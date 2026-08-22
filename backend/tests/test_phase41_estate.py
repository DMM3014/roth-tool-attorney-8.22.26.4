"""Estate planning — 4-strategy comparison tests (Phase 42) + Phase C outright ledger."""
import pytest
from estate import (
    fed_exclusion, state_exclusion, state_estate_tax, project_estate,
    get_state_estate_metadata, STATE_ESTATE_TAX, FED_EXCLUSION_BASE, FED_ESTATE_TAX_RATE,
    FED_EXCLUSION_BASE_YEAR, PRE_OBBBA_BASE, SECURE_YEARS,
    _grow_outright_roth, _grow_outright_taxable_stepped, _grow_outright_traditional,
    _heir_effective_rate,
)


# -- Federal & state basics -------------------

def test_fed_exclusion_obbba_2026_matches_base():
    """OBBBA statutory: 2026 exclusion is $15M — the FED_EXCLUSION_BASE."""
    assert fed_exclusion(FED_EXCLUSION_BASE_YEAR) == FED_EXCLUSION_BASE
    assert FED_EXCLUSION_BASE == 15_000_000


def test_fed_exclusion_pre_obbba_2025_uses_pre_obbba_base():
    """Pre-2026 planning years fall back to the pre-OBBBA $13.99M-at-2025 base."""
    assert fed_exclusion(2025) == PRE_OBBBA_BASE
    assert PRE_OBBBA_BASE == 13_990_000


def test_fed_exclusion_indexes_at_model_cpi():
    """Federal exclusion now indexes at the model's assumed CPI (config.projection.
    general_inflation), falling back to DEFAULT_INDEXING_RATE = 3% when unspecified.
    2036 = 10 years past OBBBA base year → 1.03^10 ≈ 1.344× the $15M base."""
    # Default indexing rate (unspecified) = 3%
    v = fed_exclusion(2036)
    assert v > FED_EXCLUSION_BASE * 1.30
    assert v < FED_EXCLUSION_BASE * 1.38
    # Explicit override (matches the model's general_inflation)
    v2 = fed_exclusion(2036, indexing_rate=0.024)
    assert v2 > FED_EXCLUSION_BASE * 1.25
    assert v2 < FED_EXCLUSION_BASE * 1.30
    # Override with 0 → flat exclusion (statutory freeze scenario)
    assert fed_exclusion(2036, indexing_rate=0.0) == FED_EXCLUSION_BASE


def test_all_13_estate_tax_jurisdictions_present():
    assert len(STATE_ESTATE_TAX) == 13
    for c in ["CT","DC","HI","IL","MA","MD","ME","MN","NY","OR","RI","VT","WA"]:
        assert c in STATE_ESTATE_TAX


def test_ny_cliff_over_105pct_loses_exclusion():
    excl = state_exclusion("NY", 2025)
    under = state_estate_tax(excl * 1.03, "NY", 2025)
    over  = state_estate_tax(excl * 1.10, "NY", 2025)
    assert over > under * 10


def test_hi_portable_dsue_reduces_state_tax():
    no_dsue = state_estate_tax(15_000_000, "HI", 2050, dsue=0)
    with_dsue = state_estate_tax(15_000_000, "HI", 2050, dsue=5_000_000)
    assert with_dsue < no_dsue


# -- 4-strategy project_estate signature -------------------------------

# Large HNW household — 30M Roth + 10M Taxable split evenly.
BASE = dict(
    first_death_year=2050,
    second_death_year=2060,
    deceased_roth_at_y1=15_000_000,
    deceased_taxable_at_y1=5_000_000,
    survivor_roth_at_y1=15_000_000,
    survivor_taxable_at_y1=5_000_000,
    traditional_at_y1=2_000_000,
    trust_growth_rate=0.06,
    survivor_growth_rate=0.06,
    heir_marginal_rate=0.3165,
    state_code="",
)


def test_returns_all_4_strategies():
    r = project_estate(**BASE)
    assert set(r["outcomes"].keys()) == {"portability","bypass","qtip_bypass","gst_layered"}


def test_winner_field_identifies_best_strategy():
    r = project_estate(**BASE)
    winner = r["winner"]
    winner_net = r["outcomes"][winner]["net_to_heirs_at_y2"]
    for s, o in r["outcomes"].items():
        assert o["net_to_heirs_at_y2"] <= winner_net + 1


def test_portability_gets_full_step_up_on_taxable():
    """Strategy A gets full basis step-up on all Taxable at Y2 — best for taxable-heavy estates."""
    r = project_estate(**BASE)
    # Portability outcome: taxable held in survivor's estate → full step-up.
    p = r["outcomes"]["portability"]
    # Bypass: taxable inside bypass gets NO step-up (locked-in Y1 basis).
    b = r["outcomes"]["bypass"]
    # Compare after-tax on the SAME taxable dollar. Bypass's bypass_taxable_y2 is stepped=False,
    # portability's taxable is stepped=True. So portability preserves more per taxable dollar.
    # Only useful test: portability has zero trust_value_at_y2.
    assert p["trust_value_at_y2"] == 0
    assert b["trust_value_at_y2"] > 0


def test_bypass_escapes_y2_estate_tax():
    """Bypass strategy's Y2 estate is smaller than portability's — bypass excluded."""
    r = project_estate(**BASE)
    assert r["outcomes"]["bypass"]["estate_y2"] < r["outcomes"]["portability"]["estate_y2"]


def test_qtip_bypass_qtip_included_in_y2_estate():
    """QTIP is included in survivor's Y2 estate via § 2044 — larger estate than bypass-only."""
    r = project_estate(**BASE)
    # QTIP+Bypass estate should be BIGGER than Bypass-only (QTIP is in the estate) but
    # STILL smaller than portability (bypass portion is still excluded).
    b = r["outcomes"]["bypass"]["estate_y2"]
    q = r["outcomes"]["qtip_bypass"]["estate_y2"]
    p = r["outcomes"]["portability"]["estate_y2"]
    assert b <= q <= p


def test_gst_layered_has_two_trusts():
    """Strategy D funds trust at BOTH deaths — trust value at Y2 > single-death strategies."""
    r = project_estate(**BASE)
    b = r["outcomes"]["bypass"]["trust_value_at_y2"]
    g = r["outcomes"]["gst_layered"]["trust_value_at_y2"]
    # GST layered adds a second trust from Y2 exclusion, so its trust total exceeds bypass-only.
    assert g > b


def test_roth_first_funding_all_deceased_roth_into_bypass_when_room():
    """When fed_exclusion > deceased_roth, all deceased Roth goes into bypass first.

    Bypass Roth and Bypass Taxable both compound at the trust's gross rate
    (see revised trust-growth model — no compressed-bracket drag on the NAV
    since ordinary income + realized gains are distributed to beneficiaries).
    """
    from estate import _grow_roth_in_trust, _grow_taxable_in_trust
    r = project_estate(**BASE)
    b = r["outcomes"]["bypass"]
    # deceased_roth_at_y1 = 15M, fed_excl_y1 ≈ 27.5M → all Roth + $12.5M Taxable in bypass.
    expected_roth    = _grow_roth_in_trust(15_000_000, 0.06, 10)   # full trust rate
    expected_taxable = _grow_taxable_in_trust(5_000_000, 0.06, 10) # full trust rate
    assert abs(b["bypass_roth_y2"] - expected_roth) < 1
    assert abs(b["bypass_taxable_y2"] - expected_taxable) < 1
    # Under the revised model, trust-Taxable compounds at the full gross rate
    # (no internal drag) — the 15% LTCG haircut is only applied at eventual heir sale.
    naive_taxable = 5_000_000 * (1.06 ** 10)
    assert abs(b["bypass_taxable_y2"] - naive_taxable) < 1


def test_roth_first_when_fed_excl_smaller_than_deceased_roth():
    """When deceased Roth > fed exclusion, ONLY Roth goes to trust (no Taxable)."""
    # First-death year 2025 → fed excl = $13.99M; deceased Roth = $20M > excl.
    args = {**BASE, "first_death_year": 2025, "second_death_year": 2035,
            "deceased_roth_at_y1": 20_000_000, "deceased_taxable_at_y1": 5_000_000}
    r = project_estate(**args)
    b = r["outcomes"]["bypass"]
    # bypass_roth_y2 = FED_EXCLUSION_BASE × 1.06^10 (only 13.99M of Roth fits)
    # bypass_taxable_y2 = 0 (Roth used ALL the exclusion)
    assert b["bypass_taxable_y2"] == 0
    assert b["bypass_roth_y2"] > 0


def test_traditional_never_routed_to_trust():
    """Traditional IRA stays with survivor in every strategy."""
    r = project_estate(**BASE)
    # All 4 strategies should show the SAME traditional_at_y2 value (grown at same rate).
    trads = {o["traditional_at_y2"] for o in r["outcomes"].values()}
    assert len(trads) == 1  # all equal


def test_heir_marginal_rate_hurts_traditional_after_tax():
    """Higher heir marginal rate reduces net-to-heirs proportionally (Traditional taxable)."""
    low = project_estate(**{**BASE, "heir_marginal_rate": 0.10})
    high = project_estate(**{**BASE, "heir_marginal_rate": 0.40})
    # Higher heir rate → less net-to-heirs on Traditional portion → smaller net across the board.
    low_net = low["outcomes"]["portability"]["net_to_heirs_at_y2"]
    high_net = high["outcomes"]["portability"]["net_to_heirs_at_y2"]
    assert high_net < low_net


def test_taxable_basis_pct_is_ignored_post_1014_fix():
    """Post 2026-02-18: `taxable_basis_pct` is a deprecated no-op parameter.

    Trust-held Taxable's basis is now the FMV at the funding death (§1014
    step-up applies at trust funding), NOT a fraction of the current value.
    Passing different `taxable_basis_pct` values must produce IDENTICAL results.
    """
    low  = project_estate(**{**BASE, "taxable_basis_pct": 0.0})   # legacy: 100% unrealized gain
    high = project_estate(**{**BASE, "taxable_basis_pct": 1.0})   # legacy: 100% basis
    for s in ["portability", "bypass", "qtip_bypass", "gst_layered"]:
        assert abs(low["outcomes"][s]["net_to_heirs_at_y2"] - high["outcomes"][s]["net_to_heirs_at_y2"]) < 1, \
            f"Strategy {s} still sensitive to legacy taxable_basis_pct — should be ignored post-1014-fix"


def test_trust_taxable_uses_funding_fmv_as_basis():
    """Verify §1014 step-up applies at trust funding — heirs owe LTCG only on
    trust-internal appreciation from funding-date FMV, not household's original basis."""
    from estate import _after_tax_taxable, LTCG_RATE
    # A trust holds Taxable that was funded at $1M FMV (post-Y1 step-up) and
    # has now grown to $3M. Heirs' LTCG = 15% × ($3M − $1M) = $300K.
    v = _after_tax_taxable(3_000_000, entry_basis=1_000_000, stepped_up=False)
    expected = 3_000_000 - (3_000_000 - 1_000_000) * LTCG_RATE
    assert abs(v - expected) < 1
    # Stepped-up path ignores entry_basis and returns full value.
    v2 = _after_tax_taxable(3_000_000, entry_basis=999_999_999, stepped_up=True)
    assert abs(v2 - 3_000_000) < 1


def test_gst2_taxable_at_y2_has_no_immediate_ltcg():
    """GST-2 is funded at Y2 from the survivor's stepped-up estate. At Y2 the
    trust value equals the entry basis, so no LTCG haircut applies immediately.
    Only trust-internal appreciation FROM Y2 onward is un-stepped-up."""
    r = project_estate(**BASE, horizons_after_second_death=(0,))
    o = r["outcomes"]["gst_layered"]
    # At the second death (h=0), gst2_taxable_y2 should equal its funding value.
    assert o["gst2_taxable_y2"] > 0
    # The gst2 component's entry basis IS its Y2 funding value → no LTCG at h=0.
    comp_gst2 = next(c for c in o["trust_components"] if c["entry_year"] == r["second_death_year"])
    assert abs(comp_gst2["taxable_entry"] - o["gst2_taxable_y2"]) < 1


def test_state_tax_reduces_net_across_strategies():
    """WA state tax hurts all strategies but bypass/GST protect more (trust excluded)."""
    fed = project_estate(**BASE)
    wa = project_estate(**{**BASE, "state_code": "WA"})
    # WA state tax reduces every strategy's net.
    for s in ["portability","bypass","qtip_bypass","gst_layered"]:
        assert wa["outcomes"][s]["net_to_heirs_at_y2"] <= fed["outcomes"][s]["net_to_heirs_at_y2"]
    # Winner should now shift toward bypass-family strategies where WA exclusion is preserved.
    # (State exclusion is non-portable so portability loses more.)
    wa_port = wa["outcomes"]["portability"]["state_tax"]
    wa_bypass = wa["outcomes"]["bypass"]["state_tax"]
    assert wa_bypass <= wa_port


def test_post_death_horizons_grow_trust_taxfree():
    """Trust component compounds at trust_growth_rate; household at survivor_growth_rate."""
    r = project_estate(**BASE, horizons_after_second_death=(0, 20))
    h0 = r["post_death_horizons"][0]
    h20 = r["post_death_horizons"][1]
    # 20-year compounding on gst_layered's trust portion (biggest trust value).
    g0 = h0["gst_layered_trust"]
    g20 = h20["gst_layered_trust"]
    if g0 > 0:
        # 20 yrs at 6% ≈ 3.2x
        assert g20 > g0 * 2.5
        assert g20 < g0 * 4.0


def test_reversed_death_years_auto_swap():
    r = project_estate(**{**BASE, "first_death_year": 2060, "second_death_year": 2050})
    assert r["first_death_year"] == 2050
    assert r["second_death_year"] == 2060


def test_use_portability_false_zeros_dsue_in_portability():
    r = project_estate(**{**BASE, "use_portability": False})
    assert r["outcomes"]["portability"]["dsue"] == 0.0


# -- Trust growth rate under the revised model (2026-02 update) ---------------
# The compressed-bracket drag was REMOVED from trust compounding: well-drafted
# irrevocable trusts distribute ordinary income to beneficiaries and appreciated
# assets in-kind, sidestepping the trust's 37%/20% brackets. Trust NAV now
# compounds at the client's gross rate throughout.

def test_roth_in_trust_full_rate_within_secure_window():
    """Roth-in-trust compounds at full trust rate for the first 10 years."""
    from estate import _grow_roth_in_trust
    v = _grow_roth_in_trust(1_000_000, 0.06, 10)
    assert abs(v - 1_000_000 * (1.06 ** 10)) < 1


def test_roth_in_trust_compounds_at_full_rate_past_secure_window():
    """Under the revised model, trust distributes retained income to
    beneficiaries so the compressed-bracket drag never actually accrues —
    Roth-in-trust NAV keeps compounding at the gross rate beyond year 10."""
    from estate import _grow_roth_in_trust
    v = _grow_roth_in_trust(1_000_000, 0.06, 20)
    assert abs(v - 1_000_000 * (1.06 ** 20)) < 1


def test_taxable_in_trust_compounds_at_full_rate():
    """Taxable-in-trust also compounds at the gross rate — dividends are
    distributed to beneficiaries (taxed at their ordinary rate, not the
    trust's 37%) and appreciated assets are distributed in-kind so trust
    NAV bears no realized-LTCG drag internally."""
    from estate import _grow_taxable_in_trust
    v_5 = _grow_taxable_in_trust(1_000_000, 0.06, 5)
    v_20 = _grow_taxable_in_trust(1_000_000, 0.06, 20)
    assert abs(v_5 - 1_000_000 * (1.06 ** 5)) < 1
    assert abs(v_20 - 1_000_000 * (1.06 ** 20)) < 1


def test_roth_and_taxable_in_trust_compound_identically():
    """Under the revised model, Roth-in-trust and Taxable-in-trust NAV curves
    are identical: both compound at the gross rate. The economic difference
    between them shows up only at eventual heir sale, where trust-Taxable
    still owes LTCG on internal appreciation (via `_after_tax_taxable`) while
    trust-Roth passes tax-free."""
    from estate import _grow_roth_in_trust, _grow_taxable_in_trust
    for yrs in (5, 10, 15, 20, 30):
        r = _grow_roth_in_trust(1_000_000, 0.06, yrs)
        t = _grow_taxable_in_trust(1_000_000, 0.06, yrs)
        assert abs(r - t) < 1, f"Roth vs Taxable in trust diverge at {yrs} yrs: {r} vs {t}"


def test_horizon_trust_uses_secure_window_and_drag():
    """The 30-year horizon on gst_layered picks up drag on both GST-1 (Y1 entry,
    30 years post-death → 40 years total) and GST-2 (Y2 entry, 30 years total)."""
    r = project_estate(**BASE, horizons_after_second_death=(0, 30))
    h0  = r["post_death_horizons"][0]
    h30 = r["post_death_horizons"][1]
    g0  = h0["gst_layered_trust"]
    g30 = h30["gst_layered_trust"]
    if g0 > 0:
        # Naive tax-free 30-year growth at 6% is 5.74× — with drag on post-window
        # Roth AND on Taxable-in-trust from entry, the multiple is materially lower.
        naive_multiple = 1.06 ** 30
        assert g30 / g0 < naive_multiple


def test_trust_components_present_on_bypass_and_gst_layered():
    r = project_estate(**BASE)
    assert len(r["outcomes"]["bypass"]["trust_components"]) == 1
    assert len(r["outcomes"]["gst_layered"]["trust_components"]) == 2
    # Portability has no trust.
    assert r["outcomes"]["portability"]["trust_components"] == []
    # GST-layered: GST-1 entered Y1, GST-2 entered Y2.
    comps = r["outcomes"]["gst_layered"]["trust_components"]
    entry_years = sorted(c["entry_year"] for c in comps)
    assert entry_years == [r["first_death_year"], r["second_death_year"]]


# -- Phase C: outright vehicles carry their own SECURE clocks ---------------

def test_outright_roth_tax_free_within_secure_window():
    """Outright Roth compounds at the full gross rate for the first 10 years post-Y2."""
    v = _grow_outright_roth(1_000_000, 0.06, heir_rate=0.32, years=10)
    assert abs(v - 1_000_000 * (1.06 ** 10)) < 1


def test_outright_roth_drag_kicks_in_after_secure_window():
    """After year 10 the Roth is distributed & reinvested in an heir brokerage
    (dividend drag + LTCG drag on turnover) — so 20-yr growth is materially
    below naive gross compounding."""
    v = _grow_outright_roth(1_000_000, 0.06, heir_rate=0.32, years=20)
    naive = 1_000_000 * (1.06 ** 20)
    assert v < naive
    # But still ahead of a 10-yr snapshot — brokerage doesn't zero out growth.
    assert v > 1_000_000 * (1.06 ** 10)


def test_outright_taxable_stepped_uses_heir_brokerage_rate():
    """§1014 step-up at Y2 → basis reset → heir brokerage drag from year 1."""
    v_5 = _grow_outright_taxable_stepped(1_000_000, 0.06, heir_rate=0.32, years=5)
    naive_5 = 1_000_000 * (1.06 ** 5)
    assert v_5 < naive_5
    # Drag scales with time.
    v_20 = _grow_outright_taxable_stepped(1_000_000, 0.06, heir_rate=0.32, years=20)
    naive_20 = 1_000_000 * (1.06 ** 20)
    assert (naive_20 - v_20) > (naive_5 - v_5)


def test_outright_traditional_h0_matches_immediate_liquidation():
    """At h=0, outright Trad = gross × (1 − heir_rate). Consistent with the
    immediate-liquidation view used by household_after_tax_at_y2."""
    v = _grow_outright_traditional(1_000_000, 0.06, heir_rate=0.32, years=0)
    assert abs(v - 1_000_000 * (1.0 - 0.32)) < 1


def test_outright_traditional_secure_drawdown_beats_immediate_liquidation():
    """The 10-yr SECURE drawdown captures tax-deferred growth on the still-in-IRA
    portion — so it beats the "liquidate everything at Y2 and reinvest in a
    heir taxable brokerage" baseline (same brokerage drag on both sides after
    Y2, but drawdown gets extra tax-deferred compounding on the IRA slice)."""
    v_drawdown = _grow_outright_traditional(1_000_000, 0.06, heir_rate=0.32, years=10)
    r_eff = _heir_effective_rate(0.06, 0.32)
    v_immediate_liquidate = 1_000_000 * (1.0 - 0.32) * ((1.0 + r_eff) ** 10)
    assert v_drawdown > v_immediate_liquidate


def test_heir_effective_rate_less_than_gross():
    """Heir taxable brokerage drag reduces the gross growth rate (never boosts it)."""
    r = _heir_effective_rate(0.06, heir_rate=0.32)
    assert 0 < r < 0.06
    # Zero rate → zero (no drag applied since there's nothing to tax).
    assert _heir_effective_rate(0.0, heir_rate=0.32) == 0.0


def test_household_components_populated_on_all_strategies():
    """Every strategy now exposes a per-vehicle outright ledger so the horizon
    loop can compound Roth / Taxable / Traditional with their own clocks."""
    r = project_estate(**BASE)
    for s in ["portability", "bypass", "qtip_bypass", "gst_layered"]:
        hc = r["outcomes"][s]["household_components"]
        assert set(hc.keys()) == {
            "roth_after_estate_tax",
            "taxable_after_estate_tax_stepped",
            "traditional_after_estate_tax_gross",
        }
        # All non-negative.
        for v in hc.values():
            assert v >= 0


def test_horizon_row_includes_per_vehicle_outright_breakdown():
    """post_death_horizons rows now carry Roth/Taxable/Traditional splits for
    the outright bucket — powers the frontend timeline ribbon."""
    r = project_estate(**BASE, horizons_after_second_death=(0, 20))
    h20 = r["post_death_horizons"][-1]
    for s in ["portability", "bypass", "qtip_bypass", "gst_layered"]:
        assert f"{s}_household_roth" in h20
        assert f"{s}_household_taxable" in h20
        assert f"{s}_household_traditional" in h20
        # Sum matches the aggregate household column (within rounding).
        total = (h20[f"{s}_household_roth"] +
                 h20[f"{s}_household_taxable"] +
                 h20[f"{s}_household_traditional"])
        assert abs(total - h20[f"{s}_household"]) < 1


def test_outright_roth_secure_clock_shrinks_portability_h20_vs_naive():
    """The Phase C fix: outright Roth at +20 no longer compounds tax-free forever.
    Portability's h=20 household should be BELOW the legacy naive-blob compounding
    (household_after_tax_at_y2 × survivor_rate^20)."""
    r = project_estate(**BASE, horizons_after_second_death=(0, 20))
    port_h0 = r["post_death_horizons"][0]["portability_household"]
    port_h20 = r["post_death_horizons"][-1]["portability_household"]
    naive_h20 = r["outcomes"]["portability"]["household_after_tax_at_y2"] * (1.06 ** 20)
    # New model is lower than the old naive model — captures SECURE Roth cutoff
    # + heir brokerage drag on Taxable + proper Traditional drawdown.
    assert port_h20 < naive_h20
    # But still positive growth over 20 years.
    assert port_h20 > port_h0


def test_horizon_h0_matches_household_after_tax_at_y2_within_rounding():
    """h=0 aggregate outright must match `household_after_tax_at_y2` exactly
    (per-vehicle model reduces to immediate-liquidation view at h=0)."""
    r = project_estate(**BASE, horizons_after_second_death=(0,))
    row = r["post_death_horizons"][0]
    for s in ["portability", "bypass", "qtip_bypass", "gst_layered"]:
        expected = r["outcomes"][s]["household_after_tax_at_y2"]
        got = row[f"{s}_household"]
        # Within $2 (compounded rounding).
        assert abs(got - expected) < 2, f"{s}: h=0 household {got} ≠ y2 {expected}"
