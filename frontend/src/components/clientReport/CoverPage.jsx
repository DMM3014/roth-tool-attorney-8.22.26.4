import { fmtPct } from "@/lib/api";
import { LogoHeader } from "@/lib/advisorLogo";
import { Page, H3, Kpi } from "./helpers";

export const CoverPage = ({ branding, household, prettyDate, strat, marketPreset, scenario, logo, ...footProps }) => {
  const clientAge = scenario?.projection?.start_year && scenario?.household?.client_dob_year
    ? scenario.projection.start_year - scenario.household.client_dob_year : null;
  const spouseAge = scenario?.projection?.start_year && scenario?.household?.spouse_dob_year
    ? scenario.projection.start_year - scenario.household.spouse_dob_year : null;
  const clientLe = scenario?.household?.client_life_expectancy;
  const spouseLe = scenario?.household?.spouse_life_expectancy;

  return (
    <Page testid="cr-page-cover" first {...footProps}>
      <LogoHeader logo={logo} testid="cr-cover-logo" />
      <div style={{
        background: "linear-gradient(135deg, #4A6741 0%, #3B5234 100%)", color: "#fff",
        padding: "34px 32px", borderRadius: 10, marginBottom: 22,
      }}>
        <div style={{ fontSize: 10, opacity: 0.85, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
          {branding.advisor_firm || "Retirement Analysis"}
        </div>
        <div data-docx="h1" style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 30, lineHeight: 1.1 }}>
          {branding.cover_subtitle || "Retirement & Wealth-Transfer Illustration — Attorney Edition"}
        </div>
        <div data-testid="cr-cover-disclaimer" style={{ fontSize: 12.5, opacity: 0.92, marginTop: 8, fontStyle: "italic", fontWeight: 500 }}>
          Educational illustration — not investment, legal, or tax advice.
        </div>
        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 10 }}>
          Prepared for <strong>{household}</strong>
        </div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{prettyDate}</div>
        <div data-testid="cr-cover-strategy" style={{
          marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(0,0,0,0.18)", border: "1px solid rgba(255,255,255,0.30)",
          borderLeft: "3px solid #C9A227",
          padding: "6px 12px", borderRadius: 4, fontSize: 11,
        }}>
          <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", opacity: 0.85, fontWeight: 700 }}>Strategy</span>
          <strong>{strat.label}</strong>
          <span style={{ opacity: 0.7 }}>·</span>
          <span>Funding: <strong>{strat.fundingOrder}</strong></span>
        </div>
        {marketPreset && (
          <div style={{
            marginTop: 8, marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.35)",
            padding: "6px 12px", borderRadius: 999, fontSize: 11,
          }}>
            <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", opacity: 0.85, fontWeight: 700 }}>Market</span>
            <strong>{marketPreset.label}</strong>
          </div>
        )}
      </div>

      {branding.cover_intro && (
        <div style={{ padding: "12px 16px", background: "#F9F8F6", borderLeft: "4px solid #4A6741", marginBottom: 20 }}>
          <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "#2A2A2A", fontStyle: "italic", margin: 0 }}>
            {branding.cover_intro}
          </p>
        </div>
      )}

      <H3>Client profile</H3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Kpi label="Household" value={household}
          sub={clientAge != null ? `Age ${clientAge}${spouseAge != null ? ` & ${spouseAge}` : ""}` : ""} />
        <Kpi label="Filing status" value={scenario?.household?.filing_status || "MFJ"} />
        <Kpi label="Life expectancy"
          value={`${clientLe || 90}${spouseLe ? ` & ${spouseLe}` : ""}`}
          sub={`Second death ≈ ${clientLe && scenario?.household?.client_dob_year ? Math.max(
            (scenario.household.client_dob_year || 0) + (clientLe || 0),
            (scenario.household.spouse_dob_year || 0) + (spouseLe || 0),
          ) : ""}`} />
        <Kpi label="State" value={scenario?.tax?.state_code || "—"}
          sub={`State rate ${fmtPct(scenario?.tax?.state_rate)}`} />
      </div>

      <H3>What&apos;s in this report</H3>
      <ul style={{ fontSize: 11, lineHeight: 1.7, color: "#2A2A2A", paddingLeft: 20, marginBottom: 4 }}>
        <li>Overview of your plan: probability of success, projected savings, and net worth at second death</li>
        <li>Savings, income &amp; expenses, cash flow, and estimated taxes year by year</li>
        <li>Monte Carlo simulation across hundreds of market futures</li>
        <li><strong>Roth Conversion &amp; Legacy analysis</strong> — how the SECURE Act 10-year window affects what reaches your children</li>
      </ul>

      {/* AI-use disclosure footnote — printed on every client-facing PDF cover.
          Clarifies the report is generated by the static tax engine only and
          explains the client's options if they wish to run their own AI review. */}
      <div data-testid="cr-cover-ai-disclosure"
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

      <div style={{ marginTop: 30, paddingTop: 14, borderTop: "1px solid #EBE8E0", fontSize: 10, color: "#777" }}>
        {branding.advisor_name && <div style={{ color: "#1A1A1A", fontWeight: 600 }}>{branding.advisor_name}</div>}
        {branding.advisor_firm && <div>{branding.advisor_firm}</div>}
        {branding.advisor_email && <div>{branding.advisor_email}</div>}
        {branding.advisor_phone && <div>{branding.advisor_phone}</div>}
      </div>
    </Page>
  );
};
