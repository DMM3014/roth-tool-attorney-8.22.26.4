/**
 * Present-value helpers shared by the Client Report and the Presentation deck.
 *
 * A difference of $1,000,000 forty years out is not a difference of $1,000,000
 * today, so every comparative table and KPI in the client-facing material now
 * carries a "today's dollars" figure alongside the nominal one. Both surfaces
 * expose an advisor-adjustable discount rate; the default is the plan's own
 * general-inflation assumption so the PV column never contradicts the rest of
 * the model.
 */
export const pvRateFor = (scenario, override) =>
  (override != null && Number.isFinite(override))
    ? override
    : (scenario?.projection?.general_inflation ?? 0.03);

export const makePv = (scenario, override, rows) => {
  const rate = pvRateFor(scenario, override);
  const start = scenario?.projection?.start_year ?? rows?.[0]?.year ?? 0;
  const at = (year) => 1 / Math.pow(1 + rate, Math.max(0, (year ?? start) - start));
  return {
    rate,
    start,
    at,
    of: (v, year) => (v || 0) * at(year),
  };
};
