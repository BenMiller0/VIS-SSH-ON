"""
backend/api/routes_camera.py
"""

from fastapi import APIRouter
from pydantic import BaseModel

import backend.lifespan as state
from backend.hardware.provider import IS_PI
from backend.hardware.interface_camera import (
    PITCH_HOME,
    PITCH_MAX,
    PITCH_MIN,
    YAW_HOME,
    YAW_MAX,
    YAW_MIN,
    ZOOM_MAX,
    ZOOM_MIN,
)

router = APIRouter()

ZOOM_STEP  = 0.15
PITCH_STEP = 5
YAW_STEP   = 5
SPEED_MULT = {1: 0.5, 2: 0.75, 3: 1.0, 4: 1.5, 5: 2.0}

VALID_DIRS = ("zoom-in", "zoom-out", "home", "stop", "up", "down", "left", "right")


class PTZCommand(BaseModel):
    dir:   str
    speed: int = 3


@router.post("/api/ptz")
async def ptz(cmd: PTZCommand):
    if cmd.dir not in VALID_DIRS:
        return {"status": "error", "msg": f"unknown direction: {cmd.dir}"}

    if not IS_PI:
        return {"status": "ok", "zoom": 1.0}

    mult = SPEED_MULT.get(cmd.speed, 1.0)

    if cmd.dir == "zoom-in":
        state.camera.set_zoom(min(ZOOM_MAX, state.camera._zoom_level + ZOOM_STEP * mult))

    elif cmd.dir == "zoom-out":
        state.camera.set_zoom(max(ZOOM_MIN, state.camera._zoom_level - ZOOM_STEP * mult))

    elif cmd.dir == "up":
        state.camera.set_pitch(min(PITCH_MAX, state.camera._current_pitch + int(PITCH_STEP * mult)))

    elif cmd.dir == "down":
        state.camera.set_pitch(max(PITCH_MIN, state.camera._current_pitch - int(PITCH_STEP * mult)))

    elif cmd.dir == "left":
        state.camera.set_yaw(max(YAW_MIN, state.camera._current_yaw - int(YAW_STEP * mult)))

    elif cmd.dir == "right":
        state.camera.set_yaw(min(YAW_MAX, state.camera._current_yaw + int(YAW_STEP * mult)))

    elif cmd.dir in ("home", "stop"):
        state.camera.set_zoom(1.0)
        state.camera.set_pitch(PITCH_HOME)
        state.camera.set_yaw(YAW_HOME)

    return {
        "status": "ok",
        "zoom":   round(state.camera._zoom_level, 2),
        "pitch":  state.camera._current_pitch,
        "yaw":    state.camera._current_yaw,
    }
