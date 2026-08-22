// Context wrapping <GridPrefsProvider> around any tree that hosts multiple
// grid tabs so density / scale / focus are shared LIVE across mounted tabs
// (previously each grid maintained its own state that only synced via
// localStorage on unmount, causing brief inconsistencies when switching tabs
// without a re-render). Mount at the Planner root — see App/Planner.jsx.
import { createContext, useContext, useEffect, useState } from "react";

const LS_KEY = "roth-planner:gridPrefs:v1";

const readPrefs = () => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
    if (!raw) return null;
    const p = JSON.parse(raw);
    const density = p.density === "roomy" ? "roomy" : "compact";
    const scale = ["full", "k", "m"].includes(p.scale) ? p.scale : "full";
    const focus = ["all", "pre-ss", "ss-to-rmd", "rmd-window", "post-first-death"].includes(p.focus) ? p.focus : "all";
    return { density, scale, focus };
  } catch { return null; }
};

const writePrefs = (prefs) => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch { /* quota / private-mode: ignore */ }
};

const GridPrefsContext = createContext(null);

export const GridPrefsProvider = ({ children }) => {
  const initial = readPrefs() || { density: "compact", scale: "full", focus: "all" };
  const [density, setDensity] = useState(initial.density);
  const [scale, setScale] = useState(initial.scale);
  const [focus, setFocus] = useState(initial.focus);
  useEffect(() => {
    writePrefs({ density, scale, focus });
  }, [density, scale, focus]);
  const value = { density, setDensity, scale, setScale, focus, setFocus };
  return <GridPrefsContext.Provider value={value}>{children}</GridPrefsContext.Provider>;
};

// Prefer the context when available (Planner-mounted); gracefully falls back
// to an independent per-component state when a grid is rendered outside the
// Provider (e.g. Storybook / isolated tests / future embed).
export const useGridPrefs = () => {
  const ctx = useContext(GridPrefsContext);
  const [localDensity, setLocalDensity] = useState(() => readPrefs()?.density ?? "compact");
  const [localScale, setLocalScale] = useState(() => readPrefs()?.scale ?? "full");
  const [localFocus, setLocalFocus] = useState(() => readPrefs()?.focus ?? "all");
  useEffect(() => {
    if (ctx) return; // provider owns persistence
    writePrefs({ density: localDensity, scale: localScale, focus: localFocus });
  }, [ctx, localDensity, localScale, localFocus]);
  if (ctx) return ctx;
  return {
    density: localDensity, setDensity: setLocalDensity,
    scale: localScale, setScale: setLocalScale,
    focus: localFocus, setFocus: setLocalFocus,
  };
};

// Detect key milestone years from the projection rows. Row keys used:
//   - `gross_ss > 0`  → SS claim started
//   - `rmd > 0`       → RMD required
// The first-death year is taken from the HOUSEHOLD (dob + life expectancy,
// earlier of the two) when a scenario is supplied. The old row-derived signals
// — the filing-status flip and an age going null — both land on the year AFTER
// the death, and they never fire at all when the survivor's filing status is
// configured as MFJ, which pushed the "After first death" focus window to the
// wrong year. Row detection is kept as a fallback.
// Returns a stable object even when milestones aren't reached (nulls).
export const detectMilestones = (rows, scenario = null) => {
  if (!rows || !rows.length) return { firstSs: null, firstRmd: null, firstDeath: null, last: null };
  const firstSs = rows.find((r) => (r.gross_ss || 0) > 0)?.year ?? null;
  const firstRmd = rows.find((r) => (r.rmd || 0) > 0)?.year ?? null;
  const last = rows[rows.length - 1].year;

  const h = scenario?.household;
  const deathYear = (dob, le) => (dob && le ? dob + le : null);
  const deaths = h
    ? [deathYear(h.client_dob_year, h.client_life_expectancy),
       h.has_spouse === false ? null : deathYear(h.spouse_dob_year, h.spouse_life_expectancy)]
      .filter((y) => y != null)
    : [];
  let firstDeath = deaths.length > 1 ? Math.min(...deaths) : null;
  if (firstDeath == null) {
    const firstFiling = rows[0].filing_status;
    firstDeath = rows.find((r) => r.filing_status !== firstFiling)?.year ?? null;
  }
  // Only useful if it actually falls inside the projected range.
  if (firstDeath != null && (firstDeath < rows[0].year || firstDeath > last)) firstDeath = null;

  return { firstSs, firstRmd, firstDeath, last };
};

// Given a focus preset and detected milestones, return the [minYear, maxYear]
// inclusive range that should be visible. When a milestone required by the
// preset is missing, fall back to "all" so the grid never renders empty.
export const focusRangeYears = (focus, milestones) => {
  if (focus === "all") return null;
  const { firstSs, firstRmd, firstDeath, last } = milestones || {};
  if (focus === "pre-ss" && firstSs != null) return [-Infinity, firstSs - 1];
  if (focus === "ss-to-rmd" && firstSs != null) return [firstSs, (firstRmd || last) - 1];
  if (focus === "rmd-window" && firstRmd != null) return [firstRmd, last ?? Infinity];
  if (focus === "post-first-death" && firstDeath != null) return [firstDeath, last ?? Infinity];
  return null;
};

export const FOCUS_OPTIONS = [
  { key: "all",              label: "All years" },
  { key: "pre-ss",           label: "Pre-SS window" },
  { key: "ss-to-rmd",        label: "SS → RMD" },
  { key: "rmd-window",       label: "RMD window" },
  { key: "post-first-death", label: "After first death" },
];
