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
from defaults import DEFAULT_SCENARIO

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
        "Be concrete, reference the numbers given, and give 3-5 crisp, actionable insights "
        "about bracket-filling, IRMAA, NIIT, RMDs, and survivor (filing-status) impact. "
        "Use short paragraphs and bullet points. Do not give legal disclaimers."
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
            ).with_model("anthropic", "claude-sonnet-4-6")
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
