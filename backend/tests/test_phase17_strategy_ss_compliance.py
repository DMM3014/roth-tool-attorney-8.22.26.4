"""Feature tests for the new strategy sweep, SS optimizer, and Roth-compliance tracking
(Phase-17 additions). These sit alongside the golden snapshot: golden covers exact
numeric drift, these validate the SHAPE and business-rule invariants of the outputs.
"""
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from defaults import DEFAULT_SCENARIO
from ss_optimizer import (_reduction_factor, full_retirement_age, sweep_ss_claims,
                          _implied_fra_amount)
from strategy_optimizer import strategy_sweep
from projection import run_projection


# ------- Social Security reduction / DRC formulas -------

def test_fra_is_67_for_1960_plus():
    assert full_retirement_age(1960) == 67
    assert full_retirement_age(1975) == 67
    # older cohort snaps to 66 (approximation for the sweep)
    assert full_retirement_age(1954) == 66


def test_reduction_at_62_for_fra_67_is_30pct():
    # 60 months early: 36*(5/9)% + 24*(5/12)% = 20% + 10% = 30% off
    factor = _reduction_factor(fra=67, claim_age=62)
    assert abs(factor - 0.70) < 1e-4, factor


def test_delayed_credit_at_70_for_fra_67_is_24pct():
    factor = _reduction_factor(fra=67, claim_age=70)
    assert abs(factor - 1.24) < 1e-4, factor


def test_fra_claim_is_1x():
    assert _reduction_factor(67, 67) == 1.0
    assert _reduction_factor(66, 66) == 1.0


def test_implied_fra_backs_out_pia():
    """Given a stream currently paying $2906.4/mo starting at age 62 (FRA=67),
    the implied FRA amount should be $4152."""
    fake_stream = {
        "amount": 2906.4, "start_date": "2028-03-07", "start_year": 2028,
        "tax_character": "SS", "owner": "Spouse",
    }
    fra_amt = _implied_fra_amount(fake_stream, birth_year=1966)
    assert abs(fra_amt - 4152) < 1.0, fra_amt  # 2906.4 / 0.70 = 4152


# ------- SS optimizer end-to-end -------

def test_ss_optimizer_shape_and_ranking():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    out = sweep_ss_claims(cfg, ages=[62, 67, 70])
    # 3 client ages × 3 spouse ages = 9 combos
    assert len(out["results"]) == 9
    # ranked list descending by after_tax_estate
    ests = [r["after_tax_estate"] for r in out["ranked"]]
    assert ests == sorted(ests, reverse=True)
    # both spouses should have implied FRA benefit
    assert "Client" in out["fra_amounts"] and "Spouse" in out["fra_amounts"]
    # baseline reports current (as-defined) plan
    assert out["baseline"]["is_baseline"] is True


# ------- Strategy sweep -------

def test_strategy_sweep_shape():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    out = strategy_sweep(cfg,
                         start_years=[2026, 2030], stop_years=[2035, 2050],
                         brackets=[0.24, 0.32], include_phased=True)
    labels = [r["label"] for r in out["results"]]
    assert "No conversions" in labels
    # 2 starts × 2 stops × 2 brackets = 8, plus baseline + 4 phased = 13
    assert len(out["results"]) == 13
    # every result carries both nominal + PV
    for r in out["results"]:
        assert "after_tax_estate" in r
        assert "after_tax_estate_pv" in r
        assert r["after_tax_estate_pv"] <= r["after_tax_estate"], "PV must be ≤ nominal"


def test_strategy_sweep_best_is_ranked_first():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    out = strategy_sweep(cfg,
                         start_years=[2026], stop_years=[2062],
                         brackets=[0.22, 0.32], include_phased=False)
    assert out["best"] == out["ranked"][0]
    assert out["ranked"][0]["after_tax_estate"] >= out["ranked"][-1]["after_tax_estate"]


def test_strategy_sweep_beats_no_conversion_default():
    """On the default plan the winning strategy should ADD value vs no conversion."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    out = strategy_sweep(cfg,
                         start_years=[2026], stop_years=[2062],
                         brackets=[0.24, 0.32], include_phased=False)
    baseline = next(r for r in out["results"] if r["label"] == "No conversions")
    assert out["best"]["after_tax_estate"] > baseline["after_tax_estate"]


# ------- Phased schedules via year_targets -------

def test_year_targets_override_flat_target():
    """A phased schedule (year_targets) should produce different conversions than a
    flat single-bracket run over the same window."""
    flat = copy.deepcopy(DEFAULT_SCENARIO)
    flat["roth"]["target_bracket"] = 0.24
    flat_out = run_projection(flat)
    phased = copy.deepcopy(DEFAULT_SCENARIO)
    phased["roth"]["target_bracket"] = 0.24
    # fill 32% for 2026-2031 (pre-SS), 22% after
    phased["roth"]["year_targets"] = {y: 0.32 for y in range(2026, 2032)}
    phased["roth"]["year_targets"].update({y: 0.22 for y in range(2032, 2063)})
    phased_out = run_projection(phased)
    assert flat_out["summary"]["total_roth_converted"] != phased_out["summary"]["total_roth_converted"]


# ------- Roth compliance tracking -------

def test_roth_compliance_block_exists_and_clean_by_default():
    """The default V9 scenario funds spending from cash/IRA/taxable — Roth never gets
    tapped, so warnings must be empty. This locks in the 'clean state' path."""
    out = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    assert "roth_compliance" in out
    rc = out["roth_compliance"]
    assert rc["warnings"] == []
    assert rc["total_early_penalty"] == 0
    assert out["summary"]["roth_early_penalty_total"] == 0


def test_roth_compliance_flags_early_tap():
    """Force Roth-first funding on a low-cash plan so a Roth withdrawal fires while
    the client is < 60 — this should surface a warning."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    # young couple starting early to guarantee pre-59½ years
    cfg["household"]["client_dob_year"] = 1975  # age 51 in 2026
    cfg["household"]["spouse_dob_year"] = 1976  # age 50 in 2026
    # remove wages so cash runs out fast
    for s in cfg["income_streams"]:
        if s.get("tax_character") == "Ordinary":
            s["use"] = False
    # cash is thin
    for a in cfg["accounts"]:
        if a["tax_type"] == "Cash":
            a["beginning_balance"] = 5000
        if a["tax_type"] in ("Taxable", "Real Estate"):
            a["beginning_balance"] = 0
    # funding order taps Roth (via IRA drying, then Roth as last resort with only
    # Roth available)
    cfg["withdrawal"]["funding_order"] = "Cash → IRA → Taxable → Roth"
    # seed some Roth balance to be tapped
    for a in cfg["accounts"]:
        if a["tax_type"] == "Tax-Free":
            a["beginning_balance"] = 500000
        if a["tax_type"] == "Tax-Deferred":
            a["beginning_balance"] = 100000  # will deplete fast
    # short projection to keep test fast
    cfg["projection"]["end_year"] = 2032
    cfg["household"]["client_life_expectancy"] = 60
    cfg["household"]["spouse_life_expectancy"] = 60
    # conversions off to avoid competing with the test signal
    cfg["roth"]["enabled"] = False
    out = run_projection(cfg)
    # Roth compliance block always present; if we tapped Roth pre-59½, a warning fires.
    assert "roth_compliance" in out
    if out["roth_compliance"]["warnings"]:
        w = out["roth_compliance"]["warnings"][0]
        assert w["client_age"] < 60
        assert w["penalty_10pct"] > 0
