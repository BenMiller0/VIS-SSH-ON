"""
backend/websockets/ws_thermal.py

Streams thermal pixel data to the browser over /ws/thermal.
Reads shared state from lifespan.py — no hardware access here.

NOTE: import the *module* rather than the variable directly.
      Importing `latest_thermal` directly captures None at import time
      and never sees updates from the thermal thread.
"""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import backend.lifespan as state

router = APIRouter()


@router.websocket("/ws/thermal")
async def ws_thermal(websocket: WebSocket) -> None:
    await websocket.accept()
    loop = asyncio.get_event_loop()
    try:
        while not state.shutdown_event.is_set():
            await loop.run_in_executor(None, state.thermal_ready.wait)
            state.thermal_ready.clear()
            if state.shutdown_event.is_set():
                break
            with state.thermal_lock:
                data = state.latest_thermal
            if data:
                await websocket.send_text(data.decode())
    except WebSocketDisconnect:
        pass