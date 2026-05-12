"""
backend/services/test_runner.py

Runs tests in a background thread and streams structured status events.
Sprint 3 adds a first computer-vision metric for robotic-arm direction plus
automatic failure replay artifacts built from the recent frame buffer.
"""

import json
import random
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
from backend.services.cv_services import ArmDirectionTracker

ARTIFACT_ROOT = Path(__file__).resolve().parents[1] / "artifacts"


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


def _opposite_direction(direction: str) -> str:
    return "clockwise" if direction == "counterclockwise" else "counterclockwise"


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
    metric_name = params.get("metric") or ("arm_direction" if config_type == "vision" else config_type)

    broadcast({"type": "start", "run_id": run_id, "config_id": test_config_id})
    insert_event(run_id, "start", "Test started", json.dumps({"config_id": test_config_id, "duration": duration}))

    read_metrics = _read_real_metrics if IS_PI else _read_mock_metrics
    deadline = time.monotonic() + duration if duration else None

    max_temp = _to_int(params.get("max_temp"), 75)
    require_pixel_change = _to_bool(params.get("require_pixel_change"), True)
    expected_direction = params.get("expected_direction", "counterclockwise")
    confidence_threshold = _to_float(params.get("confidence_threshold"), 0.75)
    require_detection = _to_bool(params.get("require_detection"), True)
    post_failure_seconds = _to_int(params.get("post_failure_seconds"), 2)

    tracker = ArmDirectionTracker(
        roi=params.get("roi"),
        min_angle_delta_deg=_to_float(params.get("min_angle_delta_deg"), 8.0),
    )

    status = "pass"
    failure_reason: str | None = None
    failure_payload: dict[str, Any] | None = None
    replay_artifact: dict[str, Any] | None = None
    temperature = 0.0
    pixel_change = False
    prev_pixels: list[float] | None = None
    last_direction = "unknown"
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

            if metric_name == "arm_direction":
                cv_payload = tracker.update(_latest_frame_bytes())

                # Local development machines usually do not have the arm and marker.
                # Simulate a clear opposite-direction observation so the Sprint 3 UI
                # can be exercised without the physical rig.
                if not IS_PI and cv_payload["observed_direction"] == "unknown" and metric_payload["elapsed_seconds"] >= 2:
                    observed = params.get("mock_observed_direction") or _opposite_direction(expected_direction)
                    cv_payload = {
                        "observed_direction": observed,
                        "angle_delta_deg": -18.0 if observed == "clockwise" else 18.0,
                        "confidence": 0.92,
                        "note": "Mock arm-direction observation.",
                    }

                last_direction = cv_payload.get("observed_direction", "unknown")
                metric_payload.update({
                    "expected_direction": expected_direction,
                    **cv_payload,
                })

                confident = metric_payload.get("confidence", 0.0) >= confidence_threshold
                observed = metric_payload.get("observed_direction")
                if confident and observed in {"clockwise", "counterclockwise"} and observed != expected_direction:
                    status = "fail"
                    failure_reason = f"arm rotated {observed}; expected {expected_direction}"
                    failure_payload = {
                        "metric": "arm_direction",
                        "expected": expected_direction,
                        "observed": observed,
                        "confidence": metric_payload.get("confidence"),
                        "angle_delta_deg": metric_payload.get("angle_delta_deg"),
                        "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                        "note": failure_reason,
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
            if metric_name == "arm_direction" and require_detection and last_direction == "unknown":
                status = "fail"
                failure_reason = "arm direction was not confidently detected"
                failure_payload = {
                    "metric": "arm_direction",
                    "expected": expected_direction,
                    "observed": "unknown",
                    "confidence": 0.0,
                    "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                    "note": failure_reason,
                }
            elif require_pixel_change and metric_name not in {"arm_direction", "custom"} and not pixel_change:
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
            thresholds["confidence_threshold"] = confidence_threshold
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