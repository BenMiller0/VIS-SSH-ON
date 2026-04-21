"""
backend/hardware/camera_thermal.py

AMG88xx implementation of ThermalInterface.
Only imported on Linux (non-mock) via provider.py.
"""

import time

import adafruit_amg88xx
import board
import busio

from backend.hardware.interface_camera_thermal import ThermalInterface


class Thermal(ThermalInterface):
    def __init__(self):
        i2c = busio.I2C(board.SCL, board.SDA)
        self.sensor = adafruit_amg88xx.AMG88XX(i2c)
        time.sleep(0.1)

    @property
    def pixels(self) -> list[list[float]]:
        return self.sensor.pixels

    @property
    def temperature(self) -> float:
        return self.sensor.temperature