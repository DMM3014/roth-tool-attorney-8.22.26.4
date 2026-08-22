#!/usr/bin/env python3
"""Focused verification for Kubernetes health probe 404 regression.

Uses the external preview backend URL from /app/frontend/.env for the primary
contract. Also checks internal 127.0.0.1:8001 to distinguish backend app routing
from preview ingress routing.
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path


ENV_PATH = Path("/app/frontend/.env")
MASTER_PIN = "140431"


def backend_url() -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


def request(method: str, url: str, body: dict | None = None):
    cmd = ["curl", "-sS", "-w", "\n%{http_code}", "--max-time", "15", "-X", method]
    if body is not None:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(body)])
    cmd.append(url)
    start = time.perf_counter()
    proc = subprocess.run(cmd, check=False, text=True, capture_output=True)
    elapsed_ms = (time.perf_counter() - start) * 1000
    if proc.returncode != 0:
        raise RuntimeError(f"curl failed for {url}: {proc.stderr.strip()}")
    raw, status_s = proc.stdout.rsplit("\n", 1)
    return int(status_s), raw, elapsed_ms


def parse_json(raw: str):
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AssertionError(f"response was not JSON: {raw!r}") from exc


def assert_equal(actual, expected, label: str):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main() -> int:
    external = backend_url()
    internal = "http://127.0.0.1:8001"
    results = []
    failures = []

    def record(base_name: str, base: str, method: str, path: str, expected_status: int, expected_body=None, body=None):
        status, raw, elapsed_ms = request(method, f"{base}{path}", body)
        parsed = None
        parse_error = None
        try:
            parsed = parse_json(raw)
        except AssertionError as exc:
            parse_error = str(exc)
        ok = status == expected_status and (expected_body is None or parsed == expected_body)
        item = {
            "base": base_name,
            "endpoint": path,
            "status": status,
            "elapsed_ms": round(elapsed_ms, 1),
            "json": parsed,
            "raw_prefix": raw[:120],
            "ok": ok,
        }
        if parse_error:
            item["parse_error"] = parse_error
        results.append(item)
        if not ok:
            failures.append(item)

    # Primary contract requested by the review: external preview URL, no auth headers.
    for path in ["/health", "/healthz"]:
        record("external", external, "GET", path, 200, {"status": "ok"})

    # Existing external API behavior/regressions.
    record("external", external, "GET", "/api/", 200, {"message": "Retirement & Roth Conversion Optimizer API"})
    record("external", external, "GET", "/api/nonexistent", 404)
    status, raw, elapsed_ms = request("POST", f"{external}/api/auth/pin/verify", {"pin": MASTER_PIN})
    auth_json = parse_json(raw)
    auth_ok = status == 200 and auth_json.get("role") == "master" and bool(auth_json.get("token"))
    results.append({"base": "external", "endpoint": "/api/auth/pin/verify", "status": status, "elapsed_ms": round(elapsed_ms, 1), "role": auth_json.get("role"), "token_present": bool(auth_json.get("token")), "ok": auth_ok})
    if not auth_ok:
        failures.append(results[-1])

    # Diagnostic: backend app itself is healthy on its container port.
    for path in ["/health", "/healthz"]:
        record("internal", internal, "GET", path, 200, {"status": "ok"})

    print(json.dumps({"external_base_url": external, "internal_base_url": internal, "results": results, "failures": failures}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())