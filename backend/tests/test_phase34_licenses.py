"""License-tier auth tests (master + licensee).

Verifies:
- Master token issued via POST /api/auth/pin/verify unlocks admin endpoints.
- Licensee token issued via POST /api/auth/license/verify unlocks compute but NOT admin.
- Full admin CRUD lifecycle: create → login → rotate PIN → renew → revoke → login fails.
- Revoking a licensee immediately invalidates their active JWT (epoch bump).
- Legacy PIN change endpoint returns HTTP 410.
- Session status reports the correct role + email.

Runs over HTTP against the live backend. Mongo is prodded directly to swap in a known
test master PIN hash for the module and to clean up test licensees afterward.
"""
import os
import sys
import uuid
import time

import pytest
import requests

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND, ".env"))

from pymongo import MongoClient
from auth_pin import hash_pin
from auth_licenses import MASTER_DOC_ID, LICENSES_COLLECTION

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

TEST_MASTER_PIN = "999999"
NOAUTH = {"X-Test-No-Auth": "1"}
mdb = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
TEST_EMAIL = f"pytest-{uuid.uuid4().hex[:8]}@test.local"


@pytest.fixture(scope="module", autouse=True)
def _swap_master_pin():
    """Swap in the test master PIN hash for the module, keep the epoch, restore
    the original doc + purge test licensees on teardown."""
    original = mdb.auth_config.find_one({"_id": MASTER_DOC_ID})
    assert original is not None, "master PIN doc missing — startup seeding failed"
    mdb.auth_config.update_one({"_id": MASTER_DOC_ID}, {"$set": {"pin_hash": hash_pin(TEST_MASTER_PIN)}})
    yield
    mdb.auth_config.replace_one({"_id": MASTER_DOC_ID}, original, upsert=True)
    mdb[LICENSES_COLLECTION].delete_many({"email": {"$regex": r"^pytest-.*@test\.local$"}})


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def _master_token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": TEST_MASTER_PIN},
                      headers=NOAUTH, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "master"
    return body["token"]


# ------------ Master ------------

def test_master_status_reports_master_role():
    tok = _master_token()
    r = requests.get(f"{BASE_URL}/api/auth/pin/status", headers=_hdr(tok), timeout=30)
    assert r.status_code == 200
    assert r.json()["role"] == "master"


def test_master_change_pin_returns_410_deprecated():
    tok = _master_token()
    r = requests.post(f"{BASE_URL}/api/auth/pin/change",
                      json={"current_pin": TEST_MASTER_PIN, "new_pin": "888888"},
                      headers=_hdr(tok), timeout=30)
    assert r.status_code == 410


def test_master_can_list_admin_endpoint():
    tok = _master_token()
    r = requests.get(f"{BASE_URL}/api/admin/licenses", headers=_hdr(tok), timeout=30)
    assert r.status_code == 200
    assert "licenses" in r.json()


# ------------ Licensee lifecycle ------------

def test_admin_licensee_full_lifecycle():
    master = _master_token()
    # Create
    r = requests.post(f"{BASE_URL}/api/admin/licenses",
                      json={"email": TEST_EMAIL, "expires_at": None},
                      headers=_hdr(master), timeout=30)
    assert r.status_code == 200, r.text
    created = r.json()
    lic_id = created["license_id"]
    pin = created["pin"]
    assert len(pin) == 6 and pin.isdigit()

    # Duplicate email → 409
    r = requests.post(f"{BASE_URL}/api/admin/licenses",
                      json={"email": TEST_EMAIL, "expires_at": None},
                      headers=_hdr(master), timeout=30)
    assert r.status_code == 409

    # Licensee logs in
    r = requests.post(f"{BASE_URL}/api/auth/license/verify",
                      json={"email": TEST_EMAIL, "pin": pin}, headers=NOAUTH, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "licensee"
    assert body["email"] == TEST_EMAIL
    lic_token = body["token"]

    # Licensee CAN call compute; CANNOT call admin
    assert requests.get(f"{BASE_URL}/api/market-scenarios",
                       headers=_hdr(lic_token), timeout=30).status_code == 200
    r = requests.get(f"{BASE_URL}/api/admin/licenses", headers=_hdr(lic_token), timeout=30)
    assert r.status_code == 401

    # Wrong PIN → 401
    r = requests.post(f"{BASE_URL}/api/auth/license/verify",
                      json={"email": TEST_EMAIL, "pin": "000000"}, headers=NOAUTH, timeout=30)
    assert r.status_code == 401

    # Rotate PIN — old PIN dies, new PIN works, old JWT is epoch-invalidated
    r = requests.post(f"{BASE_URL}/api/admin/licenses/{lic_id}/rotate-pin",
                     headers=_hdr(master), timeout=30)
    assert r.status_code == 200, r.text
    new_pin = r.json()["pin"]
    assert new_pin != pin

    assert requests.post(f"{BASE_URL}/api/auth/license/verify",
                        json={"email": TEST_EMAIL, "pin": pin},
                        headers=NOAUTH, timeout=30).status_code == 401
    r = requests.post(f"{BASE_URL}/api/auth/license/verify",
                     json={"email": TEST_EMAIL, "pin": new_pin}, headers=NOAUTH, timeout=30)
    assert r.status_code == 200
    new_lic_token = r.json()["token"]

    # Original JWT should now fail (epoch bumped by rotate-pin)
    assert requests.get(f"{BASE_URL}/api/market-scenarios",
                       headers=_hdr(lic_token), timeout=30).status_code == 401

    # Revoke → new token stops working immediately
    r = requests.post(f"{BASE_URL}/api/admin/licenses/{lic_id}/revoke",
                     headers=_hdr(master), timeout=30)
    assert r.status_code == 200
    assert requests.get(f"{BASE_URL}/api/market-scenarios",
                       headers=_hdr(new_lic_token), timeout=30).status_code == 401
    # Login with the current PIN also fails post-revoke
    assert requests.post(f"{BASE_URL}/api/auth/license/verify",
                        json={"email": TEST_EMAIL, "pin": new_pin},
                        headers=NOAUTH, timeout=30).status_code == 401

    # Renew reactivates it with a new expiration
    future = "2099-12-31T00:00:00Z"
    r = requests.post(f"{BASE_URL}/api/admin/licenses/{lic_id}/renew",
                     json={"expires_at": future}, headers=_hdr(master), timeout=30)
    assert r.status_code == 200
    r = requests.post(f"{BASE_URL}/api/auth/license/verify",
                     json={"email": TEST_EMAIL, "pin": new_pin}, headers=NOAUTH, timeout=30)
    assert r.status_code == 200


def test_unknown_email_rejected_401():
    r = requests.post(f"{BASE_URL}/api/auth/license/verify",
                      json={"email": "never-existed@test.local", "pin": "123456"},
                      headers=NOAUTH, timeout=30)
    assert r.status_code == 401


def test_admin_endpoint_401_without_master_token():
    r = requests.get(f"{BASE_URL}/api/admin/licenses", headers=NOAUTH, timeout=30)
    assert r.status_code == 401


def test_license_verify_rejects_invalid_email_format():
    r = requests.post(f"{BASE_URL}/api/auth/license/verify",
                      json={"email": "not-an-email", "pin": "123456"},
                      headers=NOAUTH, timeout=30)
    assert r.status_code == 422


def test_expired_license_cannot_login():
    """A license whose expires_at is in the past must fail login even with the
    correct PIN."""
    master = _master_token()
    email = f"pytest-expired-{uuid.uuid4().hex[:6]}@test.local"
    past = "2020-01-01T00:00:00Z"
    r = requests.post(f"{BASE_URL}/api/admin/licenses",
                     json={"email": email, "expires_at": past},
                     headers=_hdr(master), timeout=30)
    assert r.status_code == 200
    pin = r.json()["pin"]
    r = requests.post(f"{BASE_URL}/api/auth/license/verify",
                     json={"email": email, "pin": pin}, headers=NOAUTH, timeout=30)
    assert r.status_code == 401
