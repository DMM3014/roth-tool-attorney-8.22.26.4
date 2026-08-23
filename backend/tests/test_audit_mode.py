"""Audit Mode — assumption diff + attribution waterfall over two planner configs."""
import copy

import pytest

from defaults import DEFAULT_SCENARIO
from projection import audit_compare


def _base():
    return copy.deepcopy(DEFAULT_SCENARIO)


def _find_taxable_index(cfg):
    for i, a in enumerate(cfg["accounts"]):
        if a["tax_type"] == "Taxable":
            return i
    raise AssertionError("no taxable account in default scenario")


def _two_diff_configs():
    """review vs planner differing in EXACTLY two leaves:
    - a taxable account return (review 0.07 vs planner 0.08)
    - heir federal rate (review 0.36 vs planner 0.26)."""
    review = _base()
    planner = _base()
    ti = _find_taxable_index(review)
    review["accounts"][ti]["return"] = 0.07
    planner["accounts"][ti]["return"] = 0.08
    review["legacy"]["heir_federal_rate"] = 0.36
    planner["legacy"]["heir_federal_rate"] = 0.26
    return review, planner, ti


def test_diff_finds_exactly_the_two_changed_keys():
    review, planner, ti = _two_diff_configs()
    res = audit_compare(review, planner)
    paths = {d["path"] for d in res["assumption_diff"]["list"]}
    assert paths == {f"accounts[{ti}].return", "legacy.heir_federal_rate"}
    assert res["assumption_diff"]["count"] == 2
    # values captured both ways
    hr = next(d for d in res["assumption_diff"]["list"] if d["path"] == "legacy.heir_federal_rate")
    assert hr["review"] == 0.36 and hr["planner"] == 0.26
    assert hr["section"] == "legacy & heirs"


def test_attribution_rows_sum_to_total_gap_within_residual():
    review, planner, _ = _two_diff_configs()
    res = audit_compare(review, planner)
    attr = res["attribution"]
    steps = [w for w in attr["waterfall"] if w["type"] == "step"]
    explained = sum(s["value"] for s in steps)
    # steps + interaction residual must exactly reconstruct the total gap
    assert explained == pytest.approx(attr["explained"], abs=0.5)
    assert (explained + attr["interaction_residual"]) == pytest.approx(attr["total_gap"], abs=0.5)
    # waterfall must start at planner and end at review
    assert attr["waterfall"][0]["type"] == "start"
    assert attr["waterfall"][0]["value"] == pytest.approx(attr["planner_outcome"], abs=0.5)
    assert attr["waterfall"][-1]["type"] == "end"
    assert attr["waterfall"][-1]["value"] == pytest.approx(attr["review_outcome"], abs=0.5)
    assert attr["waterfall"][-1]["cumulative"] == pytest.approx(attr["review_outcome"], abs=0.5)


def test_outcome_deltas_present_nominal_and_today():
    review, planner, _ = _two_diff_configs()
    res = audit_compare(review, planner)
    d = res["outcomes"]["deltas"]
    for k in ("net_worth_at_second_death", "after_tax_to_heirs_secure10",
              "lifetime_tax_nominal", "lifetime_tax_npv", "total_conversions",
              "federal_estate_tax_no_trust"):
        assert k in d
        assert "delta_nominal" in d[k] and "delta_today" in d[k]
        assert d[k]["delta_nominal"] == pytest.approx(d[k]["review"] - d[k]["planner"], abs=0.5)


def test_identical_configs_empty_diff_zero_deltas():
    cfg = _base()
    res = audit_compare(cfg, copy.deepcopy(cfg))
    assert res["assumption_diff"]["count"] == 0
    assert res["assumption_diff"]["list"] == []
    for k, v in res["outcomes"]["deltas"].items():
        assert v["delta_nominal"] == pytest.approx(0.0, abs=0.5)
        assert v["delta_today"] == pytest.approx(0.0, abs=0.5)
    assert res["attribution"]["total_gap"] == pytest.approx(0.0, abs=0.5)
    assert res["attribution"]["interaction_residual"] == pytest.approx(0.0, abs=0.5)


def test_attribution_capped_at_12():
    review = _base()
    planner = _base()
    # Create many diffs by nudging every account return.
    for a in planner["accounts"]:
        a["return"] = round((a.get("return") or 0.05) + 0.005, 4)
    planner["projection"]["general_inflation"] = (review["projection"]["general_inflation"] or 0.03) + 0.002
    res = audit_compare(review, planner)
    assert res["attribution"]["n_attributed"] <= 12
    steps = [w for w in res["attribution"]["waterfall"] if w["type"] == "step"]
    assert len(steps) <= 12
    # residual still closes the gap exactly
    explained = sum(s["value"] for s in steps)
    assert (explained + res["attribution"]["interaction_residual"]) == pytest.approx(res["attribution"]["total_gap"], abs=0.5)
