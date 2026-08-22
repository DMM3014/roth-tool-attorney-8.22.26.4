# Roadmap / Backlog

## P0 backlog (blocked / deferred)
- None active.

## Deferred backlog (2026-02-18)
User has explicitly deferred the following action items — do NOT surface them again in `Next Action Items` unless the user asks:
- **State Move UI** in Plan Inputs — backend `state_move` logic is fully implemented and tested; UI to expose it is deferred.
- **QCD Line Item** in the income-streams UI — backend already models QCD via the `qcd_amount` field; explicit UI is deferred.
- **Configurable Trust Drag Parameters** on the Estate tab — advisors currently accept the built-in defaults (37% ord / 20% LTCG / 2% yield / 20% turnover); customization UI is deferred.
- **Per-Beneficiary Rate Overrides** for the trustee-planning note — deferred.
- **Compliance / Audit Trail** (SEC scenario edit-history & advisor action log) — deferred.
- **Trust-Bracket Modeling** — shipped 2026-02-18 as default engine behavior (not a toggle); no follow-up work required.

## P1 backlog
- **Account Aggregation (Plaid)** — user explicitly deferred. Stays in scope for future.

## P2 backlog
- Extend the projection loop 10 years past the second death so heirs' inherited-Roth compounding shows in the Detail/Cashflow tab.
- Funding-order sweep in the Optimizer (4th dimension: also test `Cash → IRA → Taxable → Roth` and `Split IRA & Taxable` across the existing grid).
- Add "Funding order in use" header on the Optimizer tab so users see which order every result uses.

## P3 backlog
- Regime-switching stochastic inflation (macro regime) for Monte Carlo v4.
- Full engine support for arbitrary N-phase year-by-year bracket schedules (currently 2-phase heuristic).
- **Refactor**: split `server.py` (now ~1650 lines) — extract workspace + scenario routers into dedicated modules under `backend/routes/`.


## Upcoming (from user sessions)
- P1: Paired A/B distribution for Monte Carlo — histogram + percentile table of pairwise delta (with − without conversions) on identical market seeds.
- ~~P1: Optimizer end-year sweep (horizon presets + economic-completion callout).~~ **SHIPPED 2026-06 Phase 56.**
- ~~P2: Net-to-heirs envelope bar chart under the Estate MC-rebasis picker.~~ **SHIPPED 2026-06 Phase 56.**
- ~~MC-rebasis stale auto-detect warning.~~ **SHIPPED 2026-06 Phase 56.**
- ~~Estate FET sensitivity grid (3×3 growth × death timing).~~ **SHIPPED 2026-06 Phase 56.**
- P1: Conversion Guardrail Tuning — let advisors soften the MC halt rule (pause one year instead of stopping permanently) and see conversion-distribution impact.
- P2: Statutory-Freeze Warning on Estate tab for IL/MA/MD/MN/OR/VT (exclusion frozen, no inflation indexing).
- ~~P2: Auto-Run on Preset — after a Plan Inputs goal-preset click, offer "Run sweep now" toast jumping to Strategy Optimizer.~~ **SHIPPED 2026-02-15 as Phase 52.**
- P2: Account Aggregation (Plaid).
- P3: Compliance/audit trail (scenario edit history, advisor actions).
- P3: State Move UI completion.
- P3: Configurable trust drag parameters & per-beneficiary rate overrides.
- P3: Cover Letter Personalization (short custom advisor note on Client Report).
- ~~P3: Bracket Viz on Client Report — snapshot the visualizer at 3 key years as a print page.~~ **SHIPPED 2026-06-19 (default ON + advisor toggle).**
- ~~Beneficiary tax-rate sensitivity on the legacy page (low / middle / high heir marginal rate).~~ **SHIPPED 2026-06-19 as its own print page + `/api/legacy/heir-rate-sensitivity`.**

## Shipped 2026-06-19 (advisor punch-list, second half)
- ~~Presentation funding-order narrative reworked as a trade-off (no winner).~~ SHIPPED.
- ~~Cash Flow Surplus/(Shortfall) column showing negatives.~~ SHIPPED (reads engine `cashflow.surplus`).
- ~~Revised "current taxes are real" statement across Presentation / White Paper / strategy explainer.~~ SHIPPED.
- ~~Client Report PDF squished text.~~ SHIPPED — pdf.js never distorts aspect ratio; Income&Expenses/Legacy/Appendix split across multiple print pages.

## Next candidates
- P2: Cover-letter personalization (short custom advisor note on the Client Report cover).
- P2: Presentation "Recommendations & caveats" page is ~6% taller than the printable box (renders at a 94% uniform scale) — split it if advisors want it pixel-exact.
- P2: Beneficiary rate band on the Presentation deck (currently Client Report only).

## Shipped 2026-06-20
- ~~Strategy Optimizer "Different from best/leader" chip stuck on + no reaction to Goal Presets.~~ SHIPPED (structural comparison + stale-sweep banner).
- ~~Winner→Leader vocabulary across all visible text/buttons.~~ SHIPPED.
- ~~Split the deck's Recommendations & caveats page.~~ SHIPPED.
- ~~Longevity trade-off deck page (funding order at −5/+5/+10/+20 survivor years).~~ SHIPPED.
- ~~Beneficiary tax-rate band on the Presentation deck.~~ SHIPPED.

## Next candidates
- P2: Cover-letter personalization (short custom advisor note on the Client Report cover).
- P2: Longevity grid as a small chart (leader crossover point) rather than a table only.
- P2: Let the advisor choose the longevity deltas / beneficiary rates shown (currently fixed ladders).
- P3: Compliance/audit trail — scenario edit history, advisor actions.

## Shipped 2026-06-20 (later)
- ~~Goal presets deselecting when a sweep switch changes.~~ SHIPPED (amber "Modified" state).
- ~~Convert-or-Skip: model net worth at 2nd death AND at the end of the SECURE-10 window.~~ SHIPPED (two-milestone card + reconciling bridge).
- ~~Convert-or-Skip broken JSX rendering ") : (" as text.~~ FIXED.
- ~~`(r.home || 0)` never resolved (field is `real_estate`) in total-wealth figures.~~ FIXED where the label includes the home.

## Next candidates
- P2: Deck wealth page caption says "total household wealth" but the chart inside is the PRESENT-VALUE net worth chart — reconcile the caption or add the nominal chart.
- P2: Crossover chart for the longevity grid; advisor-selectable longevity / beneficiary ladders.
- P2: Cover-letter personalization on the Client Report cover.
