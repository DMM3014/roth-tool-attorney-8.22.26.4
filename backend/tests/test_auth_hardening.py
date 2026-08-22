"""Regression tests for SEC-001 master-account hardening.

Verifies the passphrase acceptance policy and the tiered failed-attempt lockout.
Uses a lightweight in-memory Motor-shaped fake so tests are DB-independent.
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta

import pytest

import auth_licenses as al


# --------------------------------------------------------------------------
# Minimal async fake of the AsyncIOMotor collections we touch.
# --------------------------------------------------------------------------
class _FakeCollection:
    def __init__(self):
        self.docs = {}

    async def find_one(self, query, projection=None):
        _id = query.get("_id")
        if _id is None:
            return None
        doc = self.docs.get(_id)
        return dict(doc) if doc else None

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)

    async def update_one(self, query, update, upsert=False):
        _id = query.get("_id")
        cur = self.docs.get(_id, {"_id": _id}) if upsert else self.docs.get(_id)
        if cur is None:
            return
        set_ops = update.get("$set", {})
        cur = {**cur, **set_ops}
        self.docs[_id] = cur


class _FakeDb:
    def __init__(self):
        self.auth_config = _FakeCollection()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# --------------------------------------------------------------------------
# is_valid_master_secret — length policy
# --------------------------------------------------------------------------
def test_master_secret_accepts_6_digit_pin():
    assert al.is_valid_master_secret("140431") is True

def test_master_secret_accepts_12_char_passphrase():
    assert al.is_valid_master_secret("correct-horse-battery") is True

def test_master_secret_rejects_short_alphanumeric():
    # 7-char alphanumeric is neither a 6-digit PIN nor a valid passphrase.
    assert al.is_valid_master_secret("abc1234") is False
    assert al.is_valid_master_secret("short") is False
    assert al.is_valid_master_secret("") is False

def test_master_secret_rejects_too_long():
    assert al.is_valid_master_secret("x" * (al.MAX_MASTER_PASSPHRASE_LEN + 1)) is False

def test_master_secret_type_safe():
    assert al.is_valid_master_secret(None) is False
    assert al.is_valid_master_secret(140431) is False    # not a string


# --------------------------------------------------------------------------
# Lockout tier math
# --------------------------------------------------------------------------
def test_lockout_seconds_for_attempts_tiers():
    assert al._lockout_seconds_for_attempts(0) == 0
    assert al._lockout_seconds_for_attempts(4) == 0
    assert al._lockout_seconds_for_attempts(5) == 15 * 60
    assert al._lockout_seconds_for_attempts(9) == 15 * 60
    assert al._lockout_seconds_for_attempts(10) == 60 * 60
    assert al._lockout_seconds_for_attempts(14) == 60 * 60
    assert al._lockout_seconds_for_attempts(15) == 24 * 60 * 60
    assert al._lockout_seconds_for_attempts(100) == 24 * 60 * 60


# --------------------------------------------------------------------------
# verify_master_pin — success / failure / lockout path
# --------------------------------------------------------------------------
def _seed_pin(db, plaintext):
    _run(db.auth_config.insert_one({
        "_id": al.MASTER_DOC_ID,
        "pin_hash": al.hash_pin(plaintext),
        "epoch": "test-epoch-001",
    }))


def test_correct_pin_returns_epoch_and_resets_counter():
    db = _FakeDb()
    _seed_pin(db, "140431")
    # Simulate 3 prior failed attempts.
    _run(db.auth_config.insert_one({
        "_id": al.MASTER_LOCKOUT_DOC_ID, "attempts": 3, "locked_until": None,
    }))
    epoch = _run(al.verify_master_pin(db, "140431"))
    assert epoch == "test-epoch-001"
    # Counter reset
    doc = _run(db.auth_config.find_one({"_id": al.MASTER_LOCKOUT_DOC_ID}))
    assert doc["attempts"] == 0
    assert doc["locked_until"] is None


def test_wrong_pin_increments_counter_no_lockout_below_threshold():
    db = _FakeDb()
    _seed_pin(db, "140431")
    for _ in range(4):
        assert _run(al.verify_master_pin(db, "000000")) is None
    doc = _run(db.auth_config.find_one({"_id": al.MASTER_LOCKOUT_DOC_ID}))
    assert doc["attempts"] == 4
    assert doc["locked_until"] is None


def test_5_wrong_attempts_triggers_15min_lockout():
    db = _FakeDb()
    _seed_pin(db, "140431")
    for _ in range(4):
        assert _run(al.verify_master_pin(db, "000000")) is None
    # 5th attempt crosses the threshold — should raise MasterAccountLocked
    with pytest.raises(al.MasterAccountLocked) as exc:
        _run(al.verify_master_pin(db, "000000"))
    assert exc.value.attempts == 5
    delta = exc.value.locked_until - datetime.now(timezone.utc)
    assert 14 * 60 <= delta.total_seconds() <= 16 * 60


def test_correct_pin_while_locked_still_raises():
    db = _FakeDb()
    _seed_pin(db, "140431")
    # Force a lockout state 5 minutes in the future.
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    _run(db.auth_config.insert_one({
        "_id": al.MASTER_LOCKOUT_DOC_ID, "attempts": 5, "locked_until": future.isoformat(),
    }))
    with pytest.raises(al.MasterAccountLocked):
        _run(al.verify_master_pin(db, "140431"))


def test_expired_lockout_allows_next_attempt():
    db = _FakeDb()
    _seed_pin(db, "140431")
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    _run(db.auth_config.insert_one({
        "_id": al.MASTER_LOCKOUT_DOC_ID, "attempts": 5, "locked_until": past.isoformat(),
    }))
    # Lockout has passed — a correct attempt should now succeed and reset the state.
    epoch = _run(al.verify_master_pin(db, "140431"))
    assert epoch == "test-epoch-001"
    doc = _run(db.auth_config.find_one({"_id": al.MASTER_LOCKOUT_DOC_ID}))
    assert doc["attempts"] == 0


def test_passphrase_login_succeeds():
    db = _FakeDb()
    passphrase = "a-real-passphrase-with-real-length"
    _seed_pin(db, passphrase)
    epoch = _run(al.verify_master_pin(db, passphrase))
    assert epoch == "test-epoch-001"


def test_malformed_input_counts_as_attempt():
    """SEC-001: length-policy failures still increment the counter so an attacker
    cannot probe the length policy without triggering lockout."""
    db = _FakeDb()
    _seed_pin(db, "140431")
    locked = False
    for _ in range(5):
        try:
            _run(al.verify_master_pin(db, "bad"))
        except al.MasterAccountLocked:
            locked = True
    doc = _run(db.auth_config.find_one({"_id": al.MASTER_LOCKOUT_DOC_ID}))
    assert doc["attempts"] >= 5
    assert doc["locked_until"] is not None
    assert locked, "5 malformed attempts should have triggered the lockout"


def test_10_attempts_promote_to_60min_lockout():
    db = _FakeDb()
    _seed_pin(db, "140431")
    # We need to accumulate 10 attempts. Each attempt after #5 will re-trigger
    # a lockout — so rewind the lockout window each time so the next attempt
    # is allowed through.
    def _rewind():
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        _run(db.auth_config.update_one(
            {"_id": al.MASTER_LOCKOUT_DOC_ID}, {"$set": {"locked_until": past.isoformat()}},
        ))

    triggered_tier2 = False
    for i in range(10):
        try:
            _run(al.verify_master_pin(db, "000000"))
        except al.MasterAccountLocked as e:
            delta = e.locked_until - datetime.now(timezone.utc)
            if e.attempts >= 10 and 55 * 60 <= delta.total_seconds() <= 65 * 60:
                triggered_tier2 = True
                break
        _rewind()
    assert triggered_tier2, "expected the 10th failed attempt to raise 60-min lockout"


def test_15_attempts_promote_to_24hr_lockout():
    db = _FakeDb()
    _seed_pin(db, "140431")
    def _rewind():
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        _run(db.auth_config.update_one(
            {"_id": al.MASTER_LOCKOUT_DOC_ID}, {"$set": {"locked_until": past.isoformat()}},
        ))

    triggered_tier3 = False
    for _ in range(15):
        try:
            _run(al.verify_master_pin(db, "000000"))
        except al.MasterAccountLocked as e:
            delta = e.locked_until - datetime.now(timezone.utc)
            if e.attempts >= 15 and 23 * 3600 <= delta.total_seconds() <= 25 * 3600:
                triggered_tier3 = True
                break
        _rewind()
    assert triggered_tier3, "expected the 15th failed attempt to raise 24-hr lockout"
