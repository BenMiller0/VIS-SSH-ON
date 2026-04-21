"""
backend/hardware/mock_camera_thermal.py

Random-data implementation of ThermalInterface.
Used on Windows or when MOCK_HARDWARE=1 is set.
"""

import random

from backend.hardware.interface_camera_thermal import ThermalInterface


class MockThermal(ThermalInterface):
    @property
    def pixels(self) -> list[list[float]]:
        return [
            [round(random.uniform(20, 80), 2) for _ in range(8)]
            for _ in range(8)
        ]

    @property
    def temperature(self) -> float:
        return round(random.uniform(20, 80), 2)