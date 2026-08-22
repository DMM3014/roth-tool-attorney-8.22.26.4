"""Phase 46 (revised in Phase 48) — EP Flowchart engine parity tests.

Locks the workbook-parity plan structure AFTER the Phase-48 semantic revisions:
  - Plan 2 renamed `taxable_first` → `roth_and_taxable`; Y1 order = Roth first, then
    Taxable (both flow into the trust up to the fed exclusion). Previously Plan 2
    was Taxable-first; the user rebased Plan 2 semantics on 2026-02-13.
  - Plans 2, 3, and 4 all route the survivor's Cash & House balance into the
    spouse GST trust at Y2 (up to remaining exclusion). Only the Traditional IRA
    flows outright to children — the house is sold and rolled into the trust at
    second death.
"""
from __future__ import annotations

import pytest

from ep_flowchart import build_ep_flowchart


@pytest.fixture
def result():
    # Workbook baseline (from Flowchart.pdf): first death 2056, second death 2062,
    # 7% uniform growth, 3% CPI indexing, client Roth $14,343,712 and Taxable
    # $1,575,866 at first death, plus survivor Roth $3.586M / (1.07^6) ≈ $2,389K.
    return build_ep_flowchart(
        first_death_year=2056, second_death_year=2062,
        client_roth=14_343_712.0, client_taxable=1_575_866.0,
        client_cash_house=1_452_516.0, client_traditional=0.0,
        survivor_roth=3_586_764.04 / (1.07 ** 6), survivor_taxable=0.0,
        survivor_cash_house=0.0, survivor_traditional=0.0,
        growth_rate=0.07, cap_gains_rate=0.24,
        heir_income_rate=0.3165, indexing_rate=0.03,
    )


def plan(r, key):
    return next(p for p in r["plans"] if p["key"] == key)


def test_exclusions_match_workbook(result):
    assert result["fed_excl_y1"] == pytest.approx(36_408_937.07, rel=1e-6)
    assert result["fed_excl_y2"] == pytest.approx(43_474_174.92, rel=1e-6)


def test_plan_order_no_trust_first(result):
    # Feb-2026 authoritative plan order.
    assert [p["key"] for p in result["plans"]] == [
        "no_trust", "disclaimer_roth", "roth_and_taxable", "roth_only", "second_death_only"]
    assert [p["plan_no"] for p in result["plans"]] == [1, 2, 3, 4, 5]


def test_plan3_roth_and_taxable_funding(result):
    """Plan 3 (roth_and_taxable) funds Roth FIRST, then Taxable — both flow into the client GST trust."""
    p = plan(result, "roth_and_taxable")
    f = p["funding_y1"]
    # Roth first fills the trust up to exclusion; Taxable fills the remainder.
    assert f["roth_to_trust"] == pytest.approx(14_343_712.0)
    assert f["taxable_to_trust"] == pytest.approx(1_575_866.0)
    assert f["maximum_to_trust"] == pytest.approx(15_919_578.0)
    # Same total DSUE as the old taxable-first order (funding fits under exclusion).
    assert f["dsue"] == pytest.approx(20_489_359.07, rel=1e-6)


def test_plan3_roth_only_funding_unchanged(result):
    p = plan(result, "roth_only")
    f = p["funding_y1"]
    assert f["roth_to_trust"] == pytest.approx(14_343_712.0)
    assert f["taxable_to_trust"] == 0.0
    assert f["dsue"] == pytest.approx(22_065_225.07, rel=1e-6)


def test_house_routes_into_gst_trust_at_y2_for_all_trust_plans():
    """The survivor's Cash+House sold at 2nd death now flows into the spouse GST
    trust (up to remaining exclusion) in EVERY trust-funded plan
    (disclaimer_roth, roth_and_taxable, roth_only, second_death_only)."""
    r = build_ep_flowchart(
        first_death_year=2056, second_death_year=2062,
        client_roth=3_000_000, client_taxable=5_000_000, client_cash_house=750_000,
        survivor_roth=3_000_000, survivor_taxable=5_000_000, survivor_cash_house=750_000,
        growth_rate=0.07, cap_gains_rate=0.24, indexing_rate=0.03,
    )
    for key in ("disclaimer_roth", "roth_and_taxable", "roth_only", "second_death_only"):
        p = plan(r, key)
        assert p["spouse_trust_y2"]["other"] > 0, f"{key}: house should be routed to trust"
        # Only Traditional IRA flows outright → gross outright = 0 when trad = 0.
        assert p["children"]["outright_gross"] == pytest.approx(0.0, abs=1e-6), (
            f"{key}: outright_gross should be $0 when Traditional is $0")


def test_forgone_step_up_matches_new_plan2_semantics(result):
    # Under Plan 2 (Roth-first, then Taxable), Taxable of $1,575,866 flows into the
    # trust so the second step-up is forgone on that slug — same $ as the old
    # Plan-2 semantics because the taxable amount routed is identical when the
    # entire deceased Roth+Taxable fits under the exclusion.
    tf = plan(result, "roth_and_taxable")["metrics"]["forgone_step_up"]
    ro = plan(result, "roth_only")["metrics"]["forgone_step_up"]
    assert tf == pytest.approx(189_380.14, rel=1e-4)
    assert ro == 0.0


def test_no_trust_full_dsue_and_no_shelter(result):
    p = plan(result, "no_trust")
    assert p["funding_y1"] is None and p["spouse_trust_y2"] is None
    assert p["dsue"] == pytest.approx(result["fed_excl_y1"], rel=1e-9)
    assert p["metrics"]["in_trust_y2"] == 0.0
    assert p["metrics"]["gst_exempt_y2"] == 0.0
    assert p["metrics"]["lost_roth_unsheltered"] == pytest.approx(
        p["totals_y2"]["roth"], rel=1e-9)


def test_second_death_only_gst_capped_at_survivor_exclusion(result):
    p = plan(result, "second_death_only")
    assert p["funding_y1"] is None
    f2 = p["funding_y2"]
    assert f2["exclusion_limit"] == pytest.approx(
        result["fed_excl_y2"] + result["fed_excl_y1"], rel=1e-9)
    assert f2["gst_exempt_portion"] <= result["fed_excl_y2"] + 1e-6


def test_combined_totals_identical_across_plans(result):
    totals = [p["totals_y2"]["total"] for p in result["plans"]]
    for t in totals[1:]:
        assert t == pytest.approx(totals[0], rel=1e-9)


def test_estate_tax_when_over_limit():
    r = build_ep_flowchart(
        first_death_year=2030, second_death_year=2032,
        client_roth=40_000_000, client_taxable=30_000_000,
        survivor_roth=20_000_000, survivor_taxable=20_000_000,
        growth_rate=0.0, cap_gains_rate=0.24, indexing_rate=0.03)
    p = next(pl for pl in r["plans"] if pl["key"] == "no_trust")
    cap = r["fed_excl_y2"] + r["fed_excl_y1"]
    expected_over = 110_000_000 - cap
    assert p["children"]["amount_over"] == pytest.approx(expected_over, rel=1e-9)
    assert p["children"]["fet"] == pytest.approx(expected_over * 0.40, rel=1e-9)
    for key in ("disclaimer_roth", "roth_and_taxable", "roth_only", "second_death_only"):
        pl = next(x for x in r["plans"] if x["key"] == key)
        assert pl["metrics"]["fet"] <= p["children"]["fet"] + 1e-6
        assert pl["metrics"]["in_trust_y2"] > 0
