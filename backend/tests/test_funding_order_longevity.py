"""Funding-order × survivor-longevity grid (Presentation deck page).

The funding-order decision is a longevity bet: taxable-funded conversion tax buys
a bigger Roth (tax-free compounding) at the cost of the §1014 step-up. These
tests pin the mechanics of the grid, not a particular winner.
"""
import copy

from defaults import DEFAULT_SCENARIO
from projection import (
    DEFAULT_LONGEVITY_DELTAS, LONGEVITY_ORDERS, funding_order_longevity,
)

TAXABLE_FIRST = "Cash → Taxable → IRA → Roth"
IRA_FIRST = "Cash → IRA → Taxable → Roth"


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


class TestFundingOrderLongevity:
    def test_grid_shape(self):
        res = funding_order_longevity(_cfg())
        assert res["survivor"] in ("client", "spouse")
        assert res["orders"] == list(LONGEVITY_ORDERS)
        assert len(res["rows"]) >= 3
        for row in res["rows"]:
            assert set(row["orders"].keys()) == set(LONGEVITY_ORDERS)
            assert row["leader"] in LONGEVITY_ORDERS
            for v in row["orders"].values():
                assert v["after_tax_estate"] > 0
                assert v["lifetime_taxes"] > 0

    def test_baseline_row_always_present(self):
        res = funding_order_longevity(_cfg(), [5, 20])
        assert any(r["extra_years"] == 0 for r in res["rows"])

    def test_second_death_year_tracks_the_delta(self):
        res = funding_order_longevity(_cfg(), [0, 10])
        by_delta = {r["extra_years"]: r for r in res["rows"]}
        assert by_delta[10]["second_death_year"] - by_delta[0]["second_death_year"] == 10
        assert by_delta[10]["survivor_age_at_death"] - by_delta[0]["survivor_age_at_death"] == 10

    def test_longer_survival_grows_the_estate_under_every_order(self):
        res = funding_order_longevity(_cfg(), [0, 20])
        by_delta = {r["extra_years"]: r for r in res["rows"]}
        for order in LONGEVITY_ORDERS:
            assert (by_delta[20]["orders"][order]["after_tax_estate"]
                    > by_delta[0]["orders"][order]["after_tax_estate"])

    def test_leader_is_the_row_max(self):
        res = funding_order_longevity(_cfg(), list(DEFAULT_LONGEVITY_DELTAS))
        for row in res["rows"]:
            best = max(row["orders"].items(), key=lambda kv: kv[1]["after_tax_estate"])[0]
            assert row["leader"] == best

    def test_impossible_rows_are_skipped(self):
        # -15 years lands the "second death" before the FIRST death in the default
        # plan, which is not a meaningful grid row.
        res = funding_order_longevity(_cfg(), [-15, 0])
        assert all(r["extra_years"] != -15 for r in res["rows"])

    def test_taxable_first_ends_with_more_roth(self):
        # Mechanical check on the trade-off itself: funding conversion tax from the
        # taxable sleeve leaves the IRA intact for more conversion, so the Roth
        # balance is never smaller than under IRA-first.
        row = funding_order_longevity(_cfg(), [0])["rows"][0]
        assert (row["orders"][TAXABLE_FIRST]["ending_roth"]
                >= row["orders"][IRA_FIRST]["ending_roth"])
