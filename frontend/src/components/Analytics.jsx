import { useEffect, useMemo, useState } from "react";
import { Printer, FileSpreadsheet, FileDown, Lightbulb, ScrollText, Package, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { runProjection, fmtUSD, pvSeries, buildPvSheets, downloadWorkbook, downloadCSV } from "@/lib/api";
import { exportChartsToWord, exportChartsToExcel } from "@/lib/chartExport";
import {
  IncomeSourcesChart, BracketFillChart, SurplusChart, TaxCompositionChart,
  RmdBalanceChart, IrmaaChart, RateTrendChart, CumulativeTaxChart, HeirLegacyCompareChart,
  PvNetWorthChart, RothConversionsChart, PvNetToFamilyChart,
  AccountValuesStackedBarChart,
} from "@/components/AnalyticsCharts";
import { ConceptsPrint } from "@/components/ConceptsPrint";
import { WhitePaper } from "@/components/WhitePaper";
import { StrategyBadge } from "@/components/StrategyBadge";
import { MarketBadge } from "@/components/MarketScenarioSelector";

const BRACKET_LABELS = ["10%", "12%", "22%", "24%", "32%", "35%", "37%"];

export const Analytics = ({ scenario }) => {
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);

  // "Add Concepts to PDF": the print pages are pre-rendered off-screen; toggle the
  // body class that reveals them in the print flow, then print.
  const printWithConcepts = () => {
    document.body.classList.add("print-concepts");
    const cleanup = () => { document.body.classList.remove("print-concepts"); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(cleanup, 1000);
  };

  // "Add White Paper to PDF": reveal the off-flow white-paper appendix during print only.
  const printWithWhitePaper = () => {
    document.body.classList.add("print-whitepaper");
    const cleanup = () => { document.body.classList.remove("print-whitepaper"); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(cleanup, 1000);
  };

  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const tasks = [runProjection(scenario)];
      if (scenario.roth?.enabled) {
        const noCfg = JSON.parse(JSON.stringify(scenario));
        noCfg.roth.enabled = false;
        tasks.push(runProjection(noCfg));
      }
      Promise.all(tasks).then(([a, b]) => {
        if (alive) { setWithRoth(a); setNoRoth(b || a); }
      });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Display-layer only: de-minimis end-of-plan RMDs (< $100) render as $0 so no
  // stray "$1" rounding artifact appears in the RMD chart. No calculation change.
  const rows = useMemo(() => (withRoth?.rows || []).map((r) => {
    if (r.rmd == null || r.rmd >= 100) return r;
    const next = { ...r, rmd: 0 };
    if (r.cashflow) next.cashflow = { ...r.cashflow, rmd: 0 };
    return next;
  }), [withRoth]);

  const incomeData = useMemo(() => rows.map((r) => {
    const cf = r.cashflow || {};
    return {
      year: r.year,
      Wages: cf.wages_pension || 0,
      SocialSecurity: cf.gross_ss || 0,
      Dividends: cf.dividends || 0,
      Interest: cf.interest || 0,
      RMD: cf.rmd || 0,
      // Roth conversions are intentionally EXCLUDED — they're internal
      // transfers between accounts (Traditional → Roth), not new dollars
      // arriving in the household. The tax paid on the conversion is real
      // and still shows up in the `Need` line via `income_tax`.
      Withdrawals: (cf.from_cash || 0) + (cf.from_taxable || 0) + (cf.from_ira || 0) + (cf.from_roth || 0),
      Need: (cf.expenses || 0) + (cf.income_tax || 0) + (cf.medicare || 0),
    };
  }), [rows]);

  const bracketData = useMemo(() => rows.map((r) => {
    const o = { year: r.year, marginal: r.marginal_rate };
    (r.bracket_fill || []).forEach((b) => { o[`${Math.round(b.rate * 100)}%`] = b.amount; });
    return o;
  }), [rows]);

  const surplusData = useMemo(() => rows.map((r) => ({ year: r.year, surplus: r.cashflow?.surplus || 0 })), [rows]);
  const taxCompData = useMemo(() => rows.map((r) => ({ year: r.year, ...(r.tax_breakdown || {}) })), [rows]);
  const rmdData = useMemo(() => rows.map((r) => ({ year: r.year, rmd: r.rmd, traditional: r.traditional, roth: r.roth })), [rows]);
  const irmaaData = useMemo(() => rows.map((r) => {
    const t = r.irmaa_thresholds || [];
    return { year: r.year, magi: r.magi, t0: t[0], t1: t[1], t2: t[2], t3: t[3], t4: t[4] };
  }), [rows]);
  const rateData = useMemo(() => rows.map((r) => ({ year: r.year, effective: r.effective_rate, marginal: r.marginal_rate })), [rows]);
  // Stacked-bar snapshot of portfolio composition — Cash + Taxable + Traditional + Roth per year.
  const accountValuesData = useMemo(() => rows.map((r) => ({
    year: r.year, Cash: r.cash, Taxable: r.taxable, Traditional: r.traditional, Roth: r.roth,
  })), [rows]);
  const cumData = useMemo(() => {
    let cy = 0, cn = 0;
    // Lifetime rows: sum total_tax per year for both plans.
    const lifetime = rows.map((r, i) => {
      cy += r.total_tax || 0;
      cn += noRoth?.rows?.[i]?.total_tax || 0;
      return { year: r.year, cumYes: Math.round(cy), cumNo: Math.round(cn), heir: false };
    });
    // 10-year SECURE heir horizon: only inherited-IRA RMDs are taxed at the
    // heirs' rate; the Roth pays $0. Extend both cumulative curves by adding
    // `ira_tax_paid` per post-death year. Note: withRoth typically has a much
    // smaller inherited IRA left (conversions drained it) so the gap between
    // curves usually WIDENS in this segment — a key insight for advisors.
    const lastYear = rows.length ? rows[rows.length - 1].year : 0;
    const postWith = withRoth?.legacy?.post_death_rows || [];
    const postNo = noRoth?.legacy?.post_death_rows || [];
    const horizon = Math.max(postWith.length, postNo.length);
    const heir = [];
    for (let i = 0; i < horizon; i++) {
      cy += postWith[i]?.ira_tax_paid || 0;
      cn += postNo[i]?.ira_tax_paid || 0;
      heir.push({
        year: lastYear + (postWith[i]?.year_after_death ?? postNo[i]?.year_after_death ?? (i + 1)),
        cumYes: Math.round(cy),
        cumNo: Math.round(cn),
        heir: true,
      });
    }
    return [...lifetime, ...heir];
  }, [rows, noRoth, withRoth]);
  // Anchor year for the "second death" reference line on the CumulativeTaxChart.
  const lastLifetimeYear = useMemo(() => (rows.length ? rows[rows.length - 1].year : null), [rows]);

  const pv = useMemo(() => pvSeries(withRoth, noRoth, scenario), [withRoth, noRoth, scenario]);

  const downloadData = (fmt) => {
    const { yearly, summary } = buildPvSheets(pv.series, pv.ntf);
    if (fmt === "xlsx") {
      downloadWorkbook([
        { name: "PV Net Worth & Conversions", rows: yearly },
        { name: "Net to Family (PV)", rows: summary },
      ], "retirement-pv-results.xlsx");
    } else {
      downloadCSV(yearly, "retirement-pv-results.csv");
    }
  };

  // ---- Export ALL analytics charts as one bundle ---------------------------
  // We build a canonical registry that mirrors what the <analytics-grid> renders:
  // each entry pairs a human title with (a) the underlying data rows and (b) a
  // css selector for the on-screen Card so we can rasterize the SAME view the
  // reader is looking at. The registry keys off `data-chart-panel` attributes
  // that <Panel> stamps on each Card at render time.
  const buildExportRegistry = () => {
    const bySlug = (slug) => document.querySelector(`[data-chart-panel="${slug}"]`);
    return [
      { title: "Present Value of Net Worth",
        slug: "pv-net-worth",
        data: pv.series.map((r) => ({ year: r.year, pv_with_conversions: r.pvWith, pv_no_conversions: r.pvNo })) },
      { title: "Roth Conversion Schedule",
        slug: "roth-conversion-schedule",
        data: pv.series.map((r) => ({ year: r.year, conversion: r.conversion || 0 })) },
      { title: "Account Values by Year",
        slug: "account-values-by-year",
        data: accountValuesData },
      { title: "Sources of Income",
        slug: "sources-of-income",
        data: incomeData },
      { title: "Tax Bracket Fill",
        slug: "tax-bracket-fill",
        data: bracketData },
      { title: "Annual Surplus",
        slug: "annual-surplus",
        data: surplusData },
      { title: "Tax Composition",
        slug: "tax-composition",
        data: taxCompData },
      { title: "RMD vs Balances",
        slug: "rmd-vs-balances",
        data: rmdData },
      { title: "IRMAA Cliff",
        slug: "irmaa-cliff",
        data: irmaaData },
      { title: "Effective vs Marginal Rate",
        slug: "effective-vs-marginal-rate",
        data: rateData },
      { title: "Cumulative Lifetime Taxes",
        slug: "cumulative-lifetime-taxes",
        data: cumData },
      { title: "Heir Legacy Comparison (Nominal)",
        slug: "heir-legacy-comparison-nominal",
        data: [
          { plan: "With Conversions", after_tax_to_heirs: withRoth?.legacy?.after_tax_estate_to_heirs || 0,
            tax_free_roth: withRoth?.legacy?.tax_free_roth_to_heirs || 0,
            inherited_ira_tax: withRoth?.legacy?.inherited_ira_tax || 0 },
          { plan: "No Conversions", after_tax_to_heirs: noRoth?.legacy?.after_tax_estate_to_heirs || 0,
            tax_free_roth: noRoth?.legacy?.tax_free_roth_to_heirs || 0,
            inherited_ira_tax: noRoth?.legacy?.inherited_ira_tax || 0 },
        ] },
      { title: "Net to Family (Present Value)",
        slug: "net-to-family-pv",
        data: [
          { plan: "With Conversions", pv_total: pv.ntf.pvWith, pv_roth: pv.ntf.pvRothWith },
          { plan: "No Conversions",   pv_total: pv.ntf.pvNo,   pv_roth: pv.ntf.pvRothNo },
        ] },
    ].map((c) => ({ ...c, node: bySlug(c.slug) })).filter((c) => c.node || (c.data && c.data.length));
  };

  const [exportAllBusy, setExportAllBusy] = useState(false);
  const runExportAll = async (fmt, includeChart, includeData) => {
    if (exportAllBusy) return;
    setExportAllBusy(true);
    try {
      const registry = buildExportRegistry();
      const items = registry.map((c) => ({
        title: c.title, node: c.node, data: c.data,
        includeChart, includeData,
      }));
      const stamp = new Date().toISOString().slice(0, 10);
      const stem = `analytics-charts-${stamp}`;
      if (fmt === "docx") {
        await exportChartsToWord(items, `${stem}.docx`, { docTitle: "Retirement Analytics — All Charts" });
      } else {
        await exportChartsToExcel(items, `${stem}.xlsx`);
      }
      toast.success(`Exported ${items.length} chart${items.length === 1 ? "" : "s"}.`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("export-all error", err);
      toast.error(`Export failed: ${err?.message || "unknown error"}`);
    } finally {
      setExportAllBusy(false);
    }
  };

  if (!withRoth) {
    return <div className="py-20 text-center text-muted-foreground animate-pulse label-cap">Running analytics…</div>;
  }

  const h = scenario.household || {};
  const household = h.spouse_name ? `${h.client_name} & ${h.spouse_name}` : (h.client_name || "Household");
  const s = withRoth.summary || {};
  const sn = noRoth?.summary || {};
  const lg = withRoth.legacy || {};
  const lgn = noRoth?.legacy || {};
  const coverMetrics = [
    { label: "Lifetime Taxes", withV: s.lifetime_taxes, noV: sn.lifetime_taxes },
    { label: "Ending Net Worth", withV: s.ending_net_worth, noV: sn.ending_net_worth },
    { label: "Total Converted to Roth", withV: s.total_roth_converted, noV: 0 },
    { label: "Ending Roth (tax-free)", withV: s.ending_roth, noV: sn.ending_roth },
    { label: "Inheritance to Heirs (2nd death +10)", withV: lg.after_tax_estate_to_heirs, noV: lgn.after_tax_estate_to_heirs },
    { label: "Heir Income Tax on Inherited IRA (+10)", withV: lg.inherited_ira_tax, noV: lgn.inherited_ira_tax },
  ];
  const heirInheritDelta = (lg.after_tax_estate_to_heirs || 0) - (lgn.after_tax_estate_to_heirs || 0);
  const heirTaxSaved = (lgn.inherited_ira_tax || 0) - (lg.inherited_ira_tax || 0);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      <div className="no-print grid grid-cols-1 md:grid-cols-2 gap-3">
        <StrategyBadge scenario={scenario} testid="analytics-strategy-badge" />
        <MarketBadge scenario={scenario} testid="analytics-market-badge" />
      </div>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EBE8E0] bg-[#F9F8F6] px-5 py-4" data-testid="presentation-toolbar">
        <div>
          <p className="font-display text-sm font-bold tracking-tight">Client-ready presentation</p>
          <p className="text-[11px] text-muted-foreground">Branded document · summary metrics + all analytics charts. Download the underlying data to reconcile against your source spreadsheet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" data-testid="export-all-menu-trigger"
                disabled={exportAllBusy}
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                <Package className="h-4 w-4" /> {exportAllBusy ? "Exporting…" : "Export all charts…"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1" data-testid="export-all-menu">
              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">Word (.docx)</div>
              <button type="button" onClick={() => runExportAll("docx", true, false)}
                      data-testid="export-all-word-charts"
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-[#1A1A1A] hover:bg-[#F1F5EF] text-left">
                <ImageIcon className="h-3 w-3" /> All charts (images only)
              </button>
              <button type="button" onClick={() => runExportAll("docx", false, true)}
                      data-testid="export-all-word-data"
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-[#1A1A1A] hover:bg-[#F1F5EF] text-left">
                <FileText className="h-3 w-3" /> All data tables only
              </button>
              <button type="button" onClick={() => runExportAll("docx", true, true)}
                      data-testid="export-all-word-both"
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-[#1A1A1A] hover:bg-[#F1F5EF] text-left">
                <FileText className="h-3 w-3" /> All charts + data
              </button>
              <div className="px-2 py-1 mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">Excel (.xlsx)</div>
              <button type="button" onClick={() => runExportAll("xlsx", true, false)}
                      data-testid="export-all-xlsx-charts"
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-[#1A1A1A] hover:bg-[#F1F5EF] text-left">
                <ImageIcon className="h-3 w-3" /> All charts (one per sheet)
              </button>
              <button type="button" onClick={() => runExportAll("xlsx", false, true)}
                      data-testid="export-all-xlsx-data"
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-[#1A1A1A] hover:bg-[#F1F5EF] text-left">
                <FileSpreadsheet className="h-3 w-3" /> All data (one sheet per chart)
              </button>
              <button type="button" onClick={() => runExportAll("xlsx", true, true)}
                      data-testid="export-all-xlsx-both"
                      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-[#1A1A1A] hover:bg-[#F1F5EF] text-left">
                <FileSpreadsheet className="h-3 w-3" /> All charts + data
              </button>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" onClick={() => downloadData("xlsx")} data-testid="download-xlsx"
            className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
            <FileSpreadsheet className="h-4 w-4" /> PV Data Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadData("csv")} data-testid="download-csv"
            className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
            <FileDown className="h-4 w-4" /> PV Data CSV
          </Button>
          <Button size="sm" onClick={() => window.print()} data-testid="export-presentation"
            className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
            <Printer className="h-4 w-4" /> Print / Export PDF
          </Button>
          <Button size="sm" onClick={printWithConcepts} data-testid="export-with-concepts"
            className="gap-2 bg-[#C87941] hover:bg-[#A8632F] text-white rounded-full">
            <Lightbulb className="h-4 w-4" /> Add Concepts to PDF
          </Button>
          <Button size="sm" onClick={printWithWhitePaper} data-testid="export-with-whitepaper"
            className="gap-2 bg-[#4B7A94] hover:bg-[#3C6478] text-white rounded-full">
            <ScrollText className="h-4 w-4" /> Add White Paper to PDF
          </Button>
        </div>
      </div>

      <div id="analytics-print">
        {/* Branded cover + summary — only visible when printing */}
        <div className="print-only print-cover" data-testid="print-cover">
          <div style={{ background: "#4A6741", color: "#fff", padding: "20px 24px", borderRadius: 8 }}>
            <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 22 }}>Roth Conversion & Retirement Plan</div>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>Strategy analytics & lifetime projection</div>
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 15 }}>Prepared for {household}</div>
            <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>Generated {today}</div>
            <div data-testid="print-obbba-badge" style={{ marginTop: 8, display: "inline-block", border: "1px solid #4A6741", borderRadius: 999, padding: "3px 10px", fontSize: 10, color: "#4A6741", fontWeight: 600 }}>
              Assumes current law — OBBBA 2025: permanent, inflation-indexed TCJA brackets
            </div>
          </div>
          <table style={{ width: "100%", marginTop: 22, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "#777", borderBottom: "2px solid #4A6741" }}>
                <th style={{ textAlign: "left", padding: "6px 4px", fontWeight: 600 }}>STRATEGY METRIC</th>
                <th style={{ textAlign: "right", padding: "6px 4px", fontWeight: 600 }}>WITH CONVERSIONS</th>
                <th style={{ textAlign: "right", padding: "6px 4px", fontWeight: 600 }}>NO CONVERSIONS</th>
              </tr>
            </thead>
            <tbody>
              {coverMetrics.map((m) => (
                <tr key={m.label} style={{ borderBottom: "1px solid #EBE8E0" }}>
                  <td style={{ textAlign: "left", padding: "8px 4px" }}>{m.label}</td>
                  <td style={{ textAlign: "right", padding: "8px 4px", fontWeight: 700, color: "#4A6741" }}>{fmtUSD(m.withV)}</td>
                  <td style={{ textAlign: "right", padding: "8px 4px", color: "#5A5A5A" }}>{fmtUSD(m.noV)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div data-testid="print-heir-callout" style={{ marginTop: 18, display: "flex", gap: 12 }}>
            <div style={{ flex: 1, border: "1px solid #4A6741", background: "#4A67410D", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, letterSpacing: 0.5, color: "#4A6741", fontWeight: 700, textTransform: "uppercase" }}>Extra Inheritance from Converting</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 22, fontWeight: 700, color: heirInheritDelta >= 0 ? "#4A6741" : "#C87941" }}>
                {heirInheritDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(heirInheritDelta))}
              </div>
              <div style={{ fontSize: 10, color: "#777", marginTop: 2 }}>more to heirs at 2nd death + {lg.horizon_years || 10} yrs</div>
            </div>
            <div style={{ flex: 1, border: "1px solid #C87941", background: "#C879410D", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, letterSpacing: 0.5, color: "#C87941", fontWeight: 700, textTransform: "uppercase" }}>Heir Income Tax Saved by Converting</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 22, fontWeight: 700, color: heirTaxSaved >= 0 ? "#4A6741" : "#C87941" }}>
                {heirTaxSaved >= 0 ? "−" : "+"}{fmtUSD(Math.abs(heirTaxSaved))}
              </div>
              <div style={{ fontSize: 10, color: "#777", marginTop: 2 }}>less tax on the inherited IRA over 10 yrs</div>
            </div>
          </div>
          <p style={{ fontSize: 10, color: "#999", marginTop: 16, fontStyle: "italic" }}>
            Educational model · LTCG/QDIV stacked at 0/15/20% · NIIT · IRMAA · brackets permanent &amp; inflation-indexed (OBBBA 2025). Verify against current IRS tables.
          </p>
        </div>

        {<ConceptsPrint scenario={scenario} withRoth={withRoth} />}

        <WhitePaper print />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 analytics-grid" data-testid="analytics-grid">
          <PvNetWorthChart data={pv.series}
            exportData={pv.series.map((r) => ({ year: r.year, pv_with_conversions: r.pvWith, pv_no_conversions: r.pvNo }))}
            exportFilename="pv-net-worth" />
          <RothConversionsChart data={pv.series} span={1}
            exportData={pv.series.map((r) => ({ year: r.year, conversion: r.conversion || 0 }))}
            exportFilename="roth-conversion-schedule" />
          <AccountValuesStackedBarChart data={accountValuesData} span={2}
            exportData={accountValuesData} exportFilename="account-values-by-year" />
          <IncomeSourcesChart data={incomeData} exportData={incomeData} exportFilename="sources-of-income" />
          <BracketFillChart data={bracketData} brackets={BRACKET_LABELS}
            exportData={bracketData} exportFilename="tax-bracket-fill" />
          <SurplusChart data={surplusData} exportData={surplusData} exportFilename="annual-surplus" />
          <TaxCompositionChart data={taxCompData} exportData={taxCompData} exportFilename="tax-composition" />
          <RmdBalanceChart data={rmdData} exportData={rmdData} exportFilename="rmd-vs-balances" />
          <IrmaaChart data={irmaaData} exportData={irmaaData} exportFilename="irmaa-cliff" />
          <RateTrendChart data={rateData} exportData={rateData} exportFilename="effective-vs-marginal-rate" />
          <CumulativeTaxChart data={cumData} deathYear={lastLifetimeYear}
            exportData={cumData} exportFilename="cumulative-lifetime-taxes" />
          {/* Net to Family at Second Death — Nominal + Present Value side-by-side so advisors
              can show clients how a $6M-in-2050 legacy translates to today's purchasing power. */}
          <HeirLegacyCompareChart withLegacy={withRoth.legacy} noLegacy={noRoth?.legacy} span={1}
            exportData={[
              { plan: "With Conversions", after_tax_to_heirs: withRoth.legacy?.after_tax_estate_to_heirs || 0, tax_free_roth: withRoth.legacy?.tax_free_roth_to_heirs || 0, inherited_ira_tax: withRoth.legacy?.inherited_ira_tax || 0 },
              { plan: "No Conversions",   after_tax_to_heirs: noRoth?.legacy?.after_tax_estate_to_heirs || 0, tax_free_roth: noRoth?.legacy?.tax_free_roth_to_heirs || 0, inherited_ira_tax: noRoth?.legacy?.inherited_ira_tax || 0 },
            ]}
            exportFilename="heir-legacy-comparison-nominal" />
          <PvNetToFamilyChart ntf={pv.ntf} span={1}
            exportData={[
              { plan: "With Conversions", pv_total: pv.ntf.pvWith, pv_roth: pv.ntf.pvRothWith },
              { plan: "No Conversions",   pv_total: pv.ntf.pvNo,   pv_roth: pv.ntf.pvRothNo },
            ]}
            exportFilename="net-to-family-pv" />
        </div>
      </div>
    </div>
  );
};
