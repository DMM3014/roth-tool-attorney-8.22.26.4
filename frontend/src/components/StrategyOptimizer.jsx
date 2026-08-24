import { useState, useMemo, useEffect, useRef } from "react";
import { Trophy, Play, Loader2, Sparkles, ArrowUpDown, HelpCircle, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { runStrategySweep, fmtUSD, getConfigFingerprint } from "@/lib/api";
import { StrategyStressTest } from "@/components/StrategyStressTest";
import { getStrategyLabel, appliedMatchesSweepRow } from "@/lib/strategyLabel";
import BestFundingChipStrip from "@/components/strategy/BestFundingChipStrip";
import AggressiveStrategyExplainer from "@/components/strategy/AggressiveStrategyExplainer";
import AIAnalysisCard from "@/components/AIAnalysisCard";
import { GoalPresetButtons } from "@/components/strategy/GoalPresetButtons";
import {
  RANK_OPTIONS, getOptimizerPrefs, getActiveRankOption, setOptimizerField,
} from "@/lib/optimizerPrefs";
import { METRIC_LABELS, metricDef } from "@/lib/reportLabels";

const IRMAA_TIERS = [
  { value: "", label: "No cap" },
  { value: "0", label: "Tier 0 (base — no surcharge)" },
  { value: "1", label: "Tier 1" },
  { value: "2", label: "Tier 2" },
  { value: "3", label: "Tier 3" },
];

const kindLabel = {
  baseline: "No conversion",
  single: "Fixed bracket",
  phased: "Two-phase (time-varying)",
};

// Fingerprint of the inputs a sweep GRID depends on. Deliberately excludes
// `roth`, `withdrawal.funding_order` and `optimizer` — those are the dimensions
// the sweep itself varies (and applying a leader rewrites them), so including
// them would flag the results stale the instant an advisor clicked Apply.
const sweepInputStamp = (scenario, prefs) => {
  const { roth, optimizer, withdrawal, ...rest } = scenario || {};
  const wd = { ...(withdrawal || {}) };
  delete wd.funding_order;
  return JSON.stringify({ plan: { ...rest, withdrawal: wd }, prefs });
};

export const StrategyOptimizer = ({
  scenario, setScenario, onStressResult,
  autoRunPending = false, onAutoRunConsumed = null,
}) => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [irmaaCap, setIrmaaCap] = useState("");
  const [maxAnnual, setMaxAnnual] = useState(0);
  const [refineFundingOrders, setRefineFundingOrders] = useState(false);
  // Snapshot of the inputs the on-screen sweep was actually run with.
  const [runStamp, setRunStamp] = useState(null);
  // Backend config fingerprints: the one the visible sweep was run under, and the
  // live plan's current one. Structural-hash mismatch ⇒ real input drift (accounts
  // or settings changed) — distinct from applying a leader (roth/funding only).
  const [sweepFp, setSweepFp] = useState(null);
  const [currentFp, setCurrentFp] = useState(null);

  // Goal / sweep prefs are persisted on `scenario.optimizer.*` so Plan Inputs
  // presets and StrategyOptimizer stay in sync (see /lib/optimizerPrefs.js).
  const { goal: sortKey, includePhased, sweepFundingOrders, sweepHorizon, sweepHorizonYear } = getOptimizerPrefs(scenario);
  const setSortKey = (v) => setOptimizerField(setScenario, "goal", v);
  const setIncludePhased = (v) => setOptimizerField(setScenario, "include_phased", v);
  const setSweepFundingOrders = (v) => setOptimizerField(setScenario, "sweep_funding_orders", v);
  const setSweepHorizon = (v) => setOptimizerField(setScenario, "sweep_horizon", v);
  const setSweepHorizonYear = (v) => setOptimizerField(setScenario, "sweep_horizon_year", v);

  const activeOption = getActiveRankOption(sortKey);
  const planEndYear = scenario?.projection?.end_year || null;
  // Life-expectancy year = the later of the two projected death years.
  const lifeExpectancyYear = useMemo(() => {
    const h = scenario?.household || {};
    const c = h.client_dob_year && h.client_life_expectancy ? h.client_dob_year + h.client_life_expectancy : 0;
    const s = h.spouse_dob_year && h.spouse_life_expectancy ? h.spouse_dob_year + h.spouse_life_expectancy : 0;
    return Math.max(c, s) || null;
  }, [scenario]);

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const opts = {
        include_phased: includePhased,
        irmaa_cap: irmaaCap === "" ? null : parseInt(irmaaCap, 10),
        max_annual: parseFloat(maxAnnual) || 0,
        // When the full 4D sweep is on, refine is redundant (backend also skips it).
        refine_funding_orders: refineFundingOrders && !sweepFundingOrders,
        sweep_funding_orders: sweepFundingOrders,
      };
      // Sweep horizon — extend the conversion stop-year grid (and the projection)
      // past the plan boundary when the preset asks for it.
      const horizonEnd = sweepHorizon === "life" ? lifeExpectancyYear
        : sweepHorizon === "custom" ? (parseInt(sweepHorizonYear, 10) || null) : null;
      if (horizonEnd && planEndYear && horizonEnd > planEndYear) opts.horizon_end_year = horizonEnd;
      const out = await runStrategySweep(scenario, opts);
      setResult(out);
      setSweepFp(out.config_fingerprint || null);
      setRunStamp(sweepInputStamp(scenario, {
        includePhased, sweepFundingOrders, sweepHorizon, sweepHorizonYear,
        irmaaCap, maxAnnual, refineFundingOrders,
      }));
    } catch (e) {
      setErr("Strategy sweep failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  // Auto-run bridge — Plan Inputs presets can offer a "Run sweep now" toast
  // that flips `autoRunPending=true` in the parent AND switches tabs here. On
  // mount we consume the flag exactly once: fire the sweep, then notify the
  // parent to clear it so a subsequent tab-switch doesn't re-fire the sweep.
  // The ref guards against React StrictMode's double-effect invocation.
  const autoRunFired = useRef(false);
  useEffect(() => {
    if (!autoRunPending || autoRunFired.current || running) return;
    autoRunFired.current = true;
    if (typeof onAutoRunConsumed === "function") onAutoRunConsumed();
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunPending]);

  const sortedResults = useMemo(() => {
    if (!result) return [];
    const dir = activeOption.dir === "asc" ? 1 : -1;
    return [...result.ranked].sort((a, b) => dir * ((a[sortKey] || 0) - (b[sortKey] || 0)));
  }, [result, sortKey, activeOption.dir]);

  // Detect tie clusters at the top of the ranking — happens when several bracket
  // strategies converge at the RMD wall (identical after-tax legacy).
  const topTieCount = useMemo(() => {
    if (!sortedResults.length) return 0;
    const top = sortedResults[0][sortKey] || 0;
    let n = 0;
    for (const r of sortedResults) {
      if (Math.abs((r[sortKey] || 0) - top) < 1.0) n++;
      else break;
    }
    return n;
  }, [sortedResults, sortKey]);

  // Applies a strategy config (baseline / single / phased) to the current scenario.
  // Optionally overrides the withdrawal funding order — used by the refinement panel
  // where the winning combo is (strategy + a different funding order than baseline).
  // When the 4D sweep is on, every row already carries its own `funding_order`, which
  // is preferred over the caller-supplied override.
  const applyStrategy = (b, { fundingOrder } = {}) => {
    if (!b) return;
    if (resultsStale) {
      toast.error("These results are from different plan inputs. Re-run the sweep before applying.");
      return;
    }
    const effectiveOrder = fundingOrder || b.funding_order || null;
    setScenario((p) => {
      const next = JSON.parse(JSON.stringify(p));
      if (b.kind === "baseline") {
        next.roth.enabled = false;
      } else if (b.kind === "single") {
        next.roth.enabled = true;
        next.roth.start_year = b.start_year;
        next.roth.end_year = b.stop_year;
        next.roth.target_bracket = b.bracket;
        delete next.roth.year_targets;
      } else if (b.kind === "phased" && b.segments) {
        next.roth.enabled = true;
        next.roth.start_year = b.segments[0].start_year;
        next.roth.end_year = b.segments[b.segments.length - 1].stop_year;
        const yt = {};
        b.segments.forEach((seg) => {
          for (let y = seg.start_year; y <= seg.stop_year; y++) yt[y] = seg.bracket;
        });
        next.roth.year_targets = yt;
        next.roth.target_bracket = b.segments[0].bracket;
      }
      if (effectiveOrder) {
        next.withdrawal = next.withdrawal || {};
        next.withdrawal.funding_order = effectiveOrder;
      }
      return next;
    });
    const orderNote = effectiveOrder ? ` · funding order → ${effectiveOrder}` : "";
    const legacyLine = b.after_tax_estate != null
      ? ` · after-tax legacy ${fmtUSD(b.after_tax_estate)}${
          result?.baseline?.after_tax_estate != null
            ? ` (+${fmtUSD(b.after_tax_estate - result.baseline.after_tax_estate)} vs no conversion)`
            : ""
        }`
      : "";
    toast.success(`Applied: ${b.label}${orderNote}`, { description: `${legacyLine}`.trim() || undefined });
  };

  // Apply the current WINNER — which is the top of the sortedResults list
  // (respects the user's chosen rank metric). Falls back to result.best only
  // if the sweep hasn't populated sortedResults yet.
  const applyWinner = () => applyStrategy(sortedResults[0] || result?.best);

  // Revert to "no conversion" (baseline).
  const revertToBaseline = () => {
    setScenario((p) => {
      const next = JSON.parse(JSON.stringify(p));
      next.roth = next.roth || {};
      next.roth.enabled = false;
      delete next.roth.year_targets;
      return next;
    });
    toast.success("Reverted to no conversion", {
      description: "Roth conversions disabled. Projection tabs now reflect the baseline.",
    });
  };

  // Derive a human-readable summary of what's currently applied in `scenario`,
  // pulled from scenario.roth (enabled / target_bracket / year_targets / start/end)
  // and scenario.withdrawal.funding_order. Shared helper keeps this identical
  // to the Strategy badge shown on Projection / Cashflow / Analytics / Presentation.
  const appliedSummary = useMemo(() => getStrategyLabel(scenario), [scenario]);

  const baseline = result?.baseline;
  const best = result?.best;
  // The "winner" shown in the winner card follows the ACTIVE rank metric,
  // not the backend's default legacy sort. When the user re-sorts the ranked
  // table (e.g. by lowest lifetime tax), the winner card + Apply button
  // update accordingly so the ranking key is the single source of truth.
  const winner = sortedResults[0] || best;

  // Metric-aware winner numbers. `winnerMetricValue` is what the sort key
  // reads on the winner; `baselineMetricValue` is the same read on the
  // no-conversion baseline; `winnerDelta` is directional-aware (positive =
  // better regardless of asc/desc).
  const winnerMetricValue = winner ? (winner[sortKey] || 0) : 0;
  const baselineMetricValue = baseline ? (baseline[sortKey] || 0) : 0;
  const winnerDelta = activeOption.dir === "asc"
    ? baselineMetricValue - winnerMetricValue   // e.g. tax savings — baseline higher = winner better
    : winnerMetricValue - baselineMetricValue;   // e.g. legacy — winner higher = winner better
  const deltaGood = winnerDelta > 0;

  // Legacy `delta` name still used by differsFromBest — kept identical
  // (compares winner legacy vs baseline legacy) so the "Different from best"
  // sub-widget behaviour doesn't shift under the user.
  const delta = winner && baseline ? winner.after_tax_estate - baseline.after_tax_estate : 0;

  // Micro-indicator: is the currently-applied strategy the sweep's #1 leader?
  // Compares the strategy STRUCTURALLY (bracket / window / phased segments) plus
  // the funding order — label strings never match once the 4D sweep decorates
  // them ("… · IRA-1st") or a phased row is applied, which used to pin this chip
  // on permanently. Suppressed when no sweep has run or the applied strategy is
  // inactive.
  const differsFromBest = useMemo(() => {
    if (!winner || !appliedSummary.active) return null;
    const strategyDiffers = !appliedMatchesSweepRow(scenario, winner);
    const fundingDiffers = !!winner.funding_order && winner.funding_order !== appliedSummary.fundingOrder;
    if (!strategyDiffers && !fundingDiffers) return null;
    // Use the ACTIVE metric for the gap so the tooltip matches the ranking
    // criterion the user is currently viewing.
    const gap = winner && baseline ? Math.abs(winnerDelta) : 0;
    return { labelDiffers: strategyDiffers, fundingDiffers, gap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner, baseline, appliedSummary, winnerDelta, scenario]);

  // Is the ranking on screen still the ranking these inputs produce? Changing a
  // Goal Preset (or any sweep switch / plan input) re-sorts the OLD grid but
  // cannot add the rows the new settings would have generated, so say so instead
  // of quietly showing a stale leader. Goal alone is excluded: re-sorting the
  // same grid by a different metric is a legitimate live operation.
  const sweepStamp = useMemo(() => sweepInputStamp(scenario, {
    includePhased, sweepFundingOrders, sweepHorizon, sweepHorizonYear,
    irmaaCap, maxAnnual, refineFundingOrders,
  }), [scenario, includePhased, sweepFundingOrders, sweepHorizon, sweepHorizonYear,
       irmaaCap, maxAnnual, refineFundingOrders]);
  const sweepStale = !!result && !!runStamp && runStamp !== sweepStamp;

  // Live plan fingerprint — refreshed (debounced) whenever the scenario changes,
  // via the shared backend helper so JS/Python never disagree on the hash.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      getConfigFingerprint(scenario)
        .then((fp) => { if (alive) setCurrentFp(fp); })
        .catch(() => {});
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [scenario]);

  // True input drift: the visible sweep was computed from different accounts /
  // settings than the current plan (roth/funding changes are excluded via the
  // structural hash, so applying a leader never trips this).
  const configStale = !!result && !!sweepFp?.structural_hash && !!currentFp?.structural_hash
    && sweepFp.structural_hash !== currentFp.structural_hash;
  const resultsStale = sweepStale || configStale;

  // Economic-completion insight — earliest sibling stop-year (same bracket /
  // start / funding order) whose goal metric ties the winner within 0.05%.
  // Conversions past that year are pure tax prepayments (no heir-rate benefit).
  // When the earliest tie IS the last sampled stop-year, the metric was still
  // improving at the sweep boundary — the true optimum may lie beyond it.
  const econInsight = useMemo(() => {
    if (!winner || winner.kind !== "single" || !result?.ranked) return null;
    const siblings = result.ranked.filter((r) =>
      r.kind === "single"
      && r.bracket === winner.bracket
      && r.start_year === winner.start_year
      && (r.funding_order || "") === (winner.funding_order || ""));
    if (siblings.length < 2) return null;
    const tol = Math.abs(winnerMetricValue) * 0.0005;
    const withinTol = (r) => activeOption.dir === "asc"
      ? (r[sortKey] || 0) <= winnerMetricValue + tol
      : (r[sortKey] || 0) >= winnerMetricValue - tol;
    const tiedStops = siblings.filter(withinTol).map((r) => r.stop_year);
    if (!tiedStops.length) return null;
    const econYear = Math.min(...tiedStops);
    const maxStopSampled = Math.max(...siblings.map((r) => r.stop_year));
    const horizonEnd = result.horizon_end_year_used || result.plan_end_year || scenario?.projection?.end_year;
    return { econYear, maxStopSampled, horizonEnd, atBoundary: econYear >= maxStopSampled };
  }, [winner, result, sortKey, activeOption.dir, winnerMetricValue, scenario]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="strategy-controls">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Trophy className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Multi-Year Conversion Strategy Analyzer</h3>
          <div className="ml-auto flex items-center gap-2 flex-wrap" data-testid="applied-strategy-badge">
            <span className="label-cap text-muted-foreground text-[10px]">Currently applied</span>
            {appliedSummary.active ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#4A6741]/40 bg-[#4A6741]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#4A6741]"
                  title="The Roth conversion strategy that will drive the projection tabs">
                  {appliedSummary.label}
                </span>
                <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-[#C87941]/40 bg-[#C87941]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#C87941]"
                  title="The withdrawal funding order used when discretionary cashflow is short">
                  {appliedSummary.fundingOrder}
                </span>
                {differsFromBest && (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" onClick={applyWinner}
                          data-testid="applied-strategy-differs-from-best"
                          className="inline-flex items-center gap-1 rounded-full border border-[#C87941] bg-[#C87941]/10 px-2 py-0.5 text-[10px] font-semibold text-[#C87941] hover:bg-[#C87941]/20 transition-colors">
                          <AlertTriangle className="h-3 w-3" />
                          Different from leader
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs bg-[#1A1A1A] text-white text-[11px] leading-snug px-3 py-2">
                        The applied strategy isn&apos;t the sweep&apos;s #1 leader
                        {" "}on <span className="font-semibold">{activeOption.label}</span>.
                        {differsFromBest.labelDiffers && (
                          <> Leader: <span className="font-semibold">{winner?.label}</span>.</>
                        )}
                        {differsFromBest.fundingDiffers && winner?.funding_order && (
                          <> Leader uses funding order <span className="font-semibold">{winner.funding_order}</span>.</>
                        )}
                        {differsFromBest.gap > 0 && (
                          <> Gap on this metric: <span className="font-semibold">{fmtUSD(differsFromBest.gap)}</span>.</>
                        )}
                        {sweepStale && (
                          <> These results are from an earlier sweep — re-run the sweep to rank the current settings.</>
                        )}
                        {" "}Click to apply the leader.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <button type="button" onClick={revertToBaseline}
                  data-testid="applied-strategy-revert"
                  title="Turn off Roth conversions and return the projection to the no-conversion baseline"
                  className="inline-flex items-center gap-1 rounded-full border border-[#B84A4A]/40 bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#B84A4A] hover:bg-[#B84A4A]/10">
                  Revert to no conversion
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#EBE8E0] bg-[#F3F1EC] px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                title="No Roth conversion is active. Apply a strategy from the sweep below to change this.">
                No conversion active
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          Sweeps <span className="font-medium">start year × stop year × target bracket</span>, plus
          time-varying two-phase schedules pivoting off the SS claim year and the RMD wall
          (e.g. <span className="font-medium">&ldquo;fill 32% until SS starts, then 24% after&rdquo;</span>).
          Ranks every candidate by the goal you choose below &mdash; with lifetime-tax as tiebreaker.
          This is the multi-year search most single-year Roth calculators can&apos;t do.
        </p>

        {/* One-click goal presets — atomic goal + phased + funding-order sweep setup.
             Also mirrored on the Plan Inputs tab; both write to scenario.optimizer.*. */}
        <div className="mb-4">
          <GoalPresetButtons scenario={scenario} setScenario={setScenario}
            testidPrefix="strategy-goal-preset" />
        </div>

        {/* Primary goal picker — user's optimization objective drives the entire sweep view
             (winner card, ranked table, AI analysis). Kept prominent so advisors set the
             lens BEFORE running, not after scrolling through results. */}
        <div className="mb-5 rounded-lg border border-[#4A6741]/25 bg-[#4A6741]/5 p-4"
             data-testid="strategy-goal-picker">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[16rem]">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#4A6741]" />
                <Label className="text-[10px] uppercase tracking-wide font-semibold text-[#4A6741]">
                  Illustration goal
                </Label>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                Pick the outcome the sweep should maximize (or minimize). The leader card,
                ranked table, and AI analysis all follow this lens; change it anytime.
              </p>
            </div>
            <div className="flex flex-col gap-1 min-w-[300px]">
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                data-testid="strategy-goal-select"
                title={activeOption.hint}
                className="text-sm h-10 w-full rounded-md bg-white border border-[#4A6741]/40 px-3 pr-8
                           focus:outline-none focus:ring-2 focus:ring-[#4A6741]/30 focus:border-[#4A6741]
                           font-medium text-[#4A6741] cursor-pointer">
                {RANK_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key} title={o.hint}>{o.label}</option>
                ))}
              </select>
              <span className="text-[10px] text-muted-foreground leading-snug">
                {activeOption.hint}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">IRMAA tier cap</Label>
            <select value={irmaaCap} onChange={(e) => setIrmaaCap(e.target.value)}
              data-testid="strategy-irmaa-cap"
              className="mt-1 h-9 w-full rounded-md bg-[#F9F8F6] text-sm border border-input px-3">
              {IRMAA_TIERS.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">Skips MAGI beyond a chosen Medicare tier.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Max annual conversion ($)</Label>
            <Input type="number" step={10000} value={maxAnnual}
              onChange={(e) => setMaxAnnual(e.target.value)}
              data-testid="strategy-max-annual"
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">0 = no cap; caps per-year conversion.</p>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={includePhased} onCheckedChange={setIncludePhased}
              data-testid="strategy-include-phased" />
            <div>
              <Label className="text-xs text-muted-foreground">Include two-phase schedules</Label>
              <p className="text-[10px] text-muted-foreground">SS-pivot &amp; RMD-pivot brackets.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={sweepFundingOrders} onCheckedChange={setSweepFundingOrders}
              data-testid="strategy-sweep-funding" />
            <div>
              <Label className="text-xs text-muted-foreground">Sweep every funding order</Label>
              <p className="text-[10px] text-muted-foreground">4th dimension: every strategy × 3 orders (~3× compute).</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 pt-5 ${sweepFundingOrders ? "opacity-50" : ""}`}>
            <Switch
              checked={refineFundingOrders && !sweepFundingOrders}
              onCheckedChange={setRefineFundingOrders}
              disabled={sweepFundingOrders}
              data-testid="strategy-refine-funding"
            />
            <div>
              <Label className="text-xs text-muted-foreground">Refine funding order</Label>
              <p className="text-[10px] text-muted-foreground">
                {sweepFundingOrders
                  ? "Covered by the full sweep — no post-pass needed."
                  : "Top-2 per bracket (37–22%) × 3 orders (~3s)."}
              </p>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Sweep horizon</Label>
            <select value={sweepHorizon} onChange={(e) => setSweepHorizon(e.target.value)}
              data-testid="strategy-sweep-horizon"
              className="mt-1 h-9 w-full rounded-md bg-[#F9F8F6] text-sm border border-input px-3">
              <option value="plan">Plan boundary{planEndYear ? ` (${planEndYear})` : ""}</option>
              <option value="life">Life-expectancy year{lifeExpectancyYear ? (lifeExpectancyYear === planEndYear ? ` (${lifeExpectancyYear} — same as plan)` : ` (${lifeExpectancyYear})`) : ""}</option>
              <option value="custom">Custom year…</option>
            </select>
            {sweepHorizon === "custom" && (
              <Input type="number" value={sweepHorizonYear ?? ""}
                onChange={(e) => setSweepHorizonYear(parseInt(e.target.value, 10) || null)}
                data-testid="strategy-sweep-horizon-year"
                className="mt-1 bg-[#F9F8F6] h-8" placeholder={`${(planEndYear || 2062) + 5}`} />
            )}
            <p className="text-[10px] text-muted-foreground mt-1">Stop-years sweep to this year — extends the projection when past the plan boundary.</p>
          </div>
          <div className="flex items-end">
            <Button onClick={run} disabled={running}
              className="bg-[#4A6741] hover:bg-[#3B5234] text-white w-full"
              data-testid="strategy-run">
              {running ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sweeping…</>)
                : (<><Play className="h-4 w-4 mr-1" /> Run strategy sweep</>)}
            </Button>
          </div>
        </div>
        {err && <p className="mt-3 text-xs text-[#B84A4A]" data-testid="strategy-error">{err}</p>}
        {sweepStale && (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-[#C87941] bg-[#C87941]/10 px-3 py-2"
               data-testid="strategy-sweep-stale">
            <AlertTriangle className="h-4 w-4 text-[#C87941] shrink-0" />
            <p className="text-[11px] leading-snug text-[#8A4B1F] flex-1">
              <strong>The ranking below is from an earlier sweep.</strong> Plan inputs or sweep settings (phased
              schedules, funding-order sweep, horizon, IRMAA cap, annual cap) changed since it ran, so rows the new
              settings would generate are missing. Re-run to rank the current plan. Changing only the ranking goal
              does not need a re-run — the same grid is simply re-sorted.
            </p>
            <Button size="sm" onClick={run} disabled={running}
              data-testid="strategy-sweep-stale-rerun"
              className="bg-[#C87941] hover:bg-[#A9622F] text-white h-7 text-[11px] px-3">
              {running ? "Sweeping…" : "Re-run sweep"}
            </Button>
          </div>
        )}
        {configStale && (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-[#B84A4A] bg-[#B84A4A]/10 px-3 py-2"
               data-testid="strategy-config-stale">
            <AlertTriangle className="h-4 w-4 text-[#B84A4A] shrink-0" />
            <p className="text-[11px] leading-snug text-[#8A2F2F] flex-1">
              <strong>These results were computed from different plan inputs than the current plan</strong>{" "}
              (accounts or settings have changed). Re-run the sweep.
            </p>
            <Button size="sm" onClick={run} disabled={running}
              data-testid="strategy-config-stale-rerun"
              className="bg-[#B84A4A] hover:bg-[#9A3B3B] text-white h-7 text-[11px] px-3">
              {running ? "Sweeping…" : "Re-run sweep"}
            </Button>
          </div>
        )}
      </Card>

      {/* Winner card — reflects the currently-selected rank metric */}
      {winner && (
        <Card className="p-6 border-[#4A6741]/40 bg-[#4A6741]/5 shadow-none" data-testid="strategy-winner">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Sparkles className="h-4 w-4 text-[#4A6741]" />
                <span className="label-cap text-[#4A6741] text-[10px]">Best strategy on</span>
                <span className="inline-flex items-center rounded-full bg-[#4A6741] text-white text-[10px] font-medium px-2 py-0.5"
                      data-testid="strategy-winner-metric-chip"
                      title={activeOption.hint}>
                  {activeOption.label}
                </span>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="Why this may differ from Find Optimal Bracket" data-testid="strategy-winner-why"
                        className="inline-flex items-center gap-1 rounded-full border border-[#4A6741]/40 bg-white px-2 py-0.5 text-[10px] font-medium text-[#4A6741] hover:bg-[#4A6741]/10">
                        <HelpCircle className="h-3 w-3" /> Why?
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs bg-[#1A1A1A] text-white text-[11px] leading-snug px-3 py-2">
                      This searches <span className="font-semibold">time-varying phased schedules</span> AND
                      <span className="font-semibold"> narrower conversion windows</span> — not just a single flat bracket for your whole horizon.
                      Leader shown here follows the rank metric you picked below
                      (<span className="font-semibold">{activeOption.label}</span>) with lowest lifetime tax as tiebreaker;
                      change the dropdown to re-crown a different leader on the fly.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <h3 className="font-display text-2xl font-bold tracking-tight" data-testid="strategy-winner-label">{winner.label}</h3>
              <p className="text-xs text-muted-foreground mt-1">{kindLabel[winner.kind]}</p>
              {result?.sweep_funding_orders && winner.funding_order && (
                <p className="text-xs mt-1" data-testid="strategy-winner-funding">
                  Funding order: <span className="font-medium text-[#1A1A1A]">{winner.funding_order}</span>
                  {winner.funding_order !== (scenario?.withdrawal?.funding_order || "Cash → Taxable → IRA → Roth") && (
                    <span className="ml-2 inline-block rounded-full border border-[#C87941] bg-[#C87941]/10 px-2 py-0.5 text-[9px] font-medium text-[#C87941]">
                      Differs from current plan
                    </span>
                  )}
                </p>
              )}

              {/* Primary line — the active metric value, formatted for display */}
              <p className="text-xs mt-2" data-testid="strategy-winner-primary">
                <span className="text-muted-foreground">{activeOption.label}: </span>
                <span className="font-bold text-[#4A6741]">
                  {sortKey === "lifetime_taxes"
                    ? fmtUSD(winnerMetricValue)
                    : fmtUSD(winnerMetricValue)}
                </span>
                {" "}
                <span className={`ml-1 inline-flex items-center rounded-full px-1.5 py-[1px] text-[9px] font-medium
                    ${deltaGood ? "bg-[#4A6741]/15 text-[#4A6741]" : "bg-[#C87941]/15 text-[#C87941]"}`}
                    data-testid="strategy-winner-delta">
                  {deltaGood ? "▲" : "▼"} {fmtUSD(Math.abs(winnerDelta))} {" "}
                  {activeOption.dir === "asc"
                    ? (deltaGood ? "less tax vs. no conversion" : "more tax vs. no conversion")
                    : (deltaGood ? "vs. no conversion" : "less vs. no conversion")}
                </span>
              </p>

              {/* Secondary reference numbers — always show all four key stats
                  so the advisor sees the full trade-off, not just the sort key. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-[11px] mt-3"
                   data-testid="strategy-winner-secondary">
                {sortKey !== "after_tax_estate" && (
                  <MiniStat label={METRIC_LABELS.after_tax_estate.label} def={metricDef("after_tax_estate")} value={fmtUSD(winner.after_tax_estate)} />
                )}
                {sortKey !== "after_tax_estate_pv" && (
                  <MiniStat label={METRIC_LABELS.after_tax_estate_pv.label} def={metricDef("after_tax_estate_pv")} value={fmtUSD(winner.after_tax_estate_pv)} />
                )}
                {sortKey !== "after_tax_estate_at_death" && (
                  <MiniStat label={METRIC_LABELS.after_tax_estate_at_death.label} def={metricDef("after_tax_estate_at_death")} value={fmtUSD(winner.after_tax_estate_at_death)} />
                )}
                {sortKey !== "value_at_death" && (
                  <MiniStat label={METRIC_LABELS.value_at_death.label} def={metricDef("value_at_death")} value={fmtUSD(winner.value_at_death)} />
                )}
                {sortKey !== "ending_roth" && (
                  <MiniStat label={METRIC_LABELS.ending_roth.label} def={metricDef("ending_roth")} value={fmtUSD(winner.ending_roth)} />
                )}
                {sortKey !== "lifetime_taxes" && (
                  <MiniStat label={METRIC_LABELS.lifetime_taxes.label} def={metricDef("lifetime_taxes")} value={fmtUSD(winner.lifetime_taxes)} warn />
                )}
                <MiniStat label={METRIC_LABELS.total_converted.label} def={metricDef("total_converted")} value={fmtUSD(winner.total_converted)} />
              </div>

              {sweepFp && (
                <p className="mt-3 text-[10px] text-muted-foreground leading-snug" data-testid="strategy-run-on">
                  <span className="font-semibold text-[#4A6741]">Run on:</span>{" "}
                  {new Date(sweepFp.computed_at).toLocaleString()} ·{" "}
                  investable {fmtUSD(sweepFp.summary?.total_starting_investable)} ·{" "}
                  taxable {fmtUSD(sweepFp.summary?.taxable_balance)} ·{" "}
                  IRA {fmtUSD(sweepFp.summary?.ira_balance)} ·{" "}
                  funding {sweepFp.summary?.funding_order} ·{" "}
                  conv {sweepFp.summary?.conversion_window} ·{" "}
                  <span className="font-mono">#{sweepFp.hash}</span>
                </p>
              )}

              {econInsight?.atBoundary && (
                <div className="mt-3 rounded-md border border-[#C87941]/40 bg-[#C87941]/10 px-3 py-2 text-[11px] text-[#8A5A20] flex items-start gap-2"
                     data-testid="strategy-winner-boundary-badge">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    <strong>Stops at the sweep boundary ({econInsight.horizonEnd}).</strong> The goal metric was still
                    improving at the last sampled stop-year, so the true optimum may lie beyond this plan&apos;s horizon.
                    Set <em>Sweep horizon</em> to the Life-expectancy year and re-run.
                  </span>
                </div>
              )}
              {econInsight && !econInsight.atBoundary && (
                <div className="mt-3 rounded-md border border-[#4A6741]/30 bg-[#4A6741]/10 px-3 py-2 text-[11px] text-[#2F4A2A]"
                     data-testid="strategy-winner-econ-callout">
                  <strong>Economic completion year: {econInsight.econYear}.</strong> Conversions past {econInsight.econYear} show
                  no measurable gain (within 0.05%) on {activeOption.label} — they only prepay tax the plan would otherwise
                  pay at the same rate later, with no heir-rate benefit.
                  {econInsight.econYear < winner.stop_year && (
                    <> The leading window runs to {winner.stop_year}, which ties within tolerance — {econInsight.econYear} is
                    the earliest equivalent stop.</>
                  )}
                </div>
              )}
            </div>
            <Button onClick={applyWinner} disabled={resultsStale}
              className="bg-[#4A6741] hover:bg-[#3B5234] text-white disabled:opacity-50"
              data-testid="strategy-apply">
              Apply leader
            </Button>
          </div>
        </Card>
      )}

      {/* Why does the analyzer favor early high-tax conversions? — collapsible explainer */}
      <AggressiveStrategyExplainer visible={!!winner} />

      {/* AI plain-English analysis of the current ranking */}
      {winner && baseline && (
        <AIAnalysisCard
          testid="strategy-ai-analysis"
          title="AI analysis of this strategy sweep"
          focus={`You are reviewing a multi-year Roth-conversion strategy sweep result. The user is currently ranking by "${activeOption.label}". Explain in plain English why the leader beats the baseline, the trade-offs of the leader's funding order and bracket target, and any caveats (aggressive early conversions, RMD wall, IRMAA cliffs, SS timing). 4-5 crisp bullets max.`}
          summary={{
            page: "Strategy Analyzer",
            rank_metric: activeOption.label,
            rank_direction: activeOption.dir,
            strategies_evaluated: result.results.length,
            winner: {
              label: winner.label,
              kind: winner.kind,
              funding_order: winner.funding_order,
              after_tax_estate_10yr: winner.after_tax_estate,
              after_tax_estate_pv: winner.after_tax_estate_pv,
              after_tax_estate_at_death: winner.after_tax_estate_at_death,
              value_at_death: winner.value_at_death,
              lifetime_taxes: winner.lifetime_taxes,
              total_converted: winner.total_converted,
              ending_roth: winner.ending_roth,
            },
            baseline_no_conversion: {
              after_tax_estate_10yr: baseline.after_tax_estate,
              after_tax_estate_pv: baseline.after_tax_estate_pv,
              lifetime_taxes: baseline.lifetime_taxes,
            },
            delta_on_active_metric: winnerDelta,
          }}
        />
      )}

      {/* Results table */}
      {result && (
        <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="strategy-results">
          {result?.sweep_funding_orders ? (
            <BestFundingChipStrip result={result} applyStrategy={applyStrategy}
              sortKey={sortKey} rankDir={activeOption.dir} />
          ) : (
            <div className="mb-4 rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] p-3 flex items-start gap-2"
                 data-testid="best-funding-per-bracket-hint">
              <Trophy className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                Enable <span className="font-semibold text-[#4A6741]">Sweep funding orders</span> above to
                unlock a "Best funding order per bracket" summary here. With the sweep on, this strip shows
                a one-click chip for the leading combo of{" "}
                <span className="font-medium">bracket ceiling + conversion window + funding order</span> at
                each target rate.
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="font-display text-lg font-bold tracking-tight">All strategies ranked</h3>
              <p className="text-xs text-muted-foreground">
                {result.results.length} strategies evaluated · sorted by{" "}
                <span className="font-medium">{activeOption.label}</span>{" "}
                <span className="text-muted-foreground/70">({activeOption.dir === "asc" ? "lower is better" : "higher is better"})</span>
                {topTieCount > 1 && (
                  <span className="ml-2 text-[#C87941]" data-testid="strategy-tie-note">
                    · <span className="font-medium">Ties broken by lifetime tax:</span> the top {topTieCount} rows have identical
                    {" "}<span className="font-medium">{activeOption.label}</span> (Fill-32%+ variants converge once conversions hit
                    the RMD wall), so we rank by <span className="font-medium">lowest lifetime tax</span> among them.
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Re-rank by goal</span>
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                  data-testid="strategy-sort-select"
                  title={activeOption.hint}
                  className="text-xs h-9 min-w-[280px] rounded-full bg-[#F9F8F6] border border-[#EBE8E0] px-3 pr-8
                             focus:outline-none focus:ring-2 focus:ring-[#4A6741]/30 focus:border-[#4A6741]
                             font-medium text-[#4A6741] cursor-pointer">
                  {RANK_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key} title={o.hint}>{o.label}</option>
                  ))}
                </select>
              </div>
              <span className="text-[10px] text-muted-foreground/70 max-w-[320px] text-right leading-snug">
                Same as the goal picker above &mdash; kept here so you can re-rank without scrolling.
              </span>
            </div>
          </div>
          <div className="overflow-auto max-h-[1400px] rounded border border-[#EBE8E0]/60" data-testid="strategy-results-scroll">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left sticky top-0 bg-white shadow-[0_1px_0_0_#EBE8E0] z-10">
                <tr className="border-b border-[#EBE8E0]">
                  <th className="px-2">#</th>
                  <th className="px-2">Strategy</th>
                  <th className="px-2">Type</th>
                  <th className="px-2">Funding order</th>
                  <th className={`px-2 text-right ${sortKey === "after_tax_estate" ? "text-[#4A6741] font-semibold" : ""}`}
                    title={metricDef("after_tax_estate")}>
                    {METRIC_LABELS.after_tax_estate.label}
                    <span className="block text-[9px] font-normal normal-case text-muted-foreground">
                      {METRIC_LABELS.after_tax_estate.subtitle}
                    </span>
                  </th>
                  <th className={`px-2 text-right ${sortKey === "after_tax_estate_pv" ? "text-[#4A6741] font-semibold" : ""}`}
                    title={metricDef("after_tax_estate_pv")}>
                    PV (today&apos;s $)
                  </th>
                  <th className={`px-2 text-right ${sortKey === "after_tax_estate_at_death" ? "text-[#4A6741] font-semibold" : ""}`}
                    title={metricDef("after_tax_estate_at_death")}>
                    {METRIC_LABELS.after_tax_estate_at_death.label}
                  </th>
                  <th className={`px-2 text-right ${sortKey === "value_at_death" ? "text-[#4A6741] font-semibold" : ""}`}
                    title={metricDef("value_at_death")}>
                    {METRIC_LABELS.value_at_death.label}
                  </th>
                  <th className="px-2 text-right">Total converted</th>
                  <th className={`px-2 text-right ${sortKey === "lifetime_taxes" ? "text-[#4A6741] font-semibold" : ""}`}>
                    Lifetime tax
                  </th>
                  <th className={`px-2 text-right ${sortKey === "ending_roth" ? "text-[#4A6741] font-semibold" : ""}`}>
                    Ending Roth
                  </th>
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r, i) => (
                  <tr key={r.label} className={`border-b border-[#F3F1EC] ${i === 0 ? "bg-[#4A6741]/5" : ""}`}
                    data-testid={`strategy-row-${i}`}>
                    <td className="px-2 py-1.5 font-medium">{i + 1}</td>
                    <td className="px-2">{r.label}</td>
                    <td className="px-2 text-muted-foreground">{kindLabel[r.kind]}</td>
                    <td className="px-2 text-muted-foreground" data-testid={`strategy-row-funding-${i}`}
                        title={r.funding_order}>
                      {r.funding_order_short || r.funding_order || "—"}
                    </td>
                    <td className={`px-2 text-right ${sortKey === "after_tax_estate" ? "font-semibold text-[#4A6741]" : "font-medium"}`}>{fmtUSD(r.after_tax_estate)}</td>
                    <td className={`px-2 text-right ${sortKey === "after_tax_estate_pv" ? "font-semibold text-[#4A6741]" : ""}`}>{fmtUSD(r.after_tax_estate_pv)}</td>
                    <td className={`px-2 text-right ${sortKey === "after_tax_estate_at_death" ? "font-semibold text-[#4A6741]" : ""}`}>{fmtUSD(r.after_tax_estate_at_death)}</td>
                    <td className={`px-2 text-right ${sortKey === "value_at_death" ? "font-semibold text-[#4A6741]" : ""}`}>{fmtUSD(r.value_at_death)}</td>
                    <td className="px-2 text-right">{fmtUSD(r.total_converted)}</td>
                    <td className={`px-2 text-right ${sortKey === "lifetime_taxes" ? "font-semibold text-[#4A6741]" : ""}`}>{fmtUSD(r.lifetime_taxes)}</td>
                    <td className={`px-2 text-right ${sortKey === "ending_roth" ? "font-semibold text-[#4A6741]" : ""}`}>{fmtUSD(r.ending_roth)}</td>
                    <td className="px-2 text-right">
                      <Button size="sm" variant="outline"
                        onClick={() => applyStrategy(r)}
                        disabled={resultsStale}
                        data-testid={`strategy-apply-row-${i}`}
                        className="h-7 px-2 text-[11px] border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/10 disabled:opacity-50">
                        Apply
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Monte Carlo stress test of the top candidates — paired random-market trials */}
      {result && (
        <StrategyStressTest scenario={scenario} sweepResult={result} applyStrategy={applyStrategy}
          onResult={onStressResult} />
      )}

      {/* Funding-order refinement pass — only rendered when the run enabled it */}
      {result?.funding_order_refinement && (
        <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="strategy-funding-refinement">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Funding-order refinement</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
            For each of the top 2 strategies at brackets{" "}
            <span className="font-medium">37% / 35% / 32% / 24% / 22%</span>, each candidate was re-run against all
            three withdrawal funding orders — the best legacy across those 3 orders is highlighted below. Baseline:
            <span className="font-medium"> {result.funding_order_refinement.baseline_funding_order}</span>.
            {result.funding_order_refinement.any_improvement ? (
              <span className="ml-1 text-[#4A6741] font-medium">
                A different funding order improves at least one strategy — see rows highlighted below.
              </span>
            ) : (
              <span className="ml-1 text-muted-foreground italic">
                No candidate benefits from a different funding order in this scenario — expected when the IRA is
                fully drained by the conversion, since only the middle-tier (Taxable vs IRA) discretionary spending
                is affected by the order.
              </span>
            )}
          </p>

          {result.funding_order_refinement.any_improvement && result.funding_order_refinement.best_improvement && (
            <div className="mb-4 p-3 rounded border border-[#4A6741]/40 bg-[#4A6741]/5 flex items-start justify-between gap-4 flex-wrap"
              data-testid="refinement-best">
              <p className="text-xs flex-1 min-w-[16rem]">
                <span className="font-medium text-[#4A6741]">Largest gain:</span>{" "}
                <span className="font-medium">{result.funding_order_refinement.best_improvement.label}</span>{" "}
                switching to{" "}
                <span className="font-medium">{result.funding_order_refinement.best_improvement.best_funding_order}</span>{" "}
                improves after-tax legacy by{" "}
                <span className="font-medium text-[#4A6741]">
                  {fmtUSD(result.funding_order_refinement.best_improvement.improvement)}
                </span>{" "}
                ({result.funding_order_refinement.best_improvement.improvement_pct}%).
              </p>
              <Button size="sm"
                onClick={() => applyStrategy(
                  { ...result.funding_order_refinement.best_improvement,
                    after_tax_estate: result.funding_order_refinement.best_improvement.variants
                      ?.find((v) => v.funding_order === result.funding_order_refinement.best_improvement.best_funding_order)?.after_tax_estate },
                  { fundingOrder: result.funding_order_refinement.best_improvement.best_funding_order }
                )}
                className="bg-[#4A6741] hover:bg-[#3B5234] text-white shrink-0"
                data-testid="refinement-apply-best">
                Apply best funding order
              </Button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b border-[#EBE8E0]">
                  <th className="px-2 py-1">Strategy</th>
                  <th className="px-2">Bracket</th>
                  <th className="px-2 text-right">Cash → Taxable → IRA → Roth</th>
                  <th className="px-2 text-right">Cash → IRA → Taxable → Roth</th>
                  <th className="px-2 text-right">Split IRA &amp; Taxable</th>
                  <th className="px-2">Leader</th>
                  <th className="px-2 text-right">Δ vs baseline</th>
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody>
                {result.funding_order_refinement.candidates.map((c, i) => {
                  const byOrder = Object.fromEntries(c.variants.map((v) => [v.funding_order, v]));
                  const cell = (order) => {
                    const v = byOrder[order];
                    if (!v) return <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>;
                    const isWinner = c.best_funding_order === order;
                    const isBaseline = v.is_baseline;
                    return (
                      <td className={`px-2 py-1.5 text-right ${isWinner ? "font-bold text-[#4A6741]" : ""}`}>
                        {fmtUSD(v.after_tax_estate)}
                        {isBaseline && <span className="ml-1 text-[10px] text-muted-foreground">(base)</span>}
                      </td>
                    );
                  };
                  const improved = c.improvement > 1;
                  const winningVariant = c.variants.find((v) => v.funding_order === c.best_funding_order);
                  return (
                    <tr key={c.label} className={`border-b border-[#F3F1EC] ${improved ? "bg-[#4A6741]/5" : ""}`}
                        data-testid={`refinement-row-${i}`}>
                      <td className="px-2 py-1.5">{c.label}</td>
                      <td className="px-2">{c.bracket ? `${Math.round(c.bracket * 100)}%` : "—"}</td>
                      {cell("Cash → Taxable → IRA → Roth")}
                      {cell("Cash → IRA → Taxable → Roth")}
                      {cell("Split IRA & Taxable")}
                      <td className="px-2 font-medium">{c.best_funding_order}</td>
                      <td className={`px-2 text-right ${improved ? "font-medium text-[#4A6741]" : "text-muted-foreground"}`}>
                        {improved ? `+${fmtUSD(c.improvement)}` : "—"}
                      </td>
                      <td className="px-2 text-right">
                        <Button size="sm" variant="outline"
                          onClick={() => applyStrategy(
                            { ...c, after_tax_estate: winningVariant?.after_tax_estate },
                            { fundingOrder: c.best_funding_order }
                          )}
                          data-testid={`refinement-apply-row-${i}`}
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
          <p className="text-[10px] text-muted-foreground mt-3">
            Method: for each key bracket 37 / 35 / 32 / 24 / 22, take the top 2 by after-tax legacy from the main sweep,
            then re-run each with the alternative funding orders. The baseline cell (labeled &ldquo;base&rdquo;) reuses the
            already-computed sweep result — the other two are fresh projections. Total added compute:
            ≤ 20 extra projections, ~3 seconds.
          </p>
        </Card>
      )}

      {!result && !running && (
        <Card className="p-8 border-[#EBE8E0] shadow-none text-center" data-testid="strategy-empty">
          <Trophy className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Run the sweep to see the full ranking of strategies.</p>
        </Card>
      )}
    </div>
  );
};

// Compact stat row inside the Winner card — one row per non-sorted metric so
// the advisor always sees the full trade-off (legacy AND lifetime tax AND
// portfolio value) even when a single metric drives the ranking.
const MiniStat = ({ label, value, warn, def }) => (
  <div className="flex flex-col leading-tight" title={def || undefined}>
    <span className="label-cap text-muted-foreground text-[9px]">{label}</span>
    <span className={`font-medium tabular-nums ${warn ? "text-[#C87941]" : "text-[#1A1A1A]"}`}>{value}</span>
  </div>
);

