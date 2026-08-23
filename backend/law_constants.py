"""Single source of truth for statutory tax-law figures used across the engine.

This module is intentionally dependency-free (imports nothing from other backend
modules) so it can be imported everywhere without circular-import risk. Every
statutory constant the projection/tax/estate engines rely on is defined ONCE
here, with its value, indexing rule, and legal citation. Consumers (tax_engine,
estate, projection) read from LAW so a single edit keeps the whole app — and the
printed report's "Statutory Figures & Authorities" appendix — in sync.

IMPORTANT: values here are the exact figures previously hard-coded in the engine
(2026 OBBBA framework). Changing a value here changes the calculation everywhere.
"""

LAW_AS_OF = "2026 OBBBA framework"

# Each figure entry: {label, value, indexing, citation}
LAW = {
    "LAW_AS_OF": LAW_AS_OF,
    "figures": {
        "federal_ordinary_brackets": {
            "label": "Federal ordinary income brackets",
            "value": {
                "rates": [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
                "floors_mfj": [0, 24800, 101200, 211400, 403550, 512450, 768700],
                "floors_single": [0, 12400, 50600, 105700, 201775, 256225, 640600],
            },
            "indexing": "Chained-CPI (C-CPI-U) annually",
            "citation": "IRC §1; OBBBA (2026 framework)",
        },
        "standard_deduction": {
            "label": "Standard deduction (incl. age-65+ addition)",
            "value": {"mfj": 32200, "single": 16100, "add65_mfj": 1650, "add65_single": 2050},
            "indexing": "Chained-CPI (C-CPI-U) annually",
            "citation": "IRC §63(c)",
        },
        "ltcg_qdi_thresholds": {
            "label": "LTCG / qualified-dividend rate thresholds (top of 0% and 15% bands)",
            "value": {
                "mfj": {"top_of_0pct": 98900, "top_of_15pct": 613700},
                "single": {"top_of_0pct": 49450, "top_of_15pct": 545500},
            },
            "indexing": "Chained-CPI (C-CPI-U) annually",
            "citation": "IRC §1(h)",
        },
        "niit": {
            "label": "Net Investment Income Tax (rate & MAGI thresholds)",
            "value": {"rate": 0.038, "threshold_mfj": 250000, "threshold_single": 200000},
            "indexing": "Not indexed (fixed by statute)",
            "citation": "IRC §1411",
        },
        "rmd_beginning_age": {
            "label": "Required Minimum Distribution beginning age (by birth year)",
            "value": {"born_le_1950": 72, "born_1951_1959": 73, "born_ge_1960": 75},
            "indexing": "Set by birth year (SECURE 2.0)",
            "citation": "IRC §401(a)(9); SECURE 2.0 Act §107 (2022)",
        },
        "secure_post_death_horizon_years": {
            "label": "SECURE Act post-death distribution horizon (non-eligible beneficiaries)",
            "value": 10,
            "indexing": "Fixed by statute",
            "citation": "IRC §401(a)(9)(H); SECURE Act (2019)",
        },
        "fed_estate_exclusion": {
            "label": "Federal estate / gift / GST basic exclusion amount",
            "value": 15_000_000,
            "indexing": "Chained-CPI annually from the 2026 base (permanent per OBBBA)",
            "citation": "IRC §2010(c), §2631",
        },
        "fed_estate_tax_rate": {
            "label": "Federal estate / gift / GST top marginal rate",
            "value": 0.40,
            "indexing": "Not indexed (fixed by statute)",
            "citation": "IRC §2001(c), §2502, §2641",
        },
        "annual_gift_exclusion": {
            "label": "Annual gift-tax exclusion (per donor, per donee)",
            "value": 19000,
            "indexing": "Indexed annually, rounded to nearest $1,000",
            "citation": "IRC §2503(b)",
        },
        "qcd_cap": {
            "label": "Qualified Charitable Distribution annual cap (per taxpayer)",
            "value": 111000.0,
            "indexing": "Indexed annually (SECURE 2.0)",
            "citation": "IRC §408(d)(8)",
        },
        "irmaa_thresholds_mfj": {
            "label": "IRMAA MAGI thresholds — married filing jointly (tier tops)",
            "value": [218000, 274000, 342000, 410000, 750000],
            "indexing": "Indexed annually (CPI-U)",
            "citation": "42 U.S.C. §1395r(i)",
        },
        "irmaa_thresholds_single": {
            "label": "IRMAA MAGI thresholds — single (tier tops)",
            "value": [109000, 137000, 171000, 205000, 500000],
            "indexing": "Indexed annually (CPI-U)",
            "citation": "42 U.S.C. §1395r(i)",
        },
        "irmaa_part_b_multipliers": {
            "label": "IRMAA Part B premium multipliers (by tier)",
            "value": [1.4, 2.0, 2.6, 3.2, 3.4],
            "indexing": "Statutory tier multipliers",
            "citation": "42 U.S.C. §1395r(i)(3)",
        },
        "irmaa_part_d_surcharge": {
            "label": "IRMAA Part D monthly surcharge, $ (by tier)",
            "value": [174, 449, 724, 998, 1093],
            "indexing": "Indexed annually",
            "citation": "42 U.S.C. §1395r(i); §1395w-113",
        },
    },
}
