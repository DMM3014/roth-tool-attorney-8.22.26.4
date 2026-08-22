import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub, Kpi, StaticLegend, useIsolation } from "./helpers";

export const SavingsPage = ({ rows, composeData, withRoth, ...footProps }) => {
  const iso = useIsolation();
  const s = withRoth?.summary || {};
  const totalCon = s.total_roth_converted || 0;
  const conversionYears = rows.filter((r) => (r.roth_conversion || 0) > 0).length;
  const largestYr = rows.reduce((acc, r) => (r.roth_conversion || 0) > (acc?.amt || 0)
    ? { yr: r.year, amt: r.roth_conversion } : acc, null);
  const startNW = rows[0] ? (rows[0].cash + rows[0].taxable + rows[0].traditional + rows[0].roth) : 0;
  const endNW = rows.length ? (rows.at(-1).cash + rows.at(-1).taxable + rows.at(-1).traditional + rows.at(-1).roth) : 0;

  return (
    <Page testid="cr-page-savings" {...footProps}>
      <H2>Savings</H2>
      <P>
        Your savings evolve year by year as contributions, investment returns, withdrawals, and Roth conversions
        move dollars between accounts. Roth conversions are shown as internal transfers between the Traditional
        and Roth buckets — they don&apos;t leave the household, but they do trigger a tax bill in the year of the
        conversion.
      </P>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Kpi label="Starting investable wealth" value={fmtUSD(startNW)} sub="Excl. home equity" />
        <Kpi label="Ending investable wealth" value={fmtUSD(endNW)} tone="green" sub="Excl. home equity" />
        <Kpi label="Total converted (transfer)" value={fmtUSD(totalCon)} tone="orange"
          sub={`${conversionYears} year${conversionYears === 1 ? "" : "s"}`} />
        <Kpi label="Largest conversion year" value={largestYr ? fmtUSD(largestYr.amt) : "—"}
          sub={largestYr ? `Year ${largestYr.yr}` : ""} />
      </div>
      <H3>Balances by account, year by year</H3>
      <div style={{ height: 195 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={composeData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} width={42} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Area type="monotone" dataKey="Cash" stackId="1" stroke="#B8B4A8" fill="#B8B4A8" isAnimationActive={false} {...iso.dim("Cash")} />
            <Area type="monotone" dataKey="Taxable" stackId="1" stroke="#C4A64A" fill="#C4A64A" isAnimationActive={false} {...iso.dim("Taxable")} />
            <Area type="monotone" dataKey="Traditional" stackId="1" stroke="#C87941" fill="#C87941" isAnimationActive={false} {...iso.dim("Traditional")} />
            <Area type="monotone" dataKey="Roth" stackId="1" stroke="#4A6741" fill="#4A6741" isAnimationActive={false} {...iso.dim("Roth")} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={[
          { label: "Cash", color: "#B8B4A8", dataKey: "Cash" },
          { label: "Taxable", color: "#C4A64A", dataKey: "Taxable" },
          { label: "Traditional", color: "#C87941", dataKey: "Traditional" },
          { label: "Roth", color: "#4A6741", dataKey: "Roth" },
        ]}
        isolated={iso.isolated}
        onToggle={iso.toggle}
        size={9}
        testid="cr-savings-legend"
      />
      <Sub>
        Notice how the terra-cotta Traditional band shrinks and the green Roth band grows during the conversion window —
        the same dollars, moved from the taxed-later bucket into the never-taxed-again bucket. Roth conversions are a
        non-cash transfer; the tax bill they trigger is captured in the Taxes section.
      </Sub>
    </Page>
  );
};
