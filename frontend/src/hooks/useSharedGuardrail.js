/**
 * useSharedGuardrail — one source of truth for the Monte Carlo "Spending
 * guardrail" toggle across every surface that renders it (the MC simulation
 * tab and the Client Report MC behavior card, primarily).
 *
 * Prior behaviour was two disconnected pieces of local state, each persisted
 * to its own localStorage key. Advisors reported that flipping the guardrail
 * on the MC tab did not follow through to the Client Report (and vice-versa),
 * and that both defaulted to OFF even though the guardrail is the intended
 * conservative default.
 *
 * Implementation notes:
 *   • Persists to a single key `shared_mc_guardrail_v1` shared by every
 *     consumer, so a fresh session in either tab starts from the same value.
 *   • Broadcasts a same-tab "mc-guardrail:change" custom event on every
 *     update so sibling consumers mounted in the same document (e.g. the MC
 *     tab and the Client Report tab hidden in another <Tabs> pane) receive
 *     the change without a reload. The native `storage` event only fires
 *     cross-tab, which is not enough here.
 *   • Default is ON with a 10% discretionary-spend cut.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "shared_mc_guardrail_v1";
const EVENT = "mc-guardrail:change";
const DEFAULT = { enabled: true, cut_pct: 10 };

const readStored = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT.enabled,
      cut_pct: typeof parsed.cut_pct === "number" ? parsed.cut_pct : DEFAULT.cut_pct,
    };
  } catch {
    return { ...DEFAULT };
  }
};

export function useSharedGuardrail() {
  const [state, setState] = useState(readStored);

  // Same-tab sync: any consumer that calls setEnabled/setCut fires a
  // "mc-guardrail:change" event with the fresh value; every hook instance
  // updates its own copy from the event payload (never from re-reading
  // localStorage — that would drop numeric values still being typed).
  useEffect(() => {
    const onChange = (e) => {
      const next = e?.detail;
      if (!next) return;
      setState((prev) => (prev.enabled === next.enabled && prev.cut_pct === next.cut_pct
        ? prev : next));
    };
    // Cross-tab: someone else's window edited localStorage.
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return;
      setState(readStored());
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const commit = useCallback((next) => {
    setState(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
  }, []);

  const setEnabled = useCallback((v) => {
    const nextEnabled = typeof v === "function" ? v(state.enabled) : !!v;
    commit({ enabled: nextEnabled, cut_pct: state.cut_pct });
  }, [state.enabled, state.cut_pct, commit]);

  const setCut = useCallback((v) => {
    const raw = typeof v === "function" ? v(state.cut_pct) : v;
    const n = Math.max(0, Math.min(50, parseInt(raw, 10) || 0));
    commit({ enabled: state.enabled, cut_pct: n });
  }, [state.enabled, state.cut_pct, commit]);

  return { grOn: state.enabled, setGrOn: setEnabled, grCut: state.cut_pct, setGrCut: setCut };
}
