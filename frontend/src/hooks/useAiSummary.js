import { useMemo } from "react";

// Builds the structured summary fed to the AI Insights endpoint. Extracted from
// Projection.jsx to keep the component lean and isolate this many-input derivation.
export const useAiSummary = ({ scenario, withRoth, s, sn, legacy, legacyNo, sweep, taxDelta, nwDelta, heirDelta, mcResult }) =>
  useMemo(
    () => s && {
      mode: "multi_year",
      filing_status: scenario.household.filing_status,
      roth_controls: scenario.roth,
      with_conversions: s,
      without_conversions: sn,
      legacy_estate: legacy,
      bracket_sweep_ranked: sweep?.ranked,
      lifetime_tax_savings: taxDelta,
      ending_networth_difference: nwDelta,
      net_to_family: legacy && legacyNo && {
        horizon_years: legacy.horizon_years,
        with_conversions: legacy.after_tax_estate_to_heirs,
        without_conversions: legacyNo.after_tax_estate_to_heirs,
        delta: heirDelta,
        inheritance_delta: heirDelta,
        tax_free_roth_with: legacy.tax_free_roth_to_heirs,
        tax_free_roth_without: legacyNo.tax_free_roth_to_heirs,
        heir_ira_tax_with: legacy.inherited_ira_tax,
        heir_ira_tax_without: legacyNo.inherited_ira_tax,
        heir_ira_tax_saved: (legacyNo.inherited_ira_tax || 0) - (legacy.inherited_ira_tax || 0),
      },
      monte_carlo: mcResult && {
        trials: mcResult.n_trials,
        volatility: mcResult.portfolio_vol,
        mean_return: mcResult.portfolio_mean,
        success_with_conversions: mcResult.with_conversions?.success,
        success_without_conversions: mcResult.without_conversions?.success,
        resilience_delta_points: mcResult.with_conversions && mcResult.without_conversions
          ? Math.round((mcResult.with_conversions.success - mcResult.without_conversions.success) * 1000) / 10
          : null,
        median_ending_portfolio: mcResult.with_conversions?.ending?.p50,
        downside_ending_p10: mcResult.with_conversions?.ending?.p10,
        depleted_pct: mcResult.with_conversions?.ending?.depleted_pct,
      },
      sample_years: withRoth.rows.filter((_, i) => i % 5 === 0).map((x) => ({
        year: x.year, conversion: x.roth_conversion, tax: x.total_tax,
        traditional: x.traditional, roth: x.roth, marginal_rate: x.marginal_rate,
      })),
    },
    [s, sn, taxDelta, nwDelta, withRoth, scenario, sweep, legacy, legacyNo, heirDelta, mcResult]
  );
