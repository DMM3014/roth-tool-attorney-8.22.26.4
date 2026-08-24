/** Client Report — Mortality Timing sensitivity (five death-timing scenarios). */
import React from "react";
import { Page, H2, P, Sub } from "./helpers.jsx";
import { PvFootnote } from "./helpers.jsx";
import { fmtUSD } from "@/lib/api";

export const MortalityTimingPage = ({ mortalityData, pv, ...footProps }) => {
  if (!mortalityData || !mortalityData.rows) {
    return (
      <Page testid="cr-page-mortality" {...footProps}>
        <H2>Mortality Timing</H2>
        <P>This section was not computed for this plan.</P>
      </Page>
    );
  }
  const rows = mortalityData.rows;
  const th = { padding: "4px 5px", fontSize: 8.5, fontWeight: 700, textAlign: "right", borderBottom: "1.5px solid #4A6741" };
  const td = { padding: "4px 5px", fontSize: 8.5, textAlign: "right", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid #F3F1EC" };
  return (
    <Page testid="cr-page-mortality" {...footProps}>
      <H2>Mortality Timing</H2>
      <P>
        Retirement and estate outcomes are sensitive to <em>when</em> each spouse dies. The table re-runs the full
        projection under five death-timing scenarios, isolating widow-year (single-filer) exposure, estate tax, and the
        wealth ultimately delivered to heirs.
      </P>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }} data-testid="cr-mortality-table">
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Scenario</th>
            <th style={th}>Single-filer yrs</th>
            <th style={th}>Compression cost</th>
            <th style={th}>Net worth @ 2nd death</th>
            <th style={th}>Federal estate tax</th>
            <th style={th}>To heirs (SECURE end)</th>
            <th style={th}>Conversion Δ (nom / today)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const todayVal = (pv && r.secure_window_end_year != null)
              ? r.conversion_delta_nominal * pv.at(r.secure_window_end_year)
              : r.conversion_delta_today;
            return (
            <tr key={r.id} data-testid={`cr-mortality-row-${r.id}`} style={{ background: r.id === "base" ? "#4A67410D" : "#fff" }}>
              <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{r.label}</td>
              <td style={td}>{r.single_filer_years}</td>
              <td style={{ ...td, color: "#B84A4A" }}>{fmtUSD(r.bracket_compression_cost)}</td>
              <td style={td}>{fmtUSD(r.net_worth_at_second_death)}</td>
              <td style={td}>{fmtUSD(r.federal_estate_tax_no_trust)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{fmtUSD(r.after_tax_to_heirs_secure10)}</td>
              <td style={{ ...td, color: r.conversion_delta_nominal >= 0 ? "#4A6741" : "#B84A4A" }}>
                {r.conversion_delta_nominal >= 0 ? "+" : "−"}{fmtUSD(Math.abs(r.conversion_delta_nominal))}
                {" / "}{todayVal >= 0 ? "+" : "−"}{fmtUSD(Math.abs(todayVal))}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 10, borderLeft: "3px solid #4A6741", paddingLeft: 10 }}>
        <p style={{ fontSize: 10, lineHeight: 1.5, color: "#3A3A3A", margin: 0 }} data-testid="cr-mortality-note">
          The §2518 nine-month post-mortem disclaimer window is precisely the mechanism that lets the survivor adapt to{" "}
          <em>actual</em> timing rather than these assumptions (see the EP Plan 2 page). A shortened window is one of the
          specific conditions under which filling toward the heirs&apos; rate — never past it — can overtake the
          lower-bracket program.
        </p>
      </div>
      <Sub>
        Deterministic single-path runs; first death is clamped so it never postdates the second death and neither predates
        the current year. Compression cost estimates the single-vs-MFJ bracket premium over the widow years.
      </Sub>
      <PvFootnote testid="cr-mortality-pv-footnote" />
    </Page>
  );
};
