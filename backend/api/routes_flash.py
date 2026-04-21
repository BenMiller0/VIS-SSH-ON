"""
backend/api/routes_flash.py

  POST /api/flash — trigger a PlatformIO build+upload and stream output as SSE.

The actual subprocess logic lives in services/flash_service.py so this
route stays thin.
"""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from backend.services.flash_service import stream_upload

router = APIRouter(prefix="/api/flash", tags=["flash"])

EMBEDDED_SOFTWARE_DIR = "embedded_software"


@router.post("")
async def flash_firmware():
    """
    Stream `pio run -t upload` output line-by-line as Server-Sent Events.
    Terminal events: __OK__ or __FAIL__
    """
    import os
    cwd = os.path.abspath(EMBEDDED_SOFTWARE_DIR)

    return StreamingResponse(
        stream_upload(cwd),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
        },
    )