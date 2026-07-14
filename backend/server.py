from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import re
import json
import math
import logging
import secrets
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import Any, Dict, List, Optional
import uuid
from datetime import datetime, timezone

from tax_engine import compute_year_tax, optimize_conversion
from projection import run_projection, sweep_brackets
from montecarlo import run_montecarlo
from strategy_optimizer import strategy_sweep
from ss_optimizer import sweep_ss_claims
from defaults import DEFAULT_SCENARIO
from states import STATES
import asyncio
from google import genai
from google.genai import types as genai_types
from google.genai import errors as genai_errors

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ---------- Security limits (SEC-001) ----------
MAX_PROJECTION_YEARS = 60          # cap plan horizon
MAX_SWEEP_GRID_CELLS = 500         # start × stop × bracket cells for /api/strategy-sweep
MAX_SS_AGES = 8                    # /api/ss-optimizer sweep breadth
MAX_MC_TRIALS = 2000               # already enforced in engine but re-checked here
MAX_POST_DEATH_YEARS = 100         # SECURE-Act horizon is 10; 100 is a generous hard cap
MAX_EXPENSES = 60                  # matches accounts(50)/income_streams(40) style caps
MAX_CONFIG_NODES = 20000           # total JSON nodes walked by the non-finite scan
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
SHARE_TOKEN_RE = re.compile(r"^[a-zA-Z0-9_-]{22,64}$")  # url-safe base64 of ≥16 secure bytes


def _bad_request(msg: str):
    """Uniform 400 for size / range / shape violations."""
    raise HTTPException(status_code=400, detail=msg)


def _reject_non_finite(node) -> None:
    """SEC-003: stdlib JSON happily parses NaN/Infinity literals inside free-form dicts
    (typed Pydantic fields already reject them via allow_inf_nan=False). Walk the object
    iteratively (no recursion-depth attack) with a node budget that doubles as an overall
    structural size cap."""
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


def _validate_config(config: dict) -> None:
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
    # SEC-001 (audit round 3): post-death horizon drives an O(years) loop per projection
    # (x500 under strategy-sweep) — hard-cap it before any compute happens.
    legacy = config.get("legacy") or {}
    pdy = legacy.get("post_death_years")
    if pdy is not None:
        if isinstance(pdy, bool) or not isinstance(pdy, (int, float)) \
                or not float(pdy).is_integer() or not (0 <= pdy <= MAX_POST_DEATH_YEARS):
            _bad_request(f"legacy.post_death_years must be an integer between 0 and {MAX_POST_DEATH_YEARS}")
    _reject_non_finite(config)


# ---------- Session scoping (SEC-002) ----------
async def require_session(x_session_token: Optional[str] = Header(default=None)) -> str:
    """Every scenario read/write must present an anonymous per-browser session token
    (a UUIDv4 minted by the frontend and kept in localStorage). This scopes saved
    plans so one visitor cannot read or delete another's data."""
    if not x_session_token or not UUID_RE.match(x_session_token):
        raise HTTPException(status_code=401, detail="Missing or invalid X-Session-Token")
    return x_session_token.lower()


# ---------- Rate limiting (SEC-001) ----------
# X-Forwarded-For is client-prependable: an attacker can spoof the LEFTMOST entries to
# dodge per-client limits. The trusted proxy chain (our ingress) APPENDS the real socket
# peer on the RIGHT, so the trustworthy client identity is the Nth-from-right hop, where
# N = number of trusted proxies in front of the app. Default 1 (the ingress). Configurable
# for other deploy topologies without touching code.
TRUSTED_PROXY_HOPS = max(1, int(os.environ.get("TRUSTED_PROXY_HOPS", "1")))


def _client_ip(request: Request) -> str:
    """Rate-limit key derived from the trusted proxy hop, not from client-controlled XFF."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            # count TRUSTED_PROXY_HOPS in from the right; clamp so extra spoofed
            # leftmost entries can never shift us past the real client hop.
            return parts[max(0, len(parts) - TRUSTED_PROXY_HOPS)]
    return get_remote_address(request)


limiter = Limiter(key_func=_client_ip, default_limits=["300/minute"])

app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError):
    """Return a clean 422 that never reflects raw request input. Non-finite floats
    (NaN/Inf) in the offending body otherwise break the default handler's JSON
    serializer (500) AND echo attacker-supplied values back (SEC-003)."""
    errors = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")}
              for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


# ---------- Security headers (P3 hardening) ----------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        # API serves only JSON / plain-text; lock rendering contexts down entirely.
        resp.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        return resp


app.add_middleware(SecurityHeadersMiddleware)

api_router = APIRouter(prefix="/api")

GEMINI_MODEL = "gemini-flash-latest"
DEFAULT_GEMINI_API_KEY = os.environ.get("DEFAULT_GEMINI_API_KEY", "").strip()


def _resolve_gemini_key(user_key: Optional[str]) -> str:
    """Prefer the caller's BYOK key; fall back to the server-side default. If neither is
    configured, surface a 401 so the client can prompt for a key."""
    k = (user_key or "").strip()
    if k:
        return k
    if DEFAULT_GEMINI_API_KEY:
        return DEFAULT_GEMINI_API_KEY
    raise HTTPException(status_code=401,
                        detail="AI Insights is not configured. Add your Gemini API key to continue.")


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


async def _gemini_stream(api_key: str, system: str, prompt: str, max_tokens: int):
    """Returns a primed text async-generator. Key/quota errors raise before streaming starts."""
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
        _keepalive = gclient  # noqa: F841 — keep the aiohttp session alive for the stream's lifetime
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


# ---------- Models ----------
class YearTaxRequest(BaseModel):
    inputs: Dict[str, Any]


class OptimizeRequest(BaseModel):
    inputs: Dict[str, Any]
    target_rate: float = Field(default=0.24, ge=0.0, le=1.0, allow_inf_nan=False)
    max_conversion: float = Field(default=0.0, ge=0.0, le=1e9, allow_inf_nan=False)


class ProjectionRequest(BaseModel):
    config: Dict[str, Any]


class Scenario(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    config: Dict[str, Any]
    owner_token: Optional[str] = None       # UUIDv4 stamp of the browser session that owns this plan
    share_token: Optional[str] = None       # opaque public read-only handle (nullable = not shared)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class SharedScenario(BaseModel):
    """Public shape of a scenario served via /api/scenarios/share/{token}.
    Deliberately omits owner_token AND the internal id so a viewer can only see the plan
    payload — never the owner's session token or the primary-key needed to hit the
    session-scoped endpoints."""
    name: str
    config: Dict[str, Any]
    created_at: str


class ScenarioCreate(BaseModel):
    name: str
    config: Dict[str, Any]

    @field_validator("name")
    @classmethod
    def _name_bounds(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name required")
        if len(v) > 120:
            raise ValueError("name capped at 120 chars")
        return v.strip()


class InsightRequest(BaseModel):
    summary: Dict[str, Any]
    api_key: Optional[str] = None

    @field_validator("api_key")
    @classmethod
    def _api_key_bounds(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if len(v) > 200:
            raise ValueError("API key too long")
        return v or None


class ChatTurn(BaseModel):
    role: str
    content: str

    @field_validator("content")
    @classmethod
    def _content_bounds(cls, v: str) -> str:
        if len(v) > 4000:
            raise ValueError("chat content capped at 4000 chars per turn")
        return v


class InsightChatRequest(InsightRequest):
    history: List[ChatTurn] = []
    message: str

    @field_validator("history")
    @classmethod
    def _history_bounds(cls, v: List[ChatTurn]) -> List[ChatTurn]:
        if len(v) > 40:
            raise ValueError("chat history capped at 40 turns")
        return v

    @field_validator("message")
    @classmethod
    def _message_bounds(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("message capped at 2000 chars")
        return v


class AssetClass(BaseModel):
    mean: float = Field(ge=-1.0, le=1.0, allow_inf_nan=False)
    vol: float = Field(ge=0.0, le=2.0, allow_inf_nan=False)
    weight: float = Field(ge=0.0, le=1000.0, allow_inf_nan=False)


class ShockSpec(BaseModel):
    enabled: bool = False
    rate: float = Field(default=-0.15, ge=-1.0, le=1.0, allow_inf_nan=False)
    years: int = Field(default=2, ge=0, le=60)


class InflationSpec(BaseModel):
    enabled: bool = True
    mean: float = Field(default=0.03, ge=-0.5, le=1.0, allow_inf_nan=False)
    vol: float = Field(default=0.015, ge=0.0, le=1.0, allow_inf_nan=False)  # 1.5% ≈ post-1990 US CPI stdev


class CorrelationSpec(BaseModel):
    """Gaussian-copula pairwise correlations across stocks/bonds/cash/inflation draws.
    Defaults ≈ long-run US annual history. Repaired to nearest PSD matrix server-side.
    Field bounds reject out-of-range AND non-finite (NaN/Inf) inputs at the API boundary."""
    enabled: bool = False
    stocks_bonds: float = Field(default=0.15, ge=-0.99, le=0.99, allow_inf_nan=False)
    stocks_cash: float = Field(default=0.0, ge=-0.99, le=0.99, allow_inf_nan=False)
    bonds_cash: float = Field(default=0.20, ge=-0.99, le=0.99, allow_inf_nan=False)
    stocks_inflation: float = Field(default=-0.20, ge=-0.99, le=0.99, allow_inf_nan=False)
    bonds_inflation: float = Field(default=-0.30, ge=-0.99, le=0.99, allow_inf_nan=False)
    cash_inflation: float = Field(default=0.55, ge=-0.99, le=0.99, allow_inf_nan=False)


class GuardrailSpec(BaseModel):
    """Spending flexibility (Guyton-Klinger-lite): cut discretionary expenses by cut_pct
    in any year following a portfolio loss. Taxes are never flexible."""
    enabled: bool = False
    cut_pct: float = Field(default=0.10, ge=0.0, le=0.5, allow_inf_nan=False)


class MonteCarloRequest(BaseModel):
    config: Dict[str, Any]
    n_trials: int = 500
    assets: Optional[Dict[str, AssetClass]] = None
    shock: Optional[ShockSpec] = None
    inflation: Optional[InflationSpec] = None
    correlation: Optional[CorrelationSpec] = None
    engine: str = "lognormal"
    anchor_to_plan: bool = True
    guardrail: Optional[GuardrailSpec] = None
    seed: Optional[int] = None

    @field_validator("engine")
    @classmethod
    def _engine_ok(cls, v):
        if v not in ("lognormal", "historical"):
            raise ValueError("engine must be 'lognormal' or 'historical'")
        return v

    @field_validator("n_trials")
    @classmethod
    def _trials_bounds(cls, v):
        if v < 50 or v > MAX_MC_TRIALS:
            raise ValueError(f"n_trials must be in [50, {MAX_MC_TRIALS}]")
        return v


class StrategySweepRequest(BaseModel):
    config: Dict[str, Any]
    start_years: Optional[List[int]] = None
    stop_years: Optional[List[int]] = None
    brackets: Optional[List[float]] = None
    include_phased: bool = True
    irmaa_cap: Optional[int] = None
    max_annual: float = 0.0

    @field_validator("start_years", "stop_years")
    @classmethod
    def _year_list_bounds(cls, v):
        if v is None:
            return v
        if len(v) > 40:
            raise ValueError("year list capped at 40 entries")
        return v

    @field_validator("brackets")
    @classmethod
    def _brackets_bounds(cls, v):
        if v is None:
            return v
        if len(v) > 12:
            raise ValueError("brackets list capped at 12 entries")
        if any(not (0.0 <= x <= 0.99) for x in v):
            raise ValueError("bracket values must lie in [0, 0.99]")
        return v


class SsOptimizerRequest(BaseModel):
    config: Dict[str, Any]
    ages: Optional[List[int]] = None

    @field_validator("ages")
    @classmethod
    def _ages_bounds(cls, v):
        if v is None:
            return v
        if len(v) > MAX_SS_AGES:
            raise ValueError(f"ages list capped at {MAX_SS_AGES} entries")
        if any(not (62 <= x <= 70) for x in v):
            raise ValueError("ages must lie in [62, 70]")
        return v


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Retirement & Roth Conversion Optimizer API"}


# ---------- Custom defaults override (single-tenant tool) ----------
# Any authenticated (session-token) visitor can promote the current in-memory scenario
# to be the app's baked-in defaults by POSTing to /api/defaults/save. The payload is
# validated with the same DoS caps as any config, then persisted to a JSON file next
# to defaults.py so it survives restarts. GET /api/defaults returns the override if
# present, else the code-defined DEFAULT_SCENARIO. DELETE reverts to the built-in.
USER_DEFAULTS_PATH = ROOT_DIR / "user_defaults.json"


def _load_user_defaults() -> Optional[dict]:
    try:
        if USER_DEFAULTS_PATH.exists():
            with open(USER_DEFAULTS_PATH, "r") as f:
                return json.load(f)
    except Exception:
        logging.exception("failed reading user_defaults.json — falling back to DEFAULT_SCENARIO")
    return None


@api_router.get("/defaults")
async def get_defaults():
    return _load_user_defaults() or DEFAULT_SCENARIO


@api_router.post("/defaults/save")
@limiter.limit("10/minute")
async def save_defaults(request: Request, req: ProjectionRequest,
                        _owner: str = Depends(require_session)):
    _validate_config(req.config)
    try:
        with open(USER_DEFAULTS_PATH, "w") as f:
            json.dump(req.config, f)
    except Exception:
        logging.exception("failed writing user_defaults.json")
        raise HTTPException(status_code=500, detail="Could not save defaults")
    return {"saved": True}


@api_router.delete("/defaults/save")
@limiter.limit("10/minute")
async def revert_defaults(request: Request, _owner: str = Depends(require_session)):
    try:
        if USER_DEFAULTS_PATH.exists():
            USER_DEFAULTS_PATH.unlink()
    except Exception:
        logging.exception("failed removing user_defaults.json")
        raise HTTPException(status_code=500, detail="Could not revert defaults")
    return {"reverted": True}


@api_router.get("/states")
async def get_states():
    return STATES


@api_router.post("/tax/year")
@limiter.limit("60/minute")
async def tax_year(request: Request, req: YearTaxRequest):
    _reject_non_finite(req.inputs)
    return compute_year_tax(req.inputs)


@api_router.post("/tax/optimize")
@limiter.limit("60/minute")
async def tax_optimize(request: Request, req: OptimizeRequest):
    _reject_non_finite(req.inputs)
    return optimize_conversion(req.inputs, req.target_rate, req.max_conversion)


@api_router.post("/projection")
@limiter.limit("30/minute")
async def projection(request: Request, req: ProjectionRequest):
    _validate_config(req.config)
    try:
        # heavy sync math runs in a worker thread so it can never block the event loop
        return await asyncio.to_thread(run_projection, req.config)
    except Exception:
        logging.exception("projection failed")
        raise HTTPException(status_code=400, detail="Projection request could not be processed")


@api_router.post("/sweep")
@limiter.limit("15/minute")
async def sweep(request: Request, req: ProjectionRequest):
    _validate_config(req.config)
    try:
        return await asyncio.to_thread(sweep_brackets, req.config)
    except Exception:
        logging.exception("sweep failed")
        raise HTTPException(status_code=400, detail="Bracket sweep request could not be processed")


@api_router.post("/strategy-sweep")
@limiter.limit("10/minute")
async def strategy_sweep_endpoint(request: Request, req: StrategySweepRequest):
    _validate_config(req.config)
    # Cap the sweep grid: |start_years| * |stop_years| * |brackets| ≤ MAX_SWEEP_GRID_CELLS.
    if req.start_years and req.stop_years and req.brackets:
        cells = len(req.start_years) * len(req.stop_years) * len(req.brackets)
        if cells > MAX_SWEEP_GRID_CELLS:
            _bad_request(f"sweep grid capped at {MAX_SWEEP_GRID_CELLS} cells (got {cells})")
    try:
        return await asyncio.to_thread(
            strategy_sweep,
            req.config,
            start_years=req.start_years, stop_years=req.stop_years,
            brackets=req.brackets, include_phased=req.include_phased,
            irmaa_cap=req.irmaa_cap, max_annual=req.max_annual,
        )
    except Exception:
        logging.exception("strategy_sweep failed")
        raise HTTPException(status_code=400, detail="Strategy sweep request could not be processed")


@api_router.post("/ss-optimizer")
@limiter.limit("15/minute")
async def ss_optimizer_endpoint(request: Request, req: SsOptimizerRequest):
    _validate_config(req.config)
    try:
        return await asyncio.to_thread(sweep_ss_claims, req.config, req.ages)
    except Exception:
        logging.exception("ss_optimizer failed")
        raise HTTPException(status_code=400, detail="Social Security optimizer request could not be processed")


MC_TTL_SECONDS = 3600


@app.on_event("startup")
async def _mc_indexes():
    try:
        await db.mc_jobs.create_index("created_at", expireAfterSeconds=MC_TTL_SECONDS)
        await db.mc_jobs.create_index("job_id", unique=True)
        # Sparse index: only indexes docs that have a non-null share_token (Mongo skips
        # nulls with `sparse`), so revoked/unshared plans don't crowd the index.
        await db.scenarios.create_index("share_token", unique=True, sparse=True)
    except Exception:
        logging.exception("failed creating mc_jobs indexes")


@api_router.post("/montecarlo")
@limiter.limit("30/minute")
async def start_montecarlo(request: Request, req: MonteCarloRequest,
                           owner_token: str = Depends(require_session)):
    _validate_config(req.config)
    job_id = str(uuid.uuid4())
    await db.mc_jobs.insert_one({
        "job_id": job_id, "owner_token": owner_token,
        "status": "running", "result": None, "error": None,
        "created_at": datetime.now(timezone.utc),
    })

    assets = {k: v.model_dump() for k, v in req.assets.items()} if req.assets else None
    shock = req.shock.model_dump() if req.shock else None
    inflation = req.inflation.model_dump() if req.inflation else None
    correlation = req.correlation.model_dump() if req.correlation else None
    guardrail = req.guardrail.model_dump() if req.guardrail else None

    async def worker():
        try:
            res = await asyncio.to_thread(run_montecarlo, req.config, req.n_trials, assets, shock,
                                          req.seed, inflation, correlation,
                                          req.engine, req.anchor_to_plan, guardrail)
            await db.mc_jobs.update_one({"job_id": job_id}, {"$set": {"status": "done", "result": res}})
        except Exception:
            logging.exception("montecarlo failed")
            await db.mc_jobs.update_one({"job_id": job_id}, {"$set": {"status": "error", "error": "Simulation failed"}})

    asyncio.create_task(worker())
    return {"job_id": job_id, "status": "running"}


@api_router.get("/montecarlo/{job_id}")
async def montecarlo_status(job_id: str, owner_token: str = Depends(require_session)):
    if not UUID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    # scope the read to the session that started the job (BOLA guard)
    job = await db.mc_jobs.find_one(
        {"job_id": job_id, "owner_token": owner_token}, {"_id": 0, "created_at": 0, "owner_token": 0}
    )
    if not job:
        raise HTTPException(status_code=404, detail="Monte Carlo job not found")
    return job


@api_router.post("/scenarios", response_model=Scenario)
@limiter.limit("30/minute")
async def create_scenario(request: Request, req: ScenarioCreate,
                          owner_token: str = Depends(require_session)):
    _validate_config(req.config)
    sc = Scenario(name=req.name, config=req.config, owner_token=owner_token)
    await db.scenarios.insert_one(sc.model_dump())
    return sc


@api_router.get("/scenarios", response_model=List[Scenario])
async def list_scenarios(owner_token: str = Depends(require_session)):
    docs = await db.scenarios.find(
        {"owner_token": owner_token}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    return docs


@api_router.get("/scenarios/{sid}", response_model=Scenario)
async def get_scenario(sid: str, owner_token: str = Depends(require_session)):
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    doc = await db.scenarios.find_one({"id": sid, "owner_token": owner_token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return doc


@api_router.delete("/scenarios/{sid}")
async def delete_scenario(sid: str, owner_token: str = Depends(require_session)):
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    res = await db.scenarios.delete_one({"id": sid, "owner_token": owner_token})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"deleted": sid}


# ---------- Read-only shareable links ----------
# The owner mints an opaque `share_token` on their plan; anyone with the URL can view
# the config read-only via /api/scenarios/share/{token}. The token has enough entropy
# (16 secure random bytes → 22-char url-safe) that guessing is infeasible. The public
# endpoint intentionally does not use / expose the owner session token or the internal
# scenario id — it's a strictly read-only view of {name, config, created_at}.

@api_router.post("/scenarios/{sid}/share")
@limiter.limit("30/minute")
async def enable_scenario_share(request: Request, sid: str,
                                owner_token: str = Depends(require_session)):
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    doc = await db.scenarios.find_one({"id": sid, "owner_token": owner_token}, {"_id": 0, "share_token": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    token = doc.get("share_token")
    if not token:
        token = secrets.token_urlsafe(16)  # ~22 chars, 128-bit entropy
        await db.scenarios.update_one({"id": sid, "owner_token": owner_token},
                                      {"$set": {"share_token": token}})
    return {"share_token": token}


@api_router.delete("/scenarios/{sid}/share")
@limiter.limit("30/minute")
async def revoke_scenario_share(request: Request, sid: str,
                                owner_token: str = Depends(require_session)):
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    res = await db.scenarios.update_one(
        {"id": sid, "owner_token": owner_token},
        {"$set": {"share_token": None}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"revoked": sid}


@api_router.get("/scenarios/share/{share_token}", response_model=SharedScenario)
@limiter.limit("60/minute")
async def get_shared_scenario(request: Request, share_token: str):
    # No session token required — the share_token IS the capability. Validate its shape
    # to keep obvious garbage / probing out of the DB query path.
    if not SHARE_TOKEN_RE.match(share_token):
        raise HTTPException(status_code=400, detail="Invalid share token")
    doc = await db.scenarios.find_one(
        {"share_token": share_token},
        {"_id": 0, "name": 1, "config": 1, "created_at": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Shared scenario not found")
    return doc


@api_router.post("/insights")
@limiter.limit("10/minute")
async def insights(request: Request, req: InsightRequest):
    system = (
        "You are a meticulous CFP-level retirement and tax strategist. You analyze "
        "Roth conversion plans. Always respect the strict separation of ORDINARY income "
        "(wages, IRA distributions, Roth conversions) from PREFERENTIAL income (qualified "
        "dividends + long-term capital gains, taxed at 0/15/20% stacked on top of ordinary). "
        "CURRENT TAX LAW (assume this — do NOT warn about a TCJA sunset): the One Big Beautiful "
        "Bill Act of 2025 (OBBBA) made the TCJA individual tax brackets (10/12/22/24/32/35/37%) "
        "PERMANENT and kept them inflation-indexed (chained CPI), and made the larger TCJA standard "
        "deduction permanent and indexed. Brackets are NOT reverting to pre-2017 rates in 2026; treat "
        "today's bracket structure as the ongoing baseline (this is why the plan indexes brackets forward). "
        "FORMAT (important): keep the ENTIRE response under ~180 words. Open with ONE short "
        "headline sentence, then 4-5 crisp single-line bullets covering bracket-filling, IRMAA, "
        "NIIT, RMDs and survivor (filing-status) impact. Do NOT use markdown tables, headers, or "
        "multi-section essays. Reference the actual dollar figures. End with one line inviting the "
        "user to ask a follow-up question. "
        "If a 'monte_carlo' block is present, make the FIRST bullet the probability of success and how "
        "many points of resilience the Roth conversions add (success_with vs success_without), e.g. "
        "'93% success rate — converting adds ~4 points of resilience.' "
        "If a 'net_to_family' block is present, include one LEGACY bullet that states BOTH the extra "
        "inheritance and the heir tax saved, e.g. 'Conversions leave heirs ~$18.7M more and cut their "
        "inherited-IRA income tax by ~$3.6M, mostly tax-free' (use net_to_family.inheritance_delta, "
        "net_to_family.heir_ira_tax_saved and tax_free_roth_with). "
        "Do not give legal disclaimers."
    )
    prompt = (
        "Analyze this retirement & Roth conversion plan and explain the strategy and "
        "trade-offs.\n\nPlan summary (JSON):\n" + json.dumps(req.summary, indent=2)
    )
    stream = await _gemini_stream(_resolve_gemini_key(req.api_key), system, prompt, max_tokens=800)

    return StreamingResponse(
        stream,
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_router.post("/insights/chat")
@limiter.limit("30/minute")
async def insights_chat(request: Request, req: InsightChatRequest):
    system = (
        "You are a meticulous CFP-level retirement and tax strategist answering a client's "
        "follow-up questions about THEIR specific Roth conversion plan. Respect the strict "
        "separation of ORDINARY income (wages, IRA distributions, Roth conversions) from "
        "PREFERENTIAL income (qualified dividends + long-term capital gains, taxed at 0/15/20% "
        "stacked on top of ordinary). "
        "CURRENT TAX LAW (assume this — do NOT warn about a TCJA sunset): the One Big Beautiful Bill "
        "Act of 2025 (OBBBA) made the TCJA individual brackets (10/12/22/24/32/35/37%) PERMANENT and "
        "kept them inflation-indexed (chained CPI), and made the larger standard deduction permanent "
        "and indexed. Brackets are NOT reverting to pre-2017 rates in 2026. "
        "Always reference the actual numbers from the plan summary. "
        "Be conversational, direct and concise — 2-4 short paragraphs or a few bullets. Stay on "
        "the topic of this retirement plan. Do not give legal disclaimers."
    )
    transcript = ""
    for t in req.history:
        who = "Client" if t.role == "user" else "You (advisor)"
        transcript += f"{who}: {t.content}\n\n"
    prompt = (
        "Client's retirement & Roth conversion plan summary (JSON):\n"
        + json.dumps(req.summary, indent=2)
        + "\n\n"
        + (f"Earlier in this conversation:\n{transcript}\n" if transcript else "")
        + "Client's question: " + req.message
    )
    stream = await _gemini_stream(_resolve_gemini_key(req.api_key), system, prompt, max_tokens=1000)

    return StreamingResponse(
        stream,
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app.include_router(api_router)

# ---------- CORS (P3: explicit allowlist) ----------
_default_origins = "https://roth-retirement-tool.preview.emergentagent.com,http://localhost:3000"
_allow_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()]
# When credentials=True the browser requires a specific origin, not '*'. If '*' is explicitly
# configured we drop credentials to keep the browser accepting the response.
_allow_credentials = "*" not in _allow_origins
app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_allow_origins,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Session-Token"],
)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
