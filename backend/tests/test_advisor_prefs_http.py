"""Per-advisor UI preferences (Two-Way nominal-vs-today framing default) over HTTP.

GET /api/prefs/mine and PUT /api/prefs/mine — round-trip + merge semantics, so a
license's saved framing opens the surface in their preferred view.
"""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

_fe = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")

MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": MASTER_PIN},
                      headers={"X-Test-No-Auth": "1"}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"master pin verify failed {r.status_code}: {r.text[:300]}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}",
                      "X-Session-Token": str(uuid.uuid4())})
    return s


def test_prefs_roundtrip_and_merge(client):
    # Save the two-way framing default = today's dollars.
    r = client.put(f"{BASE_URL}/api/prefs/mine", json={"prefs": {"two_way_today": True}}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["prefs"]["two_way_today"] is True

    # GET returns it.
    g = client.get(f"{BASE_URL}/api/prefs/mine", timeout=30)
    assert g.status_code == 200, g.text
    assert g.json()["prefs"]["two_way_today"] is True

    # A partial update to another key must not wipe two_way_today (merge).
    r2 = client.put(f"{BASE_URL}/api/prefs/mine", json={"prefs": {"some_other": 1}}, timeout=30)
    assert r2.status_code == 200
    merged = r2.json()["prefs"]
    assert merged["two_way_today"] is True and merged["some_other"] == 1

    # Flip it back to nominal and confirm.
    r3 = client.put(f"{BASE_URL}/api/prefs/mine", json={"prefs": {"two_way_today": False}}, timeout=30)
    assert r3.json()["prefs"]["two_way_today"] is False


def test_prefs_requires_auth():
    r = requests.get(f"{BASE_URL}/api/prefs/mine", timeout=30)
    assert r.status_code in (401, 403)
