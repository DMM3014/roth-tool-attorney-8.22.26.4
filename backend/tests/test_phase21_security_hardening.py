"""Phase 21 — Security hardening round 2 (post-Phase-20 audit).

Covers the SEC-001 rate-limit-key fix + four hardening items:
  - SEC-001: rate-limit key derived from the trusted proxy hop, NOT client-spoofable XFF.
  - H1: Monte Carlo jobs are session-scoped (auth required + BOLA guard + no owner_token leak).
  - H2: non-finite (NaN/Inf) and out-of-range floats rejected at the API boundary (clean 422).
  - H3: (frontend, tested by the frontend suite) crypto-strong session token.
  - H4: Content-Security-Policy header present.

HTTP tests against the deployed preview URL. Paced to respect slowapi limits.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Session-Token": str(uuid.uuid4())})
    return s


@pytest.fixture(scope="module")
def cfg(client):
    return client.get(f"{BASE_URL}/api/defaults", timeout=10).json()


# ---------- H1: Monte Carlo jobs are session-scoped ----------
def test_montecarlo_requires_session(cfg):
    r = requests.post(f"{BASE_URL}/api/montecarlo", json={"config": cfg, "n_trials": 100},
                      headers={"Content-Type": "application/json"}, timeout=10)
    assert r.status_code == 401, r.text


def test_montecarlo_job_is_owner_scoped(client, cfg):
    r = client.post(f"{BASE_URL}/api/montecarlo",
                    json={"config": cfg, "n_trials": 100, "seed": 5}, timeout=15)
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    # owner can read; result must NOT leak the owner_token field
    owner_view = None
    for _ in range(20):
        owner_view = client.get(f"{BASE_URL}/api/montecarlo/{job_id}", timeout=10).json()
        if owner_view["status"] in ("done", "error"):
            break
        time.sleep(0.7)
    assert "owner_token" not in owner_view

    # a different session gets 404 (BOLA guard), even though the job exists
    other = requests.get(f"{BASE_URL}/api/montecarlo/{job_id}",
                         headers={"X-Session-Token": str(uuid.uuid4())}, timeout=10)
    assert other.status_code == 404, other.text

    # no token at all -> 401
    anon = requests.get(f"{BASE_URL}/api/montecarlo/{job_id}", timeout=10)
    assert anon.status_code == 401


def test_montecarlo_malformed_job_id(client):
    r = client.get(f"{BASE_URL}/api/montecarlo/not-a-uuid", timeout=10)
    assert r.status_code == 400


# ---------- H2: non-finite / out-of-range floats rejected cleanly ----------
def _post_raw(client, body: str):
    """POST a raw (possibly non-JSON-compliant) body string."""
    return client.post(f"{BASE_URL}/api/montecarlo", data=body, timeout=10)


def test_correlation_nan_rejected(client, cfg):
    import json
    body = json.dumps({"config": cfg, "correlation": {"enabled": True, "stocks_bonds": float("nan")}},
                      allow_nan=True)
    r = _post_raw(client, body)
    assert r.status_code == 422, r.text
    # response itself must be valid JSON (no serializer 500) and must NOT echo raw input
    payload = r.json()
    assert "finite" in str(payload).lower()
    assert "input" not in str(payload["detail"][0])


def test_asset_inf_rejected(client, cfg):
    import json
    body = json.dumps({"config": cfg, "assets": {
        "stocks": {"mean": float("inf"), "vol": 0.18, "weight": 0.6},
        "bonds": {"mean": 0.04, "vol": 0.06, "weight": 0.3},
        "cash": {"mean": 0.03, "vol": 0.01, "weight": 0.1},
    }}, allow_nan=True)
    r = _post_raw(client, body)
    assert r.status_code == 422, r.text


def test_correlation_out_of_range_rejected(client, cfg):
    r = client.post(f"{BASE_URL}/api/montecarlo",
                    json={"config": cfg, "correlation": {"enabled": True, "stocks_bonds": 1.5}},
                    timeout=10)
    assert r.status_code == 422, r.text


# ---------- H4: Content-Security-Policy header ----------
def test_csp_header_present():
    r = requests.get(f"{BASE_URL}/api/defaults", timeout=10)
    h = {k.lower(): v for k, v in r.headers.items()}
    csp = h.get("content-security-policy", "")
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp


# ---------- SEC-001: rate-limit key not spoofable via X-Forwarded-For ----------
def test_rate_limit_survives_xff_spoofing(client, cfg):
    """Vary X-Forwarded-For on every request. Because the trusted ingress hop is used
    as the limiter key (not the client-prepended leftmost XFF), a per-client cap must
    still trip. We assert at least one 429 within the burst."""
    body = {"config": cfg}
    codes = []
    for i in range(45):
        r = client.post(f"{BASE_URL}/api/projection", json=body,
                        headers={"X-Forwarded-For": f"203.0.113.{i}"}, timeout=10)
        codes.append(r.status_code)
        if r.status_code == 429:
            break
    assert 429 in codes, f"XFF spoofing bypassed the rate limit (SEC-001 regression): {codes}"
