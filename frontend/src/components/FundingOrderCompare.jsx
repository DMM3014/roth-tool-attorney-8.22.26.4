import { useState } from "react";
import { GitCompareArrows, Loader2, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runProjection, fundingCompareConfigs, fmtUSD } from "@/lib/api";
import { toast } from "sonner";

// The two funding orders we compare. "Deplete IRA now" pulls Traditional first
// (leaves more Roth + steps up any leftover taxable). "Leave IRA" pulls Taxable
// first (preserves the tax-deferred bucket but heirs pay ordinary tax on the RMDs).
const ORDERS = [
  { key: "leaveIra",   label: "Cash → Taxable → IRA → Roth",   sub: "Preserve IRA / leave for heirs" },
  { key: "depleteIra", label: "Cash → IRA → Taxable → Roth",   sub: "Deplete IRA now / step-up taxable" },
];

const METRICS = [
  { key: "ending_net_worth",         label: "Ending Net Worth (2nd death)",          from: "summary", higherIsBetter: true },
  { key: "lifetime_taxes",           label: "Lifetime Taxes",                        from: "summary", higherIsBetter: false },
  { key: "after_tax_estate_to_heirs",label: "After-Tax to Heirs (+10 yr SECURE)",    from: "legacy",  higherIsBetter: true },
  { key: "heir_ira_tax_paid",        label: "Heir Income Tax on Inherited IRA",      from: "legacy",  higherIsBetter: false },
  { key: "ending_roth",              label: "Ending Roth (2nd death)",               from: "summary", higherIsBetter: true },
  { key: "tax_free_roth_to_heirs",   label: "Tax-Free Roth to Heirs (+10 yr)",       from: "legacy",  higherIsBetter: true },
];

const readMetric = (result, m) => {
  const bucket = m.from === "legacy" ? result?.legacy : result?.summary;
  return bucket?.[m.key];
};

export const FundingOrderCompare = ({ scenario }) => {
  const [runs, setRuns] = useState(null);      // { leaveIra: projection, depleteIra: projection }
  const [running, setRunning] = useState(false);
  const currentOrder = scenario?.withdrawal?.funding_order || "Cash → Taxable → IRA → Roth";

  const compare = async () => {
    if (running) return;
    setRunning(true);
    try {
      // fundingCompareConfigs mutates a deep-copied scenario per order — the live scenario
      // is untouched. Both runs keep the user's current roth.enabled + target_bracket +
      // year_targets, so we're comparing funding ORDER holding conversions constant.
      const cfgs = fundingCompareConfigs(scenario);
      const [leaveIra, depleteIra] = await Promise.all([
        runProjection(cfgs.leaveIra),
        runProjection(cfgs.depleteIra),
      ]);
      setRuns({ leaveIra, depleteIra });
    } catch {
      toast.error("Funding-order comparison failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  // Determine winner cell per row (used to render ★ + delta).
  const winnerKey = (m) => {
    if (!runs) return null;
    const a = readMetric(runs.leaveIra, m);
    const b = readMetric(runs.depleteIra, m);
    if (a == null || b == null) return null;
    if (m.higherIsBetter) return a > b ? "leaveIra" : b > a ? "depleteIra" : null;
    return a < b ? "leaveIra" : b < a ? "depleteIra" : null;
  };

  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="funding-order-compare-card">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Compare Funding Orders</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
            Runs the same plan (same conversions, same spending, same accounts) through both funding
            strategies so you can see which one wins on the metrics you care about. Cash is always spent first
            and Roth always last — only the middle two draw sources swap.
          </p>
        </div>
        <Button onClick={compare} disabled={running} data-testid="funding-compare-run"
          className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full shrink-0">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
          {running ? "Running both…" : (runs ? "Re-run comparison" : "Run comparison")}
        </Button>
      </div>

      {!runs && !running && (
        <p className="text-[11px] text-muted-foreground italic mt-3" data-testid="funding-compare-empty">
          Click <span className="font-medium">Run comparison</span> above to project both orders. Your current
          plan uses <span className="font-medium text-[#4A6741]">{currentOrder}</span>.
        </p>
      )}

      {runs && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[#EBE8E0]" data-testid="funding-compare-table">
          <table className="w-full text-sm">
            <thead className="bg-[#F9F8F6] text-[11px] text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Metric</th>
                {ORDERS.map((o) => {
                  const active = o.label === currentOrder;
                  return (
                    <th key={o.key} className="text-right font-semibold px-3 py-2" data-testid={`funding-col-${o.key}`}>
                      <div className="flex flex-col items-end">
                        <span className="text-[#1A1A1A]">
                          {o.label}
                          {active && <span className="ml-1.5 rounded-full bg-[#4A6741] text-white px-1.5 py-[1px] text-[9px] uppercase tracking-wide align-middle">Current</span>}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-normal">{o.sub}</span>
                      </div>
                    </th>
                  );
                })}
                <th className="text-right font-semibold px-3 py-2">Δ</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const winner = winnerKey(m);
                const va = readMetric(runs.leaveIra, m);
                const vb = readMetric(runs.depleteIra, m);
                const delta = (va != null && vb != null) ? vb - va : null; // depleteIra − leaveIra
                const deltaCls = delta == null
                  ? "text-muted-foreground"
                  : (m.higherIsBetter ? (delta > 0 ? "text-[#4A6741]" : delta < 0 ? "text-[#C87941]" : "text-muted-foreground")
                                       : (delta < 0 ? "text-[#4A6741]" : delta > 0 ? "text-[#C87941]" : "text-muted-foreground"));
                return (
                  <tr key={m.key} className="border-t border-[#EBE8E0]" data-testid={`funding-row-${m.key}`}>
                    <td className="px-3 py-2 font-medium">{m.label}</td>
                    {ORDERS.map((o) => (
                      <td key={o.key} className={`px-3 py-2 text-right ${winner === o.key ? "text-[#4A6741] font-bold" : ""}`}
                          data-testid={`funding-${o.key}-${m.key}`}>
                        {winner === o.key && <Trophy className="inline h-3 w-3 mr-1 mb-0.5" />}
                        {fmtUSD(readMetric(o.key === "leaveIra" ? runs.leaveIra : runs.depleteIra, m))}
                      </td>
                    ))}
                    <td className={`px-3 py-2 text-right font-medium ${deltaCls}`} data-testid={`funding-delta-${m.key}`}>
                      {delta == null ? "—" : `${delta > 0 ? "+" : ""}${fmtUSD(Math.abs(delta) === delta ? delta : delta)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {runs && (
        <p className="text-[11px] text-muted-foreground mt-3" data-testid="funding-compare-hint">
          The Δ column is <span className="font-medium">Cash → IRA → Taxable → Roth</span> minus
          <span className="font-medium"> Cash → Taxable → IRA → Roth</span>. Positive Δ on ending wealth /
          Roth / heir cash means <span className="font-medium">depleting the IRA first</span> won that row;
          positive Δ on tax lines means depleting cost <span className="font-medium">more</span> in taxes.
          Trophy marks the winning cell per row. Change your live funding order in the Roth Conversion
          Controls card if you want to make one of these strategies your plan.
        </p>
      )}
    </Card>
  );
};
