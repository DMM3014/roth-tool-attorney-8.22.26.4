import { Page, H2, P, Sub } from "./helpers";
import { OBJECTIVES, PRIORITIES, PRIORITY_COLOR, readObjectives, hasSelections } from "@/lib/objectives";
import { ObjectivesBody, ObjectiveTensions } from "@/components/shared/PrintBlocks";

/**
 * ObjectivesPage — "What are we planning for?" No dollar forecasts. Printed
 * before any conversion arithmetic so every quantitative page that follows is
 * read as evidence relevant to a stated family objective rather than as
 * evidence for a predetermined solution.
 */
export const ObjectivesPage = ({ scenario, household, ...footProps }) => {
  const objectives = readObjectives(scenario);
  const any = hasSelections(objectives);

  return (
    <Page testid="cr-page-objectives" {...footProps}>
      <H2>What are we planning for?</H2>
      <P>
        Before any arithmetic, it is worth naming what this plan is actually being asked to do. The objectives
        below routinely <strong>compete with one another</strong> — minimizing lifetime tax can work against
        preserving a basis step-up; protecting later generations can work against simplicity; maximizing what
        reaches children can work against the surviving spouse&apos;s flexibility. There is no single arrangement
        that maximizes all of them at once, which is why this report presents trade-offs rather than a verdict.
      </P>

      <ObjectivesBody objectives={objectives} priorities={PRIORITIES}
        priorityColor={PRIORITY_COLOR} all={OBJECTIVES} testid="cr-objectives-body" />

      <ObjectiveTensions testid="cr-objective-tensions" />

      <div style={{ marginTop: 10, padding: "9px 13px", borderRadius: 8,
                    border: "1px solid #C4A64A", background: "#C4A64A14" }}
           data-testid="cr-objectives-note">
        <p style={{ fontSize: 10.5, lineHeight: 1.6, margin: 0, color: "#1A1A1A" }}>
          {any ? (
            <>
              <strong style={{ color: "#8A6A12" }}>Priorities as discussed with {household}.</strong> The
              highlighted objectives are the ones this plan is being weighed against. Objectives shown as
              &ldquo;to discuss&rdquo; are not judged unimportant — they simply have not been raised as drivers
              yet, and any of them can change the preferred answer once it is. Every later page should be read
              by asking which of these objectives it informs.
            </>
          ) : (
            <>
              <strong style={{ color: "#8A6A12" }}>Nothing has been prioritized yet — that is the first
              conversation.</strong> This page is deliberately blank of dollars. Working through which of these
              objectives matter most to your family, and which you are willing to trade away, determines how the
              numbers in the rest of this report should be weighted.
            </>
          )}
        </p>
      </div>

      <Sub>
        These objectives are not ranked by the model, and the model cannot rank them — the weighting is a family
        judgement, informed by circumstances no projection can see. Priorities recorded here travel with the plan
        and should be revisited at every annual review, particularly after a death, a marriage, a divorce, a
        liquidity event, or a change in a beneficiary&apos;s circumstances.
      </Sub>
    </Page>
  );
};

export default ObjectivesPage;
