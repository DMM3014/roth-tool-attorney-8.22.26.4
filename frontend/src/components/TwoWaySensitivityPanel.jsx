// Two-way sensitivity: heir marginal rate × market regime. Renders a heat-grid of
// the conversion delta in after-tax wealth to heirs (green = converting wins, amber
// = not converting wins), with a per-regime interpolated break-even row underneath.
// One click shows the advisor that the case for conversion lives on a whole surface,
// not at a single assumed cell.

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Grid3x3, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { runTwoWaySensitivity, fmtUSD, fmtPct } from "@/lib/api";

const GREEN = "74, 103, 65";   // converting wins
const AMBER = "184, 122, 60";  // not converting wins

// Background for a delta cell: hue by sign, opacity by magnitude relative to the grid max.
const cellBg = (delta, maxAbs) => {
  if (delta == null || Math.abs(delta) < 1 || maxAbs <= 0) return "transparent";  // ~$0 = neutral (conversion is a wash)
  const rgb = delta > 0 ? GREEN : AMBER;
  const a = Math.min(0.85, 0.12 + (Math.abs(delta) / maxAbs) * 0.73);
  return `rgba(${rgb}, ${a.toFixed(3)})`;
};

const cellText = (delta) =>
  delta == null ? "—" : (Math.abs(delta) < 1 ? "$0" : `${delta >= 0 ? "+" : "−"}${fmtUSD(Math.abs(delta))}`);

// A left rail per cell — green in the winning (converting-wins) zone, amber in the
// losing zone. Stacked down a column, the rail switches colour at the break-even
// rate, so each regime's "winning zone" reads as a shaded band at a glance.
const railColor = (delta) => {
  if (delta == null || Math.abs(delta) < 1) return "transparent";
  return delta > 0 ? `rgba(${GREEN},0.95)` : `rgba(${AMBER},0.95)`;
};

export const TwoWaySensitivityPanel = ({ scenario, onResult }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await runTwoWaySensitivity(scenario);
      setData(res);
      onResult?.(res);
      toast.success("Computed heir-rate × regime sensitivity surface");
    } catch (e) {
      setErr("Two-way sensitivity failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const maxAbs = data
    ? Math.max(1, ...data.matrix.flat().filter((v) => v != null).map((v) => Math.abs(v)))
    : 1;

  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none mt-6" data-testid="two-way-panel">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Grid3x3 className="h-5 w-5 text-[#4A6741] mt-0.5" />
          <div>
            <h3 className="font-display text-lg font-bold tracking-tight">Two-Way Sensitivity — Heir Rate × Market Regime</h3>
            <p className="text-[11px] text-muted-foreground max-w-2xl mt-1 leading-relaxed">
              After-tax wealth to heirs, conversion minus no-conversion, at every heir income-tax rate under every
              market regime. Green = converting wins; amber = not converting wins.
            </p>
          </div>
        </div>
        <Button onClick={run} disabled={loading} variant="outline" size="sm"
          className="h-8 text-xs shrink-0" data-testid="two-way-run-btn">
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            : (data ? <RefreshCw className="h-3.5 w-3.5 mr-1" /> : null)}
          {data ? "Re-run" : "Run surface"}
        </Button>
      </div>

      {err && <p className="text-sm text-[#B84A4A] mt-3" data-testid="two-way-error">{err}</p>}

      {data && (
        <div className="mt-5">
          <div className="rounded-lg border border-[#4A6741]/30 bg-[#4A6741]/5 px-4 py-2.5 mb-4" data-testid="two-way-headline">
            <p className="text-sm text-[#1A1A1A]">
              Conversions win in <strong className="text-[#4A6741]">{data.wins_at_modeled} of {data.n_regimes}</strong> market regimes at your modeled heir rate{data.modeled_rate != null ? ` of ${fmtPct(data.modeled_rate)}` : ""}.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="two-way-grid">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-muted-foreground sticky left-0 bg-white">Heir income-tax rate</th>
                  {data.regimes.map((rg) => (
                    <th key={rg.preset_id} className="px-2 py-1.5 text-[10px] font-semibold text-center min-w-[92px]"
                      data-testid={`two-way-col-${rg.preset_id}`}>
                      {rg.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rates.map((rate, ri) => (
                  <tr key={rate} data-testid={`two-way-row-${ri}`}>
                    <td className="px-2 py-1.5 text-[11px] font-medium whitespace-nowrap sticky left-0 bg-white">
                      {data.rate_labels[ri]}
                    </td>
                    {data.regimes.map((rg, ci) => {
                      const delta = data.matrix[ri][ci];
                      return (
                        <td key={rg.preset_id} className="px-1 py-1 text-center tabular-nums text-[10.5px] font-semibold border border-white"
                          style={{ background: cellBg(delta, maxAbs), color: "#1A1A1A", borderLeft: `4px solid ${railColor(delta)}` }}
                          data-testid={`two-way-cell-${ri}-${ci}`}>
                          {cellText(delta)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Break-even rate per regime */}
                <tr className="border-t-2 border-[#4A6741]" data-testid="two-way-breakeven-row">
                  <td className="px-2 py-2 text-[11px] font-bold text-[#4A6741] sticky left-0 bg-white">Break-even heir rate</td>
                  {data.regimes.map((rg, ci) => {
                    const be = data.break_even[ci];
                    return (
                      <td key={rg.preset_id} className="px-1 py-2 text-center tabular-nums text-[11px] font-bold"
                        data-testid={`two-way-breakeven-${rg.preset_id}`}>
                        {be.rate == null ? (
                          <span className="text-muted-foreground">n/a</span>
                        ) : (
                          <span className={be.extrapolated ? "text-[#8A5A20]" : "text-[#4A6741]"}>
                            {fmtPct(be.rate)}
                            {be.extrapolated && <span className="block text-[8px] font-medium uppercase tracking-wide">extrapolated</span>}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: `rgba(${GREEN},0.7)` }} /> Converting wins</span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: `rgba(${AMBER},0.7)` }} /> Not converting wins</span>
            {data.modeled_rate != null && <span>Your modeled heir rate: <strong>{fmtPct(data.modeled_rate)}</strong></span>}
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground max-w-3xl leading-relaxed italic border-l-2 border-[#4A6741] pl-3"
            data-testid="two-way-caption">
            {data.caption}
          </p>
        </div>
      )}
    </Card>
  );
};
