"""
backend/hardware/interface_camera.py

Abstract base class for the RGB camera.
Any concrete implementation must define all four methods or Python will
raise TypeError at instantiation time.
"""

from abc import ABC, abstractmethod

import numpy as np

# Camera zoom constants - available in both mock and real implementations
ZOOM_MIN = 1.0
ZOOM_MAX = 8.0

# PTZ constants - available without importing Raspberry Pi-only camera modules
PITCH_MIN = 0
PITCH_MAX = 90
YAW_MIN = 0
YAW_MAX = 180
PITCH_HOME = 45
YAW_HOME = 90


class CameraInterface(ABC):

    @abstractmethod
    def start(self) -> None:
        """Configure and start the camera."""

    @abstractmethod
    def capture_array(self) -> np.ndarray:
        """Capture and return a single frame as an HxWxC uint8 array."""

    @abstractmethod
    def stop(self) -> None:
        """Stop the camera stream."""

    @abstractmethod
    def close(self) -> None:
        """Release all hardware resources."""

    def set_zoom(self, zoom: float) -> None:
        pass
