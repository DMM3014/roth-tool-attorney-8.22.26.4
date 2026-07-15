#!/usr/bin/env python3
"""Restore scenarios / mc_jobs / user_defaults from a JSON backup produced by
`export_scenarios.py`. Idempotent — safe to run multiple times.

Usage:
    cd /app/backend
    python scripts/import_scenarios.py backup/latest.json
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from dotenv import load_dotenv
load_dotenv(HERE / ".env")

from pymongo import MongoClient


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: python scripts/import_scenarios.py <path-to-backup.json>", file=sys.stderr)
        return 2

    src = Path(argv[1])
    if not src.exists():
        print(f"ERROR: backup file not found: {src}", file=sys.stderr)
        return 1

    with open(src) as f:
        backup = json.load(f)

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME must be set in backend/.env", file=sys.stderr)
        return 1

    client = MongoClient(mongo_url)
    db = client[db_name]

    scenarios = backup.get("scenarios") or []
    mc_jobs = backup.get("mc_jobs") or []
    user_defaults = backup.get("user_defaults")

    for s in scenarios:
        db.scenarios.update_one({"id": s["id"]}, {"$set": s}, upsert=True)
    for j in mc_jobs:
        db.mc_jobs.update_one({"job_id": j["job_id"]}, {"$set": j}, upsert=True)

    ud_written = False
    if user_defaults is not None:
        ud_path = HERE / "user_defaults.json"
        with open(ud_path, "w") as f:
            json.dump(user_defaults, f, indent=2)
        ud_written = True

    print(f"[ok] restored from {src}")
    print(f"     scenarios upserted: {len(scenarios)}")
    print(f"     mc_jobs upserted:   {len(mc_jobs)}")
    print(f"     user_defaults:      {'restored' if ud_written else 'not in backup'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
