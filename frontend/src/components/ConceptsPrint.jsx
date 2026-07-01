import { fmtUSD, fmtPct } from "@/lib/api";
import { Waterfall, InternalExternalLines } from "@/components/ConceptsCharts";

const C = { green: "#4A6741", sage: "#7A9B76", terra: "#C87941", sand: "#E6B89C", blue: "#4B7A94" };
const kFmt = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
const CW = 660;

const H = ({ children }) => (
  <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 15, color: "#1A1A1A", marginBottom: 4 }}>{children}</div>
);
const Sub = ({ children }) => <div style={{ fontSize: 11, color: "#777", marginBottom: 10, maxWidth: CW }}>{children}</div>;
const Cell = ({ label, value, tone }) => (
  <div style={{ flex: 1, border: `1px solid ${tone === "terra" ? "#C87941" : "#4A6741"}55`, background: `${tone === "terra" ? "#C87941" : "#4A6741"}0D`, borderRadius: 8, padding: "10px 12px" }}>
    <div style={{ fontSize: 9, letterSpacing: 0.4, textTransform: "uppercase", fontWeight: 700, color: tone === "terra" ? "#C87941" : "#4A6741" }}>{label}</div>
    <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 700, color: tone === "terra" ? "#C87941" : "#4A6741" }}>{value}</div>
  </div>
);

// Print-only Concepts pages (fixed-width charts so they render inside the hidden print block).
export const ConceptsPrint = ({ scenario, withRoth, noRoth }) => {
  const rows = withRoth?.rows || [];
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

  // Internal vs external (plan-derived defaults)
  const iraReturn = scenario.accounts.find((a) => a.tax_type === "Tax-Deferred")?.return
    ?? scenario.accounts.find((a) => a.tax_type === "Tax-Free")?.return ?? 0.07;
  const rate = (scenario.roth?.target_bracket ?? 0.24) + stateRate;
  const years = 20;
  const convVal = Math.round(Math.max(0, ...rows.map((r) => r.roth_conversion || 0))) || 300000;
  const taxAmt = convVal * rate;
  const rothInt0 = Math.max(0, convVal - taxAmt);
  const ieSeries = Array.from({ length: years + 1 }, (_, y) => ({
    year: y,
    External: Math.round(convVal * Math.pow(1 + iraReturn, y)),
    Internal: Math.round(rothInt0 * Math.pow(1 + iraReturn, y)),
  }));
  const extEnd = ieSeries[years].External, intEnd = ieSeries[years].Internal;

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

      <div style={{ paddingTop: 4, pageBreakAfter: "always", breakAfter: "page" }}>
        <H>Paying the conversion tax externally vs. from the conversion</H>
        <Sub>
          One {fmtUSD(convVal)} conversion at a {fmtPct(rate)} tax rate, growing {fmtPct(iraReturn)}/yr. Pay the tax from outside money and the full amount
          compounds tax-free; pay it from the conversion and less ever reaches the Roth. Here's the Roth balance {years} years later.
        </Sub>
        <InternalExternalLines data={ieSeries} width={CW} testid="print-ie-chart" />
        <div style={{ display: "flex", gap: 10, marginTop: 10, maxWidth: CW }}>
          <Cell label={`Roth @ Yr ${years} — External`} value={fmtUSD(extEnd)} />
          <Cell label={`Roth @ Yr ${years} — Internal`} value={fmtUSD(intEnd)} tone="terra" />
          <Cell label="Tax-free advantage" value={`+${fmtUSD(extEnd - intEnd)}`} />
        </div>
      </div>
    </div>
  );
};
