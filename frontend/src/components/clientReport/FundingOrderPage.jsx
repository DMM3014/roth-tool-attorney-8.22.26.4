import { Page, H2, P, Sub, PvFootnote } from "./helpers";
import {
  FUNDING_ORDER_SHORT, METRIC_ROWS, FUNDING_ORDER_EXPLAINER,
} from "@/lib/fundingOrderRows";

// "Funding Order — The Hidden Lever" — printed comparison of the SAME plan
// (conversions unchanged) under each withdrawal funding order. Placed between
// the Roth Conversions page and the Savings page.
export const FundingOrderPage = ({ data, ...footProps }) => {
  const results = data?.results || [];
  if (!results.length) {
    return (
      <Page testid="cr-page-funding-order" {...footProps}>
        <H2>Funding Order — The Hidden Lever</H2>
        <P>Funding-order comparison is unavailable for this plan.</P>
      </Page>
    );
  }

  const th = { padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" };
  const td = { padding: "4px 8px", textAlign: "right", whiteSpace: "nowrap" };

  return (
    <Page testid="cr-page-funding-order" {...footProps}>
      <H2>Funding Order — The Hidden Lever</H2>
      <P>{FUNDING_ORDER_EXPLAINER[0]}</P>

      <table data-testid="cr-funding-order-table"
        style={{ width: "100%", fontSize: 9.5, borderCollapse: "collapse", marginTop: 6, marginBottom: 10 }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid #4A6741", background: "#F9F8F6" }}>
            <th style={{ padding: "5px 8px", textAlign: "left" }}>Metric</th>
            {results.map((r) => (
              <th key={r.funding_order} style={th}>
                <div style={{ fontWeight: 700 }}>{FUNDING_ORDER_SHORT[r.funding_order] || r.funding_order}</div>
                <div style={{ fontSize: 7.5, fontWeight: 400, color: "#8A8A8A" }}>{r.funding_order}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => (
            <tr key={row.key} data-testid={`cr-funding-order-row-${row.key}`} style={{ borderBottom: "0.5px solid #EDEBE4" }}>
              <td style={{
                padding: row.indent ? "3px 8px 3px 20px" : "4px 8px",
                textAlign: "left",
                color: row.indent ? "#8A8A8A" : "#1A1A1A",
                fontSize: row.indent ? 8.5 : 9.5,
                fontWeight: row.strong ? 700 : 400,
              }}>
                {row.indent ? "— " : ""}{row.label}
              </td>
              {results.map((r) => (
                <td key={r.funding_order} style={{
                  ...td,
                  color: row.indent ? "#8A8A8A" : (row.strong ? "#4A6741" : "#1A1A1A"),
                  fontSize: row.indent ? 8.5 : 9.5,
                  fontWeight: row.strong ? 700 : 400,
                }}>
                  {row.fmt(r[row.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ background: "#F9F8F6", borderLeft: "3px solid #4A6741", padding: "8px 12px", borderRadius: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 10, color: "#4A6741", marginBottom: 4 }}>Why the order matters</div>
        {FUNDING_ORDER_EXPLAINER.slice(1).map((p, i) => (
          <p key={i} style={{ fontSize: 9, lineHeight: 1.5, margin: "0 0 4px", color: "#3A3A3A" }}>{p}</p>
        ))}
      </div>

      <Sub>
        Illustration only. Conversion schedule, spending, returns and longevity are held constant across every
        column; only the withdrawal funding order changes. Federal estate tax is the no-trust (portability-only)
        baseline at the second death. Break-even is the combined ordinary rate beneficiaries would pay at which
        converting and not converting leave heirs equal after-tax wealth.
      </Sub>
      <PvFootnote testid="cr-funding-order-pv-footnote" />
    </Page>
  );
};

export default FundingOrderPage;
