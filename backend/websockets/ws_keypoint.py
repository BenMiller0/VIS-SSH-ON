"""Streams the latest colored blob keypoints over /ws/keypoint."""

import asyncio
import copy
import json
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import backend.lifespan as state
from backend.services.cv_services import detect_keypoints

router = APIRouter()


@router.websocket("/ws/keypoint")
async def ws_keypoint(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while not state.shutdown_event.is_set():
            with state.frame_lock:
                frame = state.latest_frame
            keypoints = detect_keypoints(frame)
            payload = copy.deepcopy(keypoints["red"])
            if not payload.get("detected") and keypoints["green"].get("detected"):
                payload = copy.deepcopy(keypoints["green"])
            payload["keypoints"] = copy.deepcopy(keypoints)
            payload["type"] = "keypoint"
            payload["timestamp"] = datetime.now().isoformat(timespec="milliseconds")
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        pass
