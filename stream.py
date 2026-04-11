from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from picamera2 import Picamera2
import cv2

app = FastAPI()

picam2 = Picamera2()
picam2.configure(picam2.create_video_configuration(main={"size": (640, 480)}))
picam2.start()

def generate():
    while True:
        frame = picam2.capture_array()
        frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

        _, buffer = cv2.imencode(".jpg", frame)

        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" +
               buffer.tobytes() + b"\r\n")

@app.get("/")
def home():
    return {"status": "camera streaming"}

@app.get("/video")
def video():
    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
