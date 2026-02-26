"""Config endpoints: list available options, update session config, generate MD files."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from omegaconf import OmegaConf
from pydantic import BaseModel

from web.backend.session_manager import _repo_conf_dir, get_session

router = APIRouter()


@router.get("/config/options")
async def get_config_options():
    """Return available Hydra config group options."""
    conf_dir = Path(_repo_conf_dir())

    def list_group(subdir: str) -> list[str]:
        d = conf_dir / subdir
        if not d.is_dir():
            return []
        return [f.stem for f in sorted(d.glob("*.yaml"))]

    return {
        "methods": list_group("method"),
        "systems": list_group("system"),
        "gromacs": list_group("gromacs"),
        "plumed_cvs": list_group("plumed/collective_variables"),
    }


class ConfigUpdateRequest(BaseModel):
    updates: dict  # flat or nested dict of overrides


@router.post("/sessions/{session_id}/config")
async def update_session_config(session_id: str, req: ConfigUpdateRequest):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    cfg = session.agent.cfg
    OmegaConf.update(cfg, ".", req.updates, merge=True)
    return {"updated": True, "config": OmegaConf.to_container(cfg, resolve=True)}


@router.get("/sessions/{session_id}/config")
async def get_session_config(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    cfg = session.agent.cfg
    return {"config": OmegaConf.to_container(cfg, resolve=True)}


@router.post("/sessions/{session_id}/generate-files")
async def generate_session_files(session_id: str):
    """Write md.mdp (and session.json metadata) from current config into work_dir."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    work_dir = Path(session.work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    cfg = session.agent.cfg

    generated: list[str] = []

    # ── config.yaml — human-readable session config ───────────────────────
    try:
        OmegaConf.save(cfg, work_dir / "config.yaml")
        generated.append("config.yaml")
    except Exception as exc:
        raise HTTPException(500, f"Config YAML write failed: {exc}")

    # ── md.mdp — GROMACS parameter file (converted from config) ──────────
    try:
        from md_agent.config.hydra_utils import generate_mdp_from_config
        mdp_path = str(work_dir / "md.mdp")
        generate_mdp_from_config(cfg, mdp_path)
        generated.append("md.mdp")
    except Exception as exc:
        raise HTTPException(500, f"MDP generation failed: {exc}")

    # ── session.json metadata ─────────────────────────────────────────────
    meta = {
        "session_id": session_id,
        "nickname": session.nickname,
        "work_dir": session.work_dir,
        "updated_at": datetime.utcnow().isoformat(),
    }
    (work_dir / "session.json").write_text(json.dumps(meta, indent=2))
    generated.append("session.json")

    return {"generated": generated, "work_dir": str(work_dir)}
