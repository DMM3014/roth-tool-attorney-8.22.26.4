import { useState } from "react";
import { Dices, Loader2, Play, Flame, Link2, RotateCcw, AlertTriangle, Anchor, LifeBuoy, History, CloudLightning, BarChart2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { runMonteCarlo, fmtUSD, fmtPct } from "@/lib/api";
import { MonteCarloResults } from "@/components/MonteCarloResults";

const ASSET_ROWS = [
  ["stocks", "Stocks"],
  ["bonds", "Bonds"],
  ["cash", "Cash"],
];
const DEFAULT_TRIALS = 1000;
const MIN_TRIALS = 50;
const MAX_TRIALS = 2000;
const LIQUID_TYPES = ["Cash", "Taxable", "Tax-Deferred", "Tax-Free"];
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

// One-click "2022 replay": stocks −18%, bonds −13%, CPI 8% — stock/bond diversification
// failed (correlation flipped positive) while inflation punished both.
const STAGFLATION = {
  shock: { rate: -0.15, years: 2 },
  inflation: { mean: 0.055, vol: 0.03 },
  corr: {
    stocks_bonds: 0.6, stocks_cash: 0.0, bonds_cash: 0.2,
    stocks_inflation: -0.5, bonds_inflation: -0.6, cash_inflation: 0.7,
  },
};

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
  const [engine, setEngine] = useState("lognormal");
  const [anchorOn, setAnchorOn] = useState(true);
  const [grOn, setGrOn] = useState(false);
  const [grCut, setGrCut] = useState(10); // percent
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState(null);
  const [resStag, setResStag] = useState(false);
  const [err, setErr] = useState(null);
  const [realDollars, setRealDollars] = useState(false);
  // Engine-comparison strip: {lognormal: success, historical: success, plan_return}
  const [compare, setCompare] = useState(null);
  const [comparing, setComparing] = useState(false);
  // Trial count is user-editable in [50, 2000]; default 1000. Backend Pydantic
  // also validates the same range so oversized requests never reach the engine.
  const [nTrials, setNTrials] = useState(DEFAULT_TRIALS);

  const weightSum = ASSET_ROWS.reduce((s, [k]) => s + (assets[k].weight || 0), 0);
  const setAsset = (cls, field, v) =>
    setAssets((p) => ({ ...p, [cls]: { ...p[cls], [field]: parseFloat(v) || 0 } }));

  // The plan's own liquid-weighted return assumption — the anchor for the simulation.
  const planReturn = (() => {
    const liq = (scenario?.accounts || []).filter((a) => LIQUID_TYPES.includes(a.tax_type));
    const tot = liq.reduce((s, a) => s + (a.beginning_balance || 0), 0);
    if (!tot) return null;
    return liq.reduce((s, a) => s + (a.beginning_balance || 0) * (a.return || 0), 0) / tot;
  })();

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const out = await runMonteCarlo(scenario, {
        n_trials: nTrials,
        assets,
        shock: { enabled: shockOn, rate: shockRate, years: shockYears },
        inflation: { enabled: inflOn, mean: inflMean, vol: inflVol },
        correlation: { enabled: corrOn && engine === "lognormal", ...corr },
        engine,
        anchor_to_plan: anchorOn,
        guardrail: { enabled: grOn, cut_pct: grCut / 100 },
      });
      setRes(out);
      setResStag(stagApplied);
      onResult?.(out);
    } catch (e) {
      setErr("Simulation failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  // Engine comparison: run BOTH engines with the same trial count, anchor + guardrail
  // settings and asset assumptions (as available). Every other option is left as-is so the
  // user sees the "same plan, two engines" answer at a glance. Uses fixed seed 42 so the
  // comparison is reproducible and the two runs don't drift due to independent RNG paths.
  const runCompare = async () => {
    if (comparing || running) return;
    setComparing(true);
    setErr(null);
    try {
      const shared = {
        n_trials: nTrials,
        assets,
        shock: { enabled: shockOn, rate: shockRate, years: shockYears },
        inflation: { enabled: inflOn, mean: inflMean, vol: inflVol },
        anchor_to_plan: anchorOn,
        guardrail: { enabled: grOn, cut_pct: grCut / 100 },
        seed: 42,
      };
      // NOTE: correlation only applies to the lognormal engine (historical resamples calendar
      // years, so co-movements come from the data). Skip it for the historical call.
      const [lg, hist] = await Promise.all([
        runMonteCarlo(scenario, {
          ...shared, engine: "lognormal",
          correlation: { enabled: corrOn, ...corr },
        }),
        runMonteCarlo(scenario, { ...shared, engine: "historical" }),
      ]);
      setCompare({
        lognormal: lg,
        historical: hist,
        plan_return: lg.plan_return ?? hist.plan_return ?? null,
        n_trials: nTrials,
        anchored: anchorOn,
      });
    } catch (e) {
      setErr("Engine comparison failed. Please try again.");
    } finally {
      setComparing(false);
    }
  };

  const setCorrVal = (k, v) =>
    setCorr((p) => ({ ...p, [k]: Math.max(-0.99, Math.min(0.99, parseFloat(v) || 0)) }));

  // "2022-style stagflation" preset — derived so it stays honest if the user tweaks anything
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const stagApplied =
    engine === "lognormal" &&
    shockOn && near(shockRate, STAGFLATION.shock.rate) && shockYears === STAGFLATION.shock.years &&
    inflOn && near(inflMean, STAGFLATION.inflation.mean) && near(inflVol, STAGFLATION.inflation.vol) &&
    corrOn && CORR_ROWS.every(([k]) => near(corr[k], STAGFLATION.corr[k]));
  const toggleStagflation = () => {
    if (stagApplied) {
      setShockOn(false); setShockRate(-0.15); setShockYears(2);
      setInflOn(false); setInflMean(scenario?.projection?.general_inflation ?? 0.03); setInflVol(0.015);
      setCorrOn(false); setCorr(DEFAULT_CORR);
      toast("Stagflation preset cleared", { description: "Shock, inflation and correlations back to baseline." });
    } else {
      setEngine("lognormal");
      setShockOn(true); setShockRate(STAGFLATION.shock.rate); setShockYears(STAGFLATION.shock.years);
      setInflOn(true); setInflMean(STAGFLATION.inflation.mean); setInflVol(STAGFLATION.inflation.vol);
      setCorrOn(true); setCorr(STAGFLATION.corr);
      toast.success("2022-style stagflation preset applied", {
        description: "2-yr −15% return shock · 5.5% ±3% inflation · stock/bond diversification failure (+0.60).",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-controls">
        <div className="flex items-center gap-2 mb-1">
          <Dices className="h-5 w-5 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Monte Carlo Simulation</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          Locks your plan&apos;s conversion schedule and stress-tests it against {nTrials} random market paths built from your
          stock / bond / cash mix. Success = the liquid portfolio fully funds every year&apos;s spending and never runs out
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
                          disabled={engine === "historical"}
                          onChange={(e) => setAsset(k, "mean", (parseFloat(e.target.value) || 0) / 100)}
                          className="h-8 text-right bg-white disabled:opacity-40" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" step={0.5} value={+(assets[k].vol * 100).toFixed(1)} data-testid={`mc-v-${k}`}
                          disabled={engine === "historical"}
                          onChange={(e) => setAsset(k, "vol", (parseFloat(e.target.value) || 0) / 100)}
                          className="h-8 text-right bg-white disabled:opacity-40" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`text-[10px] mt-1 ${Math.abs(weightSum - 1) > 0.001 ? "text-[#C87941]" : "text-muted-foreground"}`} data-testid="mc-weight-note">
              Allocation totals {Math.round(weightSum * 100)}% (auto-normalized on run).
              {engine === "historical" && <span className="text-[#4A6741] font-medium"> Historical engine: weights blend real 1928–2024 class returns — means/vols come from the data.</span>}
              {res && <> Blended portfolio · <span className="font-medium text-[#4A6741]">{fmtPct(res.portfolio_mean)} mean</span>, {fmtPct(res.portfolio_vol)} vol · liquid start {fmtUSD(res.liquid_start)}.</>}
            </p>
          </div>

          {/* Run options */}
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Trials</Label>
              <Input
                type="number"
                min={MIN_TRIALS}
                max={MAX_TRIALS}
                step={50}
                value={nTrials}
                data-testid="mc-trials"
                onChange={(e) => setNTrials(Math.max(MIN_TRIALS, Math.min(MAX_TRIALS, parseInt(e.target.value) || DEFAULT_TRIALS)))}
                className="mt-1 h-10 bg-[#F9F8F6] text-right"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Random market paths per run. Allowed range {MIN_TRIALS}–{MAX_TRIALS}; default {DEFAULT_TRIALS}.
                More trials = tighter percentiles but longer wall time.
              </p>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Return engine</Label>
              <div className="mt-1 flex rounded-full border border-[#EBE8E0] bg-[#F9F8F6] p-0.5" data-testid="mc-engine-toggle">
                <button onClick={() => setEngine("lognormal")} data-testid="mc-engine-lognormal"
                  className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-full transition-colors ${engine === "lognormal" ? "bg-[#4A6741] text-white" : "text-muted-foreground hover:text-[#4A6741]"}`}>
                  Statistical
                </button>
                <button onClick={() => setEngine("historical")} data-testid="mc-engine-historical"
                  className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-full transition-colors flex items-center justify-center gap-1 ${engine === "historical" ? "bg-[#4A6741] text-white" : "text-muted-foreground hover:text-[#4A6741]"}`}>
                  <History className="h-3 w-3" /> Historical 1928–2024
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {engine === "historical"
                  ? "Block-bootstrap resampling of real US stock / bond / bill / CPI history — fat tails, mean reversion and 1970s / 2022-style stagflation come from actual data (Anarkulova-Cederburg-O'Doherty method)."
                  : "Lognormal draws from the class means / vols above."}
              </p>
            </div>

            <div className="rounded-lg border border-[#EBE8E0] p-3" data-testid="mc-anchor-card">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5">
                  <Anchor className="h-3.5 w-3.5 text-[#4A6741]" />
                  Anchor to plan return{planReturn != null ? ` (${(planReturn * 100).toFixed(2)}%)` : ""}
                </Label>
                <Switch checked={anchorOn} onCheckedChange={setAnchorOn} data-testid="mc-anchor-toggle" />
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Re-centers the simulation so its median growth matches the blended return your accounts already assume —
                the deterministic plan and this simulation then answer the same question, with volatility layered on top.
                Off = raw {engine === "historical" ? "historical" : "class"} means (may quietly diverge from your plan).
              </p>
            </div>

            <div className={`rounded-lg border p-3 transition-colors ${stagApplied ? "border-[#C87941] bg-[#FBF3EC]" : "border-[#EBE8E0]"}`} data-testid="mc-stagflation-card">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <AlertTriangle className={`h-3.5 w-3.5 ${stagApplied ? "text-[#C87941]" : "text-muted-foreground"}`} />
                  Stress preset
                </Label>
                {stagApplied && <span className="text-[10px] font-semibold text-[#C87941] uppercase tracking-wide" data-testid="mc-stagflation-active">Active</span>}
              </div>
              <Button variant="outline" size="sm" onClick={toggleStagflation} data-testid="mc-stagflation-preset"
                className={`mt-2 h-8 w-full gap-1.5 text-[11px] rounded-full ${stagApplied
                  ? "border-[#C87941] text-[#C87941] hover:bg-[#C87941]/10"
                  : "border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/10"}`}>
                <Flame className="h-3 w-3" />
                {stagApplied ? "Clear stagflation preset" : "2022-style stagflation"}
              </Button>
              <p className="text-[10px] text-muted-foreground mt-2">
                One click replays 2022: −15% returns for 2 yrs, 5.5% ± 3% inflation, and stock/bond
                diversification failure (correlation +0.60) with inflation punishing both (−0.50 / −0.60).
              </p>
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
              {inflOn && engine !== "historical" && (
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
                {engine === "historical"
                  ? "ON = each trial's outflows track the CPI of its sampled historical years (jointly with returns). OFF = deterministic plan inflation."
                  : "Applies a per-trial cumulative CPI multiplier to outflows (expenses + taxes). Off = deterministic inflation."}
              </p>
            </div>

            <div className="rounded-lg border border-[#EBE8E0] p-3" data-testid="mc-corr-card">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-[#4A6741]" /> Correlated draws</Label>
                {engine === "lognormal" && <Switch checked={corrOn} onCheckedChange={setCorrOn} data-testid="mc-corr-toggle" />}
              </div>
              {engine === "historical" ? (
                <p className="text-[10px] text-muted-foreground mt-2" data-testid="mc-corr-historical-note">
                  Handled by the data: sampling real calendar years keeps the true stock / bond / cash / inflation
                  co-movements (e.g. 1974 and 2022, when bonds fell WITH stocks while inflation spiked).
                </p>
              ) : (
                <>
                  {corrOn && (
                <>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-3">
                    {CORR_ROWS.map(([k, label]) => (
                      <div key={k}>
                        <Label className="text-[10px] text-muted-foreground">{label}</Label>
                        <Input type="number" step={0.05} min={-0.99} max={0.99} value={corr[k]} data-testid={`mc-corr-${k}`}
                          onChange={(e) => setCorrVal(k, e.target.value)} className="h-8 text-right bg-white" />
                      </div>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setCorr(DEFAULT_CORR)} data-testid="mc-corr-reset"
                    className="mt-2 h-7 w-full gap-1.5 text-[11px] text-[#4A6741] hover:text-[#3B5234]">
                    <RotateCcw className="h-3 w-3" /> Reset to historical defaults
                  </Button>
                </>
              )}
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Gaussian copula across stocks / bonds / cash{corrOn ? " / inflation" : ""} draws.
                    Inflation pairs apply only when stochastic inflation is on. Invalid matrices are repaired to the nearest valid one.
                  </p>
                </>
              )}
            </div>

            <div className="rounded-lg border border-[#EBE8E0] p-3" data-testid="mc-guardrail-card">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5"><LifeBuoy className="h-3.5 w-3.5 text-[#4A6741]" /> Spending guardrail</Label>
                <Switch checked={grOn} onCheckedChange={setGrOn} data-testid="mc-guardrail-toggle" />
              </div>
              {grOn && (
                <div className="mt-3">
                  <Label className="text-[10px] text-muted-foreground">Cut discretionary spending after a loss year by %</Label>
                  <Input type="number" step={5} min={0} max={50} value={grCut} data-testid="mc-guardrail-cut"
                    onChange={(e) => setGrCut(Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)))}
                    className="h-8 text-right bg-white" />
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-2">
                Real retirees trim spending after bad markets (Guyton-Klinger guardrails). When on, expenses — never
                taxes — are cut in any year that follows a portfolio loss, and the success-rate lift is reported.
              </p>
            </div>

            <Button onClick={run} disabled={running || comparing} data-testid="mc-run"
              className="w-full gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running…" : "Run Simulation"}
            </Button>
            <Button variant="outline" onClick={runCompare} disabled={running || comparing} data-testid="mc-compare-run"
              className="w-full gap-2 border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/10 rounded-full">
              {comparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart2 className="h-4 w-4" />}
              {comparing ? "Running both…" : "Compare Statistical vs Historical"}
            </Button>
          </div>
        </div>
        {err && <p className="text-sm text-[#C87941] mt-3" data-testid="mc-error">{err}</p>}
      </Card>

      {compare && <EngineCompareStrip data={compare} />}

      {!res && !running && (
        <Card className="p-12 border-dashed border-[#EBE8E0] shadow-none text-center" data-testid="mc-empty">
          <Dices className="h-8 w-8 text-[#7A9B76] mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Run the simulation to see your probability of success, the percentile fan chart, sequence-of-returns risk, and how conversions affect resilience.</p>
        </Card>
      )}

      {res && (
        <MonteCarloResults
          res={res}
          scenario={scenario}
          resStag={resStag}
          realDollars={realDollars}
          setRealDollars={setRealDollars}
        />
      )}
    </div>
  );
};

// Compact "same plan, two engines" strip: paired success rates + delta.
// Rendered under the controls card; independent of the main run.
const EngineCompareStrip = ({ data }) => {
  const lg = data.lognormal?.with_conversions?.success ?? 0;
  const hi = data.historical?.with_conversions?.success ?? 0;
  const delta = hi - lg; // historical vs statistical (positive = historical rosier)
  const dc = delta >= 0 ? "text-[#4A6741]" : "text-[#C87941]";
  const bar = (v) => `${Math.max(2, Math.min(100, v * 100))}%`;
  return (
    <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="mc-engine-compare">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">Engine comparison — same plan, both engines</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {data.n_trials} trials each · seed 42 · {data.anchored ? "anchored to plan return" : "engine defaults"}
            {data.plan_return != null && <> · plan return <span className="font-medium">{fmtPct(data.plan_return)}</span></>}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${delta >= 0 ? "border-[#4A6741]/40 bg-[#F1F5EF] text-[#4A6741]" : "border-[#C87941]/40 bg-[#FBF3EC] text-[#C87941]"}`} data-testid="mc-engine-compare-delta">
          Historical {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)} pts
        </span>
      </div>
      <div className="space-y-2.5">
        <EngineRow label="Statistical (lognormal)" success={lg} widthPct={bar(lg)} testid="mc-compare-lognormal" />
        <EngineRow label="Historical (1928–2024)" success={hi} widthPct={bar(hi)} testid="mc-compare-historical" />
      </div>
      <p className={`text-[11px] mt-3 ${dc}`}>
        {Math.abs(delta) < 0.02
          ? "The two engines agree — your plan is robust to how volatility is modeled."
          : delta > 0
            ? "Historical resampling gives a rosier read — likely because real US history includes long bull runs that lognormal draws miss."
            : "Historical resampling is harsher — real history's fat tails (1930s, 1970s, 2008, 2022) bite this plan more than pure lognormal does."}
      </p>
    </Card>
  );
};

const EngineRow = ({ label, success, widthPct, testid }) => (
  <div data-testid={testid}>
    <div className="flex items-center justify-between text-xs mb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-[#1A1A1A]">{fmtPct(success)}</span>
    </div>
    <div className="h-2 rounded-full bg-[#F3F1EC] overflow-hidden">
      <div className="h-full bg-[#4A6741]" style={{ width: widthPct }} />
    </div>
  </div>
);
