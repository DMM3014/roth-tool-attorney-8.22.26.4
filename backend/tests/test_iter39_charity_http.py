"""HTTP tests for POST /api/charitable-beneficiary (Iteration 39).

Auth: the conftest hook injects a master bearer token, so these calls exercise
the same require_advisor_or_share gate the real UI passes.
"""
import copy
import os

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL", "")).rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"

URL = f"{BASE_URL}/api/charitable-beneficiary"


@pytest.fixture(scope="module")
def default_cfg():
    r = requests.get(f"{BASE_URL}/api/defaults", timeout=30)
    assert r.status_code == 200, f"defaults failed: {r.status_code} {r.text[:200]}"
    return r.json()


def _post(cfg):
    return requests.post(URL, json={"config": cfg}, timeout=180)


def test_charity_default_cfg(default_cfg):
    r = _post(default_cfg)
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    d = r.json()
    for k in ("cases", "combined_delta_conversions_effect", "winner", "fraction", "note"):
        assert k in d, f"missing key {k}"
    cases = d["cases"]
    assert set(cases) == {"no_charity", "charity_with_conversions", "charity_no_conversions"}
    for name, c in cases.items():
        for f in ("family_after_tax", "charity_receipt", "combined_family_charity", "total_tax_everyone"):
            assert isinstance(c[f], (int, float)), f"{name}.{f} not numeric"
    # No charity case must have zero receipt.
    assert cases["no_charity"]["charity_receipt"] == 0.0
    # Default household converts the whole IRA in life -> nothing left to give.
    assert cases["charity_with_conversions"]["charity_receipt"] == 0.0
    assert cases["charity_no_conversions"]["charity_receipt"] > 0
    assert d["winner"] == "charity_no_conversions"
    dd = d["combined_delta_conversions_effect"]
    assert abs(dd["today"]) <= abs(dd["nominal"]) + 0.01
    assert "_id" not in str(d)


def test_charity_fraction_from_config(default_cfg):
    cfg = copy.deepcopy(default_cfg)
    cfg.setdefault("beneficiary", {})["ira_to_charity_fraction"] = 0.5
    r = _post(cfg)
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    d = r.json()
    assert abs(d["fraction"] - 0.5) < 1e-6
    half = d["cases"]["charity_no_conversions"]["charity_receipt"]

    cfg["beneficiary"]["ira_to_charity_fraction"] = 1.0
    r2 = _post(cfg)
    assert r2.status_code == 200
    full = r2.json()["cases"]["charity_no_conversions"]["charity_receipt"]
    assert full > half > 0
    assert abs(full / 2.0 - half) / max(full, 1) < 0.02, "50% receipt should be ~half of 100%"


def test_projection_with_fraction_still_works(default_cfg):
    cfg = copy.deepcopy(default_cfg)
    cfg.setdefault("beneficiary", {})["ira_to_charity_fraction"] = 0.5
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": cfg}, timeout=120)
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    assert "legacy" in r.json() and "rows" in r.json()


def test_fraction_out_of_range_is_clamped_or_rejected(default_cfg):
    cfg = copy.deepcopy(default_cfg)
    cfg.setdefault("beneficiary", {})["ira_to_charity_fraction"] = 5.0
    r = _post(cfg)
    assert r.status_code in (200, 400, 422), f"unexpected {r.status_code}"
    if r.status_code == 200:
        assert r.json()["fraction"] <= 1.0

    cfg["beneficiary"]["ira_to_charity_fraction"] = "abc"
    r2 = _post(cfg)
    assert r2.status_code in (200, 400, 422), f"unexpected {r2.status_code}"


def test_requires_auth(default_cfg):
    r = requests.post(URL, json={"config": default_cfg},
                      headers={"X-Test-No-Auth": "1"}, timeout=60)
    assert r.status_code in (401, 403), f"unauthenticated call returned {r.status_code}"
