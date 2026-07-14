import { useState, useMemo } from "react";
import { Trophy, Play, Loader2, Sparkles, ArrowUpDown, HelpCircle, ChevronDown, TrendingUp, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
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
          (e.g. <span className="font-medium">&ldquo;fill 32% until SS starts, then 24% after&rdquo;</span>).
          Ranks every candidate by <span className="font-medium">after-tax legacy to heirs at 2nd death + horizon</span>
          {" "}(nominal) with lifetime-tax as tiebreaker; sortable by PV of the same legacy.
          This is the multi-year optimization Boldin&apos;s Explorer can&apos;t do.
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
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="Why this may differ from Find Optimal Bracket" data-testid="strategy-winner-why"
                        className="inline-flex items-center gap-1 rounded-full border border-[#4A6741]/40 bg-white px-2 py-0.5 text-[10px] font-medium text-[#4A6741] hover:bg-[#4A6741]/10">
                        <HelpCircle className="h-3 w-3" /> Why?
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs bg-[#1A1A1A] text-white text-[11px] leading-snug px-3 py-2">
                      This searches <span className="font-semibold">time-varying phased schedules</span> AND
                      <span className="font-semibold"> narrower conversion windows</span> — not just a single flat bracket for your whole horizon.
                      That&apos;s why the answer can be e.g. &ldquo;Fill 32% 2026–2035&rdquo; even when the flat 24% wins the simpler
                      &ldquo;Find Optimal Bracket&rdquo; sweep on the Projection tab. Both rank by the same metric: highest after-tax to heirs,
                      tiebreak lowest lifetime tax.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <h3 className="font-display text-2xl font-bold tracking-tight" data-testid="strategy-winner-label">{best.label}</h3>
              <p className="text-xs text-muted-foreground mt-1">{kindLabel[best.kind]}</p>
              <p className="text-xs mt-2">
                After-tax legacy (nominal, +horizon): <span className="font-bold text-[#4A6741]">{fmtUSD(best.after_tax_estate)}</span>
              </p>
              <p className="text-xs">
                Present value (today&apos;s $): <span className="font-medium">{fmtUSD(best.after_tax_estate_pv)}</span>
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

      {/* Why does the aggressive strategy win? — collapsible explainer */}
      {best && (
        <details className="group border border-[#EBE8E0] rounded-lg bg-white shadow-none"
                 data-testid="aggressive-strategy-explainer">
          <summary className="cursor-pointer list-none px-6 py-4 flex items-center justify-between hover:bg-[#F9F8F6]/60 transition-colors rounded-lg">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4 text-[#4A6741]" />
              <div>
                <span className="font-display text-sm font-bold text-[#1A1A1A]">Why does the aggressive strategy win?</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">Front-loading beats lifetime-tax-minimization when your heirs&apos; future rate exceeds your current rate — and why it&apos;s not risk-free.</p>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground group-open:rotate-180 transition-transform" />
          </summary>
          <div className="px-6 pb-6 pt-2 border-t border-[#EBE8E0]/60 space-y-4 text-[13px] leading-6 text-[#2A2A2A]">
            <p className="text-muted-foreground italic">
              Roth conversion isn&apos;t a tax bill — it&apos;s an asset transfer at an exchange rate. You pay
              today&apos;s rate to move a dollar from the &ldquo;taxed-at-heir-rate&rdquo; pool into the
              &ldquo;never-taxed&rdquo; pool. As long as tomorrow&apos;s rate is <em>higher</em> than today&apos;s,
              the trade profits — and the profit compounds tax-free for every year until the heir eventually withdraws.
            </p>

            <div>
              <p className="font-semibold text-[#1A1A1A] mb-1">1 · Every dollar is not worth the same</p>
              <p className="text-muted-foreground">
                In &ldquo;post-tax to your heirs&rdquo; terms: <span className="font-medium text-[#1A1A1A]">$1 in Traditional</span> is worth about
                <span className="font-medium text-[#1A1A1A]"> $0.64</span> (heir marginal ~36%), while
                <span className="font-medium text-[#1A1A1A]"> $1 in Roth</span> is worth
                <span className="font-medium text-[#1A1A1A]"> $1.00</span>. Every dollar you convert is <span className="font-semibold">≈ 56% more valuable</span> to your heirs.
              </p>
            </div>

            <div>
              <p className="font-semibold text-[#1A1A1A] mb-1">2 · The unconverted IRA compounds toward a <em>higher</em> future rate</p>
              <p className="text-muted-foreground">
                &ldquo;Fill only 22–24%&rdquo; feels efficient — but the balance you didn&apos;t touch is still growing at
                7%. It doubles every ~10 years, then triggers forced RMDs at 75 that push you into 32–37% brackets on
                top of Social Security and dividends. After first death, the survivor pays those rates in the
                <em> Single</em> brackets (half the width). You&apos;re not avoiding tax — you&apos;re deferring it into
                a higher-rate future.
              </p>
            </div>

            <div>
              <p className="font-semibold text-[#1A1A1A] mb-1">3 · Roth grows tax-free; Taxable grows at ~5% net</p>
              <p className="text-muted-foreground">
                Roth compounds at the full 7% gross return. Taxable loses ~1.5–2 pp/year to dividend and NIIT drag —
                growing at ~5% net. Over 30 years that gap compounds to
                <span className="font-medium text-[#1A1A1A]"> (1.05/1.07)<sup>30</sup> ≈ 0.56</span>: $1 of Taxable growth
                is worth ~56¢ of $1 of Roth growth in final-heir-dollar terms. Converting simply moves dollars from the
                drag-bearing pool into the drag-free pool.
              </p>
            </div>

            <div>
              <p className="font-semibold text-[#1A1A1A] mb-1">4 · The pre-SS window is the cheapest tax you&apos;ll ever pay</p>
              <p className="text-muted-foreground">
                Between retirement and Social Security (typically ages 62–70), ordinary income is at its lowest. Even
                pushing into 32% or 37% here is often the same rate you&apos;d face later on <em>much</em> larger RMD
                dollars. Front-loading empties the IRA <em>before</em> the forced-withdrawal machine turns on.
              </p>
            </div>

            <div className="rounded-lg border border-[#C87941]/40 bg-[#C87941]/5 p-4">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-[#C87941] shrink-0 mt-0.5" />
                <p className="font-semibold text-[#C87941] text-[13px]">The risk: sequence-of-returns and mean reversion</p>
              </div>
              <blockquote className="border-l-4 border-[#C87941] bg-white/60 pl-3 pr-2 py-2 mb-3 italic text-[13px] text-[#1A1A1A] font-medium leading-6">
                &ldquo;Never pay taxes early because an assumption produces a better result. Taxes are real; assumptions are hypothetical.&rdquo;
              </blockquote>
              <p className="text-muted-foreground mb-2">
                The math above assumes the historical long-term average return (roughly 8% pre-inflation, 7% real) holds
                over your remaining horizon. It usually does — <em>eventually</em>. But if markets deliver <em>below-average
                returns in the years immediately after</em> you convert (a bear market, a lost decade, or a mean-reversion
                episode), you&apos;ve already prepaid tax on wealth that no longer exists at the moment you needed it to
                compound. And unlike pre-2018, <span className="font-semibold">a Roth conversion cannot be recharacterized</span> —
                TCJA closed that door in 2017. You cannot unwind an over-conversion after the fact.
              </p>
              <p className="text-muted-foreground mb-2 font-medium text-[#1A1A1A]">Practical mitigation:</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li><span className="font-medium text-[#1A1A1A]">Phase the conversion</span> across several years rather than one big bullet — the sweep&apos;s &ldquo;phased&rdquo; strategies do this automatically.</li>
                <li><span className="font-medium text-[#1A1A1A]">Convert <em>more</em> in down markets</span> — a bear market is effectively a &ldquo;Roth conversion sale.&rdquo; The dollar amount converted is fixed for tax, but the shares are cheap; when they recover, all the recovery lands in the Roth tax-free.</li>
                <li><span className="font-medium text-[#1A1A1A]">Program the floor, harvest the ceiling opportunistically</span> — bake in the safer bracket (24%) as your baseline, and convert into 32–37% only in years with clearly favorable circumstances (bear market, unusually low income, pre-SS window closing, pre-widow bracket compression).</li>
                <li><span className="font-medium text-[#1A1A1A]">Stress-test with Monte Carlo</span> — the app&apos;s Monte Carlo tab runs 1,000+ market paths against each strategy. If the aggressive plan holds up at the 5th percentile, you&apos;re not just chasing the median.</li>
              </ul>
            </div>

            <p className="text-[11px] text-muted-foreground italic pt-1">
              The sweep&apos;s deterministic winner uses your assumed real return every year. The rankings are only as reliable
              as those assumptions — but their <em>direction</em> (convert aggressively when the heir rate exceeds your
              current rate and the horizon is long) is robust to most reasonable return paths.
            </p>
          </div>
        </details>
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
                  <th className="px-2 text-right">PV (today&apos;s $)</th>
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
