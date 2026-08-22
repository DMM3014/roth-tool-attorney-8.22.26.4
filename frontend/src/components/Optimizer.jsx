import { useEffect, useMemo, useState, useCallback } from "react";
import { ArrowRight, Target, Sparkles, DownloadCloud, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { optimizeConversion, runProjection, fmtUSD, fmtPct } from "@/lib/api";
import { toast } from "sonner";
import { AIInsights } from "@/components/AIInsights";

const BRACKETS = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

// LTCG/QDIV band tops (2026 base-year $, indexed by the projection's bracket_index)
// mirror the tax_engine constants — needed to detect when a conversion pushes
// preferential income across the 0→15% or 15→20% cliffs (Kitces "capital gains
// bump zone"). Keeping these in sync with tax_engine.py is intentional: the
// bump-zone effect is purely a function of ordinary vs. preferential band overlap,
// no extra backend call is required to detect it.
const LTCG0_MFJ = 98900;
const LTCG15_MFJ = 613700;
const LTCG0_SGL = 49450;
const LTCG15_SGL = 545500;

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
  const divRate = scenario.dividend_yield ?? 0.01;
  const divFromRate = Math.round(divRate * taxableTotal);

  const proj = scenario.projection;
  const startYear = proj.start_year;
  const endYear = proj.end_year;
  const bracketRate = proj.bracket_indexing ?? 0.03;
  const irmaaRate = proj.irmaa_indexing ?? 0.03;
  const clientDob = scenario.household?.client_dob_year;
  const spouseDob = scenario.household?.spouse_dob_year;
  const YEARS = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

  // Sum any Dividend/LTCG income streams (e.g. "Special Dividends & LTCG") that
  // are active in the given year — mirrors backend/projection.py::_stream_amount
  // so the Optimizer preview and the multi-year engine agree byte-for-byte on
  // preferential income sourced from streams. Follows the same use/skip logic,
  // start_date/stop_date proration, Monthly-vs-Annual frequency, and COLA
  // compounding rules the projection engine uses.
  const parseYMD = (s) => {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  };
  const daysInYear = (y) => (((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365);
  const dayOfYear = ({ y, m, d }) => {
    const days = [31, 28 + (((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 1 : 0), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let n = d;
    for (let i = 0; i < m - 1; i++) n += days[i];
    return n;
  };
  const activeFraction = (sd, ed, year) => {
    // sd/ed may be null. Backend semantics: outside range → 0; entirely inside → 1;
    // boundary years prorate by the active day-count fraction.
    if (sd && year < sd.y) return 0;
    if (ed && year > ed.y) return 0;
    if ((!sd || year > sd.y) && (!ed || year < ed.y)) return 1;
    const totalDays = daysInYear(year);
    const startDay = (sd && sd.y === year) ? dayOfYear(sd) : 1;
    const endDay = (ed && ed.y === year) ? dayOfYear(ed) : totalDays;
    return Math.max(0, (endDay - startDay + 1) / totalDays);
  };
  const streamDividendsForYear = (year) => {
    let total = 0;
    for (const s of (scenario.income_streams || [])) {
      if (s.type !== "Dividend/LTCG") continue;
      if (s.use === false) continue; // honour the "Use" toggle on Plan Inputs
      const sd = parseYMD(s.start_date);
      const ed = parseYMD(s.stop_date);
      const startYearS = sd ? sd.y : (s.start_year ?? startYear);
      let frac;
      if (sd || ed) {
        frac = activeFraction(sd, ed, year);
      } else {
        const stop = s.stop_year;
        if (year < startYearS || (stop && year > stop)) continue;
        frac = 1;
      }
      if (frac <= 0) continue;
      const monthly = s.frequency === "Monthly";
      const freqMul = monthly ? 12 : 1; // backend only supports Monthly / Annual
      let annual = Number(s.amount || 0) * freqMul;
      const cola = Number(s.cola || 0);
      annual *= Math.pow(1 + cola, Math.max(0, year - startYearS));
      annual *= frac;
      total += annual;
    }
    return Math.round(total);
  };

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
      // Include both auto-computed brokerage dividends AND any explicit
      // Dividend/LTCG income streams the user configured on the Inputs page.
      recurring_div_ltcg: divFromRate + streamDividendsForYear(startYear),
      realized_ltcg: 0,
      state_rate: scenario.tax.state_rate,
      include_irmaa: true,
    };
  });
  const [targetIdx, setTargetIdx] = useState(3); // index into BRACKETS -> 0.24
  const [result, setResult] = useState(null);
  const [pulling, setPulling] = useState(false);
  const [irmaaAware, setIrmaaAware] = useState(false);
  const [irmaaBuffer, setIrmaaBuffer] = useState(3000);

  const set = (k) => (v) => setInp((p) => ({ ...p, [k]: v }));
  const targetRate = BRACKETS[targetIdx];

  const setYear = (y) => {
    const year = +y;
    const c = ageCountFor(year, inp.filing_status);
    // Re-sync recurring_div_ltcg to the selected year's stream state so
    // starting/stopping a Dividend/LTCG stream on Plan Inputs immediately
    // reflects in the tax breakdown when the user changes tax year — was
    // stale otherwise (iteration_41 bug).
    setInp((p) => ({
      ...p,
      year,
      ...idxFor(year),
      num_65plus: c,
      medicare_count: c,
      recurring_div_ltcg: divFromRate + streamDividendsForYear(year),
    }));
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
    optimizeConversion(inp, targetRate, 0, { irmaa_aware: irmaaAware, irmaa_cliff_buffer: irmaaBuffer }).then(setResult);
  }, [inp, targetRate, irmaaAware, irmaaBuffer]);

  useEffect(() => {
    const t = setTimeout(recalc, 250);
    return () => clearTimeout(t);
  }, [recalc]);

  const before = result?.before;
  const after = result?.after;

  // ---- Capital-gains "bump zone" detection ----
  // A Roth conversion adds to ordinary taxable income; LTCG/QDIV stacks ON TOP of
  // that base, so a big enough conversion can push some qualified dividends /
  // long-term gains from the 0% band into 15%, or from 15% into 20%. When it does,
  // the effective marginal rate on the conversion dollars silently ramps to
  // ~27–50% (ordinary rate PLUS 15pp or 5pp on the bumped preferential dollars).
  // Warn the user with a concrete $ callout of what got bumped and how much extra
  // pref tax the conversion cost them.
  const bumpAlert = useMemo(() => {
    if (!before || !after) return null;
    const mfj = inp.filing_status === "MFJ";
    const idx = inp.bracket_index || 1;
    const l0 = (mfj ? LTCG0_MFJ : LTCG0_SGL) * idx;
    const l15 = (mfj ? LTCG15_MFJ : LTCG15_SGL) * idx;
    const beforeOrd = before.ordinary_taxable_income || 0;
    const afterOrd = after.ordinary_taxable_income || 0;
    const pref = before.preferential_within_taxable || 0;
    if (pref <= 0) return null;
    if (afterOrd <= beforeOrd + 0.5) return null;
    // "Preferential dollars in band X" helpers: pref stacks from `ord` up to `ord+pref`,
    // and we intersect that segment with each LTCG band.
    const prefIn = (ord, lo, hi) => Math.max(0, Math.min(ord + pref, hi) - Math.max(ord, lo));
    const in0 = { before: prefIn(beforeOrd, 0, l0), after: prefIn(afterOrd, 0, l0) };
    const in15 = { before: prefIn(beforeOrd, l0, l15), after: prefIn(afterOrd, l0, l15) };
    const in20 = { before: prefIn(beforeOrd, l15, Infinity), after: prefIn(afterOrd, l15, Infinity) };
    // Net-flow rule of thumb:
    //   dollars pushed off the 0% shelf = max(0, in0.before - in0.after)
    //   dollars pushed into the 20% band = max(0, in20.after - in20.before)
    // The 15% band's balance reconciles the two — any 0% dollars that didn't leak
    // all the way to 20 landed there.
    const round0 = (x) => (Math.abs(x) < 1 ? 0 : Math.round(x));
    const bumped15to20 = round0(Math.max(0, in20.after - in20.before));
    // Dollars that left the 0% band and did NOT leak all the way to the 20% band.
    // Clamp the entire expression at 0 — bumped15to20 can exceed the drop-from-0
    // when the flow is purely 15→20 (no 0-band involvement at all).
    const bumped0to15 = round0(Math.max(0, Math.max(0, in0.before - in0.after) - bumped15to20));
    // Ground-truth extra pref tax from the tax engine, no reconstruction guesswork.
    const ltcgExtra = Math.round(Math.max(0, (after.federal_ltcg_tax || 0) - (before.federal_ltcg_tax || 0)));
    if (bumped0to15 <= 0 && bumped15to20 <= 0 && ltcgExtra < 1) return null;
    return {
      bumped0to15,
      bumped15to20,
      ltcgExtra,
      ceiling15: Math.round(l15),
      ceiling0: Math.round(l0),
      in15After: round0(in15.after),
      in20After: round0(in20.after),
    };
  }, [before, after, inp.filing_status, inp.bracket_index]);
  const bumpTagline = bumpAlert && (bumpAlert.bumped15to20 > 0
    ? `${fmtUSD(bumpAlert.bumped15to20)} of gains pushed 15% → 20%`
    : bumpAlert.bumped0to15 > 0
      ? `${fmtUSD(bumpAlert.bumped0to15)} of gains pushed 0% → 15%`
      : "");

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
                  Auto = {fmtPct(divRate)} dividend rate × {fmtUSD(taxableTotal)} taxable balances = {fmtUSD(divFromRate)}
                  {streamDividendsForYear(inp.year) > 0 && (
                    <> · plus <span className="font-medium">{fmtUSD(streamDividendsForYear(inp.year))}</span> from Dividend/LTCG income streams (e.g. Special Dividends) active in {inp.year}</>
                  )}
                  . Editable; change the rate or streams on Plan Inputs.
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

        {/* IRMAA-cliff-aware toggle */}
        <div className="mt-4 rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] p-3" data-testid="irmaa-aware-card">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#4A6741]" />
                <span className="text-xs font-semibold text-[#1A1A1A]">IRMAA cliff-aware routing</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                Clip the recommendation so MAGI stays clear of the next Medicare Part-B IRMAA tier. Crossing a tier by
                even $1 costs a couple ~$1,000–$5,000/yr in extra premiums.
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <Switch checked={irmaaAware} onCheckedChange={setIrmaaAware} data-testid="irmaa-aware-toggle" />
              <span className="text-[11px] text-muted-foreground">
                Buffer:{" "}
                <input
                  type="number"
                  value={irmaaBuffer}
                  min={0}
                  max={20000}
                  step={500}
                  onChange={(e) => setIrmaaBuffer(Math.max(0, Math.min(20000, parseFloat(e.target.value) || 0)))}
                  disabled={!irmaaAware}
                  data-testid="irmaa-buffer-input"
                  className="w-20 px-1.5 py-0.5 border border-[#EBE8E0] rounded text-[11px] text-right"
                />{" "}
                $
              </span>
            </div>
          </div>
          {result?.avoided_irmaa_cliff && (
            <div className="mt-2 rounded-md border border-[#4A6741]/30 bg-[#4A6741]/8 px-3 py-2" data-testid="irmaa-cliff-badge">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-[#4A6741] mb-0.5">
                Cliff Avoided
              </div>
              <p className="text-[11px] text-[#2A2A2A] leading-relaxed">
                Trimmed the conversion by <strong>{fmtUSD(result.avoided_irmaa_cliff.avoided_conversion_amount)}</strong>{" "}
                to keep MAGI at least <strong>{fmtUSD(result.avoided_irmaa_cliff.buffer)}</strong> below the next IRMAA
                tier at <strong>{fmtUSD(result.avoided_irmaa_cliff.threshold)}</strong>. The unconstrained recommendation
                would have been <strong>{fmtUSD(result.avoided_irmaa_cliff.unconstrained_conversion)}</strong>.
              </p>
            </div>
          )}
        </div>

        {bumpAlert && (
          <div className="mt-4 rounded-lg border border-[#C87941]/40 bg-[#FBF3EC] p-3 flex items-start gap-3"
               data-testid="bump-zone-alert">
            <AlertTriangle className="h-4 w-4 text-[#C87941] mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-[#C87941]">Capital-gains bump zone</span>
                <span className="text-[10px] rounded-full bg-[#C87941] text-white px-2 py-0.5" data-testid="bump-zone-tagline">
                  {bumpTagline || `+${fmtUSD(bumpAlert.ltcgExtra)} extra LTCG/QDIV tax`}
                </span>
              </div>
              <p className="text-[11px] text-[#7A4A2E] leading-relaxed">
                This conversion stacks additional ordinary income beneath your qualified dividends and long-term gains, pushing some of them into a higher preferential bracket. The <span className="font-semibold">Extra Tax on Conversion</span> above already includes this <span className="font-semibold" data-testid="bump-zone-ltcg-extra">{fmtUSD(bumpAlert.ltcgExtra)}</span> of extra LTCG/QDIV tax — the effective marginal rate on the marginal conversion dollars is higher than the {(targetRate * 100).toFixed(0)}% ordinary bracket alone.
              </p>
              <ul className="text-[11px] text-[#7A4A2E] leading-relaxed mt-1 space-y-0.5 list-disc pl-4">
                {bumpAlert.bumped0to15 > 0 && (
                  <li data-testid="bump-zone-0to15">
                    <span className="font-semibold">{fmtUSD(bumpAlert.bumped0to15)}</span> of gains crossed the 0% → 15% cliff (ceiling <span className="font-mono">{fmtUSD(bumpAlert.ceiling0)}</span> of ordinary taxable income).
                  </li>
                )}
                {bumpAlert.bumped15to20 > 0 && (
                  <li data-testid="bump-zone-15to20">
                    <span className="font-semibold">{fmtUSD(bumpAlert.bumped15to20)}</span> of gains crossed the 15% → 20% cliff (ceiling <span className="font-mono">{fmtUSD(bumpAlert.ceiling15)}</span> of ordinary taxable income).
                  </li>
                )}
                <li>Consider a smaller conversion that stops below the cliff, or realize gains in a low-income year instead.</li>
              </ul>
            </div>
          </div>
        )}
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
