/**
 * Client Report — Assumption Review Memorandum (Audit Mode).
 *
 * Memo-format summary of a third-party planner review: differing assumptions,
 * the outcome deltas, the single-variable attribution waterfall, and a signature
 * block for the reviewing attorney. Rendered only when an audit has been run.
 */
import React from "react";
import { Page, H2, H3, P, Sub } from "./helpers.jsx";
import { fmtUSD, fmtPct } from "@/lib/api";

const money = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${fmtUSD(Math.abs(v))}`);

const OUTCOME_ROWS = [
  ["after_tax_to_heirs_secure10", "After-tax wealth to heirs (SECURE-window end)"],
  ["net_worth_at_second_death", "Net worth at second death"],
  ["lifetime_tax_nominal", "Lifetime income tax (nominal)"],
  ["lifetime_tax_npv", "Lifetime income tax (NPV)"],
  ["total_conversions", "Total Roth conversions"],
  ["federal_estate_tax_no_trust", "Federal estate tax (no trust)"],
];

export const AuditMemoPage = ({ audit, advisor, ...footProps }) => {
  if (!audit || !audit.outcomes) {
    return (
      <Page testid="cr-page-audit-memo" {...footProps}>
        <H2>Assumption Review Memorandum</H2>
        <P>No third-party plan review has been run for this engagement.</P>
      </Page>
    );
  }
  const d = audit.outcomes.deltas || {};
  const diffs = audit.assumption_diff || { count: 0, grouped: {} };
  const attr = audit.attribution || {};
  const wf = attr.waterfall || [];
  const gap = attr.total_gap || 0;
  const topDriver = attr.top_driver || null;
  const cell = { padding: "4px 6px", fontSize: 9.5, borderBottom: "1px solid #F3F1EC" };
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Page testid="cr-page-audit-memo" {...footProps}>
      <H2>Assumption Review Memorandum</H2>
      <div style={{ fontSize: 10, color: "#5A5A5A", marginBottom: 8, lineHeight: 1.5 }} data-testid="cr-audit-memo-header">
        <div><strong>Re:</strong> Independent review of a third-party financial-planning projection</div>
        <div><strong>Date:</strong> {today}</div>
        {advisor?.advisor_firm && <div><strong>Reviewing firm:</strong> {advisor.advisor_firm}</div>}
      </div>

      <P>
        This memorandum compares an outside planner&apos;s projection (the &ldquo;Planner&rdquo; plan) against our
        office&apos;s independent projection (the &ldquo;Review&rdquo; plan). We identified{" "}
        <strong>{diffs.count} assumption {diffs.count === 1 ? "difference" : "differences"}</strong> and modeled the
        dollar impact of each on the wealth ultimately delivered to heirs.
      </P>

      {/* Outcome deltas */}
      <H3>Outcome differences (Review − Planner)</H3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }} data-testid="cr-audit-memo-outcomes">
        <thead>
          <tr style={{ background: "#F9F8F6", borderBottom: "1.5px solid #4A6741" }}>
            <th style={{ ...cell, textAlign: "left", fontWeight: 700 }}>Metric</th>
            <th style={{ ...cell, textAlign: "right", fontWeight: 700 }}>Review</th>
            <th style={{ ...cell, textAlign: "right", fontWeight: 700 }}>Planner</th>
            <th style={{ ...cell, textAlign: "right", fontWeight: 700 }}>Δ nominal</th>
            <th style={{ ...cell, textAlign: "right", fontWeight: 700 }}>Δ today&apos;s $</th>
          </tr>
        </thead>
        <tbody>
          {OUTCOME_ROWS.map(([k, label]) => d[k] && (
            <tr key={k}>
              <td style={cell}>{label}</td>
              <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(d[k].review)}</td>
              <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(d[k].planner)}</td>
              <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700,
                           color: (d[k].delta_nominal || 0) >= 0 ? "#4A6741" : "#B84A4A" }}>{money(d[k].delta_nominal)}</td>
              <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums",
                           color: (d[k].delta_today || 0) >= 0 ? "#4A6741" : "#B84A4A" }}>{money(d[k].delta_today)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Attribution waterfall */}
      <H3>Attribution — what drives the {money(gap)} gap in after-tax wealth to heirs</H3>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6 }} data-testid="cr-audit-memo-waterfall">
        <tbody>
          {wf.map((w, i) => {
            const isEnd = w.type === "start" || w.type === "end";
            return (
              <tr key={i} style={{ borderBottom: "1px solid #F3F1EC",
                                   background: isEnd ? "#F9F8F6" : (w.type === "residual" ? "#FBF6EC" : "#FFFFFF") }}>
                <td style={{ ...cell, fontWeight: isEnd || w.type === "residual" ? 700 : 400,
                             fontFamily: w.type === "step" ? "monospace" : "inherit", fontSize: w.type === "step" ? 8.5 : 9.5 }}>
                  {w.label}
                </td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700,
                             color: isEnd ? "#1A1A1A" : ((w.value || 0) >= 0 ? "#4A6741" : "#B84A4A") }}>
                  {isEnd ? fmtUSD(w.cumulative) : money(w.value)}
                </td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#8A8A8A", fontSize: 8.5 }}>
                  {fmtUSD(w.cumulative)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Sub>
        Each step re-runs the Planner plan changing only that single assumption to the Review value; the interaction
        residual absorbs cross-effects and any differences beyond the twelve largest. Steps + residual reconstruct the
        full gap exactly.
      </Sub>

      {/* Differing assumptions detail */}
      {diffs.count > 0 && (
        <>
          <H3>Differing assumptions</H3>
          {Object.entries(diffs.grouped).map(([section, items]) => (
            <div key={section} style={{ marginBottom: 5 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#4A6741", textTransform: "uppercase", letterSpacing: 0.3 }}>{section}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {items.map((it, i) => {
                    const isTop = topDriver && it.path === topDriver;
                    return (
                    <tr key={i} style={{ borderBottom: "1px solid #F6F5F1", background: isTop ? "#EEF3EC" : undefined }} data-testid="cr-audit-memo-diff-row">
                      <td style={{ ...cell, fontFamily: "monospace", fontSize: 8.5, color: "#5A5A5A", fontWeight: isTop ? 700 : 400 }}>
                        {it.path}{isTop && <span style={{ fontFamily: "inherit", color: "#4A6741", fontWeight: 700 }}> ★ largest driver</span>}
                      </td>
                      <td style={{ ...cell, textAlign: "right", fontWeight: isTop ? 700 : 400 }}>Review: <strong>{String(it.review)}</strong></td>
                      <td style={{ ...cell, textAlign: "right", color: "#8A5A20", fontWeight: isTop ? 700 : 400 }}>Planner: <strong>{String(it.planner)}</strong></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      {/* Signature block */}
      <div style={{ marginTop: 18, paddingTop: 10, borderTop: "1px solid #D9CFA8" }} data-testid="cr-audit-memo-signature">
        <div style={{ fontSize: 9.5, color: "#3A3A3A", lineHeight: 1.6 }}>
          Respectfully submitted,
          <div style={{ height: 26 }} />
          <div style={{ borderTop: "1px solid #1A1A1A", width: 260, paddingTop: 3 }}>
            <strong>{advisor?.advisor_name || "Reviewing attorney"}</strong>
            {advisor?.advisor_title ? `, ${advisor.advisor_title}` : ""}
          </div>
          {advisor?.advisor_firm && <div>{advisor.advisor_firm}</div>}
          <div style={{ marginTop: 4, color: "#8A8A8A", fontSize: 8.5 }}>
            This memorandum is an internal analytical work product prepared for the client&apos;s counsel. Figures rely on
            the stated assumptions and this model; they are estimates, not tax advice or a guarantee of results.
          </div>
        </div>
      </div>
    </Page>
  );
};
