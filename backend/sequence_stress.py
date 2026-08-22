"""Sequence-of-returns stress test — does the ORDER of returns change the answer?

The deterministic projection grows every account at one flat rate for the whole
horizon. That hides the single biggest risk in a decumulation plan: a bad decade
at the START, while the portfolio is at its largest and withdrawals (plus
conversion tax) are coming out of it, is far more damaging than the same decade
at the end, even when both paths average exactly the same return.

This module builds year-by-year EQUITY return paths, feeds them to the existing
engine via `cfg["return_path"]` and re-runs the plan twice per path (with the
advisor's conversion schedule and with conversions switched off) so the advisor
can report, per scenario:

  * lifetime tax paid with and without conversions -> tax saved by converting
  * ending portfolio and ending net worth
  * after-tax dollars reaching the heirs
  * whether the liquid portfolio ever ran dry

Two variants of every scenario are produced, as requested by the advisor:

  raw            — the bear years take the hit and nothing compensates, so the
                   horizon's average return lands BELOW the plan assumption.
                   This is "a worse market", level and sequence combined.
  mean-preserved — the non-bear years are lifted so the path compounds to
                   exactly the same total as the flat assumption. With no
                   withdrawals it would finish at the identical balance, so any
                   difference that survives IS sequence risk, isolated.

Only the equity sleeve is shocked. Each market-exposed account grows at
`w x equity_return + (1 - w) x its own flat return`, where w is the stocks
weight from the household allocation card, so a −15% equity year is roughly a
−6% year for a 60/40 account rather than a −15% one. Cash and the residence are
untouched.
"""
from __future__ import annotations

import copy
import random

from projection import run_projection

RISKY = ("Taxable", "Tax-Deferred", "Tax-Free")

DEFAULT_PARAMS = {
    "bear_return": -0.15,   # equity return during a bear leg (advisor-editable)
    "early_years": 3,       # length of the early bear leg
    "late_years": 5,        # length of the late bear leg
    "vol_min": -0.15,       # uniform draw floor for the volatility path
    "vol_max": 0.20,        # uniform draw ceiling
    "seed": 20260822,       # fixed so the same plan always tells the same story
}


# --------------------------------------------------------------------------
# plan-derived inputs
# --------------------------------------------------------------------------
def _equity_share(cfg: dict) -> float:
    w = (cfg.get("allocation") or {}).get("stocks")
    return float(w) if isinstance(w, (int, float)) and 0 < float(w) <= 1 else 0.6


def _ref_return(cfg: dict) -> float:
    """The representative market-exposed return the flat projection assumes."""
    accounts = cfg.get("accounts") or []
    for tt in ("Tax-Deferred", "Tax-Free", "Taxable"):
        for a in accounts:
            if a.get("tax_type") == tt and isinstance(a.get("return"), (int, float)):
                return float(a["return"])
    return 0.07


def _conversion_window(cfg: dict, last_conversion_year: int | None = None) -> tuple[int, int]:
    """The window that actually matters: the permitted window clipped to the last
    year the engine really converts (the schedule usually finishes early because
    the Traditional IRA runs out)."""
    roth = cfg.get("roth") or {}
    proj = cfg["projection"]
    start = int(roth.get("start_year") or proj["start_year"])
    end = int(roth.get("end_year") or proj["end_year"])
    if last_conversion_year:
        end = min(end, int(last_conversion_year))
    return start, end


def _blend(w: float, e: float, r: float) -> float:
    return w * e + (1.0 - w) * r


# --------------------------------------------------------------------------
# path construction
# --------------------------------------------------------------------------
def _uplift_for_mean(w: float, r_ref: float, equity: list[float], fixed: list[bool]) -> float:
    """Additive equity uplift on the NON-fixed years that makes the blended path
    compound to (1 + r_ref) ** N — closed form, because a blended year is linear
    in the equity return."""
    n = len(equity)
    n_free = sum(1 for f in fixed if not f)
    if n_free == 0:
        return 0.0
    locked = 1.0
    for e, f in zip(equity, fixed):
        if f:
            locked *= (1.0 + _blend(w, e, r_ref))
    target_total = (1.0 + r_ref) ** n
    if locked <= 0:
        return 0.0
    per_free = (target_total / locked) ** (1.0 / n_free)
    # blended free year = r_ref + w * u  ->  solve for u
    return (per_free - 1.0 - r_ref) / w


def _shift_for_mean(w: float, r_ref: float, equity: list[float]) -> float:
    """Additive shift applied to EVERY equity draw so the blended path compounds
    to the flat assumption. Bisection — keeps the dispersion of the draws intact."""
    n = len(equity)
    target = (1.0 + r_ref) ** n

    def total(u: float) -> float:
        out = 1.0
        for e in equity:
            out *= max(1e-6, 1.0 + _blend(w, e + u, r_ref))
        return out

    lo, hi = -0.5, 0.5
    for _ in range(200):
        mid = (lo + hi) / 2
        if total(mid) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def build_paths(cfg: dict, params: dict | None = None,
                last_conversion_year: int | None = None) -> list[dict]:
    """Every scenario/variant pair, as equity-return paths ready for the engine."""
    p = {**DEFAULT_PARAMS, **(params or {})}
    proj = cfg["projection"]
    start, end = int(proj["start_year"]), int(proj["end_year"])
    n = max(1, end - start + 1)
    w = _equity_share(cfg)
    r_ref = _ref_return(cfg)
    bear = float(p["bear_return"])
    early_n = max(1, min(int(p["early_years"]), n))
    late_n = max(1, min(int(p["late_years"]), n))
    conv_start, conv_end = _conversion_window(cfg, last_conversion_year)

    def legs(bear_idx: set[int]) -> tuple[list[float], list[bool]]:
        eq = [bear if i in bear_idx else r_ref for i in range(n)]
        fixed = [i in bear_idx for i in range(n)]
        return eq, fixed

    specs = []

    # 1. Early bear — the first N years of the projection.
    idx = set(range(0, early_n))
    specs.append(("early_bear", f"Early bear — {early_n} down years at the start", idx))

    # 2. Late bear anchored to the END OF THE PROJECTION.
    idx = set(range(max(0, n - late_n), n))
    specs.append(("late_bear_projection", f"Late bear — final {late_n} years of the projection", idx))

    # 3. Late bear anchored to the END OF THE CONVERSION WINDOW — the crash lands
    #    while conversion tax is still being paid, which is the real hedge test.
    cw_end_i = max(0, min(n - 1, conv_end - start))
    conv_idx = set(range(max(0, cw_end_i - late_n + 1), cw_end_i + 1))
    if conv_idx != specs[-1][2]:      # identical to the projection anchor => one row, not two
        specs.append(("late_bear_conversion",
                      f"Late bear — final {late_n} years of the conversion window "
                      f"({start + min(conv_idx)}–{start + max(conv_idx)})", conv_idx))

    out = []
    for key, label, bear_idx in specs:
        eq, fixed = legs(bear_idx)
        out.append({"key": f"{key}__raw", "scenario": key, "label": label, "variant": "raw",
                    "bear_years": sorted(start + i for i in bear_idx), "equity": list(eq)})
        u = _uplift_for_mean(w, r_ref, eq, fixed)
        eq_mp = [e if f else e + u for e, f in zip(eq, fixed)]
        out.append({"key": f"{key}__mean_preserved", "scenario": key, "label": label,
                    "variant": "mean_preserved",
                    "bear_years": sorted(start + i for i in bear_idx), "equity": eq_mp})

    # 4. Historical-style volatility — seeded uniform draws in the advisor's band.
    rng = random.Random(int(p["seed"]))
    draws = [rng.uniform(float(p["vol_min"]), float(p["vol_max"])) for _ in range(n)]
    out.append({"key": "volatility__raw", "scenario": "volatility",
                "label": f"Volatile markets — annual equity returns drawn between "
                         f"{round(float(p['vol_min']) * 100)}% and {round(float(p['vol_max']) * 100)}%",
                "variant": "raw", "bear_years": [], "equity": list(draws)})
    shift = _shift_for_mean(w, r_ref, draws)
    out.append({"key": "volatility__mean_preserved", "scenario": "volatility",
                "label": f"Volatile markets — same dispersion, re-centred on the plan's "
                         f"{round(r_ref * 100, 1)}% assumption",
                "variant": "mean_preserved", "bear_years": [],
                "equity": [e + shift for e in draws]})

    for path in out:
        path["equity_share"] = w
        path["start_year"] = start
        path["blended_cagr"] = _cagr([_blend(w, e, r_ref) for e in path["equity"]])
        path["equity_cagr"] = _cagr(path["equity"])
    return out


def _cagr(rates: list[float]) -> float:
    total = 1.0
    for r in rates:
        total *= max(1e-6, 1.0 + r)
    return round(total ** (1.0 / len(rates)) - 1.0, 6)


# --------------------------------------------------------------------------
# scenario runs
# --------------------------------------------------------------------------
def _metrics(res: dict) -> dict:
    s = res["summary"]
    rows = res["rows"]
    liquid = [round(r.get("net_worth", 0.0) - r.get("real_estate", 0.0), 2) for r in rows]
    # Worst single year the HOUSEHOLD actually lives through (market move net of
    # that year's spending, tax and conversions) and the first year, if any, the
    # liquid portfolio runs dry.
    worst_pct, worst_year = None, None
    for i in range(1, len(liquid)):
        if liquid[i - 1] <= 0:
            continue
        chg = liquid[i] / liquid[i - 1] - 1.0
        if worst_pct is None or chg < worst_pct:
            worst_pct, worst_year = chg, rows[i]["year"]
    dry_year = next((rows[i]["year"] for i, v in enumerate(liquid) if v <= 0), None)
    return {
        "worst_portfolio_year_pct": None if worst_pct is None else round(worst_pct, 4),
        "worst_portfolio_year": worst_year,
        "depleted_year": dry_year,
        "lifetime_taxes": s["lifetime_taxes"],
        "total_converted": s["total_roth_converted"],
        "ending_net_worth": s["ending_net_worth"],
        "ending_portfolio": round(s["ending_net_worth"] - s.get("ending_real_estate", 0.0), 2),
        "after_tax_to_heirs": (res.get("legacy") or {}).get("after_tax_estate_to_heirs"),
        "min_liquid": min(liquid) if liquid else 0.0,
        "depleted": bool(liquid and min(liquid) <= 0),
    }


def _run_pair(cfg: dict, path: dict | None) -> dict:
    base = copy.deepcopy(cfg)
    if path:
        base["return_path"] = {"start_year": path["start_year"],
                               "equity_share": path["equity_share"],
                               "equity_returns": path["equity"]}
    with_conv = run_projection(copy.deepcopy(base))
    no_cfg = copy.deepcopy(base)
    no_cfg["roth"] = {**(no_cfg.get("roth") or {}), "enabled": False}
    no_conv = run_projection(no_cfg)
    a, b = _metrics(with_conv), _metrics(no_conv)
    return {
        "with_conversions": a,
        "without_conversions": b,
        "tax_saved_by_converting": round(b["lifetime_taxes"] - a["lifetime_taxes"], 2),
        "portfolio_delta": round(a["ending_portfolio"] - b["ending_portfolio"], 2),
        "heirs_delta": (None if a["after_tax_to_heirs"] is None or b["after_tax_to_heirs"] is None
                        else round(a["after_tax_to_heirs"] - b["after_tax_to_heirs"], 2)),
    }


def run_sequence_stress(cfg: dict, params: dict | None = None) -> dict:
    """Baseline (flat return) plus every sequence scenario, each run with and
    without the conversion schedule."""
    p = {**DEFAULT_PARAMS, **(params or {})}
    baseline = _run_pair(cfg, None)
    # The schedule usually stops converting before the permitted window closes
    # (the IRA empties). Anchor the "late bear inside the conversion window"
    # scenario to the last year money is ACTUALLY converted.
    flat = run_projection(copy.deepcopy(cfg))
    conv_years = [r["year"] for r in flat["rows"] if (r.get("roth_conversion") or 0) > 0]
    last_conv = conv_years[-1] if conv_years else None
    baseline.update({"key": "baseline", "scenario": "baseline", "variant": "flat",
                     "label": "Flat assumed return (the plan as modeled)",
                     "bear_years": [], "equity_cagr": round(_ref_return(cfg), 6),
                     "blended_cagr": round(_ref_return(cfg), 6)})

    scenarios = []
    for path in build_paths(cfg, p, last_conv):
        run = _run_pair(cfg, path)
        run.update({k: path[k] for k in ("key", "scenario", "label", "variant",
                                         "bear_years", "equity_cagr", "blended_cagr")})
        run["equity_returns"] = [round(e, 6) for e in path["equity"]]
        blended = [_blend(run_w := _equity_share(cfg), e, _ref_return(cfg))
                   for e in path["equity"]]
        worst_i = min(range(len(blended)), key=lambda i: blended[i])
        run["worst_market_year_pct"] = round(blended[worst_i], 4)
        run["worst_market_year"] = path["start_year"] + worst_i
        run["vs_baseline"] = {
            "tax_saved": round(run["tax_saved_by_converting"]
                               - baseline["tax_saved_by_converting"], 2),
            "ending_portfolio": round(run["with_conversions"]["ending_portfolio"]
                                      - baseline["with_conversions"]["ending_portfolio"], 2),
            "ending_portfolio_no_conv": round(run["without_conversions"]["ending_portfolio"]
                                              - baseline["without_conversions"]["ending_portfolio"], 2),
            "lifetime_taxes": round(run["with_conversions"]["lifetime_taxes"]
                                    - baseline["with_conversions"]["lifetime_taxes"], 2),
            "heirs": (None if run["heirs_delta"] is None or baseline["heirs_delta"] is None
                      else round(run["heirs_delta"] - baseline["heirs_delta"], 2)),
            "after_tax_to_heirs": round((run["with_conversions"]["after_tax_to_heirs"] or 0)
                                        - (baseline["with_conversions"]["after_tax_to_heirs"] or 0), 2),
        }
        scenarios.append(run)

    return {
        "params": p,
        "equity_share": _equity_share(cfg),
        "reference_return": _ref_return(cfg),
        "start_year": int(cfg["projection"]["start_year"]),
        "end_year": int(cfg["projection"]["end_year"]),
        "conversion_window": list(_conversion_window(cfg, last_conv)),
        "last_conversion_year": last_conv,
        "baseline": baseline,
        "scenarios": scenarios,
    }
