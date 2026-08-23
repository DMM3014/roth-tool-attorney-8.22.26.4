// Shared tax-callout math consumed by both the Analyzer's Bump-Zone Alert and
// the new Tax Detail tab. Everything is a pure, side-effect-free function of the
// per-year `row` object emitted by /api/projection — no engine calls needed.
//
// The three callouts we detect:
//   1. LTCG "bump zone" — preferential income crossed the 0→15% or 15→20% cliff
//      compared to the previous year (or entered the 15 / 20 band from below).
//   2. IRMAA step change — MAGI moved into (or out of) a higher IRMAA tier.
//   3. SS Torpedo step — the % of gross SS federally taxable jumped 0→50 or
//      50→85 (or dropped back).
//
// Each callout returns null when it does NOT fire so the frontend can render
// them with a simple truthy check.

// ---- LTCG bump zone ----
// A cliff is "crossed" between year Y-1 and year Y when preferential income
// occupied a lower band in Y-1 and a higher band in Y (band = 0%/15%/20%).
// This is DIFFERENT from the Analyzer's variant (which diffs a hypothetical
// with-conversion vs. without-conversion state within a single year) — here we
// diff the previous calendar year against this one.
export const detectLtcgBump = (row, prevRow) => {
  const td = row?.tax_detail;
  if (!td?.ltcg_band_split) return null;
  const cur = td.ltcg_band_split;
  const pref = td.preferential_taxable || 0;
  if (pref <= 0) return null;
  // Which band held the majority of pref this year and last year?
  const dominantBand = (split) => {
    if (split.in_20 > split.in_15 && split.in_20 > split.in_0) return 20;
    if (split.in_15 >= split.in_0 && split.in_15 > 0) return 15;
    return 0;
  };
  const curBand = dominantBand(cur);
  const prevBand = prevRow?.tax_detail?.ltcg_band_split
    ? dominantBand(prevRow.tax_detail.ltcg_band_split)
    : null;
  // Standing callout (no prev year): only flag if pref sits meaningfully at 15 or 20.
  if (prevBand === null) {
    if (curBand === 20 && cur.in_20 > 1) {
      return { severity: "warn", label: "In 20% LTCG band", detail: cur };
    }
    if (curBand === 15 && cur.in_15 > 1) {
      return { severity: "info", label: "In 15% LTCG band", detail: cur };
    }
    return null;
  }
  if (curBand > prevBand) {
    return {
      severity: curBand === 20 ? "warn" : "info",
      label: `Bump ${prevBand}% → ${curBand}% LTCG`,
      detail: cur,
      from: prevBand,
      to: curBand,
    };
  }
  if (curBand < prevBand) {
    return {
      severity: "good",
      label: `Down ${prevBand}% → ${curBand}% LTCG`,
      detail: cur,
      from: prevBand,
      to: curBand,
    };
  }
  return null;
};

// ---- IRMAA step ----
// IRMAA tier goes 0..5 (5 = highest surcharge). A step-up is a cliff — the
// household pays surcharges on Part B + Part D premiums FOR THE ENTIRE
// FOLLOWING YEAR (2-year lookback rule) once MAGI clears the threshold.
export const detectIrmaaStep = (row, prevRow) => {
  const tier = row?.irmaa_tier ?? 0;
  const prevTier = prevRow?.irmaa_tier ?? 0;
  if (tier === prevTier) {
    // First year at tier > 0 with no comparable prior — surface it once so the
    // advisor sees IRMAA is being paid.
    if (prevRow == null && tier > 0) {
      return { severity: "warn", label: `IRMAA tier ${tier}`, tier, from: null };
    }
    return null;
  }
  if (tier > prevTier) {
    return {
      severity: tier >= 3 ? "warn" : "info",
      label: `IRMAA tier ${prevTier} → ${tier}`,
      tier, from: prevTier,
    };
  }
  return {
    severity: "good",
    label: `IRMAA tier ${prevTier} → ${tier}`,
    tier, from: prevTier,
  };
};

// ---- Social Security "torpedo" ----
// The SS taxability step goes 0% → 50% → 85%. A jump from 0% to 50% (or from
// 50% to 85%) means the couple's provisional income cleared the taxability
// threshold, which can produce a marginal rate of ~40–46% on ordinary income
// because each extra dollar drags more SS into taxability alongside it.
export const detectSsStep = (row, prevRow) => {
  const cur = row?.tax_detail?.ss_inclusion_pct;
  if (cur == null) return null;
  const prev = prevRow?.tax_detail?.ss_inclusion_pct ?? null;
  const bucket = (p) => (p == null ? null : (p >= 84.5 ? 85 : p >= 45 ? 50 : 0));
  const curB = bucket(cur);
  const prevB = bucket(prev);
  if (prev == null) {
    // First year with SS: only surface if any of it is taxed
    if (curB && curB > 0) {
      return { severity: curB === 85 ? "warn" : "info",
               label: `SS: ${curB}% taxable`, from: null, to: curB, pct: cur };
    }
    return null;
  }
  if (curB === prevB) return null;
  if (curB > prevB) {
    return { severity: curB === 85 ? "warn" : "info",
             label: `SS torpedo ${prevB}% → ${curB}%`, from: prevB, to: curB, pct: cur };
  }
  return { severity: "good",
           label: `SS taxability ${prevB}% → ${curB}%`, from: prevB, to: curB, pct: cur };
};

export const collectCallouts = (row, prevRow) => {
  const out = [];
  const ltcg = detectLtcgBump(row, prevRow);
  if (ltcg) out.push({ kind: "ltcg", ...ltcg });
  const irmaa = detectIrmaaStep(row, prevRow);
  if (irmaa) out.push({ kind: "irmaa", ...irmaa });
  const ss = detectSsStep(row, prevRow);
  if (ss) out.push({ kind: "ss", ...ss });
  return out;
};
