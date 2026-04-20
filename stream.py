from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from picamera2 import Picamera2
import board
import busio
import adafruit_amg88xx
import cv2
import threading
import asyncio
import time
import json
import signal
import sys
import os

picam2 = Picamera2()
shutdown_event = threading.Event()

latest_frame = None
frame_lock = threading.Lock()
frame_ready = threading.Event()

latest_thermal = None
thermal_lock = threading.Lock()
thermal_ready = threading.Event()

def cleanup(signum=None, frame=None):
    shutdown_event.set()
    frame_ready.set()
    thermal_ready.set()
    try:
        picam2.stop()
        picam2.close()
    except Exception:
        pass
    sys.exit(0)

signal.signal(signal.SIGTERM, cleanup)
signal.signal(signal.SIGINT, cleanup)

def capture_loop():
    global latest_frame
    try:
        while not shutdown_event.is_set():
            frame = picam2.capture_array()
            frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            with frame_lock:
                latest_frame = buffer.tobytes()
            frame_ready.set()
    except Exception as e:
        print(f"[capture_loop ERROR] {e}")

def thermal_loop():
    global latest_thermal
    i2c = busio.I2C(board.SCL, board.SDA)
    amg = adafruit_amg88xx.AMG88XX(i2c)
    time.sleep(0.1)
    while not shutdown_event.is_set():
        data = json.dumps({
            "pixels": amg.pixels,
            "thermistor": round(amg.temperature, 2)
        }).encode()
        with thermal_lock:
            latest_thermal = data
        thermal_ready.set()
        time.sleep(0.1)

@asynccontextmanager
async def lifespan(app: FastAPI):
    t1 = threading.Thread(target=capture_loop, daemon=True)
    t2 = threading.Thread(target=thermal_loop, daemon=True)
    try:
        picam2.configure(picam2.create_video_configuration(main={"size": (640, 480)}))
        picam2.start()
        t1.start()
        t2.start()
        yield
    finally:
        shutdown_event.set()
        frame_ready.set()
        thermal_ready.set()
        t1.join(timeout=3)
        t2.join(timeout=3)
        try:
            picam2.stop()
            picam2.close()
        except Exception:
            pass

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="templates/static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/")
def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_event_loop()
    try:
        while not shutdown_event.is_set():
            await loop.run_in_executor(None, frame_ready.wait)
            frame_ready.clear()
            if shutdown_event.is_set():
                break
            with frame_lock:
                frame = latest_frame
            if frame:
                await websocket.send_bytes(frame)
    except WebSocketDisconnect:
        pass

@app.websocket("/ws/thermal")
async def thermal_websocket(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_event_loop()
    try:
        while not shutdown_event.is_set():
            await loop.run_in_executor(None, thermal_ready.wait)
            thermal_ready.clear()
            if shutdown_event.is_set():
                break
            with thermal_lock:
                data = latest_thermal
            if data:
                await websocket.send_bytes(data)
    except WebSocketDisconnect:
        pass

class FileContent(BaseModel):
    content: str

EMBEDDED_SOFTWARE_DIR = "embedded_software"

@app.get("/api/files")
def list_files():
    files = []
    for root, dirs, filenames in os.walk(EMBEDDED_SOFTWARE_DIR):
        for filename in filenames:
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, EMBEDDED_SOFTWARE_DIR)
            files.append(rel_path)
    return {"files": files}

@app.get("/api/files/{file_path:path}")
def read_file(file_path: str):
    safe_path = os.path.join(EMBEDDED_SOFTWARE_DIR, file_path)
    if not os.path.exists(safe_path):
        return JSONResponse(status_code=404, content={"error": "File not found"})
    try:
        with open(safe_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return {"path": file_path, "content": content}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/files/{file_path:path}")
def write_file(file_path: str, file_content: FileContent):
    safe_path = os.path.join(EMBEDDED_SOFTWARE_DIR, file_path)
    try:
        os.makedirs(os.path.dirname(safe_path), exist_ok=True)
        with open(safe_path, 'w', encoding='utf-8') as f:
            f.write(file_content.content)
        return {"success": True, "path": file_path}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    import uvicorn
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    if args.debug:
        uvicorn.run(app, host="0.0.0.0", port=5000, timeout_graceful_shutdown=2)
    else:
        print("\n  vis-ssh-on started!")
        print("  View feed at: http://100.125.67.124:5000/\n")
        uvicorn.run(app, host="0.0.0.0", port=5000, timeout_graceful_shutdown=2, log_level="critical")