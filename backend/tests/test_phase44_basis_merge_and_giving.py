"""Phase 44 — Basis-Merge toggle + Lifetime Giving Program (§2503(b) / §2503(e))

Locks in the two new workbook-parity features shipped this session:

  1. `tax.merge_basis_at_first_death` toggle — when True the surviving spouse's
     Taxable accounts are pooled into ONE blended-basis account after first death
     (workbook convention). When False, accounts stay separate.
  2. `giving.annual_gift_amount` + `giving.section_2503e_amount` — annual gifts
     drain the Taxable brokerage and compound in a family-side "gift pot" at the
     heir reinvestment rate.
"""
import copy

from defaults import DEFAULT_SCENARIO
from projection import run_projection


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


# ------------------------------- Basis Merge ------------------------------- #

def test_basis_merge_default_is_on():
    """Product decision: default matches the spreadsheet (merged basis at Y1)."""
    assert DEFAULT_SCENARIO["tax"]["merge_basis_at_first_death"] is True


def test_basis_merge_off_yields_lower_lifetime_tax():
    """Turning merge OFF lets the survivor spend the stepped-up lot first
    (tax-efficient real-world behavior). Same inputs → lifetime tax must drop
    and heirs must inherit more."""
    on = _cfg()
    off = _cfg()
    off["tax"]["merge_basis_at_first_death"] = False
    r_on = run_projection(on)
    r_off = run_projection(off)
    assert r_off["summary"]["lifetime_taxes"] < r_on["summary"]["lifetime_taxes"], (
        "merge=False must spend stepped-up lot first and lower lifetime taxes"
    )
    assert (
        r_off["legacy"]["after_tax_estate_to_heirs"]
        > r_on["legacy"]["after_tax_estate_to_heirs"]
    )


# ------------------------------- Lifetime Giving --------------------------- #

def test_giving_zero_when_disabled():
    r = run_projection(_cfg())
    assert r["summary"]["lifetime_gifted"] == 0.0
    assert r["summary"]["gift_pot_at_second_death"] == 0.0


def test_giving_drains_taxable_and_compounds_family_pot():
    cfg = _cfg()
    cfg["giving"] = {
        "annual_gift_amount": 100000.0,
        "section_2503e_amount": 40000.0,
        "start_year": cfg["projection"]["start_year"],
        "end_year": cfg["projection"]["end_year"],
    }
    r = run_projection(cfg)
    yrs = int(cfg["projection"]["end_year"]) - int(cfg["projection"]["start_year"]) + 1
    # Note: actual gifted is capped at available Taxable — spouse dies before
    # end so the final year contribution can be 0. We check "close to" the max.
    assert r["summary"]["lifetime_gifted"] > 0
    assert r["summary"]["lifetime_gifted"] <= 140_000 * yrs + 1
    # Family pot > total gifted because it compounds at the heir rate.
    assert r["summary"]["gift_pot_at_second_death"] > r["summary"]["lifetime_gifted"]


def test_giving_reduces_estate_net_worth():
    """Gifting siphons dollars out of the estate → NW at end must drop."""
    base = run_projection(_cfg())
    gift = _cfg()
    gift["giving"] = {
        "annual_gift_amount": 60000.0,
        "section_2503e_amount": 0.0,
        "start_year": gift["projection"]["start_year"],
        "end_year": gift["projection"]["end_year"],
    }
    r = run_projection(gift)
    assert r["summary"]["ending_net_worth"] < base["summary"]["ending_net_worth"]


def test_giving_response_shape():
    r = run_projection(_cfg())
    assert "giving" in r
    assert set(r["giving"].keys()) == {"annual_pot", "total_gifted", "ending_pot"}
    # annual_pot is keyed by year → {contributed, cumulative_pot}
    for k, v in r["giving"]["annual_pot"].items():
        assert isinstance(v, dict)
        assert "contributed" in v and "cumulative_pot" in v
