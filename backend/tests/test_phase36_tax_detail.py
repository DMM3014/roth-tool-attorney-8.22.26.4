"""Phase 36 — Tax Detail exposure (backend-side): the ltcg_band_split helper +
`tax_detail` sub-object on every year row.

The two features under test are pure engine-intermediate exposures — they do not
change any tax math. These tests lock:
  1. `ltcg_band_split` correctly slices preferential dollars into 0/15/20% bands
     with the standard "pref stacks on top of ordinary" model, using the indexed
     ceilings (bracket_index) — critical because the Tax Detail tab UI, the
     Optimizer's Bump-Zone Alert, and the callout logic all read these numbers.
  2. Every yearly projection row now carries a `tax_detail` object with the
     specific fields the frontend expects (schema contract).
"""
from __future__ import annotations
import copy
import math

import pytest

from tax_engine import ltcg_band_split, compute_year_tax
from projection import run_projection
from defaults import DEFAULT_SCENARIO


# --------------- ltcg_band_split ---------------

def test_ltcg_band_split_all_in_zero_when_pref_fits_under_l0():
    # MFJ base year (idx=1.0): l0 = $98,900. Pref of $50K sitting on top of
    # $20K ordinary lives entirely in the 0% band (20K → 70K, all ≤ 98.9K).
    s = ltcg_band_split(ord_tax=20_000, pref=50_000, mfj=True, idx=1.0)
    assert s["in_0"] == 50_000.0
    assert s["in_15"] == 0.0
    assert s["in_20"] == 0.0
    assert s["ceiling_0"] == 98_900.0
    assert s["ceiling_15"] == 613_700.0


def test_ltcg_band_split_spans_zero_and_fifteen_bands():
    # $20K ordinary + $100K pref → stacks 20K..120K
    #   0% band = intersect(20K..120K, 0..98.9K) = 78.9K
    #   15% band = intersect(20K..120K, 98.9K..613.7K) = 21.1K
    #   20% band = 0
    s = ltcg_band_split(20_000, 100_000, mfj=True, idx=1.0)
    assert s["in_0"] == pytest.approx(78_900.0, abs=0.01)
    assert s["in_15"] == pytest.approx(21_100.0, abs=0.01)
    assert s["in_20"] == 0.0


def test_ltcg_band_split_uses_indexed_ceilings():
    # idx=1.25 shifts both ceilings up 25%. $700K ordinary + $50K pref stacks
    # 700K..750K. Indexed l15 = 613,700 * 1.25 = 767,125. So all pref is in 15%.
    s = ltcg_band_split(700_000, 50_000, mfj=True, idx=1.25)
    assert s["in_20"] == 0.0
    assert s["in_15"] == 50_000.0
    assert s["ceiling_15"] == pytest.approx(767_125.0, abs=0.01)


def test_ltcg_band_split_pushes_across_the_fifteen_twenty_cliff():
    # $600K ordinary + $50K pref → stacks 600K..650K. l15 (MFJ, idx=1) = 613,700.
    # Pref split: 600K..613.7K = 13.7K in 15%, 613.7K..650K = 36.3K in 20%.
    s = ltcg_band_split(600_000, 50_000, mfj=True, idx=1.0)
    assert s["in_0"] == 0.0
    assert s["in_15"] == pytest.approx(13_700.0, abs=0.01)
    assert s["in_20"] == pytest.approx(36_300.0, abs=0.01)


def test_ltcg_band_split_single_filer_uses_lower_ceilings():
    s = ltcg_band_split(0, 40_000, mfj=False, idx=1.0)
    assert s["ceiling_0"] == 49_450.0
    assert s["ceiling_15"] == 545_500.0
    # 40K pref stacked on 0 ordinary → all in 0% band (< 49.45K)
    assert s["in_0"] == 40_000.0


def test_ltcg_band_split_zero_pref_returns_zeros_with_ceilings():
    s = ltcg_band_split(400_000, 0, mfj=True, idx=1.0)
    assert s["in_0"] == 0.0
    assert s["in_15"] == 0.0
    assert s["in_20"] == 0.0
    # Ceilings still returned so the UI can render the axis even in a zero-pref year.
    assert s["ceiling_0"] == 98_900.0
    assert s["ceiling_15"] == 613_700.0


def test_ltcg_band_split_matches_federal_ltcg_tax_reconstruction():
    """The 15%*in_15 + 20%*in_20 sum MUST match tax_engine.federal_ltcg_tax
    to the cent — proves the split is the SAME math the tax engine actually
    uses, not a parallel reimplementation that could drift."""
    from tax_engine import federal_ltcg_tax
    for ordv, prefv in [(20_000, 100_000), (600_000, 50_000), (0, 40_000),
                         (400_000, 250_000)]:
        s = ltcg_band_split(ordv, prefv, mfj=True, idx=1.0)
        expected = federal_ltcg_tax(ordv, prefv, mfj=True, idx=1.0)
        actual = 0.15 * s["in_15"] + 0.20 * s["in_20"]
        assert actual == pytest.approx(expected, abs=0.01)


# --------------- Projection row `tax_detail` schema ---------------

def test_projection_rows_carry_tax_detail_object_with_required_keys():
    r = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    assert r["rows"], "projection returned no rows"
    for row in r["rows"]:
        td = row.get("tax_detail")
        assert td is not None, f"year {row['year']} missing tax_detail"
        for k in ("preferential_taxable", "total_preferential", "taxable_ss",
                  "provisional_income", "standard_deduction", "senior_bonus",
                  "ss_inclusion_pct", "ltcg_band_split",
                  "marginal_ordinary_rate", "effective_rate"):
            assert k in td, f"year {row['year']} tax_detail missing key {k}"
        # Band split has all its own keys
        band = td["ltcg_band_split"]
        for k in ("in_0", "in_15", "in_20", "ceiling_0", "ceiling_15"):
            assert k in band, f"year {row['year']} ltcg_band_split missing {k}"


def test_ss_inclusion_pct_is_none_when_no_ss():
    """Pre-retirement years (before either spouse claims SS) have gross_ss=0 —
    the SS Torpedo indicator should be null, not 0, so the frontend can render
    a distinct "no SS this year" state instead of misleading 0%."""
    r = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    # Find a year with gross_ss = 0 (should exist early in the plan).
    early_no_ss = [row for row in r["rows"] if row["gross_ss"] == 0]
    assert early_no_ss, "expected at least one year with gross_ss=0"
    for row in early_no_ss:
        assert row["tax_detail"]["ss_inclusion_pct"] is None


def test_ss_inclusion_pct_matches_taxable_over_gross():
    r = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    for row in r["rows"]:
        gross = row["gross_ss"]
        td = row["tax_detail"]
        if gross > 0:
            expected = round(td["taxable_ss"] / gross * 100, 2)
            assert td["ss_inclusion_pct"] == pytest.approx(expected, abs=0.01)


def test_tax_detail_ltcg_band_split_matches_row_pref_taxable():
    """Sum of in_0 + in_15 + in_20 should equal the row's preferential_taxable
    (± cents of rounding) — proves the band slicing spans ALL of pref, no leakage."""
    r = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    for row in r["rows"]:
        td = row["tax_detail"]
        b = td["ltcg_band_split"]
        total = b["in_0"] + b["in_15"] + b["in_20"]
        assert total == pytest.approx(td["preferential_taxable"], abs=0.02), \
            f"year {row['year']} band split {total} != pref_taxable {td['preferential_taxable']}"
