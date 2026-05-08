"""
backend/hardware/camera.py

Picamera2 implementation of CameraInterface.
Only imported on Linux (non-mock) via provider.py.
"""

from picamera2 import Picamera2

from backend.hardware.interface_camera import CameraInterface

ZOOM_MIN = 1.0
ZOOM_MAX = 8.0


class Camera(CameraInterface):
    def __init__(self):
        self.cam = Picamera2()
        self._zoom_level: float = 1.0

    def start(self):
        self.cam.configure(
            self.cam.create_video_configuration(main={"size": (640, 480)})
        )
        self.cam.start()

    def capture_array(self):
        return self.cam.capture_array()

    def set_zoom(self, zoom: float) -> None:
        """
        Crop the centre of the full IMX500 sensor array and let the ISP
        scale it up to the configured output resolution.

        ScalerCrop takes (x, y, width, height) in full-sensor pixel coordinates.
        At 1× the entire sensor is used; at 8× only the central 1/64th is
        sampled — still ~190k pixels feeding a 640×480 stream.
        """
        zoom = max(ZOOM_MIN, min(ZOOM_MAX, zoom))

        full_w, full_h = self.cam.camera_properties["PixelArraySize"]
        crop_w = int(full_w / zoom)
        crop_h = int(full_h / zoom)
        x = (full_w - crop_w) // 2
        y = (full_h - crop_h) // 2

        self.cam.set_controls({"ScalerCrop": (x, y, crop_w, crop_h)})
        self._zoom_level = zoom

    def stop(self):
        self.cam.stop()

    def close(self):
        self.cam.close()