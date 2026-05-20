"""Computer-vision helpers for locating colored blob keypoints."""

import cv2
import numpy as np

# HSV thresholds for bright LEDs/markers.
_COLOR_RANGES = {
    "red": (
        (np.array([0, 160, 160], dtype=np.uint8), np.array([15, 255, 255], dtype=np.uint8)),
        (np.array([160, 160, 160], dtype=np.uint8), np.array([180, 255, 255], dtype=np.uint8)),
    ),
    "green": (
        (np.array([30, 15, 70], dtype=np.uint8), np.array([115, 255, 255], dtype=np.uint8)),
    ),
}
MIN_BLOB_AREA = 10  # px^2


def decode_jpeg(frame_bytes: bytes | None):
    if not frame_bytes:
        return None
    arr = np.frombuffer(frame_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _color_mask(frame, color: str):
    ranges = _COLOR_RANGES.get(color)
    if ranges is None:
        raise ValueError(f"Unsupported keypoint color: {color}")

    hsv  = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = None
    for lower, upper in ranges:
        color_mask = cv2.inRange(hsv, lower, upper)
        mask = color_mask if mask is None else cv2.bitwise_or(mask, color_mask)

    if color == "green":
        b, g, r = cv2.split(frame.astype(np.int16))
        brightest = np.maximum(np.maximum(r, g), b)
        darkest = np.minimum(np.minimum(r, g), b)
        color_spread = brightest - darkest
        green_or_cyan = (
            (g > 85)
            & (g >= r + 5)
            & (b >= r - 15)
            & (color_spread > 18)
        ).astype(np.uint8) * 255
        green_dominance = cv2.dilate(green_or_cyan, np.ones((5, 5), dtype=np.uint8), iterations=1)
        mask = cv2.bitwise_and(mask, green_dominance)

    mask = cv2.medianBlur(mask, 5)
    if color == "green":
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), dtype=np.uint8))

    return mask


def _contour_keypoint(contour) -> tuple[float, float, float] | None:
    area = cv2.contourArea(contour)
    if area < MIN_BLOB_AREA:
        return None

    m = cv2.moments(contour)
    if m["m00"] == 0:
        return None

    return m["m10"] / m["m00"], m["m01"] / m["m00"], area


def _find_color_blobs(frame, color: str, *, limit: int | None = None) -> list[tuple[float, float, float]]:
    """Return matching color blobs sorted largest-first."""
    mask = _color_mask(frame, color)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []

    points = [
        point
        for contour in contours
        for point in [_contour_keypoint(contour)]
        if point is not None
    ]
    points.sort(key=lambda point: point[2], reverse=True)
    return points[:limit] if limit is not None else points


def _find_color_blob(frame, color: str) -> tuple[float, float, float] | None:
    """Return (x, y, area) for the largest matching blob, or None."""
    blobs = _find_color_blobs(frame, color, limit=1)
    return blobs[0] if blobs else None


def _format_keypoint(
    *,
    color: str,
    detected: bool,
    x: float | None,
    y: float | None,
    area: float,
    frame_width: int | None,
    frame_height: int | None,
    name: str | None = None,
    note: str | None = None,
) -> dict:
    return {
        "name": name or color,
        "color": color,
        "detected": detected,
        "x": round(x, 2) if x is not None else None,
        "y": round(y, 2) if y is not None else None,
        "area": round(area, 2),
        "frame_width": frame_width,
        "frame_height": frame_height,
        "note": note or (f"{color.title()} blob keypoint" if detected else f"{color.title()} blob not visible"),
    }


def supported_keypoint_colors() -> tuple[str, ...]:
    return tuple(_COLOR_RANGES)


def detect_color_keypoint(frame_bytes: bytes | None, color: str = "red", roi: str | None = None) -> dict:
    color = color.lower().strip()
    if color not in _COLOR_RANGES:
        color = "red"

    frame = decode_jpeg(frame_bytes)
    if frame is None:
        return _format_keypoint(
            color=color,
            detected=False,
            x=None,
            y=None,
            area=0.0,
            frame_width=None,
            frame_height=None,
            note="No camera frame available",
        )

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

    pos = _find_color_blob(frame, color)
    if pos is None:
        return _format_keypoint(
            color=color,
            detected=False,
            x=None,
            y=None,
            area=0.0,
            frame_width=w,
            frame_height=h,
        )

    x, y, area = pos
    return _format_keypoint(
        color=color,
        detected=True,
        x=x + offset_x,
        y=y + offset_y,
        area=area,
        frame_width=w,
        frame_height=h,
    )


def detect_color_keypoints(
    frame_bytes: bytes | None,
    color: str = "red",
    roi: str | None = None,
    *,
    limit: int | None = None,
) -> list[dict]:
    color = color.lower().strip()
    if color not in _COLOR_RANGES:
        color = "red"

    frame = decode_jpeg(frame_bytes)
    if frame is None:
        return []

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

    blobs = _find_color_blobs(frame, color, limit=limit)
    blobs.sort(key=lambda point: (point[0], point[1]))

    return [
        _format_keypoint(
            color=color,
            name=f"{color}_{index}",
            detected=True,
            x=x + offset_x,
            y=y + offset_y,
            area=area,
            frame_width=w,
            frame_height=h,
        )
        for index, (x, y, area) in enumerate(blobs, start=1)
    ]


def detect_keypoints(frame_bytes: bytes | None, roi: str | None = None) -> dict[str, dict | list[dict]]:
    keypoints: dict[str, dict | list[dict]] = {
        color: detect_color_keypoint(frame_bytes, color=color, roi=roi)
        for color in supported_keypoint_colors()
    }
    red_points = detect_color_keypoints(frame_bytes, color="red", roi=roi, limit=3)
    keypoints["red_points"] = red_points
    for point in red_points:
        keypoints[point["name"]] = point
    return keypoints


def detect_red_keypoint(frame_bytes: bytes | None, roi: str | None = None) -> dict:
    return detect_color_keypoint(frame_bytes, color="red", roi=roi)


class RedBlobKeypointTracker:
    """Small state wrapper used by tests and routes."""

    def __init__(self, roi: str | None = None):
        self.roi = roi

    def update(self, frame_bytes: bytes | None) -> dict:
        return detect_red_keypoint(frame_bytes, self.roi)


class ColorBlobKeypointTracker:
    """Small state wrapper used by tests and routes."""

    def __init__(self, color: str = "red", roi: str | None = None):
        self.color = color
        self.roi = roi

    def update(self, frame_bytes: bytes | None) -> dict:
        return detect_color_keypoint(frame_bytes, self.color, self.roi)
