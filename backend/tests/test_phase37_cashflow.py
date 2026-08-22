"""Phase 37 — Full income & expense cashflow statement.

Locks the per-year `line_items` sub-object that `projection.py` emits on every
row. The Cashflow tab feeds directly off these objects, so:
  * income + expenses subtotals must reconcile to the cent
  * per-line-item amounts must sum to the reported subtotal
  * ROTH CONVERSIONS must live in `non_cash_events` (never in `income`) so the
    income subtotal isn't overstated by the conversion amount
  * The funding block must equal calc.cash_drawn / calc.ira_withdraw / etc.
"""
from __future__ import annotations
import copy

import pytest

from projection import run_projection, _income_line_items, _expense_line_items
from defaults import DEFAULT_SCENARIO


@pytest.fixture(scope="module")
def default_run():
    return run_projection(copy.deepcopy(DEFAULT_SCENARIO))


def test_every_row_has_line_items_with_required_shape(default_run):
    for row in default_run["rows"]:
        li = row.get("line_items")
        assert li is not None, f"year {row['year']} missing line_items"
        for k in ("income", "expenses", "funding", "subtotals", "non_cash_events"):
            assert k in li, f"year {row['year']} line_items missing {k}"
        for k in ("income", "expenses", "net_cashflow", "funding_drawn", "surplus"):
            assert k in li["subtotals"], f"year {row['year']} subtotals missing {k}"
        for k in ("from_cash", "from_taxable", "from_ira", "from_roth"):
            assert k in li["funding"], f"year {row['year']} funding missing {k}"


def test_income_line_amounts_sum_to_subtotal(default_run):
    for row in default_run["rows"]:
        li = row["line_items"]
        total = sum(x["amount"] for x in li["income"])
        assert total == pytest.approx(li["subtotals"]["income"], abs=0.5), \
            f"year {row['year']} income lines {total} != subtotal {li['subtotals']['income']}"


def test_expense_line_amounts_sum_to_subtotal(default_run):
    for row in default_run["rows"]:
        li = row["line_items"]
        total = sum(x["amount"] for x in li["expenses"])
        assert total == pytest.approx(li["subtotals"]["expenses"], abs=0.5), \
            f"year {row['year']} expense lines {total} != subtotal {li['subtotals']['expenses']}"


def test_net_cashflow_equals_income_minus_expenses(default_run):
    for row in default_run["rows"]:
        s = row["line_items"]["subtotals"]
        assert s["net_cashflow"] == pytest.approx(s["income"] - s["expenses"], abs=0.5)


def test_funding_block_sums_match_row_cashflow_aggregates(default_run):
    for row in default_run["rows"]:
        cf = row["cashflow"]
        f = row["line_items"]["funding"]
        assert f["from_cash"] == pytest.approx(cf["from_cash"], abs=0.5)
        assert f["from_taxable"] == pytest.approx(cf["from_taxable"], abs=0.5)
        assert f["from_ira"] == pytest.approx(cf["from_ira"], abs=0.5)
        assert f["from_roth"] == pytest.approx(cf["from_roth"], abs=0.5)


def test_roth_conversion_never_in_income_only_in_non_cash_events(default_run):
    """Regression guard for the double-counting risk: conversions drive the tax
    bill but are NOT a real cash movement. If a future refactor accidentally
    files them under `income`, income_subtotal balloons and the tab misleads."""
    for row in default_run["rows"]:
        li = row["line_items"]
        conv = row["roth_conversion"]
        # Guard 1: no income line has the conversion amount as its source label
        assert not any("roth conversion" in x["source"].lower() for x in li["income"]), \
            f"year {row['year']} filed Roth conversion under income"
        # Guard 2: if conversion > 0, it MUST appear in non_cash_events
        if conv > 0:
            assert any(x.get("kind") == "conversion" and x["amount"] == pytest.approx(conv, abs=0.5)
                       for x in li["non_cash_events"]), \
                f"year {row['year']} conversion {conv} missing from non_cash_events"
        else:
            assert li["non_cash_events"] == []


def test_ss_lines_carry_correct_taxable_ordinary_split(default_run):
    """Each SS line's taxable_ordinary should be its proportional share of the
    row's aggregate taxable_ss — proves per-source SS taxability is fairly split
    across the two spouses in the per-year card view."""
    for row in default_run["rows"]:
        ss_lines = [x for x in row["line_items"]["income"] if x["kind"] == "ss"]
        if not ss_lines:
            continue
        total_ss_amount = sum(x["amount"] for x in ss_lines)
        total_ss_taxable = sum(x["taxable_ordinary"] for x in ss_lines)
        assert total_ss_taxable == pytest.approx(row["tax_detail"]["taxable_ss"], abs=0.5), \
            f"year {row['year']} sum of SS taxable_ordinary != row taxable_ss"
        # Each line's taxable share is proportional to its gross share.
        for l in ss_lines:
            expected = row["tax_detail"]["taxable_ss"] * l["amount"] / total_ss_amount
            assert l["taxable_ordinary"] == pytest.approx(expected, abs=0.5)


def test_dividend_line_is_pure_preferential(default_run):
    """Dividend lines should have taxable_ordinary=0 and taxable_preferential=amount."""
    for row in default_run["rows"]:
        for l in row["line_items"]["income"]:
            if l["kind"] == "dividends":
                assert l["taxable_ordinary"] == 0.0
                assert l["taxable_preferential"] == pytest.approx(l["amount"], abs=0.5)


def test_rmd_line_appears_in_years_after_rmd_age(default_run):
    """After RMDs start, at least one income line should have kind='rmd'."""
    saw_rmd = False
    for row in default_run["rows"]:
        rmd_lines = [x for x in row["line_items"]["income"] if x["kind"] == "rmd"]
        if rmd_lines:
            saw_rmd = True
            # The sum of RMD line amounts should equal the row's aggregate rmd.
            total = sum(x["amount"] for x in rmd_lines)
            assert total == pytest.approx(row["rmd"], abs=0.5)
    assert saw_rmd, "Expected at least one year with RMD lines in the default plan"


# ---- Direct helper coverage ----

def test_income_line_items_labels_ss_streams_with_owner():
    streams = [
        {"tax_character": "SS", "owner": "Client", "amount": 3000, "annual_amount": None},
        {"tax_character": "SS", "owner": "Spouse", "amount": 2000, "annual_amount": None},
    ]
    lines = _income_line_items(streams, year=2030, client_alive=True, spouse_alive=True,
                                both_alive=True, has_spouse=True, survivor_owner=None)
    assert len(lines) == 2
    labels = sorted(l["source"] for l in lines)
    assert any("Client" in x for x in labels)
    assert any("Spouse" in x for x in labels)


def test_expense_line_items_carries_category_and_source():
    expenses = [
        {"name": None, "category": "Living Expenses", "amount": 100000,
         "owner": "Joint", "start_year": 2026, "inflation": 0.0, "frequency": "Annual", "use": True},
        {"name": "Yacht insurance", "amount": 5000, "owner": "Joint",
         "start_year": 2026, "inflation": 0.0, "frequency": "Annual", "use": True},
    ]
    lines = _expense_line_items(expenses, year=2026, client_alive=True, spouse_alive=True,
                                 both_alive=True, start_year=2026, survivor_reduction=0.15)
    assert lines[0]["source"] == "Living Expenses"
    assert lines[0]["category"] == "spending"
    assert lines[1]["source"] == "Yacht insurance"
    assert lines[1]["category"] == "insurance"


def test_survivor_reduction_applied_to_expense_lines():
    """After first death, expense_line_items should apply the same survivor
    reduction multiplier as the aggregate _total_expenses helper — otherwise
    line-item sums would exceed the aggregate."""
    expenses = [{"name": "Living", "category": "Living", "amount": 100000, "owner": "Joint",
                 "start_year": 2026, "inflation": 0.0, "frequency": "Annual", "use": True}]
    both = _expense_line_items(expenses, 2026, True, True, True, 2026, 0.20)
    widowed = _expense_line_items(expenses, 2026, True, False, False, 2026, 0.20)
    assert both[0]["amount"] == 100000
    assert widowed[0]["amount"] == pytest.approx(80000.0, abs=0.5)
