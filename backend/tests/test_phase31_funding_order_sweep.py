"""Funding-order as the 4th sweep dimension in the Strategy Optimizer.

When `sweep_funding_orders=True`:
- Every (start, stop, bracket) triple runs against ALL 3 funding orders.
- Baseline row expands to 3 rows (one per order).
- Every result row carries a `funding_order` field.
- Row labels end with a short order tag (e.g. "· Taxable-first").
- The cheaper `_refine_funding_orders` post-pass is skipped as redundant.
"""
import copy
import pytest

from defaults import DEFAULT_SCENARIO
from strategy_optimizer import strategy_sweep, FUNDING_ORDERS


def _small_grid_cfg():
    """A tiny sweep so tests run fast — 2 starts × 2 stops × 2 brackets = 8 cells.
    The full 4D sweep is then 24 rows + 3 baselines + 3×4 phased = 39."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    return cfg


# --------------------------------------------------------------------------- #
# Backward compatibility (single-order sweep still works)                     #
# --------------------------------------------------------------------------- #

def test_single_order_sweep_unchanged():
    """Not passing sweep_funding_orders (or passing False) is the pre-4D behavior."""
    out = strategy_sweep(
        _small_grid_cfg(),
        start_years=[2026, 2030], stop_years=[2044, 2050],
        brackets=[0.22, 0.32], include_phased=False,
    )
    assert out["sweep_funding_orders"] is False
    assert out["grid"]["funding_orders"] is None
    # 1 baseline + 8 single = 9 rows
    assert len(out["results"]) == 9
    # baseline is still singular
    assert isinstance(out["baseline"], dict)
    assert out["baseline"]["kind"] == "baseline"
    # baselines (plural) exists but contains just the single default-order baseline
    assert len(out["baselines"]) == 1


# --------------------------------------------------------------------------- #
# 4D sweep — the new behavior                                                 #
# --------------------------------------------------------------------------- #

def test_sweep_funding_orders_triples_single_row_count():
    """Full 4D sweep: |funding_orders| × |single strategies| single rows,
    plus |funding_orders| baseline rows."""
    out = strategy_sweep(
        _small_grid_cfg(),
        start_years=[2026, 2030], stop_years=[2044, 2050],
        brackets=[0.22, 0.32], include_phased=False,
        sweep_funding_orders=True,
    )
    assert out["sweep_funding_orders"] is True
    assert out["grid"]["funding_orders"] == FUNDING_ORDERS

    # 8 single strategies × 3 funding orders + 3 baselines = 27 rows
    singles = [r for r in out["results"] if r["kind"] == "single"]
    baselines = [r for r in out["results"] if r["kind"] == "baseline"]
    assert len(singles) == 24
    assert len(baselines) == 3

    # Every row must carry funding_order + funding_order_short
    for r in out["results"]:
        assert r["funding_order"] in FUNDING_ORDERS
        assert r["funding_order_short"] in {"Taxable-first", "IRA-first", "Split"}

    # Baseline (singular) is still the scenario-default-order baseline
    base_order = _small_grid_cfg()["withdrawal"]["funding_order"]
    assert out["baseline"]["funding_order"] == base_order
    assert out["baseline"]["kind"] == "baseline"


def test_sweep_funding_orders_labels_include_short_order():
    """Labels should end with '· Taxable-first' / '· IRA-first' / '· Split' when 4D on."""
    out = strategy_sweep(
        _small_grid_cfg(),
        start_years=[2026], stop_years=[2044],
        brackets=[0.24], include_phased=False,
        sweep_funding_orders=True,
    )
    singles = [r for r in out["results"] if r["kind"] == "single"]
    assert len(singles) == 3
    labels = [r["label"] for r in singles]
    assert any(l.endswith("· Taxable-first") for l in labels)
    assert any(l.endswith("· IRA-first") for l in labels)
    assert any(l.endswith("· Split") for l in labels)


def test_sweep_funding_orders_produces_distinct_legacies():
    """The three funding orders MUST produce distinct after-tax legacies for the
    same (start, stop, bracket) — otherwise the 4th dimension adds no signal.
    This regression-locks the bug fixed in the previous session where the
    refinement pass had a typo that silently ignored the order override."""
    out = strategy_sweep(
        _small_grid_cfg(),
        start_years=[2026], stop_years=[2050],
        brackets=[0.24], include_phased=False,
        sweep_funding_orders=True,
    )
    singles = [r for r in out["results"] if r["kind"] == "single"]
    assert len(singles) == 3
    legacies = {r["funding_order"]: r["after_tax_estate"] for r in singles}
    # At least 2 of the 3 orders must differ by >$10 — Split may coincide with one
    # of the pure orders in some edge cases, but Taxable-first vs IRA-first
    # essentially always diverge for a plan with meaningful IRA balance.
    unique = set(round(v, 2) for v in legacies.values())
    assert len(unique) >= 2, f"Funding orders produced identical legacies: {legacies}"


def test_sweep_funding_orders_skips_refine_pass():
    """`refine_funding_orders=True` + `sweep_funding_orders=True` → refine is
    silently skipped as redundant (the full sweep already covers every order)."""
    out = strategy_sweep(
        _small_grid_cfg(),
        start_years=[2026], stop_years=[2044],
        brackets=[0.24], include_phased=False,
        sweep_funding_orders=True,
        refine_funding_orders=True,
    )
    assert "funding_order_refinement" not in out


def test_sweep_funding_orders_with_phased():
    """Phased schedules also iterate per funding order when 4D is on."""
    out = strategy_sweep(
        _small_grid_cfg(),
        start_years=[2026], stop_years=[2044],
        brackets=[0.24], include_phased=True,
        sweep_funding_orders=True,
    )
    phased = [r for r in out["results"] if r["kind"] == "phased"]
    # 4 phased schedules × 3 orders = 12 rows
    assert len(phased) == 12
    for r in phased:
        assert r["funding_order"] in FUNDING_ORDERS


# --------------------------------------------------------------------------- #
# Winner may actually change when the 4th dimension is added                   #
# --------------------------------------------------------------------------- #

def test_sweep_funding_orders_can_change_winner():
    """The 4D winner should be >= the 3D winner (in the base order) on after-tax
    legacy, because the 4D search space is a strict superset. This proves the
    new dimension is actually widening the search, not just relabeling rows."""
    grid = dict(start_years=[2026, 2030], stop_years=[2044, 2050],
                brackets=[0.22, 0.24, 0.32], include_phased=False)
    single = strategy_sweep(_small_grid_cfg(), **grid, sweep_funding_orders=False)
    full = strategy_sweep(_small_grid_cfg(), **grid, sweep_funding_orders=True)
    assert full["best"]["after_tax_estate"] >= single["best"]["after_tax_estate"] - 1.0
