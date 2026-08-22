"""Advisor PIN gate (single-advisor passcode auth, SEC-003).

The 6-digit PIN's bcrypt hash lives in Mongo (auth_config/advisor_pin) together with a
random `epoch`. Advisor JWTs embed that epoch, so a PIN change rotates the epoch and
instantly invalidates every previously issued token on every device.
"""
import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt

JWT_ALGORITHM = "HS256"
ADVISOR_TOKEN_TTL_DAYS = 30
PIN_DOC_ID = "advisor_pin"


def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def is_valid_pin_format(pin) -> bool:
    return isinstance(pin, str) and len(pin) == 6 and pin.isdigit()


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def mint_advisor_token(epoch: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "advisor",
        "epoch": epoch,
        "iat": now,
        "exp": now + timedelta(days=ADVISOR_TOKEN_TTL_DAYS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_advisor_token(token: str) -> Optional[dict]:
    """Payload for a structurally valid, unexpired advisor token, else None.
    Epoch freshness is checked by the caller against the DB doc."""
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != "advisor":
        return None
    return payload


async def seed_pin_if_missing(db) -> None:
    """Idempotent: creates the PIN doc from ADVISOR_PIN_INITIAL only when absent, so a
    self-service PIN change is never clobbered by restarts."""
    existing = await db.auth_config.find_one({"_id": PIN_DOC_ID})
    if existing is not None:
        return
    initial = os.environ.get("ADVISOR_PIN_INITIAL", "").strip()
    if not is_valid_pin_format(initial):
        logging.error("ADVISOR_PIN_INITIAL missing or not 6 digits — PIN gate not seeded")
        return
    await db.auth_config.insert_one({
        "_id": PIN_DOC_ID,
        "pin_hash": hash_pin(initial),
        "epoch": str(uuid.uuid4()),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    logging.info("advisor PIN seeded from ADVISOR_PIN_INITIAL")
