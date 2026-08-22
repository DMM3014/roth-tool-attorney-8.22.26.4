"""Iteration 63 — HTTP tests for POST /api/estate/ep-flowchart (Phase 46)."""
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
    "client_roth": 14343712,
    "client_taxable": 1575866,
    "client_cash_house": 1452516,
    "survivor_roth": 2390000,
    "survivor_taxable": 4000000,
    "survivor_cash_house": 2000000,
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


def test_exclusions(result):
    assert result["fed_excl_y1"] == pytest.approx(36_408_937, rel=1e-4)
    assert result["fed_excl_y2"] == pytest.approx(43_474_175, rel=1e-4)


def test_plan_order(result):
    keys = [p["key"] for p in result["plans"]]
    nos = [p["plan_no"] for p in result["plans"]]
    # Feb-2026 authoritative plan order.
    assert keys == ["no_trust", "disclaimer_roth", "roth_and_taxable", "roth_only", "second_death_only"]
    assert nos == [1, 2, 3, 4, 5]


def test_roth_and_taxable_funding(result):
    p = next(p for p in result["plans"] if p["key"] == "roth_and_taxable")
    f = p["funding_y1"]
    assert f["maximum_to_trust"] == pytest.approx(15_919_578, rel=1e-4)
    assert f["dsue"] == pytest.approx(20_489_359, rel=1e-4)
    assert p["metrics"]["forgone_step_up"] == pytest.approx(189_380, rel=1e-3)


def test_totals_identical(result):
    totals = [p["totals_y2"]["total"] for p in result["plans"]]
    for t in totals[1:]:
        assert t == pytest.approx(totals[0], rel=1e-9)


def test_missing_field_returns_422(token):
    bad = dict(PAYLOAD)
    bad.pop("first_death_year")
    r = requests.post(f"{BASE_URL}/api/estate/ep-flowchart", json=bad,
                      headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 422, r.text


def test_unauth_returns_401_or_403():
    r = requests.post(f"{BASE_URL}/api/estate/ep-flowchart", json=PAYLOAD,
                      headers={"X-Test-No-Auth": "1"}, timeout=15)
    assert r.status_code in (401, 403), r.text
