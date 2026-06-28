import { useEffect, useState, useCallback, useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, Line, ComposedChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Wallet, Landmark, Receipt, Sparkles, Wand2, Award, Download, Printer, Gift } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { runProjection, runSweep, downloadCSV, fmtUSD, fmtPct } from "@/lib/api";
import { AIInsights } from "@/components/AIInsights";

const BRACKETS = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
const C = { green: "#4A6741", sage: "#7A9B76", terra: "#C87941", sand: "#E6B89C", blue: "#4B7A94" };
const AXIS_TICK = { fontSize: 11 };
const BAR_RADIUS = [3, 3, 0, 0];

const metricColor = (accent, warn) => {
  if (accent) return "text-[#4A6741]";
  if (warn) return "text-[#C87941]";
  return "text-[#1A1A1A]";
};

const ttFmt = (v) => fmtUSD(v);

export const Projection = ({ scenario, setScenario }) => {
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sweep, setSweep] = useState(null);
  const [sweeping, setSweeping] = useState(false);
  const r = scenario.roth;
  const targetIdx = BRACKETS.indexOf(r.target_bracket) >= 0 ? BRACKETS.indexOf(r.target_bracket) : 3;

  const update = (path, value) => {
    setScenario((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let o = next;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      o[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const findOptimal = useCallback(() => {
    setSweeping(true);
    runSweep(scenario)
      .then((res) => {
        setSweep(res);
        if (res.best?.target_bracket != null) update("roth.target_bracket", res.best.target_bracket);
        else update("roth.enabled", false);
      })
      .finally(() => setSweeping(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

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
  const taxDelta = s && sn ? sn.lifetime_taxes - s.lifetime_taxes : 0;
  const nwDelta = s && sn ? s.ending_net_worth - sn.ending_net_worth : 0;

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
      sample_years: withRoth.rows.filter((_, i) => i % 5 === 0).map((x) => ({
        year: x.year, conversion: x.roth_conversion, tax: x.total_tax,
        traditional: x.traditional, roth: x.roth, marginal_rate: x.marginal_rate,
      })),
    },
    [s, sn, taxDelta, nwDelta, withRoth, scenario, sweep, legacy]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Controls */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:row-span-2" data-testid="projection-controls">
        <h3 className="font-display text-lg font-bold tracking-tight mb-4">Conversion & Plan Controls</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Enable Roth conversions</Label>
            <Switch checked={r.enabled} onCheckedChange={(v) => update("roth.enabled", v)} data-testid="roth-enabled-switch" />
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <Label className="text-xs text-muted-foreground">Target bracket ceiling</Label>
              <span className="font-display font-bold text-[#4A6741]" data-testid="proj-target-label">{(BRACKETS[targetIdx] * 100).toFixed(0)}%</span>
            </div>
            <Slider min={0} max={BRACKETS.length - 1} step={1} value={[targetIdx]}
              onValueChange={(v) => update("roth.target_bracket", BRACKETS[v[0]])} data-testid="proj-bracket-slider" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Conv. start</Label>
              <Input type="number" value={r.start_year} data-testid="conv-start-year"
                onChange={(e) => update("roth.start_year", +e.target.value)} className="mt-1 bg-[#F9F8F6]" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Conv. end</Label>
              <Input type="number" value={r.end_year} data-testid="conv-end-year"
                onChange={(e) => update("roth.end_year", +e.target.value)} className="mt-1 bg-[#F9F8F6]" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm">Stop at RMD age (73)</Label>
            <Switch checked={r.stop_at_rmd_age} onCheckedChange={(v) => update("roth.stop_at_rmd_age", v)} data-testid="stop-rmd-switch" />
          </div>

          <div className="pt-2 border-t border-[#EBE8E0]">
            <Label className="text-xs text-muted-foreground">Funding / Withdrawal Order</Label>
            <Select value={scenario.withdrawal?.funding_order || "Cash → Taxable → IRA → Roth"}
              onValueChange={(v) => update("withdrawal.funding_order", v)}>
              <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="funding-order-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash → Taxable → IRA → Roth">Cash → Taxable → IRA → Roth</SelectItem>
                <SelectItem value="Cash → IRA → Taxable → Roth">Cash → IRA → Taxable → Roth</SelectItem>
                <SelectItem value="Split IRA & Taxable">Split IRA &amp; Taxable</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">Cash is always spent first, Roth always last. Saved per scenario.</p>
            {scenario.withdrawal?.funding_order === "Split IRA & Taxable" && (
              <div className="mt-3">
                <div className="flex justify-between mb-2">
                  <Label className="text-xs text-muted-foreground">IRA share of split</Label>
                  <span className="font-display font-bold text-[#4A6741]" data-testid="ira-split-label">{Math.round((scenario.withdrawal?.ira_split ?? 0.5) * 100)}%</span>
                </div>
                <Slider min={0} max={100} step={5} value={[(scenario.withdrawal?.ira_split ?? 0.5) * 100]}
                  onValueChange={(v) => update("withdrawal.ira_split", v[0] / 100)} data-testid="ira-split-slider" />
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-[#EBE8E0]">
            <p className="label-cap text-muted-foreground mb-3">Key Balances</p>
            {scenario.accounts.filter((a) => ["Tax-Deferred", "Taxable", "Cash"].includes(a.tax_type)).map((a, i) => {
              const idx = scenario.accounts.findIndex((x) => x.id === a.id);
              return (
                <div key={a.id} className="mb-3">
                  <Label className="text-xs text-muted-foreground">{a.name}</Label>
                  <Input type="number" step={10000} value={a.beginning_balance} data-testid={`acct-${a.id}`}
                    onChange={(e) => update(`accounts.${idx}.beginning_balance`, +e.target.value)} className="mt-1 bg-[#F9F8F6]" />
                </div>
              );
            })}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Survivor filing status</Label>
            <Select value={scenario.tax.survivor_filing_status} onValueChange={(v) => update("tax.survivor_filing_status", v)}>
              <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="survivor-status-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Single">Single</SelectItem>
                <SelectItem value="Married Filing Jointly">Married Filing Jointly</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">Applied the year after first death (life expectancies set in Scenario tab).</p>
          </div>
        </div>
      </Card>

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

      {/* One-click optimizer sweep */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4 bg-white" data-testid="sweep-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">Find the Bracket That Minimizes Lifetime Tax</h3>
          </div>
          <div className="flex gap-2">
            <Button onClick={findOptimal} disabled={sweeping} data-testid="find-optimal-button"
              className="bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
              <Wand2 className="h-4 w-4 mr-2" />{sweeping ? "Sweeping all brackets…" : "Find Optimal Bracket"}
            </Button>
            <Button variant="outline" onClick={() => downloadCSV(withRoth?.rows, "retirement_projection.csv")}
              disabled={!withRoth} data-testid="export-csv-button" className="rounded-full">
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()} data-testid="print-button" className="rounded-full">
              <Printer className="h-4 w-4 mr-2" /> Print / PDF
            </Button>
          </div>
        </div>
        {!sweep && <p className="text-sm text-muted-foreground">Sweeps every target bracket (and no-conversion) and ranks each by the after-tax estate passed to heirs — then auto-applies the winner.</p>}
        {sweep && (
          <div className="overflow-x-auto">
            <div className="flex items-center gap-2 mb-3 text-sm">
              <Award className="h-4 w-4 text-[#C87941]" />
              <span className="font-semibold">Optimal:</span>
              <span data-testid="optimal-result" className="font-display font-bold text-[#4A6741]">{sweep.best.label}</span>
              <span className="text-muted-foreground">→ {fmtUSD(sweep.best.after_tax_estate)} to heirs · {fmtUSD(sweep.best.lifetime_taxes)} lifetime tax</span>
            </div>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-right border-b border-[#EBE8E0]">
                <tr><th className="text-left py-2">Strategy</th><th>Total Converted</th><th>Lifetime Taxes</th><th>Ending Roth</th><th>Ending Net Worth</th><th>After-Tax to Heirs</th></tr>
              </thead>
              <tbody>
                {sweep.ranked.map((row, i) => (
                  <tr key={row.label} className={`text-right border-b border-[#F3F1EC] tabular-nums ${i === 0 ? "bg-[#4A6741]/5 font-medium" : ""}`} data-testid={`sweep-row-${i}`}>
                    <td className="text-left py-2">{i === 0 && "★ "}{row.label}</td>
                    <td>{fmtUSD(row.total_converted)}</td>
                    <td className="text-[#C87941]">{fmtUSD(row.lifetime_taxes)}</td>
                    <td>{fmtUSD(row.ending_roth)}</td>
                    <td>{fmtUSD(row.ending_net_worth)}</td>
                    <td className="text-[#4A6741] font-medium">{fmtUSD(row.after_tax_estate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Net worth comparison chart */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-3" data-testid="networth-chart">
        <h3 className="font-display text-base font-bold tracking-tight mb-4">Net Worth — Conversions vs. No Conversions {loading && <span className="text-xs text-muted-foreground animate-pulse">updating…</span>}</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeOpacity={0.1} vertical={false} />
            <XAxis dataKey="year" tick={AXIS_TICK} />
            <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} tick={AXIS_TICK} width={50} />
            <Tooltip formatter={ttFmt} />
            <Legend />
            <Bar dataKey="conversion" name="Roth Conversion" fill={C.sand} barSize={6} />
            <Line type="monotone" dataKey="netRoth" name="With Conversions" stroke={C.green} strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="netNo" name="No Conversions" stroke={C.terra} strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Account composition */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-2" data-testid="composition-chart">
        <h3 className="font-display text-base font-bold tracking-tight mb-4">Account Composition Over Time</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeOpacity={0.1} vertical={false} />
            <XAxis dataKey="year" tick={AXIS_TICK} />
            <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} tick={AXIS_TICK} width={45} />
            <Tooltip formatter={ttFmt} />
            <Legend />
            <Area type="monotone" stackId="1" dataKey="Cash" stroke={C.blue} fill={C.blue} fillOpacity={0.7} />
            <Area type="monotone" stackId="1" dataKey="Taxable" stroke={C.sage} fill={C.sage} fillOpacity={0.7} />
            <Area type="monotone" stackId="1" dataKey="Traditional" stroke={C.terra} fill={C.terra} fillOpacity={0.7} />
            <Area type="monotone" stackId="1" dataKey="Roth" stroke={C.green} fill={C.green} fillOpacity={0.8} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Annual taxes */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-2" data-testid="tax-chart">
        <h3 className="font-display text-base font-bold tracking-tight mb-4">Annual Tax Burden</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <CartesianGrid strokeOpacity={0.1} vertical={false} />
            <XAxis dataKey="year" tick={AXIS_TICK} />
            <YAxis tickFormatter={(v) => `$${(v / 1e3).toFixed(0)}k`} tick={AXIS_TICK} width={45} />
            <Tooltip formatter={ttFmt} />
            <Bar dataKey="tax" name="Total Tax" fill={C.terra} radius={BAR_RADIUS} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Year table */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4 overflow-x-auto" data-testid="projection-table">
        <h3 className="font-display text-base font-bold tracking-tight mb-4">Year-by-Year Detail</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-right border-b border-[#EBE8E0] text-muted-foreground">
              <th className="py-2 text-left">Year</th><th className="text-left">Filing</th><th>Ages</th>
              <th>Ordinary</th><th>RMD</th><th>Conversion</th><th>LTCG/Div</th>
              <th>Tax</th><th>Marg.</th><th>Traditional</th><th>Roth</th><th>Net Worth</th>
            </tr>
          </thead>
          <tbody>
            {(withRoth?.rows || []).map((row) => (
              <tr key={row.year} className="text-right border-b border-[#F3F1EC] tabular-nums">
                <td className="py-1.5 text-left font-medium">{row.year}</td>
                <td className="text-left">{row.filing_status}</td>
                <td>{row.client_age ?? "—"}/{row.spouse_age ?? "—"}</td>
                <td>{fmtUSD(row.ordinary_income)}</td>
                <td>{fmtUSD(row.rmd)}</td>
                <td className="text-[#4A6741] font-medium">{fmtUSD(row.roth_conversion)}</td>
                <td>{fmtUSD(row.preferential_income)}</td>
                <td className="text-[#C87941]">{fmtUSD(row.total_tax)}</td>
                <td>{fmtPct(row.marginal_rate)}</td>
                <td>{fmtUSD(row.traditional)}</td>
                <td>{fmtUSD(row.roth)}</td>
                <td className="font-medium">{fmtUSD(row.net_worth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Legacy / Estate */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="legacy-card">
        <div className="flex items-center gap-2 mb-4">
          <Gift className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Legacy & Estate at Second Death</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Taxable & home receive a basis step-up (no embedded-gain tax). Inherited traditional IRA is taxed to heirs (SECURE 10-year, PV-at-death) at {fmtPct(legacy?.heir_ordinary_rate)}. Roth passes tax-free.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <EstateMetric label="Gross Estate" value={fmtUSD(legacy?.gross_estate)} testid="estate-gross" />
          <EstateMetric label="Settlement Costs" value={`−${fmtUSD(legacy?.estate_settlement)}`} warn testid="estate-settlement" />
          <EstateMetric label="Inherited IRA Tax" value={`−${fmtUSD(legacy?.inherited_ira_tax)}`} warn testid="estate-ira-tax" />
          <EstateMetric label="Tax-Free Roth to Heirs" value={fmtUSD(legacy?.tax_free_roth_to_heirs)} accent testid="estate-roth" />
          <EstateMetric label="After-Tax Estate to Heirs" value={fmtUSD(legacy?.after_tax_estate_to_heirs)} accent big testid="estate-after-tax" />
        </div>
      </Card>

      {/* AI */}
      <Card className="p-6 bg-[#EBE8E0]/60 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="ai-insights-panel-proj">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-[#C87941]" />
          <h3 className="font-display text-lg font-bold tracking-tight">AI Strategy Insights</h3>
        </div>
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

const EstateMetric = ({ label, value, accent, warn, big, testid }) => (
  <div className={`rounded-lg border p-4 ${big ? "border-[#4A6741]/30 bg-[#4A6741]/5" : "border-[#EBE8E0] bg-white"}`}>
    <p className="label-cap text-muted-foreground text-[10px] mb-1">{label}</p>
    <p data-testid={testid} className={`font-display ${big ? "text-2xl" : "text-lg"} font-bold ${metricColor(accent, warn)}`}>{value}</p>
  </div>
);
