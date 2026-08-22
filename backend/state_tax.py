"""State income tax engine — proper per-state brackets + retirement-income exclusions.

Replaces the naive `state_rate × federal_taxable` approximation with a per-state
computation that respects:

  * Progressive bracket schedules where they exist (CA, NY, NJ, HI, OR, MN, etc.)
  * Flat-rate states (CO, IL, PA, KY, MI, MA, etc.)
  * Zero-tax states (AK, FL, NV, NH, SD, TN, TX, WA, WY)
  * State-level retirement-income exclusions:
      - Social Security benefits — 41 states + DC exempt SS from state income tax
      - Pension & Traditional IRA distributions — IL, MS, PA fully exempt;
        many other states have partial exclusions (modeled here as full binary
        for MVP; caveats noted per-state).
  * State standard deduction where applicable.

Model:
    state_agi_proxy = federal_taxable + federal_std_deduction + federal_senior_bonus
                      (approximates federal AGI, the starting point most states use)
    state_agi       = state_agi_proxy − excluded_items (SS/pension/IRA per state)
    state_taxable   = max(0, state_agi − state_standard_deduction)
    state_tax       = apply_brackets(state_taxable)  [or flat_rate × state_taxable]

Rates are 2025/2026 tax-year figures where known; kept editable in the UI.
When `state_code == ""` (unset), the engine falls back to the legacy behavior:
    state_tax = state_rate × federal_taxable_income

Sources: state DOR websites, Tax Foundation 2025 individual income-tax data.
"""
from __future__ import annotations

from typing import Any

# Sentinel "no ceiling" bracket top.
INF = float("inf")


# -- Progressive states: brackets are lists of (upper_limit, rate) --------
# Each row means: dollars in the slice (prev_top, upper_limit] are taxed at `rate`.
# The last row's upper_limit is INF (no ceiling).

# --- CALIFORNIA (2025 indexed) — mental-health tax adds 1% > $1M (approximated
# for MFJ as an extra bracket ~ $1.44M).
CA_MFJ = [(21512, 0.01), (50998, 0.02), (80490, 0.04), (111732, 0.06),
          (141212, 0.08), (721318, 0.093), (865574, 0.103), (1442628, 0.113),
          (INF, 0.123)]
CA_SGL = [(10756, 0.01), (25499, 0.02), (40245, 0.04), (55866, 0.06),
          (70606, 0.08), (360659, 0.093), (432787, 0.103), (721314, 0.113),
          (INF, 0.123)]

# --- NEW YORK (2025) — no separate MFJ table until higher brackets
NY_MFJ = [(17150, 0.04), (23600, 0.045), (27900, 0.0525), (161550, 0.055),
          (323200, 0.06), (2155350, 0.0685), (5000000, 0.0965),
          (25000000, 0.103), (INF, 0.109)]
NY_SGL = [(8500, 0.04), (11700, 0.045), (13900, 0.0525), (80650, 0.055),
          (215400, 0.06), (1077550, 0.0685), (5000000, 0.0965),
          (25000000, 0.103), (INF, 0.109)]

# --- NEW JERSEY (2025)
NJ_MFJ = [(20000, 0.014), (50000, 0.0175), (70000, 0.0245), (80000, 0.035),
          (150000, 0.05525), (500000, 0.0637), (1000000, 0.0897),
          (INF, 0.1075)]
NJ_SGL = [(20000, 0.014), (35000, 0.0175), (40000, 0.035), (75000, 0.05525),
          (500000, 0.0637), (1000000, 0.0897), (INF, 0.1075)]

# --- HAWAII (2025)
HI_MFJ = [(4800, 0.014), (9600, 0.032), (19200, 0.055), (28800, 0.064),
          (38400, 0.068), (48000, 0.072), (72000, 0.076), (96000, 0.079),
          (300000, 0.0825), (350000, 0.09), (400000, 0.10), (INF, 0.11)]
HI_SGL = [(2400, 0.014), (4800, 0.032), (9600, 0.055), (14400, 0.064),
          (19200, 0.068), (24000, 0.072), (36000, 0.076), (48000, 0.079),
          (150000, 0.0825), (175000, 0.09), (200000, 0.10), (INF, 0.11)]

# --- OREGON (2025)
OR_MFJ = [(9200, 0.0475), (23000, 0.0675), (250000, 0.0875), (INF, 0.099)]
OR_SGL = [(4600, 0.0475), (11500, 0.0675), (125000, 0.0875), (INF, 0.099)]

# --- MINNESOTA (2025)
MN_MFJ = [(46330, 0.0535), (184040, 0.068), (321450, 0.0785), (INF, 0.0985)]
MN_SGL = [(31690, 0.0535), (104090, 0.068), (193240, 0.0785), (INF, 0.0985)]

# --- DISTRICT OF COLUMBIA (2025) — same for Single and MFJ
DC_ALL = [(10000, 0.04), (40000, 0.06), (60000, 0.065), (250000, 0.085),
          (500000, 0.0925), (1000000, 0.0975), (INF, 0.1075)]

# --- WISCONSIN (2025)
WI_MFJ = [(18420, 0.035), (36840, 0.044), (405550, 0.053), (INF, 0.0765)]
WI_SGL = [(13810, 0.035), (27630, 0.044), (304170, 0.053), (INF, 0.0765)]

# --- MARYLAND (2025)
MD_MFJ = [(1000, 0.02), (2000, 0.03), (3000, 0.04), (150000, 0.0475),
          (175000, 0.05), (225000, 0.0525), (300000, 0.055), (INF, 0.0575)]
MD_SGL = [(1000, 0.02), (2000, 0.03), (3000, 0.04), (100000, 0.0475),
          (125000, 0.05), (150000, 0.0525), (250000, 0.055), (INF, 0.0575)]

# --- CONNECTICUT (2025)
CT_MFJ = [(20000, 0.02), (100000, 0.045), (200000, 0.055), (500000, 0.06),
          (1000000, 0.065), (INF, 0.0699)]
CT_SGL = [(10000, 0.02), (50000, 0.045), (100000, 0.055), (200000, 0.06),
          (500000, 0.065), (INF, 0.0699)]

# --- MONTANA (2025) — simplified 2-bracket
MT_MFJ = [(41000, 0.047), (INF, 0.059)]
MT_SGL = [(20500, 0.047), (INF, 0.059)]

# --- NEW MEXICO (2025)
NM_MFJ = [(8000, 0.017), (16000, 0.032), (24000, 0.047), (315000, 0.049),
          (INF, 0.059)]
NM_SGL = [(5500, 0.017), (11000, 0.032), (16000, 0.047), (210000, 0.049),
          (INF, 0.059)]

# --- MAINE (2025)
ME_MFJ = [(49050, 0.058), (116450, 0.0675), (INF, 0.0715)]
ME_SGL = [(24500, 0.058), (58050, 0.0675), (INF, 0.0715)]

# --- VERMONT (2025)
VT_MFJ = [(75000, 0.0335), (180150, 0.066), (275450, 0.076), (INF, 0.0875)]
VT_SGL = [(45400, 0.0335), (110050, 0.066), (229550, 0.076), (INF, 0.0875)]

# --- RHODE ISLAND (2025)
RI_MFJ = [(77450, 0.0375), (176050, 0.0475), (INF, 0.0599)]
RI_SGL = [(77450, 0.0375), (176050, 0.0475), (INF, 0.0599)]

# --- SOUTH CAROLINA (2025)
SC_MFJ = [(3460, 0.0), (17330, 0.03), (INF, 0.062)]
SC_SGL = [(3460, 0.0), (17330, 0.03), (INF, 0.062)]

# --- OHIO (2025)
OH_MFJ = [(26050, 0.0), (100000, 0.0275), (INF, 0.035)]
OH_SGL = [(26050, 0.0), (100000, 0.0275), (INF, 0.035)]

# --- MASSACHUSETTS (5% flat + 4% surtax on income > $1M/MFJ)
MA_MFJ = [(1000000, 0.05), (INF, 0.09)]
MA_SGL = [(1000000, 0.05), (INF, 0.09)]

# --- IOWA (2025)
IA_MFJ = [(12420, 0.044), (62100, 0.0482), (INF, 0.057)]
IA_SGL = [(6210, 0.044), (31050, 0.0482), (INF, 0.057)]

# --- ALABAMA (2025)
AL_MFJ = [(1000, 0.02), (6000, 0.04), (INF, 0.05)]
AL_SGL = [(500, 0.02), (3000, 0.04), (INF, 0.05)]

# --- ARKANSAS (2025)
AR_MFJ = [(5300, 0.02), (10600, 0.03), (INF, 0.039)]
AR_SGL = [(5300, 0.02), (10600, 0.03), (INF, 0.039)]

# --- GEORGIA (2026) — flat 4.99% effective 2026 (rate reduced from 5.19%)
GA_FLAT = 0.0499

# --- MISSOURI (2025)
MO_MFJ = [(1273, 0.02), (2546, 0.025), (3819, 0.03), (5092, 0.035),
          (6365, 0.04), (7638, 0.045), (INF, 0.047)]
MO_SGL = MO_MFJ

# --- KANSAS (2025)
KS_MFJ = [(46000, 0.031), (INF, 0.0558)]
KS_SGL = [(23000, 0.031), (INF, 0.0558)]

# --- NEBRASKA (2025)
NE_MFJ = [(7390, 0.0246), (44290, 0.0351), (71300, 0.0501), (INF, 0.052)]
NE_SGL = [(3690, 0.0246), (22170, 0.0351), (35730, 0.0501), (INF, 0.052)]

# --- DELAWARE (2025)
DE_MFJ = [(2000, 0.0), (5000, 0.022), (10000, 0.039), (20000, 0.048),
          (25000, 0.052), (60000, 0.0555), (INF, 0.066)]
DE_SGL = DE_MFJ

# --- NORTH DAKOTA (2025)
ND_MFJ = [(74750, 0.0), (275100, 0.0195), (INF, 0.025)]
ND_SGL = [(44725, 0.0), (225975, 0.0195), (INF, 0.025)]

# --- WEST VIRGINIA (2025)
WV_MFJ = [(10000, 0.0222), (25000, 0.0296), (40000, 0.0333), (60000, 0.0444),
          (INF, 0.0512)]
WV_SGL = WV_MFJ


# ---------------------------------------------------------------------------
# STATE_TAX_RULES — the master data structure. `type` controls the branch used
# in `compute_state_tax` (progressive brackets / flat rate / none).
#
# Exclusions:
#   exempts_ss:      federally-taxable SS is subtracted from state income
#   exempts_pension: private/public pension income is subtracted
#   exempts_ira:     Traditional IRA distributions (RMDs + conversions + discretionary)
#                    are subtracted
#
# For states with partial retirement-income exclusions (e.g. NY $20K/person > 59½,
# GA $65K over-65, CO's $24K over-65 pension exclusion), an approximate cap is
# recorded in `ret_exclusion_cap` — applied against combined pension + IRA
# distributions for taxpayers who meet the age gate. MVP: applied if any of
# household is ≥ that age.
# ---------------------------------------------------------------------------
STATE_TAX_RULES: dict[str, dict[str, Any]] = {
    # -- No-income-tax states (9) -----------------------------------------
    "AK": {"type": "none"},
    "FL": {"type": "none"},
    "NV": {"type": "none"},
    "NH": {"type": "none"},  # phased out interest/dividend tax by 2025
    "SD": {"type": "none"},
    "TN": {"type": "none"},
    "TX": {"type": "none"},
    "WA": {"type": "none"},  # 7% capital-gains tax > $250K/yr — not modeled for MVP
    "WY": {"type": "none"},

    # -- Full retirement-income-exempt flat states ------------------------
    "IL": {"type": "flat", "flat_rate": 0.0495,
           "exempts_ss": True, "exempts_pension": True, "exempts_ira": True,
           "std_ded_mfj": 5300, "std_ded_single": 2650, "note": "IL exempts all retirement income."},
    "MS": {"type": "flat", "flat_rate": 0.044,
           "exempts_ss": True, "exempts_pension": True, "exempts_ira": True,
           "std_ded_mfj": 4600, "std_ded_single": 2300},
    "PA": {"type": "flat", "flat_rate": 0.0307,
           "exempts_ss": True, "exempts_pension": True, "exempts_ira": True,
           "std_ded_mfj": 0, "std_ded_single": 0,
           "note": "PA exempts retirement income; no state std deduction."},

    # -- Flat-rate income-tax states --------------------------------------
    "AZ": {"type": "flat", "flat_rate": 0.025,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 29200, "std_ded_single": 14600},  # matches federal
    "CO": {"type": "flat", "flat_rate": 0.044,
           "exempts_ss": False, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 24000, "ret_exclusion_min_age": 55,
           "note": "CO has a $24K/person retirement income subtraction age 55-64; unlimited 65+."},
    "IN": {"type": "flat", "flat_rate": 0.0295,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 2000, "std_ded_single": 1000},
    "KY": {"type": "flat", "flat_rate": 0.035,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 31110, "ret_exclusion_min_age": 0,
           "note": "KY excludes $31,110/person of pension+IRA income. 2026 rate reduced from 4.0% to 3.5%."},
    "MI": {"type": "flat", "flat_rate": 0.0425,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 20000, "ret_exclusion_min_age": 65,
           "note": "MI retirement exclusion varies by birth year."},
    "NC": {"type": "flat", "flat_rate": 0.0399,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 25500, "std_ded_single": 12750,
           "note": "2026 rate reduced from 4.25% to 3.99% (further reductions scheduled)."},
    "UT": {"type": "flat", "flat_rate": 0.0445,
           "exempts_ss": False, "exempts_pension": False, "exempts_ira": False,
           "note": "UT has a retirement-credit that reduces effective SS tax; approximated as no exemption. 2026 rate reduced from 4.55% to 4.45%."},
    "LA": {"type": "flat", "flat_rate": 0.03,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 12500, "std_ded_single": 12500},
    "ID": {"type": "flat", "flat_rate": 0.0569,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 29200, "std_ded_single": 14600},
    "GA": {"type": "flat", "flat_rate": GA_FLAT,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 65000, "ret_exclusion_min_age": 65,
           "std_ded_mfj": 24000, "std_ded_single": 12000},
    "OK": {"type": "flat", "flat_rate": 0.0475,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 12700, "std_ded_single": 6350},
    "VA": {"type": "flat", "flat_rate": 0.0575,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 12000, "ret_exclusion_min_age": 65,
           "std_ded_mfj": 17000, "std_ded_single": 8500},

    # -- Progressive states -----------------------------------------------
    "CA": {"type": "progressive", "brackets_mfj": CA_MFJ, "brackets_single": CA_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 11080, "std_ded_single": 5540},
    "NY": {"type": "progressive", "brackets_mfj": NY_MFJ, "brackets_single": NY_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 20000, "ret_exclusion_min_age": 59,
           "std_ded_mfj": 16050, "std_ded_single": 8000,
           "note": "NY excludes $20K/person pension+IRA over 59½; government pensions fully excluded (approximation)."},
    "NJ": {"type": "progressive", "brackets_mfj": NJ_MFJ, "brackets_single": NJ_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 100000, "ret_exclusion_min_age": 62,
           "std_ded_mfj": 0, "std_ded_single": 0,
           "note": "NJ excludes up to $100K MFJ pension+IRA income if age 62+ and total income ≤ $150K."},
    "HI": {"type": "progressive", "brackets_mfj": HI_MFJ, "brackets_single": HI_SGL,
           "exempts_ss": True, "exempts_pension": True, "exempts_ira": False,
           "std_ded_mfj": 4400, "std_ded_single": 2200,
           "note": "HI exempts qualified employer pensions but taxes IRA distributions."},
    "OR": {"type": "progressive", "brackets_mfj": OR_MFJ, "brackets_single": OR_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 5495, "std_ded_single": 2745},
    "MN": {"type": "progressive", "brackets_mfj": MN_MFJ, "brackets_single": MN_SGL,
           "exempts_ss": False, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 29200, "std_ded_single": 14600,
           "note": "MN taxes SS with a partial subtraction; approximated as fully taxed."},
    "DC": {"type": "progressive", "brackets_mfj": DC_ALL, "brackets_single": DC_ALL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 29200, "std_ded_single": 14600},
    "WI": {"type": "progressive", "brackets_mfj": WI_MFJ, "brackets_single": WI_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 26350, "std_ded_single": 14170},
    "MD": {"type": "progressive", "brackets_mfj": MD_MFJ, "brackets_single": MD_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 40200, "ret_exclusion_min_age": 65,
           "std_ded_mfj": 5500, "std_ded_single": 2400},
    "CT": {"type": "progressive", "brackets_mfj": CT_MFJ, "brackets_single": CT_SGL,
           "exempts_ss": False, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 0, "std_ded_single": 0,
           "note": "CT has income-based SS/pension exemptions; approximated as fully taxed."},
    "MT": {"type": "progressive", "brackets_mfj": MT_MFJ, "brackets_single": MT_SGL,
           "exempts_ss": False, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 29200, "std_ded_single": 14600},
    "NM": {"type": "progressive", "brackets_mfj": NM_MFJ, "brackets_single": NM_SGL,
           "exempts_ss": False, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 29200, "std_ded_single": 14600,
           "note": "NM exempts SS for MFJ AGI ≤ $150K (2023+); approximated as fully taxed at high AGI."},
    "ME": {"type": "progressive", "brackets_mfj": ME_MFJ, "brackets_single": ME_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 30000, "ret_exclusion_min_age": 0,
           "std_ded_mfj": 29200, "std_ded_single": 14600},
    "VT": {"type": "progressive", "brackets_mfj": VT_MFJ, "brackets_single": VT_SGL,
           "exempts_ss": False, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 14050, "std_ded_single": 7000},
    "RI": {"type": "progressive", "brackets_mfj": RI_MFJ, "brackets_single": RI_SGL,
           "exempts_ss": False, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 20050, "std_ded_single": 10025,
           "note": "RI has an income-tested SS/pension subtraction; approximated as fully taxed."},
    "SC": {"type": "progressive", "brackets_mfj": SC_MFJ, "brackets_single": SC_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 10000, "ret_exclusion_min_age": 65},
    "OH": {"type": "progressive", "brackets_mfj": OH_MFJ, "brackets_single": OH_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "note": "OH has a retirement-income credit; not modeled."},
    "MA": {"type": "progressive", "brackets_mfj": MA_MFJ, "brackets_single": MA_SGL,
           "exempts_ss": True, "exempts_pension": True, "exempts_ira": False,
           "note": "MA exempts government + private pensions; IRA distributions taxable."},
    "IA": {"type": "progressive", "brackets_mfj": IA_MFJ, "brackets_single": IA_SGL,
           "exempts_ss": True, "exempts_pension": True, "exempts_ira": True,
           "ret_exclusion_min_age": 55,
           "note": "IA exempts all retirement income for 55+ (2023+ law)."},
    "AL": {"type": "progressive", "brackets_mfj": AL_MFJ, "brackets_single": AL_SGL,
           "exempts_ss": True, "exempts_pension": True, "exempts_ira": False,
           "std_ded_mfj": 8500, "std_ded_single": 3000},
    "AR": {"type": "progressive", "brackets_mfj": AR_MFJ, "brackets_single": AR_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 6000, "ret_exclusion_min_age": 0,
           "std_ded_mfj": 4680, "std_ded_single": 2340},
    "MO": {"type": "progressive", "brackets_mfj": MO_MFJ, "brackets_single": MO_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 29200, "std_ded_single": 14600,
           "note": "MO exempts SS for MFJ AGI ≤ $100K; approximated as always exempt."},
    "KS": {"type": "progressive", "brackets_mfj": KS_MFJ, "brackets_single": KS_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 8000, "std_ded_single": 3500,
           "note": "KS exempts SS entirely (2024 law change)."},
    "NE": {"type": "progressive", "brackets_mfj": NE_MFJ, "brackets_single": NE_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 15300, "std_ded_single": 7650},
    "DE": {"type": "progressive", "brackets_mfj": DE_MFJ, "brackets_single": DE_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "ret_exclusion_cap": 12500, "ret_exclusion_min_age": 60,
           "std_ded_mfj": 6500, "std_ded_single": 3250},
    "ND": {"type": "progressive", "brackets_mfj": ND_MFJ, "brackets_single": ND_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "std_ded_mfj": 29200, "std_ded_single": 14600},
    "WV": {"type": "progressive", "brackets_mfj": WV_MFJ, "brackets_single": WV_SGL,
           "exempts_ss": True, "exempts_pension": False, "exempts_ira": False,
           "note": "WV phased out SS tax (2022+)."},
}


def _apply_progressive(taxable: float, brackets: list) -> tuple[float, float]:
    """Return (tax, marginal_rate) for a progressive schedule.

    `brackets` = list of (upper_limit, rate). Dollars in (prev_upper, upper] taxed at `rate`.
    """
    if taxable <= 0:
        return 0.0, 0.0
    tax = 0.0
    marginal = 0.0
    prev = 0.0
    for top, rate in brackets:
        if taxable > prev:
            slice_amt = min(taxable, top) - prev
            if slice_amt > 0:
                tax += slice_amt * rate
                marginal = rate
        prev = top
        if taxable <= top:
            break
    return tax, marginal


def compute_state_tax(
    state_code: str,
    filing_status: str,
    federal_taxable_income: float,
    federal_std_deduction: float,
    federal_senior_bonus: float,
    taxable_ss: float,
    ira_distributions: float,
    pension_income: float,
    year: int = 2026,
    idx: float = 1.0,
    max_age: int = 0,
    fallback_rate: float = 0.0,
) -> dict:
    """Compute state income tax with proper exclusions and brackets.

    Args:
        state_code:            2-letter state code (or "" for legacy fallback_rate path).
        filing_status:         "MFJ" or anything else (Single).
        federal_taxable_income: Federal taxable income (already excludes federal std ded).
        federal_std_deduction:  Federal standard deduction (added back to reconstruct AGI).
        federal_senior_bonus:   OBBBA senior bonus (added back).
        taxable_ss:            Federally-taxable Social Security portion.
        ira_distributions:     Traditional IRA gross distributions (RMDs + conversions + discretionary).
        pension_income:        Ordinary pension/annuity income (not incl. wages).
        year:                  Calendar year (for future indexing).
        idx:                   Bracket-indexing factor (relative to state's base year).
        max_age:               Older-spouse age (for retirement-exclusion age gates).
        fallback_rate:         Rate used when state_code is empty ("" = legacy behavior).

    Returns dict:
        state_tax, state_taxable_income, state_agi, state_std_deduction,
        state_marginal_rate, state_effective_rate,
        state_ss_excluded, state_pension_excluded, state_ira_excluded,
        state_ret_exclusion_used, state_type, state_code, state_note.
    """
    # Legacy path: no state_code set → use the flat fallback_rate.
    if not state_code:
        tax = max(0.0, fallback_rate * federal_taxable_income)
        return {
            "state_tax": round(tax, 2),
            "state_taxable_income": round(federal_taxable_income, 2),
            "state_agi": round(federal_taxable_income, 2),
            "state_std_deduction": 0.0,
            "state_marginal_rate": fallback_rate,
            "state_effective_rate": fallback_rate if federal_taxable_income > 0 else 0.0,
            "state_ss_excluded": 0.0,
            "state_pension_excluded": 0.0,
            "state_ira_excluded": 0.0,
            "state_ret_exclusion_used": 0.0,
            "state_type": "flat_fallback",
            "state_code": "",
            "state_note": "Legacy behavior: flat state_rate × federal taxable income (no state selected).",
        }

    rules = STATE_TAX_RULES.get(state_code.upper())
    if not rules:
        # Unknown code → same as legacy fallback.
        tax = max(0.0, fallback_rate * federal_taxable_income)
        return {
            "state_tax": round(tax, 2),
            "state_taxable_income": round(federal_taxable_income, 2),
            "state_agi": round(federal_taxable_income, 2),
            "state_std_deduction": 0.0,
            "state_marginal_rate": fallback_rate,
            "state_effective_rate": fallback_rate,
            "state_ss_excluded": 0.0,
            "state_pension_excluded": 0.0,
            "state_ira_excluded": 0.0,
            "state_ret_exclusion_used": 0.0,
            "state_type": "unknown",
            "state_code": state_code,
            "state_note": f"Unknown state code '{state_code}' — used flat fallback.",
        }

    stype = rules["type"]
    mfj = filing_status == "MFJ"

    # No-income-tax states short-circuit.
    if stype == "none":
        return {
            "state_tax": 0.0,
            "state_taxable_income": 0.0,
            "state_agi": 0.0,
            "state_std_deduction": 0.0,
            "state_marginal_rate": 0.0,
            "state_effective_rate": 0.0,
            "state_ss_excluded": round(taxable_ss, 2),
            "state_pension_excluded": round(pension_income, 2),
            "state_ira_excluded": round(ira_distributions, 2),
            "state_ret_exclusion_used": 0.0,
            "state_type": "none",
            "state_code": state_code,
            "state_note": "No state income tax.",
        }

    # Approximate federal AGI as taxable + federal_std + senior_bonus.
    state_agi_start = max(0.0, federal_taxable_income + federal_std_deduction + federal_senior_bonus)

    # -- Retirement exclusions ------------------------------------------------
    ss_excluded = taxable_ss if rules.get("exempts_ss") else 0.0
    pension_excluded = pension_income if rules.get("exempts_pension") else 0.0
    ira_excluded = ira_distributions if rules.get("exempts_ira") else 0.0

    # Partial retirement exclusion cap (age-gated) applied against the remaining
    # taxable pension+IRA slug (i.e. what's left AFTER any full exemptions).
    ret_cap_used = 0.0
    ret_cap = rules.get("ret_exclusion_cap", 0.0)
    ret_min_age = rules.get("ret_exclusion_min_age", 0)
    if ret_cap > 0 and max_age >= ret_min_age:
        remaining_ret_income = max(0.0, (pension_income - pension_excluded)
                                   + (ira_distributions - ira_excluded))
        # Cap is doubled for MFJ households (per-person cap).
        effective_cap = ret_cap * (2 if mfj else 1)
        ret_cap_used = min(effective_cap, remaining_ret_income)

    total_exclusions = ss_excluded + pension_excluded + ira_excluded + ret_cap_used
    state_agi = max(0.0, state_agi_start - total_exclusions)

    # State standard deduction
    std_ded = (rules.get("std_ded_mfj", 0.0) if mfj else rules.get("std_ded_single", 0.0))
    state_taxable = max(0.0, state_agi - std_ded)

    # Apply brackets or flat rate.
    if stype == "flat":
        rate = rules["flat_rate"]
        tax = state_taxable * rate
        marg = rate
    else:  # progressive
        brackets = rules["brackets_mfj"] if mfj else rules["brackets_single"]
        tax, marg = _apply_progressive(state_taxable, brackets)

    return {
        "state_tax": round(tax, 2),
        "state_taxable_income": round(state_taxable, 2),
        "state_agi": round(state_agi, 2),
        "state_std_deduction": round(std_ded, 2),
        "state_marginal_rate": round(marg, 4),
        "state_effective_rate": round(tax / state_agi_start, 4) if state_agi_start > 0 else 0.0,
        "state_ss_excluded": round(ss_excluded, 2),
        "state_pension_excluded": round(pension_excluded, 2),
        "state_ira_excluded": round(ira_excluded, 2),
        "state_ret_exclusion_used": round(ret_cap_used, 2),
        "state_type": stype,
        "state_code": state_code.upper(),
        "state_note": rules.get("note", ""),
    }


def get_state_metadata(state_code: str) -> dict:
    """Return summary metadata for a state code (for UI display)."""
    rules = STATE_TAX_RULES.get(state_code.upper()) if state_code else None
    if not rules:
        return {"code": state_code or "", "type": "flat_fallback", "supported": False}
    return {
        "code": state_code.upper(),
        "type": rules["type"],
        "supported": True,
        "exempts_ss": rules.get("exempts_ss", False),
        "exempts_pension": rules.get("exempts_pension", False),
        "exempts_ira": rules.get("exempts_ira", False),
        "ret_exclusion_cap": rules.get("ret_exclusion_cap", 0.0),
        "ret_exclusion_min_age": rules.get("ret_exclusion_min_age", 0),
        "flat_rate": rules.get("flat_rate", None),
        "std_ded_mfj": rules.get("std_ded_mfj", 0.0),
        "std_ded_single": rules.get("std_ded_single", 0.0),
        "note": rules.get("note", ""),
    }
