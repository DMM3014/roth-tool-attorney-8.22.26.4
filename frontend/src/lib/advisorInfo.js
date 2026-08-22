// Shared advisor-info store — the advisor's own identity (name, firm, contact
// info, logo). Client Report and Presentation both read from this so a firm's
// details automatically populate on both reports without re-entry.
import { useEffect, useState } from "react";

export const ADVISOR_INFO_KEY = "advisor_info_v1";
const ADVISOR_INFO_EVENT = "advisor-info-changed";

export const defaultAdvisorInfo = {
  advisor_name: "",
  advisor_firm: "",
  advisor_email: "",
  advisor_phone: "",
};

export const loadAdvisorInfo = () => {
  try {
    const raw = window.localStorage.getItem(ADVISOR_INFO_KEY);
    return raw ? { ...defaultAdvisorInfo, ...JSON.parse(raw) } : defaultAdvisorInfo;
  } catch { return defaultAdvisorInfo; }
};

export const saveAdvisorInfo = (info) => {
  try {
    window.localStorage.setItem(ADVISOR_INFO_KEY, JSON.stringify(info));
    window.dispatchEvent(new CustomEvent(ADVISOR_INFO_EVENT, { detail: info }));
  } catch { /* noop */ }
};

// React hook: subscribes to focus + storage + custom events so any consumer
// (Client Report cover, Presentation cover, footer, etc.) sees updates
// immediately when the user edits fields on the Advisor Info tab.
export const useAdvisorInfo = () => {
  const [info, setInfo] = useState(loadAdvisorInfo);
  useEffect(() => {
    const refresh = () => setInfo(loadAdvisorInfo());
    const onCustom = (e) => setInfo(e?.detail || loadAdvisorInfo());
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener(ADVISOR_INFO_EVENT, onCustom);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(ADVISOR_INFO_EVENT, onCustom);
    };
  }, []);
  return [info, (next) => { saveAdvisorInfo(next); setInfo(next); }];
};
