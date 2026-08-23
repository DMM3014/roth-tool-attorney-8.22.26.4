"""Audit Mode — compare a third-party planner's projection against the review plan.

Endpoints:
  POST /api/audit/compare              — run the comparison (diff + outcomes + waterfall)
  PUT  /api/audit/{workspace_id}       — persist the planner_cfg on a workspace
  GET  /api/audit/{workspace_id}       — reload the persisted planner_cfg
"""
# NOTE: no `from __future__ import annotations` — slowapi + PEP 563 breaks
# FastAPI body-model detection on `@limiter.limit()`-decorated endpoints.
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from deps import UUID_RE, db, limiter, require_advisor, require_advisor_or_share, require_session, validate_config

router = APIRouter(prefix="/api/audit")


class AuditCompareRequest(BaseModel):
    review_config: Dict[str, Any]
    planner_config: Dict[str, Any]


class PlannerCfgBody(BaseModel):
    planner_config: Dict[str, Any]
    label: Optional[str] = Field(None, max_length=200)


@router.post("/compare")
@limiter.limit("10/minute")
async def audit_compare_route(request: Request, req: AuditCompareRequest,
                              _gate: None = Depends(require_advisor_or_share)):
    validate_config(req.review_config)
    validate_config(req.planner_config)
    try:
        from projection import audit_compare
        return await asyncio.to_thread(audit_compare, req.review_config, req.planner_config)
    except Exception:
        logging.exception("audit compare failed")
        raise HTTPException(status_code=400, detail="Audit comparison could not be processed")


@router.put("/{workspace_id}")
@limiter.limit("30/minute")
async def save_planner_cfg(request: Request, workspace_id: str, req: PlannerCfgBody,
                           owner_token: str = Depends(require_session),
                           _adv: None = Depends(require_advisor)):
    if not UUID_RE.match(workspace_id):
        raise HTTPException(status_code=400, detail="Invalid workspace id")
    validate_config(req.planner_config)
    doc = await db.workspaces.find_one_and_update(
        {"id": workspace_id, "owner_token": owner_token},
        {"$set": {"audit_planner_config": req.planner_config,
                  "audit_planner_label": req.label,
                  "audit_updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"ok": True, "workspace_id": workspace_id}


@router.get("/{workspace_id}")
async def load_planner_cfg(workspace_id: str,
                           owner_token: str = Depends(require_session),
                           _adv: None = Depends(require_advisor)):
    if not UUID_RE.match(workspace_id):
        raise HTTPException(status_code=400, detail="Invalid workspace id")
    doc = await db.workspaces.find_one(
        {"id": workspace_id, "owner_token": owner_token},
        {"_id": 0, "audit_planner_config": 1, "audit_planner_label": 1, "audit_updated_at": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {
        "planner_config": doc.get("audit_planner_config"),
        "label": doc.get("audit_planner_label"),
        "updated_at": doc.get("audit_updated_at"),
    }
