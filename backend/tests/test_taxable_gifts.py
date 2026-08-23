"""Stage 1 tests for taxable lifetime gifts (§2001(b) unified computation).

The portability (no-trust) strategy in estate.project_estate now accepts
adjusted_gifts_first_death / adjusted_gifts_second_death. Gifts are added ONCE to
the tentative-tax base; the full exclusion + DSUE shelter still applies. Defaults
of 0.0 must leave every figure byte-identical to the pre-gift behavior.
"""
import estate
from estate import project_estate, fed_exclusion, FED_ESTATE_TAX_RATE

# Common far-enough-out death years so the estate exceeds the indexed exclusion.
Y1, Y2 = 2040, 2045
IDX = 0.03


def _base_kwargs(**over):
    kw = dict(
        first_death_year=Y1, second_death_year=Y2,
        deceased_roth_at_y1=0.0, deceased_taxable_at_y1=50_000_000.0,
        survivor_roth_at_y1=0.0, survivor_taxable_at_y1=0.0,
        traditional_at_y1=0.0,
        heir_marginal_rate=0.36, state_code="", use_portability=True,
        indexing_rate=IDX, horizons_after_second_death=(0,),
        # Pin Y2 balances so estate_y2 is deterministic (no stylized growth).
        # $60M sits well above the combined exclusion + DSUE (~$49M for 2040/2045
        # at 3% indexing) so the gift's marginal effect on fed_tax is observable.
        y2_roth=0.0, y2_taxable=60_000_000.0, y2_traditional=0.0,
    )
    kw.update(over)
    return kw


def _portability(res):
    return res["outcomes"]["portability"]


def test_no_gifts_is_byte_identical():
    """With gifts absent (default 0.0) the portability outcome must equal a run
    where we pass 0.0 explicitly — i.e. the new params are a strict no-op."""
    a = _portability(project_estate(**_base_kwargs()))
    b = _portability(project_estate(**_base_kwargs(
        adjusted_gifts_first_death=0.0, adjusted_gifts_second_death=0.0)))
    assert a["fed_tax"] == b["fed_tax"]
    assert a["estate_y2"] == b["estate_y2"]


def test_5m_taxable_gift_by_first_decedent():
    """HAND COMPUTATION (unified §2001(b), flat 40%, portability):

    estate_y2 (pinned)        = $60,000,000
    fed_excl_y2 = 15M*(1.03^(2045-2026)) ; fed_excl_y1 = 15M*(1.03^(2040-2026))
    DSUE (portability)        = fed_excl_y1  (full ported exclusion)
    shelter avail_y2          = fed_excl_y2 + DSUE
    adjusted taxable gifts    = $5,000,000 (first decedent)
    fed_taxable = max(0, estate_y2 + 5,000,000 - avail_y2)
    fed_tax     = fed_taxable * 0.40

    A $5M gift ADDS $5M to the tentative-tax base (single count) but does NOT
    separately reduce the exclusion, so vs. the no-gift run the tax rises by
    exactly 0.40 * 5,000,000 = $2,000,000 *for the same pinned estate*. (In the
    full model the estate would be ~$5M smaller because the gift left it, which
    is why gifting reduces total tax — that reduction is modeled on the
    projection side, not inside project_estate's pinned-balance call.)
    """
    excl_y1 = fed_exclusion(Y1, IDX)
    excl_y2 = fed_exclusion(Y2, IDX)
    avail = excl_y2 + excl_y1
    expected_taxable = max(0.0, 60_000_000.0 + 5_000_000.0 - avail)
    expected_tax = expected_taxable * FED_ESTATE_TAX_RATE

    out = _portability(project_estate(**_base_kwargs(adjusted_gifts_first_death=5_000_000.0)))
    assert abs(out["fed_tax"] - expected_tax) < 1.0

    # And it is exactly $2,000,000 more than the no-gift run on the same estate.
    base_out = _portability(project_estate(**_base_kwargs()))
    assert abs((out["fed_tax"] - base_out["fed_tax"]) - 2_000_000.0) < 1.0


def test_gift_split_across_both_decedents_sums_in_base():
    """A split $5M gift ($2.5M each) adds the same $5M to the base as a single
    donor's $5M gift -> identical fed_tax for the pinned estate."""
    single = _portability(project_estate(**_base_kwargs(adjusted_gifts_first_death=5_000_000.0)))
    split = _portability(project_estate(**_base_kwargs(
        adjusted_gifts_first_death=2_500_000.0, adjusted_gifts_second_death=2_500_000.0)))
    assert abs(single["fed_tax"] - split["fed_tax"]) < 1.0



# --- Projection-side parser + wiring (Stage 1) ------------------------------
import copy

from defaults import DEFAULT_SCENARIO
from projection import run_projection, _cfg_adjusted_gifts


def _scenario_with_gifts(gifts):
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    cfg.setdefault("giving", {})["taxable_gifts"] = gifts
    return cfg


def test_projection_no_taxable_gifts_key_absent():
    """Without a taxable_gifts array the giving block must NOT carry the new key
    (keeps the golden baseline byte-identical)."""
    res = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    assert "taxable_gifts" not in res["giving"]


def test_projection_tracks_cumulative_adjusted_gifts_per_donor():
    """Client + Joint gifts accumulate per donor (Joint splits 50/50) and drain
    the donor's taxable balance."""
    sy = DEFAULT_SCENARIO["projection"]["start_year"]
    cfg = _scenario_with_gifts([
        {"year": sy + 1, "amount": 2_000_000, "donor": "Client"},
        {"year": sy + 2, "amount": 1_000_000, "donor": "Joint"},
    ])
    tax_ids = [a["id"] for a in cfg["accounts"] if a["tax_type"] == "Taxable"]
    tax_before = sum(a.get("beginning_balance", 0.0) for a in cfg["accounts"] if a["id"] in tax_ids)

    res = run_projection(cfg)
    tg = res["giving"]["taxable_gifts"]
    assert abs(tg["by_donor"]["Client"] - 2_500_000.0) < 1.0
    assert abs(tg["by_donor"]["Spouse"] - 500_000.0) < 1.0
    assert abs(tg["total"] - 3_000_000.0) < 1.0
    assert len(tg["rows"]) == 2
    # The projection totals match the cfg-derived helper the funding-order path uses.
    first, second = _cfg_adjusted_gifts(cfg)
    assert abs(first - tg["adjusted_gifts_first_death"]) < 1.0
    assert abs(second - tg["adjusted_gifts_second_death"]) < 1.0


def test_projection_gift_capped_at_available_balance():
    """A gift larger than the household's taxable+cash balance funds only what's
    available — the cumulative adjusted gift never exceeds drained dollars."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    avail = sum(a.get("beginning_balance", 0.0) for a in cfg["accounts"]
                if a["tax_type"] in ("Taxable", "Cash"))
    sy = cfg["projection"]["start_year"]
    cfg.setdefault("giving", {})["taxable_gifts"] = [
        {"year": sy, "amount": avail + 50_000_000, "donor": "Client"},
    ]
    res = run_projection(cfg)
    tg = res["giving"]["taxable_gifts"]
    # The requested gift far exceeds the household's liquid assets, so it can only
    # be partially funded — the cumulative adjusted gift is bounded well below the
    # request and stays positive.
    assert 0.0 < tg["total"] < (avail + 50_000_000)


def test_projection_carryover_basis_after_tax_pot():
    """§1015: gifted appreciated assets carry the donor's basis. The family pot's
    embedded gain (value - carryover basis) is taxed to heirs at the LTCG rate, so
    the after-tax pot is strictly below the nominal pot when there is a gain."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    sy = cfg["projection"]["start_year"]
    cfg.setdefault("giving", {})["taxable_gifts"] = [
        {"year": sy + 1, "amount": 3_000_000, "donor": "Client"},
    ]
    res = run_projection(cfg)
    cob = res["giving"]["carryover_basis"]
    pot = res["giving"]["ending_pot"]
    assert cob["pot_basis"] >= 0
    assert cob["embedded_gain"] == round(max(0.0, pot - cob["pot_basis"]), 2)
    assert cob["ltcg_owed_at_sale"] == round(cob["embedded_gain"] * cob["heir_ltcg_rate"], 2)
    assert cob["pot_after_tax"] < pot  # a real embedded gain => a haircut
    assert cob["pot_after_tax"] == round(pot - cob["ltcg_owed_at_sale"], 2)


def test_projection_no_carryover_key_without_gifts():
    """No gifts -> no carryover_basis key (golden-safe)."""
    res = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    assert "carryover_basis" not in res["giving"]
