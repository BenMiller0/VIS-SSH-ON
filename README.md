# VIS-SSH-ON: Remote Monitoring for Embedded Systems

[View Project Page Here](https://benmiller0.github.io/VIS-SSH-ON/)

A platform for remotely monitoring, testing, and flashing embedded hardware over a network connection. Streams a live RGB camera feed and AMG88xx thermal heatmap to the browser, runs configurable test suites, and lets you edit and flash firmware without leaving the UI.

---

## What's inside

| Layer              | Tech                                        |
| ------------------ | ------------------------------------------- |
| Backend            | FastAPI + Uvicorn                           |
| Database           | SQLite (`tests.db`)                         |
| Hardware           | Picamera2 (RGB) · AMG88xx via I²C (thermal) |
| Mock hardware      | OpenCV webcam · random thermal data         |
| Frontend           | Vanilla JS · CodeMirror 5 · WebSockets      |

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
Triggers a build + upload and streams the full output live in a modal. Shows `__OK__` or `__FAIL__` on completion.

> **Every `setup()` must begin with `delay(1500)` or longer** — skipping this causes undefined hardware behaviour on upload.

### In-browser editor (`✎ EDIT CODE`)
Browse, create, edit, and delete files under `embedded_software/` without leaving the browser. Supports syntax highlighting for C/C++, Python, and JavaScript via CodeMirror.

### Test runner
- Configure test parameters (thresholds, fail criteria) via the REST API
- Run tests from the UI — results stream live over `/ws/test`
- Pass/fail status and failure reason shown in the footer panel
- All runs persisted to SQLite for later review

### Writable CV tests
Editable camera tests live in `backend/cv_tests/`. Each script can import the
small VIS-SSH-ON test API and declare keypoints directly:

```python
import vis_ssh_on as vis

green = vis.keypoint("green").should_be_visible(min_area=20)
green.should_rotate("clockwise")

vis.pass_test(x=green.x, y=green.y, area=green.area)
```

The current detector provides built-in `red` and `green` keypoints. The same API
also supports named keypoints from payloads shaped like
`{"keypoints": {"tip": ...}}`, so tests can compare points naturally:

```python
scene = vis.scene()
tip = scene.keypoint("tip").should_be_visible()
base = scene.keypoint("base").should_be_visible()

tip.should_be_above(base, by_at_least=10)
tip.should_be_near(base, within=80)
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
| `GET`        | `/api/cv-tests`          | List CV test scripts      |
| `POST`       | `/api/cv-tests/{name}`   | Run a CV test             |

---

## Project structure

```
.
├── main.py                        # FastAPI app entry point
├── embedded_software/             # Firmware project
│   └── src/main.cpp
├── docs/                          # GitHub Pages site
│   ├── index.html
│   ├── style.css
│   └── favicon.svg
├── frontend/
│   ├── routes_pages.py            # (unused)
│   ├── static/
│   │   ├── js/
│   │   │   ├── script.js          # WS connections, camera/thermal/test rendering
│   │   │   ├── editor.js          # In-browser file editor
│   │   │   ├── flash.js           # Flash modal + SSE handling
│   │   │   ├── ptz.js             # PTZ camera control UI and interactions
│   │   │   └── serial.js          # Serial monitor UI
│   │   ├── css/
│   │   │   └── style.css
│   │   └── favicon/
│   └── templates/
│       ├── index.html
│       └── partials/
│           ├── modal_editor.html
│           ├── modal_flash.html
│           ├── modal_serial.html
│           ├── view_configs.html
│           ├── view_monitor.html
│           ├── view_replay.html
│           ├── view_reports.html
│           └── view_run.html
└── backend/
    ├── lifespan.py                # Startup/shutdown, shared camera state
    ├── schemas.py                 # Pydantic models
    ├── api/
    │   ├── routes_camera.py       # PTZ camera control API
    │   ├── routes_configs.py      # Test config CRUD
    │   ├── routes_cv_tests.py     # CV test execution API
    │   ├── routes_files.py        # File browser API
    │   ├── routes_flash.py        # PIO flash route
    │   └── routes_tests.py        # Test run CRUD + execution
    ├── cv_tests/
    │   ├── _helpers.py            # CV test helper utilities
    │   ├── vis_ssh_on.py          # CV test API
    │   ├── red_keypoint_test.py
    │   ├── rotation_test.py
    │   └── three_red_keypoints_test.py
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
