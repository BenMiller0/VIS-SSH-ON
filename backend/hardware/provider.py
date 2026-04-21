"""
backend/hardware/provider.py

Selects real or mock hardware based on platform / environment.
Set MOCK_HARDWARE=1 in your environment to force mock mode on any platform.

Exports IS_PI so other modules (e.g. lifespan.py) can branch on it
without duplicating the detection logic.
"""

import os
import platform

IS_PI: bool = platform.system() == "Linux" and os.environ.get("MOCK_HARDWARE", "0") != "1"

if not IS_PI:
    from backend.hardware.mock_camera import MockCamera as Camera
    from backend.hardware.mock_camera_thermal import MockThermal as Thermal
else:
    from backend.hardware.camera import Camera
    from backend.hardware.camera_thermal import Thermal