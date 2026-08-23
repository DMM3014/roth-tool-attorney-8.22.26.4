import { useMemo } from "react";
import { Trophy, TrendingUp } from "lucide-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { fmtUSD } from "@/lib/api";

// ---------------------------------------------------------------------------
// Best funding order per bracket — one clickable chip per unique single-bracket
// target in the ranked results. Ranking follows the ACTIVE optimization goal
// (sortKey + rankDir), not a static after-tax-legacy read, so the strip always
// agrees with the winner card and ranked table. Chips carry a hover popover
// that generates 2–3 sentences of advisor talking points from the row's own
// metrics (delta vs. the second-best funding order at the same bracket +
// a canned rationale keyed off the winning order name). Zero AI cost.
//
// Rendered only when the 4-D funding-order sweep is enabled (result.sweep_funding_orders).
// ---------------------------------------------------------------------------

const ORDER_MECHANIC = {
  "Taxable-first":
    "Taxable-first preserves the IRA balance longer, giving future conversion years more room before RMDs kick in. It also draws down already-taxed principal without triggering ordinary income.",
  "IRA-first":
    "IRA-first shrinks the pre-tax bucket aggressively during your lifetime, cutting the heir's SECURE-Act 10-year drawdown at their ordinary rate — often the biggest lever when the heir marginal rate is high.",
  "Cash-first":
    "Cash-first minimizes taxable-brokerage LTCG realizations before the step-up in basis at second death, protecting embedded gains from ever being taxed.",
  "Split IRA & Taxable":
    "Splitting withdrawals keeps both buckets active — smoother IRMAA path, less concentration risk, and no single-bucket exhaustion late in retirement.",
};

// Short metric names for inline copy — keyed by the analyzer goal (sortKey).
const METRIC_SHORT = {
  after_tax_estate: "after-tax legacy (+10 yrs)",
  after_tax_estate_pv: "after-tax legacy PV",
  after_tax_estate_at_death: "legacy at 2nd death",
  value_at_death: "portfolio value at 2nd death",
  ending_roth: "ending Roth",
  lifetime_taxes: "lifetime tax",
};

const BestFundingChipStrip = ({ result, applyStrategy, sortKey = "after_tax_estate", rankDir = "desc" }) => {
  const metricShort = METRIC_SHORT[sortKey] || "after-tax legacy";

  // Compute one row per bracket: the best `single`-kind row on the ACTIVE goal.
  const bestByBracket = useMemo(() => {
    if (!result?.ranked) return null;
    const better = (a, b) => rankDir === "asc"
      ? (a[sortKey] || 0) < (b[sortKey] || 0)
      : (a[sortKey] || 0) > (b[sortKey] || 0);
    const byBr = new Map(); // bracket -> best row on the active metric
    for (const r of result.ranked) {
      if (r.kind !== "single" || r.bracket == null) continue;
      const cur = byBr.get(r.bracket);
      if (!cur || better(r, cur)) byBr.set(r.bracket, r);
    }
    return Array.from(byBr.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bracket, row]) => ({
        bracket, row,
        pct: `${Math.round(bracket * 100)}%`,
        orderShort: row.funding_order_short || row.funding_order || "—",
      }));
  }, [result, sortKey, rankDir]);

  // For the popover: find the second-best funding order AT THE SAME BRACKET on
  // the same metric so the talking point has a concrete "$X more/less" figure.
  const secondBestFor = (bracket, winnerOrder) => {
    if (!result?.ranked) return null;
    const sameBr = result.ranked
      .filter((r) => r.kind === "single" && r.bracket === bracket && r.funding_order !== winnerOrder)
      .sort((a, b) => rankDir === "asc"
        ? (a[sortKey] || 0) - (b[sortKey] || 0)
        : (b[sortKey] || 0) - (a[sortKey] || 0));
    return sameBr[0] || null;
  };

  if (!bestByBracket) return null;

  return (
    <div className="mb-4 rounded-lg border border-[#4A6741]/20 bg-[#F1F5EF] p-3"
         data-testid="best-funding-per-bracket">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Trophy className="h-4 w-4 text-[#4A6741]" />
        <p className="text-xs font-semibold text-[#4A6741]">Best funding order per bracket</p>
        <span className="text-[10px] text-muted-foreground" data-testid="best-funding-metric-note">
          (best {metricShort} at each target bracket — follows your illustration goal · hover for talking points)
        </span>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="best-funding-chips">
        {bestByBracket.map(({ bracket, row, pct, orderShort }) => {
          const second = secondBestFor(bracket, row.funding_order);
          return (
            <HoverCard key={bracket} openDelay={120} closeDelay={80}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  onClick={() => applyStrategy(row)}
                  data-testid={`best-funding-chip-${Math.round(bracket * 100)}`}
                  className="group inline-flex items-center gap-2 rounded-full border border-[#4A6741]/30 bg-white px-3 py-1 text-[11px] transition-colors hover:bg-[#4A6741] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#4A6741]/40">
                  <span className="rounded-full bg-[#4A6741] text-white group-hover:bg-white group-hover:text-[#4A6741] px-1.5 py-0.5 text-[10px] font-bold">
                    {pct}
                  </span>
                  <span className="font-medium">➜ {orderShort}</span>
                  <span className="text-muted-foreground group-hover:text-white/80 text-[10px]">
                    · {row.start_year}–{row.stop_year}
                  </span>
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="top" align="start" className="w-[340px] p-3 text-[12px] leading-relaxed"
                                data-testid={`best-funding-chip-${Math.round(bracket * 100)}-popover`}>
                <ChipTalkingPoint pct={pct} winner={row} orderShort={orderShort} second={second}
                  sortKey={sortKey} rankDir={rankDir} metricShort={metricShort} />
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        Click a chip to apply that combo — bracket target, conversion window, AND funding order — to the current scenario.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Talking-point content for the hover popover — metric-aware phrasing so the
// strip reads correctly whether the goal is a maximize (legacy, Roth) or a
// minimize (lifetime tax) objective.
// ---------------------------------------------------------------------------
const ChipTalkingPoint = ({ pct, winner, orderShort, second, sortKey, rankDir, metricShort }) => {
  const winnerValue = winner[sortKey] || 0;
  const mechanic = ORDER_MECHANIC[orderShort] || `The analyzer selected ${orderShort} as the best funding order at this bracket ceiling.`;
  const deltaWord = rankDir === "asc" ? "less" : "more";
  return (
    <div className="space-y-2" data-testid="chip-talking-point">
      <div className="flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-[#4A6741]" />
        <p className="font-semibold text-[#1A1A1A]">
          At {pct} target, <span className="text-[#4A6741]">{orderShort}</span> wins on {metricShort}
        </p>
      </div>
      <p className="text-muted-foreground">
        Filling the {pct} bracket from <span className="font-medium">{winner.start_year}–{winner.stop_year}</span>{" "}
        with {orderShort} scores <span className="font-medium text-[#1A1A1A]">{fmtUSD(winnerValue)}</span> on {metricShort}.
        {second ? (
          <>
            {" "}That&apos;s <span className="font-medium text-[#4A6741]">
              {fmtUSD(Math.abs(winnerValue - (second[sortKey] || 0)))}
            </span>{" "}{deltaWord} than the same bracket-fill run with{" "}
            <span className="font-medium">{second.funding_order_short || second.funding_order}</span>.
          </>
        ) : (
          <> Only one funding order was scored at this bracket — enable the funding-order sweep to compare.</>
        )}
      </p>
      <p className="text-muted-foreground text-[11px] italic border-l-2 border-[#4A6741]/40 pl-2">
        {mechanic}
      </p>
      <p className="text-[10px] text-muted-foreground pt-1 border-t border-[#EBE8E0]">
        Click the chip to apply this combo — bracket + window + funding order — to the current scenario.
      </p>
    </div>
  );
};

export default BestFundingChipStrip;
