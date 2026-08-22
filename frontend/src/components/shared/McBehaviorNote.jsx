import React from "react";
import { useSharedGuardrail } from "@/hooks/useSharedGuardrail";
import { useSharedHalt } from "@/hooks/useSharedHalt";

/**
 * McBehaviorNote — prints the Monte Carlo behavioral rules (spending guardrail
 * and drawdown conversion halt) wherever the commentary needs to disclose them,
 * and prints NOTHING when both are off.
 *
 * It reads the same shared stores the Monte Carlo tab, the Client Report and the
 * Presentation controls write to (useSharedGuardrail / useSharedHalt), so the
 * printed note can never disagree with the switches the advisor is looking at —
 * no props to thread through a dozen pages.
 */
export const McBehaviorNote = ({ variant = "box", testid = "mc-behavior-note" }) => {
  const { grOn, grCut } = useSharedGuardrail();
  const { haltOn, haltDrop, haltResume } = useSharedHalt();
  if (!grOn && !haltOn) return null;

  const label = [grOn && "spending guardrail ON", haltOn && "conversion halt ON"]
    .filter(Boolean).join(" · ");

  const body = (
    <>
      <strong>Behavioral rules modeled — {label}.</strong>{" "}
      {grOn && (
        <>In the Monte Carlo simulation, discretionary spending is trimmed by <strong>{grCut}%</strong> in any
        year that follows a portfolio loss; taxes and fixed costs never flex. </>
      )}
      {haltOn && (
        <>{grOn ? "In the same simulation, remaining" : "In the Monte Carlo simulation, remaining"} Roth conversions
        pause in any trial whose prior-year portfolio return falls <strong>{haltDrop}%</strong> or more
        {haltResume > 0
          ? <>, then resume after <strong>{haltResume}</strong> consecutive positive-return
            year{haltResume === 1 ? "" : "s"}</>
          : <> for the rest of the conversion window</>}. </>
      )}
      These rules shape the Monte Carlo dispersion only. The deterministic projection tables elsewhere in this
      report hold spending and the conversion schedule fixed, so they do not include
      {grOn && haltOn ? " either rule" : " this rule"}.
    </>
  );

  if (variant === "line") {
    return (
      <p data-testid={testid}
         style={{ margin: "0 0 8px", padding: "6px 10px", borderRadius: 6,
                  borderLeft: "3px solid #4A6741", background: "#F1F5EF",
                  fontSize: 9.5, lineHeight: 1.55, color: "#2A2A2A" }}>
        {body}
      </p>
    );
  }

  return (
    <div data-testid={testid}
         style={{ marginTop: 8, padding: "9px 12px", borderRadius: 6,
                  border: "1px solid #4A6741", background: "#F1F5EF",
                  fontSize: 10, lineHeight: 1.55, color: "#1A1A1A" }}>
      {body}
    </div>
  );
};

export default McBehaviorNote;
