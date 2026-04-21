"""
backend/services/test_runner.py

Runs a test synchronously in a background thread.
Receives a broadcast callable so it stays decoupled from WebSocket concerns —
the caller (routes_tests.py) injects broadcast_test_update from ws_test.py.
"""

import random
import time
from collections.abc import Callable
from datetime import datetime

from backend.database.database import (
    create_test_run,
    get_test_parameters,
    insert_result,
    update_test_run,
)


def run_mock_test(test_config_id: int, broadcast: Callable[[dict], None]) -> int:
    # ── Start ─────────────────────────────────────────────────────────────────
    start_time  = datetime.now()
    test_run_id = create_test_run(test_config_id, start_time)

    broadcast({"type": "start", "run_id": test_run_id})
    time.sleep(0.1)

    # ── Load thresholds ───────────────────────────────────────────────────────
    params               = get_test_parameters(test_config_id)
    max_temp             = int(params.get("max_temp", 75))
    require_pixel_change = params.get("require_pixel_change", "true") == "true"

    # ── Simulate metrics ──────────────────────────────────────────────────────
    temperature  = random.randint(60, 90)
    pixel_change = random.choice([True, False])

    broadcast({
        "type":          "metric",
        "temperature":   temperature,
        "pixel_changed": pixel_change,
    })
    time.sleep(0.1)

    # ── Persist ───────────────────────────────────────────────────────────────
    insert_result(test_run_id, "temperature",   str(temperature))
    insert_result(test_run_id, "pixel_changed", str(pixel_change))

    # ── Evaluate ──────────────────────────────────────────────────────────────
    status         = "pass"
    failure_reason = None

    if temperature > max_temp:
        status         = "fail"
        failure_reason = f"temperature > {max_temp} ({temperature})"
    elif require_pixel_change and not pixel_change:
        status         = "fail"
        failure_reason = "pixel did not change"

    # ── End ───────────────────────────────────────────────────────────────────
    end_time = datetime.now()
    update_test_run(test_run_id, end_time, status, failure_reason)

    broadcast({
        "type":           "result",
        "status":         status,
        "failure_reason": failure_reason,
    })

    return test_run_id