import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub } from "./helpers";

// Coordinated claiming — shows the SS Optimizer sweep result: winner card + ranked table.
// `ssResult` is the API response from /api/ss-optimizer (or null if not run yet).
export const CoordinatedClaimingPage = ({ ssResult, ...footProps }) => {
  const best = ssResult?.best;
  const baseline = ssResult?.baseline;
  const ranked = ssResult?.ranked || [];
  const delta = best && baseline ? best.after_tax_estate - baseline.after_tax_estate : 0;

  if (!ssResult) {
    return (
      <Page testid="ssr-page-coordinated" {...footProps}>
        <H2>Household Coordinated Claiming</H2>
        <P>
          Run the Social Security sweep on the &ldquo;SS Optimizer&rdquo; tab to populate this page with a full
          16-pair analysis of every combination of Client × Spouse claim ages at 62 / 65 / 67 / 70. The report will
          then show the leading pair — the one that maximizes <strong>after-tax legacy at the second death</strong>,
          not just the highest lifetime SS check.
        </P>
        <Sub>
          The sweep runs the entire projection (income, taxes, RMDs, IRMAA, Roth conversions, second-death mechanics)
          for each of the 16 pairs, so the ranking reflects the whole household picture — not the SS check in isolation.
        </Sub>
      </Page>
    );
  }

  return (
    <Page testid="ssr-page-coordinated" {...footProps}>
      <H2>Household Coordinated Claiming</H2>
      <P>
        Below is the full 16-pair sweep of Client × Spouse claim ages. The ranking objective is
        <strong> after-tax legacy at the second death</strong> — meaning the sweep runs the entire projection
        (income, taxes, RMDs, IRMAA, Roth conversions, second-death mechanics) for each pair and picks the one that
        leaves the most to heirs on an after-tax basis.
      </P>

      {best && (
        <>
          <H3>Leading claim pair</H3>
          <div style={{
            background: "linear-gradient(135deg, #4A67410D 0%, #4A67411A 100%)",
            border: "1px solid #4A6741", borderRadius: 8, padding: "14px 16px", marginBottom: 12,
          }}>
            <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700 }}>
              Optimal
            </div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 700, marginTop: 3, color: "#1A1A1A" }}
                 data-testid="ssr-coord-winner-label">
              {best.label}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: "#5A5A5A" }}>After-tax legacy</div>
                <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, color: "#4A6741" }}>
                  {fmtUSD(best.after_tax_estate)}
                </div>
                <div style={{ fontSize: 8.5, color: delta >= 0 ? "#4A6741" : "#B84A4A", fontWeight: 700 }}>
                  {delta >= 0 ? "+" : ""}{fmtUSD(delta)} vs current
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#5A5A5A" }}>Lifetime SS collected</div>
                <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, color: "#1A1A1A" }}>
                  {fmtUSD(best.lifetime_ss)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#5A5A5A" }}>Lifetime tax</div>
                <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, color: "#C87941" }}>
                  {fmtUSD(best.lifetime_taxes)}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <H3>All 16 combinations ranked</H3>
      <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #EBE8E0", background: "#F9F8F6" }}>
            <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 700, color: "#5A5A5A" }}>#</th>
            <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 700, color: "#5A5A5A" }}>Client</th>
            <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 700, color: "#5A5A5A" }}>Spouse</th>
            <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, color: "#5A5A5A" }}>After-tax legacy</th>
            <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, color: "#5A5A5A" }}>Lifetime SS</th>
            <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, color: "#5A5A5A" }}>Lifetime tax</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => (
            <tr key={`${r.client_age}-${r.spouse_age}`}
                style={{
                  borderBottom: "1px solid #F3F1EC",
                  background: i === 0 ? "#4A67410D" : "transparent",
                }}>
              <td style={{ padding: "4px 6px", fontWeight: i === 0 ? 700 : 400 }}>{i + 1}</td>
              <td style={{ padding: "4px 6px", fontWeight: i === 0 ? 700 : 400 }}>{r.client_age}</td>
              <td style={{ padding: "4px 6px", fontWeight: i === 0 ? 700 : 400 }}>{r.spouse_age ?? "—"}</td>
              <td style={{ textAlign: "right", padding: "4px 6px", fontWeight: 700, color: i === 0 ? "#4A6741" : "#1A1A1A" }}>{fmtUSD(r.after_tax_estate)}</td>
              <td style={{ textAlign: "right", padding: "4px 6px" }}>{fmtUSD(r.lifetime_ss)}</td>
              <td style={{ textAlign: "right", padding: "4px 6px" }}>{fmtUSD(r.lifetime_taxes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{
        marginTop: 12, padding: "10px 12px", background: "#FFF4E6", border: "1px solid #E5B87A", borderRadius: 8,
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8A5A20", marginBottom: 4 }}>
          &ldquo;Highest lifetime SS&rdquo; is not automatically the best plan
        </div>
        <p style={{ fontSize: 10, color: "#5A4020", lineHeight: 1.55, margin: 0 }}>
          Claiming SS early (62 or 65) generates <strong>ordinary income</strong> before age 70. That income competes
          with your Roth-conversion window for the low 12% and 22% brackets, forcing conversions into higher brackets
          (24%, 32%) or skipping them entirely. The pair that maximizes cumulative SS collected can therefore leave the
          household paying <em>more</em> total tax and delivering <em>less</em> after-tax legacy. That&apos;s why the
          ranking above uses <strong>after-tax legacy at second death</strong> — the metric that reflects the whole
          household picture.
        </p>
      </div>

      <Sub>
        Metric definition: after-tax legacy includes all household net worth at the second death, minus the estimated
        federal + state tax the heirs would owe on inherited Traditional IRA balances under the SECURE Act&apos;s
        10-year distribution rule. Inherited Roth balances continue to compound income-tax free through that same
        10-year window; if retained in trust thereafter, retained income is taxed at compressed trust rates.
      </Sub>
    </Page>
  );
};
