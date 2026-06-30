"""Monte Carlo v1 — locks the deterministic conversion schedule and randomizes returns.

Methodology (aggregate liquid-wealth recursion):
    L_{t+1} = L_t * g_t + (external_income_t - spending_t - taxes_t)
where g_t is a random gross return factor and the cashflow terms are taken from the
deterministic projection (so the conversion strategy, taxes, RMDs, SS and IRMAA are
locked). External income = wages/pension + Social Security (the only non-portfolio cash);
dividends/RMD/conversions are internal reshuffles that don't change total liquid wealth.

"Success" = the liquid portfolio never depletes through the second death, which is
equivalent to fully funding every year's spending + taxes.
"""

import copy
import numpy as np

from projection import run_projection

LIQUID_TAX_TYPES = {"Cash", "Taxable", "Tax-Deferred", "Tax-Free"}
PCTS = [10, 25, 50, 75, 90]


def _liquid_start_and_mean(config, mean_return):
    liq = [(a.get("beginning_balance", 0.0), a.get("return", 0.0))
           for a in config["accounts"] if a.get("tax_type") in LIQUID_TAX_TYPES]
    liquid0 = sum(b for b, _ in liq)
    if mean_return is None:
        tot = sum(b for b, _ in liq) or 1.0
        mean_return = sum(b * r for b, r in liq) / tot
    return float(liquid0), float(mean_return)


def _flows(rows):
    ext = np.array([(r["cashflow"]["wages_pension"] + r["cashflow"]["gross_ss"]) for r in rows], dtype=float)
    out = np.array([(r["cashflow"]["expenses"] + r["total_tax"]) for r in rows], dtype=float)
    return ext - out


def _simulate(liquid0, net_flow, g):
    n, T = g.shape
    L = np.full(n, liquid0, dtype=float)
    paths = np.empty((n, T), dtype=float)
    ever_dep = np.zeros(n, dtype=bool)
    for t in range(T):
        L = L * g[:, t] + net_flow[t]
        ever_dep |= (L <= 0.0)
        L = np.where(ever_dep, 0.0, L)   # once depleted, the portfolio stays gone
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
        "success": round(success, 4),                       # never depletes the liquid portfolio
        "success_funded": round(success, 4),                # = fully funds spending every year
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


def run_montecarlo(config, n_trials=500, volatility=0.12, mean_return=None, seed=None):
    n = int(max(50, min(n_trials, 2000)))

    # deterministic runs lock the conversion schedule + taxes + cashflows
    det_with = run_projection(config)
    cfg_without = copy.deepcopy(config)
    cfg_without.setdefault("roth", {})["enabled"] = False
    det_without = run_projection(cfg_without)

    rows_w = det_with["rows"]
    rows_n = det_without["rows"]
    years = [r["year"] for r in rows_w]
    T = len(rows_w)

    liquid0, mean_ret = _liquid_start_and_mean(config, mean_return)
    flow_w = _flows(rows_w)
    flow_n = _flows(rows_n)

    # paired draws: identical market paths for both strategies (fair comparison)
    rng = np.random.default_rng(seed)
    s = float(volatility)
    mu = np.log(1.0 + mean_ret) - 0.5 * s * s
    g = np.exp(rng.normal(mu, s, size=(n, T)))

    paths_w, dep_w = _simulate(liquid0, flow_w, g)
    paths_n, dep_n = _simulate(liquid0, flow_n, g)

    return {
        "years": years,
        "n_trials": n,
        "volatility": round(s, 4),
        "mean_return": round(mean_ret, 4),
        "liquid_start": round(liquid0, 0),
        "with_conversions": _summarize(paths_w, dep_w),
        "without_conversions": _summarize(paths_n, dep_n),
    }
