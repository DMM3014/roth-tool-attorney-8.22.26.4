// Shared rank options + goal presets for the Strategy Analyzer.
//
// The Strategy Analyzer used to keep `sortKey / includePhased / sweepFundingOrders`
// in local React state. To let the Plan Inputs tab expose the same "goal presets"
// (Legacy-first, Tax-minimizer, Roth-maximizer, …) the preferences live under
// `scenario.optimizer.*` so both tabs read/write the same source of truth and
// the choice persists with the scenario.
//
//   scenario.optimizer.goal                    (string; one of RANK_OPTIONS.key)
//   scenario.optimizer.include_phased          (bool)
//   scenario.optimizer.sweep_funding_orders    (bool)

export const RANK_OPTIONS = [
  { key: "after_tax_estate",           dir: "desc", label: "After-tax legacy · 10 yrs after 2nd death", hint: "Nominal after-tax dollars delivered to heirs after the SECURE 10-year window — the app's default legacy metric." },
  { key: "after_tax_estate_pv",        dir: "desc", label: "After-tax legacy · PV (today's $)",         hint: "Same metric, discounted to today at your general-inflation rate. Softens the 'aggressive wins' effect." },
  { key: "after_tax_estate_at_death",  dir: "desc", label: "After-tax legacy at 2nd death",             hint: "After-tax value at the second death — before the 10-year heir compounding window. Isolates the plan's impact from heir-side reinvestment." },
  { key: "value_at_death",             dir: "desc", label: "Portfolio value at 2nd death",              hint: "Gross portfolio (net worth minus mortgage) at the second death, before any inherited-IRA tax or estate settlement." },
  { key: "ending_roth",                dir: "desc", label: "Highest ending Roth balance",               hint: "Roth balance at end of plan (before heir horizon) — proxy for tax-free wealth transferred." },
  { key: "lifetime_taxes",             dir: "asc",  label: "Lowest lifetime tax paid",                  hint: "Total federal + state + Medicare/IRMAA tax across all lifetime years. Lower is better." },
];

// Legacy-first is the house default (advisor request 2026-08-22): after-tax
// dollars to heirs after the SECURE window, searching phased schedules and
// every funding order. Keep these three in step with the GOAL_PRESETS entry
// below or the preset will render as "Modified" on a fresh plan.
export const DEFAULT_GOAL = "after_tax_estate";
export const DEFAULT_INCLUDE_PHASED = true;
export const DEFAULT_SWEEP_FUNDING = true;
export const DEFAULT_PRESET_ID = "legacy_first";

export const getOptimizerPrefs = (scenario) => {
  const o = scenario?.optimizer || {};
  return {
    goal: o.goal || DEFAULT_GOAL,
    includePhased: o.include_phased ?? DEFAULT_INCLUDE_PHASED,
    sweepFundingOrders: o.sweep_funding_orders ?? DEFAULT_SWEEP_FUNDING,
    presetId: o.preset_id || DEFAULT_PRESET_ID,
    sweepHorizon: o.sweep_horizon || "plan",
    sweepHorizonYear: o.sweep_horizon_year ?? null,
  };
};

export const getActiveRankOption = (goal) =>
  RANK_OPTIONS.find((o) => o.key === goal) || RANK_OPTIONS[0];

// Preset presets — each button applies goal + two sweep toggles atomically.
// `id` is the persisted marker so the UI can highlight the active preset;
// clearing the marker happens whenever any of the underlying fields diverge
// from the preset's values (see `matchesPreset`).
export const GOAL_PRESETS = [
  {
    id: "legacy_first",
    label: "Legacy-first",
    tagline: "Most to heirs after 2nd death + 10 yrs",
    description: "Maximize after-tax dollars delivered to heirs after the SECURE 10-year window. Explores phased schedules and every funding order for a full search.",
    goal: "after_tax_estate",
    include_phased: true,
    sweep_funding_orders: true,
  },
  {
    id: "tax_minimizer",
    label: "Tax-minimizer",
    tagline: "Lowest lifetime tax",
    description: "Minimize total federal + state + IRMAA tax across the plan. Phased schedules + full funding-order sweep let the engine avoid IRMAA cliffs and RMD walls.",
    goal: "lifetime_taxes",
    include_phased: true,
    sweep_funding_orders: true,
  },
  {
    id: "roth_maximizer",
    label: "Roth-maximizer",
    tagline: "Highest ending Roth balance",
    description: "Push the largest possible balance into tax-free Roth by end of plan. Phased schedules explore SS-pivot and RMD-pivot brackets; funding-order sweep finds the cheapest way to fund the tax.",
    goal: "ending_roth",
    include_phased: true,
    sweep_funding_orders: true,
  },
  {
    id: "portfolio_at_death",
    label: "Portfolio at 2nd death",
    tagline: "Biggest gross portfolio at 2nd death",
    description: "Maximize the gross portfolio value at the second death (before any inherited-IRA tax). Isolates plan impact from heir-side reinvestment.",
    goal: "value_at_death",
    include_phased: true,
    sweep_funding_orders: true,
  },
];

export const matchesPreset = (prefs, preset) =>
  prefs.goal === preset.goal
  && !!prefs.includePhased === !!preset.include_phased
  && !!prefs.sweepFundingOrders === !!preset.sweep_funding_orders;

/**
 * How closely do the current prefs match a preset?
 *
 * Presets used to deselect entirely the moment an advisor turned off, say,
 * two-phase schedules — which read as "the app forgot my goal". The goal is what
 * the preset is really about, so a preset whose GOAL still matches stays selected
 * and is badged "Modified", listing what was changed. Returns null when the goal
 * differs (a genuinely different preset), otherwise { state, diffs }.
 */
export const presetMatchState = (prefs, preset) => {
  if (prefs.goal !== preset.goal) return null;
  const diffs = [];
  if (!!prefs.includePhased !== !!preset.include_phased) {
    diffs.push(prefs.includePhased ? "two-phase schedules on" : "two-phase schedules off");
  }
  if (!!prefs.sweepFundingOrders !== !!preset.sweep_funding_orders) {
    diffs.push(prefs.sweepFundingOrders ? "funding-order sweep on" : "funding-order sweep off");
  }
  return { state: diffs.length ? "modified" : "exact", diffs };
};

export const applyPresetToScenario = (setScenario, preset) => {
  setScenario((p) => ({
    ...p,
    optimizer: {
      ...(p.optimizer || {}),
      goal: preset.goal,
      include_phased: preset.include_phased,
      sweep_funding_orders: preset.sweep_funding_orders,
      preset_id: preset.id,
    },
  }));
};

export const setOptimizerField = (setScenario, field, value) => {
  setScenario((p) => {
    const nextOpt = { ...(p.optimizer || {}), [field]: value };
    // The preset marker is deliberately KEPT on manual switch edits — the goal is
    // unchanged, so the preset stays selected and the UI badges it "Modified"
    // (see presetMatchState). Only a goal change abandons the preset.
    if (field === "goal") delete nextOpt.preset_id;
    return { ...p, optimizer: nextOpt };
  });
};
