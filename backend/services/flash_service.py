"""
backend/services/flash_service.py

Encapsulates the PlatformIO subprocess and SSE generation.
routes_flash.py calls stream_upload() and streams the result directly.
Keeping this in a service makes it independently testable and mockable.
"""

import asyncio
from collections.abc import AsyncGenerator


async def stream_upload(cwd: str) -> AsyncGenerator[str, None]:
    """
    Run `pio run -t upload` in *cwd* and yield SSE-formatted lines.
    Yields:
        "data: <line>\\n\\n"  for each stdout line
        "data: __OK__\\n\\n"  on success
        "data: __FAIL__\\n\\n" on failure
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "pio", "run", "-t", "upload",
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for raw in proc.stdout:
            line = raw.decode(errors="replace").rstrip()
            safe = line.replace("\n", " ").replace("\r", "")
            yield f"data: {safe}\n\n"

        await proc.wait()
        sentinel = "__OK__" if proc.returncode == 0 else "__FAIL__"
        yield f"data: {sentinel}\n\n"

    except FileNotFoundError:
        yield "data: ERROR: 'pio' not found — is PlatformIO installed and on PATH?\n\n"
        yield "data: __FAIL__\n\n"
    except Exception as exc:
        yield f"data: ERROR: {exc}\n\n"
        yield "data: __FAIL__\n\n"