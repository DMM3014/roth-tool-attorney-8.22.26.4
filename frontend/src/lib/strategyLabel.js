// Shared derivation of the currently-modeled Roth conversion strategy from a
// scenario config. Used by every page that displays results driven by
// `scenario.roth` so the label stays in sync across Projection, Detail/Cashflow,
// Analytics, Presentation, and the Strategy Analyzer.
//
// Shape returned:
//   { active, kind, label, pctLabel, yearsLabel, fundingOrder }
//
// - active: false  → "No conversion active"
// - kind: "single" → `Fill 22% · 2026–2033`
// - kind: "phased" → `Phased: 32% · 2026–2029 → 22% · 2030–2033`
/**
 * Does the scenario currently model EXACTLY the strategy in a sweep row?
 *
 * Compare structurally, never by label. The sweep's own labels carry extra
 * decoration the applied-scenario label can never reproduce — a 4D funding-order
 * sweep appends " · IRA-1st", and phased rows read "Fill 32% pre-SS (2026-2032),
 * 24% after" versus the applied "Phased: 32% · 2026–2032 → 24% · 2033–2049". A
 * string compare therefore reported "different from best" forever, even straight
 * after Apply, which is what advisors were seeing.
 */
export const appliedMatchesSweepRow = (scenario, row) => {
  if (!row) return false;
  const roth = scenario?.roth || {};
  if (row.kind === "baseline") return !roth.enabled;
  if (!roth.enabled) return false;
  const yt = roth.year_targets || {};
  const ytYears = Object.keys(yt);
  const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 1e-9;

  if (row.kind === "single") {
    if (ytYears.length) return false;              // a phased schedule is applied
    return near(roth.target_bracket, row.bracket)
      && roth.start_year === row.start_year
      && roth.end_year === row.stop_year;
  }
  if (row.kind === "phased" && Array.isArray(row.segments)) {
    if (!ytYears.length) return false;
    const expected = {};
    row.segments.forEach((s) => {
      for (let y = s.start_year; y <= s.stop_year; y++) expected[y] = s.bracket;
    });
    const expYears = Object.keys(expected);
    if (expYears.length !== ytYears.length) return false;
    return expYears.every((y) => near(yt[y], expected[y]));
  }
  return false;
};

export const getStrategyLabel = (scenario) => {
  const roth = scenario?.roth || {};
  const fundingOrder = scenario?.withdrawal?.funding_order || "Cash → Taxable → IRA → Roth";

  if (!roth.enabled) {
    return {
      active: false,
      kind: "baseline",
      label: "No conversion active",
      pctLabel: "—",
      yearsLabel: "—",
      fundingOrder,
    };
  }

  // Phased schedule (per-year target brackets set by the Strategy Analyzer)
  const yt = roth.year_targets;
  if (yt && Object.keys(yt).length > 0) {
    const years = Object.keys(yt).map((y) => parseInt(y, 10)).sort((a, b) => a - b);
    const segs = [];
    let curBracket = yt[years[0]];
    let segStart = years[0];
    for (let i = 1; i <= years.length; i++) {
      const y = years[i];
      const bkt = y != null ? yt[y] : null;
      const prevY = years[i - 1];
      const isBreak = i === years.length || bkt !== curBracket || y !== prevY + 1;
      if (isBreak) {
        segs.push({ start: segStart, stop: prevY, bracket: curBracket });
        if (i < years.length) { curBracket = bkt; segStart = y; }
      }
    }
    const segStr = segs.map((s) =>
      `${Math.round(s.bracket * 100)}% · ${s.start}${s.stop !== s.start ? `–${s.stop}` : ""}`
    ).join(" → ");
    return {
      active: true,
      kind: "phased",
      label: `Phased: ${segStr}`,
      pctLabel: segs.map((s) => `${Math.round(s.bracket * 100)}%`).join(" → "),
      yearsLabel: `${segs[0].start}–${segs[segs.length - 1].stop}`,
      fundingOrder,
    };
  }

  // Single-bracket schedule
  const pct = roth.target_bracket != null ? `${Math.round(roth.target_bracket * 100)}%` : "—";
  const start = roth.start_year ?? "—";
  const stop = roth.end_year ?? "—";
  const yearsLabel = `${start}${stop !== start ? `–${stop}` : ""}`;
  return {
    active: true,
    kind: "single",
    label: `Fill ${pct} · ${yearsLabel}`,
    pctLabel: pct,
    yearsLabel,
    fundingOrder,
  };
};
