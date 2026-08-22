"""Monte Carlo regime-comparison endpoint tests.

Verifies that POST /api/montecarlo/regime-compare correctly runs the same MC
simulation across all market-scenario presets and returns a compact per-preset
result table. This is the feature that lets advisors show a client how sensitive
the plan's success rate is to the assumed market regime.
"""
import copy
import uuid
import json

import pytest
from starlette.testclient import TestClient

from server import app
from defaults import DEFAULT_SCENARIO


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def sess():
    return str(uuid.uuid4())


# --------------------------------------------------------------------------- #
# Happy path                                                                  #
# --------------------------------------------------------------------------- #

def test_regime_compare_returns_row_per_preset(client, sess):
    payload = {"config": DEFAULT_SCENARIO, "n_trials": 100, "engine": "lognormal", "seed": 42}
    r = client.post("/api/montecarlo/regime-compare", json=payload,
                    headers={"X-Session-Token": sess})
    assert r.status_code == 200
    body = r.json()
    assert body["baseline_id"] == "historical_avg"
    assert body["n_trials"] == 100
    assert body["engine"] == "lognormal"
    ids = [row["preset_id"] for row in body["rows"]]
    # Every preset except 'custom' by default
    assert set(ids) == {"historical_avg", "last_50_years", "70s_stagflation",
                        "lost_decade", "high_inflation", "low_return"}
    # Sorted by success descending
    successes = [row["success"] for row in body["rows"]]
    assert successes == sorted(successes, reverse=True)


def test_regime_compare_reflects_current_baseline(client, sess):
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    cfg["market_scenario"] = {"id": "70s_stagflation"}
    payload = {"config": cfg, "n_trials": 100, "engine": "lognormal", "seed": 42}
    r = client.post("/api/montecarlo/regime-compare", json=payload,
                    headers={"X-Session-Token": sess})
    assert r.status_code == 200
    assert r.json()["baseline_id"] == "70s_stagflation"


def test_regime_compare_rows_carry_headline_metrics(client, sess):
    payload = {"config": DEFAULT_SCENARIO, "n_trials": 100, "engine": "lognormal", "seed": 42}
    r = client.post("/api/montecarlo/regime-compare", json=payload,
                    headers={"X-Session-Token": sess})
    for row in r.json()["rows"]:
        for k in ("preset_id", "label", "success", "depleted_pct", "p10", "p50", "p90", "mean", "min"):
            assert k in row, f"missing {k} on {row.get('preset_id')}"
        # Success is a rate in [0, 1]
        assert 0.0 <= row["success"] <= 1.0


def test_regime_compare_last_50_years_beats_lost_decade(client, sess):
    """Sanity check: the plan's success rate under the cheerful 'Last 50 Years'
    regime MUST be higher than under 'Lost Decade' — otherwise the preset
    overrides aren't actually flowing to the MC engine."""
    payload = {"config": DEFAULT_SCENARIO, "n_trials": 500, "engine": "lognormal", "seed": 42}
    r = client.post("/api/montecarlo/regime-compare", json=payload,
                    headers={"X-Session-Token": sess})
    rows = {row["preset_id"]: row["success"] for row in r.json()["rows"]}
    assert rows["last_50_years"] > rows["lost_decade"]
    assert rows["last_50_years"] > rows["historical_avg"]


# --------------------------------------------------------------------------- #
# Custom preset list                                                          #
# --------------------------------------------------------------------------- #

def test_regime_compare_accepts_custom_preset_list(client, sess):
    payload = {
        "config": DEFAULT_SCENARIO, "n_trials": 100, "engine": "lognormal", "seed": 42,
        "preset_ids": ["historical_avg", "last_50_years", "lost_decade"],
    }
    r = client.post("/api/montecarlo/regime-compare", json=payload,
                    headers={"X-Session-Token": sess})
    assert r.status_code == 200
    ids = [row["preset_id"] for row in r.json()["rows"]]
    assert set(ids) == {"historical_avg", "last_50_years", "lost_decade"}


def test_regime_compare_dedupes_preset_list(client, sess):
    payload = {
        "config": DEFAULT_SCENARIO, "n_trials": 100, "engine": "lognormal", "seed": 42,
        "preset_ids": ["last_50_years", "last_50_years", "historical_avg"],
    }
    r = client.post("/api/montecarlo/regime-compare", json=payload,
                    headers={"X-Session-Token": sess})
    rows = r.json()["rows"]
    assert len(rows) == 2   # duplicates removed


# --------------------------------------------------------------------------- #
# Validation                                                                  #
# --------------------------------------------------------------------------- #

def test_regime_compare_rejects_missing_session(client):
    r = client.post("/api/montecarlo/regime-compare",
                    json={"config": DEFAULT_SCENARIO, "n_trials": 100})
    assert r.status_code == 401


def test_regime_compare_rejects_excessive_trials(client, sess):
    r = client.post("/api/montecarlo/regime-compare",
                    json={"config": DEFAULT_SCENARIO, "n_trials": 5000},
                    headers={"X-Session-Token": sess})
    assert r.status_code == 422


def test_regime_compare_rejects_over_6_presets(client, sess):
    r = client.post("/api/montecarlo/regime-compare",
                    json={"config": DEFAULT_SCENARIO, "n_trials": 100,
                          "preset_ids": ["a", "b", "c", "d", "e", "f", "g"]},
                    headers={"X-Session-Token": sess})
    assert r.status_code == 422


def test_regime_compare_rejects_invalid_engine(client, sess):
    r = client.post("/api/montecarlo/regime-compare",
                    json={"config": DEFAULT_SCENARIO, "n_trials": 100, "engine": "not_a_real_engine"},
                    headers={"X-Session-Token": sess})
    assert r.status_code == 422
