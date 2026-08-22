/**
 * Shared client-facing language about Roth income-tax treatment for heirs.
 *
 * Design principle (2026-02 revision): the earlier "Roth income-tax free forever"
 * language overstated the truth for trust-held Roth balances. The correct
 * framing is:
 *
 *   1. During the owner's lifetime: Roth compounds tax-free — accurate.
 *   2. During the SECURE Act 10-year withdrawal window after death: Roth
 *      continues to compound income-tax free INSIDE the inherited Roth wrapper.
 *   3. After the 10-year window: the Roth wrapper terminates. If assets have
 *      been distributed to individual beneficiaries, subsequent income (LTCG,
 *      dividends, interest) is taxed at THEIR marginal rates. If assets are
 *      RETAINED in an accumulation trust past the 10-year window, retained
 *      trust income is taxed at the compressed trust brackets (37% federal
 *      above ~$16,000/yr of retained income).
 *   4. Estate/GST-tax leverage of trust structures is a SEPARATE benefit from
 *      income-tax treatment — a bypass/GST trust still shelters the Roth from
 *      estate tax at each subsequent death, even after the SECURE window ends.
 *
 * Trustee planning note: because compressed trust brackets are so punitive,
 * trustees typically distribute ordinary income (DNI carry-out to beneficiaries
 * on the same year it arises) or distribute appreciated assets in-kind so
 * beneficiaries — who are usually in lower brackets — bear the tax rather than
 * the trust.
 */

export const ROTH_TRUST_CAVEAT_SHORT =
  "Roth income-tax free during the SECURE Act 10-year window; if retained in trust thereafter, assume compressed trust tax rates on retained income.";

export const ROTH_TRUST_CAVEAT_LONG =
  "During the SECURE Act 10-year distribution window after death, an inherited " +
  "Roth continues to compound income-tax free inside the Roth wrapper. After the " +
  "10-year window the wrapper must be emptied — if the account passes to individual " +
  "beneficiaries, subsequent income is taxed at their marginal rates; if it stays " +
  "in an accumulation trust, retained income is taxed at the compressed trust " +
  "brackets (37% federal above ~$16,000/yr of retained income). The estate + GST " +
  "tax shelter of a bypass/GST trust survives that transition, but the income-tax " +
  "shelter of the Roth itself does not.";

export const TRUSTEE_DISTRIBUTION_NOTE =
  "Because trust brackets compress so quickly, trustees typically distribute " +
  "ordinary income (dividends and interest) to beneficiaries in the year it " +
  "arises (DNI carry-out) — the trust's 37% top ordinary bracket versus a " +
  "beneficiary's 24–32% is a 5–13 point saving on every dollar. Capital gains, " +
  "however, are typically RETAINED inside the trust: the trust's 20% top LTCG " +
  "rate is only 5 points above the individual 15% LTCG rate, and retaining the " +
  "gains preserves the trust's creditor protection, spendthrift control, and " +
  "continued tax-advantaged compounding. For beneficiaries who are themselves " +
  "high earners (e.g., adult children in peak earning years with substantial " +
  "salary or business income), the ordinary-income differential is even larger " +
  "— which strengthens the case for DNI carry-out on ordinary items and " +
  "retention of capital gains inside the trust.";
