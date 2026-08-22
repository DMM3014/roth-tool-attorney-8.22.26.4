"""Default scenario = Retirement_Optimizer V9 'Scenario 1' (validated to within ~1%).

"Fill 24% pre-RMD, IRA-first, Roth conversions." Income/expense boundary years carry
explicit start_date/stop_date so the engine prorates partial years exactly like the sheet
(e.g. mid-year retirement, SS claim, 65th-birthday medical switch).
"""

DEFAULT_SCENARIO = {
    "household": {
        "client_name": "John Smith",
        "client_dob_year": 1965,
        "client_life_expectancy": 91,   # dies 2056
        "client_retirement_age": 66,    # retires 2031 — seeds the Client Report "Retirement" auto-suggest
        "spouse_name": "Jane Smith",
        "spouse_dob_year": 1966,
        "spouse_life_expectancy": 96,   # dies 2062 (second death)
        "spouse_retirement_age": 65,    # retires 2031 — seeds the Client Report "Retirement" auto-suggest
        "filing_status": "Married Filing Jointly",
    },
    "projection": {
        "start_year": 2026,
        "end_year": 2062,
        "general_inflation": 0.03,
        "bracket_indexing": 0.03,
        "irmaa_indexing": 0.03,
    },
    "allocation": {
        # Household-level asset allocation for Monte Carlo. Weights should sum to 1;
        # if omitted the MC falls back to DEFAULT_ASSETS (60/30/10). This is a purely
        # advisory input — the projection engine still uses per-account returns from
        # scenario.accounts[*].return. Feeds `assets` on all MC calls.
        "stocks": 0.60,
        "bonds": 0.30,
        "cash": 0.10,
    },
    "state_exclusions": {
        # Which federal-taxable income categories are EXCLUDED from state taxable
        # income. Purely a display-only knob for the Client Report state-taxable chart
        # and milestone row — does NOT change the actual state tax computed in the
        # projection engine (that still uses scenario.federal_state.state_rate applied
        # to federal taxable income, a common simplification). Advisors edit these on
        # Plan Inputs to reflect the client's home state.
        # Defaults chosen for California-ish behavior: SS is exempt, pensions & RMDs
        # follow federal (fully taxable), municipal-bond interest ignored (already
        # federal-tax-exempt so it never entered the base).
        "ss": True,
        "pension": False,
        "rmds": False,
    },
    # Custom milestone columns for the Client Report Income & Expenses milestone
    # table. Persisted on the scenario (as opposed to advisor-machine localStorage)
    # so a shared plan reads the same set of milestones for every advisor. Up to 3
    # entries; each `{name: str, year: int}`. Empty by default.
    "custom_milestones": [],
    # Family objectives the plan is being weighed against — {objective_key:
    # "high"|"medium"|"watch"}. Drives the dollar-free "What are we planning
    # for?" page printed ahead of the conversion analysis. Empty by default:
    # the advisor ticks what this family actually cares about.
    "planning_objectives": {},
    "income_streams": [
        {"id": "WAG01", "owner": "Client", "type": "Wages", "description": "Client Wages",
         "start_date": "2026-01-01", "stop_date": "2027-05-12", "start_year": 2026, "stop_year": 2027,
         "amount": 350000, "frequency": "Annual", "cola": 0.03,
         "tax_character": "Ordinary", "taxable_pct": 1.0, "survivor_pct": 0.0, "use": True},
        {"id": "WAG02", "owner": "Spouse", "type": "Wages", "description": "Spouse Wages",
         "start_date": "2026-01-01", "stop_date": "2026-03-07", "start_year": 2026, "stop_year": 2026,
         "amount": 0, "frequency": "Annual", "cola": 0.03,
         "tax_character": "Ordinary", "taxable_pct": 1.0, "survivor_pct": 0.0, "use": True},
        {"id": "SS01", "owner": "Client", "type": "Social Security", "description": "Client SS @ claim",
         "start_date": "2032-05-12", "stop_date": None, "start_year": 2032, "stop_year": None,
         "amount": 4152, "frequency": "Monthly", "cola": 0.03,
         "tax_character": "SS", "taxable_pct": 0.0, "survivor_pct": 1.0, "use": True},
        {"id": "SS02", "owner": "Spouse", "type": "Social Security", "description": "Spouse SS @ claim",
         "start_date": "2028-03-07", "stop_date": None, "start_year": 2028, "stop_year": None,
         "amount": 2906.4, "frequency": "Monthly", "cola": 0.03,
         "tax_character": "SS", "taxable_pct": 0.0, "survivor_pct": 1.0, "use": True},
        {"id": "PEN01", "owner": "Client", "type": "Pension", "description": "Client Pension 1",
         "start_date": "2027-05-12", "stop_date": "2032-05-12", "start_year": 2027, "stop_year": 2032,
         "amount": 4950, "frequency": "Monthly", "cola": 0.04,
         "tax_character": "Ordinary", "taxable_pct": 1.0, "survivor_pct": 0.5, "use": True},
        {"id": "PEN03", "owner": "Spouse", "type": "Pension", "description": "Spouse Pension 1",
         "start_date": "2032-05-12", "stop_date": "2062-03-07", "start_year": 2032, "stop_year": 2062,
         "amount": 700, "frequency": "Monthly", "cola": 0.04,
         "tax_character": "Ordinary", "taxable_pct": 1.0, "survivor_pct": 0.5, "use": True},
        {"id": "DIV03", "owner": "Joint", "type": "Dividend/LTCG", "description": "Special Dividends & LTCG",
         "start_date": "2026-01-01", "stop_date": None, "start_year": 2026, "stop_year": None,
         "amount": 0, "frequency": "Annual", "cola": 0.03,
         "tax_character": "QDiv/LTCG", "taxable_pct": 1.0, "survivor_pct": 1.0, "use": False},
    ],
    "expenses": [
        {"id": "EXP01", "owner": "Joint", "category": "Living Expenses",
         "start_date": "2026-01-01", "stop_date": None, "start_year": 2026, "stop_year": None,
         "amount": 240000, "frequency": "Annual", "inflation": 0.03, "use": True},
        {"id": "EXP02", "owner": "Client", "category": "Pre-65 Medical — Client",
         "start_date": "2026-01-01", "stop_date": "2030-05-12", "start_year": 2026, "stop_year": 2030,
         "amount": 1500, "frequency": "Monthly", "inflation": 0.06, "use": True},
        {"id": "EXP03", "owner": "Client", "category": "65+ Medical — Client",
         "start_date": "2030-05-12", "stop_date": None, "start_year": 2030, "stop_year": None,
         "amount": 300, "frequency": "Monthly", "inflation": 0.06, "use": True},
        {"id": "EXP04", "owner": "Spouse", "category": "Pre-65 Medical — Spouse",
         "start_date": "2026-01-01", "stop_date": "2031-03-07", "start_year": 2026, "stop_year": 2031,
         "amount": 1500, "frequency": "Monthly", "inflation": 0.06, "use": True},
        {"id": "EXP05", "owner": "Spouse", "category": "65+ Medical — Spouse",
         "start_date": "2031-03-07", "stop_date": None, "start_year": 2031, "stop_year": None,
         "amount": 300, "frequency": "Monthly", "inflation": 0.06, "use": True},
        {"id": "EXP07", "owner": "Joint", "category": "Travel / Discretionary",
         "start_date": "2026-01-01", "stop_date": None, "start_year": 2026, "stop_year": None,
         "amount": 10000, "frequency": "Annual", "inflation": 0.04, "use": True},
    ],
    "accounts": [
        {"id": "CASH", "owner": "Joint", "name": "Cash / Checking", "tax_type": "Cash",
         "beginning_balance": 500000, "cost_basis": 0, "return": 0.03},
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
        "state_code": "NC",
        "community_property": False,
        "include_irmaa": True,
        "survivor_filing_status": "Single",
        "survivor_spending_reduction": 0.2,
        "merge_basis_at_first_death": True,
    },
    "giving": {
        "annual_gift_amount": 0.0,
        "section_2503e_amount": 0.0,
        "start_year": 0,
        "end_year": 0,
    },
    "roth": {
        "enabled": True,
        "start_year": 2026,
        "end_year": 2062,
        "target_bracket": 0.24,
        "max_annual": 0.0,
        "stop_at_rmd_age": False,
        "irmaa_tier_cap": None,
    },
    "dividend_yield": 0.01,
    "mortgage_balance": 0,
    "withdrawal": {
        "funding_order": "Cash → IRA → Taxable → Roth",
        "ira_split": 0.5,
        "surplus_sweep_to": "Taxable",
    },
    # Strategy Optimizer lens shown on the Plan Inputs tab. Legacy-first is the
    # house default: most after-tax dollars to heirs after the SECURE window.
    "optimizer": {
        "goal": "after_tax_estate",
        "include_phased": True,
        "sweep_funding_orders": True,
        "preset_id": "legacy_first",
    },
    "legacy": {
        "estate_settlement_pct": 0.0,
        "heir_federal_rate": 0.32,     # heirs' federal ordinary income bracket
        "heir_state_rate": 0.04,       # heirs' state ordinary income rate (NC-adjacent default)
        "heir_ltcg_rate": 0.228,       # 15% LTCG + 3.8% NIIT + 4% heir state = 22.8%
        "heir_gains_realized": False,
        "step_up_at_death": True,
        "post_death_years": 10,
        "heir_reinvest_return": None,
    },
}
