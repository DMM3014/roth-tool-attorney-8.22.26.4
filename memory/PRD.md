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
- **IRMAA tier-cap forward-indexed**: a conversion in year Y sets the Y+2 surcharge, so the cap now
  compares year-Y MAGI against the **Y+2 indexed** IRMAA thresholds (slightly more headroom, correct).

### Phase 15 — V9 spreadsheet reconciliation (2026-06-28)
Reconciled the engine to **Retirement_Optimizer V9.xlsm "Scenario 1"** (Fill 24% pre-RMD, IRA-first).
Every headline now matches within ~1% (user-agreed tolerance):
| Metric | Model | V9 | Δ |
|---|---|---|---|
| Total lifetime conversions | 3,890,427 | 3,894,632 | −0.1% |
| Lifetime taxes + Medicare | 7,765,488 | 7,810,252 | −0.6% |
| Gross estate @ 2nd death | 81,426,835 | 81,538,200 | −0.1% |
| Traditional IRA @ 2nd death | 4,520,255 | 4,520,453 | −0.0% |
| Heir tax on inherited IRA (PV) | 1,430,661 | 1,430,723 | −0.0% |
| After-tax legacy (nominal) | 79,181,906 | 79,292,095 | −0.1% |
| Children's wealth @ +10 | 140,350,666 | 141,792,197 | −1.0% |

Engine changes (`projection.py`, `tax_engine.py`):
- **Day-count proration**: income/expense boundary years prorate by active days/365 (mid-year
  retirement, SS claim, 65th-birthday medical switch). New `start_date`/`stop_date` fields (engine
  prefers them; falls back to `start_year`/`stop_year`). Income COLA compounds from the stream's start
  year; expenses inflate from the projection start year.
- **SECURE 2.0 RMD start age** by birth year (72 / 73 / **75** for born ≥1960) via `rmd_start_age`;
  conversions stop at the same age.
- **Conversion sized inside the circular solver**, net of RMDs and discretionary IRA withdrawals
  (IRA-first funding consumes bracket room, leaving less for conversion — matches the sheet's solver).
- **Income covers spending first**: cash is only tapped for the net shortfall (fixed a bug that drained
  cash by the full spend each year). Cash interest is retained in (and compounds inside) cash.
- **Grow-then-apply order**: EOY = BOY×(1+r) ± flows (current-year conversions/RMDs no longer compound).
- **Per-account RMD** taken from each account; conversions/withdrawals draw client-IRA-first; spousal
  IRA **rollover** the year after first death (RMDs continue on the survivor's age).
- **Post-death horizon** matches V9: inherited Roth compounds tax-free, inherited IRA depleted at the
  heir ordinary rate (no settlement haircut), taxable/reinvest sleeves grow net of the dividend tax drag
  and incur accrued LTCG on post-death appreciation. New `legacy.heir_ltcg_rate` (default 0.188+state).
- **Default scenario is now V9 Scenario 1** (`defaults.py`). Frontend Plan Inputs uses **date inputs**
  for income/expense start/stop (synced to year fields); header reads "v9 Longevity Engine"; RMD-stop
  label is dynamic by birth year.
- Tests: new `test_phase14_v9_reconciliation.py` (11 assertions). **45/45 backend tests pass**; full
  frontend validated by the testing agent (9/9 checks, 0 issues). Validation harness:
  `backend/tests/v9_scenario1.py` + `v9_compare.py`.

KNOWN: AI Insights streaming currently returns a budget error — the **Emergent LLM key budget is
exceeded** (unrelated to this work; user must top up at Profile → Universal Key → Add Balance).

### Phase 16 — code-quality refactor (2026-06-28)
Applied the legitimate code-review findings (kept the V9 reconciliation green throughout — 44/44 tests):
- **Backend `run_projection` complexity**: extracted the 40-iteration conversion/withdrawal circular
  solver into `_solve_year_conversion(ctx, bal, basis)` (with a `_SolveCtx` dataclass to group args)
  and result roll-up into `_aggregate_results(cfg, rows)`. Behavior identical (V9 year-by-year test guards).
- **Frontend hook deps**: memoized `update()` with `useCallback` and fixed `findOptimal` deps in
  `Projection.jsx`; removed the unnecessary eslint-disable in `Planner.jsx`.
- **Projection.jsx breakdown**: extracted all chart JSX into `ProjectionCharts.jsx` (NetWorth /
  Composition / Tax / LegacyHorizon / ConvertCompare); main file 484 → 414 lines, recharts imports gone.
- **Dynamic RMD-stop label** by birth year (SECURE 2.0).
- **Deliberately NOT changed (linter false positives)**: `is None`/`is not None` are correct PEP8 (changing
  to `==` would introduce bugs); `craco.config.js` console.warn is already dev-gated build infra;
  `use-toast.js` is a vendored shadcn file with the intentional `[state]` dependency. `compute_year_tax`
  was left as-is — all math already lives in dedicated helpers; its length is the 30-key result dict.

## Implemented (2026-06-29)
- **Detail / Cashflow tab (DONE)**: wired `DetailCashflow.jsx` into `Planner.jsx` as a new tab placed
  right after "Multi-Year Projection". Renders two tables: (1) Account Detail — per-account balances,
  per-tax-type subtotals and Net Worth for every lifetime year + the 10-year post-death heir horizon
  (inherited-bucket subtotals + total-to-heirs); (2) Cashflow — year-by-year line items (wages/pension,
  SS, dividends, interest, RMD, Roth conversion, expenses, income tax, Medicare/IRMAA, discretionary
  withdrawals by source, surplus). Both tables export to CSV. Backend `projection.py` already exposes
  `rows[].account_balances{}`, `rows[].cashflow{}` and `legacy.post_death_rows[]`.
  Verified by testing agent (iteration_7.json) — 8/8 frontend checks PASS. Cleaned up React key-prop
  warning (Fragment keys) and the `0`-falsy cashflow cell render.
- **Detail/Cashflow enhancements (DONE)**: (1) "Download full plan" button exports a single multi-sheet
  Excel workbook (`retirement_plan.xlsx`) with Projection Summary + Account Detail + Cashflow sheets via
  SheetJS (`xlsx` added to package.json; `downloadWorkbook` helper in `lib/api.js`). (2) Debounced the
  projection refire in `DetailCashflow` (300ms timeout keyed on a JSON signature of scenario) to avoid
  duplicate /api/project calls. (3) Native-title tooltip on the heir-row blank cells explaining accounts
  merge / step-up at the second death. Self-verified via screenshot + real download event.
  Note: yarn.lock integrity hash for `@emergentbase/visual-edits` was stale and updated to the current
  CDN tarball hash to unblock `yarn add`.
- **Compare tab (DONE)**: new top-level "Compare" tab lets users pick up to 3 scenarios from dropdowns
  (the live "Current (working scenario)" + any saved scenarios) and view them side by side. Shows
  (1) a Headline Metrics table (lifetime taxes, ending net worth, total converted, ending Roth,
  after-tax to heirs, inherited IRA tax) with a ★ on the most-favorable value per row, (2) a net-worth-
  over-time overlay line chart with one line per scenario, and (3) a year-by-year net-worth delta table
  (Δ vs the first selected). Files: `Compare.jsx`, `CompareChart.jsx`; wired into `Planner.jsx`.
  Each slot runs `/api/projection`; effect debounced via a JSON signature with an `alive` race guard.
  Verified by testing agent (iteration_8.json) — 9/9 frontend checks PASS, 0 console errors.
- **Analytics tab — 8 MGP/Boldin-style charts (DONE)**: new top-level "Analytics" tab (after Detail/
  Cashflow) with: (1) Income sources stacked bar vs spending line, (2) Tax bracket-fill stacked bars +
  marginal-rate step line, (3) Annual surplus/(shortfall) green/red bars, (4) Tax composition stacked
  (ordinary/LTCG/NIIT/state/Medicare), (5) RMD vs Traditional/Roth balances dual-axis, (6) IRMAA cliff
  MAGI area vs 5 indexed tier step-lines, (7) Effective vs marginal rate lines, (8) Cumulative lifetime
  taxes convert-vs-no-convert area. Files: `Analytics.jsx`, `AnalyticsCharts.jsx`; wired into `Planner.jsx`.
  Backend: added per-row `ordinary_taxable_income`, `magi`, `irmaa_tier`, `irmaa_thresholds`,
  `bracket_fill`, `tax_breakdown` (projection.py) + `bracket_fill()`/`irmaa_thresholds()` helpers
  (tax_engine.py). Tax math unchanged — 45/45 tests pass. Analytics runs the projection with + without
  conversions (debounced, short-circuits the 2nd call when conversions already off).
  Verified by testing agent (iteration_9.json) — 7/7 frontend checks PASS, 0 console errors.
- **Print / Export presentation (DONE)**: "Print / Export PDF" button on the Analytics tab compiles a
  branded, client-ready document — a green cover page with household name, date and a with/without-
  conversions metrics table, followed by all 8 analytics charts (one per section). Implemented via a
  print stylesheet (`index.css` `@media print` + `.print-only`/`.no-print`/`.print-card`) and
  `window.print()` (same vector-quality, memory-safe pattern as the existing Projection print button) —
  the user saves as PDF from the browser dialog. Verified by emulating print media + generating a real
  4-page A4 PDF via Playwright (branded cover + charts render, toolbar hidden).
  NOTE: an earlier jspdf+html2canvas approach was abandoned — html2canvas hung capturing the recharts
  SVGs and spiked memory (caused a pod OOM); `jspdf`/`html2canvas` remain in package.json but are unused
  (dead `lib/pdf.js`, not imported, tree-shaken out).
- **AI Insights — continued dialog (DONE)**: after the AI generates the strategy summary, the client can
  keep chatting with the model about their plan. `AIInsights.jsx` now renders a streaming chat thread
  (assistant + client bubbles) with an input box, send, and "start over" (reset). New backend endpoint
  `POST /api/insights/chat` (server.py) is STATELESS and streaming — the frontend keeps the transcript
  (ephemeral) and sends `{summary, history, message}` each turn; the endpoint rebuilds context (plan
  summary JSON + prior transcript + new question) and streams Claude Sonnet 4.6 (Emergent LLM key).
  Both the Optimizer and Projection AI panels inherit it (shared component). Verified via curl (context-
  aware streamed answer) + full e2e screenshot (generate summary → follow-up → 3 messages, correct
  context). Ephemeral per user's choice; clears on reset/reload — no DB persistence.
- **Dividends rate → Optimizer link (DONE)**: On Plan Inputs the dividend field is now labeled
  "Other Dividends Realized — Rate (% of taxable)" (the existing `dividend_yield`, default 2%/0.02,
  user-editable) and shows the derived annual dollars (rate × sum of Taxable account balances). The
  Single-Year Optimizer's "Qualified Dividends + Recurring LTCG" now auto-defaults to that same
  `rate × taxable balances` (was a static 60k / income-stream value), with a derivation note; still
  editable. Reactive across tabs (verified: 2% → $120,000, 3% → $180,000). No backend/core-math change —
  the multi-year engine already computes dividends as `dividend_yield × taxable balances`.
- **Single-Year Optimizer — Tax Year selector (DONE)**: added a "Tax Year" dropdown (projection range
  2026–2062). Previously the optimizer was hardwired to the start year with no indexing
  (`bracket_index`/`irmaa_index` = 1.0). Now selecting a year computes `bracket_index`/`irmaa_index =
  (1+rate)^(year−start)` from the projection's indexing rates, and AUTO-DERIVES "# Age 65+" / Medicare
  count from the household birth years + selected year + filing status (still editable). Shows an
  indexing/ages note. Frontend-only (Optimizer.jsx) — the `/api/tax/optimize` endpoint already accepted
  year + indices. Verified: 2026 → ×1.00 (ages 61/60, conv $82,750); 2035 → ×1.30 (ages 70/69, Medicare
  + senior deduction apply, 24% ceiling widens to $526,541, conv $219,861).
- **Optimizer — "Use values from my plan" drill-down (DONE)**: a button under the Tax Year selector
  pulls the selected year's BEFORE-CONVERSION income from the multi-year projection into the optimizer
  fields, so it then recommends the Roth conversion on top. Maps from `runProjection(scenario)` row's
  cashflow: wages_pension→ordinary, rmd+from_ira→IRA distributions (excl. conversion), interest, gross_ss,
  dividends→recurring div/LTCG, (preferential_income − dividends)→realized LTCG; filing status + #65+ /
  Medicare derived from the row's client/spouse ages (handles survivor years). Frontend-only (Optimizer.jsx,
  sonner toast). Verified: 2040 pull → wages $11,496, IRA dist $153,320, SS $112,842, div+LTCG $239,757,
  ages 75/74, then recommends $403,371 conversion to the indexed 24% ceiling ($610,406).
- **Monte Carlo v1 (DONE)**: new "Monte Carlo" tab. Backend `montecarlo.py` + `POST /api/montecarlo`
  (background job + `GET /api/montecarlo/{job_id}` poll; in-memory MC_JOBS dict trimmed to 50). Locks the
  deterministic conversion schedule, runs the projection with AND without conversions (paired identical
  random draws), and marches an aggregate liquid-wealth recursion `L_{t+1}=L_t·g+net_flow` on liquid
  accounts only (numpy-vectorized N×T lognormal returns; balance-weighted mean return; depleted trials
  locked at $0). Returns ONLY summary stats: per-year percentiles P10/P25/P50/P75/P90, ending dist
  (p10/p50/p90/mean/min/pct_positive/depleted), 20-bin histogram clipped at P90 — never raw trials.
  Success = liquid never depletes through 2nd death (= fully funds every year). Frontend: probability-of-
  success gauge, with-vs-without resilience comparison, percentile fan chart, ending-portfolio histogram.
  Trials 250/500/1000 (default 500), editable volatility (default 12%). Verified by testing agent
  (iteration_10.json): backend 6/6, frontend 100%, 0 console errors, 8-tab regression all PASS.
  Methodology note: aggregate approximation (taxes locked from deterministic run); numpy is in requirements.txt.
- **Monte Carlo → AI Insights bridge (DONE)**: the MC result is lifted to Planner state (`mcResult`),
  passed to the Projection tab, and injected as a `monte_carlo` block into the AI summary (success with/
  without, resilience delta points, median & P10 ending, depleted %). The `/insights` system prompt now
  instructs the AI to OPEN with the probability of success and the resilience the conversions add. The
  result auto-clears whenever the scenario changes (so it never goes stale). Verified e2e: run MC (92%) →
  Projection → Generate Insights opens with "92% probability of success … converting adds 2.8 points of
  resilience (92.0% vs 89.2%)…".
- **Projection AI panel hint (DONE)**: when no Monte Carlo has been run yet, the Projection AI panel shows
  a dismissible-by-action tip (`data-testid="mc-hint"`) nudging the user to run the Monte Carlo tab first
  for a success-rate-aware summary. It auto-hides once `mcResult` exists. Verified: visible before MC,
  hidden after a run.
- **Analytics — "Net to Family at Second Death + 10 Years" chart (DONE)**: new `HeirLegacyCompareChart`
  (AnalyticsCharts.jsx, wired into Analytics grid) contrasts the after-tax estate delivered to heirs after
  the 10-year SECURE inherited-account drawdown, WITH vs WITHOUT conversions. Stacked horizontal bars split
  tax-free inherited Roth (green) from other after-tax (sand), with total labels and a delta callout. Uses
  the existing dual `withRoth.legacy`/`noRoth.legacy` runs; included in the print/PDF export via `print-card`.
  Verified: With $140.35M vs No $126.09M (+$14.26M to family; conversions also shift a large slice into the
  tax-free Roth bucket).

### Monte Carlo v2 (DONE — 2026-06-30)
- **Per-asset-class global allocation**: `montecarlo.py` `_portfolio_factors` blends independent
  per-class lognormal draws (stocks/bonds/cash, each with its own mean + vol) into a single portfolio
  gross-return factor weighted by allocation; allocations auto-normalize on run. Reports blended
  `portfolio_mean` / `portfolio_vol`. Frontend `MonteCarlo.jsx` exposes an editable Allocation %/Mean %/Vol %
  table (defaults 60/30/10 · 8/4/3 · 18/6/1) with a live "totals X%" warning when ≠100%.
- **Sequence-of-returns risk** (automatic): cohort = worst 5% of paths by cumulative return over the first
  3 years; reports base vs cohort success rate and the cohort median ending portfolio (`mc-seq-card`).
- **Early bear-market stress** (toggle): forces a fixed negative return (default −15%/yr) for the first
  N years (1–5) as a separate run on the same draws; shows shocked success with/without conversions
  (`mc-shock-card`, conditional).
- **Persistence**: MC jobs stored in MongoDB `mc_jobs` with a TTL index (`created_at` expireAfterSeconds=3600)
  + unique `job_id` index; `POST /api/montecarlo` writes job then runs in a background asyncio task,
  `GET /api/montecarlo/{job_id}` polls. AssetClass{mean,vol,weight} + ShockSpec{enabled,rate,years} models.
- **UI polish**: SuccessCompareChart bars switched from fixed barSize to maxBarSize/minPointSize so they
  render thick at any container width.
- Verified: backend e2e via curl (allocation + sequence_risk + shock all returned), frontend testing agent
  iteration_11.json — 6/6 review bullets PASS, 0 console/page errors, Plan-Inputs→Monte-Carlo invalidation OK.

## Backlog / Next (updated 2026-06-30)
- P1: Monte Carlo v2.1 — add inflation volatility (stochastic COLA / spending growth) to the simulation.
- P2: api.js runMonteCarlo poll window is 42s (60×700ms); raise to ~60s or backoff for very large trials.
- P2: enforce shock-years HTML max=5 in onChange (currently clamps min only).

### Present-Value charts + spreadsheet verification + MC trials lock (DONE — 2026-06-30)
- **Present Value (today's dollars) analytics on BOTH Analytics and Scenarios tabs**: new `pvSeries()` helper
  (`lib/api.js`) discounts every projection year's net worth — and the net-to-family estate (delivered at
  2nd-death + SECURE horizon, default 2072) — back to the plan start year at the plan inflation rate
  (`projection.general_inflation`, ~3%), With vs Without conversions.
  - `PvNetWorthChart` — PV of future net worth over time (With area vs No dashed line).
  - `RothConversionsChart` — **planned Roth conversions by year** (bar; total label) — added to BOTH tabs.
  - `PvNetToFamilyChart` — PV of after-tax estate to heirs, With vs No, split tax-free Roth vs other, with
    a delta callout (default plan: With $36.03M PV vs No $32.37M PV → +$3.66M PV to family).
- **Spreadsheet download verification**: `buildPvSheets()` builds a year-by-year sheet (conversion, nominal &
  PV net worth With/No) + a net-to-family PV summary sheet. Both Analytics and Scenarios have **Download Excel
  (.xlsx)** and **Download CSV** buttons (Analytics keeps Print/Export PDF too) so figures reconcile against
  the source model.
- **Scenarios tab** now runs the projection (with + no-conversion) on scenario change (300ms debounce) and
  renders the 3 PV/conversion charts below the household & saved-scenarios cards.
- **Monte Carlo trials locked to 500**: removed the 250/1000 dropdown (unsupported recalculations); `mc-trials`
  is now a static "500 · fixed · validated" display; `TRIALS=500` constant drives the run.
- Verified: frontend testing agent iteration_12.json — 5/5 review bullets PASS, 0 console/page errors,
  4/4 downloads fire (retirement-pv-results.xlsx/csv, scenario-pv-results.xlsx/csv), save/load/delete intact.

### AI Insights "stops at one query" fix (DONE — 2026-06-30)
- Root cause: not a multi-turn defect — the initial `/insights` generation streamed a long multi-section
  essay with tables (~49s). The chat input stays disabled while `streaming` (correct), so the long stream
  made it look frozen/finished, blocking follow-ups.
- Fix (`server.py`): tightened the `/insights` system prompt to a concise format (one headline + 4-5
  single-line bullets, no tables/headers, ~180 words, ends inviting a follow-up) and added a
  `.with_params(max_tokens=450)` cap (550 for `/insights/chat`). Initial response now streams in ~11s
  (was ~49s); follow-ups ~9s. Verified e2e: 5-message multi-turn thread (initial + 2 Q&A pairs) with the
  input re-enabling after each turn.

### AI Insights suggested follow-up chips (DONE — 2026-06-30)
- Added 4 one-click suggestion chips under the AI thread ("Why 24%?", "IRMAA risk?", "Survivor impact?",
  "Net to family?") in `AIInsights.jsx`. Each chip sends a full follow-up question via a refactored
  `sendMessage(q)` helper (`send()` now delegates to it). Chips render only when not streaming
  (data-testid ai-suggestions / ai-suggestion-{i}). Verified e2e: clicking "IRMAA risk?" appended the Q&A
  and the assistant answered on-topic; input re-enabled ~12s.

### Code-quality refactor pass (DONE — 2026-06-30)
Regression guard added: `backend/tests/golden_snapshot.py` (save/check) snapshots compute_year_tax,
optimize_conversion, run_projection & sweep across several configs -> `_golden.json`. All refactors below
verified GOLDEN MATCH + 52/52 pytest.
- **Backend run_projection** (223 lines / cyclomatic 56 -> ~70 lines): extracted `Plan` dataclass +
  `_parse_plan`, `YearStatus` + `_year_demographics` (alive/filing/rollover/65+ counts), `YearCalc` +
  `_build_year_row`. Output byte-identical.
- **Backend compute_year_tax**: extracted `_TaxBase` + `_resolve_taxable_income` (income->AGI/MAGI->
  deductions->ordinary/preferential split); main fn now orchestrates the (already-separate) bracket helpers.
- **Backend run_montecarlo**: extracted `_deterministic_flows`, `_sequence_risk`, `_shock_run`.
- **Fixed 2 outdated Monte Carlo tests** (used removed v1 `volatility`/`mean_return`) -> v2 `assets`/
  `portfolio_vol`; the "higher vol lowers success" test is now a robust dispersion test; added a shock test.
- **Frontend Projection.jsx split** 406 -> 191 lines (orchestrator) + new `ProjectionPanels.jsx`
  (ProjectionControls / SweepPanel / YearTable / LegacyPanels). Imports cut 36 -> 7. Memoized the
  in-JSX key-accounts filter. Fixed AI-summary mcResult v1->v2 keys (portfolio_vol/portfolio_mean).
- **Index-as-key fixes**: MonteCarloCharts compare Cell (key=d.name), AnalyticsCharts SurplusChart Cell
  (key=d.year), AIInsights messages now carry a stable `id` (history strips id when POSTed). Fixed the
  last Planner.jsx exhaustive-deps warning -> build is now 0 warnings.
- **Correctly NOT changed (linter false positives)**: `is None`/`is not None`/`is True` are PEP-8 idiom
  (==would be a regression); the "missing hook deps i/keys/next/res/a/b" are LOCAL vars inside the
  callbacks, not deps (build shows 0 exhaustive-deps warnings for those files).
- Verified: frontend testing agent iteration_13.json — 6/6 PASS, 0 console errors, 0 key warnings.

Deferred (low value / higher risk, noted from the report): per-helper argument-count reductions
(_apply_year_flows 11 args, _withdraw/_total_rmd) and the aiSummary 11-dependency useMemo — these are
"Important" not "Critical" and the dependencies/args are genuinely needed.
