"""Phase 64 — deterministic (single-path) regime comparison.

`regime_deterministic_compare` re-runs the FULL projection under each named market
regime (both with- and no-conversions branches) and returns net worth at second
death, after-tax wealth to heirs at the SECURE-window end, and the conversion delta
in nominal + today's dollars. The 'Long-term Average' (historical_avg) regime must
reproduce the baseline plan's headline numbers EXACTLY.
"""
import copy

import pytest

from defaults import DEFAULT_SCENARIO
from projection import run_projection, regime_deterministic_compare
from market_scenarios import PRESETS


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def _row(res, pid):
    return next(r for r in res["rows"] if r["preset_id"] == pid)


def test_all_named_regimes_returned():
    res = regime_deterministic_compare(_cfg())
    ids = {r["preset_id"] for r in res["rows"]}
    # 'custom' is a no-op passthrough (== baseline) and is excluded, matching the MC table.
    assert ids == {pid for pid in PRESETS.keys() if pid != "custom"}
    assert "custom" not in ids
    # Every row carries both branches + both delta representations.
    for r in res["rows"]:
        assert "net_worth_at_second_death" in r["with_conversions"]
        assert "after_tax_to_heirs_secure10" in r["with_conversions"]
        assert "after_tax_to_heirs_secure10" in r["no_conversions"]
        assert "conversion_delta_to_heirs_nominal" in r
        assert "conversion_delta_to_heirs_today" in r


def test_historical_avg_equals_baseline_exactly():
    """The Long-term Average regime row must equal the baseline plan's existing
    headline numbers to the cent (DEFAULT_SCENARIO already uses 7%/3%/3% = historical_avg)."""
    base = run_projection(_cfg())
    leg = base["legacy"]
    res = regime_deterministic_compare(_cfg())
    ha = _row(res, "historical_avg")["with_conversions"]
    assert ha["net_worth_at_second_death"] == leg["gross_estate"]
    assert ha["after_tax_to_heirs_secure10"] == leg["after_tax_estate_to_heirs"]
    assert ha["lifetime_taxes"] == base["summary"]["lifetime_taxes"]


def test_no_conversion_branch_differs_and_delta_is_consistent():
    res = regime_deterministic_compare(_cfg())
    r = _row(res, "historical_avg")
    w = r["with_conversions"]["after_tax_to_heirs_secure10"]
    n = r["no_conversions"]["after_tax_to_heirs_secure10"]
    assert r["conversion_delta_to_heirs_nominal"] == pytest.approx(round(w - n, 2), abs=0.01)
    # Today's dollars discounts the nominal delta by the regime CPI over deliver-year span.
    yrs = res["heir_deliver_year"] - res["start_year"]
    disc = r["general_inflation"]
    expected_today = (w - n) / ((1 + disc) ** yrs)
    assert r["conversion_delta_to_heirs_today"] == pytest.approx(round(expected_today, 2), rel=1e-6)


def test_stagflation_shifts_outcomes_vs_baseline():
    """A different regime must produce genuinely different dollars — proving it re-runs
    the full projection rather than scaling the baseline."""
    res = regime_deterministic_compare(_cfg())
    ha = _row(res, "historical_avg")["with_conversions"]["after_tax_to_heirs_secure10"]
    stag = _row(res, "70s_stagflation")["with_conversions"]["after_tax_to_heirs_secure10"]
    assert stag != ha


def test_cache_returns_same_object():
    cfg = _cfg()
    a = regime_deterministic_compare(cfg)
    b = regime_deterministic_compare(copy.deepcopy(cfg))
    assert a is b  # cached per config hash
