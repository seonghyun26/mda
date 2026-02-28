"""Pydantic schemas for validating Hydra configs and extracted paper settings."""

from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


# ── Collective Variable schemas ────────────────────────────────────────

CV_TYPES = {"DISTANCE", "TORSION", "ANGLE", "RMSD", "COORDINATION"}


class CVSchema(BaseModel):
    name: str
    type: str
    atoms: Optional[List[int]] = None
    reference: Optional[str] = None       # for RMSD
    rmsd_type: str = "OPTIMAL"
    groupa: Optional[List[int]] = None    # for COORDINATION
    groupb: Optional[List[int]] = None
    r0: Optional[float] = None

    @field_validator("type")
    @classmethod
    def validate_cv_type(cls, v: str) -> str:
        if v not in CV_TYPES:
            raise ValueError(f"Unknown CV type '{v}'. Expected one of {CV_TYPES}")
        return v

    @model_validator(mode="after")
    def check_required_fields(self) -> "CVSchema":
        if self.type in {"DISTANCE", "TORSION", "ANGLE"} and not self.atoms:
            raise ValueError(f"CV type '{self.type}' requires 'atoms' list")
        if self.type == "RMSD" and not self.reference:
            raise ValueError("RMSD CV requires 'reference' PDB path")
        if self.type == "COORDINATION":
            if not self.groupa or not self.groupb:
                raise ValueError("COORDINATION CV requires 'groupa' and 'groupb'")
        return self


# ── Method schemas ─────────────────────────────────────────────────────

class MetadynamicsSchema(BaseModel):
    _target_name: str = "metadynamics"
    hills_height: float = Field(gt=0, description="Gaussian height in kJ/mol")
    hills_sigma: List[float] = Field(min_length=1)
    hills_pace: int = Field(gt=0)
    biasfactor: Optional[float] = Field(default=None, gt=1)
    temperature: float = Field(gt=0)
    nsteps: int = Field(gt=0)

    @model_validator(mode="after")
    def sigma_count_matches_cvs(self) -> "MetadynamicsSchema":
        # sigma list length is validated against actual CVs in PlumedGenerator
        return self


class UmbrellaSamplingSchema(BaseModel):
    _target_name: str = "umbrella_sampling"
    window_start: float
    window_end: float
    window_spacing: float = Field(gt=0)
    force_constant: float = Field(gt=0)
    nsteps_per_window: int = Field(gt=0)
    equilibration_steps: int = Field(ge=0)


class SteeredMDSchema(BaseModel):
    _target_name: str = "steered_md"
    pull_rate: float = Field(gt=0, description="nm/ps")
    force_constant: float = Field(gt=0, description="kJ/mol/nm^2")
    nsteps: int = Field(gt=0)


# ── GROMACS MDP schema ─────────────────────────────────────────────────

VALID_INTEGRATORS = {"md", "sd", "bd", "l-bfgs", "steep", "cg"}
VALID_TCOUPLE = {"V-rescale", "berendsen", "nose-hoover", "no"}
VALID_PCOUPLE = {"Parrinello-Rahman", "berendsen", "C-rescale", "MTTK", "no"}
VALID_CONSTRAINTS = {"none", "h-bonds", "all-bonds", "h-angles", "all-angles"}


class GromacsSchema(BaseModel):
    integrator: str = "md"
    dt: float = Field(gt=0, le=0.004, description="ps")
    temperature: float = Field(gt=0, description="K")
    pressure: float = Field(gt=0, description="bar")
    nsteps: int = Field(gt=0)
    tcoupl: str = "V-rescale"
    pcoupl: str = "Parrinello-Rahman"
    constraints: str = "h-bonds"
    nstenergy: int = Field(gt=0)
    rlist: float = Field(gt=0, description="nm")
    rcoulomb: float = Field(gt=0, description="nm")
    rvdw: float = Field(gt=0, description="nm")

    @field_validator("integrator")
    @classmethod
    def validate_integrator(cls, v: str) -> str:
        if v not in VALID_INTEGRATORS:
            raise ValueError(f"Unknown integrator '{v}'")
        return v

    @field_validator("tcoupl")
    @classmethod
    def validate_tcoupl(cls, v: str) -> str:
        if v not in VALID_TCOUPLE:
            raise ValueError(f"Unknown thermostat '{v}'")
        return v

    @field_validator("pcoupl")
    @classmethod
    def validate_pcoupl(cls, v: str) -> str:
        if v not in VALID_PCOUPLE:
            raise ValueError(f"Unknown barostat '{v}'")
        return v

    @field_validator("constraints")
    @classmethod
    def validate_constraints(cls, v: str) -> str:
        if v not in VALID_CONSTRAINTS:
            raise ValueError(f"Unknown constraints value '{v}'")
        return v


# ── Extracted paper settings schema ───────────────────────────────────

class ExtractedPaperSettings(BaseModel):
    """Schema for MD settings extracted from a paper by Claude."""

    method: str = Field(description="metadynamics | umbrella | steered | plain")
    gromacs: dict[str, Any] = Field(default_factory=dict)
    plumed: dict[str, Any] = Field(default_factory=dict)
    system: dict[str, Any] = Field(default_factory=dict)
    notes: str = ""
    confidence: str = "medium"   # low | medium | high

    @field_validator("method")
    @classmethod
    def validate_method(cls, v: str) -> str:
        valid = {"metadynamics", "umbrella", "steered", "plain"}
        if v not in valid:
            raise ValueError(f"Unknown method '{v}'. Expected one of {valid}")
        return v


def validate_extracted_settings(raw: dict) -> tuple[bool, list[str]]:
    """Validate raw extracted settings dict. Returns (is_valid, error_messages)."""
    errors: list[str] = []
    try:
        ExtractedPaperSettings(**raw)
    except Exception as exc:
        errors = [str(exc)]
    return len(errors) == 0, errors
