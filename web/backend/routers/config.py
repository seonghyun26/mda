"""Config endpoints: list available options, update session config, generate MD files."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from omegaconf import OmegaConf
from pydantic import BaseModel

from web.backend.session_manager import _repo_conf_dir, get_session, get_or_restore_session

router = APIRouter()

_DATA_MOLECULES = Path(__file__).parents[4] / "data" / "molecule"
_MOL_EXTS = {".pdb", ".gro", ".mol2", ".xyz", ".sdf"}


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
    for key, value in req.updates.items():
        OmegaConf.update(cfg, key, value, merge=True)
    return {"updated": True, "config": OmegaConf.to_container(cfg, resolve=True)}


@router.get("/sessions/{session_id}/config")
async def get_session_config(session_id: str):
    session = get_or_restore_session(session_id)
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

    # ── config.yaml — human-readable session config (session root) ───────
    try:
        session_root = work_dir.parent
        session_root.mkdir(parents=True, exist_ok=True)
        OmegaConf.save(cfg, session_root / "config.yaml")
        generated.append("../config.yaml")
        # Remove legacy config location inside data/ so it is not listed in web files.
        legacy_cfg = work_dir / "config.yaml"
        if legacy_cfg.exists():
            legacy_cfg.unlink()
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

    # ── session.json metadata (lives in session root, parent of data/) ───────
    session_root.mkdir(parents=True, exist_ok=True)
    meta_path = session_root / "session.json"
    try:
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    except Exception:
        meta = {}
    meta.update({
        "session_id": session_id,
        "nickname": session.nickname,
        "work_dir": session.work_dir,
        "updated_at": datetime.utcnow().isoformat(),
    })
    meta.setdefault("status", "active")
    try:
        meta_path.write_text(json.dumps(meta, indent=2))
    except Exception as exc:
        raise HTTPException(500, f"Failed to write session.json: {exc}")

    return {"generated": generated, "work_dir": str(work_dir)}


# ── Molecule library ───────────────────────────────────────────────────

@router.get("/molecules")
async def get_molecules():
    """Scan data/molecule/ and return available systems with their conformational states."""
    systems = []
    if _DATA_MOLECULES.is_dir():
        for system_dir in sorted(_DATA_MOLECULES.iterdir()):
            if not system_dir.is_dir():
                continue
            states = []
            for f in sorted(system_dir.iterdir()):
                if f.is_file() and f.suffix.lower() in _MOL_EXTS:
                    states.append({"name": f.stem, "file": f.name})
            if states:
                label = system_dir.name.replace("_", " ").title()
                systems.append({"id": system_dir.name, "label": label, "states": states})
    return {"systems": systems}


class LoadMoleculeRequest(BaseModel):
    system: str
    state: str


@router.post("/sessions/{session_id}/molecules/load")
async def load_molecule(session_id: str, req: LoadMoleculeRequest):
    """Copy a specific molecule state file from the data library into the session work_dir."""
    import shutil

    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    src_dir = _DATA_MOLECULES / req.system
    if not src_dir.is_dir():
        raise HTTPException(404, f"System {req.system!r} not found in molecule library")

    src_file = next(
        (f for f in src_dir.iterdir() if f.is_file() and f.suffix.lower() in _MOL_EXTS and f.stem == req.state),
        None,
    )
    if src_file is None:
        raise HTTPException(404, f"State {req.state!r} not found in system {req.system!r}")

    dest = Path(session.work_dir) / src_file.name
    shutil.copy2(src_file, dest)
    return {"loaded": src_file.name, "work_dir": session.work_dir}
