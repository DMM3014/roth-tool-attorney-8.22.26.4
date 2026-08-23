// Shared primitives + constants for the Client Report pages.
import { useState, useEffect, useCallback } from "react";
import { LogoWatermark } from "@/lib/advisorLogo";
import { fmtPct as _fmtPct } from "@/lib/api";

// Re-export fmtPct so sub-components can `import { fmtPct } from "./helpers.jsx"`
// without reaching into lib/api directly.
export const fmtPct = _fmtPct;

// Auto-suggest a milestone year from the household's DOBs / retirement dates
// based on a plain-English label the advisor typed ("Retirement", "First Death",
// "RMDs Begin", "Medicare", "Social Security", "Second Death", etc.).
//
// Returns null if the label doesn't match any known keyword or the required
// household field is missing. Order matters: check more-specific labels first
// (e.g. "Second Death" before "Death").
export const suggestMilestoneYear = (label, scenario) => {
  const l = String(label || "").trim().toLowerCase();
  if (!l) return null;
  const h = scenario?.household || {};
  const parseYear = (s) => (s ? parseInt(String(s).slice(0, 4), 10) : null);
  const clientDob = h.client_dob_year;
  const spouseDob = h.spouse_dob_year;
  const clientRet = parseYear(h.client_retirement_date) || (clientDob && h.client_retirement_age ? clientDob + h.client_retirement_age : null);
  const spouseRet = parseYear(h.spouse_retirement_date) || (spouseDob && h.spouse_retirement_age ? spouseDob + h.spouse_retirement_age : null);
  const clientDeath = clientDob && h.client_life_expectancy ? clientDob + h.client_life_expectancy : null;
  const spouseDeath = spouseDob && h.spouse_life_expectancy ? spouseDob + h.spouse_life_expectancy : null;
  if (/(^| )second (death|passing)|survivor death|both deaths|end of both/.test(l)) {
    if (clientDeath && spouseDeath) return Math.max(clientDeath, spouseDeath);
    return clientDeath || spouseDeath || null;
  }
  if (/(^| )first (death|passing)|either death|one passes/.test(l)) {
    if (clientDeath && spouseDeath) return Math.min(clientDeath, spouseDeath);
    return clientDeath || spouseDeath || null;
  }
  if (/\brmd/.test(l)) {
    if (!clientDob) return null;
    const rmdAge = clientDob >= 1960 ? 75 : 73;
    return clientDob + rmdAge;
  }
  if (/medicare|age 65/.test(l)) {
    return clientDob ? clientDob + 65 : (spouseDob ? spouseDob + 65 : null);
  }
  if (/social security|\bss\b|ss claim|start ss/.test(l)) {
    const ssClaim = parseYear(h.client_ss_claim_date);
    if (ssClaim) return ssClaim;
    return clientDob ? clientDob + 67 : null;
  }
  if (/retire|retirement/.test(l)) {
    if (l.includes("spouse")) return spouseRet;
    if (l.includes("client")) return clientRet;
    if (clientRet && spouseRet) return Math.min(clientRet, spouseRet);
    return clientRet || spouseRet || null;
  }
  if (/death|passing|life expectancy/.test(l)) {
    if (clientDeath && spouseDeath) return Math.min(clientDeath, spouseDeath);
    return clientDeath || spouseDeath || null;
  }
  return null;
};

export const BRANDING_KEY = "client_report_branding_v1";
export const AI_TEXT_KEY = "client_report_ai_text_v1";
export const BENEFICIARIES_KEY = "client_report_beneficiaries_v1";

export const loadBeneficiaries = () => {
  try {
    const raw = window.localStorage.getItem(BENEFICIARIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
export const saveBeneficiaries = (list) => {
  try { window.localStorage.setItem(BENEFICIARIES_KEY, JSON.stringify(list)); } catch { /* noop */ }
};

// Compute a weighted-average heir federal + state marginal rate from an explicit
// beneficiaries list (each with share_pct in 0-100, fed_rate + state_rate in 0-1).
// Beneficiaries whose share sums to 0 are ignored. Returns null if list is empty.
export const beneficiaryWeightedRate = (beneficiaries) => {
  const list = (beneficiaries || []).filter((b) => Number.isFinite(b.share_pct) && b.share_pct > 0);
  if (!list.length) return null;
  const totalShare = list.reduce((t, b) => t + b.share_pct, 0);
  if (totalShare <= 0) return null;
  const fed = list.reduce((t, b) => t + (b.share_pct / totalShare) * (Number.isFinite(b.fed_rate) ? b.fed_rate : 0), 0);
  const state = list.reduce((t, b) => t + (b.share_pct / totalShare) * (Number.isFinite(b.state_rate) ? b.state_rate : 0), 0);
  return { fed, state };
};

export const defaultBranding = {
  advisor_name: "",
  advisor_firm: "",
  advisor_email: "",
  advisor_phone: "",
  client_name_override: "",
  spouse_name_override: "",
  presentation_date: new Date().toISOString().slice(0, 10),
  cover_subtitle: "Retirement & Wealth-Transfer Illustration — Attorney Edition",
  cover_intro: "",
  confidentiality: "Confidential — Prepared for client review only. Not for redistribution.",
  // Advisor Commentary (formerly "AI Review"). Now advisor-only — never printed into
  // the client PDF. Default OFF; when advisor enables, the commentary card unlocks
  // for internal analysis and can be exported as a standalone PDF/RTF. Kept as a
  // branding-level flag so it persists per-advisor across sessions.
  include_ai_review: false,
  // Anonymize client identity in printed materials — default ON (client privacy
  // is a core deliverable of any advisor engagement, so we treat "anonymized" as
  // the safe default and require an explicit opt-out for real-name printouts).
  // When ON, all printed reports render the client as "Client" and their partner
  // as "Client Partner", preserving planning-model privacy for any documents shared
  // outside of the client engagement (LLM prompts, AI review, marketing samples).
  anonymize_names: true,
  // Optional advisor cover letter, printed as page 2 of the Client Report.
  // Default OFF — advisors opt in per engagement from the branding card.
  cover_letter_on: false,
  cover_letter: "",
};

export const loadBranding = () => {
  try {
    const raw = window.localStorage.getItem(BRANDING_KEY);
    // The report date ALWAYS defaults to today. A saved branding blob would
    // otherwise print whatever date the advisor last opened the settings on.
    return raw
      ? { ...defaultBranding, ...JSON.parse(raw), presentation_date: new Date().toISOString().slice(0, 10) }
      : defaultBranding;
  } catch { return defaultBranding; }
};

export const saveBranding = (b) => {
  try { window.localStorage.setItem(BRANDING_KEY, JSON.stringify(b)); } catch { /* noop */ }
};

// ---- Print-only typography helpers ----
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

export const Page = ({ children, testid, first, pageNo, pageTotal, footer, confidential, logo, lawAsOf }) => (
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
        <span>{footer}{lawAsOf ? ` · Tax law as of: ${lawAsOf}` : ""}</span>
        {pageNo != null && <span>Page {pageNo}{pageTotal ? ` of ${pageTotal}` : ""}</span>}
      </div>
    )}
  </section>
);

export const Kpi = ({ label, value, sub, tone = "green" }) => {
  const color = tone === "green" ? "#4A6741" : tone === "orange" ? "#C87941" : "#5A5A5A";
  return (
    <div data-docx="kpi" data-docx-kpi-label={label} data-docx-kpi-value={typeof value === "string" ? value : ""} data-docx-kpi-sub={sub || ""}
         style={{ padding: "10px 12px", border: "1px solid #EBE8E0", borderRadius: 8, background: "#F9F8F6" }}>
      <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase", color, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 700, color: "#1A1A1A", marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 8.5, color: "#777", marginTop: 2 }}>{sub}</div>}
    </div>
  );
};


// Plain-HTML legend used in place of Recharts' <Legend> inside the printed
// report. Recharts renders its legend as an absolutely-positioned div INSIDE
// the ResponsiveContainer/SVG, and html2canvas clips SVG content to the
// declared viewBox when serializing — so any legend pill whose text runs
// past the chart's right edge gets truncated (e.g. "Social Security (taxable)"
// → "Social Security (tax"). Rendering the legend as regular flex-wrap HTML
// BELOW the chart sidesteps the SVG-viewport clip entirely and lets items
// wrap onto a second row when they don't fit.
//
// Two usage modes:
//   (a) Static:      <StaticLegend items={[{ label, color }, ...]} testid="..." />
//                    OR <StaticLegend keys={["A","B"]} colors={{A:"#000",B:"#fff"}} />
//   (b) Interactive: pass `isolated` + `onToggle` (usually from useIsolation()) —
//                    each item becomes a clickable button. Clicking a series
//                    isolates it (dims others in the chart); clicking again
//                    resets. Each item should carry a `dataKey` used as its
//                    identity; if omitted, `label` is used as the key.
//
// The interactive click behavior is on-screen only; before PDF capture, the
// doPrint routine dispatches a "cr-reset-isolation" window event that clears
// isolation across all charts so the printed report always shows the full
// chart.
export const StaticLegend = ({
  items, keys, colors, testid,
  size = 8.5, align = "center",
  isolated, onToggle,
}) => {
  const list = items && items.length
    ? items
    : (keys || []).map((k) => ({ label: k, color: (colors || {})[k] }));
  if (!list.length) return null;
  const interactive = typeof onToggle === "function";
  return (
    <div
      data-testid={testid}
      data-docx="legend"
      data-isolated={isolated || ""}
      style={{
        display: "flex", flexWrap: "wrap",
        justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
        gap: "2px 10px", fontSize: size, lineHeight: 1.4,
        color: "#2A2A2A", marginTop: 4, padding: "0 6px",
      }}
    >
      {list.map((it, i) => {
        const key = it.dataKey || it.label;
        const isThis = isolated === key;
        const isDimmed = interactive && isolated && !isThis;
        const commonStyle = {
          display: "inline-flex", alignItems: "center", whiteSpace: "nowrap",
          opacity: isDimmed ? 0.4 : 1,
          fontWeight: isThis ? 600 : "normal",
          transition: "opacity 120ms ease, font-weight 120ms ease",
        };
        const swatch = (
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: 1,
            background: it.color || "#999", marginRight: 4,
            WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
          }} />
        );
        if (!interactive) {
          return (
            <span key={`${it.label}-${i}`} style={commonStyle}>
              {swatch}{it.label}
            </span>
          );
        }
        return (
          <button
            key={`${it.label}-${i}`}
            type="button"
            onClick={() => onToggle(key)}
            data-testid={testid ? `${testid}-item-${key}` : undefined}
            data-active={isThis ? "true" : "false"}
            style={{
              ...commonStyle,
              background: "transparent", border: "none", padding: "1px 3px",
              cursor: "pointer", color: "inherit", font: "inherit",
              borderRadius: 3,
            }}
            title={isThis ? "Click to reset" : `Click to isolate ${it.label}`}
          >
            {swatch}{it.label}
          </button>
        );
      })}
    </div>
  );
};

// State + helpers for the "click a legend item to isolate this series" pattern
// used across the on-screen Client Report / SS Report chart previews. Each
// chart page calls `const iso = useIsolation()` and then:
//   • Sprinkles `{...iso.dim("dataKey")}` onto every <Bar/Line/Area> to fade
//     non-isolated series while one is active.
//   • Passes `isolated={iso.isolated} onToggle={iso.toggle}` into
//     <StaticLegend> and gives each legend item a `dataKey`.
// Before PDF capture, the report's doPrint dispatches a window event
// "cr-reset-isolation" that every hook listens for — that way the printed PDF
// always contains the full, un-dimmed chart even if the advisor left a series
// isolated on-screen for teaching purposes.
export const useIsolation = () => {
  const [isolated, setIsolated] = useState(null);
  useEffect(() => {
    const reset = () => setIsolated(null);
    window.addEventListener("cr-reset-isolation", reset);
    return () => window.removeEventListener("cr-reset-isolation", reset);
  }, []);
  const toggle = useCallback((key) => {
    setIsolated((cur) => (cur === key ? null : key));
  }, []);
  const dim = useCallback((key) => {
    // Returns fillOpacity + strokeOpacity props for a Recharts series. Non-isolated
    // series drop to 0.15 opacity; the isolated series (or every series when
    // nothing is isolated) stays fully visible.
    if (!isolated || isolated === key) return {};
    return { fillOpacity: 0.15, strokeOpacity: 0.25 };
  }, [isolated]);
  return { isolated, toggle, dim, reset: () => setIsolated(null) };
};

// Fired by doPrint just before html2canvas rasterizes the report. All active
// useIsolation() hooks listen for this event and reset to null so the printed
// PDF captures the full, un-dimmed chart. Call: await resetChartIsolation();
export const resetChartIsolation = async () => {
  window.dispatchEvent(new CustomEvent("cr-reset-isolation"));
  // Give React a beat to re-render with restored opacities before the caller
  // starts capturing pixels.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};
