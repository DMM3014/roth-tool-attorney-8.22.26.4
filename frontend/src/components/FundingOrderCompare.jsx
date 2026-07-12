import { useState, useEffect } from "react";
import { GitCompareArrows, Loader2, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runProjection, fundingCompareConfigs, fmtUSD } from "@/lib/api";
import { toast } from "sonner";

// The three funding strategies we compare. "Deplete IRA now" pulls Traditional first
// (leaves more Roth + steps up any leftover taxable). "Leave IRA" pulls Taxable first
// (preserves the tax-deferred bucket but heirs pay ordinary tax on the RMDs). "Split"
// draws from both proportionally at the user's ira_split — often the empirical winner
// on plans with a large taxable brokerage.
const orderCols = (iraSplit) => [
  { key: "leaveIra",   label: "Cash → Taxable → IRA → Roth",  matchOrder: "Cash → Taxable → IRA → Roth", sub: "Preserve IRA / leave for heirs" },
  { key: "split",      label: `Split IRA & Taxable (${Math.round((iraSplit ?? 0.5) * 100)}%)`, matchOrder: "Split IRA & Taxable", sub: "Blend both draws each year" },
  { key: "depleteIra", label: "Cash → IRA → Taxable → Roth",  matchOrder: "Cash → IRA → Taxable → Roth", sub: "Deplete IRA now / step-up taxable" },
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

// Build the split config inline (fundingCompareConfigs stays focused on the two
// extreme orders — used elsewhere by Concepts). Deep-copies scenario so the live
// scenario is never mutated.
const splitConfig = (scenario) => {
  const c = JSON.parse(JSON.stringify(scenario));
  c.withdrawal = c.withdrawal || {};
  c.withdrawal.funding_order = "Split IRA & Taxable";
  if (c.withdrawal.ira_split == null) c.withdrawal.ira_split = 0.5;
  return c;
};

export const FundingOrderCompare = ({ scenario }) => {
  const [runs, setRuns] = useState(null);      // { leaveIra, split, depleteIra }
  const [running, setRunning] = useState(false);
  const currentOrder = scenario?.withdrawal?.funding_order || "Cash → Taxable → IRA → Roth";
  const iraSplit = scenario?.withdrawal?.ira_split ?? 0.5;
  const cols = orderCols(iraSplit);

  // Any edit to the live scenario invalidates the old comparison. Reset so the user
  // can't misread a stale table against their new plan inputs.
  const scenarioSig = JSON.stringify(scenario);
  useEffect(() => { setRuns(null); }, [scenarioSig]);

  const compare = async () => {
    if (running) return;
    setRunning(true);
    try {
      // Same conversions, same spending, same accounts — only the funding order changes.
      const cfgs = fundingCompareConfigs(scenario);
      const [leaveIra, split, depleteIra] = await Promise.all([
        runProjection(cfgs.leaveIra),
        runProjection(splitConfig(scenario)),
        runProjection(cfgs.depleteIra),
      ]);
      setRuns({ leaveIra, split, depleteIra });
    } catch {
      toast.error("Funding-order comparison failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  // Winner across all three columns.
  const winnerKey = (m) => {
    if (!runs) return null;
    const vals = cols.map((o) => ({ key: o.key, v: readMetric(runs[o.key], m) }))
                     .filter((x) => x.v != null);
    if (!vals.length) return null;
    const pick = m.higherIsBetter
      ? vals.reduce((a, b) => (b.v > a.v ? b : a))
      : vals.reduce((a, b) => (b.v < a.v ? b : a));
    return pick.key;
  };

  // The column key that matches the user's currently-selected funding order.
  const currentKey = cols.find((o) => o.matchOrder === currentOrder)?.key || null;

  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="funding-order-compare-card">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Compare Funding Orders</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
            Runs the same plan (same conversions, same spending, same accounts) through all three
            funding strategies — the two extremes plus your Split at {Math.round(iraSplit * 100)}% IRA —
            so you can see which one wins on the metrics you care about. Cash is always spent first
            and Roth always last.
          </p>
        </div>
        <Button onClick={compare} disabled={running} data-testid="funding-compare-run"
          className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full shrink-0">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
          {running ? "Running all three…" : (runs ? "Re-run comparison" : "Run comparison")}
        </Button>
      </div>

      {!runs && !running && (
        <p className="text-[11px] text-muted-foreground italic mt-3" data-testid="funding-compare-empty">
          Click <span className="font-medium">Run comparison</span> above to project all three orders. Your current
          plan uses <span className="font-medium text-[#4A6741]">{currentOrder}</span>
          {currentOrder === "Split IRA & Taxable" && <> ({Math.round(iraSplit * 100)}% IRA)</>}.
        </p>
      )}

      {runs && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[#EBE8E0]" data-testid="funding-compare-table">
          <table className="w-full text-sm">
            <thead className="bg-[#F9F8F6] text-[11px] text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Metric</th>
                {cols.map((o) => {
                  const active = o.key === currentKey;
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
                <th className="text-right font-semibold px-3 py-2" data-testid="funding-delta-header">Δ vs your plan</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const winner = winnerKey(m);
                const curV = currentKey ? readMetric(runs[currentKey], m) : null;
                const winV = winner ? readMetric(runs[winner], m) : null;
                // Δ = winner − current. Positive means "switching to the winner improves this metric".
                const delta = (curV != null && winV != null && winner !== currentKey) ? (winV - curV) : 0;
                const deltaCls = winner == null || winner === currentKey
                  ? "text-muted-foreground"
                  : (m.higherIsBetter ? "text-[#4A6741]" : (delta < 0 ? "text-[#4A6741]" : "text-[#C87941]"));
                return (
                  <tr key={m.key} className="border-t border-[#EBE8E0]" data-testid={`funding-row-${m.key}`}>
                    <td className="px-3 py-2 font-medium">{m.label}</td>
                    {cols.map((o) => (
                      <td key={o.key} className={`px-3 py-2 text-right ${winner === o.key ? "text-[#4A6741] font-bold" : ""}`}
                          data-testid={`funding-${o.key}-${m.key}`}>
                        {winner === o.key && <Trophy className="inline h-3 w-3 mr-1 mb-0.5" />}
                        {fmtUSD(readMetric(runs[o.key], m))}
                      </td>
                    ))}
                    <td className={`px-3 py-2 text-right font-medium ${deltaCls}`} data-testid={`funding-delta-${m.key}`}>
                      {winner == null ? "—" : winner === currentKey
                        ? "on winner"
                        : `${delta > 0 ? "+" : ""}${fmtUSD(delta)}`}
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
          Trophy marks the winning cell per row (best-of-three). The Δ column shows how much each row
          would change if you switched from your current order to the winning order — &ldquo;on winner&rdquo; means
          your current pick already wins that row. Change your live funding order (and, for Split, the IRA %)
          in the Roth Conversion Controls card if you want to adopt a strategy.
        </p>
      )}
    </Card>
  );
};
