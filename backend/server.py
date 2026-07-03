from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request
from fastapi.responses import StreamingResponse
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
import logging
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
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _bad_request(msg: str):
    """Uniform 400 for size / range / shape violations."""
    raise HTTPException(status_code=400, detail=msg)


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


# ---------- Session scoping (SEC-002) ----------
async def require_session(x_session_token: Optional[str] = Header(default=None)) -> str:
    """Every scenario read/write must present an anonymous per-browser session token
    (a UUIDv4 minted by the frontend and kept in localStorage). This scopes saved
    plans so one visitor cannot read or delete another's data."""
    if not x_session_token or not UUID_RE.match(x_session_token):
        raise HTTPException(status_code=401, detail="Missing or invalid X-Session-Token")
    return x_session_token.lower()


# ---------- Rate limiting (SEC-001 hardening) ----------
def _client_ip(request: Request) -> str:
    """Use X-Forwarded-For (set by ingress) so limits are per real client, not per ingress IP."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(key_func=_client_ip, default_limits=["300/minute"])

app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ---------- Security headers (P3 hardening) ----------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        return resp


app.add_middleware(SecurityHeadersMiddleware)

api_router = APIRouter(prefix="/api")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")


# ---------- Models ----------
class YearTaxRequest(BaseModel):
    inputs: Dict[str, Any]


class OptimizeRequest(BaseModel):
    inputs: Dict[str, Any]
    target_rate: float = 0.24
    max_conversion: float = 0.0


class ProjectionRequest(BaseModel):
    config: Dict[str, Any]


class Scenario(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    config: Dict[str, Any]
    owner_token: Optional[str] = None       # UUIDv4 stamp of the browser session that owns this plan
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


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


class ChatTurn(BaseModel):
    role: str
    content: str

    @field_validator("content")
    @classmethod
    def _content_bounds(cls, v: str) -> str:
        if len(v) > 4000:
            raise ValueError("chat content capped at 4000 chars per turn")
        return v


class InsightChatRequest(BaseModel):
    summary: Dict[str, Any]
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
    mean: float
    vol: float
    weight: float


class ShockSpec(BaseModel):
    enabled: bool = False
    rate: float = -0.15
    years: int = 2


class InflationSpec(BaseModel):
    enabled: bool = True
    mean: float = 0.03
    vol: float = 0.015     # 1.5% inflation vol ≈ post-1990 US CPI stdev


class CorrelationSpec(BaseModel):
    """Gaussian-copula pairwise correlations across stocks/bonds/cash/inflation draws.
    Defaults ≈ long-run US annual history. Repaired to nearest PSD matrix server-side."""
    enabled: bool = False
    stocks_bonds: float = 0.15
    stocks_cash: float = 0.0
    bonds_cash: float = 0.20
    stocks_inflation: float = -0.20
    bonds_inflation: float = -0.30
    cash_inflation: float = 0.55

    @field_validator("stocks_bonds", "stocks_cash", "bonds_cash",
                     "stocks_inflation", "bonds_inflation", "cash_inflation")
    @classmethod
    def _corr_bounds(cls, v):
        if v < -0.99 or v > 0.99:
            raise ValueError("correlations must be within [-0.99, 0.99]")
        return v


class MonteCarloRequest(BaseModel):
    config: Dict[str, Any]
    n_trials: int = 500
    assets: Optional[Dict[str, AssetClass]] = None
    shock: Optional[ShockSpec] = None
    inflation: Optional[InflationSpec] = None
    correlation: Optional[CorrelationSpec] = None
    seed: Optional[int] = None

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


@api_router.get("/defaults")
async def get_defaults():
    return DEFAULT_SCENARIO


@api_router.get("/states")
async def get_states():
    return STATES


@api_router.post("/tax/year")
async def tax_year(req: YearTaxRequest):
    return compute_year_tax(req.inputs)


@api_router.post("/tax/optimize")
async def tax_optimize(req: OptimizeRequest):
    return optimize_conversion(req.inputs, req.target_rate, req.max_conversion)


@api_router.post("/projection")
@limiter.limit("30/minute")
async def projection(request: Request, req: ProjectionRequest):
    _validate_config(req.config)
    try:
        return run_projection(req.config)
    except Exception:
        logging.exception("projection failed")
        raise HTTPException(status_code=400, detail="Projection request could not be processed")


@api_router.post("/sweep")
@limiter.limit("15/minute")
async def sweep(request: Request, req: ProjectionRequest):
    _validate_config(req.config)
    try:
        return sweep_brackets(req.config)
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
        return strategy_sweep(
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
        return sweep_ss_claims(req.config, req.ages)
    except Exception:
        logging.exception("ss_optimizer failed")
        raise HTTPException(status_code=400, detail="Social Security optimizer request could not be processed")


MC_TTL_SECONDS = 3600


@app.on_event("startup")
async def _mc_indexes():
    try:
        await db.mc_jobs.create_index("created_at", expireAfterSeconds=MC_TTL_SECONDS)
        await db.mc_jobs.create_index("job_id", unique=True)
    except Exception:
        logging.exception("failed creating mc_jobs indexes")


@api_router.post("/montecarlo")
@limiter.limit("30/minute")
async def start_montecarlo(request: Request, req: MonteCarloRequest):
    _validate_config(req.config)
    job_id = str(uuid.uuid4())
    await db.mc_jobs.insert_one({
        "job_id": job_id, "status": "running", "result": None, "error": None,
        "created_at": datetime.now(timezone.utc),
    })

    assets = {k: v.model_dump() for k, v in req.assets.items()} if req.assets else None
    shock = req.shock.model_dump() if req.shock else None
    inflation = req.inflation.model_dump() if req.inflation else None
    correlation = req.correlation.model_dump() if req.correlation else None

    async def worker():
        try:
            res = await asyncio.to_thread(run_montecarlo, req.config, req.n_trials, assets, shock,
                                          req.seed, inflation, correlation)
            await db.mc_jobs.update_one({"job_id": job_id}, {"$set": {"status": "done", "result": res}})
        except Exception:
            logging.exception("montecarlo failed")
            await db.mc_jobs.update_one({"job_id": job_id}, {"$set": {"status": "error", "error": "Simulation failed"}})

    asyncio.create_task(worker())
    return {"job_id": job_id, "status": "running"}


@api_router.get("/montecarlo/{job_id}")
async def montecarlo_status(job_id: str):
    job = await db.mc_jobs.find_one({"job_id": job_id}, {"_id": 0, "created_at": 0})
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


@api_router.post("/insights")
@limiter.limit("10/minute")
async def insights(request: Request, req: InsightRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

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
    user_msg = UserMessage(text=prompt)

    async def gen():
        try:
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"insights-{uuid.uuid4()}",
                system_message=system,
            ).with_model("anthropic", "claude-sonnet-4-6").with_params(max_tokens=450)
            async for ev in chat.stream_message(user_msg):
                if isinstance(ev, TextDelta):
                    yield ev.content
                elif isinstance(ev, StreamDone):
                    break
        except Exception:
            logging.exception("insight stream failed")
            yield "\n[Sorry, insights are temporarily unavailable. Please try again.]"

    return StreamingResponse(
        gen(),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_router.post("/insights/chat")
@limiter.limit("30/minute")
async def insights_chat(request: Request, req: InsightChatRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

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
    user_msg = UserMessage(text=prompt)

    async def gen():
        try:
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"insights-chat-{uuid.uuid4()}",
                system_message=system,
            ).with_model("anthropic", "claude-sonnet-4-6").with_params(max_tokens=550)
            async for ev in chat.stream_message(user_msg):
                if isinstance(ev, TextDelta):
                    yield ev.content
                elif isinstance(ev, StreamDone):
                    break
        except Exception:
            logging.exception("insight chat stream failed")
            yield "\n[Sorry, I couldn't process that question right now. Please try again.]"

    return StreamingResponse(
        gen(),
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
    allow_headers=["Content-Type", "Authorization", "X-Session-Token", "X-Forwarded-For"],
)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
