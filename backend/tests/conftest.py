"""Shared test config: transparently retry HTTP 429 (rate-limit) responses.

The API enforces strict per-client rate limits (Phase 19/21 security hardening), so running
the full HTTP test suite in one shot trips 429s that are NOT regressions. This hook patches
requests so any 429 waits for the rate window and retries (up to 5 times).

Escape hatch: requests that carry an explicit X-Forwarded-For header are NOT retried —
the Phase 21 spoof-resistance test needs to observe the raw 429.
"""
import time

import requests

_orig_request = requests.sessions.Session.request


def _patched_request(self, method, url, **kwargs):
    headers = kwargs.get("headers") or {}
    lower = {k.lower() for k in headers} | {k.lower() for k in self.headers}
    no_retry = "x-forwarded-for" in lower or "x-test-expect-429" in lower
    resp = _orig_request(self, method, url, **kwargs)
    if no_retry:
        return resp
    for _ in range(5):
        if resp.status_code != 429:
            break
        time.sleep(15)
        resp = _orig_request(self, method, url, **kwargs)
    return resp


requests.sessions.Session.request = _patched_request
