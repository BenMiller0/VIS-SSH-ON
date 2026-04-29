"""
backend/api/routes_tests.py

CRUD + execution routes for test runs.
  POST   /api/tests/{config_id}    — run a test
  POST   /api/tests/{run_id}/stop  — stop a running test
  GET    /api/tests                — list all runs
  GET    /api/tests/{run_id}       — get a single run
  DELETE /api/tests/{run_id}       — delete a run
"""

import asyncio
import threading

from fastapi import APIRouter, Body, HTTPException

from backend.database.database import (
    delete_test_run,
    get_test_runs,
    query_all,
)
from backend.schemas import TestRunRequest, TestRunResponse
from backend.websockets.ws_test import broadcast_test_update

router = APIRouter(prefix="/api/tests", tags=["tests"])

_running: dict[int, threading.Event] = {}


@router.post("/{config_id}")
async def create_test(config_id: int, body: TestRunRequest = Body(default=TestRunRequest())):
    from backend.services.test_runner import run_mock_test
    stop_event = threading.Event()
    kill_event = threading.Event()
    loop = asyncio.get_event_loop()
    run_id = await loop.run_in_executor(
        None, run_mock_test, config_id, broadcast_test_update, stop_event, body.duration, _running, kill_event
    )
    _running.pop(run_id, None)
    return {"run_id": run_id}


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


@router.get("/{run_id}", response_model=TestRunResponse)
def get_test(run_id: int):
    rows = query_all("SELECT * FROM test_runs WHERE id = ?", (run_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="Test run not found")
    return dict(rows[0])


@router.delete("/{run_id}")
def delete_test(run_id: int):
    delete_test_run(run_id)
    return {"ok": True}
