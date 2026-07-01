import { useEffect, useState } from "react";
import { fmtUSD, fmtPct, runProjection, fundingCompareConfigs } from "@/lib/api";
import { Waterfall, FundingCompareBars } from "@/components/ConceptsCharts";

const C = { green: "#4A6741", sage: "#7A9B76", terra: "#C87941", sand: "#E6B89C", blue: "#4B7A94" };
const kFmt = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const CW = 660;

const H = ({ children }) => (
  <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 15, color: "#1A1A1A", marginBottom: 4 }}>{children}</div>
);
const Sub = ({ children }) => <div style={{ fontSize: 11, color: "#777", marginBottom: 10, maxWidth: CW }}>{children}</div>;

// Print-only Concepts pages (fixed-width charts so they render inside the hidden print block).
export const ConceptsPrint = ({ scenario, withRoth }) => {
  const rows = withRoth?.rows || [];

  const [cmp, setCmp] = useState(null);
  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let alive = true;
    const { depleteIra, leaveIra } = fundingCompareConfigs(scenario, null);
    Promise.all([runProjection(depleteIra), runProjection(leaveIra)]).then(([a, b]) => {
      if (alive) setCmp({ a, b });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!rows.length) return null;

  const stateRate = scenario.tax?.state_rate ?? 0;
  let maxConvYear = null, mv = -1;
  rows.forEach((r) => { if ((r.roth_conversion || 0) > mv) { mv = r.roth_conversion; maxConvYear = r.year; } });
  const row = rows.find((r) => r.year === maxConvYear) || rows[0];
  const cf = row.cashflow || {};

  // Spending waterfall
  const spend = (cf.expenses || 0) + (cf.income_tax || 0) + (cf.medicare || 0);
  const income = (cf.wages_pension || 0) + (cf.gross_ss || 0) + (cf.dividends || 0) + (cf.rmd || 0);
  const spendSteps = [
    { name: "Income & RMD", value: Math.min(income, spend), fill: C.green },
    { name: "From Cash", value: cf.from_cash || 0, fill: C.blue },
    { name: "From Taxable", value: cf.from_taxable || 0, fill: C.sand },
    { name: "From IRA", value: cf.from_ira || 0, fill: C.terra },
    { name: "From Roth", value: cf.from_roth || 0, fill: C.sage },
  ].filter((s) => s.value > 0.5);
  let run = 0;
  const spendWF = spendSteps.map((s) => { const v = Math.round(s.value); const d = { name: s.name, base: run, value: v, fill: s.fill, label: kFmt(v) }; run += s.value; return d; });
  spendWF.push({ name: "Total Spending", base: 0, value: Math.round(run), fill: C.green, label: kFmt(run) });

  // Conversion-tax funding waterfall
  const conversion = cf.conversion || 0;
  const convTax = Math.round(conversion * ((row.marginal_rate || 0) + stateRate));
  const fc = cf.from_cash || 0, ft = cf.from_taxable || 0;
  let cashPart, taxablePart;
  if (fc + ft > 0) { cashPart = Math.min(convTax, fc); taxablePart = Math.max(0, convTax - cashPart); }
  else { cashPart = 0; taxablePart = convTax; }
  const convWF = [];
  let r2 = 0;
  [["From Cash", cashPart, C.blue], ["From Taxable", taxablePart, C.sand]].forEach(([name, val, fill]) => {
    if (val > 0.5) { convWF.push({ name, base: r2, value: Math.round(val), fill, label: kFmt(val) }); r2 += val; }
  });
  convWF.push({ name: "Conversion Tax", base: 0, value: Math.round(convTax), fill: C.terra, label: kFmt(convTax) });

  // Deplete-IRA vs Leave-IRA comparison
  let cmpBlock = null;
  if (cmp) {
    const depL = cmp.a.legacy, leaL = cmp.b.legacy;
    const iraDep = cmp.a.rows[cmp.a.rows.length - 1]?.traditional || 0;
    const iraLeave = cmp.b.rows[cmp.b.rows.length - 1]?.traditional || 0;
    const horizon = leaL.horizon_years || 10;
    const heirRate = leaL.heir_ordinary_rate || 0;
    const cmpData = [
      { name: "At 2nd Death", "Deplete IRA": Math.round(depL.after_tax_estate_at_death), "Leave IRA to heirs": Math.round(leaL.after_tax_estate_at_death) },
      { name: `At +${horizon} Years`, "Deplete IRA": Math.round(depL.after_tax_estate_to_heirs), "Leave IRA to heirs": Math.round(leaL.after_tax_estate_to_heirs) },
    ];
    const rowsTbl = [
      ["Traditional IRA at 2nd death", iraDep, iraLeave],
      ["Heir income tax on inherited IRA", depL.inherited_ira_tax, leaL.inherited_ira_tax],
      ["After-tax to heirs @ 2nd death", depL.after_tax_estate_at_death, leaL.after_tax_estate_at_death],
      [`After-tax to heirs @ +${horizon} yrs`, depL.after_tax_estate_to_heirs, leaL.after_tax_estate_to_heirs],
    ];
    cmpBlock = (
      <div style={{ paddingTop: 4, pageBreakAfter: "always", breakAfter: "page" }} data-testid="print-funding-compare">
        <H>Deplete the IRA now, or leave it for the children?</H>
        <Sub>
          Cash is spent first; the choice is whether to draw the Traditional IRA down at your controlled rates during both lifetimes (preserving the
          taxable step-up), or preserve the IRA by selling taxable assets and leave a larger IRA for the children to draw down at their
          {heirRate ? ` ~${fmtPct(heirRate)}` : ""} ordinary rate over the 10-year SECURE window. Full plan, run both ways.
        </Sub>
        <FundingCompareBars data={cmpData} width={CW} testid="print-funding-compare-chart" />
        <table style={{ width: CW, borderCollapse: "collapse", fontSize: 11, marginTop: 10 }}>
          <thead>
            <tr style={{ textAlign: "right", borderBottom: "1px solid #EBE8E0", color: "#777" }}>
              <th style={{ textAlign: "left", padding: "4px 0" }}>Metric</th>
              <th style={{ padding: "4px 8px", color: C.green }}>Deplete IRA</th>
              <th style={{ padding: "4px 8px", color: C.terra }}>Leave IRA</th>
            </tr>
          </thead>
          <tbody>
            {rowsTbl.map(([label, a, b]) => (
              <tr key={label} style={{ textAlign: "right", borderBottom: "1px solid #F3F1EC" }}>
                <td style={{ textAlign: "left", padding: "5px 0", fontWeight: 600 }}>{label}</td>
                <td style={{ padding: "5px 8px", color: C.green, fontWeight: 600 }}>{fmtUSD(a)}</td>
                <td style={{ padding: "5px 8px", color: C.terra }}>{fmtUSD(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="concepts-print-block" data-testid="print-concepts">
      <div style={{ paddingTop: 4, pageBreakAfter: "always", breakAfter: "page" }}>
        <H>How the plan funds each year — {maxConvYear}</H>
        <Sub>Income covers spending first, then the withdrawal order Cash → Taxable → IRA → Roth. The Roth is drawn last to keep it compounding tax-free.</Sub>
        <Waterfall data={spendWF} width={CW} height={300} testid="print-spending-waterfall" />
        {conversion > 0.5 && (
          <div style={{ marginTop: 14 }}>
            <H>Conversion tax is paid from outside money</H>
            <Sub>
              Converting {fmtUSD(conversion)} in {maxConvYear}; estimated tax {fmtUSD(convTax)} (marginal {fmtPct(row.marginal_rate)} + state {fmtPct(stateRate)}).
              Funded from Cash / Taxable — never from the Roth and never from the converted IRA dollars — so 100% of the conversion lands in the Roth.
            </Sub>
            <Waterfall data={convWF} width={460} height={260} testid="print-conversion-waterfall" />
          </div>
        )}
      </div>
      {cmpBlock}
    </div>
  );
};
