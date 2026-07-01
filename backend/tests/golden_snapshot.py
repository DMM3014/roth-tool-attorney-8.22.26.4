"""Deterministic regression guard for the tax engine refactor.

Usage:
    python tests/golden_snapshot.py save     # capture baseline -> _golden.json
    python tests/golden_snapshot.py check     # compare current output to baseline

Exercises compute_year_tax, optimize_conversion and run_projection across several
configs so any behavioral drift from refactoring is caught to the cent.
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from defaults import DEFAULT_SCENARIO
from tax_engine import compute_year_tax, optimize_conversion
from projection import run_projection, sweep_brackets
from montecarlo import run_montecarlo

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, "_golden.json")


def _year_tax_cases():
    cases = [
        {"filing_status": "Married Filing Jointly", "ordinary_income": 320000,
         "ira_distributions": 50000, "qualified_dividends_ltcg": 40000, "interest": 3000,
         "gross_social_security": 0, "state_rate": 0.05, "include_irmaa": True},
        {"filing_status": "Single", "ordinary_income": 90000,
         "ira_distributions": 0, "qualified_dividends_ltcg": 20000, "interest": 1000,
         "gross_social_security": 30000, "num_over_65": 1, "on_medicare": 1,
         "state_rate": 0.0399, "include_irmaa": True},
        {"filing_status": "Married Filing Jointly", "ordinary_income": 0,
         "qualified_dividends_ltcg": 120000, "interest": 0, "gross_social_security": 60000,
         "num_over_65": 2, "state_rate": 0.0, "include_irmaa": False},
    ]
    return [compute_year_tax(c) for c in cases]


def _optimize_cases():
    base = {"filing_status": "Married Filing Jointly", "ordinary_income": 120000,
            "qualified_dividends_ltcg": 30000, "interest": 2000, "gross_social_security": 0,
            "state_rate": 0.05, "include_irmaa": True}
    return [optimize_conversion(base, 0.24, 0), optimize_conversion(base, 0.32, 100000)]


def _projection_cases():
    out = {}
    out["default"] = run_projection(copy.deepcopy(DEFAULT_SCENARIO))

    no_roth = copy.deepcopy(DEFAULT_SCENARIO)
    no_roth["roth"]["enabled"] = False
    out["no_roth"] = run_projection(no_roth)

    cap = copy.deepcopy(DEFAULT_SCENARIO)
    cap["roth"]["max_annual"] = 100000
    cap["roth"]["target_bracket"] = 0.32
    out["capped_32"] = run_projection(cap)

    # --- edge cases (widen the safety net) ---
    # 1. Single filer / no spouse: single brackets + deduction, no rollover, spouse items removed.
    single = copy.deepcopy(DEFAULT_SCENARIO)
    single["household"] = {
        "client_name": "Single Client", "client_dob_year": 1960,
        "client_life_expectancy": 90, "filing_status": "Single",
    }
    single["income_streams"] = [s for s in single["income_streams"] if s.get("owner") != "Spouse"]
    single["expenses"] = [e for e in single["expenses"] if e.get("owner") != "Spouse"]
    single["accounts"] = [a for a in single["accounts"] if a["id"] not in ("TAXS", "IRAS", "ROTS")]
    single["tax"]["survivor_filing_status"] = "Single"
    out["single_filer"] = run_projection(single)

    # 2. Early widow: client dies 2035 -> spousal rollover, survivor Single filing, survivor SS/spending.
    widow = copy.deepcopy(DEFAULT_SCENARIO)
    widow["household"]["client_life_expectancy"] = 70   # dob 1965 -> dies ~2035
    out["early_widow"] = run_projection(widow)

    # 3. High state tax: stresses state_tax, effective rate and heir blended rate.
    high_tax = copy.deepcopy(DEFAULT_SCENARIO)
    high_tax["tax"]["state_rate"] = 0.13
    high_tax["legacy"]["heir_state_rate"] = 0.10
    out["high_state_tax"] = run_projection(high_tax)

    # 4. Community property: client dies ~2035, CP state -> 100% first-death basis step-up
    #    on taxable/real-estate accounts (exercises _step_up_basis full-step branch).
    community = copy.deepcopy(DEFAULT_SCENARIO)
    community["household"]["client_life_expectancy"] = 70   # dies ~2035
    community["tax"]["community_property"] = True
    out["community_property"] = run_projection(community)

    out["sweep"] = sweep_brackets(copy.deepcopy(DEFAULT_SCENARIO))
    return out


def _montecarlo_cases():
    """Fixed-seed Monte Carlo runs: deterministic given the seed, so success rates,
    percentile bands, sequence-risk and shock outputs are regression-guarded. All engine
    outputs are pre-rounded (success 4dp, percentiles to whole $), so this is robust."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    base_assets = {
        "stocks": {"weight": 0.6, "mean": 0.08, "vol": 0.18},
        "bonds": {"weight": 0.3, "mean": 0.04, "vol": 0.06},
        "cash": {"weight": 0.1, "mean": 0.03, "vol": 0.01},
    }
    stock_assets = {
        "stocks": {"weight": 1.0, "mean": 0.07, "vol": 0.30},
        "bonds": {"weight": 0.0, "mean": 0.04, "vol": 0.06},
        "cash": {"weight": 0.0, "mean": 0.03, "vol": 0.01},
    }
    return {
        "base_seed42": run_montecarlo(cfg, n_trials=500, assets=base_assets, seed=42),
        "allstock_shock_seed7": run_montecarlo(
            cfg, n_trials=500, assets=stock_assets,
            shock={"enabled": True, "rate": -0.15, "years": 3}, seed=7),
    }


def build():
    return {
        "year_tax": _year_tax_cases(),
        "optimize": _optimize_cases(),
        "projection": _projection_cases(),
        "montecarlo": _montecarlo_cases(),
    }


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    current = build()
    payload = json.dumps(current, sort_keys=True, default=str)
    if mode == "save":
        with open(GOLDEN, "w") as f:
            f.write(payload)
        print(f"Saved golden baseline ({len(payload)} bytes) -> {GOLDEN}")
        return
    with open(GOLDEN) as f:
        baseline = f.read()
    if baseline == payload:
        print("GOLDEN MATCH: refactor preserved all tax-engine / projection / Monte Carlo outputs exactly.")
        return
    # find first differing region for a helpful message
    base_obj = json.loads(baseline)
    cur_obj = json.loads(payload)
    for k in ("year_tax", "optimize", "projection", "montecarlo"):
        if json.dumps(base_obj.get(k), sort_keys=True, default=str) != json.dumps(cur_obj.get(k), sort_keys=True, default=str):
            print(f"GOLDEN MISMATCH in section: {k}")
    sys.exit(1)


if __name__ == "__main__":
    main()
