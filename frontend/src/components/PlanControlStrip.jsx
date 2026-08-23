// PlanControlStrip — top-of-tab reset row for Client Report & Presentation.
//
// Exposes three at-a-glance dropdowns that patch the scenario in place, so
// advisors can hot-swap the modeled strategy / funding order / market regime
// without leaving the report tab. Every downstream compute (projection, estate,
// EP flowchart, MC) reacts automatically because it keys on `scenario`.
//
//   • Strategy Modeled  → mutates scenario.roth (enabled / target_bracket)
//   • Funding Order     → mutates scenario.withdrawal.funding_order
//   • Market Regime     → mutates scenario.market_scenario.id
//
// Notes:
//   - Custom / phased schedules (produced by the Strategy Analyzer's phased
//     picker or the year_targets sweep) are surfaced as a read-only "Custom /
//     phased" entry; picking a bracket-fill replaces it with a single-bracket
//     schedule. This is intentional — the strip is a quick reset, not a phased
//     editor. Advisors who want to keep the phased schedule leave the strip
//     alone and use the Strategy Analyzer as usual.
import { useMemo, useState } from "react";
import { Trophy, Layers, LineChart, AlertTriangle, Save, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
} from "@/components/ui/select";
import { useMarketPresets } from "@/components/MarketScenarioSelector";
import { saveMyDefaults, revertMyDefaults, fetchDefaults } from "@/lib/api";

// Full ladder per user directive (2026-02-15).
const BRACKET_OPTIONS = [
  { key: "baseline", label: "No conversion",  bracket: null },
  { key: "b12",      label: "Fill 12%",       bracket: 0.12 },
  { key: "b22",      label: "Fill 22%",       bracket: 0.22 },
  { key: "b24",      label: "Fill 24%",       bracket: 0.24 },
  { key: "b32",      label: "Fill 32%",       bracket: 0.32 },
  { key: "b35",      label: "Fill 35%",       bracket: 0.35 },
  { key: "b37",      label: "Fill 37%",       bracket: 0.37 },
];

// Matches strategy_optimizer.FUNDING_ORDERS on the backend (see /app/backend/strategy_optimizer.py).
const FUNDING_ORDERS = [
  "Cash → Taxable → IRA → Roth",
  "Cash → IRA → Taxable → Roth",
  "Split IRA & Taxable",
];

// Derive the currently-active strategy key from scenario.roth. Phased schedules
// (year_targets set) collapse to "custom"; a matching bracket-fill maps to its
// preset key; anything else → "baseline".
const getActiveStrategyKey = (scenario) => {
  const r = scenario?.roth || {};
  if (!r.enabled) return "baseline";
  if (r.year_targets && Object.keys(r.year_targets).length > 0) return "custom";
  const bkt = r.target_bracket;
  if (bkt == null) return "custom";
  const match = BRACKET_OPTIONS.find((o) => o.bracket != null && Math.abs(o.bracket - bkt) < 1e-6);
  return match ? match.key : "custom";
};

// Resolve safe start/end years for a single-bracket conversion window when the
// scenario has never carried a value before. Falls back to the projection bounds.
const resolveConversionYears = (scenario) => {
  const r = scenario?.roth || {};
  if (r.start_year && r.end_year) return { start: r.start_year, end: r.end_year };
  const p = scenario?.projection || {};
  return {
    start: r.start_year || p.start_year || new Date().getFullYear(),
    end:   r.end_year   || p.end_year   || (p.start_year ? p.start_year + 30 : new Date().getFullYear() + 30),
  };
};

const applyStrategyKey = (setScenario, key) => {
  const opt = BRACKET_OPTIONS.find((o) => o.key === key);
  if (!opt) return;
  setScenario((prev) => {
    const next = JSON.parse(JSON.stringify(prev));
    next.roth = next.roth || {};
    if (opt.key === "baseline") {
      next.roth.enabled = false;
      delete next.roth.year_targets;
      return next;
    }
    const { start, end } = resolveConversionYears(prev);
    next.roth.enabled = true;
    next.roth.target_bracket = opt.bracket;
    next.roth.start_year = start;
    next.roth.end_year = end;
    delete next.roth.year_targets;
    return next;
  });
};

const applyFundingOrder = (setScenario, order) => {
  setScenario((prev) => {
    const next = JSON.parse(JSON.stringify(prev));
    next.withdrawal = next.withdrawal || {};
    next.withdrawal.funding_order = order;
    return next;
  });
};

const applyMarketId = (setScenario, id) => {
  setScenario((prev) => {
    const next = JSON.parse(JSON.stringify(prev));
    next.market_scenario = { ...(next.market_scenario || {}), id };
    return next;
  });
};

export const PlanControlStrip = ({ scenario, setScenario, testidPrefix = "plan-control-strip" }) => {
  const presets = useMarketPresets();
  const activeStrategyKey = useMemo(() => getActiveStrategyKey(scenario), [scenario]);
  const activeFundingOrder = scenario?.withdrawal?.funding_order || FUNDING_ORDERS[0];
  const activeMarketId = scenario?.market_scenario?.id || presets?.default_id || "historical_avg";
  const isPhased = activeStrategyKey === "custom";
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);

  // Persist the CURRENT scenario as this advisor's own defaults (Mongo-backed,
  // per-license). Distinct from the header's "Save as defaults" which writes to
  // the shared app-wide user_defaults.json — this one only affects THIS license.
  const onSaveMine = async () => {
    if (!scenario || saving) return;
    setSaving(true);
    try {
      await saveMyDefaults(scenario);
      toast.success("Saved as your defaults", {
        description: "Every future login on this license will boot with these picks.",
      });
    } catch (e) {
      toast.error("Could not save your defaults. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const onRevertMine = async () => {
    if (reverting) return;
    setReverting(true);
    try {
      await revertMyDefaults();
      // Reload the freshly-resolved defaults (falls back to shared or hardcoded).
      const d = await fetchDefaults();
      setScenario(d);
      toast.success("Reverted to app defaults", {
        description: "Your license-scoped defaults were cleared.",
      });
    } catch (e) {
      toast.error("Could not revert. Please try again.");
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#4A6741]/25 bg-[#4A6741]/[0.04] p-4 mb-4 print:hidden"
         data-testid={testidPrefix}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Trophy className="h-4 w-4 text-[#4A6741]" />
        <h4 className="font-display text-sm font-bold tracking-tight">Reset the modeled plan</h4>
        <span className="text-[10.5px] text-muted-foreground flex-1 min-w-[140px]">
          One-click swaps — every downstream page, chart and PDF re-runs against your pick.
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" onClick={onSaveMine} disabled={saving || !setScenario}
            data-testid={`${testidPrefix}-save-mine`}
            title="Persist these picks as YOUR defaults — scoped to your license. Next login on this account boots with this exact plan."
            className="h-8 gap-1.5 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/10 text-xs">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save my defaults
          </Button>
          <Button size="sm" variant="outline" onClick={onRevertMine} disabled={reverting || !setScenario}
            data-testid={`${testidPrefix}-revert-mine`}
            title="Clear YOUR saved license-scoped defaults and fall back to the app's shared defaults on the next reload."
            className="h-8 gap-1.5 rounded-full border-[#C87941]/50 text-[#C87941] hover:bg-[#C87941]/10 text-xs">
            {reverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Revert
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Strategy Modeled */}
        <div>
          <Label className="text-[10.5px] label-cap flex items-center gap-1 mb-1">
            <Trophy className="h-3 w-3 text-[#4A6741]" /> Strategy Modeled
          </Label>
          <Select
            value={isPhased ? "custom" : activeStrategyKey}
            onValueChange={(v) => v !== "custom" && applyStrategyKey(setScenario, v)}
          >
            <SelectTrigger className="h-9 text-sm bg-white"
                           data-testid={`${testidPrefix}-strategy-trigger`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel className="text-[10.5px]">Baseline</SelectLabel>
                <SelectItem value="baseline" data-testid={`${testidPrefix}-strategy-baseline`}>
                  No conversion
                </SelectItem>
              </SelectGroup>
              <SelectGroup>
                <SelectLabel className="text-[10.5px]">Fill a bracket (single-year target)</SelectLabel>
                {BRACKET_OPTIONS.filter((o) => o.bracket != null).map((o) => (
                  <SelectItem key={o.key} value={o.key}
                              data-testid={`${testidPrefix}-strategy-${o.key}`}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              {isPhased && (
                <SelectGroup>
                  <SelectLabel className="text-[10.5px]">From Strategy Analyzer</SelectLabel>
                  <SelectItem value="custom" disabled
                              data-testid={`${testidPrefix}-strategy-custom`}>
                    Custom / phased (locked)
                  </SelectItem>
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          {isPhased && (
            <p className="mt-1 flex items-start gap-1 text-[10px] text-[#C87941]">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>Phased schedule active — pick a bracket to replace it, or edit in Strategy Analyzer.</span>
            </p>
          )}
        </div>

        {/* Funding Order */}
        <div>
          <Label className="text-[10.5px] label-cap flex items-center gap-1 mb-1">
            <Layers className="h-3 w-3 text-[#4A6741]" /> Funding Order
          </Label>
          <Select value={activeFundingOrder}
                  onValueChange={(v) => applyFundingOrder(setScenario, v)}>
            <SelectTrigger className="h-9 text-sm bg-white"
                           data-testid={`${testidPrefix}-funding-trigger`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUNDING_ORDERS.map((o) => (
                <SelectItem key={o} value={o}
                            data-testid={`${testidPrefix}-funding-${o.replace(/[^a-z]/gi, "-").toLowerCase()}`}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
            Order the engine draws from when discretionary spending outruns cash.
          </p>
        </div>

        {/* Market Regime */}
        <div>
          <Label className="text-[10.5px] label-cap flex items-center gap-1 mb-1">
            <LineChart className="h-3 w-3 text-[#4A6741]" /> Market Regime
          </Label>
          <Select value={activeMarketId}
                  onValueChange={(v) => applyMarketId(setScenario, v)}>
            <SelectTrigger className="h-9 text-sm bg-white"
                           data-testid={`${testidPrefix}-regime-trigger`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(presets?.presets || []).map((p) => (
                <SelectItem key={p.id} value={p.id}
                            data-testid={`${testidPrefix}-regime-${p.id}`}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
            Historical Average reproduces the baseline; anything else is a what-if lens.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PlanControlStrip;
