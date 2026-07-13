"""HTTP-level tests for Phase-17 endpoints exercising the public preview URL.
Verifies exact review-request checklist bullets for /api/strategy-sweep,
/api/ss-optimizer and the updated /api/projection response shape/values.
"""
import os
import copy
import requests
import pytest

# Import DEFAULT_SCENARIO in-process to send full payload
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from defaults import DEFAULT_SCENARIO  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # frontend/.env fallback
    _env = open("/app/frontend/.env").read()
    for ln in _env.splitlines():
        if ln.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
            break

TIMEOUT = 90


@pytest.fixture(scope="module")
def scenario():
    return copy.deepcopy(DEFAULT_SCENARIO)


# -------- /api/projection (regression + roth_compliance) --------

def test_projection_has_roth_compliance_and_math_unchanged(scenario):
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": scenario}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    # roth_compliance block
    rc = data.get("roth_compliance")
    assert rc is not None, "missing roth_compliance"
    assert rc.get("warnings") == []
    assert rc.get("total_early_penalty") == 0
    assert "conversions_ledger" in rc
    # summary early penalty
    assert data["summary"]["roth_early_penalty_total"] == 0
    # regression numbers (allow tiny FP drift)
    assert abs(data["summary"]["lifetime_taxes"] - 7075325.52) < 1.0
    assert abs(data["summary"]["ending_net_worth"] - 80238883.64) < 1.0


def test_projection_year_targets_differs_from_flat(scenario):
    flat = copy.deepcopy(scenario)
    flat["roth"]["target_bracket"] = 0.24
    r1 = requests.post(f"{BASE_URL}/api/projection", json={"config": flat}, timeout=TIMEOUT)
    assert r1.status_code == 200
    flat_total = r1.json()["summary"]["total_roth_converted"]

    phased = copy.deepcopy(scenario)
    phased["roth"]["target_bracket"] = 0.24
    phased["roth"]["year_targets"] = {"2026": 0.32, "2027": 0.32, "2028": 0.24, "2029": 0.24}
    r2 = requests.post(f"{BASE_URL}/api/projection", json={"config": phased}, timeout=TIMEOUT)
    assert r2.status_code == 200
    phased_total = r2.json()["summary"]["total_roth_converted"]

    assert abs(phased_total - flat_total) > 1.0, (phased_total, flat_total)


# -------- /api/strategy-sweep --------

def test_strategy_sweep_default_shape(scenario):
    r = requests.post(
        f"{BASE_URL}/api/strategy-sweep",
        json={"config": scenario},
        timeout=180,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("ranked", "results", "best", "baseline", "grid"):
        assert key in d, f"missing {key}"
    assert len(d["ranked"]) > 0
    # PV present + PV <= nominal for each row
    for row in d["ranked"]:
        assert "after_tax_estate" in row
        assert "after_tax_estate_pv" in row
        assert row["after_tax_estate_pv"] <= row["after_tax_estate"] + 1e-6
    # best equals top of ranked
    assert d["ranked"][0]["after_tax_estate"] == d["best"]["after_tax_estate"]


def test_strategy_sweep_include_phased(scenario):
    r = requests.post(
        f"{BASE_URL}/api/strategy-sweep",
        json={"config": scenario, "include_phased": True},
        timeout=240,
    )
    assert r.status_code == 200
    rows = r.json()["results"]
    phased = [x for x in rows if x.get("kind") == "phased"]
    assert phased, "expected at least one phased row"
    assert isinstance(phased[0].get("segments"), list) and len(phased[0]["segments"]) >= 2


def test_strategy_sweep_beats_baseline_specific_grid(scenario):
    r = requests.post(
        f"{BASE_URL}/api/strategy-sweep",
        json={
            "config": scenario,
            "start_years": [2026],
            "stop_years": [2062],
            "brackets": [0.22, 0.32],
            "include_phased": False,
        },
        timeout=180,
    )
    assert r.status_code == 200
    d = r.json()
    assert d["best"]["after_tax_estate"] > d["baseline"]["after_tax_estate"]


# -------- /api/ss-optimizer --------

def test_ss_optimizer_default(scenario):
    r = requests.post(
        f"{BASE_URL}/api/ss-optimizer",
        json={"config": scenario},
        timeout=180,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("baseline", "ranked", "fra_amounts", "fra_ages"):
        assert k in d, f"missing {k}"
    # FRA amounts
    assert abs(d["fra_amounts"]["Client"] - 4152) < 5, d["fra_amounts"]
    assert abs(d["fra_amounts"]["Spouse"] - 4152) < 5, d["fra_amounts"]
    # ranking descending
    estates = [row["after_tax_estate"] for row in d["ranked"]]
    assert estates == sorted(estates, reverse=True)


def test_ss_optimizer_ages_grid(scenario):
    r = requests.post(
        f"{BASE_URL}/api/ss-optimizer",
        json={"config": scenario, "ages": [62, 70]},
        timeout=180,
    )
    assert r.status_code == 200
    rows = r.json()["ranked"]
    assert len(rows) == 4
    for row in rows:
        assert "client_age" in row and "spouse_age" in row
        assert row["client_age"] in (62, 70)
        assert row["spouse_age"] in (62, 70)
