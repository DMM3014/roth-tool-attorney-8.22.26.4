import { useState } from "react";
import { Dices, Loader2, Play, Flame, Link2, RotateCcw, AlertTriangle, Anchor, History, CloudLightning, BarChart2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { runMonteCarlo, fmtUSD, fmtPct } from "@/lib/api";
import { MonteCarloResults } from "@/components/MonteCarloResults";
import { MarketScenarioSelector } from "@/components/MarketScenarioSelector";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RegimeComparePanel } from "@/components/RegimeComparePanel";
import AIAnalysisCard from "@/components/AIAnalysisCard";
import { GuardrailCard, HaltCard, RebalanceCadenceCard } from "@/components/monteCarlo/BehaviorRuleCards";
import { PairedRothVsNoRothCard } from "@/components/monteCarlo/PairedRothVsNoRothCard";
import { useSharedGuardrail } from "@/hooks/useSharedGuardrail";
import { useSharedHalt } from "@/hooks/useSharedHalt";

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
  stocks: { weight: 0.65, mean: 0.08, vol: 0.18 },
  bonds: { weight: 0.25, mean: 0.04, vol: 0.06 },
  cash: { weight: 0.10, mean: 0.03, vol: 0.01 },
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

export const MonteCarlo = ({ scenario, setScenario, onResult, onRegimeResult }) => {
  // Seed the MC weights from scenario.allocation (edited on Plan Inputs) so switching
  // the household allocation on Plan Inputs flows into the MC without an extra click.
  // Advisors can still fine-tune on this tab; edits stay local to the MC view.
  const [assets, setAssets] = useState(() => {
    const a = scenario?.allocation;
    if (!a) return DEFAULT_ASSETS;
    const sum = (a.stocks || 0) + (a.bonds || 0) + (a.cash || 0);
    if (!(sum > 0)) return DEFAULT_ASSETS;
    return {
      stocks: { ...DEFAULT_ASSETS.stocks, weight: (a.stocks || 0) / sum },
      bonds:  { ...DEFAULT_ASSETS.bonds,  weight: (a.bonds  || 0) / sum },
      cash:   { ...DEFAULT_ASSETS.cash,   weight: (a.cash   || 0) / sum },
    };
  });
  // Early Bear Market stress — ON by default (−20% for 2 years). Advisor can
  // turn it off or dial the depth via the shock controls below.
  const [shockOn, setShockOn] = useState(true);
  const [shockRate, setShockRate] = useState(-0.20);
  const [shockYears, setShockYears] = useState(2);
  const [inflOn, setInflOn] = useState(false);
  const [inflMean, setInflMean] = useState(scenario?.projection?.general_inflation ?? 0.03);
  const [inflVol, setInflVol] = useState(0.015);
  // Regime-switching stochastic inflation (Markov 3-state Low/Normal/High).
  const [regimeOn, setRegimeOn] = useState(false);
  const [regimeLow, setRegimeLow] = useState({ mean: 0.020, vol: 0.008 });
  const [regimeNormal, setRegimeNormal] = useState({ mean: 0.035, vol: 0.014 });
  const [regimeHigh, setRegimeHigh] = useState({ mean: 0.060, vol: 0.025 });
  const [regimePStay, setRegimePStay] = useState(0.85);
  // Correlated draws — ON by default so the "risk-off" cross-asset comovement
  // shows up in every stress-test unless the advisor explicitly wants independent
  // draws (e.g. teaching mode).
  const [corrOn, setCorrOn] = useState(true);
  const [corr, setCorr] = useState(DEFAULT_CORR);
  const [engine, setEngine] = useState("historical");
  const [anchorOn, setAnchorOn] = useState(true);
  // Spending guardrail is shared with the Client Report tab via
  // `useSharedGuardrail` so flipping it on either surface updates the other
  // in real time and both sessions boot with the same default (ON, 10%).
  const { grOn, setGrOn, grCut, setGrCut } = useSharedGuardrail();
  // Halt conversions on drawdowns — shared with the Client Report tab via
  // `useSharedHalt`, so changing the threshold here updates the printed report
  // in real time. Default: ON, 20% YoY drawdown trigger, resume after 1
  // positive-return year.
  const { haltOn, setHaltOn, haltDrop, setHaltDrop, haltResume, setHaltResume } = useSharedHalt();
  const [rebalCadence, setRebalCadence] = useState("annual"); // annual | biennial | never
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

  // Build the inflation config for API calls — same in `run` and `runCompare`.
  const inflationPayload = () => ({
    enabled: inflOn,
    mean: inflMean,
    vol: inflVol,
    regime_switching: inflOn && regimeOn,
    regime_low: regimeLow,
    regime_normal: regimeNormal,
    regime_high: regimeHigh,
    regime_p_stay: regimePStay,
  });

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const out = await runMonteCarlo(scenario, {
        n_trials: nTrials,
        assets,
        shock: { enabled: shockOn, rate: shockRate, years: shockYears },
        inflation: inflationPayload(),
        correlation: { enabled: corrOn && engine === "lognormal", ...corr },
        engine,
        anchor_to_plan: anchorOn,
        guardrail: { enabled: grOn, cut_pct: grCut / 100 },
        conversion_halt: { enabled: haltOn, drop_threshold: haltDrop / 100, resume_after_positive_years: haltResume },
        rebalance: { cadence: rebalCadence },
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
        inflation: inflationPayload(),
        anchor_to_plan: anchorOn,
        guardrail: { enabled: grOn, cut_pct: grCut / 100 },
        conversion_halt: { enabled: haltOn, drop_threshold: haltDrop / 100, resume_after_positive_years: haltResume },
        rebalance: { cadence: rebalCadence },
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

  // "Early bear-market stress" preset — the default shipped state (matches Phase 53
  // defaults exactly). Kept in sync with the shock controls below: if the user
  // dials the shock away from −20% / 2yrs, or turns it off, the preset dropdown
  // reflects that reality rather than falsely claiming the preset is still active.
  const earlyBearApplied =
    shockOn && near(shockRate, -0.20) && shockYears === 2 && !stagApplied;
  const activeStressPreset = stagApplied
    ? "stagflation"
    : earlyBearApplied ? "early_bear" : "none";

  const applyEarlyBear = () => {
    setShockOn(true); setShockRate(-0.20); setShockYears(2);
    // Early Bear is a pure shock — do NOT stack stagflation's inflation or
    // correlation overrides on top of it; those belong to the stagflation preset.
    if (stagApplied) {
      setInflOn(false); setInflMean(scenario?.projection?.general_inflation ?? 0.03); setInflVol(0.015);
      setCorr(DEFAULT_CORR);
    }
  };
  const clearAllStress = () => {
    setShockOn(false); setShockRate(-0.20); setShockYears(2);
    setInflOn(false); setInflMean(scenario?.projection?.general_inflation ?? 0.03); setInflVol(0.015);
    setCorr(DEFAULT_CORR);
  };
  const setStressPreset = (v) => {
    if (v === "early_bear") {
      applyEarlyBear();
      toast.success("Early Bear Market Stress applied", {
        description: "−20% return shock for the first 2 years. Everything else stays at your current settings.",
      });
    } else if (v === "stagflation") {
      setEngine("lognormal");
      setShockOn(true); setShockRate(STAGFLATION.shock.rate); setShockYears(STAGFLATION.shock.years);
      setInflOn(true); setInflMean(STAGFLATION.inflation.mean); setInflVol(STAGFLATION.inflation.vol);
      setCorrOn(true); setCorr(STAGFLATION.corr);
      toast.success("2022-style stagflation preset applied", {
        description: "2-yr −15% return shock · 5.5% ±3% inflation · stock/bond diversification failure (+0.60).",
      });
    } else {
      clearAllStress();
      toast("Stress preset cleared", { description: "Shock, inflation and correlations back to baseline." });
    }
  };
  // Legacy button-toggle kept only as an alias for tests — logically equivalent to
  // picking stagflation from the preset dropdown, then clearing it.
  const toggleStagflation = () => setStressPreset(stagApplied ? "none" : "stagflation");

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

        {/* Market Scenario selector — anchors the deterministic median-return baseline
            that every stochastic trial is calibrated against. Changing the preset here
            propagates to every tab because it patches scenario.market_scenario. */}
        {setScenario && (
          <div className="mb-5">
            <MarketScenarioSelector scenario={scenario} setScenario={setScenario} />
          </div>
        )}

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
                Re-centers each simulated year on the return path your deterministic plan already implies —
                as low-yield cash becomes a smaller slice, the anchor drifts up with it, so the simulation median
                tracks the plan instead of quietly understating it.
                Off = raw {engine === "historical" ? "historical" : "class"} means (may quietly diverge from your plan).
              </p>
            </div>

            <div className={`rounded-lg border p-3 transition-colors ${activeStressPreset !== "none" ? "border-[#C87941] bg-[#FBF3EC]" : "border-[#EBE8E0]"}`} data-testid="mc-stagflation-card">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <AlertTriangle className={`h-3.5 w-3.5 ${activeStressPreset !== "none" ? "text-[#C87941]" : "text-muted-foreground"}`} />
                  Stress preset
                </Label>
                {activeStressPreset !== "none" && (
                  <span className="text-[10px] font-semibold text-[#C87941] uppercase tracking-wide"
                        data-testid="mc-stress-preset-active">Active</span>
                )}
              </div>
              <Select value={activeStressPreset} onValueChange={setStressPreset}>
                <SelectTrigger className="h-9 mt-2 text-xs bg-white" data-testid="mc-stress-preset-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="early_bear" data-testid="mc-stress-preset-early-bear">
                    Early Bear Market Stress (default)
                  </SelectItem>
                  <SelectItem value="stagflation" data-testid="mc-stress-preset-stagflation">
                    2022-style Stagflation
                  </SelectItem>
                  <SelectItem value="none" data-testid="mc-stress-preset-none">
                    No stress preset
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
                {activeStressPreset === "early_bear"
                  ? "Front-loads a −20% return shock for the first 2 years — the sequence-of-returns risk aggressive conversions run into."
                  : activeStressPreset === "stagflation"
                  ? "One click replays 2022: −15% returns for 2 yrs, 5.5% ± 3% inflation, and stock/bond diversification failure (correlation +0.60)."
                  : "No preset applied — baseline market draws."}
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

              {/* Regime-switching inflation — a 3-state Markov chain instead of a single lognormal draw */}
              {inflOn && engine !== "historical" && (
                <div className="mt-3 pt-3 border-t border-[#EBE8E0]" data-testid="mc-regime-card">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Flame className="h-3.5 w-3.5 text-[#8A6820]" /> Regime-switching (Markov)
                    </Label>
                    <Switch checked={regimeOn} onCheckedChange={setRegimeOn} data-testid="mc-regime-toggle" />
                  </div>
                  {regimeOn && (
                    <>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                        3-state Markov chain (Low / Normal / High). Each year has probability{" "}
                        <strong>{Math.round(regimePStay * 100)}%</strong> of staying in the current regime, the rest split evenly.
                        The 3 regimes replace the single (mean, vol) above.
                      </p>
                      <table className="w-full text-[11px] mt-2" data-testid="mc-regime-table">
                        <thead>
                          <tr className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            <th className="text-left py-1">Regime</th>
                            <th className="text-right py-1">Mean %/yr</th>
                            <th className="text-right py-1">Vol %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ["Low", regimeLow, setRegimeLow, "reg-low"],
                            ["Normal", regimeNormal, setRegimeNormal, "reg-normal"],
                            ["High", regimeHigh, setRegimeHigh, "reg-high"],
                          ].map(([label, val, setter, tid]) => (
                            <tr key={label} className="border-t border-[#F3F1EC]">
                              <td className="py-1 font-medium">{label}</td>
                              <td className="py-1">
                                <Input type="number" step={0.25} value={+(val.mean * 100).toFixed(2)}
                                  data-testid={`mc-${tid}-mean`}
                                  onChange={(e) => setter({ ...val, mean: (parseFloat(e.target.value) || 0) / 100 })}
                                  className="h-7 text-[11px] text-right bg-white" />
                              </td>
                              <td className="py-1">
                                <Input type="number" step={0.1} value={+(val.vol * 100).toFixed(2)}
                                  data-testid={`mc-${tid}-vol`}
                                  onChange={(e) => setter({ ...val, vol: (parseFloat(e.target.value) || 0) / 100 })}
                                  className="h-7 text-[11px] text-right bg-white" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-2">
                        <Label className="text-[10px] text-muted-foreground">Persistence (P_stay): {Math.round(regimePStay * 100)}%</Label>
                        <input type="range" min="0.5" max="0.99" step="0.01" value={regimePStay}
                          onChange={(e) => setRegimePStay(parseFloat(e.target.value))}
                          data-testid="mc-regime-p-stay"
                          className="w-full mt-1" />
                      </div>
                    </>
                  )}
                </div>
              )}
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

            <GuardrailCard grOn={grOn} setGrOn={setGrOn} grCut={grCut} setGrCut={setGrCut} />

            <HaltCard haltOn={haltOn} setHaltOn={setHaltOn} haltDrop={haltDrop} setHaltDrop={setHaltDrop}
              haltResume={haltResume} setHaltResume={setHaltResume} />

            <RebalanceCadenceCard rebalCadence={rebalCadence} setRebalCadence={setRebalCadence} />

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

      {/* Paired A/B — Roth vs no-Roth on identical seeds. Uses the paths_w /
          paths_n arrays the engine already computes; no extra run needed. */}
      {res?.paired_delta && (
        <PairedRothVsNoRothCard res={res} testid="mc-paired-roth-vs-no-roth" />
      )}

      {/* AI plain-English analysis of the Monte Carlo result */}
      {res && (
        <AIAnalysisCard
          testid="mc-ai-analysis"
          title="AI analysis of this Monte Carlo simulation"
          focus="You are reviewing a Monte Carlo retirement simulation result. Explain in plain English what the success rate means, how converting to Roth changes resilience, sequence-of-returns risk exposure (early loss years), and whether the guardrail / shock stress-tests suggest a safer plan. 4-5 crisp bullets max."
          summary={{
            page: "Monte Carlo",
            engine: engine,
            n_trials: nTrials,
            allocation: { stocks: assets.stocks, bonds: assets.bonds, cash: assets.cash },
            success_with_conversions: res.with_conversions?.success,
            success_without_conversions: res.without_conversions?.success,
            median_ending_net_worth_with: res.with_conversions?.percentiles?.p50?.slice(-1)?.[0],
            p10_ending_net_worth_with: res.with_conversions?.percentiles?.p10?.slice(-1)?.[0],
            p90_ending_net_worth_with: res.with_conversions?.percentiles?.p90?.slice(-1)?.[0],
            guardrail: res.guardrail || null,
            shock: shockOn ? { rate: shockRate, years: shockYears, base_success: res.shock?.base_success_with, shocked_success: res.shock?.success_with } : null,
            comparing_engine: compare ? { lognormal_success: compare.lognormal?.with_conversions?.success, historical_success: compare.historical?.with_conversions?.success } : null,
          }}
        />
      )}

      {/* Regime comparison — same simulation across all 6 market-scenario
          presets. Only shown once the user has run the main MC at least
          once, so the panel picks up the same allocation, engine, correlation,
          and trial count they just used. */}
      {res && (
        <RegimeComparePanel
          scenario={scenario}
          onResult={onRegimeResult}
          mcRequestBase={{
            assets,
            shock: { enabled: shockOn, rate: shockRate, years: shockYears },
            inflation: inflationPayload(),
            correlation: { enabled: corrOn && engine === "lognormal", ...corr },
            engine,
            anchor_to_plan: anchorOn,
            guardrail: { enabled: grOn, cut_pct: grCut / 100 },
            conversion_halt: { enabled: haltOn, drop_threshold: haltDrop / 100, resume_after_positive_years: haltResume },
            rebalance: { cadence: rebalCadence },
            n_trials: nTrials,
          }}
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
