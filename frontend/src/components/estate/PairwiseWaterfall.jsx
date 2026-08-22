/**
 * Pairwise Trade-off Waterfall — Phase D companion to the Roth Timeline Ribbon.
 *
 * For each non-baseline strategy we render a horizontal waterfall that
 * decomposes the total delta (Bypass − Portability, etc.) into four
 * economically-meaningful drivers, all measured at the same user-selectable
 * post-second-death horizon:
 *
 *   ΔTrust               →  trust-held wealth that escapes 2nd-death (and
 *                            every subsequent generation's) estate + GST tax
 *   ΔOutright Roth       →  outright Roth compounding delta — SECURE 10-yr
 *                            tax-free window then heir taxable brokerage drag
 *                            (vs. trust-Roth's compressed-bracket regime)
 *   ΔOutright Taxable    →  §1014 step-up captured at Y2 (portability keeps
 *                            it, bypass forfeits basis reset on trust portion)
 *                            + heir brokerage vs. trust turnover LTCG
 *   ΔOutright Traditional →  SECURE 10-yr drawdown at heir ordinary rate
 *                            (identical across strategies — usually ~0 delta)
 *
 * Sum of the 4 drivers = total delta. Advisors read left-to-right: "what
 * levers explain the gap between the two strategies?" — the whole point of
 * Phase D per the Excel model review.
 *
 * Zero backend calls — everything is pulled from the same `result` payload
 * already fetched by Estate.jsx (the horizon rows carry per-vehicle outright
 * breakdown thanks to Phase C engine work).
 */
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { fmtUSD } from "@/lib/api";
import { Info, ArrowRight } from "lucide-react";

const STRATEGY_LABELS = {
  portability:   "Portability-Only",
  bypass:        "Bypass Trust",
  qtip_bypass:   "Bypass + QTIP",
  gst_layered:   "Layered GST-Exempt",
};
const NON_BASELINE = ["bypass", "qtip_bypass", "gst_layered"];

// Palette: baseline neutral, delta green/red, comparison blue-ish accent.
const BASELINE_FILL   = "#8B8776";
const COMPARE_FILL    = "#4A6741";      // matches winner accent
const COMPARE_WORST   = "#B84A4A";
const DELTA_POS       = "#7A9B76";      // gain (transferred wealth)
const DELTA_NEG       = "#C87878";      // loss
const CONNECTOR       = "#D6D3CB";

function getHorizonRow(result, h) {
  const rows = result.post_death_horizons || [];
  return rows.find((r) => r.years_after_second_death === h) || rows[rows.length - 1];
}

/** Compute the 4-driver decomposition for (baseline, target) at horizon h. */
function decompose(result, baselineKey, targetKey, h) {
  const row = getHorizonRow(result, h);
  if (!row) return null;

  const baselineTotal = row[`${baselineKey}_total`];
  const targetTotal   = row[`${targetKey}_total`];
  const totalDelta    = targetTotal - baselineTotal;

  // Per-vehicle deltas — sums exactly to totalDelta (rounding aside).
  const dTrust = row[`${targetKey}_trust`] - row[`${baselineKey}_trust`];
  const dRoth  = row[`${targetKey}_household_roth`] - row[`${baselineKey}_household_roth`];
  const dTax   = row[`${targetKey}_household_taxable`] - row[`${baselineKey}_household_taxable`];
  const dTrad  = row[`${targetKey}_household_traditional`] - row[`${baselineKey}_household_traditional`];

  return {
    baselineTotal,
    targetTotal,
    totalDelta,
    drivers: [
      { key: "trust", label: "Trust wealth", delta: dTrust,
        hint: "Trust-held assets that escape 2nd-death estate + GST tax at every subsequent generation" },
      { key: "roth", label: "Outright Roth", delta: dRoth,
        hint: "Trust-Roth NAV compounds at the client's gross rate through and past SECURE year 10 (under the revised model, trust distributes to beneficiaries to avoid compressed brackets) — outright Roth gets its own 10-yr tax-free window but then bears heir-brokerage drag" },
      { key: "taxable", label: "Outright Taxable", delta: dTax,
        hint: "Portability captures §1014 step-up at Y2 for ALL taxable; bypass/GST lock in Y1 basis on the trust portion. Trust-Taxable NAV compounds at the client's gross rate but heirs still owe LTCG (~15%) on trust-internal appreciation at eventual in-kind sale" },
      { key: "traditional", label: "Outright Traditional", delta: dTrad,
        hint: "Traditional IRA/401(k) is never routed into any trust — same 10-yr SECURE drawdown at heir ordinary rate on both sides, so delta is typically ~0" },
    ],
  };
}

/** Horizontal-waterfall row segment. */
function BarRow({ label, valuePos, valueLen, total, kind, xMax, hint, bold, testid }) {
  // Values are in dollars; we render as % of xMax across the plotting area.
  const leftPct  = Math.max(0, (valuePos / xMax) * 100);
  const widthPct = Math.max(0.4, Math.min(100 - leftPct, Math.abs(valueLen) / xMax * 100));
  const fill =
    kind === "baseline" ? BASELINE_FILL :
    kind === "compare_win" ? COMPARE_FILL :
    kind === "compare_loss" ? COMPARE_WORST :
    valueLen >= 0 ? DELTA_POS : DELTA_NEG;

  return (
    <div className="flex items-center gap-3 group" data-testid={testid}>
      <div className={`w-40 shrink-0 text-[11px] ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`} title={hint || ""}>
        {label}
      </div>
      <div className="flex-1 relative h-6 bg-[#F9F8F6] rounded overflow-hidden border border-[#EBE8E0]">
        <div
          className="absolute top-0 bottom-0 rounded-sm"
          style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: fill, transition: "all 200ms" }}
        />
      </div>
      <div className={`w-32 shrink-0 text-right text-[11px] tabular-nums ${bold ? "font-semibold" : ""} ${kind === "baseline" || kind?.startsWith("compare") ? "text-foreground" : (valueLen >= 0 ? "text-[#4A6741]" : "text-[#B84A4A]")}`}>
        {kind === "baseline" || kind?.startsWith("compare")
          ? fmtUSD(total)
          : `${valueLen >= 0 ? "+" : "−"}${fmtUSD(Math.abs(valueLen))}`}
      </div>
    </div>
  );
}

function Waterfall({ result, baselineKey, targetKey, horizon }) {
  const d = useMemo(() => decompose(result, baselineKey, targetKey, horizon), [result, baselineKey, targetKey, horizon]);
  if (!d) return null;
  const { baselineTotal, targetTotal, totalDelta, drivers } = d;
  const xMax = Math.max(baselineTotal, targetTotal) * 1.05;

  // Running-total walk: baseline → +/- each driver → target.
  let running = baselineTotal;

  return (
    <div className="p-4 rounded-md border bg-white border-[#EBE8E0]" data-testid={`estate-waterfall-${targetKey}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{STRATEGY_LABELS[baselineKey]}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{STRATEGY_LABELS[targetKey]}</span>
        </div>
        <div className={`text-sm font-display font-bold tabular-nums ${totalDelta >= 0 ? "text-[#4A6741]" : "text-[#B84A4A]"}`}>
          {totalDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(totalDelta))}
        </div>
      </div>

      <div className="space-y-1.5">
        <BarRow label={STRATEGY_LABELS[baselineKey]} valuePos={0} valueLen={baselineTotal} total={baselineTotal} kind="baseline" xMax={xMax} bold testid={`waterfall-${targetKey}-baseline`} />

        {drivers.map((drv) => {
          const before = running;
          const after = running + drv.delta;
          // For positive deltas, bar starts at 'before' and extends right by delta.
          // For negative deltas, bar starts at 'after' (smaller) and extends by |delta|.
          const barLeft = Math.min(before, after);
          const barLen = drv.delta;
          running = after;
          return (
            <BarRow
              key={drv.key}
              label={`Δ ${drv.label}`}
              valuePos={barLeft}
              valueLen={barLen}
              total={after}
              kind="delta"
              xMax={xMax}
              hint={drv.hint}
              testid={`waterfall-${targetKey}-driver-${drv.key}`}
            />
          );
        })}

        <BarRow
          label={STRATEGY_LABELS[targetKey]}
          valuePos={0}
          valueLen={targetTotal}
          total={targetTotal}
          kind={totalDelta >= 0 ? "compare_win" : "compare_loss"}
          xMax={xMax}
          bold
          testid={`waterfall-${targetKey}-total`}
        />
      </div>
    </div>
  );
}

export default function PairwiseWaterfall({ result }) {
  // Horizons available in the payload; default to the last one (most-differentiated).
  const horizons = useMemo(() => (result?.post_death_horizons || []).map((r) => r.years_after_second_death), [result]);
  const [horizon, setHorizon] = useState(horizons.length ? horizons[horizons.length - 1] : 0);
  const [baseline, setBaseline] = useState("portability");

  if (!result) return null;
  const targets = ["portability", "bypass", "qtip_bypass", "gst_layered"].filter((k) => k !== baseline);

  return (
    <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-pairwise-waterfall">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold tracking-tight">Pairwise trade-off waterfall</h3>
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            For each alternative strategy, decompose the total delta vs. the baseline into four levers:
            <strong> trust wealth</strong> (assets that escape 2nd-death + subsequent-generation estate/GST tax),
            <strong> outright Roth</strong> (SECURE clock + heir brokerage regime vs. trust compressed brackets),
            <strong> outright Taxable</strong> (§1014 step-up capture vs. trust-locked basis), and
            <strong> outright Traditional</strong> (usually ~0 — no strategy routes IRAs into trust). Sum equals
            the headline delta. Toggle horizon to see how the trade-offs shift as the second-death recedes.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-[11px] text-muted-foreground">Horizon</label>
          <div className="flex rounded-md border border-[#EBE8E0] overflow-hidden" data-testid="waterfall-horizon-tabs">
            {horizons.map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`px-2.5 py-1 text-[11px] tabular-nums transition-colors ${h === horizon ? "bg-[#4A6741] text-white font-semibold" : "bg-white text-muted-foreground hover:bg-[#F1F5EF]"}`}
                data-testid={`waterfall-horizon-${h}`}
              >
                {h === 0 ? "Y2" : `+${h}y`}
              </button>
            ))}
          </div>
          <label className="text-[11px] text-muted-foreground ml-3">Baseline</label>
          <select
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
            className="text-[11px] px-2 py-1 rounded-md border border-[#EBE8E0] bg-white"
            data-testid="waterfall-baseline-select"
          >
            {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {targets.map((k) => (
          <Waterfall
            key={k}
            result={result}
            baselineKey={baseline}
            targetKey={k}
            horizon={horizon}
          />
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground italic mt-3 leading-relaxed">
        Reading tip: green = wealth transferred into that vehicle vs. baseline; red = wealth forfeited. A trust
        strategy typically shows large positive Δ Trust and slightly negative Δ Outright Taxable (giving up the
        Y2 step-up on the trust portion). Under the revised trust-growth model, trust NAV compounds at the
        client&apos;s gross rate — so if a trust strategy wins overall, it means the escaped 2nd-death estate
        tax + multi-generational GST shielding exceeds the lost §1014 step-up on the trust portion.
      </p>
    </Card>
  );
}
