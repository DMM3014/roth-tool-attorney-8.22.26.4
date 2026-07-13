"""Phase 25 — Monte Carlo v3.1: time-varying anchor-to-plan + P5/P95 percentile reporting.

The v3.0 anchor used a single flat plan return (beginning-balance blend), which understated
the plan's compounding as the low-yield cash slice shrank. v3.1 anchors each simulated year
to the return path implied by the deterministic projection's own liquid balances.
Pure engine tests — no HTTP.
"""
import copy
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from defaults import DEFAULT_SCENARIO
from montecarlo import run_montecarlo, _plan_return_path, _flows_split, _liquid_start
from projection import run_projection

TINY_VOL = {
    "stocks": {"weight": 0.60, "mean": 0.08, "vol": 1e-6},
    "bonds": {"weight": 0.30, "mean": 0.04, "vol": 1e-6},
    "cash": {"weight": 0.10, "mean": 0.03, "vol": 1e-6},
}


def _det_ending_liquid(cfg):
    r = run_projection(cfg)["rows"][-1]
    return r["cash"] + r["taxable"] + r["traditional"] + r["roth"]


def test_plan_return_path_reproduces_deterministic_liquid():
    """Running the MC recursion at exactly the implied path must land on the plan's ending."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    rows = run_projection(cfg)["rows"]
    flows = _flows_split(rows)
    L = _liquid_start(cfg)
    path = _plan_return_path(rows, L, flows)
    ext, exp, tax = flows
    for t in range(len(rows)):
        L = L * (1.0 + path[t]) + (ext[t] - (exp[t] + tax[t]))
    det_end = _det_ending_liquid(cfg)
    assert abs(L - det_end) < 1.0


def test_path_drifts_up_as_cash_share_shrinks():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    rows = run_projection(cfg)["rows"]
    path = _plan_return_path(rows, _liquid_start(cfg), _flows_split(rows))
    assert path[-1] > path[0]          # 3% cash slice shrinks -> blend climbs toward 7%
    assert 0.06 < path[0] < 0.075 and 0.06 < path[-1] < 0.075


def test_zero_vol_anchored_mc_reproduces_plan():
    """With ~zero volatility and no stochastic inflation, the anchored MC median must
    match the deterministic plan's ending liquid balance — THE fix for 'MC looks low'."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    det_end = _det_ending_liquid(cfg)
    r = run_montecarlo(cfg, n_trials=50, seed=1, assets=copy.deepcopy(TINY_VOL),
                       inflation={"enabled": False})
    mc_end = r["with_conversions"]["ending"]["p50"]
    assert abs(mc_end - det_end) / det_end < 0.01


def test_median_no_longer_structurally_understated():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    det_end = _det_ending_liquid(cfg)
    r = run_montecarlo(cfg, n_trials=2000, seed=42)
    mc_end = r["with_conversions"]["ending"]["p50"]
    # volatility-cashflow interaction keeps the median a bit under plan, but the old
    # flat-anchor structural bias (median ~20% below plan) must be gone
    assert mc_end > det_end * 0.80


def test_percentiles_include_p5_p95_and_are_ordered():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    r = run_montecarlo(cfg, n_trials=200, seed=3)
    for branch in ("with_conversions", "without_conversions"):
        b = r[branch]
        for p in ("p5", "p10", "p25", "p50", "p75", "p90", "p95"):
            assert p in b["percentiles"]
            assert len(b["percentiles"][p]) == len(r["years"])
        e = b["ending"]
        assert e["p5"] <= e["p10"] <= e["p25"] <= e["p50"] <= e["p75"] <= e["p90"] <= e["p95"]


def test_lognormal_anchor_reports_plan_path_mode():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    r = run_montecarlo(cfg, n_trials=200, seed=5)
    a = r["anchor"]
    assert a["enabled"] is True and a["mode"] == "plan_path"
    assert a["path_last"] >= a["path_first"]
    assert abs(a["plan_return"] - 0.0667) < 1e-3


def test_historical_anchor_reports_plan_path_mode():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    h = run_montecarlo(cfg, n_trials=200, seed=6, engine="historical")
    assert h["anchor"]["mode"] == "plan_path"
    assert h["anchor"]["path_last"] >= h["anchor"]["path_first"]


def test_anchor_off_has_no_path_scaling():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    u = run_montecarlo(cfg, n_trials=200, seed=4, anchor_to_plan=False)
    assert u["anchor"]["enabled"] is False
    assert "mode" not in u["anchor"]


def test_seed_reproducible_with_path_anchor():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=300, seed=9)
    b = run_montecarlo(cfg, n_trials=300, seed=9)
    assert a["with_conversions"] == b["with_conversions"]
