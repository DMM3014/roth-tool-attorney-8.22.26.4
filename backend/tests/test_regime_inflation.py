"""Regression tests for the regime-switching stochastic inflation feature in Monte Carlo."""
import copy

import numpy as np
import pytest

from montecarlo import run_montecarlo
from defaults import DEFAULT_SCENARIO


def _base_config():
    """Deep-copy the shipped DEFAULT_SCENARIO so we don't mutate module-level state."""
    return copy.deepcopy(DEFAULT_SCENARIO)


def test_regime_switching_produces_inflation_block_with_regime_info():
    cfg = _base_config()
    inflation = {
        "enabled": True, "mean": 0.03, "vol": 0.015, "regime_switching": True,
        "regime_low":    {"mean": 0.020, "vol": 0.008},
        "regime_normal": {"mean": 0.035, "vol": 0.014},
        "regime_high":   {"mean": 0.060, "vol": 0.025},
        "regime_p_stay": 0.85,
    }
    res = run_montecarlo(cfg, n_trials=300, inflation=inflation, engine="lognormal", seed=42)
    infl = res["inflation"]
    assert infl["enabled"] is True
    reg = infl["regime_switching"]
    assert reg is not None
    assert reg["p_stay"] == pytest.approx(0.85)
    assert len(reg["means"]) == 3
    assert reg["means"][0] < reg["means"][1] < reg["means"][2]
    assert reg["vols"][0] > 0
    total_time = sum(reg["time_in_regime"].values())
    assert total_time == pytest.approx(1.0, abs=0.01)
    # With p_stay=0.85 and symmetric off-diag=0.075, the stationary distribution is
    # uniform (1/3 each) because the chain is symmetric.
    for k in ("low", "normal", "high"):
        assert 0.20 < reg["time_in_regime"][k] < 0.46, \
            f"expected ~1/3 time in {k}, got {reg['time_in_regime'][k]}"


def test_regime_switching_off_matches_prior_behavior():
    cfg = _base_config()
    inflation = {"enabled": True, "mean": 0.03, "vol": 0.015, "regime_switching": False}
    res = run_montecarlo(cfg, n_trials=200, inflation=inflation, engine="lognormal", seed=42)
    assert res["inflation"]["enabled"] is True
    assert res["inflation"]["regime_switching"] is None


def test_regime_higher_pstay_means_stickier_regimes():
    """With p_stay=0.98 the chain rarely leaves its starting regime (Normal) → time_in_regime.normal >> time_in_low/high."""
    cfg = _base_config()
    sticky = {
        "enabled": True, "mean": 0.03, "vol": 0.015, "regime_switching": True,
        "regime_low":    {"mean": 0.020, "vol": 0.008},
        "regime_normal": {"mean": 0.035, "vol": 0.014},
        "regime_high":   {"mean": 0.060, "vol": 0.025},
        "regime_p_stay": 0.98,
    }
    res = run_montecarlo(cfg, n_trials=300, inflation=sticky, engine="lognormal", seed=7)
    tir = res["inflation"]["regime_switching"]["time_in_regime"]
    assert tir["normal"] > 0.60, f"expected >60% in Normal with sticky chain; got {tir['normal']}"


def test_regime_realized_inflation_reasonable():
    """With ~1/3 time in each regime (symmetric p_stay=0.85), the realized long-run
    annualized inflation should sit close to the equal-weighted regime mean (≈3.83%)."""
    cfg = _base_config()
    infl = {
        "enabled": True, "mean": 0.03, "vol": 0.015, "regime_switching": True,
        "regime_low":    {"mean": 0.020, "vol": 0.008},
        "regime_normal": {"mean": 0.035, "vol": 0.014},
        "regime_high":   {"mean": 0.060, "vol": 0.025},
        "regime_p_stay": 0.85,
    }
    res = run_montecarlo(cfg, n_trials=800, inflation=infl, engine="lognormal", seed=11)
    cum = res["inflation"]["cumulative"]  # cumulative NOMINAL price level percentiles
    T = len(cum["p50"])
    # (1+π_annualized)^T = median cumulative multiplier
    realized_median_annualized = (cum["p50"][-1]) ** (1.0 / T) - 1.0
    # Expected ~3.83% (equal-weighted 2%/3.5%/6%). Wide-ish tolerance for Monte Carlo noise.
    assert 0.028 < realized_median_annualized < 0.048, \
        f"realized annualized inflation out of expected range for symmetric regimes: {realized_median_annualized}"
