"""Monte Carlo v2.2 — locks the deterministic conversion schedule and randomizes returns
+ (v2.1) stochastic inflation on the spending side
+ (v2.2) optional Gaussian-copula correlation across stocks/bonds/cash/inflation draws.

v2 adds:
  * per-asset-class volatility via a GLOBAL stocks/bonds/cash allocation (each class has its own
    mean + vol; the portfolio gross factor each year is the allocation-weighted blend of the classes,
    so diversification reduces portfolio volatility),
  * an optional early "bear-market" sequence-of-returns stress (force a fixed negative return for the
    first N years) reported as a side stress-test,
  * an automatic sequence-of-returns risk report (outcomes among the worst 5% of early-return paths).

v2.1 adds:
  * OPTIONAL stochastic inflation: draw per-trial per-year inflation π_t ~ LogNormal, then apply a
    cumulative inflation multiplier M[t] = ∏(1+π_s) / (1+μ_det)^t to each year's OUTFLOWS (expenses
    + taxes). Incomes are left at deterministic levels — this models the client-facing risk that
    "spending runs hotter than expected" while nominal wages/pensions don't fully keep up. SS is
    approximated as deterministic (it's inflation-indexed in reality, but the deterministic run
    already grew it at plan inflation, so this is conservative in the right direction).
  * Reports cumulative-inflation percentiles (p10/p50/p90) over the horizon, and the ratio of
    inflation-shocked success rate to the base success rate.

Methodology (aggregate liquid-wealth recursion):
    L_{t+1} = L_t * g_t + (external_income_t - outflow_t * M_t)
where g_t is the random portfolio gross-return factor, M_t is the cumulative inflation multiplier
(1.0 when inflation is deterministic), and the cashflow terms are taken from the deterministic
projection (conversion strategy, taxes, RMDs, SS and IRMAA are locked).
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

# Long-run US historical pairwise correlations (annual): order stocks, bonds, cash, inflation.
DEFAULT_CORR = {
    "stocks_bonds": 0.15, "stocks_cash": 0.00, "bonds_cash": 0.20,
    "stocks_inflation": -0.20, "bonds_inflation": -0.30, "cash_inflation": 0.55,
}
_CORR_PAIRS = [("stocks_bonds", 0, 1), ("stocks_cash", 0, 2), ("bonds_cash", 1, 2),
               ("stocks_inflation", 0, 3), ("bonds_inflation", 1, 3), ("cash_inflation", 2, 3)]


def _corr_setup(corr, k):
    """Build the k×k correlation matrix (k=3 assets-only, k=4 with inflation) from the
    six pairwise entries, repair to the nearest PSD matrix if needed (eigenvalue clipping
    + unit-diagonal rescale), and return (matrix_used, cholesky_L, was_adjusted)."""
    R = np.eye(k)
    for key, i, j in _CORR_PAIRS:
        if i < k and j < k:
            v = max(-0.99, min(0.99, float(corr.get(key, DEFAULT_CORR[key]))))
            R[i, j] = R[j, i] = v
    w, V = np.linalg.eigh(R)
    adjusted = bool(w.min() < 1e-8)
    if adjusted:
        w = np.clip(w, 1e-8, None)
        R = V @ np.diag(w) @ V.T
        d = np.sqrt(np.diag(R))
        R = R / np.outer(d, d)
    return R, np.linalg.cholesky(R), adjusted


def _liquid_start(config):
    return float(sum(a.get("beginning_balance", 0.0)
                     for a in config["accounts"] if a.get("tax_type") in LIQUID_TAX_TYPES))


def _flows_split(rows):
    """Split each year's deterministic cashflow into (external_income, outflow) so inflation
    volatility can rescale the outflow side per-trial without touching income."""
    ext = np.array([(r["cashflow"]["wages_pension"] + r["cashflow"]["gross_ss"]) for r in rows], dtype=float)
    out = np.array([(r["cashflow"]["expenses"] + r["total_tax"]) for r in rows], dtype=float)
    return ext, out


def _portfolio_factors(assets, n, T, rng, z=None):
    """Allocation-weighted gross-return factors (n x T) blended from per-class draws.

    `z` (n×T×3 standard normals, already correlated) overrides the independent draws
    when the Gaussian-copula correlation mode is on."""
    classes = ["stocks", "bonds", "cash"]
    weights = np.array([max(0.0, assets[c]["weight"]) for c in classes], dtype=float)
    wsum = weights.sum() or 1.0
    weights = weights / wsum
    g = np.zeros((n, T), dtype=float)
    for i, c in enumerate(classes):
        m, s = float(assets[c]["mean"]), max(1e-6, float(assets[c]["vol"]))
        mu = np.log(1.0 + m) - 0.5 * s * s
        zi = z[:, :, i] if z is not None else rng.normal(size=(n, T))
        g += weights[i] * np.exp(mu + s * zi)
    port_mean = float(np.dot(weights, [assets[c]["mean"] for c in classes]))
    port_vol = float(np.sqrt(np.dot(weights ** 2, [assets[c]["vol"] ** 2 for c in classes])))
    return g, weights, port_mean, port_vol


def _inflation_factors(inflation, n, T, rng, det_mean, z=None):
    """Return (multiplier[n,T], mean_used, vol_used, cum_summary).

    Multiplier at year t = ∏_{s≤t}(1+π_s) / (1+det_mean)^(t+1)   (t is 0-indexed here).
    So the LHS scales the deterministic (already-inflated) outflow to what it WOULD have been
    if realized inflation ran at π_s instead of det_mean.  When inflation is None or vol<=0
    the multiplier is 1.0 everywhere (backward-compatible with v2).
    `z` (n×T standard normals, already correlated with the asset draws) overrides the
    independent draws when the Gaussian-copula correlation mode is on.
    """
    if not inflation or not inflation.get("enabled", True) or float(inflation.get("vol", 0.0)) <= 0.0:
        return np.ones((n, T), dtype=float), None, None, None
    mean = float(inflation.get("mean", det_mean))
    vol = float(inflation.get("vol", 0.015))
    # lognormal draws of (1 + π_t): mean of ln(1+π) ≈ mean - 0.5*vol^2
    mu_ln = np.log(1.0 + mean) - 0.5 * vol * vol
    zi = z if z is not None else rng.normal(size=(n, T))
    draws = np.exp(mu_ln + vol * zi)                         # (1 + π_t) per trial per year
    cum_actual = np.cumprod(draws, axis=1)                  # ∏(1+π)
    cum_expected = np.array([(1.0 + det_mean) ** (t + 1) for t in range(T)])
    m = cum_actual / cum_expected                            # relative multiplier
    # summary stats for the UI (cumulative realized inflation percentiles)
    cum_pct = np.percentile(cum_actual, [10, 50, 90], axis=0)
    cum_summary = {
        "p10": [round(float(v), 4) for v in cum_pct[0]],
        "p50": [round(float(v), 4) for v in cum_pct[1]],
        "p90": [round(float(v), 4) for v in cum_pct[2]],
        "expected": [round(float(v), 4) for v in cum_expected],
    }
    return m, mean, vol, cum_summary


def _simulate(liquid0, ext, out, g, infl_mult):
    """Advance the aggregate liquid-wealth recursion N trials × T years.

    Outflow is scaled per-trial per-year by `infl_mult` (1.0 = deterministic inflation only).
    """
    n, T = g.shape
    L = np.full(n, liquid0, dtype=float)
    paths = np.empty((n, T), dtype=float)
    ever_dep = np.zeros(n, dtype=bool)
    for t in range(T):
        net_flow = ext[t] - out[t] * infl_mult[:, t]
        L = L * g[:, t] + net_flow
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


def _deterministic_flows(config):
    """Run the locked with/without-conversion projections; return their row lists."""
    det_with = run_projection(config)
    cfg_without = copy.deepcopy(config)
    cfg_without.setdefault("roth", {})["enabled"] = False
    det_without = run_projection(cfg_without)
    return det_with["rows"], det_without["rows"]


def _sequence_risk(g, paths_w, dep_w, T):
    """Automatic sequence-of-returns report: outcomes among the worst 5% of early paths."""
    K = min(EARLY_YEARS, T)
    early_cum = np.prod(g[:, :K], axis=1)
    thresh = np.percentile(early_cum, 5)
    cohort = early_cum <= thresh
    return {
        "early_years": K,
        "worst_pct": 5,
        "base_success": round(float(np.mean(~dep_w)), 4),
        "success": round(float(np.mean(~dep_w[cohort])), 4) if cohort.any() else None,
        "median_ending": round(float(np.median(paths_w[cohort, -1])), 0) if cohort.any() else None,
    }


def _shock_run(shock, g, liquid0, ext_w, out_w, ext_n, out_n, infl_mult, T, base_success_with):
    """Optional early bear-market stress: force a fixed negative return for the first N years."""
    rate = float(shock.get("rate", -0.15))
    yrs = int(max(1, min(shock.get("years", 2), T)))
    g_shock = g.copy()
    g_shock[:, :yrs] = 1.0 + rate
    sp_w, sd_w = _simulate(liquid0, ext_w, out_w, g_shock, infl_mult)
    sp_n, sd_n = _simulate(liquid0, ext_n, out_n, g_shock, infl_mult)
    return {
        "rate": round(rate, 4),
        "years": yrs,
        "success_with": round(float(np.mean(~sd_w)), 4),
        "success_without": round(float(np.mean(~sd_n)), 4),
        "base_success_with": base_success_with,
        "median_ending_with": round(float(np.median(sp_w[:, -1])), 0),
    }


def run_montecarlo(config, n_trials=500, assets=None, shock=None, seed=None, inflation=None,
                   correlation=None):
    n = int(max(50, min(n_trials, 2000)))
    assets = assets or DEFAULT_ASSETS

    # deterministic runs lock the conversion schedule + taxes + cashflows
    rows_w, rows_n = _deterministic_flows(config)
    years = [r["year"] for r in rows_w]
    T = len(rows_w)

    liquid0 = _liquid_start(config)
    ext_w, out_w = _flows_split(rows_w)
    ext_n, out_n = _flows_split(rows_n)

    rng = np.random.default_rng(seed)
    det_infl = float(config.get("projection", {}).get("general_inflation", 0.03))

    # Gaussian copula: one correlated standard-normal draw across stocks/bonds/cash
    # (+ inflation when stochastic inflation is on), mapped to each lognormal marginal.
    corr_info = None
    z_assets = z_infl = None
    if correlation and correlation.get("enabled"):
        infl_active = bool(inflation and inflation.get("enabled", True)
                           and float(inflation.get("vol", 0.0)) > 0.0)
        k = 4 if infl_active else 3
        R, L, adjusted = _corr_setup(correlation, k)
        z = rng.standard_normal(size=(n, T, k)) @ L.T
        z_assets = z[:, :, :3]
        z_infl = z[:, :, 3] if infl_active else None
        flat = z.reshape(-1, k)
        realized = np.corrcoef(flat, rowvar=False)
        corr_info = {
            "enabled": True,
            "includes_inflation": infl_active,
            "adjusted_to_psd": adjusted,
            "matrix_used": {key: round(float(R[i, j]), 4)
                            for key, i, j in _CORR_PAIRS if i < k and j < k},
            "realized": {key: round(float(realized[i, j]), 4)
                         for key, i, j in _CORR_PAIRS if i < k and j < k},
        }

    g, weights, port_mean, port_vol = _portfolio_factors(assets, n, T, rng, z=z_assets)

    infl_mult, infl_mean, infl_vol, cum_summary = _inflation_factors(
        inflation, n, T, rng, det_infl, z=z_infl)

    paths_w, dep_w = _simulate(liquid0, ext_w, out_w, g, infl_mult)
    paths_n, dep_n = _simulate(liquid0, ext_n, out_n, g, infl_mult)

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
        "sequence_risk": _sequence_risk(g, paths_w, dep_w, T),
        "shock": None,
        "inflation": None,
        "correlation": corr_info,
    }

    if infl_vol is not None:
        result["inflation"] = {
            "enabled": True,
            "mean": round(infl_mean, 4),
            "vol": round(infl_vol, 4),
            "deterministic_mean": round(det_infl, 4),
            "cumulative": cum_summary,
        }

    if shock and shock.get("enabled"):
        result["shock"] = _shock_run(shock, g, liquid0, ext_w, out_w, ext_n, out_n, infl_mult, T,
                                     result["with_conversions"]["success"])

    return result
