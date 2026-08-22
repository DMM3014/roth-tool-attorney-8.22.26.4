"""Phase 29 — Monte Carlo stress test for Strategy Optimizer candidates."""
import copy
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from defaults import DEFAULT_SCENARIO  # noqa: E402
from strategy_optimizer import _apply_single_bracket  # noqa: E402
from strategy_stress import stress_test_strategies  # noqa: E402


@pytest.fixture
def cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def _specs(cfg, n=2):
    start = cfg["projection"]["start_year"]
    end = cfg["projection"]["end_year"]
    pool = [
        {"label": "S32", "kind": "single", "start_year": start, "stop_year": min(start + 6, end), "bracket": 0.32},
        {"label": "S24", "kind": "single", "start_year": start, "stop_year": end, "bracket": 0.24},
        {"label": "S35", "kind": "single", "start_year": start, "stop_year": min(start + 4, end), "bracket": 0.35},
    ]
    return pool[:n]


def test_stress_shape_and_baseline_prepended(cfg):
    out = stress_test_strategies(cfg, _specs(cfg), n_trials=100, engine="historical", seed=7)
    labels = [s["label"] for s in out["strategies"]]
    assert labels[0] == "No conversions"
    assert "S32" in labels and "S24" in labels
    s = out["strategies"][1]
    for key in ("success", "ending", "legacy", "seq_cohort", "paths",
                "robust_rank", "det_after_tax_estate", "det_ending_liquid"):
        assert key in s
    assert 0.0 <= s["success"] <= 1.0
    assert len(s["paths"]["p50"]) == len(out["years"])
    assert out["cohort"]["worst_pct"] == 5
    assert out["n_trials"] == 100


def test_stress_seed_deterministic(cfg):
    a = stress_test_strategies(cfg, _specs(cfg), n_trials=100, engine="historical", seed=42)
    b = stress_test_strategies(cfg, _specs(cfg), n_trials=100, engine="historical", seed=42)
    for sa, sb in zip(a["strategies"], b["strategies"]):
        assert sa["success"] == sb["success"]
        assert sa["ending"]["p50"] == sb["ending"]["p50"]
        assert sa["legacy"]["p10"] == sb["legacy"]["p10"]


def test_legacy_map_calibrates_to_deterministic(cfg):
    """legacy(det_ending_liquid) must reproduce the strategy's deterministic legacy."""
    out = stress_test_strategies(cfg, _specs(cfg), n_trials=60, engine="lognormal", seed=1)
    for s in out["strategies"]:
        approx = s["legacy"]["floor"] + s["legacy"]["slope"] * s["det_ending_liquid"]
        assert approx == pytest.approx(s["det_after_tax_estate"], rel=0.01)


def test_robust_rank_orders_by_p10_legacy(cfg):
    out = stress_test_strategies(cfg, _specs(cfg, 3), n_trials=100, engine="historical", seed=5)
    ranked = sorted(out["strategies"], key=lambda s: s["robust_rank"])
    p10s = [s["legacy"]["p10"] for s in ranked]
    assert p10s == sorted(p10s, reverse=True)
    assert out["robust_best_label"] == ranked[0]["label"]
    det_best = max(out["strategies"], key=lambda s: s["det_after_tax_estate"])
    assert out["deterministic_best_label"] == det_best["label"]
    assert out["robust_differs"] == (out["robust_best_label"] != out["deterministic_best_label"])


def test_lognormal_engine(cfg):
    out = stress_test_strategies(cfg, _specs(cfg, 1), n_trials=60, engine="lognormal", seed=3)
    assert out["engine"] == "lognormal"
    assert out["historical"] is None
    assert all(0.0 <= s["success"] <= 1.0 for s in out["strategies"])


def test_invalid_engine_raises(cfg):
    with pytest.raises(ValueError):
        stress_test_strategies(cfg, _specs(cfg, 1), n_trials=60, engine="bogus")


def test_phased_spec(cfg):
    start = cfg["projection"]["start_year"]
    end = cfg["projection"]["end_year"]
    pivot = min(start + 5, end - 1)
    spec = {"label": "Phased 32→24", "kind": "phased", "segments": [
        {"start_year": start, "stop_year": pivot, "bracket": 0.32},
        {"start_year": pivot + 1, "stop_year": end, "bracket": 0.24},
    ]}
    out = stress_test_strategies(cfg, [spec], n_trials=60, engine="historical", seed=2)
    labels = [s["label"] for s in out["strategies"]]
    assert "Phased 32→24" in labels


def test_strategy_cap(cfg):
    specs = _specs(cfg, 3) * 5  # 15 specs
    out = stress_test_strategies(cfg, specs, n_trials=50, engine="lognormal", seed=1)
    assert len(out["strategies"]) <= 13  # 12 cap + baseline


def test_apply_single_bracket_clears_stale_year_targets(cfg):
    """Regression: stale phased year_targets must not leak into single-bracket candidates."""
    start = cfg["projection"]["start_year"]
    cfg["roth"]["year_targets"] = {str(start): 0.37, str(start + 1): 0.37}
    c = _apply_single_bracket(cfg, start, start + 5, 0.24)
    assert "year_targets" not in c["roth"]
    assert c["roth"]["target_bracket"] == 0.24


# ---- SEC-001 (audit round 4): unbounded phased-segment year ranges must be rejected ----

def test_huge_segment_span_rejected_by_engine(cfg):
    spec = {"label": "evil", "kind": "phased", "segments": [
        {"start_year": -10**9, "stop_year": 10**9, "bracket": 0.24},
    ]}
    with pytest.raises(ValueError):
        stress_test_strategies(cfg, [spec], n_trials=50)


def test_reversed_segment_span_rejected_by_engine(cfg):
    start = cfg["projection"]["start_year"]
    spec = {"label": "rev", "kind": "phased", "segments": [
        {"start_year": start + 10, "stop_year": start, "bracket": 0.24},
    ]}
    with pytest.raises(ValueError):
        stress_test_strategies(cfg, [spec], n_trials=50)


def test_http_huge_segment_span_returns_400(cfg):
    """The endpoint must reject the OOM-DoS payload fast with a 400, never compute."""
    import requests
    base = os.environ.get("REACT_APP_BACKEND_URL") or open(
        "/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
    hdrs = {"X-Session-Token": "7c1e4b90-2d3f-4a5b-8c6d-9e0f1a2b3c4d"}
    payload = {"config": cfg, "n_trials": 50, "strategies": [
        {"label": "evil", "kind": "phased", "segments": [
            {"start_year": -1000000000, "stop_year": 1000000000, "bracket": 0.24}]}]}
    r = requests.post(f"{base}/api/strategy-stress", json=payload, headers=hdrs, timeout=15)
    assert r.status_code in (400, 422)


def test_http_requires_session_token(cfg):
    import requests
    base = os.environ.get("REACT_APP_BACKEND_URL") or open(
        "/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
    start = cfg["projection"]["start_year"]
    payload = {"config": cfg, "n_trials": 50, "strategies": [
        {"label": "S", "kind": "single", "start_year": start, "stop_year": start + 3, "bracket": 0.24}]}
    r = requests.post(f"{base}/api/strategy-stress", json=payload, timeout=15)
    assert r.status_code == 401


def test_http_out_of_range_single_years_rejected(cfg):
    import requests
    base = os.environ.get("REACT_APP_BACKEND_URL") or open(
        "/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
    hdrs = {"X-Session-Token": "7c1e4b90-2d3f-4a5b-8c6d-9e0f1a2b3c4d"}
    payload = {"config": cfg, "n_trials": 50, "strategies": [
        {"label": "S", "kind": "single", "start_year": -5000, "stop_year": 10**7, "bracket": 0.24}]}
    r = requests.post(f"{base}/api/strategy-stress", json=payload, headers=hdrs, timeout=15)
    assert r.status_code in (400, 422)
