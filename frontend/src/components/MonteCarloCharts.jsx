import {
  Area, ComposedChart, Bar, BarChart, Line, Cell,
  RadialBar, RadialBarChart, PolarAngleAxis,
  CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { fmtUSD } from "@/lib/api";

const C = { green: "#4A6741", sage: "#7A9B76", terra: "#C87941", sand: "#E6B89C", blue: "#4B7A94" };
const AXIS = { fontSize: 11 };
const mAxis = (v) => `$${(v / 1e6).toFixed(0)}M`;

const successColor = (p) => (p >= 0.9 ? C.green : p >= 0.75 ? "#B8860B" : C.terra);

// ---- Probability of Success gauge ----
export const SuccessGauge = ({ value, label, testid }) => {
  const v = value || 0;
  const data = [{ name: "success", value: v * 100, fill: successColor(v) }];
  return (
    <div className="flex flex-col items-center" data-testid={testid}>
      <div className="relative h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart innerRadius="72%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar background={{ fill: "#EBE8E0" }} dataKey="value" cornerRadius={20} angleAxisId={0} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-4xl font-bold" style={{ color: successColor(v) }} data-testid={`${testid}-value`}>{(v * 100).toFixed(1)}%</span>
          <span className="text-[10px] text-muted-foreground">success</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center max-w-[200px]">{label}</p>
    </div>
  );
};

// ---- With vs Without success comparison ----
export const SuccessCompareChart = ({ withV, withoutV }) => {
  const data = [
    { name: "With Conversions", success: Math.round((withV || 0) * 100), fill: C.green },
    { name: "No Conversions", success: Math.round((withoutV || 0) * 100), fill: C.terra },
  ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 30 }}>
        <CartesianGrid strokeOpacity={0.1} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={AXIS} />
        <YAxis type="category" dataKey="name" width={120} tick={AXIS} />
        <Tooltip formatter={(v) => `${v}%`} />
        <Bar dataKey="success" radius={[0, 6, 6, 0]} barSize={42} label={{ position: "right", formatter: (v) => `${v}%`, fontSize: 13, fontWeight: 700 }}>
          {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// ---- Percentile fan chart of net worth over time ----
export const FanChart = ({ years, percentiles }) => {
  const data = years.map((y, i) => ({
    year: y,
    p10: percentiles.p10[i],
    spread: percentiles.p90[i] - percentiles.p10[i],
    p25: percentiles.p25[i],
    p50: percentiles.p50[i],
    p75: percentiles.p75[i],
  }));
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="year" tick={AXIS} />
        <YAxis tickFormatter={mAxis} tick={AXIS} width={52} />
        <Tooltip formatter={(v, n) => [fmtUSD(v), n]} />
        <Legend />
        <Area dataKey="p10" stackId="band" stroke="none" fill="transparent" name="P10" legendType="none" />
        <Area dataKey="spread" stackId="band" stroke="none" fill={C.green} fillOpacity={0.16} name="P10–P90 range" />
        <Line dataKey="p75" stroke={C.sage} strokeWidth={1} strokeDasharray="4 3" dot={false} name="P75" />
        <Line dataKey="p25" stroke={C.sage} strokeWidth={1} strokeDasharray="4 3" dot={false} name="P25" />
        <Line dataKey="p50" stroke={C.green} strokeWidth={2.6} dot={false} name="Median (P50)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// ---- Ending portfolio distribution histogram (clipped at P90, last bin = overflow) ----
export const EndingHistogram = ({ histogram }) => {
  const { counts, edges, capped } = histogram;
  const last = counts.length - 1;
  const data = counts.map((c, i) => ({
    bin: `$${(edges[i] / 1e6).toFixed(1)}M${capped && i === last ? "+" : ""}`,
    count: c,
  }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeOpacity={0.1} vertical={false} />
        <XAxis dataKey="bin" tick={{ fontSize: 9 }} interval={1} angle={-30} textAnchor="end" height={50} />
        <YAxis tick={AXIS} width={36} label={{ value: "# of trials", angle: -90, position: "insideLeft", fontSize: 10, fill: "#999" }} />
        <Tooltip formatter={(v) => [`${v} trials`, "Count"]} labelFormatter={(l) => `Ending ~${l}`} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]} fill={C.blue} />
      </BarChart>
    </ResponsiveContainer>
  );
};
