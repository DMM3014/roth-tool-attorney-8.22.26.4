import { useEffect, useMemo, useState, useCallback } from "react";
import { ArrowRight, Target, Sparkles, DownloadCloud, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { optimizeConversion, runProjection, fmtUSD, fmtPct } from "@/lib/api";
import { toast } from "sonner";
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
  // "Other Dividends Realized" = dividend rate × taxable account balances (mirrors the multi-year engine)
  const taxableTotal = scenario.accounts
    .filter((a) => a.tax_type === "Taxable")
    .reduce((sum, a) => sum + (a.beginning_balance || 0), 0);
  const divRate = scenario.dividend_yield ?? 0.02;
  const divFromRate = Math.round(divRate * taxableTotal);

  const proj = scenario.projection;
  const startYear = proj.start_year;
  const endYear = proj.end_year;
  const bracketRate = proj.bracket_indexing ?? 0.03;
  const irmaaRate = proj.irmaa_indexing ?? 0.03;
  const clientDob = scenario.household?.client_dob_year;
  const spouseDob = scenario.household?.spouse_dob_year;
  const YEARS = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

  const idxFor = (year) => ({
    bracket_index: Math.pow(1 + bracketRate, year - startYear),
    irmaa_index: Math.pow(1 + irmaaRate, year - startYear),
  });
  const ageCountFor = (year, filing) => {
    const ca = clientDob ? year - clientDob : -1;
    const sa = spouseDob ? year - spouseDob : -1;
    if (filing === "Single") return ca >= 65 ? 1 : 0;
    return (ca >= 65 ? 1 : 0) + (sa >= 65 ? 1 : 0);
  };

  const [inp, setInp] = useState(() => {
    const c = ageCountFor(startYear, "MFJ");
    return {
      filing_status: "MFJ",
      year: startYear,
      ...idxFor(startYear),
      num_65plus: c,
      medicare_count: c,
      ordinary_non_ss: wages ? wages.amount : 200000,
      ira_distributions: 0,
      cash_interest: 3000,
      gross_ss: 0,
      recurring_div_ltcg: divFromRate,
      realized_ltcg: 0,
      state_rate: scenario.tax.state_rate,
      include_irmaa: true,
    };
  });
  const [targetIdx, setTargetIdx] = useState(3); // index into BRACKETS -> 0.24
  const [result, setResult] = useState(null);
  const [pulling, setPulling] = useState(false);

  const set = (k) => (v) => setInp((p) => ({ ...p, [k]: v }));
  const targetRate = BRACKETS[targetIdx];

  const setYear = (y) => {
    const year = +y;
    const c = ageCountFor(year, inp.filing_status);
    setInp((p) => ({ ...p, year, ...idxFor(year), num_65plus: c, medicare_count: c }));
  };
  const setFiling = (v) => {
    const c = ageCountFor(inp.year, v);
    setInp((p) => ({ ...p, filing_status: v, num_65plus: c, medicare_count: c }));
  };

  const clientAge = clientDob ? inp.year - clientDob : null;
  const spouseAge = spouseDob ? inp.year - spouseDob : null;

  const pullFromPlan = async () => {
    setPulling(true);
    try {
      const data = await runProjection(scenario);
      const row = (data.rows || []).find((r) => r.year === inp.year);
      if (!row) {
        toast.error(`No projected data for ${inp.year} (outside the plan horizon).`);
        return;
      }
      const cf = row.cashflow || {};
      const realized = Math.max(0, (row.preferential_income || 0) - (cf.dividends || 0));
      const ages = [row.client_age, row.spouse_age].filter((a) => a != null);
      const count65 = ages.filter((a) => a >= 65).length;
      const filing = row.filing_status === "Single" ? "Single" : "MFJ";
      setInp((p) => ({
        ...p,
        filing_status: filing,
        ordinary_non_ss: Math.round(cf.wages_pension || 0),
        ira_distributions: Math.round((cf.rmd || 0) + (cf.from_ira || 0)),
        cash_interest: Math.round(cf.interest || 0),
        gross_ss: Math.round(cf.gross_ss || 0),
        recurring_div_ltcg: Math.round(cf.dividends || 0),
        realized_ltcg: Math.round(realized),
        num_65plus: count65,
        medicare_count: count65,
      }));
      toast.success(`Loaded ${inp.year} income from your plan — before any Roth conversion. The optimizer now recommends a conversion on top.`);
    } catch (e) {
      toast.error("Couldn't load values from your plan. Please try again.");
    } finally {
      setPulling(false);
    }
  };

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
    () => result && { mode: "single_year", year: inp.year, filing_status: inp.filing_status, target_bracket: targetRate, ...result },
    [result, inp.year, inp.filing_status, targetRate]
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
            <Select value={inp.filing_status} onValueChange={setFiling}>
              <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="filing-status-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MFJ">Married Filing Jointly</SelectItem>
                <SelectItem value="Single">Single (Survivor)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Tax Year</Label>
            <Select value={String(inp.year)} onValueChange={setYear}>
              <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="tax-year-select"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1" data-testid="year-indexing-note">
              Brackets & IRMAA indexed ×{inp.bracket_index.toFixed(2)} ({fmtPct(bracketRate)}/yr from {startYear})
              {clientAge != null && ` · ${scenario.household.client_name?.split(" ")[0] || "Client"} age ${clientAge}`}
              {spouseAge != null && inp.filing_status === "MFJ" && ` · ${scenario.household.spouse_name?.split(" ")[0] || "Spouse"} age ${spouseAge}`}
            </p>
            <Button variant="outline" size="sm" onClick={pullFromPlan} disabled={pulling} data-testid="pull-from-plan"
              className="mt-2 w-full gap-2 border-[#4A6741] text-[#4A6741] hover:bg-[#E8F3E5] rounded-full">
              {pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
              {pulling ? "Loading…" : `Use ${inp.year} values from my plan`}
            </Button>
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
              <div>
                <NumField label="Qualified Dividends + Recurring LTCG" value={inp.recurring_div_ltcg} onChange={set("recurring_div_ltcg")} testid="in-div" />
                <p className="text-[10px] text-muted-foreground mt-1" data-testid="div-derivation">
                  Auto = {fmtPct(divRate)} dividend rate × {fmtUSD(taxableTotal)} taxable balances. Editable; change the rate on Plan Inputs.
                </p>
              </div>
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
              <p className="text-[10px] text-muted-foreground mt-1">Auto from birth years · editable</p>
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
