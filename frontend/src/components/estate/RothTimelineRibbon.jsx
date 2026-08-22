/**
 * Roth Timeline Ribbon — Phase C UI companion.
 *
 * Renders a per-strategy horizontal timeline showing every Roth "slug" as a
 * shaded track: owner-lifetime tax-free growth → funding event (into trust or
 * outright at Y2) → SECURE 10-year tax-free window → post-window tax regime
 * (compressed trust brackets for trust-held Roth; heir taxable brokerage for
 * outright Roth). Year markers anchor Y1, Y1+10, Y2, Y2+10.
 *
 * Data source: `result.outcomes[k].trust_components` (funding events + $ at
 * entry) and `result.outcomes[k].household_components.roth_after_estate_tax`
 * (outright Roth passing to heirs at Y2). Zero backend calls — everything is
 * derived from the shared `result` prop already loaded by Estate.jsx.
 */
import { Card } from "@/components/ui/card";
import { fmtUSD } from "@/lib/api";
import { Info } from "lucide-react";

const STRATEGY_LABELS = {
  portability:   "Portability-Only",
  bypass:        "Bypass Trust",
  qtip_bypass:   "Bypass + QTIP",
  gst_layered:   "Layered GST-Exempt",
};
const STRATEGY_ORDER = ["portability", "bypass", "qtip_bypass", "gst_layered"];

// Color grammar for the timeline segments.
const SEG = {
  owner_life:       { fill: "#4A6741", label: "Owner alive — Roth compounds tax-free" },
  survivor_life:    { fill: "#7A9B76", label: "Survivor holds — Roth compounds tax-free" },
  trust_secure:     { fill: "#A8C89F", label: "Trust-held Roth · SECURE 10-yr tax-free window (Roth wrapper active)" },
  trust_post:       { fill: "#E4C05D", label: "Post-SECURE · Roth wrapper terminates; trust distributes income to beneficiaries — NAV compounds at client rate" },
  outright_secure:  { fill: "#B8D9AC", label: "Heirs' outright Roth · SECURE 10-yr tax-free window" },
  outright_post:    { fill: "#B8B4A8", label: "Heirs distributed → taxable brokerage · dividend + LTCG drag" },
  none:             { fill: "#F3F1EC", label: "No Roth in this vehicle for this strategy" },
};

/** Build per-strategy track list from `result` outcomes. */
function buildTracks(result) {
  const y1 = result.first_death_year;
  const y2 = result.second_death_year;
  const perStrategy = {};

  for (const key of STRATEGY_ORDER) {
    const o = result.outcomes[key];
    const tc = (o.trust_components || []).filter((c) => (c.roth_entry || 0) > 0);
    const hc = o.household_components || {};
    const outrightRoth = hc.roth_after_estate_tax || 0;
    const tracks = [];

    // Track 1..N: trust-held Roth slugs (one per trust_component with roth > 0).
    tc.forEach((c, i) => {
      const entry = c.entry_year;
      const secureEnd = entry + 10;
      tracks.push({
        title: c.entry_year === y1
          ? (key === "gst_layered" ? "Roth in GST-Exempt Trust #1 (Y1 funding)" : "Roth in Bypass Trust (Y1 funding)")
          : "Roth in GST-Exempt Trust #2 (Y2 funding)",
        fundedAt: entry,
        fundedAmt: c.roth_entry || 0,
        segments: [
          // Pre-funding: owner alive, Roth still owned outright by the deceased spouse.
          { kind: "owner_life",   start: null,      end: entry },
          // Funding → SECURE end (10-yr window opens the day of the funding death).
          { kind: "trust_secure", start: entry,     end: secureEnd },
          // Post-SECURE — Roth wrapper terminates, retained income taxed at compressed brackets.
          { kind: "trust_post",   start: secureEnd, end: null },
        ],
      });
    });

    // Track: outright Roth passing to heirs at Y2 (Portability + residual survivor
    // Roth in B/C/D + QTIP Roth for C).
    if (outrightRoth > 0) {
      tracks.push({
        title: key === "portability"
          ? "All Roth (survivor's own + deceased's rolled over) — outright to heirs at Y2"
          : (key === "qtip_bypass"
              ? "Survivor + QTIP Roth — outright to heirs at Y2"
              : "Survivor's Roth (above trust cap) — outright to heirs at Y2"),
        fundedAt: y2,
        fundedAmt: outrightRoth,
        segments: [
          // Pre-Y1: owner alive, Roth compounds tax-free.
          { kind: "owner_life",      start: null, end: y1 },
          // Y1 → Y2: survivor holds, still tax-free.
          { kind: "survivor_life",   start: y1,   end: y2 },
          // Y2 → Y2+10: SECURE 10-yr window for heirs.
          { kind: "outright_secure", start: y2,   end: y2 + 10 },
          // Y2+10 → end: heirs' taxable brokerage.
          { kind: "outright_post",   start: y2 + 10, end: null },
        ],
      });
    }
    // Strategies with zero-Roth outcomes (rare) get a single "no Roth" track.
    if (tracks.length === 0) {
      tracks.push({
        title: "No Roth balance in this strategy",
        fundedAt: null, fundedAmt: 0,
        segments: [{ kind: "none", start: null, end: null }],
      });
    }
    perStrategy[key] = tracks;
  }
  return perStrategy;
}

/** Compute time-axis bounds so all strategies share the same X scale. */
function axisBounds(result) {
  const y1 = result.first_death_year;
  const y2 = result.second_death_year;
  const today = new Date().getFullYear();
  const start = Math.min(today, y1 - 5);
  // Extend end to the last horizon in the data (defaults to Y2+30).
  const horizons = result.post_death_horizons || [];
  const lastHorizonYear = horizons.length ? horizons[horizons.length - 1].year : y2 + 30;
  const end = Math.max(lastHorizonYear, y2 + 20);
  return { start, end, y1, y2 };
}

function pct(start, end, year) {
  if (year == null) return null;
  const clamped = Math.max(start, Math.min(end, year));
  return ((clamped - start) / (end - start)) * 100;
}

function TrackRow({ track, bounds }) {
  const { start, end } = bounds;
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] text-muted-foreground leading-tight">{track.title}</span>
        {track.fundedAmt > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            Funding {track.fundedAt}: <strong className="text-foreground">{fmtUSD(track.fundedAmt)}</strong>
          </span>
        )}
      </div>
      <div className="relative h-6 bg-[#F9F8F6] rounded overflow-hidden border border-[#EBE8E0]">
        {track.segments.map((seg, i) => {
          const segStart = seg.start ?? start;
          const segEnd = seg.end ?? end;
          const left = pct(start, end, segStart);
          const right = pct(start, end, segEnd);
          if (left == null || right == null || right <= left) return null;
          const width = right - left;
          const meta = SEG[seg.kind] || SEG.none;
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 flex items-center justify-center text-[9px] font-semibold text-white/90"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: meta.fill,
                textShadow: "0 1px 1px rgba(0,0,0,0.15)",
              }}
              title={`${meta.label} · ${Math.round(segStart)}–${Math.round(segEnd)}`}
            >
              {width > 8 ? `${Math.round(segStart)}–${Math.round(segEnd)}` : ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineAxis({ bounds }) {
  const { start, end, y1, y2 } = bounds;
  // Year ticks: every 10 years from start.
  const ticks = [];
  for (let y = Math.ceil(start / 5) * 5; y <= end; y += 5) ticks.push(y);
  const marker = (year, color, label, dashed = false) => {
    const left = pct(start, end, year);
    if (left == null) return null;
    return (
      <div key={label} className="absolute top-0 bottom-0" style={{ left: `${left}%` }}>
        <div
          className="absolute top-0 bottom-0 w-px"
          style={{ background: color, borderLeft: dashed ? `1.5px dashed ${color}` : `1.5px solid ${color}`, opacity: 0.9 }}
        />
        <div
          className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold px-1 py-0.5 rounded"
          style={{ background: color, color: "white", top: -2 }}
        >
          {label}
        </div>
      </div>
    );
  };
  return (
    <div className="relative mb-3">
      {/* Ticks strip */}
      <div className="relative h-5 border-b border-[#EBE8E0]">
        {ticks.map((y) => {
          const left = pct(start, end, y);
          if (left == null) return null;
          return (
            <div key={y} className="absolute bottom-0" style={{ left: `${left}%` }}>
              <div className="w-px h-2 bg-[#D6D3CB]" />
              <div className="text-[9px] text-muted-foreground -translate-x-1/2 mt-0.5">{y}</div>
            </div>
          );
        })}
      </div>
      {/* Overlay markers */}
      <div className="relative h-6">
        {marker(y1, "#B84A4A", `Y1 · ${y1}`, false)}
        {marker(y1 + 10, "#8B6D2B", `Y1+10 · ${y1 + 10}`, true)}
        {marker(y2, "#B84A4A", `Y2 · ${y2}`, false)}
        {marker(y2 + 10, "#5B6F55", `Y2+10 · ${y2 + 10}`, true)}
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    { kind: "owner_life",      short: "Owner alive · tax-free" },
    { kind: "survivor_life",   short: "Survivor holds · tax-free" },
    { kind: "trust_secure",    short: "Trust SECURE 10-yr window · Roth wrapper active" },
    { kind: "trust_post",      short: "Trust post-SECURE · distributions to beneficiaries (NAV at client rate)" },
    { kind: "outright_secure", short: "Heirs' SECURE 10-yr window · tax-free" },
    { kind: "outright_post",   short: "Heirs' brokerage · dividend + LTCG drag" },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 mt-3 border-t border-[#EBE8E0]">
      {items.map((i) => (
        <div key={i.kind} className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded" style={{ background: SEG[i.kind].fill }} />
          <span className="text-[10px] text-muted-foreground">{i.short}</span>
        </div>
      ))}
    </div>
  );
}

export default function RothTimelineRibbon({ result }) {
  if (!result) return null;
  const bounds = axisBounds(result);
  const tracksByStrategy = buildTracks(result);

  return (
    <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-roth-timeline">
      <div className="flex items-start gap-2 mb-1">
        <h3 className="font-display text-base font-bold tracking-tight">Roth timeline — per-strategy SECURE clocks</h3>
        <Info className="h-3.5 w-3.5 text-muted-foreground mt-1 shrink-0" aria-hidden />
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Each row follows a single Roth "slug" through its life: dark-green while an owner or spouse still holds it
        (tax-free), bright-green during a SECURE 10-year distribution window (funded death starts the clock),
        then amber (trust) or grey (outright) once the window closes. Vertical markers show Y1 (first death),
        Y2 (second death), and the two SECURE-clock expirations. All four strategies share the same time axis so
        you can read left-to-right and compare "when does each Roth stop being tax-free?" at a glance.
      </p>

      <TimelineAxis bounds={bounds} />

      <div className="space-y-4">
        {STRATEGY_ORDER.map((k) => {
          const tracks = tracksByStrategy[k] || [];
          return (
            <div
              key={k}
              className="rounded-md border p-3 bg-white border-[#EBE8E0]"
              data-testid={`estate-roth-timeline-${k}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-4 rounded-sm"
                    style={{ background: "#4A6741" }}
                    aria-hidden
                  />
                  <span className="text-xs font-semibold text-foreground">
                    {STRATEGY_LABELS[k]}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {tracks.length} Roth slug{tracks.length === 1 ? "" : "s"}
                </span>
              </div>
              {tracks.map((t, i) => <TrackRow key={i} track={t} bounds={bounds} />)}
            </div>
          );
        })}
      </div>

      <Legend />
      <p className="text-[10px] text-muted-foreground italic mt-3 leading-relaxed">
        Trust-held Roth in an accumulation trust: SECURE Act requires full distribution within 10 years of the
        funding death; the Roth wrapper is income-tax free during that window. Under the revised operating model,
        well-drafted irrevocable trusts distribute ordinary income to beneficiaries (taxed at their rate, not the
        trust&apos;s 37%) and distribute appreciated assets in-kind (beneficiaries sell at their own LTCG rate),
        so <strong>all trust NAV compounds at the client&apos;s gross taxable rate</strong> — the amber
        &quot;post-SECURE&quot; band no longer implies a compressed-bracket drag, only the moment the Roth
        wrapper closes. Outright Roth passing to heirs at Y2 starts a fresh 10-yr window; distributions are
        tax-free, but heirs reinvest post-window dollars in a taxable brokerage bearing dividend + LTCG drag.
      </p>
    </Card>
  );
}
