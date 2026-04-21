"""
backend/lifespan.py

Owns application startup and shutdown.
All shared hardware state (frames, thermal data) lives here as module-level
objects so WebSocket handlers can import them directly.
"""

import asyncio
import json
import threading
import time
from contextlib import asynccontextmanager

import cv2
from fastapi import FastAPI

from backend.hardware.provider import Camera, Thermal, IS_PI

# ── Hardware instances ────────────────────────────────────────────────────────
camera  = Camera()
thermal = Thermal()

# ── Shared camera state ───────────────────────────────────────────────────────
latest_frame: bytes | None = None
frame_lock   = threading.Lock()
frame_ready  = threading.Event()

# ── Shared thermal state ──────────────────────────────────────────────────────
latest_thermal: bytes | None = None
thermal_lock   = threading.Lock()
thermal_ready  = threading.Event()

# ── Shutdown signal ───────────────────────────────────────────────────────────
shutdown_event = threading.Event()

# ── asyncio event loop reference (set at startup) ────────────────────────────
# Used by ws_test.py to safely send from background threads.
main_loop: asyncio.AbstractEventLoop | None = None


# ── Background threads ────────────────────────────────────────────────────────

def _capture_loop() -> None:
    global latest_frame
    try:
        while not shutdown_event.is_set():
            frame = camera.capture_array()
            # Picamera2 outputs RGB — convert to BGR for cv2.imencode.
            # MockCamera (OpenCV) already outputs BGR — skip conversion.
            if IS_PI:
                frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            with frame_lock:
                latest_frame = buf.tobytes()
            frame_ready.set()
    except Exception as exc:
        print(f"[capture_loop] {exc}")


def _thermal_loop() -> None:
    global latest_thermal
    while not shutdown_event.is_set():
        payload = json.dumps({
            "pixels":     thermal.pixels,
            "thermistor": round(thermal.temperature, 2),
        }).encode()
        with thermal_lock:
            latest_thermal = payload
        thermal_ready.set()
        time.sleep(0.1)


# ── Lifespan context manager ──────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global main_loop
    main_loop = asyncio.get_running_loop()

    camera.start()

    t1 = threading.Thread(target=_capture_loop, daemon=True)
    t2 = threading.Thread(target=_thermal_loop, daemon=True)
    t1.start()
    t2.start()

    print("\n  vis-ssh-on started — http://0.0.0.0:8000\n")

    try:
        yield
    finally:
        shutdown_event.set()
        # Unblock any threads waiting on events so they can exit cleanly
        frame_ready.set()
        thermal_ready.set()
        t1.join(timeout=3)
        t2.join(timeout=3)
        try:
            camera.stop()
            camera.close()
        except Exception:
            pass