"""Estate planning engine — 4 post-mortem strategies compared side-by-side.

Strategies (all applied to the same household):
    A. portability      — Simple: 100% to spouse via marital ded; DSUE election.
    B. bypass           — Credit-shelter trust funded to fed exclusion at Y1;
                          remainder to spouse via marital ded.
    C. qtip_bypass      — Bypass to exclusion + QTIP for spouse (marital ded);
                          both eligible for GST allocation on the bypass.
    D. gst_layered      — Bypass with GST at Y1 + second GST trust at Y2 from
                          DSUE + surviving spouse's exclusion (dynasty planning).

Roth-first trust funding
========================
Whenever a trust is funded (B/C/D), Roth assets are routed to the trust FIRST,
then Taxable. Traditional IRA / 401(k) NEVER enters a trust (see warning).

Roth in a GST/bypass trust escapes estate + GST tax at every subsequent death,
BUT the SECURE Act's 10-year window still applies: Roth-in-trust grows
income-tax free only for 10 years after the decedent's death. After year 10
the Roth wrapper terminates and retained trust income is subject to the
compressed trust tax brackets (37% federal ordinary / 20% federal LTCG).

Taxable assets funded into a trust have NO Roth-style grace period — from the
year they enter the trust (i.e. the death of the respective spouse) they are
fully taxable at trust rates on ordinary income (dividends/interest) and
LTCG on realized capital gains.

Basis step-up (§ 1014)
======================
    Roth:        No tax during the SECURE 10-year window (always $1 → $1 to
                 heirs). No basis matters. After year 10, trust rates apply on
                 retained income if held in an accumulation trust.
    Taxable held in household:
                 Full step-up at each death (Y1 and Y2). Heirs receive assets
                 at FMV basis and pay 0 LTCG. Applies to Strategy A (Portability)
                 and to QTIP + survivor-owned portions of Strategy C.
    Taxable inside irrevocable trust (bypass, GST-Exempt):
                 §1014 step-up applied ONCE at the funding death (Y1 for bypass /
                 GST-1, Y2 for GST-2 funded from the survivor's already-stepped-up
                 estate). Basis is locked at that funding-date FMV thereafter.
                 Heirs owe 15% federal LTCG on trust-internal appreciation from
                 that funding date to their eventual sale.
    Traditional: NO step-up. Heirs draw down over SECURE 10-year window at their
                 ordinary rate (scenario.legacy.heir_federal_rate).

Assumptions
===========
- Trust-held Taxable's basis is the FMV at funding (§1014 step-up applied there),
  NOT the household's pre-death cost basis. The legacy `taxable_basis_pct` API
  parameter is accepted for backward compatibility but is ignored — earlier versions
  treated basis as a fixed fraction of the CURRENT trust value, which double-counted
  the step-up and was fixed in the 2026-02-18 §1014 correction.
- 15% federal LTCG rate on any un-stepped-up gains at heir sale.
- Trust ordinary-income drag: 2% dividend/interest yield × 37% top rate.
- Trust LTCG drag: 20% of unrealized appreciation realized/yr × 20% top rate.
- Traditional IRA stays with surviving spouse in every strategy (rollover).
- State estate tax exclusions are NON-portable except HI and MD.
- Federal exclusion chained-CPI indexed forward (permanent per OBBBA).
"""
from __future__ import annotations

from typing import Any

# OBBBA statutory: $15,000,000 base for taxable years beginning after 2025,
# adjusted for inflation for years beginning after 2026 from the $15M base.
# Pre-OBBBA (year < 2026) uses the pre-existing $13.99M-at-2025 base for
# historical continuity.
FED_EXCLUSION_BASE = 15_000_000
FED_EXCLUSION_BASE_YEAR = 2026
PRE_OBBBA_BASE = 13_990_000
PRE_OBBBA_BASE_YEAR = 2025
# Legacy fallback only — DEFAULT_INDEXING_RATE is used ONLY when a caller does
# not supply an indexing rate. Per user directive (2026-02): all bracket &
# exemption indexing should follow the model's assumed CPI (config.projection.
# general_inflation), matching the spreadsheet's single BracketInfl variable.
DEFAULT_INDEXING_RATE = 0.03
FED_ESTATE_TAX_RATE = 0.40
LTCG_RATE = 0.15  # federal LTCG; state cap-gains handled separately
DEFAULT_TAXABLE_BASIS_PCT = 0.50  # 50% of taxable value assumed to be basis

# Trust-bracket parameters. Trusts hit the top compressed bracket ($15,650 in
# 2025 for ordinary, $15,650 for LTCG) very quickly — treat everything above
# ~$16K of annual retained income as taxed at these top rates.
TRUST_ORD_TAX_RATE = 0.37       # top federal ordinary bracket in a trust
TRUST_LTCG_TAX_RATE = 0.20      # top federal LTCG bracket in a trust
TRUST_INCOME_YIELD = 0.02       # % of NAV distributed as ordinary income (div/int)
TRUST_TURNOVER = 0.20           # % of unrealized appreciation realized annually
SECURE_YEARS = 10               # SECURE Act 10-year distribution window


def fed_exclusion(year: int, indexing_rate: float | None = None) -> float:
    """Federal estate/gift/GST exclusion for a given calendar year.

    OBBBA (One Big Beautiful Bill Act) sets the exclusion at $15,000,000
    for taxable years beginning after 2025, indexed for inflation each
    subsequent year from the $15M base. `indexing_rate` should be the
    model's assumed CPI (config.projection.general_inflation) — this ties
    the exclusion growth to the single inflation rate the user controls
    on the Inputs page, matching the spreadsheet's `BracketInfl` variable.
    Falls back to DEFAULT_INDEXING_RATE (3%) if unspecified.
    """
    r = DEFAULT_INDEXING_RATE if indexing_rate is None else max(0.0, float(indexing_rate))
    if year >= FED_EXCLUSION_BASE_YEAR:
        yrs = year - FED_EXCLUSION_BASE_YEAR
        return FED_EXCLUSION_BASE * ((1.0 + r) ** yrs)
    yrs = year - PRE_OBBBA_BASE_YEAR  # may be negative for < 2025
    return PRE_OBBBA_BASE * ((1.0 + r) ** yrs)


# State exclusion snapshots in `STATE_ESTATE_TAX` below are 2025 values; the
# state-indexing loop anchors off this year (independent of federal OBBBA
# rebase to 2026 in FED_EXCLUSION_BASE_YEAR).
STATE_EXCLUSION_BASE_YEAR = 2025

STATE_ESTATE_TAX = {
    "CT": {"name": "Connecticut", "exclusion": 13_610_000, "top_rate": 0.12,
           "portable": False, "indexed": True, "note": "Matches federal exclusion (2023+)."},
    "DC": {"name": "District of Columbia", "exclusion": 4_873_200, "top_rate": 0.16,
           "portable": False, "indexed": True},
    "HI": {"name": "Hawaii", "exclusion": 5_490_000, "top_rate": 0.20,
           "portable": True, "indexed": True,
           "note": "Portable since 2020 — surviving spouse can use decedent's unused exclusion."},
    "IL": {"name": "Illinois", "exclusion": 4_000_000, "top_rate": 0.16,
           "portable": False, "indexed": False, "note": "Exclusion frozen at $4M since 2013 (statutory)."},
    "MA": {"name": "Massachusetts", "exclusion": 2_000_000, "top_rate": 0.16,
           "portable": False, "indexed": False,
           "note": "Cliff exclusion — $2M applies to entire estate over $2M (2023 reform). Statutory freeze."},
    "MD": {"name": "Maryland", "exclusion": 5_000_000, "top_rate": 0.16,
           "portable": True, "indexed": False,
           "note": "Statutory freeze. MD also imposes a 10% inheritance tax on non-lineal heirs (not modeled)."},
    "ME": {"name": "Maine", "exclusion": 6_800_000, "top_rate": 0.12, "portable": False, "indexed": True},
    "MN": {"name": "Minnesota", "exclusion": 3_000_000, "top_rate": 0.16, "portable": False, "indexed": False,
           "note": "Statutory freeze at $3M."},
    "NY": {"name": "New York", "exclusion": 6_940_000, "top_rate": 0.16, "portable": False, "indexed": True,
           "cliff_multiplier": 1.05,
           "note": "Cliff — estates > 105% of exclusion LOSE the exclusion entirely."},
    "OR": {"name": "Oregon", "exclusion": 1_000_000, "top_rate": 0.16, "portable": False, "indexed": False,
           "note": "Statutory freeze at $1M since 2012."},
    "RI": {"name": "Rhode Island", "exclusion": 1_774_583, "top_rate": 0.16, "portable": False, "indexed": True},
    "VT": {"name": "Vermont", "exclusion": 5_000_000, "top_rate": 0.16, "portable": False, "indexed": False,
           "note": "Flat 16% rate above $5M exclusion. Statutory freeze."},
    "WA": {"name": "Washington", "exclusion": 2_193_000, "top_rate": 0.20, "portable": False, "indexed": True,
           "note": "Highest US top rate (20% > $9M taxable) — steep for HNW."},
}


def state_exclusion(state_code: str, year: int, indexing_rate: float | None = None) -> float:
    """State exclusion for `year`, indexed per model CPI where the state law
    provides for indexing (all others are statutorily frozen).

    `indexing_rate` should be the model's assumed CPI (config.projection.
    general_inflation). Falls back to DEFAULT_INDEXING_RATE (3%) if omitted.
    States marked `indexed=False` remain frozen regardless of the parameter —
    that's a statutory reality, not a modeling choice.
    """
    s = STATE_ESTATE_TAX.get(state_code)
    if not s:
        return 0.0
    yrs = max(0, year - STATE_EXCLUSION_BASE_YEAR)
    if not s.get("indexed"):
        return s["exclusion"]
    r = DEFAULT_INDEXING_RATE if indexing_rate is None else max(0.0, float(indexing_rate))
    return s["exclusion"] * ((1.0 + r) ** yrs)


def state_estate_tax(estate_value: float, state_code: str, year: int, dsue: float = 0.0,
                      indexing_rate: float | None = None) -> float:
    s = STATE_ESTATE_TAX.get(state_code)
    if not s or estate_value <= 0:
        return 0.0
    excl = state_exclusion(state_code, year, indexing_rate=indexing_rate)
    if s.get("portable"):
        excl += dsue
    cliff = s.get("cliff_multiplier")
    if cliff and estate_value > excl * cliff:
        return estate_value * s["top_rate"]
    return max(0.0, (estate_value - excl) * s["top_rate"])


def get_state_estate_metadata() -> list[dict]:
    return [
        {"code": code, **{k: v for k, v in data.items() if k != "cliff_multiplier"},
         "has_cliff": "cliff_multiplier" in data}
        for code, data in sorted(STATE_ESTATE_TAX.items(), key=lambda x: x[1]["name"])
    ]


# -- Basis step-up helpers ----------------------------------------------

# NOTE ON TRUST GROWTH RATE (revised model, 2026-02)
# --------------------------------------------------
# The IRC's compressed trust brackets (37% ordinary above ~$16K, 20% LTCG)
# ONLY apply to income and gains that are RETAINED inside the trust. A
# well-drafted irrevocable trust sidesteps this by distributing ordinary
# income to beneficiaries annually (taxed at their ordinary rate, not the
# trust's) and distributing appreciated assets in-kind before sale
# (beneficiaries recognize LTCG at THEIR rate on eventual sale). Under
# that operating model — which is what advisors actually practice — the
# trust NAV compounds at the client's own gross taxable rate with NO
# internal deduction for income taxes or capital gains. Constants like
# TRUST_ORD_TAX_RATE / TRUST_LTCG_TAX_RATE below remain as documentation of
# the "worst-case, retained income" scenario but are no longer applied to
# the compounding curve.


def _grow_roth_in_trust(v: float, gross_rate: float, years: int) -> float:
    """Roth held in an irrevocable trust.

    Compounds at the full gross rate for all years. SECURE Act requires the
    Roth wrapper to be fully distributed within 10 years of the funding
    death — under the revised model the distributed corpus is invested in
    the beneficiaries' own accounts at the same gross rate, so trust NAV
    tracks a single compounding curve regardless of the SECURE clock.
    (See the "NOTE ON TRUST GROWTH RATE" block above.)
    """
    if v <= 0 or years <= 0:
        return max(0.0, v)
    return v * ((1.0 + gross_rate) ** years)


def _grow_taxable_in_trust(v: float, gross_rate: float, years: int) -> float:
    """Taxable brokerage held in an irrevocable trust.

    Compounds at the full gross rate. Ordinary income (dividends/interest)
    is distributed annually and taxed at beneficiaries' rates; realized
    capital gains are recognized by beneficiaries on in-kind distribution
    and eventual sale. From the trust's NAV perspective this is
    tax-neutral. Heirs still owe LTCG on trust-internal appreciation at
    eventual sale — captured separately by `_after_tax_taxable`.
    """
    if v <= 0 or years <= 0:
        return max(0.0, v)
    return v * ((1.0 + gross_rate) ** years)


def _after_tax_taxable(current_value: float, entry_basis: float = 0.0, stepped_up: bool = False) -> float:
    """After-tax value of a Taxable-account slug when heirs eventually sell.

    Two modes, keyed by whether §1014 step-up applied at the relevant death:

      stepped_up=True:
        The assets were in the decedent's estate at the death immediately
        preceding this evaluation → basis is reset to FMV → heirs pay 0 LTCG.
        `entry_basis` is ignored (any value passes through).

      stepped_up=False:
        The assets are held inside an irrevocable bypass or GST-Exempt trust
        that was funded at a prior death. §1014 step-up applied ONCE at that
        prior funding death (so the trust's locked-in basis is the FMV at
        funding — passed in as `entry_basis`). Subsequent trust-internal
        appreciation is un-stepped-up; heirs owe 15% federal LTCG on
        (current_value − entry_basis) at eventual sale.

    Note: this function does NOT model the trust's ongoing income-tax drag on
    dividends / interest / turnover-realized LTCG inside the trust — under
    the revised trust-growth model (see NOTE at the top of the module) the
    trust NAV compounds at the client's gross rate, since ordinary income
    and realized gains are distributed to beneficiaries rather than retained.
    The 15% LTCG applied here is the tax beneficiaries owe on eventual
    in-kind sale of trust-internal appreciation.
    """
    if current_value <= 0:
        return 0.0
    if stepped_up:
        return current_value
    gain = max(0.0, current_value - max(0.0, entry_basis))
    return current_value - gain * LTCG_RATE


def _after_tax_traditional(value: float, heir_rate: float) -> float:
    """After-tax value of Traditional IRA / 401(k) drawn down under SECURE 10yr.

    Approximated as a single-year full drawdown at heir_rate — actual 10-yr
    smoothing helps modestly but the step-up gap vs. Roth is the story.
    """
    return max(0.0, value * (1.0 - heir_rate))


# -- Outright (non-trust) growth helpers with per-vehicle clocks -------------
# When Roth / Taxable / Traditional pass OUTRIGHT to heirs at the second death
# (Strategy A portability, and the residual portion in B/C/D), each vehicle
# carries its OWN SECURE clock and its OWN post-transfer tax regime — they
# should NOT be blended into a single household bucket compounding at the
# survivor's gross growth rate. These helpers model each vehicle correctly.
def _heir_effective_rate(gross_rate: float, heir_rate: float) -> float:
    """Effective growth rate for assets held in an heir-owned taxable brokerage.

    Ordinary income (dividend/interest yield) is taxed at the heir's ordinary
    rate; realized capital gains (turnover portion of appreciation) are taxed
    at the federal LTCG rate (heirs' bracket approximated as 15%).
    """
    if gross_rate <= 0:
        return gross_rate
    ord_drag = TRUST_INCOME_YIELD * heir_rate
    cap_drag = max(0.0, gross_rate - TRUST_INCOME_YIELD) * TRUST_TURNOVER * LTCG_RATE
    return max(0.0, gross_rate - ord_drag - cap_drag)


def _grow_outright_roth(v: float, gross_rate: float, heir_rate: float, years: int) -> float:
    """Outright Roth passed to heirs at the second death.

    Years 0 → SECURE_YEARS: tax-free (Roth wrapper still in force; SECURE
    Act requires full distribution within 10 years but the internal Roth
    balance grows tax-free during that window).
    Years SECURE_YEARS+: Roth wrapper terminates. Heirs receive the
    distributed dollars and reinvest in a taxable brokerage — subsequent
    growth is subject to ordinary tax on dividends + LTCG on realized gains
    (modeled via `_heir_effective_rate`).
    """
    if v <= 0 or years <= 0:
        return max(0.0, v)
    protected = min(SECURE_YEARS, years)
    post = max(0, years - SECURE_YEARS)
    r_post = _heir_effective_rate(gross_rate, heir_rate)
    return v * ((1.0 + gross_rate) ** protected) * ((1.0 + r_post) ** post)


def _grow_outright_taxable_stepped(v: float, gross_rate: float, heir_rate: float, years: int) -> float:
    """Outright Taxable brokerage — §1014 stepped-up at the second death.

    Basis is reset to FMV at Y2 (heirs owe zero LTCG at that moment). From
    Y2 onward the account grows in an heir-owned taxable brokerage: annual
    drag on dividends (heir ordinary rate) + realized turnover LTCG (15%).
    No SECURE clock (§1014 already resolved the basis question at Y2).
    """
    if v <= 0 or years <= 0:
        return max(0.0, v)
    r_eff = _heir_effective_rate(gross_rate, heir_rate)
    return v * ((1.0 + r_eff) ** years)


def _grow_outright_traditional(gross_at_y2: float, gross_rate: float, heir_rate: float, years: int) -> float:
    """Outright Traditional IRA / 401(k) — SECURE 10-year linear drawdown.

    `gross_at_y2` is the pre-heir-income-tax IRA balance at the second death
    (already reduced by any federal/state estate tax haircut). Each year of
    the SECURE window: (a) the IRA grows at the gross rate, (b) a proportional
    slice is distributed (1 / remaining_secure_years), (c) the distribution
    is taxed at `heir_rate` and the net lands in an heir-owned taxable
    brokerage that compounds at `_heir_effective_rate` thereafter.

    At `years == 0`: returns gross × (1 − heir_rate) — matches the immediate-
    liquidation view used by `household_after_tax_at_y2`.
    At `years >= SECURE_YEARS`: IRA is empty; only brokerage compounds.
    """
    v = max(0.0, gross_at_y2)
    if v <= 0:
        return 0.0
    if years <= 0:
        return v * (1.0 - heir_rate)
    r_eff = _heir_effective_rate(gross_rate, heir_rate)
    ira = v
    brokerage = 0.0
    horizon = min(SECURE_YEARS, years)
    for y in range(1, horizon + 1):
        ira *= (1.0 + gross_rate)
        remaining_secure = SECURE_YEARS - (y - 1)
        distribute = ira / remaining_secure
        ira -= distribute
        brokerage += distribute * (1.0 - heir_rate)
        if y < years:
            brokerage *= (1.0 + r_eff)
    # Past the SECURE window, IRA is fully distributed; brokerage keeps compounding.
    remaining = max(0, years - SECURE_YEARS)
    brokerage *= ((1.0 + r_eff) ** remaining)
    return brokerage + ira  # ira ≈ 0 for years >= SECURE_YEARS


# ---------------------------------------------------------------------------
# Main engine — computes ALL 4 strategies for a given household + config.
# ---------------------------------------------------------------------------

def project_estate(
    *,
    first_death_year: int,
    second_death_year: int,
    # NEW: separate balances by account type so we can route Roth to trusts first,
    # apply step-up to Taxable, and never route Traditional to any trust.
    deceased_roth_at_y1: float,
    deceased_taxable_at_y1: float,
    survivor_roth_at_y1: float,
    survivor_taxable_at_y1: float,
    traditional_at_y1: float,  # stays with survivor in every strategy (rollover)
    # Growth rates.
    trust_growth_rate: float = 0.06,
    survivor_growth_rate: float = 0.06,
    traditional_growth_rate: float | None = None,
    # Tax / basis assumptions.
    heir_marginal_rate: float = 0.3165,
    taxable_basis_pct: float = DEFAULT_TAXABLE_BASIS_PCT,   # deprecated: ignored post 2026-02-18 §1014 fix
    state_code: str = "",
    use_portability: bool = True,
    gst_funding_order: str = "roth_first",  # "roth_first" (default) or "taxable_first" — applies to Layered GST strategy only
    indexing_rate: float | None = None,  # model's assumed CPI (fed + state exclusions)
    horizons_after_second_death: tuple = (0, 10, 20, 30),
    # Per-class household balances at the SECOND death from the retirement
    # projection. When all three are provided, the engine scales each class so
    # the strategies' combined second-death base lands exactly on the retirement
    # model's actual Y2 balances (same convention as the EP flowchart) — this
    # page then reconciles to the EP Projection pages instead of compounding Y1
    # balances at stylized rates that ignore between-death spending and taxes.
    y2_roth: float | None = None,
    y2_taxable: float | None = None,
    y2_traditional: float | None = None,
) -> dict:
    """Full 4-strategy estate comparison.

    Every strategy is evaluated against the SAME starting balances so the delta
    row in the response tells the advisor which structure adds the most net-
    to-heirs dollars. Roth-first funding is applied wherever a trust is created.
    """
    if second_death_year < first_death_year:
        first_death_year, second_death_year = second_death_year, first_death_year

    trust_growth_rate = max(0.0, trust_growth_rate)
    survivor_growth_rate = max(0.0, survivor_growth_rate)
    if traditional_growth_rate is None:
        traditional_growth_rate = survivor_growth_rate
    yrs_between = max(0, second_death_year - first_death_year)

    fed_excl_y1 = fed_exclusion(first_death_year, indexing_rate=indexing_rate)
    fed_excl_y2 = fed_exclusion(second_death_year, indexing_rate=indexing_rate)

    deceased_total = deceased_roth_at_y1 + deceased_taxable_at_y1
    survivor_total = survivor_roth_at_y1 + survivor_taxable_at_y1

    # -- helper: fund a bypass/GST trust up to `cap`, in the requested order.
    def _route_to_trust(roth: float, taxable: float, cap: float, order: str = "roth_first"):
        """Return (roth_to_trust, taxable_to_trust, roth_left, taxable_left)."""
        if cap <= 0:
            return 0.0, 0.0, roth, taxable
        if order == "taxable_first":
            taxable_to = min(taxable, cap)
            remaining_cap = cap - taxable_to
            roth_to = min(roth, remaining_cap)
        else:  # roth_first (default)
            roth_to = min(roth, cap)
            remaining_cap = cap - roth_to
            taxable_to = min(taxable, remaining_cap)
        return roth_to, taxable_to, roth - roth_to, taxable - taxable_to

    # Grow a mixed-asset slug (Roth = trust growth rate always; taxable inside
    # trust also compounds at trust rate since trusts are typically 100% equity
    # and rarely realize gains).
    def _grow(v, r, yrs): return v * ((1.0 + r) ** yrs)

    # Trust growth helpers with the SECURE window + compressed trust brackets.
    # Roth in trust gets a 10-year Roth-wrapper grace before drag applies.
    # Taxable in trust has drag from year 0 (entry) onward — no grace.
    def _roth_trust(v, yrs): return _grow_roth_in_trust(v, trust_growth_rate, yrs)
    def _tax_trust(v, yrs):  return _grow_taxable_in_trust(v, trust_growth_rate, yrs)

    # -- Y1→Y2 growth basis: projection-scaled factors OR legacy stylized rates.
    _y1_cls = {"roth": deceased_roth_at_y1 + survivor_roth_at_y1,
               "taxable": deceased_taxable_at_y1 + survivor_taxable_at_y1,
               "trad": traditional_at_y1}
    _y2_cls = {"roth": y2_roth, "taxable": y2_taxable, "trad": y2_traditional}
    use_projection = all(v is not None for v in _y2_cls.values())
    if use_projection:
        _factors = {k: (_y2_cls[k] / _y1_cls[k]) if _y1_cls[k] > 0 else 0.0 for k in _y1_cls}
        # Classes that are zero at Y1 but nonzero at Y2 credit to the survivor.
        _orph = {k: (_y2_cls[k] if _y1_cls[k] <= 0 else 0.0) for k in _y1_cls}
    else:
        _factors = None
        _orph = {"roth": 0.0, "taxable": 0.0, "trad": 0.0}

    def _to_y2(v, cls, in_trust=False):
        """Carry a Y1 slug of class `cls` to the second death. In projection mode
        every slug of a class (trust-held or household) follows the class's
        actual projection path; in legacy mode trust slugs compound at the trust
        rate and household slugs at the survivor rate."""
        if use_projection:
            return v * _factors[cls]
        if cls == "trad":
            return _grow(v, traditional_growth_rate, yrs_between)
        return _grow(v, trust_growth_rate if in_trust else survivor_growth_rate, yrs_between)

    # -- STRATEGY A: Portability-Only --------------------------------------
    # Everything to survivor at Y1 via marital ded. DSUE = full Y1 exclusion.
    # At Y2: survivor holds all of it. Roth → tax free. Taxable → full step-up.
    # Traditional → no step-up (goes through heir's 10-yr window).
    def _run_portability():
        dsue = fed_excl_y1 if use_portability else 0.0
        avail_y2 = fed_excl_y2 + dsue
        # Survivor holds ALL Roth + Taxable at Y1, carried to Y2.
        roth_y2 = _to_y2(deceased_roth_at_y1 + survivor_roth_at_y1, "roth") + _orph["roth"]
        taxable_y2 = _to_y2(deceased_taxable_at_y1 + survivor_taxable_at_y1, "taxable") + _orph["taxable"]
        trad_y2 = _to_y2(traditional_at_y1, "trad") + _orph["trad"]
        estate_y2 = roth_y2 + taxable_y2 + trad_y2

        fed_taxable = max(0.0, estate_y2 - avail_y2)
        fed_tax = fed_taxable * FED_ESTATE_TAX_RATE
        st_tax = state_estate_tax(estate_y2, state_code, second_death_year, dsue=dsue, indexing_rate=indexing_rate)

        # Basis step-up applied to Taxable (§1014, held in survivor's estate).
        taxable_after_tax = _after_tax_taxable(taxable_y2, stepped_up=True)
        trad_after_tax = _after_tax_traditional(trad_y2, heir_marginal_rate)
        # Estate tax hits the whole estate proportionally — apply to net-of-basis-step-up
        # sum, then heirs receive residual.
        gross_after_step = roth_y2 + taxable_after_tax + trad_after_tax
        # Fed + state estate tax reduce the gross-after-step (which is what actually
        # gets distributed — everything above the exclusion pays 40%).
        net = max(0.0, gross_after_step - fed_tax - st_tax)
        # Decompose the estate-tax haircut across the three vehicles so each can
        # be compounded with its OWN clock at horizons (SECURE 10-yr Roth, heir
        # brokerage drag on Taxable, SECURE 10-yr drawdown on Traditional).
        haircut = 1.0 if gross_after_step <= 0 else max(0.0, 1.0 - (fed_tax + st_tax) / gross_after_step)
        household_components = {
            "roth_after_estate_tax": roth_y2 * haircut,
            "taxable_after_estate_tax_stepped": taxable_after_tax * haircut,
            "traditional_after_estate_tax_gross": trad_y2 * haircut,
        }
        return _outcome(
            "portability",
            gst1_y2=0.0, gst2_y2=0.0,
            trust_after_tax_at_y2=0.0,
            household_after_tax=net, fed_tax=fed_tax, state_tax=st_tax,
            estate_y2=estate_y2, dsue=dsue, roth_y2=roth_y2, taxable_y2=taxable_y2,
            trad_y2=trad_y2, trust_components=[],
            household_components=household_components,
            notes="Full basis step-up. State exclusion lost if non-portable.",
        )

    # -- STRATEGY B: Bypass Only ------------------------------------------
    # Fund bypass at Y1 up to fed_excl_y1 (Roth first). No portability needed.
    # Bypass Roth grows tax-free for the SECURE 10-year window then faces
    # compressed trust brackets on retained income; Bypass Taxable faces trust-
    # bracket drag from Y1. Survivor holds remainder + Traditional.
    def _run_bypass():
        # Fund bypass with deceased's assets only (bypass is funded from decedent's estate).
        # Cap = min(deceased's assets, fed exclusion).
        roth_to_bypass, tax_to_bypass, roth_left, tax_left = _route_to_trust(
            deceased_roth_at_y1, deceased_taxable_at_y1, fed_excl_y1)
        # Grow the two components to Y2 using their respective growth models.
        bypass_roth_share    = _to_y2(roth_to_bypass, "roth", in_trust=True)
        bypass_taxable_share = _to_y2(tax_to_bypass, "taxable", in_trust=True)
        # Survivor holds: remainder of deceased's stuff + all of survivor's own.
        survivor_roth = _to_y2(survivor_roth_at_y1 + roth_left, "roth") + _orph["roth"]
        survivor_taxable = _to_y2(survivor_taxable_at_y1 + tax_left, "taxable") + _orph["taxable"]
        trad_y2 = _to_y2(traditional_at_y1, "trad") + _orph["trad"]

        # Y2 estate: ONLY survivor's holdings (bypass excluded).
        estate_y2 = survivor_roth + survivor_taxable + trad_y2
        # No portability needed since bypass used the deceased's exclusion at Y1.
        avail_y2 = fed_excl_y2  # survivor's own only
        fed_tax = max(0.0, estate_y2 - avail_y2) * FED_ESTATE_TAX_RATE
        st_tax = state_estate_tax(estate_y2, state_code, second_death_year, dsue=0.0, indexing_rate=indexing_rate)

        # Basis step-up: applies to survivor's Taxable (held in her estate), NOT to bypass Taxable.
        survivor_taxable_after = _after_tax_taxable(survivor_taxable, stepped_up=True)
        # Bypass Taxable does NOT get step-up at Y2 — but it DID get step-up at Y1 when
        # the trust was funded (§1014 on the decedent's estate). So its locked-in basis is
        # the Y1 FMV = tax_to_bypass. Heirs owe 15% LTCG on trust-internal appreciation only.
        bypass_after_step = bypass_roth_share + _after_tax_taxable(bypass_taxable_share, entry_basis=tax_to_bypass, stepped_up=False)
        trad_after_tax = _after_tax_traditional(trad_y2, heir_marginal_rate)
        # Estate taxes hit survivor's estate only; bypass paid its own at Y1 (none, within exclusion).
        gross_household = survivor_roth + survivor_taxable_after + trad_after_tax
        household_net = max(0.0, gross_household - fed_tax - st_tax)
        haircut = 1.0 if gross_household <= 0 else max(0.0, 1.0 - (fed_tax + st_tax) / gross_household)
        household_components = {
            "roth_after_estate_tax": survivor_roth * haircut,
            "taxable_after_estate_tax_stepped": survivor_taxable_after * haircut,
            "traditional_after_estate_tax_gross": trad_y2 * haircut,
        }
        return _outcome(
            "bypass",
            gst1_y2=bypass_after_step, gst2_y2=0.0,
            trust_after_tax_at_y2=bypass_after_step,
            household_after_tax=household_net, fed_tax=fed_tax, state_tax=st_tax,
            estate_y2=estate_y2, dsue=0.0, roth_y2=survivor_roth, taxable_y2=survivor_taxable,
            trad_y2=trad_y2,
            bypass_roth_y2=bypass_roth_share, bypass_taxable_y2=bypass_taxable_share,
            trust_components=[{"entry_year": first_death_year,
                               "roth_entry": roth_to_bypass, "taxable_entry": tax_to_bypass}],
            household_components=household_components,
            notes="Bypass escapes Y2 estate. State exclusion preserved. Bypass Taxable §1014-steps-up at Y1 funding, locking in FMV as basis. Under the revised trust-growth model, trust NAV compounds at the client's gross taxable rate — ordinary income is distributed to beneficiaries and appreciated assets pass in-kind, avoiding the trust's compressed brackets. Heirs owe LTCG on trust-internal appreciation at eventual sale.",
        )

    # -- STRATEGY C: QTIP + Bypass ---------------------------------------
    # Fund bypass with Roth first up to exclusion; remainder (any deceased Roth left
    # + all deceased Taxable) goes into QTIP for spouse. QTIP is a simple trust that
    # must distribute income annually to the surviving spouse — so QTIP income is
    # taxed at HER individual rate (modeled here as survivor_growth_rate, no drag).
    # QTIP is included in Y2 estate via §2044 and gets step-up. Bypass grows outside
    # Y2 estate and follows the SECURE/trust-bracket rules.
    def _run_qtip_bypass():
        roth_to_bypass, tax_to_bypass, roth_left, tax_left = _route_to_trust(
            deceased_roth_at_y1, deceased_taxable_at_y1, fed_excl_y1)
        bypass_roth_share    = _to_y2(roth_to_bypass, "roth", in_trust=True)
        bypass_taxable_share = _to_y2(tax_to_bypass, "taxable", in_trust=True)

        # QTIP funded from deceased's remainder — grows at survivor's rate (simple
        # trust distributes DNI to spouse annually, taxed at her individual rate).
        qtip_roth_y2 = _to_y2(roth_left, "roth")
        qtip_taxable_y2 = _to_y2(tax_left, "taxable")
        # Survivor's own assets + Traditional.
        survivor_roth = _to_y2(survivor_roth_at_y1, "roth") + _orph["roth"]
        survivor_taxable = _to_y2(survivor_taxable_at_y1, "taxable") + _orph["taxable"]
        trad_y2 = _to_y2(traditional_at_y1, "trad") + _orph["trad"]

        # Y2 estate = survivor's own + QTIP + Traditional (bypass excluded).
        estate_y2 = survivor_roth + survivor_taxable + qtip_roth_y2 + qtip_taxable_y2 + trad_y2
        # No portability needed; bypass used decedent's exclusion. If any exclusion left
        # unused at Y1 (Roth-first + fed excl > deceased total), DSUE captures it.
        bypass_y1 = roth_to_bypass + tax_to_bypass
        dsue = max(0.0, fed_excl_y1 - bypass_y1) if use_portability else 0.0
        avail_y2 = fed_excl_y2 + dsue
        fed_tax = max(0.0, estate_y2 - avail_y2) * FED_ESTATE_TAX_RATE
        st_tax = state_estate_tax(estate_y2, state_code, second_death_year, dsue=dsue, indexing_rate=indexing_rate)

        # Basis step-up: QTIP Taxable + survivor's Taxable BOTH get step-up (§ 2044 → in estate).
        survivor_taxable_after = _after_tax_taxable(survivor_taxable, stepped_up=True)
        qtip_taxable_after = _after_tax_taxable(qtip_taxable_y2, stepped_up=True)
        # Bypass Taxable stepped-up at Y1 funding (basis = Y1 FMV), then trust-locked thereafter.
        bypass_after_step = bypass_roth_share + _after_tax_taxable(bypass_taxable_share, entry_basis=tax_to_bypass, stepped_up=False)
        trad_after_tax = _after_tax_traditional(trad_y2, heir_marginal_rate)

        gross_household = survivor_roth + survivor_taxable_after + qtip_roth_y2 + qtip_taxable_after + trad_after_tax
        household_net = max(0.0, gross_household - fed_tax - st_tax)
        haircut = 1.0 if gross_household <= 0 else max(0.0, 1.0 - (fed_tax + st_tax) / gross_household)
        # QTIP Roth goes into the household outright bucket (spouse owned it via QTIP,
        # then passes outright to heirs at Y2) — it carries a fresh SECURE 10-yr clock.
        household_components = {
            "roth_after_estate_tax": (survivor_roth + qtip_roth_y2) * haircut,
            "taxable_after_estate_tax_stepped": (survivor_taxable_after + qtip_taxable_after) * haircut,
            "traditional_after_estate_tax_gross": trad_y2 * haircut,
        }
        return _outcome(
            "qtip_bypass",
            gst1_y2=bypass_after_step, gst2_y2=0.0,
            trust_after_tax_at_y2=bypass_after_step,
            household_after_tax=household_net, fed_tax=fed_tax, state_tax=st_tax,
            estate_y2=estate_y2, dsue=dsue, roth_y2=survivor_roth + qtip_roth_y2,
            taxable_y2=survivor_taxable + qtip_taxable_y2, trad_y2=trad_y2,
            bypass_roth_y2=bypass_roth_share, bypass_taxable_y2=bypass_taxable_share,
            qtip_roth_y2=qtip_roth_y2, qtip_taxable_y2=qtip_taxable_y2,
            trust_components=[{"entry_year": first_death_year,
                               "roth_entry": roth_to_bypass, "taxable_entry": tax_to_bypass}],
            household_components=household_components,
            notes="Bypass escapes Y2 estate + faces SECURE/trust-bracket rules; QTIP included with step-up (income taxed at spouse's rate). Best for remarriage/control.",
        )

    # -- STRATEGY D: Layered GST-Exempt Trust ----------------------------
    # GST #1 at Y1 (Roth first, up to fed excl). GST #2 at Y2 from remaining
    # available exclusion (fed_excl_y2 + DSUE). Both trusts escape estate + GST
    # tax on subsequent transfers but each carries the SECURE 10-year Roth
    # window (starts at Y1 for GST #1, at Y2 for GST #2) and applies trust-
    # bracket drag on retained income thereafter (immediately for Taxable).
    def _run_gst_layered():
        roth_to_gst1, tax_to_gst1, roth_left, tax_left = _route_to_trust(
            deceased_roth_at_y1, deceased_taxable_at_y1, fed_excl_y1, gst_funding_order)
        gst1_y1 = roth_to_gst1 + tax_to_gst1
        gst1_roth_share    = _to_y2(roth_to_gst1, "roth", in_trust=True)
        gst1_taxable_share = _to_y2(tax_to_gst1, "taxable", in_trust=True)

        # DSUE captures unused Y1 exclusion for the survivor's Y2 GST allocation.
        dsue = max(0.0, fed_excl_y1 - gst1_y1) if use_portability else 0.0
        avail_y2 = fed_excl_y2 + dsue

        # Survivor holds: remainder of deceased's assets + all her own.
        survivor_roth = _to_y2(survivor_roth_at_y1 + roth_left, "roth") + _orph["roth"]
        survivor_taxable = _to_y2(survivor_taxable_at_y1 + tax_left, "taxable") + _orph["taxable"]
        trad_y2 = _to_y2(traditional_at_y1, "trad") + _orph["trad"]
        estate_y2 = survivor_roth + survivor_taxable + trad_y2

        # At Y2, fund GST #2 up to avail_y2 (Roth first from survivor's estate).
        roth_to_gst2, tax_to_gst2, roth_left2, tax_left2 = _route_to_trust(
            survivor_roth, survivor_taxable, avail_y2)
        # Note: Traditional IRA is NOT routed into any GST trust (per the warning).

        # Anything above exclusion pays 40% federal + state.
        fed_taxable = max(0.0, estate_y2 - avail_y2)
        fed_tax = fed_taxable * FED_ESTATE_TAX_RATE
        # State tax: bypass GST amounts too (state exclusions non-portable so DSUE=0 for state).
        st_tax = state_estate_tax(estate_y2 - (roth_to_gst2 + tax_to_gst2), state_code, second_death_year, dsue=dsue, indexing_rate=indexing_rate)

        # Basis step-up for taxable held in survivor's estate — the portion NOT
        # routed to GST #2 (i.e., left over above the exclusion) still gets a
        # step-up at her death; the portion inside a GST trust does NOT.
        survivor_taxable_after = _after_tax_taxable(tax_left2, stepped_up=True)
        # GST-1 Taxable was stepped-up at Y1 funding — basis locked at Y1 FMV thereafter.
        gst1_after_step = gst1_roth_share + _after_tax_taxable(gst1_taxable_share, entry_basis=tax_to_gst1, stepped_up=False)
        # GST-2 Taxable is funded at Y2 from the survivor's (already-stepped-up) estate,
        # so its Y2 entry_basis IS the Y2 FMV — at Y2 the current_value == entry_basis,
        # so no LTCG haircut applies yet. Trust-internal appreciation from Y2 onward is
        # what heirs owe LTCG on (kicks in at horizon compounding).
        gst2_after_step = roth_to_gst2 + _after_tax_taxable(tax_to_gst2, entry_basis=tax_to_gst2, stepped_up=False)
        trad_after_tax = _after_tax_traditional(trad_y2, heir_marginal_rate)

        household_gross = roth_left2 + survivor_taxable_after + trad_after_tax
        household_net = max(0.0, household_gross - fed_tax - st_tax)
        haircut = 1.0 if household_gross <= 0 else max(0.0, 1.0 - (fed_tax + st_tax) / household_gross)
        # Note: after GST-2 funding, the "outright" residual is the amount above
        # the exclusion (roth_left2 outright-Roth, tax_left2 outright-Taxable-stepped).
        # These are the vehicles that pass to heirs with SECURE/heir-brokerage
        # regimes — the GST-2 portion is covered by the trust_components ledger.
        household_components = {
            "roth_after_estate_tax": roth_left2 * haircut,
            "taxable_after_estate_tax_stepped": survivor_taxable_after * haircut,
            "traditional_after_estate_tax_gross": trad_y2 * haircut,
        }
        return _outcome(
            "gst_layered",
            gst1_y2=gst1_after_step, gst2_y2=gst2_after_step,
            trust_after_tax_at_y2=gst1_after_step + gst2_after_step,
            household_after_tax=household_net, fed_tax=fed_tax, state_tax=st_tax,
            estate_y2=estate_y2, dsue=dsue,
            roth_y2=survivor_roth, taxable_y2=survivor_taxable, trad_y2=trad_y2,
            bypass_roth_y2=gst1_roth_share, bypass_taxable_y2=gst1_taxable_share,
            gst2_roth_y2=roth_to_gst2, gst2_taxable_y2=tax_to_gst2,
            trust_components=[
                {"entry_year": first_death_year, "roth_entry": roth_to_gst1, "taxable_entry": tax_to_gst1},
                {"entry_year": second_death_year, "roth_entry": roth_to_gst2, "taxable_entry": tax_to_gst2},
            ],
            household_components=household_components,
            notes=(
                ("Dynasty planning with Taxable-first Y1 funding — Taxable brokerage routes into the GST trust "
                 "FIRST at first death (up to fed exclusion), then Roth fills any remaining exclusion. Taxable "
                 "inside the trust keeps its Y1 funding-date §1014 basis and forgoes the second step-up, but "
                 "the whole trust corpus escapes estate + GST tax at every subsequent generation."
                 if gst_funding_order == "taxable_first" else
                 "Dynasty planning. Trusts escape estate + GST tax at every subsequent generation.") +
                " Under the revised trust-growth model, trust NAV compounds at the client's gross taxable rate — "
                "ordinary income is distributed annually to beneficiaries (taxed at their rate, not the trust's 37%) "
                "and appreciated assets pass in-kind so beneficiaries realize gains at their own LTCG rate. Heirs "
                "owe LTCG on trust-internal appreciation only at eventual in-kind sale."
            ),
        )

    def _outcome(strategy, *, gst1_y2, gst2_y2, trust_after_tax_at_y2,
                 household_after_tax, fed_tax, state_tax, estate_y2, dsue,
                 roth_y2=0.0, taxable_y2=0.0, trad_y2=0.0,
                 bypass_roth_y2=0.0, bypass_taxable_y2=0.0,
                 qtip_roth_y2=0.0, qtip_taxable_y2=0.0,
                 gst2_roth_y2=0.0, gst2_taxable_y2=0.0,
                 trust_components=None,
                 household_components=None,
                 notes=""):
        net = household_after_tax + trust_after_tax_at_y2
        return {
            "strategy": strategy,
            "fed_tax": round(fed_tax, 2),
            "state_tax": round(state_tax, 2),
            "estate_y2": round(estate_y2, 2),
            "dsue": round(dsue, 2),
            "trust_value_at_y2": round(gst1_y2 + gst2_y2, 2),  # AFTER step-up haircut
            "household_after_tax_at_y2": round(household_after_tax, 2),
            "net_to_heirs_at_y2": round(net, 2),
            # detail for the print table
            "roth_at_y2": round(roth_y2, 2),
            "taxable_at_y2": round(taxable_y2, 2),
            "traditional_at_y2": round(trad_y2, 2),
            "bypass_roth_y2": round(bypass_roth_y2, 2),
            "bypass_taxable_y2": round(bypass_taxable_y2, 2),
            "qtip_roth_y2": round(qtip_roth_y2, 2),
            "qtip_taxable_y2": round(qtip_taxable_y2, 2),
            "gst2_roth_y2": round(gst2_roth_y2, 2),
            "gst2_taxable_y2": round(gst2_taxable_y2, 2),
            # entry-year components for the horizon compounding — the model applies
            # the SECURE 10-year Roth window + trust-bracket drag using each
            # component's entry year (Y1 or Y2). Not consumed by frontend directly.
            "trust_components": trust_components or [],
            # per-vehicle outright ledger for horizon compounding: Roth (SECURE
            # 10-yr tax-free clock starting at Y2, heir brokerage thereafter),
            # Taxable (§1014-stepped at Y2, heir brokerage rate thereafter),
            # Traditional (SECURE 10-yr linear drawdown at heir_rate, brokerage
            # thereafter). Each value is POST-estate-tax haircut.
            "household_components": household_components or {},
            "notes": notes,
        }

    outcomes = {
        "portability": _run_portability(),
        "bypass": _run_bypass(),
        "qtip_bypass": _run_qtip_bypass(),
        "gst_layered": _run_gst_layered(),
    }

    # Best strategy = max net-to-heirs at Y2.
    winner = max(outcomes.items(), key=lambda kv: kv[1]["net_to_heirs_at_y2"])

    # Post-death horizons — each strategy's trust component compounds using the
    # SECURE 10-year Roth window + compressed trust brackets thereafter, keyed
    # off each component's ENTRY year (Y1 for bypass/GST1, Y2 for GST2).
    # Household after-tax compounds at survivor_growth_rate on the residual.
    def _trust_value_at(components: list[dict], target_year: int) -> float:
        total = 0.0
        for c in components:
            entry_basis = c.get("taxable_entry", 0.0)  # FMV at funding = §1014 basis inside the trust
            if use_projection and c["entry_year"] <= first_death_year:
                # Y1-funded trust: projection-scaled to Y2, then trust-rate compounding beyond.
                roth_at_y2 = c.get("roth_entry", 0.0) * _factors["roth"]
                tax_at_y2 = entry_basis * _factors["taxable"]
                h_post = max(0, target_year - second_death_year)
                roth_now    = _grow_roth_in_trust(roth_at_y2, trust_growth_rate, h_post)
                taxable_now = _grow_taxable_in_trust(tax_at_y2, trust_growth_rate, h_post)
                taxable_after = _after_tax_taxable(taxable_now, entry_basis=entry_basis, stepped_up=False)
                total += roth_now + taxable_after
                continue
            yrs = max(0, target_year - c["entry_year"])
            roth_now    = _grow_roth_in_trust(c.get("roth_entry", 0.0),    trust_growth_rate, yrs)
            taxable_now = _grow_taxable_in_trust(entry_basis, trust_growth_rate, yrs)
            # Trust-held Taxable's §1014 step-up was locked in at the funding death.
            # Heirs owe 15% LTCG only on trust-internal appreciation from that
            # funding-date basis (entry_basis) to eventual sale value.
            taxable_after = _after_tax_taxable(taxable_now, entry_basis=entry_basis, stepped_up=False)
            total += roth_now + taxable_after
        return total

    horizons = []
    for h in horizons_after_second_death:
        target = second_death_year + h
        row = {"years_after_second_death": h, "year": target}
        for name, o in outcomes.items():
            components = o.get("trust_components") or []
            trust_at_h = _trust_value_at(components, target)

            # -- Outright bucket: per-vehicle clocks (Phase C: Roth as first-class vehicle).
            # Previously the household bucket was a single blob compounded at
            # survivor_growth_rate ^ h — which (a) let outright Roth escape the
            # SECURE 10-year cutoff, (b) gave inherited Taxable full gross growth
            # instead of heir-brokerage drag, and (c) treated Traditional as a
            # single-year draw at Y2 instead of a proper 10-year SECURE drawdown.
            hc = o.get("household_components") or {}
            roth_h = _grow_outright_roth(
                hc.get("roth_after_estate_tax", 0.0),
                survivor_growth_rate, heir_marginal_rate, h)
            tax_h = _grow_outright_taxable_stepped(
                hc.get("taxable_after_estate_tax_stepped", 0.0),
                survivor_growth_rate, heir_marginal_rate, h)
            trad_h = _grow_outright_traditional(
                hc.get("traditional_after_estate_tax_gross", 0.0),
                survivor_growth_rate, heir_marginal_rate, h)
            household_at_h = roth_h + tax_h + trad_h
            # Fallback: if household_components is empty (older callers), use
            # the legacy single-blob growth to preserve compatibility.
            if not hc:
                household_at_h = o["household_after_tax_at_y2"] * ((1 + survivor_growth_rate) ** h)

            row[f"{name}_trust"] = round(trust_at_h, 2)
            row[f"{name}_household"] = round(household_at_h, 2)
            row[f"{name}_household_roth"] = round(roth_h, 2)
            row[f"{name}_household_taxable"] = round(tax_h, 2)
            row[f"{name}_household_traditional"] = round(trad_h, 2)
            row[f"{name}_total"] = round(trust_at_h + household_at_h, 2)
        horizons.append(row)

    return {
        "first_death_year": first_death_year,
        "second_death_year": second_death_year,
        "fed_exclusion_y1": round(fed_exclusion(first_death_year, indexing_rate=indexing_rate), 2),
        "fed_exclusion_y2": round(fed_exclusion(second_death_year, indexing_rate=indexing_rate), 2),
        "state_code": state_code,
        "state_name": STATE_ESTATE_TAX.get(state_code, {}).get("name", ""),
        "state_note": STATE_ESTATE_TAX.get(state_code, {}).get("note", ""),
        "trust_growth_rate": trust_growth_rate,
        "survivor_growth_rate": survivor_growth_rate,
        "heir_marginal_rate": heir_marginal_rate,
        "taxable_basis_pct": taxable_basis_pct,
        "use_portability": use_portability,
        "gst_funding_order": gst_funding_order,
        # Growth basis disclosure: "projection" = second-death base scaled to the
        # retirement model's actual Y2 balances (reconciles to the EP Projection
        # pages); "rates" = legacy stylized compounding of Y1 balances.
        "growth_basis": "projection" if use_projection else "rates",
        "implied_growth": ({k: (round(_factors[k] ** (1.0 / yrs_between) - 1.0, 4)
                                if (yrs_between > 0 and _factors[k] > 0) else 0.0)
                            for k in _factors} if use_projection else None),
        "y2_targets": ({k: round(float(_y2_cls[k]), 2) for k in _y2_cls} if use_projection else None),
        "starting_balances": {
            "deceased_roth": round(deceased_roth_at_y1, 2),
            "deceased_taxable": round(deceased_taxable_at_y1, 2),
            "survivor_roth": round(survivor_roth_at_y1, 2),
            "survivor_taxable": round(survivor_taxable_at_y1, 2),
            "traditional": round(traditional_at_y1, 2),
        },
        "outcomes": outcomes,
        "winner": winner[0],
        "post_death_horizons": horizons,
    }
