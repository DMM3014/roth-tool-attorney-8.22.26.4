"""Phase 45 — 2026 state rate updates + CPI-driven exclusion indexing.

Locks in the three fixes shipped 2026-02-12:

  1. Six flat-rate states updated to their statutory 2026 rates
     (NC 3.99, KY 3.5, IN 2.95, GA 4.99, UT 4.45, LA remains 3.0).
  2. Federal + state estate exclusions now index at the model's assumed CPI
     (config.projection.general_inflation), matching the spreadsheet's single
     BracketInfl variable — no more hardcoded 2.4% chained-CPI or per-state
     override rates.
  3. Legislatively-frozen state exclusions (IL, MA, MD, MN, OR, VT) remain
     frozen regardless of the indexing_rate parameter (statutory reality).
"""
import copy
import pytest

from defaults import DEFAULT_SCENARIO
from projection import run_projection
from state_tax import STATE_TAX_RULES
from estate import (
    fed_exclusion, state_exclusion, project_estate,
    FED_EXCLUSION_BASE, DEFAULT_INDEXING_RATE,
)


# ------------------------------- 2026 state rates ------------------------- #

EXPECTED_2026_FLAT_RATES = {
    "NC": 0.0399,
    "KY": 0.035,
    "IN": 0.0295,
    "UT": 0.0445,
    "LA": 0.03,
    # Georgia uses the GA_FLAT constant → 4.99% for 2026
    "GA": 0.0499,
}


@pytest.mark.parametrize("code,expected", EXPECTED_2026_FLAT_RATES.items())
def test_state_flat_rate_matches_2026(code, expected):
    s = STATE_TAX_RULES[code]
    assert s["type"] == "flat", f"{code} should be flat"
    assert s["flat_rate"] == pytest.approx(expected, abs=1e-5), (
        f"{code} flat_rate={s['flat_rate']} but 2026 statutory = {expected}"
    )


# ------------------------------- Federal exclusion indexing ---------------- #

def test_fed_exclusion_uses_default_when_no_rate_supplied():
    """No rate → DEFAULT_INDEXING_RATE (3%) applies from the $15M/2026 base."""
    v = fed_exclusion(2027)
    assert v == pytest.approx(FED_EXCLUSION_BASE * (1 + DEFAULT_INDEXING_RATE), rel=1e-6)


@pytest.mark.parametrize("rate,years,expected_multiplier", [
    (0.024, 10, 1.024 ** 10),  # legacy chained-CPI
    (0.03,  10, 1.03  ** 10),  # default 3%
    (0.05,  10, 1.05  ** 10),  # high-inflation scenario
    (0.0,   10, 1.0),          # statutory freeze
])
def test_fed_exclusion_follows_model_cpi(rate, years, expected_multiplier):
    v = fed_exclusion(2026 + years, indexing_rate=rate)
    assert v == pytest.approx(FED_EXCLUSION_BASE * expected_multiplier, rel=1e-6)


# ------------------------------- State exclusion indexing ------------------ #

def test_state_exclusion_indexed_states_follow_model_cpi():
    """CT, DC, HI, ME, NY, RI, WA all have `indexed=True` — must index at the
    passed CPI, not any historical/legislative override rate."""
    for code in ["CT", "DC", "HI", "ME", "NY", "RI", "WA"]:
        v_default = state_exclusion(code, 2035)
        v_3pct    = state_exclusion(code, 2035, indexing_rate=0.03)
        v_5pct    = state_exclusion(code, 2035, indexing_rate=0.05)
        # 3% default should match explicit 3%
        assert v_default == pytest.approx(v_3pct, rel=1e-6), f"{code} default != 3%"
        # 5% must grow larger than 3%
        assert v_5pct > v_3pct, f"{code} did not grow faster at 5%"


def test_state_exclusion_frozen_states_ignore_cpi():
    """IL / MA / MD / MN / OR / VT are STATUTORILY frozen — indexing_rate must
    be a no-op regardless of the value passed."""
    for code in ["IL", "MA", "MD", "MN", "OR", "VT"]:
        v_0 = state_exclusion(code, 2035, indexing_rate=0.0)
        v_5 = state_exclusion(code, 2035, indexing_rate=0.05)
        v_none = state_exclusion(code, 2035)
        assert v_0 == v_5 == v_none, f"{code} varied with indexing_rate — expected freeze"


# ------------------------------- Projection engine ------------------------- #

def test_projection_bracket_indexing_defaults_to_general_inflation():
    """When bracket_indexing is not set, the engine must fall back to the
    model's general_inflation — same convention as the spreadsheet."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    cfg["projection"]["general_inflation"] = 0.05
    cfg["projection"].pop("bracket_indexing", None)
    cfg["projection"].pop("irmaa_indexing", None)
    r_5 = run_projection(cfg)

    cfg2 = copy.deepcopy(DEFAULT_SCENARIO)
    cfg2["projection"]["general_inflation"] = 0.02
    cfg2["projection"].pop("bracket_indexing", None)
    cfg2["projection"].pop("irmaa_indexing", None)
    r_2 = run_projection(cfg2)

    # Higher inflation → higher bracket ceilings → lower lifetime tax.
    assert r_5["summary"]["lifetime_taxes"] < r_2["summary"]["lifetime_taxes"], (
        "5% inflation should produce lower lifetime tax than 2% (wider brackets)"
    )


def test_project_estate_threads_indexing_rate():
    """project_estate must accept an indexing_rate and use it for BOTH the
    federal exclusion and any indexed state's exclusion."""
    r1 = project_estate(
        first_death_year=2050, second_death_year=2055,
        deceased_roth_at_y1=5e6, deceased_taxable_at_y1=5e6,
        survivor_roth_at_y1=5e6, survivor_taxable_at_y1=5e6,
        traditional_at_y1=0.0,
        trust_growth_rate=0.06, survivor_growth_rate=0.06,
        heir_marginal_rate=0.3165, state_code="",
        indexing_rate=0.02, use_portability=True,
    )
    r2 = project_estate(
        first_death_year=2050, second_death_year=2055,
        deceased_roth_at_y1=5e6, deceased_taxable_at_y1=5e6,
        survivor_roth_at_y1=5e6, survivor_taxable_at_y1=5e6,
        traditional_at_y1=0.0,
        trust_growth_rate=0.06, survivor_growth_rate=0.06,
        heir_marginal_rate=0.3165, state_code="",
        indexing_rate=0.06, use_portability=True,
    )
    # 6% CPI grows the $15M base to ~$42.8M by 2055 (fed) — no federal estate
    # tax owed. 2% CPI grows it to only ~$25.8M — still no fed tax on $20M
    # household but the exclusion figure exposed on the response must differ.
    assert r2["fed_exclusion_y2"] > r1["fed_exclusion_y2"], (
        "6% indexing must produce a larger Y2 federal exclusion than 2%"
    )
