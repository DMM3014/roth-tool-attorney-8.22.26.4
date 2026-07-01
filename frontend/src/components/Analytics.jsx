import { useEffect, useMemo, useState } from "react";
import { Printer, FileSpreadsheet, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runProjection, fmtUSD, pvSeries, buildPvSheets, downloadWorkbook, downloadCSV } from "@/lib/api";
import {
  IncomeSourcesChart, BracketFillChart, SurplusChart, TaxCompositionChart,
  RmdBalanceChart, IrmaaChart, RateTrendChart, CumulativeTaxChart, HeirLegacyCompareChart,
  PvNetWorthChart, RothConversionsChart, PvNetToFamilyChart,
} from "@/components/AnalyticsCharts";

const BRACKET_LABELS = ["10%", "12%", "22%", "24%", "32%", "35%", "37%"];

export const Analytics = ({ scenario }) => {
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);

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

  const rows = useMemo(() => withRoth?.rows || [], [withRoth]);

  const incomeData = useMemo(() => rows.map((r) => {
    const cf = r.cashflow || {};
    return {
      year: r.year,
      Wages: cf.wages_pension || 0,
      SocialSecurity: cf.gross_ss || 0,
      Dividends: cf.dividends || 0,
      Interest: cf.interest || 0,
      RMD: cf.rmd || 0,
      Conversion: cf.conversion || 0,
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
  const cumData = useMemo(() => {
    let cy = 0, cn = 0;
    return rows.map((r, i) => {
      cy += r.total_tax || 0;
      cn += noRoth?.rows?.[i]?.total_tax || 0;
      return { year: r.year, cumYes: Math.round(cy), cumNo: Math.round(cn) };
    });
  }, [rows, noRoth]);

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
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EBE8E0] bg-[#F9F8F6] px-5 py-4" data-testid="presentation-toolbar">
        <div>
          <p className="font-display text-sm font-bold tracking-tight">Client-ready presentation</p>
          <p className="text-[11px] text-muted-foreground">Branded document · summary metrics + all analytics charts. Download the underlying data to reconcile against your source spreadsheet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadData("xlsx")} data-testid="download-xlsx"
            className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
            <FileSpreadsheet className="h-4 w-4" /> Download Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadData("csv")} data-testid="download-csv"
            className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
            <FileDown className="h-4 w-4" /> Download CSV
          </Button>
          <Button size="sm" onClick={() => window.print()} data-testid="export-presentation"
            className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
            <Printer className="h-4 w-4" /> Print / Export PDF
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 analytics-grid" data-testid="analytics-grid">
          <PvNetWorthChart data={pv.series} />
          <RothConversionsChart data={pv.series} span={1} />
          <PvNetToFamilyChart ntf={pv.ntf} span={1} />
          <IncomeSourcesChart data={incomeData} />
          <BracketFillChart data={bracketData} brackets={BRACKET_LABELS} />
          <SurplusChart data={surplusData} />
          <TaxCompositionChart data={taxCompData} />
          <RmdBalanceChart data={rmdData} />
          <IrmaaChart data={irmaaData} />
          <RateTrendChart data={rateData} />
          <CumulativeTaxChart data={cumData} />
          <HeirLegacyCompareChart withLegacy={withRoth.legacy} noLegacy={noRoth?.legacy} />
        </div>
      </div>
    </div>
  );
};
