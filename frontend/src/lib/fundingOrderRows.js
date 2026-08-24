// Shared definitions for the "Funding Order — The Hidden Lever" feature, used by
// both the interactive tab (FundingOrderLever) and the printed report page
// (clientReport/FundingOrderPage) so the two never drift apart.
import { fmtUSD, fmtPct } from "@/lib/api";

// The three withdrawal orders the projection engine supports.
export const VALID_FUNDING_ORDERS = [
  "Cash → Taxable → IRA → Roth",
  "Cash → IRA → Taxable → Roth",
  "Split IRA & Taxable",
];

// Short, readable column headers.
export const FUNDING_ORDER_SHORT = {
  "Cash → Taxable → IRA → Roth": "Taxable-first",
  "Cash → IRA → Taxable → Roth": "IRA-first",
  "Split IRA & Taxable": "Split",
};

export const DEFAULT_ORDERS = [
  "Cash → Taxable → IRA → Roth",
  "Cash → IRA → Taxable → Roth",
];

const usd = (v) => (v == null ? "—" : fmtUSD(v));
const rateOrNone = (v) => (v == null ? "None in tested band" : fmtPct(v));

// Rows in the exact order requested. `indent` renders the account-detail
// sub-rows (embedded gain / step-up) beneath the ending taxable balance.
export const METRIC_ROWS = [
  { key: "total_roth_converted", label: "Total Roth conversions executed", fmt: usd },
  { key: "ending_roth", label: "Ending Roth balance", fmt: usd },
  { key: "ending_taxable", label: "Ending Taxable balance", fmt: usd },
  { key: "embedded_unrealized_gain", label: "embedded unrealized gain", fmt: usd, indent: true },
  { key: "step_up_value", label: "step-up value (LTCG avoided at death)", fmt: usd, indent: true },
  { key: "net_worth_at_second_death", label: "Net worth at second death", fmt: usd },
  { key: "net_worth_at_second_death_today", label: "in today's $", fmt: usd, indent: true, pv: true,
    pvOf: { nominalKey: "net_worth_at_second_death", yearKey: "second_death_year" } },
  { key: "federal_estate_tax_no_trust", label: "Federal estate tax at 2nd death (Plan 1 — no trust)", fmt: usd },
  { key: "federal_estate_tax_no_trust_today", label: "in today's $", fmt: usd, indent: true, pv: true,
    pvOf: { nominalKey: "federal_estate_tax_no_trust", yearKey: "second_death_year" } },
  { key: "after_tax_to_heirs_secure10", label: "After-tax wealth to heirs (end of SECURE-10)", fmt: usd, strong: true },
  { key: "after_tax_to_heirs_secure10_today", label: "in today's $", fmt: usd, indent: true, pv: true,
    pvOf: { nominalKey: "after_tax_to_heirs_secure10", yearKey: "heir_deliver_year" } },
  { key: "lifetime_tax_nominal", label: "Parents' lifetime tax (nominal)", fmt: usd },
  { key: "lifetime_tax_npv", label: "Parents' lifetime tax (NPV, modeled inflation)", fmt: usd, indent: true, pv: true },
  { key: "heir_secure10_ira_tax", label: "Heirs' SECURE-10 IRA tax", fmt: usd },
  { key: "beneficiary_break_even_rate", label: "Beneficiary break-even rate", fmt: rateOrNone },
];

export const FUNDING_ORDER_EXPLAINER = [
  "Changing only the order in which accounts are spent — not the conversion schedule — quietly reshapes total conversions, heir outcomes, estate tax, and the beneficiary break-even rate.",
  "Spending the IRA during life shrinks future RMDs and preserves the step-up-eligible taxable account, so heirs inherit assets that receive a §1014 basis step-up at death.",
  "Spending the taxable account first preserves tax deferral but grows the IRA that heirs must drain — and pay ordinary income tax on — within the SECURE Act's ten-year window at their own marginal rates.",
  "Neither order is universally better. This page illustrates the trade-off side by side; it does not recommend one.",
];
