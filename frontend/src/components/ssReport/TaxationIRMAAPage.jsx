import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub, Kpi } from "./helpers";

// Explains the SS taxability formula (up to 85% inclusion) and IRMAA impact.
// Uses the actual projection rows to show the client's own IRMAA years + inclusion %.
export const TaxationIRMAAPage = ({ withRoth, scenario, ...footProps }) => {
  const rows = withRoth?.rows || [];

  // Find years where the household is subject to IRMAA (medicare > baseline part B)
  const irmaaYears = rows.filter((r) => (r.medicare_irmaa || 0) > 0 || (r.cashflow?.medicare || 0) > 3500);
  const totalIrmaa = rows.reduce((t, r) => t + (r.medicare_irmaa || 0), 0);

  // Find the SS taxable-% in each year — from tax_detail if present, else compute from inclusion
  const ssInclusionRows = rows.filter((r) => (r.cashflow?.gross_ss || 0) > 0)
    .map((r) => ({
      year: r.year,
      gross_ss: r.cashflow?.gross_ss || 0,
      taxable_ss: r.tax_detail?.taxable_ss ?? Math.min(0.85, ((r.cashflow?.taxable_ss || 0) / Math.max(1, r.cashflow?.gross_ss || 1))) * (r.cashflow?.gross_ss || 0),
      inclusion_pct: r.tax_detail?.ss_inclusion_pct != null
        ? r.tax_detail.ss_inclusion_pct
        : Math.min(0.85, (r.cashflow?.taxable_ss || 0) / Math.max(1, r.cashflow?.gross_ss || 1)),
      provisional: r.tax_detail?.provisional_income,
    }));

  const maxInclusion = ssInclusionRows.reduce((m, r) => Math.max(m, r.inclusion_pct || 0), 0);
  const firstFullTaxable = ssInclusionRows.find((r) => (r.inclusion_pct || 0) >= 0.85);

  return (
    <Page testid="ssr-page-taxation-irmaa" {...footProps}>
      <H2>Taxation of Social Security &amp; IRMAA</H2>

      <H3>Up to 85% of your SS check can be federally taxable</H3>
      <P>
        Social Security is not fully tax-free. The IRS taxes 0%, up to 50%, or up to 85% of your benefit based on
        &ldquo;combined income&rdquo; (also called &ldquo;provisional income&rdquo;) — a formula that adds your AGI,
        tax-exempt interest, and <strong>half of your gross SS</strong>. The thresholds have not been indexed for inflation
        since 1993, so most retirees hit the 85% cap fairly quickly:
      </P>
      <table style={{ width: "100%", fontSize: 10.5, borderCollapse: "collapse", marginBottom: 10 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #EBE8E0", background: "#F9F8F6" }}>
            <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Combined income (MFJ)</th>
            <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Combined income (Single)</th>
            <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>% of SS taxable</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: "5px 8px" }}>Below $32,000</td>
            <td style={{ padding: "5px 8px" }}>Below $25,000</td>
            <td style={{ textAlign: "right", padding: "5px 8px", color: "#4A6741", fontWeight: 700 }}>0%</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: "5px 8px" }}>$32,000 – $44,000</td>
            <td style={{ padding: "5px 8px" }}>$25,000 – $34,000</td>
            <td style={{ textAlign: "right", padding: "5px 8px", color: "#C4A64A", fontWeight: 700 }}>Up to 50%</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: "5px 8px" }}>Above $44,000</td>
            <td style={{ padding: "5px 8px" }}>Above $34,000</td>
            <td style={{ textAlign: "right", padding: "5px 8px", color: "#B84A4A", fontWeight: 700 }}>Up to 85%</td>
          </tr>
        </tbody>
      </table>

      <H3>Your household&apos;s SS taxability over time</H3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}>
        <Kpi label="Peak SS inclusion %" tone={maxInclusion >= 0.85 ? "orange" : "green"}
          value={maxInclusion > 0 ? `${(maxInclusion * 100).toFixed(0)}%` : "—"}
          sub="Highest year in your projection" />
        <Kpi label="First 85%-taxable year"
          value={firstFullTaxable ? String(firstFullTaxable.year) : "Never"}
          sub={firstFullTaxable ? "SS ordinary income at peak" : "Your plan keeps combined income low"} />
        <Kpi label="Total IRMAA premium paid" tone={totalIrmaa > 0 ? "orange" : "green"}
          value={fmtUSD(totalIrmaa)}
          sub={`Across ${irmaaYears.length} projected year(s)`} />
      </div>

      <H3>The &ldquo;Social Security Tax Torpedo&rdquo;</H3>
      <P>
        Because the SS taxability formula phases in, an extra dollar of ordinary income (from an IRA withdrawal, a Roth
        conversion, or wages) can trigger up to <strong>85 cents of previously-untaxed SS</strong> to become taxable at
        the same time. The effective marginal rate on that extra dollar can climb to <strong>40.7%–46.25%</strong>{" "}
        (Geisler, Harden &amp; Hulse 2021 JFP) even though the household&apos;s statutory bracket is only 22% or 24%.
        This is why <em>timing</em> matters so much — pre-SS Roth conversions dodge the torpedo entirely.
      </P>

      <H3>IRMAA — Medicare income-related premium surcharges</H3>
      <P>
        Starting at age 65 (when Medicare Part B enrollment is required), your household&apos;s premiums are tied to
        MAGI from two years prior. Cross an IRMAA tier and your premium jumps by <strong>$700–$4,900 per person per year</strong>{" "}
        (2025 rates). Higher-income households can pay $10,000+/year in surcharges. IRMAA tiers are cliffs, not phase-ins —
        one extra dollar of income can cost the household thousands.
      </P>
      {irmaaYears.length > 0 && (
        <div style={{
          padding: "10px 12px", background: "#FFF4E6", border: "1px solid #E5B87A", borderRadius: 8, marginTop: 4,
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8A5A20", marginBottom: 4 }}>
            Your plan hits IRMAA in {irmaaYears.length} year(s)
          </div>
          <p style={{ fontSize: 10, color: "#5A4020", lineHeight: 1.55, margin: 0 }}>
            Total IRMAA premiums across the plan horizon: <strong>{fmtUSD(totalIrmaa)}</strong>.
            The Roth-conversion strategy on the &ldquo;Strategy Analyzer&rdquo; tab can route conversions <em>around</em>
            the IRMAA cliffs when possible — see the &ldquo;IRMAA-aware&rdquo; toggle there.
          </p>
        </div>
      )}

      <Sub>
        Federal SS taxability rules: 26 U.S.C. § 86. IRMAA tiers: SSA Publication 05-10161 (current year).
        The MAGI look-back is 2 years — meaning a Roth conversion in year Y raises the IRMAA premium in year Y+2.
      </Sub>
    </Page>
  );
};
