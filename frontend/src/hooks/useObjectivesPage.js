/**
 * useObjectivesPage — whether the dollar-free "What are we planning for?" page
 * prints. Advisor's choice, OFF by default (the objectives conversation doesn't
 * belong in every deliverable). One switch drives BOTH the Client Report page
 * and the deck slide, shared the same way as useSharedHalt / useFlowPlans.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "shared_objectives_page_v1";
const EVENT = "objectives-page:change";

const readStored = () => {
  try { return window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
};

export function useObjectivesPage() {
  const [on, setOn] = useState(readStored);

  useEffect(() => {
    const onChange = (e) => setOn(!!e?.detail);
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setOn(readStored()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setEnabled = useCallback((v) => {
    const next = !!v;
    setOn(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
  }, []);

  return { objectivesOn: on, setObjectivesOn: setEnabled };
}
