/**
 * Client Report — Two-Way Sensitivity: Heir Rate × Market Regime.
 *
 * Prints the same heat-grid as the in-app panel: conversion delta in after-tax
 * wealth to heirs (green = converting wins, amber = not) across every heir income-
 * tax rate and every market regime, with the per-regime break-even rate underneath
 * and the verbatim "judge across the whole surface" caption.
 */
import React from "react";
import { Page, H2, P, Sub } from "./helpers.jsx";
import { fmtUSD, fmtPct } from "@/lib/api";

const GREEN = "74, 103, 65";
const AMBER = "184, 122, 60";

const cellBg = (delta, maxAbs) => {
  if (delta == null || Math.abs(delta) < 1 || maxAbs <= 0) return "transparent";  // ~$0 = neutral (conversion is a wash)
  const rgb = delta > 0 ? GREEN : AMBER;
  const a = Math.min(0.85, 0.12 + (Math.abs(delta) / maxAbs) * 0.73);
  return `rgba(${rgb}, ${a.toFixed(3)})`;
};

const cellText = (delta) =>
  delta == null ? "—" : (Math.abs(delta) < 1 ? "$0" : `${delta >= 0 ? "+" : "−"}${fmtUSD(Math.abs(delta))}`);

const railColor = (delta) => {
  if (delta == null || Math.abs(delta) < 1) return "transparent";
  return delta > 0 ? `rgba(${GREEN},0.95)` : `rgba(${AMBER},0.95)`;
};

export const TwoWaySensitivityPage = ({ twoWayData, ...footProps }) => {
  if (!twoWayData || !twoWayData.matrix || twoWayData.matrix.length === 0) {
    return (
      <Page testid="cr-page-two-way" {...footProps}>
        <H2>Two-Way Sensitivity — Heir Rate × Market Regime</H2>
        <P>This section was not computed for this plan.</P>
      </Page>
    );
  }

  const d = twoWayData;
  const maxAbs = Math.max(1, ...d.matrix.flat().filter((v) => v != null).map((v) => Math.abs(v)));
  const th = { padding: "4px 5px", fontSize: 8.5, fontWeight: 700, textAlign: "center", borderBottom: "1.5px solid #4A6741" };
  const rateCell = { padding: "4px 6px", fontSize: 9, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid #F3F1EC" };

  return (
    <Page testid="cr-page-two-way" {...footProps}>
      <H2>Two-Way Sensitivity — Heir Rate × Market Regime</H2>
      <div style={{ background: "#EEF3EC", border: "1px solid rgba(74,103,65,0.35)", borderRadius: 6,
                    padding: "7px 12px", margin: "2px 0 8px" }} data-testid="cr-two-way-headline">
        <p style={{ fontSize: 11, color: "#1A1A1A", margin: 0 }}>
          Conversions win in <strong style={{ color: "#4A6741" }}>{d.wins_at_modeled} of {d.n_regimes}</strong> market
          regimes at your modeled heir rate{d.modeled_rate != null ? ` of ${fmtPct(d.modeled_rate)}` : ""}.
        </p>
      </div>
      <P>
        Every cell is the after-tax wealth delivered to heirs <strong>with</strong> the Roth-conversion plan minus{" "}
        <strong>without</strong> it, at that heir income-tax rate and market regime. Green cells are where converting
        wins; amber cells are where leaving the pre-tax IRA in place wins. The <em>break-even</em> row is the heir rate
        at which the two are equal for each regime.
      </P>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }} data-testid="cr-two-way-grid">
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Heir income-tax rate</th>
            {d.regimes.map((rg) => (
              <th key={rg.preset_id} style={th} data-testid={`cr-two-way-col-${rg.preset_id}`}>{rg.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rates.map((rate, ri) => (
            <tr key={rate} data-testid={`cr-two-way-row-${ri}`}>
              <td style={rateCell}>{d.rate_labels[ri]}</td>
              {d.regimes.map((rg, ci) => {
                const delta = d.matrix[ri][ci];
                return (
                  <td key={rg.preset_id}
                    style={{ padding: "4px 3px", fontSize: 8.5, fontWeight: 700, textAlign: "center",
                             fontVariantNumeric: "tabular-nums", color: "#1A1A1A", border: "1px solid #FFFFFF",
                             borderLeft: `3px solid ${railColor(delta)}`,
                             background: cellBg(delta, maxAbs) }}
                    data-testid={`cr-two-way-cell-${ri}-${ci}`}>
                    {cellText(delta)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid #4A6741" }} data-testid="cr-two-way-breakeven-row">
            <td style={{ ...rateCell, fontWeight: 800, color: "#4A6741" }}>Break-even heir rate</td>
            {d.regimes.map((rg, ci) => {
              const be = d.break_even[ci];
              return (
                <td key={rg.preset_id}
                  style={{ padding: "5px 3px", fontSize: 9, fontWeight: 800, textAlign: "center",
                           fontVariantNumeric: "tabular-nums",
                           color: be.rate == null ? "#8A8A8A" : (be.extrapolated ? "#8A5A20" : "#4A6741") }}
                  data-testid={`cr-two-way-breakeven-${rg.preset_id}`}>
                  {be.rate == null ? "n/a" : fmtPct(be.rate)}
                  {be.rate != null && be.extrapolated && (
                    <span style={{ display: "block", fontSize: 6.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>extrapolated</span>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 8.5, color: "#5A5A5A", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: `rgba(${GREEN},0.7)` }} /> Converting wins
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: `rgba(${AMBER},0.7)` }} /> Not converting wins
        </span>
        {d.modeled_rate != null && <span>Your modeled heir rate: <strong>{fmtPct(d.modeled_rate)}</strong></span>}
      </div>

      <div style={{ marginTop: 10, borderLeft: "3px solid #4A6741", paddingLeft: 10 }}>
        <p style={{ fontSize: 10, lineHeight: 1.55, color: "#3A3A3A", fontStyle: "italic", margin: 0 }}
           data-testid="cr-two-way-caption">
          {d.caption}
        </p>
      </div>
      <Sub>
        Deltas are nominal after-tax dollars to heirs at the end of the SECURE-10 window. The 0% row doubles as the
        charitable-beneficiary case (no income tax on the inherited IRA). Break-even rates flagged &ldquo;extrapolated&rdquo;
        fall outside the 0–41% grid and continue the last segment linearly.
      </Sub>
    </Page>
  );
};
