"""
Backend regression tests for Roth IRA Conversion & Retirement Planner.
Endpoints covered:
  /api/defaults, /api/tax/year, /api/tax/optimize, /api/projection,
  /api/scenarios (CRUD), /api/insights (streaming).
"""
import os
import uuid
import math
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')

# Read frontend env where REACT_APP_BACKEND_URL lives (override if not in env)
if 'preview' not in BASE_URL and 'http' not in BASE_URL:
    # fallback: read from frontend/.env
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        # Per-test-run session token (SEC-002: scenarios are per-session).
        "X-Session-Token": str(uuid.uuid4()),
    })
    return s


# ---------- /api/defaults ----------
class TestDefaults:
    def test_defaults_returns_full_scenario(self, client):
        r = client.get(f"{BASE_URL}/api/defaults", timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ["household", "projection", "income_streams", "expenses", "accounts", "tax", "roth"]:
            assert k in d, f"missing key {k} in defaults"
        assert isinstance(d["income_streams"], list)
        assert isinstance(d["accounts"], list)

    def test_save_and_revert_custom_defaults(self, client):
        # Snapshot the caller's real saved defaults up front — this test must never
        # clobber user_defaults.json even if it fails mid-flight.
        pre = client.get(f"{BASE_URL}/api/defaults", timeout=15).json()
        try:
            # 1. Fetch defaults (may be either DEFAULT_SCENARIO or the caller's override).
            base = client.get(f"{BASE_URL}/api/defaults", timeout=15).json()
            assert base["household"]["filing_status"] == "Married Filing Jointly"

            # 2. Save a marker-tweaked config as the new defaults.
            marker = {**base, "household": {**base["household"], "first_name": "PYTEST_MARKER"}}
            r = client.post(f"{BASE_URL}/api/defaults/save", json={"config": marker}, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json() == {"saved": True}

            # 3. GET should now return the marker.
            after = client.get(f"{BASE_URL}/api/defaults", timeout=15).json()
            assert after["household"]["first_name"] == "PYTEST_MARKER"

            # 4. DELETE reverts to built-in DEFAULT_SCENARIO.
            r = client.delete(f"{BASE_URL}/api/defaults/save", timeout=15)
            assert r.status_code == 200, r.text
            assert r.json() == {"reverted": True}
            reverted = client.get(f"{BASE_URL}/api/defaults", timeout=15).json()
            assert reverted["household"].get("first_name") != "PYTEST_MARKER"
        finally:
            # Restore the caller's original defaults if they differ from built-in.
            current = client.get(f"{BASE_URL}/api/defaults", timeout=15).json()
            if pre != current:
                client.post(f"{BASE_URL}/api/defaults/save", json={"config": pre}, timeout=15)

    def test_save_defaults_requires_session_token(self):
        # No X-Session-Token header → 401.
        r = requests.post(
            f"{BASE_URL}/api/defaults/save",
            json={"config": {"projection": {"start_year": 2026, "end_year": 2050}}},
            timeout=15,
        )
        assert r.status_code == 401, r.text

    def test_save_defaults_rejects_oversized_horizon(self, client):
        # 200-year horizon busts the MAX_PROJECTION_YEARS cap → 400.
        r = client.post(
            f"{BASE_URL}/api/defaults/save",
            json={"config": {"projection": {"start_year": 2026, "end_year": 2226}}},
            timeout=15,
        )
        assert r.status_code == 400, r.text


# ---------- /api/tax/year ----------
class TestTaxYear:
    PAYLOAD = {
        "filing_status": "MFJ", "year": 2026, "bracket_index": 1.0,
        "irmaa_index": 1.0, "num_65plus": 0, "medicare_count": 0,
        "ordinary_non_ss": 350000, "ira_distributions": 0,
        "cash_interest": 3000, "gross_ss": 0,
        "recurring_div_ltcg": 150000, "realized_ltcg": 0,
        "state_rate": 0.0399, "include_irmaa": True,
    }

    def test_tax_year_exact_values(self, client):
        r = client.post(f"{BASE_URL}/api/tax/year", json={"inputs": self.PAYLOAD}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # expected exact values
        assert math.isclose(d["ordinary_taxable_income"], 320800, abs_tol=0.5), d
        assert math.isclose(d["federal_ltcg_tax"], 22500, abs_tol=0.5), d
        assert math.isclose(d["niit"], 5814, abs_tol=0.5), d
        assert math.isclose(d["federal_ordinary_tax"], 62148, abs_tol=0.5), d
        assert math.isclose(d["total_income_tax"], 109246.92, abs_tol=1.0), d

    def test_tax_year_separation_preferential_vs_ordinary(self, client):
        r = client.post(f"{BASE_URL}/api/tax/year", json={"inputs": self.PAYLOAD}, timeout=15)
        d = r.json()
        # ordinary tax computed only on ordinary; LTCG tax separate
        assert d["federal_ordinary_tax"] > 0
        assert d["federal_ltcg_tax"] > 0


# ---------- /api/tax/optimize ----------
class TestOptimize:
    def test_optimize_target_24(self, client):
        payload = TestTaxYear.PAYLOAD
        r = client.post(f"{BASE_URL}/api/tax/optimize",
                        json={"inputs": payload, "target_rate": 0.24, "max_conversion": 0},
                        timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert math.isclose(d["recommended_conversion"], 82750, abs_tol=1.0), d
        assert math.isclose(d["bracket_ceiling"], 403550, abs_tol=1.0), d
        assert "before" in d and "after" in d


# ---------- /api/projection ----------
class TestProjection:
    def test_projection_default_config(self, client):
        # Built-in code defaults — GET /api/defaults returns user-saved overrides,
        # which would make the 37-row expectation environment-dependent.
        import sys, copy
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from defaults import DEFAULT_SCENARIO
        defaults = copy.deepcopy(DEFAULT_SCENARIO)
        r = client.post(f"{BASE_URL}/api/projection", json={"config": defaults}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "rows" in d and "summary" in d
        assert len(d["rows"]) == 37, f"expected 37 rows, got {len(d['rows'])}"
        summary = d["summary"]
        for k in ["total_roth_converted", "lifetime_taxes", "ending_net_worth"]:
            assert k in summary
        # Survivor filing transition present (both MFJ and Single)
        statuses = {row.get("filing_status") for row in d["rows"]}
        assert "MFJ" in statuses
        assert "Single" in statuses, f"expected Single in {statuses}"


# ---------- /api/scenarios CRUD ----------
class TestScenariosCRUD:
    def test_scenarios_full_cycle(self, client):
        name = f"TEST_scn_{uuid.uuid4().hex[:6]}"
        defaults = client.get(f"{BASE_URL}/api/defaults").json()

        # CREATE
        r = client.post(f"{BASE_URL}/api/scenarios", json={"name": name, "config": defaults}, timeout=15)
        assert r.status_code == 200, r.text
        sc = r.json()
        sid = sc["id"]
        assert sc["name"] == name

        # LIST
        r = client.get(f"{BASE_URL}/api/scenarios", timeout=15)
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert sid in ids

        # GET by id
        r = client.get(f"{BASE_URL}/api/scenarios/{sid}", timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == name

        # DELETE
        r = client.delete(f"{BASE_URL}/api/scenarios/{sid}", timeout=15)
        assert r.status_code == 200

        # GET after delete => 404
        r = client.get(f"{BASE_URL}/api/scenarios/{sid}", timeout=15)
        assert r.status_code == 404


# ---------- /api/insights streaming (BYOK Gemini) ----------
class TestInsights:
    SUMMARY = {"mode": "single_year", "filing_status": "MFJ",
               "recommended_conversion": 82750, "bracket_ceiling": 403550,
               "before": {"total_burden": 109000},
               "after": {"total_burden": 130000}}

    def test_insights_uses_default_key_when_omitted(self, client):
        # api_key is optional — the server falls back to DEFAULT_GEMINI_API_KEY in .env.
        # We can't assume network access in every CI run, so just verify the request is
        # *accepted* (no longer 422) and produces either a streamed response or a
        # bounded upstream error (401/429/502) — never a validation failure.
        r = client.post(f"{BASE_URL}/api/insights", json={"summary": self.SUMMARY}, timeout=60)
        assert r.status_code in (200, 401, 429, 502), r.text
        assert r.status_code != 422

    def test_insights_rejects_invalid_key(self, client):
        r = client.post(f"{BASE_URL}/api/insights",
                        json={"summary": self.SUMMARY, "api_key": "AIzaFakeKeyForTest123"},
                        timeout=60)
        assert r.status_code == 401, r.text
        assert "Gemini API key" in r.json()["detail"]

    def test_insights_chat_rejects_invalid_key(self, client):
        r = client.post(f"{BASE_URL}/api/insights/chat",
                        json={"summary": self.SUMMARY, "api_key": "AIzaFakeKeyForTest123",
                              "history": [], "message": "Why 24%?"},
                        timeout=60)
        assert r.status_code == 401, r.text
        assert "Gemini API key" in r.json()["detail"]
