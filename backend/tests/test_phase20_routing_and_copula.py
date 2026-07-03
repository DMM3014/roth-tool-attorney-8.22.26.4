"""Phase 20 — P2 refinements:
(A) Per-owner conversion routing: converted dollars physically land in the SOURCE-IRA
    owner's own Roth account (auto-created at $0 if the owner has none).
(B) Correlated inflation-return draws: Gaussian copula across stocks/bonds/cash/inflation
    with nearest-PSD repair, backward-compatible when disabled.
Pure engine tests — no HTTP.
"""
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from defaults import DEFAULT_SCENARIO
from projection import run_projection
from montecarlo import run_montecarlo

CORR = {"enabled": True, "stocks_bonds": 0.15, "stocks_cash": 0.0, "bonds_cash": 0.20,
        "stocks_inflation": -0.20, "bonds_inflation": -0.30, "cash_inflation": 0.55}
INFL = {"enabled": True, "mean": 0.03, "vol": 0.02}


def _spouse_heavy_cfg():
    """Small client IRA + big spouse IRA so conversions must draw from the spouse."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    for a in cfg["accounts"]:
        if a["id"] == "IRAC":
            a["beginning_balance"] = 100000
        if a["id"] == "IRAS":
            a["beginning_balance"] = 4900000
    return cfg


# ---------------- (A) per-owner conversion routing ----------------

def test_spouse_conversions_land_in_spouse_roth():
    r = run_projection(_spouse_heavy_cfg())
    final = r["rows"][-1]["account_balances"]
    assert final["ROTS"] > 0, "spouse-sourced conversions must land in the spouse's Roth"
    assert final["ROTC"] > 0, "client-sourced conversions still land in the client's Roth"
    led = r["roth_compliance"]["conversions_ledger"]
    assert any(entry["owner"] == "Spouse" for entry in led)


def test_default_scenario_unchanged_totals():
    """Default: all conversions are client-sourced; totals must match the ledger."""
    r = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    led = r["roth_compliance"]["conversions_ledger"]
    assert all(entry["owner"] == "Client" for entry in led)
    assert abs(sum(entry["amount"] for entry in led)
               - r["summary"]["total_roth_converted"]) < 1.0
    assert r["rows"][-1]["account_balances"]["ROTS"] == 0.0
    assert r["auto_accounts"] == []


def test_auto_roth_created_for_owner_without_one():
    cfg = _spouse_heavy_cfg()
    cfg["accounts"] = [a for a in cfg["accounts"] if a["id"] != "ROTS"]
    n_before = len(cfg["accounts"])
    r = run_projection(cfg)
    assert len(cfg["accounts"]) == n_before, "config must never be mutated"
    autos = r["auto_accounts"]
    assert [a["id"] for a in autos] == ["ROTH-AUTO-SPOUSE"]
    assert autos[0]["owner"] == "Spouse" and autos[0]["tax_type"] == "Tax-Free"
    assert r["rows"][-1]["account_balances"]["ROTH-AUTO-SPOUSE"] > 0


def test_no_roth_accounts_dollars_conserved():
    """With NO Roth accounts in the plan, both are auto-created and converted dollars
    are physically preserved (sum of Roth balances == roth total in the row)."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    cfg["accounts"] = [a for a in cfg["accounts"] if a["tax_type"] != "Tax-Free"]
    r = run_projection(cfg)
    assert {a["id"] for a in r["auto_accounts"]} == {"ROTH-AUTO-CLIENT", "ROTH-AUTO-SPOUSE"}
    final = r["rows"][-1]
    per_acct = sum(final["account_balances"][a["id"]] for a in r["auto_accounts"])
    assert abs(per_acct - final["roth"]) < 1.0
    assert final["roth"] > 0


def test_roth_split_sums_to_total_every_year():
    r = run_projection(_spouse_heavy_cfg())
    for row in r["rows"]:
        split = row["account_balances"]["ROTC"] + row["account_balances"]["ROTS"]
        assert abs(split - row["roth"]) < 1.0, f"year {row['year']} Roth split mismatch"


# ---------------- (B) correlated inflation-return draws ----------------

def test_realized_correlations_match_requested():
    r = run_montecarlo(copy.deepcopy(DEFAULT_SCENARIO), n_trials=500, seed=11,
                       inflation=INFL, correlation=CORR)
    c = r["correlation"]
    assert c["enabled"] and c["includes_inflation"] and not c["adjusted_to_psd"]
    for key, req in c["matrix_used"].items():
        assert abs(c["realized"][key] - req) < 0.05, (key, c["realized"][key], req)


def test_disabled_correlation_identical_to_legacy_path():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=300, seed=42, inflation=INFL)
    b = run_montecarlo(cfg, n_trials=300, seed=42, inflation=INFL,
                       correlation={"enabled": False})
    assert a["with_conversions"] == b["with_conversions"]
    assert a["without_conversions"] == b["without_conversions"]
    assert a["correlation"] is None and b["correlation"] is None


def test_non_psd_matrix_repaired():
    bad = dict(CORR, stocks_bonds=0.95, stocks_inflation=0.95, bonds_inflation=-0.95)
    r = run_montecarlo(copy.deepcopy(DEFAULT_SCENARIO), n_trials=200, seed=7,
                       inflation=INFL, correlation=bad)
    c = r["correlation"]
    assert c["adjusted_to_psd"] is True
    assert 0.0 <= r["with_conversions"]["success"] <= 1.0
    # repaired matrix keeps every entry a valid correlation
    assert all(-1.0 <= v <= 1.0 for v in c["matrix_used"].values())


def test_correlation_without_inflation_is_assets_only():
    r = run_montecarlo(copy.deepcopy(DEFAULT_SCENARIO), n_trials=200, seed=7,
                       inflation=None, correlation=CORR)
    c = r["correlation"]
    assert c["includes_inflation"] is False
    assert set(c["matrix_used"]) == {"stocks_bonds", "stocks_cash", "bonds_cash"}


def test_correlation_reproducible_with_seed():
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    a = run_montecarlo(cfg, n_trials=200, seed=2027, inflation=INFL, correlation=CORR)
    b = run_montecarlo(cfg, n_trials=200, seed=2027, inflation=INFL, correlation=CORR)
    assert a["with_conversions"] == b["with_conversions"]
    assert a["correlation"] == b["correlation"]
