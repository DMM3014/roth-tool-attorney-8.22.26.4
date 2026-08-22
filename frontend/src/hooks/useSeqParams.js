/**
 * useSeqParams — the sequence-of-returns stress-test inputs, shared by the
 * Sequence Risk tab, the Client Report page and the deck page so the printed
 * table can never be built on different settings than the advisor is viewing.
 * Same store pattern as useSharedGuardrail.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sequence_stress_params_v1";
const EVENT = "sequence-stress-params:change";

export const SEQ_DEFAULTS = {
  bear_return: -0.15,
  early_years: 3,
  late_years: 5,
  vol_min: -0.15,
  vol_max: 0.20,
};

const readStored = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { ...SEQ_DEFAULTS, ...(raw ? JSON.parse(raw) : null) };
  } catch {
    return { ...SEQ_DEFAULTS };
  }
};

export function useSeqParams() {
  const [params, setLocal] = useState(readStored);

  useEffect(() => {
    const onChange = (e) => { if (e?.detail) setLocal(e.detail); };
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setLocal(readStored()); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setParam = useCallback((k, v) => {
    setLocal((prev) => {
      const next = { ...prev, [k]: v };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const resetParams = useCallback(() => {
    const next = { ...SEQ_DEFAULTS };
    setLocal(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: next })); } catch { /* ignore */ }
  }, []);

  // Stable string for effect dependencies / staleness checks.
  const seqSig = `${params.bear_return}|${params.early_years}|${params.late_years}|${params.vol_min}|${params.vol_max}`;

  return { seqParams: params, setSeqParam: setParam, resetSeqParams: resetParams, seqSig };
}
