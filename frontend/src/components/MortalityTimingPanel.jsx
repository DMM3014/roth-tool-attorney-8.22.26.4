// Mortality Timing sensitivity — five death-timing scenarios (base; first/second
// death ±5y). Shows widow-year exposure, estate/heir outcomes, and the conversion
// delta so counsel can see how sensitive the plan is to when deaths actually occur.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, HeartPulse, Play } from "lucide-react";
import { toast } from "sonner";
import { runMortalityTiming, fmtUSD } from "@/lib/api";

export const MortalityTimingPanel = ({ scenario }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const run = async () => {
    setLoading(true);
    try { setData(await runMortalityTiming(scenario)); }
    catch { toast.error("Mortality timing failed"); }
    finally { setLoading(false); }
  };
  const rows = data?.rows || [];
  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none mt-6" data-testid="mortality-panel">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <HeartPulse className="h-5 w-5 text-[#4A6741] mt-0.5" />
          <div>
            <h3 className="font-display text-lg font-bold tracking-tight">Mortality Timing</h3>
            <p className="text-[11px] text-muted-foreground max-w-2xl mt-1 leading-relaxed">
              How the plan responds if deaths occur earlier or later than assumed — widow-year exposure, estate tax, and
              wealth to heirs across five timing scenarios.
            </p>
          </div>
        </div>
        <Button onClick={run} disabled={loading} variant="outline" size="sm" className="h-8 text-xs shrink-0" data-testid="mortality-run">
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          {data ? "Re-run" : "Run scenarios"}
        </Button>
      </div>
      {data && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm" data-testid="mortality-table">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b border-[#EBE8E0]">
                <th className="text-left px-2 py-1.5 font-semibold">Scenario</th>
                <th className="text-right px-2 font-semibold">Single-filer yrs</th>
                <th className="text-right px-2 font-semibold">Compression cost</th>
                <th className="text-right px-2 font-semibold">Net worth @ 2nd death</th>
                <th className="text-right px-2 font-semibold">Federal estate tax</th>
                <th className="text-right px-2 font-semibold">To heirs (SECURE end)</th>
                <th className="text-right px-2 font-semibold">Conversion Δ (nom / today)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`mortality-row-${r.id}`} className="border-b border-[#F3F1EC]"
                  style={{ background: r.id === "base" ? "#4A67410D" : undefined }}>
                  <td className="px-2 py-2 font-medium">{r.label}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">{r.single_filer_years}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs text-[#B84A4A]">{fmtUSD(r.bracket_compression_cost)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">{fmtUSD(r.net_worth_at_second_death)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs">{fmtUSD(r.federal_estate_tax_no_trust)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs font-semibold">{fmtUSD(r.after_tax_to_heirs_secure10)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: r.conversion_delta_nominal >= 0 ? "#4A6741" : "#B84A4A" }}>
                    {r.conversion_delta_nominal >= 0 ? "+" : "−"}{fmtUSD(Math.abs(r.conversion_delta_nominal))}
                    <span className="text-muted-foreground"> / {r.conversion_delta_today >= 0 ? "+" : "−"}{fmtUSD(Math.abs(r.conversion_delta_today))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground max-w-3xl leading-relaxed border-l-2 border-[#4A6741] pl-3">
            The §2518 nine-month post-mortem disclaimer window is precisely the mechanism that lets the survivor adapt to
            <em> actual</em> timing rather than these assumptions — see EP Plan 2. A shortened window is one of the specific
            conditions under which filling toward the heirs&apos; rate — never past it — can overtake the lower-bracket program.
          </p>
        </div>
      )}
    </Card>
  );
};
