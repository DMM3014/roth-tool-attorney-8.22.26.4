// Single shared label dictionary so a given metric carries ONE name across the
// Strategy Analyzer and the Client Report. Where a surface keeps a historical
// short name, the `def`/`subtitle` bridges it to the report's exact vocabulary
// so the two are provably the same field.
export const METRIC_LABELS = {
  after_tax_estate: {
    label: "After-tax legacy (+10 yrs)",
    subtitle: "same metric as the report's \u201CAfter-tax wealth to heirs (end of SECURE-10)\u201D",
    def: "legacy.after_tax_estate_to_heirs \u2014 after-tax wealth reaching heirs at the end of the SECURE-10 window. Identical to the Client Report's \u201CAfter-tax wealth to heirs (end of SECURE-10)\u201D.",
  },
  after_tax_estate_pv: {
    label: "After-tax legacy PV (today)",
    def: "The After-tax legacy (+10 yrs) figure discounted to today's dollars at the plan's inflation assumption.",
  },
  value_at_death: {
    label: "Gross estate @ 2nd death",
    def: "legacy.gross_estate \u2014 total portfolio at the 2nd death, pre-heir-tax, home included. Same field the Client Report shows as \u201CNet worth at second death\u201D.",
  },
  after_tax_estate_at_death: {
    label: "After-tax @ 2nd death",
    def: "After-tax value at the 2nd death, before the 10-yr SECURE compounding \u2014 distinct from the pre-tax Gross estate @ 2nd death and from After-tax legacy (+10 yrs).",
  },
  ending_net_worth: {
    label: "Ending net worth",
    def: "summary.ending_net_worth \u2014 net worth at the plan's end (2nd death), matching the report's net-worth-at-second-death figure.",
  },
  lifetime_taxes: {
    label: "Lifetime tax",
    def: "summary.lifetime_taxes \u2014 total income tax paid by the parents over the plan, matching the report's lifetime-taxes figure.",
  },
  ending_roth: {
    label: "Ending Roth",
    def: "summary.ending_roth \u2014 Roth balance at the plan's end.",
  },
  total_converted: {
    label: "Total converted",
    def: "summary.total_roth_converted \u2014 cumulative Roth conversions executed over the plan.",
  },
};

export const metricLabel = (key) => METRIC_LABELS[key]?.label || key;
export const metricDef = (key) => METRIC_LABELS[key]?.def || "";
