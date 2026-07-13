import { useState, useEffect } from "react";
import { GitCompareArrows, Loader2, Trophy, Info } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, Legend, LabelList } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { runProjection, fundingCompareConfigs, fmtUSD } from "@/lib/api";
import { toast } from "sonner";

// Stack colors — reuse the app's earthy palette so this chart reads as part of the family.
// Roth is the "safe, tax-free" green (primary), IRA post-tax is the warm terracotta (money
// the heirs pay tax on), and non-retirement is the soft sage that also represents
// taxable/brokerage on the Net-Worth Composition chart.
const STACK_COLORS = { roth: "#4A6741", ira: "#C87941", nonret: "#7A9B76" };
const mAxis = (v) => `$${(v / 1e6).toFixed(0)}M`;
const shortLabel = (label) => label.replace(/Cash → /, "").replace(/ → Roth$/, "");

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
  {
    key: "after_tax_estate_to_heirs",
    label: "Total After-Tax Estate to Heirs (+10 yr SECURE)",
    from: "legacy", higherIsBetter: true,
    tip: "Everything the heirs actually keep 10 years after the 2nd death: inherited Roth (tax-free) + inherited IRA drawn down over the SECURE window (net of heirs' ordinary tax) + taxable brokerage + cash + real estate (basis step-up at death, LTCG on post-death appreciation), minus estate settlement.",
  },
  { key: "roth_to_heirs",            label: "↳ Roth (tax-free)",                     from: "legacy", higherIsBetter: true, sub: true },
  { key: "ira_post_tax_to_heirs",    label: "↳ IRA (post-tax, after SECURE)",        from: "legacy", higherIsBetter: true, sub: true },
  { key: "nonretirement_to_heirs",   label: "↳ Taxable + Cash + Real Estate (net of LTCG)", from: "legacy", higherIsBetter: true, sub: true },
  { key: "heir_ira_tax_paid",        label: "Heir Income Tax on Inherited IRA",      from: "legacy", higherIsBetter: false },
  { key: "ending_roth",              label: "Ending Roth (2nd death)",               from: "summary", higherIsBetter: true },
  { key: "tax_free_roth_to_heirs",   label: "Tax-Free Roth to Heirs (+10 yr)",       from: "legacy", higherIsBetter: true },
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
    } catch (e) {
      console.error("funding-order compare failed", e);
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
            funding strategies — the two extremes plus the Split column at {Math.round(iraSplit * 100)}% IRA
            (from your live plan) — so you can see which one wins on the metrics you care about. Cash is
            always spent first and Roth always last.
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
                const labelCls = m.sub
                  ? "px-3 py-1.5 pl-8 text-xs text-muted-foreground"
                  : "px-3 py-2 font-medium";
                const cellCls = m.sub ? "px-3 py-1.5 text-right text-xs" : "px-3 py-2 text-right";
                return (
                  <tr key={m.key} className={`border-t border-[#EBE8E0] ${m.sub ? "bg-[#FBFAF7]" : ""}`} data-testid={`funding-row-${m.key}`}>
                    <td className={labelCls}>
                      <span className="inline-flex items-center gap-1.5">
                        {m.label}
                        {m.tip && (
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" aria-label="What's included" data-testid={`funding-tip-${m.key}`}
                                  className="inline-flex items-center text-[#4A6741] hover:text-[#3B5234]">
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-sm bg-[#1A1A1A] text-white text-[11px] leading-snug px-3 py-2">
                                {m.tip}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                    </td>
                    {cols.map((o) => (
                      <td key={o.key} className={`${cellCls} ${winner === o.key ? "text-[#4A6741] font-bold" : ""}`}
                          data-testid={`funding-${o.key}-${m.key}`}>
                        {winner === o.key && !m.sub && <Trophy className="inline h-3 w-3 mr-1 mb-0.5" />}
                        {fmtUSD(readMetric(runs[o.key], m))}
                      </td>
                    ))}
                    <td className={`${cellCls} font-medium ${deltaCls}`} data-testid={`funding-delta-${m.key}`}>
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
        <div className="mt-5 rounded-lg border border-[#EBE8E0] bg-[#FBFAF7] p-4" data-testid="funding-mix-chart-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <h4 className="font-display text-sm font-bold tracking-tight text-[#1A1A1A]">Where the inheritance ends up</h4>
            <p className="text-[10px] text-muted-foreground">
              Stacked $ mix at end of 10-yr SECURE horizon · totals labeled above each bar
              {currentKey && (
                <>
                  {" · "}
                  <span className="text-[#4A6741] font-semibold">Your plan: {shortLabel(cols.find((c) => c.key === currentKey)?.label || "")}</span>
                </>
              )}
            </p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={cols.map((o) => {
                const leg = runs[o.key]?.legacy || {};
                return {
                  name: shortLabel(o.label) + (o.key === currentKey ? "  ★" : ""),
                  Roth: leg.roth_to_heirs || 0,
                  "IRA (post-tax)": leg.ira_post_tax_to_heirs || 0,
                  "Taxable + Cash + RE": leg.nonretirement_to_heirs || 0,
                  total: leg.after_tax_estate_to_heirs || 0,
                };
              })}
              margin={{ top: 26, right: 16, left: 8, bottom: 20 }}
              barCategoryGap="28%"
            >
              <CartesianGrid strokeOpacity={0.1} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} height={36} />
              <YAxis tickFormatter={mAxis} tick={{ fontSize: 11 }} width={54} />
              <RTooltip
                cursor={{ fill: "#4A67410D" }}
                formatter={(v, n) => [fmtUSD(v), n]}
                labelFormatter={(l) => l.replace("  ★", "")}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #EBE8E0" }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" iconSize={9} />
              <Bar dataKey="Roth" stackId="mix" fill={STACK_COLORS.roth} isAnimationActive={false} />
              <Bar dataKey="IRA (post-tax)" stackId="mix" fill={STACK_COLORS.ira} isAnimationActive={false} />
              <Bar dataKey="Taxable + Cash + RE" stackId="mix" fill={STACK_COLORS.nonret} isAnimationActive={false} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="total" position="top" formatter={(v) => fmtUSD(v)}
                  style={{ fontSize: 10, fill: "#1A1A1A", fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
