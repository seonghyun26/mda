# prj-amd

A Claude Opus 4.6-powered agent for running enhanced sampling molecular dynamics simulations with GROMACS + PLUMED.

## Features

- **Run enhanced sampling MD** — metadynamics (well-tempered), umbrella sampling, and steered MD, fully configured via Hydra
- **Live wandb logging** — background monitor thread tails `.edr`, `COLVAR`, and `HILLS` files during the run
- **Reproduce from papers** — search Semantic Scholar or ArXiv, extract MD settings with Claude, auto-generate Hydra configs

## Prerequisites

| Software | Install |
|---|---|
| Python 3.10+ | `conda create -n amd python=3.11` |
| GROMACS 2023+ | [gromacs.org](https://www.gromacs.org/Downloads.html) |
| PLUMED 2.9+ | [plumed.org](https://www.plumed.org) — patch GROMACS with `plumed patch -p` |
| Anthropic API key | `export ANTHROPIC_API_KEY=sk-ant-...` |
| WandB account | `wandb login` |

## Installation

```bash
git clone <repo-url> prj-amd
cd prj-amd
pip install -r requirements.txt
```

## Usage

### Run enhanced sampling MD

```bash
# Metadynamics with defaults
python main.py

# Switch to umbrella sampling
python main.py method=umbrella

# Steered MD at higher temperature
python main.py method=steered gromacs.temperature=320

# Multirun sweep over HILLS height
python main.py --multirun method.hills.height=0.5,1.0,2.0,4.0
```

### Reproduce a paper

```bash
# From ArXiv ID
python main.py mode=reproduce_paper paper.arxiv_id=2301.12345

# From keyword search
python main.py mode=reproduce_paper "paper.query=alanine dipeptide metadynamics"

# From local PDF
python main.py mode=reproduce_paper paper.pdf_path=/path/to/paper.pdf
```

### Interactive mode

```bash
python main.py mode=interactive
```

## Configuration

All parameters are set in `conf/`. Key files:

| File | Controls |
|---|---|
| `conf/config.yaml` | Mode, work dir, paper options |
| `conf/method/metadynamics.yaml` | HILLS height/sigma/pace, biasfactor |
| `conf/method/umbrella.yaml` | Window spacing, force constant, WHAM |
| `conf/method/steered.yaml` | Pull rate, spring constant |
| `conf/gromacs/default.yaml` | All GROMACS MDP parameters |
| `conf/plumed/collective_variables.yaml` | CV definitions (atoms, type) |
| `conf/wandb/default.yaml` | WandB project, logging interval |
| `conf/system/protein.yaml` | Force field, water model, topology paths |

Override any parameter on the command line:

```bash
python main.py gromacs.temperature=310 method.hills.height=0.8 wandb.project=my_project
```

## Project Structure

```
prj-amd/
├── conf/               # Hydra config files
├── md_agent/
│   ├── agent.py        # Claude Opus 4.6 agentic loop (25 tools)
│   ├── tools/
│   │   ├── gromacs_tools.py   # GROMACSRunner (grompp, mdrun, analysis)
│   │   ├── plumed_tools.py    # PlumedGenerator (Jinja2 templates)
│   │   ├── wandb_tools.py     # MDMonitor background thread
│   │   └── paper_tools.py     # PaperRetriever + MDSettingsExtractor
│   ├── config/
│   │   ├── hydra_utils.py     # MDP generation, config merging
│   │   └── schemas.py         # Pydantic validation schemas
│   └── utils/
│       ├── parsers.py          # EDR/COLVAR/HILLS parsers, unit conversion
│       └── file_utils.py       # File read/list helpers
├── templates/plumed/   # Jinja2 templates for PLUMED input files
├── tests/              # pytest test suite
├── main.py             # Hydra entry point
└── requirements.txt
```

## Running Tests

```bash
pytest tests/ -v
```

## Key Design Notes

- **mdrun is non-blocking** — `subprocess.Popen` returns immediately so the WandB monitor can start
- **PLUMED atom indices are 1-based** — the agent system prompt enforces this
- **Paper extraction always requires confirmation** — never auto-runs multi-hour simulations
- **Adaptive thinking** — Claude Opus 4.6 uses `thinking: {type: "adaptive"}` for complex reasoning

## License

MIT
