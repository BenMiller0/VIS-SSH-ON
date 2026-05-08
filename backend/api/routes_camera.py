"""
backend/api/api_ptz.py

POST /api/ptz  —  adjust camera zoom level via picamera2 ScalerCrop.

Pan/tilt (dir: up/down/left/right) is accepted and returns ok so the
frontend doesn't error — wire those to a servo controller when ready.
"""

from fastapi import APIRouter
from pydantic import BaseModel

import backend.lifespan as state
from backend.hardware.provider import IS_PI
from backend.hardware.interface_camera import ZOOM_MIN, ZOOM_MAX

router = APIRouter()

ZOOM_STEP   = 0.15                              # base increment per press
SPEED_MULT  = {1: 0.5, 2: 0.75, 3: 1.0, 4: 1.5, 5: 2.0}


class PTZCommand(BaseModel):
    dir:   str
    speed: int = 3


@router.post("/api/ptz")
async def ptz(cmd: PTZCommand):
    # Pan/tilt — placeholder until servos are wired up
    if cmd.dir not in ("zoom-in", "zoom-out", "home", "stop"):
        return {"status": "ok", "zoom": round(state.camera._zoom_level, 2)}

    # Zoom is a no-op on the mock camera (dev machine without picamera2)
    if not IS_PI:
        return {"status": "ok", "zoom": 1.0}

    step        = ZOOM_STEP * SPEED_MULT.get(cmd.speed, 1.0)
    current     = state.camera._zoom_level

    if cmd.dir == "zoom-in":
        new_zoom = min(ZOOM_MAX, current + step)
    elif cmd.dir == "zoom-out":
        new_zoom = max(ZOOM_MIN, current - step)
    else:  # home / stop
        new_zoom = 1.0

    state.camera.set_zoom(new_zoom)
    return {"status": "ok", "zoom": round(new_zoom, 2)}