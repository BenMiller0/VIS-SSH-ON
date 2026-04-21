"""
backend/hardware/mock_camera.py

OpenCV webcam implementation of CameraInterface.
Used on Windows or when MOCK_HARDWARE=1 is set.
"""

import cv2

from backend.hardware.interface_camera import CameraInterface


class MockCamera(CameraInterface):
    def __init__(self):
        self.cap = cv2.VideoCapture(0)

    def start(self):
        pass  # VideoCapture opens on __init__

    def capture_array(self):
        ret, frame = self.cap.read()
        if not ret:
            raise RuntimeError("Failed to read from webcam")
        return frame

    def stop(self):
        self.cap.release()

    def close(self):
        pass