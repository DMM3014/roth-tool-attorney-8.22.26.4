import { useState } from "react";
import { Dices, Loader2, Play, TrendingUp, ShieldCheck, BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { runMonteCarlo, fmtUSD, fmtPct } from "@/lib/api";
import { SuccessGauge, SuccessCompareChart, FanChart, EndingHistogram } from "@/components/MonteCarloCharts";

export const MonteCarlo = ({ scenario, onResult }) => {
  const [trials, setTrials] = useState("500");
  const [vol, setVol] = useState(0.12);
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const out = await runMonteCarlo(scenario, { n_trials: +trials, volatility: vol });
      setRes(out);
      onResult?.(out);
    } catch (e) {
      setErr("Simulation failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  const wc = res?.with_conversions;
  const nc = res?.without_conversions;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-controls">
        <div className="flex items-center gap-2 mb-1">
          <Dices className="h-5 w-5 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Monte Carlo Simulation</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          Locks your plan's conversion schedule and stress-tests it against {trials} random market paths. Success = the liquid
          portfolio fully funds every year's spending and never runs out through the second death.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Trials</Label>
            <Select value={trials} onValueChange={setTrials}>
              <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="mc-trials"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["250", "500", "1000"].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Portfolio Volatility (σ)</Label>
            <Input type="number" step={0.01} value={vol} data-testid="mc-volatility"
              onChange={(e) => setVol(parseFloat(e.target.value) || 0)} className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">{fmtPct(vol)} std-dev of annual returns</p>
          </div>
          <div className="text-xs text-muted-foreground">
            <p>Mean return is balance-weighted from your accounts{res && <span className="font-medium text-[#4A6741]"> · {fmtPct(res.mean_return)}</span>}.</p>
            <p className="mt-1">Liquid start{res && <span className="font-medium"> · {fmtUSD(res.liquid_start)}</span>}</p>
          </div>
          <Button onClick={run} disabled={running} data-testid="mc-run"
            className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running…" : "Run Simulation"}
          </Button>
        </div>
        {err && <p className="text-sm text-[#C87941] mt-3" data-testid="mc-error">{err}</p>}
      </Card>

      {!res && !running && (
        <Card className="p-12 border-dashed border-[#EBE8E0] shadow-none text-center" data-testid="mc-empty">
          <Dices className="h-8 w-8 text-[#7A9B76] mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Run the simulation to see your probability of success, the percentile fan chart, and how conversions affect resilience.</p>
        </Card>
      )}

      {res && (
        <>
          {/* Headline: gauge + with/without */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="p-6 border-[#EBE8E0] shadow-none flex flex-col items-center justify-center" data-testid="mc-gauge-card">
              <div className="flex items-center gap-2 mb-2 self-start">
                <ShieldCheck className="h-4 w-4 text-[#4A6741]" />
                <h3 className="font-display text-base font-bold tracking-tight">Probability of Success</h3>
              </div>
              <SuccessGauge value={wc.success} label="Fully funds spending & never runs out (with your Roth conversions)" testid="mc-gauge" />
            </Card>

            <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-2" data-testid="mc-compare-card">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-[#4A6741]" />
                <h3 className="font-display text-base font-bold tracking-tight">Does converting improve resilience?</h3>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">Same {res.n_trials} market paths applied to both strategies.</p>
              <SuccessCompareChart withV={wc.success} withoutV={nc.success} />
              <p className="text-sm mt-2" data-testid="mc-delta">
                Roth conversions change the success rate by{" "}
                <span className={`font-bold ${wc.success >= nc.success ? "text-[#4A6741]" : "text-[#C87941]"}`}>
                  {wc.success >= nc.success ? "+" : ""}{((wc.success - nc.success) * 100).toFixed(1)} pts
                </span>{" "}({fmtPct(nc.success)} → {fmtPct(wc.success)}).
              </p>
            </Card>
          </div>

          {/* Fan chart */}
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-fan-card">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-[#4A6741]" />
              <h3 className="font-display text-base font-bold tracking-tight">Liquid Portfolio Over Time — Percentile Range</h3>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">Median path with the shaded P10–P90 outcome band (with conversions). Investable assets only — excludes illiquid home equity.</p>
            <FanChart years={res.years} percentiles={wc.percentiles} />
            <div className="grid grid-cols-3 gap-4 mt-4">
              <Stat label="Downside ending (P10)" value={fmtUSD(wc.ending.p10)} />
              <Stat label="Median ending (P50)" value={fmtUSD(wc.ending.p50)} accent />
              <Stat label="Upside ending (P90)" value={fmtUSD(wc.ending.p90)} />
            </div>
          </Card>

          {/* Ending distribution */}
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-hist-card">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-[#4A6741]" />
              <h3 className="font-display text-base font-bold tracking-tight">Ending Portfolio Distribution</h3>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Final liquid portfolio across all trials (clipped at P90; last bar is the upside tail). <span className="font-medium text-[#C87941]">{wc.ending.depleted} of {res.n_trials} trials ({fmtPct(wc.ending.depleted_pct)}) deplete to $0.</span>
            </p>
            <EndingHistogram histogram={wc.histogram} />
          </Card>
        </>
      )}
    </div>
  );
};

const Stat = ({ label, value, accent }) => (
  <div className="rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] p-4">
    <p className="label-cap text-muted-foreground text-[10px] mb-1">{label}</p>
    <p className={`font-display text-xl font-bold ${accent ? "text-[#4A6741]" : "text-[#1A1A1A]"}`}>{value}</p>
  </div>
);
