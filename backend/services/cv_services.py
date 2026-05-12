"""
backend/services/cv_services.py
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
            x, y, w, h = [int(p.strip()) for p in value.split(",")]

            x = max(0, min(width - 1, x))
            y = max(0, min(height - 1, y))
            w = max(1, min(width - x, w))
            h = max(1, min(height - y, h))

            return x, y, w, h

        except ValueError:
            pass

    return 0, 0, width, height


def _find_red_led(frame, roi) -> tuple[float, float, float] | None:
    x, y, w, h = roi

    crop = frame[y:y + h, x:x + w]

    if crop.size == 0:
        return None

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)

    mask = cv2.bitwise_or(
        cv2.inRange(
            hsv,
            np.array([0, 160, 160]),
            np.array([15, 255, 255]),
        ),
        cv2.inRange(
            hsv,
            np.array([160, 160, 160]),
            np.array([180, 255, 255]),
        ),
    )

    mask = cv2.medianBlur(mask, 5)

    contours, _ = cv2.findContours(
        mask,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    if not contours:
        return None

    contour = max(contours, key=cv2.contourArea)

    area = float(cv2.contourArea(contour))

    if area < 10:
        return None

    m = cv2.moments(contour)

    if m["m00"] == 0:
        return None

    cx = x + m["m10"] / m["m00"]
    cy = y + m["m01"] / m["m00"]

    confidence = min(
        1.0,
        area / max(1.0, w * h * 0.005),
    )

    return cx, cy, confidence


def _angle_delta_degrees(previous: float, current: float) -> float:
    delta = current - previous

    while delta > math.pi:
        delta -= 2 * math.pi

    while delta < -math.pi:
        delta += 2 * math.pi

    return math.degrees(delta)


def detect_rotation_blob(
    prev_jpeg: bytes | None,
    curr_jpeg: bytes | None,
    roi: tuple | None = None,
) -> dict:

    DIFF_THRESHOLD = 12
    MIN_PIXELS = 20

    if prev_jpeg is None or curr_jpeg is None:
        return {
            "observed_direction": "unknown",
            "angle_delta_deg": 0.0,
            "confidence": 0.0,
            "note": "Need two frames",
        }

    prev = decode_jpeg(prev_jpeg)
    curr = decode_jpeg(curr_jpeg)

    if prev is None or curr is None:
        return {
            "observed_direction": "unknown",
            "angle_delta_deg": 0.0,
            "confidence": 0.0,
            "note": "Frame decode failed",
        }

    prev_gray = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    curr_gray = cv2.cvtColor(curr, cv2.COLOR_BGR2GRAY)

    if roi:
        x, y, w, h = roi

        prev_gray = prev_gray[y:y + h, x:x + w]
        curr_gray = curr_gray[y:y + h, x:x + w]

    else:
        h, w = prev_gray.shape

    print(f"[CV] frame size: {w}x{h} roi={roi}")

    diff = curr_gray.astype(np.int16) - prev_gray.astype(np.int16)

    diff -= int(np.median(diff))

    horn_now = diff < -DIFF_THRESHOLD
    horn_was = diff > DIFF_THRESHOLD

    n_now = int(np.sum(horn_now))
    n_was = int(np.sum(horn_was))

    print(
        f"[CV] changed pixels: "
        f"horn_now={n_now} horn_was={n_was}"
    )

    if n_now < MIN_PIXELS or n_was < MIN_PIXELS:
        return {
            "observed_direction": "unknown",
            "angle_delta_deg": 0.0,
            "confidence": 0.0,
            "changed_pixels": n_now + n_was,
            "note": (
                f"Not enough blob change "
                f"(now={n_now}, was={n_was})"
            ),
        }

    ys, xs = np.mgrid[0:h, 0:w]

    cx_now = float(np.mean(xs[horn_now]))
    cy_now = float(np.mean(ys[horn_now]))

    cx_was = float(np.mean(xs[horn_was]))
    cy_was = float(np.mean(ys[horn_was]))

    dx = cx_now - cx_was
    dy = cy_now - cy_was

    motion_dist = math.sqrt(dx**2 + dy**2)

    if motion_dist < 3.0:
        return {
            "observed_direction": "unknown",
            "angle_delta_deg": 0.0,
            "confidence": 0.0,
            "note": "Horn barely moved",
        }

    px = (cx_now + cx_was) / 2 - w / 2
    py = (cy_now + cy_was) / 2 - h / 2

    cross_z = px * dy - py * dx

    direction = (
        "clockwise"
        if cross_z > 0
        else "counterclockwise"
    )

    confidence = round(
        min(1.0, motion_dist / 20.0)
        * min(1.0, min(n_now, n_was) / 80.0),
        3,
    )

    return {
        "observed_direction": direction,
        "angle_delta_deg": round(motion_dist, 1),
        "confidence": confidence,
        "note": "Blob motion tracking",
    }


@dataclass
class ArmDirectionTracker:
    roi: str | None = None

    min_angle_delta_deg: float = 4.0

    direction_hold_frames: int = 15

    angle_smoothing: float = 0.75

    previous_frame: bytes | None = field(
        default=None,
        repr=False,
    )

    def __post_init__(self):
        self._last_dir: str | None = None
        self._last_conf: float = 0.0
        self._hold_remaining: int = 0

        self._last_marker_pos: tuple | None = None

        self._marker_stuck: bool = False
        self._stuck_buf: list = []

        self._prev_angle: float | None = None

        self._filtered_delta: float = 0.0

    def _persist(self, result: dict) -> dict:
        d = result.get("observed_direction", "unknown")
        c = result.get("confidence", 0.0)

        if d not in ("unknown", None) and c > 0.0:
            self._last_dir = d
            self._last_conf = c
            self._hold_remaining = self.direction_hold_frames

            return result

        if self._hold_remaining > 0 and self._last_dir:
            self._hold_remaining -= 1

            decayed = round(
                self._last_conf
                * (
                    self._hold_remaining
                    / self.direction_hold_frames
                ),
                3,
            )

            return {
                **result,
                "observed_direction": self._last_dir,
                "confidence": decayed,
                "note": result.get("note", "") + " [held]",
            }

        return result

    def update(self, frame_bytes: bytes | None) -> dict:
        frame = decode_jpeg(frame_bytes)

        if frame is None:
            return self._persist({
                "observed_direction": "unknown",
                "angle_delta_deg": 0.0,
                "confidence": 0.0,
                "note": "No camera frame available.",
            })

        roi = _parse_roi(self.roi, frame)

        led = _find_red_led(frame, roi)

        # Jump filter

        if (
            led is not None
            and self._last_marker_pos is not None
        ):
            dist = math.sqrt(
                (led[0] - self._last_marker_pos[0])**2
                + (led[1] - self._last_marker_pos[1])**2
            )

            if dist > 40:
                print(
                    f"[CV] LED jumped "
                    f"{dist:.1f}px rejected"
                )

                led = None

        # Stuck filter

        if led is not None and not self._marker_stuck:
            self._stuck_buf.append((led[0], led[1]))

            if len(self._stuck_buf) > 20:
                self._stuck_buf.pop(0)

            if len(self._stuck_buf) >= 20:
                xs = [p[0] for p in self._stuck_buf]
                ys = [p[1] for p in self._stuck_buf]

                spread = math.sqrt(
                    (max(xs) - min(xs))**2
                    + (max(ys) - min(ys))**2
                )

                if spread < 4.0:
                    self._marker_stuck = True
                    led = None

        if led is not None and self._marker_stuck:
            led = None

        # LED tracking path

        if led is not None:
            self.previous_frame = None

            mx, my, mconf = led

            self._last_marker_pos = (mx, my)

            x, y, w, h = roi

            center_x = x + w / 2
            center_y = y + h / 2

            current_angle = math.atan2(
                my - center_y,
                mx - center_x,
            )

            if self._prev_angle is None:
                self._prev_angle = current_angle

                return self._persist({
                    "observed_direction": "unknown",
                    "angle_delta_deg": 0.0,
                    "confidence": 0.0,
                    "note": "Initializing angle tracker",
                })

            raw_delta = _angle_delta_degrees(
                self._prev_angle,
                current_angle,
            )

            self._prev_angle = current_angle

            # Low-pass filter removes jitter sign flips

            self._filtered_delta = (
                self.angle_smoothing
                * self._filtered_delta
                + (1.0 - self.angle_smoothing)
                * raw_delta
            )

            delta_deg = self._filtered_delta

            print(
                f"[CV] raw_delta={raw_delta:.2f} "
                f"filtered_delta={delta_deg:.2f}"
            )

            if abs(delta_deg) < self.min_angle_delta_deg:
                return self._persist({
                    "observed_direction": "unknown",
                    "angle_delta_deg": round(delta_deg, 2),
                    "confidence": 0.0,
                    "note": "Motion below threshold",
                })

            direction = (
                "clockwise"
                if delta_deg > 0
                else "counterclockwise"
            )

            confidence = min(
                1.0,
                abs(delta_deg) / 15.0,
            ) * mconf

            return self._persist({
                "observed_direction": direction,
                "angle_delta_deg": round(delta_deg, 2),
                "confidence": round(confidence, 3),
                "note": "LED angular tracking",
            })

        # Reset angle tracker if LED lost

        self._prev_angle = None
        self._filtered_delta = 0.0

        # Blob fallback

        if self.previous_frame is None:
            self.previous_frame = frame_bytes

            return self._persist({
                "observed_direction": "unknown",
                "angle_delta_deg": 0.0,
                "confidence": 0.0,
                "note": "Collecting first frame.",
            })

        result = detect_rotation_blob(
            self.previous_frame,
            frame_bytes,
            roi,
        )

        self.previous_frame = frame_bytes

        return self._persist(result)


def detect_rotation_optical_flow(
    prev_jpeg,
    curr_jpeg,
    roi=None,
):
    return detect_rotation_blob(
        prev_jpeg,
        curr_jpeg,
        roi,
    )