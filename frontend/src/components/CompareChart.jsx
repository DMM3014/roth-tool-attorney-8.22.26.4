import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { fmtUSD } from "@/lib/api";

const AXIS_TICK = { fontSize: 11 };
const mAxis = (v) => `$${(v / 1e6).toFixed(1)}M`;

export const CompareNetWorthChart = ({ data, series }) => (
  <ResponsiveContainer width="100%" height={300}>
    <LineChart data={data}>
      <CartesianGrid strokeOpacity={0.1} vertical={false} />
      <XAxis dataKey="year" tick={AXIS_TICK} />
      <YAxis tickFormatter={mAxis} tick={AXIS_TICK} width={50} />
      <Tooltip formatter={(v) => fmtUSD(v)} />
      <Legend />
      {series.map((s) => (
        <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
          stroke={s.color} strokeWidth={2.5} dot={false} connectNulls />
      ))}
    </LineChart>
  </ResponsiveContainer>
);
