import { useEffect, useState, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";

import { CoverPage } from "./CoverPage";
import { HowSSWorksPage } from "./HowSSWorksPage";
import { BenefitsByAgePage } from "./BenefitsByAgePage";
import { LifetimeBenefitsPage } from "./LifetimeBenefitsPage";
import { CoordinatedClaimingPage } from "./CoordinatedClaimingPage";
import { RothInteractionPage } from "./RothInteractionPage";
import { TaxationIRMAAPage } from "./TaxationIRMAAPage";
import { SurvivorBenefitsPage } from "./SurvivorBenefitsPage";
import { RecommendationsPage } from "./RecommendationsPage";

// ============================================================================
// PresenterMode — fullscreen dark-mode slide-deck view of the SS Report
// Advisors use this to walk clients through the report on a call/screen-share.
// Keyboard: ← / →, Space (next), Home / End, Esc.
// Click left/right thirds of the slide to advance / go back.
// One page centered per slide, styled for a dimly lit room (dark bg, off-white content).
// ============================================================================
export const PresenterMode = ({
  branding, household, prettyDate, scenario, withRoth, ssResult, fraAmounts, fraAges, aiText, logo, onClose,
}) => {
  const [idx, setIdx] = useState(0);

  const hasSpouse = scenario?.household?.spouse_dob_year != null;

  // Build the ordered slide list — same 9 pages as the printed report. Advisor
  // Commentary is never in Presenter Mode; it's an advisor-only working doc.
  const slides = [
    { label: "Cover", node: (
      <CoverPage branding={branding} household={household} prettyDate={prettyDate} scenario={scenario}
        fraAges={fraAges} fraAmounts={fraAmounts} logo={logo} first />
    ) },
    { label: "How SS Works", node: <HowSSWorksPage fraAges={fraAges} /> },
    { label: "Benefits by Age", node:
      <BenefitsByAgePage scenario={scenario} fraAmounts={fraAmounts} fraAges={fraAges} /> },
    { label: "Lifetime Benefits", node:
      <LifetimeBenefitsPage scenario={scenario} fraAmounts={fraAmounts} fraAges={fraAges} owner="Client" /> },
    { label: "Coordinated Claiming", node: <CoordinatedClaimingPage ssResult={ssResult} /> },
    { label: "Roth Interaction", node: <RothInteractionPage withRoth={withRoth} scenario={scenario} /> },
    { label: "Taxation & IRMAA", node: <TaxationIRMAAPage withRoth={withRoth} scenario={scenario} /> },
    { label: "Survivor Benefits", node:
      <SurvivorBenefitsPage scenario={scenario} fraAmounts={fraAmounts} fraAges={fraAges}
        includeSpousal={branding.include_spousal !== false} /> },
    { label: "Recommendations", node:
      <RecommendationsPage ssResult={ssResult} scenario={scenario} fraAmounts={fraAmounts} /> },
  ];

  const advance = useCallback((delta) => {
    setIdx((cur) => Math.max(0, Math.min(slides.length - 1, cur + delta)));
  }, [slides.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); advance(1); return; }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); advance(-1); return; }
      if (e.key === "Home") { e.preventDefault(); setIdx(0); return; }
      if (e.key === "End") { e.preventDefault(); setIdx(slides.length - 1); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, onClose, slides.length]);

  // Try browser fullscreen on mount (best-effort — some browsers require a user
  // gesture and reject with "Permissions check failed" which we silently ignore).
  useEffect(() => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) {
      try {
        const result = req.call(el);
        if (result && typeof result.catch === "function") {
          result.catch(() => { /* fullscreen denied — that's fine, we stay in-window */ });
        }
      } catch { /* silently ignore */ }
    }
    return () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        try {
          const p = document.exitFullscreen();
          if (p && typeof p.catch === "function") p.catch(() => { /* ignore */ });
        } catch { /* ignore */ }
      }
    };
  }, []);

  const cur = slides[idx];
  const isFirst = idx === 0;
  const isLast = idx === slides.length - 1;

  return (
    <div
      data-testid="ssr-presenter-mode"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "#0E1512",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* Top bar — advisor branding + slide title + close */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)",
        color: "#E8E4D6",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {logo?.dataUrl && (
            <img src={logo.dataUrl} alt="" style={{ height: 26, width: "auto", opacity: 0.9 }} />
          )}
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", opacity: 0.65 }}>
              {branding.advisor_firm || "Social Security Analysis"}
            </div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 15, fontWeight: 600 }}>
              {household} · {cur.label}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.65, fontVariantNumeric: "tabular-nums" }}
               data-testid="ssr-presenter-counter">
            Slide {idx + 1} / {slides.length}
          </div>
          <Button size="sm" variant="ghost"
            onClick={onClose} data-testid="ssr-presenter-close"
            className="h-8 gap-1 text-xs" style={{ color: "#E8E4D6" }}>
            <X className="h-4 w-4" /> Exit (Esc)
          </Button>
        </div>
      </header>

      {/* Slide area — a paper-like card on a dim background, centered, no scroll */}
      <main
        style={{
          flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
          padding: "36px 40px 60px 40px", overflow: "auto",
        }}
        onClick={(e) => {
          // Click left third → back, right third → forward, middle = do nothing
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = (e.clientX - rect.left) / rect.width;
          if (relX < 0.33) advance(-1);
          else if (relX > 0.67) advance(1);
        }}
      >
        <div
          data-testid={`ssr-presenter-slide-${idx}`}
          style={{
            background: "#FBFAF6",
            color: "#1A1A1A",
            padding: "56px 72px",
            width: "min(1180px, 95vw)",
            minHeight: "min(76vh, 780px)",
            borderRadius: 8,
            boxShadow: "0 24px 80px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.35)",
            fontFamily: "Outfit, 'Helvetica Neue', sans-serif",
            // Scale interior typography up ~25% for presentation legibility
            fontSize: 14,
          }}
        >
          {/* Wrap the page node in a magnifier — the pages set their own inline fontSizes,
              so we override H1/H2/H3 + KPI values via a targeted CSS zoom. */}
          <div style={{ zoom: 1.35 }} className="ssr-presenter-slide-body">
            {cur.node}
          </div>
        </div>

        {/* Navigation arrows (visible cue in addition to click zones + keyboard) */}
        {!isFirst && (
          <button
            onClick={(e) => { e.stopPropagation(); advance(-1); }}
            data-testid="ssr-presenter-prev"
            aria-label="Previous slide"
            style={{
              position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)",
              color: "#E8E4D6", borderRadius: 999, width: 46, height: 46,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {!isLast && (
          <button
            onClick={(e) => { e.stopPropagation(); advance(1); }}
            data-testid="ssr-presenter-next"
            aria-label="Next slide"
            style={{
              position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)",
              color: "#E8E4D6", borderRadius: 999, width: 46, height: 46,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </main>

      {/* Bottom bar — slide dots + shortcut reminder */}
      <footer style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px", borderTop: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(232,228,214,0.55)", fontSize: 11,
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          {slides.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setIdx(i)}
              data-testid={`ssr-presenter-dot-${i}`}
              aria-label={`Go to slide ${i + 1}`}
              style={{
                width: i === idx ? 22 : 8, height: 8, borderRadius: 4, border: "none",
                background: i === idx ? "#4A9B76" : "rgba(255,255,255,0.22)",
                cursor: "pointer", transition: "width 150ms ease-in-out, background 150ms",
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <span>← / → or Space to advance</span>
          <span>Click left/right to move</span>
          <span>Esc to exit</span>
        </div>
      </footer>
    </div>
  );
};
