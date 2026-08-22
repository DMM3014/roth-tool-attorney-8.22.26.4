/**
 * Client Report — EP Projection flowchart pages.
 * One page per advisor-selected plan (each with a line-by-line federal estate
 * tax calculation and an investable-wealth ↔ gross-estate bridge), an optional
 * plan-comparison-table page, and — when a comparison scenario is picked — one
 * combined-comparison page explicitly labeled as multi-variable (not causal).
 */
import React from "react";
import { Page, H2, H3, P, Sub } from "./helpers.jsx";
import { fmtUSD } from "@/lib/api";
import { PlanFlowchart, DisclaimerFallbackNote } from "@/components/flowchart/PlanFlowchart";
import { PlanComparisonTable } from "@/components/flowchart/PlanComparisonTable";
import { EstateThreeQuestions, AdvisorDetailTag, BasisTradeoffCaveat } from "@/components/shared/PrintBlocks";

const rowStyle = { borderBottom: "1px solid #F3F1EC" };
const num = { padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 9.5 };
const lbl = { padding: "4px 6px", color: "#5A5A5A", fontSize: 9.5, lineHeight: 1.4 };

/**
 * Line-by-line federal estate tax calculation. Every row comes straight from
 * the engine payload so a reviewer can verify the FET from disclosed
 * assumptions (reviewer critique: the tax must be reproducible line by line).
 */
export const FetCalcTable = ({ plan, flowResult, testid }) => {
  const ch = plan.children || {};
  const f2 = plan.funding_y2;
  const y1Funded = plan.funding_y1?.maximum_to_trust || 0;
  return (
    <div data-testid={testid} style={{ marginTop: 8, padding: 8, border: "1px solid #EBE8E0", borderRadius: 6, background: "#FAFAF8" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 10 }}>
          Federal estate tax at second death — line-by-line calculation
        </div>
        <AdvisorDetailTag testid={`${testid}-advisor-tag`} />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr style={rowStyle}>
            <td style={lbl}>Survivor&apos;s gross estate at {flowResult.second_death_year} (excludes assets already inside a first-death trust)</td>
            <td style={num}>{fmtUSD(plan.survivor_y2?.total || 0)}</td>
          </tr>
          <tr style={rowStyle}>
            <td style={lbl}>Federal exclusion at {flowResult.second_death_year} ($15M base in 2026, indexed at the model&apos;s CPI assumption)</td>
            <td style={num}>−{fmtUSD(flowResult.fed_excl_y2)}</td>
          </tr>
          <tr style={rowStyle}>
            <td style={lbl}>
              DSUE ported from first death — {flowResult.first_death_year} exclusion of {fmtUSD(flowResult.fed_excl_y1)}
              {y1Funded > 0
                ? <> minus {fmtUSD(y1Funded)} used to fund the first-death trust</>
                : <>, fully unused at the first death</>}; frozen at that value per timely-filed Form 706
            </td>
            <td style={num}>−{fmtUSD(plan.dsue || 0)}</td>
          </tr>
          <tr style={{ ...rowStyle, background: "#F3F1EC" }}>
            <td style={{ ...lbl, fontWeight: 700, color: "#1A1A1A" }}>Combined shelter (Y2 exclusion + DSUE)</td>
            <td style={{ ...num, fontWeight: 700 }}>{fmtUSD(ch.fet_limit || 0)}</td>
          </tr>
          <tr style={rowStyle}>
            <td style={lbl}>Amount of the gross estate above the combined shelter</td>
            <td style={num}>{fmtUSD(ch.amount_over || 0)}</td>
          </tr>
          <tr>
            <td style={{ ...lbl, fontWeight: 800, color: (ch.fet || 0) > 0 ? "#B84A4A" : "#4A6741" }}>
              Federal estate tax (40% of the excess)
            </td>
            <td style={{ ...num, fontWeight: 800, color: (ch.fet || 0) > 0 ? "#B84A4A" : "#4A6741" }}>
              {fmtUSD(ch.fet || 0)}
            </td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 8.5, color: "#777", margin: "4px 0 0", lineHeight: 1.45 }}>
        Assumptions disclosed: no prior taxable gifts; DSUE portability elected via timely-filed Form 706 at the first
        death; state estate/inheritance taxes not modeled on this page. The GST exemption is <strong>not</strong> portable —
        {f2
          ? <> only {fmtUSD(f2.gst_exempt_portion || 0)} of the second-death trust funding is GST-exempt (capped at the {flowResult.second_death_year} exclusion, without DSUE).</>
          : <> this plan funds no second-death trust, so no GST allocation occurs at {flowResult.second_death_year}.</>}
      </p>
    </div>
  );
};

export const EstateFramingNote = ({ testid = "cr-estate-framing-note" }) => (
  <div data-testid={testid}
       style={{ padding: 10, background: "#FDF6EC", border: "1.5px solid #C87941", borderRadius: 6,
                marginBottom: 10 }}>
    <p style={{ fontSize: 10.5, lineHeight: 1.6, margin: 0, color: "#1A1A1A", fontWeight: 600 }}>
      These estate structures are hypothetical educational illustrations, not ranked recommendations. The
      appropriate structure at the time of either spouse&apos;s death will depend on then-current tax law,
      estate values, beneficiary tax circumstances, family relationships, asset-protection needs, and the
      family&apos;s goals for children and later generations.
    </p>
  </div>
);

export const EpFlowchartPage = ({ plan, flowResult, y2Split, showFraming, detailFoot, ...footProps }) => {
  // Lift the Plan 2 disclaimer fallback state here so clicking the
  // "What if Spouse doesn't disclaim?" toggle inside the PlanFlowchart
  // swaps BOTH the flowchart body AND the surrounding narrative on this
  // page (H2 title annotation, plan subtitle paragraph, and the FET calc
  // table). Without this lift the toggle only re-rendered the flowchart
  // middle and advisors reported it looking like nothing changed.
  const [fallback, setFallback] = React.useState(false);
  const isDisclaimer = plan.key === "disclaimer_roth";
  const p1 = isDisclaimer ? (flowResult.plans || []).find((p) => p.key === "no_trust") : null;
  const showPlan = (isDisclaimer && fallback && p1) ? p1 : plan;
  const showingFallback = isDisclaimer && fallback && p1;
  const t = showPlan.totals_y2 || {};
  const investableClasses = (t.roth || 0) + (t.taxable || 0) + (t.traditional || 0);
  const cash = y2Split?.cash ?? null;
  const home = y2Split?.home ?? null;
  const investableWealth = cash != null ? investableClasses + cash : null;
  return (
    <>
      {/* ---- Page A: the flow diagram, given a print page of its own ----
          Previously the diagram, the FET arithmetic and all the notes shared one
          page, which ran 1350–2000px against an A4 budget of ~1050px. The PDF
          pipeline then either shrank the whole page or sliced it mid-diagram.
          Splitting at this boundary lets the diagram print at full size. */}
      <Page testid={`cr-page-flow-plan-${plan.plan_no}`} {...footProps}>
        {showFraming && <EstateFramingNote />}
        {showFraming && <EstateThreeQuestions testid="cr-estate-three-questions" />}
        <H2>
          EP Projection — Plan {plan.plan_no}: {plan.title}
          {showingFallback && (
            <span data-testid={`cr-flow-fallback-h2-badge-${plan.plan_no}`}
                  style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                           textTransform: "uppercase", color: "#8A5A20", background: "#FDF6EC",
                           border: "1px solid #E5B87A", borderRadius: 999, padding: "2px 8px" }}>
              Showing fallback — Plan 1 baseline
            </span>
          )}
        </H2>
        <PlanFlowchart plan={plan} ctx={flowResult}
                       testid={`cr-flow-plan-${plan.plan_no}`}
                       hideSubtitle hideFallbackCallout
                       fallback={fallback}
                       onFallbackChange={isDisclaimer ? setFallback : undefined} />
      </Page>

      {/* ---- Page B: what the diagram is saying, and the arithmetic ---- */}
      <Page testid={`cr-page-flow-plan-${plan.plan_no}-detail`} {...(detailFoot || footProps)}>
        <H2>Plan {plan.plan_no}: {plan.title} — the arithmetic</H2>
        <P data-testid={`cr-flow-subtitle-${plan.plan_no}`}>
          {showingFallback ? (
            <>
              <strong>Fallback view engaged.</strong> The Spouse has declined (or is unable) to
              disclaim within the 9-month window, so the Disclaimer GST Trust is never funded.
              The illustration on the previous page and the Federal Estate Tax calculation below
              reflect Plan&nbsp;1&apos;s baseline outcome:{" "}<em>{p1.subtitle}</em>
            </>
          ) : (
            plan.subtitle
          )}
        </P>
        <FetCalcTable plan={showPlan} flowResult={flowResult} testid={`cr-flow-fet-calc-${plan.plan_no}`} />
        <div data-testid={`cr-flow-bridge-${plan.plan_no}`}
             style={{ marginTop: 8, padding: 8, border: "1px solid #EBE8E0", borderLeft: "3px solid #4A6741",
                      borderRadius: 6, background: "#F9F8F6", fontSize: 9.5, lineHeight: 1.5, color: "#1A1A1A" }}>
          <strong>Gross estate vs. investable wealth — the bridge.</strong>{" "}
          {investableWealth != null ? (
            <>Gross estate at {flowResult.second_death_year} on this page = <strong>investable wealth {fmtUSD(investableWealth)}</strong>
            {" "}(Roth {fmtUSD(t.roth || 0)} + Taxable {fmtUSD(t.taxable || 0)}
            {(t.traditional || 0) > 0 ? <> + Traditional {fmtUSD(t.traditional)}</> : null}
            {" "}+ cash sleeve {fmtUSD(cash)}) <strong>+ home {fmtUSD(home)} = {fmtUSD(t.total || 0)}</strong>.
            The &ldquo;Investable Wealth&rdquo; figures on the Overview and Basis Step-Up pages exclude the home, so this
            page&apos;s gross estate is larger by exactly the projected home value.</>
          ) : (
            <>Gross estate at {flowResult.second_death_year} = investable accounts {fmtUSD(investableClasses)}
            {" "}+ Cash &amp; House {fmtUSD(t.cash_house || 0)} = <strong>{fmtUSD(t.total || 0)}</strong>. The
            &ldquo;Investable Wealth&rdquo; figures elsewhere in this report exclude the home.</>
          )}
          {" "}Each asset class is carried to the second death at the retirement cash-flow/tax model&apos;s actual
          projected balance.
        </div>
        {isDisclaimer && p1 && <DisclaimerFallbackNote plan={plan} p1={p1} />}
        <Sub>
          Balances at the first death ({flowResult.first_death_year}) are split 50/50 between spouses, and each asset
          class is carried to the second death ({flowResult.second_death_year}) at the retirement model&apos;s actual
          projected balance. Federal estate tax only — exclusions of {fmtUSD(flowResult.fed_excl_y1)} /
          {" "}{fmtUSD(flowResult.fed_excl_y2)} index at the model&apos;s CPI assumption. Consult a qualified
          estate-planning attorney before implementing any trust structure.
        </Sub>
      </Page>
    </>
  );
};

export const EpFlowchartComparePage = ({ flowResult, selected, ...footProps }) => {
  const plans = flowResult.plans.filter((p) => selected.includes(p.plan_no));
  // Build the plan-set-aware narrative for the "Reading the table" paragraph.
  // Prior copy hard-coded "Plans 2, 3, and 4 preserve more shelter than Plan 5",
  // which no longer matches reports where the advisor de-selected some plans
  // (e.g. the new 1-2-3 default). We now derive the sentence from `selected`
  // so it always describes the plans on the page.
  //   • fund-at-first-death = plans 2, 3, 4 (Disclaimer, Roth+Taxable, Roth-Only)
  //   • wait-until-second-death = plan 5
  const listSel = (nums) => nums.length === 0 ? "" :
    nums.length === 1 ? `Plan ${nums[0]}` :
    nums.length === 2 ? `Plans ${nums[0]} and ${nums[1]}` :
    `Plans ${nums.slice(0, -1).join(", ")}, and ${nums[nums.length - 1]}`;
  const firstDeathPlans = selected.filter((n) => [2, 3, 4].includes(n));
  const hasP5 = selected.includes(5);
  const hasDisclaimer = selected.includes(2);
  const shelterSentence = firstDeathPlans.length > 0 && hasP5
    ? <>funding at the first death ({listSel(firstDeathPlans)}) preserves more shelter than waiting until the second death (Plan 5).</>
    : firstDeathPlans.length > 0
      ? <>funding at the first death ({listSel(firstDeathPlans)}) preserves more shelter than waiting until the second death.</>
      : hasP5
        ? <>waiting until the second death (Plan 5) forfeits the first spouse&apos;s exemption — funding at the first death would have preserved more shelter.</>
        : <>timing the funding matters — funding a GST-exempt trust at the first death preserves more shelter than waiting until the second death.</>;
  return (
    <Page testid="cr-page-flow-compare" {...footProps}>
      <H2>EP Projection — Plan Comparison</H2>
      <EstateFramingNote testid="cr-estate-framing-note-compare" />
      <P>
        All plans start from the same balances at the first death, so the combined pre-tax total at the second
        death is identical — the plans differ only in <em>where</em> the assets sit (GST-sheltered trust vs.
        exposed outright) and what tax they attract. No single structure is best for every family: the right
        choice depends on asset growth, death timing, future law, and non-tax objectives — review the trade-offs
        with your advisor and estate attorney.
      </P>
      <PlanComparisonTable plans={plans} capGainsRate={flowResult.cap_gains_rate} testid="cr-flow-compare-table" />
      <BasisTradeoffCaveat plans={plans} testid="cr-flow-basis-caveat" />
      <H3>Reading the table</H3>
      <P>
        <strong>GST-exempt</strong> dollars escape estate and GST tax at every later generation&apos;s death —
        the dynasty shelter. <strong>Forgone 2nd step-up</strong> is the embedded capital-gains liability on
        Taxable assets locked in a trust at the first death (they keep funding-date basis instead of receiving
        the survivor&apos;s §1014 step-up). <strong>Roth outside GST shelter</strong> — GST-trust ownership can
        preserve transfer-tax protection, creditor protection, governance, and multigenerational control, while
        subsequent income taxation depends on whether income is retained in or distributed from the trust.
        Because the GST exemption is
        <em> not portable</em>, {shelterSentence}
        {hasDisclaimer && <>{" "}Plan 2&apos;s Disclaimer Trust adds post-mortem OPTIONALITY — the Spouse decides within
        9 months whether the disclaimer election is still worthwhile.</>}
      </P>
    </Page>
  );
};

/**
 * Combined scenario comparison — ONE page, explicitly labeled as an
 * all-differences-at-once view. Replaces the former per-plan paired pages,
 * which invited causal readings the comparison cannot support.
 */
export const EpFlowchartCombinedComparePage = ({ flowResult, compareResult, compareLabel,
                                                 selected, ...footProps }) => {
  const cmpMap = {};
  (compareResult?.plans || []).forEach((p) => { cmpMap[p.plan_no] = p; });
  const plans = flowResult.plans.filter((p) => selected.includes(p.plan_no) && cmpMap[p.plan_no]);
  const deathsDiffer = flowResult.first_death_year !== compareResult.first_death_year
    || flowResult.second_death_year !== compareResult.second_death_year;
  const metricRows = (cur, cmp) => ([
    { label: "Gross estate at 2nd death", a: cur.totals_y2?.total || 0, b: cmp.totals_y2?.total || 0 },
    { label: "Totals to Trusts and Children", a: cur.metrics?.total_to_children || 0, b: cmp.metrics?.total_to_children || 0 },
    { label: "Federal estate tax", a: cur.metrics?.fet || 0, b: cmp.metrics?.fet || 0, negative: true },
  ]);
  return (
    <Page testid="cr-page-flow-combined-compare" {...footProps}>
      <H2>Scenario Comparison — All Differences Combined</H2>
      <div data-testid="cr-combined-compare-warning"
           style={{ padding: 10, background: "#FDF6EC", border: "1px solid #C87941", borderRadius: 6,
                    fontSize: 9.5, lineHeight: 1.55, color: "#1A1A1A", marginBottom: 10 }}>
        <strong>Read this first — this is not causal attribution.</strong> The &ldquo;{compareLabel}&rdquo; scenario
        differs from the current plan in <em>multiple inputs at once</em> — Roth conversion schedule, withdrawal
        funding order, return assumptions, and possibly expenses{deathsDiffer
          ? <> — and even the projected death years ({flowResult.first_death_year}/{flowResult.second_death_year} current
              vs. {compareResult.first_death_year}/{compareResult.second_death_year} comparison)</>
          : null}. The gaps below therefore <strong>cannot be attributed to any single decision</strong>. For
        decision-grade evidence, use the Single-Variable Sensitivity page (previous page), where each run changes
        exactly one input at a time.
      </div>
      <table style={{ width: "100%", fontSize: 9.5, borderCollapse: "collapse" }} data-testid="cr-combined-compare-table">
        <thead>
          <tr style={{ borderBottom: "1.5px solid #4A6741", background: "#F9F8F6" }}>
            <th style={{ padding: 5, textAlign: "left", color: "#5A5A5A" }}>Metric</th>
            <th style={{ padding: 5, textAlign: "right", color: "#5A5A5A" }}>Current scenario</th>
            <th style={{ padding: 5, textAlign: "right", color: "#5A5A5A" }}>{compareLabel}</th>
            <th style={{ padding: 5, textAlign: "right", color: "#5A5A5A" }}>Δ (comparison − current)</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => {
            const cmp = cmpMap[p.plan_no];
            return (
              <React.Fragment key={p.plan_no}>
                <tr style={{ background: "#F3F1EC" }}>
                  <td colSpan={4} style={{ padding: "5px 5px", fontWeight: 700, fontSize: 9.5 }}>
                    Plan {p.plan_no}: {p.title}
                  </td>
                </tr>
                {metricRows(p, cmp).map((m) => {
                  const d = m.b - m.a;
                  const good = m.negative ? d < 0 : d > 0;
                  return (
                    <tr key={m.label} style={{ borderBottom: "1px solid #F3F1EC" }}>
                      <td style={{ padding: "4px 5px", color: "#5A5A5A", paddingLeft: 14 }}>{m.label}</td>
                      <td style={{ padding: "4px 5px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(m.a)}</td>
                      <td style={{ padding: "4px 5px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(m.b)}</td>
                      <td style={{ padding: "4px 5px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                                   fontWeight: 700, color: Math.abs(d) < 0.5 ? "#8A8A82" : good ? "#4A6741" : "#B84A4A" }}>
                        {d >= 0 ? "+" : "−"}{fmtUSD(Math.abs(d))}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <Sub>
        Both sides use the same cap-gains rate ({((flowResult.cap_gains_rate || 0) * 100).toFixed(0)}%) and heir
        income tax rate ({((flowResult.heir_income_rate || 0) * 100).toFixed(1)}%). Each scenario&apos;s balances at
        both deaths come from its own retirement projection.
      </Sub>
    </Page>
  );
};
