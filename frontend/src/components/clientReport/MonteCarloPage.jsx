import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, P, Sub, Kpi, StaticLegend, useIsolation } from "./helpers";

export const MonteCarloReportPage = ({ mcResult, ...footProps }) => {
  const iso = useIsolation();
  const wc = mcResult?.with_conversions;
  const success = wc?.success;
  const succPct = success != null ? Math.round(success * 100) : null;
  const succColor = succPct == null ? "#999" : succPct >= 90 ? "#4A6741" : succPct >= 75 ? "#C4A64A" : "#C87941";
  const pctData = useMemo(() => {
    if (!wc?.percentiles || !mcResult?.years) return [];
    return mcResult.years.map((y, i) => ({
      year: y,
      p10: wc.percentiles.p10?.[i] || 0,
      p50: wc.percentiles.p50?.[i] || 0,
      p90: wc.percentiles.p90?.[i] || 0,
    }));
  }, [wc, mcResult]);

  // Surface the actual allocation used by the MC engine so the reader can
  // judge whether it resembles their client's real portfolio. These come
  // straight from the MC result payload (montecarlo.py DEFAULT_ASSETS unless
  // overridden by the caller).
  const mcAssets = mcResult?.assets || {};
  const wStk = Math.round((mcAssets.stocks?.weight ?? 0.6) * 100);
  const wBnd = Math.round((mcAssets.bonds?.weight ?? 0.3) * 100);
  const wCsh = Math.round((mcAssets.cash?.weight ?? 0.1) * 100);
  const engineLabel = mcResult?.engine === "historical"
    ? "historical (block-bootstrap 1928–2024 real US market data)"
    : mcResult?.engine === "lognormal"
    ? "statistical (lognormal per-class draws with historical correlations)"
    : (mcResult?.engine || "historical");
  const guardrailActive = !!mcResult?.guardrail_info;
  const haltInfo = mcResult?.conversion_halt;
  const haltActive = !!(haltInfo && haltInfo.enabled);
  const haltDropPct = haltActive ? Math.round((haltInfo.drop_threshold || 0) * 100) : null;
  const haltTrigPct = haltActive ? Math.round((haltInfo.triggered_pct || 0) * 100) : null;
  // Phase 55: surface the stress / correlation / inflation state directly from the
  // MC payload so this section stops silently disagreeing with what the reader
  // actually ran. Every field falls back to a null-safe "OFF" string.
  const shockInfo = mcResult?.shock;
  const shockActive = !!shockInfo;
  const shockRatePct = shockActive ? Math.round((shockInfo.rate ?? -0.20) * 100) : null;
  const shockYrs = shockActive ? (shockInfo.years ?? 2) : null;
  // Detect which named preset (if any) is active based on the payload signature.
  const isStagflationPreset = shockActive
    && Math.abs((shockInfo.rate ?? 0) - -0.15) < 1e-6
    && (shockInfo.years ?? 0) === 2
    && mcResult?.inflation?.enabled
    && Math.abs((mcResult.inflation.mean ?? 0) - 0.055) < 1e-6;
  const isEarlyBearPreset = shockActive
    && Math.abs((shockInfo.rate ?? 0) - -0.20) < 1e-6
    && (shockInfo.years ?? 0) === 2
    && !isStagflationPreset;
  const stressPresetLabel = isStagflationPreset
    ? "2022-style Stagflation preset"
    : isEarlyBearPreset
    ? "Early Bear Market Stress preset"
    : shockActive
    ? `custom shock (${shockRatePct}% for ${shockYrs} yr${shockYrs === 1 ? "" : "s"})`
    : "OFF";
  const corrInfo = mcResult?.correlation;
  const corrEnabled = !!(corrInfo && corrInfo.enabled);
  const inflInfo = mcResult?.inflation;
  const inflEnabled = !!(inflInfo && inflInfo.enabled);
  const inflMeanPct = inflEnabled ? (inflInfo.mean * 100).toFixed(1) : null;
  const inflVolPct = inflEnabled ? (inflInfo.vol * 100).toFixed(1) : null;

  return (
    <Page testid="cr-page-montecarlo" {...footProps}>
      <H2>Monte Carlo — How Robust Is the Plan?</H2>
      {!mcResult ? (
        <P>Monte Carlo simulation is still running. It runs {mcResult?.n_trials || 500} independent market futures and reports the range of outcomes.</P>
      ) : (
        <>
          <P>
            We re-ran the plan under <strong>{mcResult.n_trials.toLocaleString()}</strong> different market futures drawn
            from real market history. In <strong>{succPct}%</strong> of those futures the plan does not deplete — the
            household reaches second death with money left over. The band below shows the middle 80% of outcomes: the
            best-10% line at the top, the median in the middle, and the worst-10% line at the bottom.
          </P>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "center", marginTop: 8 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 46, fontWeight: 700, color: succColor, lineHeight: 1 }}
                   data-testid="cr-mc-success">
                {succPct}%
              </div>
              <div style={{ fontSize: 10, color: "#5A5A5A", marginTop: 2 }}>Plan success rate</div>
            </div>
            <div>
              <div style={{ height: 145 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pctData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
                    <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} width={42} tickLine={false} />
                    <Tooltip formatter={(v) => fmtUSD(v)} />
                    <Area type="monotone" dataKey="p90" stroke="#4A6741" fill="#4A6741" fillOpacity={0.15} isAnimationActive={false} name="Top 10%" {...iso.dim("p90")} />
                    <Area type="monotone" dataKey="p50" stroke="#4A6741" fill="#4A6741" fillOpacity={0.35} isAnimationActive={false} name="Median" {...iso.dim("p50")} />
                    <Area type="monotone" dataKey="p10" stroke="#C87941" fill="#C87941" fillOpacity={0.2} isAnimationActive={false} name="Bottom 10%" {...iso.dim("p10")} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <StaticLegend
                items={[
                  { label: "Top 10%", color: "#4A6741", dataKey: "p90" },
                  { label: "Median", color: "#4A6741", dataKey: "p50" },
                  { label: "Bottom 10%", color: "#C87941", dataKey: "p10" },
                ]}
                isolated={iso.isolated}
                onToggle={iso.toggle}
                size={9}
                testid="cr-mc-percentiles-legend"
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
            <Kpi label="P10 ending wealth" value={fmtUSD(wc?.ending?.p10)} tone="orange" sub="Worst 10% futures" />
            <Kpi label="Median ending wealth" value={fmtUSD(wc?.ending?.p50)} />
            <Kpi label="P90 ending wealth" value={fmtUSD(wc?.ending?.p90)} tone="green" sub="Best 10% futures" />
          </div>

          {/* Distribution of plan outcomes — conversions / lifetime taxes /
              after-tax inheritance are distributions across trials, not the
              single deterministic numbers reported elsewhere in this report. */}
          {mcResult?.outcome_distributions && (() => {
            const od = mcResult.outcome_distributions;
            const conv = od.conversions;
            const taxes = od.lifetime_taxes;
            const inh = od.after_tax_inheritance;
            const fullPct = Math.round((conv?.pct_trials_full_plan || 0) * 100);
            const rows = [
              conv && ["Total Roth conversions executed", conv, conv.planned_total, "exact"],
              taxes && ["Lifetime taxes paid", taxes, taxes.det_value, "model-locked"],
              inh && ["After-tax inheritance", inh, inh.det_value, "approximation"],
            ].filter(Boolean);
            return (
              <div data-testid="cr-mc-outcome-dist" style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4 }}>
                  Distribution of plan outcomes — not just a success probability
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5 }}>
                  <thead>
                    <tr style={{ borderBottom: "1.5px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
                      <th style={{ padding: "4px 4px" }}>Metric</th>
                      <th style={{ padding: "4px 4px", textAlign: "right" }}>P10</th>
                      <th style={{ padding: "4px 4px", textAlign: "right" }}>Median</th>
                      <th style={{ padding: "4px 4px", textAlign: "right" }}>P90</th>
                      <th style={{ padding: "4px 4px", textAlign: "right" }}>Deterministic plan</th>
                      <th style={{ padding: "4px 4px", textAlign: "left" }}>Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, d, det, basis]) => (
                      <tr key={label} style={{ borderBottom: "1px solid #F3F1EC" }}>
                        <td style={{ padding: "4px 4px", fontWeight: 600 }}>{label}</td>
                        <td style={{ padding: "4px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(d.p10)}</td>
                        <td style={{ padding: "4px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmtUSD(d.p50)}</td>
                        <td style={{ padding: "4px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(d.p90)}</td>
                        <td style={{ padding: "4px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#5A5A5A" }}>{fmtUSD(det)}</td>
                        <td style={{ padding: "4px 4px", color: "#777", fontStyle: "italic" }}>{basis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 9, color: "#777", fontStyle: "italic", marginTop: 3, lineHeight: 1.5 }}>
                  {od.halt_active
                    ? <>With the drawdown-halt rule active, the full {fmtUSD(conv?.planned_total)} conversion schedule
                      executes in only <strong>{fullPct}%</strong> of trials — the deterministic conversion total and its
                      legacy benefit should not be read as assured. </>
                    : null}
                  &ldquo;Model-locked&rdquo; = taxes follow the locked cash-flow schedule (halted trials pay the
                  no-conversion tax stream; amounts inflation-scaled per trial). &ldquo;Approximation&rdquo; = the
                  deterministic heirs÷ending-wealth ratio applied to each trial&apos;s ending wealth, less heir tax on
                  conversions that trial skipped — directional, not an exact per-trial estate computation.
                </p>
                {/* Pause / resume badge — surfaces the halt-and-resume behavior as
                    data alongside the outcome table. Only rendered when the halt
                    rule actually engaged (at least one trial paused). */}
                {haltActive && haltTrigPct > 0 && (
                  <div data-testid="cr-mc-halt-resume-badge"
                       style={{ marginTop: 8, padding: "7px 10px", background: "#F1F5EF",
                                border: "1px solid #4A6741", borderRadius: 5,
                                fontSize: 10, lineHeight: 1.5, color: "#1A1A1A" }}>
                    <strong style={{ color: "#4A6741" }}>Halt & resume behavior:</strong>{" "}
                    <strong>{haltTrigPct}%</strong> of trials paused conversions in ≥1 year
                    {haltInfo.resume_after_positive_years > 0 ? (
                      haltInfo.trials_resumed > 0 ? (
                        <>, of which <strong>{Math.round((haltInfo.resumed_pct || 0) * 100)}%</strong> resumed
                        by year-end <strong>{haltInfo.median_resume_year || haltInfo.p90_resume_year}</strong>
                        {" "}(median resume year). The remaining paused trials stayed halted through the end of the
                        conversion window (
                        {haltInfo.conversion_window_end || "plan end"}
                        ){" "}because markets never delivered {haltInfo.resume_after_positive_years} consecutive
                        {" "}positive-return years after the drop.</>
                      ) : (
                        <>{" "}— and none resumed within the conversion window because markets never delivered
                        {" "}{haltInfo.resume_after_positive_years} consecutive positive-return years after the drop.</>
                      )
                    ) : (
                      <>{" "}and stayed halted permanently (no resume rule configured).</>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Methodology & limitations — full disclosure of what the simulation
              actually models and (crucially) what it does NOT. Advisor and
              client should read this before drawing conclusions. */}
          <div data-testid="cr-mc-methodology"
               style={{ marginTop: 10, padding: "10px 12px", border: "1px solid #EBE8E0",
                        borderLeft: "3px solid #C4A64A", background: "#FDFBF4",
                        borderRadius: 6, fontSize: 10, lineHeight: 1.5, color: "#1A1A1A" }}>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 10.5 }}>
              How this Monte Carlo was generated
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", marginBottom: 6 }}>
              <div><strong>Engine:</strong> {engineLabel}</div>
              <div><strong>Trials:</strong> {mcResult.n_trials.toLocaleString()} paired paths</div>
              <div><strong>Modeled allocation:</strong> {wStk}% stocks / {wBnd}% bonds / {wCsh}% cash (from Plan Inputs)</div>
              <div><strong>Rebalancing:</strong> {mcResult?.rebalance?.cadence === "biennial"
                ? "biennial (weights drift 1 year, snap back)"
                : mcResult?.rebalance?.cadence === "never"
                ? "never (weights drift for full horizon)"
                : "annual reset to target"}</div>
              <div><strong>Return anchor:</strong> re-centered on the plan&apos;s liquid-weighted assumed return</div>
              <div><strong>Spending guardrail:</strong> {guardrailActive ? "active" : "OFF — expenses do not adapt to markets"}</div>
              <div><strong>Stress preset:</strong> {stressPresetLabel}</div>
              <div><strong>Correlated draws:</strong> {corrEnabled ? "ON — historical cross-asset comovement applied" : "OFF — independent draws"}</div>
              <div><strong>Stochastic inflation:</strong> {inflEnabled
                ? `ON — ${inflMeanPct}% mean, ${inflVolPct}% vol (${inflInfo?.source || "modeled"})`
                : "OFF — deterministic plan inflation"}</div>
              <div><strong>Conversion schedule:</strong> {haltActive
                ? (haltInfo.resume_after_positive_years > 0
                    ? `adaptive — halt on ≥ ${haltDropPct}% YoY drop, resume after ${haltInfo.resume_after_positive_years} positive years (triggered in ${haltTrigPct}% of trials)`
                    : `adaptive — halt permanently on ≥ ${haltDropPct}% YoY drop (triggered in ${haltTrigPct}% of trials)`)
                : "LOCKED — same conversions run in every trial"}</div>
              <div><strong>Success definition:</strong> liquid portfolio never depletes through second death</div>
            </div>
            <div style={{ fontWeight: 700, marginTop: 6, marginBottom: 3 }}>
              Important — what these numbers do and do not represent
            </div>
            <div>
              These Monte Carlo results are a <strong>{mcResult?.engine === "historical" ? "historical bootstrap" : "statistical"}</strong> exercise, not a
              forecast. They resample real return sequences (or draw from statistical
              distributions) against the plan&apos;s cashflow schedule. The modeled {wStk}/{wBnd}/{wCsh} stocks/bonds/cash
              mix is taken from the <strong>Household Allocation card on Plan Inputs</strong>. Unless that entry
              reflects the client&apos;s actual total household allocation — and the portfolio is periodically
              rebalanced back to that mix across every account — the dispersion in this chart is unlikely to
              reflect the client&apos;s hypothetical outcomes; confirm the allocation card before relying on the
              success rate as a household-specific probability. {haltActive ? (
                <>The simulation <strong>does</strong> model an advisor drawdown-halt rule: any
                trial whose prior-year portfolio return falls below −{haltDropPct}% <strong>pauses</strong>
                its remaining Roth conversions
                {haltInfo.resume_after_positive_years > 0
                  ? <>, then <strong>resumes</strong> the schedule after {haltInfo.resume_after_positive_years}{" "}
                    consecutive positive-return years</>
                  : <> for the rest of the conversion window</>}
                {" "}({haltTrigPct}% of trials triggered the pause here). This adds bear-market realism to the
                dispersion — trials with early crashes no longer eat the full conversion tax bill
                on top of the loss{haltInfo.resume_after_positive_years > 0
                  ? <>, and paused conversions come back online once markets recover so the schedule isn&apos;t abandoned permanently on the first bad year</>
                  : null}. Other behavioral guardrails (e.g. discretionary spending cuts,
                re-prioritizing parents&apos; solvency over expected heir results) are NOT modeled;
                if a real-world plan would include them, actual outcomes would differ from what is
                shown here.</>
              ) : (
                <>Additionally, the simulation runs the same Roth conversion schedule in every
                trial: it does <strong>not</strong> pause, reduce, or cancel planned conversions
                when markets decline, and it does <strong>not</strong> re-prioritize parents&apos;
                solvency over expected heir results if a bear market hits during the conversion
                window. If a real-world plan would include those behavioral guardrails, actual
                outcomes would differ — typically showing lower conversion tax in bad markets and
                a higher parent-side success rate at the cost of a smaller heir legacy.</>
              )} Treat this page as sensitivity analysis, not a promise.
            </div>
          </div>

          <Sub>
            &ldquo;Success&rdquo; = the household never runs out of investable wealth over the plan horizon. The Monte
            Carlo engine anchors the average return to your plan&apos;s assumption and then bootstraps year-by-year
            variability from historical US market data, so both the best and worst runs stay tethered to real history.
          </Sub>
        </>
      )}
    </Page>
  );
};
