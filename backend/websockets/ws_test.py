"""
backend/websockets/ws_test.py

Manages the /ws/test WebSocket endpoint and the broadcast function used
by background threads (test_runner) to push test events to all connected clients.

broadcast_test_update() is the single point of import for anything that needs
to push a test event — it safely crosses the thread→asyncio boundary.
"""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import backend.lifespan as _lifespan

router = APIRouter()

# Connected test-status clients
_clients: list[WebSocket] = []


def broadcast_test_update(data: dict) -> None:
    """
    Thread-safe broadcast to all connected /ws/test clients.
    Safe to call from background threads (e.g. test_runner).

    Reads _lifespan.main_loop at call time (not import time) so it always
    sees the value set by the lifespan context manager on startup.
    """
    loop = _lifespan.main_loop
    if loop is None:
        print("[broadcast] ERROR: main_loop is None")
        return

    dead: list[WebSocket] = []
    for ws in _clients:
        try:
            asyncio.run_coroutine_threadsafe(ws.send_json(data), loop)
        except Exception as exc:
            print(f"[broadcast] send failed: {exc}")
            dead.append(ws)

    for ws in dead:
        _clients.remove(ws)


@router.websocket("/ws/test")
async def ws_test(websocket: WebSocket) -> None:
    await websocket.accept()
    _clients.append(websocket)
    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in _clients:
            _clients.remove(websocket)