import { useMemo } from "react";
import { fmtUSD } from "@/lib/api";
import { buildMilestoneBridge } from "@/lib/convertSkip";
import { makePv } from "@/lib/pv";
import { HoldConstantBand } from "@/components/shared/PrintBlocks";
import { McBehaviorNote } from "@/components/shared/McBehaviorNote";
import { ConvertSkipNarrative, ConvertSkipFootnote } from "@/lib/convertSkipCopy";
import { pctOfBase } from "@/components/clientReport/ConvertSkipPage";
import { Page, H2, H3, P, Sub } from "./printPrimitives";

/**
 * ConvertSkipDeckPage — deck version of the convert-vs-don't-convert
 * comparison, placed right after the objectives page so the client sees the
 * trade-off before the detailed income / wealth / tax pages. Math is shared via
 * lib/convertSkip.js; every difference also appears in today's dollars.
 */
const Head = ({ children, right, highlight, tint }) => (
  <th style={{ padding: "6px 4px", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4,
               textAlign: right ? "right" : "left",
               background: highlight ? "#4A67410D" : (tint ? "#F9F8F6" : undefined) }}>
    {children}
  </th>
);

const Cell = ({ v, color, highlight, tint }) => (
  <td style={{ padding: "5px 4px", textAlign: "right", fontSize: 11, fontVariantNumeric: "tabular-nums",
               color, background: highlight ? "#4A67410D" : (tint ? "#F9F8F6" : undefined) }}>{v}</td>
);

export const ConvertSkipDeckPage = ({ withRoth, noRoth, scenario, pvRateOverride, includeNarrative = true }) => {
  const bridge = useMemo(() => buildMilestoneBridge(withRoth, noRoth), [withRoth, noRoth]);
  const pv = useMemo(() => makePv(scenario, pvRateOverride, withRoth?.rows),
    [scenario, pvRateOverride, withRoth]);
  if (!bridge) return null;

  const deathDelta = bridge.grossA - bridge.grossB;
  const endDelta = bridge.endA - bridge.endB;
  const taxDelta = bridge.lifetimeTaxA - bridge.lifetimeTaxB;
  const deathDeltaPv = deathDelta * pv.at(bridge.secondDeathYear);
  const endDeltaPv = endDelta * pv.at(bridge.windowEnd);

  const Headline = ({ label, a, b, delta, deltaPv, testid }) => (
    <div style={{ border: "1px solid #EBE8E0", borderRadius: 8, background: "#F9F8F6", padding: 10 }}
         data-testid={testid}>
      <p style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4, color: "#5A5A5A",
                  fontWeight: 700, margin: 0 }}>{label}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, color: "#4A6741" }}>
          {fmtUSD(a)}
        </span>
        <span style={{ fontSize: 9.5, color: "#777" }}>convert</span>
        <span style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, color: "#C87941" }}>
          {fmtUSD(b)}
        </span>
        <span style={{ fontSize: 9.5, color: "#777" }}>don&apos;t convert</span>
      </div>
      <p style={{ fontSize: 9.5, margin: "3px 0 0", color: delta >= 0 ? "#4A6741" : "#C87941", fontWeight: 600 }}>
        {delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(delta))} for converting
        <span style={{ color: "#777", fontWeight: 400 }}>
          {"  ·  "}{deltaPv >= 0 ? "+" : "−"}{fmtUSD(Math.abs(deltaPv))} in today&apos;s dollars
        </span>
      </p>
    </div>
  );

  return (
    <Page testid="presentation-page-convert-skip">
      <H2>Convert or Don&apos;t Convert</H2>
      <HoldConstantBand testid="deck-convert-skip-band"
        variable="Roth conversions — the modeled schedule vs none at all"
        constant="spending, returns, longevity, funding order, beneficiary assumption" />
      <ConvertSkipNarrative P={P} pvRate={pv.rate} includeNarrative={includeNarrative} />
      <McBehaviorNote variant="line" testid="deck-convert-skip-mc-note" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Headline testid="deck-convert-skip-death"
          label={`Net worth at 2nd death${bridge.secondDeathYear ? ` (${bridge.secondDeathYear})` : ""} — pre-heir tax`}
          a={bridge.grossA} b={bridge.grossB} delta={deathDelta} deltaPv={deathDeltaPv} />
        <Headline testid="deck-convert-skip-window"
          label={`Heirs' net worth at end of SECURE-10${bridge.windowEnd ? ` (${bridge.windowEnd})` : ""}`}
          a={bridge.endA} b={bridge.endB} delta={endDelta} deltaPv={endDeltaPv} />
      </div>

      <H3>From the second death to the end of the heirs&apos; window</H3>
      <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="deck-convert-skip-bridge">
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A" }}>
            <Head>Bridge between the two milestones</Head>
            <Head right highlight>Convert</Head>
            <Head right>Don&apos;t convert</Head>
            <Head right>Δ nominal</Head>
            <Head right tint>Δ in today&apos;s $</Head>
            <Head right>Δ as % of plan</Head>
          </tr>
        </thead>
        <tbody>
          {bridge.lines.map((line) => {
            const d = (line.a || 0) - (line.b || 0);
            const dPv = d * pv.at(line.pvYear);
            return (
              <tr key={line.key} style={{ borderBottom: "1px solid #F3F1EC", fontWeight: line.bold ? 700 : 400 }}
                  data-testid={`deck-convert-skip-row-${line.key}`}>
                <td style={{ padding: "5px 4px", fontSize: 11 }}>
                  {line.negative ? "− " : ""}{line.label}
                  {line.sub && (
                    <span style={{ display: "block", fontSize: 9, color: "#8A8578", fontWeight: 400 }}>{line.sub}</span>
                  )}
                </td>
                <Cell v={fmtUSD(line.a)} color="#4A6741" highlight />
                <Cell v={fmtUSD(line.b)} color="#C87941" />
                <Cell v={`${d >= 0 ? "+" : "−"}${fmtUSD(Math.abs(d))}`} color={d >= 0 ? "#4A6741" : "#C87941"} />
                <Cell v={`${dPv >= 0 ? "+" : "−"}${fmtUSD(Math.abs(dPv))}`}
                      color={dPv >= 0 ? "#4A6741" : "#C87941"} tint />
                <Cell v={pctOfBase(d, line.b)}
                      color={pctOfBase(d, line.b) === "—" ? "#8A8578" : d >= 0 ? "#4A6741" : "#C87941"} />
              </tr>
            );
          })}
          <tr style={{ borderBottom: "1px solid #F3F1EC" }} data-testid="deck-convert-skip-row-lifetime-tax">
            <td style={{ padding: "5px 4px", fontSize: 11 }}>
              Lifetime income tax you pay
              <span style={{ display: "block", fontSize: 9, color: "#8A8578" }}>
                Across the whole projection — the price of converting early
              </span>
            </td>
            <Cell v={fmtUSD(bridge.lifetimeTaxA)} color="#4A6741" highlight />
            <Cell v={fmtUSD(bridge.lifetimeTaxB)} color="#C87941" />
            <Cell v={`${taxDelta >= 0 ? "+" : "−"}${fmtUSD(Math.abs(taxDelta))}`}
                  color={taxDelta <= 0 ? "#4A6741" : "#C87941"} />
            <Cell v="see next page" color="#8A8578" tint />
            <Cell v={pctOfBase(taxDelta, bridge.lifetimeTaxB)}
                  color={taxDelta <= 0 ? "#4A6741" : "#C87941"} />
          </tr>
        </tbody>
      </table>

      <ConvertSkipFootnote Sub={Sub} bridge={bridge} pvStart={pv.start} pvRate={pv.rate} />
    </Page>
  );
};

export default ConvertSkipDeckPage;
