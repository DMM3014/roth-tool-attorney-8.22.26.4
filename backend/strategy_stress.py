"""Monte Carlo stress test for Strategy Optimizer candidates.

Runs the top deterministic-sweep strategies + the no-conversion baseline against ONE
shared set of random market paths (paired trials): outcome differences are purely
strategic, never luck. Inflation stays at the plan's deterministic assumption so the
comparison isolates sequence-of-returns risk — exactly the risk borne by strategies
that prepay conversion tax early (the tax bill is locked in even when early returns
disappoint).

Two lenses per strategy:
- liquid wealth: ending liquid portfolio percentiles + success (never depletes)
- after-tax legacy (approx): MC ending wealth mapped through a linear transform
  legacy(W) = floor + slope * W, where floor = legacy with zero liquid assets
  (real estate only) and slope is calibrated so legacy(det_ending_liquid) equals
  the strategy's deterministic after-tax legacy. Assumes the MC ending account mix
  (Roth/IRA/taxable shares) matches the deterministic mix.
"""

import copy
import numpy as np

from projection import run_projection, _compute_legacy
from montecarlo import (DEFAULT_ASSETS, EARLY_YEARS, _anchor_assets, _flows_split,
                        _historical_factors, _liquid_start, _plan_return,
                        _portfolio_factors, _simulate)

MAX_STRESS_STRATEGIES = 12
MAX_SEGMENT_YEARS = 120
ENDING_PCTS = (5, 10, 25, 50, 75, 90)


def _strategy_cfg(cfg, spec):
    c = copy.deepcopy(cfg)
    roth = c.setdefault("roth", {})
    kind = spec.get("kind", "single")
    if kind == "baseline":
        roth["enabled"] = False
        roth.pop("year_targets", None)
        return c
    if kind == "phased":
        segs = spec.get("segments") or []
        if not segs:
            raise ValueError("phased strategy requires segments")
        # defense-in-depth vs OOM: never build a per-year dict beyond a sane span
        total = 0
        for seg in segs:
            span = int(seg["stop_year"]) - int(seg["start_year"]) + 1
            if span < 1 or span > MAX_SEGMENT_YEARS:
                raise ValueError("segment year span out of range")
            total += span
        if total > MAX_SEGMENT_YEARS:
            raise ValueError("phased segments span too many years")
        roth["enabled"] = True
        roth["start_year"] = int(segs[0]["start_year"])
        roth["end_year"] = int(segs[-1]["stop_year"])
        yt = {}
        for seg in segs:
            for y in range(int(seg["start_year"]), int(seg["stop_year"]) + 1):
                yt[y] = float(seg["bracket"])
        roth["year_targets"] = yt
        return c
    if spec.get("start_year") is None or spec.get("stop_year") is None or spec.get("bracket") is None:
        raise ValueError("single strategy requires start_year, stop_year and bracket")
    roth["enabled"] = True
    roth["start_year"] = int(spec["start_year"])
    roth["end_year"] = int(spec["stop_year"])
    roth["target_bracket"] = float(spec["bracket"])
    roth.pop("year_targets", None)
    return c


def _legacy_map(c, res):
    """Calibrate the linear after-tax-legacy transform legacy(W) ≈ floor + slope*W."""
    final = res["rows"][-1]
    liquid = final["cash"] + final["taxable"] + final["traditional"] + final["roth"]
    legacy_det = res["legacy"]["after_tax_estate_to_heirs"]
    final0 = {**final, "cash": 0.0, "taxable": 0.0, "traditional": 0.0, "roth": 0.0,
              "net_worth": final["net_worth"] - liquid}
    floor = _compute_legacy(c, final0, accounts=c["accounts"])["after_tax_estate_to_heirs"]
    slope = (legacy_det - floor) / liquid if liquid > 1.0 else 0.0
    return float(floor), float(slope), float(liquid), float(legacy_det)


def stress_test_strategies(cfg, strategies, n_trials=1000, engine="historical", seed=None):
    """Stress-test candidate strategies + baseline against a shared random-market matrix.

    strategies: list of {label, kind: single|phased, start_year, stop_year, bracket, segments?}.
    The no-conversion baseline is always prepended. Returns per-strategy MC summaries
    (both liquid-wealth and approximate after-tax-legacy lenses), the worst-5%-early-
    sequence cohort outcomes, and a robust (P10-legacy) re-ranking vs the deterministic one.
    """
    if engine not in ("lognormal", "historical"):
        raise ValueError("engine must be 'lognormal' or 'historical'")
    specs = [{"label": "No conversions", "kind": "baseline"}]
    specs += [s for s in strategies[:MAX_STRESS_STRATEGIES] if s.get("kind") != "baseline"]
    n = int(max(50, min(n_trials, 2000)))

    runs = []
    for spec in specs:
        c = _strategy_cfg(cfg, spec)
        res = run_projection(c)
        floor, slope, liq_det, legacy_det = _legacy_map(c, res)
        runs.append({"spec": spec, "rows": res["rows"], "floor": floor, "slope": slope,
                     "liquid_det": liq_det, "legacy_det": legacy_det})

    T = min(len(r["rows"]) for r in runs)
    years = [row["year"] for row in runs[0]["rows"][:T]]
    liquid0 = _liquid_start(cfg)
    plan_ret = _plan_return(cfg)
    rng = np.random.default_rng(seed)

    anchor = {"enabled": plan_ret is not None, "mode": "flat_plan_return",
              "plan_return": round(plan_ret, 4) if plan_ret is not None else None}
    hist_info = None
    if engine == "historical":
        g, _gc, _infl, _w, geom, hist_info = _historical_factors(DEFAULT_ASSETS, n, T, rng)
        if plan_ret is not None:
            g = g * ((1.0 + plan_ret) / geom)
    else:
        assets = DEFAULT_ASSETS
        if plan_ret is not None:
            assets, _info = _anchor_assets(DEFAULT_ASSETS, plan_ret)
        g, _gc, _w, _pm, _pv = _portfolio_factors(assets, n, T, rng)
    infl_mult = np.ones((n, T), dtype=float)

    # worst-5%-early-returns cohort — SAME trials for every strategy (paired comparison)
    K = min(EARLY_YEARS, T)
    early = np.prod(g[:, :K], axis=1)
    cohort = early <= np.percentile(early, 5)

    out_strats = []
    for r in runs:
        ext, exp, tax = _flows_split(r["rows"][:T])
        paths, dep, *_ = _simulate(liquid0, ext, exp, tax, g, infl_mult)
        ending = paths[:, -1]
        pct = {f"p{p}": round(float(np.percentile(ending, p)), 0) for p in ENDING_PCTS}
        legacy_pct = {k: round(r["floor"] + r["slope"] * pct[k], 0) for k in ("p10", "p50", "p90")}
        med_end_cohort = float(np.median(ending[cohort])) if cohort.any() else None
        spec = r["spec"]
        out_strats.append({
            "label": spec.get("label") or "Strategy",
            "kind": spec.get("kind", "single"),
            "start_year": spec.get("start_year"),
            "stop_year": spec.get("stop_year"),
            "bracket": spec.get("bracket"),
            "segments": spec.get("segments"),
            "det_after_tax_estate": round(r["legacy_det"], 0),
            "det_ending_liquid": round(r["liquid_det"], 0),
            "success": round(float(np.mean(~dep)), 4),
            "depleted_pct": round(float(np.mean(dep)), 4),
            "ending": pct,
            "legacy": {"floor": round(r["floor"], 0), "slope": round(r["slope"], 4), **legacy_pct},
            "seq_cohort": {
                "success": round(float(np.mean(~dep[cohort])), 4) if cohort.any() else None,
                "median_ending": round(med_end_cohort, 0) if med_end_cohort is not None else None,
                "median_legacy": (round(r["floor"] + r["slope"] * med_end_cohort, 0)
                                  if med_end_cohort is not None else None),
            },
            "paths": {
                "p10": [round(float(v), 0) for v in np.percentile(paths, 10, axis=0)],
                "p50": [round(float(v), 0) for v in np.percentile(paths, 50, axis=0)],
            },
        })

    robust = sorted(out_strats, key=lambda s: -s["legacy"]["p10"])
    for i, s in enumerate(robust):
        s["robust_rank"] = i + 1
    det_best = max(out_strats, key=lambda s: s["det_after_tax_estate"])
    return {
        "n_trials": n,
        "engine": engine,
        "years": years,
        "plan_return": anchor["plan_return"],
        "anchor": anchor,
        "historical": hist_info,
        "liquid_start": round(liquid0, 0),
        "cohort": {"early_years": K, "worst_pct": 5},
        "strategies": out_strats,
        "deterministic_best_label": det_best["label"],
        "robust_best_label": robust[0]["label"],
        "robust_differs": robust[0]["label"] != det_best["label"],
        "method_notes": {
            "paired_trials": True,
            "inflation": "deterministic (plan assumption) — isolates return-sequence risk",
            "legacy_lens": "linear approximation legacy(W) = floor + slope*W calibrated to the deterministic ending account mix",
        },
    }
