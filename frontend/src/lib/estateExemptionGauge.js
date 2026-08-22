/**
 * Combined-exemption gauge — utility functions.
 *
 * Answers: how close is this household to the (fed_excl_y1 + fed_excl_y2)
 * ceiling, and therefore how "materially valuable" is the GST-Exempt
 * strategy vs. simple portability?
 *
 * Combined exemption:
 *   - fed_excl_y1  — chained-CPI-indexed federal exclusion at the FIRST death
 *   - fed_excl_y2  — same at the SECOND death
 *   - Combined     — the total exclusion capacity BOTH spouses can shelter
 *                    across their two lifetimes (both estate + GST when the
 *                    GST-layered strategy is used; only estate when portability
 *                    is used, because GST is NOT portable — half is wasted).
 *
 * Consumed (denominator basis):
 *   - The PORTABILITY strategy's estate_y2 — i.e. the total household wealth
 *     at the second death under the "everything to spouse" simple case. This
 *     is the amount of wealth that is potentially exposed to estate + GST tax
 *     if nothing is sheltered by trust.
 *
 * Tiers (advisor-facing narrative):
 *   [0,    50%)  — Well under; GST is dynasty-optionality
 *   [50,  100%)  — Close to ceiling; GST locks in both spouses' exemptions
 *   [100, 150%)  — Over one spouse's exemption; GST becomes materially valuable
 *   [150,  ∞)    — Substantially over; GST minimizes an unavoidable tax
 */

export function computeCombinedExemptionMetrics(estateResult) {
  if (!estateResult) return null;
  const y1 = estateResult.fed_exclusion_y1 || 0;
  const y2 = estateResult.fed_exclusion_y2 || 0;
  const combinedAvailable = y1 + y2;
  const consumed = estateResult.outcomes?.portability?.estate_y2 || 0;
  const pct = combinedAvailable > 0 ? consumed / combinedAvailable : 0;
  const pctDisplay = pct * 100;
  let tier, headline, narrative;
  if (pct < 0.5) {
    tier = "safe";
    headline = "Well under the combined exemption";
    narrative = "Portability alone will avoid federal estate tax. The GST-Exempt structure still preserves dynasty tax leverage across future generations and locks in the exemption before any future law change.";
  } else if (pct < 1.0) {
    tier = "watch";
    headline = "Close to the combined exemption ceiling";
    narrative = "The household is under the combined exemption but not by much. GST-Exempt locks in BOTH spouses' estate + GST exemptions before market growth or a future statutory change erodes the shelter. Under portability alone the first spouse's GST exemption is not utilized and cannot be recovered later.";
  } else if (pct < 1.5) {
    tier = "material";
    headline = "Above one spouse's exemption — GST becomes materially valuable";
    narrative = "The household exceeds one spouse's exemption. GST-Exempt is now materially valuable: it captures the second exemption that portability would preserve for estate tax purposes but leave UNUTILIZED for GST purposes (the GST exemption is not portable via DSUE). Every dollar sheltered in the GST trust also escapes estate tax at every subsequent generation.";
  } else {
    tier = "critical";
    headline = "Substantially above the combined exemption";
    narrative = "Federal estate tax is unavoidable at 40% on the excess. GST-Exempt does not eliminate that tax but minimizes it by securing both spouses' full exemptions AND compounds the sheltered dollars outside every subsequent generation's estate — the dynasty math becomes the dominant term.";
  }
  return {
    y1,
    y2,
    combinedAvailable,
    consumed,
    pct,
    pctDisplay,
    tier,
    headline,
    narrative,
    firstDeathYear: estateResult.first_death_year,
    secondDeathYear: estateResult.second_death_year,
  };
}

// Tier color mapping shared across the tab and the print page.
export const TIER_COLORS = {
  safe:     { bar: "#4A6741", fg: "#4A6741", bg: "#F1F5EF", border: "#4A6741" },   // green
  watch:    { bar: "#C87941", fg: "#8A5A20", bg: "#FEFAF1", border: "#C87941" },   // amber
  material: { bar: "#C87941", fg: "#8A5A20", bg: "#FEF3E4", border: "#C87941" },   // deeper amber
  critical: { bar: "#B84A4A", fg: "#B84A4A", bg: "#FDF3F3", border: "#B84A4A" },   // red
};
