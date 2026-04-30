"""
backend/services/test_runner.py

Runs a test synchronously in a background thread.
Receives a broadcast callable so it stays decoupled from WebSocket concerns —
the caller (routes_tests.py) injects broadcast_test_update from ws_test.py.

On a Raspberry Pi (IS_PI=True), metrics are read from the real AMG88xx sensor
via the shared state in lifespan.py. Locally, random values are used instead.
"""

import json
import random
import threading
from collections.abc import Callable
from datetime import datetime

from backend.database.database import (
    create_test_run,
    get_test_parameters,
    insert_result,
    update_test_run,
)
from backend.hardware.provider import IS_PI


def _read_real_metrics(prev_pixels: list[float] | None) -> tuple[float, bool, list[float]]:
    import backend.lifespan as state
    with state.thermal_lock:
        raw = state.latest_thermal
    if raw is None:
        return 0.0, False, prev_pixels or []
    data        = json.loads(raw)
    temperature = data["thermistor"]
    pixels      = [p for row in data["pixels"] for p in row]
    if prev_pixels is None:
        pixel_change = False
    else:
        pixel_change = any(abs(a - b) > 2.0 for a, b in zip(pixels, prev_pixels))
    return temperature, pixel_change, pixels


def _read_mock_metrics(prev_pixels: list[float] | None) -> tuple[float, bool, list[float]]:
    temperature  = float(random.randint(60, 90))
    pixel_change = random.choice([True, False])
    return temperature, pixel_change, prev_pixels or []


def run_mock_test(
    test_config_id: int,
    broadcast: Callable[[dict], None],
    stop_event: threading.Event,
    duration: int | None = None,
    registry: dict | None = None,
    kill_event: threading.Event | None = None,
) -> int:
    start_time  = datetime.now()
    test_run_id = create_test_run(test_config_id, start_time)

    if registry is not None:
        registry[test_run_id] = (stop_event, kill_event)

    broadcast({"type": "start", "run_id": test_run_id})

    params               = get_test_parameters(test_config_id)
    max_temp             = int(params.get("max_temp", 75))
    require_pixel_change = params.get("require_pixel_change", "true") == "true"

    if duration:
        threading.Timer(duration, stop_event.set).start()

    read_metrics = _read_real_metrics if IS_PI else _read_mock_metrics

    temperature  = 0.0
    pixel_change = False
    prev_pixels: list[float] | None = None

    while not stop_event.is_set():
        temperature, pixel_change, prev_pixels = read_metrics(prev_pixels)

        broadcast({
            "type":          "metric",
            "temperature":   temperature,
            "pixel_changed": pixel_change,
        })

        insert_result(test_run_id, "temperature",   str(temperature))
        insert_result(test_run_id, "pixel_changed", str(pixel_change))

        stop_event.wait(timeout=1.0)

    # Manual stop (kill) skips pass/fail — the test didn't run to completion
    if kill_event is not None and kill_event.is_set():
        status         = "killed"
        failure_reason = None
    else:
        status         = "pass"
        failure_reason = None
        if temperature > max_temp:
            status         = "fail"
            failure_reason = f"temperature > {max_temp} ({temperature})"
        elif require_pixel_change and not pixel_change:
            status         = "fail"
            failure_reason = "pixel did not change"

    end_time = datetime.now()
    update_test_run(test_run_id, end_time, status, failure_reason)

    if registry is not None:
        registry.pop(test_run_id, None)

    broadcast({
        "type":           "result",
        "status":         status,
        "failure_reason": failure_reason,
        "thresholds": {
            "max_temp":             max_temp,
            "require_pixel_change": require_pixel_change,
        },
    })

    return test_run_id
