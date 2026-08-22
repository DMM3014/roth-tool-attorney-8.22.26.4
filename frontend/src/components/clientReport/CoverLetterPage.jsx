import { LogoHeader } from "@/lib/advisorLogo";
import { Page } from "./helpers";

/**
 * CoverLetterPage — optional advisor cover letter printed immediately after the
 * cover. Off by default; the advisor opts in per engagement from the branding
 * card and types the note there. Blank lines start a new paragraph.
 */
export const CoverLetterPage = ({ branding, household, prettyDate, logo, ...footProps }) => {
  const body = (branding?.cover_letter || "").trim();
  if (!body) return null;
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <Page testid="cr-page-cover-letter" {...footProps}>
      <LogoHeader logo={logo} testid="cr-letter-logo" />
      <div style={{ borderBottom: "2px solid #4A6741", paddingBottom: 8, marginBottom: 20 }}>
        <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 15, color: "#1A1A1A" }}>
          {branding?.advisor_firm || branding?.advisor_name || "A note before you begin"}
        </div>
        {branding?.advisor_firm && branding?.advisor_name && (
          <div style={{ fontSize: 10.5, color: "#5A5A5A", marginTop: 2 }}>{branding.advisor_name}</div>
        )}
      </div>

      <p style={{ fontSize: 10.5, color: "#777", margin: "0 0 18px" }}>{prettyDate}</p>
      <p data-docx="p" style={{ fontSize: 11.5, color: "#1A1A1A", margin: "0 0 14px", fontWeight: 600 }}>
        Dear {household},
      </p>

      <div data-testid="cr-cover-letter-body">
        {paras.map((p, i) => (
          <p key={i} data-docx="p"
             style={{ fontSize: 11.5, lineHeight: 1.75, color: "#2A2A2A", margin: "0 0 12px", whiteSpace: "pre-wrap" }}>
            {p}
          </p>
        ))}
      </div>

      <div style={{ marginTop: 26, fontSize: 11.5, lineHeight: 1.7, color: "#2A2A2A" }}>
        <p style={{ margin: 0 }}>Sincerely,</p>
        {branding?.advisor_name && (
          <p style={{ margin: "22px 0 0", fontWeight: 600, color: "#1A1A1A" }}>{branding.advisor_name}</p>
        )}
        {branding?.advisor_firm && <p style={{ margin: 0, fontSize: 10.5, color: "#5A5A5A" }}>{branding.advisor_firm}</p>}
        {branding?.advisor_email && <p style={{ margin: 0, fontSize: 10.5, color: "#777" }}>{branding.advisor_email}</p>}
        {branding?.advisor_phone && <p style={{ margin: 0, fontSize: 10.5, color: "#777" }}>{branding.advisor_phone}</p>}
      </div>
    </Page>
  );
};

export default CoverLetterPage;
