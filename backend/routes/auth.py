"""Authentication routes — master PIN, licensee login, master-only license CRUD.

Split out of server.py to keep the app bootstrap file small. All auth math stays
in `auth_licenses.py` — this module is a thin HTTP shell over it.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from auth_licenses import (
    LICENSES_COLLECTION,
    TOKEN_TTL_DAYS as LICENSE_TOKEN_TTL_DAYS,
    MasterAccountLocked,
    create_licensee as auth_create_licensee,
    list_licensees as auth_list_licensees,
    mint_licensee_token,
    mint_master_token,
    renew_licensee as auth_renew_licensee,
    revoke_licensee as auth_revoke_licensee,
    rotate_licensee_pin as auth_rotate_licensee_pin,
    verify_licensee_login,
    verify_master_pin,
    is_valid_email,
)
from deps import (
    UUID_RE, _extract_bearer_payload, _is_licensee, _is_master, db, limiter,
    require_master,
)
from models import (
    LicenseCreateRequest, LicenseLoginRequest, LicenseRenewRequest,
    PinChangeRequest, PinVerifyRequest,
)

router = APIRouter(prefix="/api")


# ---------- Master PIN ----------
@router.post("/auth/pin/verify")
@limiter.limit("5/minute")
async def pin_verify(request: Request, req: PinVerifyRequest):
    """Master PIN/passphrase login. Returns a master-role token with 30-day TTL.

    Lockout policy (SEC-001):
    - 5 consecutive failed attempts → 15-minute lockout
    - 10 → 60-minute lockout
    - 15+ → 24-hour lockout
    Successful login resets the counter. Lockout is enforced at the account
    level, so it stops distributed guess attacks across many source IPs.
    """
    try:
        epoch = await verify_master_pin(db, req.pin)
    except MasterAccountLocked as e:
        retry_seconds = max(1, int((e.locked_until - datetime.now(timezone.utc)).total_seconds()))
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again after {e.locked_until.isoformat()}.",
            headers={"Retry-After": str(retry_seconds)},
        )
    if epoch is None:
        raise HTTPException(status_code=401, detail="Incorrect passcode")
    return {"token": mint_master_token(epoch), "role": "master",
            "expires_days": LICENSE_TOKEN_TTL_DAYS}


@router.get("/auth/pin/status")
async def pin_status(authorization: Optional[str] = Header(default=None)):
    payload = await _extract_bearer_payload(authorization)
    if payload is None:
        return {"authenticated": False}
    if await _is_master(payload):
        return {"authenticated": True, "role": "master", "sub": "master"}
    if await _is_licensee(payload):
        lic = await db[LICENSES_COLLECTION].find_one(
            {"license_id": payload.get("sub")}, {"_id": 0, "email": 1, "expires_at": 1})
        return {"authenticated": True, "role": "licensee",
                "sub": payload.get("sub"),
                "email": (lic or {}).get("email"),
                "expires_at": (lic or {}).get("expires_at")}
    return {"authenticated": False}


@router.post("/auth/pin/change")
@limiter.limit("5/minute")
async def pin_change(request: Request, req: PinChangeRequest, _mst: None = Depends(require_master)):
    """DEPRECATED: master PIN rotates by editing env + restarting the backend."""
    raise HTTPException(
        status_code=410,
        detail="Master PIN is now managed via the MASTER_ADMIN_PIN environment variable. "
               "Rotate it by editing your backend .env and restarting the server.",
    )


# ---------- Licensee login ----------
@router.post("/auth/license/verify")
@limiter.limit("5/minute")
async def license_verify(request: Request, req: LicenseLoginRequest):
    """Licensee login. Returns a licensee token whose exp is min(30 days, license expires_at)."""
    if not is_valid_email(req.email):
        raise HTTPException(status_code=422, detail="Invalid email format")
    client_ip = None
    try:
        client_ip = request.client.host if request.client else None
    except Exception:
        pass
    result = await verify_licensee_login(db, req.email, req.pin, client_ip=client_ip)
    if result is None:
        # Same message for unknown-email / wrong-pin / revoked / expired — don't leak which condition tripped.
        raise HTTPException(status_code=401, detail="Invalid email or passcode")
    token = mint_licensee_token(
        license_id=result["license_id"],
        epoch=result["epoch"],
        expires_at=result["expires_at"],
    )
    return {
        "token": token,
        "role": "licensee",
        "email": result["email"],
        "expires_at": result["expires_at"].isoformat() if result["expires_at"] else None,
    }


# ---------- Admin (master-only) license CRUD ----------
def _parse_expires_at(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="expires_at must be ISO8601 or null")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@router.post("/admin/licenses")
@limiter.limit("30/minute")
async def admin_create_license(request: Request, req: LicenseCreateRequest,
                               _mst: None = Depends(require_master)):
    if not is_valid_email(req.email):
        raise HTTPException(status_code=422, detail="Invalid email format")
    expires_at = _parse_expires_at(req.expires_at)
    try:
        created = await auth_create_licensee(db, req.email, expires_at)
    except ValueError as e:
        raise HTTPException(status_code=409 if "already" in str(e) else 422, detail=str(e))
    return created  # includes generated `pin` — shown ONCE to the master


@router.get("/admin/licenses")
async def admin_list_licenses(_mst: None = Depends(require_master)):
    return {"licenses": await auth_list_licensees(db)}


@router.post("/admin/licenses/{license_id}/rotate-pin")
@limiter.limit("30/minute")
async def admin_rotate_license_pin(request: Request, license_id: str,
                                   _mst: None = Depends(require_master)):
    if not UUID_RE.match(license_id):
        raise HTTPException(status_code=400, detail="Invalid license id")
    result = await auth_rotate_licensee_pin(db, license_id)
    if result is None:
        raise HTTPException(status_code=404, detail="License not found")
    return result  # includes new `pin` — shown ONCE


@router.post("/admin/licenses/{license_id}/revoke")
@limiter.limit("30/minute")
async def admin_revoke_license(request: Request, license_id: str,
                               _mst: None = Depends(require_master)):
    if not UUID_RE.match(license_id):
        raise HTTPException(status_code=400, detail="Invalid license id")
    ok = await auth_revoke_licensee(db, license_id)
    if not ok:
        raise HTTPException(status_code=404, detail="License not found or already revoked")
    return {"revoked": license_id}


@router.post("/admin/licenses/{license_id}/renew")
@limiter.limit("30/minute")
async def admin_renew_license(request: Request, license_id: str, req: LicenseRenewRequest,
                              _mst: None = Depends(require_master)):
    if not UUID_RE.match(license_id):
        raise HTTPException(status_code=400, detail="Invalid license id")
    expires_at = _parse_expires_at(req.expires_at)
    ok = await auth_renew_licensee(db, license_id, expires_at)
    if not ok:
        raise HTTPException(status_code=404, detail="License not found")
    return {"renewed": license_id, "expires_at": expires_at.isoformat() if expires_at else None}
