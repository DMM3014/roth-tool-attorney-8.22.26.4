import { useEffect, useMemo, useState } from "react";
import { GitCompareArrows, BarChart3, Table2, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { listScenarios, runProjection, fmtUSD } from "@/lib/api";
import { CompareNetWorthChart } from "@/components/CompareChart";

const SLOT_COLORS = ["#4A6741", "#C87941", "#4B7A94"];
const NONE = "__none__";
const CURRENT = "__current__";

// metric label, accessor, "min" | "max" (which is best) | null
const METRICS = [
  ["Lifetime Taxes", (d) => d.summary?.lifetime_taxes, "min"],
  ["Ending Net Worth", (d) => d.summary?.ending_net_worth, "max"],
  ["Total Converted to Roth", (d) => d.summary?.total_roth_converted, null],
  ["Ending Roth", (d) => d.summary?.ending_roth, "max"],
  ["After-Tax to Heirs", (d) => d.legacy?.after_tax_estate_to_heirs, "max"],
  ["Inherited IRA Tax", (d) => d.legacy?.inherited_ira_tax, "min"],
];

export const Compare = ({ scenario }) => {
  const [saved, setSaved] = useState([]);
  const [slots, setSlots] = useState([CURRENT, NONE, NONE]);
  const [results, setResults] = useState({}); // value -> projection data

  useEffect(() => { listScenarios().then(setSaved); }, []);

  const options = useMemo(
    () => [
      { value: CURRENT, label: "Current (working scenario)", config: scenario },
      ...saved.map((s) => ({ value: s.id, label: s.name, config: s.config })),
    ],
    [saved, scenario]
  );
  const cfgFor = (val) => options.find((o) => o.value === val)?.config;
  const labelFor = (val) => options.find((o) => o.value === val)?.label || "";

  // active = selected, non-none, de-duplicated by slot order
  const active = slots
    .map((val, i) => ({ val, i }))
    .filter(({ val }) => val && val !== NONE);

  const activeSig = JSON.stringify(active.map(({ val }) => [val, cfgFor(val)]));
  useEffect(() => {
    let alive = true;
    Promise.all(active.map(({ val }) => runProjection(cfgFor(val)).then((d) => [val, d]))).then((pairs) => {
      if (alive) setResults(Object.fromEntries(pairs));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSig]);

  const cols = active
    .map(({ val, i }) => ({ val, color: SLOT_COLORS[i], label: labelFor(val), data: results[val] }))
    .filter((c) => c.data);

  // ---- chart data: net worth by year, one key per column ----
  const chartSeries = cols.map((c, i) => ({ key: `nw${i}`, label: c.label, color: c.color }));
  const chartData = useMemo(() => {
    const byYear = {};
    cols.forEach((c, i) => {
      (c.data.rows || []).forEach((r) => {
        byYear[r.year] = byYear[r.year] || { year: r.year };
        byYear[r.year][`nw${i}`] = r.net_worth;
      });
    });
    return Object.values(byYear).sort((a, b) => a.year - b.year);
  }, [cols]);

  // ---- year-by-year delta table (vs first active as baseline) ----
  const years = useMemo(() => {
    const set = new Set();
    cols.forEach((c) => (c.data.rows || []).forEach((r) => set.add(r.year)));
    return [...set].sort((a, b) => a - b);
  }, [cols]);
  const nwAt = (c, y) => c.data.rows?.find((r) => r.year === y)?.net_worth;

  const slotSelect = (idx) => (
    <div>
      <Label className="text-xs text-muted-foreground flex items-center gap-2 mb-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SLOT_COLORS[idx] }} />
        Scenario {idx + 1}
      </Label>
      <Select value={slots[idx]} onValueChange={(v) => setSlots((p) => p.map((x, i) => (i === idx ? v : x)))}>
        <SelectTrigger className="bg-[#F9F8F6]" data-testid={`compare-slot-${idx}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— None —</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  const bestVal = (accessor, dir) => {
    const vals = cols.map((c) => accessor(c.data)).filter((v) => v != null);
    if (vals.length < 2 || !dir) return null;
    return dir === "min" ? Math.min(...vals) : Math.max(...vals);
  };

  return (
    <div className="space-y-8">
      {/* Selectors */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="compare-selectors">
        <div className="flex items-center gap-2 mb-4">
          <GitCompareArrows className="h-5 w-5 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Compare up to 3 scenarios</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <div key={i}>{slotSelect(i)}</div>)}
        </div>
        {cols.length < 2 && (
          <p className="text-sm text-muted-foreground mt-4">Pick at least two scenarios to see the comparison. Save scenarios from the Scenarios tab to add more options.</p>
        )}
      </Card>

      {cols.length >= 1 && (
        <>
          {/* Headline metrics */}
          <Card className="p-6 border-[#EBE8E0] shadow-none overflow-x-auto" data-testid="compare-metrics-card">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="h-4 w-4 text-[#C87941]" />
              <h3 className="font-display text-base font-bold tracking-tight">Headline Metrics</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#EBE8E0] text-right text-muted-foreground">
                  <th className="py-2 text-left font-semibold">Metric</th>
                  {cols.map((c) => (
                    <th key={c.val} className="py-2 px-3 font-semibold whitespace-nowrap" style={{ color: c.color }} data-testid={`compare-col-head-${c.val}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([label, accessor, dir]) => {
                  const best = bestVal(accessor, dir);
                  return (
                    <tr key={label} className="border-b border-[#F3F1EC]">
                      <td className="py-2 text-left font-medium">{label}</td>
                      {cols.map((c) => {
                        const v = accessor(c.data);
                        const isBest = best != null && v === best;
                        return (
                          <td key={c.val} className={`py-2 px-3 text-right tabular-nums ${isBest ? "font-bold text-[#4A6741] bg-[#4A6741]/5 rounded" : ""}`} data-testid={`compare-metric-${c.val}`}>
                            {fmtUSD(v)}{isBest && " ★"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground mt-3">★ marks the most favorable value for each metric (lower taxes, higher net worth / heir value).</p>
          </Card>

          {/* Net worth overlay */}
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="compare-chart-card">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-[#4A6741]" />
              <h3 className="font-display text-base font-bold tracking-tight">Net Worth Over Time</h3>
            </div>
            <CompareNetWorthChart data={chartData} series={chartSeries} />
          </Card>

          {/* Year-by-year delta table */}
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="compare-delta-card">
            <div className="flex items-center gap-2 mb-4">
              <Table2 className="h-4 w-4 text-[#4A6741]" />
              <h3 className="font-display text-base font-bold tracking-tight">Year-by-Year Net Worth {cols.length >= 2 && <span className="text-xs font-normal text-muted-foreground">· Δ vs {cols[0].label}</span>}</h3>
            </div>
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#F9F8F6] z-10">
                  <tr className="border-b border-[#EBE8E0] text-right text-muted-foreground">
                    <th className="px-2 py-2 text-left font-semibold sticky left-0 bg-[#F9F8F6]">Year</th>
                    {cols.map((c) => (
                      <th key={c.val} className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: c.color }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => {
                    const baseline = nwAt(cols[0], y);
                    return (
                      <tr key={y} className="border-b border-[#F3F1EC] hover:bg-[#F9F8F6]" data-testid={`compare-row-${y}`}>
                        <td className="px-2 py-1.5 text-left font-medium sticky left-0 bg-white">{y}</td>
                        {cols.map((c, ci) => {
                          const v = nwAt(c, y);
                          const delta = ci > 0 && v != null && baseline != null ? v - baseline : null;
                          return (
                            <td key={c.val} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                              <span className="font-medium">{v == null ? "—" : fmtUSD(v)}</span>
                              {delta != null && (
                                <span className={`ml-1 text-[10px] ${delta >= 0 ? "text-[#4A6741]" : "text-[#C87941]"}`}>
                                  {delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(delta))}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
