import React from "react";
import { Page, H2, P, Sub, PvFootnote } from "./helpers.jsx";
import { fmtUSD, fmtPct } from "@/lib/api";

const CASES = [
  { key: "no_charity", label: "No charity (family only)" },
  { key: "charity_with_conversions", label: "Charity + current conversions" },
  { key: "charity_no_conversions", label: "Charity + conversions off" },
];

const signed = (v) => `${v >= 0 ? "+" : "\u2212"}${fmtUSD(Math.abs(v))}`;

// Charitable Beneficiary — printed comparison of the three cases with the
// conversions'-effect delta in nominal and today's dollars (PV-twin convention).
export const CharitableBeneficiaryPage = ({ charityData, ...footProps }) => {
  const d = charityData;
  if (!d || !d.cases) {
    return (
      <Page testid="cr-page-charity" {...footProps}>
        <H2>Charitable Beneficiary — IRA to Charity vs Conversions</H2>
        <P>This section was not computed for this plan.</P>
      </Page>
    );
  }
  const cases = d.cases;
  const delta = d.combined_delta_conversions_effect || { nominal: 0, today: 0 };
  const cell = { padding: "5px 6px", fontVariantNumeric: "tabular-nums", textAlign: "right", fontSize: 9.5 };
  const th = { ...cell, fontWeight: 700, color: "#555", borderBottom: "1px solid #D8D5CC" };

  return (
    <Page testid="cr-page-charity" {...footProps}>
      <H2>Charitable Beneficiary — IRA to Charity vs Conversions</H2>
      <P>
        Naming a qualified charity as the death-time beneficiary of the Traditional IRA passes that fraction free of
        income tax (the charity pays none) <em>and</em> free of estate tax (a charitable deduction on the estate side),
        and removes it from the heirs&apos; SECURE-10 drawdown. Here {fmtPct(d.fraction)} of the IRA is designated to
        charity, compared with the current conversion program and with conversions off.
      </P>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }} data-testid="cr-charity-table">
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Case</th>
            <th style={th}>Family after-tax</th>
            <th style={th}>Charity receipt</th>
            <th style={th}>Combined family&nbsp;+&nbsp;charity</th>
            <th style={th}>Total tax (everyone)</th>
          </tr>
        </thead>
        <tbody>
          {CASES.map((c) => {
            const r = cases[c.key] || {};
            const win = d.winner === c.key;
            return (
              <tr key={c.key} data-testid={`cr-charity-row-${c.key}`}
                style={{ background: win ? "#4A67410D" : "#fff", borderBottom: "1px solid #F0EEE8" }}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>
                  {c.label}{win && <span style={{ color: "#4A6741", fontWeight: 800 }}> &#9656; best</span>}
                </td>
                <td style={cell}>{fmtUSD(r.family_after_tax)}</td>
                <td style={{ ...cell, color: "#4A6741" }}>{fmtUSD(r.charity_receipt)}</td>
                <td style={{ ...cell, fontWeight: 700 }}>{fmtUSD(r.combined_family_charity)}</td>
                <td style={{ ...cell, color: "#B84A4A" }}>{fmtUSD(r.total_tax_everyone)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 10, padding: "8px 10px", background: "#F1F5EF", border: "1px solid #4A674133", borderRadius: 4 }}
        data-testid="cr-charity-delta">
        <p style={{ fontSize: 10, margin: 0, color: "#2A2A2A" }}>
          <strong>Conversions&apos; effect on the combined family + charity total:</strong>{" "}
          <span style={{ color: delta.nominal >= 0 ? "#4A6741" : "#B84A4A", fontWeight: 700 }}>{signed(delta.nominal)}</span>
          {" nominal / "}
          <span style={{ color: delta.today >= 0 ? "#4A6741" : "#B84A4A", fontWeight: 700 }}>{signed(delta.today)}</span>
          {" in today\u2019s $. "}
          A negative figure means converting shrinks the IRA that would otherwise pass tax-free to charity, reducing the
          combined total — the result emerges from the engine, it is not assumed.
        </p>
      </div>

      <Sub>
        {d.note} Charity is tax-exempt, so its receipt is grown over the SECURE-10 horizon (parallel to an inherited
        Roth) for an apples-to-apples combined total. See the QCD page: lifetime QCDs and a death-time bequest draw on
        the same pre-tax pool and should be planned together.
      </Sub>
      <PvFootnote testid="cr-charity-pv-footnote" />
    </Page>
  );
};

export default CharitableBeneficiaryPage;
