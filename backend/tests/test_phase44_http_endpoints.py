"""HTTP-level tests for Phase 44 features via /api/projection and /api/defaults."""
import copy
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://roth-retirement-tool.preview.emergentagent.com").rstrip("/")
PIN = "i4m07MnVDhpTYkc1giC6wWDv"


def _token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": PIN}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _headers():
    return {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}


def _defaults():
    r = requests.get(f"{BASE_URL}/api/defaults", headers=_headers(), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_defaults_include_merge_and_giving():
    d = _defaults()
    assert d["tax"]["merge_basis_at_first_death"] is True
    assert "giving" in d
    for k in ("annual_gift_amount", "section_2503e_amount", "start_year", "end_year"):
        assert k in d["giving"], f"missing giving.{k}"


def _run(cfg):
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": cfg}, headers=_headers(), timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def test_projection_merge_toggle_affects_taxes():
    d = _defaults()
    on = copy.deepcopy(d)
    # The basis merge only bites when a taxable lot still exists at the first
    # death. /api/defaults may return an advisor-saved funding order that spends
    # Taxable first (leaving nothing to step up), which makes the toggle a
    # legitimate no-op — so pin the funding order for this assertion.
    on["withdrawal"] = {**on.get("withdrawal", {}), "funding_order": "Cash → IRA → Taxable → Roth"}
    off = copy.deepcopy(on)
    off["tax"]["merge_basis_at_first_death"] = False
    r_on = _run(on)
    r_off = _run(off)
    assert r_off["summary"]["lifetime_taxes"] < r_on["summary"]["lifetime_taxes"]
    assert (
        r_off["legacy"]["after_tax_estate_to_heirs"]
        > r_on["legacy"]["after_tax_estate_to_heirs"]
    )


def test_projection_giving_shape_and_effects():
    d = _defaults()
    cfg = copy.deepcopy(d)
    cfg["giving"] = {
        "annual_gift_amount": 100000.0,
        "section_2503e_amount": 40000.0,
        "start_year": cfg["projection"]["start_year"],
        "end_year": cfg["projection"]["end_year"],
    }
    r = _run(cfg)
    assert r["summary"]["lifetime_gifted"] > 0
    assert r["summary"]["gift_pot_at_second_death"] > r["summary"]["lifetime_gifted"]
    assert "giving" in r
    assert set(r["giving"].keys()) == {"annual_pot", "total_gifted", "ending_pot"}


def test_projection_gifting_lowers_networth():
    d = _defaults()
    base = _run(copy.deepcopy(d))
    cfg = copy.deepcopy(d)
    cfg["giving"] = {
        "annual_gift_amount": 60000.0,
        "section_2503e_amount": 0.0,
        "start_year": cfg["projection"]["start_year"],
        "end_year": cfg["projection"]["end_year"],
    }
    r = _run(cfg)
    assert r["summary"]["ending_net_worth"] < base["summary"]["ending_net_worth"]
