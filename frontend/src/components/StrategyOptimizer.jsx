import { useState, useMemo } from "react";
import { Trophy, Play, Loader2, Sparkles, ArrowUpDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { runStrategySweep, fmtUSD } from "@/lib/api";

const IRMAA_TIERS = [
  { value: "", label: "No cap" },
  { value: "0", label: "Tier 0 (base — no surcharge)" },
  { value: "1", label: "Tier 1" },
  { value: "2", label: "Tier 2" },
  { value: "3", label: "Tier 3" },
];

const kindLabel = {
  baseline: "No conversion",
  single: "Fixed bracket",
  phased: "Two-phase (time-varying)",
};

export const StrategyOptimizer = ({ scenario, setScenario }) => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [includePhased, setIncludePhased] = useState(true);
  const [irmaaCap, setIrmaaCap] = useState("");
  const [maxAnnual, setMaxAnnual] = useState(0);
  const [sortKey, setSortKey] = useState("after_tax_estate"); // or after_tax_estate_pv

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const opts = {
        include_phased: includePhased,
        irmaa_cap: irmaaCap === "" ? null : parseInt(irmaaCap, 10),
        max_annual: parseFloat(maxAnnual) || 0,
      };
      const out = await runStrategySweep(scenario, opts);
      setResult(out);
    } catch (e) {
      setErr("Strategy sweep failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  const sortedResults = useMemo(() => {
    if (!result) return [];
    return [...result.ranked].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  }, [result, sortKey]);

  // Detect tie clusters at the top of the ranking — happens when several bracket
  // strategies converge at the RMD wall (identical after-tax legacy).
  const topTieCount = useMemo(() => {
    if (!sortedResults.length) return 0;
    const top = sortedResults[0][sortKey] || 0;
    let n = 0;
    for (const r of sortedResults) {
      if (Math.abs((r[sortKey] || 0) - top) < 1.0) n++;
      else break;
    }
    return n;
  }, [sortedResults, sortKey]);

  const applyWinner = () => {
    if (!result?.best) return;
    const b = result.best;
    setScenario((p) => {
      const next = JSON.parse(JSON.stringify(p));
      if (b.kind === "baseline") {
        next.roth.enabled = false;
      } else if (b.kind === "single") {
        next.roth.enabled = true;
        next.roth.start_year = b.start_year;
        next.roth.end_year = b.stop_year;
        next.roth.target_bracket = b.bracket;
        // clear any prior phased schedule
        delete next.roth.year_targets;
      } else if (b.kind === "phased" && b.segments) {
        next.roth.enabled = true;
        next.roth.start_year = b.segments[0].start_year;
        next.roth.end_year = b.segments[b.segments.length - 1].stop_year;
        // encode the phased schedule as year_targets
        const yt = {};
        b.segments.forEach((seg) => {
          for (let y = seg.start_year; y <= seg.stop_year; y++) yt[y] = seg.bracket;
        });
        next.roth.year_targets = yt;
        next.roth.target_bracket = b.segments[0].bracket;
      }
      return next;
    });
    toast.success(`Applied: ${b.label}`, {
      description: `After-tax legacy ${fmtUSD(b.after_tax_estate)} (+${fmtUSD(
        b.after_tax_estate - (result.baseline?.after_tax_estate || 0)
      )} vs no conversion)`,
    });
  };

  const baseline = result?.baseline;
  const best = result?.best;
  const delta = best && baseline ? best.after_tax_estate - baseline.after_tax_estate : 0;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="strategy-controls">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Multi-Year Conversion Strategy Optimizer</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          Sweeps <span className="font-medium">start year × stop year × target bracket</span>, plus
          time-varying two-phase schedules pivoting off the SS claim year and the RMD wall
          (e.g. <span className="font-medium">"fill 32% until SS starts, then 24% after"</span>).
          Ranks every candidate by <span className="font-medium">after-tax legacy to heirs at 2nd death + horizon</span>
          {" "}(nominal) with lifetime-tax as tiebreaker; sortable by PV of the same legacy.
          This is the multi-year optimization Boldin's Explorer can't do.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">IRMAA tier cap</Label>
            <select value={irmaaCap} onChange={(e) => setIrmaaCap(e.target.value)}
              data-testid="strategy-irmaa-cap"
              className="mt-1 h-9 w-full rounded-md bg-[#F9F8F6] text-sm border border-input px-3">
              {IRMAA_TIERS.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">Skips MAGI beyond a chosen Medicare tier.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Max annual conversion ($)</Label>
            <Input type="number" step={10000} value={maxAnnual}
              onChange={(e) => setMaxAnnual(e.target.value)}
              data-testid="strategy-max-annual"
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">0 = no cap; caps per-year conversion.</p>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={includePhased} onCheckedChange={setIncludePhased}
              data-testid="strategy-include-phased" />
            <div>
              <Label className="text-xs text-muted-foreground">Include two-phase schedules</Label>
              <p className="text-[10px] text-muted-foreground">SS-pivot &amp; RMD-pivot brackets.</p>
            </div>
          </div>
          <div className="flex items-end">
            <Button onClick={run} disabled={running}
              className="bg-[#4A6741] hover:bg-[#3B5234] text-white w-full"
              data-testid="strategy-run">
              {running ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sweeping…</>)
                : (<><Play className="h-4 w-4 mr-1" /> Run strategy sweep</>)}
            </Button>
          </div>
        </div>
        {err && <p className="mt-3 text-xs text-[#B84A4A]" data-testid="strategy-error">{err}</p>}
      </Card>

      {/* Winner card */}
      {best && (
        <Card className="p-6 border-[#4A6741]/40 bg-[#4A6741]/5 shadow-none" data-testid="strategy-winner">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-[#4A6741]" />
                <span className="label-cap text-[#4A6741] text-[10px]">Best strategy</span>
              </div>
              <h3 className="font-display text-2xl font-bold tracking-tight" data-testid="strategy-winner-label">{best.label}</h3>
              <p className="text-xs text-muted-foreground mt-1">{kindLabel[best.kind]}</p>
              <p className="text-xs mt-2">
                After-tax legacy (nominal, +horizon): <span className="font-bold text-[#4A6741]">{fmtUSD(best.after_tax_estate)}</span>
              </p>
              <p className="text-xs">
                Present value (today's $): <span className="font-medium">{fmtUSD(best.after_tax_estate_pv)}</span>
              </p>
              <p className="text-xs">
                Vs. no conversion: <span className="font-medium text-[#4A6741]">+{fmtUSD(delta)}</span>
                {" · "}total converted <span className="font-medium">{fmtUSD(best.total_converted)}</span>
                {" · "}lifetime tax <span className="font-medium">{fmtUSD(best.lifetime_taxes)}</span>
              </p>
            </div>
            <Button onClick={applyWinner} className="bg-[#4A6741] hover:bg-[#3B5234] text-white"
              data-testid="strategy-apply">
              Apply winner
            </Button>
          </div>
        </Card>
      )}

      {/* Results table */}
      {result && (
        <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="strategy-results">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="font-display text-lg font-bold tracking-tight">All strategies ranked</h3>
              <p className="text-xs text-muted-foreground">
                {result.results.length} strategies evaluated · sorted by <span className="font-medium">
                  {sortKey === "after_tax_estate" ? "nominal legacy (+horizon)" : "PV legacy (today's $)"}
                </span>
                {topTieCount > 1 && (
                  <span className="ml-2 text-[#C87941]" data-testid="strategy-tie-note">
                    · <span className="font-medium">Ties broken by lifetime tax:</span> the top {topTieCount} rows have identical
                    {sortKey === "after_tax_estate_pv" ? " PV" : ""} legacy (Fill-32%+ variants converge once conversions hit
                    the RMD wall), so we rank by <span className="font-medium">lowest lifetime tax</span> among them.
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              <button onClick={() => setSortKey("after_tax_estate")}
                data-testid="strategy-sort-nominal"
                className={`text-xs px-2 py-1 rounded ${sortKey === "after_tax_estate" ? "bg-[#4A6741] text-white" : "bg-[#F3F1EC] text-muted-foreground"}`}>
                Nominal
              </button>
              <button onClick={() => setSortKey("after_tax_estate_pv")}
                data-testid="strategy-sort-pv"
                className={`text-xs px-2 py-1 rounded ${sortKey === "after_tax_estate_pv" ? "bg-[#4A6741] text-white" : "bg-[#F3F1EC] text-muted-foreground"}`}>
                PV
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b border-[#EBE8E0]">
                  <th className="px-2 py-1">#</th>
                  <th className="px-2">Strategy</th>
                  <th className="px-2">Type</th>
                  <th className="px-2 text-right">After-tax legacy (nominal)</th>
                  <th className="px-2 text-right">PV (today's $)</th>
                  <th className="px-2 text-right">Total converted</th>
                  <th className="px-2 text-right">Lifetime tax</th>
                  <th className="px-2 text-right">Ending Roth</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r, i) => (
                  <tr key={r.label} className={`border-b border-[#F3F1EC] ${i === 0 ? "bg-[#4A6741]/5" : ""}`}
                    data-testid={`strategy-row-${i}`}>
                    <td className="px-2 py-1.5 font-medium">{i + 1}</td>
                    <td className="px-2">{r.label}</td>
                    <td className="px-2 text-muted-foreground">{kindLabel[r.kind]}</td>
                    <td className="px-2 text-right font-medium">{fmtUSD(r.after_tax_estate)}</td>
                    <td className="px-2 text-right">{fmtUSD(r.after_tax_estate_pv)}</td>
                    <td className="px-2 text-right">{fmtUSD(r.total_converted)}</td>
                    <td className="px-2 text-right">{fmtUSD(r.lifetime_taxes)}</td>
                    <td className="px-2 text-right">{fmtUSD(r.ending_roth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!result && !running && (
        <Card className="p-8 border-[#EBE8E0] shadow-none text-center" data-testid="strategy-empty">
          <Trophy className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Run the sweep to see the full ranking of strategies.</p>
        </Card>
      )}
    </div>
  );
};
