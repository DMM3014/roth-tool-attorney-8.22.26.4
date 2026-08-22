"""Shared foundation imported by every route module.

Split out of `server.py` to make each `backend/routes/*.py` module import a small,
focused surface (db handle, rate limiter, auth dependencies, request validators,
LLM stream helpers) without pulling in the FastAPI app instance and creating
import cycles.

`server.py` is now the app bootstrap only — middleware, routers, startup hooks.
"""
import logging
import math
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

from auth_licenses import (
    LICENSES_COLLECTION,
    decode_token as decode_auth_token,
    is_valid_licensee_token,
    is_valid_master_token,
)

# --------------------------------------------------------------------------
# App-wide constants & DB handle
# --------------------------------------------------------------------------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

# ---------- Security limits (SEC-001) ----------
MAX_PROJECTION_YEARS = 60
MAX_SWEEP_GRID_CELLS = 500
MAX_SS_AGES = 8
MAX_MC_TRIALS = 2000
MAX_POST_DEATH_YEARS = 100
MAX_EXPENSES = 60
MAX_CONFIG_NODES = 20000
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
SHARE_TOKEN_RE = re.compile(r"^[a-zA-Z0-9_-]{22,64}$")


# --------------------------------------------------------------------------
# Rate limiting
# X-Forwarded-For is client-prependable: an attacker can spoof the LEFTMOST
# entries to dodge per-client limits. Our ingress APPENDS the real socket peer
# on the RIGHT, so the trustworthy client identity is the Nth-from-right hop.
# --------------------------------------------------------------------------
TRUSTED_PROXY_HOPS = max(1, int(os.environ.get("TRUSTED_PROXY_HOPS", "1")))


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[max(0, len(parts) - TRUSTED_PROXY_HOPS)]
    return get_remote_address(request)


limiter = Limiter(key_func=_client_ip, default_limits=["300/minute"])


# --------------------------------------------------------------------------
# Security headers (P3 hardening)
# --------------------------------------------------------------------------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        resp.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        return resp


# --------------------------------------------------------------------------
# Request validation helpers
# --------------------------------------------------------------------------
def _bad_request(msg: str):
    raise HTTPException(status_code=400, detail=msg)


def _reject_non_finite(node) -> None:
    """SEC-003: stdlib JSON happily parses NaN/Infinity inside free-form dicts.
    Iterative walk with a node budget doubles as an overall structural size cap."""
    stack = [node]
    seen = 0
    while stack:
        cur = stack.pop()
        seen += 1
        if seen > MAX_CONFIG_NODES:
            _bad_request("config too large")
        if isinstance(cur, float):
            if not math.isfinite(cur):
                _bad_request("config contains non-finite numbers (NaN/Infinity)")
        elif isinstance(cur, dict):
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)


def validate_config(config: dict) -> None:
    """Cap engine inputs to prevent DoS via oversized projection horizons."""
    if not isinstance(config, dict):
        _bad_request("config must be an object")
    proj = config.get("projection") or {}
    start = proj.get("start_year")
    end = proj.get("end_year")
    if not isinstance(start, int) or not isinstance(end, int):
        _bad_request("projection.start_year and end_year must be integers")
    if end < start:
        _bad_request("projection.end_year must be >= start_year")
    if end - start > MAX_PROJECTION_YEARS:
        _bad_request(f"projection horizon capped at {MAX_PROJECTION_YEARS} years")
    accts = config.get("accounts")
    if accts is not None and len(accts) > 50:
        _bad_request("accounts list capped at 50 entries")
    streams = config.get("income_streams")
    if streams is not None and len(streams) > 40:
        _bad_request("income_streams list capped at 40 entries")
    expenses = config.get("expenses")
    if expenses is not None and len(expenses) > MAX_EXPENSES:
        _bad_request(f"expenses list capped at {MAX_EXPENSES} entries")
    legacy = config.get("legacy") or {}
    pdy = legacy.get("post_death_years")
    if pdy is not None:
        if isinstance(pdy, bool) or not isinstance(pdy, (int, float)) \
                or not float(pdy).is_integer() or not (0 <= pdy <= MAX_POST_DEATH_YEARS):
            _bad_request(f"legacy.post_death_years must be an integer between 0 and {MAX_POST_DEATH_YEARS}")
    _reject_non_finite(config)


# --------------------------------------------------------------------------
# Session scoping (SEC-002)
# --------------------------------------------------------------------------
async def require_session(x_session_token: Optional[str] = Header(default=None)) -> str:
    """Every scenario read/write must present an anonymous per-browser session token
    (a UUIDv4 minted by the frontend and kept in localStorage)."""
    if not x_session_token or not UUID_RE.match(x_session_token):
        raise HTTPException(status_code=401, detail="Missing or invalid X-Session-Token")
    return x_session_token.lower()


# --------------------------------------------------------------------------
# Advisor / master gates (SEC-003)
# Post-licensing, the "advisor" surface unified: master OR licensee tokens satisfy
# require_advisor. Master-only surface (admin, license CRUD) uses require_master.
# --------------------------------------------------------------------------
ADVISOR_AUTH_DETAIL = "Advisor authentication required"
MASTER_AUTH_DETAIL = "Master authentication required"


async def extract_bearer_payload(authorization: Optional[str]) -> Optional[dict]:
    """Decode a Bearer JWT into its payload dict (or None on any failure).
    Public API — consumed by routes/planning.py to key per-advisor defaults
    on the caller's identity."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return decode_auth_token(authorization[7:])


# Backwards-compat alias for the pre-Phase-54 private name — routes/auth.py
# still imports it via this shim until that module is rewritten.
_extract_bearer_payload = extract_bearer_payload


async def _is_master(payload: Optional[dict]) -> bool:
    if payload is None or payload.get("role") != "master":
        return False
    return await is_valid_master_token(db, payload)


async def _is_licensee(payload: Optional[dict]) -> bool:
    if payload is None or payload.get("role") != "licensee":
        return False
    return await is_valid_licensee_token(db, payload)


async def _advisor_token_ok(authorization: Optional[str]) -> bool:
    payload = await extract_bearer_payload(authorization)
    if payload is None:
        return False
    return await _is_master(payload) or await _is_licensee(payload)


async def require_advisor(authorization: Optional[str] = Header(default=None)) -> None:
    if not await _advisor_token_ok(authorization):
        raise HTTPException(status_code=401, detail=ADVISOR_AUTH_DETAIL)


async def require_master(authorization: Optional[str] = Header(default=None)) -> None:
    payload = await extract_bearer_payload(authorization)
    if not await _is_master(payload):
        raise HTTPException(status_code=401, detail=MASTER_AUTH_DETAIL)


async def require_advisor_or_share(
    authorization: Optional[str] = Header(default=None),
    x_share_token: Optional[str] = Header(default=None, alias="X-Share-Token"),
) -> None:
    """Compute/read surface: an advisor token OR a valid share token unlocks."""
    if await _advisor_token_ok(authorization):
        return
    if x_share_token:
        row = await db.scenarios.find_one({"share_token": x_share_token}, {"_id": 1})
        if row:
            return
    raise HTTPException(status_code=401, detail=ADVISOR_AUTH_DETAIL)


# --------------------------------------------------------------------------
# LLM configuration + stream helpers (BYOK Gemini > default Fable > server Gemini)
# --------------------------------------------------------------------------
from google import genai
from google.genai import types as genai_types
from google.genai import errors as genai_errors
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

GEMINI_MODEL = "gemini-flash-latest"
FABLE_MODEL = "claude-fable-5"
DEFAULT_GEMINI_API_KEY = os.environ.get("DEFAULT_GEMINI_API_KEY", "").strip()
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "").strip()


def _gemini_http_error(e: Exception) -> HTTPException:
    code = getattr(e, "code", None)
    msg = str(e)
    if code in (401, 403) or "API_KEY_INVALID" in msg or "API key not valid" in msg or "PERMISSION_DENIED" in msg:
        return HTTPException(status_code=401,
                             detail="Your Gemini API key was rejected. Check it at aistudio.google.com and try again.")
    if code == 429 or "RESOURCE_EXHAUSTED" in msg:
        return HTTPException(status_code=429,
                             detail="Your Gemini key hit its rate limit or free-tier quota. Wait a minute and try again.")
    return HTTPException(status_code=502, detail="Gemini is temporarily unavailable. Please try again.")


async def _fable_stream(system: str, prompt: str, max_tokens: int):
    """Default engine: Anthropic Claude Fable 5 via the Emergent universal key."""
    chat = (
        LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"insights-{uuid.uuid4()}", system_message=system)
        .with_model("anthropic", FABLE_MODEL)
        .with_params(max_tokens=max_tokens)
    )
    gen = chat.stream_message(UserMessage(text=prompt))
    try:
        first = await anext(gen, None)
    except Exception:
        logging.exception("fable stream init failed")
        raise HTTPException(status_code=502, detail="AI Insights is temporarily unavailable. Please try again.")

    async def _iter():
        try:
            if isinstance(first, TextDelta) and first.content:
                yield first.content
            async for ev in gen:
                if isinstance(ev, TextDelta) and ev.content:
                    yield ev.content
                elif isinstance(ev, StreamDone):
                    break
        except Exception:
            logging.exception("fable stream failed")
            yield "\n[Sorry, insights are temporarily unavailable. Please try again.]"

    return _iter()


async def _gemini_stream(api_key: str, system: str, prompt: str, max_tokens: int):
    gclient = genai.Client(api_key=api_key)
    try:
        stream = await gclient.aio.models.generate_content_stream(
            model=GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=max_tokens,
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        first = await anext(stream, None)
    except HTTPException:
        raise
    except genai_errors.APIError as e:
        raise _gemini_http_error(e)
    except Exception:
        logging.exception("gemini stream init failed")
        raise HTTPException(status_code=502, detail="Gemini is temporarily unavailable. Please try again.")

    async def _iter():
        _keepalive = gclient  # noqa: F841 — keep the aiohttp session alive
        try:
            if first is not None and first.text:
                yield first.text
            async for chunk in stream:
                if chunk.text:
                    yield chunk.text
        except Exception:
            logging.exception("gemini stream failed")
            yield "\n[Sorry, insights are temporarily unavailable. Please try again.]"

    return _iter()


async def insights_stream(user_key: Optional[str], system: str, prompt: str, max_tokens: int):
    """BYOK Gemini > default Fable > server-side Gemini. 401 when nothing is configured."""
    k = (user_key or "").strip()
    if k:
        return await _gemini_stream(k, system, prompt, max_tokens)
    if EMERGENT_LLM_KEY:
        return await _fable_stream(system, prompt, max_tokens)
    if DEFAULT_GEMINI_API_KEY:
        return await _gemini_stream(DEFAULT_GEMINI_API_KEY, system, prompt, max_tokens)
    raise HTTPException(status_code=401,
                        detail="AI Insights is not configured. Add your Gemini API key to continue.")
