/**
 * Estate Planning tab — 4-strategy comparison with Roth-first trust funding.
 *
 * Compares Portability-Only / Bypass Trust / QTIP + Bypass / Layered GST-Exempt
 * side by side against the same household balances, presented neutrally.
 * Roth is always routed into any bypass/GST trust FIRST since Roth-in-trust
 * is the uniquely powerful pairing: income-tax free DURING the SECURE Act
 * 10-year distribution window PLUS estate-tax free at every subsequent death
 * PLUS GST-tax free. After the 10-year window the Roth wrapper terminates —
 * see rothTrustCaveat for the trust-tax handoff.
 */
import { ROTH_TRUST_CAVEAT_LONG, TRUSTEE_DISTRIBUTION_NOTE } from "@/lib/rothTrustCaveat";
import { computeCombinedExemptionMetrics, TIER_COLORS } from "@/lib/estateExemptionGauge";
import RothTimelineRibbon from "@/components/estate/RothTimelineRibbon";
import PairwiseWaterfall from "@/components/estate/PairwiseWaterfall";
import DeathPlusTenDetail from "@/components/estate/DeathPlusTenDetail";
import WorkbookSyncReport from "@/components/estate/WorkbookSyncReport";
import FetSensitivityGrid from "@/components/estate/FetSensitivityGrid";
import EstateMcEnvelopeChart from "@/components/estate/EstateMcEnvelopeChart";
import { mcScenarioSig } from "@/lib/mcSignature";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { Landmark, Info, AlertTriangle, ScrollText, Users, Percent, TrendingUp, FileText, Gift } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { runProjection, analyzeEstate, fetchEstateStateMetadata, fmtUSD } from "@/lib/api";
import { toast } from "sonner";

const STORAGE_KEY = "estate_plan_settings_v2";

const STRATEGY_LABELS = {
  portability:   { name: "Portability-Only",     desc: "All to survivor via marital ded; DSUE election. Full basis step-up on Y2." },
  bypass:        { name: "Bypass Trust",         desc: "Credit-shelter trust at Y1 up to fed excl. Bypass escapes Y2. No portability needed." },
  qtip_bypass:   { name: "Bypass + QTIP",        desc: "Bypass at Y1 + QTIP for spouse. Marital control + step-up on QTIP portion." },
  gst_layered:   { name: "Layered GST-Exempt",   desc: "Bypass at Y1 + GST at Y2 with dynasty allocation. Multi-generational." },
};
const STRATEGY_COLORS = {
  portability: "#B8B4A8",
  bypass:      "#7A9B76",
  qtip_bypass: "#4A6741",
  gst_layered: "#2F4A2A",
};
const STRATEGY_ORDER = ["portability","bypass","qtip_bypass","gst_layered"];

// Rebasis modes rendered on the net-to-heirs envelope chart (picker order:
// Deterministic → optimistic → median → pessimistic).
const ENVELOPE_MODES = [
  { mode: "deterministic", label: "Deterministic" },
  { mode: "p75", label: "MC P90 (optimistic)" },
  { mode: "median", label: "MC Median" },
  { mode: "p25", label: "MC P10 (pessimistic)" },
];

const loadSettings = () => { try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } };
const saveSettings = (s) => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} };

const deriveDeathYears = (scenario) => {
  const h = scenario?.household || {};
  const c = (h.client_dob_year && h.client_life_expectancy) ? h.client_dob_year + h.client_life_expectancy : null;
  const s = (h.spouse_dob_year && h.spouse_life_expectancy) ? h.spouse_dob_year + h.spouse_life_expectancy : null;
  const first = (c != null && s != null) ? Math.min(c, s) : (c || s || scenario?.projection?.end_year);
  const second = (c != null && s != null) ? Math.max(c, s) : (c || s || scenario?.projection?.end_year);
  return { first, second };
};

export const Estate = ({ scenario, mcResult = null }) => {
  const [states, setStates] = useState([]);
  const [projectionRows, setProjectionRows] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const initial = loadSettings();
  const [stateCode, setStateCode] = useState(initial.stateCode ?? "");
  // MC rebasis picker — lets the advisor swap the estate model's Y2 basis
  // between the deterministic conversion path and the median/P25/P75 outcomes
  // from the last Monte Carlo run. This closes the reviewer objection that
  // "the estate uses the full $8.989M conversion but MC says the full schedule
  // only completes in 21% of trials". "deterministic" = original behavior;
  // other values shift dollars from Roth back to Traditional at Y2 equal to
  // the missed-conversion delta, grown at the plan return to the Y2 year.
  const [mcRebasis, setMcRebasis] = useState("deterministic");
  // Trust growth rate defaults to the balance-weighted return of the Taxable accounts
  // on Plan Inputs (fall-through 0.06 if no taxable balances). Overridden by any prior
  // saved value from localStorage so advisor customizations survive.
  const [trustGrowthRate, setTrustGrowthRate] = useState(() => {
    if (initial.trustGrowthRate != null) return initial.trustGrowthRate;
    const taxAccts = (scenario?.accounts || []).filter((a) => a.tax_type === "Taxable");
    const totalBal = taxAccts.reduce((s, a) => s + (a.beginning_balance || 0), 0);
    if (totalBal <= 0) return 0.06;
    const weightedRet = taxAccts.reduce((s, a) => s + (a.return || 0) * (a.beginning_balance || 0), 0) / totalBal;
    return weightedRet > 0 ? Math.round(weightedRet * 1000) / 1000 : 0.06;
  });
  const [usePortability, setUsePortability] = useState(initial.usePortability ?? true);
  const [gstFundingOrder, setGstFundingOrder] = useState(initial.gstFundingOrder ?? "roth_first");

  useEffect(() => {
    saveSettings({ stateCode, trustGrowthRate, usePortability, gstFundingOrder });
  }, [stateCode, trustGrowthRate, usePortability, gstFundingOrder]);

  useEffect(() => {
    fetchEstateStateMetadata().then((d) => setStates(d.states || [])).catch(() => setStates([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setBusy(true); setError("");
    runProjection(scenario)
      .then((r) => { if (alive) setProjectionRows(r); })
      .catch((e) => { if (alive) setError(e?.message || "Projection failed."); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [scenario]);

  const y1Balances = useMemo(() => {
    if (!projectionRows?.rows) return null;
    const { first, second } = deriveDeathYears(scenario);
    const row = projectionRows.rows.find((r) => r.year >= first) || projectionRows.rows[projectionRows.rows.length - 1];
    if (!row) return null;
    const y2row = projectionRows.rows.find((r) => r.year >= second) || projectionRows.rows[projectionRows.rows.length - 1];
    // The family home + cash are assumed sold at the surviving spouse's death
    // and reinvested in taxable-like assets. From the estate model's perspective
    // we fold real_estate + cash into the Taxable bucket at Y1 (with full
    // step-up basis at first death) so they compound at the client's taxable
    // account rate from that point forward.
    return {
      roth: row.roth || 0,
      taxable: (row.taxable || 0) + (row.real_estate || 0) + (row.cash || 0),
      traditional: row.traditional || 0,
      year: row.year,
      // Second-death per-class targets from the retirement projection — the
      // engine re-bases every strategy onto these so the Estate analysis shares
      // the same economic base as the EP Projection flowchart.
      y2_roth: y2row?.roth || 0,
      y2_taxable: (y2row?.taxable || 0) + (y2row?.real_estate || 0) + (y2row?.cash || 0),
      y2_traditional: y2row?.traditional || 0,
      y2_year: y2row?.year || null,
    };
  }, [projectionRows, scenario]);

  // Taxable lifetime gifts (§2001(b)) surfaced by the projection — adjusted gifts
  // per decedent + total, used to feed the estate call and the impact callout.
  const giftAdj = useMemo(() => {
    const tg = projectionRows?.giving?.taxable_gifts;
    if (!tg || !(tg.total > 0)) return { total: 0, first: 0, second: 0 };
    return { total: tg.total, first: tg.adjusted_gifts_first_death || 0, second: tg.adjusted_gifts_second_death || 0 };
  }, [projectionRows]);


  // MC rebasis math — see docstring on `mcRebasis`. `rebasisFor(mode)` returns
  // the Y2 balances + diagnostics for ANY picker mode so the active picker and
  // the envelope chart below share the exact same math.
  const rebasisFor = useMemo(() => (mode) => {
    if (mode === "deterministic" || !y1Balances) {
      return { y2_roth: y1Balances?.y2_roth, y2_taxable: y1Balances?.y2_taxable,
               y2_traditional: y1Balances?.y2_traditional, shift: 0, mode: "deterministic",
               planned: null, actual: null };
    }
    const od = mcResult?.outcome_distributions;
    if (!od?.conversions) {
      // MC not run yet — silently fall back to deterministic (no shift).
      return { y2_roth: y1Balances.y2_roth, y2_taxable: y1Balances.y2_taxable,
               y2_traditional: y1Balances.y2_traditional, shift: 0, mode,
               planned: null, actual: null, mc_missing: true };
    }
    const c = od.conversions;
    const percentileKey = mode === "p25" ? "p10"     // conservative = fewest conversions
                       : mode === "p75" ? "p90"     // aggressive   = most conversions
                       : "p50";                     // median default
    const actual = Number(c[percentileKey] ?? c.p50 ?? 0);
    const planned = Number(c.planned_total ?? 0);
    const missed = Math.max(0, planned - actual);  // dollars that stayed in Traditional
    // Grow the missed dollars forward from the conversion window's midpoint to Y2
    // at the plan's Traditional-account return. Approximation — good enough for
    // the estate-level materiality check the reviewer is asking for.
    const window_start = mcResult?.conversion_halt?.conversion_window_start
                      || scenario?.roth?.start_year || (new Date().getFullYear());
    const window_end = mcResult?.conversion_halt?.conversion_window_end
                    || scenario?.roth?.end_year || window_start;
    const midYear = Math.round((window_start + window_end) / 2);
    const y2Year = y1Balances.y2_year || window_end;
    const years_to_grow = Math.max(0, y2Year - midYear);
    // Use Traditional-weighted return if available, else plan default.
    const tradAccts = (scenario?.accounts || []).filter((a) => a.tax_type === "Traditional");
    const totalBal = tradAccts.reduce((s, a) => s + (a.beginning_balance || 0), 0);
    const tradReturn = totalBal > 0
      ? tradAccts.reduce((s, a) => s + (a.return || 0) * (a.beginning_balance || 0), 0) / totalBal
      : 0.06;
    const growth = Math.pow(1 + tradReturn, years_to_grow);
    const shift = missed * growth;
    return {
      y2_roth: Math.max(0, y1Balances.y2_roth - shift),
      y2_taxable: y1Balances.y2_taxable,
      y2_traditional: y1Balances.y2_traditional + shift,
      shift, mode, planned, actual, missed, years_to_grow, tradReturn,
    };
  }, [y1Balances, mcResult, scenario]);
  const mcRebasisApplied = useMemo(() => rebasisFor(mcRebasis), [rebasisFor, mcRebasis]);
  const mcAvailable = !!mcResult?.outcome_distributions?.conversions;
  // Stale detection — the MC stress result snapshots the scenario signature it
  // was run against (see Planner.jsx). Any plan-input change afterwards invalidates it.
  const mcStale = !!(mcResult?._scenarioSig && mcResult._scenarioSig !== mcScenarioSig(scenario));

  // Shared request body for /estate/analyze — the main analysis, the MC envelope
  // chart, and the FET sensitivity grid all build on this same base.
  // BOTH trust and household portions compound at the same client-taxable rate
  // (per user spec 2026-02-12); exclusion indexing ties to the model's CPI.
  const baseRequest = useMemo(() => {
    if (!y1Balances) return null;
    const { first, second } = deriveDeathYears(scenario);
    // 50/50 split of Roth + Taxable between the two spouses (community-property assumption).
    const half_roth = y1Balances.roth / 2;
    const half_taxable = y1Balances.taxable / 2;
    const heirRate = (scenario?.legacy?.heir_federal_rate ?? 0.32) + (scenario?.legacy?.heir_state_rate ?? 0.04);
    return {
      first_death_year: first,
      second_death_year: second,
      deceased_roth_at_y1: half_roth,
      deceased_taxable_at_y1: half_taxable,
      survivor_roth_at_y1: half_roth,
      survivor_taxable_at_y1: half_taxable,
      traditional_at_y1: y1Balances.traditional,
      trust_growth_rate: trustGrowthRate,
      survivor_growth_rate: trustGrowthRate,
      heir_marginal_rate: heirRate,
      state_code: stateCode,
      use_portability: usePortability,
      gst_funding_order: gstFundingOrder,
      indexing_rate: scenario?.projection?.general_inflation ?? 0.03,
      horizons_after_second_death: [0, 10, 20, 30],
    };
  }, [y1Balances, scenario, stateCode, trustGrowthRate, usePortability, gstFundingOrder]);

  useEffect(() => {
    if (!baseRequest) return;
    analyzeEstate({
      ...baseRequest,
      // Re-base onto the retirement projection's actual second-death balances
      // (MC-rebased when the picker is on a Monte Carlo percentile).
      y2_roth: mcRebasisApplied.y2_roth,
      y2_taxable: mcRebasisApplied.y2_taxable,
      y2_traditional: mcRebasisApplied.y2_traditional,
      // §2001(b): lifetime taxable gifts add back into the tentative-tax base
      // (0 when no gifts modeled -> unchanged behavior).
      adjusted_gifts_first_death: giftAdj.first,
      adjusted_gifts_second_death: giftAdj.second,
    })
      .then(setResult)
      .catch((e) => { setError(e?.message || "Estate analysis failed."); toast.error("Estate analysis failed."); });
  }, [baseRequest, mcRebasisApplied, giftAdj]);

  // Gifting impact — "with vs without the lifetime taxable-gifts program". Runs a
  // counterfactual projection with taxable gifts removed and compares the estate
  // tax + net-to-heirs (portability baseline). Only fires when gifts are modeled.
  const [giftImpact, setGiftImpact] = useState(null);
  useEffect(() => {
    if (!baseRequest || !result || !(giftAdj.total > 0)) { setGiftImpact(null); return; }
    let alive = true;
    (async () => {
      try {
        const noGiftScenario = { ...scenario, giving: { ...(scenario.giving || {}), taxable_gifts: [] } };
        const proj = await runProjection(noGiftScenario);
        const { first, second } = deriveDeathYears(scenario);
        const prows = proj.rows || [];
        const y1r = prows.find((r) => r.year >= first) || prows[prows.length - 1] || {};
        const y2r = prows.find((r) => r.year >= second) || prows[prows.length - 1] || {};
        // Rebuild BOTH Y1 and Y2 balances from the counterfactual (no-gift) projection
        // so the two runs share a consistent first-death base (50/50 spousal split).
        const y1Roth = y1r.roth || 0;
        const y1Taxable = (y1r.taxable || 0) + (y1r.real_estate || 0) + (y1r.cash || 0);
        const noGift = await analyzeEstate({
          ...baseRequest,
          deceased_roth_at_y1: y1Roth / 2,
          deceased_taxable_at_y1: y1Taxable / 2,
          survivor_roth_at_y1: y1Roth / 2,
          survivor_taxable_at_y1: y1Taxable / 2,
          traditional_at_y1: y1r.traditional || 0,
          y2_roth: y2r.roth || 0,
          y2_taxable: (y2r.taxable || 0) + (y2r.real_estate || 0) + (y2r.cash || 0),
          y2_traditional: y2r.traditional || 0,
          adjusted_gifts_first_death: 0, adjusted_gifts_second_death: 0,
        });
        if (!alive) return;
        const wp = result.outcomes.portability;
        const np = noGift.outcomes.portability;
        // The family gift pot (after §1015 carryover-basis LTCG) stays in the family
        // and must be added to the WITH-gifting side for an apples-to-apples net-to-heirs.
        const cb = projectionRows?.giving?.carryover_basis;
        const potAfterTax = (cb ? cb.pot_after_tax : projectionRows?.giving?.ending_pot) || 0;
        setGiftImpact({
          withTax: wp.fed_tax + wp.state_tax,
          noTax: np.fed_tax + np.state_tax,
          taxSaved: (np.fed_tax + np.state_tax) - (wp.fed_tax + wp.state_tax),
          withNet: wp.net_to_heirs_at_y2,
          withNetTotal: wp.net_to_heirs_at_y2 + potAfterTax,
          noNet: np.net_to_heirs_at_y2,
          potAfterTax,
          total: giftAdj.total,
          secondYear: result.second_death_year,
        });
      } catch { if (alive) setGiftImpact(null); }
    })();
    return () => { alive = false; };
  }, [baseRequest, result, giftAdj, scenario, projectionRows]);


  // Net-to-heirs envelope — re-run the estate at ALL four rebasis modes so the
  // advisor sees the full range of outcomes without clicking through the picker.
  const [envelope, setEnvelope] = useState(null);
  useEffect(() => {
    if (!baseRequest || !mcAvailable) { setEnvelope(null); return; }
    let alive = true;
    Promise.all(ENVELOPE_MODES.map(({ mode }) => {
      const rb = rebasisFor(mode);
      return analyzeEstate({ ...baseRequest, horizons_after_second_death: [0],
        y2_roth: rb.y2_roth, y2_taxable: rb.y2_taxable, y2_traditional: rb.y2_traditional });
    }))
      .then((results) => {
        if (!alive) return;
        setEnvelope(ENVELOPE_MODES.map((m, i) => ({
          ...m,
          portability: results[i].outcomes.portability.net_to_heirs_at_y2,
          gst_layered: results[i].outcomes.gst_layered.net_to_heirs_at_y2,
        })));
      })
      .catch(() => { if (alive) setEnvelope(null); });
    return () => { alive = false; };
  }, [baseRequest, rebasisFor, mcAvailable]);

  const compareData = useMemo(() => {
    if (!result) return [];
    return STRATEGY_ORDER.map((key) => ({
      strategy: STRATEGY_LABELS[key].name,
      key,
      "Trust value": result.outcomes[key].trust_value_at_y2,
      "Household after tax": result.outcomes[key].household_after_tax_at_y2,
      "Net to heirs": result.outcomes[key].net_to_heirs_at_y2,
    }));
  }, [result]);
  // Headline chart: just the two strategies compared in the header narrative.
  const headlineData = useMemo(() => compareData.filter((d) => d.key === "portability" || d.key === "gst_layered"), [compareData]);

  const chosenState = states.find((s) => s.code === stateCode);
  const winner = result?.winner;
  // Headline comparison: Portability-only (marital ded + DSUE at Y2) vs. Layered
  // GST (Roth-first into GST at both deaths, up to fed exclusion; excess Roth
  // spousal-rolls at Y1 and passes as inherited Roth at Y2).
  const portNet = result ? result.outcomes.portability.net_to_heirs_at_y2 : 0;
  const gstNet  = result ? result.outcomes.gst_layered.net_to_heirs_at_y2 : 0;
  const headlineDelta = gstNet - portNet;

  return (
    <div className="space-y-6" data-testid="estate-panel">
      {/* Verdict header */}
      <Card className="p-6 border-[#EBE8E0] shadow-none">
        <div className="flex items-start gap-3">
          <Landmark className="h-6 w-6 text-[#4A6741] mt-1 shrink-0" />
          <div className="flex-1">
            <h2 className="font-display text-2xl font-bold tracking-tight text-[#1A1A1A]">Estate Planning — GST-Exempt Trust vs. Portability</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              The core question for a couple with a potentially taxable estate:
              <strong> route Roth (and Taxable, if there&apos;s exemption room left) into a GST-exempt trust
              at each death up to the federal estate + GST exemption</strong>, letting excess Roth spousal-roll at
              first death and pass to heirs as inherited Roth at second death — <em>versus</em>
              <strong> leave everything to the surviving spouse via marital deduction</strong> and rely on DSUE portability
              at the second death. Two alternative structures — <em>Bypass Trust</em> (single-death) and{" "}
              <em>Bypass + QTIP</em> (HNW with control/remarriage concerns) — are also modeled for reference.
              Traditional IRA/401(k) is never routed into any trust (see warning below).
            </p>
            {result && (
              <div className="mt-4 rounded-lg border p-4 bg-[#F1F5EF] border-[#4A6741]/30" data-testid="estate-headline-compare">
                <p className="text-xs uppercase tracking-wide text-[#4A6741] font-semibold">Headline comparison at second death (Y{result.second_death_year})</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">A. Portability-Only (marital ded + DSUE)</p>
                    <p className="font-display text-xl font-bold text-[#1A1A1A] tabular-nums" data-testid="estate-headline-a">{fmtUSD(portNet)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">D. Layered GST-Exempt (Roth-first at both deaths)</p>
                    <p className="font-display text-xl font-bold text-[#4A6741] tabular-nums" data-testid="estate-headline-d">{fmtUSD(gstNet)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">GST vs. Portability delta</p>
                    <p className={`font-display text-xl font-bold tabular-nums ${headlineDelta >= 0 ? "text-[#4A6741]" : "text-[#B84A4A]"}`} data-testid="estate-headline-delta">
                      {headlineDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(headlineDelta))}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                  {headlineDelta >= 0
                    ? <>The GST-exempt strategy delivers <strong>{fmtUSD(Math.abs(headlineDelta))} more</strong> to heirs at second death by using both spouses&apos; estate + GST exemptions and sheltering the trust portion from every subsequent generation&apos;s estate tax. Excess Roth at Y1 spousal-rolls into the survivor&apos;s Roth; excess Roth at Y2 passes to heirs as inherited Roth (SECURE 10-yr window).</>
                    : <>Portability alone comes out <strong>{fmtUSD(Math.abs(headlineDelta))} ahead</strong> here — the household is under the combined exemption, so the GST-trust structure adds complexity without a material tax saving. Revisit if the estate grows or if a future statutory change reduces the exclusion.</>}
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Gifting impact — estate tax saved by the lifetime taxable-gifts program */}
      {giftImpact && (
        <Card className="p-5 border shadow-none bg-[#FEFAF1] border-[#8A5A20]/30" data-testid="estate-gift-impact">
          <div className="flex items-start gap-3">
            <Gift className="h-5 w-5 text-[#8A5A20] mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <p className="text-sm font-semibold text-[#8A5A20]">Lifetime taxable-gifts program — estate-tax impact</p>
                <p className="text-xs text-muted-foreground tabular-nums" data-testid="estate-gift-impact-total">
                  {fmtUSD(giftImpact.total)} gifted during life
                </p>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-[11px] text-muted-foreground">Estate + state tax WITHOUT gifting</p>
                  <p className="font-display text-xl font-bold text-[#1A1A1A] tabular-nums" data-testid="estate-gift-impact-notax">{fmtUSD(giftImpact.noTax)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Estate + state tax WITH gifting</p>
                  <p className="font-display text-xl font-bold text-[#1A1A1A] tabular-nums" data-testid="estate-gift-impact-withtax">{fmtUSD(giftImpact.withTax)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Estate tax saved by gifting</p>
                  <p className={`font-display text-xl font-bold tabular-nums ${giftImpact.taxSaved >= 0 ? "text-[#4A6741]" : "text-[#B84A4A]"}`} data-testid="estate-gift-impact-saved">
                    {giftImpact.taxSaved >= 0 ? "+" : "−"}{fmtUSD(Math.abs(giftImpact.taxSaved))}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed" data-testid="estate-gift-impact-narrative">
                Under standard unified §2001(b) mechanics, the gifted principal is added back to the tentative-tax base and the full exclusion + DSUE still shelters it — so gifts <em>within the exclusion add no estate tax</em>. The saving of{" "}
                <strong className={giftImpact.taxSaved >= 0 ? "text-[#4A6741]" : "text-[#B84A4A]"}>{fmtUSD(Math.abs(giftImpact.taxSaved))}</strong>{" "}
                comes from the <strong>future appreciation</strong> on the gifted assets escaping the estate between the gift date and second death (Y{giftImpact.secondYear}). Net-to-heirs at Y{giftImpact.secondYear}: {fmtUSD(giftImpact.noNet)} without → <strong>{fmtUSD(giftImpact.withNetTotal)}</strong> with (the estate delivers {fmtUSD(giftImpact.withNet)} plus the {fmtUSD(giftImpact.potAfterTax)} family gift pot, already net of §1015 carryover-basis capital-gains tax). Gifted assets carry the donor&apos;s cost basis, so heirs forgo the step-up on the embedded gain — the Legacy pages quantify that income-tax trade-off.
              </p>
            </div>
          </div>
        </Card>
      )}


      {/* Combined-exemption gauge — visualize how close the household is to the (fed_excl_y1 + fed_excl_y2) ceiling. */}
      {(() => {
        const g = computeCombinedExemptionMetrics(result);
        if (!g) return null;
        const c = TIER_COLORS[g.tier];
        const capPct = Math.min(150, g.pctDisplay);         // visual cap for the bar
        const overflow = Math.max(0, g.pctDisplay - 100);   // portion above 100%
        return (
          <Card className="p-5 border shadow-none" style={{ background: c.bg, borderColor: c.border }} data-testid="estate-exemption-gauge">
            <div className="flex items-start gap-3">
              <TrendingUp className="h-5 w-5 mt-0.5 shrink-0" style={{ color: c.fg }} />
              <div className="flex-1">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <p className="text-sm font-semibold" style={{ color: c.fg }} data-testid="estate-exemption-headline">{g.headline}</p>
                  <p className="text-xs font-medium tabular-nums" style={{ color: c.fg }} data-testid="estate-exemption-pct">
                    {g.pctDisplay.toFixed(1)}% of combined exemption consumed
                  </p>
                </div>
                {/* Bar: 0–100% shaded by tier color, with a red-overflow band beyond 100% if applicable */}
                <div className="mt-3 relative" data-testid="estate-exemption-bar">
                  <div className="h-3 w-full rounded-full bg-white border" style={{ borderColor: "#EBE8E0" }}>
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${Math.min(100, g.pctDisplay) / 150 * 100}%`,
                      background: c.bar,
                    }} />
                    {overflow > 0 && (
                      <div className="h-3 absolute top-0 rounded-r-full" style={{
                        left: `${100 / 150 * 100}%`,
                        width: `${Math.min(50, overflow) / 150 * 100}%`,
                        background: "#B84A4A",
                      }} />
                    )}
                  </div>
                  {/* Tick markers at 50% / 100% / 150% */}
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>0</span>
                    <span>50%</span>
                    <span style={{ fontWeight: 700, color: "#4A6741" }}>Fed excl Y1 = {fmtUSD(g.y1)}</span>
                    <span style={{ fontWeight: 700, color: "#4A6741" }}>Combined = {fmtUSD(g.combinedAvailable)}</span>
                    <span style={{ color: "#B84A4A" }}>150%+ (fed estate tax zone)</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Household estate at Y{g.secondDeathYear}</p>
                    <p className="font-display text-base font-bold tabular-nums" style={{ color: c.fg }} data-testid="estate-exemption-consumed">{fmtUSD(g.consumed)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Fed excl Y1 + Y2 combined</p>
                    <p className="font-display text-base font-bold tabular-nums text-[#4A6741]" data-testid="estate-exemption-available">{fmtUSD(g.combinedAvailable)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {g.pct >= 1 ? "Estate exposed above ceiling" : "Headroom remaining"}
                    </p>
                    <p className="font-display text-base font-bold tabular-nums"
                      style={{ color: g.pct >= 1 ? "#B84A4A" : "#4A6741" }}
                      data-testid="estate-exemption-headroom">
                      {g.pct >= 1 ? "+" : ""}{fmtUSD(Math.abs(g.consumed - g.combinedAvailable))}
                    </p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed mt-3" style={{ color: "#1A1A1A" }} data-testid="estate-exemption-narrative">
                  {g.narrative}
                </p>
              </div>
            </div>
          </Card>
        );
      })()}

      <Card className="p-5 border-[#EBE8E0] shadow-none bg-[#F1F5EF]" data-testid="estate-gst-portability-note">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-[#8A5A20] mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#4A6741] mb-2">GST exemption is NOT portable — DSUE only covers the estate tax exemption</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              A frequently overlooked asymmetry drives the case for building a bypass/GST trust at the first death
              instead of relying purely on portability. The <strong>estate tax exemption</strong> ($15M in 2026 under OBBBA, chained-CPI
              indexed) IS portable — a timely-filed Form 706 lets the surviving spouse claim the decedent&apos;s unused
              exclusion (DSUE). The <strong>GST exemption</strong>, however, <em>is not portable via DSUE</em>. If the
              first spouse to die leaves everything to the surviving spouse via marital deduction and no GST-exempt
              trust is funded at Y1, that spouse&apos;s <strong>entire GST exemption is not utilized</strong> and
              cannot be recovered later.
              Creating a bypass trust at first death — and allocating the decedent&apos;s GST exemption to it — is the
              standard workaround: the trust becomes a permanently GST-exempt vehicle that shelters every subsequent
              generation&apos;s transfers from the 40% GST tax, and does so <em>on top of</em> the estate tax shelter.
              For families expecting to transfer wealth to grandchildren, preserving both spouses&apos; GST exemptions
              is often more valuable than the estate-tax-only saving reflected in the headline delta above.
            </p>
          </div>
        </div>
      </Card>

      {/* Why Roth-plus-trust works when Traditional-plus-trust fails. */}
      <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-roth-trust-rationale">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-[#4A6741] mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#4A6741] mb-2">Why Roth funds a trust cleanly, and Traditional doesn&apos;t</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              The core problem with trusts as retirement-account beneficiaries was never the trust structure — it&apos;s
              that trusts are terrible at receiving <em>ordinary income</em>. An accumulation trust hits the 37% + 3.8%
              NIIT ceiling at roughly <strong>$16K of retained income</strong>, so a Traditional IRA draining through
              the SECURE-10 window into a trust converts a family&apos;s 24–36% tax problem into a ~41% one. The
              historical workaround — conduit-trust drafting — passes distributions straight out to beneficiaries at
              their individual rates, but the 10-year rule then forces the entire IRA out of the trust within a decade:
              no creditor protection, no divorce protection, no spendthrift control, no GST leverage on those dollars.
              Pre-conversion, families faced a forced choice: <em>tax efficiency (conduit) or asset control
              (accumulation), never both.</em>
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Conversion dissolves the dilemma. A Roth flowing to an accumulation trust still faces the 10-year payout,
              but the distributions <strong>arrive tax-free</strong>, so the compressed trust brackets have nothing to
              bite. The trustee retains and reinvests the full proceeds behind the trust&apos;s protections. The
              subsequent nuance is straightforward: post-distribution ongoing dividends, interest, and realized gains
              inside the trust ARE taxed at trust rates — or carried out annually to beneficiaries via DNI at their
              rates, at the trustee&apos;s discretion. Every dollar converted before death is a dollar that can go to
              the trust with <strong>full control AND full tax efficiency</strong>; every un-converted Traditional
              dollar forces the old bad choice between spousal rollover (deferral but no trust protection, and back into
              the survivor&apos;s estate) and trust funding at punitive compressed rates.
            </p>
            <p className="text-[11px] text-muted-foreground italic mt-2">
              Drafting caveat: the trust must be an <strong>accumulation see-through trust</strong> (not conduit) for
              this strategy to deliver the control benefit, and beneficiary-designation forms at each custodian must
              name the trust with the disclaimer cascade correctly ordered. Get the CFP and estate attorney in the
              same room with the beneficiary forms before finalizing.
            </p>
          </div>
        </div>
      </Card>

      {/* Inputs card */}
      <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-inputs">
        <div className="flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Estate configuration</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">State estate tax</Label>
            <Select value={stateCode || "NONE"} onValueChange={(v) => setStateCode(v === "NONE" ? "" : v)}>
              <SelectTrigger className="mt-1 h-9 bg-[#F9F8F6]" data-testid="estate-state-code">
                <SelectValue placeholder="Federal-only" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Federal-only (no state estate tax)</SelectItem>
                {states.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name} — {fmtUSD(s.exclusion)} @ {(s.top_rate * 100).toFixed(0)}%{s.has_cliff ? " (cliff)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosenState?.note && (
              <p className="text-[10px] text-muted-foreground italic mt-1">{chosenState.note}</p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Trust growth rate</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input type="number" step="0.005" min="0" max="0.15" value={trustGrowthRate}
                onChange={(e) => setTrustGrowthRate(Math.max(0, Math.min(0.15, parseFloat(e.target.value) || 0)))}
                className="h-9 bg-[#F9F8F6]" data-testid="estate-trust-rate" />
              <Percent className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
            <p className="text-[10px] text-muted-foreground italic mt-1">
              Defaults to the balance-weighted return of your Taxable accounts on Plan Inputs.
            </p>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={usePortability} onCheckedChange={setUsePortability} data-testid="estate-portability" />
              <span className="text-xs text-muted-foreground">Elect DSUE portability (Form 706)</span>
            </label>
            <p className="text-[10px] text-muted-foreground italic">
              Heir blended bracket <strong>{(((scenario?.legacy?.heir_federal_rate ?? 0.32) + (scenario?.legacy?.heir_state_rate ?? 0.04)) * 100).toFixed(2)}%</strong> (federal + state) — edit on Plan Inputs.
            </p>
          </div>
        </div>
        {/* Layered-GST funding order — mirrors the EP Flowchart tab's Plan-2 vs Plan-3 knob. */}
        <div className="mt-4 pt-4 border-t border-[#EBE8E0]">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <Label className="text-xs text-muted-foreground">Layered GST — Y1 trust funding order</Label>
              <Select value={gstFundingOrder} onValueChange={setGstFundingOrder}>
                <SelectTrigger className="mt-1 h-9 bg-[#F9F8F6]" data-testid="estate-gst-funding-order">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="roth_first">Roth first, then Taxable (default — preserves 2nd §1014 step-up on Taxable)</SelectItem>
                  <SelectItem value="taxable_first">Taxable first, then Roth (shelters Taxable in trust — forgoes 2nd step-up)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground italic mt-1">
                Applies only to the <strong>Layered GST-Exempt</strong> strategy. Portability, Bypass, and Bypass&nbsp;+&nbsp;QTIP always route Roth first into any Y1 trust.
              </p>
            </div>
            <div className="max-w-[420px] rounded-md border border-[#EBE8E0] bg-[#F9F8F6] p-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-[#1A1A1A]">How the funding order matters.</strong> Roth-first typically ranks higher on
                net-to-heirs — Roth escapes the SECURE 10-year window <em>and</em> Taxable outside the trust receives
                a second §1014 step-up at the survivor&apos;s death. Taxable-first shelters more Taxable dollars from
                estate tax at every subsequent generation but locks in the Y1 funding-date basis on that Taxable slug
                (the second step-up is forgone). Both orders produce identical numbers when the deceased&apos;s Roth+Taxable
                combined fits under the Y1 fed exclusion.
              </p>
            </div>
          </div>
        </div>
        {/* MC-rebasis picker — closes the reviewer objection that the estate model
            assumes the full deterministic Roth conversion completes when Monte
            Carlo says it only does in ~21% of trials. Picking a MC percentile
            shifts dollars from Y2 Roth back to Y2 Traditional equal to the
            "missed conversion" amount, grown to Y2 at the Traditional return. */}
        <div className="mt-4 pt-4 border-t border-[#EBE8E0]" data-testid="estate-mc-rebasis-card">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <Label className="text-xs text-muted-foreground">Rebasis on Monte Carlo conversion outcome</Label>
              <Select value={mcRebasis} onValueChange={setMcRebasis}>
                <SelectTrigger className="mt-1 h-9 bg-[#F9F8F6]" data-testid="estate-mc-rebasis-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deterministic" data-testid="estate-mc-rebasis-det">
                    Deterministic — full conversion schedule completes (default)
                  </SelectItem>
                  <SelectItem value="median" data-testid="estate-mc-rebasis-median">
                    MC Median — only the median trial&apos;s conversions completed
                  </SelectItem>
                  <SelectItem value="p25" data-testid="estate-mc-rebasis-p25">
                    MC P10 (pessimistic) — worst-decile conversion outcome
                  </SelectItem>
                  <SelectItem value="p75" data-testid="estate-mc-rebasis-p75">
                    MC P90 (optimistic) — best-decile conversion outcome
                  </SelectItem>
                </SelectContent>
              </Select>
              {mcStale && mcAvailable && (
                <div className="mt-2 rounded-md border border-[#C87941]/50 bg-[#C87941]/10 px-2.5 py-1.5 flex items-start gap-1.5"
                     data-testid="estate-mc-stale-warning">
                  <AlertTriangle className="h-3.5 w-3.5 text-[#C87941] mt-[1px] shrink-0" />
                  <p className="text-[10px] text-[#8A5A20] leading-snug">
                    <strong>MC outdated</strong> — plan inputs have changed since this Monte Carlo run.
                    Re-run the simulation on the Monte Carlo tab before trusting this rebasis.
                  </p>
                </div>
              )}
              {mcRebasisApplied.mc_missing && mcRebasis !== "deterministic" && (
                <p className="text-[10px] text-[#C87941] italic mt-1">
                  Run a Monte Carlo simulation first to enable MC-based rebasis — currently using deterministic Y2.
                </p>
              )}
              {mcRebasisApplied.mode !== "deterministic" && !mcRebasisApplied.mc_missing && (
                <p className="text-[10px] text-muted-foreground italic mt-1">
                  {fmtUSD(mcRebasisApplied.actual)} of {fmtUSD(mcRebasisApplied.planned)} planned conversions
                  {" "}executed → {fmtUSD(mcRebasisApplied.missed)} stayed in Traditional, grown to Y2 at
                  {" "}{(mcRebasisApplied.tradReturn * 100).toFixed(1)}% for {mcRebasisApplied.years_to_grow} yrs
                  {" "}= <strong>{fmtUSD(mcRebasisApplied.shift)}</strong> shifted from Y2 Roth → Y2 Traditional.
                </p>
              )}
            </div>
            <div className="max-w-[420px] rounded-md border border-[#EBE8E0] bg-[#F9F8F6] p-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-[#1A1A1A]">Why this matters.</strong> The default deterministic view
                assumes the full conversion schedule completes. When halt-on-drawdown is on, MC often shows only
                a fraction actually converts — so the estate&apos;s Roth/Traditional split at second death is
                systematically off. This picker lets you rerun the estate at the MC-median (or P10/P90) conversion
                outcome so the trust vs. outright decision is anchored to what the model expects to actually happen,
                not the deterministic ceiling.
              </p>
            </div>
          </div>
          <EstateMcEnvelopeChart envelope={envelope} stale={mcStale} />
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {busy && !result && <div className="text-sm text-muted-foreground">Running 4-strategy comparison…</div>}

      {result && (
        <>
          {/* Comparison bar chart — headline A vs. D */}
          <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-compare-chart">
            <h3 className="font-display text-base font-bold tracking-tight mb-1">Net-to-heirs at second death — Portability vs. Layered GST</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Stacked bar: <strong>Trust value</strong> (all trust-held assets compound at the client&apos;s
              gross taxable rate under the revised model — ordinary income and appreciated assets are distributed
              to beneficiaries to sidestep the trust&apos;s compressed brackets; the SECURE 10-year Roth window
              simply governs when the Roth wrapper must be fully distributed) + <strong>household after tax</strong>
              (received by heirs at Y{result.second_death_year}, with basis step-up applied where §1014 allows).
            </p>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={headlineData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
                  <XAxis dataKey="strategy" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} width={60} />
                  <Tooltip formatter={(v) => fmtUSD(v)} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Trust value" stackId="a" isAnimationActive={false}>
                    {headlineData.map((d, i) => <Cell key={i} fill={STRATEGY_COLORS[d.key]} />)}
                  </Bar>
                  <Bar dataKey="Household after tax" stackId="a" fill="#C8CBB8" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 italic">
              Alternative structures (Bypass Trust, Bypass + QTIP) are shown in the Strategy detail table below.
            </p>
          </Card>

          {/* 4-column strategy detail table */}
          <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-strategy-detail">
            <h3 className="font-display text-base font-bold tracking-tight mb-3">Strategy detail</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left">
                  <tr className="border-b border-[#EBE8E0]">
                    <th className="px-2 py-2">Metric</th>
                    {STRATEGY_ORDER.map((k) => (
                      <th key={k} className="px-2 py-2 text-right">
                        {STRATEGY_LABELS[k].name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Y2 estate value", get: (o) => o.estate_y2 },
                    { label: "Federal estate tax", get: (o) => o.fed_tax, negative: true },
                    { label: `State estate tax${stateCode ? ` (${stateCode})` : ""}`, get: (o) => o.state_tax, negative: true },
                    { label: "DSUE captured", get: (o) => o.dsue },
                    { label: "Trust value at Y2 (after step-up)", get: (o) => o.trust_value_at_y2, tone: "green" },
                    { label: "Household to heirs (after tax)", get: (o) => o.household_after_tax_at_y2 },
                    { label: "Net to heirs at Y2 (total)", get: (o) => o.net_to_heirs_at_y2, bold: true },
                  ].map((row, ri) => (
                    <tr key={ri} className="border-b border-[#F3F1EC]">
                      <td className="px-2 py-2 text-muted-foreground">{row.label}</td>
                      {STRATEGY_ORDER.map((k) => {
                        const v = row.get(result.outcomes[k]);
                        return (
                          <td key={k} className={`px-2 py-2 text-right tabular-nums ${row.bold ? "font-bold" : ""} ${row.tone === "green" ? "text-[#4A6741]" : ""} ${row.negative && v > 0 ? "text-[#B84A4A]" : ""}`}>
                            {v > 0 || v < 0 ? fmtUSD(v) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* FET sensitivity — 3×3 growth × death-timing grid for the federal estate tax. */}
          <FetSensitivityGrid baseRequest={baseRequest} />

          {/* Roth Timeline Ribbon — Phase C UI: per-strategy SECURE clocks + tax-free window shading. */}
          <RothTimelineRibbon result={result} />

          {/* Pairwise Trade-off Waterfall — Phase D: decompose strategy deltas into 4 drivers. */}
          <PairwiseWaterfall result={result} />

          {/* Multi-generational compounding — all 4 strategies */}
          <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-horizons">
            <h3 className="font-display text-base font-bold tracking-tight mb-1">Multi-generational compounding</h3>
            <p className="text-xs text-muted-foreground mb-3">
              <strong>Trust portions compound at the same rate as the client's Taxable accounts</strong> (see Plan
              Inputs → Accounts). Roth-in-trust runs income-tax free during its SECURE 10-year window (starting at
              the funding death); after year 10 the Roth wrapper terminates and retained trust income <em>would</em>
              be taxed at compressed trust brackets <strong>if</strong> ordinary income and appreciated investments
              are not distributed to beneficiaries. Taxable-in-trust ordinary income and capital gains would bear
              compressed ordinary-income and LTCG/Qualified-Dividend bracket drag from the year assets enter the
              trust — federal tax policy discourages creating trusts to run up lower brackets by adding separate
              taxpayers.
              <br /><br />
              Trust income-tax rate compression is avoided by <strong>distributing ordinary income to
              beneficiaries</strong> on a current basis (taxed at their ordinary rate, not the trust&apos;s 37%) and
              by <strong>distributing appreciated assets to beneficiaries in-kind</strong>, to be sold and capital
              gains realized at the beneficiaries&apos; typically lower rates. Under this hypothetical operating
              model — which assumes an income-tax-favorable distribution pattern — <strong>all assets in trust are
              assumed to grow at the client's Taxable account rate, without deduction for income taxes or capital
              gains</strong>. This includes any residence or cash held by the surviving spouse at his or her death,
              which is assumed to be sold and reinvested in assets similar to those held in the client's Taxable
              investment account. GST / bypass trusts continue to shelter assets from estate + GST tax at every
              subsequent generation, as well as from beneficiary creditors.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left">
                  <tr className="border-b border-[#EBE8E0]">
                    <th className="px-2 py-2">Horizon</th>
                    <th className="px-2 py-2 text-right">Year</th>
                    {STRATEGY_ORDER.map((k) => (
                      <th key={k} className="px-2 py-2 text-right">
                        {STRATEGY_LABELS[k].name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.post_death_horizons.map((h) => (
                    <tr key={h.year} className="border-b border-[#F3F1EC]">
                      <td className="px-2 py-2 font-medium">{h.years_after_second_death === 0 ? "Second death" : `+${h.years_after_second_death}y`}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{h.year}</td>
                      {STRATEGY_ORDER.map((k) => (
                        <td key={k} className="px-2 py-2 text-right tabular-nums">
                          {fmtUSD(h[`${k}_total`])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Distribution schedule assumption — makes the trust operating model
              explicit at a glance so clients understand the model dependency. */}
          <Card className="p-4 border-[#4A6741]/25 shadow-none bg-[#F1F5EF]" data-testid="estate-trust-distribution-note">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-[#4A6741] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#4A6741] mb-1">Distribution schedule assumption</p>
                <p className="text-xs text-[#1A1A1A] leading-relaxed">
                  This projection assumes the trustee <strong>distributes 100% of annual DNI</strong> (ordinary
                  income, dividends, interest) to beneficiaries — taxed at their individual marginal rates, not the
                  trust&apos;s compressed 37% bracket — and <strong>passes appreciated assets in-kind</strong> so
                  heirs realize LTCG on eventual sale at their own capital-gains rate. Under this operating model,
                  the trust corpus compounds at the client&apos;s Taxable-account growth rate (see Plan Inputs)
                  without income-tax drag. Any residence or cash held by the surviving spouse at his or her death
                  is assumed sold and reinvested in similar taxable assets. <em>Actual results will differ if the
                  trust accumulates income or holds appreciated assets past a beneficiary&apos;s life event.</em>
                </p>
              </div>
            </div>
          </Card>

          {/* Death+10 detail — per-heir breakdown + heir-rate sensitivity matrix. */}
          <DeathPlusTenDetail result={result} winner={winner} scenario={scenario} />

          {/* Workbook Sync Report — dollar-for-dollar reconciliation vs uploaded spreadsheet. */}
          <WorkbookSyncReport result={result} />

          {/* Strategy notes */}
          <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-strategy-notes">
            <h3 className="font-display text-base font-bold tracking-tight mb-3">When to use each strategy</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {STRATEGY_ORDER.map((k) => (
                <div key={k} className="rounded-lg border p-3 bg-[#F9F8F6] border-[#EBE8E0]">
                  <p className="text-sm font-semibold" style={{ color: STRATEGY_COLORS[k] }}>{STRATEGY_LABELS[k].name}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{STRATEGY_LABELS[k].desc}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 italic">{result.outcomes[k].notes}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Traditional IRA warning */}
          <Card className="p-5 border-[#C87941]/40 shadow-none bg-[#FEFAF1]" data-testid="estate-trad-ira-warning">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-[#C87941] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#8A5A20] mb-2">Traditional IRA / 401(k) NEVER routed to trusts</p>
                <p className="text-xs text-[#8A5A20] leading-relaxed">
                  From an income-tax standpoint, this is almost never a good idea. Trusts holding pre-tax retirement
                  assets trigger the SECURE Act&apos;s 10-year drawdown and compress income into trust brackets
                  (<strong>37% federal at only ~$16,000 of retained income</strong>). This analysis therefore leaves the
                  household&apos;s <span className="font-semibold">{y1Balances ? fmtUSD(y1Balances.traditional) : "—"}</span>
                  {" "}of Traditional IRA balance with the surviving spouse in every strategy. Heirs will draw down at
                  their assumed <strong>{(((scenario?.legacy?.heir_federal_rate ?? 0.32) + (scenario?.legacy?.heir_state_rate ?? 0.04)) * 100).toFixed(2)}%</strong>
                  {" "}blended (federal + state) marginal rate. <strong>Convert to Roth during life</strong> — the trust benefit only fully materializes
                  when the asset inside is income-tax free through the SECURE 10-year distribution window (which is why
                  Roth is routed FIRST to every bypass/GST trust here). After the 10-year window, retained trust income
                  is taxed at compressed trust rates regardless of the wrapper.
                </p>
              </div>
            </div>
          </Card>

          {/* Trustee planning note — compressed trust brackets favor distributions */}
          <Card className="p-5 border-[#EBE8E0] shadow-none bg-[#F1F5EF]" data-testid="estate-trustee-note">
            <div className="flex items-start gap-3">
              <Users className="h-5 w-5 text-[#4A6741] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#4A6741] mb-2">Trustee planning note — compressed brackets favor distributions</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {TRUSTEE_DISTRIBUTION_NOTE}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-2">
                  In practice: trustee reviews annually with the beneficiaries&apos; tax advisors to (a) carry out DNI
                  on dividends, interest, and other ordinary items, (b) generally <strong>retain</strong> capital gains
                  inside the trust — the 20% vs. 15% LTCG spread is a small toll compared with the protection and
                  compounding benefits of keeping the corpus intact — and (c) distribute appreciated assets in-kind
                  only when a beneficiary&apos;s immediate need justifies breaking the trust&apos;s shelter. <em>Due to a
                  Trust&apos;s compressed income tax brackets, it is generally advisable not to let ordinary income
                  accumulate inside the Trust past year-end. However, this is subject to the circumstances of the
                  beneficiary which must be separately considered in light of the Grantor&apos;s intentions as expressed
                  in the governing instrument.</em>
                </p>
              </div>
            </div>
          </Card>

          {/* Legal caveat */}
          <Card className="p-5 border-[#EBE8E0] shadow-none bg-[#FAFAF8]" data-testid="estate-legal-caveat">
            <div className="flex items-start gap-3">
              <ScrollText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong>Legal caveat:</strong> This analysis models the math of estate/GST tax leverage under current law
                (OBBBA-permanent brackets, chained-CPI indexing, $15M federal exclusion per person for 2026). It does not draft trust documents, elect a GST allocation
                on Form 706 Schedule R, evaluate the interaction between state law variations, community-property titling,
                Rule Against Perpetuities, or the specific accumulation-vs.-conduit structure of any trust.
                <strong> You must consult a qualified estate-planning attorney</strong> before implementing any of these strategies.
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default Estate;
