import { Page, H2, P, Sub } from "./printPrimitives";
import { OBJECTIVES, PRIORITIES, PRIORITY_COLOR, readObjectives, hasSelections } from "@/lib/objectives";
import { ObjectivesBody, ObjectiveTensions } from "@/components/shared/PrintBlocks";

/**
 * ObjectivesDeckPage — the deck's "What are we planning for?" slide. Placed
 * before the first conversion comparison so the client meeting starts with
 * family objectives and only then moves to the technical machinery.
 */
export const ObjectivesDeckPage = ({ scenario, household, includeNarrative = true }) => {
  const objectives = readObjectives(scenario);
  const any = hasSelections(objectives);

  return (
    <Page testid="presentation-page-objectives">
      <H2>What are we planning for?</H2>
      {includeNarrative && (
        <P>
          Every number in this deck is downstream of a question this page asks first: what is this money
          <em> for</em>? The objectives below routinely <strong>compete</strong> — minimizing lifetime tax can
          work against preserving a basis step-up, protecting later generations can work against simplicity, and
          maximizing what reaches children can work against the surviving spouse&apos;s flexibility. Nothing that
          follows resolves that tension; it measures it, so the trade-off can be made deliberately.
        </P>
      )}

      <ObjectivesBody objectives={objectives} priorities={PRIORITIES}
        priorityColor={PRIORITY_COLOR} all={OBJECTIVES} testid="deck-objectives-body" />

      <ObjectiveTensions testid="deck-objective-tensions" />

      <div style={{ marginTop: 10, padding: "9px 13px", borderRadius: 8,
                    border: "1px solid #C4A64A", background: "#C4A64A14" }}
           data-testid="deck-objectives-note">
        <p style={{ fontSize: 10.5, lineHeight: 1.6, margin: 0, color: "#1A1A1A" }}>
          {any ? (
            <>
              <strong style={{ color: "#8A6A12" }}>These are the objectives we are weighing this plan
              against{household ? ` for ${household}` : ""}.</strong> As you read the pages that follow, ask
              which of these each page informs — and which it says nothing about.
            </>
          ) : (
            <>
              <strong style={{ color: "#8A6A12" }}>This page is intentionally free of dollar
              figures.</strong> Deciding which of these objectives matter most, and which you are willing to
              trade away, comes before deciding how much to convert.
            </>
          )}
        </p>
      </div>

      <Sub>
        The model does not rank these objectives and cannot — the weighting is a family judgement informed by
        circumstances no projection can see. Revisit them at every annual review, and especially after a death,
        marriage, divorce, liquidity event, or change in a beneficiary&apos;s circumstances.
      </Sub>
    </Page>
  );
};

export default ObjectivesDeckPage;
