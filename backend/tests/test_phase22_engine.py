"""Phase 22 — Monte Carlo v3.0 engine tests.

(1) BASELINE FIX  — anchor-to-plan: simulated central tendency matches the plan's own
    liquid-weighted return; unanchored mode reproduces the old v2.2 blend.
(2) HISTORICAL ENGINE — stationary block bootstrap over real US 1928-2024 data.
(4) FAILURE REPORTING + GUARDRAIL — failure anatomy block, survivor-only histogram,
    Guyton-Klinger-lite spending cuts.
Pure engine tests — no HTTP.
"""
import copy
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from defaults import DEFAULT_SCENARIO
from montecarlo import run_montecarlo, _bootstrap_indices, _plan_return
from historical_data import HIST, HIST_YEARS


def _tight_cfg():
    """A stressed household (25% of the taxable/cash assets) that produces failures."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    for a in cfg["accounts"]:
        if a["tax_type"] in ("Taxable", "Cash"):
            a["beginning_balance"] *= 0.25
    return cfg


# ---------------- (1) anchor-to-plan ----------------

def test_plan_return_is_liquid_weighted():
    r = _plan_return(copy.deepcopy(DEFAULT_SCENARIO))
    assert abs(r - 0.066667) < 1e-4  # 1M@3% + 11M@7% / 12M


def test_anchor_on_by_default_and_recenters():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=400, seed=42)
    assert a["anchor"]["enabled"] is True
    assert abs(a["anchor"]["plan_return"] - 0.0667) < 1e-3
    # arithmetic target = plan + port_var/2 > raw 6.3% blend
    assert a["portfolio_mean"] > 0.066
    assert a["engine"] == "lognormal"


def test_unanchored_reproduces_v22_blend():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    u = run_montecarlo(cfg, n_trials=400, seed=42, anchor_to_plan=False)
    assert u["anchor"]["enabled"] is False
    assert abs(u["portfolio_mean"] - 0.063) < 1e-3  # raw 60/30/10 @ 8/4/3


def test_anchor_improves_success_vs_unanchored():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=500, seed=42)
    u = run_montecarlo(cfg, n_trials=500, seed=42, anchor_to_plan=False)
    assert a["with_conversions"]["success"] > u["with_conversions"]["success"]


# ---------------- (2) historical block-bootstrap engine ----------------

def test_historical_dataset_integrity():
    assert HIST_YEARS[0] == 1928 and HIST_YEARS[-1] == 2024
    assert all(len(HIST[k]) == 97 for k in ("stocks", "bonds", "cash", "inflation"))
    # spot-check canonical years
    assert abs(HIST["stocks"][HIST_YEARS.index(2008)] + 0.3655) < 1e-4
    assert abs(HIST["bonds"][HIST_YEARS.index(2022)] + 0.1783) < 1e-4
    assert abs(HIST["inflation"][HIST_YEARS.index(1979)] - 0.133) < 1e-3


def test_historical_engine_runs_and_reports():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    h = run_montecarlo(cfg, n_trials=400, seed=42, engine="historical")
    assert h["engine"] == "historical"
    assert h["historical"]["years_span"] == "1928-2024"
    assert h["historical"]["avg_block_years"] == 10
    # anchored by default: sample geometric ~8.2% recentered onto plan 6.67%
    assert h["anchor"]["enabled"] is True
    assert h["anchor"]["mode"] == "plan_path"
    # v3.1 path anchor: geometric mean of the plan-implied path (≈6.7% yr-1 → ≈7% late)
    assert 0.064 <= h["anchor"]["blended_mean_after"] <= 0.073
    # inflation sampled jointly from history
    assert h["inflation"]["source"] == "historical"
    assert 0.0 <= h["with_conversions"]["success"] <= 1.0


def test_historical_seed_reproducible_and_copula_ignored():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=300, seed=9, engine="historical")
    b = run_montecarlo(cfg, n_trials=300, seed=9, engine="historical",
                       correlation={"enabled": True, "stocks_bonds": 0.9})
    assert a["with_conversions"] == b["with_conversions"]
    assert a["correlation"] is None and b["correlation"] is None


def test_block_bootstrap_continuation_rate():
    rng = np.random.default_rng(1)
    idx = _bootstrap_indices(2000, 30, 97, rng)
    cont = float(np.mean((idx[:, 1:] - idx[:, :-1]) % 97 == 1))
    assert 0.87 < cont < 0.93  # expected 1 - 1/avg_block = 0.9


def test_historical_inflation_can_be_disabled():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    h = run_montecarlo(cfg, n_trials=200, seed=5, engine="historical",
                       inflation={"enabled": False, "mean": 0.03, "vol": 0.0})
    assert h["inflation"] is None


# ---------------- (4) guardrail + failure anatomy ----------------

def test_guardrail_never_hurts_success():
    cfg = _tight_cfg()
    base = run_montecarlo(cfg, n_trials=500, seed=7, anchor_to_plan=False)
    gr = run_montecarlo(cfg, n_trials=500, seed=7, anchor_to_plan=False,
                        guardrail={"enabled": True, "cut_pct": 0.10})
    info = gr["guardrail"]
    assert info["enabled"] and info["cut_pct"] == 0.10
    assert info["success_with_guardrail"] >= info["success_without_guardrail"]
    # baseline inside the guardrail report equals an actual no-guardrail run
    assert abs(info["success_without_guardrail"] - base["with_conversions"]["success"]) < 1e-9


def test_guardrail_disabled_matches_none():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=200, seed=3)
    b = run_montecarlo(cfg, n_trials=200, seed=3, guardrail={"enabled": False, "cut_pct": 0.10})
    assert a["with_conversions"] == b["with_conversions"]
    assert a["guardrail"] is None and b["guardrail"] is None


def test_failure_anatomy_consistent():
    cfg = _tight_cfg()
    r = run_montecarlo(cfg, n_trials=500, seed=7, anchor_to_plan=False)
    wc = r["with_conversions"]
    f = wc["failure"]
    assert f is not None and f["count"] == wc["ending"]["depleted"] > 0
    assert r["years"][0] <= f["p10_year"] <= f["median_year"] <= f["p90_year"] <= r["years"][-1]
    assert f["median_years_unfunded"] >= 0
    assert f["horizon_end"] == r["years"][-1]


def test_histogram_survivors_only():
    cfg = _tight_cfg()
    r = run_montecarlo(cfg, n_trials=500, seed=7, anchor_to_plan=False)
    wc = r["with_conversions"]
    assert wc["histogram"]["survivors_only"] is True
    assert sum(wc["histogram"]["counts"]) == 500 - wc["ending"]["depleted"]


def test_no_failures_no_failure_block():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    r = run_montecarlo(cfg, n_trials=200, seed=11, engine="historical")
    wc = r["with_conversions"]
    if wc["ending"]["depleted"] == 0:
        assert wc["failure"] is None
        assert sum(wc["histogram"]["counts"]) == 200
