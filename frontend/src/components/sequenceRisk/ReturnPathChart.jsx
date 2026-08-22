import React, { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip,
} from "recharts";

/**
 * ReturnPathChart — the four equity paths on one axis so the reader can see that
 * the SAME average can arrive in a very different order. Mean-preserved variants
 * by default: those all compound to the plan's assumption, which is the point.
 */
const COLORS = {
  early_bear: "#C87941",
  late_bear_conversion: "#8A6A12",
  late_bear_projection: "#4A6741",
  volatility: "#6B7B8C",
};
const NAMES = {
  early_bear: "Early bear",
  late_bear_conversion: "Late bear (conversion window)",
  late_bear_projection: "Late bear (end of plan)",
  volatility: "Volatile markets",
};

export const ReturnPathChart = ({ data, variant = "mean_preserved", height = 170,
                                  testid = "sequence-risk-path-chart" }) => {
  const { rows, keys } = useMemo(() => {
    if (!data?.scenarios?.length) return { rows: [], keys: [] };
    const picked = data.scenarios.filter((s) => s.variant === variant);
    const start = data.start_year;
    const n = Math.max(...picked.map((s) => s.equity_returns.length));
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const row = { year: start + i };
      picked.forEach((s) => { row[s.scenario] = Number(((s.equity_returns[i] ?? 0) * 100).toFixed(2)); });
      out.push(row);
    }
    return { rows: out, keys: picked.map((s) => s.scenario) };
  }, [data, variant]);

  if (!rows.length) return null;

  return (
    <div data-testid={testid}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} interval={4} />
            <YAxis tick={{ fontSize: 9 }} width={38} tickLine={false}
                   tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v, n) => [`${v}%`, NAMES[n] || n]} labelFormatter={(l) => `Year ${l}`} />
            <ReferenceLine y={Number(((data.reference_return || 0) * 100).toFixed(2))}
                           stroke="#1A1A1A" strokeDasharray="4 3" strokeOpacity={0.5} />
            <ReferenceLine y={0} stroke="#C87941" strokeOpacity={0.35} />
            {keys.map((k) => (
              <Line key={k} type="monotone" dataKey={k} stroke={COLORS[k] || "#999"} dot={false}
                    strokeWidth={1.6} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 4 }}>
        {keys.map((k) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 8.5, color: "#5A5A5A" }}>
            <span style={{ width: 12, height: 2, background: COLORS[k] || "#999", display: "inline-block" }} />
            {NAMES[k] || k}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 8.5, color: "#5A5A5A" }}>
          <span style={{ width: 12, borderTop: "2px dashed #1A1A1A", opacity: 0.5, display: "inline-block" }} />
          Plan assumption ({((data.reference_return || 0) * 100).toFixed(1)}% equity)
        </span>
      </div>
    </div>
  );
};

export default ReturnPathChart;
