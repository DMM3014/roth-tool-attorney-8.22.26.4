import { useMemo } from "react";
import { fmtUSD } from "@/lib/api";
import { Page, H2, P, Sub } from "./helpers";

export const CashFlowPage = ({ rows, ...footProps }) => {
  const cashRows = useMemo(() => rows.map((r) => {
    const cf = r.cashflow || {};
    const income = (cf.wages_pension || 0) + (cf.gross_ss || 0) + (cf.dividends || 0)
                 + (cf.interest || 0) + (cf.rmd || 0);
    const withdrawals = (cf.from_cash || 0) + (cf.from_taxable || 0) + (cf.from_ira || 0) + (cf.from_roth || 0);
    const expenses = (cf.expenses || 0) + (cf.income_tax || 0) + (cf.medicare || 0);
    // Surplus / (Shortfall) is measured BEFORE portfolio withdrawals — i.e. does
    // recurring income cover the year's spending and taxes? Adding withdrawals back
    // in made the column always net to ~zero, so a shortfall could never print
    // negative. `cf.surplus` is the engine's ground-truth reconciler for this.
    const surplus = cf.surplus != null ? cf.surplus : income - expenses;
    return { year: r.year, income, withdrawals, expenses, surplus };
  }), [rows]);

  // Cap table to first ~24 years so it fits on one page. If more, sample every-other-year.
  const display = cashRows.length > 24 ? cashRows.filter((_, i) => i % 2 === 0) : cashRows;

  return (
    <Page testid="cr-page-cashflow" {...footProps}>
      <H2>Cash Flow</H2>
      <P>
        A year-by-year picture of the money flowing in and the money flowing out. Income covers Social Security,
        pensions, dividends, interest, and any Required Minimum Distributions. Withdrawals cover the amounts
        pulled from cash, taxable brokerage, IRA, or Roth to fill any shortfall. Expenses roll everything
        together — living costs, taxes, and Medicare. The final column compares income with expenses
        <em> before</em> any portfolio withdrawal: a figure in parentheses is the shortfall the portfolio had to
        cover that year.
      </P>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5, marginTop: 4 }} data-testid="cr-cashflow-table">
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", textAlign: "right", color: "#5A5A5A" }}>
            <th style={{ padding: "5px 4px", textAlign: "left" }}>Year</th>
            <th style={{ padding: "5px 4px" }}>Income</th>
            <th style={{ padding: "5px 4px" }}>Withdrawals</th>
            <th style={{ padding: "5px 4px" }}>Expenses</th>
            <th style={{ padding: "5px 4px" }}>Surplus / (Shortfall)</th>
          </tr>
        </thead>
        <tbody>
          {display.map((r) => (
            <tr key={r.year} style={{ borderBottom: "1px solid #F3F1EC" }}>
              <td style={{ padding: "4px 4px", fontWeight: 600 }}>{r.year}</td>
              <td style={{ padding: "4px 4px", textAlign: "right" }}>{fmtUSD(r.income)}</td>
              <td style={{ padding: "4px 4px", textAlign: "right" }}>{fmtUSD(r.withdrawals)}</td>
              <td style={{ padding: "4px 4px", textAlign: "right" }}>{fmtUSD(r.expenses)}</td>
              <td style={{
                padding: "4px 4px", textAlign: "right", fontWeight: 700,
                color: r.surplus < 0 ? "#B84A4A" : "#4A6741",
              }}>
                {r.surplus < 0 ? `(${fmtUSD(Math.abs(r.surplus))})` : fmtUSD(r.surplus)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Sub>
        {cashRows.length > 24
          ? `Showing every other year to keep this table on one page (${cashRows.length} years total). See the Cashflow tab for the full year-by-year detail. Surplus / (Shortfall) is income minus expenses before portfolio withdrawals — a number in parentheses is filled by the Withdrawals column.`
          : "Surplus in green means recurring income covered the household's bills and taxes that year on its own. A figure in parentheses (red) is a shortfall, filled by the portfolio withdrawals shown in the Withdrawals column."}
      </Sub>
    </Page>
  );
};
