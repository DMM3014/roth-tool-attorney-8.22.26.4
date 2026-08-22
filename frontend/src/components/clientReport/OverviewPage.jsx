import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub, Kpi, StaticLegend, useIsolation } from "./helpers";

export const OverviewPage = ({ withRoth, noRoth, rows, nwSeries, mcResult, ...footProps }) => {
  const donutIso = useIsolation();
  const wealthIso = useIsolation();
  const lg = withRoth?.legacy || {};
  const lgn = noRoth?.legacy || {};
  const success = mcResult?.with_conversions?.success;
  const succPct = success != null ? Math.round(success * 100) : null;
  const succColor = succPct == null ? "#999" : succPct >= 90 ? "#4A6741" : succPct >= 75 ? "#C4A64A" : "#C87941";

  const lastRow = rows[rows.length - 1] || {};
  const nwDonut = [
    { name: "Cash", value: Math.max(0, lastRow.cash || 0) },
    { name: "Taxable", value: Math.max(0, lastRow.taxable || 0) },
    { name: "Traditional", value: Math.max(0, lastRow.traditional || 0) },
    { name: "Roth", value: Math.max(0, lastRow.roth || 0) },
  ].filter((d) => d.value > 0);
  const donutColors = { Cash: "#B8B4A8", Taxable: "#C4A64A", Traditional: "#C87941", Roth: "#4A6741" };
  const totalNw = nwDonut.reduce((t, x) => t + x.value, 0);
  const homeEnd = Math.max(0, lastRow.real_estate || 0);

  const retRows = rows.filter((r) => (r.cashflow?.rmd || 0) > 0 || (r.cashflow?.gross_ss || 0) > 0);
  const avg = (getter) => retRows.length ? retRows.reduce((t, r) => t + getter(r), 0) / retRows.length : 0;
  const avgIncome = avg((r) => (r.cashflow?.wages_pension || 0) + (r.cashflow?.gross_ss || 0)
    + (r.cashflow?.dividends || 0) + (r.cashflow?.interest || 0) + (r.cashflow?.rmd || 0));
  const avgLivingExpenses = avg((r) => r.cashflow?.expenses || 0);
  const avgTaxMedicare = avg((r) => (r.cashflow?.income_tax || 0) + (r.cashflow?.medicare || 0));

  return (
    <Page testid="cr-page-overview" {...footProps}>
      <H2>Overview</H2>
      <P>
        Here&apos;s the plan at a glance. The gauge below shows how often the plan succeeds across hundreds of
        different market futures. The chart tracks your projected household wealth year by year — with your
        conversion strategy in green and the &ldquo;no conversions&rdquo; baseline in a lighter tone.
      </P>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ border: "1px solid #EBE8E0", borderRadius: 8, padding: 14, background: "#FAFAF8", textAlign: "center" }}>
          <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase", color: "#5A5A5A", fontWeight: 700 }}>
            Chance of Plan Success
          </div>
          <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 48, fontWeight: 700, color: succColor, lineHeight: 1.1, marginTop: 4 }}
               data-testid="cr-success-gauge">
            {succPct != null ? `${succPct}%` : "…"}
          </div>
          {succPct != null && (
            <>
              <div style={{
                height: 8, background: "#F3F1EC", borderRadius: 4, overflow: "hidden", marginTop: 6,
                WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
              }}>
                <div style={{
                  height: "100%", width: `${succPct}%`, background: succColor,
                  WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
                }} />
              </div>
              <div style={{ fontSize: 9.5, color: "#5A5A5A", marginTop: 6 }}>
                Across {mcResult?.n_trials || 500} simulated market futures, the plan does not deplete in about {succPct}% of them.
              </div>
            </>
          )}
        </div>

        <div style={{ border: "1px solid #EBE8E0", borderRadius: 8, padding: 10, background: "#FAFAF8" }}>
          <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase", color: "#5A5A5A", fontWeight: 700, textAlign: "center" }}
               data-testid="cr-overview-investable-label">
            Investable Wealth at 2nd Death · {fmtUSD(totalNw)}
          </div>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={nwDonut} dataKey="value" nameKey="name" innerRadius={32} outerRadius={54}
                  isAnimationActive={false} paddingAngle={1}>
                  {nwDonut.map((d) => (
                    <Cell key={d.name} fill={donutColors[d.name]}
                      {...donutIso.dim(d.name)} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmtUSD(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <StaticLegend
            items={nwDonut.map((d) => ({ label: d.name, color: donutColors[d.name], dataKey: d.name }))}
            isolated={donutIso.isolated}
            onToggle={donutIso.toggle}
            testid="cr-overview-donut-legend"
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
        <Kpi label="Avg. Income" tone="green" value={fmtUSD(avgIncome)} sub="Retirement years (RMD/SS active)" />
        <Kpi label="Avg. Living Expenses" tone="orange" value={fmtUSD(avgLivingExpenses)} sub="User-defined spending only" />
        <Kpi label="Avg. Tax + Medicare" tone="orange" value={fmtUSD(avgTaxMedicare)} sub="Incl. tax on Roth conversions & IRMAA" />
        <Kpi label="Extra to Heirs" tone="green"
          value={fmtUSD((lg.after_tax_estate_to_heirs || 0) - (lgn.after_tax_estate_to_heirs || 0))}
          sub="After-tax, +10 yr window" />
      </div>

      <H3>Projected household wealth</H3>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={nwSeries} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} width={42} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Line type="monotone" dataKey="withRoth" stroke="#4A6741" strokeWidth={2.2} dot={false} isAnimationActive={false} name="With strategy" />
            <Line type="monotone" dataKey="withoutRoth" stroke="#C4A64A" strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} name="Without conversions" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={[
          { label: "With strategy", color: "#4A6741" },
          { label: "Without conversions", color: "#C4A64A" },
        ]}
        size={9}
        testid="cr-overview-nw-legend"
      />
      <Sub>
        Wealth line: <strong>investable accounts only</strong> (cash + taxable + traditional + Roth) — home equity
        is not included{homeEnd > 0 ? ` (projected home value at end of plan: ${fmtUSD(homeEnd)})` : ""}. The EP
        Projection pages report the <em>gross estate</em>, which adds the home — the two figures differ by exactly
        that amount. The green line reflects your active strategy; the amber dashed line shows the same household
        without any Roth conversions.
      </Sub>
    </Page>
  );
};
