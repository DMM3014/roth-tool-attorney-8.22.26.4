/**
 * useFlowPlans — which of the five estate-funding plans to display, shared
 * between the Client Report and the EP Flowchart tab.
 *
 * The Client Report has always owned this selection (localStorage
 * `client_report_flow_plans_v3`, defaulting to Plans 1–3 per an earlier advisor
 * request). The EP Flowchart tab used to render all five unconditionally, so the
 * two surfaces disagreed. Both now read and write the same key, with the same
 * same-tab event + cross-tab storage sync used by useSharedHalt.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "client_report_flow_plans_v3";
const EVENT = "flow-plans:change";
export const ALL_PLANS = [1, 2, 3, 4, 5];
const DEFAULT = { 1: true, 2: true, 3: true, 4: false, 5: false };

const readStored = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { ...DEFAULT, ...(raw ? JSON.parse(raw) : null) };
  } catch {
    return { ...DEFAULT };
  }
};

export function useFlowPlans() {
  const [plans, setPlans] = useState(readStored);

  useEffect(() => {
    const onChange = (e) => { if (e?.detail) setPlans(e.detail); };
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setPlans(readStored()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const commit = useCallback((next) => {
    setPlans(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
  }, []);

  const setFlowPlans = useCallback((v) => {
    setPlans((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const togglePlan = useCallback((n, on) => {
    setFlowPlans((prev) => ({ ...prev, [n]: !!on }));
  }, [setFlowPlans]);

  const selected = ALL_PLANS.filter((n) => plans[n]);
  return { flowPlans: plans, setFlowPlans, togglePlan, selected, commit };
}
