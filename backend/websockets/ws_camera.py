"""
backend/websockets/ws_camera.py

Streams JPEG frames to the browser over /ws.
Reads shared state from lifespan.py — no hardware access here.
"""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.lifespan import frame_lock, frame_ready, latest_frame, shutdown_event

router = APIRouter()


@router.websocket("/ws")
async def ws_camera(websocket: WebSocket) -> None:
    await websocket.accept()
    loop = asyncio.get_event_loop()
    try:
        while not shutdown_event.is_set():
            await loop.run_in_executor(None, frame_ready.wait)
            frame_ready.clear()
            if shutdown_event.is_set():
                break
            with frame_lock:
                frame = latest_frame
            if frame:
                await websocket.send_bytes(frame)
    except WebSocketDisconnect:
        pass