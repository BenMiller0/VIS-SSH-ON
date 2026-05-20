"""Editable Python CV test scripts and runner."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import backend.lifespan as state
from backend.services.cv_services import detect_keypoints

router = APIRouter(prefix="/api/cv-tests", tags=["cv-tests"])

CV_TEST_ROOT = Path(__file__).resolve().parents[1] / "cv_tests"
CV_TEST_ROOT.mkdir(parents=True, exist_ok=True)


class FileContent(BaseModel):
    content: str


def _safe_path(file_path: str) -> Path | None:
    candidate = (CV_TEST_ROOT / file_path).resolve()
    root = CV_TEST_ROOT.resolve()
    if root not in candidate.parents and candidate != root:
        return None
    if candidate.suffix != ".py":
        return None
    return candidate


def _latest_payload(history_seconds: float = 3.0) -> dict:
    with state.frame_lock:
        frame = state.latest_frame
    keypoints = detect_keypoints(frame)
    latest = keypoints["red"]

    cutoff = time.time() - history_seconds
    samples = []
    with state.frame_history_lock:
        frames = [dict(item) for item in state.frame_history if item["time"] >= cutoff]

    for item in frames:
        sample_keypoints = detect_keypoints(item["jpeg"])
        keypoint = sample_keypoints["red"]
        keypoint["keypoints"] = sample_keypoints
        keypoint["timestamp"] = item["timestamp"]
        keypoint["time"] = item["time"]
        samples.append(keypoint)

    return {
        "keypoint": latest,
        "keypoints": keypoints,
        "history": samples,
    }


@router.get("")
def list_cv_tests():
    files = [
        str(path.relative_to(CV_TEST_ROOT)).replace(os.sep, "/")
        for path in sorted(CV_TEST_ROOT.rglob("*.py"))
        if "__pycache__" not in path.parts
        and not path.name.startswith("_")
        and path.name != "vis_ssh_on.py"
    ]
    return {"files": files}


@router.get("/{file_path:path}")
def read_cv_test(file_path: str):
    safe = _safe_path(file_path)
    if safe is None:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    if not safe.is_file():
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return {"path": file_path, "content": safe.read_text(encoding="utf-8")}


@router.post("/run/{file_path:path}")
def run_cv_test(file_path: str):
    safe = _safe_path(file_path)
    if safe is None:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    if not safe.is_file():
        return JSONResponse(status_code=404, content={"error": "Not found"})

    payload_data = _latest_payload()
    payload = json.dumps(payload_data)
    env = {
        **os.environ,
        "CV_KEYPOINT_JSON": json.dumps(payload_data["keypoint"]),
        "CV_KEYPOINTS_JSON": json.dumps(payload_data["keypoints"]),
        "CV_TEST_JSON": payload,
    }

    try:
        proc = subprocess.run(
            [sys.executable, str(safe)],
            input=payload,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(CV_TEST_ROOT),
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return JSONResponse(status_code=408, content={"error": "Test timed out"})

    return {
        "path": file_path,
        "returncode": proc.returncode,
        "ok": proc.returncode == 0,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        **payload_data,
    }


@router.post("/{file_path:path}")
def write_cv_test(file_path: str, body: FileContent):
    safe = _safe_path(file_path)
    if safe is None:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    safe.parent.mkdir(parents=True, exist_ok=True)
    safe.write_text(body.content, encoding="utf-8")
    return {"success": True, "path": file_path}
