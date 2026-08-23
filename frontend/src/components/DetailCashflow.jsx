import { useEffect, useMemo, useState, Fragment } from "react";
import { Download, Wallet, Table2, FileSpreadsheet, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runProjection, downloadCSV, downloadWorkbook, fmtUSD } from "@/lib/api";
import { StrategyBadge } from "@/components/StrategyBadge";
import { MarketBadge } from "@/components/MarketScenarioSelector";
import { scaleMoney, densityClasses } from "@/lib/gridFmt";
import { useGridPrefs, detectMilestones, focusRangeYears } from "@/lib/useGridPrefs";
import GridControls from "@/components/grid/GridControls";
import SecureWindowChart from "@/components/SecureWindowChart";

const TYPE_GROUPS = [
  { type: "Cash", label: "Cash", bucket: "cash", color: "#4B7A94" },
  { type: "Taxable", label: "Taxable", bucket: "taxable_and_reinvested", color: "#7A9B76" },
  { type: "Tax-Deferred", label: "Traditional IRA", bucket: "inherited_traditional", color: "#C87941" },
  { type: "Tax-Free", label: "Roth", bucket: "inherited_roth", color: "#4A6741" },
  { type: "Real Estate", label: "Real Estate", bucket: "real_estate", color: "#7A5C7E" },
];

// Cashflow line items — same set the old vertical version showed.
const CONV_TOOLTIP = "A Roth conversion moves dollars from a Traditional IRA to a Roth IRA — no cash leaves the household. What DOES leave is the income tax you owe on the conversion, which shows up separately on the Income Tax row. So the conversion amount here is informational only; it never appears in the surplus calculation.";
const CF_LINES = [
  { key: "wages_pension", label: "Wages / Pension", section: "income" },
  { key: "gross_ss",      label: "Gross SS",         section: "income" },
  { key: "taxable_ss",    label: "Taxable SS",       section: "income", muted: true },
  { key: "dividends",     label: "Dividends",        section: "income" },
  { key: "interest",      label: "Interest",         section: "income" },
  { key: "rmd",           label: "RMD",              section: "income" },
  { key: "conversion",    label: "Roth Conversion (non-cash transfer)",  section: "income", muted: true, tooltip: CONV_TOOLTIP },
  { key: "expenses",      label: "Expenses",         section: "expenses" },
  { key: "income_tax",    label: "Income Tax",       section: "expenses" },
  { key: "medicare",      label: "Medicare + IRMAA", section: "expenses" },
  { key: "from_cash",     label: "← Cash",           section: "funding" },
  { key: "from_taxable",  label: "← Taxable",        section: "funding" },
  { key: "from_ira",      label: "← IRA",            section: "funding" },
  { key: "from_roth",     label: "← Roth",           section: "funding" },
  { key: "surplus",       label: "Surplus / (Short)", section: "net" },
];

const SECTION_HEADERS = [
  { key: "income", label: "INCOME", color: "#4A6741" },
  { key: "expenses", label: "EXPENSES", color: "#B84A4A" },
  { key: "funding", label: "FUNDING DRAWN TO COVER SHORTFALL", color: "#C87941" },
  { key: "net", label: "NET RECONCILIATION", color: "#1A1A1A" },
];

const num = (v, scale = "full") => (v == null || v === "" ? "—" : (typeof v === "number" ? scaleMoney(v, scale) : v));

export const DetailCashflow = ({ scenario }) => {
  const [data, setData] = useState(null);
  const { density, setDensity, scale, setScale, focus, setFocus } = useGridPrefs();
  const dc = densityClasses(density);

  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => runProjection(scenario).then((d) => active && setData(d)), 300);
    return () => { active = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Display-layer only: de-minimis end-of-plan RMDs (< $100) render as $0 so no
  // stray "$1" rounding artifact appears. The grid reads r.cashflow[key], so we
  // must zero cashflow.rmd (and the raw r.rmd). Does not affect any calculation.
  const rows = useMemo(() => (data?.rows || []).map((r) => {
    if (r.rmd == null || r.rmd >= 100) return r;
    const next = { ...r, rmd: 0 };
    if (r.cashflow) next.cashflow = { ...r.cashflow, rmd: 0 };
    if (r.line_items?.income) next.line_items = {
      ...r.line_items,
      income: r.line_items.income.map((it) => (it.kind === "rmd" && (it.amount || 0) < 100) ? { ...it, amount: 0 } : it),
    };
    return next;
  }), [data]);
  const postRows = useMemo(() => data?.legacy?.post_death_rows || [], [data]);
  const lastYear = rows.length ? rows[rows.length - 1].year : 2062;

  // ---------- Column model: lifetime years + heir years ----------
  // Declared before the early-return so hook order stays stable.
  // Focus filter narrows the lifetime year set to the milestone window the
  // user picked; heir columns remain visible unless focus is set to the
  // pre-milestone window that ends before the last lifetime year.
  const yearCols = useMemo(() => {
    const ms = detectMilestones(rows, scenario);
    const range = focusRangeYears(focus, ms);
    const inRange = (yr) => (!range || (yr >= range[0] && yr <= range[1]));
    const cols = rows
      .filter((r) => inRange(r.year))
      .map((r) => ({ kind: "lifetime", year: r.year, row: r, label: String(r.year) }));
    // Only show heir columns when the focus window extends to the end of life
    // (otherwise they'd float away from their conceptual "after second death"
    // anchor).
    if (!range || range[1] >= lastYear) {
      postRows.forEach((p) => cols.push({
        kind: "heir",
        year: lastYear + p.year_after_death,
        post: p,
        label: `${lastYear + p.year_after_death}`,
        sublabel: `+${p.year_after_death}`,
      }));
    }
    return cols;
  }, [rows, postRows, lastYear, focus, scenario]);

  // Rows in the current Focus window (lifetime kind only). Used by the
  // Cashflow-half table below Account Detail.
  const visibleLifetimeRows = useMemo(
    () => yearCols.filter((c) => c.kind === "lifetime").map((c) => c.row),
    [yearCols]
  );

  if (!data) {
    return <div className="py-20 text-center text-muted-foreground animate-pulse label-cap">Running projection…</div>;
  }

  // Group accounts by tax type
  const allAccts = [...(scenario.accounts || []), ...(data.auto_accounts || [])];
  const groups = TYPE_GROUPS.map((g) => ({
    ...g,
    accts: allAccts.filter((a) => a.tax_type === g.type),
  })).filter((g) => g.accts.length > 0);

  // ---------- Downloads (pivoted to match new layout) ----------
  // Account detail — line items (accounts + subtotals + net worth) as rows,
  // years as columns. Heir columns show em-dash for individual accounts and
  // bucket subtotals from `postRows[i][bucket]`.
  const buildAcctSheet = () => {
    const sheet = [];
    groups.forEach((g) => {
      g.accts.forEach((a) => {
        const rec = { Section: g.label, "Line item": a.name };
        yearCols.forEach((c) => {
          if (c.kind === "lifetime") rec[c.label] = c.row.account_balances?.[a.id] ?? "";
          else rec[c.label] = "";
        });
        sheet.push(rec);
      });
      const subRec = { Section: g.label, "Line item": `${g.label} — subtotal` };
      yearCols.forEach((c) => {
        if (c.kind === "lifetime") {
          subRec[c.label] = g.accts.reduce((s, a) => s + (c.row.account_balances?.[a.id] || 0), 0);
        } else {
          subRec[c.label] = c.post[g.bucket] ?? "";
        }
      });
      sheet.push(subRec);
    });
    const nwRec = { Section: "TOTAL", "Line item": "Net Worth" };
    yearCols.forEach((c) => {
      nwRec[c.label] = c.kind === "lifetime" ? c.row.net_worth : c.post.total_to_heirs;
    });
    sheet.push(nwRec);
    return sheet;
  };

  const buildCfSheet = () => {
    return CF_LINES.map((l) => {
      const rec = { Section: sectionLabel(l.section), "Line item": l.label };
      rows.forEach((r) => { rec[String(r.year)] = r.cashflow?.[l.key] ?? ""; });
      return rec;
    });
  };

  const buildSummaryRows = () => rows.map((r) => ({
    Year: r.year, Filing: r.filing_status,
    "Client Age": r.client_age ?? "", "Spouse Age": r.spouse_age ?? "",
    "Ordinary Income": r.ordinary_income, RMD: r.rmd,
    "Roth Conversion": r.roth_conversion, "LTCG / Dividends": r.preferential_income,
    "Total Tax": r.total_tax, "Marginal Rate": r.marginal_rate,
    Traditional: r.traditional, Roth: r.roth, "Net Worth": r.net_worth,
  }));

  const acctCsv = () => downloadCSV(buildAcctSheet(), "account_detail.csv");
  const cfCsv = () => downloadCSV(buildCfSheet(), "cashflow.csv");
  const fullPlan = () => downloadWorkbook([
    { name: "Projection Summary", rows: buildSummaryRows() },
    { name: "Account Detail", rows: buildAcctSheet() },
    { name: "Cashflow", rows: buildCfSheet() },
  ], "retirement_plan.xlsx");

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StrategyBadge scenario={scenario} testid="cashflow-strategy-badge" />
        <MarketBadge scenario={scenario} testid="cashflow-market-badge" />
      </div>

      {/* Full-plan export toolbar */}
      <div className="flex items-center justify-between rounded-xl border border-[#EBE8E0] bg-[#F9F8F6] px-5 py-4" data-testid="full-plan-toolbar">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-[#4A6741]" />
          <div>
            <p className="font-display text-sm font-bold tracking-tight">Download full plan</p>
            <p className="text-[11px] text-muted-foreground">One Excel workbook · Projection Summary + Account Detail + Cashflow (one sheet each)</p>
          </div>
        </div>
        <Button size="sm" onClick={fullPlan} data-testid="export-full-plan" className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
          <Download className="h-4 w-4" /> Excel (.xlsx)
        </Button>
      </div>

      {/* ------------------ Account Detail (horizontal) ------------------ */}
      <Card className="border-[#EBE8E0] shadow-none" data-testid="account-detail-card">
        <div className="flex items-center justify-between p-6 pb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Table2 className="h-5 w-5 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">
              Account Detail — year by year (lifetime + 10 yrs to heirs)
            </h3>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <GridControls density={density} setDensity={setDensity}
                          scale={scale} setScale={setScale}
                          focus={focus} setFocus={setFocus}
                          testidPrefix="detail-cashflow" />
            <Button size="sm" variant="outline" onClick={acctCsv} data-testid="export-account-detail" className="gap-2">
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>
        <div className="overflow-auto max-h-[640px] mx-2 mb-4 border-t border-[#EBE8E0]">
          <table className={`w-full ${dc.textSize}`}>
            <thead className="sticky top-0 z-20 bg-[#F9F8F6] shadow-[0_1px_0_rgba(0,0,0,0.06)]">
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className={`${dc.headCell} font-medium text-left sticky left-0 bg-[#F9F8F6] z-10 ${dc.firstColWidth}`}>
                  Account
                </th>
                {yearCols.map((c) => (
                  <th key={`${c.kind}-${c.year}`}
                      className={`${dc.headCell} font-medium text-right tabular-nums ${dc.colWidth} ${c.kind === "heir" ? "text-[#C87941] bg-[#FBF7F0]" : ""}`}>
                    <div>{c.label}</div>
                    {c.sublabel && (
                      <div className="text-[9px] font-normal normal-case tracking-normal">{c.sublabel}</div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => (
                <Fragment key={g.type}>
                  {/* Group header row */}
                  <tr className={gi === 0 ? "" : "border-t-4 border-[#EBE8E0]"} data-testid={`acct-section-${g.type}`}>
                    <td colSpan={yearCols.length + 1} className="sticky left-0 bg-white z-10">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="inline-block h-3 w-1 rounded-sm" style={{ backgroundColor: g.color }} />
                        <span className="label-cap text-[10px] font-bold" style={{ color: g.color }}>{g.label.toUpperCase()}</span>
                      </div>
                    </td>
                  </tr>
                  {/* One row per account in this group */}
                  {g.accts.map((a) => (
                    <tr key={a.id} className="hover:bg-[#F9F8F6] border-t border-[#EBE8E0]/50"
                        data-testid={`acct-line-${a.id}`}>
                      <td className={`${dc.cell} pl-8 sticky left-0 bg-white z-10 ${dc.firstColWidth}`}>
                        <span className="truncate block max-w-[320px]" title={a.name}>{a.name}</span>
                      </td>
                      {yearCols.map((c) => {
                        if (c.kind === "heir") {
                          return (
                            <td key={c.year} className={`${dc.cell} text-right tabular-nums text-muted-foreground/50 bg-[#FBF7F0]/40 cursor-help`}
                                title="Individual accounts merge and receive a basis step-up at the second death — only the inherited-bucket subtotals are tracked over the 10-year SECURE horizon.">
                              —
                            </td>
                          );
                        }
                        const v = c.row.account_balances?.[a.id];
                        const zero = v == null || Math.abs(v) < 0.5;
                        return (
                          <td key={c.year}
                              className={`${dc.cell} text-right tabular-nums ${zero ? "text-muted-foreground/40" : ""}`}
                              title={typeof v === "number" && !zero ? fmtUSD(v) : undefined}>
                            {num(v, scale)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Subtotal row for the group */}
                  <tr className="bg-[#F9F8F6]" data-testid={`acct-subtotal-${g.type}`}>
                    <td className={`${dc.cell} pl-8 font-semibold sticky left-0 bg-[#F9F8F6] z-10`} style={{ color: g.color }}>
                      {g.label} subtotal
                    </td>
                    {yearCols.map((c) => {
                      let v;
                      if (c.kind === "lifetime") {
                        v = g.accts.reduce((s, a) => s + (c.row.account_balances?.[a.id] || 0), 0);
                      } else {
                        v = c.post[g.bucket];
                      }
                      return (
                        <td key={c.year}
                            className={`${dc.cell} text-right tabular-nums font-semibold ${c.kind === "heir" ? "bg-[#FBF7F0]" : ""}`}
                            style={{ color: g.color }}
                            title={typeof v === "number" ? fmtUSD(v) : undefined}>
                          {num(v, scale)}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              ))}
              {/* Bold Net Worth row */}
              <tr className="bg-[#F1EFE7] border-t-4 border-[#EBE8E0]" data-testid="acct-networth-row">
                <td className={`${dc.cell} font-display font-bold ${density === "roomy" ? "text-base" : "text-sm"} sticky left-0 bg-[#F1EFE7] z-10`}>
                  Net Worth
                </td>
                {yearCols.map((c) => {
                  const v = c.kind === "lifetime" ? c.row.net_worth : c.post.total_to_heirs;
                  return (
                    <td key={c.year}
                        className={`${dc.cell} text-right tabular-nums font-bold ${c.kind === "heir" ? "text-[#C87941] bg-[#F1EFE7]" : "text-[#1A1A1A]"}`}
                        title={typeof v === "number" ? fmtUSD(v) : undefined}>
                      {num(v, scale)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="px-6 pb-4 text-[11px] text-muted-foreground">
          Columns shaded orange are the 10-year SECURE horizon after the second death — individual accounts have merged/stepped-up,
          so only the inherited-bucket subtotals are shown.
        </p>
      </Card>

      {/* ---------- Stacked account values across the SECURE 10-year window ---------- */}
      <SecureWindowChart postRows={postRows} secondDeathYear={lastYear}
        heirRate={data?.legacy?.heir_ordinary_rate} />

      {/* ------------------ Cashflow (horizontal) ------------------ */}
      <Card className="border-[#EBE8E0] shadow-none" data-testid="cashflow-card">
        <div className="flex items-center justify-between p-6 pb-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">Cashflow — year by year</h3>
          </div>
          <Button size="sm" variant="outline" onClick={cfCsv} data-testid="export-cashflow" className="gap-2">
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
        <div className="overflow-auto max-h-[640px] mx-2 mb-4 border-t border-[#EBE8E0]">
          <table className={`w-full ${dc.textSize}`}>
            <thead className="sticky top-0 z-20 bg-[#F9F8F6] shadow-[0_1px_0_rgba(0,0,0,0.06)]">
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className={`${dc.headCell} font-medium text-left sticky left-0 bg-[#F9F8F6] z-10 ${dc.firstColWidth}`}>
                  Line item
                </th>
                {visibleLifetimeRows.map((r) => (
                  <th key={r.year} className={`${dc.headCell} font-medium text-right tabular-nums ${dc.colWidth}`}>
                    {r.year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SECTION_HEADERS.map((sec) => {
                const linesInSection = CF_LINES.filter((l) => l.section === sec.key);
                if (!linesInSection.length) return null;
                return (
                  <Fragment key={sec.key}>
                    <tr className="border-t-4 border-[#EBE8E0]" data-testid={`cf-section-${sec.key}`}>
                      <td colSpan={visibleLifetimeRows.length + 1} className="sticky left-0 bg-white z-10">
                        <div className="flex items-center gap-2 px-3 py-2">
                          <span className="inline-block h-3 w-1 rounded-sm" style={{ backgroundColor: sec.color }} />
                          <span className="label-cap text-[10px] font-bold" style={{ color: sec.color }}>{sec.label}</span>
                        </div>
                      </td>
                    </tr>
                    {linesInSection.map((l) => (
                      <CfLineRow key={l.key} line={l} rows={visibleLifetimeRows} dc={dc} scale={scale} density={density} />
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-6 pb-4 text-[11px] text-muted-foreground">
          "← Cash / Taxable / IRA / Roth" are discretionary withdrawals drawn to fund the year's shortfall
          (income covers spending first). Positive surplus is swept to the taxable brokerage.
        </p>
      </Card>
    </div>
  );
};

// -------------------- helpers --------------------

const sectionLabel = (key) => {
  const s = SECTION_HEADERS.find((x) => x.key === key);
  return s ? s.label : key;
};

const CfLineRow = ({ line, rows, dc, scale, density }) => {
  const isSurplus = line.key === "surplus";
  return (
    <tr className={`hover:bg-[#F9F8F6] border-t border-[#EBE8E0]/50 ${isSurplus ? "bg-[#F1EFE7]" : ""}`}
        data-testid={`cf-line-${line.key}`}>
      <td className={`${dc.cell} pl-8 sticky left-0 z-10 ${dc.firstColWidth} ${isSurplus ? `bg-[#F1EFE7] font-bold font-display ${density === "roomy" ? "text-base" : "text-sm"}` : "bg-white"} ${line.muted ? "text-muted-foreground" : ""}`}>
        <span className="inline-flex items-center gap-1.5" title={line.tooltip || undefined}
              data-testid={line.tooltip ? `cf-line-${line.key}-label` : undefined}>
          {line.label}
          {line.tooltip && (
            <Info className="h-3 w-3 text-muted-foreground/60 shrink-0"
                  data-testid={`cf-line-${line.key}-info`} />
          )}
        </span>
      </td>
      {rows.map((r) => {
        const v = r.cashflow?.[line.key];
        const zero = v == null || Math.abs(v) < 0.5;
        const cls = isSurplus
          ? `font-bold ${v < 0 ? "text-[#C87941]" : "text-[#4A6741]"}`
          : (line.muted ? "text-muted-foreground" : "");
        return (
          <td key={r.year}
              className={`${dc.cell} text-right tabular-nums ${zero ? "text-muted-foreground/40" : cls}`}
              title={typeof v === "number" && !zero ? fmtUSD(v) : undefined}>
            {num(v, scale)}
          </td>
        );
      })}
    </tr>
  );
};
