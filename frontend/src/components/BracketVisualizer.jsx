/**
 * BracketVisualizer — the "bucket diagram" tax bracket visualizer.
 *
 * Renders the seven federal ordinary brackets (10 / 12 / 22 / 24 / 32 / 35 /
 * 37%) as stacked horizontal bands. Overlaid on top:
 *
 *   • Ordinary taxable income filling from $0 up through the buckets
 *     (dark green fill).
 *   • The Roth conversion amount stacked on top of ordinary income
 *     (amber block). Users drag its top handle up or down to see the
 *     conversion push into higher brackets live.
 *   • A year scrubber below the chart lets the user step through every
 *     year in the plan; as they scrub, ordinary income and bracket floors
 *     re-index (inflation grows floors, RMDs raise ordinary income) so the
 *     "conversion window" opens (early years) and closes (RMD years).
 *
 * All bracket floors + indexation are known client-side; we get the yearly
 * `bracket_index` multiplier from the projection row. No extra API round
 * trip.
 */

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { runProjection } from "@/lib/api";
import { Loader2, Info, Layers } from "lucide-react";
import {
  RATES, BRACKET_COLORS, floorsFor, stdDedFor, isMfjScenario, humanUsd,
  computeIncrementalTax,
} from "@/lib/brackets";

export const BracketVisualizer = ({ scenario }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [yearIndex, setYearIndex] = useState(0);
  // Local override for the "what if I converted X instead" slider.
  // null → follow the plan's original roth_conversion for that year.
  const [overrideConv, setOverrideConv] = useState(null);
  const chartRef = useRef(null);

  const mfj = isMfjScenario(scenario);

  // Load the base projection so we know each year's ordinary income and the
  // current planned conversion.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    runProjection(scenario)
      .then((res) => { if (alive) setRows(res.rows || []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(scenario)]);

  useEffect(() => {
    // Clamp scrubber & clear override when the dataset changes.
    setYearIndex((y) => Math.min(y, Math.max(0, rows.length - 1)));
    setOverrideConv(null);
  }, [rows.length]);

  const row = rows[yearIndex] || null;
  const bracketIdx = row?.bracket_index ?? 1;
  const floors = useMemo(() => floorsFor(mfj, bracketIdx), [mfj, bracketIdx]);
  const stdDed = useMemo(() => stdDedFor(mfj, bracketIdx), [mfj, bracketIdx]);

  // Ordinary taxable income for the year (excludes the current conversion so we
  // can layer it on top interactively).
  const originalConv = row?.roth_conversion || 0;
  const originalTaxable = row?.tax_detail?.ordinary_taxable_income ?? row?.ordinary_taxable_income ?? 0;
  const baseOrdinaryExConv = Math.max(0, originalTaxable - originalConv);

  // The user's chosen conversion (falls back to plan) — clamped to a sensible
  // range so the slider doesn't try to visualize $50M conversions on a $100K
  // income year.
  const traditionalBal = row?.traditional ?? 0;
  const maxConv = Math.max(500_000, traditionalBal || 500_000, originalConv * 2);
  const conv = overrideConv != null ? overrideConv : originalConv;

  const totalIncome = baseOrdinaryExConv + conv;
  const chartCeiling = Math.max(floors[floors.length - 1] * 1.35, totalIncome * 1.1, 300_000);

  // px math for the vertical chart
  const chartH = 420;
  const yFor = (dollars) => (1 - Math.min(dollars, chartCeiling) / chartCeiling) * chartH;

  const inc = computeIncrementalTax(baseOrdinaryExConv, conv, floors);
  const nextEdgeAbove = floors.find((f) => f > totalIncome);
  const dollarsToNextEdge = nextEdgeAbove != null ? nextEdgeAbove - totalIncome : null;

  // Drag handle
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const applyDollarsFromY = useCallback((clientY) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const yInside = Math.max(0, Math.min(chartH, clientY - rect.top));
    const dollarsAtY = (1 - yInside / chartH) * chartCeiling;
    const newConv = Math.max(0, Math.min(maxConv, dollarsAtY - baseOrdinaryExConv));
    setOverrideConv(newConv);
  }, [baseOrdinaryExConv, chartCeiling, chartH, maxConv]);
  useEffect(() => {
    if (!dragging) return;
    const move = (e) => {
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      applyDollarsFromY(y);
    };
    const stop = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", move);
    window.addEventListener("touchend", stop);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", stop);
    };
  }, [dragging, applyDollarsFromY]);

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center text-muted-foreground" data-testid="bracket-viz-loading">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading tax brackets…
      </div>
    );
  }
  if (!rows.length) {
    return <div className="p-6 text-muted-foreground" data-testid="bracket-viz-empty">
      No projection data available.
    </div>;
  }

  const year = row?.year;
  const clientAge = year && scenario?.household?.client_dob_year
    ? year - scenario.household.client_dob_year : null;
  const spouseAge = year && scenario?.household?.spouse_dob_year
    ? year - scenario.household.spouse_dob_year : null;

  const svgW = 640;
  const barLeft = 220;
  const barW = 220;

  return (
    <div className="space-y-4" ref={chartRef} data-testid="bracket-visualizer-tab">
      <Card className="p-6 border-[#EBE8E0] shadow-none">
        <div className="flex items-start gap-2">
          <Layers className="h-5 w-5 text-[#4A6741] mt-1" />
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight">Tax Bracket Visualizer</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
              The federal ordinary-income brackets drawn as buckets. Your projected income for the selected
              year fills the lower buckets; the Roth conversion is a coloured block on top. Drag the conversion
              handle to see, in real time, when the next dollar crosses a bracket line. Scrub the year slider
              below to watch the buckets expand with inflation and your income grow with RMDs.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <Card className="p-4 border-[#EBE8E0] shadow-none">
          <div className="flex flex-wrap items-baseline gap-4 mb-2">
            <div className="text-lg font-semibold text-[#1A1A1A]">{year}</div>
            <div className="text-[11px] text-muted-foreground">
              Client age {clientAge != null ? clientAge : "—"}
              {spouseAge != null && ` · Spouse ${spouseAge}`} · {mfj ? "MFJ" : "Single"}
            </div>
          </div>

          <svg ref={svgRef} viewBox={`0 0 ${svgW} ${chartH + 30}`}
               style={{ width: "100%", height: chartH + 40, userSelect: "none",
                        cursor: dragging ? "grabbing" : "default" }}
               data-testid="bracket-svg">
            {/* Bracket bands */}
            {floors.map((floor, i) => {
              const top = i + 1 < floors.length ? floors[i + 1] : chartCeiling;
              const yTop = yFor(top);
              const yBottom = yFor(floor);
              const bandH = Math.max(0, yBottom - yTop);
              if (bandH < 0.5 || floor >= chartCeiling) return null;
              return (
                <g key={i}>
                  <rect x={barLeft} y={yTop} width={barW} height={bandH}
                        fill={BRACKET_COLORS[i]} opacity={0.45} />
                  <text x={barLeft + barW + 8} y={yTop + Math.min(14, bandH / 2 + 5)}
                        fontSize="11" fill="#5A5A5A" fontWeight={500}>
                    {`${(RATES[i] * 100).toFixed(0)}% bracket`}
                  </text>
                  <text x={barLeft - 8} y={yBottom - 2} fontSize="10" fill="#8A8578"
                        textAnchor="end">
                    {humanUsd(floor)}
                  </text>
                </g>
              );
            })}
            {/* Chart ceiling label */}
            <text x={barLeft - 8} y={12} fontSize="10" fill="#8A8578" textAnchor="end">
              {humanUsd(chartCeiling)}
            </text>

            {/* Standard deduction guide (dashed line where "gross" would be
                relative to taxable) */}
            <line x1={barLeft} y1={yFor(stdDed)} x2={barLeft + barW} y2={yFor(stdDed)}
                  stroke="#8A8578" strokeDasharray="2 3" strokeOpacity={0.4} />

            {/* Ordinary taxable income bar */}
            {baseOrdinaryExConv > 0 && (
              <rect x={barLeft} y={yFor(baseOrdinaryExConv)} width={barW}
                    height={chartH - yFor(baseOrdinaryExConv)}
                    fill="#4A6741" opacity={0.82} />
            )}
            {/* Conversion bar stacked on top */}
            {conv > 0 && (
              <rect x={barLeft} y={yFor(baseOrdinaryExConv + conv)} width={barW}
                    height={yFor(baseOrdinaryExConv) - yFor(baseOrdinaryExConv + conv)}
                    fill="#C87941" opacity={0.9} />
            )}

            {/* Draggable handle (top of the conversion block, or top of income
                if no conversion) */}
            {(() => {
              const handleY = yFor(baseOrdinaryExConv + conv);
              return (
                <g style={{ cursor: "grab" }}
                   onMouseDown={(e) => { e.preventDefault(); setDragging(true); }}
                   onTouchStart={(e) => { e.preventDefault(); setDragging(true); }}
                   data-testid="bracket-conv-handle">
                  <line x1={barLeft - 6} y1={handleY} x2={barLeft + barW + 6} y2={handleY}
                        stroke="#8B3A0F" strokeWidth={2} />
                  <rect x={barLeft + barW / 2 - 30} y={handleY - 9} width={60} height={18} rx={4}
                        fill="#8B3A0F" />
                  <text x={barLeft + barW / 2} y={handleY + 4} fontSize="11" fontWeight={700}
                        fill="#FFFFFF" textAnchor="middle">
                    ⇕ {humanUsd(conv)}
                  </text>
                </g>
              );
            })()}

            {/* Left-side income labels */}
            <text x={barLeft - 8} y={yFor(baseOrdinaryExConv) - 2} fontSize="10.5"
                  fill="#4A6741" textAnchor="end" fontWeight={600}>
              income {humanUsd(baseOrdinaryExConv)}
            </text>
            {conv > 0 && (
              <text x={barLeft - 8} y={yFor(baseOrdinaryExConv + conv) + 12} fontSize="10.5"
                    fill="#8B3A0F" textAnchor="end" fontWeight={600}>
                +conv {humanUsd(conv)}
              </text>
            )}
          </svg>

          {/* Year scrubber */}
          <div className="mt-2" data-testid="bracket-year-scrubber">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>{rows[0]?.year}</span>
              <span className="font-medium text-[#1A1A1A]">Year: {year}</span>
              <span>{rows[rows.length - 1]?.year}</span>
            </div>
            <Slider value={[yearIndex]} min={0} max={Math.max(0, rows.length - 1)} step={1}
                    onValueChange={(v) => { setYearIndex(v[0]); setOverrideConv(null); }}
                    className="w-full" data-testid="bracket-year-slider" />
            <p className="text-[10px] text-muted-foreground mt-1">
              Scrub through the plan to see how RMDs raise ordinary income (buckets fill higher) and how
              inflation grows the buckets themselves. The plan&apos;s planned conversion is loaded for each
              new year; drag the handle to override it locally.
            </p>
          </div>
        </Card>

        <Card className="p-4 border-[#EBE8E0] shadow-none space-y-3" data-testid="bracket-kpi-panel">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Conversion this year</div>
            <div className="text-2xl font-semibold text-[#8B3A0F] tabular-nums">{humanUsd(conv)}</div>
            {overrideConv != null && (
              <button type="button" onClick={() => setOverrideConv(null)}
                      data-testid="bracket-reset-conv"
                      className="text-[10px] underline text-[#4A6741] hover:text-[#3E5637]">
                reset to plan ({humanUsd(originalConv)})
              </button>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Marginal rate on last dollar</div>
            <div className="text-2xl font-semibold text-[#1A1A1A] tabular-nums">
              {(inc.marginalRateAtTop * 100).toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Federal tax on conversion</div>
            <div className="text-2xl font-semibold text-[#1A1A1A] tabular-nums">{humanUsd(inc.extraTax)}</div>
            {conv > 0 && (
              <div className="text-[10px] text-muted-foreground">
                Blended rate {((inc.extraTax / conv) * 100).toFixed(1)}% on the conversion
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Headroom to next bracket</div>
            <div className="text-lg font-semibold text-[#4A6741] tabular-nums">
              {dollarsToNextEdge != null ? humanUsd(dollarsToNextEdge) : "at top bracket"}
            </div>
          </div>
          <div className="text-[10px] leading-relaxed text-muted-foreground border-t border-[#EBE8E0] pt-2">
            <div className="flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                &ldquo;Ordinary income&rdquo; here is <em>taxable</em> ordinary income for the year —
                gross income minus the {humanUsd(stdDed)} standard deduction and any exclusions the tax
                engine applied. The Roth conversion is layered directly on top.
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default BracketVisualizer;
