import { useEffect, useMemo, useState, useCallback } from "react";
import {
  GitCompareArrows, Loader2, TrendingUp, Landmark, Receipt, Users, Dices, Sparkles, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend,
  AreaChart, Area, BarChart, Bar,
} from "recharts";
import { runProjection, runMonteCarlo, fmtUSD, fmtPct } from "@/lib/api";
import { StrategyBadge } from "@/components/StrategyBadge";
import { MarketBadge, useMarketPresets, getActivePreset } from "@/components/MarketScenarioSelector";
import { getStrategyLabel } from "@/lib/strategyLabel";
import { loadBeneficiaries, beneficiaryWeightedRate } from "./clientReport/helpers";
import { WidowTaxTrapWeb } from "@/components/WidowTaxTrap";

// ============================================================================
// ConvertCompare — dedicated side-by-side "Convert vs Don't-Convert" view.
// Runs the active scenario twice (with + without Roth conversions), then
// stacks the two outcomes across wealth, taxes, balances, MC success, and
// legacy on a single screen so clients don't have to toggle plans to compare.
// (Different from the existing Compare tab, which lets advisors pick 2-3
// SAVED scenarios and compare their metrics.)
// ============================================================================
export const ConvertCompare = ({ scenario }) => {
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);
  const [mcWith, setMcWith] = useState(null);
  const [mcNo, setMcNo] = useState(null);
  const [mcRunning, setMcRunning] = useState(false);
  const [heirFedOverride, setHeirFedOverride] = useState(null);
  const [heirStateOverride, setHeirStateOverride] = useState(null);

  // Read shared beneficiaries state (set on Client Report tab) — same localStorage key.
  // Re-load whenever the user comes back to this tab (window focus).
  const [beneficiaries, setBeneficiaries] = useState(loadBeneficiaries);
  useEffect(() => {
    const refresh = () => setBeneficiaries(loadBeneficiaries());
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Effective heir rate: single-input override wins, else beneficiary-weighted, else scenario default.
  const weightedBene = beneficiaryWeightedRate(beneficiaries);
  const effectiveHeirFed = heirFedOverride ?? (weightedBene ? weightedBene.fed : null);
  const effectiveHeirState = heirStateOverride ?? (weightedBene ? weightedBene.state : null);
  const effectiveHeirTotal = (effectiveHeirFed ?? scenario?.legacy?.heir_federal_rate ?? 0.3165)
                           + (effectiveHeirState ?? scenario?.legacy?.heir_state_rate ?? 0);

  const overrideScenario = useMemo(() => {
    if (effectiveHeirFed == null && effectiveHeirState == null) return scenario;
    const c = JSON.parse(JSON.stringify(scenario));
    c.legacy = c.legacy || {};
    if (effectiveHeirFed != null) c.legacy.heir_federal_rate = effectiveHeirFed;
    if (effectiveHeirState != null) c.legacy.heir_state_rate = effectiveHeirState;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(scenario), effectiveHeirFed, effectiveHeirState]);

  const sig = JSON.stringify(overrideScenario);
  const marketPresets = useMarketPresets();
  const marketPreset = getActivePreset(scenario, marketPresets);
  const strat = getStrategyLabel(scenario);

  useEffect(() => {
    let alive = true;
    setWithRoth(null); setNoRoth(null);
    const t = setTimeout(() => {
      const noCfg = JSON.parse(JSON.stringify(overrideScenario));
      noCfg.roth = { ...(noCfg.roth || {}), enabled: false };
      Promise.all([runProjection(overrideScenario), runProjection(noCfg)])
        .then(([a, b]) => {
          if (!alive) return;
          setWithRoth(a); setNoRoth(b);
        })
        .catch(() => { if (alive) toast.error("Projection failed. Try reloading."); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const runMcBoth = useCallback(() => {
    if (mcRunning) return;
    setMcRunning(true);
    setMcWith(null); setMcNo(null);
    const noCfg = JSON.parse(JSON.stringify(overrideScenario));
    noCfg.roth = { ...(noCfg.roth || {}), enabled: false };
    Promise.all([
      runMonteCarlo(overrideScenario, { n_trials: 400, engine: "historical", anchor_to_plan: true }),
      runMonteCarlo(noCfg, { n_trials: 400, engine: "historical", anchor_to_plan: true }),
    ])
      .then(([a, b]) => { setMcWith(a); setMcNo(b); })
      .catch(() => toast.error("Monte Carlo failed."))
      .finally(() => setMcRunning(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const notReady = !withRoth || !noRoth;

  const wealthSeries = useMemo(() => {
    if (notReady) return [];
    const wr = withRoth.rows, nr = noRoth.rows;
    return wr.map((r, i) => ({
      year: r.year,
      convert: (r.cash || 0) + (r.taxable || 0) + (r.traditional || 0) + (r.roth || 0) + (r.real_estate || 0),
      noConvert: nr[i]
        ? (nr[i].cash || 0) + (nr[i].taxable || 0) + (nr[i].traditional || 0) + (nr[i].roth || 0) + (nr[i].real_estate || 0)
        : 0,
    }));
  }, [withRoth, noRoth, notReady]);

  const taxSeries = useMemo(() => {
    if (notReady) return [];
    const wr = withRoth.rows, nr = noRoth.rows;
    return wr.map((r, i) => ({
      year: r.year,
      convert: r.cashflow?.income_tax || 0,
      noConvert: nr[i]?.cashflow?.income_tax || 0,
    }));
  }, [withRoth, noRoth, notReady]);

  const balancesConvert = useMemo(() => (withRoth?.rows || []).map((r) => ({
    year: r.year, Cash: r.cash || 0, Taxable: r.taxable || 0, Traditional: r.traditional || 0, Roth: r.roth || 0,
  })), [withRoth]);

  const balancesNoConvert = useMemo(() => (noRoth?.rows || []).map((r) => ({
    year: r.year, Cash: r.cash || 0, Taxable: r.taxable || 0, Traditional: r.traditional || 0, Roth: r.roth || 0,
  })), [noRoth]);

  const s = withRoth?.summary || {};
  const sn = noRoth?.summary || {};
  const lg = withRoth?.legacy || {};
  const lgn = noRoth?.legacy || {};
  const wEndNW = withRoth?.rows?.length ? (() => {
    const r = withRoth.rows.at(-1);
    return (r.cash || 0) + (r.taxable || 0) + (r.traditional || 0) + (r.roth || 0) + (r.real_estate || 0);
  })() : 0;
  const nEndNW = noRoth?.rows?.length ? (() => {
    const r = noRoth.rows.at(-1);
    return (r.cash || 0) + (r.taxable || 0) + (r.traditional || 0) + (r.roth || 0) + (r.real_estate || 0);
  })() : 0;

  const legacyDelta = (lg.after_tax_estate_to_heirs || 0) - (lgn.after_tax_estate_to_heirs || 0);
  const taxDelta = (sn.lifetime_taxes || 0) - (s.lifetime_taxes || 0);
  const familyTaxWith = (s.lifetime_taxes || 0) + (lg.inherited_ira_tax || 0);
  const familyTaxWithout = (sn.lifetime_taxes || 0) + (lgn.inherited_ira_tax || 0);
  const familyTaxDelta = familyTaxWithout - familyTaxWith;

  const verdictWins = legacyDelta >= 0;

  return (
    <div className="space-y-6" data-testid="convert-compare-root">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StrategyBadge scenario={scenario} testid="convert-compare-strategy-badge" />
        <MarketBadge scenario={scenario} testid="convert-compare-market-badge" />
      </div>

      <div className="rounded-xl border border-[#EBE8E0] bg-[#F9F8F6] p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
            <GitCompareArrows className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-display text-base font-bold tracking-tight text-[#1A1A1A]">
              Convert vs Don&apos;t Convert — Side by Side
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 max-w-3xl leading-relaxed">
              Runs your active scenario ({strat.label}{marketPreset ? ` · ${marketPreset.label}` : ""}) twice — with the current
              conversion plan (<strong className="text-[#4A6741]">Convert</strong>) and with all Roth conversions turned off
              (<strong className="text-[#C87941]">Don&apos;t Convert</strong>) — and shows both outcomes side by side across wealth,
              taxes, account balances, Monte Carlo, and legacy.
            </p>
          </div>
        </div>
      </div>

      {/* Heir tax rate override — sensitivity-test the verdict live */}
      <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-4" data-testid="cc-heir-rate-card">
        <div className="flex items-start gap-3 mb-3">
          <Users className="h-4 w-4 text-[#4A6741] mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1A1A1A]">Heir tax rate — sensitivity-test the verdict live</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Override the heirs&apos; expected marginal bracket during the 10-year post-death window and the projections
              + verdict below refresh instantly.
              {weightedBene && !heirFedOverride && !heirStateOverride && " Currently using the beneficiary-weighted average set on the Client Report tab."}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-[11px] label-cap">Heir federal marginal rate</Label>
            <Input data-testid="cc-input-heir-fed" type="number" step="0.01" min="0" max="0.5"
              value={heirFedOverride == null ? "" : heirFedOverride}
              onChange={(e) => {
                const v = e.target.value;
                setHeirFedOverride(v === "" ? null : Math.max(0, Math.min(0.5, parseFloat(v))));
              }}
              placeholder={String(
                weightedBene ? weightedBene.fed.toFixed(4)
                             : (scenario?.legacy?.heir_federal_rate ?? 0.3165)
              )}
              className="h-9 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-[11px] label-cap">Heir state marginal rate</Label>
            <Input data-testid="cc-input-heir-state" type="number" step="0.01" min="0" max="0.15"
              value={heirStateOverride == null ? "" : heirStateOverride}
              onChange={(e) => {
                const v = e.target.value;
                setHeirStateOverride(v === "" ? null : Math.max(0, Math.min(0.15, parseFloat(v))));
              }}
              placeholder={String(
                weightedBene ? weightedBene.state.toFixed(4)
                             : (scenario?.legacy?.heir_state_rate ?? 0)
              )}
              className="h-9 text-sm mt-1" />
          </div>
          <div className="flex items-end">
            <Button size="sm" variant="outline"
              onClick={() => { setHeirFedOverride(null); setHeirStateOverride(null); }}
              data-testid="cc-reset-heir-rates"
              className="h-9 text-xs w-full">
              <RotateCcw className="h-3 w-3 mr-1" /> Reset
            </Button>
          </div>
          <div className="flex items-end">
            <div className="w-full rounded-md border border-[#4A6741]/30 bg-[#4A6741]/5 px-3 py-2">
              <div className="text-[9px] uppercase tracking-wider text-[#4A6741] font-semibold">Effective</div>
              <div className="font-display text-[15px] font-bold text-[#4A6741]" data-testid="cc-effective-heir-rate">
                {fmtPct(effectiveHeirTotal)}
              </div>
            </div>
          </div>
        </div>
        {beneficiaries.length > 0 && (
          <p className="text-[10.5px] text-muted-foreground mt-2" data-testid="cc-beneficiary-note">
            {beneficiaries.length} beneficiary/ies loaded from Client Report:{" "}
            {beneficiaries.map((b, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <strong>{b.name || `#${i+1}`}</strong> ({b.share_pct}% @ {fmtPct(b.fed_rate + b.state_rate)})
              </span>
            ))}
          </p>
        )}
      </div>
      {notReady ? (
        <div className="rounded-xl border border-[#EBE8E0] bg-white p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Running both projections…
        </div>
      ) : (
        <div
          data-testid="convert-compare-verdict"
          className={`rounded-xl border p-5 ${
            verdictWins
              ? "bg-[#4A6741]/8 border-[#4A6741]/40"
              : "bg-[#C87941]/8 border-[#C87941]/40"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${verdictWins ? "bg-[#4A6741]" : "bg-[#C87941]"}`}>
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <p className={`text-lg font-display font-bold ${verdictWins ? "text-[#4A6741]" : "text-[#C87941]"}`}>
                {verdictWins
                  ? `Converting delivers ${fmtUSD(legacyDelta)} more to heirs`
                  : `Skipping conversions is better here by ${fmtUSD(Math.abs(legacyDelta))}`}
              </p>
              <p className={`text-[12px] text-[#5A5A5A] mt-1 leading-relaxed`}>
                Across the full plan horizon at the effective heir marginal rate of{" "}
                <strong>{fmtPct(effectiveHeirTotal)}</strong>
                {weightedBene && " (from beneficiaries table)"}
                {heirFedOverride != null || heirStateOverride != null ? " (manual override)" : ""}
                .
                {verdictWins
                  ? ` The family also pays ${fmtUSD(Math.abs(familyTaxDelta))} ${familyTaxDelta >= 0 ? "less" : "more"} in total tax across parents + heirs.`
                  : " Consider lower conversion amounts, a lower target bracket, or waiting until the heir's income drops."}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3" data-testid="convert-compare-kpi-grid">
        <CompareKpi
          label="Ending Net Worth"
          icon={<TrendingUp className="h-3 w-3" />}
          a={fmtUSD(wEndNW)}
          b={fmtUSD(nEndNW)}
          delta={wEndNW - nEndNW}
          winnerIsA={wEndNW >= nEndNW}
        />
        <CompareKpi
          label="Lifetime Tax (parents)"
          icon={<Receipt className="h-3 w-3" />}
          a={fmtUSD(s.lifetime_taxes)}
          b={fmtUSD(sn.lifetime_taxes)}
          delta={taxDelta}
          winnerIsA={(s.lifetime_taxes || 0) <= (sn.lifetime_taxes || 0)}
          deltaLabel="tax saved"
        />
        <CompareKpi
          label="After-Tax Legacy"
          icon={<Users className="h-3 w-3" />}
          a={fmtUSD(lg.after_tax_estate_to_heirs)}
          b={fmtUSD(lgn.after_tax_estate_to_heirs)}
          delta={legacyDelta}
          winnerIsA={legacyDelta >= 0}
        />
        <CompareKpi
          label="Total Family Tax"
          icon={<Landmark className="h-3 w-3" />}
          a={fmtUSD(familyTaxWith)}
          b={fmtUSD(familyTaxWithout)}
          delta={familyTaxDelta}
          winnerIsA={familyTaxWith <= familyTaxWithout}
          deltaLabel="tax saved"
        />
      </div>

      <TwoMilestoneCard
        lg={lg} lgn={lgn}
        wEndNW={wEndNW} nEndNW={nEndNW}
        secondDeathYear={withRoth?.rows?.length ? withRoth.rows.at(-1).year : null}
      />

      <div className="rounded-xl border border-[#EBE8E0] bg-white p-4" data-testid="convert-compare-wealth-chart">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-semibold text-[#1A1A1A]">Household wealth over time</p>
          <p className="text-[11px] text-muted-foreground">Total investable + home equity</p>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={wealthSeries} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} width={48} tickLine={false} />
              <Tooltip formatter={(v) => fmtUSD(v)} />
              <Line type="monotone" dataKey="convert" stroke="#4A6741" strokeWidth={2.4} dot={false} isAnimationActive={false} name="Convert" />
              <Line type="monotone" dataKey="noConvert" stroke="#C87941" strokeWidth={2.4} strokeDasharray="6 4" dot={false} isAnimationActive={false} name="Don't Convert" />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 10 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="convert-compare-balances">
        <BalancesPanel title="Convert — account balances" data={balancesConvert} accent="#4A6741" testid="cc-bal-convert" />
        <BalancesPanel title="Don't Convert — account balances" data={balancesNoConvert} accent="#C87941" testid="cc-bal-noconvert" />
      </div>

      <div className="rounded-xl border border-[#EBE8E0] bg-white p-4" data-testid="convert-compare-tax-chart">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-semibold text-[#1A1A1A]">Annual income tax — Convert vs Don&apos;t Convert</p>
          <p className="text-[11px] text-muted-foreground">Federal + state + IRMAA (excludes heir SECURE-10 tax)</p>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={taxSeries} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={48} tickLine={false} />
              <Tooltip formatter={(v) => fmtUSD(v)} />
              <Bar dataKey="convert" fill="#4A6741" name="Convert" isAnimationActive={false} />
              <Bar dataKey="noConvert" fill="#C87941" name="Don't Convert" isAnimationActive={false} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10.5px] text-muted-foreground mt-1 italic">
          Notice the early-year tax spike under Convert — that&apos;s the conversion tax bill. It buys later-year
          tax reduction (smaller RMDs, more Roth income) and the SECURE-10 tax savings the heirs enjoy.
        </p>
      </div>

      <div className="rounded-xl border border-[#EBE8E0] bg-white p-4" data-testid="convert-compare-mc-panel">
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-center gap-2">
            <Dices className="h-4 w-4 text-[#4A6741]" />
            <p className="text-sm font-semibold text-[#1A1A1A]">Monte Carlo — Both Strategies</p>
          </div>
          <Button
            size="sm"
            onClick={runMcBoth}
            disabled={mcRunning || notReady}
            data-testid="convert-compare-mc-run"
            className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white h-8 text-xs"
          >
            {mcRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {mcRunning ? "Running…" : "Run Monte Carlo for both"}
          </Button>
        </div>
        {(!mcWith || !mcNo) ? (
          <p className="text-[11.5px] text-muted-foreground italic">
            400 historical-bootstrap trials per strategy. Click <em>Run Monte Carlo for both</em> above (≈15 seconds).
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="convert-compare-mc-results">
            <McPanel title="Convert" res={mcWith} accent="#4A6741" testid="cc-mc-convert" />
            <McPanel title="Don't Convert" res={mcNo} accent="#C87941" testid="cc-mc-noconvert" />
          </div>
        )}
      </div>

      {/* Widow tax trap — powered by the projection's filing_status field */}
      <WidowTaxTrapWeb rows={withRoth?.rows} testid="cc-widow-trap" />
    </div>
  );
};

// ---- Sub-components ----
/**
 * TwoMilestoneCard — the two moments that actually matter, side by side.
 *
 * Advisors kept asking "is this number at the second death or after the heirs'
 * ten years?" Both are now modeled explicitly, with the bridge between them:
 *
 *   Net worth at 2nd death (portfolio + real estate, before any heir tax)
 *     − estate settlement cost, − embedded income tax on the inherited IRA
 *   = after-tax estate at the 2nd death
 *     ± growth and heir income tax across the SECURE Act 10-year window
 *   = net worth in the heirs' hands at the end of the window
 */
const MilestoneRow = ({ label, a, b, sub, bold, negative, testid }) => {
  const delta = (a || 0) - (b || 0);
  return (
    <tr className={`border-b border-[#F3F1EC] ${bold ? "font-semibold" : ""}`} data-testid={testid}>
      <td className="py-1.5 pr-2 text-[12px] text-[#2A2A2A]">
        {negative ? "− " : ""}{label}
        {sub && <span className="block text-[10px] text-muted-foreground font-normal">{sub}</span>}
      </td>
      <td className="py-1.5 px-2 text-right text-[12px] tabular-nums text-[#4A6741]">{fmtUSD(a)}</td>
      <td className="py-1.5 px-2 text-right text-[12px] tabular-nums text-[#C87941]">{fmtUSD(b)}</td>
      <td className={`py-1.5 pl-2 text-right text-[12px] tabular-nums ${delta >= 0 ? "text-[#4A6741]" : "text-[#C87941]"}`}>
        {delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(delta))}
      </td>
    </tr>
  );
};

const TwoMilestoneCard = ({ lg, lgn, wEndNW, nEndNW, secondDeathYear }) => {
  const horizon = lg?.horizon_years ?? 10;
  const windowEnd = secondDeathYear ? secondDeathYear + horizon : null;
  // Use the legacy block's own gross estate so the bridge reconciles to the penny
  // (it is the same last-row net worth, real estate included).
  const grossW = lg?.gross_estate ?? wEndNW;
  const grossN = lgn?.gross_estate ?? nEndNW;
  // Income tax embedded in the estate AT the second death — i.e. what the heirs
  // would owe if the inherited IRA were distributed immediately. This is smaller
  // than the tax they actually pay across the window, because the IRA keeps
  // growing until it is drained.
  const embeddedW = (grossW || 0) - (lg?.estate_settlement || 0) - (lg?.after_tax_estate_at_death || 0);
  const embeddedN = (grossN || 0) - (lgn?.estate_settlement || 0) - (lgn?.after_tax_estate_at_death || 0);
  const growthWith = (lg?.after_tax_estate_to_heirs || 0) - (lg?.after_tax_estate_at_death || 0);
  const growthNo = (lgn?.after_tax_estate_to_heirs || 0) - (lgn?.after_tax_estate_at_death || 0);
  return (
    <div className="rounded-xl border border-[#EBE8E0] bg-white p-5" data-testid="convert-compare-milestones">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <p className="text-sm font-semibold text-[#1A1A1A]">Two milestones: second death, then the end of the SECURE-10 window</p>
        <p className="text-[11px] text-muted-foreground">
          {secondDeathYear ? `2nd death ${secondDeathYear}` : "2nd death"}
          {windowEnd ? ` → window ends ${windowEnd}` : ""}
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed mb-3 max-w-4xl">
        The first milestone is what the household owns the moment the second spouse dies — before the heirs owe a
        dollar of income tax. The second is what is actually left in the heirs&apos; hands once the inherited
        Traditional IRA has been drained over the SECURE Act&apos;s {horizon}-year window and the remaining assets
        have compounded. A conversion strategy can lead on one milestone and trail on the other, which is why both
        are shown.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] p-3" data-testid="convert-compare-milestone-death">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Net worth at 2nd death{secondDeathYear ? ` (${secondDeathYear})` : ""} — pre-heir tax
          </p>
          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
            <span className="font-display text-lg font-bold text-[#4A6741] tabular-nums">{fmtUSD(grossW)}</span>
            <span className="text-[11px] text-muted-foreground">convert</span>
            <span className="font-display text-lg font-bold text-[#C87941] tabular-nums">{fmtUSD(grossN)}</span>
            <span className="text-[11px] text-muted-foreground">don&apos;t convert</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Investable balances + real estate. Roth dollars here are already tax-paid; Traditional dollars are not.
          </p>
        </div>
        <div className="rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] p-3" data-testid="convert-compare-milestone-window">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Net worth at end of SECURE-10{windowEnd ? ` (${windowEnd})` : ""} — after heir tax
          </p>
          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
            <span className="font-display text-lg font-bold text-[#4A6741] tabular-nums">{fmtUSD(lg?.after_tax_estate_to_heirs)}</span>
            <span className="text-[11px] text-muted-foreground">convert</span>
            <span className="font-display text-lg font-bold text-[#C87941] tabular-nums">{fmtUSD(lgn?.after_tax_estate_to_heirs)}</span>
            <span className="text-[11px] text-muted-foreground">don&apos;t convert</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Heirs&apos; assumed combined ordinary rate {fmtPct(lg?.heir_ordinary_rate)} on inherited IRA
            distributions; remaining assets compound at the heir reinvestment assumption.
          </p>
        </div>
      </div>

      <table className="w-full border-collapse" data-testid="convert-compare-milestone-bridge">
        <thead>
          <tr className="border-b-2 border-[#4A6741] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1.5 pr-2 font-semibold">Bridge between the two milestones</th>
            <th className="py-1.5 px-2 text-right font-semibold">Convert</th>
            <th className="py-1.5 px-2 text-right font-semibold">Don&apos;t convert</th>
            <th className="py-1.5 pl-2 text-right font-semibold">Δ</th>
          </tr>
        </thead>
        <tbody>
          <MilestoneRow testid="milestone-row-gross" label="Net worth at 2nd death (pre-heir tax)"
            a={grossW} b={grossN} bold />
          <MilestoneRow testid="milestone-row-settlement" label="Estate settlement cost" negative
            a={lg?.estate_settlement} b={lgn?.estate_settlement}
            sub="Administration / final expenses modeled at the settlement rate" />
          <MilestoneRow testid="milestone-row-embedded-tax" label="Income tax embedded in the inherited IRA at death"
            negative a={embeddedW} b={embeddedN}
            sub="What the heirs would owe if the pre-tax balance were distributed immediately" />
          <MilestoneRow testid="milestone-row-at-death" label="After-tax estate at the 2nd death" bold
            a={lg?.after_tax_estate_at_death} b={lgn?.after_tax_estate_at_death}
            sub="What the heirs would net if the window closed immediately" />
          <MilestoneRow testid="milestone-row-growth" label={`Growth in the heirs' hands over ${horizon} years`}
            a={growthWith} b={growthNo}
            sub="Net of heir income tax on inherited-IRA distributions" />
          <MilestoneRow testid="milestone-row-end-window" label="Net worth at end of the SECURE-10 window" bold
            a={lg?.after_tax_estate_to_heirs} b={lgn?.after_tax_estate_to_heirs} />
        </tbody>
      </table>
      <p className="text-[10px] text-muted-foreground mt-2 italic">
        Nominal dollars, no discounting — see the Client Report for present-value versions. Across the window the
        heirs actually pay {fmtUSD(lgn?.inherited_ira_tax)} of income tax without conversions
        ({fmtUSD(lg?.inherited_ira_tax)} with them) — more than the amount embedded at death above, because the
        inherited IRA keeps growing until it is fully distributed. That extra tax is already netted out of the
        growth row.
      </p>
    </div>
  );
};

const CompareKpi = ({ label, icon, a, b, delta, winnerIsA, deltaLabel = "advantage" }) => {
  const better = winnerIsA;
  const deltaColor = better ? "text-[#4A6741]" : "text-[#C87941]";
  return (
    <div className="rounded-xl border border-[#EBE8E0] bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#5A5A5A] font-semibold mb-2">
        {icon}{label}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className={`rounded-md px-2 py-1.5 ${better ? "bg-[#4A6741]/8 border border-[#4A6741]/30" : "bg-white border border-[#EBE8E0]"}`}>
          <div className="text-[9px] font-semibold text-[#4A6741] uppercase tracking-wide">Convert</div>
          <div className="font-display text-[13px] font-bold text-[#1A1A1A]">{a}</div>
        </div>
        <div className={`rounded-md px-2 py-1.5 ${!better ? "bg-[#C87941]/8 border border-[#C87941]/30" : "bg-white border border-[#EBE8E0]"}`}>
          <div className="text-[9px] font-semibold text-[#C87941] uppercase tracking-wide">Don&apos;t Convert</div>
          <div className="font-display text-[13px] font-bold text-[#1A1A1A]">{b}</div>
        </div>
      </div>
      <div className={`text-[10.5px] font-semibold mt-2 ${deltaColor}`}>
        Δ {fmtUSD(Math.abs(delta))} {deltaLabel}
      </div>
    </div>
  );
};

const BalancesPanel = ({ title, data, accent, testid }) => (
  <div className="rounded-xl border border-[#EBE8E0] bg-white p-4" data-testid={testid}>
    <p className="text-sm font-semibold mb-2" style={{ color: accent }}>{title}</p>
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
          <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
          <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} width={44} tickLine={false} />
          <Tooltip formatter={(v) => fmtUSD(v)} />
          <Area type="monotone" dataKey="Cash" stackId="1" stroke="#B8B4A8" fill="#B8B4A8" isAnimationActive={false} />
          <Area type="monotone" dataKey="Taxable" stackId="1" stroke="#C4A64A" fill="#C4A64A" isAnimationActive={false} />
          <Area type="monotone" dataKey="Traditional" stackId="1" stroke="#C87941" fill="#C87941" isAnimationActive={false} />
          <Area type="monotone" dataKey="Roth" stackId="1" stroke="#4A6741" fill="#4A6741" isAnimationActive={false} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 9 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

const McPanel = ({ title, res, accent, testid }) => {
  const wc = res?.with_conversions;
  const success = wc?.success;
  const succPct = success != null ? Math.round(success * 100) : null;
  const pctData = useMemo(() => {
    if (!wc?.percentiles || !res?.years) return [];
    return res.years.map((y, i) => ({
      year: y,
      p10: wc.percentiles.p10?.[i] || 0,
      p50: wc.percentiles.p50?.[i] || 0,
      p90: wc.percentiles.p90?.[i] || 0,
    }));
  }, [wc, res]);

  return (
    <div className="rounded-lg border border-[#EBE8E0] bg-[#FAFAF8] p-3" data-testid={testid}>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[13px] font-semibold" style={{ color: accent }}>{title}</p>
        <p className="font-display text-lg font-bold" style={{ color: accent }}>{succPct}% success</p>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={pctData} margin={{ top: 2, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 8 }} tickLine={false} />
            <YAxis tick={{ fontSize: 8 }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} width={42} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Area type="monotone" dataKey="p90" stroke={accent} fill={accent} fillOpacity={0.15} isAnimationActive={false} name="Top 10%" />
            <Area type="monotone" dataKey="p50" stroke={accent} fill={accent} fillOpacity={0.35} isAnimationActive={false} name="Median" />
            <Area type="monotone" dataKey="p10" stroke="#B8B4A8" fill="#B8B4A8" fillOpacity={0.3} isAnimationActive={false} name="Bottom 10%" />
            <Legend iconSize={7} wrapperStyle={{ fontSize: 8 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-3 gap-1.5 mt-1.5 text-[9px]">
        <div className="text-center">
          <div className="text-[8px] uppercase tracking-wide text-[#5A5A5A]">P10 end</div>
          <div className="font-semibold">{fmtUSD(wc?.ending?.p10)}</div>
        </div>
        <div className="text-center">
          <div className="text-[8px] uppercase tracking-wide text-[#5A5A5A]">Median</div>
          <div className="font-semibold">{fmtUSD(wc?.ending?.p50)}</div>
        </div>
        <div className="text-center">
          <div className="text-[8px] uppercase tracking-wide text-[#5A5A5A]">P90 end</div>
          <div className="font-semibold">{fmtUSD(wc?.ending?.p90)}</div>
        </div>
      </div>
    </div>
  );
};

export default ConvertCompare;
