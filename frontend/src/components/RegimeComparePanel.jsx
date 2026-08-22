// Runs the same Monte Carlo simulation across every market-scenario preset and
// renders a compact per-regime comparison table + horizontal success-rate bar
// chart. Advisors use this to show the client how sensitive the plan's success
// is to the assumed market regime — one click answers "how much of this
// recommendation depends on you being right about the future market?"
//
// The panel is collapsed by default (it costs a ~1-2s API call to populate),
// and shows a "Run Comparison" button. Once populated, the caller passes the
// same `mcRequestBase` (assets, correlation, shock, engine, n_trials) so the
// numbers match the simulation the user just ran on the main MC page.

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Layers, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { runRegimeCompare, fmtUSD, fmtPct } from "@/lib/api";
import { mcScenarioSig } from "@/lib/mcSignature";

export const RegimeComparePanel = ({ scenario, mcRequestBase, onResult }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [pairBehavior, setPairBehavior] = useState(false);
  // Detect whether at least one behavioral rule is active — the pair toggle is only
  // meaningful when the with-behavior run has SOMETHING to strip out.
  const grEnabled = !!mcRequestBase?.guardrail?.enabled;
  const haltEnabled = !!mcRequestBase?.conversion_halt?.enabled;
  const behaviorAvailable = grEnabled || haltEnabled;

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const payload = {
        ...mcRequestBase,
        config: scenario,
        // Deterministic seed so paired-regime comparisons are luck-neutral —
        // every regime sees the SAME sequence of random shocks so differences
        // are entirely driven by the regime's return + inflation, not by draws.
        seed: 42,
        // Cap at 500 trials for the batch even if the main sim ran 1000 — the
        // batch endpoint bounds trials tighter to keep 6× compute manageable.
        n_trials: Math.min(mcRequestBase?.n_trials || 500, 1000),
        include_no_behavior_pair: pairBehavior && behaviorAvailable,
      };
      const res = await runRegimeCompare(payload);
      setData(res);
      onResult?.({ result: res, scenarioSig: mcScenarioSig(scenario), ranAt: Date.now() });
      toast.success(`Compared ${new Set(res.rows.map((r) => r.preset_id)).size} market regimes`);
    } catch (e) {
      setErr("Regime comparison failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Empty state — advisor clicks the button to populate the panel
  if (!data && !loading) {
    return (
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-regime-compare-card">
        <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
          <div className="flex items-center gap-2 shrink-0">
            <Layers className="h-5 w-5 text-[#4A6741]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Regime Comparison</h3>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
              Rerun the same 1&#8202;000-trial simulation under every named market regime
              (Long-term Average, Last 50 Years, 1970s Stagflation, Lost Decade, Persistent
              5% Inflation, Bogle 4%) with a shared random seed. Answers the client&apos;s
              most common question: <em>&ldquo;how much does this recommendation depend on
              which future you assume?&rdquo;</em>
            </p>
            {behaviorAvailable && (
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <Switch checked={pairBehavior} onCheckedChange={setPairBehavior}
                  data-testid="mc-regime-compare-pair-toggle" />
                <span className="text-[11px] text-muted-foreground">
                  Also run each regime WITHOUT the behavioral rules ({grEnabled && "guardrail"}
                  {grEnabled && haltEnabled && " + "}
                  {haltEnabled && "halt"}) so the report shows resilience-from-plan vs
                  resilience-from-behavior — doubles run time.
                </span>
              </label>
            )}
            {err && <p className="text-xs text-[#B84A4A] mt-2">{err}</p>}
          </div>
          <Button
            onClick={run}
            data-testid="mc-regime-compare-run"
            className="bg-[#4A6741] hover:bg-[#3D5535] text-white"
          >
            <Layers className="mr-2 h-4 w-4" /> Run Comparison
          </Button>
        </div>
      </Card>
    );
  }

  // Loading state
  if (loading) {
    return (
      <Card className="p-6 border-[#EBE8E0] shadow-none flex items-center justify-center gap-3"
            data-testid="mc-regime-compare-loading">
        <Loader2 className="h-5 w-5 animate-spin text-[#4A6741]" />
        <span className="text-sm text-muted-foreground">Running 6 simulations…</span>
      </Card>
    );
  }

  // Populated — build the comparison table
  const baselineId = data.baseline_id;
  const paired = !!data.include_no_behavior_pair;
  // For sorting/winner detection use only the WITH-behavior rows (or single rows when
  // pairing is off).
  const primaryRows = paired ? data.rows.filter((r) => r.variant === "with_behavior") : data.rows;
  const successes = primaryRows.map((r) => r.success);
  const maxSuccess = Math.max(...successes);
  const minSuccess = Math.min(...successes);
  const spread = maxSuccess - minSuccess;
  const winner = primaryRows[0];
  const loser = primaryRows[primaryRows.length - 1];
  const baseline = primaryRows.find((r) => r.preset_id === baselineId) || winner;
  const spreadPct = Math.round(spread * 100);

  // Advisor-friendly headline: how much does the winner/loser differ from where the client is now?
  const headline = (() => {
    if (spreadPct <= 5) {
      return "Your plan is remarkably regime-agnostic — success rate barely moves across the six named regimes. High confidence.";
    }
    if (baselineId === winner.preset_id) {
      return `Your baseline is the best-case regime. Under the worst-case (${loser.label}) your success drops ${Math.round((baseline.success - loser.success) * 100)} points — sensitivity risk.`;
    }
    if (baselineId === loser.preset_id) {
      return `Your baseline is the worst-case regime — the plan looks stronger under every other assumption you might make.`;
    }
    return `Success spans ${spreadPct} points across the six regimes (${loser.label}: ${fmtPct(loser.success)} → ${winner.label}: ${fmtPct(winner.success)}). Show this range to set realistic expectations.`;
  })();

  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-regime-compare-card">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Regime Comparison</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          data-testid="mc-regime-compare-rerun"
          className="text-xs border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/10"
        >
          <RefreshCw className="mr-1 h-3 w-3" /> Rerun
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-3xl leading-relaxed">
        Same conversion plan, same random seed — only the assumed market regime changes. Sorted by
        success rate (highest first).
      </p>

      {/* Headline callout */}
      <div
        data-testid="mc-regime-compare-headline"
        className="rounded-lg px-4 py-3 mb-4 text-sm"
        style={{
          background: spreadPct <= 5 ? "#4A67410D" : "#C879410D",
          border: `1px solid ${spreadPct <= 5 ? "#4A6741" : "#C87941"}`,
          color: "#1A1A1A",
        }}
      >
        {spreadPct > 5 && <AlertTriangle className="inline h-4 w-4 mr-1 -mt-0.5" style={{ color: "#C87941" }} />}
        {headline}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="mc-regime-compare-table">
          <thead className="text-muted-foreground text-[11px]">
            <tr className="border-b border-[#EBE8E0]">
              <th className="text-left px-2 py-1.5 font-semibold">Market Regime</th>
              <th className="text-right px-2 font-semibold">Success</th>
              <th className="text-right px-2 font-semibold">Δ vs. baseline</th>
              <th className="text-right px-2 font-semibold">P10 legacy</th>
              <th className="text-right px-2 font-semibold">P50 legacy</th>
              <th className="text-right px-2 font-semibold">P90 legacy</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const primaryIdx = primaryRows.findIndex((p) => p.preset_id === r.preset_id);
              const isPrimary = !paired || r.variant === "with_behavior";
              const isPair = paired && r.variant === "no_behavior";
              const isWinner = isPrimary && primaryIdx === 0;
              const isLoser = isPrimary && primaryIdx === primaryRows.length - 1;
              const isBaseline = isPrimary && r.preset_id === baselineId;
              const successDelta = r.success - baseline.success;
              const barWidth = Math.max(2, Math.round(r.success * 100));
              // For the paired sub-row, compute the delta vs its own with_behavior sibling.
              const sibling = isPair ? primaryRows.find((p) => p.preset_id === r.preset_id) : null;
              const behaviorLift = sibling ? sibling.success - r.success : 0;
              return (
                <tr
                  key={`${r.preset_id}-${r.variant || "single"}`}
                  data-testid={`mc-regime-row-${r.preset_id}${isPair ? "-nobehavior" : ""}`}
                  className="border-b border-[#F3F1EC]"
                  style={{ background: isBaseline ? "#4A67410D" : (isPair ? "#FAFAF8" : undefined) }}
                >
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-medium ${isPair ? "text-muted-foreground pl-4" : ""}`}>
                        {isWinner && <span className="text-[#4A6741]">★ </span>}
                        {isPair ? "— without behavioral rules" : r.label}
                      </span>
                      {isBaseline && (
                        <span
                          className="inline-block rounded-full border border-[#C87941] bg-[#C87941]/10 px-2 py-0.5 text-[9px] font-semibold text-[#C87941] tracking-wide uppercase"
                          data-testid={`mc-regime-baseline-badge-${r.preset_id}`}
                        >
                          Your baseline
                        </span>
                      )}
                      {isLoser && !isBaseline && (
                        <span className="inline-block rounded-full border border-[#8A8A82] bg-[#F3F1EC] px-2 py-0.5 text-[9px] font-semibold text-[#5A5A5A] tracking-wide uppercase">
                          Worst case
                        </span>
                      )}
                      {isPair && behaviorLift > 0.001 && (
                        <span className="inline-block rounded-full border border-[#4A6741] bg-[#4A6741]/10 px-2 py-0.5 text-[9px] font-semibold text-[#4A6741] tracking-wide uppercase">
                          +{Math.round(behaviorLift * 100)} pts from behavior
                        </span>
                      )}
                      {isPair && behaviorLift < -0.001 && (
                        <span className="inline-block rounded-full border border-[#C87941] bg-[#C87941]/10 px-2 py-0.5 text-[9px] font-semibold text-[#C87941] tracking-wide uppercase">
                          {Math.round(behaviorLift * 100)} pts behavior COST
                        </span>
                      )}
                    </div>
                    {/* Success bar */}
                    <div className="mt-1.5 h-1.5 rounded-full bg-[#F3F1EC] overflow-hidden max-w-[300px]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${barWidth}%`,
                          background: r.success >= 0.90 ? "#4A6741" : r.success >= 0.75 ? "#C4A64A" : "#C87941",
                          opacity: isPair ? 0.55 : 1,
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-bold tabular-nums"
                      style={{ color: r.success >= 0.90 ? "#4A6741" : r.success >= 0.75 ? "#8A6820" : "#B84A4A" }}>
                    {fmtPct(r.success)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs"
                      style={{ color: successDelta > 0.001 ? "#4A6741" : successDelta < -0.001 ? "#C87941" : "#8A8A82" }}>
                    {isPair
                      ? "—"
                      : isBaseline
                      ? "—"
                      : `${successDelta >= 0 ? "+" : ""}${Math.round(successDelta * 100)} pts`}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">{fmtUSD(r.p10)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">{fmtUSD(r.p50)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">{fmtUSD(r.p90)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground max-w-3xl leading-relaxed">
        {data.n_trials.toLocaleString()} trials per regime{paired ? " × 2 (with/without behavior)" : ""}, engine: <strong>{data.engine === "historical" ? "historical bootstrap" : "lognormal"}</strong>.
        All runs share seed = 42 so trial-to-trial differences are driven entirely by the regime&apos;s return + inflation
        assumptions{paired ? " and the behavioral rule delta" : ""}, not by luck of the draw.
      </p>
    </Card>
  );
};
