# Roth Conversion & Retirement Planner — PRD

## Original Problem Statement
Turn a retirement spreadsheet (Retirement_Optimizer_v.8 Longevity.xlsm) into a web-based Roth IRA
conversion and retirement planner. Keep the spreadsheet as the tax engine and preserve separation of
ordinary income from LTCG and qualified-dividend income.

## User Choices
- Filing status user-selectable (MFJ / Single) with death-of-spouse transition to survivor status.
- Tax engine matches the source spreadsheet's tax tables / effective rates (2026 base, indexed).
- BOTH a single-year Roth conversion optimizer AND a multi-year retirement projection.
- Generic example data (John & Jane Smith).
- AI insights via Claude Sonnet 4.6 (Emergent LLM key).

## Architecture
- **Backend** FastAPI + MongoDB. Faithful Python port of the .xlsm `Tax` + `TaxTables` sheets.
  - `tax_engine.py` — single-year tax: ordinary vs preferential separation, taxable SS (provisional),
    indexed std/senior deductions, differential bracket method, LTCG/QDIV stacked at 0/15/20%, NIIT 3.8%,
    state tax, IRMAA tiers, RMD uniform lifetime table; `optimize_conversion` (fill-the-bracket).
  - `projection.py` — year-by-year sim: income streams (COLA, survivor%), RMDs, fill-bracket conversions,
    expenses, circular tax↔withdrawal iteration, account growth, survivor filing transition.
  - `defaults.py` — generic DEFAULT_SCENARIO. `server.py` — /api/defaults, /tax/year, /tax/optimize,
    /projection, /scenarios CRUD, /insights (streaming Claude).
- **Frontend** React + Tailwind + shadcn + Recharts. Earthy "Organic" light theme (Outfit + IBM Plex Sans).
  - Tabs: Single-Year Optimizer (snapshot inputs + bracket slider + before/after breakdown + AI),
    Multi-Year Projection (controls + 3 charts + year table + with/without-conversion comparison + AI),
    Scenarios (household/longevity editor + save/load/delete).

## Implemented (2026-06-28)
- Faithful tax engine with strict ordinary/preferential separation (verified exact: ord taxable 320800,
  LTCG tax 22500, NIIT 5814, ordinary tax 62148, total 109246.92).
- Fill-the-bracket optimizer (24% → convert 82750 to ceiling 403550).
- Multi-year projection (33 yrs) with survivor MFJ→Single transition; with-vs-without conversion comparison.
- Scenario save/load/delete (MongoDB). AI insights streaming. Tested 100% backend + frontend.

### Phase 9 (2026-06-28)
- Editable income-stream / expense / account tables in new **Plan Inputs** tab.
- **One-click "Find Optimal Bracket"** sweep (`/api/sweep`): runs all brackets + no-conversion, ranks by
  after-tax estate to heirs (tie-break: lower lifetime tax), auto-applies the winner.
- **CSV export** + **Print/PDF** of the projection.
- **Legacy & Estate** view: gross estate, settlement cost, inherited-IRA tax (PV-at-death @ heir rate),
  basis step-up on taxable/home, tax-free Roth to heirs. Returned in `/api/projection.legacy`.
- All validated: 12/12 backend pytest, 100% frontend.

## Backlog / Next
- P1: Model the SECURE 10-year inherited-IRA stretch explicitly (currently PV-at-death approximation).
- P2: IRMAA tier cap enforcement on conversions; Monte Carlo / sequence-of-returns risk.
- P2: Lifetime-gifting program (§2503(e)) from source sheet; split run_projection into helpers.
- P2: Migrate deprecated on_event shutdown to lifespan handler.

### Phase 10 (2026-06-28)
- **Heir tax bracket** is now a real input (federal + state, blended) driving the legacy/estate
  calc and the "Find Optimal Bracket" sweep — converting above heirs' rate is correctly penalized.
- **State income tax rate** and **Estate settlement %** exposed on the Plan Inputs "Tax Assumptions
  & Heirs" card with a live blended-heir-rate readout.
- **Funding / Withdrawal Order** selector (Cash→Taxable→IRA→Roth · Cash→IRA→Taxable→Roth · Split,
  with IRA-share slider), stored per-scenario; cash always first, Roth always last.
- **Max Annual Conversion** dollar cap added to the projection controls.
### Phase 11 (2026-06-28)
- **Taxable-account dividends** now modeled: each year taxable BOY balance × dividend yield is paid
  out as cash income, taxed at qualified-dividend/LTCG (preferential) rates; the account appreciates
  at (gross return − dividend yield). New `dividend-yield` input + guidance note (enter GROSS return;
  appreciation computed net of dividends). Default DIV03 static stream turned off to avoid double-count.
- Confirmed funding-order/heir-rate sensitivity: with dividends modeled the 35–37% fill still wins
  on the default 33yr/7% case; setting dividend yield to 0 (taxable becomes Roth-like via step-up)
  collapses the conversion advantage to ~$3M (no-conversion estate rises $44M→$66.6M).
- 18/18 backend tests pass.

### Phase 12 (2026-06-28)
- **Surplus income/dividends reinvested into the taxable brokerage** at the gross return (basis
  increased accordingly); configurable via `withdrawal.surplus_sweep_to` (Taxable | Cash, default
  Taxable) with a UI selector. Verified: Taxable sweep $68.86M vs Cash $59.15M ending net worth.
- **Full 10-year post-death SECURE-Act horizon** (`_post_death_horizon`): inherited Roth compounds
  tax-free 10 yrs; inherited Traditional IRA depleted over 10 yrs and taxed to heirs (after-tax
  proceeds reinvested); taxable/home step-up. Headline `after_tax_estate_to_heirs` is now the
  10-year-forward value; `after_tax_estate_at_death` retained. Legacy card visualizes Roth growth
  vs IRA depletion. With the richer model the default optimal shifts to a more conservative bracket.
- 24/24 backend tests pass; full frontend validated.

### Phase 13 (2026-06-28)
- **Configurable post-death horizon** (`legacy.post_death_years`) and **heirs' reinvestment return**
  (`legacy.heir_reinvest_return`, blank = use account returns) — exposed on Plan Inputs.
- **IRMAA tier-cap on conversions** (`roth.irmaa_tier_cap`: None/0/1/2/3): caps conversions so MAGI
  stays within the chosen Medicare/IRMAA tier (new `irmaa_threshold_cap` helper). UI selector added.
- **"Convert vs. Don't" post-death comparison chart**: overlays heir after-tax value (and Roth-only
  portion) for the selected bracket vs no conversions, with a headline advantage badge — makes the
  heir-level Roth advantage (or its absence via taxable step-up) visible at a glance.
- 31/31 backend tests pass; full frontend validated.

### Phase 14 (2026-06-28)
- **IRMAA 2-year MAGI lookback (hard-coded)**: the Medicare surcharge in year Y is now driven by the
  MAGI from year Y−2 (SSA rule). `compute_year_tax` accepts an `irmaa_magi` override (falls back to
  current-year MAGI for the single-year optimizer); the projection tracks `magi_history` and feeds the
  Y−2 value each year. Returns `irmaa_magi` in the breakdown. 34/34 backend tests pass (3 new).
