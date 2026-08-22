"""Client-workspace CRUD (named folders that group scenarios)."""
# NOTE: no `from __future__ import annotations` — slowapi + PEP 563 breaks
# FastAPI body-model detection on `@limiter.limit()`-decorated endpoints.
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from deps import UUID_RE, db, limiter, require_advisor, require_session
from models import Workspace, WorkspaceCreate, WorkspaceUpdate

router = APIRouter(prefix="/api")


@router.post("/workspaces", response_model=Workspace)
@limiter.limit("30/minute")
async def create_workspace(request: Request, req: WorkspaceCreate,
                           owner_token: str = Depends(require_session),
                           _adv: None = Depends(require_advisor)):
    ws = Workspace(name=req.name, notes=req.notes, owner_token=owner_token)
    await db.workspaces.insert_one(ws.model_dump())
    return ws


@router.get("/workspaces")
async def list_workspaces(owner_token: str = Depends(require_session),
                          _adv: None = Depends(require_advisor)):
    """List the caller's workspaces plus a per-workspace `scenario_count` and an
    `unfiled` bucket count for scenarios not filed anywhere."""
    docs = await db.workspaces.find(
        {"owner_token": owner_token}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    counts: Dict[Optional[str], int] = {}
    async for row in db.scenarios.aggregate([
        {"$match": {"owner_token": owner_token}},
        {"$group": {"_id": "$workspace_id", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = row["n"]
    for d in docs:
        d["scenario_count"] = int(counts.get(d["id"], 0))
    unfiled = int(counts.get(None, 0))
    return {"workspaces": docs, "unfiled_count": unfiled}


@router.patch("/workspaces/{wid}", response_model=Workspace)
@limiter.limit("60/minute")
async def update_workspace(request: Request, wid: str, req: WorkspaceUpdate,
                           owner_token: str = Depends(require_session),
                           _adv: None = Depends(require_advisor)):
    if not UUID_RE.match(wid):
        raise HTTPException(status_code=400, detail="Invalid workspace id")
    updates: Dict[str, Any] = {}
    if req.name is not None:
        updates["name"] = req.name
    if req.notes is not None:
        updates["notes"] = req.notes
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    doc = await db.workspaces.find_one_and_update(
        {"id": wid, "owner_token": owner_token},
        {"$set": updates},
        projection={"_id": 0},
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return doc


@router.delete("/workspaces/{wid}")
@limiter.limit("30/minute")
async def delete_workspace(request: Request, wid: str,
                           owner_token: str = Depends(require_session),
                           _adv: None = Depends(require_advisor)):
    """Delete a workspace. Its scenarios are unfiled (workspace_id → null) — the
    plans themselves survive so switching or renaming folders never loses data."""
    if not UUID_RE.match(wid):
        raise HTTPException(status_code=400, detail="Invalid workspace id")
    res = await db.workspaces.delete_one({"id": wid, "owner_token": owner_token})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Workspace not found")
    upd = await db.scenarios.update_many(
        {"owner_token": owner_token, "workspace_id": wid},
        {"$set": {"workspace_id": None}},
    )
    return {"deleted": wid, "unfiled_scenarios": int(upd.modified_count)}
