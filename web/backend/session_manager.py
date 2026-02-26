"""Session management: one MDAgent per browser session."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from importlib.util import find_spec
from pathlib import Path


def _repo_conf_dir() -> str:
    """Return the conf/ directory, whether running from the repo or installed."""
    spec = find_spec("md_agent")
    if spec and spec.origin:
        pkg_dir = Path(spec.origin).parent
    else:
        raise RuntimeError("md_agent package not found")

    for candidate in [
        Path(__file__).parents[2] / "conf",  # repo root/conf
        pkg_dir.parents[1] / "share" / "amd-agent" / "conf",  # installed
    ]:
        if candidate.is_dir():
            return str(candidate)

    raise FileNotFoundError("Cannot locate conf/ directory")


def _load_hydra_cfg(overrides: list[str], work_dir: str):
    from hydra import compose, initialize_config_dir
    from hydra.core.global_hydra import GlobalHydra

    conf_dir = _repo_conf_dir()
    GlobalHydra.instance().clear()
    with initialize_config_dir(config_dir=conf_dir, job_name="amd-web"):
        cfg = compose(
            config_name="config",
            overrides=overrides + [f"run.work_dir={work_dir}"],
        )
    return cfg


@dataclass
class Session:
    session_id: str
    work_dir: str
    nickname: str = ""
    username: str = ""
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    sim_status: dict = field(default_factory=dict)
    # agent is set after __init__ to allow dataclass + post-init pattern
    agent: object = field(default=None, init=False)


_sessions: dict[str, Session] = {}


def create_session(
    work_dir: str,
    nickname: str = "",
    username: str = "",
    method: str = "metadynamics",
    system: str = "protein",
    gromacs: str = "default",
    plumed_cvs: str = "default",
    extra_overrides: list[str] | None = None,
) -> Session:
    from md_agent.agent import MDAgent

    overrides = [
        f"method={method}",
        f"system={system}",
        f"gromacs={gromacs}",
        f"plumed/collective_variables={plumed_cvs}",
        *(extra_overrides or []),
    ]
    cfg = _load_hydra_cfg(overrides, work_dir)

    sid = str(uuid.uuid4())
    session = Session(session_id=sid, work_dir=work_dir, nickname=nickname, username=username)
    session.agent = MDAgent(cfg=cfg, work_dir=work_dir)
    _sessions[sid] = session
    return session


def get_session(session_id: str) -> Session | None:
    return _sessions.get(session_id)


def list_sessions(username: str = "") -> list[dict]:
    sessions = _sessions.values()
    if username:
        sessions = [s for s in sessions if s.username == username]
    return [
        {"session_id": s.session_id, "work_dir": s.work_dir, "nickname": s.nickname}
        for s in sessions
    ]


def delete_session(session_id: str) -> bool:
    return _sessions.pop(session_id, None) is not None
