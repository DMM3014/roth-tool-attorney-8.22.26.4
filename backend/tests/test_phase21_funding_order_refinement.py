"""Tests for the funding-order refinement pass added to strategy_sweep.

Ensures:
  1. `refine_funding_orders=False` (default) produces no `funding_order_refinement` key
     — backwards compatible.
  2. `refine_funding_orders=True` produces the refinement structure with the top-2
     candidates from each of the material brackets (37/35/32/24/22) tested against
     all 3 funding orders, and reuses the sweep result for the baseline order.
  3. The `improvement` and `improvement_pct` are non-negative (the winner is at
     least as good as the baseline by construction).
  4. The `any_improvement` flag correctly reflects whether ANY candidate benefits
     from a swap.
"""
import copy
import pytest
from defaults import DEFAULT_SCENARIO
from strategy_optimizer import strategy_sweep, FUNDING_ORDERS, REFINE_BRACKETS


@pytest.fixture(scope="module")
def cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def test_refinement_omitted_by_default(cfg):
    """Backward compat: without the flag, no refinement key exists."""
    res = strategy_sweep(copy.deepcopy(cfg))
    assert "funding_order_refinement" not in res, "refinement key should be absent when flag is False"


def test_refinement_returns_expected_shape(cfg):
    """With the flag, refinement holds a baseline order + a list of candidates."""
    res = strategy_sweep(copy.deepcopy(cfg), refine_funding_orders=True)
    assert "funding_order_refinement" in res
    fr = res["funding_order_refinement"]
    assert "baseline_funding_order" in fr
    assert "candidates" in fr
    assert "any_improvement" in fr
    assert isinstance(fr["candidates"], list)
    # Should be at most 5 brackets × 2 top = 10 candidates
    assert len(fr["candidates"]) <= 10


def test_refinement_baseline_order_matches_cfg(cfg):
    """The reported baseline should match cfg.withdrawal.funding_order."""
    c = copy.deepcopy(cfg)
    c.setdefault("withdrawal", {})["funding_order"] = "Cash → Taxable → IRA → Roth"
    res = strategy_sweep(c, refine_funding_orders=True)
    assert res["funding_order_refinement"]["baseline_funding_order"] == "Cash → Taxable → IRA → Roth"


def test_each_candidate_has_all_three_orders(cfg):
    """Every candidate must have exactly 3 variants — one per funding order."""
    res = strategy_sweep(copy.deepcopy(cfg), refine_funding_orders=True)
    for c in res["funding_order_refinement"]["candidates"]:
        orders_seen = {v["funding_order"] for v in c["variants"]}
        assert orders_seen == set(FUNDING_ORDERS), (
            f"candidate {c['label']} missing variants: got {orders_seen}"
        )
        # exactly one is_baseline flag
        baselines = [v for v in c["variants"] if v.get("is_baseline")]
        assert len(baselines) == 1


def test_improvement_is_nonnegative(cfg):
    """Winner is by construction ≥ baseline, so improvement can't be negative."""
    res = strategy_sweep(copy.deepcopy(cfg), refine_funding_orders=True)
    for c in res["funding_order_refinement"]["candidates"]:
        assert c["improvement"] >= 0, f"negative improvement on {c['label']}"


def test_candidate_brackets_are_only_in_refine_brackets(cfg):
    """Only the material brackets (37/35/32/24/22) are refined — not 12."""
    res = strategy_sweep(copy.deepcopy(cfg), refine_funding_orders=True)
    seen_brackets = {c["bracket"] for c in res["funding_order_refinement"]["candidates"]}
    for br in seen_brackets:
        assert any(abs(br - target) < 1e-6 for target in REFINE_BRACKETS), (
            f"bracket {br} shouldn't be in refinement pool"
        )


def test_no_more_than_two_per_bracket(cfg):
    """Top-2 rule enforced per bracket."""
    res = strategy_sweep(copy.deepcopy(cfg), refine_funding_orders=True)
    from collections import Counter
    bracket_counts = Counter(c["bracket"] for c in res["funding_order_refinement"]["candidates"])
    for br, count in bracket_counts.items():
        assert count <= 2, f"bracket {br} produced {count} candidates (max 2)"


def test_any_improvement_flag_matches_data(cfg):
    """The summary flag should match whether any candidate has non-trivial improvement."""
    res = strategy_sweep(copy.deepcopy(cfg), refine_funding_orders=True)
    fr = res["funding_order_refinement"]
    actual_any = any(c["improvement"] > 1.0 for c in fr["candidates"])
    assert fr["any_improvement"] == actual_any


def test_funding_orders_produce_distinct_results(cfg):
    """REGRESSION: funding_order must actually affect the projection. If a bug ever
    causes the override to be silently ignored (e.g. wrong config key), all three
    variants would produce identical results — this asserts they don't.

    The DEFAULT_SCENARIO has a substantial IRA balance ($5M) that is NOT fully
    drained by conversions in a mid-bracket run, so switching between taxable-first
    and IRA-first funding MUST change discretionary IRA vs Taxable draws and thus
    the ending Roth balance and after-tax legacy.
    """
    res = strategy_sweep(copy.deepcopy(cfg), refine_funding_orders=True)
    # find any 22/24/32/35 candidate — they'll have material IRA balance during spend years
    for c in res["funding_order_refinement"]["candidates"]:
        legacies = [v["after_tax_estate"] for v in c["variants"]]
        distinct_values = len(set(round(x) for x in legacies))
        # For candidates with a bracket >= 22%, expect > 1 distinct legacy value across the 3 orders.
        if c.get("bracket") and c["bracket"] >= 0.22 - 1e-6:
            assert distinct_values > 1, (
                f"Funding order override didn't take effect for {c['label']} — "
                f"all 3 orders produced legacy {legacies[0]}. Check cfg['withdrawal'] key."
            )
            return  # one meaningful candidate is enough
    pytest.fail("No candidates in the refinement pool had a bracket >= 22%")
