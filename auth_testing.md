# Advisor PIN Gate — Testing Playbook (SEC-003)

## What was built
Single-advisor 6-digit PIN gate. No usernames/emails. bcrypt PIN hash + random `epoch`
stored in Mongo (`auth_config` collection, doc `_id: "advisor_pin"`). Advisor JWTs
(HS256, 30-day TTL, `JWT_SECRET` in backend/.env) embed the epoch; changing the PIN
rotates the epoch → all previously issued tokens die instantly.

Current PIN: see /app/memory/test_credentials.md (initial: 140431).

## Server-side enforcement map
- OPEN: `GET /api/`, `GET /api/scenarios/share/{token}`, `POST /api/auth/pin/verify` (5/min), `GET /api/auth/pin/status`
- ADVISOR **or** SHARE token (header `Authorization: Bearer ...` OR `X-Share-Token: ...`):
  /defaults (GET), /states, /market-scenarios, /tax/year, /tax/optimize, /projection, /sweep,
  /strategy-sweep, /strategy-stress, /ss-optimizer, /montecarlo (+status, regime-compare),
  /insights, /insights/chat
- ADVISOR ONLY: /defaults/save (POST+DELETE), /scenarios CRUD + share enable/revoke, /auth/pin/change (5/min)

## Step 1: MongoDB verification
```
mongosh
use test_database
db.auth_config.findOne({_id: "advisor_pin"})
```
Verify: `pin_hash` starts with `$2b$`, `epoch` is a UUID string.

## Step 2: API testing
```
API_URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
# 401 without auth:
curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/projection" -H "Content-Type: application/json" -d '{"config":{}}'
# verify PIN (rate-limited 5/min — don't hammer):
TOKEN=$(curl -s -X POST "$API_URL/api/auth/pin/verify" -H "Content-Type: application/json" -d '{"pin":"140431"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s "$API_URL/api/auth/pin/status" -H "Authorization: Bearer $TOKEN"
```

## Step 3: UI flows
1. Open app URL (no query params) → lock screen (`lock-screen`), OTP input (`pin-input`), Unlock (`pin-unlock-btn`).
2. Wrong PIN → error `pin-error`. Correct PIN (auto-submits on 6th digit) → planner loads.
3. Reload → stays unlocked (localStorage token).
4. Header "Passcode" button (`change-pin-btn`) → dialog (`change-pin-dialog`): `current-pin-input`,
   `new-pin-input`, `confirm-pin-input`, submit `change-pin-submit`. On success device stays signed in.
   IMPORTANT: if you change the PIN during testing, CHANGE IT BACK to the original and update
   /app/memory/test_credentials.md.
5. Share links: enable share on a scenario (advisor mode), open `?share=<token>` in a fresh
   context → NO lock screen, read-only view works (optimizer computes fine via X-Share-Token header).

## Pytest suite integration
- `backend/tests/conftest.py` injects a valid advisor Bearer into all HTTP test requests and
  installs dependency_overrides to bypass the gate for legacy in-process tests.
- `backend/tests/test_phase33_pin_auth.py` removes the overrides per-test and exercises the real
  gate with a swapped-in test PIN (restores the real PIN doc afterwards).
- Rate limits: /auth/pin/verify and /auth/pin/change are 5/min per IP — keep test attempts under that.
