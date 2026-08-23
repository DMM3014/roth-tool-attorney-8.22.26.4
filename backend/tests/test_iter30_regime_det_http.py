"""Iteration 30 — HTTP tests for POST /api/regime-deterministic-compare.

Goes through the public ingress URL with a master token (auth is rate-limited so
one token is fetched per session and reused).
"""
import copy
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"

EXPECTED_PRESETS = {
    "historical_avg", "last_50_years", "70s_stagflation", "lost_decade",
    "high_inflation", "low_return",
}  # 'custom' is a no-op passthrough == baseline and is excluded (matches the MC table)


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": MASTER_PIN}, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"master auth failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def default_cfg(client):
    r = client.get(f"{BASE_URL}/api/defaults", timeout=60)
    assert r.status_code == 200, r.text[:300]
    return r.json()


@pytest.fixture(scope="session")
def det_result(client, default_cfg):
    r = client.post(f"{BASE_URL}/api/regime-deterministic-compare",
                    json={"config": default_cfg}, timeout=300)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:500]}"
    return r.json()


# --- shape / contract ---
def test_response_shape(det_result):
    d = det_result
    for k in ("baseline_id", "start_year", "second_death_year", "heir_deliver_year", "rows"):
        assert k in d, f"missing {k}"
    assert len(d["rows"]) == 6, f"expected 6 rows (custom excluded), got {len(d['rows'])}"
    assert {r["preset_id"] for r in d["rows"]} == EXPECTED_PRESETS
    assert d["heir_deliver_year"] > d["start_year"]
    assert "_id" not in d


def test_row_fields(det_result):
    for r in det_result["rows"]:
        assert r["label"]
        assert isinstance(r["general_inflation"], (int, float))
        for br in ("with_conversions", "no_conversions"):
            for f in ("net_worth_at_second_death", "after_tax_to_heirs_secure10", "lifetime_taxes"):
                assert f in r[br], f"{r['preset_id']}.{br} missing {f}"
                assert isinstance(r[br][f], (int, float))
        w = r["with_conversions"]["after_tax_to_heirs_secure10"]
        n = r["no_conversions"]["after_tax_to_heirs_secure10"]
        assert r["conversion_delta_to_heirs_nominal"] == pytest.approx(w - n, abs=0.02)
        assert "conversion_delta_to_heirs_today" in r


# --- baseline exactness ---
def test_historical_avg_matches_plain_projection(client, default_cfg, det_result):
    r = client.post(f"{BASE_URL}/api/projection", json={"config": default_cfg}, timeout=180)
    assert r.status_code == 200, r.text[:300]
    leg = r.json()["legacy"]
    ha = next(x for x in det_result["rows"] if x["preset_id"] == "historical_avg")["with_conversions"]
    assert ha["net_worth_at_second_death"] == leg["gross_estate"]
    assert ha["after_tax_to_heirs_secure10"] == leg["after_tax_estate_to_heirs"]


def test_regimes_differ(det_result):
    vals = {r["preset_id"]: r["with_conversions"]["after_tax_to_heirs_secure10"]
            for r in det_result["rows"]}
    assert vals["70s_stagflation"] != vals["historical_avg"]
    assert vals["lost_decade"] != vals["historical_avg"]


# --- caching / config sensitivity ---
def test_repeat_is_stable(client, default_cfg, det_result):
    r = client.post(f"{BASE_URL}/api/regime-deterministic-compare",
                    json={"config": default_cfg}, timeout=300)
    assert r.status_code == 200
    assert r.json() == det_result


def test_modified_config_changes_result(client, default_cfg, det_result):
    cfg = copy.deepcopy(default_cfg)
    accts = cfg.get("accounts") or []
    target = next((a for a in accts if a.get("tax_type") == "Tax-Deferred"), None)
    if target is None:
        pytest.skip("no tax-deferred account in default config")
    target["beginning_balance"] = float(target.get("beginning_balance", 0)) * 1.5 + 250000
    r = client.post(f"{BASE_URL}/api/regime-deterministic-compare",
                    json={"config": cfg}, timeout=300)
    assert r.status_code == 200, r.text[:300]
    new = r.json()
    a = next(x for x in new["rows"] if x["preset_id"] == "historical_avg")
    b = next(x for x in det_result["rows"] if x["preset_id"] == "historical_avg")
    assert a["with_conversions"]["after_tax_to_heirs_secure10"] != \
        b["with_conversions"]["after_tax_to_heirs_secure10"]


# --- auth ---
def test_requires_auth(default_cfg):
    # conftest auto-injects an advisor token; X-Test-No-Auth is the escape hatch.
    r = requests.post(f"{BASE_URL}/api/regime-deterministic-compare",
                      json={"config": default_cfg},
                      headers={"X-Test-No-Auth": "1"}, timeout=120)
    assert r.status_code in (401, 403), f"unauthenticated call returned {r.status_code}"
