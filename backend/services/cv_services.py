"""Computer-vision helpers for locating the red blob keypoint."""

import cv2
import numpy as np

# ── Red LED thresholds (HSV) ─────────────────────────────────────────────────
_RED_LOWER1 = np.array([  0, 160, 160], dtype=np.uint8)
_RED_UPPER1 = np.array([ 15, 255, 255], dtype=np.uint8)
_RED_LOWER2 = np.array([160, 160, 160], dtype=np.uint8)
_RED_UPPER2 = np.array([180, 255, 255], dtype=np.uint8)
MIN_BLOB_AREA = 10  # px^2


def decode_jpeg(frame_bytes: bytes | None):
    if not frame_bytes:
        return None
    arr = np.frombuffer(frame_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _find_red_blob(frame) -> tuple[float, float, float] | None:
    """Return (x, y, area) for the largest red blob, or None."""
    hsv  = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.bitwise_or(
        cv2.inRange(hsv, _RED_LOWER1, _RED_UPPER1),
        cv2.inRange(hsv, _RED_LOWER2, _RED_UPPER2),
    )
    mask = cv2.medianBlur(mask, 5)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < MIN_BLOB_AREA:
        return None

    m = cv2.moments(largest)
    if m["m00"] == 0:
        return None

    return m["m10"] / m["m00"], m["m01"] / m["m00"], cv2.contourArea(largest)


def detect_red_keypoint(frame_bytes: bytes | None, roi: str | None = None) -> dict:
    frame = decode_jpeg(frame_bytes)
    if frame is None:
        return {
            "detected": False,
            "x": None,
            "y": None,
            "area": 0.0,
            "frame_width": None,
            "frame_height": None,
            "note": "No camera frame available",
        }

    h, w = frame.shape[:2]
    offset_x = 0
    offset_y = 0

    if roi:
        try:
            rx, ry, rw, rh = [int(p.strip()) for p in roi.split(",")]
            frame = frame[ry:ry + rh, rx:rx + rw]
            offset_x = rx
            offset_y = ry
        except ValueError:
            pass

    pos = _find_red_blob(frame)
    if pos is None:
        return {
            "detected": False,
            "x": None,
            "y": None,
            "area": 0.0,
            "frame_width": w,
            "frame_height": h,
            "note": "Red blob not visible",
        }

    x, y, area = pos
    return {
        "detected": True,
        "x": round(x + offset_x, 2),
        "y": round(y + offset_y, 2),
        "area": round(area, 2),
        "frame_width": w,
        "frame_height": h,
        "note": "Red blob keypoint",
    }


class RedBlobKeypointTracker:
    """Small state wrapper used by tests and routes."""

    def __init__(self, roi: str | None = None):
        self.roi = roi

    def update(self, frame_bytes: bytes | None) -> dict:
        return detect_red_keypoint(frame_bytes, self.roi)
