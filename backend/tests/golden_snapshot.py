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

    out["sweep"] = sweep_brackets(copy.deepcopy(DEFAULT_SCENARIO))
    return out


def build():
    return {
        "year_tax": _year_tax_cases(),
        "optimize": _optimize_cases(),
        "projection": _projection_cases(),
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
        print("GOLDEN MATCH: refactor preserved all tax-engine / projection outputs exactly.")
        return
    # find first differing region for a helpful message
    base_obj = json.loads(baseline)
    cur_obj = json.loads(payload)
    for k in ("year_tax", "optimize", "projection"):
        if json.dumps(base_obj[k], sort_keys=True, default=str) != json.dumps(cur_obj[k], sort_keys=True, default=str):
            print(f"GOLDEN MISMATCH in section: {k}")
    sys.exit(1)


if __name__ == "__main__":
    main()
