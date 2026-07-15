# MongoDB Backup — Roth Conversion & Retirement Planner

## What's here

Each `scenarios_YYYY-MM-DD.json` file is a **full snapshot** of the app's user data at
the moment the backup was taken. `latest.json` is a duplicate of the most recent snapshot
for convenience. These files contain:

- **`scenarios`**: every saved scenario (name, config, share tokens, timestamps, owner tokens)
- **`mc_jobs`**: any completed Monte Carlo simulation jobs
- **`user_defaults`**: the config saved via the "Save as defaults" button in the UI
  (contents of `backend/user_defaults.json`, if it exists)
- **`backup_metadata`**: timestamp, counts, restore instructions

These files travel with the codebase when you push to GitHub, so a `git clone` +
this folder = a complete restore-from-nothing.

## Re-running the backup

```bash
cd /app/backend
python scripts/export_scenarios.py
```

That will drop a fresh `scenarios_YYYY-MM-DD.json` here and update `latest.json`.

## Restoring from a backup

After a fresh install (fresh MongoDB, cloned repo, env vars filled in):

```bash
cd /app/backend
python scripts/import_scenarios.py backup/latest.json
```

The importer is idempotent — running it twice won't create duplicates (it upserts by
scenario `id`). It will also restore `user_defaults.json` if included in the backup.

## What's NOT in these files (and how to preserve)

- **Env vars** — `MONGO_URL`, `DB_NAME`, `DEFAULT_GEMINI_API_KEY`, `EMERGENT_LLM_KEY` live
  only in `backend/.env`. Copy that file separately to a password manager or encrypted store.
- **Frontend `.env`** — `REACT_APP_BACKEND_URL` lives in `frontend/.env`. Same rules.

## Format details

Every value is JSON-native; MongoDB `ObjectId`s and `datetime`s are serialized to strings.
The `_id` field is dropped on export — Mongo will assign a fresh one on import, and the
app's own `id` UUID is what maps to shares / URLs / owner-token scoping.
