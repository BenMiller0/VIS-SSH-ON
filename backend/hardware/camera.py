"""
backend/hardware/camera.py
"""

import time
from pathlib import Path

from picamera2 import Picamera2

from backend.hardware.interface_camera import CameraInterface

ZOOM_MIN  = 1.0
ZOOM_MAX  = 8.0
PITCH_MIN = 0
PITCH_MAX = 90
YAW_MIN   = 0
YAW_MAX   = 180
SETTLE_S  = 0.3

PITCH_HOME = 45   # tune this to your physical "straight ahead"
YAW_HOME   = 90   # center of pan range

PWM_CHIP    = 0
PWM_CH_TILT = 0   # GPIO 12
PWM_CH_PAN  = 1   # GPIO 13
PWM_PERIOD  = 20_000_000

PW_MIN = 500_000
PW_MAX = 2_400_000


class HardwarePWM:
    def __init__(self, chip: int, channel: int):
        self._base = Path(f"/sys/class/pwm/pwmchip{chip}/pwm{channel}")
        export     = Path(f"/sys/class/pwm/pwmchip{chip}/export")

        if not self._base.exists():
            export.write_text(str(channel))
            time.sleep(0.1)

        self._write("period",     PWM_PERIOD)
        self._write("duty_cycle", 0)
        self._write("enable",     1)

    def _write(self, attr: str, value: int):
        (self._base / attr).write_text(str(value))

    def set_pulse_ns(self, ns: int):
        self._write("enable",     1)
        self._write("duty_cycle", ns)

    def stop(self):
        self._write("duty_cycle", 0)
        self._write("enable",     0)


def _angle_to_ns(angle: int, min_angle: int, max_angle: int) -> int:
    return int(PW_MIN + (angle - min_angle) / (max_angle - min_angle) * (PW_MAX - PW_MIN))


class Camera(CameraInterface):
    def __init__(self):
        self.cam             = Picamera2()
        self._zoom_level:    float = 1.0
        self._current_pitch: int   = PITCH_HOME
        self._current_yaw:   int   = YAW_HOME

        self._tilt_pwm = HardwarePWM(PWM_CHIP, PWM_CH_TILT)
        self._pan_pwm  = HardwarePWM(PWM_CHIP, PWM_CH_PAN)

        self.set_pitch(PITCH_HOME)
        self.set_yaw(YAW_HOME)

    def start(self):
        self.cam.configure(
            self.cam.create_video_configuration(main={"size": (640, 480)})
        )
        self.cam.start()

    def capture_array(self):
        return self.cam.capture_array()

    def stop(self):
        self.cam.stop()

    def close(self):
        self.cam.close()
        self._tilt_pwm.stop()
        self._pan_pwm.stop()

    def set_zoom(self, zoom: float) -> None:
        zoom = max(ZOOM_MIN, min(ZOOM_MAX, zoom))
        full_w, full_h = self.cam.camera_properties["PixelArraySize"]
        crop_w = int(full_w / zoom)
        crop_h = int(full_h / zoom)
        x = (full_w - crop_w) // 2
        y = (full_h - crop_h) // 2
        self.cam.set_controls({"ScalerCrop": (x, y, crop_w, crop_h)})
        self._zoom_level = zoom

    def set_pitch(self, pitch: int) -> None:
        pitch = max(PITCH_MIN, min(PITCH_MAX, pitch))
        self._tilt_pwm.set_pulse_ns(_angle_to_ns(pitch, PITCH_MIN, PITCH_MAX))
        time.sleep(SETTLE_S)
        self._tilt_pwm.stop()
        self._current_pitch = pitch

    def set_yaw(self, yaw: int) -> None:
        yaw = max(YAW_MIN, min(YAW_MAX, yaw))
        self._pan_pwm.set_pulse_ns(_angle_to_ns(yaw, YAW_MIN, YAW_MAX))
        time.sleep(SETTLE_S)
        self._pan_pwm.stop()
        self._current_yaw = yaw