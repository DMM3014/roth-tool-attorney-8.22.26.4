"""Phase 50 — Report-review corrections:

1. EP flowchart reconciles to the retirement projection (per-class Y2 balances).
2. QCD annual cap updated to the 2026 IRS limit ($111,000).
3. Monte Carlo outcome distributions (conversions / lifetime taxes / inheritance).
"""
import copy

import numpy as np
import pytest

from defaults import DEFAULT_SCENARIO
from ep_flowchart import build_ep_flowchart
from montecarlo import run_montecarlo
from projection import Plan


# ---------------------------------------------------------------- flowchart
def test_flowchart_projection_mode_reconciles_to_y2_totals():
    r = build_ep_flowchart(
        first_death_year=2056, second_death_year=2062,
        client_roth=1e6, client_taxable=2e6, client_cash_house=5e5, client_traditional=3e5,
        survivor_roth=1e6, survivor_taxable=2e6, survivor_cash_house=5e5, survivor_traditional=3e5,
        growth_rate=0.07,
        y2_roth=2.4e6, y2_taxable=3.9e6, y2_cash_house=1.2e6, y2_traditional=0.5e6)
    assert r["growth_basis"] == "projection"
    assert r["y2_reconciled_total"] == pytest.approx(8.0e6)
    # Plan 1 (no trust): the whole household estate at Y2 must equal the
    # projection's actual second-death balances — the reconciliation guarantee.
    p1 = r["plans"][0]
    assert p1["totals_y2"]["total"] == pytest.approx(8.0e6, abs=1.0)
    assert p1["survivor_y2"]["roth"] == pytest.approx(2.4e6, abs=1.0)
    assert p1["survivor_y2"]["taxable"] == pytest.approx(3.9e6, abs=1.0)
    assert p1["survivor_y2"]["cash_house"] == pytest.approx(1.2e6, abs=1.0)
    assert p1["survivor_y2"]["traditional"] == pytest.approx(0.5e6, abs=1.0)


def test_flowchart_all_plans_share_same_pretax_total_in_projection_mode():
    r = build_ep_flowchart(
        first_death_year=2050, second_death_year=2060,
        client_roth=3e6, client_taxable=4e6, client_cash_house=1e6, client_traditional=2e6,
        survivor_roth=3e6, survivor_taxable=4e6, survivor_cash_house=1e6, survivor_traditional=2e6,
        y2_roth=9e6, y2_taxable=1.1e7, y2_cash_house=2.5e6, y2_traditional=4e6)
    totals = [p["totals_y2"]["total"] for p in r["plans"]]
    for t in totals[1:]:
        assert t == pytest.approx(totals[0], abs=1.0)
    assert totals[0] == pytest.approx(9e6 + 1.1e7 + 2.5e6 + 4e6, abs=1.0)


def test_flowchart_uniform_fallback_unchanged():
    r = build_ep_flowchart(first_death_year=2056, second_death_year=2062,
                           client_roth=1e6, survivor_roth=1e6, growth_rate=0.07)
    assert r["growth_basis"] == "uniform"
    assert r["y2_reconciled_total"] is None
    assert r["plans"][0]["totals_y2"]["roth"] == pytest.approx(2e6 * 1.07 ** 6)


def test_flowchart_orphan_class_credits_survivor():
    # Roth is zero at Y1 but nonzero at Y2 (e.g. conversions between deaths):
    # the orphan dollars land on the survivor's side so totals still reconcile.
    r = build_ep_flowchart(first_death_year=2056, second_death_year=2062,
                           client_taxable=1e6, survivor_taxable=1e6, growth_rate=0.07,
                           y2_roth=5e5, y2_taxable=2.5e6, y2_cash_house=0.0, y2_traditional=0.0)
    p1 = r["plans"][0]
    assert p1["survivor_y2"]["roth"] == pytest.approx(5e5, abs=1.0)
    assert p1["totals_y2"]["total"] == pytest.approx(3.0e6, abs=1.0)


def test_flowchart_spend_down_factor_below_one():
    # Y2 balance BELOW Y1 (survivor spend-down) must be honored, not grown.
    r = build_ep_flowchart(first_death_year=2050, second_death_year=2060,
                           client_taxable=2e6, survivor_taxable=2e6, growth_rate=0.07,
                           y2_roth=0.0, y2_taxable=3e6, y2_cash_house=0.0, y2_traditional=0.0)
    assert r["plans"][0]["totals_y2"]["taxable"] == pytest.approx(3e6, abs=1.0)
    assert r["implied_growth"]["taxable"] < 0.07


# ---------------------------------------------------------------------- QCD
def test_qcd_cap_default_is_2026_limit():
    assert Plan.__dataclass_fields__["qcd_annual_cap"].default == 111000.0


# ------------------------------------------------------------- Monte Carlo
def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def test_mc_outcome_distributions_present_and_shaped():
    res = run_montecarlo(_cfg(), n_trials=100, seed=7,
                         conversion_halt={"enabled": True, "drop_threshold": 0.10})
    od = res["outcome_distributions"]
    for key in ("conversions", "lifetime_taxes", "after_tax_inheritance"):
        blk = od[key]
        assert blk is not None
        for p in ("p5", "p10", "p25", "p50", "p75", "p90", "p95", "mean"):
            assert p in blk
        assert blk["p10"] <= blk["p50"] <= blk["p90"]
    assert od["halt_active"] is True
    conv = od["conversions"]
    assert conv["basis"] == "exact"
    assert conv["p90"] <= conv["planned_total"] + 0.5
    assert 0.0 <= conv["pct_trials_full_plan"] <= 1.0
    assert sum(conv["histogram"]["counts"]) == res["n_trials"]


def test_mc_conversions_degenerate_without_halt():
    res = run_montecarlo(_cfg(), n_trials=80, seed=7)
    conv = res["outcome_distributions"]["conversions"]
    assert conv["p10"] == conv["p50"] == conv["p90"] == conv["planned_total"]
    assert conv["pct_trials_full_plan"] == 1.0
    assert res["outcome_distributions"]["halt_active"] is False


def test_mc_halt_reduces_conversion_distribution():
    res = run_montecarlo(_cfg(), n_trials=200, seed=42,
                         conversion_halt={"enabled": True, "drop_threshold": 0.10})
    conv = res["outcome_distributions"]["conversions"]
    # With a 10% halt threshold most trials halt at some point — the median
    # executed conversion total must fall below the full planned schedule.
    assert conv["p50"] < conv["planned_total"]
    assert conv["pct_trials_full_plan"] < 1.0


def test_mc_lifetime_taxes_and_inheritance_reference_deterministic():
    res = run_montecarlo(_cfg(), n_trials=80, seed=3,
                         conversion_halt={"enabled": True, "drop_threshold": 0.10})
    od = res["outcome_distributions"]
    assert od["lifetime_taxes"]["det_value"] > 0
    assert od["lifetime_taxes"]["basis"] == "model_locked"
    inh = od["after_tax_inheritance"]
    assert inh["det_value"] > 0
    assert inh["basis"] == "approximation"
    assert 0.0 < inh["heir_rate"] < 1.0
    assert np.all(np.array([inh["p5"], inh["p50"], inh["p95"]]) >= 0.0)
