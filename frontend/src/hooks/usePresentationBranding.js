/**
 * usePresentationBranding — the deck's branding + which-pages-print flags,
 * shared live between the full Presentation tab and the curated Client Deck tab.
 *
 * These used to be plain component state persisted only by the "Save settings"
 * button. Because the two tabs mount two separate <Presentation> instances, a
 * page toggled off in the Client Deck picker silently reverted the moment the
 * advisor switched tabs. Every write now goes straight to localStorage and
 * announces itself, the same pattern as useDeckPages / useObjectivesPage, so the
 * branding-backed picker rows really are ONE control.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "presentation_branding_v1";
const EVENT = "presentation-branding:change";

export const defaultBranding = {
  advisor_name: "",
  advisor_firm: "",
  advisor_email: "",
  advisor_phone: "",
  client_name_override: "",
  spouse_name_override: "",
  presentation_date: new Date().toISOString().slice(0, 10),
  cover_subtitle: "Roth Conversion & Retirement Analysis",
  cover_intro: "",
  closing_notes: "",
  include_narrative: true,
  include_recommendations: true,
  include_assumptions: true,
  include_robustness: true,
  include_regimes: true,
  // Longevity trade-off grid + beneficiary tax-rate band — both default ON so the
  // deck shows the two big unknowns behind the conversion case; advisors can
  // switch either off for a shorter client meeting.
  // Sequence-of-returns page — OFF by default; it needs a run from the
  // Sequence Risk tab before it has anything to print.
  include_sequence_risk: false,
  include_longevity: true,
  include_beneficiary_band: true,
  // Anonymize names in this presentation — default ON so real names are only
  // printed when the advisor deliberately opts in.
  anonymize_names: true,
};

export const loadBranding = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // The report date ALWAYS defaults to today — a saved branding blob would
    // otherwise print whatever date the advisor last opened the settings on.
    return raw
      ? { ...defaultBranding, ...JSON.parse(raw), presentation_date: new Date().toISOString().slice(0, 10) }
      : defaultBranding;
  } catch (e) {
    console.warn("Presentation: failed to parse saved branding, using defaults", e);
    return defaultBranding;
  }
};

export const saveBranding = (b) => {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(b)); }
  catch (e) { console.warn("Presentation: failed to persist branding to localStorage", e); }
};

export function usePresentationBranding() {
  const [branding, setLocal] = useState(loadBranding);

  useEffect(() => {
    const onChange = (e) => { if (e?.detail) setLocal(e.detail); };
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setLocal(loadBranding()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setBranding = useCallback((v) => {
    setLocal((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      saveBranding(next);
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return [branding, setBranding];
}
