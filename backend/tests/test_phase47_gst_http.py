"""Phase 47 — HTTP smoke tests for /api/estate/analyze gst_funding_order field."""
import os, requests, pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "https://roth-retirement-tool.preview.emergentagent.com"
BASE = BASE.rstrip("/")

MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/pin/verify", json={"pin": MASTER_PIN}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


BASE_PAYLOAD = {
    "first_death_year": 2040,
    "second_death_year": 2050,
    "survivor_roth_at_y1": 5_000_000,
    "survivor_taxable_at_y1": 5_000_000,
    "traditional_at_y1": 2_000_000,
    "deceased_roth_at_y1": 15_000_000,
    "deceased_taxable_at_y1": 15_000_000,
    "trust_growth_rate": 0.06,
    "survivor_growth_rate": 0.06,
    "heir_marginal_rate": 0.3165,
    "state_code": "",
    "use_portability": True,
    "indexing_rate": 0.024,
}


def _analyze(headers, order=None):
    p = dict(BASE_PAYLOAD)
    if order is not None:
        p["gst_funding_order"] = order
    r = requests.post(f"{BASE}/api/estate/analyze", json=p, headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def test_default_echo_field(headers):
    r = _analyze(headers)
    assert r["gst_funding_order"] == "roth_first"


def test_taxable_first_echo(headers):
    r = _analyze(headers, "taxable_first")
    assert r["gst_funding_order"] == "taxable_first"


def test_roth_first_beats_taxable_first_when_over_exclusion(headers):
    r_roth = _analyze(headers, "roth_first")
    r_tax = _analyze(headers, "taxable_first")
    a = r_roth["outcomes"]["gst_layered"]["net_to_heirs_at_y2"]
    b = r_tax["outcomes"]["gst_layered"]["net_to_heirs_at_y2"]
    assert a > b, f"expected roth_first ({a}) > taxable_first ({b})"


def test_other_strategies_unchanged(headers):
    r_roth = _analyze(headers, "roth_first")
    r_tax = _analyze(headers, "taxable_first")
    for strat in ("portability", "bypass", "qtip_bypass"):
        for k in ("net_to_heirs_at_y2", "trust_value_at_y2"):
            assert abs(r_roth["outcomes"][strat][k] - r_tax["outcomes"][strat][k]) < 1e-2, (
                f"{strat}.{k} changed unexpectedly")


def test_invalid_order_rejected_by_regex(headers):
    p = dict(BASE_PAYLOAD)
    p["gst_funding_order"] = "bogus"
    r = requests.post(f"{BASE}/api/estate/analyze", json=p, headers=headers, timeout=15)
    assert r.status_code == 422, r.text
