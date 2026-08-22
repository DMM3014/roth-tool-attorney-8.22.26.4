import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtUSD } from "@/lib/api";

// Net-to-heirs envelope — the estate model re-run at every MC rebasis mode
// (Deterministic / P90 / Median / P10) for Portability-Only vs. Layered GST,
// so the full range of estate outcomes across market luck is visible at once.
const EstateMcEnvelopeChart = ({ envelope, stale = false }) => {
  if (!envelope?.length) return null;
  const data = envelope.map((e) => ({
    name: e.label,
    "Portability-Only": Math.round(e.portability),
    "Layered GST": Math.round(e.gst_layered),
  }));
  return (
    <div className="mt-4 pt-4 border-t border-[#EBE8E0]" data-testid="estate-mc-envelope-chart">
      <p className="text-xs font-semibold text-[#1A1A1A]">
        Net-to-heirs envelope across market luck
        {stale && (
          <span className="ml-2 text-[10px] font-medium text-[#C87941]" data-testid="estate-mc-envelope-stale">
            (MC outdated — re-run before relying on these bars)
          </span>
        )}
      </p>
      <p className="text-[10px] text-muted-foreground mb-2">
        The full estate model re-run at each Monte Carlo conversion outcome — Deterministic, best-decile (P90),
        median, and worst-decile (P10) — so the whole range is visible without clicking through the picker.
      </p>
      <div style={{ height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} width={56} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Portability-Only" fill="#B8B4A8" isAnimationActive={false} />
            <Bar dataKey="Layered GST" fill="#2F4A2A" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default EstateMcEnvelopeChart;
