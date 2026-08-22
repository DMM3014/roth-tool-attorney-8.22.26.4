/**
 * Convert-vs-Don't-Convert comparison, reduced to the two milestones advisors
 * actually get asked about:
 *
 *   1. NET WORTH AT THE SECOND DEATH — what the household owns the moment the
 *      second spouse dies, before the heirs owe a dollar of income tax.
 *   2. NET WORTH AT THE END OF THE SECURE-10 WINDOW — what is left in the heirs'
 *      hands once the inherited Traditional IRA has been drained over the ten
 *      years and the remaining assets have compounded.
 *
 * A conversion strategy can lead on one and trail on the other, so both are
 * modeled. The bridge between them reconciles EXACTLY:
 *
 *   gross estate at 2nd death
 *     − estate settlement cost
 *     − income tax embedded in the inherited pre-tax IRA at death
 *   = after-tax estate at the 2nd death
 *     + growth in the heirs' hands over the window (net of their income tax)
 *   = net worth at the end of the SECURE-10 window
 *
 * The embedded-at-death tax is DERIVED from the legacy block rather than reusing
 * `inherited_ira_tax` — that figure is the (larger) tax actually paid across the
 * window, because the inherited IRA keeps growing until it is fully distributed.
 *
 * Shared by the Convert-or-Skip tab, the Client Report and the Presentation deck.
 */
export const buildMilestoneBridge = (withRoth, noRoth) => {
  const lg = withRoth?.legacy;
  const lgn = noRoth?.legacy;
  if (!lg || !lgn) return null;

  const rows = withRoth.rows || [];
  const secondDeathYear = rows.length ? rows[rows.length - 1].year : null;
  const horizon = lg.horizon_years ?? 10;
  const windowEnd = secondDeathYear ? secondDeathYear + horizon : null;

  const grossA = lg.gross_estate || 0;
  const grossB = lgn.gross_estate || 0;
  const settleA = lg.estate_settlement || 0;
  const settleB = lgn.estate_settlement || 0;
  const atDeathA = lg.after_tax_estate_at_death || 0;
  const atDeathB = lgn.after_tax_estate_at_death || 0;
  const endA = lg.after_tax_estate_to_heirs || 0;
  const endB = lgn.after_tax_estate_to_heirs || 0;

  const lines = [
    { key: "gross", label: "Net worth at 2nd death (pre-heir tax)", bold: true, a: grossA, b: grossB,
      pvYear: secondDeathYear },
    { key: "settlement", label: "Estate settlement cost", negative: true, a: settleA, b: settleB,
      pvYear: secondDeathYear,
      sub: "Administration and final expenses at the modeled settlement rate" },
    { key: "embedded", label: "Income tax embedded in the inherited IRA at death", negative: true,
      a: grossA - settleA - atDeathA, b: grossB - settleB - atDeathB, pvYear: secondDeathYear,
      sub: "What the heirs would owe if the pre-tax balance were distributed immediately" },
    { key: "at-death", label: "After-tax estate at the 2nd death", bold: true, a: atDeathA, b: atDeathB,
      pvYear: secondDeathYear,
      sub: "What the heirs net if the window closed the day of the second death" },
    { key: "growth", label: `Growth in the heirs' hands over ${horizon} years`,
      a: endA - atDeathA, b: endB - atDeathB, pvYear: windowEnd,
      sub: "Net of heir income tax on the forced inherited-IRA distributions" },
    { key: "end-window", label: "Net worth at end of the SECURE-10 window", bold: true, a: endA, b: endB,
      pvYear: windowEnd },
  ];

  return {
    secondDeathYear, windowEnd, horizon,
    grossA, grossB, atDeathA, atDeathB, endA, endB,
    heirTaxA: lg.inherited_ira_tax || 0,
    heirTaxB: lgn.inherited_ira_tax || 0,
    heirRate: lg.heir_ordinary_rate,
    lifetimeTaxA: withRoth?.summary?.lifetime_taxes || 0,
    lifetimeTaxB: noRoth?.summary?.lifetime_taxes || 0,
    totalConverted: withRoth?.summary?.total_roth_converted || 0,
    lines,
  };
};
