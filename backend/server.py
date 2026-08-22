"""FastAPI app bootstrap.

Route logic lives in `backend/routes/*.py` — see:
  - routes/auth.py         (master PIN + license login + admin CRUD)
  - routes/scenarios.py    (scenarios CRUD + share links)
  - routes/workspaces.py   (client-workspace CRUD)
  - routes/planning.py     (tax, projection, sweeps, strategy, SS optimizer, Monte Carlo)
  - routes/insights.py     (AI Insights streaming)

Shared foundation (DB handle, rate limiter, auth deps, LLM stream helpers,
security constants) lives in `deps.py`. All Pydantic request/response shapes
live in `models.py`. This file is intentionally small — its job is app-level
wiring and lifecycle events only.

Test fixtures import `app`, `require_advisor`, and `require_advisor_or_share`
from this module (see `tests/conftest.py`); those names are explicitly re-exported.
"""
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pymongo.errors import OperationFailure
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from auth_licenses import (
    ensure_licenses_indexes,
    ensure_master_seeded,
)
from auth_pin import seed_pin_if_missing
from deps import (
    SecurityHeadersMiddleware, db, limiter, mongo_client,
    # Re-exported for tests/conftest.py — DO NOT remove these imports.
    require_advisor, require_advisor_or_share,  # noqa: F401
)
from routes.auth import router as auth_router
from routes.insights import router as insights_router
from routes.planning import router as planning_router
from routes.scenarios import router as scenarios_router
from routes.workspaces import router as workspaces_router


# --------------------------------------------------------------------------
# App instance + middleware
# --------------------------------------------------------------------------
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


@app.exception_handler(RequestValidationError)
async def _validation_handler(request, exc: RequestValidationError):
    """Return a clean 422 that never reflects raw request input. Non-finite floats
    (NaN/Inf) in the offending body otherwise break the default handler's JSON
    serializer (500) AND echo attacker-supplied values back (SEC-003)."""
    errors = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")}
              for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})

# CORS — explicit allowlist (P3 hardening). Preview + local dev by default; override with env.
_default_origins = ("https://roth-retirement-tool.preview.emergentagent.com,"
                    "https://roth-retirement-tool.emergent.host,http://localhost:3000")
_allow_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()]
# `*` + credentials=True is invalid per spec — drop credentials if wildcard is explicit.
_allow_credentials = "*" not in _allow_origins
app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_allow_origins,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Session-Token", "X-Share-Token"],
)


# --------------------------------------------------------------------------
# Routers
# --------------------------------------------------------------------------
app.include_router(auth_router)
app.include_router(scenarios_router)
app.include_router(workspaces_router)
app.include_router(planning_router)
app.include_router(insights_router)


# --------------------------------------------------------------------------
# Root endpoints (mounted on /api by their nature)
# --------------------------------------------------------------------------
@app.get("/api/")
async def root():
    return {"message": "Retirement & Roth Conversion Optimizer API"}


# Kubernetes liveness/readiness probe. Emergent's ingress polls unprefixed
# `/health` for pod health. Cheap and DB-free so it never times out under load.
@app.get("/health", include_in_schema=False)
@app.get("/healthz", include_in_schema=False)
async def health_check():
    return {"status": "ok"}


# Public downloads (static assets — no auth). Serve the Excel VBA fix macro
# so advisors can download the .bas file directly from the deployed app.
_DOWNLOADS_DIR = Path(__file__).resolve().parent / "static" / "downloads"

@app.get("/api/downloads/{name}")
async def download_asset(name: str):
    # Restrict to a hard-coded allowlist so this endpoint can never serve
    # anything outside the intended static bundle.
    allow = {"EstatePlanFixes.bas"}
    if name not in allow:
        raise HTTPException(status_code=404, detail="Not found")
    path = _DOWNLOADS_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        path,
        media_type="text/plain; charset=utf-8",
        filename=name,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# --------------------------------------------------------------------------
# Startup — indexes + PIN seeding
# --------------------------------------------------------------------------
MC_TTL_SECONDS = 3600


@app.on_event("startup")
async def _startup_indexes_and_seeds():
    try:
        await db.mc_jobs.create_index("created_at", expireAfterSeconds=MC_TTL_SECONDS)
        await db.mc_jobs.create_index("job_id", unique=True)
        # Unique index on share_token must be PARTIAL, not sparse: sparse still indexes
        # explicit nulls, so two unshared plans would collide with E11000. Partial only
        # indexes real string tokens. Migrate any legacy sparse index in place.
        _share_filter = {"share_token": {"$type": "string"}}
        try:
            await db.scenarios.create_index(
                "share_token", unique=True, name="share_token_1",
                partialFilterExpression=_share_filter)
        except OperationFailure:
            await db.scenarios.drop_index("share_token_1")
            await db.scenarios.create_index(
                "share_token", unique=True, name="share_token_1",
                partialFilterExpression=_share_filter)
    except Exception:
        logging.exception("failed creating mc_jobs indexes")
    try:
        await seed_pin_if_missing(db)
    except Exception:
        logging.exception("failed seeding advisor PIN")
    try:
        await ensure_master_seeded(db)
    except Exception:
        logging.exception("failed seeding master PIN")
    try:
        await ensure_licenses_indexes(db)
    except Exception:
        logging.exception("failed creating licenses indexes")
    try:
        # Speeds up "list scenarios in this workspace" + the workspace-count aggregation.
        await db.scenarios.create_index([("owner_token", 1), ("workspace_id", 1)],
                                        name="owner_token_workspace_id_1")
        await db.workspaces.create_index([("owner_token", 1), ("created_at", -1)],
                                         name="owner_token_created_at_-1")
    except Exception:
        logging.exception("failed creating workspace indexes")


@app.on_event("shutdown")
async def _shutdown_db_client():
    mongo_client.close()


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
