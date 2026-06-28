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

## Backlog / Next
- P1: Editable income-stream & expense tables in the UI (currently fixed from defaults; balances editable).
- P1: Surface marginal-rate-aware "optimal bracket" auto-suggestion across the whole horizon.
- P2: IRMAA tier cap enforcement on conversions; Monte Carlo / sequence-of-returns risk.
- P2: Export projection to CSV/PDF; legacy/estate (step-up, heir tax) view from the source `Legacy` sheet.
- P2: Migrate deprecated on_event shutdown to lifespan handler.
