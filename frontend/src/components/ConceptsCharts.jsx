import {
  Bar, BarChart, Line, LineChart, Cell, LabelList,
  CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { fmtUSD } from "@/lib/api";

const mAxis = (v) => `$${(v / 1e6).toFixed(1)}M`;
const kAxis = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);

// Generic waterfall: each datum has {name, base (transparent), value (colored), fill}.
export const Waterfall = ({ data, testid, height = 300 }) => (
  <div data-testid={testid}>
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 16, left: 8, bottom: 44 }}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={54} />
        <YAxis tickFormatter={kAxis} tick={{ fontSize: 11 }} width={56} />
        <Tooltip cursor={{ fill: "#4A67410D" }}
          formatter={(value, name) => (name === "value" ? [fmtUSD(value), "Amount"] : null)} />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" />
        <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          <LabelList dataKey="label" position="top" style={{ fontSize: 10, fill: "#555" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

// Two Roth balances compounding over the horizon (tax paid internally vs externally).
export const InternalExternalLines = ({ data, testid }) => (
  <div data-testid={testid}>
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 20, left: 8, bottom: 4 }}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={{ fontSize: 11 }} tickFormatter={(v) => `Yr ${v}`} />
        <YAxis tickFormatter={mAxis} tick={{ fontSize: 11 }} width={56} />
        <Tooltip formatter={(v, n) => [fmtUSD(v), n]} labelFormatter={(l) => `Year ${l}`} />
        <Legend />
        <Line dataKey="External" stroke="#4A6741" strokeWidth={2.6} dot={false} name="Tax paid externally" />
        <Line dataKey="Internal" stroke="#C87941" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Tax paid from the conversion" />
      </LineChart>
    </ResponsiveContainer>
  </div>
);
