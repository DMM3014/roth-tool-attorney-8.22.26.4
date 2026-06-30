"""Monte Carlo v2 — locks the deterministic conversion schedule and randomizes returns.

v2 adds:
  * per-asset-class volatility via a GLOBAL stocks/bonds/cash allocation (each class has its own
    mean + vol; the portfolio gross factor each year is the allocation-weighted blend of the classes,
    so diversification reduces portfolio volatility),
  * an optional early "bear-market" sequence-of-returns stress (force a fixed negative return for the
    first N years) reported as a side stress-test,
  * an automatic sequence-of-returns risk report (outcomes among the worst 5% of early-return paths).

Methodology (aggregate liquid-wealth recursion, unchanged):
    L_{t+1} = L_t * g_t + (external_income_t - spending_t - taxes_t)
where g_t is the random portfolio gross-return factor and the cashflow terms are taken from the
deterministic projection (conversion strategy, taxes, RMDs, SS and IRMAA are locked).
"Success" = the liquid portfolio never depletes through the second death.
"""

import copy
import numpy as np

from projection import run_projection

LIQUID_TAX_TYPES = {"Cash", "Taxable", "Tax-Deferred", "Tax-Free"}
PCTS = [10, 25, 50, 75, 90]
EARLY_YEARS = 3  # window that defines "sequence of returns" risk

DEFAULT_ASSETS = {
    "stocks": {"weight": 0.60, "mean": 0.08, "vol": 0.18},
    "bonds": {"weight": 0.30, "mean": 0.04, "vol": 0.06},
    "cash": {"weight": 0.10, "mean": 0.03, "vol": 0.01},
}


def _liquid_start(config):
    return float(sum(a.get("beginning_balance", 0.0)
                     for a in config["accounts"] if a.get("tax_type") in LIQUID_TAX_TYPES))


def _flows(rows):
    ext = np.array([(r["cashflow"]["wages_pension"] + r["cashflow"]["gross_ss"]) for r in rows], dtype=float)
    out = np.array([(r["cashflow"]["expenses"] + r["total_tax"]) for r in rows], dtype=float)
    return ext - out


def _portfolio_factors(assets, n, T, rng):
    """Allocation-weighted gross-return factors (n x T) blended from independent per-class draws."""
    classes = ["stocks", "bonds", "cash"]
    weights = np.array([max(0.0, assets[c]["weight"]) for c in classes], dtype=float)
    wsum = weights.sum() or 1.0
    weights = weights / wsum
    g = np.zeros((n, T), dtype=float)
    for i, c in enumerate(classes):
        m, s = float(assets[c]["mean"]), max(1e-6, float(assets[c]["vol"]))
        mu = np.log(1.0 + m) - 0.5 * s * s
        g += weights[i] * np.exp(rng.normal(mu, s, size=(n, T)))
    port_mean = float(np.dot(weights, [assets[c]["mean"] for c in classes]))
    port_vol = float(np.sqrt(np.dot(weights ** 2, [assets[c]["vol"] ** 2 for c in classes])))
    return g, weights, port_mean, port_vol


def _simulate(liquid0, net_flow, g):
    n, T = g.shape
    L = np.full(n, liquid0, dtype=float)
    paths = np.empty((n, T), dtype=float)
    ever_dep = np.zeros(n, dtype=bool)
    for t in range(T):
        L = L * g[:, t] + net_flow[t]
        ever_dep |= (L <= 0.0)
        L = np.where(ever_dep, 0.0, L)
        paths[:, t] = L
    return paths, ever_dep


def _summarize(paths, ever_dep):
    pct = np.percentile(paths, PCTS, axis=0)
    ending = paths[:, -1]
    n = ending.size
    depleted = int(np.sum(ending <= 0))
    success = float(np.mean(~ever_dep))
    cap = max(float(np.percentile(ending, 90)), 1.0)
    counts, edges = np.histogram(np.minimum(ending, cap), bins=20, range=(0.0, cap))
    return {
        "success": round(success, 4),
        "success_funded": round(success, 4),
        "percentiles": {f"p{p}": [round(float(v), 0) for v in pct[i]] for i, p in enumerate(PCTS)},
        "ending": {
            "p10": round(float(np.percentile(ending, 10)), 0),
            "p50": round(float(np.percentile(ending, 50)), 0),
            "p90": round(float(np.percentile(ending, 90)), 0),
            "mean": round(float(ending.mean()), 0),
            "min": round(float(ending.min()), 0),
            "pct_positive": round(float(np.mean(ending > 0)), 4),
            "depleted": depleted,
            "depleted_pct": round(depleted / n, 4),
        },
        "histogram": {"counts": [int(c) for c in counts], "edges": [round(float(e), 0) for e in edges], "capped": True},
    }


def run_montecarlo(config, n_trials=500, assets=None, shock=None, seed=None):
    n = int(max(50, min(n_trials, 2000)))
    assets = assets or DEFAULT_ASSETS

    # deterministic runs lock the conversion schedule + taxes + cashflows
    det_with = run_projection(config)
    cfg_without = copy.deepcopy(config)
    cfg_without.setdefault("roth", {})["enabled"] = False
    det_without = run_projection(cfg_without)

    rows_w, rows_n = det_with["rows"], det_without["rows"]
    years = [r["year"] for r in rows_w]
    T = len(rows_w)

    liquid0 = _liquid_start(config)
    flow_w, flow_n = _flows(rows_w), _flows(rows_n)

    rng = np.random.default_rng(seed)
    g, weights, port_mean, port_vol = _portfolio_factors(assets, n, T, rng)

    paths_w, dep_w = _simulate(liquid0, flow_w, g)
    paths_n, dep_n = _simulate(liquid0, flow_n, g)

    # ---- automatic sequence-of-returns risk: worst 5% of early-return paths ----
    K = min(EARLY_YEARS, T)
    early_cum = np.prod(g[:, :K], axis=1)
    thresh = np.percentile(early_cum, 5)
    cohort = early_cum <= thresh
    seq = {
        "early_years": K,
        "worst_pct": 5,
        "base_success": round(float(np.mean(~dep_w)), 4),
        "success": round(float(np.mean(~dep_w[cohort])), 4) if cohort.any() else None,
        "median_ending": round(float(np.median(paths_w[cohort, -1])), 0) if cohort.any() else None,
    }

    result = {
        "years": years,
        "n_trials": n,
        "allocation": {"stocks": round(float(weights[0]), 4), "bonds": round(float(weights[1]), 4), "cash": round(float(weights[2]), 4)},
        "assets": assets,
        "portfolio_mean": round(port_mean, 4),
        "portfolio_vol": round(port_vol, 4),
        "liquid_start": round(liquid0, 0),
        "with_conversions": _summarize(paths_w, dep_w),
        "without_conversions": _summarize(paths_n, dep_n),
        "sequence_risk": seq,
        "shock": None,
    }

    # ---- optional early bear-market stress test (separate run, same draws) ----
    if shock and shock.get("enabled"):
        rate = float(shock.get("rate", -0.15))
        yrs = int(max(1, min(shock.get("years", 2), T)))
        g_shock = g.copy()
        g_shock[:, :yrs] = 1.0 + rate
        sp_w, sd_w = _simulate(liquid0, flow_w, g_shock)
        sp_n, sd_n = _simulate(liquid0, flow_n, g_shock)
        result["shock"] = {
            "rate": round(rate, 4),
            "years": yrs,
            "success_with": round(float(np.mean(~sd_w)), 4),
            "success_without": round(float(np.mean(~sd_n)), 4),
            "base_success_with": result["with_conversions"]["success"],
            "median_ending_with": round(float(np.median(sp_w[:, -1])), 0),
        }

    return result
