# Here are your Instructions
How to get the file to your computer
Option A — via GitHub (recommended): Click "Save to GitHub" in the Emergent panel. The backup/ folder ships with the repo, so when you download the ZIP from GitHub you get code + backup in one shot. Next time you want a fresh backup, run python scripts/export_scenarios.py and re-push — you'll get an appended dated snapshot alongside the old one.

Option B — email it to yourself: The file is 74 KB, well under any attachment limit. If Emergent gives you shell access to download individual files, grab /app/backend/backup/latest.json.

Option C — I can serve it via a temporary route: If you want to hit a URL from your browser and get the file as a download, say the word — I'll add a temporary GET /api/admin/backup endpoint (session-token protected) that streams the JSON. Would take ~2 minutes.

To restore later (any fresh install)
cd /app/backend
python scripts/import_scenarios.py backup/latest.json
Idempotent — safe to run twice. Restores all 7 scenarios AND your saved defaults.

Round-trip verified
I just ran export → import and confirmed:

7/7 scenarios round-trip clean
user_defaults.json restored intact (SS 2035, DIV03=on, heir 32%/4%)
App still serves the correct defaults from /api/defaults after restore
