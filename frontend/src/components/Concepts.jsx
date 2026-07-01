import { useEffect, useMemo, useState } from "react";
import { Coins, Landmark, ArrowLeftRight, Gift, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { runProjection, fmtUSD, fmtPct } from "@/lib/api";
import { Waterfall, InternalExternalLines } from "@/components/ConceptsCharts";

const C = { green: "#4A6741", sage: "#7A9B76", terra: "#C87941", sand: "#E6B89C", blue: "#4B7A94" };
const kFmt = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);

const Money = ({ value, onChange, testid }) => {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <Input autoFocus type="number" value={value ?? ""} data-testid={testid}
        onChange={(e) => onChange(e.target.value === "" ? 0 : parseFloat(e.target.value))}
        onBlur={() => setEditing(false)} className="h-9 bg-[#F9F8F6] text-right" />
    );
  }
  return (
    <Input readOnly type="text" data-testid={testid} value={`$${Math.round(value || 0).toLocaleString("en-US")}`}
      onFocus={() => setEditing(true)} className="h-9 bg-[#F9F8F6] text-right cursor-text" />
  );
};

const Pct = ({ value, onChange, testid }) => (
  <Input type="number" step={0.5} value={+((value || 0) * 100).toFixed(2)} data-testid={testid}
    onChange={(e) => onChange((parseFloat(e.target.value) || 0) / 100)} className="h-9 bg-[#F9F8F6] text-right" />
);

const Big = ({ label, value, tone = "green", testid, sub }) => (
  <div className={`rounded-xl border p-4 ${tone === "green" ? "border-[#4A6741]/30 bg-[#4A6741]/5" : tone === "terra" ? "border-[#C87941]/30 bg-[#C87941]/5" : "border-[#EBE8E0] bg-white"}`}>
    <p className="label-cap text-[10px] mb-1" style={{ color: tone === "terra" ? C.terra : C.green }}>{label}</p>
    <p data-testid={testid} className="font-display text-2xl font-bold" style={{ color: tone === "terra" ? C.terra : C.green }}>{value}</p>
    {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
  </div>
);

export const Concepts = ({ scenario }) => {
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);

  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const noCfg = JSON.parse(JSON.stringify(scenario));
      noCfg.roth.enabled = false;
      Promise.all([runProjection(scenario), runProjection(noCfg)]).then(([a, b]) => {
        if (alive) { setWithRoth(a); setNoRoth(b); }
      });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const rows = useMemo(() => withRoth?.rows || [], [withRoth]);

  // Plan-derived defaults for the illustrations.
  const iraReturn = scenario.accounts.find((a) => a.tax_type === "Tax-Deferred")?.return
    ?? scenario.accounts.find((a) => a.tax_type === "Tax-Free")?.return ?? 0.07;
  const targetRate = scenario.roth?.target_bracket ?? 0.24;
  const stateRate = scenario.tax?.state_rate ?? 0;
  const taxableBal = scenario.accounts.filter((a) => a.tax_type === "Taxable").reduce((s, a) => s + (a.beginning_balance || 0), 0);
  const taxableBasis = scenario.accounts.filter((a) => a.tax_type === "Taxable").reduce((s, a) => s + (a.cost_basis || 0), 0);
  const embeddedGain = Math.max(0, taxableBal - taxableBasis);
  const ltcgDefault = scenario.legacy?.heir_ltcg_rate ?? 0.2345;

  const maxConvYear = useMemo(() => {
    let best = null, bv = -1;
    rows.forEach((r) => { if ((r.roth_conversion || 0) > bv) { bv = r.roth_conversion; best = r.year; } });
    return best;
  }, [rows]);
  const maxConv = useMemo(() => Math.round(Math.max(0, ...rows.map((r) => r.roth_conversion || 0))), [rows]);

  const [selYear, setSelYear] = useState(null);
  useEffect(() => { if (selYear == null && maxConvYear) setSelYear(maxConvYear); }, [maxConvYear, selYear]);
  const yr = selYear ?? maxConvYear;
  const row = rows.find((r) => r.year === yr);

  // ---- Illustration state (pre-filled from plan, editable) ----
  const [conv, setConv] = useState(null);
  useEffect(() => { if (conv == null && maxConv) setConv(maxConv); }, [maxConv, conv]);
  const convVal = conv ?? maxConv ?? 300000;
  const [convRate, setConvRate] = useState(targetRate + stateRate);
  const [growth, setGrowth] = useState(iraReturn);
  const [years, setYears] = useState(20);
  const [gain, setGain] = useState(1000000);
  const [ltcg, setLtcg] = useState(ltcgDefault);

  if (!withRoth) {
    return <div className="py-20 text-center text-muted-foreground animate-pulse label-cap">Building concept illustrations…</div>;
  }

  // ---- Spending funding waterfall (selected year) ----
  const cf = row?.cashflow || {};
  const spend = (cf.expenses || 0) + (cf.income_tax || 0) + (cf.medicare || 0);
  // fundable income excludes cash interest (the engine retains interest in cash)
  const income = (cf.wages_pension || 0) + (cf.gross_ss || 0) + (cf.dividends || 0) + (cf.rmd || 0);
  const incomeToward = Math.min(income, spend);
  const spendSteps = [
    { name: "Income & RMD", value: incomeToward, fill: C.green },
    { name: "From Cash", value: cf.from_cash || 0, fill: C.blue },
    { name: "From Taxable", value: cf.from_taxable || 0, fill: C.sand },
    { name: "From IRA", value: cf.from_ira || 0, fill: C.terra },
    { name: "From Roth", value: cf.from_roth || 0, fill: C.sage },
  ].filter((s) => s.value > 0.5);
  let run = 0;
  const spendWF = spendSteps.map((s) => { const val = Math.round(s.value); const d = { name: s.name, base: run, value: val, fill: s.fill, label: kFmt(val) }; run += s.value; return d; });
  spendWF.push({ name: "Total Spending", base: 0, value: Math.round(run), fill: C.green, label: kFmt(run) });

  // ---- Conversion-tax funding waterfall (external only) ----
  const conversion = cf.conversion || 0;
  const convTax = Math.round(conversion * ((row?.marginal_rate || 0) + stateRate));
  const fc = cf.from_cash || 0, ft = cf.from_taxable || 0;
  let cashPart, taxablePart;
  if (fc + ft > 0) { cashPart = Math.min(convTax, fc); taxablePart = Math.max(0, convTax - cashPart); }
  else { cashPart = 0; taxablePart = convTax; }
  const convWF = [];
  let r2 = 0;
  [["From Cash", cashPart, C.blue], ["From Taxable", taxablePart, C.sand]].forEach(([name, val, fill]) => {
    if (val > 0.5) { convWF.push({ name, base: r2, value: Math.round(val), fill, label: kFmt(val) }); r2 += val; }
  });
  convWF.push({ name: "Conversion Tax", base: 0, value: Math.round(convTax), fill: C.terra, label: kFmt(convTax) });

  // ---- Value to heirs (2nd death & +10) with vs without ----
  const lg = withRoth.legacy || {}, lgn = noRoth?.legacy || {};
  const horizon = lg.horizon_years || 10;

  // ---- Illustration 1: internal vs external tax ----
  const taxAmt = convVal * convRate;
  const rothInt0 = Math.max(0, convVal - taxAmt);
  const rothExt0 = convVal;
  const ieSeries = Array.from({ length: years + 1 }, (_, y) => ({
    year: y,
    External: Math.round(rothExt0 * Math.pow(1 + growth, y)),
    Internal: Math.round(rothInt0 * Math.pow(1 + growth, y)),
  }));
  const rothExtEnd = ieSeries[years].External;
  const rothIntEnd = ieSeries[years].Internal;
  const ieDiff = rothExtEnd - rothIntEnd;

  // ---- Illustration 2: realized vs step-up ----
  const realizedCost = Math.round(gain * ltcg);
  const scaledCost = Math.round(embeddedGain * ltcg);

  return (
    <div className="space-y-6">
      {/* Intro */}
      <Card className="p-5 border-[#EBE8E0] shadow-none bg-[#F9F8F6]" data-testid="concepts-intro">
        <div className="flex items-center gap-2 mb-1">
          <Info className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Concepts — the "why" behind the plan</h3>
        </div>
        <p className="text-xs text-muted-foreground max-w-4xl">
          Client-friendly illustrations of the mechanics driving the strategy: where each year's spending is funded from,
          why conversion taxes are paid from outside money, the tax-free-growth prize of paying that tax externally, and why the model
          deliberately protects your taxable-account step-up at death.
        </p>
      </Card>

      {/* Funding waterfalls */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="funding-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-base font-bold tracking-tight">Funding Waterfalls</h3>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Plan year</Label>
            <Select value={String(yr)} onValueChange={(v) => setSelYear(parseInt(v, 10))}>
              <SelectTrigger className="h-9 w-28 bg-[#F9F8F6]" data-testid="funding-year-select"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {rows.map((r) => <SelectItem key={r.year} value={String(r.year)}>{r.year}{r.year === maxConvYear ? " ★" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">
          Year {yr}{yr === maxConvYear ? " (your largest-conversion year ★)" : ""} — income funds spending first, then the withdrawal order
          <span className="font-medium"> Cash → Taxable → IRA → Roth</span>. Conversion tax is funded from external money only.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <p className="label-cap text-muted-foreground text-[10px] mb-2">Spending — where the money comes from</p>
            <Waterfall data={spendWF} testid="spending-waterfall" />
          </div>
          <div>
            <p className="label-cap text-muted-foreground text-[10px] mb-2">Conversion tax — funded externally (never Roth, never IRA proceeds)</p>
            {conversion > 0.5 ? (
              <>
                <Waterfall data={convWF} testid="conversion-tax-waterfall" />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Converting <span className="font-medium text-[#4A6741]">{fmtUSD(conversion)}</span> this year; est. tax
                  <span className="font-medium text-[#C87941]"> {fmtUSD(convTax)}</span> (marginal {fmtPct(row?.marginal_rate)} + state {fmtPct(stateRate)}).
                  Paid from Cash/Taxable — so <span className="font-medium">100% of the conversion lands in the Roth</span>.
                </p>
              </>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-center text-sm text-muted-foreground border border-dashed border-[#EBE8E0] rounded-lg px-6">
                No Roth conversion in {yr}. Pick a conversion year (★ = largest) to see the tax-funding waterfall.
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Value to heirs */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="heir-value-card">
        <div className="flex items-center gap-2 mb-1">
          <Gift className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Value to Heirs — at 2nd Death and +{horizon} Years</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">After-tax value delivered to your heirs, With vs. Without conversions — measured at the second death and again {horizon} years later after the inherited-IRA drawdown.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Big label="At 2nd Death — With" value={fmtUSD(lg.after_tax_estate_at_death)} testid="heir-atdeath-with" />
          <Big label="At 2nd Death — Without" value={fmtUSD(lgn.after_tax_estate_at_death)} tone="neutral" testid="heir-atdeath-no" />
          <Big label={`At +${horizon} Yrs — With`} value={fmtUSD(lg.after_tax_estate_to_heirs)} testid="heir-plus10-with" />
          <Big label={`At +${horizon} Yrs — Without`} value={fmtUSD(lgn.after_tax_estate_to_heirs)} tone="neutral" testid="heir-plus10-no" />
        </div>
      </Card>

      {/* Illustration 1: internal vs external */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="internal-external-card">
        <div className="flex items-center gap-2 mb-1">
          <ArrowLeftRight className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Paying Conversion Tax Internally vs. Externally</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4 max-w-4xl">
          One conversion, two ways to pay the tax. Pay it <span className="font-medium">from the conversion</span> and less reaches the Roth; pay it
          <span className="font-medium"> from outside money</span> and the full amount compounds tax-free. Here's the Roth balance {years} years later.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Conversion amount</Label>
              <Money value={convVal} onChange={setConv} testid="ie-conv" />
              {maxConv > 0 && <button onClick={() => setConv(maxConv)} className="text-[10px] text-[#4A6741] underline mt-1" data-testid="ie-use-plan">Use my plan's largest year ({fmtUSD(maxConv)})</button>}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Conversion tax rate (fed + state)</Label>
              <Pct value={convRate} onChange={setConvRate} testid="ie-rate" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Growth rate / yr</Label>
              <Pct value={growth} onChange={setGrowth} testid="ie-growth" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Horizon (years)</Label>
              <Input type="number" min={1} max={40} value={years} data-testid="ie-years"
                onChange={(e) => setYears(Math.min(40, Math.max(1, parseInt(e.target.value) || 1)))} className="h-9 bg-[#F9F8F6] text-right" />
            </div>
          </div>
          <div className="lg:col-span-2">
            <InternalExternalLines data={ieSeries} testid="ie-chart" />
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Big label={`Roth @ Yr ${years} — External`} value={fmtUSD(rothExtEnd)} testid="ie-external" />
              <Big label={`Roth @ Yr ${years} — Internal`} value={fmtUSD(rothIntEnd)} tone="terra" testid="ie-internal" />
              <Big label="Tax-free advantage" value={`+${fmtUSD(ieDiff)}`} testid="ie-diff" sub="extra tax-free growth from paying the tax externally" />
            </div>
          </div>
        </div>
      </Card>

      {/* Illustration 2: realized vs step-up */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="stepup-card">
        <div className="flex items-center gap-2 mb-1">
          <Landmark className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Realizing Gains in Life vs. the Step-Up at Death</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4 max-w-4xl">
          Long-term gains realized during life are taxed; gains held until death receive a <span className="font-medium">cost-basis step-up</span> and are
          never taxed. That's why the model draws from other buckets first to <span className="font-medium">protect the taxable step-up</span>.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Gain amount</Label>
              <Money value={gain} onChange={setGain} testid="su-gain" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">LTCG + NIIT + state rate</Label>
              <Pct value={ltcg} onChange={setLtcg} testid="su-rate" />
            </div>
            <p className="text-[10px] text-muted-foreground">Your taxable account: <span className="font-medium">{fmtUSD(taxableBal)}</span> with ≈ <span className="font-medium">{fmtUSD(embeddedGain)}</span> embedded gains.</p>
          </div>
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Big label={`Realized in life (${fmtPct(ltcg)})`} value={`−${fmtUSD(realizedCost)}`} tone="terra" testid="su-realized" sub={`${fmtUSD(gain)} of gains taxed`} />
            <Big label="Held to death (step-up)" value="$0" testid="su-stepup" sub="basis resets — gains never taxed" />
            <Big label="Across your whole account" value={`−${fmtUSD(scaledCost)}`} tone="terra" testid="su-scaled" sub={`if all ${fmtUSD(embeddedGain)} embedded gains were realized in life`} />
          </div>
        </div>
      </Card>
    </div>
  );
};
