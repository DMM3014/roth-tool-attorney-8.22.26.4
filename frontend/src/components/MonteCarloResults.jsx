import { TrendingUp, ShieldCheck, BarChart3, Activity, CloudLightning, Flame, Link2, AlertTriangle, Table2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fmtUSD, fmtPct } from "@/lib/api";
import { SuccessGauge, SuccessCompareChart, FanChart, EndingHistogram } from "@/components/MonteCarloCharts";

const CORR_ROWS = [
  ["stocks_bonds", "Stocks ↔ Bonds"],
  ["stocks_cash", "Stocks ↔ Cash"],
  ["bonds_cash", "Bonds ↔ Cash"],
  ["stocks_inflation", "Stocks ↔ Inflation"],
  ["bonds_inflation", "Bonds ↔ Inflation"],
  ["cash_inflation", "Cash ↔ Inflation"],
];

const PCT_ROWS = [
  ["p95", "P95 · Best case"],
  ["p90", "P90 · Upside"],
  ["p75", "P75 · Above average"],
  ["p50", "P50 · Median"],
  ["p25", "P25 · Below average"],
  ["p10", "P10 · Downside"],
  ["p5", "P5 · Severe downside"],
];

const Stat = ({ label, value, accent }) => (
  <div className="rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] p-4">
    <p className="label-cap text-muted-foreground text-[10px] mb-1">{label}</p>
    <p className={`font-display text-xl font-bold ${accent ? "text-[#4A6741]" : "text-[#1A1A1A]"}`}>{value}</p>
  </div>
);

// Full results view of the Monte Carlo run. All display state (real$ toggle, engine strip,
// gauge, compare, sequence-risk, failure anatomy, shock/inflation/correlation, fan, histogram)
// lives here so MonteCarlo.jsx can stay focused on the controls form.
export const MonteCarloResults = ({
  res, scenario, resStag, realDollars, setRealDollars,
}) => {
  const wc = res?.with_conversions;
  const nc = res?.without_conversions;
  const seq = res?.sequence_risk;
  const shock = res?.shock;
  const infl_res = res?.inflation;
  const corr_res = res?.correlation;

  const infl = scenario?.projection?.general_inflation ?? 0.03;
  const startYear = scenario?.projection?.start_year ?? res?.years?.[0] ?? 0;
  const dfactor = (year) => 1 / Math.pow(1 + infl, Math.max(0, year - startYear));
  const fanPct = (() => {
    if (!wc) return null;
    if (!realDollars) return wc.percentiles;
    const out = {};
    ["p10", "p25", "p50", "p75", "p90"].forEach((k) => {
      out[k] = wc.percentiles[k].map((v, i) => Math.round(v * dfactor(res.years[i])));
    });
    return out;
  })();
  const endFactor = dfactor(res.years[res.years.length - 1]);
  const endDisp = (v) => (realDollars ? Math.round((v || 0) * endFactor) : v);
  const milestoneIdx = (() => {
    const out = [];
    for (let i = 9; i < res.years.length - 1; i += 10) out.push(i);
    out.push(res.years.length - 1);
    return out;
  })();

  return (
    <>
      {resStag && (
        <div className="flex items-center gap-2 rounded-lg border border-[#C87941]/40 bg-[#FBF3EC] px-4 py-2.5" data-testid="mc-stagflation-banner">
          <Flame className="h-4 w-4 text-[#C87941] shrink-0" />
          <p className="text-xs text-[#7A4A28]">
            <span className="font-semibold">2022-style stagflation stress:</span> these results assume a 2-year −15% return
            shock, 5.5% ± 3% inflation, and failed stock/bond diversification (+0.60) — a deliberately punishing &ldquo;2022 replay&rdquo;.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px]" data-testid="mc-engine-info">
        <span className="rounded-full border border-[#EBE8E0] bg-[#F9F8F6] px-3 py-1">
          Engine: <span className="font-semibold">{res.engine === "historical" ? `Historical bootstrap (${res.historical?.years_span})` : "Statistical (lognormal)"}</span>
        </span>
        {res.plan_return != null && (
          <span className="rounded-full border border-[#EBE8E0] bg-[#F9F8F6] px-3 py-1" data-testid="mc-anchor-info">
            Plan return <span className="font-semibold">{fmtPct(res.plan_return)}</span> · simulated mean <span className="font-semibold">{fmtPct(res.portfolio_mean)}</span>
            {res.anchor?.enabled
              ? <span className="text-[#4A6741] font-semibold"> · anchored to plan{res.anchor?.mode === "plan_path" ? ` path (${fmtPct(res.anchor.path_first)}→${fmtPct(res.anchor.path_last)})` : ""}</span>
              : <span className="text-[#C87941] font-semibold"> · NOT anchored</span>}
          </span>
        )}
        {res.guardrail?.enabled && (
          <span className="rounded-full border border-[#EBE8E0] bg-[#F9F8F6] px-3 py-1" data-testid="mc-guardrail-info">
            Guardrail −{Math.round(res.guardrail.cut_pct * 100)}% after loss years: success {fmtPct(res.guardrail.success_without_guardrail)} → <span className="font-semibold text-[#4A6741]">{fmtPct(res.guardrail.success_with_guardrail)}</span> · median {res.guardrail.median_cut_years} trimmed yrs
          </span>
        )}
      </div>
      {/* Headline: gauge + with/without */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 border-[#EBE8E0] shadow-none flex flex-col items-center justify-center" data-testid="mc-gauge-card">
          <div className="flex items-center gap-2 mb-2 self-start">
            <ShieldCheck className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">Probability of Success</h3>
          </div>
          <SuccessGauge value={wc.success} label="Fully funds spending & never runs out (with your Roth conversions)" testid="mc-gauge" />
        </Card>

        <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-2" data-testid="mc-compare-card">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">Does converting improve resilience?</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">Same {res.n_trials} market paths applied to both strategies.</p>
          <SuccessCompareChart withV={wc.success} withoutV={nc.success} />
          <p className="text-sm mt-2" data-testid="mc-delta">
            Roth conversions change the success rate by{" "}
            <span className={`font-bold ${wc.success >= nc.success ? "text-[#4A6741]" : "text-[#C87941]"}`}>
              {wc.success >= nc.success ? "+" : ""}{((wc.success - nc.success) * 100).toFixed(1)} pts
            </span>{" "}({fmtPct(nc.success)} → {fmtPct(wc.success)}).
          </p>
        </Card>
      </div>

      {/* Sequence-of-returns risk + optional shock + optional inflation + optional correlation */}
      <div className={`grid grid-cols-1 ${shock || infl_res || corr_res || wc.failure ? "lg:grid-cols-2" : ""} gap-6`}>
        <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-seq-card">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-[#C87941]" />
            <h3 className="font-display text-base font-bold tracking-tight">Sequence-of-Returns Risk</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            If your <span className="font-medium text-[#1A1A1A]">first {seq.early_years} years</span> land in the worst 5% of markets,
            your success rate falls from{" "}
            <span className="font-bold text-[#4A6741]">{fmtPct(seq.base_success)}</span> to{" "}
            <span className="font-bold text-[#C87941]" data-testid="mc-seq-success">{fmtPct(seq.success)}</span>
            {seq.median_ending != null && <> — with a median ending portfolio of {fmtUSD(seq.median_ending)}.</>}
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">A bad start early in retirement is far more damaging than the same losses later — this measures that exposure automatically.</p>
        </Card>

        {wc.failure && (
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-failure-card">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-[#C87941]" />
              <h3 className="font-display text-base font-bold tracking-tight">Failure Anatomy — When Do Bad Paths Run Dry?</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-bold text-[#C87941]" data-testid="mc-failure-pct">{fmtPct(wc.failure.pct)}</span> of trials deplete.
              Half of those stay funded until <span className="font-bold text-[#1A1A1A]" data-testid="mc-failure-median-year">{wc.failure.median_year}</span>
              {scenario?.household?.client_dob_year && <> (client age {wc.failure.median_year - scenario.household.client_dob_year})</>}
              {" "}— typically leaving <span className="font-bold text-[#C87941]">{wc.failure.median_years_unfunded} of the final years unfunded</span> (horizon ends {wc.failure.horizon_end}).
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">
              Earliest failures (worst decile) hit by {wc.failure.p10_year}; the slowest 10% hang on past {wc.failure.p90_year}.
              Failure is rarely a cliff at the start — knowing <span className="font-medium">when</span> it bites tells you how much time you&apos;d have to adjust spending.
            </p>
          </Card>
        )}

        {shock && (
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-shock-card">
            <div className="flex items-center gap-2 mb-1">
              <CloudLightning className="h-4 w-4 text-[#C87941]" />
              <h3 className="font-display text-base font-bold tracking-tight">Bear-Market Stress Test</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Forcing a <span className="font-medium text-[#1A1A1A]">{fmtPct(shock.rate)}/yr</span> market for the first{" "}
              <span className="font-medium text-[#1A1A1A]">{shock.years} {shock.years === 1 ? "year" : "years"}</span> drops your success rate from{" "}
              <span className="font-bold text-[#4A6741]">{fmtPct(shock.base_success_with)}</span> to{" "}
              <span className="font-bold text-[#C87941]" data-testid="mc-shock-success">{fmtPct(shock.success_with)}</span>.
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">Even under this shock, converting keeps you ahead: {fmtPct(shock.success_with)} vs {fmtPct(shock.success_without)} without conversions.</p>
          </Card>
        )}

        {infl_res && (
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-inflation-result">
            <div className="flex items-center gap-2 mb-1">
              <Flame className="h-4 w-4 text-[#C87941]" />
              <h3 className="font-display text-base font-bold tracking-tight">Stochastic Inflation ({fmtPct(infl_res.mean)} mean · {fmtPct(infl_res.vol)} vol)</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Cumulative CPI is <span className="font-medium">expected</span> to reach{" "}
              <span className="font-bold">{(infl_res.cumulative.expected[infl_res.cumulative.expected.length - 1] * 100 - 100).toFixed(0)}%</span>{" "}
              by <span className="font-medium">{res.years[res.years.length - 1]}</span>. In the worst 10% of trials it lands at{" "}
              <span className="font-bold text-[#C87941]" data-testid="mc-infl-p90-cum">
                {(infl_res.cumulative.p90[infl_res.cumulative.p90.length - 1] * 100 - 100).toFixed(0)}%
              </span>{" "}(the P90 tail).
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">Higher realized inflation scales your outflows (expenses + taxes) per trial — the fan chart above already reflects this stress.</p>
          </Card>
        )}

        {corr_res && (
          <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-corr-result">
            <div className="flex items-center gap-2 mb-1">
              <Link2 className="h-4 w-4 text-[#4A6741]" />
              <h3 className="font-display text-base font-bold tracking-tight">
                Correlated Draws{corr_res.includes_inflation ? " (incl. inflation)" : " (assets only)"}
              </h3>
            </div>
            {corr_res.adjusted_to_psd && (
              <p className="text-[11px] text-[#C87941] mb-2" data-testid="mc-corr-adjusted">
                Your matrix was internally inconsistent — repaired to the nearest valid correlation matrix (shown below).
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {CORR_ROWS.filter(([k]) => corr_res.matrix_used[k] != null).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between text-xs border-b border-[#F3F1EC] py-1" data-testid={`mc-corr-res-${k}`}>
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">
                    {corr_res.matrix_used[k].toFixed(2)}
                    <span className="text-muted-foreground font-normal"> · realized {corr_res.realized[k].toFixed(2)}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              One correlated Gaussian-copula draw drives every asset class{corr_res.includes_inflation ? " and inflation" : ""} — e.g. high-inflation years now coincide with weaker bond returns, compounding the stress realistically.
            </p>
          </Card>
        )}
      </div>

      {/* Fan chart */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-fan-card">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">Liquid Portfolio Over Time — Percentile Range</h3>
          </div>
          <div className="flex rounded-full border border-[#EBE8E0] bg-[#F9F8F6] p-0.5 shrink-0" data-testid="mc-real-toggle">
            <button onClick={() => setRealDollars(false)} data-testid="mc-nominal-btn"
              className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${!realDollars ? "bg-[#4A6741] text-white" : "text-muted-foreground hover:text-[#4A6741]"}`}>
              Nominal $
            </button>
            <button onClick={() => setRealDollars(true)} data-testid="mc-real-btn"
              className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${realDollars ? "bg-[#4A6741] text-white" : "text-muted-foreground hover:text-[#4A6741]"}`}>
              Today&apos;s $
            </button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Median path with the shaded P10–P90 outcome band (with conversions). Investable assets only — excludes illiquid home equity.
          {realDollars
            ? <> Shown in <span className="font-medium text-[#4A6741]">today&apos;s dollars</span> (discounted at {fmtPct(infl)} inflation).</>
            : <> Shown in <span className="font-medium">nominal (future) dollars</span>.</>}
        </p>
        <FanChart years={res.years} percentiles={fanPct} />
        <div className="grid grid-cols-3 gap-4 mt-4">
          <Stat label={`Downside ending (P10)${realDollars ? " · today's $" : ""}`} value={fmtUSD(endDisp(wc.ending.p10))} />
          <Stat label={`Median ending (P50)${realDollars ? " · today's $" : ""}`} value={fmtUSD(endDisp(wc.ending.p50))} accent />
          <Stat label={`Upside ending (P90)${realDollars ? " · today's $" : ""}`} value={fmtUSD(endDisp(wc.ending.p90))} />
        </div>
      </Card>

      {/* Percentile outcomes table */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-percentile-table-card">
        <div className="flex items-center gap-2 mb-1">
          <Table2 className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Range of Outcomes by Percentile</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Liquid portfolio in <span className="font-medium">{realDollars ? "today's" : "nominal (future)"} dollars</span> at each milestone,
          with your Roth conversions. P50 is the median trial — half the simulated futures land above it, half below.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="mc-percentile-table">
            <thead>
              <tr className="border-b border-[#EBE8E0]">
                <th className="text-left py-2 pr-4 text-[10px] label-cap text-muted-foreground font-medium">Percentile</th>
                {milestoneIdx.map((i) => (
                  <th key={i} className="text-right py-2 px-3 text-[10px] label-cap text-muted-foreground font-medium">
                    {res.years[i]}{i === res.years.length - 1 ? " · End" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PCT_ROWS.filter(([k]) => wc.percentiles[k]).map(([k, label]) => (
                <tr key={k} data-testid={`mc-pct-row-${k}`}
                  className={`border-b border-[#F3F1EC] ${k === "p50" ? "bg-[#F4F7F2]" : ""}`}>
                  <td className={`py-2 pr-4 text-xs whitespace-nowrap ${k === "p50" ? "font-bold text-[#4A6741]" : "text-muted-foreground"}`}>{label}</td>
                  {milestoneIdx.map((i) => (
                    <td key={i} className={`py-2 px-3 text-right tabular-nums ${k === "p50" ? "font-bold text-[#4A6741]" : ""}`}>
                      {fmtUSD(Math.round(wc.percentiles[k][i] * (realDollars ? dfactor(res.years[i]) : 1)))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          {res.anchor?.enabled
            ? <>The median is anchored to your plan&apos;s year-by-year return path ({fmtPct(res.anchor.path_first ?? res.plan_return)} → {fmtPct(res.anchor.path_last ?? res.plan_return)} as cash becomes a smaller slice) — </>
            : <>Anchor is OFF, so the central tendency follows the raw engine means and may diverge from your plan — </>}
          {realDollars
            ? <>figures are discounted at {fmtPct(infl)} inflation to today&apos;s purchasing power.</>
            : <>figures are future dollars; use the &ldquo;Today&apos;s $&rdquo; toggle above to discount them.</>}
        </p>
      </Card>

      {/* Ending distribution */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="mc-hist-card">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Ending Portfolio Distribution</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Final liquid portfolio across <span className="font-medium">surviving trials only</span> (clipped at their P90; last bar is the upside tail).
          {wc.ending.depleted > 0
            ? <span className="font-medium text-[#C87941]" data-testid="mc-hist-depleted-note"> {wc.ending.depleted} of {res.n_trials} trials ({fmtPct(wc.ending.depleted_pct)}) depleted — reported in the Failure Anatomy card, not stacked into a misleading $0 bar.</span>
            : <span className="font-medium text-[#4A6741]"> No trials depleted.</span>}
        </p>
        <EndingHistogram histogram={wc.histogram} />
      </Card>
    </>
  );
};
