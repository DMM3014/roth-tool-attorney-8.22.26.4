/**
 * PlanComparisonTable — metric matrix across the four EP Projection plans.
 * Neutral presentation: no per-row "best" highlighting or stars — the right
 * structure depends on family objectives, not a single dollar metric.
 */
import React from "react";
import { fmtUSD } from "@/lib/api";

export const PlanComparisonTable = ({ plans, capGainsRate = 0.24, testid = "flow-metrics-table" }) => {
  const rows = [
    { label: "Inside GST trusts at 2nd death", get: (m) => m.in_trust_y2 },
    { label: "GST-exempt (dynasty-sheltered)", get: (m) => m.gst_exempt_y2 },
    { label: "Federal estate tax at 2nd death", get: (m) => m.fet },
    { label: `Forgone 2nd step-up (gains @ ${(capGainsRate * 100).toFixed(0)}%)`, get: (m) => m.forgone_step_up },
    { label: "Roth outside GST shelter", get: (m) => m.lost_roth_unsheltered },
    { label: "Heir income tax on Traditional (memo)", get: (m) => m.trad_income_tax },
    { label: "Totals to Trusts and Children at 2nd death", get: (m) => m.total_to_children, bold: true },
    // "net_economic" = gross-to-children minus embedded capital-gains only.
    // The Heir income tax on Traditional (row above) is still owed by heirs
    // over the SECURE 10-year window and is NOT subtracted here — labeling it
    // "Economic net" implied it was a fully net-of-tax bottom line, which
    // advisors flagged as misleading. Renamed + subtitled to make the
    // exclusion explicit.
    {
      label: "Second-death estate net",
      sub: "(after embedded gains, before heir IRA income tax)",
      get: (m) => m.net_economic,
      bold: true,
    },
  ];
  return (
    <table data-testid={testid} style={{ width: "100%", fontSize: 10.5, borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ borderBottom: "1.5px solid #4A6741", background: "#F9F8F6" }}>
          <th style={{ padding: 6, textAlign: "left", fontSize: 10 }}>Metric</th>
          {plans.map((p) => (
            <th key={p.key} style={{ padding: 6, textAlign: "right", fontSize: 10, color: "#5A5A5A" }}>
              Plan {p.plan_no}
              <div style={{ fontSize: 8, fontWeight: 500, color: "#8A8578" }}>{p.title}</div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: 6, color: "#5A5A5A" }}>
              {row.label}
              {row.sub && (
                <div style={{ fontSize: 8.5, color: "#8A8578", fontWeight: 400 }}>{row.sub}</div>
              )}
            </td>
            {plans.map((p) => (
              <td key={p.key} style={{ padding: 6, textAlign: "right", fontVariantNumeric: "tabular-nums",
                    fontWeight: row.bold ? 800 : 500, color: "#1A1A1A" }}>
                {fmtUSD(row.get(p.metrics))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default PlanComparisonTable;
