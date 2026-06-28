"""Faithful port of the Retirement_Optimizer 'Tax' sheet engine.

Preserves the spreadsheet's strict separation of ordinary income from
preferential (LTCG + qualified dividend) income. LTCG/QDIV stacks ON TOP of
ordinary taxable income at the 0/15/20% band tops. NIIT, state, IRMAA included.
"""
from __future__ import annotations

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

IRMAA_SINGLE = [109000, 137000, 171000, 205000, 500000]
IRMAA_MFJ = [218000, 274000, 342000, 410000, 750000]
IRMAA_PARTB_MULT = [1.4, 2.0, 2.6, 3.2, 3.4]
IRMAA_PARTD_SURCHARGE = [174, 449, 724, 998, 1093]

UNIFORM_LIFETIME = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0,
    79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0,
    86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8,
    93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
    101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
    108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1, 114: 3.0,
    115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
}


def rmd_divisor(age: int) -> float:
    if age < 73:
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


def marginal_ordinary_rate(ordinary_taxable: float, mfj: bool, idx: float) -> float:
    floors = BRACKET_FLOOR_MFJ if mfj else BRACKET_FLOOR_SGL
    rate = BRACKET_RATES[0]
    for r, f in zip(BRACKET_RATES, floors):
        if ordinary_taxable >= f * idx:
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


def compute_year_tax(inp: dict) -> dict:
    """Single-year tax computation. `inp` keys mirror the Tax sheet rows.

    Returns the full breakdown preserving ordinary vs preferential separation.
    """
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

    state_rate = inp.get("state_rate", 0.0)
    include_irmaa = inp.get("include_irmaa", True)
    part_b_base = inp.get("part_b_base", 2435.0)
    part_d_base = inp.get("part_d_base", 600.0)

    total_pref = recurring_div_ltcg + realized_ltcg                 # R13
    ordinary_before_ss = ordinary_non_ss + ira_distributions + cash_interest  # R14

    provisional = ordinary_before_ss + total_pref + 0.5 * gross_ss  # R17
    taxable_ss = taxable_social_security(gross_ss, provisional, mfj)  # R18

    agi = ordinary_before_ss + total_pref + taxable_ss               # R21
    magi = agi                                                       # R22

    std = ((STD_MFJ if mfj else STD_SGL)
           + num65 * (ADD65_MFJ if mfj else ADD65_SGL)) * idx        # R23
    if year > SENIOR_LAST_YEAR:
        senior = 0.0
    else:
        sen_thr = SENIOR_THRESH_MFJ if mfj else SENIOR_THRESH_SGL
        senior = max(0.0, num65 * SENIOR_BONUS
                     - SENIOR_PHASEOUT * max(0.0, magi - sen_thr))   # R24

    taxable_income = max(0.0, agi - std - senior)                    # R25
    pref_within = min(total_pref, taxable_income)                    # R26
    ordinary_taxable = taxable_income - pref_within                  # R27

    fed_ordinary = federal_ordinary_tax(ordinary_taxable, mfj, idx)  # R30
    fed_ltcg = federal_ltcg_tax(ordinary_taxable, pref_within, mfj, idx)  # R31
    niit = NIIT_RATE * min(total_pref + cash_interest,
                           max(0.0, magi - (NIIT_THRESH_MFJ if mfj else NIIT_THRESH_SGL)))  # R32
    state_tax = max(0.0, state_rate * taxable_income)                # R35

    tier = irmaa_tier(magi, mfj, irmaa_idx) if include_irmaa else 0  # R39
    part_b = part_b_base * irmaa_idx * (IRMAA_PARTB_MULT[tier - 1] if tier > 0 else 1)
    part_d = part_d_base * irmaa_idx + (IRMAA_PARTD_SURCHARGE[tier - 1] * irmaa_idx if tier > 0 else 0)
    medicare = medicare_count * (part_b + part_d)                    # R42

    total_tax = fed_ordinary + fed_ltcg + niit + state_tax           # R45
    eff_rate = total_tax / agi if agi > 0 else 0.0                   # R46
    marg = marginal_ordinary_rate(ordinary_taxable, mfj, idx)        # R47

    return {
        "ordinary_non_ss": round(ordinary_non_ss, 2),
        "ira_distributions": round(ira_distributions, 2),
        "cash_interest": round(cash_interest, 2),
        "gross_ss": round(gross_ss, 2),
        "taxable_ss": round(taxable_ss, 2),
        "recurring_div_ltcg": round(recurring_div_ltcg, 2),
        "realized_ltcg": round(realized_ltcg, 2),
        "total_preferential": round(total_pref, 2),
        "ordinary_before_ss": round(ordinary_before_ss, 2),
        "provisional_income": round(provisional, 2),
        "agi": round(agi, 2),
        "magi": round(magi, 2),
        "standard_deduction": round(std, 2),
        "senior_bonus": round(senior, 2),
        "taxable_income": round(taxable_income, 2),
        "preferential_within_taxable": round(pref_within, 2),
        "ordinary_taxable_income": round(ordinary_taxable, 2),
        "federal_ordinary_tax": round(fed_ordinary, 2),
        "federal_ltcg_tax": round(fed_ltcg, 2),
        "niit": round(niit, 2),
        "state_tax": round(state_tax, 2),
        "irmaa_tier": tier,
        "medicare_premiums": round(medicare, 2),
        "total_income_tax": round(total_tax, 2),
        "total_burden": round(total_tax + medicare, 2),
        "effective_rate": round(eff_rate, 4),
        "marginal_ordinary_rate": marg,
    }


def optimize_conversion(base_inp: dict, target_rate: float, max_conversion: float = 0.0) -> dict:
    """Fill-the-bracket: convert traditional IRA $ up to the target bracket ceiling.

    base_inp = year inputs WITHOUT any Roth conversion in ira_distributions.
    Returns the recommended conversion amount + before/after tax breakdowns.
    """
    mfj = base_inp.get("filing_status", "MFJ") == "MFJ"
    idx = base_inp.get("bracket_index", 1.0)

    base = compute_year_tax(base_inp)
    ceiling = bracket_ceiling(target_rate, mfj, idx)
    headroom = max(0.0, ceiling - base["ordinary_taxable_income"])
    if max_conversion and max_conversion > 0:
        headroom = min(headroom, max_conversion)
    conversion = round(headroom, 2)

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
    }
