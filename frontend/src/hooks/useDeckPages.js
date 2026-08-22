/**
 * useDeckPages — which pages the curated Client Deck prints. Same one-key +
 * same-tab event + cross-tab storage pattern as useFlowPlans / useObjectivesPage.
 * Only the "deck"-owned rows live here; rows backed by a branding flag or the
 * objectives switch keep their existing single source of truth.
 */
import { useCallback, useEffect, useState } from "react";
import { DECK_DEFAULTS } from "@/lib/deckPages";

const STORAGE_KEY = "client_deck_pages_v1";
const EVENT = "deck-pages:change";

const readStored = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { ...DECK_DEFAULTS, ...(raw ? JSON.parse(raw) : null) };
  } catch {
    return { ...DECK_DEFAULTS };
  }
};

export function useDeckPages() {
  const [pages, setPages] = useState(readStored);

  useEffect(() => {
    const onChange = (e) => { if (e?.detail) setPages(e.detail); };
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setPages(readStored()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const commit = useCallback((next) => {
    setPages(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
  }, []);

  const toggleDeckPage = useCallback((key, on) => {
    setPages((prev) => {
      const next = { ...prev, [key]: !!on };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const resetDeckPages = useCallback(() => commit({ ...DECK_DEFAULTS }), [commit]);

  return { deckPages: pages, toggleDeckPage, resetDeckPages };
}
