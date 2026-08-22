/**
 * buildEpFlowchartRequest — the /api/estate/ep-flowchart payload, derived from a
 * scenario plus its projection. Shared by the EP Flowchart tab and the curated
 * client deck's one-page estate comparison so the two can never disagree on
 * death years, the 50/50 first-death split, or the second-death balances.
 */
export const deriveDeathYears = (scenario) => {
  const h = scenario?.household || {};
  const c = (h.client_dob_year && h.client_life_expectancy)
    ? h.client_dob_year + h.client_life_expectancy : null;
  const s = (h.spouse_dob_year && h.spouse_life_expectancy)
    ? h.spouse_dob_year + h.spouse_life_expectancy : null;
  const first = (c != null && s != null) ? Math.min(c, s) : (c || s || scenario?.projection?.end_year);
  const second = (c != null && s != null) ? Math.max(c, s) : (c || s || scenario?.projection?.end_year);
  return { first, second };
};

// Weighted taxable-account return, used only as the flowchart's fallback growth
// rate for any year the projection doesn't cover.
export const taxableFallbackRate = (scenario) => {
  const taxAccts = (scenario?.accounts || []).filter((a) => a.tax_type === "Taxable");
  const totalBal = taxAccts.reduce((s, a) => s + (a.beginning_balance || 0), 0);
  if (totalBal <= 0) return 0.06;
  const weighted = taxAccts.reduce((s, a) => s + (a.return || 0) * (a.beginning_balance || 0), 0) / totalBal;
  return weighted > 0 ? Math.round(weighted * 1000) / 1000 : 0.06;
};

export const buildEpFlowchartRequest = (scenario, projection, { capGains, heirIncome } = {}) => {
  const rows = projection?.rows;
  if (!rows?.length) return null;
  const { first, second } = deriveDeathYears(scenario);
  const rowAt = (yr) => rows.find((r) => r.year >= yr) || rows[rows.length - 1];
  const slice = (row) => ({
    roth: row.roth || 0,
    taxable: row.taxable || 0,
    cash_house: (row.cash || 0) + (row.real_estate || 0),
    traditional: row.traditional || 0,
  });
  const y1 = slice(rowAt(first));
  const y2 = slice(rowAt(second));

  return {
    first_death_year: first,
    second_death_year: second,
    client_roth: y1.roth / 2,
    client_taxable: y1.taxable / 2,
    client_cash_house: y1.cash_house / 2,
    client_traditional: y1.traditional / 2,
    survivor_roth: y1.roth / 2,
    survivor_taxable: y1.taxable / 2,
    survivor_cash_house: y1.cash_house / 2,
    survivor_traditional: y1.traditional / 2,
    // Actual second-death balances from the retirement cash-flow/tax model —
    // the flowchart reconciles to the projection instead of uniform growth.
    y2_roth: y2.roth,
    y2_taxable: y2.taxable,
    y2_cash_house: y2.cash_house,
    y2_traditional: y2.traditional,
    growth_rate: taxableFallbackRate(scenario),
    cap_gains_rate: capGains ?? 0.24,
    heir_income_rate: heirIncome ?? (scenario?.legacy?.heir_federal_rate ?? 0.3165),
    indexing_rate: scenario?.projection?.general_inflation ?? 0.03,
  };
};

export const EP_SETTINGS_KEY = "ep_flowchart_settings_v1";

export const loadEpSettings = () => {
  try { return JSON.parse(window.localStorage.getItem(EP_SETTINGS_KEY) || "{}"); } catch { return {}; }
};
