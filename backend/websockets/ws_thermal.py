"""
backend/websockets/ws_thermal.py

Streams thermal pixel data to the browser over /ws/thermal.
Reads shared state from lifespan.py — no hardware access here.
"""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.lifespan import latest_thermal, shutdown_event, thermal_lock, thermal_ready

router = APIRouter()


@router.websocket("/ws/thermal")
async def ws_thermal(websocket: WebSocket) -> None:
    await websocket.accept()
    loop = asyncio.get_event_loop()
    try:
        while not shutdown_event.is_set():
            await loop.run_in_executor(None, thermal_ready.wait)
            thermal_ready.clear()
            if shutdown_event.is_set():
                break
            with thermal_lock:
                data = latest_thermal
            if data:
                await websocket.send_text(data.decode())
    except WebSocketDisconnect:
        pass