"""Iteration 74 — POST /api/estate/ep-flowchart now returns 5 plans (added Plan 5
'disclaimer_roth'). Plan 5 must be numerically identical to Plan 3 (roth_only)
in the modeled central case; the distinction is narrative.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")

MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"

PAYLOAD = {
    "first_death_year": 2056,
    "second_death_year": 2062,
    "client_roth": 3_000_000,
    "client_taxable": 5_000_000,
    "client_cash_house": 750_000,
    "survivor_roth": 3_000_000,
    "survivor_taxable": 5_000_000,
    "survivor_cash_house": 750_000,
    "growth_rate": 0.07,
    "cap_gains_rate": 0.24,
    "heir_income_rate": 0.3165,
    "indexing_rate": 0.03,
}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify",
                      json={"pin": MASTER_PIN}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def result(token):
    r = requests.post(f"{BASE_URL}/api/estate/ep-flowchart", json=PAYLOAD,
                      headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def test_five_plans_returned(result):
    assert len(result["plans"]) == 5, f"expected 5 plans, got {len(result['plans'])}"


def test_plan_keys_and_numbers(result):
    plans = result["plans"]
    # After the Feb-2026 plan reorder, Disclaimer Trust is Plan 2 (right after
    # the No-Trust baseline), and the pre-committed GST structures follow.
    expected_keys = ["no_trust", "disclaimer_roth", "roth_and_taxable", "roth_only", "second_death_only"]
    assert [p["key"] for p in plans] == expected_keys
    assert [p["plan_no"] for p in plans] == [1, 2, 3, 4, 5]


def test_plan2_disclaimer_title(result):
    p2 = result["plans"][1]
    assert p2["key"] == "disclaimer_roth"
    assert p2["title"].startswith("Direct Client's Assets to Spouse with Disclaimer Trust"), \
        f"unexpected title: {p2['title']!r}"


def test_disclaimer_metrics_match_roth_only(result):
    # Plan 2 (disclaimer_roth) must numerically equal Plan 4 (roth_only) in the
    # central case where the Spouse elects to disclaim — same Y1 funding tactic.
    p2 = next(p for p in result["plans"] if p["key"] == "disclaimer_roth")
    p4 = next(p for p in result["plans"] if p["key"] == "roth_only")
    m_keys = ["total_to_children", "fet", "gst_exempt_y2"]
    for k in m_keys:
        v2 = p2.get("metrics", {}).get(k)
        v4 = p4.get("metrics", {}).get(k)
        assert v2 == v4, f"metrics.{k}: disclaimer_roth={v2} != roth_only={v4}"
    for k in ("roth_to_trust", "taxable_to_trust"):
        v2 = p2.get("funding_y1", {}).get(k)
        v4 = p4.get("funding_y1", {}).get(k)
        assert v2 == v4, f"funding_y1.{k}: disclaimer_roth={v2} != roth_only={v4}"


def test_disclaimer_totals_y2_match_roth_only(result):
    # broader sanity: totals_y2 dict identical between Plan 2 and Plan 4
    p2 = next(p for p in result["plans"] if p["key"] == "disclaimer_roth")["totals_y2"]
    p4 = next(p for p in result["plans"] if p["key"] == "roth_only")["totals_y2"]
    assert p2 == p4, f"totals_y2 mismatch: disclaimer={p2} roth_only={p4}"


def test_new_plan_order_after_reorder(result):
    plans = result["plans"]
    # Feb-2026 authoritative plan order (Client Report + EP tab consistent):
    #   1 no_trust · 2 disclaimer_roth · 3 roth_and_taxable · 4 roth_only · 5 second_death_only
    assert plans[0]["key"] == "no_trust" and plans[0]["plan_no"] == 1
    assert plans[1]["key"] == "disclaimer_roth" and plans[1]["plan_no"] == 2
    assert plans[2]["key"] == "roth_and_taxable" and plans[2]["plan_no"] == 3
    assert plans[3]["key"] == "roth_only" and plans[3]["plan_no"] == 4
    assert plans[4]["key"] == "second_death_only" and plans[4]["plan_no"] == 5
