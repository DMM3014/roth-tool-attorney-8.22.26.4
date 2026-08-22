import { useEffect, useMemo, useState } from "react";
import {
  Bar, ComposedChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend, Line, Scatter,
} from "recharts";
import {
  AlertTriangle, Info, Shield,
  Receipt, Layers, TrendingUp,
  FileSpreadsheet, FileDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { runProjection, fmtUSD, fmtPct, downloadCSV, downloadWorkbook } from "@/lib/api";
import { collectCallouts } from "@/lib/taxCallouts";
import { scaleMoney, densityClasses } from "@/lib/gridFmt";
import { useGridPrefs, detectMilestones, focusRangeYears } from "@/lib/useGridPrefs";
import GridControls from "@/components/grid/GridControls";

const C = { green: "#4A6741", sage: "#7A9B76", terra: "#C87941", sand: "#E6B89C",
             blue: "#4B7A94", plum: "#7A5C7E", clay: "#A8553A", muted: "#8A8578" };
const AXIS = { fontSize: 11 };
const kAxis = (v) => `$${(v / 1e3).toFixed(0)}k`;

// Small icon shim mapping callout `kind` → icon + label + tone.
const CALLOUT_META = {
  ltcg: { icon: Layers, label: "LTCG bump zone" },
  irmaa: { icon: Shield, label: "IRMAA tier change" },
  ss: { icon: AlertTriangle, label: "SS taxability step" },
};
const toneClass = (sev) => (
  sev === "warn" ? "text-[#B84A4A] bg-[#FBECEC] border-[#E5B7B7]" :
  sev === "info" ? "text-[#C87941] bg-[#FBF3EC] border-[#E5CBB2]" :
                   "text-[#4A6741] bg-[#F1F5EF] border-[#C7D6C0]"
);

// Value formatters used per-row in the horizontal grid.
// Money now scales via `scale` prop from GridControls (full / thousands / millions).
const money = (v, scale = "full") => (v == null || (typeof v === "number" && Math.abs(v) < 0.5) ? "—" : scaleMoney(v, scale));
const pct = (v) => (v == null ? "—" : fmtPct(v));

export const TaxDetail = ({ scenario }) => {
  const [data, setData] = useState(null);
  const [hideChildYears, setHideChildYears] = useState(true);
  // Grid readability controls — persisted per-advisor via localStorage.
  const { density, setDensity, scale, setScale, focus, setFocus } = useGridPrefs();
  const dc = densityClasses(density);

  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      runProjection(scenario).then((d) => alive && setData(d));
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const rows = data?.rows || [];

  // Retirement-year filter — pre-retirement years typically have zero pref
  // income and no interesting tax events; hiding them keeps the table dense.
  const firstInterestingYear = useMemo(() => {
    if (!rows.length) return null;
    const r = rows.find((row) => (row.rmd > 0) || (row.gross_ss > 0));
    return r?.year ?? rows[rows.length - 1].year + 1;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!rows.length) return [];
    // Two-layer filter: legacy "hide pre-retirement" toggle first, then
    // milestone-based Focus range if user picked one.
    let out = rows;
    if (hideChildYears && firstInterestingYear != null) {
      out = out.filter((r) => r.year >= firstInterestingYear);
    }
    const ms = detectMilestones(rows, scenario);
    const range = focusRangeYears(focus, ms);
    if (range) {
      out = out.filter((r) => r.year >= range[0] && r.year <= range[1]);
    }
    return out;
  }, [rows, hideChildYears, firstInterestingYear, focus, scenario]);

  // Chart data (uses ALL visible rows so users see the full curve regardless of table filter).
  const chartData = useMemo(() =>
    visibleRows.map((r) => ({
      year: r.year,
      Federal: (r.tax_breakdown?.ordinary || 0),
      Preferential: (r.tax_breakdown?.preferential || 0),
      NIIT: (r.tax_breakdown?.niit || 0),
      State: (r.tax_breakdown?.state || 0),
      IRMAA: (r.tax_breakdown?.medicare || 0),
      "Taxable Income": r.taxable_income,
      "Marginal %": (r.marginal_rate || 0) * 100,
    })), [visibleRows]);

  // Precompute callouts per row so we don't recompute during table render.
  const callouts = useMemo(() => {
    const out = {};
    for (let i = 0; i < rows.length; i++) {
      const prev = i > 0 ? rows[i - 1] : null;
      out[rows[i].year] = collectCallouts(rows[i], prev);
    }
    return out;
  }, [rows]);

  const anyCalloutYear = (yr) => (callouts[yr]?.length || 0) > 0;

  // -------- Horizontal grid: rows = line items, columns = years --------
  // Each row spec pulls a value out of a projection row and formats it.
  // fmt: "money" | "pct" | "raw"; strong: bold display; muted: dimmer text.
  const LINE_SPECS = useMemo(() => ([
    { section: "taxable", label: "Ordinary taxable", fmt: "money",
      get: (r) => r.ordinary_taxable_income },
    { section: "taxable", label: "Preferential taxable", fmt: "money",
      get: (r) => r.tax_detail?.preferential_taxable || 0,
      chip: (r) => dominantBandChip(r) },
    { section: "taxable", label: "Taxable Social Security", fmt: "money", muted: true,
      get: (r) => r.tax_detail?.taxable_ss || 0,
      hideIfAllZero: true },
    // QCD (Qualified Charitable Distribution) — reduces AGI dollar-for-dollar and
    // counts toward the current-year RMD. Only shown when the household actually
    // has QCD activity (hideIfAllZero) so the table stays dense for non-charitable
    // scenarios.
    { section: "taxable", label: "QCD (from RMD)", fmt: "money", muted: true,
      get: (r) => -(r.cashflow?.qcd || 0),
      hideIfAllZero: true },
    { section: "taxable", label: "MAGI", fmt: "money", muted: true,
      get: (r) => r.magi || 0 },
    // Explicit taxable-income build so advisors can see the 1040-style step:
    //   MAGI (approx AGI + tax-exempt interest)  −  Standard deduction  =  Taxable income
    // Getter returns the negated value so BOTH the on-screen grid AND the CSV/XLSX
    // export stay consistent (the export path stringifies the getter's raw output).
    { section: "taxable", label: "Standard deduction", fmt: "money", muted: true,
      get: (r) => -(r.tax_detail?.standard_deduction || 0) },
    { section: "taxable", label: "Taxable income", fmt: "money", strong: true,
      get: (r) => r.taxable_income || 0 },

    { section: "federal", label: "Federal ordinary tax", fmt: "money",
      get: (r) => r.tax_breakdown?.ordinary || 0 },
    { section: "federal", label: "Federal preferential tax", fmt: "money",
      get: (r) => r.tax_breakdown?.preferential || 0 },
    { section: "federal", label: "NIIT (3.8%)", fmt: "money", muted: true,
      get: (r) => r.tax_breakdown?.niit || 0,
      hideIfAllZero: true },

    { section: "state", label: "State tax", fmt: "money", strong: true,
      get: (r) => r.tax_breakdown?.state || 0,
      chip: (r) => {
        const sd = r.tax_detail?.state_detail;
        if (!sd || !sd.state_code) return null;
        return {
          label: sd.state_code,
          tone: "bg-[#F1F5EF] text-[#4A6741] border-[#C7D6C0]",
          title: `${sd.state_type} · marginal ${((sd.state_marginal_rate || 0) * 100).toFixed(2)}%`,
        };
      } },
    { section: "state", label: "  Excluded: SS", fmt: "money", muted: true,
      get: (r) => -(r.tax_detail?.state_detail?.state_ss_excluded || 0),
      hideIfAllZero: true },
    { section: "state", label: "  Excluded: pension", fmt: "money", muted: true,
      get: (r) => -(r.tax_detail?.state_detail?.state_pension_excluded || 0),
      hideIfAllZero: true },
    { section: "state", label: "  Excluded: IRA distributions", fmt: "money", muted: true,
      get: (r) => -(r.tax_detail?.state_detail?.state_ira_excluded || 0),
      hideIfAllZero: true },
    { section: "state", label: "  Retirement exclusion cap", fmt: "money", muted: true,
      get: (r) => -(r.tax_detail?.state_detail?.state_ret_exclusion_used || 0),
      hideIfAllZero: true },
    { section: "state", label: "  State taxable income", fmt: "money", muted: true,
      get: (r) => r.tax_detail?.state_detail?.state_taxable_income || 0,
      hideIfAllZero: true },
    { section: "state", label: "Medicare + IRMAA", fmt: "money",
      get: (r) => r.tax_breakdown?.medicare || 0 },
    { section: "state", label: "IRMAA tier", fmt: "raw", muted: true,
      get: (r) => r.irmaa_tier != null ? `${r.irmaa_tier} / 5` : "—" },

    { section: "rates", label: "Marginal rate", fmt: "pct",
      get: (r) => r.marginal_rate },
    { section: "rates", label: "Effective rate", fmt: "pct",
      get: (r) => r.effective_rate },
  ]), []);

  // Filter out rows that have zero across all years (keeps grid dense).
  const displayLines = useMemo(() => {
    return LINE_SPECS.filter((spec) => {
      if (!spec.hideIfAllZero) return true;
      return visibleRows.some((r) => Math.abs(spec.get(r) || 0) > 0.5);
    });
  }, [LINE_SPECS, visibleRows]);

  const downloadData = (fmt) => {
    // Pivot horizontally: one row per line item, one column per year.
    // Matches the on-screen layout so exported files feel identical.
    const yrs = visibleRows.map((r) => r.year);
    const sheet = [];

    // Section-labelled line items
    const SECTION_LABEL = {
      taxable: "Taxable income", federal: "Federal tax",
      state: "State & Medicare", rates: "Rates",
    };
    displayLines.forEach((spec) => {
      const rec = { Section: SECTION_LABEL[spec.section], "Line item": spec.label };
      visibleRows.forEach((r, i) => {
        const v = spec.get(r);
        rec[String(yrs[i])] = formatForExport(v, spec.fmt);
      });
      sheet.push(rec);
    });

    // Subtotal row: total tax + medicare per year (matches the on-screen bold row).
    const totalRec = { Section: "TOTAL", "Line item": "Total tax + Medicare" };
    visibleRows.forEach((r, i) => { totalRec[String(yrs[i])] = r.total_tax; });
    sheet.push(totalRec);

    // Callouts row: comma-separated labels per year.
    const clRec = { Section: "Callouts", "Line item": "IRMAA / LTCG / SS flags" };
    visibleRows.forEach((r, i) => {
      const cs = callouts[r.year] || [];
      clRec[String(yrs[i])] = cs.map((c) => c.label).join("; ") || "";
    });
    sheet.push(clRec);

    if (fmt === "xlsx") {
      downloadWorkbook([{ name: "Tax Detail", rows: sheet }], "tax-detail.xlsx");
    } else {
      downloadCSV(sheet, "tax-detail.csv");
    }
  };

  if (!data) return (
    <div className="py-20 text-center text-muted-foreground animate-pulse label-cap">
      Building tax timeline…
    </div>
  );

  const years = visibleRows.map((r) => r.year);
  const totalTaxByYear = visibleRows.map((r) => r.total_tax || 0);

  return (
    <div className="space-y-6" data-testid="tax-detail-tab">
      {/* Header */}
      <Card className="p-6 border-[#EBE8E0] shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-2">
              <Receipt className="h-5 w-5 text-[#4A6741]" />
              <h2 className="font-display text-xl font-bold tracking-tight">Tax Timeline</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every year of the plan, side-by-side: taxable income, federal + state tax paid, and the three big
              structural callouts an advisor watches for &mdash; <span className="font-medium">IRMAA cliffs</span> (Medicare surcharges),
              <span className="font-medium"> Capital-gains band bumps</span> (0→15% and 15→20% LTCG cliffs) and the
              <span className="font-medium"> Social Security torpedo</span> (0→50%→85% taxability jumps).
              Numbers come directly from the same tax engine feeding the rest of the app &mdash; this is exposure of intermediates,
              not a separate model.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <GridControls density={density} setDensity={setDensity}
                          scale={scale} setScale={setScale}
                          focus={focus} setFocus={setFocus}
                          testidPrefix="tax-detail" />
            <Button size="sm" variant="outline" onClick={() => setHideChildYears((v) => !v)}
                    data-testid="tax-detail-toggle-retirement"
                    className="border-[#4A6741] text-[#4A6741]">
              {hideChildYears ? "Show all years" : "Hide pre-retirement"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadData("xlsx")}
                    data-testid="tax-detail-download-xlsx"
                    className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadData("csv")}
                    data-testid="tax-detail-download-csv"
                    className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
              <FileDown className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>
      </Card>

      {/* Timeline chart */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="tax-detail-chart">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">
            Tax cost per year, by source
          </h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Stacked bar = federal ordinary + federal preferential + NIIT + state + Medicare/IRMAA. Line overlay = taxable income
          in the year. Dots on the top strip mark years with an IRMAA / LTCG / SS callout &mdash; find them fast in the grid below.
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 30, right: 12, bottom: 8, left: 8 }}>
            <CartesianGrid strokeOpacity={0.1} vertical={false} />
            <XAxis dataKey="year" tick={AXIS} />
            <YAxis yAxisId="left" tickFormatter={kAxis} tick={AXIS} width={60} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={kAxis} tick={AXIS} width={60} />
            <Tooltip formatter={(v, n) => (typeof v === "number" && n !== "Marginal %"
              ? fmtUSD(v)
              : typeof v === "number" ? `${v.toFixed(1)}%` : v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="Federal" stackId="tax" fill={C.green} />
            <Bar yAxisId="left" dataKey="Preferential" stackId="tax" fill={C.sage} />
            <Bar yAxisId="left" dataKey="NIIT" stackId="tax" fill={C.plum} />
            <Bar yAxisId="left" dataKey="State" stackId="tax" fill={C.sand} />
            <Bar yAxisId="left" dataKey="IRMAA" stackId="tax" fill={C.terra} />
            <Line yAxisId="right" type="monotone" dataKey="Taxable Income" stroke={C.blue}
                  strokeWidth={2} dot={false} />
            <Scatter yAxisId="left" data={chartData.filter((d) => anyCalloutYear(d.year))
                .map((d) => ({ year: d.year, marker: chartData.reduce((m, x) => Math.max(m, x.Federal + x.Preferential + x.NIIT + x.State + x.IRMAA), 0) * 1.08 }))}
              dataKey="marker" fill={C.clay} shape="triangle" />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Horizontal spreadsheet-style grid — years across, line items down */}
      <Card className="p-0 border-[#EBE8E0] shadow-none overflow-hidden" data-testid="tax-detail-table-card">
        <div className="px-6 pt-6 pb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Year-by-year detail</h3>
          <span className="text-[10px] label-cap text-muted-foreground ml-auto">
            {years.length} year{years.length === 1 ? "" : "s"} · scroll horizontally for later years
          </span>
        </div>
        <div className="overflow-auto max-h-[720px]" data-testid="tax-detail-table-scroll">
          <table className={`w-full ${dc.textSize}`} data-testid="tax-detail-table">
            <thead className="sticky top-0 z-20 bg-[#F9F8F6] shadow-[0_1px_0_rgba(0,0,0,0.06)]">
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className={`${dc.headCell} font-medium text-left sticky left-0 bg-[#F9F8F6] z-10 ${dc.firstColWidth}`}>
                  Line item
                </th>
                {years.map((y) => (
                  <th key={y} className={`${dc.headCell} font-medium text-right tabular-nums ${dc.colWidth}`}
                      data-testid={`tax-col-year-${y}`}>
                    <div>{y}</div>
                    <div className="text-[9px] font-normal text-muted-foreground/70 normal-case tracking-normal">
                      {ageForYear(visibleRows, y)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* TAXABLE INCOME section */}
              <SectionHeaderRow label="TAXABLE INCOME BUILD" color={C.green} colspan={years.length + 1}
                                testid="section-taxable" />
              {displayLines.filter((s) => s.section === "taxable").map((spec) => (
                <LineRow key={spec.label} spec={spec} rows={visibleRows} dc={dc} scale={scale} />
              ))}

              {/* FEDERAL TAX section */}
              <SectionHeaderRow label="FEDERAL TAX" color={C.sage} colspan={years.length + 1}
                                testid="section-federal" />
              {displayLines.filter((s) => s.section === "federal").map((spec) => (
                <LineRow key={spec.label} spec={spec} rows={visibleRows} dc={dc} scale={scale} />
              ))}

              {/* STATE & MEDICARE section */}
              <SectionHeaderRow label="STATE & MEDICARE" color={C.terra} colspan={years.length + 1}
                                testid="section-state" />
              {displayLines.filter((s) => s.section === "state").map((spec) => (
                <LineRow key={spec.label} spec={spec} rows={visibleRows} dc={dc} scale={scale} />
              ))}

              {/* Bold reconciliation row: Total tax + Medicare */}
              <tr className="bg-[#F1EFE7]" data-testid="row-total-tax">
                <td className={`${dc.cell} font-display font-bold ${density === "roomy" ? "text-base" : "text-sm"} sticky left-0 bg-[#F1EFE7] z-10`}>
                  Total tax + Medicare
                </td>
                {totalTaxByYear.map((v, i) => (
                  <td key={i} className={`${dc.cell} text-right tabular-nums font-bold text-[#1A1A1A]`}>
                    {money(v, scale)}
                  </td>
                ))}
              </tr>

              {/* RATES section */}
              <SectionHeaderRow label="RATES" color={C.plum} colspan={years.length + 1}
                                testid="section-rates" />
              {displayLines.filter((s) => s.section === "rates").map((spec) => (
                <LineRow key={spec.label} spec={spec} rows={visibleRows} dc={dc} scale={scale} />
              ))}

              {/* CALLOUTS row — one row across all years with chips per year */}
              <SectionHeaderRow label="CALLOUTS — IRMAA / LTCG / SS" color={C.clay} colspan={years.length + 1}
                                testid="section-callouts" />
              <tr className="border-t border-[#EBE8E0]/50" data-testid="row-callouts">
                <td className={`${dc.cell} pl-8 sticky left-0 bg-white z-10 ${dc.firstColWidth} text-muted-foreground text-[11px]`}>
                  Structural tax events this year
                </td>
                {visibleRows.map((r) => (
                  <td key={r.year} className={`${dc.cell} align-top`} data-testid={`callouts-${r.year}`}>
                    <div className="flex flex-wrap gap-1 justify-center">
                      {(callouts[r.year] || []).length === 0 && (
                        <span className="text-muted-foreground/40 text-[10px]">—</span>
                      )}
                      {(callouts[r.year] || []).map((c, i) => (
                        <CalloutDot key={i} callout={c} testid={`callout-${r.year}-${c.kind}`} />
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground px-6 py-3 border-t border-[#EBE8E0] leading-relaxed flex items-start gap-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[#4A6741]" />
          Read left-to-right: each column is one year of the plan. Sections roll up to the bold
          <span className="font-medium mx-1">Total tax + Medicare</span>row.
          Callout dots at the bottom flag structural tax events &mdash; hover a dot for the full explainer.
        </p>
      </Card>

      {/* Explainer rail */}
      <div className="grid md:grid-cols-3 gap-4" data-testid="tax-detail-explainers">
        <Explainer icon={Shield} tone="warn" title="IRMAA cliffs"
          body="Once household MAGI clears an IRMAA threshold (2-year lookback), Medicare Part B + Part D premiums are surcharged for the entire following year. Tier 5 more than triples the base Part B premium. Any conversion that crosses a tier line pays that surcharge on top of ordinary + LTCG tax." />
        <Explainer icon={Layers} tone="info" title="Capital-gains bump zone"
          body="Preferential income (qualified dividends + LTCG) stacks on top of ordinary taxable income at 0/15/20% bands. A Roth conversion that lifts ordinary income can silently push pref dollars from 0→15% or 15→20% &mdash; adding 5–15 percentage points to the effective marginal rate on the conversion." />
        <Explainer icon={AlertTriangle} tone="warn" title="Social Security torpedo"
          body="Provisional income (½ gross SS + ordinary + non-taxable interest + pref) determines whether 0%, up to 50%, or up to 85% of Social Security is federally taxable. When the household crosses a threshold, each extra dollar of income drags 50¢–85¢ of SS into taxability alongside it &mdash; a 40–46% shadow marginal rate." />
      </div>
    </div>
  );
};

// -------------------- Helpers --------------------

const ageForYear = (rows, year) => {
  const r = rows.find((x) => x.year === year);
  if (!r) return "";
  const a = r.client_age;
  const b = r.spouse_age;
  if (a == null && b == null) return "";
  if (b != null) return `${a ?? "—"} / ${b}`;
  return `${a ?? "—"}`;
};

// Dominant LTCG band chip appended to the "Preferential taxable" row.
const dominantBandChip = (r) => {
  const td = r.tax_detail || {};
  const band = td.ltcg_band_split || { in_0: 0, in_15: 0, in_20: 0 };
  const dominantBand = band.in_20 > band.in_15 && band.in_20 > band.in_0 ? "20%"
    : band.in_15 >= band.in_0 && band.in_15 > 0 ? "15%"
    : (td.preferential_taxable || 0) > 0 ? "0%" : null;
  if (!dominantBand) return null;
  const tone = dominantBand === "20%" ? "bg-[#FBECEC] text-[#B84A4A] border-[#E5B7B7]"
    : dominantBand === "15%" ? "bg-[#FBF3EC] text-[#C87941] border-[#E5CBB2]"
    : "bg-[#F1F5EF] text-[#4A6741] border-[#C7D6C0]";
  return { label: dominantBand, tone };
};

const formatForExport = (v, fmt) => {
  if (v == null) return "";
  if (fmt === "pct") return typeof v === "number" ? (v * 100).toFixed(2) + "%" : v;
  if (fmt === "raw") return v;
  return typeof v === "number" ? v : v;
};

// -------------------- Line row + section header + callout dot --------------------

const LineRow = ({ spec, rows, dc, scale }) => {
  const values = rows.map((r) => spec.get(r));
  const chips = spec.chip ? rows.map((r) => spec.chip(r)) : null;
  const isMuted = !!spec.muted;

  return (
    <tr className="hover:bg-[#F9F8F6] border-t border-[#EBE8E0]/50"
        data-testid={`tax-line-${slug(spec.label)}`}>
      <td className={`${dc.cell} pl-8 sticky left-0 bg-white z-10 ${dc.firstColWidth} ${isMuted ? "text-muted-foreground" : ""}`}>
        {spec.label}
      </td>
      {values.map((v, i) => {
        const zero = v == null || (typeof v === "number" && Math.abs(v) < 0.5);
        const chip = chips ? chips[i] : null;
        return (
          <td key={i}
              className={`${dc.cell} text-right tabular-nums ${zero ? "text-muted-foreground/40" : (isMuted ? "text-muted-foreground" : "")}`}
              title={typeof v === "number" && !zero && spec.fmt !== "pct" ? fmtUSD(v) : undefined}>
            <div className="inline-flex items-center gap-1 justify-end">
              <span>
                {spec.fmt === "pct" ? pct(v) : spec.fmt === "raw" ? (v ?? "—") : money(v, scale)}
              </span>
              {chip && !zero && (
                <span className={`inline-flex items-center rounded-full border px-1 py-[1px] text-[9px] font-medium ${chip.tone}`}
                      title={chip.title || "Dominant LTCG band this year"}>
                  {chip.label}
                </span>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
};

const SectionHeaderRow = ({ label, color, colspan, testid }) => (
  <tr className="border-t-4 border-[#EBE8E0]" data-testid={testid}>
    <td colSpan={colspan} className="sticky left-0 bg-white z-10">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="inline-block h-3 w-1 rounded-sm" style={{ backgroundColor: color }} />
        <span className="label-cap text-[10px] font-bold" style={{ color }}>{label}</span>
      </div>
    </td>
  </tr>
);

// Compact callout indicator sized to fit inside a year column. Full text moves
// into the tooltip so column widths stay tight.
const CalloutDot = ({ callout, testid }) => {
  const meta = CALLOUT_META[callout.kind] || CALLOUT_META.irmaa;
  const Icon = meta.icon;
  const tone = toneClass(callout.severity);
  return (
    <TooltipProvider delayDuration={100}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center justify-center rounded-full border h-5 w-5 ${tone}`}
                data-testid={testid}
                aria-label={callout.label}
                title={callout.label}>
            <Icon className="h-2.5 w-2.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px] text-xs">
          <CalloutTooltipBody callout={callout} />
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
};

const CalloutTooltipBody = ({ callout }) => {
  if (callout.kind === "ltcg") {
    const d = callout.detail || {};
    return (
      <div className="space-y-1">
        <p className="font-semibold">Capital-gains band change</p>
        <p>Preferential $ this year: {fmtUSD((d.in_0 || 0) + (d.in_15 || 0) + (d.in_20 || 0))}</p>
        <p className="text-muted-foreground">
          0% ceiling: {fmtUSD(d.ceiling_0)} &middot; 15% ceiling: {fmtUSD(d.ceiling_15)}
        </p>
        <p>In 0% band: <span className="font-medium">{fmtUSD(d.in_0)}</span></p>
        <p>In 15% band: <span className="font-medium">{fmtUSD(d.in_15)}</span></p>
        <p>In 20% band: <span className="font-medium">{fmtUSD(d.in_20)}</span></p>
      </div>
    );
  }
  if (callout.kind === "irmaa") {
    return (
      <div className="space-y-1">
        <p className="font-semibold">Medicare IRMAA tier {callout.tier}</p>
        <p className="text-muted-foreground">
          {callout.from == null
            ? "First year at this tier — Part B + Part D premiums are surcharged based on MAGI from 2 years prior."
            : callout.from < callout.tier
              ? `Tier climbed from ${callout.from} to ${callout.tier}. Higher tier = higher Medicare premiums next year.`
              : `Tier dropped from ${callout.from} to ${callout.tier}. Lower premiums next year.`}
        </p>
      </div>
    );
  }
  if (callout.kind === "ss") {
    return (
      <div className="space-y-1">
        <p className="font-semibold">Social Security taxability step</p>
        <p>{callout.from == null
          ? `${callout.to}% of SS is federally taxable (first year).`
          : `${callout.from}% → ${callout.to}% of SS taxable this year.`}</p>
        <p className="text-muted-foreground">
          Exact inclusion: {callout.pct?.toFixed(1)}%. Each extra $ of ordinary income drags additional SS into taxability &mdash; a hidden marginal-rate multiplier.
        </p>
      </div>
    );
  }
  return null;
};

const Explainer = ({ icon: Icon, title, body, tone }) => (
  <Card className={`p-4 border shadow-none ${toneClass(tone)}`}>
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[11px] leading-relaxed mt-1 opacity-90">{body}</p>
      </div>
    </div>
  </Card>
);

// Stable data-testid slug from a human-readable label.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
