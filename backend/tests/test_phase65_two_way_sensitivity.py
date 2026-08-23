"""Phase 65 — Two-way sensitivity: heir marginal rate x market regime.

`two_way_sensitivity(cfg)` evaluates heir_rate_sensitivity under every named market
regime and returns a matrix of the conversion delta in after-tax wealth to heirs plus
a per-regime interpolated (or extrapolated) break-even rate.
"""
import copy

import pytest

from defaults import DEFAULT_SCENARIO
from projection import two_way_sensitivity, _break_even_from_points, TWO_WAY_HEIR_RATES, TWO_WAY_CAPTION
from market_scenarios import PRESETS


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def test_shape_rates_regimes_and_matrix():
    res = two_way_sensitivity(_cfg())
    assert res["rates"] == list(TWO_WAY_HEIR_RATES)
    # custom is excluded; every other preset is a column.
    ids = [rg["preset_id"] for rg in res["regimes"]]
    assert ids == [p for p in PRESETS.keys() if p != "custom"]
    assert len(res["matrix"]) == len(res["rates"])
    for row in res["matrix"]:
        assert len(row) == len(res["regimes"])
    assert len(res["break_even"]) == len(res["regimes"])


def test_charity_row_label_and_rate():
    res = two_way_sensitivity(_cfg())
    assert res["rates"][0] == 0.0
    assert res["rate_labels"][0] == "0% (charity / no income tax)"


def test_caption_is_verbatim():
    res = two_way_sensitivity(_cfg())
    assert res["caption"] == (
        "The case for conversion should be judged across this whole surface, not at a "
        "single assumed cell. The break-even rate is an output of this household's facts "
        "and this model's assumptions — it moves with the dividend yield, the funding "
        "order, and the heirs' realization behavior, and should never be quoted from a "
        "case study."
    )


def test_break_even_interpolation_crossover():
    # delta crosses zero between 0.10 (+100) and 0.20 (-100) -> 0.15, not extrapolated.
    pts = [(0.0, 300.0), (0.10, 100.0), (0.20, -100.0), (0.41, -500.0)]
    rate, extrap = _break_even_from_points(pts)
    assert rate == pytest.approx(0.15, abs=1e-6)
    assert extrap is False


def test_break_even_extrapolation_when_no_crossover():
    # All deltas positive -> extrapolate the last segment linearly, flagged extrapolated.
    pts = [(0.0, 500.0), (0.10, 400.0), (0.41, 100.0)]
    rate, extrap = _break_even_from_points(pts)
    assert extrap is True
    # last segment slope = (100-400)/(0.41-0.10) ; continue to delta=0 (rounded to 4dp)
    assert rate == pytest.approx(0.41 - 100.0 * (0.41 - 0.10) / (100.0 - 400.0), abs=1e-3)


def test_regimes_produce_distinct_matrices():
    res = two_way_sensitivity(_cfg())
    # The historical_avg column should differ from at least one other regime column,
    # proving each regime re-runs the full projection (not a scaled baseline).
    cols = list(zip(*res["matrix"]))
    assert any(cols[0] != c for c in cols[1:])


def test_cache_identity():
    cfg = _cfg()
    a = two_way_sensitivity(cfg)
    b = two_way_sensitivity(copy.deepcopy(cfg))
    assert a is b
