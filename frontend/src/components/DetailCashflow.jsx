import { useEffect, useState, Fragment } from "react";
import { Download, Wallet, Table2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runProjection, downloadCSV, fmtUSD } from "@/lib/api";

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

  useEffect(() => {
    runProjection(scenario).then(setData);
  }, [scenario]);

  if (!data) {
    return <div className="py-20 text-center text-muted-foreground animate-pulse label-cap">Running projection…</div>;
  }

  const rows = data.rows;
  const lastYear = rows.length ? rows[rows.length - 1].year : 2062;
  const postRows = data.legacy?.post_death_rows || [];

  // group accounts by tax type, in display order
  const groups = TYPE_GROUPS.map((g) => ({
    ...g,
    accts: (scenario.accounts || []).filter((a) => a.tax_type === g.type),
  })).filter((g) => g.accts.length > 0);

  // ---------- Account Detail table ----------
  const acctSubtotal = (row, g) => g.accts.reduce((s, a) => s + (row.account_balances?.[a.id] || 0), 0);

  const acctCsv = () => {
    const out = [];
    rows.forEach((r) => {
      const rec = { year: r.year };
      groups.forEach((g) => {
        g.accts.forEach((a) => { rec[a.name] = r.account_balances?.[a.id] ?? ""; });
        rec[`${g.label} Total`] = acctSubtotal(r, g);
      });
      rec["Net Worth"] = r.net_worth;
      out.push(rec);
    });
    postRows.forEach((p) => {
      const rec = { year: `${lastYear + p.year_after_death} (heirs +${p.year_after_death})` };
      groups.forEach((g) => {
        g.accts.forEach((a) => { rec[a.name] = ""; });
        rec[`${g.label} Total`] = p[g.bucket] ?? "";
      });
      rec["Net Worth"] = p.total_to_heirs;
      out.push(rec);
    });
    downloadCSV(out, "account_detail.csv");
  };

  // ---------- Cashflow table ----------
  const CF_COLS = [
    ["wages_pension", "Wages / Pension"], ["gross_ss", "Gross SS"], ["taxable_ss", "Taxable SS"],
    ["dividends", "Dividends"], ["interest", "Interest"], ["rmd", "RMD"], ["conversion", "Roth Conv."],
    ["expenses", "Expenses"], ["income_tax", "Income Tax"], ["medicare", "Medicare+IRMAA"],
    ["from_cash", "← Cash"], ["from_taxable", "← Taxable"], ["from_ira", "← IRA"], ["from_roth", "← Roth"],
    ["surplus", "Surplus / (Short)"],
  ];
  const cfCsv = () => {
    downloadCSV(rows.map((r) => ({ year: r.year, ...CF_COLS.reduce((o, [k, l]) => ({ ...o, [l]: r.cashflow?.[k] ?? "" }), {}) })), "cashflow.csv");
  };

  const th = "px-2 py-2 text-right font-semibold whitespace-nowrap";
  const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-10">
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
                      {g.accts.map((a) => <td key={a.id} className={`${td} text-muted-foreground`}>—</td>)}
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
