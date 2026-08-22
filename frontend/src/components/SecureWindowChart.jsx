import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { fmtUSD } from "@/lib/api";

/**
 * SecureWindowChart — stacked account values across the SECURE Act 10-year
 * window that follows the second death, one bar per year. Individual accounts
 * have merged and stepped up by then, so the stack is the four inherited
 * buckets the engine actually tracks (`legacy.post_death_rows`).
 */
const BUCKETS = [
  { key: "taxable_and_reinvested", label: "Taxable (incl. reinvested distributions)", color: "#7A9B76" },
  { key: "inherited_traditional", label: "Inherited Traditional IRA", color: "#C87941" },
  { key: "inherited_roth", label: "Inherited Roth", color: "#4A6741" },
  { key: "real_estate", label: "Real Estate", color: "#7A5C7E" },
  { key: "cash", label: "Cash", color: "#4B7A94" },
];

const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
};

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border border-[#EBE8E0] bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-[11px] font-bold text-[#1A1A1A] mb-1">{label}</p>
      {payload.slice().reverse().map((p) => (
        <p key={p.dataKey} className="text-[11px] tabular-nums" style={{ color: p.fill }}>
          {p.name}: <strong>{fmtUSD(p.value)}</strong>
        </p>
      ))}
      <p className="text-[11px] tabular-nums border-t border-[#EBE8E0] mt-1 pt-1">
        Total: <strong>{fmtUSD(total)}</strong>
      </p>
    </div>
  );
};

export const SecureWindowChart = ({ postRows, secondDeathYear, heirRate }) => {
  const data = useMemo(() => (postRows || []).map((p) => ({
    label: secondDeathYear ? String(secondDeathYear + p.year_after_death) : `+${p.year_after_death}`,
    yearAfter: p.year_after_death,
    ira_tax_paid: p.ira_tax_paid || 0,
    ...Object.fromEntries(BUCKETS.map((b) => [b.key, p[b.key] || 0])),
  })), [postRows, secondDeathYear]);

  if (!data.length) return null;
  const active = BUCKETS.filter((b) => data.some((d) => Math.abs(d[b.key]) > 0.5));
  const first = data[0];
  const last = data[data.length - 1];
  const firstTotal = active.reduce((s, b) => s + first[b.key], 0);
  const lastTotal = active.reduce((s, b) => s + last[b.key], 0);
  const taxPaid = data.reduce((s, d) => s + d.ira_tax_paid, 0);

  return (
    <Card className="border-[#EBE8E0] shadow-none" data-testid="secure-window-chart-card">
      <div className="flex items-start justify-between p-6 pb-2 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[#4A6741]" />
          <div>
            <h3 className="font-display text-base font-bold tracking-tight">
              Account values through the SECURE Act 10-year window
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5 max-w-3xl leading-relaxed">
              What the heirs hold in each year after the second death
              {secondDeathYear ? ` (${secondDeathYear})` : ""}, by account type. The inherited Traditional IRA
              must be fully distributed by year 10 — as it drains, the proceeds land net of tax in the taxable
              bucket, so the stack changes composition even when the total keeps growing.
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] label-cap text-muted-foreground">Year 1 → year {last.yearAfter}</p>
          <p className="text-sm font-bold tabular-nums text-[#4A6741]">
            {fmtUSD(firstTotal)} → {fmtUSD(lastTotal)}
          </p>
          {taxPaid > 0 && (
            <p className="text-[10px] text-[#C87941] tabular-nums">
              {fmtUSD(taxPaid)} heir income tax paid over the window
            </p>
          )}
        </div>
      </div>
      <div className="h-[340px] px-3 pb-5" data-testid="secure-window-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8A8578" }} />
            <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: "#8A8578" }} width={62} />
            <Tooltip content={<ChartTip />} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
            {active.map((b) => (
              <Bar key={b.key} dataKey={b.key} name={b.label} stackId="a" fill={b.color}
                   radius={b.key === active[active.length - 1].key ? [3, 3, 0, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="px-6 pb-4 text-[11px] text-muted-foreground leading-relaxed">
        Bars are nominal dollars after the heirs&apos; income tax on each forced distribution
        {heirRate != null ? ` (modeled at ${(heirRate * 100).toFixed(1)}%)` : ""}. Individual accounts merge and
        receive a basis step-up at the second death, which is why this window is tracked by bucket rather than by
        account. Estate tax, if any, is modeled separately on the Estate and EP Flowchart tabs.
      </p>
    </Card>
  );
};

export default SecureWindowChart;
