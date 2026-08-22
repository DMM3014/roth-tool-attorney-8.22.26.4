/**
 * Client Report — Single-Variable Sensitivity Analysis page.
 *
 * Reviewer critique: the former scenario-comparison pages varied conversion
 * schedule, funding order, and allocation all at once, so no single decision
 * could be credited for the outcome gap. This page runs three CONTROLLED
 * variants of the CURRENT plan — each changing exactly one input (taken from
 * the comparison scenario) — so every delta is attributable to that input.
 */
import React from "react";
import { Page, H2, P, Sub } from "./helpers.jsx";
import { fmtUSD } from "@/lib/api";

const secondDeathYear = (h) => {
  const cD = (h?.client_dob_year && h?.client_life_expectancy) ? h.client_dob_year + h.client_life_expectancy : null;
  const sD = (h?.spouse_dob_year && h?.spouse_life_expectancy) ? h.spouse_dob_year + h.spouse_life_expectancy : null;
  if (!cD && !sD) return null;
  return Math.max(cD || sD, sD || cD);
};

const metricsFor = (proj, household) => {
  const rows = proj?.rows || [];
  if (!rows.length) return null;
  const second = secondDeathYear(household);
  const y2 = (second && rows.find((r) => r.year >= second)) || rows[rows.length - 1];
  const investable = (y2.cash || 0) + (y2.taxable || 0) + (y2.traditional || 0) + (y2.roth || 0);
  const gross = investable + (y2.real_estate || 0);
  return {
    secondYr: y2.year,
    investable,
    gross,
    taxes: proj?.summary?.lifetime_taxes || 0,
    converted: proj?.summary?.total_roth_converted || 0,
  };
};

const num = { padding: "4px 5px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 9.5 };

export const SensitivityPage = ({ scenario, withRoth, sensitivity, ...footProps }) => {
  const cur = metricsFor(withRoth, scenario?.household);
  const variants = sensitivity?.variants || [];
  const cmpM = sensitivity?.compareProj
    ? metricsFor(sensitivity.compareProj, sensitivity.compareHousehold || scenario?.household)
    : null;
  const compareLabel = sensitivity?.compareLabel || "Comparison";

  if (!cur || !variants.length) {
    return (
      <Page testid="cr-page-sensitivity" {...footProps}>
        <H2>Single-Variable Sensitivity Analysis</H2>
        <P>Sensitivity runs are still loading. This page populates once the three controlled variants finish.</P>
      </Page>
    );
  }

  const tableRows = [
    { key: "current", label: "Current plan", changed: "Baseline — nothing changed.", m: cur, isBase: true },
    ...variants.map((v) => ({ key: v.key, label: v.label, changed: v.changed, m: metricsFor(v.proj, scenario?.household) })),
  ];

  return (
    <Page testid="cr-page-sensitivity" {...footProps}>
      <H2>Single-Variable Sensitivity Analysis</H2>
      <P>
        A comparison scenario that changes several inputs at once cannot tell you <em>which decision</em> created the
        outcome gap. Each run below starts from the <strong>current plan</strong> and changes <strong>exactly one
        input</strong>, taken from the &ldquo;{compareLabel}&rdquo; scenario — same household, same death years, same
        expenses, and same everything else — so each delta is attributable to that single input.
      </P>
      <table style={{ width: "100%", fontSize: 9.5, borderCollapse: "collapse", marginTop: 8 }} data-testid="cr-sensitivity-table">
        <thead>
          <tr style={{ borderBottom: "1.5px solid #4A6741", background: "#F9F8F6", color: "#5A5A5A" }}>
            <th style={{ padding: 5, textAlign: "left" }}>Run</th>
            <th style={{ padding: 5, textAlign: "right" }}>Investable @ 2nd death</th>
            <th style={{ padding: 5, textAlign: "right" }}>Gross estate @ 2nd death</th>
            <th style={{ padding: 5, textAlign: "right" }}>Lifetime taxes</th>
            <th style={{ padding: 5, textAlign: "right" }}>Total converted</th>
            <th style={{ padding: 5, textAlign: "right" }}>Δ gross estate vs. current</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((r) => {
            if (!r.m) return null;
            const d = r.m.gross - cur.gross;
            return (
              <React.Fragment key={r.key}>
                <tr style={{ background: r.isBase ? "#4A67410D" : "#FFFFFF" }} data-testid={`cr-sensitivity-row-${r.key}`}>
                  <td style={{ padding: "4px 5px", fontWeight: 700 }}>{r.label}</td>
                  <td style={num}>{fmtUSD(r.m.investable)}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{fmtUSD(r.m.gross)}</td>
                  <td style={num}>{fmtUSD(r.m.taxes)}</td>
                  <td style={num}>{fmtUSD(r.m.converted)}</td>
                  <td style={{ ...num, fontWeight: 700,
                               color: r.isBase ? "#8A8A82" : Math.abs(d) < 0.5 ? "#8A8A82" : d > 0 ? "#4A6741" : "#B84A4A" }}>
                    {r.isBase ? "—" : `${d >= 0 ? "+" : "−"}${fmtUSD(Math.abs(d))}`}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid #EBE8E0" }}>
                  <td colSpan={6} style={{ padding: "0 5px 6px", fontSize: 8.5, color: "#777", fontStyle: "italic" }}>
                    {r.changed}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
          {cmpM && (
            <>
              <tr style={{ background: "#FDF6EC" }} data-testid="cr-sensitivity-row-full-compare">
                <td style={{ padding: "4px 5px", fontWeight: 700, color: "#8A5A20" }}>
                  Full &ldquo;{compareLabel}&rdquo; (reference)
                </td>
                <td style={num}>{fmtUSD(cmpM.investable)}</td>
                <td style={{ ...num, fontWeight: 700 }}>{fmtUSD(cmpM.gross)}</td>
                <td style={num}>{fmtUSD(cmpM.taxes)}</td>
                <td style={num}>{fmtUSD(cmpM.converted)}</td>
                <td style={{ ...num, color: "#8A5A20" }}>not attributable</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #EBE8E0" }}>
                <td colSpan={6} style={{ padding: "0 5px 6px", fontSize: 8.5, color: "#8A5A20", fontStyle: "italic" }}>
                  All differences at once (schedule + funding order + returns + expenses
                  {cmpM.secondYr !== cur.secondYr ? ` + different death years (2nd death ${cmpM.secondYr} vs ${cur.secondYr})` : ""}).
                  Shown for reference only — do NOT read its gap as the effect of any single decision.
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <Sub>
        Gross estate = investable accounts (cash + taxable + traditional + Roth) plus the projected home value at the
        second death — the same basis as the EP Projection pages. All variant runs keep the current household&apos;s
        dates of birth, life expectancies, income streams, and expenses; only the named input changes. Lifetime taxes
        include federal + state income tax, NIIT, and Medicare/IRMAA over the full plan horizon.
      </Sub>
    </Page>
  );
};
