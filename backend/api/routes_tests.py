"""
backend/api/routes_tests.py

CRUD + execution routes for test runs.
  POST   /api/tests/{config_id}                 - start a test
  POST   /api/tests/{run_id}/stop               - stop a running test
  GET    /api/tests                             - list all runs
  GET    /api/tests/{run_id}/report             - detailed report data
  GET    /api/tests/{run_id}/replay             - failure replay timeline
  GET    /api/tests/{run_id}/replay/frames/{f}  - replay frame image
  GET    /api/tests/{run_id}                    - get a single run
  DELETE /api/tests/{run_id}                    - delete a test run
"""

import json
import threading
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse

from backend.database.database import (
    create_test_run,
    delete_test_run,
    get_artifacts_for_run,
    get_config_by_id,
    get_events_for_run,
    get_results_for_run,
    get_test_parameters,
    get_test_run_by_id,
    get_test_runs,
)
from backend.schemas import TestReplayResponse, TestRunRequest, TestRunResponse, TestRunStartResponse
from backend.services.test_runner import ARTIFACT_ROOT, run_test
from backend.websockets.ws_test import broadcast_test_update

router = APIRouter(prefix="/api/tests", tags=["tests"])

_running: dict[int, tuple[threading.Event, threading.Event]] = {}


def _json_or_text(value: str | None):
    if value is None:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _run_dict(run_id: int) -> dict:
    row = get_test_run_by_id(run_id)
    if not row:
        raise HTTPException(status_code=404, detail="Test run not found")
    return dict(row)


def stop_all_running_tests() -> None:
    for stop_event, kill_event in list(_running.values()):
        kill_event.set()
        stop_event.set()


@router.post("/{config_id}", response_model=TestRunStartResponse)
def create_test(config_id: int, body: TestRunRequest | None = Body(default=None)):
    if not get_config_by_id(config_id):
        raise HTTPException(status_code=404, detail="Config not found")

    request = body or TestRunRequest()
    stop_event = threading.Event()
    kill_event = threading.Event()
    run_id = create_test_run(config_id, datetime.now())
    _running[run_id] = (stop_event, kill_event)

    thread = threading.Thread(
        target=run_test,
        args=(run_id, config_id, broadcast_test_update, stop_event, request.duration, _running, kill_event),
        daemon=True,
        name=f"test-run-{run_id}",
    )
    thread.start()

    return {"run_id": run_id, "status": "running"}


@router.post("/{run_id}/stop")
def stop_test(run_id: int):
    events = _running.get(run_id)
    if not events:
        raise HTTPException(status_code=404, detail="No active test with that ID")
    stop_event, kill_event = events
    kill_event.set()
    stop_event.set()
    return {"ok": True}


@router.get("", response_model=list[TestRunResponse])
def list_tests():
    return [dict(row) for row in get_test_runs()]


@router.get("/{run_id}/report")
def get_test_report(run_id: int):
    run = _run_dict(run_id)
    config = get_config_by_id(run["test_config_id"])
    results = [
        {**dict(row), "value": _json_or_text(row["value"])}
        for row in get_results_for_run(run_id)
    ]
    events = [
        {**dict(row), "payload": _json_or_text(row["payload"])}
        for row in get_events_for_run(run_id)
    ]
    artifacts = [
        {**dict(row), "metadata": _json_or_text(row["metadata"])}
        for row in get_artifacts_for_run(run_id)
    ]

    return {
        "run": run,
        "config": {**dict(config), "parameters": get_test_parameters(config["id"])} if config else None,
        "results": results,
        "events": events,
        "artifacts": artifacts,
    }


@router.get("/{run_id}/replay", response_model=TestReplayResponse)
def get_test_replay(run_id: int):
    _run_dict(run_id)
    events = [
        {**dict(row), "payload": _json_or_text(row["payload"])}
        for row in get_events_for_run(run_id)
    ]
    artifacts = get_artifacts_for_run(run_id)
    replay = next((row for row in artifacts if row["artifact_type"] == "failure_replay"), None)
    if not replay:
        return {"run_id": run_id, "available": False, "events": events}

    artifact_path = Path(replay["path"]).resolve()
    root = ARTIFACT_ROOT.resolve()
    if root not in artifact_path.parents and artifact_path != root:
        raise HTTPException(status_code=400, detail="Invalid replay artifact path")

    timeline_path = artifact_path / "timeline.json"
    if not timeline_path.exists():
        return {"run_id": run_id, "available": False, "events": events}

    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    return {
        "run_id": run_id,
        "available": True,
        "artifact": {
            "id": replay["id"],
            "type": replay["artifact_type"],
            "metadata": _json_or_text(replay["metadata"]),
        },
        "frames": timeline.get("frames", []),
        "events": events,
    }


@router.get("/{run_id}/replay/frames/{filename}")
def get_replay_frame(run_id: int, filename: str):
    if "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid frame filename")

    _run_dict(run_id)
    artifacts = get_artifacts_for_run(run_id)
    replay = next((row for row in artifacts if row["artifact_type"] == "failure_replay"), None)
    if not replay:
        raise HTTPException(status_code=404, detail="Replay artifact not found")

    artifact_path = Path(replay["path"]).resolve()
    root = ARTIFACT_ROOT.resolve()
    if root not in artifact_path.parents and artifact_path != root:
        raise HTTPException(status_code=400, detail="Invalid replay artifact path")

    frame_path = (artifact_path / "frames" / filename).resolve()
    if artifact_path not in frame_path.parents:
        raise HTTPException(status_code=400, detail="Invalid frame path")
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail="Frame not found")

    return FileResponse(frame_path, media_type="image/jpeg")


@router.get("/{run_id}", response_model=TestRunResponse)
def get_test(run_id: int):
    return _run_dict(run_id)


@router.delete("/{run_id}")
def delete_test(run_id: int):
    events = _running.get(run_id)
    if events:
        stop_event, kill_event = events
        kill_event.set()
        stop_event.set()
    delete_test_run(run_id)
    return {"ok": True}