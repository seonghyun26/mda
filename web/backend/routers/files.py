"""File management endpoints: upload, list, download."""

from __future__ import annotations

import io
import shutil
import zipfile
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from md_agent.utils.file_utils import list_files
from web.backend.session_manager import get_session

router = APIRouter()


@router.get("/sessions/{session_id}/files")
async def list_session_files(session_id: str, pattern: str = "*", recursive: bool = True):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    files = list_files(session.work_dir, pattern=pattern, recursive=recursive)
    # Hide the archive subfolder and any GROMACS #...# backup files
    archive_prefix = str(Path(session.work_dir) / "archive") + "/"
    files = [
        f for f in files
        if not f.startswith(archive_prefix)
        and not Path(f).name.startswith("#")
    ]
    return {"files": files, "work_dir": session.work_dir}


@router.post("/sessions/{session_id}/files/upload")
async def upload_file(session_id: str, file: UploadFile):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    dest = Path(session.work_dir) / (file.filename or "upload")
    dest.parent.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    dest.write_bytes(content)
    return {"saved_path": str(dest), "size_bytes": len(content)}


@router.get("/sessions/{session_id}/files/download")
async def download_file(session_id: str, path: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    # Safety: resolve and ensure path is within work_dir
    work = Path(session.work_dir).resolve()
    target = Path(path).resolve()
    if not str(target).startswith(str(work)):
        raise HTTPException(403, "Path outside session work directory")
    if not target.exists():
        raise HTTPException(404, "File not found")

    return FileResponse(str(target), filename=target.name)


@router.delete("/sessions/{session_id}/files")
async def delete_file(session_id: str, path: str):
    """Move a file to the session-level archive/ folder instead of permanently deleting it.

    Archive location: <session_dir>/archive/  (sibling of the data/ work directory).
    Name collisions are resolved by appending _1, _2, … to the stem.
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    work = Path(session.work_dir).resolve()
    target = Path(path).resolve()
    if not str(target).startswith(str(work)):
        raise HTTPException(403, "Path outside session work directory")
    if not target.exists():
        raise HTTPException(404, "File not found")

    # Archive sits beside the data/ folder, at the session root level
    archive_dir = work.parent / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)

    dest = archive_dir / target.name
    if dest.exists():
        stem, suffix = target.stem, target.suffix
        i = 1
        while dest.exists():
            dest = archive_dir / f"{stem}_{i}{suffix}"
            i += 1

    shutil.move(str(target), str(dest))
    return {"archived": str(dest)}


@router.get("/sessions/{session_id}/files/download-zip")
async def download_zip(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    work = Path(session.work_dir).resolve()
    if not work.exists():
        raise HTTPException(404, "Work directory not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(work.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(work))
    buf.seek(0)

    filename = f"session_{session_id[:8]}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sessions/{session_id}/files/archive")
async def list_archive_files(session_id: str):
    """List files currently in the session-level archive folder."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    work = Path(session.work_dir).resolve()
    archive_dir = work.parent / "archive"
    if not archive_dir.exists():
        return {"files": []}

    files = sorted(str(f) for f in archive_dir.iterdir() if f.is_file())
    return {"files": files}


@router.post("/sessions/{session_id}/files/restore")
async def restore_file(session_id: str, path: str = Body(..., embed=True)):
    """Move a file from the archive folder back into the session work directory."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    work = Path(session.work_dir).resolve()
    archive_dir = (work.parent / "archive").resolve()

    target = Path(path).resolve()
    if not str(target).startswith(str(archive_dir)):
        raise HTTPException(403, "Path outside archive directory")
    if not target.exists():
        raise HTTPException(404, "File not found in archive")

    dest = work / target.name
    if dest.exists():
        stem, suffix = target.stem, target.suffix
        i = 1
        while dest.exists():
            dest = work / f"{stem}_{i}{suffix}"
            i += 1

    shutil.move(str(target), str(dest))
    return {"restored": str(dest)}
