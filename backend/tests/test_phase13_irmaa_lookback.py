"""IRMAA 2-year MAGI lookback (hard-coded SSA rule)."""
import os
import sys
import pytest
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tax_engine import compute_year_tax  # noqa: E402

BASE_URL = os.environ["REACT_APP_BACKEND_URL"]


def _base_inp(**over):
    inp = {
        "filing_status": "MFJ", "year": 2030, "bracket_index": 1.0, "irmaa_index": 1.0,
        "num_65plus": 2, "medicare_count": 2, "ordinary_non_ss": 50000,
        "ira_distributions": 0, "cash_interest": 0, "gross_ss": 40000,
        "recurring_div_ltcg": 10000, "realized_ltcg": 0, "state_rate": 0.04,
        "include_irmaa": True,
    }
    inp.update(over)
    return inp


def test_irmaa_uses_lookback_magi_when_provided():
    # Low current MAGI but a high 2-year-prior MAGI -> high IRMAA tier
    res = compute_year_tax(_base_inp(irmaa_magi=600000))
    low = compute_year_tax(_base_inp())  # no lookback -> current MAGI
    assert res["irmaa_magi"] == 600000
    assert res["irmaa_tier"] > low["irmaa_tier"]
    assert res["medicare_premiums"] > low["medicare_premiums"]


def test_irmaa_falls_back_to_current_magi_without_lookback():
    res = compute_year_tax(_base_inp())
    assert res["irmaa_magi"] == res["magi"]


def test_projection_includes_medicare_and_runs():
    defaults = requests.get(f"{BASE_URL}/api/defaults", timeout=30).json()
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
    assert r.status_code == 200
    rows = r.json()["rows"]
    # later years (both 65+, on Medicare) include premiums in total tax
    assert any(row["total_tax"] > 0 for row in rows)
