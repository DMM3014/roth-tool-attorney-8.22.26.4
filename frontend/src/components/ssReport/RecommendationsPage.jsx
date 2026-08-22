import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub } from "./helpers";

// Recommendations page - synthesizes the SS optimizer winner + Roth conversion doctrine
// into 3-4 client-facing action bullets.
export const RecommendationsPage = ({ ssResult, scenario, fraAmounts, ...footProps }) => {
  const h = scenario?.household || {};
  const best = ssResult?.best;
  const baseline = ssResult?.baseline;
  const delta = best && baseline ? best.after_tax_estate - baseline.after_tax_estate : 0;
  const cFra = fraAmounts?.Client;
  const sFra = fraAmounts?.Spouse;
  const higherEarnerName = ((cFra || 0) >= (sFra || 0)) ? (h.client_name || "the Client") : (h.spouse_name || "the Spouse");
  const higherClaim = ((cFra || 0) >= (sFra || 0)) ? best?.client_age : best?.spouse_age;

  return (
    <Page testid="ssr-page-recommendations" {...footProps}>
      <H2>Recommendations</H2>

      {best ? (
        <>
          <div style={{
            padding: "14px 16px", background: "#4A67410D", border: "1px solid #4A6741", borderRadius: 8, marginBottom: 14,
          }}>
            <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700 }}>
              Recommended claim pair
            </div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 700, marginTop: 4 }}>
              {best.label}
            </div>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: "#5A5A5A" }}>After-tax legacy vs current plan</div>
                <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, color: delta >= 0 ? "#4A6741" : "#B84A4A" }}>
                  {delta >= 0 ? "+" : ""}{fmtUSD(delta)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#5A5A5A" }}>Lifetime SS collected</div>
                <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700 }}>{fmtUSD(best.lifetime_ss)}</div>
              </div>
            </div>
          </div>

          <H3>Why this pair wins</H3>
          <ol style={{ fontSize: 10.5, lineHeight: 1.6, color: "#2A2A2A", paddingLeft: 20, marginBottom: 8 }}>
            <li>
              <strong>Roth conversion room preserved.</strong> By delaying Social Security to age {higherClaim ?? "70"} for {higherEarnerName},
              you keep the 12%–24% brackets clear during the critical pre-RMD conversion window.
            </li>
            <li>
              <strong>Higher after-tax legacy.</strong> Fewer taxable IRA dollars survive to force heirs into the SECURE-Act
              10-year distribution rule at their peak-earning-years tax brackets.
            </li>
            <li>
              <strong>Survivor protection.</strong> The higher earner&apos;s delayed claim locks in a larger, permanent
              survivor benefit for the widow(er).
            </li>
            <li>
              <strong>Lower lifetime tax.</strong> Even though a delayed claim collects less nominal SS, the household
              pays <strong>{fmtUSD(baseline?.lifetime_taxes - best.lifetime_taxes)}</strong> less in lifetime taxes on
              this pair vs. your current plan.
            </li>
          </ol>
        </>
      ) : (
        <P>
          Run the SS Optimizer sweep on the &ldquo;SS Optimizer&rdquo; tab to see specific numbers for the recommended
          claim pair here.
        </P>
      )}

      <H3>Next steps</H3>
      <ul style={{ fontSize: 10.5, lineHeight: 1.6, color: "#2A2A2A", paddingLeft: 20, marginBottom: 6 }}>
        <li>
          <strong>Apply the leader in your plan.</strong> On the SS Optimizer tab, click &ldquo;Apply optimal pair&rdquo;
          to lock the recommended claim ages into your projection. Rerun the Strategy Optimizer afterward — the widened
          Roth-conversion window may now support a larger conversion schedule than before.
        </li>
        <li>
          <strong>Model IRMAA impact.</strong> Larger pre-SS conversions can trigger IRMAA cliffs 2 years later. Enable
          the IRMAA-aware routing on the Strategy Optimizer to avoid paying premium surcharges you don&apos;t need to.
        </li>
        <li>
          <strong>Coordinate with the estate plan.</strong> Delaying SS also delays the survivor-benefit calculation
          &mdash; make sure your beneficiary designations and any life-insurance replacement strategy reflect the plan.
        </li>
        <li>
          <strong>Revisit annually.</strong> COLA announcements, tax-law changes, and any health-status update should
          trigger a re-run of the SS sweep and Roth-conversion optimization together (they interact).
        </li>
      </ul>

      <H3>Important caveats</H3>
      <ul style={{ fontSize: 10, lineHeight: 1.6, color: "#5A5A5A", paddingLeft: 20 }}>
        <li>The optimizer maximizes <em>after-tax legacy at second death</em>. If maximum lifetime income (spending)
          is the client&apos;s primary objective, the ranking may differ &mdash; discuss the trade-off explicitly.</li>
        <li>All results depend on the modeled life expectancy. A meaningful longevity revision (health event, family
          history update) should trigger a re-run.</li>
        <li>Social Security rules can change. This analysis reflects rules current as of {new Date().getFullYear()}. Congressional
          action to shore up the trust fund (benefit cuts, means-testing, higher taxation) is a real risk on a 20+ year horizon.</li>
      </ul>

      <Sub>
        This recommendation is <strong>illustrative</strong>. Actual claim decisions should be reviewed with your
        Social Security representative and financial advisor. See the &ldquo;For the Client&rdquo; narrative on the
        next page for a plain-English summary.
      </Sub>
    </Page>
  );
};
