"""Phase 52 backend tests:
- POST /api/estate/fet-sensitivity — 9-cell grid, validators, monotonicity in growth rate
- POST /api/strategy-sweep — horizon_end_year extension keys and behavior
- Regressions: /api/projection and /api/estate/analyze
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": MASTER_PIN}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def default_config(auth_headers):
    r = requests.get(f"{BASE_URL}/api/defaults", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("config") or body


# ---------- FET sensitivity ----------

def _base_estate_payload():
    return {
        "first_death_year": 2050,
        "second_death_year": 2055,
        "deceased_roth_at_y1": 3_000_000,
        "deceased_taxable_at_y1": 2_000_000,
        "survivor_roth_at_y1": 3_000_000,
        "survivor_taxable_at_y1": 2_000_000,
        "traditional_at_y1": 1_000_000,
        "trust_growth_rate": 0.06,
        "survivor_growth_rate": 0.06,
        "heir_marginal_rate": 0.3165,
        "taxable_basis_pct": 0.5,
        "state_code": "",
        "use_portability": True,
        "gst_funding_order": "roth_first",
        "indexing_rate": 0.025,
        "horizons_after_second_death": [0],
    }


def test_fet_sensitivity_returns_9_cells(auth_headers):
    r = requests.post(f"{BASE_URL}/api/estate/fet-sensitivity",
                      json=_base_estate_payload(), headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    cells = body.get("cells") or body.get("grid") or []
    # tolerate either key at top level
    if not cells and isinstance(body, list):
        cells = body
    assert len(cells) == 9, f"expected 9 cells, got {len(cells)} body_keys={list(body.keys())}"
    required = {"death_offset", "growth_rate", "first_death_year", "second_death_year",
                "portability_fet", "gst_fet", "highest"}
    for c in cells:
        assert required.issubset(c.keys()), f"missing keys in cell: {required - set(c.keys())}"
        assert c["highest"] in ("portability", "gst_layered")


def test_fet_sensitivity_monotonic_in_growth(auth_headers):
    r = requests.post(f"{BASE_URL}/api/estate/fet-sensitivity",
                      json=_base_estate_payload(), headers=auth_headers, timeout=60)
    assert r.status_code == 200
    cells = r.json().get("cells") or []
    # Group by death_offset and check that FET increases (or equals) with growth for portability
    by_off = {}
    for c in cells:
        by_off.setdefault(c["death_offset"], []).append(c)
    for off, group in by_off.items():
        group.sort(key=lambda x: x["growth_rate"])
        port = [g["portability_fet"] for g in group]
        assert port[0] <= port[-1] + 1e-6, f"portability_fet not monotonic in growth for offset {off}: {port}"


def test_fet_sensitivity_clamps_bad_inputs(auth_headers):
    payload = _base_estate_payload()
    payload["growth_rates"] = [-1.0, 5.0, 0.99]  # will be clamped to [0.0, 0.5, 0.5]
    payload["death_offsets"] = [-999, 0, 999]     # clamp to [-30, 0, 30]
    r = requests.post(f"{BASE_URL}/api/estate/fet-sensitivity",
                      json=payload, headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    cells = r.json().get("cells") or []
    assert len(cells) == 9
    grs = sorted({round(c["growth_rate"], 4) for c in cells})
    offs = sorted({c["death_offset"] for c in cells})
    for g in grs:
        assert 0.0 <= g <= 0.5
    for o in offs:
        assert -30 <= o <= 30


# ---------- strategy sweep horizon ----------

def _sweep_payload(config, horizon=None):
    p = {
        "config": config,
        "start_years": [2026],
        "stop_years": [2030, 2035],
        "brackets": [0.24],
        "include_phased": False,
        "sweep_funding_orders": False,
    }
    if horizon is not None:
        p["horizon_end_year"] = horizon
    return p


def test_strategy_sweep_no_horizon_regression(default_config, auth_headers):
    plan_end = default_config["projection"]["end_year"]
    r = requests.post(f"{BASE_URL}/api/strategy-sweep",
                      json=_sweep_payload(default_config), headers=auth_headers, timeout=120)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "plan_end_year" in body
    assert "horizon_end_year_used" in body
    assert body["plan_end_year"] == plan_end
    assert body["horizon_end_year_used"] == plan_end


def test_strategy_sweep_with_extended_horizon(default_config, auth_headers):
    plan_end = default_config["projection"]["end_year"]
    horizon = plan_end + 6
    payload = _sweep_payload(default_config, horizon=horizon)
    # Include a stop-year beyond plan_end to prove extension
    payload["stop_years"] = [plan_end - 2, plan_end + 3, plan_end + 5]
    r = requests.post(f"{BASE_URL}/api/strategy-sweep", json=payload, headers=auth_headers, timeout=180)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan_end_year"] == plan_end
    assert body["horizon_end_year_used"] == horizon
    # Look for stop_years > plan_end in row output
    rows = body.get("rows") or body.get("results") or []
    stop_years = {r.get("stop_year") for r in rows if isinstance(r, dict)}
    assert any(sy and sy > plan_end for sy in stop_years), f"expected stop years beyond {plan_end}, got {stop_years}"


# ---------- regressions ----------

def test_projection_regression(default_config, auth_headers):
    r = requests.post(f"{BASE_URL}/api/projection", json={"config": default_config},
                      headers=auth_headers, timeout=90)
    assert r.status_code == 200, r.text
    assert "rows" in r.json() or "projection" in r.json()


def test_estate_analyze_regression(auth_headers):
    r = requests.post(f"{BASE_URL}/api/estate/analyze",
                      json=_base_estate_payload(), headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "outcomes" in body or "winner" in body
