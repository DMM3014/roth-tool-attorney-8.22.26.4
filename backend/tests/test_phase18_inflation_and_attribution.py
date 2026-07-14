"""Phase 18 tests — Monte Carlo v2.1 stochastic inflation, per-owner Roth attribution,
and edge cases exercised by the new features.
"""
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from defaults import DEFAULT_SCENARIO
from montecarlo import run_montecarlo
from projection import run_projection


# ---------- Monte Carlo v2.1 — stochastic inflation ----------

def test_inflation_none_matches_deterministic_v2():
    """With inflation=None the v2.1 output must be numerically identical to the v2 run
    (backward-compat guarantee — the multiplier collapses to 1.0)."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=300, seed=42, inflation=None)
    b = run_montecarlo(cfg, n_trials=300, seed=42, inflation={"enabled": False, "mean": 0.03, "vol": 0.0})
    assert a["with_conversions"]["success"] == b["with_conversions"]["success"]
    assert a["with_conversions"]["percentiles"]["p50"] == b["with_conversions"]["percentiles"]["p50"]
    assert a["inflation"] is None and b["inflation"] is None


def test_inflation_block_populated_when_enabled():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    r = run_montecarlo(cfg, n_trials=200, seed=7,
                       inflation={"enabled": True, "mean": 0.03, "vol": 0.015})
    assert r["inflation"] is not None
    inf = r["inflation"]
    assert inf["mean"] == 0.03 and inf["vol"] == 0.015
    # cumulative summary: p10/p50/p90 lists same length as years
    T = len(r["years"])
    assert len(inf["cumulative"]["p50"]) == T
    # cumulative expected inflation grows monotonically
    exp = inf["cumulative"]["expected"]
    assert all(exp[i + 1] >= exp[i] for i in range(T - 1))


def test_higher_inflation_vol_worsens_p10_ending():
    """Higher inflation vol → more spending risk in the P10 tail → worse P10 ending."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    low = run_montecarlo(cfg, n_trials=500, seed=99,
                         inflation={"enabled": True, "mean": 0.03, "vol": 0.005})
    high = run_montecarlo(cfg, n_trials=500, seed=99,
                          inflation={"enabled": True, "mean": 0.03, "vol": 0.04})
    # The stress the client cares about: worse P10 (bottom decile) portfolio at horizon.
    assert high["with_conversions"]["ending"]["p10"] <= low["with_conversions"]["ending"]["p10"] + 1


def test_inflation_reproducible_with_seed():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=200, seed=2027,
                       inflation={"enabled": True, "mean": 0.03, "vol": 0.02})
    b = run_montecarlo(cfg, n_trials=200, seed=2027,
                       inflation={"enabled": True, "mean": 0.03, "vol": 0.02})
    assert a["with_conversions"]["success"] == b["with_conversions"]["success"]
    assert a["inflation"]["cumulative"]["p50"] == b["inflation"]["cumulative"]["p50"]


# ---------- Per-owner Roth conversion attribution ----------

def test_ledger_entries_carry_owner_and_age_fields():
    """Default plan converts every year → ledger should have per-owner entries."""
    out = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    ledger = out["roth_compliance"]["conversions_ledger"]
    assert len(ledger) > 0
    for lot in ledger:
        assert lot.get("owner") in ("Client", "Spouse")
        assert "owner_age_at_conversion" in lot
        assert isinstance(lot["amount"], (int, float))
        assert lot["remaining"] <= lot["amount"] + 1e-6


def test_client_ira_drained_first_attributes_to_client_owner():
    """On the default plan, client IRA is drained first — all early conversions
    should attribute to Client (matches _apply_year_flows drain order)."""
    out = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    early = [lot for lot in out["roth_compliance"]["conversions_ledger"] if lot["year"] <= 2030]
    assert all(lot["owner"] == "Client" for lot in early), \
        f"expected all early conversions Client-attributed, got {[lot['owner'] for lot in early]}"


def test_warnings_use_owner_not_just_client_age():
    """Warnings should include per-owner fields — owner + owner_age + roth_account.
    Default plan should be clean (no warnings), so we validate on a rigged scenario."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    # Force a young household + tight cash so Roth gets tapped
    cfg["household"]["client_dob_year"] = 1975
    cfg["household"]["spouse_dob_year"] = 1976
    for s in cfg["income_streams"]:
        if s.get("tax_character") in ("Ordinary", "SS"):
            s["use"] = False
    for a in cfg["accounts"]:
        if a["tax_type"] == "Cash":
            a["beginning_balance"] = 1000
        if a["tax_type"] in ("Taxable", "Real Estate"):
            a["beginning_balance"] = 0
        if a["tax_type"] == "Tax-Free":
            a["beginning_balance"] = 500000
        if a["tax_type"] == "Tax-Deferred":
            a["beginning_balance"] = 50000
    cfg["projection"]["end_year"] = 2030
    cfg["household"]["client_life_expectancy"] = 60
    cfg["household"]["spouse_life_expectancy"] = 60
    cfg["roth"]["enabled"] = False
    out = run_projection(cfg)
    if out["roth_compliance"]["warnings"]:
        w = out["roth_compliance"]["warnings"][0]
        assert "owner" in w
        assert "owner_age" in w
        assert "roth_account" in w
        assert w["owner"] in ("Client", "Spouse")


def test_conversion_math_unchanged_by_attribution():
    """Adding per-owner attribution must NOT change any of the headline projection metrics."""
    out = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    assert out["summary"]["lifetime_taxes"] == 7159874.48
    assert out["summary"]["ending_net_worth"] == 80804720.63
    assert out["legacy"]["after_tax_estate_to_heirs"] == 152411628.35
