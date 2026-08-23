"""Mortality Timing sensitivity — five death-timing scenarios."""
import copy

import pytest

from defaults import DEFAULT_SCENARIO
from projection import mortality_timing_compare, run_projection


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def _row(res, sid):
    return next(r for r in res["rows"] if r["id"] == sid)


def test_five_scenarios_present():
    res = mortality_timing_compare(_cfg())
    ids = [r["id"] for r in res["rows"]]
    assert ids == ["base", "first_earlier", "first_later", "second_earlier", "second_later"]


def test_base_matches_headline_outputs_exactly():
    base_proj = run_projection(_cfg())
    leg = base_proj["legacy"]
    base = _row(mortality_timing_compare(_cfg()), "base")
    assert base["net_worth_at_second_death"] == round(leg["gross_estate"], 2)
    assert base["after_tax_to_heirs_secure10"] == round(leg["after_tax_estate_to_heirs"], 2)


def test_second_death_later_increases_secure_window_end():
    res = mortality_timing_compare(_cfg())
    base_end = _row(res, "base")["secure_window_end_year"]
    later_end = _row(res, "second_later")["secure_window_end_year"]
    assert later_end > base_end


def test_second_death_earlier_not_after_base():
    res = mortality_timing_compare(_cfg())
    base_end = _row(res, "base")["secure_window_end_year"]
    earlier_end = _row(res, "second_earlier")["secure_window_end_year"]
    assert earlier_end <= base_end


def test_deltas_have_nominal_and_today():
    res = mortality_timing_compare(_cfg())
    for r in res["rows"]:
        assert "conversion_delta_nominal" in r and "conversion_delta_today" in r
        assert "bracket_compression_cost" in r and "single_filer_years" in r
