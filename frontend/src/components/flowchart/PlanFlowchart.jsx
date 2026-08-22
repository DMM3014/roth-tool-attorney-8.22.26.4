/**
 * PlanFlowchart — one EP Projection plan rendered as a print-safe flow diagram.
 * Shared by the EP Flowchart tab and the Client Report print pages.
 * Inline styles only so the html2canvas PDF pipeline captures it faithfully.
 */
import React, { useState, useEffect } from "react";
import { fmtUSD } from "@/lib/api";

export const TONES = {
  client:  { bg: "#F6F3FA", border: "#6E5A8E", fg: "#4A3B66" },
  spouse:  { bg: "#EFF4F9", border: "#4A6E8E", fg: "#33506B" },
  trust:   { bg: "#F1F5EF", border: "#4A6741", fg: "#3B5234" },
  funding: { bg: "#FEFAF1", border: "#C87941", fg: "#8A5A20" },
  danger:  { bg: "#FDF2F2", border: "#B84A4A", fg: "#8F3232" },
  neutral: { bg: "#F9F8F6", border: "#B8B4A8", fg: "#5A5A5A" },
};

const Box = ({ tone = "neutral", title, rows = [], note, testid }) => {
  const t = TONES[tone];
  return (
    <div data-testid={testid} style={{ background: t.bg, border: `1.5px solid ${t.border}`, borderRadius: 8, padding: "8px 10px" }}>
      <p style={{ fontSize: 9.5, fontWeight: 700, color: t.fg, margin: 0, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</p>
      {rows.map(([label, value, opts = {}], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 3 }}>
          <span style={{ fontSize: 10, color: opts.danger ? "#B84A4A" : "#5A5A5A" }}>{label}</span>
          <span style={{ fontSize: opts.bold ? 12 : 10.5, fontWeight: opts.bold ? 800 : 600, fontVariantNumeric: "tabular-nums", color: opts.danger ? "#B84A4A" : "#1A1A1A" }}>
            {typeof value === "number" ? fmtUSD(value) : value}
          </span>
        </div>
      ))}
      {note && <p style={{ fontSize: 8.5, color: t.fg, margin: 0, marginTop: 5, lineHeight: 1.45, fontStyle: "italic" }}>{note}</p>}
    </div>
  );
};

const Arrow = ({ label }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3px 0" }}>
    {label && <span style={{ fontSize: 9, fontWeight: 600, color: "#5A5A5A", marginBottom: 1, textAlign: "center" }}>{label}</span>}
    <svg width="12" height="15" viewBox="0 0 12 16" aria-hidden="true">
      <path d="M6 0v11M1.5 8.5L6 14l4.5-5.5" fill="none" stroke="#8A8578" strokeWidth="1.6" />
    </svg>
  </div>
);

const ColHeader = ({ tone, children }) => (
  <div style={{ background: TONES[tone].border, color: "#FFFFFF", borderRadius: 6, padding: "4px 10px",
                fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase",
                textAlign: "center", marginBottom: 8 }}>
    {children}
  </div>
);

const Chip = ({ label, value, tone = "neutral", testid }) => {
  const t = TONES[tone];
  return (
    <div data-testid={testid} style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 10px" }}>
      <p style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: t.fg, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#1A1A1A", margin: 0, marginTop: 1 }}>
        {typeof value === "number" ? fmtUSD(value) : value}
      </p>
    </div>
  );
};

/**
 * DisclaimerFallbackNote — "if the Spouse elects NOT to disclaim" callout.
 * Exported so the Client Report can print it on the arithmetic page while the
 * flow diagram gets a print page of its own (see EpFlowchartPage).
 *
 * IMPORTANT: always reads Plan 5's ORIGINAL metrics (`plan.metrics`) for the
 * delta — never a swapped-in fallback plan. Otherwise engaging the interactive
 * fallback toggle would turn the delta into 0 (Plan 1 vs Plan 1) and erase the
 * very insight the callout exists to surface.
 */
export const DisclaimerFallbackNote = ({ plan, p1 }) => {
  const p1m = p1?.metrics || {};
  const pm = plan?.metrics || {};
  const deltaTotal = (pm.total_to_children || 0) - (p1m.total_to_children || 0);
  const deltaFet = (p1m.fet || 0) - (pm.fet || 0);
  return (
    <div data-testid={`flow-p${plan.plan_no}-disclaimer-fallback`}
         style={{ marginTop: 12, padding: "8px 12px",
                  border: "1px dashed #C9BFA8", borderRadius: 8,
                  background: "#FDFBF6", fontSize: 10.5, lineHeight: 1.55,
                  color: "#3A3A32" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4,
                    color: "#8A5A20", marginBottom: 3, textTransform: "uppercase" }}>
        If Spouse elects NOT to disclaim
      </div>
      <div>
        The Disclaimer GST Trust is never funded and the outcome collapses to Plan 1&apos;s
        baseline — the Client&apos;s GST exemption is permanently lost (non-portable) and
        the entire estate lands in the Spouse&apos;s taxable estate. The Spouse has up to
        nine months from the Client&apos;s death (extendable) to make this election and
        must not have accepted any benefit from the Roth before electing.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
        <div>
          <div style={{ color: "#8A8A82", fontSize: 9 }}>Fallback (Plan 1) totals to Trusts &amp; Children</div>
          <div style={{ fontWeight: 700, color: "#1A1A1A" }}
               data-testid={`flow-p${plan.plan_no}-fallback-total`}>
            {fmtUSD(p1m.total_to_children || 0)}
          </div>
        </div>
        <div>
          <div style={{ color: "#8A8A82", fontSize: 9 }}>Fallback Federal estate tax</div>
          <div style={{ fontWeight: 700, color: (p1m.fet || 0) > 0 ? "#B84A4A" : "#1A1A1A" }}
               data-testid={`flow-p${plan.plan_no}-fallback-fet`}>
            {fmtUSD(p1m.fet || 0)}
          </div>
        </div>
        <div>
          <div style={{ color: "#8A8A82", fontSize: 9 }}>Cost of NOT disclaiming</div>
          <div style={{ fontWeight: 700, color: deltaTotal > 0 ? "#B84A4A" : "#8A8A82" }}
               data-testid={`flow-p${plan.plan_no}-fallback-cost`}>
            {deltaTotal > 0 ? `−${fmtUSD(deltaTotal)} to heirs` : "no dollar impact in this scenario"}
            {deltaFet > 0 && ` · +${fmtUSD(deltaFet)} FET`}
          </div>
        </div>
      </div>
    </div>
  );
};

// ctx = full /api/estate/ep-flowchart response (y1, years, rates, exclusions).
// Optional controlled props (fallback, onFallbackChange) let a parent (e.g.
// the Client Report EpFlowchartPage) lift the fallback state so its own H2
// title, subtitle paragraph and FetCalcTable can swap alongside the flowchart
// body — otherwise the toggle is internal-only and only the flowchart swaps.
// `hideSubtitle` is set by callers (like EpFlowchartPage) that render the
// plan subtitle themselves above the card — without this the same paragraph
// prints twice in the DOCX export (advisor bug report 2026-02).
export const PlanFlowchart = ({ plan, ctx, testid, hideSubtitle = false,
                                hideFallbackCallout = false,
                                fallback: controlledFallback, onFallbackChange }) => {
  // "What if Spouse doesn't disclaim?" toggle — Plan 2 (disclaimer_roth) only.
  // When ON, the ENTIRE flowchart (funding, trust boxes, survivor estate,
  // children, metric chips) re-renders using Plan 1's data. That is the exact
  // economic fallback: no disclaimer → no Y1 trust → Plan 1 baseline. Keeps
  // the Plan 2 badge + header + fallback callout at the bottom so advisors
  // can talk the client through the swap live. When uncontrolled we hold the
  // state locally; when a parent passes controlledFallback/onFallbackChange we
  // defer to them so the surrounding narrative on the Client Report page can
  // swap in lock-step. Auto-resets on the "cr-reset-isolation" event that
  // doPrint fires before html2canvas capture, so the printed PDF never
  // accidentally captures a fallback view.
  const [uncontrolled, setUncontrolled] = useState(false);
  const isControlled = typeof onFallbackChange === "function";
  const fallback = isControlled ? !!controlledFallback : uncontrolled;
  const setFallback = isControlled
    ? (next) => onFallbackChange(typeof next === "function" ? next(fallback) : next)
    : setUncontrolled;
  const isDisclaimer = plan.key === "disclaimer_roth";
  const p1 = isDisclaimer ? (ctx.plans || []).find((p) => p.key === "no_trust") : null;
  useEffect(() => {
    if (!isDisclaimer) return;
    const reset = () => setFallback(false);
    window.addEventListener("cr-reset-isolation", reset);
    return () => window.removeEventListener("cr-reset-isolation", reset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDisclaimer, isControlled]);
  // Choose which plan's data actually renders the flowchart body. When
  // fallback is engaged and Plan 1 is available in the context, swap wholesale
  // to Plan 1's structure — this is a display-only swap; the header, title,
  // and bottom callout still identify the card as Plan 5.
  const showPlan = (fallback && p1) ? p1 : plan;
  const y1 = ctx.y1 || { client: {}, survivor: {} };
  const c = y1.client, s = y1.survivor;
  const yr1 = ctx.first_death_year, yr2 = ctx.second_death_year;
  const growPct = ctx.growth_basis === "projection"
    ? "per retirement projection"
    : `@ ${(ctx.growth_rate * 100).toFixed(1)}%`;
  const f1 = showPlan.funding_y1;
  const f2 = showPlan.funding_y2;
  const ct = showPlan.client_trust_y2;
  const st = showPlan.spouse_trust_y2;
  const sv = showPlan.survivor_y2;
  const ch = showPlan.children;
  const m = showPlan.metrics;
  const clientLeftover = f1
    ? Math.max(0, (c.roth || 0) + (c.taxable || 0) - f1.maximum_to_trust) + (c.cash_house || 0) + (c.traditional || 0)
    : (c.roth || 0) + (c.taxable || 0) + (c.cash_house || 0) + (c.traditional || 0);
  // Funding-order arrow label uses the DISPLAYED plan's key (so when the
  // fallback swap is on, we don't lie about disclaimer language).
  const fundLabelY1 = showPlan.key === "roth_and_taxable"
    ? "Roth FIRST, then Taxable — up to exclusion"
    : showPlan.key === "disclaimer_roth"
    ? "Spouse DISCLAIMS Roth only (within 9 months) — up to exclusion"
    : "Roth ONLY — up to exclusion";
  const fundLabelY2 = showPlan.key === "second_death_only"
    ? "Everything (Roth first) — up to exclusion + DSUE"
    : "Roth first, then Taxable + Cash & House — up to exclusion + DSUE";

  return (
    <div data-testid={testid || `flow-plan-${plan.plan_no}`}
         {...(isDisclaimer ? { "data-fallback": fallback ? "true" : "false" } : {})}
         style={{ border: "1px solid #EBE8E0", borderRadius: 12, background: "#FFFFFF", padding: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        {/* On the printed report the page H2 already reads "Plan N: <title>",
            so repeating the badge + title inside the card only costs vertical
            room on a page that has to fit inside A4. */}
        {!hideSubtitle && (<>
          <span style={{ background: "#4A6741", color: "#FFF", borderRadius: 999, padding: "2px 10px",
                         fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>PLAN {plan.plan_no}</span>
          <span style={{ fontFamily: "Outfit, sans-serif", fontSize: 15, fontWeight: 800, color: "#1A1A1A" }}>{plan.title}</span>
        </>)}
        {/* Live fallback toggle — Plan 5 only. Kept out of the header when we
            don't have Plan 1 data to swap to (safety no-op). Print pipeline
            resets fallback via the shared cr-reset-isolation event so this
            button never appears in the exported PDF regardless of state. */}
        {isDisclaimer && p1 && (
          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {fallback && (
              <span data-testid={`flow-p${plan.plan_no}-fallback-badge`}
                    style={{ background: "#FDF6EC", color: "#8A5A20",
                             border: "1px solid #E5B87A", borderRadius: 999,
                             padding: "1px 8px", fontSize: 9, fontWeight: 700,
                             letterSpacing: 0.4, textTransform: "uppercase" }}>
                Showing fallback
              </span>
            )}
            <button type="button"
                    onClick={() => setFallback((v) => !v)}
                    data-testid={`flow-p${plan.plan_no}-fallback-toggle`}
                    data-active={fallback ? "true" : "false"}
                    title={fallback
                      ? "Return to the disclaimed view (Plan 5 central case)"
                      : "Preview what the estate looks like if the Spouse does not disclaim"}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: fallback ? "#8A5A20" : "#F9F8F6",
                      color: fallback ? "#FFFFFF" : "#3A3A32",
                      border: `1px solid ${fallback ? "#8A5A20" : "#D6CFB8"}`,
                      borderRadius: 999, padding: "3px 10px", cursor: "pointer",
                      fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
                      transition: "background-color 120ms ease, color 120ms ease",
                    }}>
              <span style={{
                display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                background: fallback ? "#FDF6EC" : "#8A8A82",
              }} />
              {fallback ? "Fallback view — click to reset" : "What if Spouse doesn’t disclaim?"}
            </button>
          </div>
        )}
      </div>
      {!hideSubtitle && (
        <p style={{ fontSize: 10, color: "#5A5A5A", lineHeight: 1.5, margin: "0 0 12px 0", maxWidth: 720 }}>{plan.subtitle}</p>
      )}

      {/* Two-column flow — tagged for DOCX export to rasterize this whole
          two-column diagram as a single PNG. The metric chips + fallback
          callout BELOW this block stay as editable Word text. */}
      <div data-docx-rasterize="plan-flow"
           style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* CLIENT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ColHeader tone="client">Client — first death · {yr1}</ColHeader>
          <Box tone="client" title="Client Roth IRA" rows={[["Balance", c.roth || 0, { bold: true }]]} />
          <Box tone="client" title="Client Taxable Brokerage" rows={[["Balance", c.taxable || 0, { bold: true }]]} />
          <Box tone="client" title="Client Cash, Traditional IRA & House"
               rows={[["Balance", (c.cash_house || 0) + (c.traditional || 0), { bold: true }]]}
               note="Never routed to a trust — passes to the survivor via marital deduction." />
          {f1 ? (
            <>
              <Arrow label={fundLabelY1} />
              <Box tone="funding" title={showPlan.key === "disclaimer_roth"
                ? `Disclaimer GST trust funding — ${yr1}`
                : `GST trust funding — ${yr1}`} testid={`flow-p${plan.plan_no}-funding-y1`}
                   rows={[
                     ["Exclusion / GST limit", f1.exclusion_limit],
                     ["Funding assets", f1.funding_assets],
                     ["Roth to trust", f1.roth_to_trust],
                     ["Taxable to trust", f1.taxable_to_trust],
                     ["Maximum to trust", f1.maximum_to_trust, { bold: true }],
                     ["Unused exclusion → DSUE", f1.dsue],
                   ]} />
              <Arrow label={`grows ${ctx.years_between} yrs ${growPct}`} />
              <Box tone="trust" title={showPlan.key === "disclaimer_roth"
                ? `Client Disclaimer GST Trust — ${yr2}`
                : `Client GST Trust — ${yr2}`} testid={`flow-p${plan.plan_no}-client-trust`}
                   rows={[
                     ["Roth", ct?.roth || 0],
                     ["Taxable", ct?.taxable || 0],
                     ["Total", ct?.total || 0, { bold: true }],
                   ]}
                   note={showPlan.key === "disclaimer_roth"
                     ? "Estate- & GST-tax free at the second death and at every later generation — funded only if the surviving Spouse timely disclaims within 9 months (extendable)."
                     : "Estate- & GST-tax free at the second death and at every later generation."} />
              {clientLeftover > 0 && (
                <Box tone="neutral" title="Remaining client assets"
                     rows={[["To survivor (marital deduction)", clientLeftover]]} />
              )}
            </>
          ) : (
            <>
              <Arrow label="First death — marital deduction (no tax)" />
              <Box tone="neutral" title="100% to surviving spouse" testid={`flow-p${plan.plan_no}-no-y1-trust`}
                   rows={[["DSUE captured (Form 706)", plan.dsue, { bold: true }]]}
                   note="No trust funded at first death — the client's GST exemption (non-portable) is not allocated." />
            </>
          )}
        </div>

        {/* SURVIVOR column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ColHeader tone="spouse">Survivor — second death · {yr2}</ColHeader>
          <Box tone="spouse" title={`Survivor assets — ${yr1}`}
               rows={[
                 ["Roth IRA", s.roth || 0],
                 ["Taxable Brokerage", s.taxable || 0],
                 ["Cash & House", s.cash_house || 0],
                 ["Traditional IRA", s.traditional || 0],
               ]}
               note="Plus everything inherited from the client outside the trust." />
          <Arrow label={`grows ${ctx.years_between} yrs ${growPct}`} />
          <Box tone="spouse" title={`Survivor gross estate — ${yr2}`} testid={`flow-p${plan.plan_no}-survivor-y2`}
               rows={[
                 ["Roth", sv.roth],
                 ["Taxable", sv.taxable],
                 ["Cash & House", sv.cash_house],
                 ["Traditional IRA", sv.traditional],
                 ["Total", sv.total, { bold: true }],
               ]} />
          {f2 ? (
            <>
              <Arrow label={fundLabelY2} />
              <Box tone="funding" title={`Spouse GST trust funding — ${yr2}`} testid={`flow-p${plan.plan_no}-funding-y2`}
                   rows={[
                     ["Exclusion limit (Fed Y2 + DSUE)", f2.exclusion_limit],
                     ["Funding assets", f2.funding_assets],
                     ["Maximum to trust", f2.maximum_to_trust, { bold: true }],
                     ["GST-exempt portion", f2.gst_exempt_portion],
                   ]}
                   note={`GST exemption is NOT portable — only the survivor's own exemption (${fmtUSD(f2.fed_excl_y2)}) can be allocated on Schedule R.`} />
              <Box tone="trust" title={`Spouse GST Trust — ${yr2}`} testid={`flow-p${plan.plan_no}-spouse-trust`}
                   rows={[
                     ["Roth", st?.roth || 0],
                     ["Taxable", st?.taxable || 0],
                     ...((st?.other || 0) > 0 ? [["Cash & House", st.other]] : []),
                     ["Total", st?.total || 0, { bold: true }],
                   ]} />
            </>
          ) : (
            <>
              <Arrow label="No trust — entire estate passes outright" />
              <Box tone="danger" title="No spouse GST trust" testid={`flow-p${plan.plan_no}-no-y2-trust`}
                   rows={[]}
                   note="Neither spouse's GST exemption is utilized. Everything lands in the children's own taxable estates." />
            </>
          )}
        </div>
      </div>

      {/* Children row */}
      <Arrow label={`Second death (${yr2}) → children`} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: 10 }}>
        <Box tone="trust" title="Inside GST trusts (sheltered)"
             rows={[
               ["Total in trust", m.in_trust_y2, { bold: true }],
               ["GST-exempt portion", m.gst_exempt_y2],
             ]}
             note="Escapes estate + GST tax at the children's later deaths." />
        <Box tone={ch.fet > 0 ? "danger" : "neutral"} title="Outright to children" testid={`flow-p${plan.plan_no}-children`}
             rows={[
               ["Gross outright", ch.outright_gross],
               ["Shelter (Fed excl Y2 + DSUE)", ch.fet_limit],
               ["Amount over", ch.amount_over, ch.amount_over > 0 ? { danger: true } : {}],
               ["Federal estate tax @ 40%", ch.fet, ch.fet > 0 ? { danger: true } : {}],
               ["Net outright", ch.outright_net, { bold: true }],
             ]} />
        <Box tone="neutral" title="Totals & notes"
             rows={[
               ["Totals to Trusts and Children", ch.total_to_children, { bold: true }],
               ["Heir income tax on Trad. IRA (memo)", ch.trad_income_tax],
             ]}
             note={`Children also pay income taxes on Traditional IRA balances at ${(ctx.heir_income_rate * 100).toFixed(1)}% over the SECURE 10-year window.`} />
      </div>

      {/* Metric chips */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 10 }}>
        <Chip tone="trust" label="GST-exempt at 2nd death" value={m.gst_exempt_y2} testid={`flow-p${plan.plan_no}-chip-gst`} />
        <Chip tone={m.fet > 0 ? "danger" : "neutral"} label="Federal estate tax" value={m.fet} testid={`flow-p${plan.plan_no}-chip-fet`} />
        <Chip tone={m.forgone_step_up > 0 ? "funding" : "neutral"} label="Forgone 2nd step-up" value={m.forgone_step_up} testid={`flow-p${plan.plan_no}-chip-stepup`} />
        <Chip tone={m.lost_roth_unsheltered > 0 ? "funding" : "trust"} label="Roth outside GST shelter" value={m.lost_roth_unsheltered} testid={`flow-p${plan.plan_no}-chip-roth`} />
        <Chip tone="trust" label="Totals to Trusts and Children" value={m.total_to_children} testid={`flow-p${plan.plan_no}-chip-total`} />
      </div>

      {/* Plan 5 — Disclaimer fallback callout. Suppressed by the Client Report,
          which prints it on the facing arithmetic page so the flow diagram gets
          a full print page to itself (see EpFlowchartPage). */}
      {plan.key === "disclaimer_roth" && p1 && !hideFallbackCallout && (
        <DisclaimerFallbackNote plan={plan} p1={p1} />
      )}
    </div>
  );
};

export default PlanFlowchart;
