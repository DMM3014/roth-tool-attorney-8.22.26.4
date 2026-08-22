import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub, StaticLegend, useIsolation } from "./helpers";

// ---------------------------------------------------------------------------
// Milestone-year selection: Today, +5, +10, +20, End of plan. Falls back
// gracefully when the plan horizon is short (skips out-of-range milestones).
// ---------------------------------------------------------------------------
const MILESTONE_OFFSETS = [
  { key: "today", label: "Today", offset: 0 },
  { key: "plus5", label: "+5 years", offset: 5 },
  { key: "plus10", label: "+10 years", offset: 10 },
  { key: "plus20", label: "+20 years", offset: 20 },
  { key: "end", label: "End of plan", offset: null },  // last row
];
// `custom` is an array of {name, year} objects (up to 3). Custom milestones are
// merged after the fixed +5/+10/+20 slots and sorted by year so the table
// columns read chronologically. Milestones falling outside the plan horizon are
// clamped to end-of-plan.
const pickMilestoneRows = (rows, custom = []) => {
  if (!rows.length) return [];
  const y0 = rows[0].year;
  const endRow = rows[rows.length - 1];
  const fixed = MILESTONE_OFFSETS.map(({ key, label, offset }) => {
    const target = offset == null ? endRow.year : y0 + offset;
    const row = rows.find((r) => r.year === target) || (target > endRow.year ? endRow : null);
    return { key, label, year: row?.year, row };
  });
  const customPicks = (custom || [])
    .filter((c) => c && c.name && Number.isFinite(Number(c.year)))
    .slice(0, 3)
    .map((c, i) => {
      const target = Math.max(y0, Math.min(endRow.year, Number(c.year)));
      const row = rows.find((r) => r.year === target) || endRow;
      return { key: `custom-${i}`, label: String(c.name).slice(0, 24), year: row.year, row };
    });
  // Merge and sort chronologically, but ALWAYS keep Today (offset 0) as the first column
  // and End of plan as the last so the reading order stays intuitive.
  const midSlots = [...fixed.slice(1, -1), ...customPicks].filter((m) => m.row);
  midSlots.sort((a, b) => a.year - b.year);
  return [fixed[0], ...midSlots, fixed[fixed.length - 1]].filter((m) => m.row);
};

// Sum an income line-items array by `kind` (both ordinary + preferential
// taxable portions) so we can bucket into the reference PDF's categories.
const sumByKind = (items, kinds) => items
  .filter((li) => kinds.includes(li.kind))
  .reduce((s, li) => s + (li.taxable_ordinary || 0) + (li.taxable_preferential || 0), 0);

const sumExpenseCat = (items, cats) => items
  .filter((li) => cats.includes(li.category))
  .reduce((s, li) => s + (li.amount || 0), 0);

// -- Compact table primitives (shared style between the two milestone tables).
const thL = { padding: "5px 6px", textAlign: "left", fontSize: 9,
              fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: "#5A5A5A" };
const thR = { ...thL, textAlign: "right" };
const tdL = { padding: "4px 6px", fontSize: 10 };
const tdR = { padding: "4px 6px", fontSize: 10, textAlign: "right",
              fontVariantNumeric: "tabular-nums" };
const sectionRowStyle = { background: "#F3F1EC" };
const totalRowStyle = { background: "#F1F5EF", fontWeight: 700, borderTop: "1px solid #4A6741" };

export const IncomeExpensesPage = ({ incomeData, rows, customMilestones, stateExclusions, ...footProps }) => {
  const expCategoryData = useMemo(() => rows.map((r) => {
    const li = r.line_items || {};
    const totals = {};
    (li.expenses || []).forEach((e) => {
      const cat = e.category || "other";
      totals[cat] = (totals[cat] || 0) + (e.amount || 0);
    });
    return { year: r.year, ...totals };
  }), [rows]);

  const cats = ["spending", "housing", "health", "insurance", "gift", "taxes", "other"];
  const catColors = {
    spending: "#7A9B76", housing: "#4A6741", health: "#C4A64A",
    insurance: "#B8B4A8", gift: "#8A6820", taxes: "#C87941", other: "#5A5A5A",
  };

  // ---- Milestone tables: cash-flow + federal taxable income by source ------
  const milestones = useMemo(() => pickMilestoneRows(rows, customMilestones),
    [rows, customMilestones]);

  // State exclusion map (hoisted here so all downstream useMemo hooks can reference it).
  // The projection engine models state tax as (state_rate × federal taxable income),
  // so this is display-only — it zeros excluded buckets in the state-taxable chart and
  // milestone row.
  const excl = stateExclusions || { ss: true, pension: false, rmds: false };

  // Cash flow rows: pull straight from row.cashflow (numeric) + row.line_items.expenses
  // (bucketed by category).
  const cashFlowRows = useMemo(() => milestones.map(({ label, year, row }) => {
    const cf = row.cashflow || {};
    const li = row.line_items || {};
    const exp = li.expenses || [];
    // Withdrawals = anything pulled out of an account to meet spending needs.
    const withdrawals = (cf.from_cash || 0) + (cf.from_taxable || 0)
                        + (cf.from_ira || 0) + (cf.from_roth || 0);
    const income = {
      "Wages & Pension": cf.wages_pension || 0,
      "Social Security (gross)": cf.gross_ss || 0,
      Dividends: cf.dividends || 0,
      Interest: cf.interest || 0,
      "RMDs": cf.rmd || 0,
      Withdrawals: withdrawals,
    };
    const totalIncome = Object.values(income).reduce((s, v) => s + v, 0);
    const expenses = {
      Spending: sumExpenseCat(exp, ["spending"]),
      Housing: sumExpenseCat(exp, ["housing"]),
      Health: sumExpenseCat(exp, ["health"]),
      Insurance: sumExpenseCat(exp, ["insurance"]),
      Gift: sumExpenseCat(exp, ["gift", "charity"]),
      Taxes: (cf.income_tax || 0) + (cf.medicare || 0),
      Other: sumExpenseCat(exp, ["other"]),
    };
    const totalExpenses = Object.values(expenses).reduce((s, v) => s + v, 0);
    return {
      label, year,
      income, totalIncome,
      expenses, totalExpenses,
      net: totalIncome - totalExpenses,
    };
  }), [milestones]);

  // Federal taxable income by source: bucket line_items.income[] by kind and sum
  // (taxable_ordinary + taxable_preferential). Adds Roth-conversion income and
  // the year's Standard Deduction row.
  const fedTaxRows = useMemo(() => milestones.map(({ label, year, row }) => {
    const items = (row.line_items?.income || []);
    const wages = sumByKind(items, ["wages"]);
    const pension = sumByKind(items, ["pension", "annuity"]);
    const interest = sumByKind(items, ["interest"]);
    const dividends = sumByKind(items, ["dividends"]);  // includes realized LTCG + QDIV
    const rmd = sumByKind(items, ["rmd"]);
    const ss = sumByKind(items, ["ss"]);
    const other = sumByKind(items, ["other"]);
    const rothConv = row.roth_conversion || 0;
    const taxableIncome = row.taxable_income || 0;
    // State-taxable approximation = federal taxable minus excluded buckets. Because
    // the standard deduction has already been applied to `taxable_income` we simply
    // subtract the excluded categories directly.
    const excludedTotal = (excl.ss ? ss : 0) + (excl.pension ? pension : 0) + (excl.rmds ? rmd : 0);
    return {
      label, year,
      sources: {
        "Wages": wages,
        "Pension / annuity": pension,
        "Interest": interest,
        "Dividends & LTCG": dividends,
        "RMDs (taxable portion)": rmd,
        "Social Security (taxable)": ss,
        "Other ordinary": other,
        "Roth conversion": rothConv,
      },
      standard_deduction: row.tax_detail?.standard_deduction || 0,
      taxable_income: taxableIncome,
      state_taxable_income: Math.max(0, taxableIncome - excludedTotal),
    };
  }), [milestones, excl]);

  // Year-by-year federal taxable income by source, stacked bar chart data. Same
  // buckets as the milestone table below so the client sees the same story in
  // two ways — a full-horizon visual mix shift + a numeric snapshot at 5 anchor years.
  // Federal-taxable series feeds two things: (a) the stacked chart above the
  // milestone table, and (b) the state-taxable derived series below, which zeros
  // out the buckets excluded by the client's state (stateExclusions prop).
  const fedTaxSeries = useMemo(() => rows.map((r) => {
    const items = (r.line_items?.income || []);
    return {
      year: r.year,
      Wages: sumByKind(items, ["wages"]),
      "Pension / annuity": sumByKind(items, ["pension", "annuity"]),
      Interest: sumByKind(items, ["interest"]),
      "Dividends & LTCG": sumByKind(items, ["dividends"]),
      "RMDs (taxable portion)": sumByKind(items, ["rmd"]),
      "Social Security (taxable)": sumByKind(items, ["ss"]),
      "Other ordinary": sumByKind(items, ["other"]),
      "Roth conversion": r.roth_conversion || 0,
    };
  }), [rows]);
  // State-taxable series: same buckets, but categories flagged in
  // stateExclusions are zeroed out. Since the projection engine models state
  // tax as (state_rate × federal taxable income), this chart is display-only
  // — it visualizes WHAT the state would tax IF the exclusions applied. Actual
  // state tax in the projection is unchanged.
  const stateTaxSeries = useMemo(() => fedTaxSeries.map((r) => ({
    year: r.year,
    Wages: r.Wages,
    "Pension / annuity": excl.pension ? 0 : r["Pension / annuity"],
    Interest: r.Interest,
    "Dividends & LTCG": r["Dividends & LTCG"],
    "RMDs (taxable portion)": excl.rmds ? 0 : r["RMDs (taxable portion)"],
    "Social Security (taxable)": excl.ss ? 0 : r["Social Security (taxable)"],
    "Other ordinary": r["Other ordinary"],
    "Roth conversion": r["Roth conversion"],
  })), [fedTaxSeries, excl]);
  // Ordering + color palette for the stacked series. Kept identical to the
  // milestone table so the reader's eye can trace the same rows visually.
  const fedTaxColors = {
    Wages: "#4A6741",
    "Pension / annuity": "#7A9B76",
    Interest: "#B8B4A8",
    "Dividends & LTCG": "#C4A64A",
    "RMDs (taxable portion)": "#C87941",
    "Social Security (taxable)": "#8A6820",
    "Other ordinary": "#5A5A5A",
    "Roth conversion": "#7A5C7E",
  };
  const fedTaxSeriesHasData = fedTaxSeries.some((r) =>
    Object.entries(r).some(([k, v]) => k !== "year" && Math.abs(v || 0) > 0.5));

  const incomeIso = useIsolation();
  const expensesIso = useIsolation();
  const fedTaxIso = useIsolation();
  const stateTaxIso = useIsolation();

  // This section spans THREE printed pages (charts / milestone cash-flow table /
  // taxable-income detail). Everything used to sit on one <Page>, which grew to
  // ~2,000px — nearly twice the printable height — and the PDF exporter squeezed
  // it to fit, producing the squished text advisors reported. `foot(i)` offsets
  // the page number the parent handed us.
  const foot = (i) => ({
    ...footProps,
    pageNo: footProps.pageNo != null ? footProps.pageNo + i : undefined,
  });

  return (
    <>
    <Page testid="cr-page-income-expenses" {...foot(0)}>
      <H2>Income &amp; Expenses</H2>
      <P>
        Where the money comes from and where it goes, year by year. Income sources are stacked so you can see how
        the mix shifts — Social Security starts up, RMDs kick in, and portfolio withdrawals fill in whatever&apos;s
        left. Expenses include everyday spending, insurance, health care, and the taxes and Medicare premiums the
        model calculates from your other decisions.
      </P>

      <H3>Sources of income</H3>
      <div style={{ height: 175 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={incomeData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={42} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Bar dataKey="Wages & Pension" stackId="i" fill="#4A6741" isAnimationActive={false} {...incomeIso.dim("Wages & Pension")} />
            <Bar dataKey="SocialSecurity" stackId="i" fill="#7A9B76" isAnimationActive={false} {...incomeIso.dim("SocialSecurity")} />
            <Bar dataKey="Dividends" stackId="i" fill="#C4A64A" isAnimationActive={false} {...incomeIso.dim("Dividends")} />
            <Bar dataKey="Interest" stackId="i" fill="#B8B4A8" isAnimationActive={false} {...incomeIso.dim("Interest")} />
            <Bar dataKey="RMD" stackId="i" fill="#C87941" isAnimationActive={false} {...incomeIso.dim("RMD")} />
            <Bar dataKey="Withdrawals" stackId="i" fill="#8A6820" isAnimationActive={false} {...incomeIso.dim("Withdrawals")} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={[
          { label: "Wages & Pension", color: "#4A6741", dataKey: "Wages & Pension" },
          { label: "SocialSecurity", color: "#7A9B76", dataKey: "SocialSecurity" },
          { label: "Dividends", color: "#C4A64A", dataKey: "Dividends" },
          { label: "Interest", color: "#B8B4A8", dataKey: "Interest" },
          { label: "RMD", color: "#C87941", dataKey: "RMD" },
          { label: "Withdrawals", color: "#8A6820", dataKey: "Withdrawals" },
        ]}
        isolated={incomeIso.isolated}
        onToggle={incomeIso.toggle}
        testid="cr-income-sources-legend"
      />

      <H3>Expenses by category</H3>
      <div style={{ height: 175 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={expCategoryData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={42} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            {cats.map((c) => (
              <Bar key={c} dataKey={c} stackId="e" fill={catColors[c]} isAnimationActive={false} {...expensesIso.dim(c)} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={cats.map((c) => ({ label: c, color: catColors[c], dataKey: c }))}
        isolated={expensesIso.isolated}
        onToggle={expensesIso.toggle}
        testid="cr-expenses-legend"
      />

      <Sub>
        Income excludes Roth conversions (those are internal transfers, not new dollars). Expenses include income
        tax and Medicare/IRMAA premiums, which are outputs of the tax model — they respond to every other decision
        the plan makes.
      </Sub>
    </Page>

    {/* ---- Page 2: milestone cash-flow snapshot ---- */}
    <Page testid="cr-page-income-expenses-milestones" {...foot(1)}>
      <H2>Income &amp; Expenses — Milestone Years</H2>
      <P>
        The same story as a numeric snapshot at five anchor years, so you can see the mix shift rather than infer it
        from the charts. &ldquo;Withdrawals&rdquo; is whatever the portfolio had to supply after recurring income
        was applied to that year&apos;s spending and taxes.
      </P>
      {/* Milestone snapshot tables — Today / +5 / +10 / +20 / End of plan */}
      {cashFlowRows.length > 0 && (
        <>
          <H3>Sources of income &amp; spending at milestone years</H3>
          <table data-testid="cr-milestone-cashflow"
                 style={{ width: "100%", borderCollapse: "collapse", marginTop: 4, marginBottom: 10 }}>
            <thead>
              <tr>
                <th style={thL}>Line item</th>
                {cashFlowRows.map((c) => (
                  <th key={c.label} style={thR}>{c.label}<br/><span style={{ fontWeight: 400, color: "#8A8A82" }}>{c.year}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={sectionRowStyle}>
                <td style={{ ...tdL, fontWeight: 600, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.3, color: "#4A6741" }}
                    colSpan={cashFlowRows.length + 1}>Income</td>
              </tr>
              {Object.keys(cashFlowRows[0].income).map((k) => (
                <tr key={k} style={{ borderBottom: "1px solid #F3F1EC" }}>
                  <td style={tdL}>{k}</td>
                  {cashFlowRows.map((c) => (
                    <td key={c.label} style={tdR}>{c.income[k] > 0 ? fmtUSD(c.income[k]) : "—"}</td>
                  ))}
                </tr>
              ))}
              <tr style={totalRowStyle}>
                <td style={tdL}>Total income</td>
                {cashFlowRows.map((c) => (
                  <td key={c.label} style={tdR}>{fmtUSD(c.totalIncome)}</td>
                ))}
              </tr>

              <tr style={sectionRowStyle}>
                <td style={{ ...tdL, fontWeight: 600, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.3, color: "#C87941" }}
                    colSpan={cashFlowRows.length + 1}>Spending</td>
              </tr>
              {Object.keys(cashFlowRows[0].expenses).map((k) => (
                <tr key={k} style={{ borderBottom: "1px solid #F3F1EC" }}>
                  <td style={tdL}>{k}</td>
                  {cashFlowRows.map((c) => (
                    <td key={c.label} style={tdR}>{c.expenses[k] > 0 ? fmtUSD(c.expenses[k]) : "—"}</td>
                  ))}
                </tr>
              ))}
              <tr style={{ ...totalRowStyle, borderTop: "1px solid #C87941" }}>
                <td style={tdL}>Total spending</td>
                {cashFlowRows.map((c) => (
                  <td key={c.label} style={tdR}>{fmtUSD(c.totalExpenses)}</td>
                ))}
              </tr>

              <tr style={{ background: "#4A67410D", fontWeight: 700, borderTop: "2px solid #4A6741" }}>
                <td style={tdL}>Net cash flow</td>
                {cashFlowRows.map((c) => (
                  <td key={c.label} style={{ ...tdR, color: c.net >= 0 ? "#4A6741" : "#B84A4A" }}>
                    {c.net >= 0 ? fmtUSD(c.net) : `(${fmtUSD(Math.abs(c.net))})`}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          <Sub>
            Net cash flow in parentheses means recurring income did not cover that year&apos;s spending and taxes on
            its own — the gap is filled by the withdrawals shown in the Income block above.
          </Sub>
        </>
      )}
    </Page>

    {/* ---- Page 3: taxable income by source (federal + state) ---- */}
    <Page testid="cr-page-taxable-income" {...foot(2)}>
      <H2>Taxable Income by Source</H2>
      <P>
        What actually lands on the tax return, year by year and at the same milestone years. Federal taxable income
        drives the bracket math; the state view repeats the same buckets with the categories your state exempts
        zeroed out.
      </P>
      {fedTaxRows.length > 0 && (
        <>
          <H3>Federal taxable income by source (milestone years)</H3>
          {fedTaxSeriesHasData && (
            <>
              <p style={{ fontSize: 10, color: "#5A5A5A", margin: "2px 0 4px" }}>
                Year-by-year mix of what shows up on the family&apos;s 1040 as taxable income. Roth conversions appear as
                a plum band during the conversion window — they are gone from the stack once the window closes.
              </p>
              <div style={{ height: 175 }} data-testid="cr-fedtax-stacked-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fedTaxSeries} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
                    <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={42} tickLine={false} />
                    <Tooltip formatter={(v) => fmtUSD(v)} />
                    {Object.keys(fedTaxColors).map((k) => (
                      <Bar key={k} dataKey={k} stackId="ti" fill={fedTaxColors[k]} isAnimationActive={false}
                        {...fedTaxIso.dim(k)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <StaticLegend
                items={Object.keys(fedTaxColors).map((k) => ({ label: k, color: fedTaxColors[k], dataKey: k }))}
                isolated={fedTaxIso.isolated}
                onToggle={fedTaxIso.toggle}
                testid="cr-fedtax-legend" />
            </>
          )}
          <table data-testid="cr-milestone-fedtax"
                 style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
            <thead>
              <tr>
                <th style={thL}>Source</th>
                {fedTaxRows.map((c) => (
                  <th key={c.label} style={thR}>{c.label}<br/><span style={{ fontWeight: 400, color: "#8A8A82" }}>{c.year}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(fedTaxRows[0].sources).map((k) => (
                <tr key={k} style={{ borderBottom: "1px solid #F3F1EC" }}>
                  <td style={tdL}>{k}</td>
                  {fedTaxRows.map((c) => (
                    <td key={c.label} style={tdR}>{c.sources[k] > 0.5 ? fmtUSD(c.sources[k]) : "—"}</td>
                  ))}
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid #C7C0AC" }}>
                <td style={{ ...tdL, color: "#8A8A82" }}>Standard deduction</td>
                {fedTaxRows.map((c) => (
                  <td key={c.label} style={{ ...tdR, color: "#8A8A82" }}>
                    ({fmtUSD(c.standard_deduction)})
                  </td>
                ))}
              </tr>
              <tr style={totalRowStyle}>
                <td style={tdL}>Taxable income</td>
                {fedTaxRows.map((c) => (
                  <td key={c.label} style={tdR}>{fmtUSD(c.taxable_income)}</td>
                ))}
              </tr>
              <tr style={{ ...totalRowStyle, background: "#7A9B7614", borderTop: "1px solid #7A9B76" }}>
                <td style={tdL}>
                  State taxable income
                  <span style={{ fontSize: 8, color: "#8A8A82", fontWeight: 400, marginLeft: 6 }}>
                    {(() => {
                      const list = [excl.ss && "SS", excl.pension && "pension", excl.rmds && "RMDs"].filter(Boolean);
                      return list.length ? `(${list.join(" + ")} excluded)` : "(no exclusions)";
                    })()}
                  </span>
                </td>
                {fedTaxRows.map((c) => (
                  <td key={c.label} style={tdR}>{fmtUSD(c.state_taxable_income)}</td>
                ))}
              </tr>
            </tbody>
          </table>

          {/* State-taxable stacked chart — mirrors the federal chart but zeros the
              excluded buckets so clients see the state-vs-federal delta visually. */}
          {fedTaxSeriesHasData && (
            <>
              <H3>State taxable income by source</H3>
              <p style={{ fontSize: 10, color: "#5A5A5A", margin: "2px 0 4px" }}>
                Same buckets as the federal chart above, with categories excluded by the client&apos;s
                state zeroed out
                {(excl.ss || excl.pension || excl.rmds)
                  ? ` (${[excl.ss && "Social Security", excl.pension && "pension income", excl.rmds && "RMDs"].filter(Boolean).join(", ")} exempt).`
                  : " (no exclusions configured — state tracks federal)."}
              </p>
              <div style={{ height: 175 }} data-testid="cr-statetax-stacked-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stateTaxSeries} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
                    <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={42} tickLine={false} />
                    <Tooltip formatter={(v) => fmtUSD(v)} />
                    {Object.keys(fedTaxColors).map((k) => (
                      <Bar key={k} dataKey={k} stackId="sti" fill={fedTaxColors[k]} isAnimationActive={false}
                        {...stateTaxIso.dim(k)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <StaticLegend
                items={Object.keys(fedTaxColors).map((k) => ({ label: k, color: fedTaxColors[k], dataKey: k }))}
                isolated={stateTaxIso.isolated}
                onToggle={stateTaxIso.toggle}
                testid="cr-statetax-legend" />
            </>
          )}
        </>
      )}

      <Sub>
        The taxable-income table above <em>does</em> include Roth conversions, since a conversion hits the 1040 as
        ordinary income in the year it happens. The state-taxable line is display-only: the projection engine models
        state tax as a flat rate on federal taxable income, so this view shows what the state <em>would</em> tax if
        the exclusions applied.
      </Sub>
    </Page>
    </>
  );
};
