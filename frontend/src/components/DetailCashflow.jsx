import { useEffect, useState, Fragment } from "react";
import { Download, Wallet, Table2, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runProjection, downloadCSV, downloadWorkbook, fmtUSD } from "@/lib/api";

const TYPE_GROUPS = [
  { type: "Cash", label: "Cash", bucket: "cash" },
  { type: "Taxable", label: "Taxable", bucket: "taxable_and_reinvested" },
  { type: "Tax-Deferred", label: "Traditional IRA", bucket: "inherited_traditional" },
  { type: "Tax-Free", label: "Roth", bucket: "inherited_roth" },
  { type: "Real Estate", label: "Real Estate", bucket: "real_estate" },
];

const num = (v) => (v == null ? "—" : fmtUSD(v));

export const DetailCashflow = ({ scenario }) => {
  const [data, setData] = useState(null);

  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => runProjection(scenario).then((d) => active && setData(d)), 300);
    return () => { active = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!data) {
    return <div className="py-20 text-center text-muted-foreground animate-pulse label-cap">Running projection…</div>;
  }

  const rows = data.rows;
  const lastYear = rows.length ? rows[rows.length - 1].year : 2062;
  const postRows = data.legacy?.post_death_rows || [];

  // group accounts by tax type, in display order (incl. backend auto-created same-owner Roths)
  const allAccts = [...(scenario.accounts || []), ...(data.auto_accounts || [])];
  const groups = TYPE_GROUPS.map((g) => ({
    ...g,
    accts: allAccts.filter((a) => a.tax_type === g.type),
  })).filter((g) => g.accts.length > 0);

  // ---------- Account Detail table ----------
  const acctSubtotal = (row, g) => g.accts.reduce((s, a) => s + (row.account_balances?.[a.id] || 0), 0);

  const buildAcctRows = () => {
    const out = [];
    rows.forEach((r) => {
      const rec = { Year: r.year };
      groups.forEach((g) => {
        g.accts.forEach((a) => { rec[a.name] = r.account_balances?.[a.id] ?? ""; });
        rec[`${g.label} Total`] = acctSubtotal(r, g);
      });
      rec["Net Worth"] = r.net_worth;
      out.push(rec);
    });
    postRows.forEach((p) => {
      const rec = { Year: `${lastYear + p.year_after_death} (heirs +${p.year_after_death})` };
      groups.forEach((g) => {
        g.accts.forEach((a) => { rec[a.name] = ""; });
        rec[`${g.label} Total`] = p[g.bucket] ?? "";
      });
      rec["Net Worth"] = p.total_to_heirs;
      out.push(rec);
    });
    return out;
  };
  const acctCsv = () => downloadCSV(buildAcctRows(), "account_detail.csv");

  // ---------- Cashflow table ----------
  const CF_COLS = [
    ["wages_pension", "Wages / Pension"], ["gross_ss", "Gross SS"], ["taxable_ss", "Taxable SS"],
    ["dividends", "Dividends"], ["interest", "Interest"], ["rmd", "RMD"], ["conversion", "Roth Conv."],
    ["expenses", "Expenses"], ["income_tax", "Income Tax"], ["medicare", "Medicare+IRMAA"],
    ["from_cash", "← Cash"], ["from_taxable", "← Taxable"], ["from_ira", "← IRA"], ["from_roth", "← Roth"],
    ["surplus", "Surplus / (Short)"],
  ];
  const buildCfRows = () =>
    rows.map((r) => ({ Year: r.year, ...CF_COLS.reduce((o, [k, l]) => ({ ...o, [l]: r.cashflow?.[k] ?? "" }), {}) }));
  const cfCsv = () => downloadCSV(buildCfRows(), "cashflow.csv");

  // ---------- Projection summary ----------
  const buildSummaryRows = () =>
    rows.map((r) => ({
      Year: r.year,
      Filing: r.filing_status,
      "Client Age": r.client_age ?? "",
      "Spouse Age": r.spouse_age ?? "",
      "Ordinary Income": r.ordinary_income,
      RMD: r.rmd,
      "Roth Conversion": r.roth_conversion,
      "LTCG / Dividends": r.preferential_income,
      "Total Tax": r.total_tax,
      "Marginal Rate": r.marginal_rate,
      Traditional: r.traditional,
      Roth: r.roth,
      "Net Worth": r.net_worth,
    }));

  const fullPlan = () => downloadWorkbook([
    { name: "Projection Summary", rows: buildSummaryRows() },
    { name: "Account Detail", rows: buildAcctRows() },
    { name: "Cashflow", rows: buildCfRows() },
  ], "retirement_plan.xlsx");

  const th = "px-2 py-2 text-right font-semibold whitespace-nowrap";
  const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-10">
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

      {/* Account Detail */}
      <Card className="border-[#EBE8E0] shadow-none" data-testid="account-detail-card">
        <div className="flex items-center justify-between p-6 pb-3">
          <div className="flex items-center gap-2">
            <Table2 className="h-5 w-5 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">Account Detail — year by year (lifetime + 10 yrs to heirs)</h3>
          </div>
          <Button size="sm" variant="outline" onClick={acctCsv} data-testid="export-account-detail" className="gap-2">
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto px-2 pb-4">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#F9F8F6] z-10">
              <tr className="border-b border-[#EBE8E0] text-[#5A5A5A]">
                <th className="px-2 py-2 text-left font-semibold sticky left-0 bg-[#F9F8F6]">Year</th>
                {groups.map((g) => (
                  <Fragment key={g.type}>
                    {g.accts.map((a) => <th key={a.id} className={th}>{a.name}</th>)}
                    <th key={`${g.type}-sub`} className={`${th} text-[#4A6741] border-l border-[#EBE8E0]`}>{g.label} Σ</th>
                  </Fragment>
                ))}
                <th className={`${th} text-[#1A1A1A] border-l-2 border-[#4A6741]`}>Net Worth</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year} className="border-b border-[#F0EEE8] hover:bg-[#F9F8F6]" data-testid={`acct-row-${r.year}`}>
                  <td className="px-2 py-1.5 text-left font-medium sticky left-0 bg-white">{r.year}</td>
                  {groups.map((g) => (
                    <Fragment key={g.type}>
                      {g.accts.map((a) => <td key={a.id} className={td}>{num(r.account_balances?.[a.id])}</td>)}
                      <td key={`${g.type}-sub`} className={`${td} font-semibold text-[#4A6741] border-l border-[#EBE8E0]`}>{num(acctSubtotal(r, g))}</td>
                    </Fragment>
                  ))}
                  <td className={`${td} font-bold border-l-2 border-[#4A6741]`}>{num(r.net_worth)}</td>
                </tr>
              ))}
              {postRows.map((p) => (
                <tr key={`p${p.year_after_death}`} className="border-b border-[#F0EEE8] bg-[#FBF7F0]" data-testid={`acct-heir-row-${p.year_after_death}`}>
                  <td className="px-2 py-1.5 text-left font-medium sticky left-0 bg-[#FBF7F0] text-[#C87941]">
                    {lastYear + p.year_after_death}<span className="text-[10px]"> · +{p.year_after_death}</span>
                  </td>
                  {groups.map((g) => (
                    <Fragment key={g.type}>
                      {g.accts.map((a) => <td key={a.id} className={`${td} text-muted-foreground cursor-help`} title="Individual accounts merge and receive a basis step-up at the second death — only the inherited-bucket subtotals are tracked over the 10-year SECURE horizon.">—</td>)}
                      <td key={`${g.type}-sub`} className={`${td} font-semibold text-[#4A6741] border-l border-[#EBE8E0]`}>{num(p[g.bucket])}</td>
                    </Fragment>
                  ))}
                  <td className={`${td} font-bold border-l-2 border-[#4A6741]`}>{num(p.total_to_heirs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-6 pb-4 text-[11px] text-muted-foreground">
          Rows shaded orange are the 10-year SECURE horizon after the second death — individual accounts have merged/stepped-up, so only the inherited-bucket subtotals are shown.
        </p>
      </Card>

      {/* Cashflow */}
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
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto px-2 pb-4">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#F9F8F6] z-10">
              <tr className="border-b border-[#EBE8E0] text-[#5A5A5A]">
                <th className="px-2 py-2 text-left font-semibold sticky left-0 bg-[#F9F8F6]">Year</th>
                {CF_COLS.map(([k, l]) => (
                  <th key={k} className={`${th} ${k === "from_cash" ? "border-l border-[#EBE8E0]" : ""} ${k === "surplus" ? "border-l-2 border-[#4A6741] text-[#1A1A1A]" : ""}`}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year} className="border-b border-[#F0EEE8] hover:bg-[#F9F8F6]" data-testid={`cf-row-${r.year}`}>
                  <td className="px-2 py-1.5 text-left font-medium sticky left-0 bg-white">{r.year}</td>
                  {CF_COLS.map(([k]) => {
                    const v = r.cashflow?.[k];
                    const isSurplus = k === "surplus";
                    return (
                      <td key={k} className={`${td} ${k === "from_cash" ? "border-l border-[#EBE8E0]" : ""} ${isSurplus ? `border-l-2 border-[#4A6741] font-semibold ${v < 0 ? "text-[#C87941]" : "text-[#4A6741]"}` : ""}`}>
                        {v == null ? "—" : num(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-6 pb-4 text-[11px] text-muted-foreground">
          "← Cash / Taxable / IRA / Roth" are discretionary withdrawals drawn to fund the year's shortfall (income covers spending first). Positive surplus is swept to the taxable brokerage.
        </p>
      </Card>
    </div>
  );
};
