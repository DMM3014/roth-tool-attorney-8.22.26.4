"""
Backend tests for Phase 10 features:
  - Legacy heir_ordinary_rate = heir_federal_rate + heir_state_rate
  - /api/sweep heir-rate sensitivity
  - Projection state-rate sensitivity
  - Projection max-annual conversion cap
"""
import copy
import os
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def defaults(client):
    r = client.get(f"{BASE_URL}/api/defaults", timeout=15)
    assert r.status_code == 200
    return r.json()


# ---------- Heir rate derivation ----------
class TestHeirRate:
    def test_default_heir_rate_is_sum(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        assert r.status_code == 200
        leg = r.json()["legacy"]
        # 0.24 + 0.06 = 0.30
        assert abs(leg["heir_ordinary_rate"] - 0.30) < 1e-6, leg
        # inherited_ira_tax should == end_trad * 0.30 approximately
        # We can't easily extract end_trad, but we can check it's positive
        assert leg["inherited_ira_tax"] >= 0

    def test_changing_heir_rate_changes_inherited_tax(self, client, defaults):
        # Low heir rate
        low_cfg = copy.deepcopy(defaults)
        low_cfg["legacy"]["heir_federal_rate"] = 0.12
        low_cfg["legacy"]["heir_state_rate"] = 0.0
        r_low = client.post(f"{BASE_URL}/api/projection", json={"config": low_cfg}, timeout=60)
        assert r_low.status_code == 200
        leg_low = r_low.json()["legacy"]
        assert abs(leg_low["heir_ordinary_rate"] - 0.12) < 1e-6

        # High heir rate
        high_cfg = copy.deepcopy(defaults)
        high_cfg["legacy"]["heir_federal_rate"] = 0.37
        high_cfg["legacy"]["heir_state_rate"] = 0.10
        r_high = client.post(f"{BASE_URL}/api/projection", json={"config": high_cfg}, timeout=60)
        assert r_high.status_code == 200
        leg_high = r_high.json()["legacy"]
        assert abs(leg_high["heir_ordinary_rate"] - 0.47) < 1e-6

        # Inherited tax must be much larger when heir rate jumps from 0.12 -> 0.47
        assert leg_high["inherited_ira_tax"] > leg_low["inherited_ira_tax"]
        # After-tax estate must be lower under high heir rate
        assert leg_high["after_tax_estate_to_heirs"] < leg_low["after_tax_estate_to_heirs"]


# ---------- /api/sweep heir-rate sensitivity ----------
class TestSweepHeirRate:
    def test_no_conversions_atee_higher_under_low_heir_rate(self, client, defaults):
        # Low heir rate (0.12 / 0.0)
        low_cfg = copy.deepcopy(defaults)
        low_cfg["legacy"]["heir_federal_rate"] = 0.12
        low_cfg["legacy"]["heir_state_rate"] = 0.0
        r_low = client.post(f"{BASE_URL}/api/sweep", json={"config": low_cfg}, timeout=180)
        assert r_low.status_code == 200, r_low.text
        results_low = {e["label"]: e for e in r_low.json()["results"]}
        noconv_low_atee = results_low["No conversions"]["after_tax_estate"]

        # High heir rate (0.37 / 0.10)
        high_cfg = copy.deepcopy(defaults)
        high_cfg["legacy"]["heir_federal_rate"] = 0.37
        high_cfg["legacy"]["heir_state_rate"] = 0.10
        r_high = client.post(f"{BASE_URL}/api/sweep", json={"config": high_cfg}, timeout=180)
        assert r_high.status_code == 200
        results_high = {e["label"]: e for e in r_high.json()["results"]}
        noconv_high_atee = results_high["No conversions"]["after_tax_estate"]

        assert noconv_low_atee > noconv_high_atee, \
            f"low heir rate ATEE {noconv_low_atee} should exceed high heir rate {noconv_high_atee}"
        # Sanity ranges (from problem statement: ~45.5M low, ~40.5M high)
        assert 40_000_000 < noconv_low_atee < 60_000_000, noconv_low_atee
        assert 30_000_000 < noconv_high_atee < 50_000_000, noconv_high_atee


# ---------- State rate sensitivity ----------
class TestStateRate:
    def test_state_rate_change_changes_lifetime_taxes(self, client, defaults):
        cfg_zero = copy.deepcopy(defaults)
        cfg_zero["tax"]["state_rate"] = 0.0
        cfg_default = copy.deepcopy(defaults)
        cfg_default["tax"]["state_rate"] = 0.0399

        r0 = client.post(f"{BASE_URL}/api/projection", json={"config": cfg_zero}, timeout=60)
        r1 = client.post(f"{BASE_URL}/api/projection", json={"config": cfg_default}, timeout=60)
        assert r0.status_code == 200 and r1.status_code == 200
        lt_zero = r0.json()["summary"]["lifetime_taxes"]
        lt_default = r1.json()["summary"]["lifetime_taxes"]
        assert lt_default > lt_zero, \
            f"expected higher taxes with state_rate=0.0399 ({lt_default}) vs 0.0 ({lt_zero})"


# ---------- Max annual conversion cap ----------
class TestMaxAnnualCap:
    def test_cap_reduces_total_converted(self, client, defaults):
        # No cap
        cfg_nocap = copy.deepcopy(defaults)
        cfg_nocap["roth"]["max_annual"] = 0.0
        r0 = client.post(f"{BASE_URL}/api/projection", json={"config": cfg_nocap}, timeout=60)
        assert r0.status_code == 200
        total_nocap = r0.json()["summary"]["total_roth_converted"]

        # Cap 50k/yr
        cfg_cap = copy.deepcopy(defaults)
        cfg_cap["roth"]["max_annual"] = 50000.0
        r1 = client.post(f"{BASE_URL}/api/projection", json={"config": cfg_cap}, timeout=60)
        assert r1.status_code == 200
        total_cap = r1.json()["summary"]["total_roth_converted"]

        assert total_cap < total_nocap, \
            f"cap should reduce total_roth_converted: cap={total_cap} nocap={total_nocap}"


# ---------- Funding order sensitivity ----------
class TestFundingOrder:
    def test_funding_order_changes_lifetime_tax(self, client, defaults):
        cfg_a = copy.deepcopy(defaults)
        cfg_a["withdrawal"]["funding_order"] = "Cash → Taxable → IRA → Roth"
        cfg_b = copy.deepcopy(defaults)
        cfg_b["withdrawal"]["funding_order"] = "Cash → IRA → Taxable → Roth"

        r_a = client.post(f"{BASE_URL}/api/projection", json={"config": cfg_a}, timeout=60)
        r_b = client.post(f"{BASE_URL}/api/projection", json={"config": cfg_b}, timeout=60)
        assert r_a.status_code == 200 and r_b.status_code == 200
        lt_a = r_a.json()["summary"]["lifetime_taxes"]
        lt_b = r_b.json()["summary"]["lifetime_taxes"]
        # Different orderings should produce different lifetime taxes
        assert lt_a != lt_b, f"funding order should change lifetime_taxes: a={lt_a} b={lt_b}"
