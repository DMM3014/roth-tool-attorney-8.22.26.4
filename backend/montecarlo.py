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
v3.1 — TIME-VARYING ANCHOR: instead of a single flat plan return, the anchor now follows the
       per-year return path implied by the deterministic projection's own liquid balances
       (g_t = (L_t - net_flow_t)/L_{t-1}), so the MC median tracks the plan even as the
       cash/growth mix shifts over the horizon. Percentile reporting extended to P5/P95.
"""

import copy
import numpy as np

from projection import run_projection
from historical_data import HIST, HIST_YEARS

LIQUID_TAX_TYPES = {"Cash", "Taxable", "Tax-Deferred", "Tax-Free"}
PCTS = [5, 10, 25, 50, 75, 90, 95]
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


def _plan_return_path(rows, liquid0, flows, fallback=None):
    """Per-year portfolio growth implied by the deterministic plan's own liquid balances:
    g_t = (L_t - net_flow_t) / L_{t-1}.  Running the MC recursion at exactly this path
    reproduces the plan, so anchoring to it keeps the MC median on-plan even as the
    low-yield cash slice shrinks and the effective blended return drifts upward.

    Guardrails (report-critique fix): the implied-return formula is only meaningful
    while the plan holds a non-trivial balance. When the deterministic plan depletes
    (or nearly depletes) — e.g. under a stressed regime preset — the ratio divides by
    near-zero balances and explodes, which previously hit the +100%/yr clip and made
    the bootstrap compound absurd upper tails (P90 in the billions on 50%-success
    regimes). Years where the prior balance is below 5% of the starting portfolio are
    treated as invalid and filled with `fallback` (the plan's flat liquid-weighted
    return); the whole path is clipped to ±50%/yr."""
    ext, exp, tax = flows
    liq = np.array([r["cash"] + r["taxable"] + r["traditional"] + r["roth"] for r in rows], dtype=float)
    prev = np.concatenate(([liquid0], liq[:-1]))
    net = ext - (exp + tax)
    floor = max(1.0, 0.05 * liquid0)
    ok = prev > floor
    r = np.zeros(liq.size, dtype=float)
    r[ok] = (liq[ok] - net[ok]) / prev[ok] - 1.0
    if not ok.all():
        if fallback is not None:
            fill = float(fallback)
        elif ok.any():
            fill = float(np.clip(r[ok], -0.50, 0.50).mean())
        else:
            fill = 0.0
        r[~ok] = fill
    return np.clip(r, -0.50, 0.50)


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

    Also returns per-class gross factors (n×T×3) so the rebalance-cadence pass can
    reconstruct a drifted-weights aggregate return path when the advisor turns off
    annual rebalancing.

    `z` (n×T×3 standard normals, already correlated) overrides the independent draws
    when the Gaussian-copula correlation mode is on."""
    classes = ["stocks", "bonds", "cash"]
    weights, _ = _normalized_weights(assets)
    g_class = np.zeros((n, T, 3), dtype=float)
    for i, c in enumerate(classes):
        m, s = float(assets[c]["mean"]), max(1e-6, float(assets[c]["vol"]))
        mu = np.log(1.0 + m) - 0.5 * s * s
        zi = z[:, :, i] if z is not None else rng.normal(size=(n, T))
        g_class[:, :, i] = np.exp(mu + s * zi)
    g = (weights[None, None, :] * g_class).sum(axis=-1)
    port_mean = float(np.dot(weights, [assets[c]["mean"] for c in classes]))
    port_vol = float(np.sqrt(np.dot(weights ** 2, [assets[c]["vol"] ** 2 for c in classes])))
    return g, g_class, weights, port_mean, port_vol


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
    within-block mean reversion. Returns (g, g_class, infl_draws(1+π), weights, stats).
    `g_class` (n×T×3) exposes per-class factors so the rebalance-cadence pass can build a
    drifted-weights aggregate path when annual rebalancing is turned off."""
    weights, _ = _normalized_weights(assets)
    stocks = np.asarray(HIST["stocks"])
    bonds = np.asarray(HIST["bonds"])
    cash = np.asarray(HIST["cash"])
    infl = np.asarray(HIST["inflation"])
    blended = weights[0] * (1 + stocks) + weights[1] * (1 + bonds) + weights[2] * (1 + cash)
    N = blended.size
    idx = _bootstrap_indices(n, T, N, rng)
    g = blended[idx]
    g_class = np.stack([(1 + stocks)[idx], (1 + bonds)[idx], (1 + cash)[idx]], axis=-1)
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
    return g, g_class, infl_draws, weights, geom, stats


def _apply_rebalance_cadence(g_class, weights_target, cadence):
    """Reshape (n, T, 3) per-class gross-return factors into an (n, T) aggregate factor
    that reflects an advisor rebalance policy other than annual re-targeting.

    * cadence == 'annual' (default): each year uses the target weights (the caller's
      already-blended g is exactly this; we still recompute for symmetry).
    * cadence == 'biennial': weights drift for one year, then rebalance every 2 years.
    * cadence == 'never':    weights drift for the entire horizon; the mix at year T
      may look nothing like the target.

    Assumption: withdrawals are pro-rata by CURRENT weights, so withdrawals leave the
    class weights unchanged. Only market movement drifts the mix. This matches how
    most non-tactical rebalance strategies are modelled at the aggregate level."""
    n, T, _ = g_class.shape
    w_target = np.asarray(weights_target, dtype=float).reshape(1, 3)
    w = np.broadcast_to(w_target, (n, 3)).copy()
    g_agg = np.empty((n, T), dtype=float)
    for t in range(T):
        r = g_class[:, t, :]
        # This year's aggregate return is the sum over classes of (entry weight × factor).
        g_agg[:, t] = (w * r).sum(axis=1)
        # Drift the weights via the year's per-class returns.
        num = w * r
        denom = num.sum(axis=1, keepdims=True)
        w = num / np.where(denom > 0.0, denom, 1.0)
        # Rebalance based on cadence.
        if cadence == "annual":
            w = np.broadcast_to(w_target, (n, 3)).copy()
        elif cadence == "biennial" and ((t + 1) % 2 == 0):
            w = np.broadcast_to(w_target, (n, 3)).copy()
        # else 'never': leave weights drifted.
    return g_agg


def _regime_inflation_draws(inflation, n, T, rng):
    """3-state Markov regime-switching draws of (1+π_t). Shape (n, T).

    States: 0 = Low, 1 = Normal, 2 = High.
    Transition matrix: diagonal = p_stay; off-diagonals split evenly among the other 2 states
    (i.e. each off-diag = (1 - p_stay) / 2). Starting state per trial: Normal (index 1).
    """
    r_low = inflation.get("regime_low", {"mean": 0.020, "vol": 0.008})
    r_norm = inflation.get("regime_normal", {"mean": 0.035, "vol": 0.014})
    r_high = inflation.get("regime_high", {"mean": 0.060, "vol": 0.025})
    p_stay = float(inflation.get("regime_p_stay", 0.85))
    p_off = (1.0 - p_stay) / 2.0
    means = np.array([float(r_low.get("mean", 0.020)),
                      float(r_norm.get("mean", 0.035)),
                      float(r_high.get("mean", 0.060))], dtype=float)
    vols = np.array([float(r_low.get("vol", 0.008)),
                     float(r_norm.get("vol", 0.014)),
                     float(r_high.get("vol", 0.025))], dtype=float)

    # Sample state paths per trial (simple loop — T is at most ~60).
    states = np.zeros((n, T), dtype=np.int8)
    states[:, 0] = 1  # start Normal
    # Vectorised regime transitions column-by-column.
    for t in range(1, T):
        prev = states[:, t - 1]
        u = rng.random(size=n)
        # For each row: if u < p_stay → stay in prev; else split remaining probability across
        # the other two states in fixed order.
        stay = u < p_stay
        # For the switchers, the "next" and "other" state are determined by prev.
        # prev=0 → other = [1,2] ; prev=1 → other = [0,2] ; prev=2 → other = [0,1]
        # Split (1-p_stay) into two equal halves.
        other_idx = np.where(u >= p_stay + p_off, 1, 0)  # 0 → first alt, 1 → second alt
        alt = np.where(prev == 0,
                       np.where(other_idx == 0, 1, 2),
                       np.where(prev == 1,
                                np.where(other_idx == 0, 0, 2),
                                np.where(other_idx == 0, 0, 1)))
        states[:, t] = np.where(stay, prev, alt).astype(np.int8)

    # Draw (1+π_t) for each cell from the appropriate regime's lognormal.
    m_per_cell = means[states]
    v_per_cell = vols[states]
    mu_ln = np.log(1.0 + m_per_cell) - 0.5 * v_per_cell * v_per_cell
    z = rng.normal(size=(n, T))
    draws = np.exp(mu_ln + v_per_cell * z)
    return draws, means, vols, p_stay, states


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


def _simulate(liquid0, ext, exp, tax, g, infl_mult, guardrail=None,
              halt=None, tax_no_conv=None, conv_year_mask=None, conv_amounts=None):
    """Advance the aggregate liquid-wealth recursion N trials × T years.

    Outflow is scaled per-trial per-year by `infl_mult` (1.0 = deterministic inflation only).
    `guardrail` (optional): {"enabled": True, "cut_pct": 0.10} — in any year following a
    portfolio loss, discretionary expenses are cut by cut_pct (taxes are never flexible).
    `halt` (optional): {"drop_threshold": 0.10, "resume_after_positive_years": int|0}
    — advisor rule: cease planned Roth conversions in a given trial once that trial's
    prior-year gross return drops below (1 - drop_threshold), for the remainder of the
    conversion window. When resume_after_positive_years > 0, a halted trial UN-halts
    once it strings together that many consecutive positive-return years (g[t-1] >= 1.0),
    and may be re-halted later if another qualifying drawdown hits. When 0, halts are
    permanent (the original behavior). Requires tax_no_conv (the without-conversion tax
    vector) and conv_year_mask (bool[T] marking conversion years).
    Because the aggregate liquid recursion only differs between with/without-conversion
    in the tax cashflow (conversions are Traditional→Roth transfers, both liquid), swapping
    tax[t]→tax_no_conv[t] while a trial is halted correctly models the halt at the
    aggregate level.
    `conv_amounts` (optional float[T]): planned conversion $ per year — used to track
    per-trial total conversions executed (skipped while a trial is halted).
    Returns (paths, ever_depleted, depletion_year_index[-1 if never], guardrail_cut_years,
             halt_ever_triggered_bool, halt_first_year_index[-1 if never], resume_idx,
             extras dict {conv_paid[n], tax_paid[n]}).
    """
    n, T = g.shape
    cut = float(guardrail.get("cut_pct", 0.10)) if guardrail and guardrail.get("enabled") else 0.0
    halt_thr = None
    resume_years = 0
    if halt and halt.get("enabled") and tax_no_conv is not None and conv_year_mask is not None:
        halt_thr = float(halt.get("drop_threshold", 0.10))
        resume_years = max(0, int(halt.get("resume_after_positive_years", 0) or 0))
    L = np.full(n, liquid0, dtype=float)
    paths = np.empty((n, T), dtype=float)
    ever_dep = np.zeros(n, dtype=bool)
    dep_idx = np.full(n, -1, dtype=np.int64)
    cut_years = np.zeros(n, dtype=np.int64)
    prev_loss = np.zeros(n, dtype=bool)
    halted = np.zeros(n, dtype=bool)  # CURRENT per-trial halt state
    halt_ever = np.zeros(n, dtype=bool)  # was halted at any point (for reporting)
    halt_idx = np.full(n, -1, dtype=np.int64)  # FIRST trigger year (for reporting)
    resume_idx = np.full(n, -1, dtype=np.int64)  # FIRST resume year (for reporting)
    consec_pos = np.zeros(n, dtype=np.int64)  # consecutive positive-return years while halted
    conv_paid = np.zeros(n)   # per-trial total conversions actually executed
    tax_paid = np.zeros(n)    # per-trial lifetime taxes (inflation-scaled, halt-aware)
    for t in range(T):
        if cut > 0.0:
            exp_t = exp[t] * np.where(prev_loss, 1.0 - cut, 1.0)
            cut_years += prev_loss
        else:
            exp_t = exp[t]
        # Conversion halt state machine (per trial). Only meaningful during conversion
        # years — after the window closes, tax_w and tax_no_conv are identical anyway.
        if halt_thr is not None and t > 0 and bool(conv_year_mask[t]):
            pos_last = g[:, t - 1] >= 1.0
            neg_last = g[:, t - 1] < (1.0 - halt_thr)
            # Un-halt trials that have strung together enough positive years (if resume rule on).
            if resume_years > 0:
                consec_pos = np.where(halted & pos_last, consec_pos + 1, np.where(halted, 0, consec_pos))
                unhalt = halted & (consec_pos >= resume_years)
                first_unhalt = unhalt & (resume_idx < 0)
                resume_idx[first_unhalt] = t
                halted = halted & ~unhalt
                consec_pos = np.where(halted, consec_pos, 0)
            # (Re-)trigger halt on qualifying drop.
            trigger = (~halted) & neg_last
            first_trigger = trigger & (halt_idx < 0)
            halt_idx[first_trigger] = t
            halted |= trigger
            halt_ever |= trigger
            consec_pos = np.where(halted & trigger, 0, consec_pos)
        if halt_thr is not None:
            tax_t = np.where(halted, tax_no_conv[t], tax[t])
        else:
            tax_t = tax[t]
        if conv_amounts is not None:
            if halt_thr is not None:
                conv_paid += np.where(halted, 0.0, conv_amounts[t])
            else:
                conv_paid += conv_amounts[t]
        tax_paid += tax_t * infl_mult[:, t]
        net_flow = ext[t] - (exp_t + tax_t) * infl_mult[:, t]
        L = L * g[:, t] + net_flow
        newly = (~ever_dep) & (L <= 0.0)
        dep_idx[newly] = t
        ever_dep |= newly
        L = np.where(ever_dep, 0.0, L)
        paths[:, t] = L
        if cut > 0.0:
            prev_loss = g[:, t] < 1.0
    return (paths, ever_dep, dep_idx, cut_years, halt_ever, halt_idx, resume_idx,
            {"conv_paid": conv_paid, "tax_paid": tax_paid})


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
            "p5": round(float(np.percentile(ending, 5)), 0),
            "p10": round(float(np.percentile(ending, 10)), 0),
            "p25": round(float(np.percentile(ending, 25)), 0),
            "p50": round(float(np.percentile(ending, 50)), 0),
            "p75": round(float(np.percentile(ending, 75)), 0),
            "p90": round(float(np.percentile(ending, 90)), 0),
            "p95": round(float(np.percentile(ending, 95)), 0),
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


def _paired_delta(paths_w, paths_n, dep_w, dep_n, tax_paid_w, tax_paid_n, conv_paid_w):
    """Per-trial paired A/B delta on identical market seeds.

    Both `paths_w` and `paths_n` come out of the same `g` returns matrix, so
    row `i` in each is the same market draw played against the with- and
    without-conversion cashflows respectively. That makes a per-trial
    difference meaningful (unlike marginal distributions, which conflate
    market noise with the plan delta).

    Returns:
      • ending_delta   — (with − without) terminal liquid wealth per trial:
                         percentiles, mean, share of trials where the Roth
                         strategy left MORE wealth, and a symmetric-around-0
                         histogram for the client-report figure.
      • lifetime_tax_delta — (with − without) per-trial lifetime taxes paid.
                             A negative number means the Roth strategy PAID
                             LESS lifetime tax on that trial.
      • conv_paid          — same as outcome_distributions.conversions but
                             re-exposed here for the paired-page callout.
      • n_trials, both_survive_pct — sanity counters for the paired footnote.
    """
    if paths_w is None or paths_n is None or paths_w.shape != paths_n.shape:
        return None
    n = paths_w.shape[0]
    end_w = paths_w[:, -1]
    end_n = paths_n[:, -1]
    ending_delta = end_w - end_n

    both_alive = (~dep_w) & (~dep_n)
    both_alive_n = int(both_alive.sum())

    def _sym_hist(arr, bins=25):
        """Symmetric-around-zero histogram capped at ±p95 of |arr| for a legible fig."""
        if arr.size == 0:
            return {"counts": [0] * bins, "edges": list(np.linspace(-1.0, 1.0, bins + 1))}
        cap = max(float(np.percentile(np.abs(arr), 95)), 1.0)
        clipped = np.clip(arr, -cap, cap)
        counts, edges = np.histogram(clipped, bins=bins, range=(-cap, cap))
        return {"counts": [int(c) for c in counts],
                "edges": [round(float(e), 0) for e in edges],
                "capped_at": round(cap, 0)}

    def _dist(arr):
        d = {f"p{p}": round(float(np.percentile(arr, p)), 0) for p in (5, 10, 25, 50, 75, 90, 95)}
        d["mean"] = round(float(arr.mean()), 0)
        d["min"] = round(float(arr.min()), 0)
        d["max"] = round(float(arr.max()), 0)
        return d

    ending_block = {
        **_dist(ending_delta),
        # "Roth wins" = trials where the with-conversion path finished with
        # more liquid wealth than the without-conversion path on the SAME
        # market seed. This is the cleanest one-liner for the paired page.
        "pct_with_wins": round(float(np.mean(ending_delta > 0)), 4),
        "pct_tie_within_1pct": round(float(np.mean(np.abs(ending_delta) < 0.01 * (np.abs(end_n) + 1))), 4),
        "histogram": _sym_hist(ending_delta),
        "n_trials": n,
    }

    lifetime_tax_block = None
    if tax_paid_w is not None and tax_paid_n is not None and len(tax_paid_w) == n and len(tax_paid_n) == n:
        tax_delta = tax_paid_w - tax_paid_n
        lifetime_tax_block = {
            **_dist(tax_delta),
            "pct_with_pays_less": round(float(np.mean(tax_delta < 0)), 4),
            "histogram": _sym_hist(tax_delta),
            "n_trials": n,
        }

    return {
        "ending_delta": ending_block,
        "lifetime_tax_delta": lifetime_tax_block,
        "both_survive_pct": round(both_alive_n / n, 4) if n else 0.0,
        "n_trials": n,
        "basis": "identical_seeds",
    }


def _deterministic_flows(config):
    """Run the locked with/without-conversion projections; return the full responses."""
    det_with = run_projection(config)
    cfg_without = copy.deepcopy(config)
    cfg_without.setdefault("roth", {})["enabled"] = False
    det_without = run_projection(cfg_without)
    return det_with, det_without


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
    sp_w, sd_w, *_ = _simulate(liquid0, *flows_w, g_shock, infl_mult, guardrail)
    sp_n, sd_n, *_ = _simulate(liquid0, *flows_n, g_shock, infl_mult, guardrail)
    return {
        "rate": round(rate, 4),
        "years": yrs,
        "success_with": round(float(np.mean(~sd_w)), 4),
        "success_without": round(float(np.mean(~sd_n)), 4),
        "base_success_with": base_success_with,
        "median_ending_with": round(float(np.median(sp_w[:, -1])), 0),
    }


def run_montecarlo(config, n_trials=500, assets=None, shock=None, seed=None, inflation=None,
                   correlation=None, engine="lognormal", anchor_to_plan=True, guardrail=None,
                   conversion_halt=None, rebalance=None):
    n = int(max(50, min(n_trials, 2000)))
    assets = assets or DEFAULT_ASSETS

    # deterministic runs lock the conversion schedule + taxes + cashflows
    det_with, det_without = _deterministic_flows(config)
    rows_w, rows_n = det_with["rows"], det_without["rows"]
    years = [r["year"] for r in rows_w]
    T = len(rows_w)

    liquid0 = _liquid_start(config)
    flows_w = _flows_split(rows_w)   # (ext, expenses, taxes)
    flows_n = _flows_split(rows_n)

    rng = np.random.default_rng(seed)
    det_infl = float(config.get("projection", {}).get("general_inflation", 0.03))
    plan_ret = _plan_return(config)
    # v3.1: per-year anchor path implied by the with-conversion deterministic plan
    # (the without-conversion sim shares the same g so the comparison stays paired).
    path = (_plan_return_path(rows_w, liquid0, flows_w, fallback=plan_ret)
            if (anchor_to_plan and plan_ret is not None) else None)
    anchor_info = {"enabled": False, "plan_return": (round(plan_ret, 4) if plan_ret is not None else None)}
    corr_info = None
    hist_info = None
    infl_source = "lognormal"

    if engine == "historical":
        # Historical block bootstrap: returns + inflation sampled jointly from 1928-2024;
        # correlations/fat-tails/mean-reversion come from the data (copula spec ignored).
        g, g_class, infl_draws, weights, geom, hist_info = _historical_factors(assets, n, T, rng)
        port_mean, port_vol = hist_info["sample_arith_mean"], hist_info["sample_vol"]
        if path is not None:
            g = g * ((1.0 + path)[None, :] / geom)
            path_geo = float(np.exp(np.mean(np.log1p(path)))) - 1.0
            anchor_info = {"enabled": True, "mode": "plan_path", "plan_return": round(plan_ret, 4),
                           "blended_mean_before": round(geom - 1.0, 4),
                           "blended_mean_after": round(path_geo, 4),
                           "path_first": round(float(path[0]), 4),
                           "path_last": round(float(path[-1]), 4)}
            port_mean = round(port_mean + (path_geo - (geom - 1.0)), 4)
        infl_on = bool(inflation and inflation.get("enabled", True)) if inflation is not None else True
        if infl_on:
            infl_mult, infl_mean, infl_vol, cum_summary = _inflation_factors(
                inflation, n, T, rng, det_infl, draws=infl_draws)
            infl_source = "historical"
        else:
            infl_mult, infl_mean, infl_vol, cum_summary = np.ones((n, T)), None, None, None
        infl_regime_info = None
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

        g, g_class, weights, port_mean, port_vol = _portfolio_factors(assets, n, T, rng, z=z_assets)
        if path is not None and anchor_info.get("enabled"):
            # flat anchor centered g on plan_ret; re-scale each YEAR onto the plan's path
            g = g * ((1.0 + path) / (1.0 + plan_ret))[None, :]
            path_geo = float(np.exp(np.mean(np.log1p(path)))) - 1.0
            anchor_info.update({
                "mode": "plan_path",
                "blended_mean_after": round(anchor_info["blended_mean_after"] + (path_geo - plan_ret), 4),
                "path_first": round(float(path[0]), 4),
                "path_last": round(float(path[-1]), 4)})
            port_mean = port_mean + (path_geo - plan_ret)
        infl_regime_info = None
        if inflation and inflation.get("enabled", True) and inflation.get("regime_switching"):
            reg_draws, reg_means, reg_vols, reg_p_stay, reg_states = _regime_inflation_draws(inflation, n, T, rng)
            infl_mult, infl_mean, infl_vol, cum_summary = _inflation_factors(
                inflation, n, T, rng, det_infl, draws=reg_draws)
            # Sampling summary — how much time was spent in each regime across all trials.
            total = float(reg_states.size)
            infl_regime_info = {
                "enabled": True,
                "p_stay": round(reg_p_stay, 4),
                "means": [round(float(x), 4) for x in reg_means],
                "vols": [round(float(x), 4) for x in reg_vols],
                "time_in_regime": {
                    "low": round(float(np.sum(reg_states == 0) / total), 4),
                    "normal": round(float(np.sum(reg_states == 1) / total), 4),
                    "high": round(float(np.sum(reg_states == 2) / total), 4),
                },
            }
        else:
            infl_mult, infl_mean, infl_vol, cum_summary = _inflation_factors(
                inflation, n, T, rng, det_infl, z=z_infl)

    gr = guardrail if (guardrail and guardrail.get("enabled")) else None
    # Rebalance cadence: if the advisor turned off annual rebalancing, rebuild g from the
    # per-class factor array with weight drift + optional periodic reset. `annual` is a
    # no-op (the pre-existing g already reflects annual re-targeting to `weights`).
    cadence = (rebalance or {}).get("cadence", "annual") if rebalance else "annual"
    if cadence not in ("annual", "biennial", "never"):
        cadence = "annual"
    rebalance_info = {"cadence": cadence}
    if cadence != "annual":
        # Preserve the anchor-to-plan adjustment: capture its multiplicative effect on the
        # annual-rebalanced g, then apply the same log-mean scaling to the drifted aggregate
        # so mean-anchoring survives.
        g_annual_ref = g.copy()
        g_drift = _apply_rebalance_cadence(g_class, weights, cadence)
        log_a = np.log(np.maximum(g_annual_ref, 1e-6)).mean(axis=1, keepdims=True)
        log_d = np.log(np.maximum(g_drift, 1e-6)).mean(axis=1, keepdims=True)
        g = g_drift * np.exp(log_a - log_d)
    # Conversion halt: only meaningful when there's an active conversion window in the plan.
    conv_mask = np.array([float(r.get("roth_conversion") or 0.0) > 0.0 for r in rows_w], dtype=bool)
    halt_active = bool(conversion_halt and conversion_halt.get("enabled") and conv_mask.any())
    halt_cfg = None
    if halt_active:
        halt_cfg = {"enabled": True,
                    "drop_threshold": float(conversion_halt.get("drop_threshold", 0.10)),
                    "resume_after_positive_years": int(conversion_halt.get("resume_after_positive_years", 0) or 0)}
    tax_no_conv = flows_n[2] if halt_active else None
    conv_amounts_arr = np.array([float(r.get("roth_conversion") or 0.0) for r in rows_w])

    paths_w, dep_w, depidx_w, cuts_w, halt_trig, halt_idx, resume_idx, extras_w = _simulate(
        liquid0, *flows_w, g, infl_mult, gr,
        halt=halt_cfg, tax_no_conv=tax_no_conv, conv_year_mask=conv_mask if halt_active else None,
        conv_amounts=conv_amounts_arr)
    # Capture the without-conversion sim's extras (tax_paid per trial) so the
    # paired A/B block below can compute a paired lifetime-tax delta on
    # identical market seeds. Prior code discarded `_*` here.
    paths_n, dep_n, depidx_n, _cn, _htn, _hin, _rin, extras_n = _simulate(liquid0, *flows_n, g, infl_mult, gr)

    guardrail_info = None
    if gr:
        _, dep_base, *_ = _simulate(liquid0, *flows_w, g, infl_mult, None)
        # cuts_w counts, per trial, how many years of discretionary spending were trimmed.
        # For symmetry with the halt reporting, expose the full distribution AND the
        # fraction of trials that ever needed a cut so advisors see the guardrail's
        # persistence (not just its success-rate lift).
        trials_with_cuts = int(np.sum(cuts_w > 0))
        guardrail_info = {
            "enabled": True,
            "cut_pct": round(float(gr.get("cut_pct", 0.10)), 4),
            "success_without_guardrail": round(float(np.mean(~dep_base)), 4),
            "success_with_guardrail": round(float(np.mean(~dep_w)), 4),
            "trials_with_cuts": trials_with_cuts,
            "trials_with_cuts_pct": round(trials_with_cuts / max(n, 1), 4),
            "median_cut_years": int(np.median(cuts_w)),
            "p10_cut_years": int(np.percentile(cuts_w, 10)),
            "p90_cut_years": int(np.percentile(cuts_w, 90)),
            "max_cut_years": int(cuts_w.max()),
            "mean_cut_years": round(float(cuts_w.mean()), 2),
        }

    # Conversion-halt reporting: what fraction of trials halted, and if so, when.
    halt_info = None
    if halt_active:
        n_trig = int(halt_trig.sum())
        trig_years = halt_idx[halt_trig]
        # Per-year trigger histogram so the UI can render a "where do the halts cluster?" chart.
        # counts[i] = number of trials whose halt fired in year years[i].
        year_counts = np.zeros(len(years), dtype=np.int64)
        if n_trig > 0:
            uniq, cnt = np.unique(trig_years, return_counts=True)
            year_counts[uniq] = cnt
        # Resume histogram: only meaningful when resume_after_positive_years > 0.
        resumed = resume_idx >= 0
        n_resumed = int(resumed.sum())
        res_years_arr = resume_idx[resumed]
        resume_counts = np.zeros(len(years), dtype=np.int64)
        if n_resumed > 0:
            uniq_r, cnt_r = np.unique(res_years_arr, return_counts=True)
            resume_counts[uniq_r] = cnt_r
        halt_info = {
            "enabled": True,
            "drop_threshold": round(halt_cfg["drop_threshold"], 4),
            "resume_after_positive_years": int(halt_cfg["resume_after_positive_years"]),
            "conversion_window_start": int(years[int(np.argmax(conv_mask))]) if conv_mask.any() else None,
            "conversion_window_end": int(years[len(conv_mask) - 1 - int(np.argmax(conv_mask[::-1]))]) if conv_mask.any() else None,
            "triggered_pct": round(n_trig / max(n, 1), 4),
            "trials_triggered": n_trig,
            "median_trigger_year": int(years[int(np.median(trig_years))]) if n_trig > 0 else None,
            "p10_trigger_year": int(years[int(np.percentile(trig_years, 10))]) if n_trig > 0 else None,
            "p90_trigger_year": int(years[int(np.percentile(trig_years, 90))]) if n_trig > 0 else None,
            "trigger_year_counts": [int(c) for c in year_counts],
            # Resume metrics — surface even when resume rule is off (counts will be zeros).
            "resumed_pct": round(n_resumed / max(n_trig, 1), 4) if n_trig > 0 else 0.0,
            "trials_resumed": n_resumed,
            "median_resume_year": int(years[int(np.median(res_years_arr))]) if n_resumed > 0 else None,
            "p10_resume_year": int(years[int(np.percentile(res_years_arr, 10))]) if n_resumed > 0 else None,
            "p90_resume_year": int(years[int(np.percentile(res_years_arr, 90))]) if n_resumed > 0 else None,
            "resume_year_counts": [int(c) for c in resume_counts],
        }

    # Outcome distributions beyond the probability-of-success headline:
    # per-trial total Roth conversions (exact under the halt state machine),
    # per-trial lifetime taxes (locked cash-flow model, halt-aware, inflation-
    # scaled), and per-trial after-tax inheritance (first-order approximation:
    # deterministic heirs-to-ending-wealth ratio applied to each trial's ending
    # wealth, minus heir tax on conversions the trial skipped).
    planned_total = float(conv_amounts_arr.sum())
    conv_paid = extras_w["conv_paid"]
    tax_paid = extras_w["tax_paid"]
    lg_det = det_with.get("legacy") or {}
    det_after_tax_heirs = float(lg_det.get("after_tax_estate_to_heirs") or 0.0)
    det_lifetime_taxes = float((det_with.get("summary") or {}).get("lifetime_taxes") or 0.0)
    last_row = rows_w[-1]
    det_end_liquid = float(sum(float(last_row.get(k) or 0.0)
                               for k in ("cash", "taxable", "traditional", "roth")))
    legacy_cfg = config.get("legacy") or {}
    heir_rate = (float(legacy_cfg.get("heir_federal_rate") or 0.3165)
                 + float(legacy_cfg.get("heir_state_rate") or 0.0))
    ending_w = paths_w[:, -1]
    heir_ratio = (det_after_tax_heirs / det_end_liquid) if det_end_liquid > 0 else None

    def _dist(arr):
        d = {f"p{p}": round(float(np.percentile(arr, p)), 0) for p in (5, 10, 25, 50, 75, 90, 95)}
        d["mean"] = round(float(arr.mean()), 0)
        return d

    conv_counts, conv_edges = np.histogram(conv_paid, bins=20, range=(0.0, max(planned_total, 1.0)))
    inherit = (np.maximum(0.0, ending_w * heir_ratio - (planned_total - conv_paid) * heir_rate)
               if heir_ratio is not None else None)
    outcome_distributions = {
        "conversions": {
            **_dist(conv_paid),
            "planned_total": round(planned_total, 0),
            "pct_trials_full_plan": round(float(np.mean(conv_paid >= planned_total - 0.5)), 4),
            "histogram": {"counts": [int(c) for c in conv_counts],
                          "edges": [round(float(e), 0) for e in conv_edges]},
            "basis": "exact",
        },
        "lifetime_taxes": {
            **_dist(tax_paid),
            "det_value": round(det_lifetime_taxes, 0),
            "basis": "model_locked",
        },
        "after_tax_inheritance": ({
            **_dist(inherit),
            "det_value": round(det_after_tax_heirs, 0),
            "heir_rate": round(heir_rate, 4),
            "basis": "approximation",
        } if inherit is not None else None),
        "halt_active": halt_active,
    }

    result = {
        "years": years,
        "n_trials": n,
        "engine": engine,
        "plan_return": (round(plan_ret, 4) if plan_ret is not None else None),
        "anchor": anchor_info,
        "historical": hist_info,
        "guardrail": guardrail_info,
        "conversion_halt": halt_info,
        "outcome_distributions": outcome_distributions,
        "rebalance": rebalance_info,
        "allocation": {"stocks": round(float(weights[0]), 4), "bonds": round(float(weights[1]), 4), "cash": round(float(weights[2]), 4)},
        "assets": assets,
        "portfolio_mean": round(float(port_mean), 4),
        "portfolio_vol": round(float(port_vol), 4),
        "liquid_start": round(liquid0, 0),
        "with_conversions": _summarize(paths_w, dep_w, depidx_w, years),
        "without_conversions": _summarize(paths_n, dep_n, depidx_n, years),
        "paired_delta": _paired_delta(paths_w, paths_n, dep_w, dep_n,
                                       extras_w.get("tax_paid"), extras_n.get("tax_paid"),
                                       extras_w.get("conv_paid")),
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
            "regime_switching": infl_regime_info,
        }

    if shock and shock.get("enabled"):
        result["shock"] = _shock_run(shock, g, liquid0, flows_w, flows_n, infl_mult, T,
                                     result["with_conversions"]["success"], gr)

    return result

    return result
