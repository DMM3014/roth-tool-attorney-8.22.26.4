// Scenario signature used to detect stale Monte Carlo results and to gate the
// debounced projection effects. Two subtrees are excluded because they configure
// UI/report presentation rather than the plan the engine simulates:
//   • `optimizer` — goal / sweep toggles on the Strategy Optimizer
//   • `planning_objectives` — which family objectives print on the "What are we
//     planning for?" page; ticking one must not re-run every projection.
export const mcScenarioSig = (scenario) => {
  if (!scenario) return "";
  const { optimizer, planning_objectives, ...rest } = scenario;
  return JSON.stringify(rest);
};
