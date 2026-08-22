import { useMemo, useState } from "react";
import { Dices, Loader2, Play, ShieldCheck, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, ResponsiveContainer, Legend,
} from "recharts";
import { toast } from "sonner";
import { runStrategyStress, fmtUSD } from "@/lib/api";
import { mcScenarioSig } from "@/lib/mcSignature";

const STRESS_BRACKETS = [0.37, 0.35, 0.32, 0.24, 0.22];
const LINE_COLORS = ["#6B6B6B", "#4A6741", "#C87941", "#5B7DA3", "#8A5BA3", "#B84A4A",
  "#3E8E7E", "#A38F3E", "#D08CA6", "#4E4E9C", "#7FA35B", "#946B4A"];

const fmtAxis = (v) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;

export const StrategyStressTest = ({ scenario, sweepResult, applyStrategy, onResult }) => {
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState(null);
  const [engine, setEngine] = useState("historical");
  const [trials, setTrials] = useState(1000);
  const [lens, setLens] = useState("legacy"); // "legacy" | "liquid"
  const [pathPct, setPathPct] = useState("p10"); // "p10" | "p50"

  // Top-2 single-bracket strategies per key bracket (37→22) + the overall sweep winner.
  const candidates = useMemo(() => {
    if (!sweepResult) return [];
    const singles = sweepResult.results.filter((r) => r.kind === "single");
    const seen = new Set();
    const picks = [];
    STRESS_BRACKETS.forEach((b) => {
      singles
        .filter((r) => r.bracket != null && Math.abs(r.bracket - b) < 1e-6)
        .sort((a, z) => z.after_tax_estate - a.after_tax_estate)
        .slice(0, 2)
        .forEach((r) => {
          if (!seen.has(r.label)) { seen.add(r.label); picks.push(r); }
        });
    });
    const best = sweepResult.best;
    if (best && best.kind !== "baseline" && !seen.has(best.label)) picks.unshift(best);
    return picks.slice(0, 11);
  }, [sweepResult]);

  const run = async () => {
    setRunning(true);
    try {
      const strategies = candidates.map(({ label, kind, start_year, stop_year, bracket, segments }) => ({
        label, kind, start_year, stop_year, bracket, segments,
      }));
      const out = await runStrategyStress(scenario, strategies, {
        engine, n_trials: Math.min(2000, Math.max(50, parseInt(trials, 10) || 1000)),
      });
      setRes(out);
      onResult?.({ result: out, scenarioSig: mcScenarioSig(scenario), ranAt: Date.now() });
    } catch {
      toast.error("Stress test failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  const rows = useMemo(() => {
    if (!res) return [];
    return [...res.strategies].sort((a, b) => a.robust_rank - b.robust_rank);
  }, [res]);

  const chartData = useMemo(() => {
    if (!res) return [];
    return res.years.map((y, i) => {
      const row = { year: y };
      res.strategies.forEach((s) => { row[s.label] = s.paths[pathPct][i]; });
      return row;
    });
  }, [res, pathPct]);

  const lensVal = (s, p) => (lens === "legacy" ? s.legacy[p] : s.ending[p]);
  const cohortVal = (s) => (lens === "legacy" ? s.seq_cohort.median_legacy : s.seq_cohort.median_ending);

  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="strategy-stress">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Dices className="h-4 w-4 text-[#4A6741]" />
        <h3 className="font-display text-lg font-bold tracking-tight">Monte Carlo stress test — sequence-of-returns risk</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
        The deterministic sweep assumes the same return <em>every year</em> — but a strategy that
        <span className="font-medium"> prepays conversion tax early</span> is exposed to bad returns arriving right after
        the tax is paid. This test runs the <span className="font-medium">top 2 strategies at each bracket (37→22%) plus the
        no-conversion baseline</span> against the <span className="font-medium">same random market paths</span> (paired
        trials), then re-ranks by the <span className="font-medium">pessimistic P10 outcome</span> and reports how each
        strategy fares in the <span className="font-medium">worst 5% of early-return sequences</span>.
      </p>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
        <div>
          <Label className="text-xs text-muted-foreground">Return engine</Label>
          <div className="flex items-center gap-2 mt-1">
            <button onClick={() => setEngine("historical")}
              data-testid="stress-engine-historical"
              title="Block bootstrap of real 1928–2024 US market data — fat tails, real bear sequences, mean reversion"
              className={`text-xs px-3 py-1.5 rounded ${engine === "historical" ? "bg-[#4A6741] text-white" : "bg-[#F3F1EC] text-muted-foreground hover:bg-[#EBE8E0]"}`}>
              Historical
            </button>
            <button onClick={() => setEngine("lognormal")}
              data-testid="stress-engine-lognormal"
              title="Lognormal draws per asset class, anchored to your plan's blended return"
              className={`text-xs px-3 py-1.5 rounded ${engine === "lognormal" ? "bg-[#4A6741] text-white" : "bg-[#F3F1EC] text-muted-foreground hover:bg-[#EBE8E0]"}`}>
              Lognormal
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Historical = real 1928–2024 bear sequences.</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Trials</Label>
          <Input type="number" step={100} min={50} max={2000} value={trials}
            onChange={(e) => setTrials(e.target.value)}
            data-testid="stress-trials"
            className="mt-1 bg-[#F9F8F6]" />
          <p className="text-[10px] text-muted-foreground mt-1">50–2,000 market paths.</p>
        </div>
        <div className="text-xs text-muted-foreground pt-6">
          <span className="font-medium text-[#1A1A1A]">{candidates.length}</span> candidates
          {" "}+ baseline · identical paths for all
        </div>
        <div className="flex items-end">
          <Button onClick={run} disabled={running || !candidates.length}
            className="bg-[#4A6741] hover:bg-[#3B5234] text-white w-full"
            data-testid="stress-run">
            {running ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Simulating…</>)
              : (<><Play className="h-4 w-4 mr-1" /> Run stress test</>)}
          </Button>
        </div>
      </div>

      {res && (
        <div className="mt-4 space-y-4">
          {/* Robust-winner callout */}
          {res.robust_differs ? (
            <div className="p-3 rounded border border-[#C87941]/40 bg-[#C87941]/5 flex items-start gap-2"
              data-testid="stress-robust-callout">
              <AlertTriangle className="h-4 w-4 text-[#C87941] shrink-0 mt-0.5" />
              <p className="text-xs">
                <span className="font-semibold text-[#C87941]">Robust leader differs.</span>{" "}
                Under pessimistic markets (P10 after-tax legacy),{" "}
                <span className="font-semibold">{res.robust_best_label}</span> beats the deterministic
                leader <span className="font-medium">{res.deterministic_best_label}</span>. Bad early
                returns punish the strategy that prepaid more tax — consider phasing conversions or
                programming the safer bracket as the floor.
              </p>
            </div>
          ) : (
            <div className="p-3 rounded border border-[#4A6741]/40 bg-[#4A6741]/5 flex items-start gap-2"
              data-testid="stress-robust-callout">
              <ShieldCheck className="h-4 w-4 text-[#4A6741] shrink-0 mt-0.5" />
              <p className="text-xs">
                <span className="font-semibold text-[#4A6741]">The deterministic leader is robust.</span>{" "}
                <span className="font-semibold">{res.deterministic_best_label}</span> also ranks #1 at the
                pessimistic P10 after-tax legacy — it survives bad early return sequences, not just the average path.
              </p>
            </div>
          )}

          {/* Lens toggle */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-muted-foreground">
              {res.n_trials.toLocaleString()} paired trials · {res.engine === "historical" ? `historical bootstrap ${res.historical?.years_span || ""}` : "lognormal"} ·
              anchored to plan return {res.plan_return != null ? `${(res.plan_return * 100).toFixed(1)}%` : "—"} ·
              ranked by <span className="font-medium">P10 {lens === "legacy" ? "after-tax legacy" : "liquid wealth"}</span>
            </p>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Lens</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setLens("legacy")}
                  data-testid="stress-lens-legacy"
                  title="Approximate after-tax legacy to heirs: MC ending wealth mapped through each strategy's deterministic ending account mix"
                  className={`text-xs px-3 py-1 rounded ${lens === "legacy" ? "bg-[#4A6741] text-white" : "bg-[#F3F1EC] text-muted-foreground hover:bg-[#EBE8E0]"}`}>
                  After-tax legacy (approx)
                </button>
                <button onClick={() => setLens("liquid")}
                  data-testid="stress-lens-liquid"
                  title="Ending liquid portfolio wealth (cash + taxable + IRA + Roth), before heir taxes"
                  className={`text-xs px-3 py-1 rounded ${lens === "liquid" ? "bg-[#4A6741] text-white" : "bg-[#F3F1EC] text-muted-foreground hover:bg-[#EBE8E0]"}`}>
                  Liquid wealth
                </button>
              </div>
            </div>
          </div>

          {/* Results table */}
          <div className="overflow-x-auto" data-testid="stress-results">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b border-[#EBE8E0]">
                  <th className="px-2 py-1" title="Rank by P10 (pessimistic) outcome">#</th>
                  <th className="px-2">Strategy</th>
                  <th className="px-2 text-right" title="After-tax legacy from the deterministic sweep">Det. legacy</th>
                  <th className="px-2 text-right" title="Share of trials where the liquid portfolio never depletes">Success</th>
                  <th className="px-2 text-right">P10</th>
                  <th className="px-2 text-right">Median</th>
                  <th className="px-2 text-right">P90</th>
                  <th className="px-2 text-right" title="Outcomes within the worst 5% of early-return sequences (first 3 years) — success rate · median outcome">Worst-5% early seq.</th>
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => {
                  const isRobustBest = s.label === res.robust_best_label;
                  const isDetBest = s.label === res.deterministic_best_label;
                  return (
                    <tr key={s.label}
                      className={`border-b border-[#F3F1EC] ${isRobustBest ? "bg-[#4A6741]/5" : ""}`}
                      data-testid={`stress-row-${i}`}>
                      <td className="px-2 py-1.5 font-medium">{s.robust_rank}</td>
                      <td className="px-2">
                        {s.label}
                        {isDetBest && (
                          <span className="ml-1.5 inline-flex rounded-full border border-[#C87941]/40 bg-[#C87941]/10 px-1.5 text-[9px] font-medium text-[#C87941]"
                            title="Leader of the deterministic sweep">det. #1</span>
                        )}
                        {isRobustBest && (
                          <span className="ml-1.5 inline-flex rounded-full border border-[#4A6741]/40 bg-[#4A6741]/10 px-1.5 text-[9px] font-medium text-[#4A6741]"
                            title="Best P10 (pessimistic) outcome">robust #1</span>
                        )}
                      </td>
                      <td className="px-2 text-right">{fmtUSD(s.det_after_tax_estate)}</td>
                      <td className="px-2 text-right font-medium">{(s.success * 100).toFixed(1)}%</td>
                      <td className="px-2 text-right font-medium">{fmtUSD(lensVal(s, "p10"))}</td>
                      <td className="px-2 text-right">{fmtUSD(lensVal(s, "p50"))}</td>
                      <td className="px-2 text-right">{fmtUSD(lensVal(s, "p90"))}</td>
                      <td className="px-2 text-right">
                        {s.seq_cohort.success != null
                          ? <>{(s.seq_cohort.success * 100).toFixed(0)}% · {fmtUSD(cohortVal(s))}</>
                          : "—"}
                      </td>
                      <td className="px-2 text-right">
                        <Button size="sm" variant="outline"
                          onClick={() => applyStrategy({ ...s, after_tax_estate: s.det_after_tax_estate })}
                          data-testid={`stress-apply-row-${i}`}
                          className="h-7 px-2 text-[11px] border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/10">
                          Apply
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Percentile-path chart */}
          <div>
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <p className="text-xs font-medium">
                {pathPct === "p10" ? "Pessimistic (P10)" : "Median (P50)"} liquid-wealth path per strategy
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPathPct("p10")}
                  data-testid="stress-path-p10"
                  className={`text-xs px-3 py-1 rounded ${pathPct === "p10" ? "bg-[#4A6741] text-white" : "bg-[#F3F1EC] text-muted-foreground hover:bg-[#EBE8E0]"}`}>
                  P10 path
                </button>
                <button onClick={() => setPathPct("p50")}
                  data-testid="stress-path-p50"
                  className={`text-xs px-3 py-1 rounded ${pathPct === "p50" ? "bg-[#4A6741] text-white" : "bg-[#F3F1EC] text-muted-foreground hover:bg-[#EBE8E0]"}`}>
                  Median path
                </button>
              </div>
            </div>
            <div className="h-72" data-testid="stress-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10 }} width={58} />
                  <RTooltip formatter={(v) => fmtUSD(v)} labelFormatter={(l) => `Year ${l}`}
                    contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {res.strategies.map((s, i) => (
                    <Line key={s.label} type="monotone" dataKey={s.label} dot={false}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={s.label === res.robust_best_label ? 2.5 : 1.5}
                      strokeDasharray={s.kind === "baseline" ? "5 4" : undefined} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              The P10 path shows what each strategy looks like when markets run at the 10th-percentile —
              front-loaded conversion strategies dip deeper early (tax was prepaid) but the survivors
              recover on tax-free compounding. Dashed line = no-conversion baseline.
            </p>
          </div>

          {/* Method footnote */}
          <p className="text-[10px] text-muted-foreground border-t border-[#EBE8E0] pt-3">
            Method: every strategy faces the <span className="font-medium">identical matrix of random return paths</span> —
            differences are strategic, not luck. Each strategy&apos;s conversion schedule, taxes, RMDs and cashflows are locked
            from its own deterministic projection; inflation is held at the plan assumption to isolate return-sequence risk.
            <span className="font-medium"> After-tax legacy (approx)</span>: MC ending wealth is mapped through a linear
            transform calibrated to each strategy&apos;s deterministic ending account mix (Roth share, heir taxes, SECURE
            10-year horizon, step-up) — legacy(W) = floor + slope × W, exact at the deterministic ending, approximate elsewhere.
          </p>
        </div>
      )}
    </Card>
  );
};
