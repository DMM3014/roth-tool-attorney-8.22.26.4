/**
 * useSharedHalt — one source of truth for the Monte Carlo "halt conversions on
 * drawdown" rule across every surface that renders it (the MC simulation tab
 * and the Client Report MC behavior card).
 *
 * Same design as useSharedGuardrail: previously these were two disconnected
 * pieces of local state under different localStorage keys, so changing the
 * drawdown threshold on the MC tab did not follow through to the printed
 * Client Report (and vice-versa) — the report could be run on a different
 * behavioral rule than the one the advisor was looking at.
 *
 * Defaults (advisor request, 2026-08-20): ON, halt on a 20% YoY drop, resume
 * after 1 positive year.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "shared_mc_halt_v1";
const EVENT = "mc-halt:change";
const DEFAULT = { enabled: true, drop_pct: 20, resume_years: 1 };

const readStored = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT.enabled,
      drop_pct: typeof parsed.drop_pct === "number" ? parsed.drop_pct : DEFAULT.drop_pct,
      resume_years: typeof parsed.resume_years === "number" ? parsed.resume_years : DEFAULT.resume_years,
    };
  } catch {
    return { ...DEFAULT };
  }
};

export function useSharedHalt() {
  const [state, setState] = useState(readStored);

  useEffect(() => {
    const onChange = (e) => {
      const next = e?.detail;
      if (!next) return;
      setState((prev) => (prev.enabled === next.enabled && prev.drop_pct === next.drop_pct
        && prev.resume_years === next.resume_years ? prev : next));
    };
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
    const enabled = typeof v === "function" ? v(state.enabled) : !!v;
    commit({ ...state, enabled });
  }, [state, commit]);

  const setDrop = useCallback((v) => {
    const raw = typeof v === "function" ? v(state.drop_pct) : v;
    const n = Math.max(2, Math.min(50, parseFloat(raw) || 0));
    commit({ ...state, drop_pct: n });
  }, [state, commit]);

  const setResume = useCallback((v) => {
    const raw = typeof v === "function" ? v(state.resume_years) : v;
    const n = Math.max(0, Math.min(20, parseInt(raw, 10) || 0));
    commit({ ...state, resume_years: n });
  }, [state, commit]);

  return {
    haltOn: state.enabled, setHaltOn: setEnabled,
    haltDrop: state.drop_pct, setHaltDrop: setDrop,
    haltResume: state.resume_years, setHaltResume: setResume,
  };
}
