import {
  Bar, BarChart, Cell, LabelList,
  CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { fmtUSD } from "@/lib/api";

const mAxis = (v) => `$${(v / 1e6).toFixed(1)}M`;
const kAxis = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);

// Generic waterfall: each datum has {name, base (transparent), value (colored), fill, label}.
// Pass a fixed `width` for print (ResponsiveContainer measures 0 inside a hidden print block).
export const Waterfall = ({ data, testid, height = 300, width }) => {
  const chart = (
    <BarChart data={data} margin={{ top: 22, right: 16, left: 8, bottom: 44 }} {...(width ? { width, height } : {})}>
      <CartesianGrid strokeOpacity={0.1} vertical={false} />
      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={54} />
      <YAxis tickFormatter={kAxis} tick={{ fontSize: 11 }} width={56} />
      {!width && <Tooltip cursor={{ fill: "#4A67410D" }}
        formatter={(value, name) => (name === "value" ? [fmtUSD(value), "Amount"] : null)} />}
      <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" />
      <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} isAnimationActive={false}>
        {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
        <LabelList dataKey="label" position="top" style={{ fontSize: 10, fill: "#555" }} />
      </Bar>
    </BarChart>
  );
  return <div data-testid={testid}>{width ? chart : <ResponsiveContainer width="100%" height={height}>{chart}</ResponsiveContainer>}</div>;
};

// Grouped bars comparing "Deplete IRA" vs "Leave IRA to heirs" at each horizon.
export const FundingCompareBars = ({ data, testid, width }) => {
  const chart = (
    <BarChart data={data} margin={{ top: 18, right: 16, left: 8, bottom: 8 }} {...(width ? { width, height: 280 } : {})}>
      <CartesianGrid strokeOpacity={0.1} vertical={false} />
      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
      <YAxis tickFormatter={mAxis} tick={{ fontSize: 11 }} width={56} />
      {!width && <Tooltip formatter={(v, n) => [fmtUSD(v), n]} />}
      <Legend />
      <Bar dataKey="Deplete IRA" fill="#4A6741" radius={[3, 3, 0, 0]} isAnimationActive={!width} />
      <Bar dataKey="Leave IRA to heirs" fill="#C87941" radius={[3, 3, 0, 0]} isAnimationActive={!width} />
    </BarChart>
  );
  return <div data-testid={testid}>{width ? chart : <ResponsiveContainer width="100%" height={280}>{chart}</ResponsiveContainer>}</div>;
};
