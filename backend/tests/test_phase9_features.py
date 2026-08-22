"""
Backend tests for Phase 9 features:
  /api/sweep, /api/projection legacy block, and config-edit propagation.
"""
import os
import sys
import copy
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from defaults import DEFAULT_SCENARIO  # noqa: E402


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def defaults(client):
    # Use built-in DEFAULT_SCENARIO — immune to whatever user_defaults.json contains.
    return copy.deepcopy(DEFAULT_SCENARIO)


# ---------- /api/sweep ----------
class TestSweep:
    def test_sweep_structure_and_best(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/sweep", json={"config": defaults}, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        # required top-level keys
        for k in ["results", "ranked", "best", "metric"]:
            assert k in d, f"missing key {k}"
        assert d["metric"] == "after_tax_estate_to_heirs"
        # results contains baseline + 7 brackets = 8 entries
        assert len(d["results"]) == 8, f"expected 8 entries got {len(d['results'])}"
        labels = [e["label"] for e in d["results"]]
        assert "No conversions" in labels
        assert "Fill 24% bracket" in labels

        # ranked sorted desc by after_tax_estate
        atees = [e["after_tax_estate"] for e in d["ranked"]]
        assert atees == sorted(atees, reverse=True), atees

        # best is top of ranked
        assert d["best"] == d["ranked"][0]

        # entry fields
        for e in d["results"]:
            for f in ["label", "target_bracket", "lifetime_taxes",
                      "ending_net_worth", "ending_roth",
                      "total_converted", "after_tax_estate"]:
                assert f in e, f"missing {f} in {e}"

    def test_sweep_best_is_valid_bracket(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/sweep", json={"config": defaults}, timeout=120)
        assert r.status_code == 200
        d = r.json()
        valid = {"No conversions", "Fill 10% bracket", "Fill 12% bracket",
                 "Fill 22% bracket", "Fill 24% bracket", "Fill 32% bracket",
                 "Fill 35% bracket", "Fill 37% bracket"}
        assert d["best"]["label"] in valid, d["best"]["label"]
        # best must be the highest-ranked entry by after-tax estate to heirs
        assert d["best"] == d["ranked"][0]
        assert d["best"]["after_tax_estate"] == max(e["after_tax_estate"] for e in d["results"])


# ---------- /api/projection legacy block ----------
class TestProjectionLegacy:
    def test_legacy_block_present(self, client, defaults):
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "legacy" in d, d.keys()
        leg = d["legacy"]
        for k in ["gross_estate", "estate_settlement", "inherited_ira_tax",
                  "tax_free_roth_to_heirs", "after_tax_estate_to_heirs",
                  "after_tax_estate_at_death", "heir_ordinary_rate",
                  "step_up_at_death", "horizon_years", "post_death_rows"]:
            assert k in leg, f"missing {k} in legacy"

        # Sanity: numeric and consistent
        assert leg["gross_estate"] > 0
        # estate settlement = 1% of gross_estate (defaults)
        assert abs(leg["estate_settlement"] - leg["gross_estate"] * 0.01) < 1.0
        # at-death after-tax = gross - settlement - (ending traditional * heir rate)
        expected_at_death = (leg["gross_estate"]
                             - leg["estate_settlement"]
                             - d["summary"]["ending_traditional"] * leg["heir_ordinary_rate"])
        assert abs(leg["after_tax_estate_at_death"] - expected_at_death) < 1.0
        # 10-year SECURE horizon: full schedule present, Roth compounds, IRA depletes
        assert leg["horizon_years"] == 10
        assert len(leg["post_death_rows"]) == 10
        assert leg["post_death_rows"][-1]["inherited_traditional"] < 1.0  # fully depleted by yr10
        # the 10-year-forward value grows beyond the at-death value
        assert leg["after_tax_estate_to_heirs"] > leg["after_tax_estate_at_death"]
        expected_heir_rate = (defaults["legacy"]["heir_federal_rate"]
                              + defaults["legacy"]["heir_state_rate"])
        assert abs(leg["heir_ordinary_rate"] - expected_heir_rate) < 1e-6
        assert leg["step_up_at_death"] is True


# ---------- Config edit propagation ----------
class TestConfigEdit:
    def test_higher_ira_balance_changes_projection(self, client, defaults):
        import copy

        # Baseline
        r0 = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        assert r0.status_code == 200
        base = r0.json()
        base_summary = base["summary"]
        base_legacy = base["legacy"]

        # Bump Client trad IRA from 3.85M -> 6M
        edited = copy.deepcopy(defaults)
        for a in edited["accounts"]:
            if a["id"] == "IRAC":
                a["beginning_balance"] = 6000000
                break

        r1 = client.post(f"{BASE_URL}/api/projection", json={"config": edited}, timeout=60)
        assert r1.status_code == 200, r1.text
        new = r1.json()
        new_summary = new["summary"]

        # Higher IRA -> more taxes / more conversions / different ending balances
        assert new_summary["lifetime_taxes"] != base_summary["lifetime_taxes"], \
            "expected lifetime_taxes to change after raising IRA balance"
        # Higher IRA -> higher ending net worth & higher gross estate
        assert new_summary["ending_net_worth"] > base_summary["ending_net_worth"]
        # Same number of rows
        assert len(new["rows"]) == len(base["rows"])
        # Legacy should also shift (gross estate larger)
        assert new["legacy"]["gross_estate"] > base_legacy["gross_estate"]
        # Inherited IRA tax should be higher (more trad IRA leftover)
        assert new["legacy"]["inherited_ira_tax"] >= base_legacy["inherited_ira_tax"]

    def test_edit_income_stream_changes_projection(self, client, defaults):
        import copy
        edited = copy.deepcopy(defaults)
        # Reduce wages from 350k to 100k
        for s in edited["income_streams"]:
            if s["id"] == "WAG01":
                s["amount"] = 100000
                break
        r0 = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        r1 = client.post(f"{BASE_URL}/api/projection", json={"config": edited}, timeout=60)
        assert r0.status_code == 200 and r1.status_code == 200
        s0 = r0.json()["summary"]
        s1 = r1.json()["summary"]
        # Reducing wages reduces lifetime taxes
        assert s1["lifetime_taxes"] < s0["lifetime_taxes"], \
            f"expected lower taxes with lower wages: {s1['lifetime_taxes']} >= {s0['lifetime_taxes']}"
