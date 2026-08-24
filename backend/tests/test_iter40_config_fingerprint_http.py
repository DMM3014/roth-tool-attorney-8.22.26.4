"""Iteration 40 — HTTP coverage for the config-fingerprint consistency guards.

Covers:
  * POST /api/config-fingerprint  (new endpoint, planning router prefix = /api)
  * POST /api/projection          -> response carries config_fingerprint
  * POST /api/strategy-sweep      -> response carries config_fingerprint
  * hash vs structural_hash semantics (roth/withdrawal excluded from structural)
  * Analyzer/report fingerprint parity for the same unchanged plan
"""
import copy
import os

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL")).rstrip("/")

import sys
sys.path.insert(0, "/app/backend")
from defaults import DEFAULT_SCENARIO  # noqa: E402


@pytest.fixture(scope="module")
def cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def _fp(config):
    r = requests.post(f"{BASE}/api/config-fingerprint", json={"config": config}, timeout=60)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    return r.json()


def test_fingerprint_endpoint_shape(cfg):
    fp = _fp(cfg)
    for k in ("hash", "structural_hash", "summary", "computed_at"):
        assert k in fp, f"missing {k}"
    assert isinstance(fp["hash"], str) and len(fp["hash"]) == 16
    s = fp["summary"]
    for k in ("total_starting_investable", "taxable_balance", "ira_balance",
              "funding_order", "conversion_window", "projection_years"):
        assert k in s, f"summary missing {k}"
    assert s["total_starting_investable"] > 0
    assert isinstance(s["taxable_balance"], (int, float))


def test_fingerprint_deterministic(cfg):
    a, b = _fp(cfg), _fp(cfg)
    assert a["hash"] == b["hash"]
    assert a["structural_hash"] == b["structural_hash"]


def test_structural_hash_ignores_roth_and_withdrawal(cfg):
    base = _fp(cfg)
    c = copy.deepcopy(cfg)
    c["roth"] = {**(c.get("roth") or {}), "enabled": True, "start_year": 2027, "end_year": 2031}
    c["withdrawal"] = {**(c.get("withdrawal") or {}), "funding_order": "IRA-first"}
    applied = _fp(c)
    assert applied["structural_hash"] == base["structural_hash"], "applying a strategy must NOT change structural hash"
    assert applied["hash"] != base["hash"], "full hash must change when roth/funding change"


def test_structural_hash_changes_on_account_edit(cfg):
    base = _fp(cfg)
    c = copy.deepcopy(cfg)
    c["accounts"][0]["beginning_balance"] = (c["accounts"][0].get("beginning_balance") or 0) + 12345
    drift = _fp(c)
    assert drift["structural_hash"] != base["structural_hash"]
    assert drift["summary"]["total_starting_investable"] != base["summary"]["total_starting_investable"]


def test_projection_response_includes_fingerprint(cfg):
    r = requests.post(f"{BASE}/api/projection", json={"config": cfg}, timeout=180)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    fp = r.json().get("config_fingerprint")
    assert fp, "projection response missing config_fingerprint"
    assert fp["structural_hash"] == _fp(cfg)["structural_hash"], "report fingerprint must match shared helper"


def test_strategy_sweep_response_includes_matching_fingerprint(cfg):
    payload = {"config": cfg, "start_years": [2026], "stop_years": [2030],
               "brackets": [0.24], "include_phased": False}
    r = requests.post(f"{BASE}/api/strategy-sweep", json=payload, timeout=300)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    data = r.json()
    fp = data.get("config_fingerprint")
    assert fp, "strategy_sweep response missing config_fingerprint"
    live = _fp(cfg)
    assert fp["structural_hash"] == live["structural_hash"], \
        "analyzer sweep fingerprint must equal current-plan fingerprint for unchanged plan"
    assert fp["summary"]["ira_balance"] == live["summary"]["ira_balance"]
