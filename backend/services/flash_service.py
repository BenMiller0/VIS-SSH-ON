"""
backend/services/flash_service.py
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


async def _get_pio_port() -> str | None:
    """Ask PlatformIO which serial port the device is on."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "pio", "device", "list",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        for line in out.decode(errors="replace").splitlines():
            # pio device list prints the port as the first token on each device line
            stripped = line.strip()
            if stripped.startswith("/dev/tty") or stripped.startswith("COM"):
                return stripped.split()[0]
    except Exception:
        pass
    return None


async def stream_reset(cwd: str) -> AsyncGenerator[str, None]:
    """
    Reset the connected ESP32 by toggling DTR/RTS on the serial port —
    the same method esptool / PlatformIO use internally.

    Auto-detects the port via `pio device list` so it uses whatever
    port the flash command would use.
    """
    try:
        import serial  # pyserial

        yield "data: Detecting device port...\n\n"
        port = await _get_pio_port()
        if not port:
            yield "data: ERROR: No serial device found — is the board plugged in?\n\n"
            yield "data: __FAIL__\n\n"
            return

        yield f"data: Resetting device on {port}...\n\n"

        # ESP32 reset sequence: assert RTS (EN pin), release
        def _do_reset():
            with serial.Serial(port, 115200, timeout=1) as ser:
                ser.setDTR(False)
                ser.setRTS(True)   # EN low  → hold in reset
                import time; time.sleep(0.1)
                ser.setRTS(False)  # EN high → release reset

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _do_reset)

        yield "data: Reset complete.\n\n"
        yield "data: __OK__\n\n"

    except ModuleNotFoundError:
        yield "data: ERROR: pyserial not installed — run: pip install pyserial\n\n"
        yield "data: __FAIL__\n\n"
    except Exception as exc:
        yield f"data: ERROR: {exc}\n\n"
        yield "data: __FAIL__\n\n"