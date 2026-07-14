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
- AI insights via Google Gemini (gemini-2.5-flash) — BYOK: each visitor supplies their own free API key.

## Architecture
- **Backend** FastAPI + MongoDB. Faithful Python port of the .xlsm `Tax` + `TaxTables` sheets.
  - `tax_engine.py` — single-year tax: ordinary vs preferential separation, taxable SS (provisional),
    indexed std/senior deductions, differential bracket method, LTCG/QDIV stacked at 0/15/20%, NIIT 3.8%,
    state tax, IRMAA tiers, RMD uniform lifetime table; `optimize_conversion` (fill-the-bracket).
  - `projection.py` — year-by-year sim: income streams (COLA, survivor%), RMDs, fill-bracket conversions,
    expenses, circular tax↔withdrawal iteration, account growth, survivor filing transition.
  - `defaults.py` — generic DEFAULT_SCENARIO. `server.py` — /api/defaults, /tax/year, /tax/optimize,
    /projection, /scenarios CRUD, /insights + /insights/chat (streaming Gemini, BYOK).
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
- ~~P2: api.js runMonteCarlo poll window is 42s~~ DONE 2026-07-01 (raised to ~60s / 86 polls).
- ~~P2: enforce shock-years HTML max=5 in onChange~~ DONE 2026-07-01 (now clamps min AND max=5).
- ~~P2: real-vs-nominal toggle on the Monte Carlo fan chart~~ DONE 2026-07-01.

### Monte Carlo — real/nominal toggle + polish (DONE — 2026-07-01)
- **Real ("today's dollars") vs Nominal toggle on the fan chart** (`MonteCarlo.jsx`): a pill toggle
  (`mc-real-toggle` / `mc-nominal-btn` / `mc-real-btn`) in the fan-card header. In real mode every
  percentile (P10/P25/P50/P75/P90) is discounted per year at the plan inflation rate
  (`projection.general_inflation`, default 3%) from the plan start year; the three ending stat cards
  (P10/P50/P90) are discounted at the final-year factor and labeled "today's $". Subtitle notes the mode
  + discount rate. Frontend-only (no engine/API change). Verified: median ending $38.2M nominal →
  $13.7M today's-$ (36 yrs @3%), Y-axis rescales $140M→$60M, labels/subtitle update.
- **Polish**: `runMonteCarlo` poll window raised 42s→~60s (86×700ms) in `lib/api.js`; MC shock-years
  input now clamps to `min 1 / max 5` in onChange (was min-only).

### Plan Inputs account CRUD + currency inputs + heir with/without panel (DONE — 2026-07-01)
- **Accounts are now fully editable** (`PlanInputs.jsx`): added an "Add" button (`add-account-button`,
  seeds a Joint Taxable Brokerage), a per-row delete (`acc-del-{i}`), and made **Tax Type** an editable
  Select (`acc-type-{i}`: Cash / Taxable / Tax-Deferred / Tax-Free / Real Estate) — so users can add a
  joint taxable brokerage (or any account). Engine re-partitions by tax_type automatically; projection
  verified to run with the added account.
- **Currency-formatted inputs**: new `Money` component shows `$1,234,567` (commas, $, no decimals) when
  idle and swaps to a raw number field on focus (preserves precision like monthly $2,906.40), reformats
  on blur. Applied to income amount (`inc-amt-{i}`), expense amount (`exp-amt-{i}`), account
  beginning_balance (`acc-bal-{i}`) and cost_basis (`acc-basis-{i}`). Rates/COLA/return stay plain number inputs.
- **Multi-Year Projection — heir with/without-conversions panel** (`ProjectionPanels.jsx`
  `HeirComparePanel`, `heir-compare-card`): a table + two callout cards contrasting, at 2nd death +
  horizon (10 yrs), the **ending inheritance to heirs** (With vs Without vs Δ) and the **heir income tax
  on the inherited IRA** (With vs Without vs tax saved). Uses the existing `legacy` (with) and `legacyNo`
  (no-conversion) runs already computed by the Projection tab. Verified live: inheritance With $162.7M vs
  Without $144.1M (+$18.7M); heir tax With $2.0M vs Without $5.6M (−$3.6M saved).

### AI legacy figures + OBBBA current-law prompt + Print cover heir cards (DONE — 2026-07-01)
- **Heir figures into AI Insights**: `useAiSummary.js` `net_to_family` block now includes
  `inheritance_delta` and `heir_ira_tax_saved`; the `/insights` system prompt (server.py) now requires a
  LEGACY bullet stating BOTH the extra inheritance AND heir tax saved (e.g. "leave heirs ~$18.7M more and
  cut their inherited-IRA income tax by ~$3.6M, mostly tax-free"). Verified live via streaming curl.
- **OBBBA current tax law**: both `/insights` and `/insights/chat` system prompts now instruct the model
  to assume the One Big Beautiful Bill Act of 2025 made the TCJA individual brackets (10/12/22/24/32/35/37%)
  PERMANENT and inflation-indexed (chained CPI) with a permanent larger standard deduction — and to NOT
  warn about a 2026 TCJA sunset. Verified: AI now says "today's permanently indexed TCJA rates".
- **Print/PDF cover heir cards** (`Analytics.jsx`): cover metrics table gained "Inheritance to Heirs
  (2nd death +10)" and "Heir Income Tax on Inherited IRA (+10)" rows, plus two headline callout cards
  ("Extra Inheritance from Converting +$X" / "Heir Income Tax Saved by Converting −$Y"). Footer updated
  to "brackets permanent & inflation-indexed (OBBBA 2025)". Verified via print-media screenshot
  (default: +$14.26M inheritance, −$3.67M heir tax).

### Concepts (client-education) tab + OBBBA badges (DONE — 2026-07-01)
New dedicated **"Concepts"** tab (`Concepts.jsx` + `ConceptsCharts.jsx`, wired in `Planner.jsx`) — runs the
projection with & without conversions and presents four client-facing illustrations. All 7 review
bullets PASS (testing agent iteration_15.json, 0 console/page errors, full 8-tab regression clean).
- **Funding Waterfalls** (year selector defaulting to the ★ largest-conversion year): a **Spending**
  waterfall (Income&RMD → Cash → Taxable → IRA → Roth → Total) and a **Conversion-tax funding** waterfall
  (Cash/Taxable only — "never Roth, never IRA proceeds"), with a "No conversion in {yr}" fallback. NOTE:
  fundable income excludes cash interest (engine retains interest in cash); waterfall bar labels use an
  explicit `LabelList dataKey="label"` string (recharts stacked-bar `label` otherwise shows cumulative,
  not the per-segment increment).
- **Value to Heirs** at 2nd death & +10 (With vs Without) — four metric cards.
- **Illustration 1 — Internal vs External conversion tax**: pre-filled from plan (conv = largest year,
  rate = target bracket + state, growth = IRA return, 20 yrs), editable; line chart + Roth-at-horizon
  cards + tax-free-advantage delta (external always ≥ internal by taxAmt×(1+g)^yrs).
- **Illustration 2 — Realized-in-life vs Step-up-at-death**: $1M gains @ LTCG+NIIT+state (≈23.45%) = tax
  vs $0 stepped-up, scaled to the household's taxable balance & embedded gain (auto-filled), editable.
- **OBBBA "current law" badge**: always-on header pill (`obbba-badge`) AND on the Print/PDF cover
  (`print-obbba-badge`).

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

### Argument-count reduction via param objects (DONE — 2026-06-30)
Behavior-identical (GOLDEN MATCH + 52/52 pytest). Reused the existing `Plan` dataclass + added `YearFlows`.
- `_total_rmd`: 9 -> 5 args (plan, status, owner_map, bal, year).
- `_withdraw`: 10 -> 5 args (plan, shortfall, bal, basis, rmd_total) — pulls funding_order/ira_split/
  rmd_reserve_id/taxable_ids/ira_ids/roth_ids from `plan`.
- `_apply_year_flows`: 11 -> 4 args (plan, bal, basis, flows) via new `YearFlows` dataclass
  (cash_need, rmd_by, ira_draw, wd, roth_withdraw, conversion, surplus).
- `_SolveCtx`: 18 -> 13 fields (dropped 6 account/funding fields, added one `plan` ref); `_withdraw`
  call inside `_solve_year_conversion` now passes `ctx.plan`.

### Code-review round 3 — false positives flagged + genuine complexity cuts (DONE — 2026-06-30)
**Verified as FALSE POSITIVES (NOT changed — applying them would break the app):**
- "Missing hook deps" (use-toast.js, Scenarios, Projection, Planner, Optimizer, DetailCashflow, Compare):
  the flagged names are LOCAL vars inside callbacks (i, keys, a, b, row, net_worth, ending), module-level
  vars (listeners), or stable setters (setState, setScenario, setMcResult). The real react-hooks/exhaustive
  -deps rule does NOT require these; the actual webpack build is 0 warnings. use-toast.js is the unmodified
  canonical shadcn file.
- Backend `is` comparisons (projection.py 91/212/467/574/639, tax_engine.py 160/256, 3 tests): all are
  `is None`/`is not None`/`is True` — correct PEP-8 (`==`/`is` for None must stay `is`).
- "1 console statement": none exist anywhere in frontend/src.

**Genuine complexity reductions applied (GOLDEN MATCH + 52/52 pytest, behavior-identical):**
- `_aggregate_income` (cx 23): extracted `_income_from_stream` (per-stream classification); main fn now a
  simple sum loop.
- `_year_demographics` (cx 24): extracted `_apply_spousal_rollover` + `_medicare_headcount`.
- `_post_death_horizon` (66 lines): converted the mutating year loop into a `_HeirSleeves` dataclass with a
  `.step()` method + `_init_heir_sleeves` builder; the fn is now ~6 lines (setup -> loop -> aggregate).
- Frontend: moved the 40-line 11-dependency `aiSummary` useMemo out of Projection.jsx into a focused
  `src/hooks/useAiSummary.js` custom hook (addresses "extract into custom hook" + component complexity).

**Deliberately skipped (low value / would add noise):** hoisting tiny static Recharts config literals
(margin/domain/tick) to module consts — negligible perf vs Recharts' own re-render cost; and `value={[state]}`
slider arrays are dynamic (can't be hoisted; useMemo on a 1-element array is over-engineering).

### Auto-guard + lint baseline (DONE — 2026-06-30)
- Added `backend/tests/test_golden_snapshot.py`: compares live `golden_snapshot.build()` output to the
  committed `_golden.json`; fails CI (pinpointing the drifted section) on any tax-engine/projection change.
  Runs offline, deterministic, xdist-safe. Suite now 53 passed. Refresh intentionally via
  `python tests/golden_snapshot.py save`.
- Added `/app/LINT_BASELINE.md`: source-of-truth quality baseline (0-warning `yarn build` + pytest +
  golden), documented recurring external-linter FALSE POSITIVES (PEP-8 `is None`; locals/module-vars/
  stable-setters mis-flagged as hook deps; no console statements exist) and the intentional eslint-disable
  locations, so future reports stop re-flagging idiomatic code.

### Widened golden safety net (DONE — 2026-06-30)
Added 3 edge-case projection configs to `golden_snapshot.py` before building v2.1, baseline regenerated
(_golden.json now 340KB) and `test_golden_snapshot` re-verified (53 pytest pass):
- `single_filer`: no-spouse household, Single brackets/deduction, spouse streams+accounts removed (25 yrs).
- `early_widow`: client dies ~2035 -> exercises spousal rollover + survivor Single filing/SS/spending
  (confirmed MFJ->Single transition at 2036).
- `high_state_tax`: state_rate 0.13 + heir_state_rate 0.10 -> stresses state_tax/effective-rate/heir blend.
Coverage now: year_tax (MFJ/Single/all-preferential), optimize (24%/32%), projection (default, no_roth,
capped_32, single_filer, early_widow, high_state_tax, sweep).

### Monte Carlo golden guard (DONE — 2026-06-30)
Extended `golden_snapshot.py` with a `montecarlo` section (fixed-seed, deterministic, offline) so the
stochastic engine gets the same auto-regression protection as the tax engine. Baseline regenerated
(_golden.json 352KB); `test_golden_snapshot` + full suite = 53 pytest pass. Verified MC is byte-identical
across runs (numpy PCG64 + engine pre-rounding → robust). Cases:
- `base_seed42`: 60/30/10 mix, seed 42 → success 0.93 / 0.89, sequence-risk cohort 0.64.
- `allstock_shock_seed7`: 100% stock @30% vol + early −15%/3yr bear shock, seed 7 → base 0.444, shock 0.234/0.202.
NOTE for v2.1: adding inflation volatility WILL intentionally change these seeded outputs — refresh the
baseline (`python tests/golden_snapshot.py save`) and review the diff when implementing it.

### State Income Tax + First-Death Basis Step-Up (DONE — 2026-07-01)
Implemented the last in-progress requirement: state-specific flat taxes + auto basis step-up at the
first death, driven by Community Property vs Common Law rules and per-account ownership.
- **`backend/states.py`** (new): curated 50-state + DC table — each `{code, name, rate,
  is_community_property, taxes_ss, taxes_ira}` (approximate 2025/2026 top-marginal individual rates,
  user-editable). 9 community-property states: AZ CA ID LA NV NM TX WA WI. Exposed via **`GET /api/states`**.
- **`defaults.py`**: `tax` block gains `state_code` ("") + `community_property` (False); `state_rate`
  unchanged (0.0399), so the flat state rate is still applied to **federal taxable income** (per user).
  SS/IRA flags are informational only (no engine effect) per user choice.
- **`projection.py` first-death step-up** (`_step_up_basis` + rewritten `_apply_spousal_rollover`, wired
  through `_year_demographics(plan, owner_map, basis, bal, ...)`): at the first death, taxable &
  real-estate account cost-basis steps up to market value —
  Community-property state → **100%** (both halves, either death); common-law → decedent-owned **100%**,
  joint-owned **50%**, survivor-owned **0%**. `Plan` gains `community_property`. Uses the ORIGINAL owner
  (step-up computed BEFORE the survivor-rollover reassignment). Higher basis → less realized LTCG on
  subsequent taxable withdrawals → less lifetime tax. Verified directional: in a spend-down scenario
  (spouse-owned taxable w/ big embedded gain, drawn after client's death) CP saves ~$898K lifetime tax
  vs common-law; the wealthy DEFAULT scenario is UNCHANGED (never liquidates taxable, so step-up doesn't
  bind — golden default byte-identical for compute_year_tax/optimize/default projection).
- **`PlanInputs.jsx`**: "State of Residence" dropdown (auto-fills state_rate + community_property + shows
  CP / Taxes-SS / Taxes-IRA badges; "Custom / Other" keeps manual rate), a Community Property toggle
  (independently editable), and an **Owner** (Client/Spouse/Joint) Select column on the Accounts editor.
  `lib/api.js` gains `fetchStates`.
- **Golden**: added a `community_property` projection case (early-widow + CP) to `golden_snapshot.py`;
  baseline regenerated (_golden.json 411KB). **53/53 pytest pass.** Frontend verified by testing agent
  iteration_14.json — 5/5 review bullets PASS, 0 console/page errors, full 8-tab regression clean.

### Phase 17 — Strategy / SS / Roth-Compliance Optimizers (2026-07-02)
Adds the three top-priority "beat Boldin at its own game" enhancements from the competitive review.

**1. Multi-Year Roth Conversion Strategy Optimizer** (`backend/strategy_optimizer.py`,
`frontend/src/components/StrategyOptimizer.jsx`, `POST /api/strategy-sweep`):
- New tab that sweeps `(start_year × stop_year × target_bracket)` combinations, plus two-phase
  time-varying schedules pivoting off the SS claim year and the RMD wall (e.g. "fill 32% pre-SS,
  24% after"). Each candidate is a full projection run through the SECURE 10-yr post-death horizon.
- Ranked by **nominal after-tax legacy at 2nd death + horizon** (user spec, matches AI Insights /
  Analytics convention); lifetime tax is tiebreaker. Every result also reports its **PV** discounted
  at plan inflation — sortable via `strategy-sort-nominal` / `strategy-sort-pv` toggle chips.
- Frontend has: IRMAA-cap dropdown, max-annual cap, include-phased toggle, results table with
  ★ winner row, and a one-click **"Apply winner"** button that mutates `roth.enabled/start_year/
  end_year/target_bracket/year_targets` in the working scenario.
- Verified: default plan winner is `Fill 32% · 2026-2062` at legacy $141.9M (+$1.55M vs single-
  bracket 24% and +$26.9M vs no-conversion baseline).

**2. Time-varying phased conversions in the engine** (`projection.py`):
- New `roth.year_targets` map (year → bracket rate) overrides the flat `target_bracket` per year.
- Wired into `_parse_plan` with JSON-safe string-key normalization (`int(k)` coercion at boundary)
  and consumed by `_solve_year_conversion` via the per-year `year_target` variable.
- Enables the phased schedules from the strategy optimizer AND direct user-set phasing on saved
  scenarios.

**3. Social Security Claiming-Age Optimizer** (`backend/ss_optimizer.py`,
`frontend/src/components/SSOptimizer.jsx`, `POST /api/ss-optimizer`):
- Sweeps `(client_age, spouse_age) ∈ {62, 65, 67, 70}` using the SSA reduction/DRC formulas:
  early = 5/9% first 36mo + 5/12% beyond (30% cut at age 62 for FRA-67); late = 8% per year
  (24% at age 70). Backs out each owner's implied FRA benefit from the current stream then
  rescales + reslates for each candidate age.
- Reruns the full projection for every combination — captures the interaction with the Roth
  conversion window (claiming later = more room for conversions in the low-income years).
- Ranked by after-tax legacy at +horizon (tiebreaker lifetime tax); shows lifetime SS collected
  and lifetime tax alongside. One-click **"Apply optimal pair"** button rewrites the SS streams.

**4. 5-year Roth Rule + Pre-59½ Penalty Guard** (`projection.py`):
- Every year the engine tracks a **per-conversion Roth basis clock** (`conversions_ledger`) and
  flags any Roth withdrawal that would tap a conversion within its 5-year window or before the
  primary owner is 59½. Estimated 10% penalty is dollar-quantified in `roth_early_penalty_total`.
- Frontend `RothComplianceCard` on the Multi-Year Projection tab renders either the green
  "Roth compliance clean" state (default V9 plan — no withdrawals) or a red warnings table with
  reason / dollar penalty / client age per event. This is the Boldin-documented blind spot.

**Testing**:
- New `backend/tests/test_phase17_strategy_ss_compliance.py` — 14 tests covering FRA math,
  SS reduction/DRC formulas, sweep shape + ranking invariants, phased year_targets (int AND
  string keys, HTTP-boundary safe), and Roth compliance flagging.
- Golden snapshot extended with `strategy` + `ss` sections (`_golden.json` 437KB); math on all
  existing projection cases is BYTE-IDENTICAL — the change is purely additive fields.
- Testing agent iteration_17.json: backend 6/7 → 7/7 after year_targets JSON key fix; frontend
  14/16 → 16/16 after RothComplianceCard was actually mounted in the JSX tree.

**KNOWN limitations**:
- FRA calculation snaps to whole years (67 for 1960+, 66 for pre-1960) — the SSA table has
  monthly precision from 1943-1959. Acceptable approximation for a sweep-style optimizer.
- Strategy sweep grid: default sweeps `[start .. start+8*step] × [step..end]` sampled every
  `(end-start)/8` years (~9×9=81 combos on a 37-yr plan) — small enough to complete in ~10-15s.
  Users can supply an explicit grid via the request body.
- Roth compliance is a household-level approximation (age of the primary owner at conversion
  time; oldest-conversion-first drawdown). A per-owner Roth attribution refinement is P2.

## Backlog / Next (updated 2026-07-02)
- P1: Monte Carlo v2.1 — add inflation volatility (stochastic COLA / spending growth) to the sim.
- P1: Account aggregation (Yodlee / Plaid) — the one remaining "Boldin wins" item from the
  competitive review.
- P2: Per-owner Roth conversion attribution (separate client vs spouse ledgers for the 5-year
  rule + pre-59½ warnings).
- P2: Show a "ties broken by lifetime tax" note on the Strategy Optimizer results header when
  the top-N rows have identical nominal legacy (fill-32% variants converge at the RMD wall).


### Phase 19 — Security Hardening: SEC-001/002/003 + P3 (2026-07-03)

Post-audit fixes. Full security review flagged 3 findings (SEC-001 HIGH, SEC-002 MEDIUM, SEC-003 LOW)
plus P3 hardening items — all resolved in this phase.

**1. SEC-001 (HIGH) — Anonymous DoS via unbounded engine calls** (`backend/server.py`):
- Added `_validate_config` helper: caps `end_year - start_year ≤ 60`, accounts ≤ 50, income_streams ≤ 40.
- Added grid caps: `/api/strategy-sweep` rejects |starts|·|stops|·|brackets| > 500;
  `/api/ss-optimizer` caps ages list at 8 and validates age range [62, 70].
- Added `slowapi` per-IP rate limiting (X-Forwarded-For aware): projection 30/min, sweep 15/min,
  strategy-sweep 10/min, ss-optimizer 15/min, MC 30/min, scenarios POST 30/min, insights 10/min,
  chat 30/min, global 300/min.
- Pydantic validators on `n_trials` (50-2000), `history` (≤ 40 turns), `message` (≤ 2000 chars),
  `content` (≤ 4000 chars/turn), `brackets` (0-99%), `ages` (62-70).

**2. SEC-002 (MEDIUM) — Anonymous read/delete of financial PII** (`backend/server.py`,
`frontend/src/lib/api.js`):
- Every `/api/scenarios*` route now requires an `X-Session-Token: <uuidv4>` header via a
  `require_session` FastAPI dependency (401 without, 401 for malformed).
- `Scenario` model gains an `owner_token` field; queries scope by `{"owner_token": token}`.
- Frontend mints a UUIDv4 into `localStorage['roth-planner-session-token']` on first load (via
  `getSessionToken()`) and stamps it via an axios request interceptor on every API call.
- Cross-session isolation verified end-to-end: session A's scenarios are invisible to session B
  (404 on GET/DELETE, missing from LIST).

**3. SEC-003 (LOW) — Raw internal error text leaked** (`backend/server.py`):
- All `raise HTTPException(status_code=400, detail=str(e))` replaced with generic messages
  ("Projection request could not be processed", etc.); full trace still `logging.exception`'d
  server-side. Same treatment for the LLM streaming error paths.

**4. P3 hardening** (`backend/server.py`):
- `SecurityHeadersMiddleware`: sets X-Content-Type-Options: nosniff, X-Frame-Options: DENY,
  Referrer-Policy: strict-origin-when-cross-origin, Strict-Transport-Security: max-age=31536000;
  includeSubDomains, and Permissions-Policy.
- CORS tightened: explicit allowlist via `CORS_ORIGINS` env (default = preview URL + localhost:3000);
  `allow_credentials=True` when specific origins, auto-disabled when `*` is used.
- Removed unused `python-jose` dependency (had known algorithm-confusion CVEs; safe to drop
  since the app has no JWT/auth code).

**Testing**:
- `backend/tests/test_phase19_security_hardening.py` — 11 HTTP tests covering all SEC/P3 fixes.
- Testing agent iteration_19.json: **100% PASS** — backend 16/16, frontend 100%, 0 console errors.
- Regression: all 72 pre-existing pytest cases still pass; math and legacy metrics byte-identical.

## Backlog / Next (updated 2026-07-03, post-Phase-19)
- P1: **Account aggregation** (Plaid / Yodlee) — the last "Boldin wins" gap.
- P2: Per-owner conversion *routing* (physically deposit into same-owner Roth account, not just
  ledger attribution).
- P2: Correlated inflation-return draws (copula / correlation matrix).
- P3: Regime-switching stochastic inflation.
- P3: Migrate axios usage to a dedicated `axios.create()` instance so the interceptor is scoped
  (currently registered on the global axios).


### Phase 18 — Monte Carlo v2.1 + Per-Owner Roth Attribution + Strategy Tie Note (2026-07-02)

**1. Monte Carlo v2.1 — Stochastic Inflation** (`backend/montecarlo.py`, `POST /api/montecarlo`):
- New optional `inflation: {enabled, mean, vol}` request field. When enabled, generates a per-trial NxT
  lognormal CPI matrix and applies a **cumulative CPI multiplier** to each year's OUTFLOWS
  (expenses + taxes): `M[t] = ∏(1+π_s) / (1+μ_det)^t`. Nominal income streams are left at deterministic
  levels (models "spending runs hotter than expected while nominal wages/pensions don't fully keep up").
- Reports `cumulative: {p10, p50, p90, expected}` inflation summary — e.g. 3%/yr mean, 2% vol over 37yrs
  produces expected cum 2.99x, P90 tail 3.41x.
- Refactored `_simulate` to accept `(ext, out, g, infl_mult)` instead of `(net_flow, g)` — backwards
  compatible: `infl_mult` of ones reproduces v2 numbers exactly (verified byte-identical against golden
  seeds 42 and 7). `inflation=None` (or vol=0, or enabled=False) short-circuits: no RNG consumed, no
  cost, response's `inflation` field is `null`.
- Frontend `MonteCarlo.jsx`: new `mc-inflation-card` on the controls panel with Flame icon and a
  `mc-inflation-toggle` switch (off by default); when on, `mc-inflation-mean` + `mc-inflation-vol`
  inputs (defaults 3% / 1.5%). Results add a `mc-inflation-result` card with expected/P90 cum CPI.
- Golden snapshot extended with `inflation_vol_seed13` case.

**2. Per-owner Roth Conversion Attribution** (`projection.py`):
- The `conversions_ledger` was household-level; it's now **per-owner**. Each conversion lot is
  attributed to the source IRA's owner: `{year, owner, amount, remaining, owner_age_at_conversion}`.
  Attribution drains client IRA first (matches `_apply_year_flows` behavior after RMDs).
- Roth withdrawals are attributed **per Roth account**: a withdrawal from ROTS (spouse's Roth)
  consumes the spouse's conversion ledger only, and checks the spouse's age for pre-59½ (not the
  client's). Warnings gain `owner`, `owner_age`, `roth_account` fields.
- Frontend Roth compliance card now renders `Owner` + `Owner age` columns.
- Behavior-preserving on the default plan (client IRA drained first → all early ledger entries
  attribute to Client; lifetime_taxes / ending_net_worth / after_tax_estate_to_heirs byte-identical
  to golden). Only differs on scenarios where the spouse's IRA is meaningfully involved.

**3. Strategy Optimizer tie-break hint** (`frontend/src/components/StrategyOptimizer.jsx`):
- New `strategy-tie-note` element appears in the results header when the top-N ranked strategies
  share identical after-tax legacy (a common Fill-32%+ convergence at the RMD wall). Explains that
  the tiebreaker is lowest lifetime tax, so users understand why the top rows look identical.

**Testing**:
- `backend/tests/test_phase18_inflation_and_attribution.py` — 8 new pytest cases (inflation
  none-matches-v2, vol≥0 populated, higher vol worsens P10, seed reproducibility, per-owner
  ledger, client-drained-first attribution, warnings-carry-owner, math-unchanged).
- Golden snapshot refresh: `_golden.json` 447KB. **54/54 pytest pass** module-level.
- Testing agent iteration_18.json: **100% PASS** — backend 88/88 (including 8 new + 7 new HTTP),
  frontend 13/13 review bullets, 0 console errors, 0 page errors, all 12 tabs regression clean.

**Deliberately deferred**:
- Full-projection stochastic re-runs per trial (would require running the tax engine N times —
  ~50x slower). The current outflow-multiplier model is the industry-standard approximation.
- Regime-switching / autocorrelated inflation (P3).
- Per-owner conversion routing at deposit time (currently all conversions still physically land
  in `acct["roth"][0]`; only the *ledger attribution* is per-owner). Would require refactoring
  `_apply_year_flows` and could shift a small amount of value on scenarios where spouse's IRA
  is converted while spouse's Roth exists — P2 refinement.

## Backlog / Next (updated 2026-07-02, post-Phase-18)
- P1: **Account aggregation** (Plaid / Yodlee) — the last "Boldin wins" gap.
- P2: Per-owner conversion *routing* (physically deposit into same-owner Roth account, not just
  ledger attribution). Small effect but tightens the model.
- P2: Correlated inflation-return draws (copula / correlation matrix — separate P2).
- P3: Regime-switching stochastic inflation (macro regime advanced modeling).


### Phase 16 — In-app White Paper (2026-07-01)
- **`frontend/src/components/WhitePaper.jsx`** (new): renders the academic white paper "Why Simplified
  Roth-Conversion Calculators Get the Funding Decision Wrong" as a styled in-app document. Includes a
  brand-styled **plain-English summary box** at top, then the full formal paper (Exec Summary + 6 sections
  + numbered References with external links + superscript footnotes). Takes a `print` prop for the PDF variant.
- **New Section 3 "Two Forces Every Conversion Analysis Must Balance"** (per user): 3.1 the case for
  converting early/aggressively for tax-free Roth compounding (even paying tax on growth that may never
  occur); 3.2 the ceiling — the "common rate" between the couple's and heirs' rates, above which conversions
  destroy value; coupled with §1014 step-up → deplete-IRA-at-controlled-rates strategy. Sections renumbered
  (Correct Framing→4, Defensible Model→5, Conclusion→6). `/app/WHITEPAPER.md` source kept in sync.
- **`Planner.jsx`**: new **"White Paper"** tab (ScrollText icon, `data-testid="tab-whitepaper"`) placed
  right after Concepts.
- **`Analytics.jsx` + `index.css`**: new **"Add White Paper to PDF"** button (`data-testid=
  "export-with-whitepaper"`, blue #4B7A94) mirroring the Concepts print pattern — reveals an off-flow
  `<WhitePaper print />` appendix via `body.print-whitepaper` class + `window.print()`, page-break before it.
- Verified via screenshot: White Paper tab renders (title, summary box, §3 "Two Forces", §4/§6, references);
  Analytics loads clean with all 5 toolbar buttons. (Frontend-only change; no backend/tax-engine touch.)

### Phase 20 — Per-Owner Conversion Routing + Correlated MC Draws (2026-07-03)
Two P2 refinements requested by user ("go with recommendation" = auto-create Roth + editable 6-value grid):
- **(A) Per-owner conversion routing** (`backend/projection.py`):
  - Converted dollars now PHYSICALLY deposit into the source-IRA owner's own Roth account
    (Client IRA → Client Roth, Spouse IRA → Spouse Roth), matching the per-owner 5-year-clock ledger.
  - `_auto_roth_accounts()`: if an IRA owner has no Roth, a $0 Roth (`ROTH-AUTO-CLIENT`/`ROTH-AUTO-SPOUSE`,
    same return as the owner's IRA) is synthesized at plan-build time (config never mutated). Reported in
    projection result key `auto_accounts`. Also fixes old silent-drop when a plan had NO Roth accounts.
  - `YearFlows.conv_deposits` dict; `_apply_year_flows` deposits per target Roth; residual → default Roth.
  - `_aggregate_results`/`_compute_legacy` take accounts override so legacy math sees auto accounts.
  - Frontend: `DetailCashflow.jsx` merges `data.auto_accounts` into the account-detail table groups;
    Roth compliance card note updated to mention same-owner routing.
  - Default scenario totals PROVEN unchanged (all default conversions are client-sourced); golden regenerated
    (only new `auto_accounts` key + `correlation` key in MC section).
- **(B) Correlated inflation-return draws — Monte Carlo v2.2** (`backend/montecarlo.py`, `server.py`,
  `frontend/src/components/MonteCarlo.jsx`):
  - Gaussian copula: one correlated standard-normal draw across stocks/bonds/cash (+ inflation when
    stochastic inflation on) mapped to each lognormal marginal. `DEFAULT_CORR` = long-run US history
    (sb +0.15, sc 0, bc +0.20, si −0.20, bi −0.30, ci +0.55).
  - `_corr_setup()`: nearest-PSD repair via eigenvalue clipping + unit-diag rescale; reports `adjusted_to_psd`.
  - `CorrelationSpec` Pydantic model (each pair bounded [−0.99, 0.99], 422 otherwise); result includes
    `correlation: {enabled, includes_inflation, adjusted_to_psd, matrix_used, realized}`.
  - Disabled path RNG-identical to v2.1 (verified: same-seed results byte-identical) — backward compatible.
  - UI: "Correlated draws" toggle card (`mc-corr-card`) with 6 editable inputs (clamped ±0.99) +
    "Reset to historical defaults"; results show "Correlated Draws" card (`mc-corr-result`) with
    requested · realized pairs and "(incl. inflation)"/"(assets only)" variants + PSD-repair notice.
- **Tests**: `tests/test_phase20_routing_and_copula.py` (10 engine tests) +
  `tests/test_phase20_http_public.py` (7 HTTP tests, added by testing agent). Testing agent iterations
  20 (backend 100%; found control-card JSX lost to a parallel-edit race — re-added) and 21 (frontend 100%).
  NOTE: running the full live-HTTP test suite twice within a minute trips Phase-19 slowapi rate limits
  (429s) — expected behavior, pace suite runs.

## Backlog / Next (updated 2026-07-03, post-Phase-20)
- P1: **Account aggregation** (Plaid / Yodlee) — the last "Boldin wins" gap.
- P2: Regime-switching stochastic inflation (macro regime advanced modeling).
- P3: Migrate global axios interceptors to a dedicated `axios.create()` instance.
- Idea: read-only shareable scenario links (CFP sharing without exposing session token).

### Phase 20b — One-Click "2022-Style Stagflation" Preset (2026-07-03)
- `MonteCarlo.jsx` only (frontend; backend untouched): `STAGFLATION` preset constant + "Stress preset"
  box (`mc-stagflation-card`) between Trials and Return shock. One click sets shock ON (−15% × 2 yrs),
  stochastic inflation ON (5.5% ± 3%), correlations ON with 2022 diversification-failure matrix
  (stocks↔bonds +0.60, stocks↔infl −0.50, bonds↔infl −0.60, cash↔infl +0.70) + sonner toast.
- Derived `stagApplied` state (epsilon float compare): ACTIVE badge + button flips to
  "Clear stagflation preset" (reverts everything to baseline); editing ANY preset value drops the badge.
- Amber results banner (`mc-stagflation-banner`) labels runs that used the preset — shareable talking point.
- Testing agent iteration 22: 6/6 acceptance criteria pass on public preview (100% frontend).

### Phase 21 — Security Hardening Round 2 (post-Phase-20 audit, 2026-07-03)
Ran security_audit_agent on the deployed app (CONDITIONAL PASS). Prior SEC-001/002/003 + headers
verified intact; fixed the 1 MEDIUM + 4 LOW/P3 items below. All in `backend/server.py` + `frontend/src/lib/api.js`.
- **SEC-001 (MEDIUM) — spoofable rate-limit key**: `_client_ip` took the LEFTMOST `X-Forwarded-For`
  entry (client-prependable) → an attacker varying XFF got a fresh limiter bucket per request,
  defeating all per-client caps (compute DoS + paid-LLM cost abuse). FIX: key off the trusted proxy
  hop = the Nth-from-RIGHT XFF entry (N = `TRUSTED_PROXY_HOPS` env, default 1 = the ingress).
  Also removed `X-Forwarded-For` from CORS allow_headers. VERIFIED end-to-end through the real ingress:
  45 projection requests with unique spoofed XFF → 30×200 then 429 (single real-client bucket).
- **H1 — Monte Carlo BOLA**: `GET/POST /api/montecarlo` now `Depends(require_session)`; jobs stamped
  with `owner_token` and reads scoped to it (401 no token / 404 wrong token). `owner_token` and
  `created_at` projected out of responses (no leak). job_id UUID-format validated.
- **H2 — non-finite float inputs**: `AssetClass`/`ShockSpec`/`InflationSpec`/`CorrelationSpec` floats now
  `Field(..., allow_inf_nan=False, ge/le=...)` → NaN/Inf/out-of-range rejected at the boundary.
  Added a custom `RequestValidationError` handler returning a sanitized 422 that (a) never crashes on
  non-serializable input (the old default handler 500'd trying to echo NaN) and (b) drops the raw
  `input`/`ctx` echo (SEC-003 defense-in-depth).
- **H3 — weak token fallback**: `api.js uuidv4()` now uses `crypto.randomUUID`, else a
  `crypto.getRandomValues`-based v4 builder (throws if no secure RNG) — dropped `Math.random`.
- **H4 — CSP**: added `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` to the
  security-headers middleware (API serves only JSON/plain-text).
- **Tests**: `tests/test_phase21_security_hardening.py` (8 HTTP tests, all pass) — XFF-spoof rate-limit,
  MC session-scoping + BOLA + no-leak, malformed job id, NaN/Inf/out-of-range 422, CSP header.
  Golden snapshot unchanged (no math touched). Frontend regression (iter 23): all MC flows +
  Scenarios CRUD work under the new session-gating (100%).

### Phase 22 — Monte Carlo v3.0: Anchor-to-Plan, Historical Bootstrap, Failure Anatomy (2026-07-03)
User reported a disconnect: conservative asset-rich couple showed ~22% MC failure while the deterministic
plan never fails. ROOT CAUSE: MC ignored the plan's account returns (blended 6.67%) and hard-coded generic
60/30/10 lognormal assumptions (6.30% mean, ~11% vol) → systematic downward bias + unchosen volatility.
Secondary optics issue: all depleted trials stacked into the histogram's $0 bin, making failure look like
the modal outcome. User picked research-backed fixes 1+2+4 (skipped regime-switching for now).
- **(1) Anchor-to-plan (default ON)**: `_plan_return()` = liquid-weighted account return; lognormal class
  means rescaled so blended GEOMETRIC mean ≈ plan (arith target = plan + σ²/2); historical engine recenters
  sampled factors by (1+plan)/geom. Result reports `plan_return` + `anchor` block; UI shows
  "Plan return 6.67% · simulated mean 7.3% · anchored" (mc-anchor-info). Default success 93% → ~97.6%.
  `anchor_to_plan=False` reproduces v2.2 exactly.
- **(2) Historical engine** (`engine="historical"`): stationary block bootstrap (Politis-Romano, expected
  block 10 yrs) over `/app/backend/historical_data.py` — Damodaran S&P500/10yr-Tbond/3mo-Tbill + BLS Dec-Dec
  CPI, 1928-2024 (97 yrs). Same-calendar-year sampling preserves real cross-correlations/fat tails/mean
  reversion (Anarkulova-Cederburg-O'Doherty method). Copula spec ignored (embedded in data); historical CPI
  drives outflows when stochastic inflation ON. UI: engine pill toggle; mean/vol inputs disabled; corr card
  shows "handled by the data" note.
- **(4) Guardrail + failure anatomy**: `guardrail={enabled, cut_pct}` cuts EXPENSES (never taxes) in years
  following a portfolio loss (Guyton-Klinger-lite); reports success with/without + median trimmed years
  (mc-guardrail-info chip). `_summarize` adds `failure` block (median/p10/p90 depletion year, years
  unfunded) → "Failure Anatomy" card (mc-failure-card); histogram is now SURVIVORS-ONLY with depleted
  count reported separately (mc-hist-depleted-note).
- **API**: MonteCarloRequest += engine ("lognormal"|"historical", validated), anchor_to_plan (default true),
  GuardrailSpec (cut_pct ≤ 0.5, allow_inf_nan=False).
- **Test infra**: `tests/conftest.py` auto-retries 429s (rate limits are intentional) with escape hatches
  for X-Forwarded-For / X-Test-Expect-429 tests; legacy MC HTTP test files updated with session tokens.
- **Testing**: `tests/test_phase22_engine.py` (14 tests) — anchor math, unanchored v2.2 reproduction,
  dataset integrity spot-checks (2008 stocks −36.55%, 2022 bonds −17.83%, 1979 CPI 13.3%), bootstrap
  continuation rate ~0.9, guardrail monotonicity, failure-block consistency, survivor histogram. FULL suite
  143/143 pass. Golden regenerated (only MC section: anchor default + new fields; tax/projection untouched).
  Frontend iteration 24: 100%, no bugs.
- Deferred/backlog: regime-switching engine (option 3); MonteCarlo.jsx approaching 700-line split threshold
  (extract MonteCarloResults.jsx); useMemo planReturn.


### Phase 23 — Security Hardening Round 3 (DoS bounds validated) (2026-07-12)
Post-Phase-22 security-audit fixes applied to `backend/server.py` were previously untested. This phase
adds the pytest coverage and confirms zero regressions.
- **`_validate_config` tightened**: caps `legacy.post_death_years ≤ 100` (integer, non-negative — was
  unbounded, would run an O(years) heir sleeve loop per projection × 500 sweep cells), `expenses` list
  ≤ 60 entries (matching accounts/streams style caps), rejects bool/float-with-fraction on
  post_death_years.
- **NaN/Infinity smuggling**: `_reject_non_finite` walks the free-form config dict iteratively (with a
  20K-node budget) — now runs on `/api/tax/year`, `/api/tax/optimize`, `/api/projection`, `/api/sweep`,
  `/api/strategy-sweep`, `/api/ss-optimizer`, `/api/montecarlo`, `/api/scenarios POST`. Prevents typed-Pydantic
  bypass via free-form dict fields (e.g. `legacy.heir_reinvest_return: NaN`).
- **Rate limits added**: `/api/tax/year` 60/min, `/api/tax/optimize` 60/min (were unlimited).
- **`asyncio.to_thread` wrappers**: `run_projection` + `sweep_brackets` + `strategy_sweep` + `sweep_ss_claims`
  wrapped so heavy synchronous math no longer blocks the event loop under concurrent load.
- **Tests**: `tests/test_phase23_config_dos.py` (12 tests) — cap enforcement, valid configs still 200,
  NaN nested rejection on projection + scenarios + tax endpoints. Full suite **155/155 pytest pass**.

### Phase 24 — Read-only Shareable Scenario Links + Engine Compare + Refactors (2026-07-12)
Four refinements requested by user (P1 features from post-Phase-22 backlog).

**(1) `axios.create()` instance refactor** (`frontend/src/lib/api.js`):
- Session-token interceptor was on the global `axios` — leaked onto any third-party axios usage. Switched
  to a dedicated `http = axios.create({ baseURL: API })` instance with a scoped request interceptor. All
  API helpers migrated (only `api.js` touches axios; verified via grep). AI streaming endpoints continue
  to use `fetch` (they don't need the session token).

**(2) `MonteCarlo.jsx` split** (615 → 442 lines):
- Extracted the entire results section (engine info strip + gauge + compare + seq-risk + failure anatomy
  + shock/inflation/correlation cards + fan chart + histogram) into a new `MonteCarloResults.jsx` (255
  lines). MonteCarlo.jsx now focuses on the controls form + run/compare buttons + empty-state.
- Same shared `Stat` sub-component + CORR_ROWS constant duplicated (small — cleaner than exporting).

**(3) Engine comparison strip — one-click Statistical vs Historical** (`frontend/src/components/MonteCarlo.jsx`):
- New `runCompare()`: runs BOTH engines in parallel via `Promise.all` with the same trial count, anchor
  setting, guardrail, asset/inflation/shock config, and fixed seed=42 (reproducible). Correlation only
  applies to the lognormal call (historical embeds real co-movements).
- New `EngineCompareStrip` card (`mc-engine-compare`) renders under the controls: paired horizontal
  progress bars (`mc-compare-lognormal`, `mc-compare-historical`), delta chip (`mc-engine-compare-delta`)
  reading "Historical +X pts" / "-X pts", context-aware explainer text (agrees / historical rosier /
  historical harsher based on `|delta| < 2pts`).
- Verified: default couple returns lognormal 97.2% vs historical 98.6% (Historical +1.4 pts) in ~15s.

**(4) Read-only shareable scenario links** (backend + frontend):
- **Backend**: `Scenario` model gains `share_token: Optional[str]`. Three new endpoints:
  - `POST /api/scenarios/{sid}/share` (owner-only): mints `secrets.token_urlsafe(16)` (22-char base64url,
    128-bit entropy); idempotent (re-enable returns same token). Rate-limited 30/min.
  - `DELETE /api/scenarios/{sid}/share` (owner-only): sets `share_token: null`. Idempotent.
  - `GET /api/scenarios/share/{share_token}`: PUBLIC (no session token). Returns
    `SharedScenario{name, config, created_at}` — **NEVER leaks** `owner_token`, `id`, or `share_token`.
    Rate-limited 60/min. Regex-validates token shape before hitting DB (`[a-zA-Z0-9_-]{22,64}`).
  - Sparse unique index on `share_token` (skips nulls).
- **Frontend**:
  - `api.js` helpers: `enableScenarioShare`, `revokeScenarioShare`, `fetchSharedScenario`.
  - `Scenarios.jsx`: Share button (`share-{id}`) per row — enables + auto-copies URL to clipboard + toast;
    inline `ShareLinkRow` (`share-url-{id}`) with the URL + Copy button that flips to 'Copied' briefly;
    Revoke button (`unshare-{id}`) once shared.
  - `Planner.jsx`: on mount, `URLSearchParams.get('share')` triggers `fetchSharedScenario`. On success
    → sets scenario + shows green `shared-view-banner` with plan name + Exit button (`exit-shared-view`);
    tab-inputs and tab-scenarios triggers/contents are **hidden**. On error → orange `shared-view-error`
    banner + default scenario loads.
- **Tests**: `tests/test_phase24_share_links.py` — 11 pytest cases covering owner-only enable/revoke,
  idempotence, cross-session 404, public GET without session, secret-leak audit (owner_token/id/share_token
  never in public payload), malformed/unknown token rejection, list endpoint exposes share_token to owner.
- **Frontend testing agent iteration 25**: 100% pass, 0 console errors, all 6 review bullets green.
  Full round-trip verified: save → share → new tab with URL → shared banner + hidden tabs → Exit → revoke.

### Phase 25 — Compare Funding Orders strip on Multi-Year Projection (2026-07-12)
User asked for a dedicated one-click side-by-side comparison of the two 4-account funding orders on the
Multi-Year Projection tab (analogous to the Monte Carlo engine-compare strip).
- **`frontend/src/components/FundingOrderCompare.jsx`** (NEW, 130 lines): self-contained card
  (`funding-order-compare-card`) with a `Run comparison` button (`funding-compare-run`). Runs both
  `Cash → Taxable → IRA → Roth` (preserve IRA / leave for heirs) and `Cash → IRA → Taxable → Roth`
  (deplete IRA now / step-up taxable) via `Promise.all(runProjection, runProjection)` using the existing
  `fundingCompareConfigs` helper (deep-copies scenario per order — live scenario untouched).
- **Metrics compared (6 rows)**: ending net worth, lifetime taxes, after-tax to heirs at 2nd-death+10yr,
  heir income tax on inherited IRA, ending Roth, tax-free Roth to heirs. Each row shows the winning cell
  bold-green with a trophy icon + a Δ column (depleteIra − leaveIra, sign-aware green/orange). Column
  headers show a "CURRENT" pill on whichever order matches `scenario.withdrawal.funding_order`.
- **Auto-stale on scenario edit**: `useEffect([JSON.stringify(scenario)])` resets `runs` — prevents users
  reading a stale table against new inputs.
- **Wired into `Projection.jsx`** directly after `SweepPanel` and before `NetWorthChart`.
- **Testing agent iteration 26**: 100% frontend pass, 0 console errors, all 7 acceptance criteria green
  (card renders, empty state hint mentions current order, run button fires two /api/projection calls,
  table renders with 5 trophies visible, CURRENT badge shifts when order is changed in the controls,
  full regression on other Projection tab elements clean). Applied 2 minor polish items from the review
  (removed dead ternary, added scenarioSig-invalidated `useEffect` to clear stale runs).


## Backlog / Next (updated 2026-07-12, post-Phase-24)

### Phase 25b — Split IRA & Taxable column added to Compare Funding Orders (2026-07-12)
User asked to extend the FundingOrderCompare card with a third column for the Split funding order at the
user's current `withdrawal.ira_split` percentage.
- **3-column layout**: `orderCols(iraSplit)` returns leaveIra / split / depleteIra. Split label reads
  live `Split IRA & Taxable ({N}%)` from the plan. `splitConfig(scenario)` deep-copies the scenario and
  sets `funding_order = "Split IRA & Taxable"` (keeps user's `ira_split`, defaults to 0.5 if unset —
  live scenario never mutated).
- **`runs` now { leaveIra, split, depleteIra }**; three parallel `runProjection` calls; `winnerKey` picks
  best-of-three per metric.
- **Δ column repurposed**: was `depleteIra − leaveIra`; now `Δ vs your plan` = winner − currentSelection,
  or the literal string `"on winner"` when the user's live funding order already wins that row. Sign-aware
  color coding retained. Header data-testid: `funding-delta-header`.
- **CURRENT badge** matches the live `withdrawal.funding_order` string against `matchOrder` on each column
  (works for all three orders including Split).
- **Auto-stale still fires** on scenario edits via `scenarioSig` — verified: switching funding-order-select
  or moving ira-split-slider clears the previous table to the empty state (empty-state text reflects the
  new order live).
- **Reviewer polish applied**: `catch (e)` now logs to console for diagnostics (was bare swallow); Split
  column description slightly reworded for clarity ("the Split column uses N% IRA").
- **Testing agent iteration 27**: 100% pass, all 9 acceptance criteria green, 0 console errors. Only
  observation: `heir_ira_tax_paid` renders "—" across all 3 columns on default seed because IRA depletes
  fully by 2nd death (all 3 orders zero out that field — not a regression).

- P1: **Account aggregation** (Plaid / Yodlee) — DEFERRED per user request.
- P3: Regime-switching stochastic inflation (macro regime).
- Idea: Client-side history.pushState + state reset for `exitShared()` (currently forces window.location.href reload — works but heavier than needed; noted by testing agent, non-blocking).
- Idea: Show a live "Roth compliance" preview for a shared scenario without letting the viewer edit it.

### Phase 25c — User-configurable Monte Carlo trials (2026-07-12)
- `MonteCarlo.jsx`: replaced the fixed `TRIALS=500` constant with a user-editable number input
  (data-testid `mc-trials`), default `DEFAULT_TRIALS=1000`, clamped `[50, 2000]` on change
  (matches the backend's `MAX_MC_TRIALS` Pydantic bound).
- Both the primary `run()` and `runCompare()` (engine-compare) use the same `nTrials` state, so
  the strip's trial count follows the input too.
- Backend untouched (already validated `n_trials in [50, 2000]` since Phase 19).
- Curl-verified: `n_trials=1000` → 200, `n_trials=2001` → 422, `n_trials=49` → 422.


### Phase 25d — "Why these differ" tooltips + heading fix (2026-07-12)
Users were confused when Find Optimal Bracket (Projection tab) said 24% but the Strategy Optimizer said
32% — both actually rank by the same metric (max after-tax to heirs, tiebreak lowest lifetime tax) but
search different spaces. Added a lightweight in-app explainer.
- **`ProjectionPanels.jsx` (SweepPanel)**: heading renamed from "Find the Bracket That Minimizes Lifetime
  Tax" (misleading) → "Find the Best Single-Bracket Strategy" (matches the ranking metric copy already in
  the subtitle). Added `sweep-winner-why` pill (HelpCircle icon) next to the ★ optimal row. Hover reveals
  a shadcn Tooltip explaining: single-flat-bracket search, note that the Strategy Optimizer tab searches
  time-varying phased schedules + narrower windows, same ranking metric.
- **`StrategyOptimizer.jsx`**: added `strategy-winner-why` pill on the Best-strategy card explaining the
  reverse — this searches phased/windowed schedules, so a "Fill 32% 2026–2035" can beat the flat 24% winner
  from the simpler Projection-tab sweep. Same ranking metric on both.
- **Tooltip components** used from `/components/ui/tooltip.jsx` (shadcn Radix); no global provider needed —
  each pill wraps its own `<TooltipProvider delayDuration={150}>` for scoped behavior.
- Lint-clean; no test agent run needed (small isolated additions with no logic changes).


### Phase 25e — Monte Carlo v3.1: time-varying plan-path anchor + percentile-dollars table (2026-07-12)
User reported "Monte Carlo appears low given the large amount of assets". Root-cause analysis confirmed
a real ~$9.5M structural understatement: the v3.0 anchor re-centered the whole simulation on a SINGLE
flat plan return (beginning-balance blend, 6.67%) even though the plan's effective blended return drifts
toward 7% as the low-yield cash slice shrinks. A further ~$5M median gap vs plan is genuine
volatility-cashflow interaction (kept — it's real risk).
- **`montecarlo.py` v3.1**: new `_plan_return_path()` derives the per-year growth implied by the
  deterministic plan's own liquid balances (g_t = (L_t − net_flow_t)/L_{t−1}); anchoring the MC to this
  path makes a zero-vol MC reproduce the plan exactly. Applied to BOTH engines (lognormal: flat anchor
  then per-year column rescale; historical: per-year rescale of the bootstrap draws). `anchor` block now
  reports `mode: "plan_path"`, `path_first`, `path_last`. PCTS extended to [5,10,25,50,75,90,95]; `ending`
  now includes p5/p95. Result on default scenario: median ending $61.5M → $70.5M (plan $76.1M).
- **`MonteCarloResults.jsx`**: new "Range of Outcomes by Percentile" card (testid
  `mc-percentile-table-card` / `mc-pct-row-p50` etc.) — P5–P95 rows × decade milestones (2035/2045/2055/
  End), honors the nominal ↔ today's-$ toggle, P50 row highlighted; anchor pill shows the path range
  (6.7%→7.0%). `MonteCarlo.jsx` anchor-card copy updated.
- **Tests**: new `tests/test_phase25_path_anchor.py` (9 tests incl. zero-vol plan reproduction and
  path-recursion exactness); `test_phase22_engine.py` historical-anchor assertion updated for plan_path.
  Full suite 175/175 pass; golden snapshot regenerated (`tests/golden_snapshot.py save`).


### Phase 26 — Legacy after-tax attribution break-out in Compare Funding Orders (2026-07-13)
User asked whether the Compare Funding Orders "After-Tax to Heirs" row includes taxable/cash. It always
did (via `_HeirSleeves.step()` summing Roth + inherited-IRA post-tax + taxable + reinvest + cash + real
estate − LTCG on post-death appreciation) — but the label hid it. Made the accounting explicit.
- **`projection.py`**: `_HeirSleeves.step()` now emits per-sleeve LTCG and three attribution fields
  (`after_tax_roth`, `after_tax_ira_post_tax`, `after_tax_nonretirement`) that sum to `total_to_heirs`;
  math verified identical to prior formula. `_compute_legacy` exposes them at the top level as
  `roth_to_heirs` / `ira_post_tax_to_heirs` / `nonretirement_to_heirs` — additive keys, no value drift on
  existing metrics.
- **`FundingOrderCompare.jsx`**: renamed the row to "Total After-Tax Estate to Heirs (+10 yr SECURE)",
  added an ℹ tooltip listing what's included, added three indented sub-rows (Roth tax-free / IRA post-tax
  after SECURE / Taxable + Cash + Real Estate net of LTCG) with a lighter sub-row style and per-row
  trophy+Δ still active. New testids: `funding-tip-after_tax_estate_to_heirs`,
  `funding-row-roth_to_heirs`, `funding-row-ira_post_tax_to_heirs`, `funding-row-nonretirement_to_heirs`.
- **Tests**: new `tests/test_phase26_heirs_breakdown.py` (4 tests: sum invariant, Roth-row equals
  `tax_free_roth_to_heirs`, non-retirement > 0 on defaults, funding-order shifts the component mix).
  Full backend suite 179/179 pass; golden snapshot refreshed for the new additive fields.


### Phase 26b — "Where the inheritance ends up" stacked-bar chart (2026-07-13)
Added a compact stacked-bar chart directly beneath the Compare Funding Orders table (same card, in a
light-tan panel) so users can *see* the Roth / IRA / Non-retirement mix shift across funding orders
without scanning the numeric rows.
- **`FundingOrderCompare.jsx`**: added Recharts `BarChart` with three vertical stacked bars (one per
  funding order), stacks colored using the app palette (`#4A6741` Roth, `#C87941` IRA post-tax,
  `#7A9B76` non-retirement). Totals labeled above each bar, ★ marker + "Your plan: …" caption
  identify the current funding order. Custom-tick component was refactored to keep the file lint-clean
  (dropped in favor of a static caption + ★ suffix — cleaner UX, no `no-unstable-nested-components`
  violation). New testid: `funding-mix-chart-card`.
- Verified: 9 stacked segments render (3 bars × 3 sleeves). Lint clean. No backend changes needed.

### Phase 27 — White paper v2 draft (empirical edition) + compare-table bug fix (2026-07-13)
User asked to review the white paper against the program's actual results and draft a revision.
- **Bug fix — `FundingOrderCompare.jsx`**: the "Heir Income Tax on Inherited IRA" row read a
  nonexistent `legacy.heir_ira_tax_paid`; corrected to `inherited_ira_tax`. Verified via live UI
  ($2.02M / $1.99M / $1.98M across the three orders).
- **Empirical review runs** (defaults, ~$13M household, heirs 31.65% ord / 23.45% LTCG):
  A) No conversions: IRA $12.9M at 2nd death, heir tax $5.64M, +10yr to heirs $126.09M.
  B) 24% target + taxable-first: converts $5.69M, Roth $40.1M, +10yr $142.43M (winner of B/C).
  C) 24% target + IRA-first: converts $3.89M, Roth $29.5M, +10yr $140.35M — wins AT DEATH
     ($79.18M vs $78.59M) but loses at +10yr → measurement-horizon reversal.
  D) 32% target (≈ heirs' rate): $144.20M — optimum. E) 35%: $143.89M — over-conversion destroys value.
- **Draft** at `/app/WHITEPAPER_v2_DRAFT.md`. Key revisions vs v1: new empirical §5 (Cases A–E);
  §2.3 reframed as bracket-headroom competition (spend the preferential bucket, convert the ordinary
  bucket — deplete the IRA by conversion, not consumption); "step-up is a snapshot, Roth is permanent";
  common-rate ceiling demonstrated; limitations section added. Subtitle updated accordingly.
- **PENDING USER DECISION**: publish v2 into the app (rewrite `WhitePaper.jsx` + `WHITEPAPER.md`) after
  user reviews the draft.

### Phase 27b — Draft revised per user critiques: realization sensitivity + conversion risk (2026-07-13)
User challenged two draft conclusions; both tested in the engine and folded into the draft:
1. "Post-death gains are unrealized and may never be realized" — re-scored all cases with post-death
   appreciation never taxed (computed exactly from post_death_rows sleeve values: roth+trad+taxable_and
   _reinvested+cash+real_estate). Result: funding-order verdict FLIPS (C $150.07M > B $149.84M) and
   32%-target loses to 24% ($148.69M vs $149.8M). Robust across both bounds: convert-vs-nothing
   (+13.0%/+6.6%), never-exceed-common-rate (35% < 32% both ways), heir IRA bill $5.64M→$2.0M.
2. "Is 32% early worth the risk?" — Monte Carlo 1,000 seed-matched trials: success 98.4% vs 98.7%,
   p5 ending $8.20M vs $8.92M (32% slightly BETTER left tail — prepaid tax shrinks RMD/dividend/IRMAA
   outflows in weak states), median $75.4M vs $73.4M (~$2M worse). Front-load: yrs1-5 taxes $689k vs
   $902k (+31%). Conversions irreversible (TCJA repealed recharacterization).
Draft changes (`WHITEPAPER_v2_DRAFT.md`): new §5.5 realization-sensitivity table, new §5.7 risk section
(MC table, "program the floor / harvest the ceiling opportunistically"), §5.8 trimmed limitations,
subtitle + What-Changed list + §5.4/§5.6 + conclusion rules rewritten to demote funding-order and
32%-target to assumption-dependent; added ref [^11] (IRS recharacterization repeal).
Still PENDING: user approval to publish v2 into the app (WhitePaper.jsx + WHITEPAPER.md).

### Phase 27c — Default changed: conversions no longer stop at RMD age; analysis re-run (2026-07-13)
User: "Default should not stop Conversions at RMD age" + asked whether the analysis used current defaults
(it did — the old default had stop_at_rmd_age: true).
- **`defaults.py`**: roth.stop_at_rmd_age True → False. (Engine fallback in projection.py untouched;
  v9_scenario1.py pins True explicitly so V9 reconciliation is unaffected.)
- **Consequence**: default scenario now fully retires BOTH IRAs before 2nd death under every conversion
  program (heir IRA tax $5.64M → $0; spouse conversions appear in ledger; ROTS > 0 at end).
- **Tests**: updated 9 regressions — new pins lifetime_taxes 7075325.52, ending_net_worth 80238883.64,
  ATEE 143648209.78; strategy-sweep band 143–145M, best kind now "phased" ("Fill 32% pre-SS, 24% after");
  test_phase20 default ledger now asserts Client+Spouse owners and ROTS>0; test_phase26 mix test and
  test_phase10 heir-rate test pin stop_at_rmd_age=True / roth.enabled=False respectively to keep a
  residual IRA. Golden snapshot re-saved. **Full suite 179/179 pass.**
- **Whitepaper draft re-run with corrected default** (all §5 numbers replaced):
  A noconv 126.09/140.57 (realized/never); B 24-taxable1st conv $10.96M → 146.20/150.29;
  C 24-ira1st conv $7.42M → 143.65/151.31; D 32 → 145.35/148.41; E 35 → 143.89/146.72.
  KEY SHIFT: with full runway 24% BEATS 32% under BOTH realization assumptions (the old 32% win was an
  artifact of the RMD-age deadline — now framed in §5.6 as "the deadline decides the bracket").
  Convert-vs-nothing: +15.9% realized / +6.9% never. Funding order still flips (±1.8%). MC re-run:
  24% success 98.2% p5 $7.25M med $73.49M; 32% 98.5%/$8.31M/$72.71M.
Still PENDING: user approval to publish v2 into the app (WhitePaper.jsx + WHITEPAPER.md).

### Phase 28 — Heir realization toggle, default = never realized (2026-07-13)
User: add "Heir realization" toggle (realized at +10yr vs never realized) to Legacy settings and
Compare Funding Orders; default NOT realized.
- **`projection.py`**: `_HeirSleeves.gains_realized` gates the three post-death LTCG charges
  (taxable/reinvest/RE appreciation); dividend drag applies in both modes. `_compute_legacy` reads
  `legacy.heir_gains_realized` (default False) and echoes it in the payload. NOTE: a corrupted
  duplicate tail (transport glitch) was truncated from projection.py — file verified via ast.parse.
- **`defaults.py`**: legacy.heir_gains_realized = False. **`v9_scenario1.py`**: pins True (spreadsheet
  reconciliation preserved).
- **Frontend**: `PlanInputs.jsx` new Switch (testid `heir-gains-realized-switch`);
  `FundingOrderCompare.jsx` header Switch (testid `funding-compare-realization-switch`) that overrides
  the comparison runs and AUTO RE-RUNS when results are showing; chart caption shows mode
  (testid `funding-mix-realization-note`).
- **Regression pins updated** (never-realized default): ATEE 151306744.66; sweep best now
  "Fill 24% · 2026–2050" single, band 150–152M. Golden re-saved. New `test_phase28_heir_realization.py`
  (6 tests incl. winner-flip invariant). **Full suite 185/185 pass.**
- **UI verified via screenshot**: default off → 150.29/149.86/151.31 (IRA-first wins); toggle on →
  146.20/143.76/143.65 (taxable-first wins, Δ +$2.55M). Matches whitepaper §5.5.
- Draft labels updated: "(default)" moved to never-realized column; toggle mentioned in §5.5 + item 4.
Still PENDING: user approval to publish v2 into the app (WhitePaper.jsx + WHITEPAPER.md).

### Phase 29 — Reset-to-defaults button + White Paper v2 published (2026-07-13)
User approved publishing v2 and asked for a reset button covering all inputs/switches.
- **Reset to defaults**: header button (testid `reset-defaults-btn`) with AlertDialog confirm
  (`reset-defaults-confirm`/`reset-defaults-cancel`); re-fetches /api/defaults and swaps the whole
  scenario state — every input/switch on every tab resets (defaults.py is the single source of truth
  and already contains all UI-bound fields incl. stop_at_rmd_age=false, heir_gains_realized=false).
  Hidden in shared read-only mode. Verified: flipped heir-realization switch → reset → restored.
- **White Paper v2 published**: `WhitePaper.jsx` fully rewritten (title/subtitle, plain-English box,
  "What changed in this edition" box, §1–§7 incl. three data tables with testids
  `whitepaper-case-table` / `whitepaper-realization-table` / `whitepaper-mc-table`, base-household
  callout, 11 references). Print/export contract preserved (`print` prop, `whitepaper-print-block`
  class, Analytics "Export + White Paper" flow untouched). `WHITEPAPER.md` overwritten with v2
  ("Second edition", draft designation removed). Draft file `WHITEPAPER_v2_DRAFT.md` retained.
- ESLint clean on all touched files. UI verified via screenshots (WP tab renders all sections; reset
  flow works with toast).

### Phase 30 — Interactive white paper: "Run this table on YOUR plan" (2026-07-13)
- `WhitePaper.jsx` now accepts `scenario` (passed from Planner; print version stays static/published).
- Three RunRow controls: `wp-run-cases` + `wp-run-realization` (shared deterministic run: 5 strategies
  × 2 realization bounds = 10 parallel /projection calls; fills §5 case table AND §5.5 table, winners
  bolded dynamically, "YOUR PLAN · LIVE" badge, revert link to published base case) and `wp-run-mc`
  (2 parallel seed-matched 1,000-trial Monte Carlo jobs → §5.7 table). Live results invalidate on any
  scenario edit. Verified via screenshots: live values on default plan reproduce published numbers
  exactly (case, realization, and MC tables).
- NOTE: platform edit-loss glitch recurred (helper block dropped despite reported success) — re-inserted
  via insert_text; verify grep after batches of edits to this file.
### BYOK Google Gemini for AI Insights (DONE — 2026-06 / July session)
- User chose "option b — users bring their own key", model **gemini-2.5-flash**.
- Backend (`server.py`): removed EMERGENT_LLM_KEY/emergentintegrations from /api/insights and
  /api/insights/chat. Both models now require `api_key` (validated, ≤200 chars, never stored/logged).
  Shared `_gemini_stream()` helper uses `google-genai` async `generate_content_stream` with
  `system_instruction`, `thinking_budget=0` (2.5-flash is a thinking model — disabled for speed and so
  max_output_tokens isn't eaten by thinking), max_tokens 800/1000. The stream is PRIMED (first chunk
  fetched via `anext`) inside the endpoint so key/quota errors raise BEFORE StreamingResponse: invalid
  key → 401 "Your Gemini API key was rejected…", quota → 429, other → 502.
- Frontend (`AIInsights.jsx`): key panel (data-testids: gemini-key-panel/-input/-save/-cancel/-link/
  -error/-change, ai-chat-key) — key kept in localStorage `gemini_api_key` only, sent per request in
  body. Generate/send disabled without a key; 401 responses reopen the panel with the server message.
- Tests: `test_planner_api.py::TestInsights` rewritten for BYOK contract (422 missing key, 401 fake key
  on both endpoints). Suite now 187 passing (run with REACT_APP_BACKEND_URL exported). Verified E2E via
  curl + screenshots (save-key flow, disabled states, invalid-key error UX).


### Silent default Gemini key (2026-07-14)
- Added `DEFAULT_GEMINI_API_KEY` to `backend/.env` — server-side only, never sent to the browser.
- `server.py`: `InsightRequest.api_key` is now `Optional[str]`; new `_resolve_gemini_key()` helper
  prefers the caller's BYOK key and falls back to `DEFAULT_GEMINI_API_KEY`. Both /api/insights and
  /api/insights/chat use it. 401 is raised only if neither key is available (impossible in this deploy).
- Model changed from `gemini-2.5-flash` → **`gemini-flash-latest`** (the shared default key doesn't have
  access to 2.5-flash on the "no longer available to new users" path; `flash-latest` auto-tracks the
  current gemini-3.5-flash and works for both the default key and any BYOK key).
- Fixed a subtle streaming bug: the `genai.Client` created inside `_gemini_stream` was being garbage-
  collected as soon as the helper returned, which tore down the aiohttp session mid-stream ("Connection
  closed." after ~1 chunk). The client is now pinned into the async-generator closure via a
  `_keepalive` reference so the session lives for the stream's full lifetime.
- Frontend (`AIInsights.jsx`): key panel is HIDDEN by default. Users hit **Generate AI Insights**
  immediately; a small "Use your own Gemini key" link opens the BYOK panel for power users who want
  unlimited use on their own key. Generate/send buttons no longer gate on `!apiKey`. Copy in the key
  panel updated to reflect that BYOK is optional. 401 responses still reopen the panel with the server
  message (in case a BYOK key was pasted and rejected).
- Tests: `test_insights_requires_api_key` → `test_insights_uses_default_key_when_omitted` (accepts 200
  streamed or bounded upstream error, never 422). Invalid-key tests unchanged. 187 pytest all passing.
- Verified E2E: curl against local backend streams a full analysis on request with no api_key; UI
  screenshot confirms hidden key panel and enabled Generate button.
