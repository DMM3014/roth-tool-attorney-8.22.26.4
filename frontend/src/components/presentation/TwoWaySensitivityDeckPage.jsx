import { fmtUSD, fmtPct } from "@/lib/api";
import { HoldConstantBand } from "@/components/shared/PrintBlocks";
import { Page, H2, P, Sub } from "./printPrimitives";

/**
 * TwoWaySensitivityDeckPage — the Client Deck version of the heat-grid: the Roth-
 * conversion delta in after-tax wealth to heirs across every heir income-tax rate
 * (rows) and every market regime (columns), with a per-regime break-even row and
 * the "judge across the whole surface" discipline note. Data: POST /api/two-way-sensitivity.
 */
const GREEN = "74, 103, 65";
const AMBER = "184, 122, 60";

const cellBg = (delta, maxAbs) => {
  if (delta == null || Math.abs(delta) < 1 || maxAbs <= 0) return "transparent";
  const rgb = delta > 0 ? GREEN : AMBER;
  const a = Math.min(0.85, 0.12 + (Math.abs(delta) / maxAbs) * 0.73);
  return `rgba(${rgb}, ${a.toFixed(3)})`;
};
const cellText = (delta) =>
  delta == null ? "—" : (Math.abs(delta) < 1 ? "$0" : `${delta >= 0 ? "+" : "−"}${fmtUSD(Math.abs(delta))}`);
const railColor = (delta) => {
  if (delta == null || Math.abs(delta) < 1) return "transparent";
  return delta > 0 ? `rgba(${GREEN},0.95)` : `rgba(${AMBER},0.95)`;
};

export const TwoWaySensitivityDeckPage = ({ twoWay, includeNarrative = true, showToday = false }) => {
  const d = twoWay;
  if (!d || !d.matrix || d.matrix.length === 0) return null;
  const useToday = !!(showToday && d.matrix_today);
  const matrix = useToday ? d.matrix_today : d.matrix;
  const maxAbs = Math.max(1, ...matrix.flat().filter((v) => v != null).map((v) => Math.abs(v)));

  return (
    <Page testid="presentation-page-two-way">
      <H2>Two-Way Sensitivity — Heir Rate × Market Regime</H2>
      <HoldConstantBand testid="deck-two-way-band"
        variable="both the heirs' assumed tax rate AND the market regime"
        constant="conversion schedule, spending, longevity, estate structure" />

      <div style={{ background: "#EEF3EC", border: "1px solid rgba(74,103,65,0.35)", borderRadius: 6,
                    padding: "8px 12px", margin: "6px 0 8px" }} data-testid="deck-two-way-headline">
        <p style={{ fontSize: 12, color: "#1A1A1A", margin: 0 }}>
          Conversions win in <strong style={{ color: "#4A6741" }}>{d.wins_at_modeled} of {d.n_regimes}</strong> market
          regimes at your modeled heir rate{d.modeled_rate != null ? ` of ${fmtPct(d.modeled_rate)}` : ""}.
        </p>
      </div>

      <P>
        Every cell is the after-tax wealth delivered to heirs <strong>with</strong> the conversion plan minus{" "}
        <strong>without</strong> it, at that heir income-tax rate and market regime. Green = converting wins; amber =
        leaving the pre-tax IRA in place wins. The left rail on each column shades the winning zone up to its
        break-even rate.
      </P>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }} data-testid="deck-two-way-grid">
        <thead>
          <tr>
            <th style={{ padding: "4px 5px", fontSize: 9, fontWeight: 700, textAlign: "left", borderBottom: "1.5px solid #4A6741" }}>Heir income-tax rate</th>
            {d.regimes.map((rg) => (
              <th key={rg.preset_id} style={{ padding: "4px 5px", fontSize: 8.5, fontWeight: 700, textAlign: "center", borderBottom: "1.5px solid #4A6741" }}>{rg.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rates.map((rate, ri) => (
            <tr key={rate}>
              <td style={{ padding: "4px 6px", fontSize: 9.5, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid #F3F1EC" }}>{d.rate_labels[ri]}</td>
              {d.regimes.map((rg, ci) => {
                const delta = matrix[ri][ci];
                return (
                  <td key={rg.preset_id} data-testid={`deck-two-way-cell-${ri}-${ci}`}
                    style={{ padding: "4px 3px", fontSize: 8.5, fontWeight: 700, textAlign: "center",
                             fontVariantNumeric: "tabular-nums", color: "#1A1A1A", border: "1px solid #FFFFFF",
                             borderLeft: `3px solid ${railColor(delta)}`, background: cellBg(delta, maxAbs) }}>
                    {cellText(delta)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid #4A6741" }}>
            <td style={{ padding: "5px 6px", fontSize: 9.5, fontWeight: 800, color: "#4A6741" }}>Break-even heir rate</td>
            {d.regimes.map((rg, ci) => {
              const be = d.break_even[ci];
              return (
                <td key={rg.preset_id}
                  style={{ padding: "5px 3px", fontSize: 9, fontWeight: 800, textAlign: "center",
                           fontVariantNumeric: "tabular-nums",
                           color: be.rate == null ? "#8A8A8A" : (be.extrapolated ? "#8A5A20" : "#4A6741") }}>
                  {be.rate == null ? "n/a" : fmtPct(be.rate)}
                  {be.rate != null && be.extrapolated && (
                    <span style={{ display: "block", fontSize: 6.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>extrapolated</span>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 8, borderLeft: "3px solid #4A6741", paddingLeft: 10 }}>
        <p style={{ fontSize: 10, lineHeight: 1.5, color: "#3A3A3A", fontStyle: "italic", margin: 0 }}
           data-testid="deck-two-way-caption">
          {d.caption}
        </p>
      </div>

      <Sub>
        Deltas are {useToday
          ? `after-tax dollars to heirs discounted to ${d.start_year || "plan-start"} dollars (each regime by its own assumed CPI)`
          : "nominal after-tax dollars to heirs at the end of the SECURE-10 window"}. The 0% row doubles as the
        charitable-beneficiary case (no income tax on the inherited IRA). Break-even rates flagged
        &ldquo;extrapolated&rdquo; fall outside the 0–41% grid.
      </Sub>

      {includeNarrative && (
        <P>
          A single quoted break-even rate hides how much the answer depends on markets. Read the surface, not one cell:
          where most regimes are green at your family&apos;s likely heir rate, the case for converting is robust; where
          the column flips amber early, it is rate- and market-sensitive and worth revisiting as facts change.
        </P>
      )}
    </Page>
  );
};

export default TwoWaySensitivityDeckPage;
