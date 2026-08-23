import { toast } from "sonner";
import { Trophy, Coins, Sparkles, TrendingUp, Check } from "lucide-react";
import {
  GOAL_PRESETS, getOptimizerPrefs, presetMatchState, applyPresetToScenario,
} from "@/lib/optimizerPrefs";

// One-click "goal presets" for the Strategy Analyzer.
//
// Renders a row of large tap-targets, one per PRESET. Clicking a preset writes
// `scenario.optimizer.{goal, include_phased, sweep_funding_orders, preset_id}`
// atomically — the Strategy Analyzer page reads those fields directly, so the
// choice is instantly reflected there without a run. Rendered on both PlanInputs
// (top-of-page) and StrategyOptimizer (above the goal picker).

const PRESET_ICONS = {
  legacy_first:       Trophy,
  tax_minimizer:      Coins,
  roth_maximizer:     Sparkles,
  portfolio_at_death: TrendingUp,
};

export const GoalPresetButtons = ({
  scenario, setScenario, compact = false, showHeading = true, testidPrefix = "goal-preset",
  onRunSweep = null,
}) => {
  const prefs = getOptimizerPrefs(scenario);

  const onClick = (preset) => {
    applyPresetToScenario(setScenario, preset);
    // When the host (e.g. Plan Inputs) provides an `onRunSweep` hook, offer a
    // one-tap action that jumps to the Strategy Analyzer tab and kicks off the
    // sweep immediately — the preset already primed goal/phased/funding-sweep
    // fields, so the user can go from "pick a lens" to "see results" in one gesture.
    const opts = { description: preset.tagline };
    if (typeof onRunSweep === "function") {
      opts.duration = 8000;  // longer window so the advisor can find the action
      opts.action = {
        label: "Run sweep now",
        onClick: () => onRunSweep(preset),
      };
      opts.actionButtonStyle = {
        backgroundColor: "#4A6741",
        color: "#ffffff",
      };
    }
    toast.success(`Preset applied: ${preset.label}`, opts);
  };

  return (
    <div className={compact ? "" : "space-y-2"} data-testid={testidPrefix}>
      {showHeading && (
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-[#4A6741]" />
          <h4 className="font-display text-sm font-bold tracking-tight">Goal presets</h4>
          <span className="text-[11px] text-muted-foreground">
            One-click setup: sets the optimization goal, phased schedules, and funding-order sweep in one shot.
          </span>
        </div>
      )}
      <div className={`grid gap-2 ${compact
        ? "grid-cols-2 md:grid-cols-4"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
        {GOAL_PRESETS.map((preset) => {
          const Icon = PRESET_ICONS[preset.id] || Sparkles;
          // A preset stays selected while its GOAL is the active goal. Turning a
          // sweep switch off no longer deselects it — the card is badged
          // "Modified" and says what changed, so the goal never looks forgotten.
          const match = presetMatchState(prefs, preset);
          const isActive = !!match;
          const isModified = match?.state === "modified";
          const diffText = isModified ? match.diffs.join(", ") : "";
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onClick(preset)}
              data-testid={`${testidPrefix}-${preset.id}`}
              title={isModified
                ? `${preset.description}\n\nModified: ${diffText}. Click to restore this preset's defaults.`
                : preset.description}
              className={`text-left rounded-lg border p-3 transition-colors relative
                ${isModified
                  ? "border-[#C4A64A] bg-[#C4A64A]/10 ring-2 ring-[#C4A64A]/25"
                  : isActive
                    ? "border-[#4A6741] bg-[#4A6741]/10 ring-2 ring-[#4A6741]/25"
                    : "border-[#EBE8E0] bg-white hover:border-[#4A6741]/50 hover:bg-[#4A6741]/5"}`}
            >
              {isActive && (
                <span className={`absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full
                                 text-white text-[9px] font-semibold px-1.5 py-0.5
                                 ${isModified ? "bg-[#C4A64A]" : "bg-[#4A6741]"}`}
                      data-testid={`${testidPrefix}-${preset.id}-badge`}>
                  <Check className="h-2.5 w-2.5" /> {isModified ? "Modified" : "Active"}
                </span>
              )}
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-4 w-4 ${isModified ? "text-[#8A6A12]" : isActive ? "text-[#4A6741]" : "text-muted-foreground"}`} />
                <span className={`font-semibold text-sm ${isModified ? "text-[#8A6A12]" : isActive ? "text-[#4A6741]" : "text-[#1A1A1A]"}`}>
                  {preset.label}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug pr-6">
                {preset.tagline}
              </p>
              {isModified && (
                <p className="text-[10px] text-[#8A6A12] mt-1 leading-snug pr-6"
                   data-testid={`${testidPrefix}-${preset.id}-modified-note`}>
                  Goal still active, with {diffText}. Click to restore the preset defaults.
                </p>
              )}
              {!compact && (
                <p className="text-[10px] text-muted-foreground/70 mt-1.5 leading-snug">
                  {preset.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
