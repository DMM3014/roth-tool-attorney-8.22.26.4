import { fmtUSD, fmtPct } from "@/lib/api";
import { Page, H2, H3, P, Sub } from "./helpers";

/**
 * InputsAppendixPage — the "here are the exact numbers the plan was built on"
 * appendix. Advisor request: clients repeatedly ask "what did you put in?" and
 * a compact appendix that snapshots every scenario input closes that loop.
 *
 * Income streams and expenses are LINE-ITEM ARRAYS on the scenario (each with
 * its own amount, frequency, window and inflation), so both are rendered as
 * itemized tables with an annualized year-one total — an earlier version read
 * `expenses.annual` off an object that never existed and printed $0 while the
 * body of the report modeled substantial spending.
 *
 * Everything is derived from the `scenario` prop; no side effects, no fetches.
 * Advisors can hide the entire page via the Client Report customization card.
 */

const th = { padding: "4px 6px", textAlign: "left" };
const thR = { padding: "4px 6px", textAlign: "right" };
const td = { padding: "4px 6px" };
const tdR = { padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const headRow = {
  borderBottom: "1px solid #C4A64A", color: "#5A5A5A", fontSize: 8.5,
  textTransform: "uppercase", letterSpacing: 0.4,
};

const annualize = (amount, frequency) => {
  const a = Number(amount) || 0;
  const f = String(frequency || "Annual").toLowerCase();
  if (f.startsWith("month")) return a * 12;
  if (f.startsWith("quarter")) return a * 4;
  if (f.startsWith("semi")) return a * 2;
  if (f.startsWith("week")) return a * 52;
  return a;
};

const windowLabel = (item) => {
  const start = item.start_year || (item.start_date ? String(item.start_date).slice(0, 4) : null);
  const stop = item.stop_year || item.end_year
    || (item.stop_date ? String(item.stop_date).slice(0, 4) : null);
  if (!start && !stop) return "—";
  return `${start || "—"} → ${stop || "ongoing"}`;
};

const Table = ({ rows, testid }) => (
  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginTop: 6, marginBottom: 10 }}
         data-testid={testid}>
    <tbody>
      {rows.filter(Boolean).map(([label, value], i) => (
        <tr key={i} style={{ borderBottom: "1px solid #F3F1EC" }}>
          <td style={{ padding: "4px 6px", color: "#5A5A5A", width: "45%" }}>{label}</td>
          <td style={{ padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                       color: "#1A1A1A", fontWeight: 500 }}>
            {value == null || value === "" ? "—" : String(value)}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const AccountsTable = ({ accounts }) => (
  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5, marginTop: 6, marginBottom: 10 }}
         data-testid="cr-inputs-accounts-table">
    <thead>
      <tr style={headRow}>
        <th style={th}>Account</th>
        <th style={th}>Owner</th>
        <th style={th}>Tax Type</th>
        <th style={thR}>Balance</th>
        <th style={thR}>Basis</th>
        <th style={thR}>Return</th>
      </tr>
    </thead>
    <tbody>
      {(accounts || []).map((a, i) => (
        <tr key={a.id || i} style={{ borderBottom: "1px solid #F3F1EC" }}>
          <td style={td}>{a.name || a.id}</td>
          <td style={td}>{a.owner || "—"}</td>
          <td style={td}>{a.tax_type || "—"}</td>
          <td style={tdR}>{fmtUSD(a.beginning_balance || 0)}</td>
          <td style={tdR}>{a.tax_type === "Taxable" ? fmtUSD(a.cost_basis || 0) : "—"}</td>
          <td style={tdR}>{a.return != null ? fmtPct(a.return) : "—"}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const LineItemTable = ({ items, firstCol, rateLabel, rateKey, testid, totalLabel }) => {
  const active = items.filter((it) => it.use !== false);
  const total = active.reduce((t, it) => t + annualize(it.amount, it.frequency), 0);
  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9.5, marginTop: 6 }}
             data-testid={testid}>
        <thead>
          <tr style={headRow}>
            <th style={th}>{firstCol}</th>
            <th style={th}>Owner</th>
            <th style={thR}>Amount</th>
            <th style={th}>Frequency</th>
            <th style={thR}>Annualized</th>
            <th style={th}>Years</th>
            <th style={thR}>{rateLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id || i} style={{ borderBottom: "1px solid #F3F1EC",
                                          opacity: it.use === false ? 0.5 : 1 }}>
              <td style={td}>
                {it.category || it.description || it.name || it.type || "—"}
                {it.use === false && <span style={{ color: "#8A8578" }}> (excluded)</span>}
              </td>
              <td style={td}>{it.owner || "—"}</td>
              <td style={tdR}>{fmtUSD(it.amount || 0)}</td>
              <td style={td}>{it.frequency || "Annual"}</td>
              <td style={tdR}>{fmtUSD(annualize(it.amount, it.frequency))}</td>
              <td style={td}>{windowLabel(it)}</td>
              <td style={tdR}>{it[rateKey] != null ? fmtPct(it[rateKey]) : "—"}</td>
            </tr>
          ))}
          <tr style={{ borderTop: "1px solid #C4A64A", background: "#F9F8F6", fontWeight: 700 }}>
            <td style={td} colSpan={4}>{totalLabel}</td>
            <td style={tdR}>{fmtUSD(total)}</td>
            <td style={td} colSpan={2}></td>
          </tr>
        </tbody>
      </table>
    </>
  );
};

export const InputsAppendixPage = ({ scenario, ...footProps }) => {
  const h = scenario?.household || {};
  const proj = scenario?.projection || {};
  const tax = scenario?.tax || {};
  const roth = scenario?.roth || {};
  const legacy = scenario?.legacy || {};
  const wd = scenario?.withdrawal || {};
  const rebal = scenario?.rebalance_cadence || proj?.rebalance_cadence || "annual";
  const accts = scenario?.accounts || [];
  const streams = Array.isArray(scenario?.income_streams) ? scenario.income_streams : [];
  const expenses = Array.isArray(scenario?.expenses) ? scenario.expenses : [];
  const fmtRate2 = (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
  // Two printed pages: balances & line items, then the rate/strategy settings.
  // One page could not hold both without the PDF exporter shrinking the text.
  const foot = (i) => ({
    ...footProps,
    pageNo: footProps.pageNo != null ? footProps.pageNo + i : undefined,
  });

  return (
    <>
    <Page testid="cr-page-inputs-appendix" {...foot(0)}>
      <H2>Appendix — Client Inputs</H2>
      <P>
        The full set of scenario inputs the plan was built on. Every projection, chart, and dollar figure in
        this report is derived from the numbers below. Amounts are entered at their stated frequency and shown
        annualized in first-year dollars; each line then inflates at its own rate over its own active window.
        If any of these values changes, ask your advisor to rerun the plan.
      </P>

      <H3>Household</H3>
      <Table testid="cr-inputs-household-table" rows={[
        ["Client name", h.client_name],
        ["Client year of birth", h.client_dob_year],
        ["Client life expectancy", h.client_life_expectancy],
        h.spouse_name && ["Spouse name", h.spouse_name],
        h.spouse_dob_year && ["Spouse year of birth", h.spouse_dob_year],
        h.spouse_life_expectancy && ["Spouse life expectancy", h.spouse_life_expectancy],
        ["Filing status", h.filing_status || tax.filing_status || (h.spouse_name ? "Married Filing Jointly" : "Single")],
        ["State", tax.state_code || tax.state || "—"],
      ]} />

      <H3>Accounts</H3>
      <AccountsTable accounts={accts} />

      {streams.length > 0 && (
        <>
          <H3>Income Streams</H3>
          <LineItemTable items={streams} firstCol="Source" rateLabel="COLA" rateKey="cola"
                         testid="cr-inputs-income-table"
                         totalLabel="Total annualized income (first year, active lines)" />
        </>
      )}
    </Page>

    {/* ---- Page 2: expenses, rates, Roth strategy, projection settings ---- */}
    <Page testid="cr-page-inputs-appendix-2" {...foot(1)}>
      <H2>Appendix — Client Inputs (continued)</H2>

      <H3>Expenses</H3>
      {expenses.length === 0 && (
        <P>No expense line items are defined on this scenario.</P>
      )}
      {expenses.length > 0 && (
        <LineItemTable items={expenses} firstCol="Category" rateLabel="Inflation" rateKey="inflation"
                       testid="cr-inputs-expenses-table"
                       totalLabel="Total annualized living expenses (first year, active lines)" />
      )}

      <H3>Tax Settings</H3>
      <Table testid="cr-inputs-tax-table" rows={[
        ["Federal filing status", h.filing_status || tax.filing_status || "—"],
        ["State code", tax.state_code || tax.state || "—"],
        tax.state_rate != null && ["State rate (flat, held constant)", fmtRate2(tax.state_rate)],
        ["IRMAA modeled", tax.include_irmaa === false ? "No" : "Yes"],
        ["Heirs' federal marginal rate (assumed)", legacy.heir_federal_rate != null ? fmtPct(legacy.heir_federal_rate) : "—"],
        ["Heirs' state marginal rate (assumed)", legacy.heir_state_rate != null ? fmtPct(legacy.heir_state_rate) : "—"],
        ["Heirs' combined marginal (used in report)",
         fmtPct((legacy.heir_federal_rate || 0) + (legacy.heir_state_rate || 0))],
      ]} />

      <H3>Roth Strategy</H3>
      <Table testid="cr-inputs-roth-table" rows={[
        ["Enabled", roth.enabled ? "Yes" : "No"],
        roth.enabled && ["Fill target bracket", roth.target_bracket != null ? `${fmtPct(roth.target_bracket)} marginal` : "—"],
        roth.enabled && ["Permitted window", `${roth.start_year || "—"} – ${roth.end_year || "—"}`],
        roth.enabled && roth.max_annual ? ["Annual cap", fmtUSD(roth.max_annual)] : null,
        ["Funding order (withdrawals)", wd.funding_order || "Cash → Taxable → IRA → Roth"],
      ]} />
      <Sub>
        The permitted window is the span the strategy is <em>allowed</em> to convert in — not a forecast that a
        conversion happens in every one of those years. See &ldquo;Planned Roth Conversions by Year&rdquo; for
        the years the model actually converts, which end earlier once the Traditional IRA is exhausted.
      </Sub>

      <H3>Projection Settings</H3>
      <Table testid="cr-inputs-projection-table" rows={[
        ["Start year", proj.start_year],
        ["End year", proj.end_year],
        ["General inflation", proj.general_inflation != null ? fmtPct(proj.general_inflation) : "—"],
        ["Bracket indexing", proj.bracket_indexing != null ? fmtPct(proj.bracket_indexing) : "—"],
        ["IRMAA indexing", proj.irmaa_indexing != null ? fmtPct(proj.irmaa_indexing) : "—"],
        ["Dividend yield (taxable)", scenario?.dividend_yield != null ? fmtPct(scenario.dividend_yield) : "—"],
        ["SECURE Act post-death horizon", `${legacy.post_death_years ?? 10} years`],
        ["Rebalance cadence", rebal],
      ]} />

      <Sub>
        This appendix is deliberately included by default. If you prefer to share only the analytical
        sections with a client, an advisor can toggle it off in the Client Report customization card.
      </Sub>
    </Page>
    </>
  );
};

export default InputsAppendixPage;
