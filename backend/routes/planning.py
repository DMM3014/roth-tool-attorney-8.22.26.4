"""Compute-heavy planning routes: defaults, tax math, projection, sweeps,
strategy analysis, SS optimizer, Monte Carlo, and regime comparison.

Every math-heavy endpoint offloads to a worker thread via `asyncio.to_thread` so
long-running numpy loops never block the event loop.
"""
# NOTE: DO NOT add `from __future__ import annotations` here. Slowapi's
# `@limiter.limit(...)` wraps the endpoint in a function whose signature loses
# access to this module's globals; when annotations are strings (PEP 563)
# FastAPI cannot resolve `req: ProjectionRequest` and mistakes it for a query
# parameter. Concrete annotations are required.
import asyncio
import copy
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from defaults import DEFAULT_SCENARIO
from states import STATES
from state_tax import STATE_TAX_RULES, get_state_metadata
from ep_flowchart import build_ep_flowchart
from estate import (
    project_estate, get_state_estate_metadata, fed_exclusion,
    state_exclusion as est_state_exclusion, STATE_ESTATE_TAX,
)
from deps import (
    MAX_SWEEP_GRID_CELLS, UUID_RE, _bad_request, _reject_non_finite, db, limiter,
    require_advisor, require_advisor_or_share, require_session, validate_config,
    ROOT_DIR, extract_bearer_payload,
)
from models import (
    AssetClass, ConversionHaltSpec, CorrelationSpec, GuardrailSpec, InflationSpec,
    MonteCarloRequest, OptimizeRequest, ProjectionRequest, RebalanceSpec, ShockSpec,
    SsOptimizerRequest, StrategyStressRequest, StrategySweepRequest, YearTaxRequest,
)
from montecarlo import run_montecarlo
from projection import (
    DEFAULT_HEIR_SENS_RATES, DEFAULT_LONGEVITY_DELTAS, funding_order_longevity,
    heir_rate_sensitivity, run_projection, sweep_brackets,
)
from ss_optimizer import sweep_ss_claims
from strategy_optimizer import strategy_sweep
from strategy_stress import stress_test_strategies
from tax_engine import compute_year_tax, optimize_conversion

router = APIRouter(prefix="/api")


# ---------- Custom defaults override (single-tenant tool) ----------
USER_DEFAULTS_PATH = ROOT_DIR / "user_defaults.json"

# Per-advisor defaults collection. Each doc: {_id: "<role>:<sub>", config: {...},
# updated_at: iso}. Lets each licensee (and the master) persist their own preset
# picks without stomping the shared app-wide user_defaults.json. Load order is
# per-advisor doc → global JSON file → hard-coded DEFAULT_SCENARIO.
ADVISOR_DEFAULTS_COLLECTION = "advisor_defaults"


def _load_user_defaults() -> Optional[dict]:
    try:
        if USER_DEFAULTS_PATH.exists():
            with open(USER_DEFAULTS_PATH, "r") as f:
                return json.load(f)
    except Exception:
        logging.exception("failed reading user_defaults.json — falling back to DEFAULT_SCENARIO")
    return None


async def _advisor_id_from_auth(authorization: Optional[str]) -> Optional[str]:
    """Extract a stable per-advisor identity from the bearer token.

    Returns e.g. `master:master` or `licensee:<license_id>`. `None` when the
    caller has no valid bearer token (share-link readers etc.) — those callers
    can never write to per-advisor storage.
    """
    payload = await extract_bearer_payload(authorization)
    if not payload:
        return None
    role = payload.get("role")
    sub = payload.get("sub")
    if not role or not sub:
        return None
    return f"{role}:{sub}"


async def _load_advisor_defaults(advisor_id: str) -> Optional[dict]:
    if not advisor_id:
        return None
    try:
        doc = await db[ADVISOR_DEFAULTS_COLLECTION].find_one({"_id": advisor_id})
        if doc and isinstance(doc.get("config"), dict):
            return doc["config"]
    except Exception:
        logging.exception("failed reading advisor_defaults for %s", advisor_id)
    return None


@router.get("/defaults")
async def get_defaults(
    request: Request,
    _gate: None = Depends(require_advisor_or_share),
):
    # Per-advisor override (Phase 54) → shared app JSON → hard-coded scenario.
    auth_header = request.headers.get("authorization")
    advisor_id = await _advisor_id_from_auth(auth_header)
    if advisor_id:
        per_advisor = await _load_advisor_defaults(advisor_id)
        if per_advisor is not None:
            return per_advisor
    return _load_user_defaults() or DEFAULT_SCENARIO


@router.post("/defaults/save")
@limiter.limit("10/minute")
async def save_defaults(request: Request, req: ProjectionRequest,
                        _owner: str = Depends(require_session),
                        _adv: None = Depends(require_advisor)):
    validate_config(req.config)
    try:
        with open(USER_DEFAULTS_PATH, "w") as f:
            json.dump(req.config, f)
    except Exception:
        logging.exception("failed writing user_defaults.json")
        raise HTTPException(status_code=500, detail="Could not save defaults")
    return {"saved": True}


@router.delete("/defaults/save")
@limiter.limit("10/minute")
async def revert_defaults(request: Request, _owner: str = Depends(require_session),
                          _adv: None = Depends(require_advisor)):
    try:
        if USER_DEFAULTS_PATH.exists():
            USER_DEFAULTS_PATH.unlink()
    except Exception:
        logging.exception("failed removing user_defaults.json")
        raise HTTPException(status_code=500, detail="Could not revert defaults")
    return {"reverted": True}


@router.post("/defaults/mine")
@limiter.limit("10/minute")
async def save_my_defaults(request: Request, req: ProjectionRequest,
                           _owner: str = Depends(require_session),
                           _adv: None = Depends(require_advisor)):
    """Persist the caller's own defaults (scoped to their license / the master
    seat). Overrides the shared user_defaults.json for THIS advisor only —
    other licensees are untouched."""
    validate_config(req.config)
    advisor_id = await _advisor_id_from_auth(request.headers.get("authorization"))
    if not advisor_id:
        raise HTTPException(status_code=401, detail="Advisor identity required")
    try:
        await db[ADVISOR_DEFAULTS_COLLECTION].update_one(
            {"_id": advisor_id},
            {"$set": {"config": req.config, "updated_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    except Exception:
        logging.exception("failed persisting advisor_defaults for %s", advisor_id)
        raise HTTPException(status_code=500, detail="Could not save your defaults")
    return {"saved": True, "advisor_id": advisor_id}


@router.delete("/defaults/mine")
@limiter.limit("10/minute")
async def clear_my_defaults(request: Request, _owner: str = Depends(require_session),
                            _adv: None = Depends(require_advisor)):
    advisor_id = await _advisor_id_from_auth(request.headers.get("authorization"))
    if not advisor_id:
        raise HTTPException(status_code=401, detail="Advisor identity required")
    try:
        await db[ADVISOR_DEFAULTS_COLLECTION].delete_one({"_id": advisor_id})
    except Exception:
        logging.exception("failed clearing advisor_defaults for %s", advisor_id)
        raise HTTPException(status_code=500, detail="Could not revert your defaults")
    return {"reverted": True, "advisor_id": advisor_id}


@router.get("/states")
async def get_states(_gate: None = Depends(require_advisor_or_share)):
    # Enrich each state row with the richer state-tax metadata (progressive vs flat,
    # retirement exclusions, age gates) so the UI can render the exclusion detail
    # without a second call.
    enriched = []
    for s in STATES:
        meta = get_state_metadata(s["code"])
        enriched.append({**s, "tax_meta": meta})
    return enriched


@router.get("/market-scenarios")
async def get_market_scenarios(_gate: None = Depends(require_advisor_or_share)):
    """List of named market-scenario presets — feeds the Market Scenario dropdown."""
    from market_scenarios import list_presets, DEFAULT_ID
    return {"presets": list_presets(), "default_id": DEFAULT_ID}


# ---------- Tax + projection ----------
@router.post("/tax/year")
@limiter.limit("60/minute")
async def tax_year(request: Request, req: YearTaxRequest, _gate: None = Depends(require_advisor_or_share)):
    _reject_non_finite(req.inputs)
    return compute_year_tax(req.inputs)


@router.post("/tax/optimize")
@limiter.limit("60/minute")
async def tax_optimize(request: Request, req: OptimizeRequest, _gate: None = Depends(require_advisor_or_share)):
    _reject_non_finite(req.inputs)
    return optimize_conversion(req.inputs, req.target_rate, req.max_conversion,
                               irmaa_aware=req.irmaa_aware,
                               irmaa_cliff_buffer=req.irmaa_cliff_buffer)


@router.post("/projection")
@limiter.limit("30/minute")
async def projection(request: Request, req: ProjectionRequest, _gate: None = Depends(require_advisor_or_share)):
    validate_config(req.config)
    try:
        return await asyncio.to_thread(run_projection, req.config)
    except Exception:
        logging.exception("projection failed")
        raise HTTPException(status_code=400, detail="Projection request could not be processed")


class SequenceStressRequest(ProjectionRequest):
    """POST /api/planning/sequence-stress — the same plan under early-bear,
    late-bear and volatile return SEQUENCES instead of one flat rate."""
    params: Dict[str, float] = Field(default_factory=dict)

    @field_validator("params")
    @classmethod
    def _clamp_params(cls, v):
        v = dict(v or {})
        out = {}
        if "bear_return" in v:
            out["bear_return"] = max(-0.9, min(0.0, float(v["bear_return"])))
        if "early_years" in v:
            out["early_years"] = int(max(1, min(20, float(v["early_years"]))))
        if "late_years" in v:
            out["late_years"] = int(max(1, min(20, float(v["late_years"]))))
        if "vol_min" in v:
            out["vol_min"] = max(-0.9, min(0.0, float(v["vol_min"])))
        if "vol_max" in v:
            out["vol_max"] = max(0.0, min(1.0, float(v["vol_max"])))
        if "seed" in v:
            out["seed"] = int(v["seed"])
        return out


@router.post("/sequence-stress")
@limiter.limit("10/minute")
async def sequence_stress(request: Request, req: SequenceStressRequest,
                          _gate: None = Depends(require_advisor_or_share)):
    """Sequence-of-returns stress test — 8 return paths x (with / without
    conversions), reporting lifetime tax saved, ending portfolio and heirs."""
    validate_config(req.config)
    try:
        from sequence_stress import run_sequence_stress
        return await asyncio.to_thread(run_sequence_stress, req.config, req.params)
    except Exception:
        logging.exception("sequence stress failed")
        raise HTTPException(status_code=400, detail="Sequence stress test could not be processed")



class HeirRateSensitivityRequest(ProjectionRequest):
    """POST /api/legacy/heir-rate-sensitivity — after-tax inheritance across a
    low / middle / high beneficiary ordinary marginal rate band."""
    heir_rates: List[float] = Field(default_factory=lambda: list(DEFAULT_HEIR_SENS_RATES))

    @field_validator("heir_rates")
    @classmethod
    def _clamp_heir_rates(cls, v):
        v = sorted({round(max(0.0, min(0.6, float(x))), 4) for x in (v or [])})[:5]
        return v or list(DEFAULT_HEIR_SENS_RATES)


@router.post("/legacy/heir-rate-sensitivity")
@limiter.limit("20/minute")
async def legacy_heir_rate_sensitivity(request: Request, req: HeirRateSensitivityRequest,
                                       _gate: None = Depends(require_advisor_or_share)):
    """Re-prices ONLY the heirs' SECURE-10 horizon at each candidate beneficiary
    rate — the parents' projection is identical across the band."""
    validate_config(req.config)
    try:
        return await asyncio.to_thread(heir_rate_sensitivity, req.config, req.heir_rates)
    except Exception:
        logging.exception("heir rate sensitivity failed")
        raise HTTPException(status_code=400, detail="Heir-rate sensitivity could not be processed")


class LongevityFundingRequest(ProjectionRequest):
    """POST /api/longevity/funding-order — funding-order trade-off as the
    surviving spouse lives 5 / 10 / 20 more years."""
    extra_years: List[int] = Field(default_factory=lambda: list(DEFAULT_LONGEVITY_DELTAS))

    @field_validator("extra_years")
    @classmethod
    def _clamp_years(cls, v):
        v = sorted({int(max(-15, min(30, int(x)))) for x in (v or [])})[:8]
        return v or list(DEFAULT_LONGEVITY_DELTAS)


@router.post("/longevity/funding-order")
@limiter.limit("10/minute")
async def longevity_funding_order(request: Request, req: LongevityFundingRequest,
                                  _gate: None = Depends(require_advisor_or_share)):
    """Same conversion strategy, three funding orders, several survivor lifespans."""
    validate_config(req.config)
    try:
        return await asyncio.to_thread(funding_order_longevity, req.config, req.extra_years)
    except Exception:
        logging.exception("funding order longevity failed")
        raise HTTPException(status_code=400, detail="Longevity comparison could not be processed")


@router.post("/sweep")
@limiter.limit("15/minute")
async def sweep(request: Request, req: ProjectionRequest, _gate: None = Depends(require_advisor_or_share)):
    validate_config(req.config)
    try:
        return await asyncio.to_thread(sweep_brackets, req.config)
    except Exception:
        logging.exception("sweep failed")
        raise HTTPException(status_code=400, detail="Bracket sweep request could not be processed")


@router.post("/strategy-sweep")
@limiter.limit("10/minute")
async def strategy_sweep_endpoint(request: Request, req: StrategySweepRequest,
                                  _gate: None = Depends(require_advisor_or_share)):
    validate_config(req.config)
    # Cap grid — funding-order sweep triples cell count so tighten multiplier.
    if req.start_years and req.stop_years and req.brackets:
        cells = len(req.start_years) * len(req.stop_years) * len(req.brackets)
        multiplier = 3 if req.sweep_funding_orders else 1
        effective = cells * multiplier
        if effective > MAX_SWEEP_GRID_CELLS:
            _bad_request(
                f"sweep grid capped at {MAX_SWEEP_GRID_CELLS} cells "
                f"(got {cells}{'×3 funding orders' if multiplier > 1 else ''} = {effective})"
            )
    try:
        return await asyncio.to_thread(
            strategy_sweep,
            req.config,
            start_years=req.start_years, stop_years=req.stop_years,
            brackets=req.brackets, include_phased=req.include_phased,
            irmaa_cap=req.irmaa_cap, max_annual=req.max_annual,
            refine_funding_orders=req.refine_funding_orders,
            sweep_funding_orders=req.sweep_funding_orders,
            horizon_end_year=req.horizon_end_year,
        )
    except Exception:
        logging.exception("strategy_sweep failed")
        raise HTTPException(status_code=400, detail="Strategy sweep request could not be processed")


@router.post("/strategy-stress")
@limiter.limit("10/minute")
async def strategy_stress_endpoint(request: Request, req: StrategyStressRequest,
                                   owner_token: str = Depends(require_session),
                                   _gate: None = Depends(require_advisor_or_share)):
    validate_config(req.config)
    try:
        return await asyncio.to_thread(
            stress_test_strategies, req.config,
            [s.model_dump() for s in req.strategies],
            n_trials=req.n_trials, engine=req.engine, seed=req.seed,
        )
    except ValueError as e:
        _bad_request(str(e))
    except Exception:
        logging.exception("strategy_stress failed")
        raise HTTPException(status_code=400, detail="Strategy stress test request could not be processed")


@router.post("/ss-optimizer")
@limiter.limit("15/minute")
async def ss_optimizer_endpoint(request: Request, req: SsOptimizerRequest,
                                _gate: None = Depends(require_advisor_or_share)):
    validate_config(req.config)
    try:
        return await asyncio.to_thread(sweep_ss_claims, req.config, req.ages)
    except Exception:
        logging.exception("ss_optimizer failed")
        raise HTTPException(status_code=400, detail="Social Security optimizer request could not be processed")


# ---------- Monte Carlo ----------
@router.post("/montecarlo")
@limiter.limit("30/minute")
async def start_montecarlo(request: Request, req: MonteCarloRequest,
                           owner_token: str = Depends(require_session),
                           _gate: None = Depends(require_advisor_or_share)):
    validate_config(req.config)
    job_id = str(uuid.uuid4())
    await db.mc_jobs.insert_one({
        "job_id": job_id, "owner_token": owner_token,
        "status": "running", "result": None, "error": None,
        "created_at": datetime.now(timezone.utc),
    })

    assets = {k: v.model_dump() for k, v in req.assets.items()} if req.assets else None
    shock = req.shock.model_dump() if req.shock else None
    inflation = req.inflation.model_dump() if req.inflation else None
    correlation = req.correlation.model_dump() if req.correlation else None
    guardrail = req.guardrail.model_dump() if req.guardrail else None
    conversion_halt = req.conversion_halt.model_dump() if req.conversion_halt else None
    rebalance = req.rebalance.model_dump() if req.rebalance else None

    async def worker():
        try:
            res = await asyncio.to_thread(run_montecarlo, req.config, req.n_trials, assets, shock,
                                          req.seed, inflation, correlation,
                                          req.engine, req.anchor_to_plan, guardrail,
                                          conversion_halt, rebalance)
            await db.mc_jobs.update_one({"job_id": job_id}, {"$set": {"status": "done", "result": res}})
        except Exception:
            logging.exception("montecarlo failed")
            await db.mc_jobs.update_one({"job_id": job_id}, {"$set": {"status": "error", "error": "Simulation failed"}})

    asyncio.create_task(worker())
    return {"job_id": job_id, "status": "running"}


@router.get("/montecarlo/{job_id}")
async def montecarlo_status(job_id: str, owner_token: str = Depends(require_session),
                            _gate: None = Depends(require_advisor_or_share)):
    if not UUID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    job = await db.mc_jobs.find_one(
        {"job_id": job_id, "owner_token": owner_token},
        {"_id": 0, "created_at": 0, "owner_token": 0},
    )
    if not job:
        raise HTTPException(status_code=404, detail="Monte Carlo job not found")
    return job


# ---------- Regime comparison ----------
# Kept inline because the request model is used only here.
class RegimeCompareRequest(BaseModel):
    """Same shape as MonteCarloRequest, plus an optional preset_ids list. Runs
    the same Monte Carlo simulation N times (once per preset) and returns a
    compact per-regime result table so advisors see success-rate sensitivity."""
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
    # When True, each preset is ALSO run with guardrail and halt disabled so the
    # response includes a paired "no-behavior" row per regime. Lets advisors see
    # how much resilience comes from the plan itself vs. the behavioral rules.
    include_no_behavior_pair: bool = False
    seed: Optional[int] = 42  # default deterministic so paired regimes are comparable
    preset_ids: Optional[List[str]] = None

    @field_validator("engine")
    @classmethod
    def _engine_ok(cls, v):
        if v not in ("lognormal", "historical"):
            raise ValueError("engine must be 'lognormal' or 'historical'")
        return v

    @field_validator("n_trials")
    @classmethod
    def _trials_bounds(cls, v):
        # Tighter than single-regime MC — batch runs 6× the work.
        if v < 50 or v > 1000:
            raise ValueError("n_trials must be in [50, 1000] for regime comparison")
        return v

    @field_validator("preset_ids")
    @classmethod
    def _preset_ids_bounds(cls, v):
        if v is None:
            return v
        if len(v) > 6:
            raise ValueError("preset_ids capped at 6 entries")
        return v


@router.post("/montecarlo/regime-compare")
@limiter.limit("6/minute")
async def montecarlo_regime_compare(
    request: Request, req: RegimeCompareRequest,
    owner_token: str = Depends(require_session),
    _gate: None = Depends(require_advisor_or_share),
):
    """Run one Monte Carlo simulation per market-scenario preset. Returns a
    compact table (success rate, P10/P50/P90 legacy, depleted %) — NOT the full
    per-year percentile paths — so a 6-regime comparison stays under a second
    of network payload."""
    from market_scenarios import PRESETS
    validate_config(req.config)

    preset_ids = req.preset_ids
    if not preset_ids:
        preset_ids = [pid for pid in PRESETS.keys() if pid != "custom"]
    else:
        seen = set()
        preset_ids = [p for p in preset_ids if not (p in seen or seen.add(p))]

    assets = {k: v.model_dump() for k, v in req.assets.items()} if req.assets else None
    shock = req.shock.model_dump() if req.shock else None
    inflation = req.inflation.model_dump() if req.inflation else None
    correlation = req.correlation.model_dump() if req.correlation else None
    guardrail = req.guardrail.model_dump() if req.guardrail else None
    conversion_halt = req.conversion_halt.model_dump() if req.conversion_halt else None
    rebalance = req.rebalance.model_dump() if req.rebalance else None
    behavior_on = bool((guardrail and guardrail.get("enabled"))
                       or (conversion_halt and conversion_halt.get("enabled")))
    pair = bool(req.include_no_behavior_pair and behavior_on)

    def _row_from_res(pid, label, res, variant):
        wc = res.get("with_conversions", {})
        end = wc.get("ending", {})
        return {
            "preset_id": pid,
            "label": label,
            "variant": variant,  # "with_behavior" | "no_behavior" | "single"
            "success": wc.get("success", 0.0),
            "depleted_pct": end.get("depleted_pct", 0.0),
            "p10": end.get("p10", 0),
            "p50": end.get("p50", 0),
            "p90": end.get("p90", 0),
            "mean": end.get("mean", 0),
            "min": end.get("min", 0),
            "portfolio_mean": res.get("portfolio_mean"),
            "portfolio_vol": res.get("portfolio_vol"),
        }

    def _run_all():
        rows = []
        for pid in preset_ids:
            preset = PRESETS.get(pid)
            if not preset:
                continue
            cfg = copy.deepcopy(req.config)
            cfg["market_scenario"] = {"id": pid}
            res_with = run_montecarlo(cfg, req.n_trials, assets, shock, req.seed,
                                      inflation, correlation, req.engine,
                                      req.anchor_to_plan, guardrail, conversion_halt,
                                      rebalance)
            rows.append(_row_from_res(pid, preset["label"], res_with,
                                      "with_behavior" if pair else "single"))
            if pair:
                # Same regime + same seed → paired sample, difference is purely the behavior.
                res_no = run_montecarlo(cfg, req.n_trials, assets, shock, req.seed,
                                        inflation, correlation, req.engine,
                                        req.anchor_to_plan, None, None, rebalance)
                rows.append(_row_from_res(pid, preset["label"], res_no, "no_behavior"))
        return rows

    try:
        rows = await asyncio.to_thread(_run_all)
    except Exception:
        logging.exception("regime-compare failed")
        raise HTTPException(status_code=400, detail="Regime comparison could not be processed")

    baseline_id = (req.config.get("market_scenario") or {}).get("id") or "historical_avg"
    # Order: keep with_behavior sorted by success desc; no_behavior rows follow each regime
    # so the UI can render them as a paired sub-row.
    if pair:
        by_pid = {}
        for r in rows:
            by_pid.setdefault(r["preset_id"], []).append(r)
        # Sort preset groups by their with_behavior success (fallback: first row's success).
        def _group_key(pid_rows):
            head = next((r for r in pid_rows if r["variant"] == "with_behavior"), pid_rows[0])
            return -head["success"]
        rows_sorted = []
        for pid in sorted(by_pid.keys(), key=lambda p: _group_key(by_pid[p])):
            # with_behavior row first, then no_behavior row
            rows_sorted += sorted(by_pid[pid], key=lambda r: 0 if r["variant"] == "with_behavior" else 1)
    else:
        rows_sorted = sorted(rows, key=lambda r: -r["success"])
    return {
        "rows": rows_sorted,
        "baseline_id": baseline_id,
        "n_trials": req.n_trials,
        "engine": req.engine,
        "include_no_behavior_pair": pair,
    }


# --- Estate planning endpoints (Phase 41) -----------------------------------


class EstateAnalyzeRequest(BaseModel):
    """POST /api/estate/analyze — 4-strategy estate comparison with Roth-first trust funding."""
    first_death_year: int = Field(..., ge=2025, le=2200)
    second_death_year: int = Field(..., ge=2025, le=2200)
    # Balances split by account type (Roth-first funding requires this granularity).
    deceased_roth_at_y1: float = Field(..., ge=0.0, le=1e12)
    deceased_taxable_at_y1: float = Field(..., ge=0.0, le=1e12)
    survivor_roth_at_y1: float = Field(..., ge=0.0, le=1e12)
    survivor_taxable_at_y1: float = Field(..., ge=0.0, le=1e12)
    traditional_at_y1: float = Field(0.0, ge=0.0, le=1e12)
    # Growth + tax.
    trust_growth_rate: float = Field(0.06, ge=-0.5, le=0.5)
    survivor_growth_rate: float = Field(0.06, ge=-0.5, le=0.5)
    traditional_growth_rate: Optional[float] = Field(None, ge=-0.5, le=0.5)
    heir_marginal_rate: float = Field(0.3165, ge=0.0, le=0.60)
    taxable_basis_pct: float = Field(0.50, ge=0.0, le=1.0)
    state_code: str = Field("", max_length=2)
    use_portability: bool = True
    gst_funding_order: str = Field("roth_first", pattern="^(roth_first|taxable_first)$",
        description="Funding order for the Layered GST-Exempt strategy's Y1 trust. Roth-first (default) preserves the second §1014 step-up on Taxable; Taxable-first shelters Taxable in the trust and forgoes the second step-up.")
    indexing_rate: Optional[float] = Field(None, ge=0.0, le=0.25,
        description="Model's assumed CPI for federal + state exclusion indexing (config.projection.general_inflation).")
    horizons_after_second_death: List[int] = Field(default_factory=lambda: [0, 10, 20, 30])
    # Second-death per-class balances from the retirement projection. When all
    # three are provided, the engine re-bases the strategies onto the retirement
    # model's actual Y2 balances (reconciles to the EP Projection pages).
    y2_roth: Optional[float] = Field(None, ge=0.0, le=1e12)
    y2_taxable: Optional[float] = Field(None, ge=0.0, le=1e12)
    y2_traditional: Optional[float] = Field(None, ge=0.0, le=1e12)

    @field_validator("horizons_after_second_death")
    @classmethod
    def _clamp_horizons(cls, v):
        v = [max(0, min(100, int(x))) for x in (v or [])]
        return sorted(set(v))[:8] or [0, 10, 20, 30]


@router.get("/estate/state-metadata")
async def get_estate_state_metadata(_gate: None = Depends(require_advisor_or_share)):
    """Return the 12 states + DC that impose an estate tax (dropdown data)."""
    return {
        "states": get_state_estate_metadata(),
        "federal_exclusion_2026": 15_000_000,  # OBBBA base, permanent + inflation-indexed
        "federal_estate_tax_rate": 0.40,
        "notes": (
            "12 states + DC impose an estate tax. State exclusion snapshots are 2025 values; "
            "indexed states grow with the model's assumed CPI. Federal exclusion is $15M/2026 "
            "under OBBBA (permanent, inflation-indexed) and is portable via DSUE (Form 706 election). "
            "Non-federal exclusions are typically NOT portable except in HI and MD."
        ),
    }


@router.post("/estate/analyze")
@limiter.limit("60/minute")
async def estate_analyze(request: Request, req: EstateAnalyzeRequest,
                        _gate: None = Depends(require_advisor_or_share)):
    """4-strategy estate comparison: portability vs. bypass vs. QTIP+bypass vs. layered GST.

    Returns per-strategy net-to-heirs at Y2 + post-death horizons, plus a `winner`
    field identifying the highest net-to-heirs structure.
    """
    code = (req.state_code or "").upper()
    if code and code not in STATE_ESTATE_TAX:
        code = ""
    result = await asyncio.to_thread(
        project_estate,
        first_death_year=req.first_death_year,
        second_death_year=req.second_death_year,
        deceased_roth_at_y1=req.deceased_roth_at_y1,
        deceased_taxable_at_y1=req.deceased_taxable_at_y1,
        survivor_roth_at_y1=req.survivor_roth_at_y1,
        survivor_taxable_at_y1=req.survivor_taxable_at_y1,
        traditional_at_y1=req.traditional_at_y1,
        trust_growth_rate=req.trust_growth_rate,
        survivor_growth_rate=req.survivor_growth_rate,
        traditional_growth_rate=req.traditional_growth_rate,
        heir_marginal_rate=req.heir_marginal_rate,
        taxable_basis_pct=req.taxable_basis_pct,
        state_code=code,
        use_portability=req.use_portability,
        gst_funding_order=req.gst_funding_order,
        indexing_rate=req.indexing_rate,
        horizons_after_second_death=tuple(req.horizons_after_second_death),
        y2_roth=req.y2_roth,
        y2_taxable=req.y2_taxable,
        y2_traditional=req.y2_traditional,
    )
    return result


class FetSensitivityRequest(EstateAnalyzeRequest):
    """POST /api/estate/fet-sensitivity — FET grid: growth rate × death timing."""
    growth_rates: List[float] = Field(default_factory=lambda: [0.05, 0.07, 0.09])
    death_offsets: List[int] = Field(default_factory=lambda: [-5, 0, 5])

    @field_validator("growth_rates")
    @classmethod
    def _clamp_rates(cls, v):
        v = [max(0.0, min(0.5, float(x))) for x in (v or [])][:5]
        return v or [0.05, 0.07, 0.09]

    @field_validator("death_offsets")
    @classmethod
    def _clamp_offsets(cls, v):
        v = [max(-30, min(30, int(x))) for x in (v or [])][:5]
        return v or [-5, 0, 5]


@router.post("/estate/fet-sensitivity")
@limiter.limit("30/minute")
async def estate_fet_sensitivity(request: Request, req: FetSensitivityRequest,
                                 _gate: None = Depends(require_advisor_or_share)):
    """FET sensitivity grid: each cell re-runs the estate model at a stylized growth
    rate × shifted death timing and pairs the Portability-Only and Layered GST federal
    estate tax. Y2 projection re-basing is intentionally dropped so the growth-rate
    axis actually moves the outcome."""
    code = (req.state_code or "").upper()
    if code and code not in STATE_ESTATE_TAX:
        code = ""

    def _run():
        cells = []
        for off in req.death_offsets:
            fd = max(2026, req.first_death_year + off)
            sd = max(fd, req.second_death_year + off)
            for gr in req.growth_rates:
                res = project_estate(
                    first_death_year=fd,
                    second_death_year=sd,
                    deceased_roth_at_y1=req.deceased_roth_at_y1,
                    deceased_taxable_at_y1=req.deceased_taxable_at_y1,
                    survivor_roth_at_y1=req.survivor_roth_at_y1,
                    survivor_taxable_at_y1=req.survivor_taxable_at_y1,
                    traditional_at_y1=req.traditional_at_y1,
                    trust_growth_rate=gr,
                    survivor_growth_rate=gr,
                    heir_marginal_rate=req.heir_marginal_rate,
                    state_code=code,
                    use_portability=req.use_portability,
                    gst_funding_order=req.gst_funding_order,
                    indexing_rate=req.indexing_rate,
                    horizons_after_second_death=(0,),
                )
                port = res["outcomes"]["portability"]["fed_tax"]
                gst = res["outcomes"]["gst_layered"]["fed_tax"]
                cells.append({
                    "death_offset": off, "growth_rate": gr,
                    "first_death_year": fd, "second_death_year": sd,
                    "portability_fet": port, "gst_fet": gst,
                    "highest": "portability" if port >= gst else "gst_layered",
                })
        return {"cells": cells, "growth_rates": req.growth_rates, "death_offsets": req.death_offsets}

    return await asyncio.to_thread(_run)


class EpFlowchartRequest(BaseModel):
    """POST /api/estate/ep-flowchart — 4-plan EP Projection flowchart (workbook replica)."""
    first_death_year: int = Field(..., ge=2025, le=2200)
    second_death_year: int = Field(..., ge=2025, le=2200)
    client_roth: float = Field(0.0, ge=0.0, le=1e12)
    client_taxable: float = Field(0.0, ge=0.0, le=1e12)
    client_cash_house: float = Field(0.0, ge=0.0, le=1e12)
    client_traditional: float = Field(0.0, ge=0.0, le=1e12)
    survivor_roth: float = Field(0.0, ge=0.0, le=1e12)
    survivor_taxable: float = Field(0.0, ge=0.0, le=1e12)
    survivor_cash_house: float = Field(0.0, ge=0.0, le=1e12)
    survivor_traditional: float = Field(0.0, ge=0.0, le=1e12)
    growth_rate: float = Field(0.06, ge=-0.5, le=0.5)
    cap_gains_rate: float = Field(0.24, ge=0.0, le=0.6)
    heir_income_rate: float = Field(0.3165, ge=0.0, le=0.6)
    indexing_rate: Optional[float] = Field(None, ge=0.0, le=0.25)
    # Per-class household balances at the second death from the retirement
    # projection. When ALL four are provided, the engine scales each class to
    # the full cash-flow/tax model's Y2 balance (page reconciles to projection).
    y2_roth: Optional[float] = Field(None, ge=0.0, le=1e12)
    y2_taxable: Optional[float] = Field(None, ge=0.0, le=1e12)
    y2_cash_house: Optional[float] = Field(None, ge=0.0, le=1e12)
    y2_traditional: Optional[float] = Field(None, ge=0.0, le=1e12)


@router.post("/estate/ep-flowchart")
@limiter.limit("60/minute")
async def estate_ep_flowchart(request: Request, req: EpFlowchartRequest,
                              _gate: None = Depends(require_advisor_or_share)):
    """4-plan EP Projection flowchart: no-trust / taxable-first GST / Roth-only GST /
    second-death-only GST. Repopulates from the loaded scenario's death-year balances."""
    return await asyncio.to_thread(build_ep_flowchart, **req.model_dump())
