import { useEffect, useMemo, useState } from "react";
import {
  Wallet, ArrowDownRight, ArrowUpRight, Table2, LayoutGrid,
  FileSpreadsheet, FileDown, ChevronRight, TrendingUp, TrendingDown, Info,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runProjection, fmtUSD, downloadCSV, downloadWorkbook } from "@/lib/api";
import { scaleMoney, densityClasses } from "@/lib/gridFmt";
import { useGridPrefs, detectMilestones, focusRangeYears } from "@/lib/useGridPrefs";
import GridControls from "@/components/grid/GridControls";

const num = (v, scale = "full") => (v == null || (typeof v === "number" && Math.abs(v) < 0.5) ? "—" : scaleMoney(v, scale));

// Section colors + labels
const SECTIONS = [
  { key: "income", label: "Income", color: "#4A6741", tone: "bg-[#F1F5EF]" },
  { key: "expenses", label: "Expenses", color: "#B84A4A", tone: "bg-[#FBECEC]" },
  { key: "net_cashflow", label: "Net cashflow", color: "#1A1A1A", tone: "bg-[#EBE8E0]" },
  { key: "funding", label: "Funding drawn", color: "#C87941", tone: "bg-[#FBF3EC]" },
];

// Income kinds ordered top → bottom in the grid rendering.
const INCOME_KIND_ORDER = ["wages", "pension", "annuity", "ss", "rmd", "interest", "dividends", "other"];
const INCOME_KIND_LABEL = {
  wages: "Wages / earned", pension: "Pension", annuity: "Annuity",
  ss: "Social Security", rmd: "RMDs", interest: "Interest",
  dividends: "Dividends / LTCG", other: "Other income",
};
// Expense categories ordered similarly.
const EXPENSE_CAT_ORDER = ["spending", "housing", "health", "insurance", "gift", "taxes", "other"];
const EXPENSE_CAT_LABEL = {
  spending: "Living / discretionary", housing: "Housing", health: "Health / Medicare",
  insurance: "Insurance", gift: "Gifts / charity", taxes: "Income taxes", other: "Other",
};

export const Cashflow = ({ scenario }) => {
  const [data, setData] = useState(null);
  const [view, setView] = useState("grid"); // "grid" | "cards"
  const [hidePreRetirement, setHidePreRetirement] = useState(false);
  const { density, setDensity, scale, setScale, focus, setFocus } = useGridPrefs();
  const dc = densityClasses(density);

  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => runProjection(scenario).then((d) => alive && setData(d)), 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Display-layer only: de-minimis end-of-plan RMDs (< $100) render as $0 so no
  // stray "$1" rounding artifact appears. Does not affect any calculation.
  const rows = useMemo(() => (data?.rows || []).map((r) => {
    if (r.rmd == null || r.rmd >= 100) return r;
    // Also filter line_items.income for RMD entries and the cashflow.rmd field.
    const filteredLineItems = r.line_items ? {
      ...r.line_items,
      income: (r.line_items.income || []).map((item) =>
        (item.kind === 'rmd' && item.amount < 100) ? { ...item, amount: 0 } : item
      ),
    } : r.line_items;
    const next = { ...r, rmd: 0, line_items: filteredLineItems };
    if (r.cashflow) next.cashflow = { ...r.cashflow, rmd: 0 };
    return next;
  }), [data]);
  const firstRetYear = useMemo(() => {
    if (!rows.length) return null;
    const r = rows.find((row) => (row.rmd > 0) || (row.gross_ss > 0));
    return r?.year ?? rows[rows.length - 1].year + 1;
  }, [rows]);
  const visibleRows = useMemo(() => {
    let out = rows;
    if (hidePreRetirement && firstRetYear != null) {
      out = out.filter((r) => r.year >= firstRetYear);
    }
    const range = focusRangeYears(focus, detectMilestones(rows, scenario));
    if (range) {
      out = out.filter((r) => r.year >= range[0] && r.year <= range[1]);
    }
    return out;
  }, [rows, hidePreRetirement, firstRetYear, focus, scenario]);

  // ---------- Aggregate a wide-grid view: line-item rows × year columns.
  // Each unique {section, group, source} pair becomes ONE row. Groups: income kind
  // or expense category. We also emit per-group subtotal rows in bold.
  const grid = useMemo(() => buildGrid(visibleRows), [visibleRows]);

  const downloadData = (fmt) => {
    // Flatten to a wide sheet: one column per year, one row per line item.
    const yrs = visibleRows.map((r) => r.year);
    const sheet = grid.rows.map((gr) => {
      const rec = { Section: gr.section, Group: gr.groupLabel, Line: gr.source };
      yrs.forEach((y, i) => { rec[String(y)] = gr.values[i]; });
      return rec;
    });
    if (fmt === "xlsx") {
      downloadWorkbook([{ name: "Cashflow", rows: sheet }], "cashflow-detail.xlsx");
    } else {
      downloadCSV(sheet, "cashflow-detail.csv");
    }
  };

  if (!data) return (
    <div className="py-20 text-center text-muted-foreground animate-pulse label-cap">
      Building cashflow statement…
    </div>
  );

  return (
    <div className="space-y-6" data-testid="cashflow-detail-tab">
      {/* Header */}
      <Card className="p-6 border-[#EBE8E0] shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="h-5 w-5 text-[#4A6741]" />
              <h2 className="font-display text-xl font-bold tracking-tight">Cashflow Statement</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              A complete year-by-year income &amp; expense statement for the couple. Income lines (wages, pension, SS, RMDs, dividends, interest)
              stack against expense lines (living, health, taxes, Medicare + IRMAA). The <span className="font-medium">Net cashflow</span> row
              shows the surplus or shortfall, and the <span className="font-medium">Funding drawn</span> block shows how any shortfall was
              pulled from cash → taxable → IRA → Roth in the funding order you set.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="inline-flex rounded-full border border-[#EBE8E0] p-0.5 bg-[#F9F8F6]">
              <button type="button" onClick={() => setView("grid")}
                      data-testid="cashflow-view-grid"
                      className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${view === "grid" ? "bg-[#4A6741] text-white" : "text-[#4A6741]"}`}>
                <Table2 className="h-3 w-3" /> Wide grid
              </button>
              <button type="button" onClick={() => setView("cards")}
                      data-testid="cashflow-view-cards"
                      className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${view === "cards" ? "bg-[#4A6741] text-white" : "text-[#4A6741]"}`}>
                <LayoutGrid className="h-3 w-3" /> Per-year cards
              </button>
            </div>
            {view === "grid" && (
              <GridControls density={density} setDensity={setDensity}
                            scale={scale} setScale={setScale}
                            focus={focus} setFocus={setFocus}
                            testidPrefix="cashflow" />
            )}
            <Button size="sm" variant="outline" onClick={() => setHidePreRetirement((v) => !v)}
                    data-testid="cashflow-toggle-retirement"
                    className="border-[#4A6741] text-[#4A6741]">
              {hidePreRetirement ? "Show all years" : "Hide pre-retirement"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadData("xlsx")}
                    data-testid="cashflow-download-xlsx"
                    className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadData("csv")}
                    data-testid="cashflow-download-csv"
                    className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
              <FileDown className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>
      </Card>

      {view === "grid" ? (
        <GridView grid={grid} years={visibleRows.map((r) => r.year)} dc={dc} scale={scale} density={density} />
      ) : (
        <CardsView rows={visibleRows} />
      )}
    </div>
  );
};

// ------------------------------------------------------------------
// buildGrid — collapse per-year line_items into a single sparse matrix
// of rows × years. Each unique (section, groupLabel, source) key becomes
// one row spanning all years — values default to null.
// ------------------------------------------------------------------
function buildGrid(rows) {
  const map = new Map(); // key -> { section, groupLabel, groupOrder, sourceOrder, source, values }
  const yearCount = rows.length;

  const ensureRow = (key, section, groupLabel, groupOrder, source, sourceOrder) => {
    if (!map.has(key)) {
      map.set(key, {
        key, section, groupLabel, groupOrder, source, sourceOrder,
        values: new Array(yearCount).fill(null),
      });
    }
    return map.get(key);
  };

  rows.forEach((r, i) => {
    const li = r.line_items || {};
    // Income
    (li.income || []).forEach((l) => {
      const kind = INCOME_KIND_ORDER.includes(l.kind) ? l.kind : "other";
      const groupOrder = INCOME_KIND_ORDER.indexOf(kind);
      const groupLabel = INCOME_KIND_LABEL[kind];
      const source = l.source;
      const key = `I|${kind}|${source}`;
      const row = ensureRow(key, "income", groupLabel, groupOrder, source, 0);
      // Accumulate rather than overwrite — protects against two backend
      // streams collapsing to the same {kind, source} tuple (e.g. all
      // unnamed Ordinary streams for one owner). Silent overwrite here
      // used to hide entire streams from the Cashflow tab.
      row.values[i] = (row.values[i] || 0) + l.amount;
    });
    // Expenses
    (li.expenses || []).forEach((l) => {
      // Backend uses "charity" for the QCD (Qualified Charitable Distribution)
      // expense row. Fold it into the "gift" bucket so it renders under the
      // "Gifts / charity" group rather than dropping into "Other".
      let rawCat = l.category === "charity" ? "gift" : l.category;
      const cat = EXPENSE_CAT_ORDER.includes(rawCat) ? rawCat : "other";
      const groupOrder = EXPENSE_CAT_ORDER.indexOf(cat);
      const groupLabel = EXPENSE_CAT_LABEL[cat];
      const source = l.source;
      const key = `E|${cat}|${source}`;
      const row = ensureRow(key, "expenses", groupLabel, groupOrder, source, 0);
      row.values[i] = (row.values[i] || 0) + l.amount;
    });
    // Funding (each source is its own row so they render side-by-side)
    const funding = li.funding || {};
    [
      ["from_cash", "Cash"], ["from_taxable", "Taxable brokerage"],
      ["from_ira", "Traditional IRA"], ["from_roth", "Roth"],
    ].forEach(([k, lbl], ord) => {
      if (funding[k] == null) return;
      const key = `F|funding|${lbl}`;
      const row = ensureRow(key, "funding", "Withdrawals by source", ord, lbl, ord);
      row.values[i] = funding[k];
    });
  });

  const gridRows = Array.from(map.values()).sort((a, b) => {
    const sOrder = ["income", "expenses", "funding"];
    if (a.section !== b.section) return sOrder.indexOf(a.section) - sOrder.indexOf(b.section);
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder;
    return a.source.localeCompare(b.source);
  });

  // Per-year subtotals lifted from the row's line_items.subtotals — ground truth.
  const incomeTotals = rows.map((r) => r.line_items?.subtotals?.income ?? 0);
  const expenseTotals = rows.map((r) => r.line_items?.subtotals?.expenses ?? 0);
  const netTotals = rows.map((r) => r.line_items?.subtotals?.net_cashflow ?? 0);
  const fundingTotals = rows.map((r) => r.line_items?.subtotals?.funding_drawn ?? 0);
  const nonCashConversion = rows.map((r) =>
    (r.line_items?.non_cash_events || []).reduce((s, x) => s + (x.amount || 0), 0));

  return { rows: gridRows, incomeTotals, expenseTotals, netTotals, fundingTotals, nonCashConversion };
}

// ------------------------------------------------------------------
// GridView — sticky first column (Line item), sticky top row (Years)
// ------------------------------------------------------------------
const GridView = ({ grid, years, dc, scale, density }) => {
  return (
    <Card className="p-0 border-[#EBE8E0] shadow-none overflow-hidden" data-testid="cashflow-grid-card">
      <div className="overflow-auto max-h-[720px]" data-testid="cashflow-grid-scroll">
        <table className={`w-full ${dc.textSize}`} data-testid="cashflow-grid-table">
          <thead className="sticky top-0 z-20 bg-[#F9F8F6] shadow-[0_1px_0_rgba(0,0,0,0.06)]">
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className={`${dc.headCell} font-medium text-left sticky left-0 bg-[#F9F8F6] z-10 ${dc.firstColWidth}`}>Line item</th>
              {years.map((y) => (
                <th key={y} className={`${dc.headCell} font-medium text-right tabular-nums ${dc.colWidth}`}>{y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SectionHeaderRow label="INCOME" color={SECTIONS[0].color} colspan={years.length + 1} testid="section-income" />
            {renderSection(grid.rows.filter((r) => r.section === "income"), years, "income", dc, scale)}
            <SubtotalRow label="Income total" values={grid.incomeTotals} color="#4A6741"
                         testid="row-income-total" dc={dc} scale={scale} />

            <SectionHeaderRow label="EXPENSES" color={SECTIONS[1].color} colspan={years.length + 1} testid="section-expenses" />
            {renderSection(grid.rows.filter((r) => r.section === "expenses"), years, "expenses", dc, scale)}
            <SubtotalRow label="Expense total" values={grid.expenseTotals} color="#B84A4A"
                         testid="row-expense-total" dc={dc} scale={scale} />

            {/* Net cashflow — bold reconciliation row */}
            <tr className="bg-[#F1EFE7]" data-testid="row-net-cashflow">
              <td className={`${dc.cell} font-display font-bold ${density === "roomy" ? "text-base" : "text-sm"} sticky left-0 bg-[#F1EFE7] z-10`}>
                Net cashflow (income − expenses)
              </td>
              {grid.netTotals.map((v, i) => (
                <td key={i}
                    className={`${dc.cell} text-right tabular-nums font-bold ${v >= 0 ? "text-[#4A6741]" : "text-[#B84A4A]"}`}
                    title={typeof v === "number" ? fmtUSD(v) : undefined}>
                  {v >= 0 ? <ArrowUpRight className="inline h-3 w-3 mr-0.5" /> : <ArrowDownRight className="inline h-3 w-3 mr-0.5" />}
                  {num(v, scale)}
                </td>
              ))}
            </tr>

            <SectionHeaderRow label="FUNDING DRAWN TO COVER SHORTFALL" color={SECTIONS[3].color}
                              colspan={years.length + 1} testid="section-funding" />
            {renderSection(grid.rows.filter((r) => r.section === "funding"), years, "funding", dc, scale)}
            <SubtotalRow label="Total drawn from accounts" values={grid.fundingTotals} color="#C87941"
                         testid="row-funding-total" dc={dc} scale={scale} />

            {/* Non-cash: Roth conversions (informational — drives tax bill only) */}
            {grid.nonCashConversion.some((v) => v > 0) && (
              <>
                <tr className="border-t-4 border-[#EBE8E0]">
                  <td className="px-3 py-1.5 label-cap text-[10px] text-muted-foreground sticky left-0 bg-white z-10"
                      colSpan={years.length + 1}>
                    NON-CASH TAX EVENT — informational only
                  </td>
                </tr>
                <tr className="text-muted-foreground italic" data-testid="row-conversion-noncash">
                  <td className={`${dc.cell} sticky left-0 bg-white z-10`}>
                    <span className="inline-flex items-center gap-1.5"
                          title="A Roth conversion moves dollars from a Traditional IRA to a Roth IRA — no cash leaves the household. What DOES leave is the income tax you owe on the conversion, shown separately on the Income Tax row. So the conversion amount here is informational only; it never appears in the surplus calculation."
                          data-testid="row-conversion-noncash-label">
                      Roth Conversion (non-cash transfer)
                      <Info className="h-3 w-3 text-muted-foreground/60 shrink-0"
                            data-testid="row-conversion-noncash-info" />
                    </span>
                  </td>
                  {grid.nonCashConversion.map((v, i) => (
                    <td key={i}
                        className={`${dc.cell} text-right tabular-nums`}
                        title={typeof v === "number" && v > 0 ? fmtUSD(v) : undefined}>
                      {num(v, scale)}
                    </td>
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground px-6 py-3 border-t border-[#EBE8E0]">
        Roth conversions appear only in the "Non-cash tax event" strip — they are internal transfers from Traditional to Roth (same household, different tax pocket) that never touch real cashflow, but they drive the year's income tax bill so the amount is disclosed for full accounting.
      </p>
    </Card>
  );
};

const renderSection = (rows, years, section, dc, scale) => {
  const out = [];
  let currentGroup = null;
  rows.forEach((r) => {
    if (r.groupLabel !== currentGroup) {
      currentGroup = r.groupLabel;
      out.push(
        <tr key={`grp-${section}-${r.groupLabel}`} className="bg-white/50">
          <td className="px-3 py-1.5 pl-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sticky left-0 bg-white z-10"
              colSpan={years.length + 1}>
            {r.groupLabel}
          </td>
        </tr>
      );
    }
    out.push(
      <tr key={r.key} className="hover:bg-[#F9F8F6] border-t border-[#EBE8E0]/50"
          data-testid={`cf-line-${r.key}`}>
        <td className={`${dc.cell} pl-8 sticky left-0 bg-white z-10 ${dc.firstColWidth}`}>
          <span className="truncate block max-w-[320px]" title={r.source}>{r.source}</span>
        </td>
        {r.values.map((v, i) => (
          <td key={i}
              className={`${dc.cell} text-right tabular-nums ${v == null || v === 0 ? "text-muted-foreground/40" : ""}`}
              title={typeof v === "number" && v > 0 ? fmtUSD(v) : undefined}>
            {num(v, scale)}
          </td>
        ))}
      </tr>
    );
  });
  return out;
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

const SubtotalRow = ({ label, values, color, testid, dc, scale }) => (
  <tr className="bg-[#F9F8F6]" data-testid={testid}>
    <td className={`${dc.cell} font-semibold sticky left-0 bg-[#F9F8F6] z-10`} style={{ color }}>
      {label}
    </td>
    {values.map((v, i) => (
      <td key={i}
          className={`${dc.cell} text-right tabular-nums font-semibold`}
          style={{ color }}
          title={typeof v === "number" ? fmtUSD(v) : undefined}>
        {num(v, scale)}
      </td>
    ))}
  </tr>
);

// ------------------------------------------------------------------
// CardsView — one card per year, mini income statement style.
// Reads the row's line_items.subtotals directly so numbers reconcile to the cent.
// ------------------------------------------------------------------
const CardsView = ({ rows }) => (
  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="cashflow-cards">
    {rows.map((r) => <YearCard key={r.year} row={r} />)}
  </div>
);

const YearCard = ({ row }) => {
  const li = row.line_items || {};
  const s = li.subtotals || {};
  const net = s.net_cashflow || 0;
  const funding = li.funding || {};
  const nonCash = (li.non_cash_events || [])[0];

  // Group income lines by kind for a compact display
  const incomeGroups = groupByKey(li.income || [], (x) => INCOME_KIND_LABEL[x.kind] || "Other income");
  const expenseGroups = groupByKey(li.expenses || [], (x) => EXPENSE_CAT_LABEL[x.category] || "Other");

  return (
    <Card className="p-5 border-[#EBE8E0] shadow-none space-y-3" data-testid={`cf-card-${row.year}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-lg font-bold tracking-tight">{row.year}</p>
          <p className="text-[10px] text-muted-foreground">
            Ages {row.client_age ?? "—"}{row.spouse_age != null ? ` / ${row.spouse_age}` : ""} · {row.filing_status}
          </p>
        </div>
        <div className={`text-right ${net >= 0 ? "text-[#4A6741]" : "text-[#B84A4A]"}`}>
          <p className="label-cap text-[9px]">Net cashflow</p>
          <p className="font-display text-base font-bold flex items-center justify-end gap-1">
            {net >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {fmtUSD(net)}
          </p>
        </div>
      </div>

      <div className="border-t border-[#EBE8E0] pt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="label-cap text-[10px] text-[#4A6741] font-semibold">Income</span>
          <span className="text-xs font-semibold text-[#4A6741] tabular-nums">{fmtUSD(s.income || 0)}</span>
        </div>
        {Object.entries(incomeGroups).map(([g, lines]) => (
          <div key={g} className="mt-1 space-y-0.5">
            <p className="text-[10px] text-muted-foreground">{g}</p>
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between text-[11px]">
                <span className="text-muted-foreground truncate max-w-[180px]" title={l.source}>{l.source}</span>
                <span className="tabular-nums">{fmtUSD(l.amount)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="border-t border-[#EBE8E0] pt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="label-cap text-[10px] text-[#B84A4A] font-semibold">Expenses</span>
          <span className="text-xs font-semibold text-[#B84A4A] tabular-nums">{fmtUSD(s.expenses || 0)}</span>
        </div>
        {Object.entries(expenseGroups).map(([g, lines]) => (
          <div key={g} className="mt-1 space-y-0.5">
            <p className="text-[10px] text-muted-foreground">{g}</p>
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between text-[11px]">
                <span className="text-muted-foreground truncate max-w-[180px]" title={l.source}>{l.source}</span>
                <span className="tabular-nums">{fmtUSD(l.amount)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {net < 0 && (
        <div className="border-t border-[#EBE8E0] pt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="label-cap text-[10px] text-[#C87941] font-semibold">Shortfall funded from</span>
            <span className="text-xs font-semibold text-[#C87941] tabular-nums">{fmtUSD(s.funding_drawn || 0)}</span>
          </div>
          <div className="text-[11px] space-y-0.5">
            {funding.from_cash > 0 && <FundRow label="Cash" v={funding.from_cash} />}
            {funding.from_taxable > 0 && <FundRow label="Taxable brokerage" v={funding.from_taxable} />}
            {funding.from_ira > 0 && <FundRow label="Traditional IRA" v={funding.from_ira} />}
            {funding.from_roth > 0 && <FundRow label="Roth" v={funding.from_roth} />}
          </div>
        </div>
      )}

      {nonCash && (
        <div className="border-t border-[#EBE8E0] pt-3" data-testid="card-noncash-conversion">
          <p className="label-cap text-[9px] text-muted-foreground">Non-cash tax event</p>
          <div className="flex items-center justify-between text-[11px] mt-1">
            <span className="text-muted-foreground italic flex items-center gap-1"
                  title={nonCash.note || "A Roth conversion moves dollars from Traditional to Roth — no cash leaves the household. The income tax it triggers shows on the Income Tax line."}>
              <ChevronRight className="h-3 w-3" /> Roth Conversion (non-cash transfer)
              <Info className="h-3 w-3 text-muted-foreground/60 shrink-0"
                    data-testid="card-noncash-info" />
            </span>
            <span className="tabular-nums italic text-muted-foreground">{fmtUSD(nonCash.amount)}</span>
          </div>
        </div>
      )}
    </Card>
  );
};

const FundRow = ({ label, v }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground flex items-center gap-1">
      <ChevronRight className="h-3 w-3" /> {label}
    </span>
    <span className="tabular-nums">{fmtUSD(v)}</span>
  </div>
);

const groupByKey = (arr, keyFn) => {
  const out = {};
  arr.forEach((x) => {
    const k = keyFn(x);
    if (!out[k]) out[k] = [];
    out[k].push(x);
  });
  return out;
};
