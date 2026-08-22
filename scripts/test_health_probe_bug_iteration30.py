#!/usr/bin/env python3
"""Focused verification for Kubernetes internal health probe bug.

Tests the exact internal pod URL/path from the production log:
127.0.0.1:8001 /health (HTTP/1.0), plus the requested regression checks.
"""

import ast
import http.client
import json
import sys
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8001
SERVER_PY = Path("/app/backend/server.py")
MASTER_PIN = "140431"


results = []


def record(name, ok, details):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {details}")
    results.append({"name": name, "ok": ok, "details": details})


def request(method, path, *, body=None, headers=None, http10=False):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=10)
    if http10:
        conn._http_vsn = 10
        conn._http_vsn_str = "HTTP/1.0"
    payload = None
    req_headers = dict(headers or {})
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    conn.request(method, path, body=payload, headers=req_headers)
    resp = conn.getresponse()
    raw = resp.read()
    text = raw.decode("utf-8", errors="replace")
    hdrs = {k.lower(): v for k, v in resp.getheaders()}
    conn.close()
    parsed = None
    try:
        parsed = json.loads(text)
    except Exception:
        pass
    return resp.status, hdrs, text, parsed


def test_health_endpoint(path):
    status, headers, text, parsed = request("GET", path, http10=True)
    ok = status == 200 and parsed == {"status": "ok"} and "application/json" in headers.get("content-type", "")
    record(
        f"internal unauthenticated HTTP/1.0 GET {path}",
        ok,
        f"status={status}, content-type={headers.get('content-type')}, body={text!r}",
    )


def test_api_root():
    status, headers, text, parsed = request("GET", "/api/")
    ok = status == 200 and isinstance(parsed, dict) and parsed.get("message") == "Retirement & Roth Conversion Optimizer API"
    record("internal GET /api/ regression", ok, f"status={status}, body={text!r}")


def test_pin_verify():
    status, headers, text, parsed = request("POST", "/api/auth/pin/verify", body={"pin": MASTER_PIN})
    ok = (
        status == 200
        and isinstance(parsed, dict)
        and isinstance(parsed.get("token"), str)
        and len(parsed.get("token", "")) > 20
        and parsed.get("role") == "master"
    )
    safe = dict(parsed or {})
    if "token" in safe:
        safe["token"] = safe["token"][:12] + "..."
    record("internal POST /api/auth/pin/verify master auth regression", ok, f"status={status}, body={safe or text!r}")


def test_code_review_static_health():
    src = SERVER_PY.read_text()
    tree = ast.parse(src)
    func = None
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "health_check":
            func = node
            break
    if func is None:
        record("health_check function exists", False, "health_check async function not found")
        return

    bad_refs = []
    for node in ast.walk(func):
        if isinstance(node, ast.Name) and node.id in {"db", "client", "mongo_url"}:
            bad_refs.append(node.id)
        if isinstance(node, ast.Await):
            bad_refs.append("await")
    static_return = (
        len(func.body) == 1
        and isinstance(func.body[0], ast.Return)
        and isinstance(func.body[0].value, ast.Dict)
        and ast.literal_eval(func.body[0].value) == {"status": "ok"}
    )
    ok = static_return and not bad_refs
    record(
        "health handler is static/no DB/no await",
        ok,
        f"static_return={static_return}, forbidden_refs={bad_refs}",
    )

    include_idx = src.find("app.include_router(api_router)")
    health_idx = src.find('@app.get("/health"')
    cors_idx = src.find("CORSMiddleware")
    # Use the middleware registration, not the import line.
    cors_mw_idx = src.find("app.add_middleware(\n    CORSMiddleware")
    ok_order = include_idx != -1 and health_idx != -1 and cors_mw_idx != -1 and include_idx < health_idx < cors_mw_idx
    record(
        "health route registration order",
        ok_order,
        f"include_router_idx={include_idx}, health_idx={health_idx}, cors_add_middleware_idx={cors_mw_idx}, first_CORSMiddleware_idx={cors_idx}",
    )


def main():
    print("Focused test plan:")
    print("- Reproduce production probe path internally: GET http://127.0.0.1:8001/health with no auth, using HTTP/1.0.")
    print("- Verify /healthz alternate probe path, /api/ regression, and master PIN auth regression.")
    print("- Statically inspect /app/backend/server.py for static no-DB health handler and route ordering.")
    print("- No relevant testing skill found.")
    print()

    test_health_endpoint("/health")
    test_health_endpoint("/healthz")
    test_api_root()
    test_pin_verify()
    test_code_review_static_health()

    passed = sum(1 for r in results if r["ok"])
    total = len(results)
    print(f"\nSummary: {passed}/{total} checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())