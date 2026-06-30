import { useEffect, useState, useCallback, useMemo } from "react";
import { Wallet, Landmark, Receipt, Sparkles, Dices } from "lucide-react";
import { Card } from "@/components/ui/card";
import { runProjection, runSweep, fmtUSD } from "@/lib/api";
import { AIInsights } from "@/components/AIInsights";
import { NetWorthChart, CompositionChart, TaxChart } from "@/components/ProjectionCharts";
import { BRACKETS, ProjectionControls, SweepPanel, YearTable, LegacyPanels } from "@/components/ProjectionPanels";

export const Projection = ({ scenario, setScenario, mcResult }) => {
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sweep, setSweep] = useState(null);
  const [sweeping, setSweeping] = useState(false);

  const rmdAge = (() => {
    const by = scenario.household?.client_dob_year ?? 1965;
    return by <= 1950 ? 72 : by <= 1959 ? 73 : 75; // SECURE 2.0
  })();
  const targetIdx = BRACKETS.indexOf(scenario.roth.target_bracket) >= 0
    ? BRACKETS.indexOf(scenario.roth.target_bracket) : 3;

  const update = useCallback((path, value) => {
    setScenario((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let o = next;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      o[keys[keys.length - 1]] = value;
      return next;
    });
  }, [setScenario]);

  const findOptimal = useCallback(() => {
    setSweeping(true);
    runSweep(scenario)
      .then((res) => {
        setSweep(res);
        if (res.best?.target_bracket != null) update("roth.target_bracket", res.best.target_bracket);
        else update("roth.enabled", false);
      })
      .finally(() => setSweeping(false));
  }, [scenario, update]);

  const run = useCallback(() => {
    setLoading(true);
    const noRothCfg = JSON.parse(JSON.stringify(scenario));
    noRothCfg.roth.enabled = false;
    Promise.all([runProjection(scenario), runProjection(noRothCfg)])
      .then(([a, b]) => { setWithRoth(a); setNoRoth(b); })
      .finally(() => setLoading(false));
  }, [scenario]);

  useEffect(() => {
    const t = setTimeout(run, 350);
    return () => clearTimeout(t);
  }, [run]);

  const chartData = useMemo(() => {
    if (!withRoth) return [];
    return withRoth.rows.map((row, i) => ({
      year: row.year,
      Cash: row.cash,
      Taxable: row.taxable,
      Traditional: row.traditional,
      Roth: row.roth,
      tax: row.total_tax,
      netRoth: row.net_worth,
      netNo: noRoth?.rows[i]?.net_worth,
      conversion: row.roth_conversion,
    }));
  }, [withRoth, noRoth]);

  const s = withRoth?.summary;
  const sn = noRoth?.summary;
  const legacy = withRoth?.legacy;
  const legacyNo = noRoth?.legacy;
  const taxDelta = s && sn ? sn.lifetime_taxes - s.lifetime_taxes : 0;
  const nwDelta = s && sn ? s.ending_net_worth - sn.ending_net_worth : 0;
  const heirDelta = legacy && legacyNo ? legacy.after_tax_estate_to_heirs - legacyNo.after_tax_estate_to_heirs : 0;

  const postCompare = useMemo(() => {
    if (!legacy?.post_death_rows || !legacyNo?.post_death_rows) return [];
    return legacy.post_death_rows.map((row, i) => ({
      year: row.year_after_death,
      Convert: row.total_to_heirs,
      NoConvert: legacyNo.post_death_rows[i]?.total_to_heirs,
      ConvertRoth: row.inherited_roth,
      NoConvertRoth: legacyNo.post_death_rows[i]?.inherited_roth,
    }));
  }, [legacy, legacyNo]);

  const aiSummary = useMemo(
    () => s && {
      mode: "multi_year",
      filing_status: scenario.household.filing_status,
      roth_controls: scenario.roth,
      with_conversions: s,
      without_conversions: sn,
      legacy_estate: legacy,
      bracket_sweep_ranked: sweep?.ranked,
      lifetime_tax_savings: taxDelta,
      ending_networth_difference: nwDelta,
      net_to_family: legacy && legacyNo && {
        horizon_years: legacy.horizon_years,
        with_conversions: legacy.after_tax_estate_to_heirs,
        without_conversions: legacyNo.after_tax_estate_to_heirs,
        delta: heirDelta,
        tax_free_roth_with: legacy.tax_free_roth_to_heirs,
        tax_free_roth_without: legacyNo.tax_free_roth_to_heirs,
        heir_ira_tax_with: legacy.inherited_ira_tax,
        heir_ira_tax_without: legacyNo.inherited_ira_tax,
      },
      monte_carlo: mcResult && {
        trials: mcResult.n_trials,
        volatility: mcResult.portfolio_vol,
        mean_return: mcResult.portfolio_mean,
        success_with_conversions: mcResult.with_conversions?.success,
        success_without_conversions: mcResult.without_conversions?.success,
        resilience_delta_points: mcResult.with_conversions && mcResult.without_conversions
          ? Math.round((mcResult.with_conversions.success - mcResult.without_conversions.success) * 1000) / 10
          : null,
        median_ending_portfolio: mcResult.with_conversions?.ending?.p50,
        downside_ending_p10: mcResult.with_conversions?.ending?.p10,
        depleted_pct: mcResult.with_conversions?.ending?.depleted_pct,
      },
      sample_years: withRoth.rows.filter((_, i) => i % 5 === 0).map((x) => ({
        year: x.year, conversion: x.roth_conversion, tax: x.total_tax,
        traditional: x.traditional, roth: x.roth, marginal_rate: x.marginal_rate,
      })),
    },
    [s, sn, taxDelta, nwDelta, withRoth, scenario, sweep, legacy, legacyNo, heirDelta, mcResult]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <ProjectionControls scenario={scenario} update={update} rmdAge={rmdAge} targetIdx={targetIdx} />

      {/* Summary metrics */}
      <SummaryCard icon={Receipt} label="Lifetime Taxes (w/ conversions)" value={fmtUSD(s?.lifetime_taxes)} sub={`vs ${fmtUSD(sn?.lifetime_taxes)} without`} accent="terra" testid="metric-lifetime-tax" />
      <SummaryCard icon={Wallet} label="Ending Net Worth" value={fmtUSD(s?.ending_net_worth)} sub={`${nwDelta >= 0 ? "+" : ""}${fmtUSD(nwDelta)} vs no conversions`} accent="green" testid="metric-ending-nw" />
      <SummaryCard icon={Landmark} label="Total Converted to Roth" value={fmtUSD(s?.total_roth_converted)} sub={`Ending Roth ${fmtUSD(s?.ending_roth)}`} accent="green" testid="metric-total-converted" />
      <div className="rounded-xl border border-[#4A6741]/30 bg-[#4A6741]/5 p-5 flex flex-col justify-center" data-testid="metric-tax-savings">
        <p className="label-cap text-[#4A6741] text-[10px] mb-1">Lifetime Tax Difference</p>
        <p className={`font-display text-2xl font-bold ${taxDelta >= 0 ? "text-[#4A6741]" : "text-[#C87941]"}`}>
          {taxDelta >= 0 ? "−" : "+"}{fmtUSD(Math.abs(taxDelta))}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{taxDelta >= 0 ? "saved by converting" : "more tax from converting"}</p>
      </div>

      <SweepPanel sweep={sweep} sweeping={sweeping} findOptimal={findOptimal} withRoth={withRoth} />

      <NetWorthChart data={chartData} loading={loading} />
      <CompositionChart data={chartData} />
      <TaxChart data={chartData} />

      <YearTable rows={withRoth?.rows || []} />

      <LegacyPanels legacy={legacy} legacyNo={legacyNo} heirDelta={heirDelta} postCompare={postCompare} targetIdx={targetIdx} />

      {/* AI */}
      <Card className="p-6 bg-[#EBE8E0]/60 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="ai-insights-panel-proj">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-[#C87941]" />
          <h3 className="font-display text-lg font-bold tracking-tight">AI Strategy Insights</h3>
        </div>
        {!mcResult && (
          <div className="flex items-center gap-3 rounded-lg border border-[#4A6741]/25 bg-[#E8F3E5]/70 px-4 py-2.5 mb-4" data-testid="mc-hint">
            <Dices className="h-4 w-4 text-[#4A6741] shrink-0" />
            <p className="text-xs text-[#2C4A2D]">
              <span className="font-semibold">Tip:</span> run the <span className="font-semibold">Monte Carlo</span> tab first — the summary will then lead with your probability of success and how much resilience the conversions add.
            </p>
          </div>
        )}
        <AIInsights summary={aiSummary} testid="ai-insights-proj" />
      </Card>
    </div>
  );
};

const SummaryCard = ({ icon: Icon, label, value, sub, accent, testid }) => (
  <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid={testid}>
    <div className="flex items-center gap-2 mb-2">
      <Icon className={`h-4 w-4 ${accent === "terra" ? "text-[#C87941]" : "text-[#4A6741]"}`} />
      <p className="label-cap text-muted-foreground text-[10px]">{label}</p>
    </div>
    <p className={`font-display text-2xl font-bold ${accent === "terra" ? "text-[#C87941]" : "text-[#4A6741]"}`}>{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{sub}</p>
  </Card>
);
