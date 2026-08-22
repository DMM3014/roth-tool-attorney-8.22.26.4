"""Phase 48 HTTP tests for POST /api/estate/ep-flowchart.

Scenario: $3M Roth + $5M Taxable + $750k cash/house per spouse (Traditional = 0),
first_death 2056 / second_death 2062, growth 7%, cap-gains 24%, CPI 3%.

Verify:
  - plans[1].key == 'roth_and_taxable' (renamed from 'taxable_first')
  - plans[1..3] each have spouse_trust_y2.other > 0 (cash+house routed to spouse GST trust)
  - plans[1..3] each have children.outright_gross == 0 (since Traditional == 0)
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


def test_plan_keys_new_order(result):
    # Feb-2026 authoritative plan order.
    keys = [p["key"] for p in result["plans"]]
    assert keys == ["no_trust", "disclaimer_roth", "roth_and_taxable", "roth_only", "second_death_only"]


def test_trust_funded_plans_spouse_trust_y2_other_positive(result):
    # Plans 2, 3, 4, 5 all fund a Y2 spouse trust with cash/house rolled in
    # (only no_trust at position 0 skips the Y2 trust entirely).
    for idx in (1, 2, 3, 4):
        p = result["plans"][idx]
        stry2 = p.get("spouse_trust_y2", {})
        other = stry2.get("other", 0)
        assert other > 0, (
            f"plans[{idx}] ({p['key']}) spouse_trust_y2.other must be > 0, got {other}. "
            f"Full spouse_trust_y2={stry2}"
        )


def test_trust_funded_plans_children_outright_gross_zero(result):
    for idx in (1, 2, 3, 4):
        p = result["plans"][idx]
        children = p.get("children", {})
        og = children.get("outright_gross", 0)
        assert og == 0, (
            f"plans[{idx}] ({p['key']}) children.outright_gross expected 0 (trad=0), got {og}"
        )


def test_all_plans_totals_y2_identical(result):
    totals = [p["totals_y2"]["total"] for p in result["plans"]]
    for t in totals[1:]:
        assert t == pytest.approx(totals[0], rel=1e-9)
