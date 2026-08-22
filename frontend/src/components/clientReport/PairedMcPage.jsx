import React from "react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine, Cell } from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, P, Sub, Kpi } from "./helpers";

/**
 * PairedMcPage — Client Report print page for the paired Roth-vs-no-Roth
 * Monte Carlo view. Mirrors `PairedRothVsNoRothCard` (the on-screen version
 * used on the MC tab) but rendered as a static print block so it slots into
 * the Client Report PDF/DOCX flow alongside the existing MC page.
 *
 * The pairing is meaningful because backend `montecarlo.run_montecarlo`
 * simulates both branches (with and without conversions) on the SAME market
 * draws inside a single request; per-trial Δ isolates the plan delta from
 * market noise.
 */
const fmtPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);

const buildHistData = (hist) => {
  if (!hist?.counts?.length || !hist?.edges?.length) return [];
  return hist.counts.map((c, i) => {
    const lo = hist.edges[i];
    const hi = hist.edges[i + 1];
    const mid = (lo + hi) / 2;
    return { mid, lo, hi, count: c, positive: mid >= 0 };
  });
};

const isConstant = (block) => {
  if (!block) return true;
  return block.p5 === block.p95 && block.p25 === block.p75;
};

const PctRow = ({ label, block, negativeMeansGood = false, testid }) => {
  if (!block) return null;
  const cellStyle = (v) => ({
    padding: "3px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums",
    color: (v > 0) === !negativeMeansGood ? "#4A6741"
         : (v < 0) === !negativeMeansGood ? "#C87941" : "#1A1A1A",
  });
  return (
    <tr data-testid={testid} style={{ borderBottom: "1px solid #F3F1EC" }}>
      <td style={{ padding: "3px 6px", color: "#5A5A5A" }}>{label}</td>
      <td style={cellStyle(block.p5)}>{fmtUSD(block.p5)}</td>
      <td style={cellStyle(block.p25)}>{fmtUSD(block.p25)}</td>
      <td style={cellStyle(block.p50)}>{fmtUSD(block.p50)}</td>
      <td style={cellStyle(block.p75)}>{fmtUSD(block.p75)}</td>
      <td style={cellStyle(block.p95)}>{fmtUSD(block.p95)}</td>
      <td style={cellStyle(block.mean)}>{fmtUSD(block.mean)}</td>
    </tr>
  );
};

export const PairedMcPage = ({ mcResult, ...footProps }) => {
  const pd = mcResult?.paired_delta;
  const end = pd?.ending_delta;
  const tax = pd?.lifetime_tax_delta;
  const endHist = buildHistData(end?.histogram);
  const taxConstant = isConstant(tax);

  return (
    <Page testid="cr-page-paired-mc" {...footProps}>
      <H2>Paired Monte Carlo — Roth strategy vs no conversions on the same market seeds</H2>
      <P>
        Because the Monte Carlo engine runs BOTH the with-conversion and the without-conversion cashflows
        against the same market draws, we can compute a per-trial difference and isolate the pure plan
        delta from market noise. Positive values below mean the Roth strategy left MORE liquid wealth on
        that market seed.
      </P>
      <Sub>
        Ending-wealth Δ is measured in nominal dollars at the projection horizon. Lifetime-tax Δ is the
        difference in cumulative tax paid over the client&apos;s lifetime. In the current inflation model
        the lifetime-tax path is inflation-scaled only, so all seeds return the same number unless
        stochastic inflation is enabled on the toolbar — we show a single value in that case rather than a
        misleading percentile fan.
      </Sub>

      {!pd && (
        <div style={{ padding: 40, textAlign: "center", color: "#8A8578", fontStyle: "italic" }}
             data-testid="cr-paired-mc-empty">
          Run the Monte Carlo simulation first — the paired A/B view will render here.
        </div>
      )}

      {pd && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 10 }}
               data-testid="cr-paired-mc-kpis">
            <Kpi label="Trials with higher ending liquid wealth under Roth strategy"
                 value={fmtPct(end.pct_with_wins)} tone="black" />
            <Kpi label="Median Δ ending liquid wealth" value={fmtUSD(end.p50)}
                 tone={end.p50 >= 0 ? "green" : "orange"} />
            <Kpi label="Worst 5% Δ ending liquid wealth" value={fmtUSD(end.p5)}
                 tone={end.p5 >= 0 ? "green" : "orange"} />
            <Kpi label="Δ Lifetime tax paid"
                 value={tax ? fmtUSD(tax.p50) : "—"}
                 tone={(tax?.p50 ?? 0) < 0 ? "green" : (tax?.p50 ?? 0) > 0 ? "orange" : "black"} />
          </div>

          <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8,
                        border: "1px solid #C4A64A", background: "#C4A64A14" }}
               data-testid="cr-paired-mc-success-note">
            <p style={{ fontSize: 10.5, lineHeight: 1.6, margin: 0, color: "#1A1A1A" }}>
              <strong style={{ color: "#8A6A12" }}>This metric measures ONE definition of success.</strong>{" "}
              The percentage above counts only the trials where the Roth strategy ended with more
              <em> liquid portfolio value</em> at the second death. It is not an overall verdict. A family may
              reasonably define success as maximizing liquid portfolio value, minimizing the parents&apos;
              lifetime taxes, maximizing the after-tax inheritance, reducing a beneficiary&apos;s income-tax
              exposure, or moving assets into a different tax and estate structure. A single trial can show
              lower liquid wealth under the Roth strategy and still deliver a better after-tax result for a
              highly taxed beneficiary. This report deliberately does not rank the strategies.
            </p>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: "#1A1A1A", marginTop: 14 }}>
            Distribution of Δ ending wealth (with − without conversions)
          </div>
          <div data-docx-rasterize="paired-histogram"
               style={{ width: "100%", height: 200, marginTop: 4 }}>
            <ResponsiveContainer>
              <BarChart data={endHist} margin={{ top: 4, right: 24, left: 8, bottom: 24 }}>
                <XAxis dataKey="mid" type="number"
                  tickFormatter={(v) => fmtUSD(v)}
                  tick={{ fontSize: 9, fill: "#5A5A5A" }}
                  domain={["dataMin", "dataMax"]} />
                <YAxis tick={{ fontSize: 9, fill: "#5A5A5A" }} allowDecimals={false} />
                <Tooltip formatter={(v, _n, ctx) => [`${v} trials`,
                  `${fmtUSD(ctx.payload.lo)} → ${fmtUSD(ctx.payload.hi)}`]}
                  labelFormatter={() => ""} />
                <ReferenceLine x={0} stroke="#1A1A1A" strokeDasharray="3 3" strokeOpacity={0.4} />
                <Bar dataKey="count">
                  {endHist.map((entry, i) => (
                    <Cell key={i} fill={entry.positive ? "#4A6741" : "#C87941"} fillOpacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Sub>
            Green = Roth strategy ended with more liquid wealth on that seed; amber = less. Histogram is
            capped at ±p95 of |Δ|; trials outside that range roll into the outermost bins.
            {" "}Based on {pd.n_trials} paired trials; both branches survived on {fmtPct(pd.both_survive_pct)} of them.
          </Sub>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginTop: 10 }}
                 data-testid="cr-paired-mc-table">
            <thead>
              <tr style={{ borderBottom: "1px solid #C4A64A" }}>
                <th style={{ padding: "4px 6px", textAlign: "left", color: "#5A5A5A", fontSize: 9,
                             textTransform: "uppercase", letterSpacing: 0.4 }}>Metric</th>
                {["Worst 5%", "P25", "Median", "P75", "Best 5%", "Mean"].map((h) => (
                  <th key={h} style={{ padding: "4px 6px", textAlign: "right", color: "#5A5A5A",
                                       fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PctRow label="Δ ending wealth (with − without)" block={end}
                      testid="cr-paired-mc-row-ending" />
              {tax && !taxConstant && (
                <PctRow label="Δ lifetime tax paid (with − without)"
                        block={tax} negativeMeansGood testid="cr-paired-mc-row-tax" />
              )}
            </tbody>
          </table>

          {tax && taxConstant && (
            <Sub>
              Δ lifetime tax paid is the same in every trial ({fmtUSD(tax.p50)}) — the tax path is not
              per-seed repriced under the current inflation setting. Enable stochastic inflation on the
              Monte Carlo tab to see a paired-tax distribution.
            </Sub>
          )}

          <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8,
                        border: "1px solid #4A6741", background: "#4A67410D" }}
               data-testid="cr-paired-mc-strategy-note">
            <p style={{ fontSize: 10.5, lineHeight: 1.6, margin: 0, color: "#1A1A1A" }}>
              <strong style={{ color: "#4A6741" }}>Why the Roth path can show higher lifetime taxes.</strong>{" "}
              Lifetime Roth conversions will naturally produce more lifetime income taxes because the
              conversions are intended to pay income taxes on Traditional IRA assets during lifetime rather
              than leave them to heirs to be taxed at assumed higher rates. If, for any reason — including
              market downturns — longevity planning becomes more important than saving taxes, Roth IRA
              conversions can be stopped.
            </p>
          </div>
        </>
      )}
    </Page>
  );
};

export default PairedMcPage;
