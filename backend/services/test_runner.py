"""
backend/services/test_runner.py

Runs tests in a background thread and streams structured status events.
Sprint 3 adds computer-vision keypoint detection plus
automatic failure replay artifacts built from the recent frame buffer.
"""

import json
import random
import os
import re
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.database.database import (
    get_config_by_id,
    get_test_parameters,
    insert_artifact,
    insert_event,
    insert_result,
    update_test_run,
)
from backend.hardware.provider import IS_PI
from backend.services.cv_services import ColorBlobKeypointTracker, detect_keypoints

ARTIFACT_ROOT = Path(__file__).resolve().parents[1] / "artifacts"
CV_TEST_ROOT = Path(__file__).resolve().parents[1] / "cv_tests"


def _to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _to_int(value: str | None, default: int) -> int:
    try:
        return int(value) if value is not None else default
    except ValueError:
        return default


def _to_float(value: str | None, default: float) -> float:
    try:
        return float(value) if value is not None else default
    except ValueError:
        return default


def _read_real_metrics(prev_pixels: list[float] | None) -> tuple[float, bool, list[float]]:
    import backend.lifespan as state

    with state.thermal_lock:
        raw = state.latest_thermal
    if raw is None:
        return 0.0, False, prev_pixels or []

    data = json.loads(raw)
    temperature = data["thermistor"]
    pixels = [p for row in data["pixels"] for p in row]
    if prev_pixels is None:
        pixel_change = False
    else:
        pixel_change = any(abs(a - b) > 2.0 for a, b in zip(pixels, prev_pixels))
    return temperature, pixel_change, pixels


def _read_mock_metrics(prev_pixels: list[float] | None) -> tuple[float, bool, list[float]]:
    temperature = float(random.randint(60, 90))
    pixel_change = random.choice([True, False])
    return temperature, pixel_change, prev_pixels or []


def _latest_frame_bytes() -> bytes | None:
    import backend.lifespan as state

    with state.frame_lock:
        return state.latest_frame


def _safe_cv_script_path(file_path: str | None) -> Path | None:
    if not file_path:
        return None
    candidate = (CV_TEST_ROOT / file_path).resolve()
    root = CV_TEST_ROOT.resolve()
    if root not in candidate.parents and candidate != root:
        return None
    if candidate.suffix != ".py" or not candidate.is_file():
        return None
    return candidate


def _run_cv_script(script_path: str, payload: dict[str, Any]) -> dict[str, Any]:
    safe = _safe_cv_script_path(script_path)
    if safe is None:
        return {
            "ok": False,
            "returncode": 1,
            "stdout": "",
            "stderr": f"Invalid CV test script: {script_path}",
        }

    raw_payload = json.dumps(payload)
    env = {
        **os.environ,
        "CV_KEYPOINT_JSON": json.dumps(payload.get("keypoint", {})),
        "CV_KEYPOINTS_JSON": json.dumps(payload.get("keypoints", {})),
        "CV_TEST_JSON": raw_payload,
    }
    try:
        proc = subprocess.run(
            [sys.executable, str(safe)],
            input=raw_payload,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(CV_TEST_ROOT),
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "returncode": 124,
            "stdout": "",
            "stderr": "CV test timed out",
        }

    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }


def _recent_history(seconds: int) -> tuple[list[dict], list[dict]]:
    import backend.lifespan as state

    cutoff = time.time() - seconds
    with state.frame_history_lock:
        frames = [dict(item) for item in state.frame_history if item["time"] >= cutoff]
        if not frames and state.frame_history:
            frames = [dict(state.frame_history[-1])]

    with state.thermal_history_lock:
        thermal = [dict(item) for item in state.thermal_history if item["time"] >= cutoff]

    return frames, thermal


def _save_failure_replay(run_id: int, failure: dict[str, Any], params: dict[str, str]) -> dict[str, Any]:
    seconds = _to_int(params.get("pre_failure_seconds"), 5) + _to_int(params.get("post_failure_seconds"), 2)
    frames, thermal = _recent_history(max(1, seconds))

    run_dir = ARTIFACT_ROOT / f"run_{run_id}"
    frames_dir = run_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    max_frames = 90
    step = max(1, len(frames) // max_frames)
    frame_entries = []

    for index, frame in enumerate(frames[::step]):
        filename = f"frame_{index:04d}.jpg"
        (frames_dir / filename).write_bytes(frame["jpeg"])
        frame_entries.append({
            "index": index,
            "timestamp": frame["timestamp"],
            "url": f"/api/tests/{run_id}/replay/frames/{filename}",
        })

    thermal_entries = []
    for item in thermal:
        try:
            payload = json.loads(item["payload"])
        except json.JSONDecodeError:
            payload = {}
        thermal_entries.append({
            "timestamp": item["timestamp"],
            "thermistor": payload.get("thermistor"),
            "pixels": payload.get("pixels"),
        })

    timeline = {
        "run_id": run_id,
        "failure": failure,
        "frames": frame_entries,
        "thermal": thermal_entries,
        "created_at": datetime.now().isoformat(timespec="milliseconds"),
    }

    timeline_path = run_dir / "timeline.json"
    timeline_path.write_text(json.dumps(timeline, indent=2), encoding="utf-8")

    metadata = {
        "timeline": "timeline.json",
        "frame_count": len(frame_entries),
        "thermal_count": len(thermal_entries),
    }
    insert_artifact(run_id, "failure_replay", str(run_dir), json.dumps(metadata))

    return {
        "type": "failure_replay",
        "path": str(run_dir),
        "metadata": metadata,
        "timeline": f"/api/tests/{run_id}/replay",
    }


def _record_metric(run_id: int, payload: dict[str, Any]) -> None:
    insert_result(run_id, "sample", json.dumps(payload))
    for key, value in payload.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            insert_result(run_id, key, str(value))


def _script_keypoint_color(script_path: str | None) -> str | None:
    safe = _safe_cv_script_path(script_path)
    if safe is None:
        return None
    match = re.search(r"(?:vis\.)?keypoint\(\s*[\"']([a-zA-Z0-9_-]+)[\"']\s*\)", safe.read_text(encoding="utf-8"))
    return match.group(1).lower() if match else None


def _keypoint_color(params: dict[str, str], metric_name: str) -> str:
    color = params.get("keypoint_color") or params.get("color")
    if color:
        return color.strip().lower()
    script_color = _script_keypoint_color(params.get("script_path"))
    if script_color:
        return script_color
    if metric_name.endswith("_keypoint"):
        return metric_name.removesuffix("_keypoint").strip().lower() or "red"
    return "red"


def _is_keypoint_metric(metric_name: str) -> bool:
    return metric_name in {"red_keypoint", "green_keypoint", "arm_direction"} or metric_name.endswith("_keypoint")


def _cv_script_payload(latest_keypoint: dict[str, Any], cv_history: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "keypoint": latest_keypoint,
        "keypoints": latest_keypoint.get("keypoints", {}),
        "history": cv_history,
    }


def run_test(
    run_id: int,
    test_config_id: int,
    broadcast: Callable[[dict], None],
    stop_event: threading.Event,
    duration: int | None = None,
    registry: dict[int, tuple[threading.Event, threading.Event]] | None = None,
    kill_event: threading.Event | None = None,
) -> int:
    params = get_test_parameters(test_config_id)
    config = get_config_by_id(test_config_id)
    config_type = config["type"] if config else "custom"
    metric_name = params.get("metric") or ("red_keypoint" if config_type == "vision" else config_type)

    broadcast({"type": "start", "run_id": run_id, "config_id": test_config_id})
    insert_event(run_id, "start", "Test started", json.dumps({"config_id": test_config_id, "duration": duration}))

    read_metrics = _read_real_metrics if IS_PI else _read_mock_metrics
    deadline = time.monotonic() + duration if duration else None

    max_temp = _to_int(params.get("max_temp"), 75)
    require_pixel_change = _to_bool(params.get("require_pixel_change"), True)
    require_detection = _to_bool(params.get("require_detection"), True)
    post_failure_seconds = _to_int(params.get("post_failure_seconds"), 2)
    script_path = params.get("script_path")
    keypoint_color = _keypoint_color(params, metric_name)

    tracker = ColorBlobKeypointTracker(color=keypoint_color, roi=params.get("roi"))

    status = "pass"
    failure_reason: str | None = None
    failure_payload: dict[str, Any] | None = None
    replay_artifact: dict[str, Any] | None = None
    script_result: dict[str, Any] | None = None
    temperature = 0.0
    pixel_change = False
    prev_pixels: list[float] | None = None
    keypoint_detected = False
    latest_keypoint: dict[str, Any] = {}
    cv_history: list[dict[str, Any]] = []
    started_at = time.monotonic()

    try:
        while not stop_event.is_set():
            if deadline and time.monotonic() >= deadline:
                break

            temperature, pixel_change, prev_pixels = read_metrics(prev_pixels)
            metric_payload: dict[str, Any] = {
                "type": "metric",
                "run_id": run_id,
                "temperature": temperature,
                "pixel_changed": pixel_change,
                "elapsed_seconds": round(time.monotonic() - started_at, 2),
            }

            if _is_keypoint_metric(metric_name):
                frame = _latest_frame_bytes()
                keypoints = detect_keypoints(frame, roi=params.get("roi"))
                cv_payload = tracker.update(frame)
                cv_payload["keypoints"] = keypoints
                keypoint_detected = bool(cv_payload.get("detected"))
                latest_keypoint = cv_payload
                cv_history.append({
                    **cv_payload,
                    "elapsed_seconds": metric_payload["elapsed_seconds"],
                    "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                })
                metric_payload.update(cv_payload)
                if script_path:
                    script_result = _run_cv_script(script_path, _cv_script_payload(latest_keypoint, cv_history))
                    metric_payload["script_result"] = {
                        "script": script_path,
                        **script_result,
                    }

            if metric_name == "thermal" and temperature > max_temp:
                status = "fail"
                failure_reason = f"temperature > {max_temp} ({temperature})"
                failure_payload = {
                    "metric": "temperature",
                    "threshold": max_temp,
                    "observed": temperature,
                    "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                    "note": failure_reason,
                }

            broadcast(metric_payload)
            _record_metric(run_id, metric_payload)

            if status == "fail":
                break

            stop_event.wait(timeout=1.0)

        if kill_event is not None and kill_event.is_set():
            status = "killed"
            failure_reason = None
            failure_payload = None
        elif status != "fail":
            if script_path and _is_keypoint_metric(metric_name):
                script_result = _run_cv_script(script_path, _cv_script_payload(latest_keypoint, cv_history))
                insert_result(run_id, "cv_script", json.dumps({
                    "script": script_path,
                    **script_result,
                }))
                if not script_result["ok"]:
                    status = "fail"
                    detail = (script_result.get("stdout") or script_result.get("stderr") or "").strip()
                    failure_reason = detail or f"{script_path} failed"
                    failure_payload = {
                        "metric": "cv_script",
                        "script": script_path,
                        "returncode": script_result.get("returncode"),
                        "stdout": script_result.get("stdout"),
                        "stderr": script_result.get("stderr"),
                        "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                        "note": failure_reason,
                    }
            elif _is_keypoint_metric(metric_name) and require_detection and not keypoint_detected:
                status = "fail"
                failure_reason = f"{keypoint_color} blob keypoint was not detected"
                failure_payload = {
                    "metric": f"{keypoint_color}_keypoint",
                    "expected": "detected",
                    "observed": "not detected",
                    "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                    "note": failure_reason,
                }
            elif require_pixel_change and not _is_keypoint_metric(metric_name) and metric_name != "custom" and not pixel_change:
                status = "fail"
                failure_reason = "pixel did not change"
                failure_payload = {
                    "metric": "pixel_changed",
                    "expected": True,
                    "observed": pixel_change,
                    "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                    "note": failure_reason,
                }

        if status == "fail" and failure_payload is not None:
            insert_event(run_id, "failure", failure_reason, json.dumps(failure_payload))
            if post_failure_seconds > 0:
                stop_event.wait(timeout=post_failure_seconds)
            replay_artifact = _save_failure_replay(run_id, failure_payload, params)

    except Exception as exc:
        status = "fail"
        failure_reason = f"runner error: {exc}"
        failure_payload = {
            "metric": "runner",
            "timestamp": datetime.now().isoformat(timespec="milliseconds"),
            "note": failure_reason,
        }
        insert_event(run_id, "error", failure_reason, json.dumps(failure_payload))
    finally:
        end_time = datetime.now()
        update_test_run(run_id, end_time, status, failure_reason)

        if registry is not None:
            registry.pop(run_id, None)

        thresholds = {}
        if config_type == "vision":
            thresholds["require_detection"] = require_detection
        elif config_type == "thermal":
            thresholds["max_temp"] = max_temp
        # For custom, no thresholds

        broadcast({
            "type": "result",
            "run_id": run_id,
            "status": status,
            "failure_reason": failure_reason,
            "failure": failure_payload,
            "artifact": replay_artifact,
            "script_result": {
                "script": script_path,
                **script_result,
            } if script_result is not None else None,
            "thresholds": thresholds,
        })

    return run_id


def run_mock_test(
    test_config_id: int,
    broadcast: Callable[[dict], None],
    stop_event: threading.Event,
    duration: int | None = None,
    registry: dict | None = None,
    kill_event: threading.Event | None = None,
) -> int:
    """Backward-compatible wrapper for older imports."""
    from backend.database.database import create_test_run

    run_id = create_test_run(test_config_id, datetime.now())
    if registry is not None:
        registry[run_id] = (stop_event, kill_event or threading.Event())
    return run_test(run_id, test_config_id, broadcast, stop_event, duration, registry, kill_event)
