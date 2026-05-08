"""
backend/hardware/mock_camera.py

OpenCV webcam implementation of CameraInterface.
Used on Windows or when MOCK_HARDWARE=1 is set.
"""

import cv2

from backend.hardware.interface_camera import CameraInterface, ZOOM_MIN, ZOOM_MAX


class MockCamera(CameraInterface):
    def __init__(self):
        self.cap = cv2.VideoCapture(0)
        self._zoom_level: float = 1.0

    def start(self):
        pass  # VideoCapture opens on __init__

    def capture_array(self):
        ret, frame = self.cap.read()
        if not ret:
            raise RuntimeError("Failed to read from webcam")
        return frame

    def set_zoom(self, zoom: float) -> None:
        zoom = max(ZOOM_MIN, min(ZOOM_MAX, zoom))
        self._zoom_level = zoom

    def stop(self):
        self.cap.release()

    def close(self):
        pass