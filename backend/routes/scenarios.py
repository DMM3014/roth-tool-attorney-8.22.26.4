"""Session-scoped scenario CRUD + read-only share-link surface."""
# NOTE: no `from __future__ import annotations` — slowapi + PEP 563 breaks
# FastAPI body-model detection on `@limiter.limit()`-decorated endpoints. See
# routes/planning.py for the full explanation.
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from deps import (
    SHARE_TOKEN_RE, UUID_RE, db, limiter, require_advisor, require_session,
    validate_config,
)
from models import Scenario, ScenarioCreate, ScenarioMove, SharedScenario

router = APIRouter(prefix="/api")


@router.post("/scenarios", response_model=Scenario)
@limiter.limit("30/minute")
async def create_scenario(request: Request, req: ScenarioCreate,
                          owner_token: str = Depends(require_session),
                          _adv: None = Depends(require_advisor)):
    validate_config(req.config)
    # If a workspace_id is supplied, make sure the caller actually owns it so
    # visitors cannot stash plans inside someone else's folder.
    if req.workspace_id is not None:
        owned = await db.workspaces.find_one(
            {"id": req.workspace_id, "owner_token": owner_token}, {"_id": 1}
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Workspace not found")
    sc = Scenario(name=req.name, config=req.config, owner_token=owner_token,
                  workspace_id=req.workspace_id)
    await db.scenarios.insert_one(sc.model_dump())
    return sc


@router.get("/scenarios", response_model=List[Scenario])
async def list_scenarios(owner_token: str = Depends(require_session),
                         workspace_id: Optional[str] = None,
                         _adv: None = Depends(require_advisor)):
    """List saved scenarios for the current session.

    `workspace_id` optionally narrows the list to a single client folder. Pass the
    sentinel `"unfiled"` to fetch plans that have no workspace_id set.
    """
    q: Dict[str, Any] = {"owner_token": owner_token}
    if workspace_id is not None:
        if workspace_id == "unfiled":
            q["$or"] = [{"workspace_id": None}, {"workspace_id": {"$exists": False}}]
        else:
            if not UUID_RE.match(workspace_id):
                raise HTTPException(status_code=400, detail="Invalid workspace_id")
            q["workspace_id"] = workspace_id
    docs = await db.scenarios.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@router.get("/scenarios/{sid}", response_model=Scenario)
async def get_scenario(sid: str, owner_token: str = Depends(require_session),
                       _adv: None = Depends(require_advisor)):
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    doc = await db.scenarios.find_one({"id": sid, "owner_token": owner_token}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return doc


@router.delete("/scenarios/{sid}")
async def delete_scenario(sid: str, owner_token: str = Depends(require_session),
                          _adv: None = Depends(require_advisor)):
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    res = await db.scenarios.delete_one({"id": sid, "owner_token": owner_token})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"deleted": sid}


@router.patch("/scenarios/{sid}/workspace", response_model=Scenario)
@limiter.limit("60/minute")
async def move_scenario(request: Request, sid: str, req: ScenarioMove,
                        owner_token: str = Depends(require_session),
                        _adv: None = Depends(require_advisor)):
    """Move a scenario into another workspace, or set workspace_id=null to unfile it.
    Same ownership rules apply to both the scenario AND (if provided) the target workspace."""
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    if req.workspace_id is not None:
        owned = await db.workspaces.find_one(
            {"id": req.workspace_id, "owner_token": owner_token}, {"_id": 1}
        )
        if not owned:
            raise HTTPException(status_code=404, detail="Workspace not found")
    res = await db.scenarios.find_one_and_update(
        {"id": sid, "owner_token": owner_token},
        {"$set": {"workspace_id": req.workspace_id}},
        projection={"_id": 0},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return res


# ---------- Read-only shareable links ----------
# The owner mints an opaque `share_token` on their plan; anyone with the URL can view
# the config read-only via /api/scenarios/share/{token}. Token has 128-bit entropy;
# the public endpoint never returns owner_token or the internal scenario id.

@router.post("/scenarios/{sid}/share")
@limiter.limit("30/minute")
async def enable_scenario_share(request: Request, sid: str,
                                owner_token: str = Depends(require_session),
                                _adv: None = Depends(require_advisor)):
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    doc = await db.scenarios.find_one({"id": sid, "owner_token": owner_token},
                                       {"_id": 0, "share_token": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    token = doc.get("share_token")
    if not token:
        token = secrets.token_urlsafe(16)  # ~22 chars, 128-bit entropy
        await db.scenarios.update_one({"id": sid, "owner_token": owner_token},
                                      {"$set": {"share_token": token}})
    return {"share_token": token}


@router.delete("/scenarios/{sid}/share")
@limiter.limit("30/minute")
async def revoke_scenario_share(request: Request, sid: str,
                                owner_token: str = Depends(require_session),
                                _adv: None = Depends(require_advisor)):
    if not UUID_RE.match(sid):
        raise HTTPException(status_code=400, detail="Invalid scenario id")
    res = await db.scenarios.update_one(
        {"id": sid, "owner_token": owner_token},
        {"$set": {"share_token": None}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"revoked": sid}


@router.get("/scenarios/share/{share_token}", response_model=SharedScenario)
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
