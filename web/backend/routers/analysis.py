"""Analysis endpoints: return plot-ready data for COLVAR, FES, energy, log."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from web.backend.analysis_utils import (
    colvar_to_columns,
    edr_to_timeseries,
    fes_dat_to_heatmap,
    get_log_progress,
)
from web.backend.session_manager import get_or_restore_session

router = APIRouter()


def _require_session(session_id: str):
    session = get_or_restore_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.get("/sessions/{session_id}/analysis/colvar")
async def get_colvar(session_id: str, filename: str = "COLVAR"):
    """Parse COLVAR and return column arrays for Plotly line/scatter charts."""
    session = _require_session(session_id)
    path = str(Path(session.work_dir) / filename)
    data = colvar_to_columns(path)
    return {"data": data, "available": bool(data)}


@router.get("/sessions/{session_id}/analysis/fes")
async def get_fes(session_id: str, filename: str = "fes.dat"):
    """Parse plumed sum_hills FES file → {x, y, z} for Plotly heatmap (Ramachandran)."""
    session = _require_session(session_id)
    path = str(Path(session.work_dir) / filename)
    data = fes_dat_to_heatmap(path)
    return {"data": data, "available": bool(data)}


@router.get("/sessions/{session_id}/analysis/energy")
async def get_energy(
    session_id: str,
    filename: str = "md.edr",
    terms: list[str] = Query(default=["Potential Energy", "Temperature"]),
):
    """Parse .edr energy file → time series for Plotly."""
    session = _require_session(session_id)
    path = str(Path(session.work_dir) / filename)
    data = edr_to_timeseries(path, terms)
    return {"data": data, "available": bool(data)}


@router.get("/sessions/{session_id}/analysis/progress")
async def get_progress(session_id: str, filename: str = "md.log"):
    """Return latest simulation progress from GROMACS log."""
    session = _require_session(session_id)
    path = str(Path(session.work_dir) / filename)
    info = get_log_progress(path)
    return {"progress": info, "available": bool(info)}
