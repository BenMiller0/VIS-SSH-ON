"""
backend/hardware/provider.py

Selects real or mock hardware based on platform / environment.
Set MOCK_HARDWARE=1 in your environment to force mock mode on any platform.
"""

import os
import platform

_force_mock = os.environ.get("MOCK_HARDWARE", "0") == "1"
_is_pi      = platform.system() == "Linux" and not _force_mock

if not _is_pi:
    from backend.hardware.mock_camera import MockCamera as Camera
    from backend.hardware.mock_camera_thermal import MockThermal as Thermal
else:
    from backend.hardware.camera import Camera
    from backend.hardware.camera_thermal import Thermal