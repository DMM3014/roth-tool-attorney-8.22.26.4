"""Present-value audit: every comparison endpoint must return a today's-dollars
(NPV) twin beside each nominal headline delta, and — for a positive multi-decade
figure — the discounted twin must be strictly smaller than the nominal one.

One assertion block per comparison surface: funding-order compare, regime
deterministic, audit mode, mortality timing, and the legacy/SECURE beneficiary
band. Also confirms the shared discount helper is the single source of truth.
"""
import copy

import pytest

from defaults import DEFAULT_SCENARIO
from projection import (
    audit_compare, discount_factor, funding_order_compare, heir_rate_sensitivity,
    lifetime_tax_present_value, mortality_timing_compare, plan_discount_rate,
    plan_start_year, present_value, regime_deterministic_compare,
)


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


# --- shared helper is the single source of truth --------------------------
def test_shared_discount_helpers_consistent():
    cfg = _cfg()
    start = plan_start_year(cfg)
    rate = plan_discount_rate(cfg)
    # A dollar 30 years out is worth less than a dollar today.
    f = discount_factor(start + 30, start, rate)
    assert 0 < f < 1
    assert present_value(1_000_000, start + 30, start, rate) == pytest.approx(1_000_000 * f)
    # Unknown year → no discount.
    assert discount_factor(None, start, rate) == 1.0
    # NPV of a positive multi-year tax stream is positive.
    rows = [{"year": start + i, "total_tax": 10_000} for i in range(30)]
    assert 0 < lifetime_tax_present_value(rows, start, rate) < 30 * 10_000


# --- funding-order compare -------------------------------------------------
def test_funding_order_compare_pv_twins():
    res = funding_order_compare(_cfg())
    assert res["results"]
    for r in res["results"]:
        # lifetime tax NPV present and below the nominal (multi-decade stream).
        assert "lifetime_tax_npv" in r and "lifetime_tax_nominal" in r
        if (r["lifetime_tax_nominal"] or 0) > 1:
            assert r["lifetime_tax_npv"] < r["lifetime_tax_nominal"]
        # after-tax to heirs delivered decades out → today's twin is smaller.
        assert "after_tax_to_heirs_secure10_today" in r
        if (r["after_tax_to_heirs_secure10"] or 0) > 1:
            assert r["after_tax_to_heirs_secure10_today"] < r["after_tax_to_heirs_secure10"]
        assert "net_worth_at_second_death_today" in r


# --- regime deterministic outcomes ----------------------------------------
def test_regime_deterministic_pv_twins():
    res = regime_deterministic_compare(_cfg())
    assert res["rows"]
    saw_positive = False
    for r in res["rows"]:
        assert "conversion_delta_to_heirs_nominal" in r
        assert "conversion_delta_to_heirs_today" in r
        nom = r["conversion_delta_to_heirs_nominal"]
        tdy = r["conversion_delta_to_heirs_today"]
        assert abs(tdy) <= abs(nom) + 0.01
        if abs(nom) > 1:
            assert abs(tdy) < abs(nom)
            saw_positive = True
    assert saw_positive


# --- audit mode ------------------------------------------------------------
def test_audit_mode_pv_twins():
    review = _cfg()
    planner = _cfg()
    planner.setdefault("roth", {})["enabled"] = False  # forces a multi-decade heirs delta
    res = audit_compare(review, planner)
    deltas = res["outcomes"]["deltas"]
    # Every headline delta carries a today's-dollars twin.
    for k, d in deltas.items():
        assert "delta_nominal" in d and "delta_today" in d
    # A future-anchored metric with a clearly positive gap discounts smaller.
    heirs = deltas["after_tax_to_heirs_secure10"]
    assert abs(heirs["delta_nominal"]) > 1
    assert abs(heirs["delta_today"]) < abs(heirs["delta_nominal"])
    # lifetime_tax_npv is already a present value → its twin equals the nominal.
    assert deltas["lifetime_tax_npv"]["delta_today"] == deltas["lifetime_tax_npv"]["delta_nominal"]


# --- mortality timing ------------------------------------------------------
def test_mortality_timing_pv_twins():
    res = mortality_timing_compare(_cfg())
    assert res["rows"]
    saw = False
    for r in res["rows"]:
        assert "conversion_delta_nominal" in r and "conversion_delta_today" in r
        nom, tdy = r["conversion_delta_nominal"], r["conversion_delta_today"]
        assert abs(tdy) <= abs(nom) + 0.01
        if abs(nom) > 1:
            assert abs(tdy) < abs(nom)
            saw = True
    assert saw


# --- legacy / SECURE beneficiary band -------------------------------------
def test_heir_rate_sensitivity_pv_twins():
    res = heir_rate_sensitivity(_cfg())
    assert "discount_rate" in res and "heir_deliver_year" in res
    for branch in res["branches"].values():
        for e in branch:
            assert "after_tax_estate_to_heirs_today" in e
            if (e["after_tax_estate_to_heirs"] or 0) > 1:
                assert e["after_tax_estate_to_heirs_today"] < e["after_tax_estate_to_heirs"]
