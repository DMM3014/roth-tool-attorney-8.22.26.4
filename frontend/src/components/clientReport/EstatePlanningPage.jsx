/**
 * Client Report — Estate Planning page (4-strategy comparison).
 *
 * Prints the 4-strategy estate analysis with Roth-first trust funding, the
 * per-strategy detail table, multi-generational compounding, and the two SVG
 * flowcharts (baseline vs. layered GST). Renders only when `estateResult` is
 * loaded — the parent (ClientReport) fetches it via /api/estate/analyze
 * whenever the Estate toggle is on.
 */
import React from "react";
import { Page, H2, H3, P, Sub, Kpi } from "./helpers.jsx";
import { fmtUSD } from "@/lib/api";
import { TRUSTEE_DISTRIBUTION_NOTE } from "@/lib/rothTrustCaveat";
import { computeCombinedExemptionMetrics, TIER_COLORS } from "@/lib/estateExemptionGauge";

const STRATEGY_LABELS = {
  portability: "Portability-Only",
  bypass: "Bypass Trust",
  qtip_bypass: "Bypass + QTIP",
  gst_layered: "Layered GST-Exempt",
};
const STRATEGY_ORDER = ["portability", "bypass", "qtip_bypass", "gst_layered"];
const STRATEGY_COLORS = {
  portability: "#B8B4A8", bypass: "#7A9B76", qtip_bypass: "#4A6741", gst_layered: "#2F4A2A",
};

// -- SVG flowcharts (unchanged from prior version) ------------------------

const FlowNode = ({ x, y, w, h, label, sub, tone = "gray" }) => {
  const bg = tone === "green" ? "#F1F5EF" : tone === "orange" ? "#FEFAF1" : tone === "red" ? "#FDF2F2" : "#F9F8F6";
  const stroke = tone === "green" ? "#4A6741" : tone === "orange" ? "#C87941" : tone === "red" ? "#B84A4A" : "#B8B4A8";
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" fill={bg} stroke={stroke} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 4 : h / 2 + 3)} textAnchor="middle"
            style={{ fontFamily: "Outfit, sans-serif", fontSize: 10, fontWeight: 700, fill: "#1A1A1A" }}>{label}</text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 10} textAnchor="middle"
              style={{ fontFamily: "Outfit, sans-serif", fontSize: 8.5, fill: "#555" }}>{sub}</text>
      )}
    </g>
  );
};
const Arrow = ({ x1, y1, x2, y2, label, color = "#5A5A5A" }) => (
  <g>
    <defs>
      <marker id={`ah-${color.replace("#", "")}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <polygon points="0 0, 8 4, 0 8" fill={color} />
      </marker>
    </defs>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.5" markerEnd={`url(#ah-${color.replace("#", "")})`} />
    {label && (
      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle"
            style={{ fontFamily: "Outfit, sans-serif", fontSize: 8.5, fill: color, fontWeight: 600 }}>{label}</text>
    )}
  </g>
);

const FlowchartPortability = () => (
  <svg viewBox="0 0 500 220" style={{ width: "100%", height: 200, maxWidth: 500 }}>
    <FlowNode x={175} y={5} w={150} h={30} label="Combined estate" />
    <Arrow x1={250} y1={35} x2={250} y2={55} label="First death" />
    <FlowNode x={140} y={60} w={220} h={40} label="100% to surviving spouse" sub="Marital ded → no tax + DSUE" />
    <Arrow x1={250} y1={100} x2={250} y2={120} label="Second death" />
    <FlowNode x={20} y={125} w={220} h={45} label="Under (excl + DSUE) → Heirs" sub="§1014 step-up on Taxable" tone="green" />
    <FlowNode x={260} y={125} w={220} h={45} label="Over (excl + DSUE) → 40% + state" sub="Full basis step-up still applies" tone="red" />
    <Arrow x1={130} y1={170} x2={130} y2={195} color="#4A6741" />
    <Arrow x1={370} y1={170} x2={370} y2={195} color="#B84A4A" />
    <text x={130} y={210} textAnchor="middle" style={{ fontFamily: "Outfit, sans-serif", fontSize: 9, fill: "#4A6741", fontWeight: 700 }}>Heirs (post-step-up)</text>
    <text x={370} y={210} textAnchor="middle" style={{ fontFamily: "Outfit, sans-serif", fontSize: 9, fill: "#B84A4A", fontWeight: 700 }}>Heirs (after tax)</text>
  </svg>
);

const FlowchartGST = () => (
  <svg viewBox="0 0 500 420" style={{ width: "100%", height: 400, maxWidth: 500 }}>
    <FlowNode x={175} y={5} w={150} h={30} label="Combined estate" />
    <Arrow x1={250} y1={35} x2={250} y2={55} label="First death (Y1)" />
    {/* First-death funding — explicit Roth-first waterfall so the reader sees the priority order. */}
    <FlowNode x={20} y={60} w={210} h={45} label="GST Trust #1 (Layered)"
              sub="Roth funded FIRST, up to fed excl (Y1)" tone="green" />
    <FlowNode x={270} y={60} w={210} h={45} label="Marital / spouse"
              sub="Everything above Y1 fed excl (or wrong asset)" />
    {/* First-death funding-priority micro-labels — the "Roth-first, then Taxable" waterfall */}
    <text x={125} y={121} textAnchor="middle" style={{ fontFamily: "Outfit, sans-serif", fontSize: 8, fill: "#4A6741", fontWeight: 700 }}>
      Roth ①  →  Taxable ②  (fill order)
    </text>
    <text x={125} y={133} textAnchor="middle" style={{ fontFamily: "Outfit, sans-serif", fontSize: 7.5, fill: "#4A6741", fontStyle: "italic" }}>
      GST exemption ALSO allocated here (Form 706 Sch. R)
    </text>
    <text x={375} y={121} textAnchor="middle" style={{ fontFamily: "Outfit, sans-serif", fontSize: 8, fill: "#5A5A5A", fontStyle: "italic" }}>
      DSUE (unused Y1 excl) → survivor
    </text>
    <text x={375} y={133} textAnchor="middle" style={{ fontFamily: "Outfit, sans-serif", fontSize: 7.5, fill: "#B84A4A", fontStyle: "italic" }}>
      Traditional IRA → survivor via rollover
    </text>
    <Arrow x1={375} y1={148} x2={375} y2={185} label="Second death (Y2)" />
    <FlowNode x={225} y={190} w={150} h={30} label="Available excl"
              sub="Fed(Y2) + DSUE (est. shelter only)" tone="orange" />
    <Arrow x1={300} y1={220} x2={300} y2={240} />
    <FlowNode x={185} y={245} w={230} h={40} label="GST Trust #2"
              sub="Roth first, then Taxable, up to avail excl" tone="green" />
    <Arrow x1={470} y1={220} x2={470} y2={305} color="#B84A4A" />
    <FlowNode x={385} y={310} w={110} h={40} label="Excess to heirs"
              sub="Roth: SECURE-10; other: 40% + state" tone="red" />
    <line x1={20} y1={340} x2={200} y2={340} stroke="#4A6741" strokeWidth="1" strokeDasharray="3 2" />
    <text x={110} y={353} textAnchor="middle" style={{ fontFamily: "Outfit, sans-serif", fontSize: 8.5, fill: "#4A6741", fontWeight: 700 }}>
      Trusts shelter each generation:
    </text>
    <text x={20} y={367} style={{ fontFamily: "Outfit, sans-serif", fontSize: 8, fill: "#4A6741" }}>• Roth: income-tax free during SECURE 10-yr window</text>
    <text x={20} y={381} style={{ fontFamily: "Outfit, sans-serif", fontSize: 8, fill: "#4A6741" }}>• Estate + GST-tax free at every subsequent death</text>
    <text x={20} y={395} style={{ fontFamily: "Outfit, sans-serif", fontSize: 8, fill: "#4A6741" }}>• Traditional IRA stays OUT of the trust (see caution below)</text>
  </svg>
);

// -- Page ------------------------------------------------------------------

export const EstatePlanningPage = ({ estateResult, ...footProps }) => {
  if (!estateResult) {
    return (
      <Page testid="cr-page-estate" {...footProps}>
        <H2>Estate Planning — 4-Strategy Comparison</H2>
        <P>Estate analysis unavailable. Ensure the household DOBs and life expectancies are set on Plan Inputs so the projection has both death years.</P>
      </Page>
    );
  }

  const outcomes = estateResult.outcomes;
  const bestNet = Math.max(...STRATEGY_ORDER.map((k) => outcomes[k].net_to_heirs_at_y2));
  const worstNet = Math.min(...STRATEGY_ORDER.map((k) => outcomes[k].net_to_heirs_at_y2));
  const range = bestNet - worstNet;
  // Headline story: Portability vs. Layered GST-Exempt.
  const portNet = outcomes.portability.net_to_heirs_at_y2;
  const gstNet  = outcomes.gst_layered.net_to_heirs_at_y2;
  const headlineDelta = gstNet - portNet;

  return (
    <Page testid="cr-page-estate" {...footProps}>
      <H2>Estate Planning — GST-Exempt Trust vs. Portability</H2>

      <P>
        For a couple with a potentially taxable estate, the core question is: <strong>route Roth (and Taxable,
        if there&apos;s exemption room left) into a GST-exempt trust at each death up to the federal estate + GST
        exemption</strong> — with excess Roth spousal-rolling at first death and passing as inherited Roth at second
        death — <em>or</em> <strong>leave everything to the surviving spouse via marital deduction</strong> and rely
        on DSUE portability at the second death. Two alternative structures (Bypass Trust single-death, Bypass + QTIP
        for control/remarriage cases) are shown for reference. Traditional IRA/401(k) is never routed into any trust
        (see warning below).
      </P>

      {/* Reconciliation chip — the engine re-bases every strategy onto the
          retirement projection's actual second-death balances (reviewer critique:
          this page previously compounded Y1 balances at stylized rates and did
          not reconcile to the EP Projection pages). */}
      {estateResult.growth_basis === "projection" && estateResult.y2_targets && (
        <div data-testid="cr-estate-recon-chip"
             style={{ padding: 8, background: "#F1F5EF", border: "1px solid #4A6741", borderRadius: 6,
                      fontSize: 9.5, lineHeight: 1.5, color: "#1A1A1A", marginBottom: 10 }}>
          <strong>Second-death balances from the retirement projection.</strong> Every strategy on this page starts
          from the retirement model&apos;s actual balances at Y{estateResult.second_death_year}: Roth
          {" "}{fmtUSD(estateResult.y2_targets.roth)} + Taxable (incl. cash &amp; house, assumed sold and reinvested)
          {" "}{fmtUSD(estateResult.y2_targets.taxable)}
          {(estateResult.y2_targets.trad || 0) > 0 ? <> + Traditional {fmtUSD(estateResult.y2_targets.trad)}</> : null}
          {" "}= <strong>{fmtUSD((estateResult.y2_targets.roth || 0) + (estateResult.y2_targets.taxable || 0) + (estateResult.y2_targets.trad || 0))}</strong> —
          the same economic base as the EP Projection pages. Strategies differ only in where those dollars sit
          (trust vs. outright) and what tax they attract.
        </div>
      )}

      {/* Headline A vs D comparison */}
      <div style={{ padding: 12, background: "#F1F5EF", border: "1px solid #4A6741", borderRadius: 8, marginTop: 8, marginBottom: 12 }}
           data-testid="cr-estate-headline-compare">
        <p style={{ fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700, margin: 0 }}>
          Headline comparison at second death (Y{estateResult.second_death_year})
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 8 }}>
          <div>
            <p style={{ fontSize: 9, color: "#5A5A5A", margin: 0 }}>A. Portability-Only (marital ded + DSUE)</p>
            <p style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 700, color: "#1A1A1A", margin: 0, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(portNet)}</p>
          </div>
          <div>
            <p style={{ fontSize: 9, color: "#5A5A5A", margin: 0 }}>D. Layered GST-Exempt (Roth-first at both deaths)</p>
            <p style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 700, color: "#4A6741", margin: 0, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(gstNet)}</p>
          </div>
          <div>
            <p style={{ fontSize: 9, color: "#5A5A5A", margin: 0 }}>GST vs. Portability delta</p>
            <p style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 700,
                         color: headlineDelta >= 0 ? "#4A6741" : "#B84A4A", margin: 0, fontVariantNumeric: "tabular-nums" }}>
              {headlineDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(headlineDelta))}
            </p>
          </div>
        </div>
        <p style={{ fontSize: 9.5, color: "#1A1A1A", margin: 0, marginTop: 8, lineHeight: 1.5 }}>
          {headlineDelta >= 0
            ? <>The GST-exempt strategy delivers <strong>{fmtUSD(Math.abs(headlineDelta))} more</strong> to heirs at
                second death by using both spouses&apos; estate + GST exemptions and sheltering the trust portion from
                every subsequent generation&apos;s estate tax. Excess Roth at Y1 spousal-rolls into the survivor&apos;s
                Roth; excess Roth at Y2 passes to heirs as inherited Roth (SECURE 10-year window).</>
            : <>Portability alone comes out <strong>{fmtUSD(Math.abs(headlineDelta))} ahead</strong> here — the
                household is under the combined exemption, so the GST-trust structure adds complexity without a
                material tax saving. Revisit if the estate grows or if a future statutory change reduces the exclusion.</>}
        </p>
      </div>

      {/* Combined-exemption gauge — visualize how close the household is to the (fed_excl_y1 + fed_excl_y2) ceiling. */}
      {(() => {
        const g = computeCombinedExemptionMetrics(estateResult);
        if (!g) return null;
        const c = TIER_COLORS[g.tier];
        return (
          <div data-testid="cr-estate-exemption-gauge"
               style={{ padding: 12, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, marginTop: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: c.fg, margin: 0 }}>{g.headline}</p>
              <p style={{ fontSize: 10, fontWeight: 600, color: c.fg, margin: 0, fontVariantNumeric: "tabular-nums" }}>
                {g.pctDisplay.toFixed(1)}% of combined exemption consumed
              </p>
            </div>
            {/* Bar */}
            <div style={{ height: 8, background: "#FFFFFF", border: "1px solid #EBE8E0", borderRadius: 999, marginTop: 8, marginBottom: 4, position: "relative", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, g.pctDisplay) / 150 * 100}%`, background: c.bar, borderRadius: 999 }} />
              {g.pctDisplay > 100 && (
                <div style={{ position: "absolute", top: 0, left: `${100 / 150 * 100}%`,
                              width: `${Math.min(50, g.pctDisplay - 100) / 150 * 100}%`, height: "100%",
                              background: "#B84A4A" }} />
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7.5, color: "#5A5A5A", marginTop: 2 }}>
              <span>0</span>
              <span>50%</span>
              <span style={{ fontWeight: 700, color: "#4A6741" }}>Y1 excl = {fmtUSD(g.y1)}</span>
              <span style={{ fontWeight: 700, color: "#4A6741" }}>Combined = {fmtUSD(g.combinedAvailable)}</span>
              <span style={{ color: "#B84A4A" }}>150%+</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
              <div>
                <p style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 0.3, color: "#5A5A5A", margin: 0 }}>
                  Household estate at Y{g.secondDeathYear}
                </p>
                <p style={{ fontFamily: "Outfit, sans-serif", fontSize: 13, fontWeight: 700, color: c.fg, margin: 0, fontVariantNumeric: "tabular-nums" }}>
                  {fmtUSD(g.consumed)}
                </p>
              </div>
              <div>
                <p style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 0.3, color: "#5A5A5A", margin: 0 }}>
                  Fed excl Y1 + Y2 combined
                </p>
                <p style={{ fontFamily: "Outfit, sans-serif", fontSize: 13, fontWeight: 700, color: "#4A6741", margin: 0, fontVariantNumeric: "tabular-nums" }}>
                  {fmtUSD(g.combinedAvailable)}
                </p>
              </div>
              <div>
                <p style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: 0.3, color: "#5A5A5A", margin: 0 }}>
                  {g.pct >= 1 ? "Exposed above ceiling" : "Headroom remaining"}
                </p>
                <p style={{ fontFamily: "Outfit, sans-serif", fontSize: 13, fontWeight: 700,
                             color: g.pct >= 1 ? "#B84A4A" : "#4A6741", margin: 0, fontVariantNumeric: "tabular-nums" }}>
                  {g.pct >= 1 ? "+" : "−"}{fmtUSD(Math.abs(g.consumed - g.combinedAvailable))}
                </p>
              </div>
            </div>
            <p style={{ fontSize: 9.5, lineHeight: 1.5, color: "#1A1A1A", margin: 0, marginTop: 8 }}>
              {g.narrative}
            </p>
          </div>
        );
      })()}

      {/* Reference KPI row — neutral spread across all 4 modeled structures */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <Kpi label="Largest modeled net-to-heirs" value={fmtUSD(bestNet)} tone="green" sub={`In year ${estateResult.second_death_year}`} />
        <Kpi label="Smallest modeled net-to-heirs" value={fmtUSD(worstNet)} sub="Across the 4 structures" />
        <Kpi label="Range across strategies" value={fmtUSD(range)} tone={range > 0 ? "green" : "gray"} sub="Largest vs. smallest spread" />
      </div>

      {/* 4-column detail table */}
      <H3>Strategy detail (all figures at Year {estateResult.second_death_year})</H3>
      <table style={{ width: "100%", fontSize: 9.5, marginBottom: 8, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid #4A6741", background: "#F9F8F6" }}>
            <th style={{ padding: 5, textAlign: "left" }}>Metric</th>
            {STRATEGY_ORDER.map((k) => (
              <th key={k} style={{ padding: 5, textAlign: "right", color: "#5A5A5A", fontWeight: 600 }}>
                {STRATEGY_LABELS[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { label: "Y2 estate value", get: (o) => o.estate_y2 },
            { label: "Federal estate tax", get: (o) => o.fed_tax, negative: true },
            { label: `State estate tax${estateResult.state_code ? ` (${estateResult.state_code})` : ""}`, get: (o) => o.state_tax, negative: true },
            { label: "DSUE captured", get: (o) => o.dsue },
            { label: "Trust value at Y2 (post-basis)", get: (o) => o.trust_value_at_y2, tone: "green" },
            { label: "Household to heirs (after tax)", get: (o) => o.household_after_tax_at_y2 },
            { label: "Net to heirs at Y2", get: (o) => o.net_to_heirs_at_y2, bold: true },
          ].map((row, ri) => (
            <tr key={ri} style={{ borderBottom: "1px solid #F3F1EC" }}>
              <td style={{ padding: 5, color: "#5A5A5A" }}>{row.label}</td>
              {STRATEGY_ORDER.map((k) => {
                const v = row.get(outcomes[k]);
                const color = row.tone === "green" ? "#4A6741"
                  : row.negative && v > 0 ? "#B84A4A"
                  : "#1A1A1A";
                return (
                  <td key={k} style={{ padding: 5, textAlign: "right", fontVariantNumeric: "tabular-nums",
                    fontWeight: row.bold ? 800 : 400, color }}>
                    {v !== 0 ? fmtUSD(v) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Multi-gen horizons */}
      <H3>Multi-generational compounding</H3>
      <Sub>
        {estateResult.growth_basis === "projection" ? (
          <>Between the deaths, every asset class follows the retirement projection&apos;s actual path — net of the
          household&apos;s real spending, taxes, and conversions — so the second-death base above reconciles to the
          rest of this report. After the second death, trust portions compound at
          {" "}{(estateResult.trust_growth_rate * 100).toFixed(1)}% gross (Roth-in-trust is income-tax free during its
          SECURE 10-year window from the funding death) and household portions at
          {" "}{(estateResult.survivor_growth_rate * 100).toFixed(1)}% with per-vehicle heir clocks.</>
        ) : (
          <>Trust portions compound at {(estateResult.trust_growth_rate * 100).toFixed(1)}% gross. Roth-in-trust is
          income-tax free during its SECURE 10-year window (starting at the funding death), then bears compressed
          trust-bracket drag on retained income. Taxable-in-trust bears drag from the year it enters (no grace).
          Household portions at {(estateResult.survivor_growth_rate * 100).toFixed(1)}%.</>
        )}
      </Sub>
      <table style={{ width: "100%", fontSize: 9.5, marginBottom: 8, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid #4A6741", background: "#F9F8F6" }}>
            <th style={{ padding: 5, textAlign: "left" }}>Horizon</th>
            <th style={{ padding: 5, textAlign: "right" }}>Year</th>
            {STRATEGY_ORDER.map((k) => (
              <th key={k} style={{ padding: 5, textAlign: "right", color: "#5A5A5A", fontWeight: 600 }}>
                {STRATEGY_LABELS[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {estateResult.post_death_horizons.map((h) => (
            <tr key={h.year} style={{ borderBottom: "1px solid #F3F1EC" }}>
              <td style={{ padding: 5, fontWeight: 700 }}>{h.years_after_second_death === 0 ? "Second death" : `+${h.years_after_second_death}y`}</td>
              <td style={{ padding: 5, textAlign: "right" }}>{h.year}</td>
              {STRATEGY_ORDER.map((k) => (
                <td key={k} style={{ padding: 5, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#1A1A1A" }}>
                  {fmtUSD(h[`${k}_total`])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Flowcharts */}
      <H3>Estate flow — simplest vs. dynasty</H3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#B8B4A8", marginBottom: 4 }}>Portability-Only</div>
          <FlowchartPortability />
        </div>
        <div>
          <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#4A6741", marginBottom: 4 }}>Layered GST-Exempt Trust</div>
          <FlowchartGST />
        </div>
      </div>

      {/* GST-exemption-not-portable — the analytical foundation for favoring the GST trust over pure portability */}
      <div style={{ padding: 12, background: "#F1F5EF", border: "1px solid #4A6741", borderRadius: 6, marginBottom: 10 }}
           data-testid="cr-estate-gst-portability-note">
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#4A6741", marginBottom: 6, letterSpacing: 0.2 }}>
          GST exemption is NOT portable — DSUE only covers the estate tax exemption
        </div>
        <p style={{ fontSize: 10.5, lineHeight: 1.6, color: "#1A1A1A", margin: 0 }}>
          A frequently overlooked asymmetry drives the case for building a bypass/GST trust at the first death instead
          of relying purely on portability. The <strong>estate tax exemption</strong> ($15M in 2026 under OBBBA, chained-CPI
          indexed) IS portable via DSUE — a timely-filed Form 706 lets the surviving spouse claim the decedent&apos;s
          unused exclusion. The <strong>GST exemption</strong>, however, <em>is not portable</em>. If the first spouse
          to die leaves everything to the surviving spouse via marital deduction and no GST-exempt trust is funded at
          Y1, that spouse&apos;s <strong>entire GST exemption is not utilized</strong> and cannot be recovered later.
          Creating a bypass trust at
          first death — and allocating the decedent&apos;s GST exemption to it via Form 706 Schedule R — is the
          standard workaround: the trust becomes a permanently GST-exempt vehicle that shelters every subsequent
          generation&apos;s transfers from the 40% GST tax, on top of the estate-tax shelter. For families expecting
          to transfer wealth to grandchildren, preserving both spouses&apos; GST exemptions is often more valuable
          than the estate-tax-only saving reflected in the headline delta above.
        </p>
      </div>

      {/* Why Roth-plus-trust works when Traditional-plus-trust fails */}
      <div style={{ padding: 12, background: "#F9F8F6", border: "1px solid #EBE8E0", borderRadius: 6, marginBottom: 10 }}
           data-testid="cr-estate-roth-trust-rationale">
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#4A6741", marginBottom: 6, letterSpacing: 0.2 }}>
          Why Roth funds a trust cleanly, and Traditional doesn&apos;t
        </div>
        <p style={{ fontSize: 10.5, lineHeight: 1.6, color: "#1A1A1A", margin: 0, marginBottom: 6 }}>
          <strong>The pre-conversion dilemma.</strong> Trusts are terrible at receiving ordinary income — an
          accumulation trust hits the 37% + 3.8% NIIT ceiling at roughly <strong>$16,000 of retained income</strong>,
          so a Traditional IRA draining through the SECURE Act 10-year window into a trust converts a 24–36% tax
          problem into a ~41% one. The historical workaround — <em>conduit</em> trust drafting — passes distributions
          straight out to beneficiaries at individual rates, but the 10-year rule then forces the entire IRA out of
          the trust within a decade: no creditor protection, no divorce protection, no spendthrift control, no GST
          leverage on those dollars. Pre-conversion, families faced a forced choice: <strong>tax efficiency (conduit)
          or asset control (accumulation), never both.</strong>
        </p>
        <p style={{ fontSize: 10.5, lineHeight: 1.6, color: "#1A1A1A", margin: 0, marginBottom: 6 }}>
          <strong>Conversion dissolves the dilemma.</strong> A Roth flowing to an accumulation trust still faces the
          10-year payout, but the distributions <strong>arrive tax-free</strong>, so the compressed trust brackets
          have nothing to bite. The trustee retains and reinvests the full proceeds behind the trust&apos;s
          protections. Ongoing dividends, interest, and realized gains inside the trust are then taxed at trust rates
          or carried out annually to beneficiaries via DNI at their individual rates — <em>trustee discretion</em>,
          year by year. Every dollar converted before death is a dollar that can go to the trust with <strong>full
          control AND full tax efficiency</strong>; every un-converted Traditional dollar forces the old bad choice
          between spousal rollover (deferral but no trust protection, back into the survivor&apos;s estate) and trust
          funding at punitive compressed rates.
        </p>
        <p style={{ fontSize: 9.5, lineHeight: 1.55, color: "#5A5A5A", margin: 0, fontStyle: "italic" }}>
          See the preceding narrative page (&quot;The Estate + GST Case for Roth Conversions&quot;) for the full
          advisor-voice discussion, including drafting cautions and the sequencing case for finishing conversions
          before the first death.
        </p>
      </div>

      {/* Warning */}
      <div style={{ padding: 10, background: "#FEFAF1", border: "1px solid #C87941", borderRadius: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#8A5A20", marginBottom: 4 }}>
          ⚠ Traditional IRA / 401(k) never routed to trusts
        </div>
        <p style={{ fontSize: 9.5, lineHeight: 1.5, color: "#8A5A20", margin: 0 }}>
          Trusts holding pre-tax retirement assets trigger the SECURE Act&apos;s 10-year drawdown and compress income into
          trust brackets (<strong>37% federal at only ~$16K of retained income</strong>). In every strategy above, the
          household&apos;s Traditional IRA balance stays with the surviving spouse via rollover; heirs draw down at their
          assumed <strong>{(estateResult.heir_marginal_rate * 100).toFixed(2)}%</strong> blended (federal + state) marginal rate over the 10-year window.
          <strong> Convert to Roth during life</strong> — the trust benefit only fully materializes when the asset inside
          is income-tax free through the SECURE 10-year distribution window (which is why Roth is routed FIRST into every
          bypass/GST trust modeled here). After the 10-year window the Roth wrapper must be emptied; retained trust income
          is then taxed at compressed trust rates regardless of the wrapper.
        </p>
      </div>

      {/* Trustee planning note */}
      <div style={{ padding: 10, background: "#F1F5EF", border: "1px solid #4A6741", borderRadius: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#4A6741", marginBottom: 4 }}>
          Trustee planning note — compressed brackets favor distributions
        </div>
        <p style={{ fontSize: 9.5, lineHeight: 1.5, color: "#1A1A1A", margin: 0 }}>
          {TRUSTEE_DISTRIBUTION_NOTE}
        </p>
        <p style={{ fontSize: 9.5, lineHeight: 1.5, color: "#1A1A1A", margin: 0, marginTop: 5 }}>
          In practice: trustee reviews annually with beneficiaries&apos; tax advisors to (a) carry out DNI on dividends,
          interest, and other ordinary items; (b) generally <strong>retain</strong> capital gains inside the trust — the
          20% vs. 15% LTCG spread is a small toll compared with the protection + compounding benefits of keeping the
          corpus intact; and (c) distribute appreciated assets in-kind only when a beneficiary&apos;s need justifies
          breaking the trust&apos;s shelter. <em>Due to a Trust&apos;s compressed income tax brackets, it is generally
          advisable not to let ordinary income accumulate inside the Trust past year-end. However, this is subject to
          the circumstances of the beneficiary which must be separately considered in light of the Grantor&apos;s
          intentions as expressed in the governing instrument.</em>
        </p>
      </div>

      {/* Legal caveat */}
      <div style={{ padding: 10, background: "#F9F8F6", border: "1px solid #EBE8E0", borderRadius: 6 }}>
        <p style={{ fontSize: 9, lineHeight: 1.5, color: "#5A5A5A", margin: 0 }}>
          <strong>Legal caveat:</strong> This analysis models the math of estate/GST tax leverage under 2025 tax law
          (OBBBA-permanent brackets, chained-CPI indexing). It does not draft trust documents, elect a GST allocation
          on Form 706 Schedule R, evaluate the interaction between state law variations, community-property titling,
          Rule Against Perpetuities, or the specific accumulation-vs.-conduit structure of any trust.
          <strong> You must consult a qualified estate-planning attorney before developing or implementing any estate plan.</strong>
        </p>
      </div>
    </Page>
  );
};
