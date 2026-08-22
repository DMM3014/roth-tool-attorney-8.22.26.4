"""Phase 19 regression + rate limit HTTP tests."""
import os
import sys
import time
import uuid
import copy
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from defaults import DEFAULT_SCENARIO  # noqa: E402


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "X-Session-Token": str(uuid.uuid4()),
    })
    return s


@pytest.fixture
def base_cfg():
    """Baseline config = built-in DEFAULT_SCENARIO. Immune to whatever the caller
    has saved via /api/defaults/save (user_defaults.json override)."""
    return copy.deepcopy(DEFAULT_SCENARIO)


# ---------- REGRESSION: default projection math ----------
def test_default_projection_math(client, base_cfg):
    r = client.post(f"{BASE_URL}/api/projection", json={"config": base_cfg}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    summary = data["summary"]
    assert summary["lifetime_taxes"] == pytest.approx(6351096.5, rel=1e-4)
    assert summary["ending_net_worth"] == pytest.approx(84563211.53, rel=1e-4)
    assert data["legacy"]["after_tax_estate_to_heirs"] == pytest.approx(162500588.9, rel=1e-4)


def test_default_strategy_sweep(client, base_cfg):
    r = client.post(f"{BASE_URL}/api/strategy-sweep", json={"config": base_cfg}, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    best = data.get("best") or data.get("best_row") or {}
    # try common shapes
    if not best and "rows" in data:
        # find max after_tax_estate row
        rows = data["rows"]
        best = max(rows, key=lambda x: x.get("after_tax_estate", 0))
    # After V17-alignment engine fix, an aggressive phased strategy wins on defaults.
    assert best.get("kind") in {"single", "phased"}, f"best={best}"
    ate = best.get("after_tax_estate")
    assert 150_000_000 <= ate <= 165_000_000, f"after_tax_estate out of band: {ate}"


def test_default_ss_optimizer(client, base_cfg):
    r = client.post(f"{BASE_URL}/api/ss-optimizer", json={"config": base_cfg}, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    fra = data.get("fra_amounts") or {}
    assert abs(fra.get("Client", 0) - 4152) < 5, f"Client FRA: {fra}"
    assert abs(fra.get("Spouse", 0) - 4152) < 5, f"Spouse FRA: {fra}"


def test_montecarlo_with_inflation(client, base_cfg):
    payload = {
        "config": base_cfg,
        "n_trials": 50,
        "inflation": {"enabled": True, "mean": 0.03, "vol": 0.02},
    }
    r = client.post(f"{BASE_URL}/api/montecarlo", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    # Poll
    result = None
    for _ in range(90):
        jr = client.get(f"{BASE_URL}/api/montecarlo/{job_id}", timeout=10).json()
        if jr.get("status") == "done":
            result = jr["result"]
            break
        if jr.get("status") == "error":
            pytest.fail(f"MC job errored: {jr}")
        time.sleep(0.7)
    assert result is not None, "MC job timed out"
    infl = result.get("inflation")
    assert infl, "inflation block missing"
    assert "mean" in infl and "vol" in infl
    cum = infl.get("cumulative", {})
    for k in ("p10", "p50", "p90", "expected"):
        assert k in cum, f"missing {k} in inflation.cumulative"


# ---------- Rate limiting ----------
def test_strategy_sweep_rate_limit(client):
    """Fire >10 requests/minute at /api/strategy-sweep; expect eventual 429."""
    cfg = client.get(f"{BASE_URL}/api/defaults", timeout=10).json()
    saw_429 = False
    codes = []
    # Use a tiny/quick payload that hits validation early to avoid slow runs
    payload = {"config": cfg, "start_years": [2026], "stop_years": [2050], "brackets": [0.24], "include_phased": False}
    for i in range(20):
        # X-Test-Expect-429 tells conftest NOT to auto-retry — this test must SEE the 429.
        r = client.post(f"{BASE_URL}/api/strategy-sweep", json=payload,
                        headers={"X-Test-Expect-429": "1"}, timeout=60)
        codes.append(r.status_code)
        if r.status_code == 429:
            saw_429 = True
            break
    assert saw_429, f"Never saw 429 after 20 requests; codes={codes}"
