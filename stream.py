from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from picamera2 import Picamera2
import cv2
import threading
import asyncio

picam2 = Picamera2()
shutdown_event = threading.Event()
latest_frame = None
frame_lock = threading.Lock()
frame_ready = threading.Event()

def capture_loop():
    global latest_frame
    while not shutdown_event.is_set():
        frame = picam2.capture_array()
        frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        with frame_lock:
            latest_frame = buffer.tobytes()
        frame_ready.set()

@asynccontextmanager
async def lifespan(app: FastAPI):
    picam2.configure(picam2.create_video_configuration(main={"size": (640, 480)}))
    picam2.start()
    t = threading.Thread(target=capture_loop, daemon=True)
    t.start()
    yield
    shutdown_event.set()
    frame_ready.set()  # unblock capture loop if it's waiting
    t.join(timeout=3)
    picam2.stop()
    picam2.close()

app = FastAPI(lifespan=lifespan)

HTML = """
<!DOCTYPE html>
<html>
<head><title>Camera Feed</title></head>
<body style="margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh">
  <img id="feed" style="max-width:100%"/>
  <script>
    const img = document.getElementById("feed");
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.binaryType = "blob";
    ws.onmessage = (e) => {
      const url = URL.createObjectURL(e.data);
      img.onload = () => URL.revokeObjectURL(url); // free memory
      img.src = url;
    };
    ws.onclose = () => console.log("Stream closed");
  </script>
</body>
</html>
"""

@app.get("/")
def home():
    return HTMLResponse(HTML)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_event_loop()
    try:
        while not shutdown_event.is_set():
            # wait for a new frame without blocking the event loop
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000, timeout_graceful_shutdown=2)