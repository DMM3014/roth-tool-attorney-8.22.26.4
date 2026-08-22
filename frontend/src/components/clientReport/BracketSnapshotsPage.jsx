import { useMemo } from "react";
import { fmtUSD, fmtPct } from "@/lib/api";
import { Page, H2, P, Sub } from "./helpers";
import {
  RATES, BRACKET_COLORS, isMfjScenario, bracketFactsForRow, humanUsd,
} from "@/lib/brackets";

/**
 * BracketSnapshotsPage — printed version of the interactive Tax Bracket
 * Visualizer, frozen at the three years that actually matter:
 *
 *   1. the FIRST conversion year (the window opening),
 *   2. the year RMDs begin (the window closing),
 *   3. the FINAL conversion year.
 *
 * All three diagrams share one dollar scale so the reader can see the buckets
 * inflating and ordinary income rising across the plan. Included by default;
 * the advisor can switch the page off in the Client Report toolbar.
 */
const CHART_H = 250;
const SVG_W = 200;
const BAR_X = 52;
const BAR_W = 62;

const MiniBucket = ({ snap, ceiling, testid }) => {
  const yFor = (d) => (1 - Math.min(d, ceiling) / ceiling) * CHART_H;
  const incomeTop = yFor(snap.baseOrdinary);
  const convTop = yFor(snap.total);
  return (
    <div data-docx-rasterize={`bracket-snapshot-${snap.year}`} data-testid={testid}>
      <svg width={SVG_W} height={CHART_H + 12} viewBox={`0 0 ${SVG_W} ${CHART_H + 12}`}
           style={{ display: "block" }}>
        {snap.floors.map((floor, i) => {
          if (floor >= ceiling) return null;
          const top = i + 1 < snap.floors.length ? snap.floors[i + 1] : ceiling;
          const yTop = yFor(top);
          const bandH = Math.max(0, yFor(floor) - yTop);
          if (bandH < 0.5) return null;
          return (
            <g key={i}>
              <rect x={BAR_X} y={yTop} width={BAR_W} height={bandH}
                    fill={BRACKET_COLORS[i]} opacity={0.5} />
              {bandH > 11 && (
                <text x={BAR_X + BAR_W + 4} y={yTop + Math.min(11, bandH / 2 + 4)}
                      fontSize="7.5" fill="#5A5A5A">{`${(RATES[i] * 100).toFixed(0)}%`}</text>
              )}
              {bandH > 11 && (
                <text x={BAR_X - 4} y={yFor(floor) - 1.5} fontSize="7" fill="#8A8578"
                      textAnchor="end">{humanUsd(floor)}</text>
              )}
            </g>
          );
        })}
        {snap.baseOrdinary > 0 && (
          <rect x={BAR_X} y={incomeTop} width={BAR_W} height={CHART_H - incomeTop}
                fill="#4A6741" opacity={0.85} />
        )}
        {snap.conversion > 0 && (
          <rect x={BAR_X} y={convTop} width={BAR_W} height={Math.max(0, incomeTop - convTop)}
                fill="#C87941" opacity={0.92} />
        )}
        {snap.conversion > 0 && (
          <line x1={BAR_X - 4} y1={convTop} x2={BAR_X + BAR_W + 2} y2={convTop}
                stroke="#8B3A0F" strokeWidth={1.2} />
        )}
        <text x={BAR_X - 4} y={Math.max(8, incomeTop - 2)} fontSize="7.5" fill="#4A6741"
              textAnchor="end" fontWeight={700}>{humanUsd(snap.baseOrdinary)}</text>
        {snap.conversion > 0 && (
          <text x={BAR_X + BAR_W + 4} y={convTop + 3} fontSize="7.5" fill="#8B3A0F" fontWeight={700}>
            {`+${humanUsd(snap.conversion)}`}
          </text>
        )}
      </svg>
    </div>
  );
};

const CaptionRow = ({ label, value }) => (
  <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
    <td style={{ padding: "2px 3px", color: "#5A5A5A", fontSize: 8.5 }}>{label}</td>
    <td style={{ padding: "2px 3px", textAlign: "right", fontSize: 8.5, fontWeight: 600,
                 fontVariantNumeric: "tabular-nums" }}>{value}</td>
  </tr>
);

export const BracketSnapshotsPage = ({ scenario, rows, ...footProps }) => {
  const mfj = isMfjScenario(scenario);

  const snaps = useMemo(() => {
    const list = rows || [];
    const convRows = list.filter((r) => (r.roth_conversion || 0) > 0);
    const rmdRow = list.find((r) => (r.rmd || 0) > 0);
    const picks = [
      convRows.length ? { label: "First conversion year", row: convRows[0] } : null,
      rmdRow ? { label: "RMDs begin", row: rmdRow } : null,
      convRows.length ? { label: "Final conversion year", row: convRows[convRows.length - 1] } : null,
    ].filter(Boolean);
    const seen = new Set();
    return picks
      .filter((p) => {
        if (seen.has(p.row.year)) return false;
        seen.add(p.row.year);
        return true;
      })
      .sort((a, b) => a.row.year - b.row.year)
      .map((p) => ({ label: p.label, ...bracketFactsForRow(p.row, mfj) }));
  }, [rows, mfj]);

  // One shared dollar ceiling so the three diagrams are visually comparable.
  const ceiling = useMemo(() => {
    if (!snaps.length) return 400_000;
    const maxTotal = Math.max(...snaps.map((s) => s.total));
    const max32Floor = Math.max(...snaps.map((s) => s.floors[4]));
    return Math.max(maxTotal * 1.15, max32Floor * 1.05, 300_000);
  }, [snaps]);

  return (
    <Page testid="cr-page-bracket-snapshots" {...footProps}>
      <H2>Tax Brackets — where each year&apos;s conversion lands</H2>
      <P>
        Each column is one year of the plan drawn as a stack of buckets: the federal ordinary-income
        brackets. The dark green block is the year&apos;s ordinary taxable income (pensions, wages, taxable
        Social Security, interest, and RMDs). The terra-cotta block on top is that year&apos;s Roth
        conversion. Where the top of the terra-cotta block sits tells you the marginal rate the last
        converted dollar paid — and how much room was left before the next bracket line.
      </P>

      {snaps.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#8A8578", fontStyle: "italic" }}
             data-testid="cr-bracket-snapshots-empty">
          No conversion or RMD years in this projection — the bracket snapshots need at least one.
        </div>
      )}

      {snaps.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${snaps.length}, 1fr)`, gap: 14,
                      marginTop: 10 }}
             data-testid="cr-bracket-snapshots-grid">
          {snaps.map((s) => (
            <div key={s.year} style={{ border: "1px solid #EBE8E0", borderRadius: 8, padding: 8,
                                       background: "#FDFDFC" }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.4,
                            color: "#4A6741", fontWeight: 700 }}>{s.label}</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 15, fontWeight: 700,
                            color: "#1A1A1A", marginBottom: 4 }}>
                {s.year}
                {s.clientAge != null && (
                  <span style={{ fontSize: 8.5, fontWeight: 500, color: "#777", marginLeft: 5 }}>
                    age {s.clientAge}{s.spouseAge != null ? ` / ${s.spouseAge}` : ""}
                  </span>
                )}
              </div>
              <MiniBucket snap={s} ceiling={ceiling} testid={`cr-bracket-snapshot-${s.year}`} />
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
                <tbody>
                  <CaptionRow label="Ordinary taxable income" value={fmtUSD(Math.round(s.baseOrdinary))} />
                  <CaptionRow label="RMD included" value={fmtUSD(Math.round(s.rmd))} />
                  <CaptionRow label="Roth conversion" value={fmtUSD(Math.round(s.conversion))} />
                  <CaptionRow label="Marginal rate on last dollar" value={fmtPct(s.marginalRateAtTop)} />
                  <CaptionRow label="Federal tax on the conversion"
                              value={s.conversion > 0 ? fmtUSD(Math.round(s.conversionTax)) : "—"} />
                  <CaptionRow label="Blended rate on the conversion"
                              value={s.blendedRate != null ? fmtPct(s.blendedRate) : "—"} />
                  <CaptionRow label="Headroom to next bracket"
                              value={s.headroom != null ? fmtUSD(Math.round(s.headroom)) : "At top bracket"} />
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <Sub>
        All three diagrams share one dollar scale, so the buckets visibly widen year to year — that is
        bracket indexation (the plan indexes the federal bracket floors at its CPI assumption). Two forces
        run against each other: indexation opens room, while RMDs push ordinary income up and close it.
        That is why the conversion schedule front-loads the years before RMDs begin. Bracket geometry here
        is federal ordinary income only — long-term capital gains and qualified dividends are taxed in their
        own 0% / 15% / 20% bands stacked above this, and state tax, IRMAA, and NIIT sit outside these
        buckets. This page is illustrative of the modeled plan, not tax advice.
      </Sub>
    </Page>
  );
};

export default BracketSnapshotsPage;
