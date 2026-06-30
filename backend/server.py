from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import uuid
from datetime import datetime, timezone

from tax_engine import compute_year_tax, optimize_conversion
from projection import run_projection, sweep_brackets
from montecarlo import run_montecarlo
from defaults import DEFAULT_SCENARIO
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
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
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ScenarioCreate(BaseModel):
    name: str
    config: Dict[str, Any]


class InsightRequest(BaseModel):
    summary: Dict[str, Any]


class ChatTurn(BaseModel):
    role: str
    content: str


class InsightChatRequest(BaseModel):
    summary: Dict[str, Any]
    history: List[ChatTurn] = []
    message: str


class AssetClass(BaseModel):
    mean: float
    vol: float
    weight: float


class ShockSpec(BaseModel):
    enabled: bool = False
    rate: float = -0.15
    years: int = 2


class MonteCarloRequest(BaseModel):
    config: Dict[str, Any]
    n_trials: int = 500
    assets: Optional[Dict[str, AssetClass]] = None
    shock: Optional[ShockSpec] = None
    seed: Optional[int] = None


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Retirement & Roth Conversion Optimizer API"}


@api_router.get("/defaults")
async def get_defaults():
    return DEFAULT_SCENARIO


@api_router.post("/tax/year")
async def tax_year(req: YearTaxRequest):
    return compute_year_tax(req.inputs)


@api_router.post("/tax/optimize")
async def tax_optimize(req: OptimizeRequest):
    return optimize_conversion(req.inputs, req.target_rate, req.max_conversion)


@api_router.post("/projection")
async def projection(req: ProjectionRequest):
    try:
        return run_projection(req.config)
    except Exception as e:
        logging.exception("projection failed")
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post("/sweep")
async def sweep(req: ProjectionRequest):
    try:
        return sweep_brackets(req.config)
    except Exception as e:
        logging.exception("sweep failed")
        raise HTTPException(status_code=400, detail=str(e))


MC_TTL_SECONDS = 3600


@app.on_event("startup")
async def _mc_indexes():
    try:
        await db.mc_jobs.create_index("created_at", expireAfterSeconds=MC_TTL_SECONDS)
        await db.mc_jobs.create_index("job_id", unique=True)
    except Exception:
        logging.exception("failed creating mc_jobs indexes")


@api_router.post("/montecarlo")
async def start_montecarlo(req: MonteCarloRequest):
    job_id = str(uuid.uuid4())
    await db.mc_jobs.insert_one({
        "job_id": job_id, "status": "running", "result": None, "error": None,
        "created_at": datetime.now(timezone.utc),
    })

    assets = {k: v.model_dump() for k, v in req.assets.items()} if req.assets else None
    shock = req.shock.model_dump() if req.shock else None

    async def worker():
        try:
            res = await asyncio.to_thread(run_montecarlo, req.config, req.n_trials, assets, shock, req.seed)
            await db.mc_jobs.update_one({"job_id": job_id}, {"$set": {"status": "done", "result": res}})
        except Exception as e:
            logging.exception("montecarlo failed")
            await db.mc_jobs.update_one({"job_id": job_id}, {"$set": {"status": "error", "error": str(e)}})

    asyncio.create_task(worker())
    return {"job_id": job_id, "status": "running"}


@api_router.get("/montecarlo/{job_id}")
async def montecarlo_status(job_id: str):
    job = await db.mc_jobs.find_one({"job_id": job_id}, {"_id": 0, "created_at": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Monte Carlo job not found")
    return job


@api_router.post("/scenarios", response_model=Scenario)
async def create_scenario(req: ScenarioCreate):
    sc = Scenario(name=req.name, config=req.config)
    await db.scenarios.insert_one(sc.model_dump())
    return sc


@api_router.get("/scenarios", response_model=List[Scenario])
async def list_scenarios():
    docs = await db.scenarios.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.get("/scenarios/{sid}", response_model=Scenario)
async def get_scenario(sid: str):
    doc = await db.scenarios.find_one({"id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return doc


@api_router.delete("/scenarios/{sid}")
async def delete_scenario(sid: str):
    await db.scenarios.delete_one({"id": sid})
    return {"deleted": sid}


@api_router.post("/insights")
async def insights(req: InsightRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

    system = (
        "You are a meticulous CFP-level retirement and tax strategist. You analyze "
        "Roth conversion plans. Always respect the strict separation of ORDINARY income "
        "(wages, IRA distributions, Roth conversions) from PREFERENTIAL income (qualified "
        "dividends + long-term capital gains, taxed at 0/15/20% stacked on top of ordinary). "
        "FORMAT (important): keep the ENTIRE response under ~180 words. Open with ONE short "
        "headline sentence, then 4-5 crisp single-line bullets covering bracket-filling, IRMAA, "
        "NIIT, RMDs and survivor (filing-status) impact. Do NOT use markdown tables, headers, or "
        "multi-section essays. Reference the actual dollar figures. End with one line inviting the "
        "user to ask a follow-up question. "
        "If a 'monte_carlo' block is present, make the FIRST bullet the probability of success and how "
        "many points of resilience the Roth conversions add (success_with vs success_without), e.g. "
        "'93% success rate — converting adds ~4 points of resilience.' "
        "If a 'net_to_family' block is present, include one legacy bullet, e.g. 'Conversions leave heirs "
        "~$14.3M more, mostly tax-free' (use net_to_family.delta and tax_free_roth_with). "
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
        except Exception as e:
            logging.exception("insight stream failed")
            yield f"\n[Error generating insights: {e}]"

    return StreamingResponse(
        gen(),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_router.post("/insights/chat")
async def insights_chat(req: InsightChatRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

    system = (
        "You are a meticulous CFP-level retirement and tax strategist answering a client's "
        "follow-up questions about THEIR specific Roth conversion plan. Respect the strict "
        "separation of ORDINARY income (wages, IRA distributions, Roth conversions) from "
        "PREFERENTIAL income (qualified dividends + long-term capital gains, taxed at 0/15/20% "
        "stacked on top of ordinary). Always reference the actual numbers from the plan summary. "
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
        except Exception as e:
            logging.exception("insight chat stream failed")
            yield f"\n[Error answering that: {e}]"

    return StreamingResponse(
        gen(),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
