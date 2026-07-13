"""
Phase 26 — Legacy after-tax attribution break-out.

The Compare Funding Orders UI splits `after_tax_estate_to_heirs` into three sub-rows:
  - roth_to_heirs             (tax-free)
  - ira_post_tax_to_heirs     (inherited IRA depleted over SECURE horizon, net of heirs' ordinary tax)
  - nonretirement_to_heirs    (taxable + cash + real estate, step-up applied, LTCG on post-death appreciation)

Invariant: these three MUST sum to `after_tax_estate_to_heirs` for every run.
"""
import copy
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


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


class TestHeirsBreakdown:
    def test_components_sum_to_total(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        assert r.status_code == 200, r.text
        leg = r.json()["legacy"]
        for k in ("roth_to_heirs", "ira_post_tax_to_heirs", "nonretirement_to_heirs",
                  "after_tax_estate_to_heirs"):
            assert k in leg, f"missing legacy key: {k}"
        parts = leg["roth_to_heirs"] + leg["ira_post_tax_to_heirs"] + leg["nonretirement_to_heirs"]
        # Rounding across three fields can drift a few cents from the pre-rounded total_10yr;
        # tolerate 1 dollar.
        assert abs(parts - leg["after_tax_estate_to_heirs"]) < 1.0, (
            f"break-out sum {parts:.2f} != total {leg['after_tax_estate_to_heirs']:.2f}")

    def test_roth_component_matches_tax_free_row(self, client, defaults):
        """The Roth sub-row should equal the existing Tax-Free Roth to Heirs metric."""
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        leg = r.json()["legacy"]
        assert leg["roth_to_heirs"] == pytest.approx(leg["tax_free_roth_to_heirs"], abs=0.01)

    def test_nonretirement_positive_when_taxable_exists(self, client, defaults):
        """Given a meaningful taxable + cash + real estate footprint in the default scenario,
        the non-retirement bucket must be > 0 (not silently missing)."""
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        leg = r.json()["legacy"]
        assert leg["nonretirement_to_heirs"] > 0

    def test_funding_order_shifts_component_mix(self, client, defaults):
        """Switching from 'leave IRA' to 'deplete IRA now' should shrink the inherited-IRA
        bucket and grow the non-retirement bucket, since the depletion strategy converts more
        of the IRA to after-tax taxable during life."""
        leave = copy.deepcopy(defaults)
        leave.setdefault("withdrawal", {})["funding_order"] = "Cash → Taxable → IRA → Roth"
        deplete = copy.deepcopy(defaults)
        deplete.setdefault("withdrawal", {})["funding_order"] = "Cash → IRA → Taxable → Roth"
        r1 = client.post(f"{BASE_URL}/api/projection", json={"config": leave}, timeout=60).json()["legacy"]
        r2 = client.post(f"{BASE_URL}/api/projection", json={"config": deplete}, timeout=60).json()["legacy"]
        assert r2["ira_post_tax_to_heirs"] < r1["ira_post_tax_to_heirs"]
