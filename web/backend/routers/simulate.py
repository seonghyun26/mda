"""Direct simulation launcher — grompp + mdrun via Docker, no AI."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from omegaconf import OmegaConf

from web.backend.session_manager import get_session

router = APIRouter()

_COORD_EXTS = {".gro", ".pdb"}
_TOP_EXTS = {".top"}

# Subfolder within work_dir where mdrun writes its output files
_SIM_SUBDIR = "simulation"
# Subfolder where pre-existing GROMACS outputs are archived before each run
_ARCHIVE_SUBDIR = "archive"


def _archive_existing(work_dir: Path, *patterns: str) -> None:
    """Move files matching glob patterns into work_dir/archive/.

    Called before every GROMACS command that would overwrite output files,
    so GROMACS never creates its own #filename.bak# backups.
    """
    archive_dir = work_dir / _ARCHIVE_SUBDIR
    for pattern in patterns:
        for src in work_dir.glob(pattern):
            if src.is_file():
                archive_dir.mkdir(exist_ok=True)
                shutil.move(str(src), str(archive_dir / src.name))


def _find_file(work_dir: Path, extensions: set[str], preferred: str = "") -> str | None:
    if preferred and (work_dir / preferred).exists():
        return preferred
    for f in sorted(work_dir.iterdir()):
        if f.is_file() and f.suffix.lower() in extensions:
            return f.name
    return None


def _gro_min_image_distance(gro_path: Path) -> float | None:
    """Return an estimate of the minimum image distance (nm) from the GRO box vectors.

    For a cubic/rectangular box  : min(v1x, v2y, v3z)
    For a dodecahedron (triclinic): v1x * sqrt(3) / 2  (good approximation)
    Returns None if the file cannot be parsed.
    """
    try:
        last = gro_path.read_text().rstrip().splitlines()[-1]
        vals = [float(x) for x in last.split()]
        if len(vals) == 3:
            return min(vals)
        if len(vals) == 9:
            # Triclinic box — for a dodecahedron v1x == v2y == v3z
            return vals[0] * (3 ** 0.5 / 2)
    except Exception:
        pass
    return None


def _topology_has_molecules(top_path: Path) -> bool:
    """Return True only if the topology file has a populated [ molecules ] section."""
    try:
        if top_path.stat().st_size == 0:
            return False
        in_mol_section = False
        for line in top_path.read_text().splitlines():
            s = line.strip()
            if s.startswith("[") and "molecules" in s.lower():
                in_mol_section = True
                continue
            if s.startswith("[") and in_mol_section:
                break  # entered a new section — no molecules found
            if in_mol_section and s and not s.startswith(";"):
                return True  # found at least one non-comment molecule entry
    except Exception:
        pass
    return False


@router.post("/sessions/{session_id}/simulate")
async def start_simulation(session_id: str):
    """Generate MDP, run grompp, then launch mdrun in Docker — no AI involved.

    All GROMACS steps run with work_dir bind-mounted at /work inside the
    Docker container.  mdrun output files are written to work_dir/simulation/.

    Pipeline for solvated systems (water_model != "none"):
      pdb2gmx → editconf → solvate → grompp(ions) → genion → grompp → mdrun

    Pipeline for vacuum systems (water_model == "none"):
      pdb2gmx → editconf (cubic box) → grompp → mdrun

    Both pdb2gmx and the solvation steps are idempotent: they are re-run
    whenever their canonical output file is absent.  Pre-existing outputs are
    moved to work_dir/archive/ before each step so GROMACS never produces its
    own #filename.bak# backups.
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    work_dir = Path(session.work_dir)
    cfg = session.agent.cfg
    gmx = session.agent._gmx

    forcefield    = OmegaConf.select(cfg, "system.forcefield")    or "amber99sb-ildn"
    water_model   = OmegaConf.select(cfg, "system.water_model")   or "none"
    box_clearance = float(OmegaConf.select(cfg, "gromacs.box_clearance") or 1.5)

    # 1. Generate md.mdp from current config
    from md_agent.config.hydra_utils import generate_mdp_from_config
    generate_mdp_from_config(cfg, str(work_dir / "md.mdp"))

    # 2. Find the raw input coordinate file (the original PDB/GRO the user uploaded)
    preferred_coord = OmegaConf.select(cfg, "system.coordinates") or ""
    # Exclude derived GROMACS outputs so _find_file picks the original input
    _DERIVED = {"system.gro", "box.gro", "solvated.gro", "ionized.gro"}
    input_coord = _find_file(
        work_dir, _COORD_EXTS,
        preferred_coord if preferred_coord not in _DERIVED else "",
    )
    if not input_coord:
        raise HTTPException(400, "No coordinate file (.gro or .pdb) found in session directory.")

    # ── Step A: pdb2gmx ─────────────────────────────────────────────────
    # Re-run whenever topol.top is missing or has no [ molecules ] entries.
    preferred_top = OmegaConf.select(cfg, "system.topology") or ""
    top_file = _find_file(work_dir, _TOP_EXTS, preferred_top)

    if not top_file or not _topology_has_molecules(work_dir / top_file):
        _archive_existing(work_dir, "system.gro", "topol.top", "posre*.itp", "mdout.mdp")

        def _run_pdb2gmx(ff: str) -> dict:
            return gmx.run_gmx_command(
                "pdb2gmx",
                ["-f", input_coord, "-o", "system.gro", "-p", "topol.top",
                 "-ff", ff, "-water", water_model, "-ignh"],
                work_dir=str(work_dir),
            )

        result = _run_pdb2gmx(forcefield)

        # Fall back to amber99sb-ildn if the chosen FF lacks the residue
        if result["returncode"] != 0:
            stderr = result.get("stderr", "")
            if "not found in residue topology database" in stderr and forcefield != "amber99sb-ildn":
                result = _run_pdb2gmx("amber99sb-ildn")
                if result["returncode"] == 0:
                    from omegaconf import OmegaConf as _OC
                    _OC.update(cfg, "system.forcefield", "amber99sb-ildn", merge=True)
                    forcefield = "amber99sb-ildn"

        if result["returncode"] != 0:
            raise HTTPException(500, f"pdb2gmx failed:\n{result.get('stderr', '')[-2000:]}")
        top_file = "topol.top"

    rcoulomb    = float(OmegaConf.select(cfg, "gromacs.rcoulomb") or 1.2)
    rvdw        = float(OmegaConf.select(cfg, "gromacs.rvdw")     or 1.2)
    _max_cutoff = max(rcoulomb, rvdw)

    def _box_too_small(gro_path: Path) -> bool:
        """True if the GRO file's box is too small for the configured cutoffs."""
        if not gro_path.exists():
            return True
        d = _gro_min_image_distance(gro_path)
        return d is None or d / 2 < _max_cutoff

    # ── Step B: solvation + ionisation ─────────────────────────────────
    # Canonical output: ionized.gro.  Re-run whenever it is absent OR whenever
    # the existing box is too small for the configured cutoffs.
    if water_model != "none":
        _ionized = work_dir / "ionized.gro"
        if _ionized.exists() and _box_too_small(_ionized):
            # Box too small — archive and rebuild
            _archive_existing(work_dir, "ionized.gro", "solvated.gro", "box.gro", "ions.tpr")

        if not _ionized.exists():
            if not (work_dir / "system.gro").exists():
                raise HTTPException(
                    500,
                    "system.gro not found — pdb2gmx must succeed before solvation.",
                )

            # B1. Add simulation box using configured clearance
            _archive_existing(work_dir, "box.gro")
            r = gmx.run_gmx_command(
                "editconf",
                ["-f", "system.gro", "-o", "box.gro",
                 "-c", "-d", str(box_clearance), "-bt", "dodecahedron"],
                work_dir=str(work_dir),
            )
            if r["returncode"] != 0:
                raise HTTPException(500, f"editconf failed:\n{r.get('stderr', '')[-2000:]}")

            # B2. Fill with water
            _archive_existing(work_dir, "solvated.gro")
            r = gmx.run_gmx_command(
                "solvate",
                ["-cp", "box.gro", "-cs", "spc216.gro",
                 "-o", "solvated.gro", "-p", "topol.top"],
                work_dir=str(work_dir),
            )
            if r["returncode"] != 0:
                raise HTTPException(500, f"solvate failed:\n{r.get('stderr', '')[-2000:]}")

            # B3. grompp → ions.tpr (net-charge warning expected; genion will fix it)
            _archive_existing(work_dir, "ions.tpr", "mdout.mdp")
            r = gmx.grompp(
                mdp_file="md.mdp",
                topology_file="topol.top",
                coordinate_file="solvated.gro",
                output_tpr="ions.tpr",
                max_warnings=20,
            )
            if not r["success"]:
                raise HTTPException(500, f"grompp (ions) failed:\n{r.get('stderr', '')[-2000:]}")

            # B4. Replace water molecules with Na+/Cl- to neutralise
            _archive_existing(work_dir, "ionized.gro")
            r = gmx.run_gmx_command(
                "genion",
                ["-s", "ions.tpr", "-o", "ionized.gro", "-p", "topol.top",
                 "-pname", "NA", "-nname", "CL", "-neutral"],
                stdin_text="SOL\n",
                work_dir=str(work_dir),
            )
            if r["returncode"] != 0:
                raise HTTPException(500, f"genion failed:\n{r.get('stderr', '')[-2000:]}")

        coord_file = "ionized.gro"
        OmegaConf.update(cfg, "system.coordinates", "ionized.gro", merge=True)
    else:
        # Vacuum: run editconf to set a proper periodic box before grompp.
        # pdb2gmx's default box is often too small for the configured cutoffs.
        _vac_box = work_dir / "box.gro"
        if _vac_box.exists() and _box_too_small(_vac_box):
            _archive_existing(work_dir, "box.gro")

        if not _vac_box.exists():
            _src = "system.gro" if (work_dir / "system.gro").exists() else input_coord
            r = gmx.run_gmx_command(
                "editconf",
                ["-f", _src, "-o", "box.gro",
                 "-c", "-d", str(box_clearance), "-bt", "cubic"],
                work_dir=str(work_dir),
            )
            if r["returncode"] != 0:
                raise HTTPException(500, f"editconf (vacuum) failed:\n{r.get('stderr', '')[-2000:]}")

        coord_file = "box.gro"

    # ── Step C: production grompp → md.tpr ─────────────────────────────
    _archive_existing(work_dir, "md.tpr", "mdout.mdp")
    index_file = OmegaConf.select(cfg, "system.index") or None
    has_index  = index_file and (work_dir / index_file).exists()
    grompp = gmx.grompp(
        mdp_file="md.mdp",
        topology_file=top_file,
        coordinate_file=coord_file,
        output_tpr="md.tpr",
        index_file=index_file if has_index else None,
        max_warnings=5,
    )
    if not grompp["success"]:
        raise HTTPException(500, f"grompp failed:\n{grompp.get('stderr', '')[-2000:]}")

    # ── Step D: launch mdrun (non-blocking) ────────────────────────────
    sim_dir = work_dir / _SIM_SUBDIR
    sim_dir.mkdir(exist_ok=True)
    output_prefix = f"{_SIM_SUBDIR}/md"
    mdrun = gmx.mdrun(tpr_file="md.tpr", output_prefix=output_prefix)

    return {
        "status": "running",
        "pid": mdrun["pid"],
        "expected_files": mdrun["expected_files"],
    }


@router.get("/sessions/{session_id}/simulate/status")
async def simulation_status(session_id: str):
    """Check whether mdrun is currently running for this session."""
    from web.backend.session_manager import get_simulation_status
    return get_simulation_status(session_id)


@router.post("/sessions/{session_id}/simulate/stop")
async def stop_simulation(session_id: str):
    """Terminate a running mdrun process."""
    from web.backend.session_manager import stop_session_simulation
    stopped = stop_session_simulation(session_id)
    return {"stopped": stopped}
