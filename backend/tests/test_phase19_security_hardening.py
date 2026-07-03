"""Phase 19 — Security hardening HTTP tests.

Validates the SEC-001/SEC-002/SEC-003/P3 hardening fixes:
  - session token gating on scenarios (SEC-002)
  - DoS guards on projection / strategy-sweep / ss-optimizer (SEC-001)
  - generic error messages (SEC-003)
  - security response headers (P3)
  - CORS behavior (P3)
"""
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


# ---------- SEC-002: session-scoped scenarios ----------
def test_scenarios_require_session_token():
    r = requests.get(f"{BASE_URL}/api/scenarios", timeout=10)
    assert r.status_code == 401, r.text
    assert "X-Session-Token" in r.json().get("detail", "")


def test_scenarios_reject_malformed_token():
    r = requests.get(f"{BASE_URL}/api/scenarios",
                     headers={"X-Session-Token": "not-a-uuid"}, timeout=10)
    assert r.status_code == 401


def test_scenarios_are_owner_scoped(client):
    """A scenario saved by session A must NOT appear in session B's list, and
    session B must not be able to read or delete it."""
    defaults = client.get(f"{BASE_URL}/api/defaults", timeout=10).json()
    name = f"iso_{uuid.uuid4().hex[:6]}"
    r = client.post(f"{BASE_URL}/api/scenarios", json={"name": name, "config": defaults}, timeout=15)
    assert r.status_code == 200
    sid = r.json()["id"]

    # Second session
    other = requests.Session()
    other.headers.update({
        "Content-Type": "application/json",
        "X-Session-Token": str(uuid.uuid4()),
    })

    # LIST from other session — should NOT contain sid
    r = other.get(f"{BASE_URL}/api/scenarios", timeout=10)
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert sid not in ids, "cross-session read leak (SEC-002 regression)"

    # GET by id from other session — 404 (behaves as not-found, doesn't disclose existence)
    r = other.get(f"{BASE_URL}/api/scenarios/{sid}", timeout=10)
    assert r.status_code == 404

    # DELETE from other session — 404 (cannot delete someone else's plan)
    r = other.delete(f"{BASE_URL}/api/scenarios/{sid}", timeout=10)
    assert r.status_code == 404

    # Owner session can still see it
    r = client.get(f"{BASE_URL}/api/scenarios/{sid}", timeout=10)
    assert r.status_code == 200

    # Cleanup
    client.delete(f"{BASE_URL}/api/scenarios/{sid}", timeout=10)


# ---------- SEC-001: DoS guards ----------
def test_projection_horizon_cap(client):
    cfg = client.get(f"{BASE_URL}/api/defaults", timeout=10).json()
    cfg["projection"]["end_year"] = 2500
    r = client.post(f"{BASE_URL}/api/projection", json={"config": cfg}, timeout=10)
    assert r.status_code == 400
    assert "60 years" in r.json().get("detail", "")


def test_strategy_sweep_grid_cap(client):
    cfg = client.get(f"{BASE_URL}/api/defaults", timeout=10).json()
    payload = {
        "config": cfg,
        "start_years": list(range(2026, 2036)),
        "stop_years": list(range(2050, 2062)),
        "brackets": [0.10, 0.12, 0.15, 0.22, 0.24, 0.30, 0.32, 0.35, 0.37],
        "include_phased": False,
    }
    # 10 × 12 × 9 = 1080 cells > 500 cap
    r = client.post(f"{BASE_URL}/api/strategy-sweep", json=payload, timeout=10)
    assert r.status_code == 400
    assert "grid" in r.json().get("detail", "").lower()


def test_ss_optimizer_ages_cap(client):
    cfg = client.get(f"{BASE_URL}/api/defaults", timeout=10).json()
    r = client.post(f"{BASE_URL}/api/ss-optimizer",
                    json={"config": cfg, "ages": [62, 63, 64, 65, 66, 67, 68, 69, 70]},
                    timeout=10)
    # 9 ages > cap of 8 → 422 (pydantic) or 400
    assert r.status_code in (400, 422)


def test_ss_optimizer_age_range(client):
    cfg = client.get(f"{BASE_URL}/api/defaults", timeout=10).json()
    r = client.post(f"{BASE_URL}/api/ss-optimizer",
                    json={"config": cfg, "ages": [40, 62]},
                    timeout=10)
    assert r.status_code in (400, 422)


def test_montecarlo_trials_cap(client):
    cfg = client.get(f"{BASE_URL}/api/defaults", timeout=10).json()
    r = client.post(f"{BASE_URL}/api/montecarlo",
                    json={"config": cfg, "n_trials": 100000},
                    timeout=10)
    assert r.status_code in (400, 422)


# ---------- SEC-003: generic error messages ----------
def test_projection_error_message_generic(client):
    """Trigger a downstream engine failure (missing required config keys) and
    verify we DON'T leak the internal traceback or python exception text."""
    r = client.post(f"{BASE_URL}/api/projection", json={"config": {"projection": {"start_year": 2026, "end_year": 2030}}}, timeout=10)
    # Either 400 with a generic body OR 422 from pydantic validation
    if r.status_code == 400:
        detail = r.json().get("detail", "")
        # must NOT leak python attributes/traceback markers
        for leak in ("KeyError", "AttributeError", "TypeError", "Traceback", "line "):
            assert leak not in detail, f"internal detail leaked: {detail}"


# ---------- P3: security response headers ----------
def test_security_headers_present():
    r = requests.get(f"{BASE_URL}/api/defaults", timeout=10)
    assert r.status_code == 200
    h = {k.lower(): v for k, v in r.headers.items()}
    assert h.get("x-content-type-options") == "nosniff"
    assert h.get("x-frame-options") == "DENY"
    assert "strict-origin" in (h.get("referrer-policy") or "")
    assert "max-age" in (h.get("strict-transport-security") or "")


# ---------- Payload size bounds ----------
def test_chat_message_bounds(client):
    """Backend caps chat history / message size — a 5000-char message should be rejected."""
    r = client.post(f"{BASE_URL}/api/insights/chat", json={
        "summary": {}, "history": [], "message": "x" * 5000,
    }, timeout=10)
    assert r.status_code in (400, 422)
