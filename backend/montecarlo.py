"""Monte Carlo v3.0
v2   — locks the deterministic conversion schedule and randomizes returns; per-class lognormal
       draws blended by a global stocks/bonds/cash allocation; bear-market shock; sequence risk.
v2.1 — optional stochastic inflation on the spending side.
v2.2 — optional Gaussian-copula correlation across stocks/bonds/cash/inflation draws.
v3.0 — (a) ANCHOR-TO-PLAN: the simulated blended return is re-centered so its geometric mean
       matches the plan's liquid-weighted account return (default ON) — fixes the disconnect
       where the deterministic plan assumed ~7% while the MC quietly ran ~6.3% mean.
       (b) HISTORICAL ENGINE: stationary block bootstrap (Anarkulova-Cederburg-O'Doherty style,
       ~10-yr average blocks) over real US 1928-2024 stock/bond/bill/CPI data — preserves fat
       tails, mean reversion, volatility clustering and true cross-correlations.
       (c) SPENDING GUARDRAIL: optionally cut discretionary expenses by X% in any year following
       a portfolio loss (Guyton-Klinger-lite), reflecting how retirees actually behave.
       (d) FAILURE ANATOMY: depleted trials report WHEN they fail (median/p10/p90 year, years
       unfunded); the ending histogram now covers survivors only so the $0 bin can't masquerade
       as "the most likely outcome".

Methodology (aggregate liquid-wealth recursion):
    L_{t+1} = L_t * g_t + (external_income_t - (expenses_t*guardrail_t + taxes_t) * M_t)
where g_t is the random portfolio gross-return factor, M_t is the cumulative inflation multiplier
(1.0 when inflation is deterministic), and the cashflow terms are taken from the deterministic
projection (conversion strategy, taxes, RMDs, SS and IRMAA are locked).
"Success" = the liquid portfolio never depletes through the second death.
"""

import copy
import numpy as np

from projection import run_projection
from historical_data import HIST, HIST_YEARS

LIQUID_TAX_TYPES = {"Cash", "Taxable", "Tax-Deferred", "Tax-Free"}
PCTS = [10, 25, 50, 75, 90]
EARLY_YEARS = 3  # window that defines "sequence of returns" risk
AVG_BLOCK_YEARS = 10  # stationary bootstrap expected block length (ACO 2023 use ~120 months)

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


def _plan_return(config):
    """Liquid-asset-weighted average of the plan's own account return assumptions —
    the anchor that keeps the simulation consistent with the deterministic projection."""
    accts = [a for a in config["accounts"] if a.get("tax_type") in LIQUID_TAX_TYPES]
    tot = sum(a.get("beginning_balance", 0.0) for a in accts)
    if tot <= 0:
        return None
    return float(sum(a.get("beginning_balance", 0.0) * float(a.get("return", 0.0))
                     for a in accts) / tot)


def _normalized_weights(assets):
    classes = ["stocks", "bonds", "cash"]
    w = np.array([max(0.0, assets[c]["weight"]) for c in classes], dtype=float)
    return w / (w.sum() or 1.0), classes


def _anchor_assets(assets, plan_ret):
    """Rescale the per-class arithmetic means so the blended GEOMETRIC mean ≈ plan_ret
    (arithmetic target = plan + portfolio_variance/2). Volatilities are untouched, so the
    allocation still sets the risk — only the central tendency is re-centered on the plan."""
    weights, classes = _normalized_weights(assets)
    means = np.array([float(assets[c]["mean"]) for c in classes])
    vols = np.array([float(assets[c]["vol"]) for c in classes])
    blended = float(np.dot(weights, means))
    var_p = float(np.dot(weights ** 2, vols ** 2))
    target = plan_ret + var_p / 2.0
    if blended <= 1e-9 or plan_ret is None:
        return assets, {"enabled": False, "plan_return": plan_ret,
                        "blended_mean_before": round(blended, 4), "blended_mean_after": round(blended, 4)}
    f = target / blended
    scaled = {c: {**assets[c], "mean": float(assets[c]["mean"]) * f} for c in classes}
    return scaled, {"enabled": True, "plan_return": round(plan_ret, 4),
                    "blended_mean_before": round(blended, 4),
                    "blended_mean_after": round(target, 4)}


def _flows_split(rows):
    """Split each year's deterministic cashflow into (external_income, expenses, taxes).
    Expenses/taxes are kept apart so the spending guardrail can trim only the spending side;
    inflation volatility rescales both (they're both nominal outflows)."""
    ext = np.array([(r["cashflow"]["wages_pension"] + r["cashflow"]["gross_ss"]) for r in rows], dtype=float)
    exp = np.array([r["cashflow"]["expenses"] for r in rows], dtype=float)
    tax = np.array([r["total_tax"] for r in rows], dtype=float)
    return ext, exp, tax


def _portfolio_factors(assets, n, T, rng, z=None):
    """Allocation-weighted gross-return factors (n x T) blended from per-class draws.

    `z` (n×T×3 standard normals, already correlated) overrides the independent draws
    when the Gaussian-copula correlation mode is on."""
    classes = ["stocks", "bonds", "cash"]
    weights, _ = _normalized_weights(assets)
    g = np.zeros((n, T), dtype=float)
    for i, c in enumerate(classes):
        m, s = float(assets[c]["mean"]), max(1e-6, float(assets[c]["vol"]))
        mu = np.log(1.0 + m) - 0.5 * s * s
        zi = z[:, :, i] if z is not None else rng.normal(size=(n, T))
        g += weights[i] * np.exp(mu + s * zi)
    port_mean = float(np.dot(weights, [assets[c]["mean"] for c in classes]))
    port_vol = float(np.sqrt(np.dot(weights ** 2, [assets[c]["vol"] ** 2 for c in classes])))
    return g, weights, port_mean, port_vol


def _bootstrap_indices(n, T, N, rng, avg_block=AVG_BLOCK_YEARS):
    """Stationary block bootstrap (Politis-Romano): geometric block lengths with expected
    length `avg_block`, wrapping around the sample. Returns an (n, T) index matrix."""
    p = 1.0 / max(1, avg_block)
    idx = np.empty((n, T), dtype=np.int64)
    cur = rng.integers(0, N, size=n)
    idx[:, 0] = cur
    for t in range(1, T):
        restart = rng.random(n) < p
        cur = np.where(restart, rng.integers(0, N, size=n), (cur + 1) % N)
        idx[:, t] = cur
    return idx


def _historical_factors(assets, n, T, rng):
    """Historical engine: sample joint (stocks, bonds, cash, CPI) calendar years via the
    stationary block bootstrap, blend class returns by the allocation weights. Sampling the
    same year across all series preserves the empirical cross-correlations, fat tails and
    within-block mean reversion. Returns (g, infl_draws(1+π), weights, stats)."""
    weights, _ = _normalized_weights(assets)
    stocks = np.asarray(HIST["stocks"])
    bonds = np.asarray(HIST["bonds"])
    cash = np.asarray(HIST["cash"])
    infl = np.asarray(HIST["inflation"])
    blended = weights[0] * (1 + stocks) + weights[1] * (1 + bonds) + weights[2] * (1 + cash)
    N = blended.size
    idx = _bootstrap_indices(n, T, N, rng)
    g = blended[idx]
    infl_draws = (1.0 + infl)[idx]
    geom = float(np.exp(np.mean(np.log(blended))))
    stats = {
        "years_span": f"{HIST_YEARS[0]}-{HIST_YEARS[-1]}",
        "n_years": N,
        "avg_block_years": AVG_BLOCK_YEARS,
        "sample_arith_mean": round(float(blended.mean() - 1.0), 4),
        "sample_geom_mean": round(geom - 1.0, 4),
        "sample_vol": round(float(blended.std()), 4),
        "sample_inflation_mean": round(float(infl.mean()), 4),
    }
    return g, infl_draws, weights, geom, stats


def _inflation_factors(inflation, n, T, rng, det_mean, z=None, draws=None):
    """Return (multiplier[n,T], mean_used, vol_used, cum_summary).

    Multiplier at year t = ∏_{s≤t}(1+π_s) / (1+det_mean)^(t+1)   (t is 0-indexed here).
    So the LHS scales the deterministic (already-inflated) outflow to what it WOULD have been
    if realized inflation ran at π_s instead of det_mean.  When inflation is None or disabled
    the multiplier is 1.0 everywhere (backward-compatible with v2).
    `z`: correlated standard normals (Gaussian-copula lognormal mode).
    `draws`: pre-sampled (1+π_t) factors (historical engine) — used verbatim.
    """
    if draws is None:
        if not inflation or not inflation.get("enabled", True) or float(inflation.get("vol", 0.0)) <= 0.0:
            return np.ones((n, T), dtype=float), None, None, None
        mean = float(inflation.get("mean", det_mean))
        vol = float(inflation.get("vol", 0.015))
        # lognormal draws of (1 + π_t): mean of ln(1+π) ≈ mean - 0.5*vol^2
        mu_ln = np.log(1.0 + mean) - 0.5 * vol * vol
        zi = z if z is not None else rng.normal(size=(n, T))
        draws = np.exp(mu_ln + vol * zi)                     # (1 + π_t) per trial per year
    else:
        mean = float(np.mean(draws) - 1.0)
        vol = float(np.std(draws))
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


def _simulate(liquid0, ext, exp, tax, g, infl_mult, guardrail=None):
    """Advance the aggregate liquid-wealth recursion N trials × T years.

    Outflow is scaled per-trial per-year by `infl_mult` (1.0 = deterministic inflation only).
    `guardrail` (optional): {"enabled": True, "cut_pct": 0.10} — in any year following a
    portfolio loss, discretionary expenses are cut by cut_pct (taxes are never flexible).
    Returns (paths, ever_depleted, depletion_year_index[-1 if never], guardrail_cut_years).
    """
    n, T = g.shape
    cut = float(guardrail.get("cut_pct", 0.10)) if guardrail and guardrail.get("enabled") else 0.0
    L = np.full(n, liquid0, dtype=float)
    paths = np.empty((n, T), dtype=float)
    ever_dep = np.zeros(n, dtype=bool)
    dep_idx = np.full(n, -1, dtype=np.int64)
    cut_years = np.zeros(n, dtype=np.int64)
    prev_loss = np.zeros(n, dtype=bool)
    for t in range(T):
        if cut > 0.0:
            exp_t = exp[t] * np.where(prev_loss, 1.0 - cut, 1.0)
            cut_years += prev_loss
        else:
            exp_t = exp[t]
        net_flow = ext[t] - (exp_t + tax[t]) * infl_mult[:, t]
        L = L * g[:, t] + net_flow
        newly = (~ever_dep) & (L <= 0.0)
        dep_idx[newly] = t
        ever_dep |= newly
        L = np.where(ever_dep, 0.0, L)
        paths[:, t] = L
        if cut > 0.0:
            prev_loss = g[:, t] < 1.0
    return paths, ever_dep, dep_idx, cut_years


def _summarize(paths, ever_dep, dep_idx, years):
    pct = np.percentile(paths, PCTS, axis=0)
    ending = paths[:, -1]
    n = ending.size
    depleted = int(np.sum(ever_dep))
    success = float(np.mean(~ever_dep))

    # Histogram over SURVIVING trials only — depleted paths are reported separately so the
    # $0 bin can't visually masquerade as "the most likely outcome".
    surv = ending[~ever_dep]
    if surv.size:
        cap = max(float(np.percentile(surv, 90)), 1.0)
        counts, edges = np.histogram(np.minimum(surv, cap), bins=20, range=(0.0, cap))
    else:
        counts, edges = np.zeros(20, dtype=int), np.linspace(0.0, 1.0, 21)

    # Failure anatomy: WHEN do the failing paths deplete, and how many years go unfunded?
    failure = None
    if depleted:
        dy = dep_idx[ever_dep]
        med_idx = int(np.median(dy))
        failure = {
            "count": depleted,
            "pct": round(depleted / n, 4),
            "median_year": int(years[med_idx]),
            "p10_year": int(years[int(np.percentile(dy, 10))]),
            "p90_year": int(years[int(np.percentile(dy, 90))]),
            "median_years_unfunded": int(len(years) - 1 - med_idx),
            "horizon_end": int(years[-1]),
        }

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
        "failure": failure,
        "histogram": {"counts": [int(c) for c in counts], "edges": [round(float(e), 0) for e in edges],
                      "capped": True, "survivors_only": True},
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


def _shock_run(shock, g, liquid0, flows_w, flows_n, infl_mult, T, base_success_with, guardrail):
    """Optional early bear-market stress: force a fixed negative return for the first N years."""
    rate = float(shock.get("rate", -0.15))
    yrs = int(max(1, min(shock.get("years", 2), T)))
    g_shock = g.copy()
    g_shock[:, :yrs] = 1.0 + rate
    sp_w, sd_w, _, _ = _simulate(liquid0, *flows_w, g_shock, infl_mult, guardrail)
    sp_n, sd_n, _, _ = _simulate(liquid0, *flows_n, g_shock, infl_mult, guardrail)
    return {
        "rate": round(rate, 4),
        "years": yrs,
        "success_with": round(float(np.mean(~sd_w)), 4),
        "success_without": round(float(np.mean(~sd_n)), 4),
        "base_success_with": base_success_with,
        "median_ending_with": round(float(np.median(sp_w[:, -1])), 0),
    }


def run_montecarlo(config, n_trials=500, assets=None, shock=None, seed=None, inflation=None,
                   correlation=None, engine="lognormal", anchor_to_plan=True, guardrail=None):
    n = int(max(50, min(n_trials, 2000)))
    assets = assets or DEFAULT_ASSETS

    # deterministic runs lock the conversion schedule + taxes + cashflows
    rows_w, rows_n = _deterministic_flows(config)
    years = [r["year"] for r in rows_w]
    T = len(rows_w)

    liquid0 = _liquid_start(config)
    flows_w = _flows_split(rows_w)   # (ext, expenses, taxes)
    flows_n = _flows_split(rows_n)

    rng = np.random.default_rng(seed)
    det_infl = float(config.get("projection", {}).get("general_inflation", 0.03))
    plan_ret = _plan_return(config)
    anchor_info = {"enabled": False, "plan_return": (round(plan_ret, 4) if plan_ret is not None else None)}
    corr_info = None
    hist_info = None
    infl_source = "lognormal"

    if engine == "historical":
        # Historical block bootstrap: returns + inflation sampled jointly from 1928-2024;
        # correlations/fat-tails/mean-reversion come from the data (copula spec ignored).
        g, infl_draws, weights, geom, hist_info = _historical_factors(assets, n, T, rng)
        port_mean, port_vol = hist_info["sample_arith_mean"], hist_info["sample_vol"]
        if anchor_to_plan and plan_ret is not None:
            g = g * ((1.0 + plan_ret) / geom)
            anchor_info = {"enabled": True, "plan_return": round(plan_ret, 4),
                           "blended_mean_before": round(geom - 1.0, 4),
                           "blended_mean_after": round(plan_ret, 4)}
            port_mean = round(port_mean + (plan_ret - (geom - 1.0)), 4)
        infl_on = bool(inflation and inflation.get("enabled", True)) if inflation is not None else True
        if infl_on:
            infl_mult, infl_mean, infl_vol, cum_summary = _inflation_factors(
                inflation, n, T, rng, det_infl, draws=infl_draws)
            infl_source = "historical"
        else:
            infl_mult, infl_mean, infl_vol, cum_summary = np.ones((n, T)), None, None, None
    else:
        # Lognormal engine (v2.2 behavior) + optional anchor-to-plan re-centering.
        if anchor_to_plan and plan_ret is not None:
            assets, anchor_info = _anchor_assets(assets, plan_ret)

        # Gaussian copula: one correlated standard-normal draw across stocks/bonds/cash
        # (+ inflation when stochastic inflation is on), mapped to each lognormal marginal.
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

    gr = guardrail if (guardrail and guardrail.get("enabled")) else None
    paths_w, dep_w, depidx_w, cuts_w = _simulate(liquid0, *flows_w, g, infl_mult, gr)
    paths_n, dep_n, depidx_n, _ = _simulate(liquid0, *flows_n, g, infl_mult, gr)

    guardrail_info = None
    if gr:
        _, dep_base, _, _ = _simulate(liquid0, *flows_w, g, infl_mult, None)
        guardrail_info = {
            "enabled": True,
            "cut_pct": round(float(gr.get("cut_pct", 0.10)), 4),
            "success_without_guardrail": round(float(np.mean(~dep_base)), 4),
            "success_with_guardrail": round(float(np.mean(~dep_w)), 4),
            "median_cut_years": int(np.median(cuts_w)),
        }

    result = {
        "years": years,
        "n_trials": n,
        "engine": engine,
        "plan_return": (round(plan_ret, 4) if plan_ret is not None else None),
        "anchor": anchor_info,
        "historical": hist_info,
        "guardrail": guardrail_info,
        "allocation": {"stocks": round(float(weights[0]), 4), "bonds": round(float(weights[1]), 4), "cash": round(float(weights[2]), 4)},
        "assets": assets,
        "portfolio_mean": round(float(port_mean), 4),
        "portfolio_vol": round(float(port_vol), 4),
        "liquid_start": round(liquid0, 0),
        "with_conversions": _summarize(paths_w, dep_w, depidx_w, years),
        "without_conversions": _summarize(paths_n, dep_n, depidx_n, years),
        "sequence_risk": _sequence_risk(g, paths_w, dep_w, T),
        "shock": None,
        "inflation": None,
        "correlation": corr_info,
    }

    if infl_vol is not None:
        result["inflation"] = {
            "enabled": True,
            "source": infl_source,
            "mean": round(infl_mean, 4),
            "vol": round(infl_vol, 4),
            "deterministic_mean": round(det_infl, 4),
            "cumulative": cum_summary,
        }

    if shock and shock.get("enabled"):
        result["shock"] = _shock_run(shock, g, liquid0, flows_w, flows_n, infl_mult, T,
                                     result["with_conversions"]["success"], gr)

    return result
