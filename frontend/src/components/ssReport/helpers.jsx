// Shared primitives + SS math helpers for the Social Security Report pages.
import { LogoWatermark } from "@/lib/advisorLogo";

export const SS_BRANDING_KEY = "ss_report_branding_v1";
export const SS_AI_TEXT_KEY = "ss_report_ai_text_v1";

// Canonical claim-age set for the "by age" analyses (matches SS Optimizer sweep).
export const CLAIM_AGES = [62, 65, 67, 70];

// SSA Full Retirement Age table (birth year → FRA age). Same as backend `full_retirement_age()`.
export const fullRetirementAge = (birthYear) => {
  if (!birthYear) return 67;
  if (birthYear <= 1954) return 66;
  if (birthYear === 1955) return 66 + 2 / 12;
  if (birthYear === 1956) return 66 + 4 / 12;
  if (birthYear === 1957) return 66 + 6 / 12;
  if (birthYear === 1958) return 66 + 8 / 12;
  if (birthYear === 1959) return 66 + 10 / 12;
  return 67;
};

// SSA reduction (early) / delayed retirement credit (late) factor vs FRA benefit.
// early: 5/9% per month first 36 months + 5/12% per month beyond = up to 30% off at 62 for FRA-67
// late : 8% simple per year past FRA, capped at age 70 → +24% at 70 for FRA-67
export const claimFactor = (claimAge, fraAge) => {
  if (claimAge == null || fraAge == null) return 1;
  const a = Math.max(62, Math.min(70, claimAge));
  if (a === fraAge) return 1;
  if (a < fraAge) {
    const monthsEarly = (fraAge - a) * 12;
    const first = Math.min(36, monthsEarly);
    const rest = Math.max(0, monthsEarly - 36);
    return 1 - (first * (5 / 9 / 100) + rest * (5 / 12 / 100));
  }
  return 1 + 0.08 * (a - fraAge);
};

// Survivor benefit = higher of (survivor's own benefit) vs (deceased spouse's benefit at
// their claim age), assuming the survivor has reached FRA. We approximate at plan-time
// for illustration by taking the max of the two spouses' post-reduction / DRC benefits.
export const survivorBenefit = (client, spouse) => {
  const c = (client?.fra != null && client?.claimAge != null)
    ? client.fra * claimFactor(client.claimAge, client.fraAge) : 0;
  const s = (spouse?.fra != null && spouse?.claimAge != null)
    ? spouse.fra * claimFactor(spouse.claimAge, spouse.fraAge) : 0;
  return Math.max(c, s);
};

// Spousal benefit: married non-earning (or lower-earning) spouse may claim up to 50% of
// the higher-earner's PIA (FRA benefit), reduced if claimed before FRA. Applied ONLY when
// it exceeds the spouse's own reduced benefit.
export const spousalBenefit = (ownFra, ownClaimAge, ownFraAge, higherFra) => {
  const ownReduced = (ownFra || 0) * claimFactor(ownClaimAge, ownFraAge);
  // Spousal ceiling = 50% of higher earner's PIA. Reduced if claimed before FRA but never
  // increased for delayed claim (delayed credits don't apply to spousal benefits).
  const spousalCap = 0.5 * (higherFra || 0);
  const spousalFactor = ownClaimAge >= ownFraAge ? 1 : claimFactor(ownClaimAge, ownFraAge);
  const spousalReduced = spousalCap * spousalFactor;
  return Math.max(ownReduced, spousalReduced);
};

export const defaultBranding = {
  advisor_name: "",
  advisor_firm: "",
  advisor_email: "",
  advisor_phone: "",
  client_name_override: "",
  spouse_name_override: "",
  presentation_date: new Date().toISOString().slice(0, 10),
  cover_subtitle: "Social Security Analysis & Strategy Report",
  cover_intro: "",
  confidentiality: "Confidential — Prepared for client review only. Not for redistribution.",
  // Advisor Commentary (formerly "AI Review") — advisor-only, never printed into
  // the client SS Report PDF. Default OFF.
  include_ai_review: false,
  // Anonymize client identity in this Social Security report — default ON
  // (client privacy first; advisor opts in to print real names).
  anonymize_names: true,
  include_spousal: true,
};

export const loadBranding = () => {
  try {
    const raw = window.localStorage.getItem(SS_BRANDING_KEY);
    // Report date always defaults to today (see Client Report helpers).
    return raw
      ? { ...defaultBranding, ...JSON.parse(raw), presentation_date: new Date().toISOString().slice(0, 10) }
      : defaultBranding;
  } catch { return defaultBranding; }
};

export const saveBranding = (b) => {
  try { window.localStorage.setItem(SS_BRANDING_KEY, JSON.stringify(b)); } catch { /* noop */ }
};

// ---- Print-only typography helpers (same visual language as Client Report) ----
export const H1 = ({ children }) => (
  <div data-docx="h1" style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 22, color: "#1A1A1A", marginBottom: 6, paddingBottom: 6, borderBottom: "3px solid #4A6741" }}>
    {children}
  </div>
);

export const H2 = ({ children }) => (
  <div data-docx="h2" style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 16, color: "#1A1A1A", marginBottom: 8, paddingBottom: 4, borderBottom: "2px solid #4A6741" }}>
    {children}
  </div>
);

export const H3 = ({ children }) => (
  <div data-docx="h3" style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 12.5, color: "#1A1A1A", marginBottom: 4, marginTop: 12 }}>
    {children}
  </div>
);

export const P = ({ children }) => (
  <p data-docx="p" style={{ fontSize: 11, lineHeight: 1.6, color: "#2A2A2A", marginBottom: 8 }}>{children}</p>
);

export const Sub = ({ children }) => (
  <p data-docx="sub" style={{ fontSize: 10, color: "#777", fontStyle: "italic", marginBottom: 8 }}>{children}</p>
);

export const Page = ({ children, testid, first, pageNo, pageTotal, footer, confidential, logo }) => (
  <section
    data-testid={testid}
    className="pdf-page"
    style={{
      pageBreakBefore: first ? "auto" : "always",
      breakBefore: first ? "auto" : "page",
      pageBreakAfter: "always",
      breakAfter: "page",
      pageBreakInside: "avoid",
      breakInside: "avoid",
      boxSizing: "border-box",
      padding: "6px 0 32px 0",
      position: "relative",
      minHeight: 900,
    }}
  >
    {children}
    {footer && (
      <div style={{
        position: "absolute", bottom: 4, left: 0, right: 0,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 8.5, color: "#999", borderTop: "1px solid #EBE8E0",
        paddingTop: 4, marginTop: 12,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          <LogoWatermark logo={logo} />{confidential || "Confidential"}
        </span>
        <span>{footer}</span>
        {pageNo != null && <span>Page {pageNo}{pageTotal ? ` of ${pageTotal}` : ""}</span>}
      </div>
    )}
  </section>
);

export const Kpi = ({ label, value, sub, tone = "green" }) => {
  const color = tone === "green" ? "#4A6741" : tone === "orange" ? "#C87941" : tone === "gold" ? "#8A6A20" : "#5A5A5A";
  return (
    <div data-docx="kpi" data-docx-kpi-label={label} data-docx-kpi-value={typeof value === "string" ? value : ""} data-docx-kpi-sub={sub || ""}
         style={{ padding: "10px 12px", border: "1px solid #EBE8E0", borderRadius: 8, background: "#F9F8F6" }}>
      <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase", color, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 700, color: "#1A1A1A", marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 8.5, color: "#777", marginTop: 2 }}>{sub}</div>}
    </div>
  );
};

// Re-export the shared StaticLegend + useIsolation from the Client Report
// helpers so SS Report pages can render a plain-HTML legend below each chart
// AND get the same "click to isolate this series" interactive behavior.
// Rationale: html2canvas clips SVG content to the declared viewBox during PDF
// rasterization, truncating any legend pill whose text runs past the chart's
// right edge. Rendering the legend as flex-wrap HTML outside the chart's SVG
// sidesteps that entirely. The isolation reset event ("cr-reset-isolation")
// fired by doPrint before capture ensures the printed PDF always captures the
// full un-dimmed chart.
export { StaticLegend, useIsolation } from "../clientReport/helpers";

