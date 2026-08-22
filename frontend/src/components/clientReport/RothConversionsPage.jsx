import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, LabelList,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, P, Sub, Kpi } from "./helpers";

/**
 * RothConversionsPage — dedicated Client Report page that reproduces the
 * "Planned Roth Conversions by Year" bar chart from the Analytics tab.
 *
 * Advisors specifically wanted this in the Client Report right after the
 * Overview so the reader sees the CONVERSION SCHEDULE before any tax /
 * savings analysis. It answers the client's first question — "when do we
 * actually convert?" — before the report talks about the effects.
 */
export const RothConversionsPage = ({ rows, withRoth, scenario, ...footProps }) => {
  const data = useMemo(() => (rows || [])
    .map((r) => ({ year: r.year, conversion: r.roth_conversion || 0 }))
    .filter((d) => d.conversion > 0), [rows]);

  const totalConverted = data.reduce((t, d) => t + d.conversion, 0);
  const conversionYears = data.length;
  const largest = data.reduce((acc, d) => d.conversion > (acc?.amt || 0)
    ? { yr: d.year, amt: d.conversion } : acc, null);
  const firstYr = data[0]?.year;
  const lastYr = data[data.length - 1]?.year;
  const s = withRoth?.summary || {};
  const roth = scenario?.roth || {};
  const permittedStart = roth.enabled ? roth.start_year : null;
  const permittedEnd = roth.enabled ? roth.end_year : null;
  // The plan is PERMITTED to convert through `roth.end_year`, but modeled
  // conversions stop earlier once the Traditional IRA is exhausted (or the
  // target bracket leaves no headroom). Labeling both closes the discrepancy
  // between this page and the Assumptions page / appendix.
  const windowDiffers = permittedEnd != null && lastYr != null && permittedEnd !== lastYr;

  return (
    <Page testid="cr-page-roth-conversions" {...footProps}>
      <H2>Planned Roth Conversions by Year</H2>
      <P>
        This is the year-by-year Roth conversion schedule the plan executes. Each bar is a taxable event —
        moving pre-tax Traditional IRA dollars into a tax-free Roth account and paying the tax at today&apos;s
        marginal rates. Every downstream chart in this report (RMDs, IRMAA, cumulative tax, ending balances)
        flows from this schedule.
      </P>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 12 }}
           data-testid="cr-roth-conversions-kpis">
        <Kpi label="Total converted" value={fmtUSD(totalConverted)} tone="green"
             sub={`Ending Roth balance: ${fmtUSD(s.ending_roth || 0)}`} />
        <Kpi label="Years with a conversion" value={String(conversionYears)} tone="green" />
        <Kpi label="Largest single-year conversion"
             value={largest ? fmtUSD(largest.amt) : "—"}
             sub={largest ? `in ${largest.yr}` : null} tone="green" />
        <Kpi label="Conversion window — actually modeled"
             value={firstYr && lastYr ? `${firstYr}–${lastYr}` : "—"}
             sub={permittedEnd != null ? `Permitted through ${permittedEnd}` : null}
             tone="black" />
      </div>

      {windowDiffers && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6,
                      border: "1px solid #EBE8E0", background: "#F9F8F6" }}
             data-testid="cr-roth-conversions-window-note">
          <p style={{ fontSize: 10, lineHeight: 1.55, margin: 0, color: "#2A2A2A" }}>
            <strong>Permitted window: {permittedStart}–{permittedEnd}. Actual modeled conversions:
            {" "}{firstYr}–{lastYr} ({conversionYears} years).</strong> The strategy allows conversions through
            {" "}{permittedEnd}, but the Traditional IRA is exhausted — or the target bracket leaves no
            headroom — after {lastYr}, so no further conversion is modeled. Elsewhere in this report the
            longer date is the <em>permitted</em> window, not a forecast of conversions in every one of those
            years.
          </p>
        </div>
      )}

      {data.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#8A8578", fontStyle: "italic" }}
             data-testid="cr-roth-conversions-empty">
          The current plan does not include any Roth conversions.
        </div>
      )}

      {data.length > 0 && (
        <div data-docx-rasterize="roth-conversions-chart"
             style={{ width: "100%", height: 240, marginTop: 14 }}
             data-testid="cr-roth-conversions-chart">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 20, right: 24, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
              <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#5A5A5A" }} interval={0}
                     angle={-30} textAnchor="end" height={40} />
              <YAxis tick={{ fontSize: 10, fill: "#5A5A5A" }}
                     tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={54} />
              <Tooltip formatter={(v) => fmtUSD(v)} labelFormatter={(l) => `Year ${l}`} />
              <Bar dataKey="conversion" fill="#7A5C7E" name="Roth Conversion" isAnimationActive={false}
                   radius={[3, 3, 0, 0]}>
                <LabelList dataKey="conversion" position="top" fontSize={8.5} fill="#5A5A5A"
                           formatter={(v) => `$${Math.round(v / 1e3)}K`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <Sub>
        The strategy label above the plan (see Cover) explains how these amounts are sized — typically by
        &ldquo;filling&rdquo; a marginal-bracket target each year without triggering a jump to the next
        bracket. Conversions can be paused any year if market conditions or health events change the
        client&apos;s priorities.
      </Sub>
    </Page>
  );
};

export default RothConversionsPage;
