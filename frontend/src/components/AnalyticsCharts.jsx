import {
  Area, AreaChart, Bar, BarChart, Line, ComposedChart, Cell,
  CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, ReferenceLine, LabelList,
} from "recharts";
import { Card } from "@/components/ui/card";
import { fmtUSD, fmtPct } from "@/lib/api";

const C = { green: "#4A6741", sage: "#7A9B76", terra: "#C87941", sand: "#E6B89C", blue: "#4B7A94", plum: "#7A5C7E", clay: "#A8553A" };
const AXIS = { fontSize: 11 };
const R = [3, 3, 0, 0];
const usd = (v) => fmtUSD(v);
const mAxis = (v) => `$${(v / 1e6).toFixed(1)}M`;
const kAxis = (v) => `$${(v / 1e3).toFixed(0)}k`;
const pctAxis = (v) => `${(v * 100).toFixed(0)}%`;

const SPAN = { 1: "lg:col-span-1", 2: "lg:col-span-2" };
const Panel = ({ title, subtitle, testid, children, span = 2 }) => (
  <Card className={`print-card p-6 border-[#EBE8E0] shadow-none ${SPAN[span]}`} data-testid={testid}>
    <h3 className="font-display text-base font-bold tracking-tight">{title}</h3>
    {subtitle && <p className="text-[11px] text-muted-foreground mt-1 mb-3 max-w-3xl">{subtitle}</p>}
    {!subtitle && <div className="mb-3" />}
    {children}
  </Card>
);

// ---- 1. Income sources waterfall (stacked bar + spending line) ----
export const IncomeSourcesChart = ({ data }) => (
  <Panel testid="chart-income-sources" title="Sources of Income vs. Spending"
    subtitle="Each year's gross inflows stacked — wages/pension, Social Security, dividends, interest, RMDs, Roth conversions and portfolio withdrawals — against the total spending + tax need (line).">
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={kAxis} tick={AXIS} width={52} />
        <Tooltip formatter={usd} />
        <Legend />
        <Bar dataKey="Wages" name="Wages / Pension" stackId="i" fill={C.green} />
        <Bar dataKey="SocialSecurity" name="Social Security" stackId="i" fill={C.sage} />
        <Bar dataKey="Dividends" name="Dividends" stackId="i" fill={C.blue} />
        <Bar dataKey="Interest" name="Interest" stackId="i" fill={C.sand} />
        <Bar dataKey="RMD" name="RMD" stackId="i" fill={C.terra} />
        <Bar dataKey="Conversion" name="Roth Conversion" stackId="i" fill={C.plum} />
        <Bar dataKey="Withdrawals" name="Portfolio Withdrawals" stackId="i" fill={C.clay} radius={R} />
        <Line type="monotone" dataKey="Need" name="Spending + Taxes" stroke="#1A1A1A" strokeWidth={2.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 2. Tax bracket fill (stacked $ bars + marginal rate line) ----
const BRACKET_COLORS = ["#9DB89A", "#7A9B76", "#5E8157", "#4A6741", "#C87941", "#A8553A", "#7A3B28"];
export const BracketFillChart = ({ data, brackets }) => (
  <Panel testid="chart-bracket-fill" title="Tax Bracket Fill — Ordinary Taxable Income"
    subtitle="How each year's ordinary taxable income fills the indexed marginal brackets. The black line is the marginal rate the last dollar is taxed at — the lever Roth conversions push against.">
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis yAxisId="L" tickFormatter={kAxis} tick={AXIS} width={52} />
        <YAxis yAxisId="R" orientation="right" tickFormatter={pctAxis} tick={AXIS} width={42} domain={[0, 0.4]} />
        <Tooltip formatter={(v, n) => (n === "Marginal Rate" ? fmtPct(v) : usd(v))} />
        <Legend />
        {brackets.map((b, i) => (
          <Bar key={b} yAxisId="L" dataKey={b} name={b} stackId="b" fill={BRACKET_COLORS[i]} radius={i === brackets.length - 1 ? R : undefined} />
        ))}
        <Line yAxisId="R" type="stepAfter" dataKey="marginal" name="Marginal Rate" stroke="#1A1A1A" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 3. Spending vs funded need (surplus / shortfall) ----
export const SurplusChart = ({ data }) => (
  <Panel testid="chart-surplus" title="Annual Surplus / (Shortfall)" span={1}
    subtitle="Income (wages, SS, dividends, interest, RMDs) minus spending + taxes. Green years self-fund; orange years require selling from the portfolio to cover the gap.">
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={kAxis} tick={AXIS} width={52} />
        <Tooltip formatter={usd} />
        <ReferenceLine y={0} stroke="#9A9A9A" />
        <Bar dataKey="surplus" name="Surplus / (Shortfall)" radius={R}>
          {data.map((d) => <Cell key={d.year} fill={d.surplus >= 0 ? C.green : C.terra} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 4. Tax composition over time ----
export const TaxCompositionChart = ({ data }) => (
  <Panel testid="chart-tax-composition" title="Tax Composition Over Time" span={1}
    subtitle="The total annual burden split into federal ordinary tax, preferential (LTCG / qualified-dividend) tax, the 3.8% NIIT, state tax and Medicare / IRMAA surcharges.">
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={kAxis} tick={AXIS} width={52} />
        <Tooltip formatter={usd} />
        <Legend />
        <Bar dataKey="ordinary" name="Federal Ordinary" stackId="t" fill={C.green} />
        <Bar dataKey="preferential" name="LTCG / Dividends" stackId="t" fill={C.sage} />
        <Bar dataKey="niit" name="NIIT 3.8%" stackId="t" fill={C.blue} />
        <Bar dataKey="state" name="State" stackId="t" fill={C.sand} />
        <Bar dataKey="medicare" name="Medicare + IRMAA" stackId="t" fill={C.terra} radius={R} />
      </BarChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 5. RMD trajectory vs balances (dual axis) ----
export const RmdBalanceChart = ({ data }) => (
  <Panel testid="chart-rmd-balance" title="RMD Time-Bomb vs. Account Balances"
    subtitle="Forced RMDs (bars, right axis) climb as the Traditional IRA grows. Converting to Roth shrinks the Traditional balance and the RMDs it would otherwise force — while the tax-free Roth compounds.">
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis yAxisId="L" tickFormatter={mAxis} tick={AXIS} width={50} />
        <YAxis yAxisId="R" orientation="right" tickFormatter={kAxis} tick={AXIS} width={52} />
        <Tooltip formatter={usd} />
        <Legend />
        <Bar yAxisId="R" dataKey="rmd" name="RMD (right)" fill={C.terra} barSize={8} radius={R} />
        <Line yAxisId="L" type="monotone" dataKey="traditional" name="Traditional IRA" stroke={C.clay} strokeWidth={2.5} dot={false} />
        <Line yAxisId="L" type="monotone" dataKey="roth" name="Roth (tax-free)" stroke={C.green} strokeWidth={2.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 6. IRMAA stair-step ----
export const IrmaaChart = ({ data }) => (
  <Panel testid="chart-irmaa" title="IRMAA Cliff — MAGI vs. Medicare Surcharge Tiers"
    subtitle="Each year's MAGI (area) plotted against the indexed IRMAA tier thresholds (steps). Crossing a step triggers a higher Medicare Part B & D surcharge two years later.">
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={kAxis} tick={AXIS} width={52} />
        <Tooltip formatter={usd} />
        <Legend />
        <Area type="monotone" dataKey="magi" name="MAGI" stroke={C.blue} fill={C.blue} fillOpacity={0.18} strokeWidth={2.5} />
        <Line type="stepAfter" dataKey="t0" name="Tier 1" stroke={C.sage} strokeWidth={1} dot={false} strokeDasharray="4 3" />
        <Line type="stepAfter" dataKey="t1" name="Tier 2" stroke={C.sand} strokeWidth={1} dot={false} strokeDasharray="4 3" />
        <Line type="stepAfter" dataKey="t2" name="Tier 3" stroke={C.terra} strokeWidth={1} dot={false} strokeDasharray="4 3" />
        <Line type="stepAfter" dataKey="t3" name="Tier 4" stroke={C.clay} strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
        <Line type="stepAfter" dataKey="t4" name="Tier 5" stroke="#7A3B28" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
      </ComposedChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 7. Effective vs marginal tax rate ----
export const RateTrendChart = ({ data }) => (
  <Panel testid="chart-rate-trend" title="Effective vs. Marginal Tax Rate" span={1}
    subtitle="The marginal rate (last-dollar bracket) vs. the effective rate (total tax ÷ AGI) over the plan. A widening gap signals room to convert at low effective cost.">
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={pctAxis} tick={AXIS} width={44} domain={[0, 0.4]} />
        <Tooltip formatter={(v) => fmtPct(v)} />
        <Legend />
        <Line type="stepAfter" dataKey="marginal" name="Marginal Rate" stroke={C.terra} strokeWidth={2.5} dot={false} />
        <Line type="monotone" dataKey="effective" name="Effective Rate" stroke={C.green} strokeWidth={2.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 8. Cumulative lifetime taxes: convert vs no-convert ----
export const CumulativeTaxChart = ({ data }) => (
  <Panel testid="chart-cumulative-tax" title="Cumulative Lifetime Taxes — Convert vs. Don't" span={1}
    subtitle="Running total of all taxes paid. The gap between the two lines at the end is the lifetime tax saved (or spent) by following the Roth conversion strategy.">
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gNo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.terra} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C.terra} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="gYes" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C.green} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={mAxis} tick={AXIS} width={50} />
        <Tooltip formatter={usd} />
        <Legend />
        <Area type="monotone" dataKey="cumNo" name="No Conversions" stroke={C.terra} strokeWidth={2} fill="url(#gNo)" />
        <Area type="monotone" dataKey="cumYes" name="With Conversions" stroke={C.green} strokeWidth={2.5} fill="url(#gYes)" />
      </AreaChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 10. Present value of net worth over time (With vs No conversions) ----
export const PvNetWorthChart = ({ data }) => (
  <Panel testid="chart-pv-networth" title="Present Value of Future Net Worth"
    subtitle="Each year's projected net worth discounted back to today's dollars at the plan's inflation rate — With vs. Without Roth conversions. Strips out the inflation that flatters nominal balances so you compare real purchasing power.">
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <defs>
          <linearGradient id="gPvWith" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.green} stopOpacity={0.28} />
            <stop offset="100%" stopColor={C.green} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={mAxis} tick={AXIS} width={50} />
        <Tooltip formatter={usd} />
        <Legend />
        <Area type="monotone" dataKey="pvWith" name="With Conversions (PV)" stroke={C.green} strokeWidth={2.5} fill="url(#gPvWith)" />
        <Line type="monotone" dataKey="pvNo" name="No Conversions (PV)" stroke={C.terra} strokeWidth={2} strokeDasharray="5 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </Panel>
);

// ---- 11. Planned Roth conversions by year ----
export const RothConversionsChart = ({ data, span = 1 }) => {
  const total = data.reduce((s, d) => s + (d.conversion || 0), 0);
  return (
    <Panel testid="chart-roth-conversions" span={span} title="Planned Roth Conversions by Year"
      subtitle={`Annual Roth conversion sized by the fill-the-bracket strategy. Total converted over the plan: ${fmtUSD(total)}.`}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <CartesianGrid strokeOpacity={0.1} vertical={false} />
          <XAxis dataKey="year" tick={AXIS} />
          <YAxis tickFormatter={kAxis} tick={AXIS} width={52} />
          <Tooltip formatter={usd} />
          <Bar dataKey="conversion" name="Roth Conversion" fill={C.plum} radius={R} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
};

// ---- 12. Net to family — present value (With vs No conversions) ----
export const PvNetToFamilyChart = ({ ntf, span = 2 }) => {
  const data = [
    { name: "With Conversions", roth: ntf.pvRothWith, other: Math.max(0, ntf.pvWith - ntf.pvRothWith), total: ntf.pvWith },
    { name: "No Conversions", roth: ntf.pvRothNo, other: Math.max(0, ntf.pvNo - ntf.pvRothNo), total: ntf.pvNo },
  ];
  const delta = ntf.pvWith - ntf.pvNo;
  return (
    <Panel testid="chart-pv-net-to-family" span={span} title="Net to Family — Present Value"
      subtitle={`After-tax estate delivered to heirs (year ${ntf.deliverYear}, once the ${ntf.horizon}-year SECURE drawdown is complete) discounted to today at ${fmtPct(ntf.discountRate)}. Green = tax-free inherited Roth. Converting changes the present value of the family's inheritance by ${delta >= 0 ? "+" : ""}${fmtUSD(delta)}.`}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ left: 30, right: 90 }}>
          <CartesianGrid strokeOpacity={0.1} horizontal={false} />
          <XAxis type="number" tickFormatter={mAxis} tick={AXIS} />
          <YAxis type="category" dataKey="name" width={120} tick={AXIS} />
          <Tooltip formatter={usd} />
          <Legend />
          <Bar dataKey="roth" name="Tax-free inherited Roth (PV)" stackId="s" fill={C.green} />
          <Bar dataKey="other" name="Other after-tax (PV)" stackId="s" fill={C.sand} radius={[0, 4, 4, 0]}>
            <LabelList dataKey="total" position="right" formatter={(v) => fmtUSD(v)} style={{ fontSize: 12, fontWeight: 700, fill: "#1A1A1A" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
};
export const HeirLegacyCompareChart = ({ withLegacy, noLegacy }) => {
  const mk = (name, lg) => {
    const total = lg?.after_tax_estate_to_heirs || 0;
    const roth = lg?.tax_free_roth_to_heirs || 0;
    return { name, roth, other: Math.max(0, total - roth), total };
  };
  const data = [mk("With Conversions", withLegacy), mk("No Conversions", noLegacy)];
  const delta = (withLegacy?.after_tax_estate_to_heirs || 0) - (noLegacy?.after_tax_estate_to_heirs || 0);
  const horizon = withLegacy?.horizon_years || 10;
  return (
    <Panel testid="chart-heir-legacy" title={`Net to Family at Second Death + ${horizon} Years`}
      subtitle={`After-tax value delivered to heirs once the ${horizon}-year SECURE inherited-account drawdown is complete. Green = tax-free inherited Roth; sand = other after-tax (after the heirs' inherited-IRA tax & LTCG). Converting changes the family's net inheritance by ${delta >= 0 ? "+" : ""}${fmtUSD(delta)}.`}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ left: 30, right: 90 }}>
          <CartesianGrid strokeOpacity={0.1} horizontal={false} />
          <XAxis type="number" tickFormatter={mAxis} tick={AXIS} />
          <YAxis type="category" dataKey="name" width={120} tick={AXIS} />
          <Tooltip formatter={usd} />
          <Legend />
          <Bar dataKey="roth" name="Tax-free inherited Roth" stackId="s" fill={C.green} />
          <Bar dataKey="other" name="Other after-tax" stackId="s" fill={C.sand} radius={[0, 4, 4, 0]}>
            <LabelList dataKey="total" position="right" formatter={(v) => fmtUSD(v)} style={{ fontSize: 12, fontWeight: 700, fill: "#1A1A1A" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
};
