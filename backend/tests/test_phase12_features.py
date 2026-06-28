"""Phase 12 backend tests: IRMAA tier cap on conversions, configurable post-death
horizon length, and configurable heir reinvest return."""
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


def _project(client, cfg):
    r = client.post(f"{BASE_URL}/api/projection", json={"config": cfg}, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


# IRMAA tier cap on conversions
class TestIrmaaTierCap:
    def test_cap_loosening_increases_conversion(self, client, defaults):
        results = {}
        for cap in (0, 2, None):
            c = copy.deepcopy(defaults)
            c["roth"]["irmaa_tier_cap"] = cap
            results[cap] = _project(client, c)["summary"]["total_roth_converted"]
        # 0 = tightest (no surcharge) -> ~0; loosen -> more conversion
        assert results[0] < results[2] < results[None], results

    def test_cap_zero_yields_near_zero(self, client, defaults):
        c = copy.deepcopy(defaults)
        c["roth"]["irmaa_tier_cap"] = 0
        total = _project(client, c)["summary"]["total_roth_converted"]
        # base/no-surcharge tier - existing income already pushes MAGI close to threshold,
        # so conversion headroom should be very small (<$100k lifetime)
        assert total < 100_000, total


# Configurable post-death horizon
class TestPostDeathHorizonYears:
    def test_horizon_20_yields_20_rows_and_larger_estate(self, client, defaults):
        c10 = copy.deepcopy(defaults)
        c10["legacy"]["post_death_years"] = 10
        c20 = copy.deepcopy(defaults)
        c20["legacy"]["post_death_years"] = 20

        l10 = _project(client, c10)["legacy"]
        l20 = _project(client, c20)["legacy"]

        assert l20["horizon_years"] == 20
        assert len(l20["post_death_rows"]) == 20
        # 20 years of compounding -> larger after-tax estate
        assert l20["after_tax_estate_to_heirs"] > l10["after_tax_estate_to_heirs"], (
            l20["after_tax_estate_to_heirs"], l10["after_tax_estate_to_heirs"]
        )


# Heir reinvest return override
class TestHeirReinvestReturn:
    def test_lower_heir_return_lowers_estate(self, client, defaults):
        c_def = copy.deepcopy(defaults)
        c_def["legacy"]["heir_reinvest_return"] = None
        c_low = copy.deepcopy(defaults)
        c_low["legacy"]["heir_reinvest_return"] = 0.04

        l_def = _project(client, c_def)["legacy"]
        l_low = _project(client, c_low)["legacy"]

        assert l_def["heir_reinvest_return"] is None
        assert l_low["heir_reinvest_return"] == 0.04
        assert l_low["after_tax_estate_to_heirs"] < l_def["after_tax_estate_to_heirs"], (
            l_low["after_tax_estate_to_heirs"], l_def["after_tax_estate_to_heirs"]
        )


# Regression: prior phases still pass
class TestRegression:
    def test_sweep_best_first_and_valid(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/sweep", json={"config": defaults}, timeout=180)
        assert r.status_code == 200
        body = r.json()
        assert body["best"] == body["ranked"][0]
        valid = {"No conversions"} | {f"Fill {int(x*100)}% bracket" for x in
                                      (0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37)}
        assert body["best"]["label"] in valid

    def test_tax_year_standard_input(self, client):
        payload = {
            "filing_status": "MFJ", "year": 2026, "bracket_index": 1.0,
            "irmaa_index": 1.0, "num_65plus": 0, "medicare_count": 0,
            "ordinary_non_ss": 350000, "ira_distributions": 0,
            "cash_interest": 3000, "gross_ss": 0,
            "recurring_div_ltcg": 150000, "realized_ltcg": 0,
            "state_rate": 0.0399, "include_irmaa": True,
        }
        r = client.post(f"{BASE_URL}/api/tax/year", json={"inputs": payload}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert abs(d["ordinary_taxable_income"] - 320800) < 0.5
        assert abs(d["federal_ltcg_tax"] - 22500) < 0.5

    def test_legacy_block_has_phase12_fields(self, client, defaults):
        leg = _project(client, defaults)["legacy"]
        for k in ("post_death_rows", "after_tax_estate_at_death", "horizon_years",
                  "heir_reinvest_return"):
            assert k in leg
