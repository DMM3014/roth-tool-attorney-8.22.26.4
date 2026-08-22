"""AI Insights streaming endpoints (BYOK Gemini > default Fable > server Gemini)."""
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from deps import insights_stream, limiter, require_advisor_or_share
from models import InsightChatRequest, InsightRequest

router = APIRouter(prefix="/api")


@router.post("/insights")
@limiter.limit("10/minute")
async def insights(request: Request, req: InsightRequest, _gate: None = Depends(require_advisor_or_share)):
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
    stream = await insights_stream(req.api_key, system, prompt, max_tokens=800)
    return StreamingResponse(
        stream, media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/insights/chat")
@limiter.limit("30/minute")
async def insights_chat(request: Request, req: InsightChatRequest, _gate: None = Depends(require_advisor_or_share)):
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
    stream = await insights_stream(req.api_key, system, prompt, max_tokens=1000)
    return StreamingResponse(
        stream, media_type="text/plain",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
