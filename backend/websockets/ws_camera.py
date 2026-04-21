"""
backend/websockets/ws_camera.py

Streams JPEG frames to the browser over /ws.
Reads shared state from lifespan.py — no hardware access here.

NOTE: import the *module* rather than the variable directly.
      Importing `latest_frame` directly captures None at import time
      and never sees updates from the capture thread.
"""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import backend.lifespan as state

router = APIRouter()


@router.websocket("/ws")
async def ws_camera(websocket: WebSocket) -> None:
    await websocket.accept()
    loop = asyncio.get_event_loop()
    try:
        while not state.shutdown_event.is_set():
            await loop.run_in_executor(None, state.frame_ready.wait)
            state.frame_ready.clear()
            if state.shutdown_event.is_set():
                break
            with state.frame_lock:
                frame = state.latest_frame
            if frame:
                await websocket.send_bytes(frame)
    except WebSocketDisconnect:
        pass