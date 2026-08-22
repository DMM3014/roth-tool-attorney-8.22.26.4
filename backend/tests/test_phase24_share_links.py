"""Phase 24 — Read-only shareable scenario links.

Verifies the /api/scenarios/{sid}/share + /api/scenarios/share/{token} endpoints:
  - Only the owner can mint / revoke a share token
  - Enabling twice returns the same token (idempotent)
  - The public GET works without a session token
  - The public response NEVER leaks owner_token or the internal id
  - Revoked tokens 404 immediately
  - Malformed share tokens are rejected
  - Malformed scenario IDs are rejected
"""
import copy
import os
import uuid

import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')


@pytest.fixture(scope="module")
def owner():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "X-Session-Token": str(uuid.uuid4()),
    })
    return s


@pytest.fixture(scope="module")
def defaults(owner):
    return owner.get(f"{BASE_URL}/api/defaults", timeout=10).json()


@pytest.fixture
def scenario(owner, defaults):
    """A fresh saved scenario per-test, cleaned up on teardown."""
    name = f"share-{uuid.uuid4().hex[:6]}"
    r = owner.post(f"{BASE_URL}/api/scenarios",
                   json={"name": name, "config": copy.deepcopy(defaults)}, timeout=10)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    yield sid, r.json()["name"]
    owner.delete(f"{BASE_URL}/api/scenarios/{sid}", timeout=10)


# ---------- Owner-only share minting ----------
def test_enable_share_requires_session(scenario):
    sid, _ = scenario
    r = requests.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    assert r.status_code == 401, r.text


def test_enable_share_by_other_session_404(scenario, defaults):
    sid, _ = scenario
    other = requests.Session()
    other.headers.update({"X-Session-Token": str(uuid.uuid4())})
    r = other.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    assert r.status_code == 404, r.text


def test_enable_share_idempotent(owner, scenario):
    sid, _ = scenario
    a = owner.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    assert a.status_code == 200, a.text
    ta = a.json()["share_token"]
    assert ta and len(ta) >= 22
    b = owner.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    assert b.status_code == 200, b.text
    assert b.json()["share_token"] == ta, "re-enabling should reuse the same token"


def test_enable_share_bad_sid(owner):
    r = owner.post(f"{BASE_URL}/api/scenarios/not-a-uuid/share", timeout=10)
    assert r.status_code == 400


# ---------- Public read-only view ----------
def test_public_get_by_share_token(owner, scenario):
    sid, name = scenario
    tok = owner.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10).json()["share_token"]

    # No session header on the public request.
    r = requests.get(f"{BASE_URL}/api/scenarios/share/{tok}", timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    # Public payload is the minimum: name + config + created_at.
    assert body["name"] == name
    assert "config" in body and isinstance(body["config"], dict)
    # Sensitive fields must NEVER be exposed on the public endpoint.
    assert "owner_token" not in body, "public share must not leak owner session token"
    assert "id" not in body, "public share must not leak internal scenario id"
    assert "share_token" not in body, "public share must not echo the share token"


def test_public_get_malformed_token_400():
    r = requests.get(f"{BASE_URL}/api/scenarios/share/x", timeout=10)
    assert r.status_code == 400


def test_public_get_unknown_token_404():
    # 32 chars, correct alphabet, just not in the DB.
    tok = "a" * 32
    r = requests.get(f"{BASE_URL}/api/scenarios/share/{tok}", timeout=10)
    assert r.status_code == 404


# ---------- Revocation ----------
def test_revoke_makes_token_dead(owner, scenario):
    sid, _ = scenario
    tok = owner.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10).json()["share_token"]
    # sanity — works before revoke
    assert requests.get(f"{BASE_URL}/api/scenarios/share/{tok}", timeout=10).status_code == 200

    rd = owner.delete(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    assert rd.status_code == 200, rd.text

    # public GET must 404 immediately after revocation
    r = requests.get(f"{BASE_URL}/api/scenarios/share/{tok}", timeout=10)
    assert r.status_code == 404, r.text


def test_revoke_by_other_session_404(owner, scenario):
    sid, _ = scenario
    owner.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    other = requests.Session()
    other.headers.update({"X-Session-Token": str(uuid.uuid4())})
    r = other.delete(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    assert r.status_code == 404


def test_revoke_is_idempotent(owner, scenario):
    """Revoking twice should still 200 — the scenario exists, share is just null."""
    sid, _ = scenario
    owner.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    r1 = owner.delete(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    r2 = owner.delete(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10)
    assert r1.status_code == 200
    assert r2.status_code == 200


# ---------- LIST shows share_token so the UI can render a badge/URL ----------
def test_list_scenarios_exposes_share_token(owner, scenario):
    sid, _ = scenario
    tok = owner.post(f"{BASE_URL}/api/scenarios/{sid}/share", timeout=10).json()["share_token"]
    r = owner.get(f"{BASE_URL}/api/scenarios", timeout=10)
    assert r.status_code == 200
    match = [s for s in r.json() if s["id"] == sid]
    assert match, "saved scenario missing from list"
    assert match[0].get("share_token") == tok, "list should surface current share token for the owner"


def test_multiple_unshared_and_revoked_scenarios_coexist(owner, defaults):
    """Regression: the share_token unique index must be PARTIAL — sparse indexes still
    index explicit nulls, so two unshared plans (or two revoked ones, which $set null)
    collided with E11000 / HTTP 500."""
    ids = []
    try:
        for _ in range(2):
            r = owner.post(f"{BASE_URL}/api/scenarios",
                           json={"name": f"nulltok-{uuid.uuid4().hex[:6]}",
                                 "config": copy.deepcopy(defaults)}, timeout=10)
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        # share then revoke both — two explicit-null share_tokens must coexist
        for sid2 in ids:
            assert owner.post(f"{BASE_URL}/api/scenarios/{sid2}/share", timeout=10).status_code == 200
        for sid2 in ids:
            assert owner.delete(f"{BASE_URL}/api/scenarios/{sid2}/share", timeout=10).status_code == 200
    finally:
        for sid2 in ids:
            owner.delete(f"{BASE_URL}/api/scenarios/{sid2}", timeout=10)
