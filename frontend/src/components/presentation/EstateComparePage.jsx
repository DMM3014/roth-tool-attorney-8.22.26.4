import { useMemo } from "react";
import { fmtUSD } from "@/lib/api";
import { PlanComparisonTable } from "@/components/flowchart/PlanComparisonTable";
import { EstateThreeQuestions, BasisTradeoffCaveat } from "@/components/shared/PrintBlocks";
import { Page, H2, P, Sub } from "./printPrimitives";

/**
 * EstateComparePage — the one-page estate scenario comparison for the curated
 * client deck. Shows only the plans the advisor has selected (shared with the
 * Client Report and the EP Flowchart tab via useFlowPlans) and leads with the
 * three questions a family actually asks, ahead of any IRC mechanics.
 */
export const EstateComparePage = ({ flowResult, selected, includeNarrative = true }) => {
  const plans = useMemo(
    () => (flowResult?.plans || []).filter((p) => !selected || selected.includes(p.plan_no)),
    [flowResult, selected],
  );
  if (!plans.length) return null;

  return (
    <Page testid="presentation-page-estate-compare">
      <H2>Estate Structures — one page, side by side</H2>
      {includeNarrative && (
        <P>
          The same projected balance sheet at the second death
          {flowResult.second_death_year ? ` (${flowResult.second_death_year})` : ""}, passed through
          {plans.length === 1 ? " one structure" : ` ${plans.length} different structures`}. Nothing about the
          investments, spending or conversion schedule changes across the columns — only the estate documents do.
          The differences you see are the price, or the value, of the paperwork.
        </P>
      )}

      <EstateThreeQuestions testid="deck-estate-three-questions" />

      <PlanComparisonTable plans={plans} capGainsRate={flowResult.cap_gains_rate} />

      <BasisTradeoffCaveat plans={plans} testid="deck-estate-basis-caveat" />

      <Sub>
        Federal estate tax only, using indexed exclusions of {fmtUSD(flowResult.fed_excl_y1)} at the first death
        and {fmtUSD(flowResult.fed_excl_y2)} at the second. Balances at the first death
        ({flowResult.first_death_year}) are split 50/50 between spouses and each asset class is carried forward at
        the retirement model&apos;s own projected balance. These are illustrations of alternative structures, not
        legal advice or a recommendation — the mechanics behind each one (disclaimer timing, DSUE portability, GST
        allocation) are set out in the Client Report&apos;s advisor appendix, and any structure must be reviewed
        with a qualified estate-planning attorney before it is implemented.
      </Sub>
    </Page>
  );
};

export default EstateComparePage;
