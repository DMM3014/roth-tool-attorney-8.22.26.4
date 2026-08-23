"""Faithful port of the Retirement_Optimizer 'Tax' sheet engine.

Preserves the spreadsheet's strict separation of ordinary income from
preferential (LTCG + qualified dividend) income. LTCG/QDIV stacks ON TOP of
ordinary taxable income at the 0/15/20% band tops. NIIT, state, IRMAA included.
"""
from __future__ import annotations

from dataclasses import dataclass

from state_tax import compute_state_tax

# ---- TaxTables sheet constants (2026 base-year $) ------------------------
BRACKET_RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]
BRACKET_DELTA = [0.10, 0.02, 0.10, 0.02, 0.08, 0.03, 0.02]
BRACKET_FLOOR_MFJ = [0, 24800, 101200, 211400, 403550, 512450, 768700]
BRACKET_FLOOR_SGL = [0, 12400, 50600, 105700, 201775, 256225, 640600]

LTCG0_MFJ, LTCG15_MFJ = 98900, 613700
LTCG0_SGL, LTCG15_SGL = 49450, 545500

STD_MFJ, STD_SGL = 32200, 16100
ADD65_MFJ, ADD65_SGL = 1650, 2050
SENIOR_BONUS = 6000
SENIOR_PHASEOUT = 0.06
SENIOR_THRESH_MFJ, SENIOR_THRESH_SGL = 150000, 75000
SENIOR_LAST_YEAR = 2028

SST1_MFJ, SST2_MFJ = 32000, 44000
SST1_SGL, SST2_SGL = 25000, 34000

NIIT_RATE = 0.038
NIIT_THRESH_MFJ, NIIT_THRESH_SGL = 250000, 200000

from law_constants import LAW
IRMAA_SINGLE = LAW["figures"]["irmaa_thresholds_single"]["value"]
IRMAA_MFJ = LAW["figures"]["irmaa_thresholds_mfj"]["value"]
IRMAA_PARTB_MULT = LAW["figures"]["irmaa_part_b_multipliers"]["value"]
IRMAA_PARTD_SURCHARGE = LAW["figures"]["irmaa_part_d_surcharge"]["value"]

UNIFORM_LIFETIME = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0,
    79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0,
    86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8,
    93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
    101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
    108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1, 114: 3.0,
    115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
}


def rmd_start_age(birth_year: int) -> int:
    """SECURE 2.0 required-beginning-distribution age by birth year (hard-coded)."""
    if birth_year <= 1950:
        return 72
    if birth_year <= 1959:
        return 73
    return 75  # born 1960 or later


def rmd_divisor(age: int) -> float:
    """Uniform Lifetime Table divisor (0 below the first table age)."""
    if age < 72:
        return 0.0
    return UNIFORM_LIFETIME.get(min(age, 120), 2.0)


def taxable_social_security(gross_ss: float, provisional: float, mfj: bool) -> float:
    """IRS worksheet method, 85% cap (Tax!R18)."""
    if gross_ss <= 0:
        return 0.0
    t1 = SST1_MFJ if mfj else SST1_SGL
    t2 = SST2_MFJ if mfj else SST2_SGL
    if provisional <= t2:
        return min(0.85 * gross_ss,
                   min(0.5 * gross_ss, 0.5 * max(0.0, provisional - t1)))
    return min(0.85 * gross_ss,
               0.85 * (provisional - t2) + min(0.5 * gross_ss, 0.5 * (t2 - t1)))


def federal_ordinary_tax(ordinary_taxable: float, mfj: bool, idx: float) -> float:
    """Differential-rate bracket method (Tax!R30)."""
    floors = BRACKET_FLOOR_MFJ if mfj else BRACKET_FLOOR_SGL
    tax = 0.0
    for f, d in zip(floors, BRACKET_DELTA):
        thr = f * idx
        if ordinary_taxable > thr:
            tax += (ordinary_taxable - thr) * d
    return tax


def federal_ltcg_tax(ord_tax: float, pref: float, mfj: bool, idx: float) -> float:
    """LTCG/QDIV stacked at 0/15/20% on top of ordinary taxable (Tax!R31)."""
    l0 = (LTCG0_MFJ if mfj else LTCG0_SGL) * idx
    l15 = (LTCG15_MFJ if mfj else LTCG15_SGL) * idx
    tax15 = 0.15 * max(0.0, min(ord_tax + pref, l15) - max(ord_tax, l0))
    tax20 = 0.20 * max(0.0, ord_tax + pref - max(ord_tax, l15))
    return tax15 + tax20


def ltcg_band_split(ord_tax: float, pref: float, mfj: bool, idx: float) -> dict:
    """How many preferential-income dollars sit in each LTCG band (0 / 15 / 20 %).

    Same stacking model as `federal_ltcg_tax` — preferential income sits directly on top of
    ordinary taxable income and is sliced by the indexed 0%/15%/20% ceilings. Returned
    keys are the raw dollar amounts in each band plus the two indexed ceilings for
    the year so the frontend can render the exact cliff dollar values.
    """
    if pref <= 0:
        return {"in_0": 0.0, "in_15": 0.0, "in_20": 0.0,
                "ceiling_0": (LTCG0_MFJ if mfj else LTCG0_SGL) * idx,
                "ceiling_15": (LTCG15_MFJ if mfj else LTCG15_SGL) * idx}
    l0 = (LTCG0_MFJ if mfj else LTCG0_SGL) * idx
    l15 = (LTCG15_MFJ if mfj else LTCG15_SGL) * idx
    top = ord_tax + pref
    in_0 = max(0.0, min(top, l0) - max(ord_tax, 0.0))
    in_15 = max(0.0, min(top, l15) - max(ord_tax, l0))
    in_20 = max(0.0, top - max(ord_tax, l15))
    return {
        "in_0": round(in_0, 2),
        "in_15": round(in_15, 2),
        "in_20": round(in_20, 2),
        "ceiling_0": round(l0, 2),
        "ceiling_15": round(l15, 2),
    }


def marginal_ordinary_rate(ordinary_taxable: float, mfj: bool, idx: float) -> float:
    """Rate applied to the LAST dollar of ordinary taxable income.

    Uses a $1 tolerance so income filled *exactly* to the top of a bracket reports that
    bracket's rate (the rate those dollars were actually taxed at) rather than flickering
    up to the next bracket on the boundary — e.g. a "fill to 24%" conversion reads 24%,
    not 32%.
    """
    floors = BRACKET_FLOOR_MFJ if mfj else BRACKET_FLOOR_SGL
    rate = BRACKET_RATES[0]
    for r, f in zip(BRACKET_RATES, floors):
        if ordinary_taxable > f * idx + 1.0:
            rate = r
    return rate


def bracket_ceiling(target_rate: float, mfj: bool, idx: float) -> float:
    """Top (next-bracket floor) of the targeted ordinary bracket (Tax!R48)."""
    floors = BRACKET_FLOOR_MFJ if mfj else BRACKET_FLOOR_SGL
    for i, r in enumerate(BRACKET_RATES):
        if abs(r - target_rate) < 1e-9:
            if i + 1 < len(floors):
                return floors[i + 1] * idx
            return float("inf")
    return float("inf")


def irmaa_tier(magi: float, mfj: bool, idx: float) -> int:
    thresholds = IRMAA_MFJ if mfj else IRMAA_SINGLE
    return sum(1 for t in thresholds if magi >= t * idx)


def irmaa_thresholds(mfj: bool, idx: float) -> list[float]:
    """The 5 indexed IRMAA MAGI tier-entry thresholds for the year (Tax!R39)."""
    thresholds = IRMAA_MFJ if mfj else IRMAA_SINGLE
    return [round(t * idx, 2) for t in thresholds]


def bracket_fill(ordinary_taxable: float, mfj: bool, idx: float) -> list[dict]:
    """Split ordinary taxable income into the dollars sitting in each marginal band.

    Returns a list of {"rate", "amount"} for every bracket from 10% up to (and
    including) the band the last dollar lands in. Mirrors the indexed floors used
    by federal_ordinary_tax so the segments reconcile with the tax computed.
    """
    floors = BRACKET_FLOOR_MFJ if mfj else BRACKET_FLOOR_SGL
    out = []
    for i, rate in enumerate(BRACKET_RATES):
        lo = floors[i] * idx
        hi = floors[i + 1] * idx if i + 1 < len(floors) else float("inf")
        amount = max(0.0, min(ordinary_taxable, hi) - lo)
        out.append({"rate": rate, "amount": round(amount, 2)})
    return out



def irmaa_threshold_cap(tier_cap: int, mfj: bool, idx: float) -> float:
    """Max MAGI to stay AT or BELOW IRMAA `tier_cap` (0 = base/no surcharge).

    Returns the indexed MAGI ceiling = start of the next tier. inf if cap exceeds tiers.
    """
    thresholds = IRMAA_MFJ if mfj else IRMAA_SINGLE
    if tier_cap is None or tier_cap >= len(thresholds):
        return float("inf")
    return thresholds[tier_cap] * idx


def standard_deduction(mfj: bool, num65: int, idx: float) -> float:
    """Indexed standard deduction incl. 65+ additions (Tax!R23)."""
    return ((STD_MFJ if mfj else STD_SGL)
            + num65 * (ADD65_MFJ if mfj else ADD65_SGL)) * idx


def senior_bonus_deduction(mfj: bool, num65: int, magi: float, year: int) -> float:
    """OBBBA senior bonus: $6,000/person 65+, 6% phaseout, through 2028 (Tax!R24)."""
    if year > SENIOR_LAST_YEAR:
        return 0.0
    sen_thr = SENIOR_THRESH_MFJ if mfj else SENIOR_THRESH_SGL
    return max(0.0, num65 * SENIOR_BONUS - SENIOR_PHASEOUT * max(0.0, magi - sen_thr))


def niit_tax(total_pref: float, cash_interest: float, magi: float, mfj: bool) -> float:
    """3.8% on lesser of NII or MAGI excess over threshold (Tax!R32)."""
    thr = NIIT_THRESH_MFJ if mfj else NIIT_THRESH_SGL
    return NIIT_RATE * min(total_pref + cash_interest, max(0.0, magi - thr))


def medicare_premiums(magi: float, mfj: bool, irmaa_idx: float, medicare_count: int,
                      include_irmaa: bool, part_b_base: float, part_d_base: float) -> tuple[int, float]:
    """Returns (irmaa_tier, total Medicare premiums) (Tax!R39-R42)."""
    tier = irmaa_tier(magi, mfj, irmaa_idx) if include_irmaa else 0
    part_b = part_b_base * irmaa_idx * (IRMAA_PARTB_MULT[tier - 1] if tier > 0 else 1)
    part_d = part_d_base * irmaa_idx + (IRMAA_PARTD_SURCHARGE[tier - 1] * irmaa_idx if tier > 0 else 0)
    return tier, medicare_count * (part_b + part_d)


@dataclass
class _TaxBase:
    """Income, AGI, deductions and the ordinary/preferential taxable split for one year."""
    mfj: bool
    idx: float
    irmaa_idx: float
    num65: int
    medicare_count: int
    year: int
    ordinary_non_ss: float
    ira_distributions: float
    cash_interest: float
    gross_ss: float
    recurring_div_ltcg: float
    realized_ltcg: float
    state_rate: float
    state_code: str
    pension_income: float
    max_age: int
    include_irmaa: bool
    part_b_base: float
    part_d_base: float
    total_pref: float
    ordinary_before_ss: float
    provisional: float
    taxable_ss: float
    agi: float
    magi: float
    magi_for_irmaa: float
    std: float
    senior: float
    taxable_income: float
    pref_within: float
    ordinary_taxable: float


def _resolve_taxable_income(inp: dict) -> _TaxBase:
    """Parse the raw Tax-sheet inputs and resolve provisional SS, AGI/MAGI, the
    standard + senior deductions, and the ordinary-vs-preferential taxable split."""
    mfj = inp.get("filing_status", "MFJ") == "MFJ"
    idx = inp.get("bracket_index", 1.0)
    irmaa_idx = inp.get("irmaa_index", 1.0)
    num65 = inp.get("num_65plus", 0)
    medicare_count = inp.get("medicare_count", 0)
    year = inp.get("year", 2026)

    ordinary_non_ss = inp.get("ordinary_non_ss", 0.0)      # R7 wages/pension/annuity/other
    ira_distributions = inp.get("ira_distributions", 0.0)  # R8 RMD+discretionary+conversions
    cash_interest = inp.get("cash_interest", 0.0)          # R9
    gross_ss = inp.get("gross_ss", 0.0)                    # R10
    recurring_div_ltcg = inp.get("recurring_div_ltcg", 0.0)  # R11
    realized_ltcg = inp.get("realized_ltcg", 0.0)          # R12

    total_pref = recurring_div_ltcg + realized_ltcg                 # R13
    ordinary_before_ss = ordinary_non_ss + ira_distributions + cash_interest  # R14

    provisional = ordinary_before_ss + total_pref + 0.5 * gross_ss  # R17
    taxable_ss = taxable_social_security(gross_ss, provisional, mfj)  # R18

    agi = ordinary_before_ss + total_pref + taxable_ss               # R21
    magi = agi                                                       # R22
    # IRMAA uses a hard-coded 2-year MAGI lookback: the Medicare surcharge this
    # year is set by the MAGI from 2 years prior. When the projection supplies that
    # prior MAGI via `irmaa_magi`, use it; otherwise fall back to current-year MAGI.
    irmaa_magi = inp.get("irmaa_magi")
    magi_for_irmaa = irmaa_magi if irmaa_magi is not None else magi

    std = standard_deduction(mfj, num65, idx)                        # R23
    senior = senior_bonus_deduction(mfj, num65, magi, year)          # R24

    taxable_income = max(0.0, agi - std - senior)                    # R25
    pref_within = min(total_pref, taxable_income)                    # R26
    ordinary_taxable = taxable_income - pref_within                  # R27

    return _TaxBase(
        mfj=mfj, idx=idx, irmaa_idx=irmaa_idx, num65=num65, medicare_count=medicare_count,
        year=year, ordinary_non_ss=ordinary_non_ss, ira_distributions=ira_distributions,
        cash_interest=cash_interest, gross_ss=gross_ss, recurring_div_ltcg=recurring_div_ltcg,
        realized_ltcg=realized_ltcg, state_rate=inp.get("state_rate", 0.0),
        state_code=inp.get("state_code", ""),
        pension_income=inp.get("pension_income", 0.0),
        max_age=inp.get("max_age", 0),
        include_irmaa=inp.get("include_irmaa", True), part_b_base=inp.get("part_b_base", 2435.0),
        part_d_base=inp.get("part_d_base", 600.0),
        total_pref=total_pref, ordinary_before_ss=ordinary_before_ss, provisional=provisional,
        taxable_ss=taxable_ss, agi=agi, magi=magi, magi_for_irmaa=magi_for_irmaa,
        std=std, senior=senior, taxable_income=taxable_income, pref_within=pref_within,
        ordinary_taxable=ordinary_taxable)


def compute_year_tax(inp: dict) -> dict:
    """Single-year tax computation. `inp` keys mirror the Tax sheet rows.

    Returns the full breakdown preserving ordinary vs preferential separation.
    """
    b = _resolve_taxable_income(inp)

    fed_ordinary = federal_ordinary_tax(b.ordinary_taxable, b.mfj, b.idx)  # R30
    fed_ltcg = federal_ltcg_tax(b.ordinary_taxable, b.pref_within, b.mfj, b.idx)  # R31
    niit = niit_tax(b.total_pref, b.cash_interest, b.magi, b.mfj)         # R32

    # State income tax: real state engine when a state_code is set, else legacy
    # flat `state_rate × federal_taxable_income` fallback (preserves back-compat).
    state_res = compute_state_tax(
        state_code=b.state_code,
        filing_status="MFJ" if b.mfj else "Single",
        federal_taxable_income=b.taxable_income,
        federal_std_deduction=b.std,
        federal_senior_bonus=b.senior,
        taxable_ss=b.taxable_ss,
        ira_distributions=b.ira_distributions,
        pension_income=b.pension_income,
        year=b.year,
        idx=b.idx,
        max_age=b.max_age,
        fallback_rate=b.state_rate,
    )
    # Use unrounded state tax for total math (matches pre-refactor behavior).
    if not b.state_code:
        state_tax = max(0.0, b.state_rate * b.taxable_income)
    else:
        state_tax = state_res["state_tax"]

    tier, medicare = medicare_premiums(
        b.magi_for_irmaa, b.mfj, b.irmaa_idx, b.medicare_count, b.include_irmaa,
        b.part_b_base, b.part_d_base)  # R39-R42

    total_tax = fed_ordinary + fed_ltcg + niit + state_tax               # R45
    eff_rate = total_tax / b.agi if b.agi > 0 else 0.0                   # R46
    marg = marginal_ordinary_rate(b.ordinary_taxable, b.mfj, b.idx)      # R47

    return {
        "ordinary_non_ss": round(b.ordinary_non_ss, 2),
        "ira_distributions": round(b.ira_distributions, 2),
        "cash_interest": round(b.cash_interest, 2),
        "gross_ss": round(b.gross_ss, 2),
        "taxable_ss": round(b.taxable_ss, 2),
        "recurring_div_ltcg": round(b.recurring_div_ltcg, 2),
        "realized_ltcg": round(b.realized_ltcg, 2),
        "total_preferential": round(b.total_pref, 2),
        "ordinary_before_ss": round(b.ordinary_before_ss, 2),
        "provisional_income": round(b.provisional, 2),
        "agi": round(b.agi, 2),
        "magi": round(b.magi, 2),
        "irmaa_magi": round(b.magi_for_irmaa, 2),
        "standard_deduction": round(b.std, 2),
        "senior_bonus": round(b.senior, 2),
        "taxable_income": round(b.taxable_income, 2),
        "preferential_within_taxable": round(b.pref_within, 2),
        "ordinary_taxable_income": round(b.ordinary_taxable, 2),
        "federal_ordinary_tax": round(fed_ordinary, 2),
        "federal_ltcg_tax": round(fed_ltcg, 2),
        "niit": round(niit, 2),
        "state_tax": round(state_tax, 2),
        "state_detail": state_res,
        "irmaa_tier": tier,
        "medicare_premiums": round(medicare, 2),
        "total_income_tax": round(total_tax, 2),
        "total_burden": round(total_tax + medicare, 2),
        "effective_rate": round(eff_rate, 4),
        "marginal_ordinary_rate": marg,
    }


def optimize_conversion(base_inp: dict, target_rate: float, max_conversion: float = 0.0,
                        irmaa_aware: bool = False, irmaa_cliff_buffer: float = 3000.0) -> dict:
    """Fill-the-bracket: convert traditional IRA $ up to the target bracket ceiling.

    base_inp = year inputs WITHOUT any Roth conversion in ira_distributions.
    Returns the recommended conversion amount + before/after tax breakdowns.

    If ``irmaa_aware`` is True and IRMAA is being modeled, the recommendation
    is trimmed so the resulting MAGI stays at least ``irmaa_cliff_buffer``
    below the next IRMAA tier threshold — avoiding a Medicare-premium cliff
    where crossing $1 costs the household hundreds of dollars per month for
    the following year.
    """
    mfj = base_inp.get("filing_status", "MFJ") == "MFJ"
    idx = base_inp.get("bracket_index", 1.0)

    base = compute_year_tax(base_inp)
    ceiling = bracket_ceiling(target_rate, mfj, idx)
    headroom = max(0.0, ceiling - base["ordinary_taxable_income"])
    if max_conversion and max_conversion > 0:
        headroom = min(headroom, max_conversion)
    conversion = round(headroom, 2)

    # IRMAA cliff avoidance: never push MAGI within `irmaa_cliff_buffer` of a threshold.
    avoided_cliff = None
    if irmaa_aware and base_inp.get("include_irmaa", True):
        irmaa_idx = base_inp.get("irmaa_index", idx)
        thresholds = irmaa_thresholds(mfj, irmaa_idx)  # already indexed
        base_magi = base["magi"]
        # Every dollar of Roth conversion enters ordinary income and directly increases MAGI.
        max_magi_after = base_magi + conversion
        # Find the next threshold above base_magi (i.e. the first one we would cross).
        next_thr = None
        for t in thresholds:
            if t > base_magi:
                next_thr = t
                break
        if next_thr is not None and max_magi_after > (next_thr - irmaa_cliff_buffer):
            allowed = max(0.0, next_thr - irmaa_cliff_buffer - base_magi)
            if allowed < conversion:
                avoided_cliff = {
                    "threshold": round(next_thr, 2),
                    "buffer": round(irmaa_cliff_buffer, 2),
                    "unconstrained_conversion": conversion,
                    "avoided_conversion_amount": round(conversion - allowed, 2),
                }
                conversion = round(allowed, 2)

    after_inp = dict(base_inp)
    after_inp["ira_distributions"] = base_inp.get("ira_distributions", 0.0) + conversion
    after = compute_year_tax(after_inp)

    return {
        "target_rate": target_rate,
        "bracket_ceiling": None if ceiling == float("inf") else round(ceiling, 2),
        "recommended_conversion": conversion,
        "tax_on_conversion": round(after["total_income_tax"] - base["total_income_tax"], 2),
        "before": base,
        "after": after,
        "irmaa_aware": irmaa_aware,
        "avoided_irmaa_cliff": avoided_cliff,
    }
