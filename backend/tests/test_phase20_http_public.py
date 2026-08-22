"""Phase 20 HTTP tests against public preview URL - routing & Monte Carlo correlation."""
import os
import time
import copy
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://cv-craft-504.preview.emergentagent.com").rstrip("/")
# ingress blocks python-urllib default UA -> use browser UA
HDRS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "X-Session-Token": "0b7a2f77-49a1-4a6a-9d3e-1c2b3d4e5f60"}


@pytest.fixture(scope="module")
def defaults():
    r = requests.get(f"{BASE_URL}/api/defaults", headers=HDRS, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _post_projection(cfg):
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": cfg}, headers=HDRS, timeout=60)
    return r


def test_projection_default_auto_accounts_empty(defaults):
    r = _post_projection(defaults)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("auto_accounts", None) == []


def test_projection_spouse_heavy_routes_to_ROTS(defaults):
    cfg = copy.deepcopy(defaults)
    for a in cfg["accounts"]:
        if a["id"] == "IRAC":
            a["beginning_balance"] = 100000
        elif a["id"] == "IRAS":
            a["beginning_balance"] = 4900000
    r = _post_projection(cfg)
    assert r.status_code == 200, r.text
    data = r.json()
    rows = data["rows"]
    last = rows[-1]["account_balances"]
    assert last.get("ROTS", 0) > 0, f"ROTS should be positive, got {last.get('ROTS')}"
    assert last.get("ROTC", 0) > 0, f"ROTC should be positive, got {last.get('ROTC')}"
    assert data.get("auto_accounts", []) == []


def test_projection_auto_creates_spouse_roth(defaults):
    cfg = copy.deepcopy(defaults)
    for a in cfg["accounts"]:
        if a["id"] == "IRAC":
            a["beginning_balance"] = 100000
        elif a["id"] == "IRAS":
            a["beginning_balance"] = 4900000
    # remove ROTS
    cfg["accounts"] = [a for a in cfg["accounts"] if a["id"] != "ROTS"]
    r = _post_projection(cfg)
    assert r.status_code == 200, r.text
    data = r.json()
    autos = data.get("auto_accounts", [])
    assert any(a.get("id") == "ROTH-AUTO-SPOUSE" for a in autos), f"expected ROTH-AUTO-SPOUSE in {autos}"
    auto = [a for a in autos if a["id"] == "ROTH-AUTO-SPOUSE"][0]
    assert auto.get("owner") == "Spouse"
    assert auto.get("tax_type") == "Tax-Free"
    last = data["rows"][-1]["account_balances"]
    assert last.get("ROTH-AUTO-SPOUSE", 0) > 0


def _run_mc(body, wait=60):
    r = requests.post(f"{BASE_URL}/api/montecarlo", json=body, headers=HDRS, timeout=30)
    if r.status_code != 200:
        return r, None
    job_id = r.json()["job_id"]
    for _ in range(wait):
        time.sleep(1)
        s = requests.get(f"{BASE_URL}/api/montecarlo/{job_id}", headers=HDRS, timeout=30)
        assert s.status_code == 200
        j = s.json()
        if j.get("status") in ("done", "error"):
            return r, j
    pytest.fail("Monte Carlo did not finish in time")


def test_mc_correlated_with_inflation(defaults):
    body = {
        "config": defaults,
        "n_trials": 300,
        "seed": 11,
        "inflation": {"enabled": True, "mean": 0.03, "vol": 0.02},
        "correlation": {
            "enabled": True,
            "stocks_bonds": 0.15,
            "stocks_cash": 0.0,
            "bonds_cash": 0.2,
            "stocks_inflation": -0.2,
            "bonds_inflation": -0.3,
            "cash_inflation": 0.55,
        },
    }
    _, j = _run_mc(body, wait=90)
    assert j["status"] == "done", j
    corr = j["result"]["correlation"]
    assert corr["enabled"] is True
    assert corr["includes_inflation"] is True
    assert corr["adjusted_to_psd"] is False
    mu = corr["matrix_used"]
    rl = corr["realized"]
    for k, v in mu.items():
        assert abs(rl[k] - v) <= 0.06, f"realized {k}={rl[k]} vs requested {v}"


def test_mc_correlation_out_of_range_422(defaults):
    body = {
        "config": defaults,
        "n_trials": 100,
        "seed": 1,
        "correlation": {"enabled": True, "stocks_bonds": 1.5},
    }
    r = requests.post(f"{BASE_URL}/api/montecarlo", json=body, headers=HDRS, timeout=30)
    assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"


def test_mc_correlation_without_inflation(defaults):
    body = {
        "config": defaults,
        "n_trials": 200,
        "seed": 7,
        "inflation": {"enabled": False, "mean": 0.03, "vol": 0.0},
        "correlation": {
            "enabled": True,
            "stocks_bonds": 0.15,
            "stocks_cash": 0.0,
            "bonds_cash": 0.2,
        },
    }
    _, j = _run_mc(body, wait=90)
    assert j["status"] == "done", j
    corr = j["result"]["correlation"]
    assert corr["includes_inflation"] is False
    mu = corr["matrix_used"]
    assert set(mu.keys()) == {"stocks_bonds", "stocks_cash", "bonds_cash"}


def test_mc_no_correlation_field_backward_compat(defaults):
    body = {"config": defaults, "n_trials": 150, "seed": 3}
    _, j = _run_mc(body, wait=90)
    assert j["status"] == "done", j
    assert j["result"].get("correlation") is None
