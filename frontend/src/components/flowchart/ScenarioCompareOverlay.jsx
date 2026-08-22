/**
 * ScenarioCompareOverlay — side-by-side "current vs comparison" delta grid
 * that renders directly above each plan's flowchart box so advisors can see
 * how Roth conversions (or any other plan change) shifts trust / tax /
 * total-to-children numbers on that specific plan.
 *
 * The overlay renders only the essential deltas. The full per-plan flowchart
 * boxes still render below so advisors can zoom into the mechanics.
 */
import React from "react";
import { fmtUSD } from "@/lib/api";
import { ArrowRight } from "lucide-react";

const METRIC_ROWS = [
  { key: "total_to_children", label: "Totals to Trusts and Children",         better: "high", bold: true },
  { key: "in_trust_y2",       label: "Inside GST trusts",          better: "high" },
  { key: "gst_exempt_y2",     label: "GST-exempt (dynasty)",       better: "high" },
  { key: "fet",               label: "Federal estate tax",         better: "low" },
  { key: "forgone_step_up",   label: "Forgone 2nd step-up",        better: "low" },
];

const arrow = (dir) => (
  <ArrowRight size={9} style={{ display: "inline-block", transform: dir === "up" ? "rotate(-45deg)" : "rotate(45deg)",
                                verticalAlign: "middle", marginRight: 3 }} />
);

/**
 * Props:
 *   currentPlan     — plan from the currently-loaded scenario's flowchart
 *   comparePlan     — plan from the saved-scenario flowchart (may be null)
 *   currentLabel    — label for the current scenario ("Current plan")
 *   compareLabel    — label for the comparison scenario (scenario name)
 *   testid          — data-testid stem
 */
export const ScenarioCompareOverlay = ({ currentPlan, comparePlan, currentLabel = "Current",
                                          compareLabel = "Comparison", testid, print = false }) => {
  if (!currentPlan || !comparePlan) return null;
  const bodyFont = print ? 9.5 : 10.5;
  const numFont = print ? 10.5 : 11.5;
  const labelFont = print ? 8.5 : 9.5;
  return (
    <div data-testid={testid || `flow-compare-overlay-${currentPlan.plan_no}`}
         style={{ background: "#F9F8F6", border: "1px solid #EBE8E0", borderRadius: 8,
                  padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <p style={{ fontSize: labelFont, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase",
                    color: "#4A6741", margin: 0 }}>
          Scenario comparison — Plan {currentPlan.plan_no}
        </p>
        <p style={{ fontSize: labelFont, color: "#5A5A5A", margin: 0 }}>
          <strong style={{ color: "#4A6741" }}>{currentLabel}</strong> vs.{" "}
          <strong style={{ color: "#6E5A8E" }}>{compareLabel}</strong>
        </p>
      </div>
      <table style={{ width: "100%", fontSize: bodyFont, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #EBE8E0" }}>
            <th style={{ textAlign: "left", padding: "4px 6px 4px 0", fontSize: labelFont, color: "#5A5A5A", fontWeight: 600 }}>Metric</th>
            <th style={{ textAlign: "right", padding: 4, fontSize: labelFont, color: "#4A6741", fontWeight: 700 }}>{currentLabel}</th>
            <th style={{ textAlign: "right", padding: 4, fontSize: labelFont, color: "#6E5A8E", fontWeight: 700 }}>{compareLabel}</th>
            <th style={{ textAlign: "right", padding: 4, fontSize: labelFont, color: "#5A5A5A", fontWeight: 700 }}>Δ current − comparison</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => {
            const a = currentPlan.metrics?.[row.key] ?? 0;
            const b = comparePlan.metrics?.[row.key] ?? 0;
            const d = a - b;
            const good = row.better === "high" ? d > 0 : row.better === "low" ? d < 0 : null;
            const deltaColor = Math.abs(d) < 0.5 ? "#5A5A5A" : good ? "#4A6741" : "#B84A4A";
            return (
              <tr key={row.key} style={{ borderBottom: "1px solid #F3F1EC" }}>
                <td style={{ padding: "4px 6px 4px 0", color: "#5A5A5A", fontWeight: row.bold ? 700 : 400 }}>{row.label}</td>
                <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums",
                             fontSize: numFont, fontWeight: row.bold ? 800 : 600, color: "#1A1A1A" }}
                    data-testid={`${testid}-current-${row.key}`}>
                  {fmtUSD(a)}
                </td>
                <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums",
                             fontSize: numFont, fontWeight: row.bold ? 800 : 600, color: "#33506B" }}
                    data-testid={`${testid}-compare-${row.key}`}>
                  {fmtUSD(b)}
                </td>
                <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums",
                             fontSize: numFont, fontWeight: 700, color: deltaColor }}
                    data-testid={`${testid}-delta-${row.key}`}>
                  {Math.abs(d) < 0.5 ? "—" : <>
                    {d >= 0 ? arrow("up") : arrow("down")}
                    {d >= 0 ? "+" : "−"}{fmtUSD(Math.abs(d))}
                  </>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ScenarioCompareOverlay;
