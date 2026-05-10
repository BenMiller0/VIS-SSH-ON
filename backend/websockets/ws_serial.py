"""
backend/websockets/ws_serial.py

Streams `pio device monitor` output to the browser over /ws/serial.
Mirrors ws_camera.py structure exactly.

The subprocess is started when the client connects and killed when
the client disconnects — so closing the modal stops the process.
"""

import asyncio
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

EMBEDDED_SOFTWARE_DIR = os.path.abspath("embedded_software")


@router.websocket("/ws/serial")
async def ws_serial(websocket: WebSocket, baud: int = 115200) -> None:
    await websocket.accept()

    proc = await asyncio.create_subprocess_exec(
        "pio", "device", "monitor",
        "--baud", str(baud),
        "--no-reconnect",
        cwd=EMBEDDED_SOFTWARE_DIR,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    try:
        async for raw in proc.stdout:
            line = raw.decode(errors="replace").rstrip()
            if line:
                await websocket.send_text(line)
    except WebSocketDisconnect:
        pass
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()