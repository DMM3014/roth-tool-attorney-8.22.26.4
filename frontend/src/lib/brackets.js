/**
 * Federal ordinary-bracket geometry shared by the interactive Tax Bracket
 * Visualizer (BracketVisualizer.jsx) and its printed Client Report snapshots
 * (clientReport/BracketSnapshotsPage.jsx).
 *
 * Base floors are the 2025 statutory anchor from backend/tax_engine.py; the
 * per-year `bracket_index` multiplier on each projection row indexes them.
 */
export const RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
export const FLOORS_MFJ = [0, 24800, 101200, 211400, 403550, 512450, 768700];
export const FLOORS_SGL = [0, 12400, 50600, 105700, 201775, 256225, 640600];
// Base standard deduction (matches STD_MFJ / STD_SGL in tax_engine.py).
export const STD_MFJ = 30000;
export const STD_SGL = 15000;

export const BRACKET_COLORS = [
  "#DCE6D1", "#C1D3B0", "#A6C08F", "#8CAF6E",
  "#D8B764", "#B8983E", "#8C6F27",
];

export const humanUsd = (v) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
};

export const isMfjScenario = (scenario) =>
  (scenario?.tax?.filing_status || (scenario?.household?.spouse_name ? "MFJ" : "Single")) === "MFJ";

export const floorsFor = (mfj, bracketIndex = 1) =>
  (mfj ? FLOORS_MFJ : FLOORS_SGL).map((f) => f * bracketIndex);

export const stdDedFor = (mfj, bracketIndex = 1) => (mfj ? STD_MFJ : STD_SGL) * bracketIndex;

// Incremental federal tax on `extra` ordinary dollars stacked on `ordinaryBase`
// (same differential-rate ladder as backend federal_ordinary_tax).
export function computeIncrementalTax(ordinaryBase, extra, floors) {
  if (extra <= 0) return { extraTax: 0, marginalRateAtTop: marginalAt(ordinaryBase, floors) };
  const total = ordinaryBase + extra;
  return {
    extraTax: taxAt(total, floors) - taxAt(ordinaryBase, floors),
    marginalRateAtTop: marginalAt(total, floors),
  };
}

function taxAt(amt, floors) {
  let t = 0;
  for (let i = 0; i < RATES.length; i++) {
    if (amt > floors[i]) {
      const nextFloor = i + 1 < RATES.length ? floors[i + 1] : Infinity;
      const inBand = Math.min(amt, nextFloor) - floors[i];
      if (inBand > 0) t += inBand * RATES[i];
    }
  }
  return t;
}

function marginalAt(amt, floors) {
  let r = RATES[0];
  for (let i = 0; i < RATES.length; i++) {
    if (amt > floors[i]) r = RATES[i];
  }
  return r;
}

/**
 * Everything a bucket diagram needs for ONE projection row: indexed floors,
 * the year's ordinary taxable income excluding the conversion, the conversion
 * stacked on top, the marginal rate on the last dollar, the federal tax the
 * conversion itself generated, and the dollars left before the next bracket.
 */
export const bracketFactsForRow = (row, mfj) => {
  if (!row) return null;
  const bracketIndex = row.bracket_index ?? 1;
  const floors = floorsFor(mfj, bracketIndex);
  const conversion = row.roth_conversion || 0;
  const taxable = row.tax_detail?.ordinary_taxable_income ?? row.ordinary_taxable_income ?? 0;
  const baseOrdinary = Math.max(0, taxable - conversion);
  const total = baseOrdinary + conversion;
  const inc = computeIncrementalTax(baseOrdinary, conversion, floors);
  const nextEdge = floors.find((f) => f > total);
  return {
    year: row.year,
    clientAge: row.client_age ?? null,
    spouseAge: row.spouse_age ?? null,
    bracketIndex,
    floors,
    stdDed: stdDedFor(mfj, bracketIndex),
    conversion,
    baseOrdinary,
    total,
    rmd: row.rmd || 0,
    marginalRateAtTop: inc.marginalRateAtTop,
    conversionTax: inc.extraTax,
    blendedRate: conversion > 0 ? inc.extraTax / conversion : null,
    headroom: nextEdge != null ? nextEdge - total : null,
  };
};
