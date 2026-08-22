import React from "react";

/**
 * SequenceRiskTable — one scenario per row group, mean-preserved and raw side by
 * side, every figure carrying its delta against the flat-return plan.
 *
 * Inline styles (not Tailwind) because the same component prints inside the
 * Client Report and the deck, where html2canvas only sees computed inline CSS.
 */
const m = (v) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}K` : `$${Math.round(a)}`;
  return v < 0 ? `−${s}` : s;
};
const signed = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${m(Math.abs(v)).replace("−", "")}`);
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);

const GREEN = "#4A6741";
const ORANGE = "#C87941";
const GREY = "#8A8578";

const th = {
  padding: "4px 3px", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.3,
  color: "#5A5A5A", textAlign: "right", fontWeight: 700,
};

const Cell = ({ value, delta, tone, tint }) => (
  <td style={{
    padding: "4px 3px", textAlign: "right", fontSize: 9.5, fontVariantNumeric: "tabular-nums",
    color: tone, background: tint ? "#4A67410D" : undefined, verticalAlign: "top",
  }}>
    {value}
    {delta !== undefined && (
      <span style={{ display: "block", fontSize: 7.5, color: GREY }}>{delta}</span>
    )}
  </td>
);

const VariantCells = ({ run, showDelta }) => {
  if (!run) return <><Cell value="—" /><Cell value="—" /><Cell value="—" /><Cell value="—" /><Cell value="—" /></>;
  const w = run.with_conversions || {};
  const vb = run.vs_baseline || {};
  const dry = w.depleted ? `Yes — ${w.depleted_year}` : "No";
  return (
    <>
      <Cell value={m(run.tax_saved_by_converting)}
            delta={showDelta ? `${signed(vb.tax_saved)} vs flat` : undefined}
            tone={run.tax_saved_by_converting >= 0 ? GREEN : ORANGE} tint />
      <Cell value={m(w.ending_portfolio)}
            delta={showDelta ? `${signed(vb.ending_portfolio)} vs flat` : undefined} />
      <Cell value={m(run.heirs_delta)}
            delta={showDelta ? `${signed(vb.heirs)} vs flat` : undefined}
            tone={(run.heirs_delta || 0) >= 0 ? GREEN : ORANGE} />
      <Cell value={pct(w.worst_portfolio_year_pct)}
            delta={w.worst_portfolio_year ? `in ${w.worst_portfolio_year}` : undefined}
            tone={ORANGE} />
      <Cell value={dry} tone={w.depleted ? ORANGE : GREY} />
    </>
  );
};

export const SequenceRiskTable = ({ data, testid = "sequence-risk-table" }) => {
  if (!data) return null;
  const byScenario = {};
  (data.scenarios || []).forEach((s) => {
    byScenario[s.scenario] = byScenario[s.scenario] || {};
    byScenario[s.scenario][s.variant] = s;
  });
  const order = ["early_bear", "late_bear_conversion", "late_bear_projection", "volatility"];
  const base = data.baseline || {};
  const bw = base.with_conversions || {};

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }} data-testid={testid}>
      <thead>
        <tr style={{ color: "#5A5A5A" }}>
          <th rowSpan={2} style={{ ...th, textAlign: "left", verticalAlign: "bottom" }}>Return sequence</th>
          <th colSpan={5} style={{ ...th, textAlign: "center", background: "#F1F5EF",
                                   borderBottom: "1px solid #4A6741" }}>
            Same long-run average as the plan
          </th>
          <th colSpan={5} style={{ ...th, textAlign: "center", background: "#FAF6F1",
                                   borderBottom: "1px solid #C87941" }}>
            Raw — a genuinely worse market
          </th>
        </tr>
        <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A" }}>
          {[0, 1].map((i) => (
            <React.Fragment key={i}>
              <th style={th}>Tax saved by converting</th>
              <th style={th}>Ending portfolio</th>
              <th style={th}>Heirs Δ from converting</th>
              <th style={th}>Worst year</th>
              <th style={th}>Runs dry?</th>
            </React.Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr style={{ borderBottom: "1px solid #F3F1EC", background: "#F9F8F6" }}
            data-testid="sequence-risk-row-baseline">
          <td style={{ padding: "4px 3px", fontSize: 9.5, fontWeight: 700 }}>
            Flat {pct(data.reference_return)} every year
            <span style={{ display: "block", fontSize: 7.5, color: GREY, fontWeight: 400 }}>
              The plan exactly as modeled everywhere else in this report
            </span>
          </td>
          <Cell value={m(base.tax_saved_by_converting)} tone={GREEN} tint />
          <Cell value={m(bw.ending_portfolio)} />
          <Cell value={m(base.heirs_delta)} tone={(base.heirs_delta || 0) >= 0 ? GREEN : ORANGE} />
          <Cell value={pct(bw.worst_portfolio_year_pct)}
                delta={bw.worst_portfolio_year ? `in ${bw.worst_portfolio_year}` : undefined} tone={GREY} />
          <Cell value={bw.depleted ? `Yes — ${bw.depleted_year}` : "No"} tone={GREY} />
        </tr>
        {order.map((key) => {
          const pair = byScenario[key];
          if (!pair) return null;
          const label = (pair.mean_preserved || pair.raw)?.label || key;
          const years = (pair.mean_preserved || pair.raw)?.bear_years || [];
          return (
            <tr key={key} style={{ borderBottom: "1px solid #F3F1EC" }}
                data-testid={`sequence-risk-row-${key}`}>
              <td style={{ padding: "4px 3px", fontSize: 9.5, fontWeight: 600 }}>
                {label}
                {years.length > 0 && (
                  <span style={{ display: "block", fontSize: 7.5, color: GREY, fontWeight: 400 }}>
                    Down years: {years[0]}–{years[years.length - 1]}
                  </span>
                )}
              </td>
              <VariantCells run={pair.mean_preserved} showDelta />
              <VariantCells run={pair.raw} showDelta />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default SequenceRiskTable;
