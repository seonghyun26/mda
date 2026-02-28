# prj-amd

A Claude Opus 4.6-powered agent for running enhanced sampling molecular dynamics simulations with GROMACS + PLUMED, with a full-featured web UI.

---

## Prerequisites

| Software | Install |
|---|---|
| Python 3.10+ | `conda create -n amd python=3.11` |
| Docker (daemon running) | [docs.docker.com](https://docs.docker.com/get-docker/) — pulls `gromacs-plumed:latest` automatically |
| Anthropic API key | `export ANTHROPIC_API_KEY=sk-ant-...` |
| WandB account (optional) | Set key via the **Information** button in the web UI |

---

## Quick Start

> **Requires Docker daemon running** — GROMACS and PLUMED run inside a Docker container (`gromacs-plumed:latest`).

```bash
git clone <repo-url> prj-amd
cd prj-amd
pip install -r requirements.txt

# Set environment variables
cp .env.example .env        # or edit .env directly
# GMX_DOCKER_IMAGE=gromacs-plumed:latest
# ANTHROPIC_API_KEY=sk-ant-...

# Start the web server + frontend
./start.sh

# Open browser at http://localhost:3000
```

---

## Features

| Feature | Description |
|---|---|
| **Web UI** | Browser-based interface for session management, GROMACS configuration, molecule visualization, and live simulation control |
| **Enhanced sampling MD** | Metadynamics (well-tempered), umbrella sampling, and unbiased MD — fully configured via the UI |
| **Direct Docker simulation** | One-click simulation launch via GROMACS+PLUMED Docker container, no manual CLI required |
| **Live wandb logging** | Background monitor thread tails `.edr`, `COLVAR`, and `HILLS` files during the run |
| **AI assistant** | Claude Opus 4.6 agent answers questions, suggests CVs, analyzes results, and extracts settings from papers |
| **Molecule search** | Search RCSB PDB and download structures directly into the session directory |

---

## Web UI

### Login

![Login](images/login.png)

Authenticate with your username and password. User accounts are stored in a local SQLite database.

---

### Dashboard

![Dashboard](images/dashboard.png)

The main interface is divided into three panels:

| Panel | Purpose |
|---|---|
| **Left — Session Sidebar** | Create, switch between, and delete simulation sessions. Access user settings (WandB API key) via the profile icon. |
| **Center — MD Workspace** | Configure and monitor a session across four tabs: Progress, Molecule, GROMACS, Method. |
| **Right — AI Assistant** | Chat with Claude Opus 4.6 — ask questions, get CV suggestions, analyze results. |

---

### Session Creation

![Session Creation](images/session-creation.png)

Click **New Session** in the sidebar to create a session. Choose:

- **Molecule System** — Alanine Dipeptide (ACE-ALA-NME), Chignolin (CLN025), or a blank system for custom files
- **Simulation Method** — Molecular Dynamics (unbiased), Metadynamics (well-tempered), or Umbrella Sampling
- **GROMACS Template** — Vacuum box (dodecahedron, no solvent) or Auto (maximally compatible defaults with PME electrostatics and solvation)

Give the session a name and click **Create Session**. The molecule PDB is automatically seeded into the session directory.

---

### Progress Tab

![Progress Tab](images/session-progress.png)

Monitor a running simulation:

- **Simulation Status** — live step counter, ns/day performance, and energy plots
- **Energy Plot** — potential and kinetic energy from the `.edr` file
- **COLVAR Plot** — collective variable trajectory (when using PLUMED)
- **Ramachandran Plot** — φ/ψ dihedral angles for peptide systems
- **Files** — list of all output files with preview, download, and delete (archived, not permanently deleted)

---

### Starting and Stopping a Simulation

At the bottom of every session view, a single button controls the simulation lifecycle:

| State | Button | Action |
|---|---|---|
| Idle | **▶ Start MD Simulation** (blue) | Runs `pdb2gmx` → `editconf` → `solvate` → `genion` → `grompp` → `mdrun` via Docker |
| Setting up | **⟳ Setting up…** (gray, disabled) | GROMACS pre-processing is running |
| Running | **■ Pause MD Simulation** (amber) | Click to stop; shows confirmation dialog |

The solvation steps (`editconf`, `solvate`, `genion`) are only run for non-vacuum systems. Output files are written to `<session_dir>/simulation/`.

---

### Molecule Tab

![Molecule Tab](images/session-molecule.png)

- **3D viewer** — interactive visualization of the selected molecule (PDB, GRO); shows atom and residue count
- **Molecule Files** — list of structure files in the session directory; click **Select** to load into the viewer, **Download** to save locally, or **Delete** to remove
- **Upload** — drag-and-drop or click to upload your own coordinate file
- **Search with agent** — AI agent searches RCSB PDB, downloads structures, and extracts molecule/system settings from papers

---

### GROMACS Tab

![GROMACS Tab](images/session-gromacs.png)

Configure all GROMACS MDP parameters before running:

| Section | Parameters |
|---|---|
| **System** | Force field (AMBER99SB-ILDN, CHARMM27, CHARMM36m) · Solvent (Vacuum, TIP3P Water) · Box clearance (nm) |
| **Simulation Length** | Steps · Timestep (fs) — total simulation time auto-calculated (fs / ps / ns) |
| **Temperature** | Reference temperature (K) · Thermostat time constant τ (ps) |
| **Advanced** | Non-bonded cutoffs · Electrostatics · Neighbor list · Constraints · Output frequencies · Pressure coupling (foldable) |

Settings are saved automatically when you leave each input field.

---

### Method Tab

![Method Tab](images/session-method.png)

Switch between simulation methods (MD, Metadynamics, Umbrella Sampling). For Metadynamics, configure:

- PLUMED HILLS height (kJ/mol), pace (steps), sigma, and bias factor γ
- Use **Suggest CVs** to ask the AI agent to recommend collective variables based on the molecule structure

Settings are saved automatically when you change any field.

---

## Key Design Notes

- **Docker daemon required** — all GROMACS commands run inside the `gromacs-plumed` container; `GMX_DOCKER_IMAGE` env var controls the image name; session `work_dir` is bind-mounted at `/work`
- **mdrun is non-blocking** — `subprocess.Popen` returns immediately so the WandB monitor can start
- **PLUMED atom indices are 1-based** — the agent system prompt enforces this
- **Paper extraction always requires confirmation** — never auto-runs multi-hour simulations
- **Adaptive thinking** — Claude Opus 4.6 uses `thinking: {type: "adaptive"}` for complex reasoning
- **Box size validation** — before each run, `ionized.gro` / `box.gro` are checked against configured cutoffs; if the box is too small, it is rebuilt automatically

## License

MIT
