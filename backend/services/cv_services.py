"""
backend/services/cv_services.py

Small computer-vision helpers for Sprint 3 test metrics.
The arm-direction tracker looks for a high-saturation marker in the configured
ROI and estimates clockwise/counterclockwise motion around the ROI center.

Sprint 3 update: Added optical flow fallback for testing without colored markers.
"""

import math
from dataclasses import dataclass, field

import cv2
import numpy as np


def decode_jpeg(frame_bytes: bytes | None):
    if not frame_bytes:
        return None
    arr = np.frombuffer(frame_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _parse_roi(value: str | None, frame) -> tuple[int, int, int, int]:
    height, width = frame.shape[:2]
    if value:
        try:
            x, y, w, h = [int(part.strip()) for part in value.split(",")]
            x = max(0, min(width - 1, x))
            y = max(0, min(height - 1, y))
            w = max(1, min(width - x, w))
            h = max(1, min(height - y, h))
            return x, y, w, h
        except ValueError:
            pass
    return 0, 0, width, height


def _largest_marker_center(frame, roi: tuple[int, int, int, int]) -> tuple[float, float, float] | None:
    x, y, w, h = roi
    crop = frame[y:y + h, x:x + w]
    if crop.size == 0:
        return None

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    # High-saturation marker detection is intentionally broad so a colored tape
    # marker works without tuning a precise hue range.
    mask = cv2.inRange(hsv, np.array([0, 70, 60]), np.array([179, 255, 255]))
    mask = cv2.medianBlur(mask, 5)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contour = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(contour))
    if area < 20:
        return None

    moments = cv2.moments(contour)
    if moments["m00"] == 0:
        return None

    cx = x + (moments["m10"] / moments["m00"])
    cy = y + (moments["m01"] / moments["m00"])
    confidence = min(1.0, area / max(1.0, w * h * 0.015))
    return cx, cy, confidence


def _angle_delta_degrees(previous: float, current: float) -> float:
    delta = current - previous
    while delta > math.pi:
        delta -= 2 * math.pi
    while delta < -math.pi:
        delta += 2 * math.pi
    return math.degrees(delta)


def detect_rotation_optical_flow(
    prev_jpeg: bytes | None,
    curr_jpeg: bytes | None,
    roi: tuple[int, int, int, int] | None = None
) -> dict:
    """
    Fallback detector using optical flow when no colored marker is present.
    Useful for testing with bare hands or unmarked objects.
    """
    if prev_jpeg is None or curr_jpeg is None:
        return {
            "observed_direction": "unknown",
            "angle_delta_deg": 0.0,
            "confidence": 0.0,
            "note": "Need two frames for optical flow"
        }
    
    prev = decode_jpeg(prev_jpeg)
    curr = decode_jpeg(curr_jpeg)
    if prev is None or curr is None:
        return {
            "observed_direction": "unknown",
            "angle_delta_deg": 0.0,
            "confidence": 0.0,
            "note": "Frame decode failed"
        }
    
    # Convert to grayscale
    prev_gray = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    curr_gray = cv2.cvtColor(curr, cv2.COLOR_BGR2GRAY)
    
    # Crop to ROI if specified
    if roi:
        x, y, w, h = roi
        prev_gray = prev_gray[y:y+h, x:x+w]
        curr_gray = curr_gray[y:y+h, x:x+w]
    
    # Dense optical flow
    flow = cv2.calcOpticalFlowFarneback(
        prev_gray, curr_gray, None,
        pyr_scale=0.5,
        levels=3,
        winsize=15,
        iterations=3,
        poly_n=5,
        poly_sigma=1.2,
        flags=0
    )
    
    # Average horizontal flow (x-direction indicates CW/CCW)
    mean_x = float(np.mean(flow[..., 0]))
    mean_magnitude = float(np.mean(np.sqrt(flow[..., 0]**2 + flow[..., 1]**2)))
    
    # Need significant motion to determine direction
    if mean_magnitude < 0.5:
        return {
            "observed_direction": "unknown",
            "angle_delta_deg": 0.0,
            "confidence": 0.0,
            "note": "Insufficient motion detected"
        }
    
    # Horizontal flow indicates rotation direction
    # Positive x-flow = object moving right = clockwise rotation
    direction = "clockwise" if mean_x > 0 else "counterclockwise"
    confidence = min(1.0, mean_magnitude / 5.0)  # Scale 0-1
    
    return {
        "observed_direction": direction,
        "angle_delta_deg": round(mean_x * 10, 2),  # Rough conversion to degrees
        "confidence": round(confidence, 3),
        "flow_magnitude": round(mean_magnitude, 2),
        "note": "Optical flow detection (no marker)"
    }


@dataclass
class ArmDirectionTracker:
    roi: str | None = None
    min_angle_delta_deg: float = 8.0
    previous_angle: float | None = None
    previous_frame: bytes | None = field(default=None, repr=False)

    def update(self, frame_bytes: bytes | None) -> dict:
        frame = decode_jpeg(frame_bytes)
        if frame is None:
            return {
                "observed_direction": "unknown",
                "angle_delta_deg": 0.0,
                "confidence": 0.0,
                "note": "No camera frame available.",
            }

        roi = _parse_roi(self.roi, frame)
        marker = _largest_marker_center(frame, roi)
        
        # Try marker detection first (preferred method)
        if marker is not None:
            marker_x, marker_y, marker_confidence = marker
            x, y, w, h = roi
            center_x = x + w / 2
            center_y = y + h / 2
            angle = math.atan2(center_y - marker_y, marker_x - center_x)

            if self.previous_angle is None:
                self.previous_angle = angle
                return {
                    "observed_direction": "unknown",
                    "angle_delta_deg": 0.0,
                    "confidence": round(marker_confidence * 0.4, 3),
                    "marker": {"x": round(marker_x, 1), "y": round(marker_y, 1)},
                    "note": "Marker acquired; waiting for movement.",
                }

            delta = _angle_delta_degrees(self.previous_angle, angle)
            self.previous_angle = angle

            if abs(delta) < self.min_angle_delta_deg:
                direction = "unknown"
                direction_confidence = marker_confidence * 0.5
            else:
                direction = "counterclockwise" if delta > 0 else "clockwise"
                direction_confidence = marker_confidence

            return {
                "observed_direction": direction,
                "angle_delta_deg": round(delta, 2),
                "confidence": round(direction_confidence, 3),
                "marker": {"x": round(marker_x, 1), "y": round(marker_y, 1)},
                "roi": {"x": x, "y": y, "w": w, "h": h},
                "note": "Color marker tracking"
            }
        
        # Fallback to optical flow if no marker detected
        if self.previous_frame is None:
            self.previous_frame = frame_bytes
            return {
                "observed_direction": "unknown",
                "angle_delta_deg": 0.0,
                "confidence": 0.0,
                "note": "No marker detected; initializing optical flow fallback"
            }
        
        result = detect_rotation_optical_flow(self.previous_frame, frame_bytes, roi)
        self.previous_frame = frame_bytes
        return result