import React from "react";
import { fmtPct, fmtUSD } from "@/lib/api";

/**
 * Shared copy for the "Convert or Don't Convert" page so the Client Report and
 * the Presentation deck can never drift apart editorially (advisor request
 * 2026-08-22). Each surface passes in its own print primitives — the two decks
 * style <P> / <Sub> differently — and the words live here, once.
 */
export const ConvertSkipNarrative = ({ P, pvRate, includeNarrative = true }) => (
  <>
    {includeNarrative && (
      <P>
        Your plan was run twice — once with the conversion schedule and once with no conversions at all — holding
        spending, markets and accounts identical. The result is shown at <strong>two moments</strong>: the second
        death, when the balance sheet passes to the next generation, and the end of the SECURE Act&apos;s ten-year
        window, when the inherited Traditional IRA has been fully distributed and taxed. Converting always reduces
        the first number (you pay tax early) and may raise the second (the heirs inherit fewer taxable dollars).
        Because these moments are decades away, each difference is also shown in <strong>today&apos;s
        dollars</strong> at {fmtPct(pvRate)}.
      </P>
    )}
    <P>
      The following illustration is based upon the assumed heir tax rates which you have provided and which are
      identified above. These results are also based upon consistent linear returns and are assumptions, not
      promises. Please note that while projected conversion benefits may seem large in amount, they are often
      relatively small gains in percentage terms based upon projection results.
    </P>
  </>
);

export const ConvertSkipFootnote = ({ Sub, bridge, pvStart, pvRate }) => (
  <Sub>
    The &ldquo;today&apos;s $&rdquo; column discounts each milestone from the year it occurs back to {pvStart} at{" "}
    {fmtPct(pvRate)}; the year-by-year page discounts each year&apos;s tax difference individually. Heirs are
    assumed to pay a combined {fmtPct(bridge.heirRate)} ordinary rate on inherited Traditional IRA distributions —
    the beneficiary-band page tests that assumption across a low / middle / high range. Total converted in this
    plan: {fmtUSD(bridge.totalConverted)}. Neither column is a recommendation; they are two hypothetical
    illustrations of the same household, and the hypothetical gains that result from conversions are adjusted by
    the program to incorporate projected reductions in step-up-in-basis benefits that could pass to the next
    generation but that will be eliminated to the extent capital gains taxes are realized in the parents&apos;
    lifetimes to provide funds for Roth conversion taxes and other lifetime taxes and expenses.
  </Sub>
);
