# VIS-SSH-ON - Remote Monitoring for Embedded Systems

A web-based dashboard for remotely monitoring, testing, and flashing embedded hardware over a network connection. Streams a live RGB camera feed and AMG88xx thermal heatmap to the browser, runs configurable test suites, and lets you edit and flash firmware without leaving the UI.

---

## What's inside

| Layer | Tech |
| --- | --- |
| Backend | FastAPI + Uvicorn |
| Database | SQLite (`tests.db`) |
| Hardware | Picamera2 (RGB) + AMG88xx via I2C (thermal) |
| Mock hardware | OpenCV webcam + random thermal data |
| Firmware toolchain | PlatformIO |
| Frontend | Vanilla JS + CodeMirror 5 + WebSockets + page-based modules |

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
- **RGB camera** - streamed as JPEG over WebSocket (`/ws`) with PTZ (Pan-Tilt-Zoom) controls
- **Thermal heatmap** - 8x8 AMG88xx pixel grid overlaid on the viewport, updated about 10 times per second via `/ws/thermal`

### PTZ Camera Control
- **Digital zoom** - 1x to 8x zoom using Picamera2 `ScalerCrop` (real hardware) or simulated behavior (mock mode)
- **Pan/Tilt controls** - D-pad interface ready for servo integration
- **Multiple input methods** - on-screen D-pad and zoom buttons, mouse wheel zoom on the viewport, keyboard shortcuts (Arrow keys / WASD for pan, `+` / `-` for zoom, `H` for home), and touch support for mobile devices
- **Visual feedback** - zoom level badge displayed when zoomed in

### Flash firmware (`FLASH CODE`)
Triggers a PlatformIO build + upload and streams the full `pio run -t upload` output live in a modal. Shows `__OK__` or `__FAIL__` on completion.

> **Every `setup()` must begin with `delay(1500)` or longer** - skipping this causes undefined hardware behavior on upload.

### In-browser editor (`EDIT CODE`)
Browse, create, edit, and delete files under `embedded_software/` without leaving the browser. Supports syntax highlighting for C/C++, Python, and JavaScript via CodeMirror.

### Test runner
- Configure test parameters (thresholds, fail criteria) via the REST API
- Run tests from the UI - results stream live over `/ws/test`
- Pass/fail status and failure reason shown in the footer panel
- All runs persisted to SQLite for later review

---

## Frontend architecture

The frontend is now organized around **page modules plus shared infrastructure** rather than a single large application script.

Each Jinja partial in `frontend/templates/partials/` has a matching JavaScript module in `frontend/static/js/pages/`. That pairing gives each screen or modal a clear ownership boundary:

- `view_*.js` modules own the behavior for a specific application view
- `modal_*.js` modules own the lifecycle and interactions for a specific modal
- `script.js` is now a lightweight bootstrap/orchestration layer instead of the old monolithic application file

This modularization separates responsibilities that previously lived together in one place: UI rendering, event wiring, shared state, WebSocket lifecycle, API calls, and feature-specific behavior.

### Shared infrastructure

Reusable frontend systems live in `frontend/static/js/core/`:

- `api.js` centralizes HTTP request behavior for configs, runs, files, PTZ, CV scripts, and reports
- `events.js` provides a lightweight pub/sub bus so modules can communicate without tight coupling
- `state.js` owns shared singleton application state such as the selected config, run history, replay state, and current CV script
- `ui.js` contains shared DOM and rendering helpers used across multiple pages
- `ws.js` owns persistent WebSocket connection management and reconnect behavior

This keeps infrastructure concerns out of page modules while keeping page modules focused on the DOM and workflows for the partial they represent.

### Page module mapping

Each HTML partial now has a corresponding JavaScript page module:

- `frontend/templates/partials/modal_editor.html` -> `frontend/static/js/pages/modal_editor.js`
- `frontend/templates/partials/modal_flash.html` -> `frontend/static/js/pages/modal_flash.js`
- `frontend/templates/partials/modal_serial.html` -> `frontend/static/js/pages/modal_serial.js`
- `frontend/templates/partials/view_configs.html` -> `frontend/static/js/pages/view_configs.js`
- `frontend/templates/partials/view_monitor.html` -> `frontend/static/js/pages/view_monitor.js`
- `frontend/templates/partials/view_replay.html` -> `frontend/static/js/pages/view_replay.js`
- `frontend/templates/partials/view_reports.html` -> `frontend/static/js/pages/view_reports.js`
- `frontend/templates/partials/view_run.html` -> `frontend/static/js/pages/view_run.js`

### Application lifecycle and bootstrap flow

The frontend startup sequence is intentionally simple:

1. `index.html` loads `frontend/static/js/script.js` as the single module entry point.
2. `script.js` initializes navigation and each page/modal module.
3. Page modules register DOM handlers and event subscriptions first.
4. Shared WebSockets are started only after subscribers are in place.
5. Initial data loads populate configs, CV scripts, and persisted reports.

Starting sockets after subscriber registration avoids missing early messages during application boot and keeps transport lifecycle concerns centralized.

### Event-driven communication

The frontend uses a small event bus for shared real-time communication.

`core/ws.js` owns the long-lived camera, thermal, test, and keypoint sockets. Instead of having view modules open their own sockets, it emits named events through `core/events.js`, and page modules subscribe only to the data they care about.

That split improves maintainability:

- transport lifecycle stays in one place
- views do not need direct references to socket objects
- new views can subscribe to shared data without rewriting connection logic
- feature modules stay easier to test and reason about independently

### Shared state ownership

Cross-view workflow state now lives in `core/state.js` rather than being scattered across browser globals. This includes:

- selected config and selected run
- cached config and report collections
- active run state
- CV script selection and editor state
- replay playback state and frame cache

This structure makes it safer to add views, extend workflows, and debug interactions between Monitor, Run, Reports, and Replay without reintroducing a monolithic frontend file.

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

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Web UI |
| `WS` | `/ws` | JPEG camera stream |
| `WS` | `/ws/thermal` | Thermal pixel data (JSON) |
| `WS` | `/ws/test` | Live test event stream |
| `POST` | `/api/ptz` | Camera PTZ control |
| `POST` | `/api/flash` | Build + upload (SSE) |
| `GET/POST` | `/api/files/{path}` | Read / write files |
| `GET` | `/api/files` | List all files |
| `DELETE` | `/api/files/{path}` | Delete a file |
| `POST` | `/api/configs` | Create test config |
| `GET` | `/api/configs` | List test configs |
| `PUT/DELETE` | `/api/configs/{id}` | Update / delete config |
| `POST` | `/api/tests/{config_id}` | Run a test |
| `GET` | `/api/tests` | List all test runs |
| `DELETE` | `/api/tests/{run_id}` | Delete a test run |

---

## Project structure

```text
.
|-- main.py                          # FastAPI app entry point
|-- embedded_software/               # PlatformIO project (firmware)
|   `-- src/main.cpp
|-- frontend/
|   |-- static/
|   |   |-- css/
|   |   |   `-- style.css
|   |   `-- js/
|   |       |-- script.js            # Bootstrap / orchestration layer
|   |       |-- core/                # Shared frontend infrastructure
|   |       |   |-- api.js           # HTTP service layer
|   |       |   |-- events.js        # Pub/sub event bus
|   |       |   |-- state.js         # Shared frontend state
|   |       |   |-- ui.js            # Shared DOM / rendering helpers
|   |       |   `-- ws.js            # WebSocket manager + reconnect logic
|   |       `-- pages/               # One module per HTML partial
|   |           |-- modal_editor.js
|   |           |-- modal_flash.js
|   |           |-- modal_serial.js
|   |           |-- view_configs.js
|   |           |-- view_monitor.js
|   |           |-- view_replay.js
|   |           |-- view_reports.js
|   |           `-- view_run.js
|   `-- templates/
|       |-- index.html               # App shell and single JS entry point
|       `-- partials/
|           |-- modal_editor.html
|           |-- modal_flash.html
|           |-- modal_serial.html
|           |-- view_configs.html
|           |-- view_monitor.html
|           |-- view_replay.html
|           |-- view_reports.html
|           `-- view_run.html
`-- backend/
    |-- lifespan.py                  # Startup/shutdown, shared hardware state
    |-- schemas.py                   # Pydantic models
    |-- api/
    |   |-- routes_camera.py         # PTZ camera control API
    |   |-- routes_configs.py        # Test config CRUD
    |   |-- routes_cv_tests.py       # CV script CRUD
    |   |-- routes_files.py          # File browser API
    |   |-- routes_flash.py          # PIO flash route
    |   `-- routes_tests.py          # Test run CRUD + execution
    |-- database/
    |   |-- database.py              # SQLite access layer
    |   `-- tests.db                 # Created automatically on first run
    |-- hardware/
    |   |-- provider.py              # Selects real vs mock hardware
    |   |-- interface_camera.py      # Abstract camera interface with zoom support
    |   |-- camera.py                # Picamera2 implementation with zoom
    |   |-- camera_thermal.py        # AMG88xx implementation
    |   |-- mock_camera.py           # OpenCV webcam fallback
    |   `-- mock_camera_thermal.py   # Random data fallback
    |-- services/
    |   |-- cv_services.py           # CV script helpers / execution support
    |   |-- flash_service.py         # PIO subprocess + SSE generator
    |   `-- test_runner.py           # Test execution logic
    `-- websockets/
        |-- ws_camera.py             # JPEG frame broadcaster
        |-- ws_keypoint.py           # Vision keypoint broadcaster
        |-- ws_serial.py             # Serial monitor websocket
        |-- ws_thermal.py            # Thermal data broadcaster
        `-- ws_test.py               # Test event broadcaster
```

### Frontend design notes

- The old frontend layout centered on large standalone files such as `script.js`, `editor.js`, `flash.js`, `ptz.js`, and `serial.js`.
- The current layout keeps those behaviors, but redistributes them into partial-matched page modules plus reusable infrastructure layers.
- The result is cleaner ownership boundaries, easier feature isolation, and safer long-term development when adding views or expanding real-time workflows.

---

## Database schema

```text
test_configs    - name, description, type ('thermal' | 'custom'), created_at
test_parameters - key/value pairs attached to a config
test_runs       - status ('running' | 'pass' | 'fail' | 'killed'), timing, failure_reason
test_results    - per-run metric snapshots (metric, value, timestamp)
```
