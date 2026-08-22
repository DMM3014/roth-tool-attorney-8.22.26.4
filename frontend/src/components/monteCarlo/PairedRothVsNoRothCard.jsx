/**
 * PairedRothVsNoRothCard — the "A/B on identical seeds" view.
 *
 * The backend MC engine already simulates both branches (with and without
 * conversions) on the SAME market draws inside a single request. That means
 * `paths_w[i]` and `paths_n[i]` are the same market seed played against
 * different tax/conversion policies, so a per-trial difference is meaningful.
 * This card surfaces that pairing:
 *
 *   • KPIs — Δ ending wealth (median), Δ ending wealth (worst case at p5),
 *     % of trials Roth beats no-Roth on ending wealth, % where Roth pays less
 *     lifetime tax, and the both-survive counter for the paired footnote.
 *   • Distribution histogram — bars centered on 0, positive = Roth strategy
 *     ended with more liquid wealth on that market seed. Y-axis is trial count.
 *   • Percentile table — full 5/25/50/75/95 breakdown for ending-delta and
 *     lifetime-tax-delta.
 *
 * The lifetime-tax row is hidden when the backend reports zero variance in
 * the tax series (the tax_paid path is only inflation-scaled, not per-seed
 * repriced against the market — so under deterministic inflation the tax
 * delta collapses to a single point). We show the constant value inline
 * instead of pretending it has a distribution.
 */
import React from "react";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine, Cell } from "recharts";
import { GitCompare } from "lucide-react";

const fmtUSD = (v) => {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${v < 0 ? "-" : ""}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${v < 0 ? "-" : ""}$${(abs / 1e3).toFixed(0)}K`;
  return `${v < 0 ? "-" : ""}$${abs.toFixed(0)}`;
};
const fmtPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);

const buildHistData = (hist) => {
  if (!hist?.counts?.length || !hist?.edges?.length) return [];
  return hist.counts.map((c, i) => {
    const lo = hist.edges[i];
    const hi = hist.edges[i + 1];
    const mid = (lo + hi) / 2;
    return { mid, lo, hi, count: c, positive: mid >= 0 };
  });
};

// Detect the degenerate "all trials identical" case so we don't render a
// spike histogram + a distribution table full of the same number.
const isConstant = (block) => {
  if (!block) return true;
  return block.p5 === block.p95 && block.p25 === block.p75;
};

const KpiRow = ({ items }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
    {items.map((k) => (
      <div key={k.label} data-testid={k.testid}
           className="rounded-lg border border-[#EBE8E0] bg-[#FCFBF8] p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
        <div className="text-lg font-semibold text-[#1A1A1A] mt-1 tabular-nums" style={{ color: k.tone }}>
          {k.value}
        </div>
        {k.sub && <div className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</div>}
      </div>
    ))}
  </div>
);

const PercentileTable = ({ block, negativeMeansGood = false, testid }) => {
  if (!block) return null;
  const cols = [
    ["p5", "Worst 5%"],
    ["p25", "P25"],
    ["p50", "Median"],
    ["p75", "P75"],
    ["p95", "Best 5%"],
    ["mean", "Mean"],
  ];
  const cell = (v) => (
    <td className="tabular-nums text-right px-2 py-1"
        style={{ color: (v > 0) === !negativeMeansGood ? "#4A6741"
                        : (v < 0) === !negativeMeansGood ? "#C87941" : "#1A1A1A" }}>
      {fmtUSD(v)}
    </td>
  );
  return (
    <table className="w-full text-xs mt-2 border-collapse" data-testid={testid}>
      <thead>
        <tr className="border-b border-[#EBE8E0] text-[10px] uppercase tracking-wide text-muted-foreground">
          {cols.map(([, l]) => <th key={l} className="text-right px-2 py-1">{l}</th>)}
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-[#F3F1EC]">{cols.map(([k]) => <React.Fragment key={k}>{cell(block[k])}</React.Fragment>)}</tr>
      </tbody>
    </table>
  );
};

export const PairedRothVsNoRothCard = ({ res, testid = "mc-paired-card" }) => {
  const pd = res?.paired_delta;
  if (!pd || !pd.ending_delta) return null;
  const end = pd.ending_delta;
  const tax = pd.lifetime_tax_delta;
  const endHist = buildHistData(end.histogram);
  const taxConstant = isConstant(tax);

  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid={testid}>
      <div className="flex items-center gap-2 mb-1">
        <GitCompare className="h-4 w-4 text-[#4A6741]" />
        <h3 className="text-sm font-semibold text-[#1A1A1A]">Paired A/B — Roth strategy vs no conversions on the same market seeds</h3>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Each trial plays the same market draw against BOTH the with-conversion cashflows and the without-conversion
        cashflows. The bars below show the per-trial difference (with − without) in ending liquid wealth. Positive =
        the Roth strategy left MORE liquid wealth on that seed. Because the market noise is identical on both sides,
        this isolates the pure plan-delta.
      </p>

      <KpiRow items={[
        { label: "Trials with higher ending liquid wealth under Roth strategy",
          value: fmtPct(end.pct_with_wins),
          sub: `${pd.n_trials} paired trials · both survived in ${fmtPct(pd.both_survive_pct)}`,
          tone: "#1A1A1A",
          testid: "mc-paired-kpi-wins" },
        { label: "Median Δ ending liquid wealth", value: fmtUSD(end.p50),
          sub: "Roth minus no-conversions",
          tone: end.p50 >= 0 ? "#4A6741" : "#C87941",
          testid: "mc-paired-kpi-median" },
        { label: "Worst 5% Δ ending liquid wealth", value: fmtUSD(end.p5),
          sub: "Left-tail sequence risk",
          tone: end.p5 >= 0 ? "#4A6741" : "#C87941",
          testid: "mc-paired-kpi-worst" },
        { label: "Δ Lifetime tax paid",
          value: tax ? fmtUSD(tax.p50) : "—",
          sub: tax ? (taxConstant
            ? "Same across trials (det. inflation)"
            : `Roth pays less in ${fmtPct(tax.pct_with_pays_less)} of trials`)
            : "n/a",
          tone: (tax?.p50 ?? 0) < 0 ? "#4A6741" : (tax?.p50 ?? 0) > 0 ? "#C87941" : "#1A1A1A",
          testid: "mc-paired-kpi-tax" },
      ]} />

      <div className="mt-3 rounded-lg border border-[#C4A64A] bg-[#C4A64A14] px-3 py-2"
           data-testid="mc-paired-success-note">
        <p className="text-[11px] leading-relaxed text-[#1A1A1A]">
          <strong className="text-[#8A6A12]">This measures ONE definition of success.</strong> The
          percentage above counts only trials where the Roth strategy ended with more <em>liquid portfolio
          value</em>. It is not an overall verdict — a family may define success as minimizing the
          parents&apos; lifetime taxes, maximizing the after-tax inheritance, reducing a beneficiary&apos;s
          income-tax exposure, or moving assets into a different tax and estate structure. A trial can show
          lower liquid wealth under Roth and still produce a better after-tax result for a highly taxed
          beneficiary.
        </p>
      </div>

      <div className="mt-5">
        <div className="text-xs font-medium text-[#1A1A1A] mb-1">
          Distribution of Δ ending wealth (with − without conversions)
        </div>
        <div style={{ width: "100%", height: 220 }} data-testid="mc-paired-histogram">
          <ResponsiveContainer>
            <BarChart data={endHist} margin={{ top: 8, right: 24, left: 8, bottom: 24 }}>
              <XAxis dataKey="mid" type="number"
                tickFormatter={(v) => fmtUSD(v)}
                tick={{ fontSize: 10, fill: "#5A5A5A" }}
                domain={["dataMin", "dataMax"]} />
              <YAxis tick={{ fontSize: 10, fill: "#5A5A5A" }} allowDecimals={false} />
              <Tooltip
                formatter={(v, _n, ctx) => [`${v} trials`,
                  `${fmtUSD(ctx.payload.lo)} → ${fmtUSD(ctx.payload.hi)}`]}
                labelFormatter={() => ""}
              />
              <ReferenceLine x={0} stroke="#1A1A1A" strokeDasharray="3 3" strokeOpacity={0.4} />
              <Bar dataKey="count">
                {endHist.map((entry, i) => (
                  <Cell key={i} fill={entry.positive ? "#4A6741" : "#C87941"} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Green = Roth strategy ended with more liquid wealth on that seed; amber = less. Histogram is capped at
          ±p95 of |Δ|; trials outside that range roll into the outermost bins.
        </p>
      </div>

      <div className="mt-4">
        <div className="text-xs font-medium text-[#1A1A1A]">Δ ending wealth — percentile breakdown</div>
        <PercentileTable block={end} testid="mc-paired-ending-table" />
      </div>

      {tax && !taxConstant && (
        <div className="mt-4">
          <div className="text-xs font-medium text-[#1A1A1A]">Δ lifetime tax paid — percentile breakdown</div>
          <p className="text-[10px] text-muted-foreground">
            Negative = the Roth strategy paid LESS lifetime tax on that market seed.
          </p>
          <PercentileTable block={tax} negativeMeansGood testid="mc-paired-tax-table" />
        </div>
      )}
      {tax && taxConstant && (
        <p className="text-[10px] text-muted-foreground mt-3">
          Δ lifetime tax paid is the same in every trial ({fmtUSD(tax.p50)}) — the tax path is not per-seed repriced
          under the current inflation setting. Enable stochastic inflation on the toolbar to see a paired-tax
          distribution.
        </p>
      )}
    </Card>
  );
};

export default PairedRothVsNoRothCard;
