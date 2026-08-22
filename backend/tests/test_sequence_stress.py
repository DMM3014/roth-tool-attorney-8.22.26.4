"""Sequence-of-returns stress test — engine-level checks.

The contract that matters: a mean-preserved path must compound to the SAME total
as the flat assumption (so any difference in the result is sequence risk, not a
worse market), while a raw bear path must land below it.
"""
import copy

import pytest

from defaults import DEFAULT_SCENARIO
from projection import run_projection
from sequence_stress import (
    DEFAULT_PARAMS, build_paths, run_sequence_stress, _blend, _cagr,
    _equity_share, _ref_return,
)


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def _last_conversion_year(cfg):
    rows = run_projection(copy.deepcopy(cfg))["rows"]
    years = [r["year"] for r in rows if (r.get("roth_conversion") or 0) > 0]
    return years[-1] if years else None


def test_paths_cover_every_scenario_and_variant():
    cfg = _cfg()
    paths = build_paths(cfg, None, _last_conversion_year(cfg))
    keys = {p["key"] for p in paths}
    assert keys == {
        "early_bear__raw", "early_bear__mean_preserved",
        "late_bear_projection__raw", "late_bear_projection__mean_preserved",
        "late_bear_conversion__raw", "late_bear_conversion__mean_preserved",
        "volatility__raw", "volatility__mean_preserved",
    }
    n = cfg["projection"]["end_year"] - cfg["projection"]["start_year"] + 1
    for p in paths:
        assert len(p["equity"]) == n


def test_bear_legs_land_where_advertised():
    cfg = _cfg()
    start = cfg["projection"]["start_year"]
    end = cfg["projection"]["end_year"]
    conv_end = _last_conversion_year(cfg)
    by = {p["key"]: p for p in build_paths(cfg, None, conv_end)}

    early = by["early_bear__raw"]
    assert early["bear_years"] == [start, start + 1, start + 2]
    assert early["equity"][:3] == [DEFAULT_PARAMS["bear_return"]] * 3

    late = by["late_bear_projection__raw"]
    assert late["bear_years"][-1] == end
    assert len(late["bear_years"]) == DEFAULT_PARAMS["late_years"]

    conv = by["late_bear_conversion__raw"]
    assert conv["bear_years"][-1] == conv_end
    assert conv["bear_years"][0] == conv_end - DEFAULT_PARAMS["late_years"] + 1


def test_mean_preserved_paths_compound_to_the_flat_assumption():
    cfg = _cfg()
    r_ref = _ref_return(cfg)
    w = _equity_share(cfg)
    for p in build_paths(cfg, None, _last_conversion_year(cfg)):
        blended = _cagr([_blend(w, e, r_ref) for e in p["equity"]])
        if p["variant"] == "mean_preserved":
            assert blended == pytest.approx(r_ref, abs=1e-5), p["key"]
        else:
            assert blended < r_ref, p["key"]


def test_mean_preserved_path_reaches_the_same_balance_with_no_cashflows():
    """With spending, income, conversions and taxes switched off, a mean-preserved
    sequence must finish exactly where the flat projection finishes — that is what
    makes the stress test a clean read on ORDER rather than level."""
    cfg = _cfg()
    cfg["income_streams"] = []
    cfg["expenses"] = []
    cfg["roth"] = {**cfg["roth"], "enabled": False}
    flat = run_projection(copy.deepcopy(cfg))

    path = next(p for p in build_paths(cfg) if p["key"] == "early_bear__mean_preserved")
    seq_cfg = copy.deepcopy(cfg)
    seq_cfg["return_path"] = {"start_year": path["start_year"], "equity_share": path["equity_share"],
                              "equity_returns": path["equity"]}
    seq = run_projection(seq_cfg)

    a = flat["summary"]["ending_net_worth"]
    b = seq["summary"]["ending_net_worth"]
    assert b == pytest.approx(a, rel=0.02), (a, b)


def test_return_path_is_ignored_outside_its_years_and_absent_by_default():
    cfg = _cfg()
    before = run_projection(copy.deepcopy(cfg))["summary"]["ending_net_worth"]
    cfg["return_path"] = {"start_year": 3000, "equity_share": 0.6, "equity_returns": [-0.9] * 5}
    after = run_projection(cfg)["summary"]["ending_net_worth"]
    assert after == before


def test_early_bear_hurts_more_than_the_same_bear_at_the_end():
    """Sequence risk in one assertion: identical mean-preserved paths, the crash
    early vs the crash late, and the early one must leave the household poorer."""
    cfg = _cfg()
    by = {p["key"]: p for p in build_paths(cfg, None, _last_conversion_year(cfg))}

    def ending(path):
        c = copy.deepcopy(cfg)
        c["return_path"] = {"start_year": path["start_year"], "equity_share": path["equity_share"],
                            "equity_returns": path["equity"]}
        return run_projection(c)["summary"]["ending_net_worth"]

    early = ending(by["early_bear__mean_preserved"])
    late = ending(by["late_bear_projection__mean_preserved"])
    assert early < late


def test_run_sequence_stress_reports_both_runs_and_tax_saved():
    out = run_sequence_stress(_cfg())
    assert out["baseline"]["with_conversions"]["total_converted"] > 0
    assert out["baseline"]["without_conversions"]["total_converted"] == 0
    assert len(out["scenarios"]) == 8
    for s in out["scenarios"]:
        assert s["with_conversions"]["lifetime_taxes"] > 0
        assert s["without_conversions"]["lifetime_taxes"] > 0
        assert s["tax_saved_by_converting"] == pytest.approx(
            s["without_conversions"]["lifetime_taxes"] - s["with_conversions"]["lifetime_taxes"], abs=0.01)
        assert "vs_baseline" in s


def test_bear_severity_is_advisor_editable():
    cfg = _cfg()
    paths = {p["key"]: p for p in build_paths(cfg, {"bear_return": -0.30, "early_years": 5},
                                              _last_conversion_year(cfg))}
    early = paths["early_bear__raw"]
    assert len(early["bear_years"]) == 5
    assert early["equity"][:5] == [-0.30] * 5


def test_sequence_stress_http_endpoint():
    """POST /api/sequence-stress returns the baseline plus 8 paths."""
    import os
    import requests

    base = os.environ.get("REACT_APP_BACKEND_URL",
                          "https://roth-retirement-tool.preview.emergentagent.com").rstrip("/")
    tok = requests.post(f"{base}/api/auth/pin/verify",
                        json={"pin": "i4m07MnVDhpTYkc1giC6wWDv"}, timeout=15).json()["token"]
    r = requests.post(f"{base}/api/sequence-stress",
                      json={"config": copy.deepcopy(DEFAULT_SCENARIO),
                            "params": {"bear_return": -0.15}},
                      headers={"Authorization": f"Bearer {tok}"}, timeout=180)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["scenarios"]) == 8
    assert body["baseline"]["with_conversions"]["lifetime_taxes"] > 0
    assert body["params"]["bear_return"] == -0.15


def test_conversion_anchor_uses_the_last_year_money_is_actually_converted():
    """The permitted window runs to 2062 but the IRA empties earlier — the
    conversion-window bear must land on the real last conversion year, and the
    scenario collapses to one late-bear row when the two anchors coincide."""
    cfg = _cfg()
    last = _last_conversion_year(cfg)
    assert last is not None and last < cfg["projection"]["end_year"]
    by = {p["key"]: p for p in build_paths(cfg, None, last)}
    assert by["late_bear_conversion__raw"]["bear_years"][-1] == last

    # No last-conversion hint => the anchor equals the projection anchor and the
    # duplicate row is dropped rather than printed twice.
    keys = {p["scenario"] for p in build_paths(cfg)}
    assert "late_bear_conversion" not in keys
