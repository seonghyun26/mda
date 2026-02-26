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


# ── Session lifecycle ──────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    work_dir: str
    nickname: str = ""
    method: str = "metadynamics"
    system: str = "protein"
    gromacs: str = "default"
    plumed_cvs: str = "default"
    extra_overrides: list[str] = []


@router.post("/sessions")
async def create_session_endpoint(req: CreateSessionRequest):
    """Create a new agent session. Returns session_id."""
    Path(req.work_dir).mkdir(parents=True, exist_ok=True)
    session = create_session(
        work_dir=req.work_dir,
        nickname=req.nickname,
        method=req.method,
        system=req.system,
        gromacs=req.gromacs,
        plumed_cvs=req.plumed_cvs,
        extra_overrides=req.extra_overrides,
    )
    return {"session_id": session.session_id, "work_dir": session.work_dir, "nickname": session.nickname}


@router.get("/sessions")
async def list_sessions_endpoint():
    return {"sessions": list_sessions()}


class NicknameRequest(BaseModel):
    nickname: str


@router.patch("/sessions/{session_id}/nickname")
async def update_nickname(session_id: str, req: NicknameRequest):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    session.nickname = req.nickname.strip()
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
