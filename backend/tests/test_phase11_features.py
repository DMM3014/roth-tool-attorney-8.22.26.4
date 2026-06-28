"""
Phase 11 backend tests:
  - post_death_rows structure & monotonicity (Roth grows, Traditional depletes)
  - after_tax_estate_to_heirs (10-yr forward) > after_tax_estate_at_death (immediate)
  - surplus_sweep_to: Taxable vs Cash produces different ending net worth
  - /api/sweep best == ranked[0] and label valid
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


class TestPostDeathHorizon:
    def test_legacy_block_has_phase11_fields(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        assert r.status_code == 200
        leg = r.json()["legacy"]
        for k in ("gross_estate", "estate_settlement", "inherited_ira_tax",
                  "tax_free_roth_to_heirs", "after_tax_estate_to_heirs",
                  "after_tax_estate_at_death", "heir_ordinary_rate",
                  "heir_federal_rate", "heir_state_rate", "step_up_at_death",
                  "horizon_years", "post_death_rows"):
            assert k in leg, f"missing legacy field: {k}"
        assert leg["horizon_years"] == 10
        assert isinstance(leg["post_death_rows"], list) and len(leg["post_death_rows"]) == 10

    def test_post_death_rows_structure_and_monotonicity(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        rows = r.json()["legacy"]["post_death_rows"]
        for i, row in enumerate(rows, start=1):
            for k in ("year_after_death", "inherited_roth", "inherited_traditional",
                      "ira_tax_paid", "taxable_and_reinvested", "total_to_heirs"):
                assert k in row, f"row {i} missing {k}"
            assert row["year_after_death"] == i
        # Inherited Roth INCREASES each year (tax-free compounding)
        roths = [r["inherited_roth"] for r in rows]
        assert all(roths[i] >= roths[i - 1] for i in range(1, len(roths))), roths
        # Inherited Traditional DECREASES (forced 10-yr depletion) and ~0 at year 10
        trads = [r["inherited_traditional"] for r in rows]
        assert trads[-1] < 1.0, f"traditional should fully deplete by year 10, got {trads[-1]}"

    def test_headline_10yr_exceeds_at_death(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        leg = r.json()["legacy"]
        assert leg["after_tax_estate_to_heirs"] > leg["after_tax_estate_at_death"], (
            f"10-yr horizon should exceed at-death value: "
            f"to_heirs={leg['after_tax_estate_to_heirs']} at_death={leg['after_tax_estate_at_death']}"
        )


class TestSurplusSweep:
    def test_taxable_vs_cash_sweep_differs(self, client, defaults):
        cfg_tax = copy.deepcopy(defaults)
        cfg_tax["withdrawal"]["surplus_sweep_to"] = "Taxable"
        cfg_cash = copy.deepcopy(defaults)
        cfg_cash["withdrawal"]["surplus_sweep_to"] = "Cash"

        r1 = client.post(f"{BASE_URL}/api/projection", json={"config": cfg_tax}, timeout=60)
        r2 = client.post(f"{BASE_URL}/api/projection", json={"config": cfg_cash}, timeout=60)
        assert r1.status_code == 200 and r2.status_code == 200
        s_tax = r1.json()["summary"]
        s_cash = r2.json()["summary"]
        # Net worth should differ; Taxable sweep compounds at gross return, cash at cash rate
        assert s_tax["ending_net_worth"] != s_cash["ending_net_worth"], (
            f"sweeps should differ: tax={s_tax['ending_net_worth']} cash={s_cash['ending_net_worth']}"
        )
        assert s_tax["ending_taxable"] != s_cash["ending_taxable"]


class TestSweepRegression:
    def test_sweep_best_is_ranked_first_and_valid(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/sweep", json={"config": defaults}, timeout=180)
        assert r.status_code == 200
        body = r.json()
        assert body["best"] == body["ranked"][0]
        valid_labels = {"No conversions"} | {f"Fill {int(x*100)}% bracket" for x in
                                             (0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37)}
        assert body["best"]["label"] in valid_labels


class TestTaxRegression:
    """Confirms /api/tax/year still returns 200 with the standard payload
    (exact 320800/22500 values are validated in test_planner_api.TestTaxYear)."""
    def test_tax_year_endpoint_alive(self, client):
        payload = {
            "filing_status": "MFJ", "year": 2026, "bracket_index": 1.0,
            "irmaa_index": 1.0, "num_65plus": 0, "medicare_count": 0,
            "ordinary_non_ss": 350000, "ira_distributions": 0,
            "cash_interest": 3000, "gross_ss": 0,
            "recurring_div_ltcg": 150000, "realized_ltcg": 0,
            "state_rate": 0.0399, "include_irmaa": True,
        }
        r = client.post(f"{BASE_URL}/api/tax/year", json={"inputs": payload}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert abs(d["ordinary_taxable_income"] - 320800) < 0.5, d
        assert abs(d["federal_ltcg_tax"] - 22500) < 0.5, d
