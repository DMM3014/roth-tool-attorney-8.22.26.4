// Widow Tax Trap illustration — shared between Client Report Legacy page
// and the Convert vs Skip tab. Reads filing_status per row from the
// projection engine (which flips MFJ→Single at first death) and shows:
//   1. Number of widow years + range
//   2. Total ordinary tax paid during widow years (from engine)
//   3. Estimated "compression premium" using 2026 IRS ordinary brackets
//   4. Small comparison of MFJ vs Single bracket caps
//   5. Callout: conversions before first death lock in MFJ rates.
import { useMemo } from "react";
import { fmtUSD, fmtPct } from "@/lib/api";

// 2026 IRS ordinary income brackets (statutory, OBBBA-permanent; matches the
// engine's TaxTables base year). Used only as an illustrative
// "would-have-been-MFJ" tax calc — the engine's own numbers are authoritative
// for the widow-year total.
const MFJ_2026 = [
  [0.10, 0, 24_800],
  [0.12, 24_800, 101_200],
  [0.22, 101_200, 211_400],
  [0.24, 211_400, 403_550],
  [0.32, 403_550, 512_450],
  [0.35, 512_450, 768_700],
  [0.37, 768_700, Infinity],
];
const SINGLE_2026 = [
  [0.10, 0, 12_400],
  [0.12, 12_400, 50_600],
  [0.22, 50_600, 105_700],
  [0.24, 105_700, 201_775],
  [0.32, 201_775, 256_225],
  [0.35, 256_225, 640_600],
  [0.37, 640_600, Infinity],
];

const bracketTax = (income, brackets) => {
  let tax = 0;
  for (const [rate, lo, hi] of brackets) {
    if (income <= lo) break;
    tax += (Math.min(income, hi) - lo) * rate;
  }
  return tax;
};

/**
 * Given the rows array from a projection response, produces:
 *   { widowYears, firstDeathYear, totalWidowTax, totalWidowOrdinary,
 *     avgMarginal, hypotheticalMfjTax, compressionPremium }
 */
export const computeWidowStats = (rows) => {
  if (!rows || !rows.length) return null;
  const widowRows = rows.filter((r) => r.filing_status && r.filing_status !== "MFJ");
  if (!widowRows.length) return null;
  const firstDeathYear = widowRows[0]?.year;
  const totalWidowTax = widowRows.reduce((t, r) => t + (r.total_tax || 0), 0);
  const totalWidowOrdinary = widowRows.reduce((t, r) => t + (r.ordinary_taxable_income || 0), 0);
  const avgMarginal = widowRows.length
    ? widowRows.reduce((t, r) => t + (r.marginal_rate || 0), 0) / widowRows.length
    : 0;

  // Hypothetical: same ordinary_taxable_income but under MFJ brackets → the compression premium.
  const hypotheticalMfjTax = widowRows.reduce(
    (t, r) => t + bracketTax(Math.max(0, r.ordinary_taxable_income || 0), MFJ_2026), 0,
  );
  const actualSingleTaxOnOrdinary = widowRows.reduce(
    (t, r) => t + bracketTax(Math.max(0, r.ordinary_taxable_income || 0), SINGLE_2026), 0,
  );
  const compressionPremium = Math.max(0, actualSingleTaxOnOrdinary - hypotheticalMfjTax);
  return {
    widowYears: widowRows.length,
    firstDeathYear,
    lastYear: widowRows[widowRows.length - 1]?.year,
    totalWidowTax,
    totalWidowOrdinary,
    avgMarginal,
    hypotheticalMfjTax,
    actualSingleTaxOnOrdinary,
    compressionPremium,
  };
};

// Web version — used inside Convert vs Skip (Tailwind-styled).
export const WidowTaxTrapWeb = ({ rows, testid = "widow-trap-web" }) => {
  const stats = useMemo(() => computeWidowStats(rows), [rows]);
  if (!stats) {
    return (
      <div className="rounded-xl border border-[#EBE8E0] bg-white p-4" data-testid={testid}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-semibold text-[#1A1A1A]">Widow(er) Tax Trap</span>
        </div>
        <p className="text-[11.5px] text-muted-foreground italic">
          The projection doesn&apos;t include any widow years (either both spouses live to plan end, or the household is
          not filing MFJ to begin with). If both spouses have equal life expectancies but different actual dates of
          passing are a concern, ask your advisor to model a scenario with a shorter spouse life expectancy.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[#EBE8E0] bg-white p-4" data-testid={testid}>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-semibold text-[#1A1A1A]">Widow(er) Tax Trap — MFJ → Single Compression</p>
        <p className="text-[11px] text-muted-foreground">
          Est. compression premium: <strong className="text-[#C87941]">{fmtUSD(stats.compressionPremium)}</strong>
        </p>
      </div>
      <p className="text-[11.5px] text-muted-foreground leading-relaxed mb-3">
        The plan projects <strong>{stats.widowYears} year{stats.widowYears === 1 ? "" : "s"}</strong> filing
        Single ({stats.firstDeathYear}–{stats.lastYear}) after first death. Single-filer brackets are roughly half as
        wide as MFJ — the same ordinary income now hits a higher bracket.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <StatTile label="Widow years" value={`${stats.widowYears}`} tone="neutral"
          sub={`Avg marginal ${fmtPct(stats.avgMarginal)}`} />
        <StatTile label="Fed ordinary (Single)" value={fmtUSD(stats.actualSingleTaxOnOrdinary)} tone="orange"
          sub="On widow-year taxable income" />
        <StatTile label="Fed ordinary (if MFJ)" value={fmtUSD(stats.hypotheticalMfjTax)} tone="green"
          sub="Same income, MFJ brackets" />
        <StatTile label="Compression cost" value={fmtUSD(stats.compressionPremium)} tone="orange"
          sub="Single − MFJ" />
      </div>
      <p className="text-[10.5px] text-muted-foreground italic mb-1">
        For reference, the projection engine reports <strong>{fmtUSD(stats.totalWidowTax)}</strong> in
        <em> total</em> tax across those widow years (fed + state + NIIT + Medicare/IRMAA). The tiles above isolate
        just the federal-ordinary layer, where the MFJ→Single compression actually lives.
      </p>
      <BracketCompareTable />
      <p className="text-[10.5px] text-muted-foreground italic mt-2 leading-relaxed">
        Note: The Actual figures come from the projection engine (running the year&apos;s exact rules). The
        &quot;If still MFJ&quot; column uses 2026 statutory MFJ brackets applied to each widow year&apos;s ordinary
        taxable income — illustrative only. The <strong>real takeaway</strong>: every Roth conversion done <em>before</em>
        first death locks in MFJ rates. Conversions after first death cost Single rates on the same dollar.
      </p>
    </div>
  );
};

// Print/PDF version — used inside Client Report Legacy page (inline styles for html2pdf).
export const WidowTaxTrapPrint = ({ rows }) => {
  const stats = useMemo(() => computeWidowStats(rows), [rows]);
  if (!stats) {
    return (
      <>
        <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 12.5, color: "#1A1A1A", marginTop: 14, marginBottom: 4 }}>
          Widow(er) Tax Trap
        </div>
        <p style={{ fontSize: 10.5, color: "#5A5A5A", fontStyle: "italic", marginBottom: 6 }}>
          No widow years are projected in this scenario. If the spouses have different actual longevities from the
          plan assumption, this section would show the cost of MFJ→Single filing compression.
        </p>
      </>
    );
  }
  return (
    <>
      <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 12.5, color: "#1A1A1A", marginTop: 14, marginBottom: 4 }}
           data-testid="cr-widow-trap-title">
        Widow(er) Tax Trap — MFJ → Single Compression
      </div>
      <p style={{ fontSize: 11, color: "#2A2A2A", lineHeight: 1.55, marginBottom: 6 }}>
        This plan projects <strong>{stats.widowYears} year{stats.widowYears === 1 ? "" : "s"}</strong> of Single-filer
        status ({stats.firstDeathYear}–{stats.lastYear}) after the first spouse passes. Single-filer brackets are
        roughly half as wide as MFJ — the same ordinary income now sits in a higher bracket, which is why every
        Roth conversion done <em>before</em> first death locks in the wider MFJ rates.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginBottom: 6 }} data-testid="cr-widow-trap-table">
        <thead>
          <tr style={{ borderBottom: "1.5px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
            <th style={{ padding: "4px 4px" }}></th>
            <th style={{ padding: "4px 4px", textAlign: "right" }}>Actual (Single)</th>
            <th style={{ padding: "4px 4px", textAlign: "right" }}>If still MFJ*</th>
            <th style={{ padding: "4px 4px", textAlign: "right" }}>Compression cost</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: "4px 4px" }}>Ordinary income tax during widow years</td>
            <td style={{ padding: "4px 4px", textAlign: "right", fontWeight: 700, color: "#C87941" }}>{fmtUSD(stats.actualSingleTaxOnOrdinary)}</td>
            <td style={{ padding: "4px 4px", textAlign: "right", color: "#4A6741" }}>{fmtUSD(stats.hypotheticalMfjTax)}</td>
            <td style={{ padding: "4px 4px", textAlign: "right", fontWeight: 700 }}>{fmtUSD(stats.compressionPremium)}</td>
          </tr>
          <tr>
            <td style={{ padding: "4px 4px", color: "#5A5A5A" }}>Total taxable ordinary income (widow years)</td>
            <td colSpan={3} style={{ padding: "4px 4px", textAlign: "right" }}>{fmtUSD(stats.totalWidowOrdinary)}</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 9.5, color: "#777", fontStyle: "italic", marginBottom: 4 }}>
        *Illustrative — computed with 2026 statutory MFJ brackets applied to each widow year&apos;s ordinary
        taxable income. Actual figures come from the projection engine and include NIIT/state/IRMAA.
      </p>
    </>
  );
};

// Sub-components
const StatTile = ({ label, value, sub, tone = "neutral" }) => {
  const color = tone === "green" ? "#4A6741" : tone === "orange" ? "#C87941" : "#5A5A5A";
  return (
    <div className="rounded-lg border border-[#EBE8E0] bg-[#FAFAF8] px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color }}>{label}</div>
      <div className="font-display text-[13px] font-bold text-[#1A1A1A]">{value}</div>
      {sub && <div className="text-[9px] text-[#777] mt-0.5">{sub}</div>}
    </div>
  );
};

const BracketCompareTable = () => (
  <div className="rounded-md border border-[#EBE8E0] bg-[#FAFAF8] p-2.5">
    <p className="text-[10px] uppercase tracking-wider font-semibold text-[#5A5A5A] mb-1.5">
      2026 ordinary brackets — bracket-cap comparison
    </p>
    <table className="w-full text-[10.5px]">
      <thead>
        <tr className="text-[9px] uppercase tracking-wide text-[#5A5A5A] border-b border-[#EBE8E0]">
          <th className="text-left py-0.5">Rate</th>
          <th className="text-right py-0.5">MFJ ends at</th>
          <th className="text-right py-0.5">Single ends at</th>
          <th className="text-right py-0.5">Compression</th>
        </tr>
      </thead>
      <tbody>
        {[
          ["12%", 101_200, 50_600],
          ["22%", 211_400, 105_700],
          ["24%", 403_550, 201_775],
          ["32%", 512_450, 256_225],
          ["35%", 768_700, 640_600],
        ].map(([rate, mfj, single]) => (
          <tr key={rate} className="border-b border-[#F3F1EC]">
            <td className="py-0.5 font-semibold">{rate}</td>
            <td className="py-0.5 text-right">{fmtUSD(mfj)}</td>
            <td className="py-0.5 text-right">{fmtUSD(single)}</td>
            <td className="py-0.5 text-right text-[#C87941] font-semibold">
              {`~${Math.round((1 - single / mfj) * 100)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
