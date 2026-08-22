import { useMemo } from "react";
import { fmtUSD } from "@/lib/api";
import { buildMilestoneBridge } from "@/lib/convertSkip";
import { makePv } from "@/lib/pv";
import { HoldConstantBand } from "@/components/shared/PrintBlocks";
import { McBehaviorNote } from "@/components/shared/McBehaviorNote";
import { ConvertSkipNarrative, ConvertSkipFootnote } from "@/lib/convertSkipCopy";
import { Page, H2, H3, P, Sub, Kpi } from "./helpers";

/**
 * ConvertSkipPage — the "convert or don't convert" question answered at the two
 * milestones that matter (second death, then the end of the heirs' SECURE-10
 * window). Math lives in lib/convertSkip.js and is shared with the
 * Convert-or-Skip tab and the Presentation deck.
 *
 * Every difference is shown twice: nominal, and discounted to today. A
 * $1,000,000 difference four decades out is not a $1,000,000 difference now,
 * and the client-facing framing should say so on the same line.
 */
// Δ as a share of the don't-convert figure on the same row — a $2M swing on a
// $35M estate is a different conversation from a $2M swing on a $6M estate.
export const pctOfBase = (delta, base) => {
  if (!Number.isFinite(base) || Math.abs(base) < 1) return "—";
  const pct = (delta / Math.abs(base)) * 100;
  const abs = Math.abs(pct);
  const digits = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
  return `${pct >= 0 ? "+" : "−"}${abs.toFixed(digits)}%`;
};

const BridgeRow = ({ line, pv }) => {
  const delta = (line.a || 0) - (line.b || 0);
  const deltaPv = delta * pv.at(line.pvYear);
  const pctTxt = pctOfBase(delta, line.b);
  return (
    <tr style={{ borderBottom: "1px solid #F3F1EC", fontWeight: line.bold ? 700 : 400 }}
        data-testid={`cr-convert-skip-row-${line.key}`}>
      <td style={{ padding: "5px 4px", fontSize: 10.5 }}>
        {line.negative ? "− " : ""}{line.label}
        {line.sub && (
          <span style={{ display: "block", fontSize: 8.5, color: "#8A8578", fontWeight: 400 }}>{line.sub}</span>
        )}
      </td>
      <td style={{ padding: "5px 4px", textAlign: "right", fontSize: 10.5, fontVariantNumeric: "tabular-nums",
                   color: "#4A6741", background: "#4A67410D" }}>{fmtUSD(line.a)}</td>
      <td style={{ padding: "5px 4px", textAlign: "right", fontSize: 10.5, fontVariantNumeric: "tabular-nums",
                   color: "#C87941" }}>{fmtUSD(line.b)}</td>
      <td style={{ padding: "5px 4px", textAlign: "right", fontSize: 10.5, fontVariantNumeric: "tabular-nums",
                   color: delta >= 0 ? "#4A6741" : "#C87941" }}>
        {delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(delta))}
      </td>
      <td style={{ padding: "5px 4px", textAlign: "right", fontSize: 10.5, fontVariantNumeric: "tabular-nums",
                   color: deltaPv >= 0 ? "#4A6741" : "#C87941", background: "#F9F8F6" }}>
        {deltaPv >= 0 ? "+" : "−"}{fmtUSD(Math.abs(deltaPv))}
      </td>
      <td style={{ padding: "5px 4px", textAlign: "right", fontSize: 10.5, fontVariantNumeric: "tabular-nums",
                   color: pctTxt === "—" ? "#8A8578" : delta >= 0 ? "#4A6741" : "#C87941" }}
          data-testid={`cr-convert-skip-pct-${line.key}`}>
        {pctTxt}
      </td>
    </tr>
  );
};

const head = { padding: "6px 4px", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "right" };

export const ConvertSkipPage = ({ withRoth, noRoth, scenario, pvRateOverride, ...footProps }) => {
  const bridge = useMemo(() => buildMilestoneBridge(withRoth, noRoth), [withRoth, noRoth]);
  const pv = useMemo(() => makePv(scenario, pvRateOverride, withRoth?.rows),
    [scenario, pvRateOverride, withRoth]);
  if (!bridge) return null;

  const deathDelta = bridge.grossA - bridge.grossB;
  const endDelta = bridge.endA - bridge.endB;
  const taxDelta = bridge.lifetimeTaxA - bridge.lifetimeTaxB;
  const deathDeltaPv = deathDelta * pv.at(bridge.secondDeathYear);
  const endDeltaPv = endDelta * pv.at(bridge.windowEnd);
  const pvOf = (v, y) => fmtUSD(Math.abs(v * pv.at(y)));

  return (
    <Page testid="cr-page-convert-skip" {...footProps}>
      <H2>Convert or Don&apos;t Convert — the same plan, two milestones</H2>
      <HoldConstantBand testid="cr-convert-skip-band"
        variable="Roth conversions — the modeled schedule vs none at all"
        constant="spending, returns, longevity, funding order, beneficiary assumption" />
      <ConvertSkipNarrative P={P} pvRate={pv.rate} />
      <McBehaviorNote variant="line" testid="cr-convert-skip-mc-note" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}
           data-testid="cr-convert-skip-kpis">
        <Kpi label={`Net worth at 2nd death${bridge.secondDeathYear ? ` (${bridge.secondDeathYear})` : ""}`}
             value={fmtUSD(bridge.grossA)} tone={deathDelta >= 0 ? "green" : "orange"}
             sub={`${deathDelta >= 0 ? "+" : "−"}${fmtUSD(Math.abs(deathDelta))} vs no conversions · ${deathDeltaPv >= 0 ? "+" : "−"}${fmtUSD(Math.abs(deathDeltaPv))} in today's $`} />
        <Kpi label={`Heirs' net worth at end of SECURE-10${bridge.windowEnd ? ` (${bridge.windowEnd})` : ""}`}
             value={fmtUSD(bridge.endA)} tone={endDelta >= 0 ? "green" : "orange"}
             sub={`${endDelta >= 0 ? "+" : "−"}${fmtUSD(Math.abs(endDelta))} vs no conversions · ${endDeltaPv >= 0 ? "+" : "−"}${fmtUSD(Math.abs(endDeltaPv))} in today's $`} />
        <Kpi label="Lifetime tax you pay" value={fmtUSD(bridge.lifetimeTaxA)}
             tone={taxDelta <= 0 ? "green" : "orange"}
             sub={`${taxDelta <= 0 ? "−" : "+"}${fmtUSD(Math.abs(taxDelta))} vs no conversions (nominal)`} />
        <Kpi label="Heirs' inherited-IRA tax" value={fmtUSD(bridge.heirTaxA)} tone="green"
             sub={`vs ${fmtUSD(bridge.heirTaxB)} with no conversions (${pvOf(bridge.heirTaxB, bridge.windowEnd)} in today's $)`} />
      </div>

      <H3>How the first milestone becomes the second</H3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 2 }}
             data-testid="cr-convert-skip-bridge">
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A" }}>
            <th style={{ ...head, textAlign: "left" }}>Bridge between the two milestones</th>
            <th style={{ ...head, background: "#4A67410D" }}>Convert</th>
            <th style={head}>Don&apos;t convert</th>
            <th style={head}>Δ nominal</th>
            <th style={{ ...head, background: "#F9F8F6" }}>Δ in today&apos;s $</th>
            <th style={head}>Δ as % of plan</th>
          </tr>
        </thead>
        <tbody>
          {bridge.lines.map((line) => <BridgeRow key={line.key} line={line} pv={pv} />)}
        </tbody>
      </table>

      <ConvertSkipFootnote Sub={Sub} bridge={bridge} pvStart={pv.start} pvRate={pv.rate} />
    </Page>
  );
};

export default ConvertSkipPage;
