# VIS-SSH-ON — Remote Monitoring for Embedded Systems

A web-based dashboard for remotely monitoring, testing, and flashing embedded hardware over a network connection. Streams a live RGB camera feed and AMG88xx thermal heatmap to the browser, runs configurable test suites, and lets you edit and flash firmware without leaving the UI.

---

## What's inside

| Layer              | Tech                                        |
| ------------------ | ------------------------------------------- |
| Backend            | FastAPI + Uvicorn                           |
| Database           | SQLite (`tests.db`)                         |
| Hardware           | Picamera2 (RGB) · AMG88xx via I²C (thermal) |
| Mock hardware      | OpenCV webcam · random thermal data         |
| Firmware toolchain | PlatformIO                                  |
| Frontend           | Vanilla JS · CodeMirror 5 · WebSockets      |

---

## Running the app

```bash
# Standard
python main.py

# Or via uvicorn directly
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000** in any browser on your network.

### Mock / development mode (no Raspberry Pi required)

The RGB camera falls back to your system webcam (OpenCV) and thermal data is randomly generated.

---

## UI features

### Live feeds
- **RGB camera** — streamed as JPEG over WebSocket (`/ws`) with PTZ (Pan-Tilt-Zoom) controls
- **Thermal heatmap** — 8×8 AMG88xx pixel grid overlaid on the viewport, updated ~10 Hz via `/ws/thermal`

### PTZ Camera Control
- **Digital zoom** — 1× to 8× zoom using Picamera2 ScalerCrop (real hardware) or simulated (mock mode)
- **Pan/Tilt controls** — D-pad interface ready for servo integration (currently placeholder)
- **Multiple input methods**:
  - On-screen D-pad and zoom buttons
  - Mouse wheel zoom on viewport
  - Keyboard shortcuts (Arrow keys/WASD for pan, +/- for zoom, H for home)
  - Touch support for mobile devices
- **Visual feedback** — Zoom level badge displayed when zoomed in

### Flash firmware (`⬡ FLASH CODE`)
Triggers a PlatformIO build + upload and streams the full `pio run -t upload` output live in a modal. Shows `__OK__` or `__FAIL__` on completion.

> **Every `setup()` must begin with `delay(1500)` or longer** — skipping this causes undefined hardware behaviour on upload.

### In-browser editor (`✎ EDIT CODE`)
Browse, create, edit, and delete files under `embedded_software/` without leaving the browser. Supports syntax highlighting for C/C++, Python, and JavaScript via CodeMirror.

### Test runner
- Configure test parameters (thresholds, fail criteria) via the REST API
- Run tests from the UI — results stream live over `/ws/test`
- Pass/fail status and failure reason shown in the footer panel
- All runs persisted to SQLite for later review

---

## Uploading firmware manually (SSH)

```bash
cd embedded_software
# edit src/main.cpp or any other files in src/
pio run -t upload

# optional: open serial monitor after flashing
pio device monitor -b 115200
```

---

## API overview

| Method       | Path                     | Description               |
| ------------ | ------------------------ | ------------------------- |
| `GET`        | `/`                      | Web UI                    |
| `WS`         | `/ws`                    | JPEG camera stream        |
| `WS`         | `/ws/thermal`            | Thermal pixel data (JSON) |
| `WS`         | `/ws/test`               | Live test event stream    |
| `POST`       | `/api/ptz`               | Camera PTZ control         |
| `POST`       | `/api/flash`             | Build + upload (SSE)      |
| `GET/POST`   | `/api/files/{path}`      | Read / write files        |
| `GET`        | `/api/files`             | List all files            |
| `DELETE`     | `/api/files/{path}`      | Delete a file             |
| `POST`       | `/api/configs`           | Create test config        |
| `GET`        | `/api/configs`           | List test configs         |
| `PUT/DELETE` | `/api/configs/{id}`      | Update / delete config    |
| `POST`       | `/api/tests/{config_id}` | Run a test                |
| `GET`        | `/api/tests`             | List all test runs        |
| `DELETE`     | `/api/tests/{run_id}`    | Delete a test run         |

---

## Project structure

```
.
├── main.py                        # FastAPI app entry point
├── embedded_software/             # PlatformIO project (firmware)
│   └── src/main.cpp
├── frontend/
│   ├── static/
│   │   ├── script.js              # WS connections, camera/thermal/test rendering
│   │   ├── editor.js              # In-browser file editor
│   │   ├── flash.js               # Flash modal + SSE handling
│   │   ├── ptz.js                 # PTZ camera control UI and interactions
│   │   └── style.css
│   └── templates/
│       └── index.html
└── backend/
    ├── lifespan.py                # Startup/shutdown, shared camera state
    ├── schemas.py                 # Pydantic models
    ├── api/
    │   ├── routes_camera.py       # PTZ camera control API
    │   ├── routes_configs.py      # Test config CRUD
    │   ├── routes_files.py        # File browser API
    │   ├── routes_flash.py        # PIO flash route
    │   └── routes_tests.py        # Test run CRUD + execution
    ├── database/
    │   ├── database.py            # SQLite access layer
    │   └── tests.db               # Created automatically on first run
    ├── hardware/
    │   ├── provider.py            # Selects real vs mock hardware
    │   ├── interface_camera.py    # Abstract camera interface with zoom support
    │   ├── camera.py              # Picamera2 implementation with zoom
    │   ├── camera_thermal.py      # AMG88xx implementation
    │   ├── mock_camera.py         # OpenCV webcam fallback
    │   └── mock_camera_thermal.py # Random data fallback
    ├── services/
    │   ├── flash_service.py       # PIO subprocess + SSE generator
    │   └── test_runner.py         # Test execution logic
    └── websockets/
        ├── ws_camera.py           # JPEG frame broadcaster
        ├── ws_thermal.py          # Thermal data broadcaster
        └── ws_test.py             # Test event broadcaster
```

---

## Database schema

```
test_configs   — name, description, type ('thermal' | 'custom'), created_at
test_parameters — key/value pairs attached to a config
test_runs      — status ('running' | 'pass' | 'fail' | 'killed'), timing, failure_reason
test_results   — per-run metric snapshots (metric, value, timestamp)
```
