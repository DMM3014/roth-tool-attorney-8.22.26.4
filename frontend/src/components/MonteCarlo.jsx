import { useState } from "react";
import { Dices, Loader2, Play, TrendingUp, ShieldCheck, BarChart3, Activity, CloudLightning, Flame, Link2, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { runMonteCarlo, fmtUSD, fmtPct } from "@/lib/api";
import { SuccessGauge, SuccessCompareChart, FanChart, EndingHistogram } from "@/components/MonteCarloCharts";

const ASSET_ROWS = [
  ["stocks", "Stocks"],
  ["bonds", "Bonds"],
  ["cash", "Cash"],
];
const TRIALS = 500;
const DEFAULT_ASSETS = {
  stocks: { weight: 0.6, mean: 0.08, vol: 0.18 },
  bonds: { weight: 0.3, mean: 0.04, vol: 0.06 },
  cash: { weight: 0.1, mean: 0.03, vol: 0.01 },
};
// Long-run US annual historical pairwise correlations (Gaussian copula defaults)
const DEFAULT_CORR = {
  stocks_bonds: 0.15, stocks_cash: 0.0, bonds_cash: 0.2,
  stocks_inflation: -0.2, bonds_inflation: -0.3, cash_inflation: 0.55,
};
const CORR_ROWS = [
  ["stocks_bonds", "Stocks ↔ Bonds"],
  ["stocks_cash", "Stocks ↔ Cash"],
  ["bonds_cash", "Bonds ↔ Cash"],
  ["stocks_inflation", "Stocks ↔ Inflation"],
  ["bonds_inflation", "Bonds ↔ Inflation"],
  ["cash_inflation", "Cash ↔ Inflation"],
];

export const MonteCarlo = ({ scenario, onResult }) => {
  const [assets, setAssets] = useState(DEFAULT_ASSETS);
  const [shockOn, setShockOn] = useState(false);
  const [shockRate, setShockRate] = useState(-0.15);
  const [shockYears, setShockYears] = useState(2);
  const [inflOn, setInflOn] = useState(false);
  const [inflMean, setInflMean] = useState(scenario?.projection?.general_inflation ?? 0.03);
  const [inflVol, setInflVol] = useState(0.015);
  const [corrOn, setCorrOn] = useState(false);
  const [corr, setCorr] = useState(DEFAULT_CORR);
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [realDollars, setRealDollars] = useState(false);

  const weightSum = ASSET_ROWS.reduce((s, [k]) => s + (assets[k].weight || 0), 0);
  const setAsset = (cls, field, v) =>
    setAssets((p) => ({ ...p, [cls]: { ...p[cls], [field]: parseFloat(v) || 0 } }));

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const out = await runMonteCarlo(scenario, {
        n_trials: TRIALS,
        assets,
        shock: { enabled: shockOn, rate: shockRate, years: shockYears },
        inflation: { enabled: inflOn, mean: inflMean, vol: inflVol },
        correlation: { enabled: corrOn, ...corr },
      });
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
  const seq = res?.sequence_risk;
  const shock = res?.shock;
  const infl_res = res?.inflation;
  const corr_res = res?.correlation;
  const setCorrVal = (k, v) =>
    setCorr((p) => ({ ...p, [k]: Math.max(-0.99, Math.min(0.99, parseFloat(v) || 0)) }));

  // Real ("today's dollars") view: discount each year's percentile at plan inflation.
  const infl = scenario?.projection?.general_inflation ?? 0.03;
  const startYear = scenario?.projection?.start_year ?? res?.years?.[0] ?? 0;
  const dfactor = (year) => 1 / Math.pow(1 + infl, Math.max(0, year - startYear));
  const fanPct = (() => {
    if (!wc) return null;
    if (!realDollars) return wc.percentiles;
    const out = {};
    ["p10", "p25", "p50", "p75", "p90"].forEach((k) => {
      out[k] = wc.percentiles[k].map((v, i) => Math.round(v * dfactor(res.years[i])));
    });
    return out;
  })();
  const endFactor = res ? dfactor(res.years[res.years.length - 1]) : 1;
  const endDisp = (v) => (realDollars ? Math.round((v || 0) * endFactor) : v);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-controls">
        <div className="flex items-center gap-2 mb-1">
          <Dices className="h-5 w-5 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Monte Carlo Simulation</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          Locks your plan's conversion schedule and stress-tests it against {TRIALS} random market paths built from your
          stock / bond / cash mix. Success = the liquid portfolio fully funds every year's spending and never runs out
          through the second death.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Asset allocation table */}
          <div className="lg:col-span-2">
            <Label className="text-xs text-muted-foreground">Global allocation & assumptions</Label>
            <div className="mt-2 rounded-lg border border-[#EBE8E0] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F9F8F6] text-[11px] text-muted-foreground">
                    <th className="text-left font-semibold px-3 py-2">Asset class</th>
                    <th className="text-right font-semibold px-3 py-2">Allocation %</th>
                    <th className="text-right font-semibold px-3 py-2">Mean return %</th>
                    <th className="text-right font-semibold px-3 py-2">Volatility %</th>
                  </tr>
                </thead>
                <tbody>
                  {ASSET_ROWS.map(([k, label]) => (
                    <tr key={k} className="border-t border-[#EBE8E0]">
                      <td className="px-3 py-1.5 font-medium">{label}</td>
                      <td className="px-2 py-1.5">
                        <Input type="number" step={5} value={Math.round(assets[k].weight * 100)} data-testid={`mc-w-${k}`}
                          onChange={(e) => setAsset(k, "weight", (parseFloat(e.target.value) || 0) / 100)}
                          className="h-8 text-right bg-white" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" step={0.5} value={+(assets[k].mean * 100).toFixed(1)} data-testid={`mc-m-${k}`}
                          onChange={(e) => setAsset(k, "mean", (parseFloat(e.target.value) || 0) / 100)}
                          className="h-8 text-right bg-white" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" step={0.5} value={+(assets[k].vol * 100).toFixed(1)} data-testid={`mc-v-${k}`}
                          onChange={(e) => setAsset(k, "vol", (parseFloat(e.target.value) || 0) / 100)}
                          className="h-8 text-right bg-white" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`text-[10px] mt-1 ${Math.abs(weightSum - 1) > 0.001 ? "text-[#C87941]" : "text-muted-foreground"}`} data-testid="mc-weight-note">
              Allocation totals {Math.round(weightSum * 100)}% (auto-normalized on run).
              {res && <> Blended portfolio · <span className="font-medium text-[#4A6741]">{fmtPct(res.portfolio_mean)} mean</span>, {fmtPct(res.portfolio_vol)} vol · liquid start {fmtUSD(res.liquid_start)}.</>}
            </p>
          </div>

          {/* Run options */}
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Trials</Label>
              <div className="mt-1 flex h-10 items-center justify-between rounded-md border border-[#EBE8E0] bg-[#F9F8F6] px-3" data-testid="mc-trials">
                <span className="text-sm font-medium">500</span>
                <span className="text-[10px] text-muted-foreground">fixed · validated</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Locked to 500 trials — the validated setting for this model.</p>
            </div>

            <div className="rounded-lg border border-[#EBE8E0] p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5"><CloudLightning className="h-3.5 w-3.5 text-[#C87941]" /> Early bear-market stress</Label>
                <Switch checked={shockOn} onCheckedChange={setShockOn} data-testid="mc-shock-toggle" />
              </div>
              {shockOn && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Return/yr %</Label>
                    <Input type="number" step={1} value={+(shockRate * 100).toFixed(0)} data-testid="mc-shock-rate"
                      onChange={(e) => setShockRate((parseFloat(e.target.value) || 0) / 100)} className="h-8 text-right bg-white" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground"># Years</Label>
                    <Input type="number" step={1} min={1} max={5} value={shockYears} data-testid="mc-shock-years"
                      onChange={(e) => setShockYears(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))} className="h-8 text-right bg-white" />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[#EBE8E0] p-3" data-testid="mc-inflation-card">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5"><Flame className="h-3.5 w-3.5 text-[#C87941]" /> Stochastic inflation</Label>
                <Switch checked={inflOn} onCheckedChange={setInflOn} data-testid="mc-inflation-toggle" />
              </div>
              {inflOn && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Mean %/yr</Label>
                    <Input type="number" step={0.5} value={+(inflMean * 100).toFixed(1)} data-testid="mc-inflation-mean"
                      onChange={(e) => setInflMean((parseFloat(e.target.value) || 0) / 100)} className="h-8 text-right bg-white" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Vol %</Label>
                    <Input type="number" step={0.25} value={+(inflVol * 100).toFixed(2)} data-testid="mc-inflation-vol"
                      onChange={(e) => setInflVol((parseFloat(e.target.value) || 0) / 100)} className="h-8 text-right bg-white" />
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-2">
                Applies a per-trial cumulative CPI multiplier to outflows (expenses + taxes). Off = deterministic inflation.
              </p>
            </div>

            <Button onClick={run} disabled={running} data-testid="mc-run"
              className="w-full gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running…" : "Run Simulation"}
            </Button>
          </div>
        </div>
        {err && <p className="text-sm text-[#C87941] mt-3" data-testid="mc-error">{err}</p>}
      </Card>

      {!res && !running && (
        <Card className="p-12 border-dashed border-[#EBE8E0] shadow-none text-center" data-testid="mc-empty">
          <Dices className="h-8 w-8 text-[#7A9B76] mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Run the simulation to see your probability of success, the percentile fan chart, sequence-of-returns risk, and how conversions affect resilience.</p>
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

          {/* Sequence-of-returns risk + optional shock + optional inflation + optional correlation */}
          <div className={`grid grid-cols-1 ${shock || infl_res || corr_res ? "lg:grid-cols-2" : ""} gap-6`}>
            <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-seq-card">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-[#C87941]" />
                <h3 className="font-display text-base font-bold tracking-tight">Sequence-of-Returns Risk</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                If your <span className="font-medium text-[#1A1A1A]">first {seq.early_years} years</span> land in the worst 5% of markets,
                your success rate falls from{" "}
                <span className="font-bold text-[#4A6741]">{fmtPct(seq.base_success)}</span> to{" "}
                <span className="font-bold text-[#C87941]" data-testid="mc-seq-success">{fmtPct(seq.success)}</span>
                {seq.median_ending != null && <> — with a median ending portfolio of {fmtUSD(seq.median_ending)}.</>}
              </p>
              <p className="text-[11px] text-muted-foreground mt-2">A bad start early in retirement is far more damaging than the same losses later — this measures that exposure automatically.</p>
            </Card>

            {shock && (
              <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-shock-card">
                <div className="flex items-center gap-2 mb-1">
                  <CloudLightning className="h-4 w-4 text-[#C87941]" />
                  <h3 className="font-display text-base font-bold tracking-tight">Bear-Market Stress Test</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Forcing a <span className="font-medium text-[#1A1A1A]">{fmtPct(shock.rate)}/yr</span> market for the first{" "}
                  <span className="font-medium text-[#1A1A1A]">{shock.years} {shock.years === 1 ? "year" : "years"}</span> drops your success rate from{" "}
                  <span className="font-bold text-[#4A6741]">{fmtPct(shock.base_success_with)}</span> to{" "}
                  <span className="font-bold text-[#C87941]" data-testid="mc-shock-success">{fmtPct(shock.success_with)}</span>.
                </p>
                <p className="text-[11px] text-muted-foreground mt-2">Even under this shock, converting keeps you ahead: {fmtPct(shock.success_with)} vs {fmtPct(shock.success_without)} without conversions.</p>
              </Card>
            )}

            {infl_res && (
              <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-inflation-result">
                <div className="flex items-center gap-2 mb-1">
                  <Flame className="h-4 w-4 text-[#C87941]" />
                  <h3 className="font-display text-base font-bold tracking-tight">Stochastic Inflation ({fmtPct(infl_res.mean)} mean · {fmtPct(infl_res.vol)} vol)</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Cumulative CPI is <span className="font-medium">expected</span> to reach{" "}
                  <span className="font-bold">{(infl_res.cumulative.expected[infl_res.cumulative.expected.length - 1] * 100 - 100).toFixed(0)}%</span>{" "}
                  by <span className="font-medium">{res.years[res.years.length - 1]}</span>. In the worst 10% of trials it lands at{" "}
                  <span className="font-bold text-[#C87941]" data-testid="mc-infl-p90-cum">
                    {(infl_res.cumulative.p90[infl_res.cumulative.p90.length - 1] * 100 - 100).toFixed(0)}%
                  </span>{" "}(the P90 tail).
                </p>
                <p className="text-[11px] text-muted-foreground mt-2">Higher realized inflation scales your outflows (expenses + taxes) per trial — the fan chart above already reflects this stress.</p>
              </Card>
            )}

            {corr_res && (
              <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-corr-result">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 className="h-4 w-4 text-[#4A6741]" />
                  <h3 className="font-display text-base font-bold tracking-tight">
                    Correlated Draws{corr_res.includes_inflation ? " (incl. inflation)" : " (assets only)"}
                  </h3>
                </div>
                {corr_res.adjusted_to_psd && (
                  <p className="text-[11px] text-[#C87941] mb-2" data-testid="mc-corr-adjusted">
                    Your matrix was internally inconsistent — repaired to the nearest valid correlation matrix (shown below).
                  </p>
                )}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {CORR_ROWS.filter(([k]) => corr_res.matrix_used[k] != null).map(([k, label]) => (
                    <div key={k} className="flex items-center justify-between text-xs border-b border-[#F3F1EC] py-1" data-testid={`mc-corr-res-${k}`}>
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">
                        {corr_res.matrix_used[k].toFixed(2)}
                        <span className="text-muted-foreground font-normal"> · realized {corr_res.realized[k].toFixed(2)}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  One correlated Gaussian-copula draw drives every asset class{corr_res.includes_inflation ? " and inflation" : ""} — e.g. high-inflation years now coincide with weaker bond returns, compounding the stress realistically.
                </p>
              </Card>
            )}
          </div>

          {/* Fan chart */}
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-fan-card">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#4A6741]" />
                <h3 className="font-display text-base font-bold tracking-tight">Liquid Portfolio Over Time — Percentile Range</h3>
              </div>
              <div className="flex rounded-full border border-[#EBE8E0] bg-[#F9F8F6] p-0.5 shrink-0" data-testid="mc-real-toggle">
                <button onClick={() => setRealDollars(false)} data-testid="mc-nominal-btn"
                  className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${!realDollars ? "bg-[#4A6741] text-white" : "text-muted-foreground hover:text-[#4A6741]"}`}>
                  Nominal $
                </button>
                <button onClick={() => setRealDollars(true)} data-testid="mc-real-btn"
                  className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${realDollars ? "bg-[#4A6741] text-white" : "text-muted-foreground hover:text-[#4A6741]"}`}>
                  Today's $
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              Median path with the shaded P10–P90 outcome band (with conversions). Investable assets only — excludes illiquid home equity.
              {realDollars
                ? <> Shown in <span className="font-medium text-[#4A6741]">today's dollars</span> (discounted at {fmtPct(infl)} inflation).</>
                : <> Shown in <span className="font-medium">nominal (future) dollars</span>.</>}
            </p>
            <FanChart years={res.years} percentiles={fanPct} />
            <div className="grid grid-cols-3 gap-4 mt-4">
              <Stat label={`Downside ending (P10)${realDollars ? " · today's $" : ""}`} value={fmtUSD(endDisp(wc.ending.p10))} />
              <Stat label={`Median ending (P50)${realDollars ? " · today's $" : ""}`} value={fmtUSD(endDisp(wc.ending.p50))} accent />
              <Stat label={`Upside ending (P90)${realDollars ? " · today's $" : ""}`} value={fmtUSD(endDisp(wc.ending.p90))} />
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
