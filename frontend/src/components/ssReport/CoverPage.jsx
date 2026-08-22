import { fmtUSD } from "@/lib/api";
import { LogoHeader } from "@/lib/advisorLogo";
import { Page, H3, Kpi, P } from "./helpers";

export const CoverPage = ({ branding, household, prettyDate, scenario, logo, fraAges, fraAmounts, ...footProps }) => {
  const h = scenario.household || {};
  const startYear = scenario?.projection?.start_year;
  const clientAge = (startYear && h.client_dob_year) ? startYear - h.client_dob_year : null;
  const spouseAge = (startYear && h.spouse_dob_year) ? startYear - h.spouse_dob_year : null;

  return (
    <Page testid="ssr-page-cover" first {...footProps}>
      <LogoHeader logo={logo} testid="ssr-cover-logo" />
      <div style={{
        background: "linear-gradient(135deg, #4A6741 0%, #3B5234 100%)", color: "#fff",
        padding: "34px 32px", borderRadius: 10, marginBottom: 22,
      }}>
        <div style={{ fontSize: 10, opacity: 0.85, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
          {branding.advisor_firm || "Social Security Analysis"}
        </div>
        <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 30, lineHeight: 1.1 }}>
          {branding.cover_subtitle || "Social Security Analysis & Strategy Report"}
        </div>
        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 10 }}>
          Prepared for <strong>{household}</strong>
        </div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{prettyDate}</div>
      </div>

      {branding.cover_intro && (
        <div style={{ padding: "12px 16px", background: "#F9F8F6", borderLeft: "4px solid #4A6741", marginBottom: 20 }}>
          <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "#2A2A2A", fontStyle: "italic", margin: 0 }}>
            {branding.cover_intro}
          </p>
        </div>
      )}

      <H3>Household snapshot</H3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Kpi label="Client"
          value={h.client_name || "Client"}
          sub={clientAge != null ? `Age ${clientAge} · FRA ${Math.floor(fraAges?.Client || 67)}${h.client_ss_claim_age ? ` · plans to claim at ${h.client_ss_claim_age}` : ""}` : ""} />
        <Kpi label="Spouse"
          value={h.spouse_name || "—"}
          sub={spouseAge != null ? `Age ${spouseAge} · FRA ${Math.floor(fraAges?.Spouse || 67)}${h.spouse_ss_claim_age ? ` · plans to claim at ${h.spouse_ss_claim_age}` : ""}` : ""} />
        <Kpi label="Client FRA benefit" tone="gold"
          value={fraAmounts?.Client ? `${fmtUSD(fraAmounts.Client)}/mo` : "—"}
          sub={fraAmounts?.Client ? `${fmtUSD(fraAmounts.Client * 12)}/yr (PIA — today's dollars)` : "Not yet entered in Plan Inputs"} />
        <Kpi label="Spouse FRA benefit" tone="gold"
          value={fraAmounts?.Spouse ? `${fmtUSD(fraAmounts.Spouse)}/mo` : "—"}
          sub={fraAmounts?.Spouse ? `${fmtUSD(fraAmounts.Spouse * 12)}/yr (PIA — today's dollars)` : ""} />
        <Kpi label="Filing status" value={h.filing_status || "MFJ"} />
        <Kpi label="Assumed SS COLA"
          value={`${((scenario?.projection?.ss_cola ?? 0.025) * 100).toFixed(1)}%/yr`}
          sub="Cost-of-living adjustment applied to future benefits" />
      </div>

      <H3>What this report covers</H3>
      <ul style={{ fontSize: 11, lineHeight: 1.7, color: "#2A2A2A", paddingLeft: 20, marginBottom: 4 }}>
        <li>How Social Security works — PIA, FRA, early-claim reductions, and delayed-retirement credits</li>
        <li>Your projected monthly benefit at ages 62, 65, 67, and 70 — both nominal and COLA-adjusted</li>
        <li>Cumulative lifetime benefits by claim age (and the &ldquo;break-even&rdquo; age math)</li>
        <li>Household coordinated claiming — the pair of ages that maximizes after-tax legacy</li>
        <li>The <strong>Roth-conversion interaction</strong> — why delaying SS opens tax headroom for conversions</li>
        <li>Taxation of Social Security (up to 85% inclusion) and IRMAA impact</li>
        <li>Survivor benefit protection — why the higher earner should usually delay to 70</li>
      </ul>

      <div style={{ marginTop: 20 }}>
        <P>
          Social Security is one of the few guaranteed, inflation-adjusted income streams a household will
          ever receive. The decision of <em>when</em> to claim is worth tens or hundreds of thousands of dollars —
          and the right answer depends not just on longevity but on how the claim decision interacts with
          your <strong>Roth conversion strategy</strong>, RMDs, IRMAA, and survivor protection.
        </P>
      </div>

      {/* AI-use disclosure footnote — printed on every client-facing SS PDF cover. */}
      <div data-testid="ssr-cover-ai-disclosure"
           style={{ marginTop: 18, padding: "10px 12px", background: "#FFF4E6",
                    border: "1px solid #E5B87A", borderRadius: 6, fontSize: 9.5,
                    lineHeight: 1.55, color: "#5A3A0F" }}>
        <strong style={{ display: "block", marginBottom: 4, color: "#8A5A20", letterSpacing: 0.3 }}>
          A note on AI-assisted evaluations
        </strong>
        This report is generated by a static tax-planning engine — no AI-assisted
        evaluations were used to produce the numbers or narrative below. If you
        wish to run an AI-generated second opinion, you may download this PDF and
        evaluate it using any AI tool of your choice, at your own expense and
        subject to that AI program&apos;s privacy restrictions and data-handling
        limitations. This planning model does not integrate with, or ask for,
        any third-party account credentials.
      </div>

      <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #EBE8E0", fontSize: 10, color: "#777" }}>
        {branding.advisor_name && <div style={{ color: "#1A1A1A", fontWeight: 600 }}>{branding.advisor_name}</div>}
        {branding.advisor_firm && <div>{branding.advisor_firm}</div>}
        {branding.advisor_email && <div>{branding.advisor_email}</div>}
        {branding.advisor_phone && <div>{branding.advisor_phone}</div>}
      </div>
    </Page>
  );
};
