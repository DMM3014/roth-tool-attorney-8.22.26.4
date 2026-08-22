"""Advisor PIN gate tests (SEC-003, Phase 33).

Runs over HTTP against the live backend (motor's event loop stays put) with a known
test PIN hash swapped into Mongo for the module. The swap keeps the ORIGINAL epoch so
tokens minted by conftest for other concurrently-running modules stay valid; the one
epoch-rotating test (PIN change) restores the original doc in its teardown and conftest
self-heals any transient 401 by re-minting.
"""
import os
import sys
import uuid

import pytest
import requests

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND, ".env"))

from pymongo import MongoClient
from defaults import DEFAULT_SCENARIO
from auth_pin import PIN_DOC_ID, hash_pin, mint_advisor_token
from auth_licenses import MASTER_DOC_ID

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

TEST_PIN = "999999"
NOAUTH = {"X-Test-No-Auth": "1"}  # tells conftest not to inject an advisor bearer
mdb = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture(scope="module", autouse=True)
def _test_pin_hash():
    """Swap in a known test PIN hash for the module against BOTH auth docs (master +
    legacy advisor), KEEPING their original epochs so tokens minted by conftest for
    other concurrently-running modules stay valid; the one epoch-rotating test
    restores the docs in its teardown."""
    original_advisor = mdb.auth_config.find_one({"_id": PIN_DOC_ID})
    original_master = mdb.auth_config.find_one({"_id": MASTER_DOC_ID})
    assert original_master is not None, "master PIN doc missing — backend startup seeding failed"
    test_hash = hash_pin(TEST_PIN)
    if original_advisor is not None:
        mdb.auth_config.update_one({"_id": PIN_DOC_ID}, {"$set": {"pin_hash": test_hash}})
    mdb.auth_config.update_one({"_id": MASTER_DOC_ID}, {"$set": {"pin_hash": test_hash}})
    yield
    if original_advisor is not None:
        mdb.auth_config.replace_one({"_id": PIN_DOC_ID}, original_advisor, upsert=True)
    mdb.auth_config.replace_one({"_id": MASTER_DOC_ID}, original_master, upsert=True)


def _epoch():
    return mdb.auth_config.find_one({"_id": MASTER_DOC_ID})["epoch"]


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_protected_endpoint_401_without_auth():
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": DEFAULT_SCENARIO},
                      headers=NOAUTH, timeout=60)
    assert r.status_code == 401
    assert r.json()["detail"] == "Advisor authentication required"


def test_root_is_open():
    assert requests.get(f"{BASE_URL}/api/", headers=NOAUTH, timeout=30).status_code == 200


def test_wrong_pin_rejected():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": "000000"},
                      headers=NOAUTH, timeout=30)
    assert r.status_code == 401


def test_garbage_token_rejected():
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": DEFAULT_SCENARIO},
                      headers=_bearer("not-a-jwt"), timeout=60)
    assert r.status_code == 401


def test_correct_pin_issues_working_token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": TEST_PIN},
                      headers=NOAUTH, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["expires_days"] == 30
    hdrs = _bearer(body["token"])
    assert requests.post(f"{BASE_URL}/api/projection", json={"config": DEFAULT_SCENARIO},
                         headers=hdrs, timeout=60).status_code == 200
    assert requests.get(f"{BASE_URL}/api/auth/pin/status", headers=hdrs,
                        timeout=30).json()["authenticated"] is True
    assert requests.get(f"{BASE_URL}/api/auth/pin/status", headers=NOAUTH,
                        timeout=30).json()["authenticated"] is False


def test_share_token_unlocks_compute_but_not_advisor_surface():
    share = uuid.uuid4().hex
    sid = str(uuid.uuid4())
    mdb.scenarios.insert_one({"id": sid, "name": "pin-gate-test", "config": DEFAULT_SCENARIO,
                              "owner_token": str(uuid.uuid4()), "share_token": share,
                              "created_at": "2026-01-01T00:00:00+00:00"})
    try:
        hdrs = {**NOAUTH, "X-Share-Token": share}
        assert requests.post(f"{BASE_URL}/api/projection", json={"config": DEFAULT_SCENARIO},
                             headers=hdrs, timeout=60).status_code == 200
        assert requests.get(f"{BASE_URL}/api/defaults", headers=hdrs, timeout=30).status_code == 200
        # advisor-only surface stays closed to share tokens
        assert requests.get(f"{BASE_URL}/api/scenarios",
                            headers={**hdrs, "X-Session-Token": str(uuid.uuid4())},
                            timeout=30).status_code == 401
        # bogus share token unlocks nothing
        assert requests.post(f"{BASE_URL}/api/projection", json={"config": DEFAULT_SCENARIO},
                             headers={**NOAUTH, "X-Share-Token": uuid.uuid4().hex},
                             timeout=60).status_code == 401
        # the public share fetch endpoint needs no auth at all
        assert requests.get(f"{BASE_URL}/api/scenarios/share/{share}", headers=NOAUTH,
                            timeout=30).status_code == 200
    finally:
        mdb.scenarios.delete_one({"id": sid})


def test_change_pin_endpoint_deprecated():
    """Master PIN change via HTTP is disabled — endpoint returns 410 with an
    instructional message. Master PIN is now sourced from MASTER_ADMIN_PIN env
    only (rotated by editing env + restarting), so a compromised master session
    cannot lock the owner out. Licensee PIN rotation goes through the admin API."""
    # Mint a master token via the standard verify endpoint (test-scoped PIN)
    tok = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": TEST_PIN},
                        headers=NOAUTH, timeout=30).json()["token"]
    r = requests.post(f"{BASE_URL}/api/auth/pin/change",
                      json={"current_pin": TEST_PIN, "new_pin": "888888"},
                      headers=_bearer(tok), timeout=30)
    assert r.status_code == 410, r.text
    assert "MASTER_ADMIN_PIN" in r.json()["detail"]
