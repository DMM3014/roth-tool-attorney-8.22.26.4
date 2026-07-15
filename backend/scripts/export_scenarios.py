#!/usr/bin/env python3
"""Dump every scenario, mc_job, and user_defaults into a portable JSON backup.

Usage:
    cd /app/backend
    python scripts/export_scenarios.py

Writes:
    backup/scenarios_YYYY-MM-DD.json      (dated snapshot)
    backup/latest.json                    (always the most recent snapshot)
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Import from /app/backend even when invoked from another cwd.
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from dotenv import load_dotenv
load_dotenv(HERE / ".env")

from pymongo import MongoClient
from bson import ObjectId


class _E(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId):
            return str(o)
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME must be set in backend/.env", file=sys.stderr)
        return 1

    client = MongoClient(mongo_url)
    db = client[db_name]

    scenarios = list(db.scenarios.find({}, {"_id": 0}))
    mc_jobs = list(db.mc_jobs.find({}, {"_id": 0}))

    user_defaults = None
    ud_path = HERE / "user_defaults.json"
    if ud_path.exists():
        with open(ud_path) as f:
            user_defaults = json.load(f)

    backup = {
        "backup_metadata": {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "db_name": db_name,
            "scenario_count": len(scenarios),
            "mc_job_count": len(mc_jobs),
            "user_defaults_included": user_defaults is not None,
            "restore_note": (
                "Use scripts/import_scenarios.py to restore; it upserts by 'id' UUID "
                "and rewrites backend/user_defaults.json when present."
            ),
        },
        "scenarios": scenarios,
        "mc_jobs": mc_jobs,
        "user_defaults": user_defaults,
    }

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_dir = HERE / "backup"
    out_dir.mkdir(exist_ok=True)
    dated = out_dir / f"scenarios_{today}.json"
    latest = out_dir / "latest.json"

    payload = json.dumps(backup, indent=2, cls=_E)
    dated.write_text(payload)
    latest.write_text(payload)

    print(f"[ok] wrote {dated.relative_to(HERE.parent)}  ({dated.stat().st_size:,} bytes)")
    print(f"     scenarios={len(scenarios)}  mc_jobs={len(mc_jobs)}  "
          f"user_defaults={'yes' if user_defaults else 'no'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
