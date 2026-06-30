"""Backend tests for Monte Carlo v1 (POST /api/montecarlo + GET poll)."""

import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback only to read frontend/.env when env var not set in pytest env
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass


@pytest.fixture(scope="session")
def defaults():
    r = requests.get(f"{BASE_URL}/api/defaults", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _poll(job_id, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/montecarlo/{job_id}", timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        if body["status"] in ("done", "error"):
            return body
        time.sleep(0.5)
    pytest.fail("Monte Carlo timed out")


def _start(config, **kwargs):
    payload = {"config": config, "n_trials": 250, "volatility": 0.12}
    payload.update(kwargs)
    r = requests.post(f"{BASE_URL}/api/montecarlo", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    js = r.json()
    assert "job_id" in js and js["status"] == "running"
    return js["job_id"]


# ------------ shape / success path ------------

def test_montecarlo_shape_and_success(defaults):
    job_id = _start(defaults, n_trials=300, volatility=0.12, seed=7)
    body = _poll(job_id)
    assert body["status"] == "done", body
    res = body["result"]
    # top level
    for k in ("years", "n_trials", "volatility", "mean_return", "liquid_start",
             "with_conversions", "without_conversions"):
        assert k in res, f"missing top-level key {k}"
    assert isinstance(res["years"], list) and len(res["years"]) > 5
    assert res["n_trials"] == 300

    wc = res["with_conversions"]
    nc = res["without_conversions"]
    for branch in (wc, nc):
        assert 0.0 <= branch["success"] <= 1.0
        # percentiles p10..p90 lists same length as years
        for p in ("p10", "p25", "p50", "p75", "p90"):
            assert p in branch["percentiles"], f"missing percentile {p}"
            assert len(branch["percentiles"][p]) == len(res["years"])
        end = branch["ending"]
        for k in ("p10", "p50", "p90", "depleted", "depleted_pct", "pct_positive"):
            assert k in end
        hist = branch["histogram"]
        assert "counts" in hist and "edges" in hist
        assert len(hist["counts"]) == len(hist["edges"]) - 1


# ------------ success == 1 - depleted_pct (depleted trials lock at 0) ------------

def test_success_equals_one_minus_depleted(defaults):
    job_id = _start(defaults, n_trials=400, volatility=0.15, seed=11)
    res = _poll(job_id)["result"]
    for branch_name in ("with_conversions", "without_conversions"):
        b = res[branch_name]
        # rounded to 4 decimals on backend; allow small tolerance
        assert abs(b["success"] - (1.0 - b["ending"]["depleted_pct"])) <= 0.001, (
            f"{branch_name}: success={b['success']} vs 1-dep_pct={1 - b['ending']['depleted_pct']}"
        )


# ------------ higher volatility -> lower success ------------

def test_higher_volatility_lowers_success(defaults):
    low_job = _start(defaults, n_trials=400, volatility=0.12, seed=42)
    hi_job = _start(defaults, n_trials=400, volatility=0.22, seed=42)
    low = _poll(low_job)["result"]
    hi = _poll(hi_job)["result"]
    s_lo = low["with_conversions"]["success"]
    s_hi = hi["with_conversions"]["success"]
    assert s_hi < s_lo, f"expected higher vol to lower success: low(0.12)={s_lo} hi(0.22)={s_hi}"


# ------------ reproducibility with fixed seed ------------

def test_seed_reproducibility(defaults):
    j1 = _start(defaults, n_trials=300, volatility=0.18, seed=2026)
    r1 = _poll(j1)["result"]
    j2 = _start(defaults, n_trials=300, volatility=0.18, seed=2026)
    r2 = _poll(j2)["result"]
    assert r1["with_conversions"]["success"] == r2["with_conversions"]["success"]
    assert r1["with_conversions"]["ending"]["p50"] == r2["with_conversions"]["ending"]["p50"]
    assert r1["with_conversions"]["percentiles"]["p50"] == r2["with_conversions"]["percentiles"]["p50"]


# ------------ unknown job_id -> 404 ------------

def test_unknown_job_returns_404():
    r = requests.get(f"{BASE_URL}/api/montecarlo/does-not-exist-xyz", timeout=30)
    assert r.status_code == 404


# ------------ no raw N trials leaked (paths array would be N x T) ------------

def test_no_raw_trial_array(defaults):
    job_id = _start(defaults, n_trials=250, volatility=0.12, seed=1)
    res = _poll(job_id)["result"]
    for key in ("trials", "paths", "all_paths", "raw"):
        assert key not in res["with_conversions"], f"raw trial data leaked under {key}"
        assert key not in res["without_conversions"], f"raw trial data leaked under {key}"
