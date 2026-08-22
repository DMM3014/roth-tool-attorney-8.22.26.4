import React from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RotateCcw, ListChecks } from "lucide-react";
import { DECK_PAGES, DECK_FIXED_PAGES, DECK_PAGE_SPAN } from "@/lib/deckPages";

/**
 * DeckPagePicker — "tick exactly which pages go in the Client Deck".
 * Rows backed by an existing advisor toggle (assumptions, robustness, regimes,
 * longevity, beneficiary band, planning considerations) write to that same flag,
 * so the deck never grows a second competing control for one page.
 */
export const DeckPagePicker = ({
  deckPages, toggleDeckPage, resetDeckPages, branding, upd,
  objectivesOn, setObjectivesOn, availability = {},
}) => {
  const valueOf = (p) => {
    if (p.src === "branding") return !!branding?.[p.flag];
    if (p.src === "objectives") return !!objectivesOn;
    return !!deckPages?.[p.key];
  };
  const setValue = (p, v) => {
    if (p.src === "branding") upd(p.flag, v);
    else if (p.src === "objectives") setObjectivesOn(v);
    else toggleDeckPage(p.key, v);
  };
  const missing = (p) => availability[p.key] === false;
  const on = DECK_PAGES.filter((p) => valueOf(p) && !missing(p));
  const pageCount = DECK_FIXED_PAGES.length
    + on.reduce((t, p) => t + (DECK_PAGE_SPAN[p.key] || 1), 0);

  return (
    <div className="mt-4 rounded-lg border border-[#4A6741]/30 bg-white p-4"
         data-testid="deck-page-picker">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-sm font-semibold text-[#1A1A1A] flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-[#4A6741]" /> Pages in this deck
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground tabular-nums"
                data-testid="deck-page-picker-count">
            {pageCount} pages
          </span>
          <Button size="sm" variant="outline" onClick={resetDeckPages}
                  data-testid="deck-page-picker-reset"
                  className="h-7 gap-1.5 text-[10px] rounded-full">
            <RotateCcw className="h-3 w-3" /> Short deck
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        Tick exactly what the client sees. <span className="font-medium">{DECK_FIXED_PAGES.join(" and ")}</span> always
        print. Turning a page on here also turns it on for the full Presentation deck where the two share a setting.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        {DECK_PAGES.map((p) => {
          const isMissing = missing(p);
          const hint = isMissing
            ? (p.missingHint || "Not available yet — the underlying run hasn't been produced")
            : p.hint;
          return (
            <label key={p.key}
                   className={`flex items-start gap-2 ${isMissing ? "opacity-60" : "cursor-pointer"}`}>
              <Switch checked={valueOf(p) && !isMissing} disabled={isMissing}
                      onCheckedChange={(v) => setValue(p, !!v)}
                      data-testid={`deck-page-toggle-${p.key}`} className="mt-0.5" />
              <span className="text-xs text-[#1A1A1A] leading-snug">
                {p.label}
                {hint && (
                  <span className={`block text-[10px] ${isMissing ? "text-[#C87941]" : "text-muted-foreground"}`}>
                    {hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default DeckPagePicker;
