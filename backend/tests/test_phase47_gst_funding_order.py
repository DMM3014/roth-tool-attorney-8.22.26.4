"""Phase 47 — Estate tab's Layered GST-Exempt strategy: taxable-first funding option.

Locks the invariant that:
  - `gst_funding_order='taxable_first'` on `project_estate` routes Taxable into the Y1 GST
    trust FIRST (up to the fed exclusion) with Roth filling any remaining exclusion.
  - The other three strategies (portability / bypass / qtip_bypass) are UNAFFECTED — the
    funding order applies only to the Layered GST strategy.
  - When Roth + Taxable at Y1 fit fully under the exclusion, the two orders produce
    identical net-to-heirs (both funded to the same total).
  - When Roth + Taxable exceed the exclusion, roth_first ranks higher on net-to-heirs
    (Roth-in-trust escapes SECURE 10-yr window; Taxable outside receives the 2nd §1014
    step-up at the survivor's death).
"""
from __future__ import annotations

import copy
import pytest

from estate import project_estate


COMMON = dict(
    first_death_year=2040, second_death_year=2050,
    survivor_roth_at_y1=5_000_000, survivor_taxable_at_y1=5_000_000,
    traditional_at_y1=2_000_000,
    trust_growth_rate=0.06, survivor_growth_rate=0.06,
    heir_marginal_rate=0.3165, state_code="", use_portability=True,
    indexing_rate=0.024, horizons_after_second_death=(0, 10),
)


def _run(order: str, deceased_roth: float, deceased_taxable: float):
    return project_estate(
        **COMMON,
        deceased_roth_at_y1=deceased_roth,
        deceased_taxable_at_y1=deceased_taxable,
        gst_funding_order=order,
    )


def test_funding_order_field_present_in_response():
    r = _run("taxable_first", 4_000_000, 6_000_000)
    assert r["gst_funding_order"] == "taxable_first"


def test_default_funding_order_is_roth_first():
    r = project_estate(
        **COMMON,
        deceased_roth_at_y1=4_000_000, deceased_taxable_at_y1=6_000_000,
    )
    assert r["gst_funding_order"] == "roth_first"


def test_taxable_first_routes_taxable_into_gst1_first():
    """With deceased assets EXCEEDING the exclusion, taxable-first fills Taxable first."""
    # In 2040 fed exclusion ≈ $20.9M (indexed at 2.4%). Give the deceased 15M Roth +
    # 15M Taxable so Taxable overflows are routed differently.
    r_taxable = _run("taxable_first", 15_000_000, 15_000_000)
    g = r_taxable["outcomes"]["gst_layered"]
    # Taxable should be prioritized into the trust — bypass_taxable_y2 > bypass_roth_y2.
    assert g["bypass_taxable_y2"] > g["bypass_roth_y2"]


def test_roth_first_routes_roth_into_gst1_first():
    r_roth = _run("roth_first", 15_000_000, 15_000_000)
    g = r_roth["outcomes"]["gst_layered"]
    assert g["bypass_roth_y2"] > g["bypass_taxable_y2"]


def test_orders_agree_when_under_exclusion():
    """If deceased Roth + Taxable both fit under the exclusion, both orders produce
    the same net (all deceased assets enter the trust either way)."""
    r_roth = _run("roth_first", 4_000_000, 6_000_000)
    r_taxable = _run("taxable_first", 4_000_000, 6_000_000)
    g_r = r_roth["outcomes"]["gst_layered"]
    g_t = r_taxable["outcomes"]["gst_layered"]
    assert abs(g_r["net_to_heirs_at_y2"] - g_t["net_to_heirs_at_y2"]) < 1e-2
    assert abs(g_r["trust_value_at_y2"] - g_t["trust_value_at_y2"]) < 1e-2


def test_roth_first_wins_when_over_exclusion():
    """Standard-issue prediction from the Estate tab's Roth-first thesis: when the
    deceased Roth + Taxable BOTH exceed the exclusion, Roth-first delivers more
    net-to-heirs at Y2 (Roth escapes SECURE; excluded Taxable gets 2nd step-up)."""
    r_roth = _run("roth_first", 15_000_000, 15_000_000)
    r_taxable = _run("taxable_first", 15_000_000, 15_000_000)
    g_r = r_roth["outcomes"]["gst_layered"]["net_to_heirs_at_y2"]
    g_t = r_taxable["outcomes"]["gst_layered"]["net_to_heirs_at_y2"]
    assert g_r > g_t, f"Expected roth_first ({g_r}) > taxable_first ({g_t})"


def test_other_three_strategies_unaffected_by_funding_order():
    """portability / bypass / qtip_bypass must return IDENTICAL numbers regardless
    of the layered-GST funding-order preference."""
    r_roth = _run("roth_first", 15_000_000, 15_000_000)
    r_taxable = _run("taxable_first", 15_000_000, 15_000_000)
    for strat in ("portability", "bypass", "qtip_bypass"):
        for k in ("net_to_heirs_at_y2", "trust_value_at_y2",
                  "household_after_tax_at_y2", "fed_tax", "state_tax"):
            assert abs(r_roth["outcomes"][strat][k] - r_taxable["outcomes"][strat][k]) < 1e-2, (
                f"Strategy {strat} field {k} changed with funding-order flip")


def test_invalid_order_falls_through_to_roth_first():
    """Defensive: an unrecognized order string routes to roth_first (default branch)."""
    r_bogus = _run("bogus_value", 15_000_000, 15_000_000)
    r_roth = _run("roth_first", 15_000_000, 15_000_000)
    assert abs(
        r_bogus["outcomes"]["gst_layered"]["net_to_heirs_at_y2"]
        - r_roth["outcomes"]["gst_layered"]["net_to_heirs_at_y2"]
    ) < 1e-2


if __name__ == "__main__":  # pragma: no cover
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
