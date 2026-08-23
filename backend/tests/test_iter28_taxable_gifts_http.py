"""Iteration 19 — HTTP tests for taxable lifetime gifts (Stage 2).

Covers:
  * POST /api/projection -> result.giving.taxable_gifts + carryover_basis
  * Joint gift 50/50 split, absence of keys without gifts
  * POST /api/estate/analyze -> adjusted_gifts_first_death/_second_death §2001(b)
"""
import copy
import os
import sys

import pytest
import requests
from dotenv import dotenv_values

sys.path.insert(0, "/app/backend")

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL", "")).rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"

MASTER_PIN = dotenv_values("/app/backend/.env").get("MASTER_ADMIN_PIN")


@pytest.fixture(scope="session")
def token():
    if not MASTER_PIN:
        pytest.fail("MASTER_ADMIN_PIN missing from /app/backend/.env")
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": MASTER_PIN}, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"auth failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in {r.json()}"
    return tok


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def base_scenario():
    from defaults import DEFAULT_SCENARIO
    return copy.deepcopy(DEFAULT_SCENARIO)


def _project(client, cfg):
    r = client.post(f"{BASE_URL}/api/projection", json={"config": cfg}, timeout=180)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
    body = r.json()
    return body.get("result", body)


# --- projection: no gifts -> keys absent -------------------------------------
def test_projection_without_gifts_omits_gift_keys(client, base_scenario):
    res = _project(client, base_scenario)
    giving = res["giving"]
    assert "taxable_gifts" not in giving
    assert "carryover_basis" not in giving


# --- projection: client + joint gifts ---------------------------------------
@pytest.fixture(scope="session")
def gift_result(client, base_scenario):
    cfg = copy.deepcopy(base_scenario)
    sy = cfg["projection"]["start_year"]
    cfg.setdefault("giving", {})["taxable_gifts"] = [
        {"year": sy + 1, "amount": 2_000_000, "donor": "Client"},
        {"year": sy + 2, "amount": 1_000_000, "donor": "Joint"},
    ]
    return _project(client, cfg)


def test_taxable_gifts_block_shape_and_joint_split(gift_result):
    tg = gift_result["giving"]["taxable_gifts"]
    for k in ("by_donor", "first_decedent", "adjusted_gifts_first_death",
              "adjusted_gifts_second_death", "total", "rows"):
        assert k in tg, f"missing key {k}"
    # Joint splits 50/50: Client 2.0M + 0.5M, Spouse 0.5M
    assert abs(tg["by_donor"]["Client"] - 2_500_000.0) < 1.0
    assert abs(tg["by_donor"]["Spouse"] - 500_000.0) < 1.0
    assert abs(tg["total"] - 3_000_000.0) < 1.0
    assert len(tg["rows"]) == 2
    assert tg["first_decedent"] in ("Client", "Spouse")
    assert abs((tg["adjusted_gifts_first_death"] + tg["adjusted_gifts_second_death"]) - tg["total"]) < 1.0


def test_carryover_basis_block(gift_result):
    g = gift_result["giving"]
    cob = g["carryover_basis"]
    for k in ("pot_basis", "embedded_gain", "heir_ltcg_rate", "ltcg_owed_at_sale", "pot_after_tax"):
        assert k in cob, f"missing key {k}"
    pot = g["ending_pot"]
    assert cob["pot_basis"] >= 0
    assert cob["embedded_gain"] == pytest.approx(round(max(0.0, pot - cob["pot_basis"]), 2), abs=1.0)
    assert cob["ltcg_owed_at_sale"] == pytest.approx(
        round(cob["embedded_gain"] * cob["heir_ltcg_rate"], 2), abs=1.0)
    assert cob["pot_after_tax"] == pytest.approx(round(pot - cob["ltcg_owed_at_sale"], 2), abs=1.0)
    assert 0.0 <= cob["heir_ltcg_rate"] < 0.5


# --- estate/analyze §2001(b) -------------------------------------------------
def _estate_payload(**over):
    p = dict(
        first_death_year=2040, second_death_year=2045,
        deceased_roth_at_y1=0.0, deceased_taxable_at_y1=50_000_000.0,
        survivor_roth_at_y1=0.0, survivor_taxable_at_y1=0.0,
        traditional_at_y1=0.0, indexing_rate=0.03, use_portability=True,
        state_code="", y2_roth=0.0, y2_taxable=60_000_000.0, y2_traditional=0.0,
        horizons_after_second_death=[0],
    )
    p.update(over)
    return p


def _analyze(client, payload):
    r = client.post(f"{BASE_URL}/api/estate/analyze", json=payload, timeout=120)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
    body = r.json()
    return body.get("result", body)


def test_estate_analyze_gift_adds_exactly_40pct(client):
    base = _analyze(client, _estate_payload())
    gifted = _analyze(client, _estate_payload(adjusted_gifts_first_death=5_000_000.0))
    b = base["outcomes"]["portability"]["fed_tax"]
    g = gifted["outcomes"]["portability"]["fed_tax"]
    assert abs((g - b) - 2_000_000.0) < 1.0, f"delta={g-b} (base={b}, gifted={g})"


def test_estate_analyze_gift_split_equivalence(client):
    single = _analyze(client, _estate_payload(adjusted_gifts_first_death=5_000_000.0))
    split = _analyze(client, _estate_payload(adjusted_gifts_first_death=2_500_000.0,
                                            adjusted_gifts_second_death=2_500_000.0))
    assert abs(single["outcomes"]["portability"]["fed_tax"]
               - split["outcomes"]["portability"]["fed_tax"]) < 1.0


def test_estate_analyze_gifts_default_to_zero(client):
    """Omitting the new fields must equal explicitly passing 0.0."""
    a = _analyze(client, _estate_payload())
    b = _analyze(client, _estate_payload(adjusted_gifts_first_death=0.0,
                                         adjusted_gifts_second_death=0.0))
    assert a["outcomes"]["portability"]["fed_tax"] == b["outcomes"]["portability"]["fed_tax"]


def test_estate_analyze_rejects_negative_gifts(client):
    r = client.post(f"{BASE_URL}/api/estate/analyze",
                    json=_estate_payload(adjusted_gifts_first_death=-1.0), timeout=60)
    assert r.status_code == 422, f"expected 422, got {r.status_code}"


# --- validation on projection gift rows -------------------------------------
def test_projection_rejects_or_ignores_bad_donor(client, base_scenario):
    cfg = copy.deepcopy(base_scenario)
    sy = cfg["projection"]["start_year"]
    cfg.setdefault("giving", {})["taxable_gifts"] = [
        {"year": sy + 1, "amount": 1_000_000, "donor": "Bogus"},
    ]
    r = client.post(f"{BASE_URL}/api/projection", json={"config": cfg}, timeout=180)
    assert r.status_code in (200, 422), f"{r.status_code}: {r.text[:300]}"
    if r.status_code == 200:
        body = r.json()
        res = body.get("result", body)
        tg = res["giving"].get("taxable_gifts")
        # Unknown donor must not crash; if kept it should default to a known donor.
        if tg:
            assert set(tg["by_donor"].keys()) <= {"Client", "Spouse"}
