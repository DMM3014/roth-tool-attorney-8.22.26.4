# Excel Model Review — "Estate Plan 8.11.26.2.xlsm" vs Web Baseline (June 2026)

Narrative-only deliverable requested by user (no code). Full text delivered in chat.
Key findings summary retained here for continuity.

## Excel model estate architecture (as uploaded)
- `Estate Plan` sheet: 4-plan comparison — P1 Roth+Taxable→GST trust, P2 Roth-only→GST trust
  (Reverse QTIP framing), P3 no trust/portability, P4 spouse-exemption-only GST trust.
- `EP Projections`: per-plan funding waterfalls + pairwise deltas (Step-Up Benefit vs Estate
  Tax Cost vs Lost Roth Tax-Free Appreciation → Net Benefit).
- `Legacy`: after-tax legacy at 2nd death + Children's Wealth @ Death+10 (SECURE 10-yr IRA
  drawdown, heir rates, step-up toggle, HeirHoldToDeath).
- `Family Wealth`: gifts program FV (annual exclusion + §2503(e)) + LegacyHorizon toggle.

## Conformance gaps in Excel vs web estate.py baseline
1. No trust tax drag (grows at gross 7%); web uses 2%yld×37% + (r−2%)×20%turnover×20% LTCG.
2. Roth-in-trust SECURE 10-yr wrapper termination not modeled (grows tax-free indefinitely).
3. §1014 step-up handled as side memo at flat 24%, not integrated after-tax values;
   trust taxable basis lock at funding FMV not carried forward.
4. Estate Plan 4-plan comparison stops at 2nd death — no +10/+20/+30 horizons; Legacy sheet
   death+10 assumes all-outright (no trust variants). Two modules not integrated.
5. No state estate tax (flat 40% federal only); web: 12 states + DC, NY cliff, HI/MD portability.
6. Exemption indexed at 3% (BracketInfl) vs chained CPI 2.4% — $36.4M vs $30.6M at 2056.
7. Settlement costs + heir IRA income tax + FET not integrated in the 4-plan net-to-heirs.
8. Legacy headline EXCLUDES federal estate tax (diagnostic only) despite $592K live exposure.

## Excel bugs found (fix regardless)
- 'Estate Plan'!C26 (Spouse Trad IRA) references Accounts row 36 = same row as C28 (Spouse
  Roth) → double counts $3.54M at client death inventory. Should be row 28.
- EP Projections Plan 1 H40 `=0.4*MAX(F38-+J31-H36,0)` SUBTRACTS Trad IRA; Plans 2/3 ADD it.
  Sign inconsistency.
- Legacy!B66 grows ENTIRE Roth 10 yrs tax-free post-2nd-death; trust-held client Roth
  (P1/P2) window expires 2066 = only 4 yrs after 2nd death 2062.

## Web-side corrections identified (both directions)
- Web FED_EXCLUSION_BASE = $13.99M base 2025 ×2.4% → 2026 ≈ $14.33M, understates OBBBA
  statutory $15M for 2026. Excel has $15M correct. Recommend updating web base.

## Excel features web lacks → HTML roadmap phases (proposed to user)
A. Exclusion base fix ($15M/2026) + indexing-rate input & sensitivity.
B. Funding-composition axis: Roth-only trust funding (Reverse QTIP), spouse-exemption-only plan.
C. "Lost Roth Tax-Free Appreciation" KPI (10-yr clock start cost, per strategy).
D. Pairwise trade-off waterfall (step-up benefit − estate tax cost − lost Roth compounding).
E. Lifetime giving program (annual exclusion + §2503(e)) + Family Wealth metric.
F. Death+10 unification: per-asset SECURE windows keyed to funding death; per-heir breakdown;
   heir-rate sensitivity matrix in Estate tab.

## Follow-up Q&A (user): "Is the client's Roth a separate compounding vehicle with its own start date?"
Verified against estate.py 2026-06:
- TRUST SIDE: YES — trust_components[{entry_year, roth_entry, taxable_entry}] give each trust
  Roth its own 10-yr window from its entry year (Y1 for bypass/GST1, Y2 for GST2); horizons
  compound per component (_trust_value_at).
- OUTRIGHT SIDE: NO — household residual (incl. all Roth in Portability) is blended into
  household_after_tax_at_y2 × (1+survivor_rate)^h with NO SECURE 10-yr cutoff at +20/+30
  horizons → understates trust strategies' relative advantage at long horizons. GAP.
- Spousal rollover clock deferral is implicit (correct math) but never displayed.
- EXCEL: not modeled at all (gross growth indefinitely; Legacy!B66 fresh 10-yr window for all).
Proposed workstream "Roth as a first-class vehicle" (Phase C+): per-vehicle ledger
{owner, wrapper, clock-start event/year, tax-regime timeline}; decompose household bucket at
horizons into Roth/taxable/traditional with own clocks; "follow the client's Roth" ribbon UI;
Excel: dedicated Roth column with own clock-start cell flowing through Plans 1-4.
User decision pending: implement engine fix + ribbon, or stay narrative-only.
