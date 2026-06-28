"""Phase 14 — reconcile the engine against Retirement_Optimizer V9 'Scenario 1'.

Asserts the Python projection reproduces the spreadsheet's headline legacy / tax /
balance numbers to within ~1% (the agreed tolerance).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from projection import run_projection  # noqa: E402
from v9_scenario1 import (V9_SCENARIO_1, V9_CONVERSIONS, V9_EOY,  # noqa: E402
                          V9_HEADLINE)

OUT = run_projection(V9_SCENARIO_1)
ROWS = {r["year"]: r for r in OUT["rows"]}
SUMMARY = OUT["summary"]
LEG = OUT["legacy"]


def within(model, target, tol=0.01):
    return target == 0 or abs((model - target) / target) <= tol


def test_horizon_is_2026_to_2062():
    assert OUT["rows"][0]["year"] == 2026
    assert OUT["rows"][-1]["year"] == 2062
    assert len(OUT["rows"]) == 37


def test_total_lifetime_conversions():
    assert within(SUMMARY["total_roth_converted"], V9_HEADLINE["total_conversions"], 0.01)


def test_gross_estate_at_second_death():
    assert within(LEG["gross_estate"], V9_HEADLINE["gross_estate"], 0.01)


def test_traditional_ira_at_second_death():
    assert within(SUMMARY["ending_traditional"], V9_HEADLINE["trad_at_death"], 0.01)


def test_heir_tax_on_inherited_ira_pv_basis():
    heir_tax = SUMMARY["ending_traditional"] * LEG["heir_ordinary_rate"]
    assert within(heir_tax, V9_HEADLINE["heir_ira_tax_pv"], 0.01)


def test_after_tax_legacy_at_death():
    assert within(LEG["after_tax_estate_at_death"], V9_HEADLINE["after_tax_legacy_nominal"], 0.01)


def test_lifetime_taxes_plus_medicare():
    target = V9_HEADLINE["lifetime_income_taxes"] + V9_HEADLINE["lifetime_medicare"]
    assert within(SUMMARY["lifetime_taxes"], target, 0.01)


def test_children_wealth_plus_ten_years():
    # secondary longevity view — allow a slightly wider band
    assert within(LEG["after_tax_estate_to_heirs"], V9_HEADLINE["children_wealth_plus10"], 0.015)


def test_year_by_year_conversions_track_v9():
    for year, v9c in V9_CONVERSIONS.items():
        model = ROWS[year]["roth_conversion"]
        # absolute floor avoids dividing by tiny early-year numbers
        assert abs(model - v9c) <= max(0.02 * v9c, 5000), (year, model, v9c)


def test_conversions_stop_at_rmd_age_75():
    # client born 1965 -> RMD age 75 in 2040; conversions must stop
    assert ROWS[2039]["roth_conversion"] > 0
    assert ROWS[2040]["roth_conversion"] == 0


def test_year_by_year_balances_track_v9():
    for year, (trad, roth, ct, nw) in V9_EOY.items():
        r = ROWS[year]
        assert within(r["traditional"], trad, 0.015), ("trad", year)
        assert within(r["roth"], roth, 0.015) or abs(r["roth"] - roth) < 5000, ("roth", year)
        assert within(r["net_worth"], nw, 0.015), ("nw", year)
