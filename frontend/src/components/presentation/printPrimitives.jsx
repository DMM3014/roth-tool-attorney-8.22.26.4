// Print primitives shared by the client Presentation deck and its page
// components. Extracted from Presentation.jsx so new deck pages can live in
// their own files instead of growing that (already large) module.
import { useAdvisorLogo, LogoWatermark } from "@/lib/advisorLogo";

export const H2 = ({ children }) => (
  <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 18, color: "#1A1A1A", marginBottom: 8, paddingBottom: 4, borderBottom: "2px solid #4A6741" }}>
    {children}
  </div>
);

export const H3 = ({ children }) => (
  <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 13, color: "#1A1A1A", marginBottom: 4, marginTop: 12 }}>
    {children}
  </div>
);

export const P = ({ children }) => (
  <p style={{ fontSize: 11, lineHeight: 1.55, color: "#2A2A2A", marginBottom: 8 }}>{children}</p>
);

export const Sub = ({ children }) => (
  <p style={{ fontSize: 10, color: "#777", fontStyle: "italic", marginBottom: 8 }}>{children}</p>
);

// One rendered "page" of the deck. During PDF export html2pdf reads
// `page-break-before: always` (pagebreak.mode: 'css') and starts each Page on a
// fresh A4 page; `page-break-inside: avoid` keeps a section from splitting.
export const Page = ({ children, testid, first, logo: logoProp }) => {
  const [logoHook] = useAdvisorLogo();
  const logo = logoProp ?? logoHook;
  return (
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
        padding: "6px 0 24px 0",
        position: "relative",
      }}
    >
      {logo && !first && (
        <div style={{ position: "absolute", top: 4, right: 6, opacity: 0.7 }} data-testid="pres-page-logo">
          <LogoWatermark logo={logo} testid="pres-page-logo-img" />
        </div>
      )}
      {children}
    </section>
  );
};
