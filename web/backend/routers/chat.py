"""Chat endpoints: create sessions and stream agent responses via SSE."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from web.backend.session_manager import (
    create_session,
    delete_session,
    get_session,
    list_sessions,
    restore_session,
    stop_session_simulation,
)
from web.backend.analysis_utils import get_log_progress

router = APIRouter()

# ── Preset definitions ─────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).parents[3]

# Maps preset id → Hydra config group selections
PRESET_CONFIGS: dict[str, dict[str, str]] = {
    "undefined": dict(method="metadynamics", system="protein", gromacs="default", plumed_cvs="default"),
    "md":        dict(method="plain_md",     system="protein", gromacs="default", plumed_cvs="default"),
    "metad":     dict(method="metadynamics", system="protein", gromacs="default", plumed_cvs="default"),
    "umbrella":  dict(method="umbrella",     system="protein", gromacs="default", plumed_cvs="default"),
}

# Maps molecule system id → subdirectory name under data/molecule/
_DATA_MOLECULES = _REPO_ROOT / "data" / "molecule"
_SYSTEM_DIR: dict[str, str] = {
    "ala_dipeptide": "alanine_dipeptide",
    "chignolin":     "chignolin",
}
_MOL_EXTS = {".pdb", ".gro", ".mol2", ".xyz", ".sdf"}


def _seed_files(work_dir: str, preset: str, system: str, state: str = "") -> list[str]:
    """Copy molecule files from data/molecule/{system}/ into work_dir.
    When state is provided, only the matching state file is copied.
    Returns a list of copied file names (relative to work_dir)."""
    import shutil
    seeded: list[str] = []
    dir_name = _SYSTEM_DIR.get(system)
    if not dir_name:
        return seeded
    src_dir = _DATA_MOLECULES / dir_name
    if not src_dir.is_dir():
        return seeded
    for src in sorted(src_dir.iterdir()):
        if src.is_file() and src.suffix.lower() in _MOL_EXTS:
            if state and src.stem != state:
                continue
            dest = Path(work_dir) / src.name
            shutil.copy2(src, dest)
            seeded.append(src.name)
    return seeded


# ── Session lifecycle ──────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    work_dir: str
    nickname: str = ""
    username: str = ""
    preset: str = "undefined"
    # Individual overrides (ignored when preset is set)
    method: str = ""
    system: str = ""
    state: str = ""   # molecule conformational state (e.g. "c5", "c7ax")
    gromacs: str = ""
    plumed_cvs: str = ""
    extra_overrides: list[str] = []


@router.post("/sessions")
async def create_session_endpoint(req: CreateSessionRequest):
    """Create a new agent session. Returns session_id + list of seeded files."""
    Path(req.work_dir).mkdir(parents=True, exist_ok=True)

    # Resolve config from preset; individual fields override if provided
    cfg_defaults = PRESET_CONFIGS.get(req.preset, PRESET_CONFIGS["undefined"])
    method     = req.method     or cfg_defaults["method"]
    plumed_cvs = req.plumed_cvs or cfg_defaults["plumed_cvs"]
    # "auto" and "blank" both map to the maximally-compatible "default" GROMACS config
    _HYDRA_GROMACS_MAP: dict[str, str] = {
        "auto":  "default",
        "blank": "default",
    }
    gromacs_raw = req.gromacs or cfg_defaults["gromacs"]
    gromacs = _HYDRA_GROMACS_MAP.get(gromacs_raw, gromacs_raw)
    # molecule_system is the UI selector (used for file seeding only)
    # hydra_system must be a valid conf/system/*.yaml name
    molecule_system = req.system  # e.g. "ala_dipeptide", "chignolin", "blank"
    _HYDRA_SYSTEM_MAP: dict[str, str] = {
        "ala_dipeptide": "ala_dipeptide",
        "chignolin":     "protein",
        "blank":         "protein",
    }
    hydra_system = _HYDRA_SYSTEM_MAP.get(molecule_system) or cfg_defaults["system"]

    session = create_session(
        work_dir=req.work_dir,
        nickname=req.nickname,
        username=req.username,
        method=method,
        system=hydra_system,
        gromacs=gromacs,
        plumed_cvs=plumed_cvs,
        extra_overrides=req.extra_overrides,
    )

    seeded = _seed_files(req.work_dir, req.preset, molecule_system, req.state)

    # Write initial config.yaml to work_dir so the user can inspect/edit it
    try:
        from omegaconf import OmegaConf
        cfg_path = Path(req.work_dir) / "config.yaml"
        OmegaConf.save(session.agent.cfg, cfg_path)
        seeded.append("config.yaml")
    except Exception:
        pass

    # Write session.json for persistence across server restarts
    from datetime import datetime
    meta = {
        "session_id": session.session_id,
        "nickname": session.nickname,
        "work_dir": session.work_dir,
        "status": "active",
        "updated_at": datetime.utcnow().isoformat(),
    }
    (Path(req.work_dir).parent / "session.json").write_text(json.dumps(meta, indent=2))

    return {
        "session_id": session.session_id,
        "work_dir": session.work_dir,
        "nickname": session.nickname,
        "seeded_files": seeded,
    }


@router.get("/sessions")
async def list_sessions_endpoint(username: str = ""):
    """List sessions by scanning outputs/{username}/*/session.json on disk."""
    outputs_root = Path("outputs")
    if username:
        scan_root = outputs_root / username
        glob_pattern = "*/session.json"
    else:
        scan_root = outputs_root
        glob_pattern = "*/*/session.json"

    sessions = []
    if scan_root.is_dir():
        for sf in scan_root.glob(glob_pattern):
            try:
                data = json.loads(sf.read_text())
                if "session_id" in data and "work_dir" in data:
                    if data.get("status") == "inactive":
                        continue
                    sessions.append({
                        "session_id": data["session_id"],
                        "work_dir": data["work_dir"],
                        "nickname": data.get("nickname", ""),
                        "selected_molecule": data.get("selected_molecule", ""),
                        "updated_at": data.get("updated_at", ""),
                    })
            except Exception:
                continue

    sessions.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
    return {"sessions": sessions}


class NicknameRequest(BaseModel):
    nickname: str


class MoleculeSelectRequest(BaseModel):
    selected_molecule: str


@router.patch("/sessions/{session_id}/molecule")
async def update_selected_molecule(session_id: str, req: MoleculeSelectRequest):
    """Persist the selected molecule filename in session.json."""
    from datetime import datetime
    for sf in Path("outputs").glob("*/*/session.json"):
        try:
            data = json.loads(sf.read_text())
            if data.get("session_id") == session_id:
                data.update({
                    "selected_molecule": req.selected_molecule,
                    "updated_at": datetime.utcnow().isoformat(),
                })
                sf.write_text(json.dumps(data, indent=2))
                break
        except Exception:
            pass
    return {"session_id": session_id, "selected_molecule": req.selected_molecule}


@router.patch("/sessions/{session_id}/nickname")
async def update_nickname(session_id: str, req: NicknameRequest):
    from datetime import datetime
    nickname = req.nickname.strip()
    # Update the in-memory session if it exists
    session = get_session(session_id)
    if session:
        session.nickname = nickname
    # Scan disk and update session.json in-place, preserving all existing fields
    for sf in Path("outputs").glob("*/*/session.json"):
        try:
            data = json.loads(sf.read_text())
            if data.get("session_id") == session_id:
                data.update({"nickname": nickname, "updated_at": datetime.utcnow().isoformat()})
                sf.write_text(json.dumps(data, indent=2))
                break
        except Exception:
            pass
    return {"session_id": session_id, "nickname": nickname}


class RestoreRequest(BaseModel):
    work_dir: str
    nickname: str = ""
    username: str = ""


@router.post("/sessions/{session_id}/restore")
async def restore_session_endpoint(session_id: str, req: RestoreRequest):
    """Ensure a session is live in memory, reconstructing from config.yaml if needed."""
    session = restore_session(session_id, req.work_dir, req.nickname, req.username)
    return {"session_id": session.session_id, "work_dir": session.work_dir, "nickname": session.nickname}


@router.delete("/sessions/{session_id}")
async def delete_session_endpoint(session_id: str):
    # Stop any running simulation before removing the session
    stopped = stop_session_simulation(session_id)

    # Scan disk directly by session_id and mark session.json as deleted in-place.
    # This avoids relying on the in-memory session (which may not exist if the
    # user deletes a session they never clicked on in the current browser tab).
    from datetime import datetime
    for sf in Path("outputs").glob("*/*/session.json"):
        try:
            data = json.loads(sf.read_text())
            if data.get("session_id") == session_id:
                data.update({
                    "status": "inactive",
                    "updated_at": datetime.utcnow().isoformat(),
                })
                sf.write_text(json.dumps(data, indent=2))
                break
        except Exception:
            pass

    delete_session(session_id)
    return {"deleted": session_id, "simulation_stopped": stopped}


# ── Streaming chat ─────────────────────────────────────────────────────

def _format_sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.get("/sessions/{session_id}/stream")
async def stream_chat(session_id: str, message: str):
    """SSE endpoint. message passed as query param.

    Returns a text/event-stream response. Each event is a JSON-encoded
    dict; see MDAgent.stream_run() for the event schema.
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    async def event_generator():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        # Run the synchronous generator in a thread pool.
        # We use a wrapper that drains next() calls one at a time.
        gen = session.agent.stream_run(message)

        async def drain_agent():
            try:
                while True:
                    # next() blocks in the thread pool, won't block event loop
                    event = await loop.run_in_executor(None, next, gen)
                    await queue.put(_format_sse(event))
                    if event.get("type") in ("agent_done", "error"):
                        break
            except StopIteration:
                pass
            finally:
                await queue.put(None)  # sentinel

        async def poll_progress():
            log_path = str(Path(session.work_dir) / "md.log")
            total_steps = session.sim_status.get("total_steps", 1)
            while True:
                await asyncio.sleep(10)
                info = get_log_progress(log_path)
                if info:
                    event = {
                        "type": "sim_progress",
                        "step": info.get("step", 0),
                        "total_steps": total_steps,
                        "ns_per_day": info.get("ns_per_day") or 0.0,
                        "time_ps": info.get("time_ps") or 0.0,
                    }
                    await queue.put(_format_sse(event))

        agent_task = asyncio.create_task(drain_agent())
        progress_task = asyncio.create_task(poll_progress())

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            agent_task.cancel()
            progress_task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
