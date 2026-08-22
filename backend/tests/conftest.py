"""Shared test config.

1) Transparently retry HTTP 429 (rate-limit) responses. The API enforces strict
   per-client rate limits (Phase 19/21 security hardening), so running the full HTTP
   test suite in one shot trips 429s that are NOT regressions. This hook patches
   requests so any 429 waits for the rate window and retries (up to 5 times).
   Escape hatch: requests that carry an explicit X-Forwarded-For header are NOT
   retried — the Phase 21 spoof-resistance test needs to observe the raw 429.

2) Advisor PIN gate (SEC-003) support:
   - HTTP-based tests: transparently attach a valid advisor bearer token minted from
     the live epoch, so pre-gate tests keep passing against the protected API. If the
     epoch rotates mid-run (the auth tests exercise PIN changes), a 401 re-mints the
     token once and retries. Escape hatches: an explicit Authorization or
     X-Test-No-Auth header skips injection.
   - In-process TestClient tests: bypass the gate via dependency_overrides (their
     endpoints never touch Mongo, avoiding motor event-loop binding issues). The
     dedicated auth module (test_phase33_pin_auth) tests the real gate over HTTP.
"""
import os
import sys
import time

import pytest
import requests

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

_ADVISOR_TOKEN_CACHE = {}


def _advisor_bearer():
    if "tok" not in _ADVISOR_TOKEN_CACHE:
        _ADVISOR_TOKEN_CACHE["tok"] = ""
        # First try HTTP PIN verify against the preview backend — this is the source of
        # truth when running tests against the deployed URL (the preview backend may use
        # a different DB / epoch than the local mongo).
        base = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
        pin = os.environ.get("ADVISOR_PIN", "")
        if base and pin:
            try:
                r = _orig_request(requests.Session(), "POST",
                                  f"{base}/api/auth/pin/verify",
                                  json={"pin": pin}, timeout=10)
                if r.status_code == 200:
                    _ADVISOR_TOKEN_CACHE["tok"] = f"Bearer {r.json()['token']}"
                    return _ADVISOR_TOKEN_CACHE["tok"]
            except Exception:
                pass
        # Fallback: mint locally from same-host mongo (in-process tests).
        try:
            from dotenv import load_dotenv
            load_dotenv(os.path.join(_BACKEND_DIR, ".env"))
            from pymongo import MongoClient
            mdb = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
            # Post-Phase-34 two-tier auth: mint a master-role token from the
            # master_pin doc's epoch (the old advisor-token mint is rejected).
            try:
                from auth_licenses import mint_master_token, MASTER_DOC_ID
                doc = mdb.auth_config.find_one({"_id": MASTER_DOC_ID})
                if doc:
                    _ADVISOR_TOKEN_CACHE["tok"] = f"Bearer {mint_master_token(doc['epoch'])}"
                    return _ADVISOR_TOKEN_CACHE["tok"]
            except Exception:
                pass
            from auth_pin import mint_advisor_token, PIN_DOC_ID
            doc = mdb.auth_config.find_one({"_id": PIN_DOC_ID})
            if doc:
                _ADVISOR_TOKEN_CACHE["tok"] = f"Bearer {mint_advisor_token(doc['epoch'])}"
        except Exception:
            pass
    return _ADVISOR_TOKEN_CACHE["tok"]


_orig_request = requests.sessions.Session.request


def _patched_request(self, method, url, **kwargs):
    headers = kwargs.get("headers") or {}
    lower = {k.lower() for k in headers} | {k.lower() for k in self.headers}
    injected = False
    if "/api/" in str(url) and "authorization" not in lower and "x-test-no-auth" not in lower:
        tok = _advisor_bearer()
        if tok:
            headers = dict(headers)
            headers["Authorization"] = tok
            kwargs["headers"] = headers
            injected = True
    no_retry = "x-forwarded-for" in lower or "x-test-expect-429" in lower
    resp = _orig_request(self, method, url, **kwargs)
    if injected and resp.status_code == 401:
        # Self-heal: the PIN epoch may have rotated mid-run (auth tests). Re-mint once.
        try:
            if resp.json().get("detail") == "Advisor authentication required":
                _ADVISOR_TOKEN_CACHE.pop("tok", None)
                tok = _advisor_bearer()
                if tok:
                    kwargs["headers"]["Authorization"] = tok
                    resp = _orig_request(self, method, url, **kwargs)
        except Exception:
            pass
    if no_retry:
        return resp
    for _ in range(5):
        if resp.status_code != 429:
            break
        time.sleep(15)
        resp = _orig_request(self, method, url, **kwargs)
    return resp


requests.sessions.Session.request = _patched_request


@pytest.fixture(scope="session", autouse=True)
def _advisor_gate_bypass_for_legacy_tests():
    """In-process TestClient tests predate the PIN gate; neutralize it for them.
    (Their endpoints are pure compute — the real gate is HTTP-tested in phase 33.)"""
    try:
        from server import app, require_advisor, require_advisor_or_share
    except Exception:
        yield
        return
    app.dependency_overrides[require_advisor] = lambda: None
    app.dependency_overrides[require_advisor_or_share] = lambda: None
    yield
    app.dependency_overrides.pop(require_advisor, None)
    app.dependency_overrides.pop(require_advisor_or_share, None)
