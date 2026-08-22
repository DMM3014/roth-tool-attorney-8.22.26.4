"""Regression coverage for Cashflow per-stream income labels.

The standalone Cashflow tab renders `row.line_items.income`. Default income
streams use the canonical `description` field, so wages and pension streams
must remain separate line-item rows instead of collapsing to the generic
"Wages / other ordinary — Client" fallback.
"""
from __future__ import annotations

import copy

import pytest

from defaults import DEFAULT_SCENARIO
from projection import run_projection


def test_cashflow_income_line_items_use_stream_descriptions_for_2027():
    result = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    row_2027 = next(row for row in result["rows"] if row["year"] == 2027)
    income_by_source = {
        line["source"]: line for line in row_2027["line_items"]["income"]
    }

    assert "Client Wages" in income_by_source
    assert "Client Pension 1" in income_by_source
    assert "Wages / other ordinary — Client" not in income_by_source

    assert income_by_source["Client Wages"]["amount"] == pytest.approx(130373, abs=1)
    assert income_by_source["Client Pension 1"]["amount"] == pytest.approx(38081, abs=1)
    assert (
        income_by_source["Client Wages"]["amount"]
        + income_by_source["Client Pension 1"]["amount"]
    ) == pytest.approx(row_2027["cashflow"]["wages_pension"], abs=1)