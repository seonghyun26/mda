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
)
from web.backend.analysis_utils import get_log_progress

router = APIRouter()

# ── Preset definitions ─────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).parents[2]

# Maps preset id → Hydra config group selections
PRESET_CONFIGS: dict[str, dict[str, str]] = {
    "undefined": dict(method="metadynamics", system="protein", gromacs="default", plumed_cvs="default"),
    "md":        dict(method="plain_md",     system="protein", gromacs="default", plumed_cvs="default"),
    "metad":     dict(method="metadynamics", system="protein", gromacs="default", plumed_cvs="default"),
    "umbrella":  dict(method="umbrella",     system="protein", gromacs="default", plumed_cvs="default"),
}

# Maps molecule system id → list of example files to copy into work_dir on creation
_ALA = _REPO_ROOT / "examples" / "alanine_dipeptide"
SYSTEM_SEED_FILES: dict[str, list[Path]] = {
    "ala_dipeptide": [_ALA / "ala2.pdb"],
}


def _seed_files(work_dir: str, preset: str, system: str) -> list[str]:
    """Copy preset/system example files into work_dir. Returns relative file paths."""
    import shutil
    seeded: list[str] = []
    sources: list[Path] = list(SYSTEM_SEED_FILES.get(system, []))
    for src in sources:
        if src.is_file():
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
    gromacs: str = ""
    plumed_cvs: str = ""
    extra_overrides: list[str] = []


@router.post("/sessions")
async def create_session_endpoint(req: CreateSessionRequest):
    """Create a new agent session. Returns session_id + list of seeded files."""
    Path(req.work_dir).mkdir(parents=True, exist_ok=True)

    # Resolve config from preset; individual fields override if provided
    cfg_defaults = PRESET_CONFIGS.get(req.preset, PRESET_CONFIGS["undefined"])
    method    = req.method    or cfg_defaults["method"]
    system    = req.system    or cfg_defaults["system"]
    gromacs   = req.gromacs   or cfg_defaults["gromacs"]
    plumed_cvs = req.plumed_cvs or cfg_defaults["plumed_cvs"]

    session = create_session(
        work_dir=req.work_dir,
        nickname=req.nickname,
        username=req.username,
        method=method,
        system=system,
        gromacs=gromacs,
        plumed_cvs=plumed_cvs,
        extra_overrides=req.extra_overrides,
    )

    seeded = _seed_files(req.work_dir, req.preset, system)

    # Write initial config.yaml to work_dir so the user can inspect/edit it
    try:
        from omegaconf import OmegaConf
        cfg_path = Path(req.work_dir) / "config.yaml"
        OmegaConf.save(session.agent.cfg, cfg_path)
        seeded.append("config.yaml")
    except Exception:
        pass

    return {
        "session_id": session.session_id,
        "work_dir": session.work_dir,
        "nickname": session.nickname,
        "seeded_files": seeded,
    }


@router.get("/sessions")
async def list_sessions_endpoint(username: str = ""):
    return {"sessions": list_sessions(username=username)}


class NicknameRequest(BaseModel):
    nickname: str


@router.patch("/sessions/{session_id}/nickname")
async def update_nickname(session_id: str, req: NicknameRequest):
    import json
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    session.nickname = req.nickname.strip()
    # Persist nickname in work_dir/session.json
    meta_path = Path(session.work_dir) / "session.json"
    try:
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        meta.update({"session_id": session_id, "nickname": session.nickname, "work_dir": session.work_dir})
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(meta, indent=2))
    except Exception:
        pass
    return {"session_id": session_id, "nickname": session.nickname}


@router.delete("/sessions/{session_id}")
async def delete_session_endpoint(session_id: str):
    ok = delete_session(session_id)
    if not ok:
        raise HTTPException(404, "Session not found")
    return {"deleted": session_id}


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
