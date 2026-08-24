import { fmtUSD, fmtPct } from "@/lib/api";
import { Page, H2, P, Sub, PvFootnote } from "./helpers";

/**
 * Regime Comparison print page for the Client Report.
 *
 * Renders the same rows the interactive MonteCarlo tab's RegimeComparePanel does, but
 * as a compact print-ready table that fits on one page. Handles both the "single"
 * mode (no behavioral rules active) and the paired mode (with + without behavior)
 * that ships when guardrail or halt is on — paired rows are indented under their
 * regime with a "+N pts from behavior" chip so clients see the resilience-from-plan
 * vs. resilience-from-behavior split.
 */
export const RegimeCompareReportPage = ({ regimeData, regimeDetData, ...footProps }) => {
  const rows = regimeData?.rows || [];
  const paired = !!regimeData?.include_no_behavior_pair;

  if (!rows.length) {
    return (
      <Page testid="cr-page-regime-compare" {...footProps}>
        <H2>Regime Comparison</H2>
        <P>
          Regime comparison is still running. This page will populate with each named market
          preset's success rate side-by-side once the batch simulation finishes.
        </P>
      </Page>
    );
  }

  // Primary rows (with_behavior in paired mode; all rows otherwise) drive winner/loser labels.
  const primaryRows = paired ? rows.filter((r) => r.variant === "with_behavior") : rows;
  const winner = primaryRows[0];
  const loser = primaryRows[primaryRows.length - 1];
  const baselineId = regimeData.baseline_id;
  const baseline = primaryRows.find((r) => r.preset_id === baselineId) || winner;
  const spreadPts = Math.round((winner.success - loser.success) * 100);

  return (
    <Page testid="cr-page-regime-compare" {...footProps}>
      <H2>Regime Comparison — Does the Plan Depend on Which Future Happens?</H2>
      <P>
        We re-ran the same {regimeData.n_trials.toLocaleString()}-trial Monte Carlo simulation
        under every named market regime and reported each one's success rate. Answers the
        client's most common question: <em>&ldquo;how much does this recommendation depend on
        which future we assume?&rdquo;</em> Range across regimes:
        <strong> {spreadPts} percentage points</strong> from best (
        <strong>{winner.label}</strong>) to worst (<strong>{loser.label}</strong>).
        {paired && (
          <> Sub-rows show each regime <strong>without</strong> the behavioral rules so you
          can see how much resilience comes from the plan itself vs. the guardrail/halt.</>
        )}
      </P>
      <table style={{ width: "100%", fontSize: 9.5, borderCollapse: "collapse", marginTop: 10 }}>
        <thead>
          <tr style={{ background: "#F3F1EC", color: "#5A5A5A" }}>
            <th style={thStyle}>Market regime</th>
            <th style={thStyleRight}>Success</th>
            <th style={thStyleRight}>Δ vs baseline</th>
            <th style={thStyleRight}>P10 ending</th>
            <th style={thStyleRight}>P50 ending</th>
            <th style={thStyleRight}>P90 ending</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isPair = paired && r.variant === "no_behavior";
            const primaryIdx = primaryRows.findIndex((p) => p.preset_id === r.preset_id);
            const isPrimary = !paired || r.variant === "with_behavior";
            const isBaseline = isPrimary && r.preset_id === baselineId;
            const isWinner = isPrimary && primaryIdx === 0;
            const isLoser = isPrimary && primaryIdx === primaryRows.length - 1;
            const delta = r.success - baseline.success;
            const sibling = isPair ? primaryRows.find((p) => p.preset_id === r.preset_id) : null;
            const behaviorLift = sibling ? sibling.success - r.success : 0;
            return (
              <tr key={`${r.preset_id}-${r.variant || "single"}`}
                  style={{ borderBottom: "1px solid #EBE8E0",
                           background: isBaseline ? "#4A67410D" : (isPair ? "#FAFAF8" : "#FFFFFF") }}>
                <td style={{ ...tdStyle, paddingLeft: isPair ? 18 : 6 }}>
                  {isWinner && <span style={{ color: "#4A6741" }}>★ </span>}
                  <span style={{ fontWeight: isPair ? 400 : 600, color: isPair ? "#5A5A5A" : "#1A1A1A" }}>
                    {isPair ? "— without behavioral rules" : r.label}
                  </span>
                  {isBaseline && (
                    <span style={badgeStyle("#C87941")}>Your baseline</span>
                  )}
                  {isLoser && !isBaseline && (
                    <span style={badgeStyle("#8A8A82")}>Worst case</span>
                  )}
                  {isPair && behaviorLift > 0.001 && (
                    <span style={badgeStyle("#4A6741")}>+{Math.round(behaviorLift * 100)} pts from behavior</span>
                  )}
                  {isPair && behaviorLift < -0.001 && (
                    <span style={badgeStyle("#C87941")}>{Math.round(behaviorLift * 100)} pts behavior cost</span>
                  )}
                </td>
                <td style={{ ...tdStyleRight, fontWeight: 700,
                             color: r.success >= 0.90 ? "#4A6741" : r.success >= 0.75 ? "#8A6820" : "#B84A4A" }}>
                  {fmtPct(r.success)}
                </td>
                <td style={{ ...tdStyleRight, color: delta > 0.001 ? "#4A6741" : delta < -0.001 ? "#C87941" : "#8A8A82" }}>
                  {isPair || isBaseline ? "—" : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} pts`}
                </td>
                <td style={tdStyleRight}>{fmtUSD(r.p10)}</td>
                <td style={tdStyleRight}>{fmtUSD(r.p50)}</td>
                <td style={tdStyleRight}>{fmtUSD(r.p90)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Sub>
        Every regime uses seed = 42 so trial-to-trial differences between regimes are driven
        entirely by the regime's assumed return + inflation profile — not by luck of the draw.
        Engine: {regimeData.engine === "historical" ? "historical bootstrap" : "lognormal"}.
        Each regime re-centers the plan's deterministic return assumptions; year-to-year variability
        is bootstrapped from full 1928–2024 US market history. The simulation anchors to the plan's
        own implied return path, floored at the plan's average assumed return whenever the
        deterministic plan depletes — so a stressed regime's upper tail stays economically bounded
        rather than compounding a depletion artifact.
        {paired && " Paired sub-rows share the same seed as their parent, so the delta between them is entirely due to the behavioral rules (guardrail and/or halt)."}
      </Sub>

      {regimeDetData && regimeDetData.rows && regimeDetData.rows.length > 0 && (() => {
        const drows = regimeDetData.rows;
        const worstId = drows.reduce((w, r) =>
          ((r.with_conversions?.after_tax_to_heirs_secure10 ?? Infinity) <
           (w.with_conversions?.after_tax_to_heirs_secure10 ?? Infinity)) ? r : w, drows[0]).preset_id;
        return (
          <div style={{ marginTop: 16 }} data-testid="cr-regime-det-section">
            <H2>Deterministic Outcomes by Regime</H2>
            <P>
              These are <strong>single-path deterministic runs</strong> — the full projection re-run under each
              regime&apos;s own return &amp; inflation profile, not a scaling of the baseline. The Monte Carlo table
              above shows the dispersion <em>around</em> these central outcomes. Dollars to heirs are at the end of the
              SECURE{regimeDetData.heir_deliver_year ? ` window (Y${regimeDetData.heir_deliver_year})` : " window"};
              the conversion Δ is after-tax wealth to heirs with vs. without the conversion plan, shown in nominal and
              today&apos;s dollars (each regime discounted by its own assumed CPI).
            </P>
            <table style={{ width: "100%", fontSize: 9.5, borderCollapse: "collapse", marginTop: 8 }}
                   data-testid="cr-regime-det-table">
              <thead>
                <tr style={{ background: "#F3F1EC", color: "#5A5A5A" }}>
                  <th style={thStyle}>Market regime</th>
                  <th style={thStyleRight}>Net worth @ 2nd death</th>
                  <th style={thStyleRight}>To heirs — conv</th>
                  <th style={thStyleRight}>To heirs — no conv</th>
                  <th style={thStyleRight}>Δ nominal</th>
                  <th style={thStyleRight}>Δ today&apos;s $</th>
                </tr>
              </thead>
              <tbody>
                {drows.map((r) => {
                  const isBaseline = r.preset_id === regimeDetData.baseline_id;
                  const isWorst = r.preset_id === worstId;
                  const dNom = r.conversion_delta_to_heirs_nominal || 0;
                  const dTdy = r.conversion_delta_to_heirs_today || 0;
                  return (
                    <tr key={r.preset_id} data-testid={`cr-regime-det-row-${r.preset_id}`}
                        style={{ borderBottom: "1px solid #EBE8E0",
                                 background: isWorst ? "#B84A4A12" : (isBaseline ? "#4A67410D" : "#FFFFFF") }}>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600 }}>{r.label}</span>
                        {isBaseline && <span style={badgeStyle("#C87941")}>Your baseline</span>}
                        {isWorst && <span style={badgeStyle("#B84A4A")}>Worst regime</span>}
                      </td>
                      <td style={tdStyleRight}>{fmtUSD(r.with_conversions?.net_worth_at_second_death)}</td>
                      <td style={{ ...tdStyleRight, fontWeight: 700 }}>{fmtUSD(r.with_conversions?.after_tax_to_heirs_secure10)}</td>
                      <td style={tdStyleRight}>{fmtUSD(r.no_conversions?.after_tax_to_heirs_secure10)}</td>
                      <td style={{ ...tdStyleRight, fontWeight: 700, color: dNom >= 0 ? "#4A6741" : "#B84A4A" }}>
                        {dNom >= 0 ? "+" : "−"}{fmtUSD(Math.abs(dNom))}
                      </td>
                      <td style={{ ...tdStyleRight, color: dTdy >= 0 ? "#4A6741" : "#B84A4A" }}>
                        {dTdy >= 0 ? "+" : "−"}{fmtUSD(Math.abs(dTdy))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Sub>
              Single deterministic path per regime (no random draws). The Monte Carlo table above is the dispersion
              around these numbers. The worst regime by after-tax wealth to heirs is highlighted so this report never
              shows only the baseline case.
            </Sub>
            <PvFootnote testid="cr-regime-det-pv-footnote" />
          </div>
        );
      })()}
    </Page>
  );
};

// -------------- inline styles (kept local to keep the print bundle self-contained) --------
const thStyle = { padding: "6px", textAlign: "left", fontSize: 9,
                  fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" };
const thStyleRight = { ...thStyle, textAlign: "right" };
const tdStyle = { padding: "6px", fontSize: 10 };
const tdStyleRight = { padding: "6px", fontSize: 10, textAlign: "right",
                       fontVariantNumeric: "tabular-nums" };
const badgeStyle = (color) => ({
  display: "inline-block",
  marginLeft: 6,
  padding: "1px 6px",
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color,
  background: `${color}1a`,
  border: `1px solid ${color}`,
  borderRadius: 999,
});
