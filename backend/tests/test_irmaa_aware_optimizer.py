"""Regression tests for the IRMAA-cliff-aware Roth-conversion optimizer.

Verifies that when `irmaa_aware=True`, the optimizer never returns a
conversion amount that would push the resulting MAGI within
`irmaa_cliff_buffer` of the next IRMAA tier threshold.
"""
import pytest

from tax_engine import optimize_conversion, irmaa_thresholds, compute_year_tax


def _base_inputs():
    """A retiree just under the 1st IRMAA tier ($218,000 MFJ in 2024) so a fill-24%
    conversion normally pushes them well over the cliff."""
    return {
        "filing_status": "MFJ",
        "year": 2027,
        "bracket_index": 1.0,
        "irmaa_index": 1.0,
        "num65": 2,
        "medicare_count": 2,
        "include_irmaa": True,
        "part_b_base": 174.70,
        "part_d_base": 55.0,
        "state_rate": 0.05,
        "ordinary_non_ss": 210_000.0,
        "gross_ss": 0.0,
        "recurring_div": 0.0,
        "realized_ltcg": 0.0,
        "cash_interest": 0.0,
        "rmd_total": 0.0,
        "ira_distributions": 0.0,
    }


def test_naive_optimizer_pushes_magi_over_first_irmaa_tier():
    """Sanity check: without IRMAA-awareness the optimizer crashes through the 1st tier."""
    inp = _base_inputs()
    res = optimize_conversion(inp, target_rate=0.24, irmaa_aware=False)
    assert res["recommended_conversion"] > 0, "should have some headroom"
    magi_after = res["after"]["magi"]
    tier1 = irmaa_thresholds(True, 1.0)[0]
    assert magi_after > tier1, f"naive optimizer should exceed tier1 ({tier1}); got {magi_after}"


def test_irmaa_aware_keeps_magi_below_first_tier_minus_buffer():
    """IRMAA-aware optimizer must clip conversion so MAGI stays at least $3K below the next tier."""
    inp = _base_inputs()
    buffer = 3000.0
    res = optimize_conversion(inp, target_rate=0.24, irmaa_aware=True, irmaa_cliff_buffer=buffer)
    tier1 = irmaa_thresholds(True, 1.0)[0]
    magi_after = res["after"]["magi"]
    assert magi_after <= tier1 - buffer + 0.01, \
        f"IRMAA-aware should keep MAGI <= {tier1 - buffer}; got {magi_after}"
    assert res["irmaa_aware"] is True
    assert res["avoided_irmaa_cliff"] is not None
    assert res["avoided_irmaa_cliff"]["threshold"] == pytest.approx(tier1)
    assert res["avoided_irmaa_cliff"]["buffer"] == buffer
    assert res["avoided_irmaa_cliff"]["avoided_conversion_amount"] > 0


def test_irmaa_aware_matches_naive_when_no_cliff_in_range():
    """If the household's headroom + base MAGI is deep below the next tier, both modes agree."""
    inp = _base_inputs()
    # target 12% bracket → very small ceiling ($23,200) → MAGI after conversion stays far below tier1 $218K
    inp["ordinary_non_ss"] = 10_000.0
    naive = optimize_conversion(inp, target_rate=0.12, irmaa_aware=False)
    aware = optimize_conversion(inp, target_rate=0.12, irmaa_aware=True)
    assert naive["recommended_conversion"] == aware["recommended_conversion"]
    assert aware["avoided_irmaa_cliff"] is None


def test_irmaa_aware_no_effect_when_include_irmaa_off():
    """If the plan disables IRMAA entirely, irmaa_aware must not change the recommendation."""
    inp = _base_inputs()
    inp["include_irmaa"] = False
    naive = optimize_conversion(inp, target_rate=0.24, irmaa_aware=False)
    aware = optimize_conversion(inp, target_rate=0.24, irmaa_aware=True)
    assert naive["recommended_conversion"] == aware["recommended_conversion"]
    assert aware["avoided_irmaa_cliff"] is None


def test_irmaa_aware_respects_buffer_size():
    """Larger buffer → smaller recommended conversion (more headroom preserved)."""
    inp = _base_inputs()
    # base income $200K MFJ; 24% ceiling = $383.9K, plenty of headroom to force cliff crossing
    inp["ordinary_non_ss"] = 200_000.0
    small = optimize_conversion(inp, target_rate=0.24, irmaa_aware=True, irmaa_cliff_buffer=1000.0)
    large = optimize_conversion(inp, target_rate=0.24, irmaa_aware=True, irmaa_cliff_buffer=10_000.0)
    assert small["recommended_conversion"] > large["recommended_conversion"]
    tier1 = irmaa_thresholds(True, 1.0)[0]
    assert small["after"]["magi"] <= tier1 - 1000.0 + 0.01
    assert large["after"]["magi"] <= tier1 - 10_000.0 + 0.01


def test_irmaa_aware_single_filer():
    """Single-filer tier1 = $109,000 (2024 statutory). Verify the guardrail works there too."""
    inp = _base_inputs()
    inp["filing_status"] = "Single"
    inp["ordinary_non_ss"] = 100_000.0
    inp["num65"] = 1
    inp["medicare_count"] = 1
    res = optimize_conversion(inp, target_rate=0.24, irmaa_aware=True, irmaa_cliff_buffer=3000.0)
    single_tier1 = irmaa_thresholds(False, 1.0)[0]
    assert single_tier1 == 109_000.0  # sanity check the statutory constant
    assert res["after"]["magi"] <= single_tier1 - 3000.0 + 0.01
