from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from backend.lifespan import lifespan
from backend.api.routes_tests import router as tests_router
from backend.api.routes_configs import router as configs_router
from backend.api.routes_files import router as files_router
from backend.api.routes_flash import router as flash_router
from backend.websockets.ws_camera import router as ws_camera_router
from backend.websockets.ws_thermal import router as ws_thermal_router
from backend.websockets.ws_test import router as ws_test_router

app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory="frontend/static"), name="static")
templates = Jinja2Templates(directory="frontend/templates")

# Store templates on app state so routes can access them via request.app.state
app.state.templates = templates

app.include_router(tests_router)
app.include_router(configs_router)
app.include_router(files_router)
app.include_router(flash_router)
app.include_router(ws_camera_router)
app.include_router(ws_thermal_router)
app.include_router(ws_test_router)

# Page route lives here since it needs templates
from fastapi import Request

@app.get("/")
def home(request: Request):
    return templates.TemplateResponse(request, "index.html", {"request": request})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)