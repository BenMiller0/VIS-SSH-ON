"""
backend/api/routes_files.py

File browser API used by editor.js.
  GET    /api/files               — list all files under EMBEDDED_SOFTWARE_DIR
  GET    /api/files/{path}        — read a file
  POST   /api/files/{path}        — write / create a file
  DELETE /api/files/{path}        — delete a file

All paths are sandboxed to EMBEDDED_SOFTWARE_DIR — traversal attempts
return 403.
"""

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/files", tags=["files"])

EMBEDDED_SOFTWARE_DIR = "embedded_software"
_EXCLUDED_DIRS = {".pio", ".git", ".venv", "__pycache__", "node_modules", ".idea", ".vscode"}


def _safe_path(file_path: str) -> str | None:
    """
    Resolve file_path relative to EMBEDDED_SOFTWARE_DIR.
    Returns the absolute path if it stays within the sandbox, else None.
    """
    base = os.path.abspath(EMBEDDED_SOFTWARE_DIR)
    resolved = os.path.normpath(os.path.join(base, file_path))
    return resolved if resolved.startswith(base) else None


class FileContent(BaseModel):
    content: str


@router.get("")
def list_files():
    base = os.path.abspath(EMBEDDED_SOFTWARE_DIR)
    files: list[str] = []
    for root, dirs, filenames in os.walk(base):
        dirs[:] = sorted(
            d for d in dirs
            if d not in _EXCLUDED_DIRS and not d.startswith(".")
        )
        for filename in sorted(filenames):
            rel = os.path.relpath(os.path.join(root, filename), base)
            files.append(rel.replace(os.sep, "/"))
    return {"files": files}


@router.get("/{file_path:path}")
def read_file(file_path: str):
    safe = _safe_path(file_path)
    if safe is None:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    if not os.path.isfile(safe):
        return JSONResponse(status_code=404, content={"error": "Not found"})
    try:
        with open(safe, encoding="utf-8") as f:
            content = f.read()
        return {"path": file_path, "content": content}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@router.post("/{file_path:path}")
def write_file(file_path: str, body: FileContent):
    safe = _safe_path(file_path)
    if safe is None:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    try:
        os.makedirs(os.path.dirname(safe), exist_ok=True)
        with open(safe, "w", encoding="utf-8") as f:
            f.write(body.content)
        return {"success": True, "path": file_path}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@router.delete("/{file_path:path}")
def delete_file(file_path: str):
    safe = _safe_path(file_path)
    if safe is None:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    if not os.path.isfile(safe):
        return JSONResponse(status_code=404, content={"error": "Not found"})
    try:
        os.remove(safe)
        return {"success": True, "path": file_path}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})