import { useEffect, useMemo, useState, useCallback } from "react";
import { ArrowRight, Target, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { optimizeConversion, fmtUSD, fmtPct } from "@/lib/api";
import { AIInsights } from "@/components/AIInsights";

const BRACKETS = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

const NumField = ({ label, value, onChange, testid, step = 1000 }) => (
  <div>
    <Label className="text-xs text-muted-foreground">{label}</Label>
    <Input
      type="number" step={step} value={value} data-testid={testid}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className="mt-1 bg-[#F9F8F6] focus-visible:ring-[#7A9B76]"
    />
  </div>
);

export const Optimizer = ({ scenario }) => {
  const wages = scenario.income_streams.find((s) => s.type === "Wages");
  const div = scenario.income_streams.find((s) => s.tax_character === "QDiv/LTCG");

  const [inp, setInp] = useState({
    filing_status: "MFJ",
    year: scenario.projection.start_year,
    bracket_index: 1.0,
    irmaa_index: 1.0,
    num_65plus: 0,
    medicare_count: 0,
    ordinary_non_ss: wages ? wages.amount : 200000,
    ira_distributions: 0,
    cash_interest: 3000,
    gross_ss: 0,
    recurring_div_ltcg: div ? div.amount : 60000,
    realized_ltcg: 0,
    state_rate: scenario.tax.state_rate,
    include_irmaa: true,
  });
  const [targetIdx, setTargetIdx] = useState(3); // index into BRACKETS -> 0.24
  const [result, setResult] = useState(null);

  const set = (k) => (v) => setInp((p) => ({ ...p, [k]: v }));
  const targetRate = BRACKETS[targetIdx];

  const recalc = useCallback(() => {
    optimizeConversion(inp, targetRate, 0).then(setResult);
  }, [inp, targetRate]);

  useEffect(() => {
    const t = setTimeout(recalc, 250);
    return () => clearTimeout(t);
  }, [recalc]);

  const before = result?.before;
  const after = result?.after;

  const aiSummary = useMemo(
    () => result && { mode: "single_year", filing_status: inp.filing_status, target_bracket: targetRate, ...result },
    [result, inp.filing_status, targetRate]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Inputs */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:row-span-2" data-testid="optimizer-inputs">
        <h3 className="font-display text-lg font-bold tracking-tight mb-1">Tax Snapshot Inputs</h3>
        <p className="text-xs text-muted-foreground mb-5">Single tax year. Ordinary and preferential income are kept separate.</p>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Filing Status</Label>
            <Select value={inp.filing_status} onValueChange={set("filing_status")}>
              <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="filing-status-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MFJ">Married Filing Jointly</SelectItem>
                <SelectItem value="Single">Single (Survivor)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-2">
            <p className="label-cap text-[#4A6741] mb-2">Ordinary Income</p>
            <div className="space-y-3">
              <NumField label="Wages / Pension / Other" value={inp.ordinary_non_ss} onChange={set("ordinary_non_ss")} testid="in-ordinary" />
              <NumField label="IRA / 401(k) Distributions (excl. conversion)" value={inp.ira_distributions} onChange={set("ira_distributions")} testid="in-ira" />
              <NumField label="Interest on Cash" value={inp.cash_interest} onChange={set("cash_interest")} testid="in-interest" step={100} />
              <NumField label="Gross Social Security" value={inp.gross_ss} onChange={set("gross_ss")} testid="in-ss" />
            </div>
          </div>

          <div className="pt-2">
            <p className="label-cap text-[#C87941] mb-2">Preferential Income (LTCG / Qual. Div)</p>
            <div className="space-y-3">
              <NumField label="Qualified Dividends + Recurring LTCG" value={inp.recurring_div_ltcg} onChange={set("recurring_div_ltcg")} testid="in-div" />
              <NumField label="Realized LTCG (sales)" value={inp.realized_ltcg} onChange={set("realized_ltcg")} testid="in-realized" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <Label className="text-xs text-muted-foreground"># Age 65+</Label>
              <Select value={String(inp.num_65plus)} onValueChange={(v) => setInp((p) => ({ ...p, num_65plus: +v, medicare_count: +v }))}>
                <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="age65-select"><SelectValue /></SelectTrigger>
                <SelectContent>{[0, 1, 2].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <NumField label="State Tax Rate" value={inp.state_rate} onChange={set("state_rate")} testid="in-state" step={0.001} />
          </div>
        </div>
      </Card>

      {/* Bracket slider + headline */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-2" data-testid="bracket-fill-card">
        <div className="flex items-center gap-2 mb-1">
          <Target className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Fill-the-Bracket Roth Conversion</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5">Convert traditional IRA dollars up to the top of your chosen ordinary bracket.</p>

        <div className="flex items-baseline justify-between mb-2">
          <span className="label-cap text-muted-foreground">Target Ordinary Bracket</span>
          <span className="font-display text-2xl font-bold text-[#4A6741]" data-testid="target-bracket-label">{(targetRate * 100).toFixed(0)}%</span>
        </div>
        <Slider
          min={0} max={BRACKETS.length - 1} step={1} value={[targetIdx]}
          onValueChange={(v) => setTargetIdx(v[0])} data-testid="roth-conversion-slider" className="my-4"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mb-6">
          {BRACKETS.map((b) => <span key={b}>{(b * 100).toFixed(0)}</span>)}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Metric label="Recommended Conversion" value={fmtUSD(result?.recommended_conversion)} accent testid="tax-conversion-amount" />
          <Metric label="Bracket Ceiling" value={result?.bracket_ceiling ? fmtUSD(result.bracket_ceiling) : "No cap"} />
          <Metric label="Extra Tax on Conversion" value={fmtUSD(result?.tax_on_conversion)} warn testid="tax-on-conversion" />
        </div>
      </Card>

      {/* Breakdown table */}
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-2" data-testid="results-breakdown">
        <h3 className="font-display text-lg font-bold tracking-tight mb-4">Tax Breakdown — Before vs. After Conversion</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[#EBE8E0]">
                <th className="py-2 font-medium text-muted-foreground">Line</th>
                <th className="py-2 text-right font-medium text-muted-foreground">Before</th>
                <th className="py-2 text-right font-medium text-muted-foreground">After</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Ordinary taxable income" b={before?.ordinary_taxable_income} a={after?.ordinary_taxable_income} />
              <Row label="Preferential (LTCG/QDIV) in taxable" b={before?.preferential_within_taxable} a={after?.preferential_within_taxable} />
              <Row label="Taxable Social Security" b={before?.taxable_ss} a={after?.taxable_ss} />
              <Row label="AGI" b={before?.agi} a={after?.agi} bold />
              <Row label="Federal ordinary income tax" b={before?.federal_ordinary_tax} a={after?.federal_ordinary_tax} />
              <Row label="Federal LTCG / QDIV tax" b={before?.federal_ltcg_tax} a={after?.federal_ltcg_tax} />
              <Row label="NIIT (3.8%)" b={before?.niit} a={after?.niit} />
              <Row label="State income tax" b={before?.state_tax} a={after?.state_tax} />
              <Row label="Medicare / IRMAA premiums" b={before?.medicare_premiums} a={after?.medicare_premiums} />
              <Row label="Total tax burden" b={before?.total_burden} a={after?.total_burden} bold highlight testid="tax-burden-total" />
            </tbody>
            <tfoot>
              <tr className="text-xs text-muted-foreground">
                <td className="py-2">Marginal ordinary rate · Effective rate</td>
                <td className="py-2 text-right">{fmtPct(before?.marginal_ordinary_rate)} · {fmtPct(before?.effective_rate)}</td>
                <td className="py-2 text-right">{fmtPct(after?.marginal_ordinary_rate)} · {fmtPct(after?.effective_rate)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* AI panel */}
      <Card className="p-6 bg-[#EBE8E0]/60 border-[#EBE8E0] shadow-none lg:col-span-3" data-testid="ai-insights-panel">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-[#C87941]" />
          <h3 className="font-display text-lg font-bold tracking-tight">AI Strategy Insights</h3>
        </div>
        <AIInsights summary={aiSummary} testid="ai-insights" />
      </Card>
    </div>
  );
};

const metricColor = (accent, warn) => {
  if (accent) return "text-[#4A6741]";
  if (warn) return "text-[#C87941]";
  return "text-[#1A1A1A]";
};

const Metric = ({ label, value, accent, warn, testid }) => (
  <div className="rounded-lg border border-[#EBE8E0] bg-white p-4">
    <p className="label-cap text-muted-foreground text-[10px] mb-1">{label}</p>
    <p data-testid={testid} className={`font-display text-xl font-bold ${metricColor(accent, warn)}`}>{value}</p>
  </div>
);

const Row = ({ label, b, a, bold, highlight, testid }) => (
  <tr className={`border-b border-[#F3F1EC] ${highlight ? "bg-[#F3F1EC]" : ""}`}>
    <td className={`py-2 ${bold ? "font-semibold" : ""}`}>{label}</td>
    <td className="py-2 text-right tabular-nums">{fmtUSD(b)}</td>
    <td data-testid={testid} className={`py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>{fmtUSD(a)}</td>
  </tr>
);
