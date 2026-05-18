"""Helpers for editable CV tests.

The UI runner sends:
  - keypoint: the latest red blob keypoint
  - history: recent red blob keypoints from prior camera frames

Tests can stay small by importing these helpers.
"""

import json
import math
import os
import sys


def load_payload() -> dict:
    raw = sys.stdin.read().strip() or os.environ.get("CV_TEST_JSON", "{}")
    payload = json.loads(raw or "{}")
    if "keypoint" not in payload:
        payload = {"keypoint": payload, "history": []}
    payload.setdefault("history", [])
    return payload


def detected_points(payload: dict) -> list[dict]:
    points = [p for p in payload.get("history", []) if p.get("detected")]
    latest = payload.get("keypoint", {})
    if latest.get("detected"):
        points.append(latest)
    return points


def require_keypoint(payload: dict) -> dict:
    keypoint = payload.get("keypoint", {})
    if not keypoint.get("detected"):
        fail("red blob not detected")
    return keypoint


def rotation_direction(points: list[dict]) -> str:
    if len(points) < 2:
        fail("need at least two detected red blob samples")

    width = next((p.get("frame_width") for p in points if p.get("frame_width")), None)
    height = next((p.get("frame_height") for p in points if p.get("frame_height")), None)
    if not width or not height:
        fail("frame size unavailable")

    center_x = width / 2
    center_y = height / 2
    total_delta = 0.0
    previous = math.atan2(points[0]["y"] - center_y, points[0]["x"] - center_x)

    for point in points[1:]:
        current = math.atan2(point["y"] - center_y, point["x"] - center_x)
        delta = current - previous
        while delta > math.pi:
            delta -= 2 * math.pi
        while delta < -math.pi:
            delta += 2 * math.pi
        total_delta += delta
        previous = current

    if abs(math.degrees(total_delta)) < 8:
        fail("red blob did not rotate enough")

    return "clockwise" if total_delta > 0 else "counterclockwise"


def pass_test(**details) -> None:
    print(json.dumps({"ok": True, **details}))


def fail(reason: str, **details) -> None:
    print(json.dumps({"ok": False, "reason": reason, **details}))
    raise SystemExit(1)
