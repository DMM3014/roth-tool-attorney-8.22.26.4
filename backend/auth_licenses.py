"""Two-tier PIN auth (master owner + licensees).

Extends the single-PIN advisor gate from `auth_pin.py`:

- **Master (owner)** — one only, PIN sourced from env `MASTER_ADMIN_PIN`, hashed on
  first boot into `auth_config/master_pin` with a random `epoch`. Changing the env
  and restarting rotates the master PIN and its epoch. Cannot be changed from the
  UI. Master tokens have `role="master"` and unlock every endpoint including the
  admin panel.

- **Licensee** — many, each with `{email, pin_hash, epoch, expires_at, revoked_at,
  ...}` stored in the `licenses` collection. Login is `POST /api/auth/license/verify`
  with `{email, pin}` → JWT `{role="licensee", sub=<license_id>, epoch, exp}`.
  Any credential change (rotate-pin, revoke) bumps the licensee epoch, invalidating
  every active JWT for that licensee on all devices.

Both token types share the same JWT_SECRET / HS256 / X-Session-Token header pattern
used by the pre-existing advisor gate, so the auth surface is unified.

Legacy note: JWTs minted by the old `mint_advisor_token()` (type="advisor") are
treated as master tokens for backwards compatibility, so an already-signed-in
device does NOT get bounced out when this module rolls out.
"""
from __future__ import annotations

import os
import re
import uuid
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt

JWT_ALGORITHM = "HS256"
TOKEN_TTL_DAYS = 30
MASTER_DOC_ID = "master_pin"
MASTER_LOCKOUT_DOC_ID = "master_lockout"
LICENSES_COLLECTION = "licenses"

# ---- Master credential policy (SEC-001 hardening) ----
# The master PIN accepts EITHER (a) the legacy 6-digit numeric PIN, or (b) a
# longer passphrase (≥ 12 chars). Passphrase is the recommended production mode.
# On startup we log a WARNING if the current secret is still in weak "6-digit"
# form so operators are nudged to rotate.
MIN_MASTER_PASSPHRASE_LEN = 12
MAX_MASTER_PASSPHRASE_LEN = 128
# Progressive lockout thresholds — 5 fails → 15 min, 10 fails → 60 min, 15+ → 24 hr.
LOCKOUT_TIERS = [
    (5, 15 * 60),
    (10, 60 * 60),
    (15, 24 * 60 * 60),
]

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


class MasterAccountLocked(Exception):
    """Raised by `verify_master_pin` when the master account is currently locked
    out for exceeding the failed-attempt threshold. `locked_until` is a
    timezone-aware datetime after which a fresh attempt will be accepted."""
    def __init__(self, locked_until: datetime, attempts: int):
        self.locked_until = locked_until
        self.attempts = attempts
        super().__init__(f"Master account locked until {locked_until.isoformat()} "
                         f"({attempts} consecutive failed attempts)")


def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def is_valid_pin_format(pin) -> bool:
    """Legacy 6-digit numeric PIN check — used by licensees + backwards-compat
    for master. New master deployments should prefer `is_valid_master_secret`."""
    return isinstance(pin, str) and len(pin) == 6 and pin.isdigit()


def is_valid_master_secret(secret) -> bool:
    """Accepts either the legacy 6-digit PIN OR a passphrase of 12-128 chars.
    Passphrase mode is the recommended production configuration."""
    if not isinstance(secret, str):
        return False
    if is_valid_pin_format(secret):
        return True
    return MIN_MASTER_PASSPHRASE_LEN <= len(secret) <= MAX_MASTER_PASSPHRASE_LEN


def is_valid_email(email) -> bool:
    return isinstance(email, str) and 5 <= len(email) <= 254 and bool(EMAIL_RE.match(email))


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def generate_pin() -> str:
    """6-digit uniformly-random PIN (0-padded)."""
    return f"{secrets.randbelow(1_000_000):06d}"


# ---------- Token minting ----------
def _mint_token(role: str, sub: str, epoch: str, expires_at: Optional[datetime] = None) -> str:
    """Mint a JWT with the smaller of {rolling 30 day TTL, license expires_at}."""
    now = datetime.now(timezone.utc)
    default_exp = now + timedelta(days=TOKEN_TTL_DAYS)
    if expires_at is not None and expires_at < default_exp:
        default_exp = expires_at
    payload = {
        "role": role,
        "sub": sub,
        "epoch": epoch,
        "iat": now,
        "exp": default_exp,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def mint_master_token(epoch: str) -> str:
    return _mint_token(role="master", sub="master", epoch=epoch)


def mint_licensee_token(license_id: str, epoch: str, expires_at: Optional[datetime]) -> str:
    return _mint_token(role="licensee", sub=license_id, epoch=epoch, expires_at=expires_at)


def decode_token(token: str) -> Optional[dict]:
    """Payload for a structurally-valid, unexpired token, else None. Epoch freshness
    is checked by the caller against the DB doc for that role/sub."""
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    role = payload.get("role")
    # Backwards compat: legacy advisor tokens (type="advisor") count as master.
    if role is None and payload.get("type") == "advisor":
        payload["role"] = "master"
        payload["sub"] = "master"
        role = "master"
    if role not in ("master", "licensee"):
        return None
    return payload


# ---------- Master seed / rotation ----------
async def ensure_master_seeded(db) -> None:
    """Idempotent seed of the master PIN from env `MASTER_ADMIN_PIN` (falls back to
    `ADVISOR_PIN_INITIAL` for backwards compatibility with the pre-license deployment).

    Behavior:
      1. If no master doc exists, hash the env PIN and store it with a fresh epoch.
      2. If a doc exists AND the env PIN no longer matches the stored hash, RE-SEED:
         update the hash to the current env PIN and rotate the epoch. This lets the
         owner change the master PIN by editing env + restarting the backend.
      3. If env PIN is missing or malformed, log an error and leave existing doc
         untouched (never wipe a working master out of DB).

    Legacy migration: if only the old `advisor_pin` doc exists (from the previous
    single-PIN release), copy its hash + epoch into `master_pin` on first boot so
    an already-signed-in advisor session survives the upgrade.
    """
    env_pin = (os.environ.get("MASTER_ADMIN_PIN")
               or os.environ.get("ADVISOR_PIN_INITIAL", "")).strip()
    if not is_valid_master_secret(env_pin):
        logging.error(
            "MASTER_ADMIN_PIN missing or invalid — master gate not seeded. "
            "Provide a 6-digit PIN or a passphrase of %d-%d chars.",
            MIN_MASTER_PASSPHRASE_LEN, MAX_MASTER_PASSPHRASE_LEN,
        )
        return
    # SEC-001: warn if the secret is still the weak 6-digit PIN form. A 6-digit
    # numeric PIN has ~20 bits of entropy — even with lockout, prefer a passphrase.
    if is_valid_pin_format(env_pin):
        logging.warning(
            "MASTER_ADMIN_PIN is a 6-digit numeric PIN (~20 bits of entropy). "
            "For production, rotate to a passphrase of %d+ chars in env and restart.",
            MIN_MASTER_PASSPHRASE_LEN,
        )

    existing = await db.auth_config.find_one({"_id": MASTER_DOC_ID})

    # Legacy migration: copy old advisor_pin doc if present and no master doc yet
    if existing is None:
        legacy = await db.auth_config.find_one({"_id": "advisor_pin"})
        if legacy is not None and "pin_hash" in legacy and "epoch" in legacy:
            await db.auth_config.insert_one({
                "_id": MASTER_DOC_ID,
                "pin_hash": legacy["pin_hash"],
                "epoch": legacy["epoch"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "migrated_from_advisor": True,
            })
            existing = await db.auth_config.find_one({"_id": MASTER_DOC_ID})
            logging.info("master PIN migrated from legacy advisor_pin doc")

    if existing is None:
        await db.auth_config.insert_one({
            "_id": MASTER_DOC_ID,
            "pin_hash": hash_pin(env_pin),
            "epoch": str(uuid.uuid4()),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        logging.info("master PIN seeded from MASTER_ADMIN_PIN")
        return

    if not verify_pin(env_pin, existing["pin_hash"]):
        await db.auth_config.update_one(
            {"_id": MASTER_DOC_ID},
            {"$set": {
                "pin_hash": hash_pin(env_pin),
                "epoch": str(uuid.uuid4()),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        logging.info("master PIN rotated from MASTER_ADMIN_PIN env change")


async def _read_master_lockout(db) -> dict:
    """Return the current lockout doc, defaulting to a zero-state dict."""
    doc = await db.auth_config.find_one({"_id": MASTER_LOCKOUT_DOC_ID})
    return doc or {"_id": MASTER_LOCKOUT_DOC_ID, "attempts": 0, "locked_until": None}


def _lockout_seconds_for_attempts(attempts: int) -> int:
    """Return the cool-off (in seconds) triggered after `attempts` consecutive
    failed logins. Returns 0 if no lockout is triggered at this count."""
    triggered = 0
    for threshold, secs in LOCKOUT_TIERS:
        if attempts >= threshold:
            triggered = secs
    return triggered


async def _check_master_lockout(db) -> None:
    """Raise MasterAccountLocked if the master account is currently locked."""
    doc = await _read_master_lockout(db)
    locked_until = doc.get("locked_until")
    if not locked_until:
        return
    # Locked_until stored as ISO-8601 with UTC offset.
    try:
        until = datetime.fromisoformat(locked_until)
    except (TypeError, ValueError):
        return
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) < until:
        raise MasterAccountLocked(locked_until=until, attempts=int(doc.get("attempts", 0)))


async def _record_master_failure(db) -> Optional[datetime]:
    """Increment the failed-attempt counter and, if a tier is reached, set the
    lockout window. Returns the new `locked_until` datetime when a fresh
    lockout is triggered, otherwise None."""
    now = datetime.now(timezone.utc)
    doc = await _read_master_lockout(db)
    attempts = int(doc.get("attempts", 0)) + 1
    lockout_secs = _lockout_seconds_for_attempts(attempts)
    locked_until = now + timedelta(seconds=lockout_secs) if lockout_secs > 0 else None
    await db.auth_config.update_one(
        {"_id": MASTER_LOCKOUT_DOC_ID},
        {"$set": {
            "attempts": attempts,
            "locked_until": locked_until.isoformat() if locked_until else None,
            "last_failed_at": now.isoformat(),
        }},
        upsert=True,
    )
    if locked_until is not None:
        logging.warning(
            "master PIN locked out after %d consecutive failures; unlocks at %s",
            attempts, locked_until.isoformat(),
        )
    return locked_until


async def _reset_master_lockout(db) -> None:
    """Wipe the failed-attempt counter on any successful master login."""
    await db.auth_config.update_one(
        {"_id": MASTER_LOCKOUT_DOC_ID},
        {"$set": {"attempts": 0, "locked_until": None,
                  "reset_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


async def verify_master_pin(db, pin: str) -> Optional[str]:
    """Verify the master PIN/passphrase.

    Behavior:
    - Refuses input that fails the length gate (short-circuits without a DB hit).
    - Enforces the failed-attempt lockout BEFORE doing bcrypt work (so a locked
      attacker cannot even burn CPU on our end).
    - On success: resets the lockout counter and returns the current epoch.
    - On failure: increments the lockout counter and returns None (or raises
      `MasterAccountLocked` if the increment just crossed a tier).
    """
    if not is_valid_master_secret(pin):
        # Malformed inputs still count as attempts so an attacker can't probe
        # length policy without triggering the lockout.
        await _record_master_failure(db)
        await _check_master_lockout(db)  # may raise on the just-incremented count
        return None
    await _check_master_lockout(db)
    doc = await db.auth_config.find_one({"_id": MASTER_DOC_ID})
    if not doc:
        return None
    if not verify_pin(pin, doc["pin_hash"]):
        await _record_master_failure(db)
        # Re-check so the caller sees a 429 immediately when this attempt
        # was the one that crossed a lockout tier.
        await _check_master_lockout(db)
        return None
    await _reset_master_lockout(db)
    return doc.get("epoch")


async def is_valid_master_token(db, payload: dict) -> bool:
    if payload.get("role") != "master":
        return False
    doc = await db.auth_config.find_one({"_id": MASTER_DOC_ID})
    return bool(doc and payload.get("epoch") == doc.get("epoch"))


# ---------- Licensee CRUD ----------
async def ensure_licenses_indexes(db) -> None:
    """Unique email + partial-unique license_id."""
    try:
        await db[LICENSES_COLLECTION].create_index(
            "email", unique=True, name="license_email_unique",
        )
    except Exception:
        logging.exception("failed creating licenses.email index")
    try:
        await db[LICENSES_COLLECTION].create_index(
            "license_id", unique=True, name="license_id_unique",
        )
    except Exception:
        logging.exception("failed creating licenses.license_id index")


def _normalize_email(email: str) -> str:
    return email.strip().lower()


async def create_licensee(db, email: str, expires_at: Optional[datetime]) -> dict:
    """Provision a new licensee: generates a random 6-digit PIN, returns it once in
    the response (must be handed to the licensee via secure channel — never stored
    plaintext). PIN is bcrypt-hashed at rest."""
    email = _normalize_email(email)
    if not is_valid_email(email):
        raise ValueError("invalid email")
    if await db[LICENSES_COLLECTION].find_one({"email": email}):
        raise ValueError("email already registered")
    pin = generate_pin()
    license_id = str(uuid.uuid4())
    doc = {
        "license_id": license_id,
        "email": email,
        "pin_hash": hash_pin(pin),
        "epoch": str(uuid.uuid4()),
        "expires_at": expires_at.isoformat() if expires_at else None,
        "revoked_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
        "last_login_ip": None,
    }
    await db[LICENSES_COLLECTION].insert_one(doc)
    doc_public = {k: v for k, v in doc.items() if k not in ("pin_hash", "_id")}
    doc_public["pin"] = pin  # returned ONCE
    return doc_public


async def rotate_licensee_pin(db, license_id: str) -> Optional[dict]:
    lic = await db[LICENSES_COLLECTION].find_one({"license_id": license_id})
    if not lic:
        return None
    new_pin = generate_pin()
    new_epoch = str(uuid.uuid4())
    await db[LICENSES_COLLECTION].update_one(
        {"license_id": license_id},
        {"$set": {
            "pin_hash": hash_pin(new_pin),
            "epoch": new_epoch,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"license_id": license_id, "email": lic["email"], "pin": new_pin}


async def revoke_licensee(db, license_id: str) -> bool:
    res = await db[LICENSES_COLLECTION].update_one(
        {"license_id": license_id, "revoked_at": None},
        {"$set": {
            "revoked_at": datetime.now(timezone.utc).isoformat(),
            "epoch": str(uuid.uuid4()),
        }},
    )
    return res.matched_count > 0


async def renew_licensee(db, license_id: str, expires_at: Optional[datetime]) -> bool:
    res = await db[LICENSES_COLLECTION].update_one(
        {"license_id": license_id},
        {"$set": {
            "expires_at": expires_at.isoformat() if expires_at else None,
            "revoked_at": None,  # renewal reactivates
            "epoch": str(uuid.uuid4()),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return res.matched_count > 0


async def list_licensees(db) -> list:
    docs = await db[LICENSES_COLLECTION].find(
        {}, {"_id": 0, "pin_hash": 0, "epoch": 0}
    ).sort("created_at", -1).to_list(500)
    # Annotate status derived from revoked_at + expires_at
    now = datetime.now(timezone.utc)
    for d in docs:
        if d.get("revoked_at"):
            d["status"] = "revoked"
        elif d.get("expires_at") and datetime.fromisoformat(d["expires_at"]) < now:
            d["status"] = "expired"
        else:
            d["status"] = "active"
    return docs


async def verify_licensee_login(db, email: str, pin: str, client_ip: Optional[str] = None) -> Optional[dict]:
    """Returns {license_id, epoch, expires_at (dt or None)} on success. Reasons for
    failure: unknown email, wrong PIN, revoked, expired. All failures return None
    to avoid leaking which condition tripped."""
    email = _normalize_email(email)
    lic = await db[LICENSES_COLLECTION].find_one({"email": email})
    if not lic:
        return None
    if lic.get("revoked_at"):
        return None
    exp_iso = lic.get("expires_at")
    expires_at = datetime.fromisoformat(exp_iso) if exp_iso else None
    if expires_at is not None:
        # Normalize to UTC for comparison
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            return None
    if not verify_pin(pin, lic["pin_hash"]):
        return None
    # Update last_login on success
    try:
        await db[LICENSES_COLLECTION].update_one(
            {"license_id": lic["license_id"]},
            {"$set": {
                "last_login_at": datetime.now(timezone.utc).isoformat(),
                "last_login_ip": (client_ip or "")[:64],
            }},
        )
    except Exception:
        pass  # non-fatal
    return {
        "license_id": lic["license_id"],
        "epoch": lic["epoch"],
        "expires_at": expires_at,
        "email": lic["email"],
    }


async def is_valid_licensee_token(db, payload: dict) -> bool:
    if payload.get("role") != "licensee":
        return False
    license_id = payload.get("sub")
    if not license_id:
        return False
    lic = await db[LICENSES_COLLECTION].find_one({"license_id": license_id})
    if not lic:
        return False
    if lic.get("revoked_at"):
        return False
    if payload.get("epoch") != lic.get("epoch"):
        return False
    # Hard-cap: if the license has expired since token was minted, reject
    exp_iso = lic.get("expires_at")
    if exp_iso:
        exp_dt = datetime.fromisoformat(exp_iso)
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        if exp_dt < datetime.now(timezone.utc):
            return False
    return True
