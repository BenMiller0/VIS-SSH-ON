"""
backend/hardware/camera.py

Picamera2 implementation of CameraInterface.
Only imported on Linux (non-mock) via provider.py.
"""

from picamera2 import Picamera2

from backend.hardware.interface_camera import CameraInterface


class Camera(CameraInterface):
    def __init__(self):
        self.cam = Picamera2()

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