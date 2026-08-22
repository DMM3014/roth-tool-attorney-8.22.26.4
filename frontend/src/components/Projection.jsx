import { useEffect, useState, useCallback, useMemo } from "react";
import { Wallet, Landmark, Receipt, Sparkles, Dices, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { runProjection, runSweep, fmtUSD } from "@/lib/api";
import { AIInsights } from "@/components/AIInsights";
import { useAiSummary } from "@/hooks/useAiSummary";
import { NetWorthChart, CompositionChart, TaxChart, ConversionScheduleChart } from "@/components/ProjectionCharts";
import { BRACKETS, ProjectionControls, SweepPanel, YearTable, LegacyPanels } from "@/components/ProjectionPanels";
import { FundingOrderCompare } from "@/components/FundingOrderCompare";
import { StrategyBadge } from "@/components/StrategyBadge";
import { MarketBadge } from "@/components/MarketScenarioSelector";

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
      // Bracket-fill overlay data — see ConversionScheduleChart.
      headroom_unused: row.conversion_headroom_unused || 0,
      target_bracket_ceiling: row.target_bracket_ceiling,
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

  const aiSummary = useAiSummary({ scenario, withRoth, s, sn, legacy, legacyNo, sweep, taxDelta, nwDelta, heirDelta, mcResult });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <StrategyBadge scenario={scenario} testid="projection-strategy-badge" />
        <MarketBadge scenario={scenario} testid="projection-market-badge" />
      </div>
      <ProjectionControls scenario={scenario} update={update} rmdAge={rmdAge} targetIdx={targetIdx} />

      {/* Summary metrics */}
      <SummaryCard icon={Receipt} label="Lifetime Taxes (w/ conversions)" hint="all-in — Fed + State + NIIT + Medicare/IRMAA" value={fmtUSD(s?.lifetime_taxes)} sub={`vs ${fmtUSD(sn?.lifetime_taxes)} without`} accent="terra" testid="metric-lifetime-tax" />
      <SummaryCard icon={Wallet} label="Ending Net Worth" hint="gross estate at 2nd death (pre-heir-tax, pre-settlement)" value={fmtUSD(s?.ending_net_worth)} sub={`${nwDelta >= 0 ? "+" : ""}${fmtUSD(nwDelta)} vs no conversions`} accent="green" testid="metric-ending-nw" />
      <SummaryCard icon={Landmark} label="Total Converted to Roth" hint="sum of every Roth conversion across the plan horizon" value={fmtUSD(s?.total_roth_converted)} sub={`Ending Roth ${fmtUSD(s?.ending_roth)}`} accent="green" testid="metric-total-converted" />
      <div className="rounded-xl border border-[#4A6741]/30 bg-[#4A6741]/5 p-5 flex flex-col justify-center" data-testid="metric-tax-savings">
        <p className="label-cap text-[#4A6741] text-[10px] mb-1">Lifetime Tax Difference</p>
        <p className={`font-display text-2xl font-bold ${taxDelta >= 0 ? "text-[#4A6741]" : "text-[#C87941]"}`}>
          {taxDelta >= 0 ? "−" : "+"}{fmtUSD(Math.abs(taxDelta))}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{taxDelta >= 0 ? "saved by converting" : "more tax from converting"}</p>
      </div>

      <SweepPanel sweep={sweep} sweeping={sweeping} findOptimal={findOptimal} withRoth={withRoth} />

      <FundingOrderCompare scenario={scenario} />

      <NetWorthChart data={chartData} loading={loading} />
      <CompositionChart data={chartData} />
      <TaxChart data={chartData} />

      {/* Dedicated Roth conversion schedule — annual bars + cumulative overlay */}
      <ConversionScheduleChart data={chartData} />

      <YearTable rows={withRoth?.rows || []} />

      <LegacyPanels legacy={legacy} legacyNo={legacyNo} heirDelta={heirDelta} postCompare={postCompare} targetIdx={targetIdx} />

      {/* 5-year / pre-59½ Roth compliance warnings — early-tap penalty tracker */}
      {withRoth?.roth_compliance && (
        <RothComplianceCard compliance={withRoth.roth_compliance} />
      )}

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

const SummaryCard = ({ icon: Icon, label, value, sub, hint, accent, testid }) => (
  <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid={testid}>
    <div className="flex items-center gap-2 mb-1">
      <Icon className={`h-4 w-4 ${accent === "terra" ? "text-[#C87941]" : "text-[#4A6741]"}`} />
      <p className="label-cap text-muted-foreground text-[10px]">{label}</p>
    </div>
    {hint && <p className="text-[10px] text-muted-foreground/80 italic mb-1 leading-tight">{hint}</p>}
    <p className={`font-display text-2xl font-bold ${accent === "terra" ? "text-[#C87941]" : "text-[#4A6741]"}`}>{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{sub}</p>
  </Card>
);

const RothComplianceCard = ({ compliance }) => {
  const { warnings = [], total_early_penalty = 0 } = compliance;
  const hasWarnings = warnings.length > 0;
  if (!hasWarnings) {
    return (
      <Card className="p-5 border-[#4A6741]/25 bg-[#4A6741]/5 shadow-none lg:col-span-4" data-testid="roth-compliance-clear">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-[#4A6741]" />
          <p className="text-xs text-[#2C4A2D]">
            <span className="font-semibold">Roth compliance clean.</span> No withdrawals under the 5-year rule, no pre-59½ taps.
          </p>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-5 border-[#B84A4A]/40 bg-[#B84A4A]/5 shadow-none lg:col-span-4" data-testid="roth-compliance-warning">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-[#B84A4A]" />
        <h3 className="font-display text-lg font-bold tracking-tight text-[#B84A4A]">5-Year Rule / Pre-59½ Warnings</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
        The funding order taps Roth <span className="font-medium">before</span> either the 5-year clock on a
        specific conversion, or before the owner reaches age 59½. Each such withdrawal on the
        converted principal incurs a <span className="font-medium">10% penalty</span> under IRC §408A(d)(3).
        Estimated penalty: <span className="font-bold text-[#B84A4A]">{fmtUSD(total_early_penalty)}</span>.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground text-left">
            <tr className="border-b border-[#EBE8E0]">
              <th className="px-2 py-1">Year</th>
              <th className="px-2">Owner</th>
              <th className="px-2">Owner age</th>
              <th className="px-2">Roth withdrawal</th>
              <th className="px-2">Within 5-yr clock</th>
              <th className="px-2">10% penalty</th>
              <th className="px-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {warnings.slice(0, 10).map((w, i) => (
              <tr key={`${w.year}-${w.owner || i}-${i}`} className="border-b border-[#F3F1EC]" data-testid={`roth-warn-${i}`}>
                <td className="px-2 py-1.5 font-medium">{w.year}</td>
                <td className="px-2">{w.owner || "—"}</td>
                <td className="px-2">{w.owner_age ?? w.client_age}</td>
                <td className="px-2">{fmtUSD(w.roth_withdrawn)}</td>
                <td className="px-2">{fmtUSD(w.amount_within_5yr)}</td>
                <td className="px-2 font-medium text-[#B84A4A]">{fmtUSD(w.penalty_10pct)}</td>
                <td className="px-2 text-muted-foreground">{w.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        Per-conversion 5-year clock tracked per owner (client vs spouse); each conversion is deposited into the source-IRA owner&apos;s own Roth account. Oldest-conversion-first drawdown. Consult a CPA before executing.
      </p>
    </Card>
  );
};
