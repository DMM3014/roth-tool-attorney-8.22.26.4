"""Pydantic request/response models extracted from server.py.

Every route module imports from here. Field validators reference `UUID_RE`,
`MAX_MC_TRIALS`, and `MAX_PROJECTION_YEARS` from `deps.py` so the size caps stay
in one place. `datetime.now(timezone.utc).isoformat()` is used as the default
factory for created_at/updated_at timestamps — matches the source-of-truth
convention in the projection engine.
"""
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from deps import MAX_MC_TRIALS, MAX_PROJECTION_YEARS, UUID_RE


# ---------- Tax + Projection request shapes ----------
class YearTaxRequest(BaseModel):
    inputs: Dict[str, Any]


class OptimizeRequest(BaseModel):
    inputs: Dict[str, Any]
    target_rate: float = Field(default=0.24, ge=0.0, le=1.0, allow_inf_nan=False)
    max_conversion: float = Field(default=0.0, ge=0.0, le=1e9, allow_inf_nan=False)
    irmaa_aware: bool = Field(default=False)
    irmaa_cliff_buffer: float = Field(default=3000.0, ge=0.0, le=50000.0, allow_inf_nan=False)


class ProjectionRequest(BaseModel):
    config: Dict[str, Any]


# ---------- Scenarios ----------
class Scenario(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    config: Dict[str, Any]
    owner_token: Optional[str] = None       # UUIDv4 stamp of the browser session that owns this plan
    share_token: Optional[str] = None       # opaque public read-only handle (nullable = not shared)
    workspace_id: Optional[str] = None      # optional named-client-folder membership; null = "Unfiled"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class SharedScenario(BaseModel):
    """Public shape of a scenario served via /api/scenarios/share/{token}.
    Deliberately omits owner_token AND the internal id so a viewer can only see the plan
    payload — never the owner's session token or the primary-key needed to hit the
    session-scoped endpoints."""
    name: str
    config: Dict[str, Any]
    created_at: str


class ScenarioCreate(BaseModel):
    name: str
    config: Dict[str, Any]
    workspace_id: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _name_bounds(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name required")
        if len(v) > 120:
            raise ValueError("name capped at 120 chars")
        return v.strip()

    @field_validator("workspace_id")
    @classmethod
    def _wid_shape(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return None
        if not UUID_RE.match(v):
            raise ValueError("workspace_id must be a valid UUID")
        return v


class ScenarioMove(BaseModel):
    workspace_id: Optional[str] = None

    @field_validator("workspace_id")
    @classmethod
    def _wid_shape(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return None
        if not UUID_RE.match(v):
            raise ValueError("workspace_id must be a valid UUID")
        return v


# ---------- Workspaces ----------
class Workspace(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    notes: Optional[str] = None
    owner_token: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class WorkspaceCreate(BaseModel):
    name: str
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _wname_bounds(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name required")
        if len(v) > 80:
            raise ValueError("name capped at 80 chars")
        return v.strip()

    @field_validator("notes")
    @classmethod
    def _notes_bounds(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if len(v) > 500:
            raise ValueError("notes capped at 500 chars")
        return v or None


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _wname_bounds(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("name cannot be blank")
        if len(v) > 80:
            raise ValueError("name capped at 80 chars")
        return v

    @field_validator("notes")
    @classmethod
    def _notes_bounds(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if len(v) > 500:
            raise ValueError("notes capped at 500 chars")
        return v or None


# ---------- Insights ----------
class InsightRequest(BaseModel):
    summary: Dict[str, Any]
    api_key: Optional[str] = None

    @field_validator("api_key")
    @classmethod
    def _api_key_bounds(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if len(v) > 200:
            raise ValueError("API key too long")
        return v or None


class ChatTurn(BaseModel):
    role: str
    content: str

    @field_validator("content")
    @classmethod
    def _content_bounds(cls, v: str) -> str:
        if len(v) > 4000:
            raise ValueError("chat content capped at 4000 chars per turn")
        return v


class InsightChatRequest(InsightRequest):
    history: List[ChatTurn] = []
    message: str

    @field_validator("history")
    @classmethod
    def _history_bounds(cls, v: List[ChatTurn]) -> List[ChatTurn]:
        if len(v) > 40:
            raise ValueError("chat history capped at 40 turns")
        return v

    @field_validator("message")
    @classmethod
    def _message_bounds(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("message capped at 2000 chars")
        return v


# ---------- Monte Carlo ----------
class AssetClass(BaseModel):
    mean: float = Field(ge=-1.0, le=1.0, allow_inf_nan=False)
    vol: float = Field(ge=0.0, le=2.0, allow_inf_nan=False)
    weight: float = Field(ge=0.0, le=1000.0, allow_inf_nan=False)


class ShockSpec(BaseModel):
    enabled: bool = False
    rate: float = Field(default=-0.15, ge=-1.0, le=1.0, allow_inf_nan=False)
    years: int = Field(default=2, ge=0, le=60)


class RegimeParams(BaseModel):
    """A single inflation regime — annual (1+π) mean and volatility."""
    mean: float = Field(ge=-0.10, le=0.30, allow_inf_nan=False)
    vol: float = Field(default=0.015, ge=0.0, le=0.25, allow_inf_nan=False)


class InflationSpec(BaseModel):
    enabled: bool = True
    mean: float = Field(default=0.03, ge=-0.5, le=1.0, allow_inf_nan=False)
    vol: float = Field(default=0.015, ge=0.0, le=1.0, allow_inf_nan=False)
    # Optional regime-switching Markov mode.  When True, per-year inflation
    # draws come from a 3-state (Low/Normal/High) Markov chain instead of a
    # single-regime lognormal.
    regime_switching: bool = Field(default=False)
    regime_low: RegimeParams = Field(default_factory=lambda: RegimeParams(mean=0.020, vol=0.008))
    regime_normal: RegimeParams = Field(default_factory=lambda: RegimeParams(mean=0.035, vol=0.014))
    regime_high: RegimeParams = Field(default_factory=lambda: RegimeParams(mean=0.060, vol=0.025))
    regime_p_stay: float = Field(default=0.85, ge=0.0, le=1.0, allow_inf_nan=False)


class CorrelationSpec(BaseModel):
    enabled: bool = False
    stocks_bonds: float = Field(default=0.15, ge=-0.99, le=0.99, allow_inf_nan=False)
    stocks_cash: float = Field(default=0.0, ge=-0.99, le=0.99, allow_inf_nan=False)
    bonds_cash: float = Field(default=0.20, ge=-0.99, le=0.99, allow_inf_nan=False)
    stocks_inflation: float = Field(default=-0.20, ge=-0.99, le=0.99, allow_inf_nan=False)
    bonds_inflation: float = Field(default=-0.30, ge=-0.99, le=0.99, allow_inf_nan=False)
    cash_inflation: float = Field(default=0.55, ge=-0.99, le=0.99, allow_inf_nan=False)


class GuardrailSpec(BaseModel):
    enabled: bool = False
    cut_pct: float = Field(default=0.10, ge=0.0, le=0.5, allow_inf_nan=False)


class ConversionHaltSpec(BaseModel):
    """Advisor rule: cease planned Roth conversions in a given trial once that trial's
    prior-year portfolio return drops below (1 - drop_threshold). When
    resume_after_positive_years > 0, a halted trial un-halts after that many consecutive
    positive-return years and may be re-halted by a subsequent qualifying drop. When 0
    (the default), halts are permanent for the remainder of the conversion window."""
    enabled: bool = False
    drop_threshold: float = Field(default=0.10, ge=0.02, le=0.50, allow_inf_nan=False)
    resume_after_positive_years: int = Field(default=0, ge=0, le=20)


class RebalanceSpec(BaseModel):
    """How aggressively the client's advisor rebalances the household portfolio back to
    the target allocation. Only affects Monte Carlo dispersion — the deterministic
    projection is unchanged.
    * annual: reset to target weights every year (default; matches classic MC assumption)
    * biennial: rebalance every 2 years (weights drift 1 year, then snap back)
    * never: weights drift for the whole horizon (dispersion widens noticeably)"""
    cadence: str = Field(default="annual")

    @field_validator("cadence")
    @classmethod
    def _cadence_ok(cls, v):
        if v not in ("annual", "biennial", "never"):
            raise ValueError("cadence must be 'annual', 'biennial', or 'never'")
        return v


class MonteCarloRequest(BaseModel):
    config: Dict[str, Any]
    n_trials: int = 500
    assets: Optional[Dict[str, AssetClass]] = None
    shock: Optional[ShockSpec] = None
    inflation: Optional[InflationSpec] = None
    correlation: Optional[CorrelationSpec] = None
    engine: str = "lognormal"
    anchor_to_plan: bool = True
    guardrail: Optional[GuardrailSpec] = None
    conversion_halt: Optional[ConversionHaltSpec] = None
    rebalance: Optional[RebalanceSpec] = None
    seed: Optional[int] = None

    @field_validator("engine")
    @classmethod
    def _engine_ok(cls, v):
        if v not in ("lognormal", "historical"):
            raise ValueError("engine must be 'lognormal' or 'historical'")
        return v

    @field_validator("n_trials")
    @classmethod
    def _trials_bounds(cls, v):
        if v < 50 or v > MAX_MC_TRIALS:
            raise ValueError(f"n_trials must be in [50, {MAX_MC_TRIALS}]")
        return v


# ---------- Strategy sweep + stress ----------
class StrategySweepRequest(BaseModel):
    config: Dict[str, Any]
    start_years: Optional[List[int]] = None
    stop_years: Optional[List[int]] = None
    brackets: Optional[List[float]] = None
    include_phased: bool = True
    irmaa_cap: Optional[int] = None
    max_annual: float = 0.0
    refine_funding_orders: bool = False
    sweep_funding_orders: bool = False
    horizon_end_year: Optional[int] = Field(None, ge=2026, le=2150)

    @field_validator("start_years", "stop_years")
    @classmethod
    def _year_list_bounds(cls, v):
        if v is None:
            return v
        if len(v) > 40:
            raise ValueError("year list capped at 40 entries")
        return v

    @field_validator("brackets")
    @classmethod
    def _brackets_bounds(cls, v):
        if v is None:
            return v
        if len(v) > 12:
            raise ValueError("brackets list capped at 12 entries")
        if any(not (0.0 <= x <= 0.99) for x in v):
            raise ValueError("bracket values must lie in [0, 0.99]")
        return v


class StressStrategySpec(BaseModel):
    label: str = Field(default="", max_length=160)
    kind: str = "single"
    start_year: Optional[int] = None
    stop_year: Optional[int] = None
    bracket: Optional[float] = Field(default=None, allow_inf_nan=False)
    segments: Optional[List[Dict[str, Any]]] = None

    @field_validator("kind")
    @classmethod
    def _kind_ok(cls, v):
        if v not in ("single", "phased", "baseline"):
            raise ValueError("kind must be single, phased or baseline")
        return v

    @field_validator("start_year", "stop_year")
    @classmethod
    def _years_ok(cls, v):
        if v is not None and not (1900 <= v <= 2200):
            raise ValueError("strategy years must lie in [1900, 2200]")
        return v

    @field_validator("bracket")
    @classmethod
    def _bracket_ok(cls, v):
        if v is not None and not (0.0 <= v <= 0.99):
            raise ValueError("bracket must lie in [0, 0.99]")
        return v

    @field_validator("segments")
    @classmethod
    def _segments_ok(cls, v):
        if v is None:
            return v
        if len(v) > 12:
            raise ValueError("segments capped at 12 entries")
        total_years = 0
        for seg in v:
            sy, ey, br = seg.get("start_year"), seg.get("stop_year"), seg.get("bracket")
            if not isinstance(sy, int) or not isinstance(ey, int) or isinstance(sy, bool) or isinstance(ey, bool):
                raise ValueError("segment years must be integers")
            if not (1900 <= sy <= 2200) or not (1900 <= ey <= 2200):
                raise ValueError("segment years must lie in [1900, 2200]")
            if ey < sy:
                raise ValueError("segment stop_year must be >= start_year")
            total_years += ey - sy + 1
            if not isinstance(br, (int, float)) or isinstance(br, bool) \
                    or not math.isfinite(br) or not (0.0 <= br <= 0.99):
                raise ValueError("segment bracket must lie in [0, 0.99]")
        if total_years > MAX_PROJECTION_YEARS + 1:
            raise ValueError(f"phased segments capped at {MAX_PROJECTION_YEARS + 1} total years")
        return v


class StrategyStressRequest(BaseModel):
    config: Dict[str, Any]
    strategies: List[StressStrategySpec]
    n_trials: int = 1000
    engine: str = "historical"
    seed: Optional[int] = None

    @field_validator("engine")
    @classmethod
    def _engine_ok(cls, v):
        if v not in ("lognormal", "historical"):
            raise ValueError("engine must be 'lognormal' or 'historical'")
        return v

    @field_validator("n_trials")
    @classmethod
    def _trials_bounds(cls, v):
        if v < 50 or v > MAX_MC_TRIALS:
            raise ValueError(f"n_trials must be in [50, {MAX_MC_TRIALS}]")
        return v

    @field_validator("strategies")
    @classmethod
    def _strategies_bounds(cls, v):
        if not v:
            raise ValueError("at least one strategy required")
        if len(v) > 12:
            raise ValueError("strategies capped at 12 entries")
        return v


class SsOptimizerRequest(BaseModel):
    config: Dict[str, Any]
    ages: Optional[List[int]] = None

    @field_validator("ages")
    @classmethod
    def _ages_bounds(cls, v):
        from deps import MAX_SS_AGES
        if v is None:
            return v
        if len(v) > MAX_SS_AGES:
            raise ValueError(f"ages list capped at {MAX_SS_AGES} entries")
        if any(not (62 <= x <= 70) for x in v):
            raise ValueError("ages must lie in [62, 70]")
        return v


# ---------- Auth ----------
class PinVerifyRequest(BaseModel):
    # Accepts the legacy 6-digit PIN OR a passphrase (see is_valid_master_secret).
    pin: str = Field(..., max_length=128)


class PinChangeRequest(BaseModel):
    current_pin: str = Field(..., max_length=128)
    new_pin: str = Field(..., max_length=128)


class LicenseLoginRequest(BaseModel):
    email: str = Field(..., max_length=254)
    pin: str = Field(..., max_length=32)


class LicenseCreateRequest(BaseModel):
    email: str = Field(..., max_length=254)
    expires_at: Optional[str] = None


class LicenseRenewRequest(BaseModel):
    expires_at: Optional[str] = None
