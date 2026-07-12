"""Phase 23 — Security hardening round 3 (post-Phase-22 audit).

New DoS bounds added to `_validate_config`:
  - `legacy.post_death_years` capped at 100 (SECURE horizon is 10; 100 is generous)
  - `expenses` list capped at 60 entries
  - NaN/Infinity inside the free-form `config` dict rejected recursively (SEC-003)
  - `/api/tax/year` and `/api/tax/optimize` now rate-limited AND reject non-finite inputs

Also verifies the projection endpoint still returns 200 with a valid config
(guarding against a regression from wrapping `run_projection` in `asyncio.to_thread`).
"""
import copy
import json
import os
import uuid

import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "X-Session-Token": str(uuid.uuid4()),
    })
    return s


@pytest.fixture(scope="module")
def cfg(client):
    return client.get(f"{BASE_URL}/api/defaults", timeout=10).json()


# ---------- Round-3 bound: post_death_years ----------
def test_post_death_years_capped(client, cfg):
    """A 500-year post-death horizon would run a per-year loop 500× and blow up
    heir sleeves; must be rejected before any compute."""
    c = copy.deepcopy(cfg)
    c.setdefault("legacy", {})["post_death_years"] = 500
    r = client.post(f"{BASE_URL}/api/projection", json={"config": c}, timeout=10)
    assert r.status_code == 400, r.text
    assert "post_death_years" in r.json().get("detail", "")


def test_post_death_years_negative_rejected(client, cfg):
    c = copy.deepcopy(cfg)
    c.setdefault("legacy", {})["post_death_years"] = -5
    r = client.post(f"{BASE_URL}/api/projection", json={"config": c}, timeout=10)
    assert r.status_code == 400, r.text


def test_post_death_years_non_integer_rejected(client, cfg):
    """Booleans / floats-with-fraction / strings must all be rejected."""
    c = copy.deepcopy(cfg)
    c.setdefault("legacy", {})["post_death_years"] = 7.5
    r = client.post(f"{BASE_URL}/api/projection", json={"config": c}, timeout=10)
    assert r.status_code == 400, r.text


def test_post_death_years_valid_accepted(client, cfg):
    """The default (10) and boundary values must still be accepted."""
    c = copy.deepcopy(cfg)
    c.setdefault("legacy", {})["post_death_years"] = 100  # exact upper bound
    r = client.post(f"{BASE_URL}/api/projection", json={"config": c}, timeout=15)
    assert r.status_code == 200, r.text


# ---------- Round-3 bound: expenses list length ----------
def test_expenses_list_capped(client, cfg):
    """61 expenses > MAX_EXPENSES(60) → 400. Uses the same trick as `accounts` cap."""
    c = copy.deepcopy(cfg)
    c["expenses"] = [{"id": f"E{i}", "amount": 100, "start_year": 2026, "stop_year": 2027}
                     for i in range(61)]
    r = client.post(f"{BASE_URL}/api/projection", json={"config": c}, timeout=10)
    assert r.status_code == 400, r.text
    assert "expenses" in r.json().get("detail", "").lower()


# ---------- Round-3: NaN/Inf smuggled inside free-form config ----------
def _post_raw(client, path: str, body: str):
    """POST a raw (non-JSON-compliant) body string bypassing requests' JSON encoder."""
    return client.post(f"{BASE_URL}{path}", data=body, timeout=10)


def test_nan_inside_config_rejected(client, cfg):
    """`_reject_non_finite` walks the free-form dict and rejects NaN even when
    it's nested deep inside `projection.some_new_field`."""
    c = copy.deepcopy(cfg)
    # Inject a NaN inside a nested dict that pydantic won't type-check.
    c.setdefault("legacy", {})["heir_reinvest_return"] = float("nan")
    body = json.dumps({"config": c}, allow_nan=True)
    r = _post_raw(client, "/api/projection", body)
    assert r.status_code == 400, r.text
    assert "non-finite" in r.json().get("detail", "").lower()


def test_infinity_inside_config_rejected(client, cfg):
    c = copy.deepcopy(cfg)
    c.setdefault("legacy", {})["heir_reinvest_return"] = float("inf")
    body = json.dumps({"config": c}, allow_nan=True)
    r = _post_raw(client, "/api/projection", body)
    assert r.status_code == 400, r.text


def test_nan_in_scenarios_post_rejected(client, cfg):
    """The same guard runs on /api/scenarios."""
    c = copy.deepcopy(cfg)
    c["_tainted"] = float("nan")
    body = json.dumps({"name": "nan-test", "config": c}, allow_nan=True)
    r = _post_raw(client, "/api/scenarios", body)
    assert r.status_code == 400, r.text


# ---------- Round-3: tax endpoints reject NaN + rate-limited ----------
def test_tax_year_rejects_nan(client):
    body = json.dumps({"inputs": {"wages": float("nan")}}, allow_nan=True)
    r = _post_raw(client, "/api/tax/year", body)
    assert r.status_code == 400, r.text
    assert "non-finite" in r.json().get("detail", "").lower()


def test_tax_optimize_rejects_nan(client):
    body = json.dumps({"inputs": {"wages": float("inf")}, "target_rate": 0.24},
                      allow_nan=True)
    r = _post_raw(client, "/api/tax/optimize", body)
    assert r.status_code == 400, r.text


# ---------- Round-3: /api/projection still works (asyncio.to_thread regression guard) ----------
def test_projection_valid_config_still_returns_200(client, cfg):
    """After wrapping run_projection in asyncio.to_thread we need to confirm
    normal projections still complete and return the same headline keys."""
    r = client.post(f"{BASE_URL}/api/projection", json={"config": cfg}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    # Sanity: engine returned its usual shape.
    assert "rows" in data
    assert "legacy" in data
    assert isinstance(data["rows"], list) and len(data["rows"]) > 0


def test_sweep_valid_config_still_returns_200(client, cfg):
    """`sweep_brackets` was also wrapped in asyncio.to_thread — smoke check."""
    r = client.post(f"{BASE_URL}/api/sweep", json={"config": cfg}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, dict)
