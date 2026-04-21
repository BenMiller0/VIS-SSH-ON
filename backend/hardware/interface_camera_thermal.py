"""
backend/hardware/interface_camera_thermal.py

Abstract base class for the AMG88xx thermal sensor.
Any concrete implementation must define both properties or Python will
raise TypeError at instantiation time.
"""

from abc import ABC, abstractmethod


class ThermalInterface(ABC):

    @property
    @abstractmethod
    def pixels(self) -> list[list[float]]:
        """Return the 8x8 grid of pixel temperatures in Celsius."""

    @property
    @abstractmethod
    def temperature(self) -> float:
        """Return the onboard thermistor temperature in Celsius."""