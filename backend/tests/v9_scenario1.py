"""Retirement_Optimizer V9 — 'Scenario 1' (LIVE) inputs, encoded for the engine.

Scenario 1 = "Fill 24% pre-RMD, IRA-first, Roth conversions".
Used by v9_compare.py to validate the Python engine against the spreadsheet.
"""

V9_SCENARIO_1 = {
    "household": {
        "client_name": "John Smith",
        "client_dob_year": 1965,
        "client_life_expectancy": 91,   # dies 2056
        "spouse_name": "Jane Smith",
        "spouse_dob_year": 1966,
        "spouse_life_expectancy": 96,   # dies 2062 (second death)
        "filing_status": "Married Filing Jointly",
    },
    "projection": {
        "start_year": 2026,
        "end_year": 2062,
        "general_inflation": 0.03,
        "bracket_indexing": 0.03,
        "irmaa_indexing": 0.03,
    },
    "income_streams": [
        {"id": "WAG01", "owner": "Client", "type": "Wages", "description": "Client Wages",
         "start_date": "2026-01-01", "stop_date": "2027-05-12", "start_year": 2026,
         "amount": 350000, "frequency": "Annual", "cola": 0.03,
         "tax_character": "Ordinary", "taxable_pct": 1.0, "survivor_pct": 0.0, "use": True},
        {"id": "SS01", "owner": "Client", "type": "Social Security", "description": "Client SS @ claim",
         "start_date": "2032-05-12", "start_year": 2032,
         "amount": 4152, "frequency": "Monthly", "cola": 0.03,
         "tax_character": "SS", "taxable_pct": 0.0, "survivor_pct": 1.0, "use": True},
        {"id": "SS02", "owner": "Spouse", "type": "Social Security", "description": "Spouse SS @ claim",
         "start_date": "2028-03-07", "start_year": 2028,
         "amount": 2906.4, "frequency": "Monthly", "cola": 0.03,
         "tax_character": "SS", "taxable_pct": 0.0, "survivor_pct": 1.0, "use": True},
        {"id": "PEN01", "owner": "Client", "type": "Pension", "description": "Client Pension 1",
         "start_date": "2027-05-12", "stop_date": "2032-05-12", "start_year": 2027,
         "amount": 4950, "frequency": "Monthly", "cola": 0.04,
         "tax_character": "Ordinary", "taxable_pct": 1.0, "survivor_pct": 0.5, "use": True},
        {"id": "PEN03", "owner": "Spouse", "type": "Pension", "description": "Spouse Pension 1",
         "start_date": "2032-05-12", "stop_date": "2062-03-07", "start_year": 2032,
         "amount": 700, "frequency": "Monthly", "cola": 0.04,
         "tax_character": "Ordinary", "taxable_pct": 1.0, "survivor_pct": 0.5, "use": True},
    ],
    "expenses": [
        {"id": "EXP01", "owner": "Joint", "category": "Living Expenses",
         "start_date": "2026-01-01", "start_year": 2026,
         "amount": 240000, "frequency": "Annual", "inflation": 0.03, "use": True},
        {"id": "EXP02", "owner": "Client", "category": "Pre-65 Medical — Client",
         "start_date": "2026-01-01", "stop_date": "2030-05-12", "start_year": 2026,
         "amount": 1500, "frequency": "Monthly", "inflation": 0.06, "use": True},
        {"id": "EXP03", "owner": "Client", "category": "65+ Medical — Client",
         "start_date": "2030-05-12", "start_year": 2026,
         "amount": 300, "frequency": "Monthly", "inflation": 0.06, "use": True},
        {"id": "EXP04", "owner": "Spouse", "category": "Pre-65 Medical — Spouse",
         "start_date": "2026-01-01", "stop_date": "2031-03-07", "start_year": 2026,
         "amount": 1500, "frequency": "Monthly", "inflation": 0.06, "use": True},
        {"id": "EXP05", "owner": "Spouse", "category": "65+ Medical — Spouse",
         "start_date": "2031-03-07", "start_year": 2026,
         "amount": 300, "frequency": "Monthly", "inflation": 0.06, "use": True},
        {"id": "EXP07", "owner": "Joint", "category": "Travel / Discretionary",
         "start_date": "2026-01-01", "start_year": 2026,
         "amount": 10000, "frequency": "Annual", "inflation": 0.04, "use": True},
    ],
    "accounts": [
        {"id": "CASH", "owner": "Joint", "name": "Cash / Checking", "tax_type": "Cash",
         "beginning_balance": 1000000, "cost_basis": 0, "return": 0.03},
        {"id": "TAXC", "owner": "Client", "name": "Client Taxable Brokerage", "tax_type": "Taxable",
         "beginning_balance": 3000000, "cost_basis": 1000000, "return": 0.07},
        {"id": "TAXS", "owner": "Spouse", "name": "Spouse Taxable Brokerage", "tax_type": "Taxable",
         "beginning_balance": 3000000, "cost_basis": 1000000, "return": 0.07},
        {"id": "IRAC", "owner": "Client", "name": "Client Trad IRA / 401(k)", "tax_type": "Tax-Deferred",
         "beginning_balance": 3850000, "cost_basis": 0, "return": 0.07},
        {"id": "IRAS", "owner": "Spouse", "name": "Spouse Trad IRA / 401(k)", "tax_type": "Tax-Deferred",
         "beginning_balance": 1150000, "cost_basis": 0, "return": 0.07},
        {"id": "ROTC", "owner": "Client", "name": "Client Roth IRA", "tax_type": "Tax-Free",
         "beginning_balance": 0, "cost_basis": 0, "return": 0.07},
        {"id": "ROTS", "owner": "Spouse", "name": "Spouse Roth IRA", "tax_type": "Tax-Free",
         "beginning_balance": 0, "cost_basis": 0, "return": 0.07},
        {"id": "HOME", "owner": "Joint", "name": "Primary Residence", "tax_type": "Real Estate",
         "beginning_balance": 1000000, "cost_basis": 0, "return": 0.035},
    ],
    "tax": {
        "state_rate": 0.0399,
        "include_irmaa": True,
        "survivor_filing_status": "Single",
        "survivor_spending_reduction": 0.2,
    },
    "roth": {
        "enabled": True,
        "start_year": 2026,
        "end_year": 2062,
        "target_bracket": 0.24,
        "max_annual": 0.0,
        "stop_at_rmd_age": True,
        "irmaa_tier_cap": None,
    },
    "dividend_yield": 0.02,
    "mortgage_balance": 0,
    "withdrawal": {
        "funding_order": "Cash → IRA → Taxable → Roth",
        "ira_split": 0.5,
        "surplus_sweep_to": "Taxable",
    },
    "legacy": {
        "estate_settlement_pct": 0.01,
        "heir_federal_rate": 0.3165,   # blended Fed+State heir ordinary rate (share-weighted)
        "heir_state_rate": 0.0,
        "heir_ltcg_rate": 0.2345,      # 15% LTCG + 3.8% NIIT + blended heir state
        "heir_gains_realized": True,   # V9 spreadsheet realizes heirs' gains at horizon end
        "step_up_at_death": True,
        "post_death_years": 10,
        "heir_reinvest_return": None,
    },
}

# ---- V9 spreadsheet 'actuals' for Scenario 1 (read from the .xlsm) ----
V9_CONVERSIONS = {  # CashFlow row 17
    2026: 55750, 2027: 249468.80, 2028: 348325.64, 2029: 359178.88, 2030: 377649.66,
    2031: 396818.64, 2032: 347170.44, 2033: 226461.72, 2034: 231351.18, 2035: 240450.94,
    2036: 250054.40, 2037: 260066.98, 2038: 270503.22, 2039: 281381.69,
}
V9_EOY = {  # Accounts EOY: (TradIRA, Roth, Cash+Taxable, NetWorth)
    2026: (5294250, 55750, 7387402, 13772402), 2030: (5473303, 1539456, 8070024, 16270469),
    2035: (5133278, 3851886, 9862418, 20258181), 2039: (4436397, 6223935, 11987830, 24266857),
    2040: (4593624, 6659611, 12587222, 25515806), 2050: (5613973, 13100463, 21566225, 42643906),
    2056: (5515041, 19660262, 30457703, 58538037), 2062: (4520453, 29504752, 43941970, 81538200),
}
V9_INCOME_TAX = {  # CashFlow row 11
    2026: 126597.65, 2032: 154290.90, 2040: 92391.19, 2056: 250513.20, 2062: 343664.31,
}
V9_HEADLINE = {
    "total_conversions": 3894632,
    "lifetime_income_taxes": 6889544,
    "lifetime_medicare": 920708,
    "gross_estate": 81538200,
    "trad_at_death": 4520453,
    "heir_ira_tax_pv": 1430723,
    "after_tax_legacy_nominal": 79292095,
    "children_wealth_plus10": 141792197,
}
