import { useMemo } from "react";
import { Wand2, Award, Download, Printer, Gift, HelpCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { downloadCSV, fmtUSD, fmtPct } from "@/lib/api";
import { LegacyHorizonChart, ConvertCompareChart } from "@/components/ProjectionCharts";

export const BRACKETS = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

const metricColor = (accent, warn) => {
  if (accent) return "text-[#4A6741]";
  if (warn) return "text-[#C87941]";
  return "text-[#1A1A1A]";
};

export const ProjectionControls = ({ scenario, update, rmdAge, targetIdx }) => {
  const r = scenario.roth;
  const keyAccounts = useMemo(
    () => scenario.accounts
      .map((a, idx) => ({ ...a, idx }))
      .filter((a) => ["Tax-Deferred", "Taxable", "Cash"].includes(a.tax_type)),
    [scenario.accounts]
  );
  return (
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

        <div>
          <Label className="text-xs text-muted-foreground">Max Annual Conversion ($, 0 = no cap)</Label>
          <Input type="number" step={10000} value={r.max_annual ?? 0} data-testid="max-annual-conversion"
            onChange={(e) => update("roth.max_annual", parseFloat(e.target.value) || 0)} className="mt-1 bg-[#F9F8F6]" />
          <p className="text-[10px] text-muted-foreground mt-1">Hard dollar cap per year, on top of the bracket ceiling above.</p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Limit Conversions by IRMAA Tier</Label>
          <Select value={r.irmaa_tier_cap == null ? "None" : String(r.irmaa_tier_cap)}
            onValueChange={(v) => update("roth.irmaa_tier_cap", v === "None" ? null : parseInt(v, 10))}>
            <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="irmaa-cap-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="None">No IRMAA cap</SelectItem>
              <SelectItem value="0">Avoid all surcharges (base tier)</SelectItem>
              <SelectItem value="1">Stay ≤ IRMAA Tier 1</SelectItem>
              <SelectItem value="2">Stay ≤ IRMAA Tier 2</SelectItem>
              <SelectItem value="3">Stay ≤ IRMAA Tier 3</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1">Caps conversions so MAGI stays within the chosen Medicare/IRMAA tier. Surcharges apply on a hard-coded 2-year MAGI lookback.</p>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-sm">Stop at RMD age ({rmdAge})</Label>
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
          <div className="mt-3">
            <Label className="text-xs text-muted-foreground">Reinvest Surplus Income To</Label>
            <Select value={scenario.withdrawal?.surplus_sweep_to || "Taxable"}
              onValueChange={(v) => update("withdrawal.surplus_sweep_to", v)}>
              <SelectTrigger className="mt-1 bg-[#F9F8F6]" data-testid="surplus-sweep-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Taxable">Taxable brokerage (gross return)</SelectItem>
                <SelectItem value="Cash">Cash (cash rate)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">Leftover income/dividends reinvested here; taxable compounds at the gross return with added basis.</p>
          </div>
        </div>

        <div className="pt-2 border-t border-[#EBE8E0]">
          <p className="label-cap text-muted-foreground mb-3">Key Balances</p>
          {keyAccounts.map((a) => (
            <div key={a.id} className="mb-3">
              <Label className="text-xs text-muted-foreground">{a.name}</Label>
              <Input type="number" step={10000} value={a.beginning_balance} data-testid={`acct-${a.id}`}
                onChange={(e) => update(`accounts.${a.idx}.beginning_balance`, +e.target.value)} className="mt-1 bg-[#F9F8F6]" />
            </div>
          ))}
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
  );
};

export const SweepPanel = ({ sweep, sweeping, findOptimal, withRoth }) => (
  <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4 bg-white" data-testid="sweep-card">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-[#4A6741]" />
        <h3 className="font-display text-base font-bold tracking-tight">Find the Best Single-Bracket Strategy</h3>
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
        <div className="flex items-center gap-2 mb-3 text-sm flex-wrap">
          <Award className="h-4 w-4 text-[#C87941]" />
          <span className="font-semibold">Optimal:</span>
          <span data-testid="optimal-result" className="font-display font-bold text-[#4A6741]">{sweep.best.label}</span>
          <span className="text-muted-foreground">→ {fmtUSD(sweep.best.after_tax_estate)} to heirs · {fmtUSD(sweep.best.lifetime_taxes)} lifetime tax</span>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Why this may differ from the Strategy Optimizer" data-testid="sweep-winner-why"
                  className="inline-flex items-center gap-1 rounded-full border border-[#4A6741]/30 bg-white px-2 py-0.5 text-[10px] font-medium text-[#4A6741] hover:bg-[#4A6741]/10">
                  <HelpCircle className="h-3 w-3" /> Why?
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs bg-[#1A1A1A] text-white text-[11px] leading-snug px-3 py-2">
                This picks the best <span className="font-semibold">single flat bracket</span> held constant every year of your
                current start-to-end window. The <span className="font-semibold">Strategy Optimizer</span> tab searches a wider space —
                time-varying phased schedules (e.g. 32% pre-SS then 22% after) and narrower conversion windows — so its winner may differ.
                Both rank by the same metric: highest after-tax to heirs, tiebreak lowest lifetime tax.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
);

export const YearTable = ({ rows }) => (
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
        {rows.map((row) => (
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
);

export const LegacyPanels = ({ legacy, legacyNo, heirDelta, postCompare, targetIdx }) => {
  const targetPct = (BRACKETS[targetIdx] * 100).toFixed(0);
  const horizon = legacy?.horizon_years || 10;
  return (
    <>
      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="legacy-card">
        <div className="flex items-center gap-2 mb-4">
          <Gift className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Legacy & Estate — {horizon}-Year SECURE Horizon After 2nd Death</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-4xl">
          Headline value is projected <span className="font-medium">{horizon} years after the second death</span>: the inherited Roth keeps compounding <span className="font-medium">tax-free</span>, while the inherited Traditional IRA must be fully drawn down within 10 years and is taxed to heirs at {fmtPct(legacy?.heir_ordinary_rate)} (after-tax proceeds reinvested). Taxable &amp; home received a basis step-up at death.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <EstateMetric label="After-Tax at Death" value={fmtUSD(legacy?.after_tax_estate_at_death)} testid="estate-at-death" />
          <EstateMetric label={`Inherited IRA Tax (${horizon}-yr)`} value={`−${fmtUSD(legacy?.inherited_ira_tax)}`} warn testid="estate-ira-tax" />
          <EstateMetric label={`Tax-Free Roth @ Yr ${horizon}`} value={fmtUSD(legacy?.tax_free_roth_to_heirs)} accent testid="estate-roth" />
          <EstateMetric label="Gross Estate at Death" value={fmtUSD(legacy?.gross_estate)} testid="estate-gross" />
          <EstateMetric label={`After-Tax to Heirs @ Yr ${horizon}`} value={fmtUSD(legacy?.after_tax_estate_to_heirs)} accent big testid="estate-after-tax" />
        </div>
        <LegacyHorizonChart rows={legacy?.post_death_rows} />
      </Card>

      <HeirComparePanel legacy={legacy} legacyNo={legacyNo} horizon={horizon} />

      <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="convert-compare-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h3 className="font-display text-base font-bold tracking-tight">Convert vs. Don&apos;t — Heir Value Over {horizon} Years Post-Death</h3>
          <div className={`rounded-full px-4 py-1.5 text-sm font-medium ${heirDelta >= 0 ? "bg-[#4A6741]/10 text-[#4A6741]" : "bg-[#C87941]/10 text-[#C87941]"}`} data-testid="heir-advantage-badge">
            {heirDelta >= 0 ? "Converting helps heirs by " : "Converting costs heirs "}{fmtUSD(Math.abs(heirDelta))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-4xl">
          After-tax value delivered to heirs for the <span className="font-medium">selected {targetPct}% bracket strategy</span> vs. doing no conversions — solid = total estate, dashed = the tax-free Roth portion. When the lines nearly overlap, conversions add little for heirs.
        </p>
        <ConvertCompareChart data={postCompare} targetPct={targetPct} />
      </Card>
    </>
  );
};

const EstateMetric = ({ label, value, accent, warn, big, testid }) => (
  <div className={`rounded-lg border p-4 ${big ? "border-[#4A6741]/30 bg-[#4A6741]/5" : "border-[#EBE8E0] bg-white"}`}>
    <p className="label-cap text-muted-foreground text-[10px] mb-1">{label}</p>
    <p data-testid={testid} className={`font-display ${big ? "text-2xl" : "text-lg"} font-bold ${metricColor(accent, warn)}`}>{value}</p>
  </div>
);

export const HeirComparePanel = ({ legacy, legacyNo, horizon }) => {
  const inhW = legacy?.after_tax_estate_to_heirs ?? 0;
  const inhN = legacyNo?.after_tax_estate_to_heirs ?? 0;
  const inhDelta = inhW - inhN;                       // more to heirs when > 0
  const taxW = legacy?.inherited_ira_tax ?? 0;
  const taxN = legacyNo?.inherited_ira_tax ?? 0;
  const taxSaved = taxN - taxW;                       // heirs save tax when > 0
  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none lg:col-span-4" data-testid="heir-compare-card">
      <div className="flex items-center gap-2 mb-1">
        <Gift className="h-4 w-4 text-[#4A6741]" />
        <h3 className="font-display text-base font-bold tracking-tight">To Heirs at 2nd Death + {horizon} Years — With vs. Without Conversions</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-5 max-w-4xl">
        The after-tax inheritance delivered to your heirs, and the income tax they pay drawing down the inherited
        Traditional IRA, projected {horizon} years after the second death — comparing your Roth conversion plan against doing none.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right border-b border-[#EBE8E0] text-muted-foreground text-xs">
              <th className="text-left py-2">Metric (2nd death + {horizon} yrs)</th>
              <th className="px-3">With Conversions</th>
              <th className="px-3">Without Conversions</th>
              <th className="px-3">Difference</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="text-right border-b border-[#F3F1EC]">
              <td className="text-left py-3 font-medium">Ending inheritance to heirs</td>
              <td className="px-3 text-[#4A6741] font-semibold" data-testid="heir-inherit-with">{fmtUSD(inhW)}</td>
              <td className="px-3" data-testid="heir-inherit-no">{fmtUSD(inhN)}</td>
              <td className={`px-3 font-semibold ${inhDelta >= 0 ? "text-[#4A6741]" : "text-[#C87941]"}`} data-testid="heir-inherit-delta">
                {inhDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(inhDelta))}
              </td>
            </tr>
            <tr className="text-right">
              <td className="text-left py-3 font-medium">Heir income tax on inherited IRA</td>
              <td className="px-3 text-[#C87941] font-semibold" data-testid="heir-tax-with">{fmtUSD(taxW)}</td>
              <td className="px-3 text-[#C87941]" data-testid="heir-tax-no">{fmtUSD(taxN)}</td>
              <td className={`px-3 font-semibold ${taxSaved >= 0 ? "text-[#4A6741]" : "text-[#C87941]"}`} data-testid="heir-tax-savings">
                {taxSaved >= 0 ? "−" : "+"}{fmtUSD(Math.abs(taxSaved))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
        <div className="rounded-lg border border-[#4A6741]/30 bg-[#4A6741]/5 p-4" data-testid="heir-inherit-callout">
          <p className="label-cap text-[#4A6741] text-[10px] mb-1">Extra inheritance from converting</p>
          <p className={`font-display text-2xl font-bold ${inhDelta >= 0 ? "text-[#4A6741]" : "text-[#C87941]"}`}>
            {inhDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(inhDelta))}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{inhDelta >= 0 ? "more to heirs vs. no conversions" : "less to heirs vs. no conversions"}</p>
        </div>
        <div className="rounded-lg border border-[#C87941]/30 bg-[#C87941]/5 p-4" data-testid="heir-tax-callout">
          <p className="label-cap text-[#C87941] text-[10px] mb-1">Heir tax {taxSaved >= 0 ? "saved" : "added"} by converting</p>
          <p className={`font-display text-2xl font-bold ${taxSaved >= 0 ? "text-[#4A6741]" : "text-[#C87941]"}`}>
            {taxSaved >= 0 ? "−" : "+"}{fmtUSD(Math.abs(taxSaved))}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{taxSaved >= 0 ? "less income tax on the inherited IRA" : "more income tax on the inherited IRA"}</p>
        </div>
      </div>
    </Card>
  );
};
