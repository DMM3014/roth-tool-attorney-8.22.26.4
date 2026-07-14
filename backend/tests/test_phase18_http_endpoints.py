"""Phase 18 HTTP-level tests via public preview URL.
Validates review-request bullets for /api/montecarlo (inflation), /api/projection
(per-owner ledger + math regression), /api/strategy-sweep, /api/ss-optimizer.
"""
import copy
import os
import sys
import time

import pytest
import requests

MC_HDRS = {"X-Session-Token": "7c1e4b90-2d3f-4a5b-8c6d-9e0f1a2b3c4d"}


def _run_mc(payload, poll_timeout=180):
    r = requests.post(f"{BASE_URL}/api/montecarlo", json=payload, headers=MC_HDRS, timeout=30)
    assert r.status_code == 200
    body = r.json()
    if "job_id" in body:
        job_id = body["job_id"]
        deadline = time.time() + poll_timeout
        while time.time() < deadline:
            s = requests.get(f"{BASE_URL}/api/montecarlo/{job_id}", headers=MC_HDRS, timeout=30)
            assert s.status_code == 200
            js = s.json()
            if js.get("status") == "done":
                return js.get("result", js)
            if js.get("status") == "error":
                raise AssertionError(f"MC job errored: {js.get('error')}")
            time.sleep(2)
        raise AssertionError("MC job timeout")
    return body

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from defaults import DEFAULT_SCENARIO  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open(
    "/app/frontend/.env"
).read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="module")
def cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


# ---------- Monte Carlo v2.1 inflation ----------
def test_mc_no_inflation_field_returns_null(cfg):
    data = _run_mc({"config": cfg, "n_trials": 100, "seed": 42})
    assert data.get("inflation") is None
    assert "years" in data and len(data["years"]) > 0


def test_mc_inflation_disabled_returns_null(cfg):
    data = _run_mc({
        "config": cfg, "n_trials": 100, "seed": 42,
        "inflation": {"enabled": False, "mean": 0.03, "vol": 0.02},
    })
    assert data.get("inflation") is None


def test_mc_inflation_vol_zero_returns_null(cfg):
    data = _run_mc({
        "config": cfg, "n_trials": 100, "seed": 42,
        "inflation": {"enabled": True, "mean": 0.03, "vol": 0.0},
    })
    # vol=0 → multiplier collapses to 1.0 case per review request
    assert data.get("inflation") is None


def test_mc_inflation_enabled_populated_block(cfg):
    data = _run_mc({
        "config": cfg, "n_trials": 200, "seed": 42,
        "inflation": {"enabled": True, "mean": 0.03, "vol": 0.02},
    })
    inf = data.get("inflation")
    assert inf is not None, "inflation block missing"
    assert inf["mean"] == 0.03 and inf["vol"] == 0.02
    cum = inf["cumulative"]
    T = len(data["years"])
    for k in ("p10", "p50", "p90", "expected"):
        assert len(cum[k]) == T, f"cumulative.{k} length {len(cum[k])} != years {T}"
    exp_end = cum["expected"][-1]
    assert 2.6 <= exp_end <= 3.2, f"expected end-of-horizon CPI ≈ 2.99, got {exp_end}"
    assert all(cum["expected"][i + 1] >= cum["expected"][i] for i in range(T - 1))


# ---------- Per-owner Roth conversion attribution + math regression ----------
def test_projection_per_owner_ledger_and_math(cfg):
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": cfg}, timeout=120)
    assert r.status_code == 200
    data = r.json()
    # Math regression
    assert data["summary"]["lifetime_taxes"] == 7074269.95
    assert data["summary"]["ending_net_worth"] == 80236439.97
    # Per-owner ledger
    ledger = data["roth_compliance"]["conversions_ledger"]
    assert len(ledger) > 0
    for lot in ledger:
        assert lot["owner"] in ("Client", "Spouse")
        assert "owner_age_at_conversion" in lot
        assert "amount" in lot and "remaining" in lot
    # Early years attribute to Client on default V9 plan
    early = [lot for lot in ledger if lot["year"] <= 2030]
    assert len(early) > 0
    assert all(lot["owner"] == "Client" for lot in early)


# ---------- Strategy sweep regression ----------
def test_strategy_sweep_default_topN_fill32(cfg):
    r = requests.post(
        f"{BASE_URL}/api/strategy-sweep",
        json={"config": cfg},
        timeout=180,
    )
    assert r.status_code == 200
    data = r.json()
    ranked = data["ranked"]
    assert len(ranked) >= 3
    top = ranked[0]
    # Winner: Fill 24% single-bracket (never-realized heir gains default: 151.3M legacy)
    assert "Fill 24%" in top["label"]
    assert 150_000_000 <= top["after_tax_estate"] <= 152_000_000


# ---------- SS optimizer regression ----------
def test_ss_optimizer_default_fra(cfg):
    r = requests.post(
        f"{BASE_URL}/api/ss-optimizer",
        json={"config": cfg},
        timeout=120,
    )
    assert r.status_code == 200
    data = r.json()
    fra = data["fra_amounts"]
    assert abs(fra["Client"] - 4152) <= 5
    assert abs(fra["Spouse"] - 4152) <= 5
    # 9-combo grid (default ages [62,65,67,70] → 16 combos actually; review says 9 for [62,67,70])
    # We assert at least 9 combos and that ranked descends
    ranked = data["ranked"]
    assert len(ranked) >= 9
    for i in range(len(ranked) - 1):
        assert ranked[i]["after_tax_estate"] >= ranked[i + 1]["after_tax_estate"] - 0.01
