"""
backend/hardware/interface_camera.py

Abstract base class for the RGB camera.
Any concrete implementation must define all four methods or Python will
raise TypeError at instantiation time.
"""

from abc import ABC, abstractmethod

import numpy as np


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