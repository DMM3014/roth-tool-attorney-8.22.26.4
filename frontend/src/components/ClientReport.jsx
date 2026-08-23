import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Printer, FileText, User, Building2, Mail, Save, Loader2, Sparkles, RotateCcw,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  API, authHeaders, runProjection, runMonteCarlo, runRegimeCompare, runEpFlowchart, runHeirRateSensitivity,
  runSequenceStress, listScenarios, fmtPct, fmtUSD, allocationToAssets, compareFundingOrders, getLawConstants,
} from "@/lib/api";
import { downloadElementAsPdf } from "@/lib/pdf";
import { downloadElementAsDocx } from "@/lib/docx";
import { StrategyBadge } from "@/components/StrategyBadge";
import { getStrategyLabel } from "@/lib/strategyLabel";
import { MarketBadge, useMarketPresets, getActivePreset } from "@/components/MarketScenarioSelector";
import { PlanControlStrip } from "@/components/PlanControlStrip";
import { useAdvisorLogo } from "@/lib/advisorLogo";
import { useAdvisorInfo } from "@/lib/advisorInfo";

import {
  defaultBranding, loadBranding, saveBranding, AI_TEXT_KEY, suggestMilestoneYear,
} from "./clientReport/helpers";
import { CoverPage } from "./clientReport/CoverPage";
import { CoverLetterPage } from "./clientReport/CoverLetterPage";
import { AssumptionsPage } from "./clientReport/AssumptionsPage";
import { OverviewPage } from "./clientReport/OverviewPage";
import { ConvertSkipPage } from "./clientReport/ConvertSkipPage";
import { ObjectivesPage } from "./clientReport/ObjectivesPage";
import { AppendixDividerPage } from "./clientReport/AppendixDividerPage";
import ObjectivesEditor from "./ObjectivesEditor";
import { makePv } from "@/lib/pv";
import { mcScenarioSig } from "@/lib/mcSignature";
import { useFlowPlans } from "@/hooks/useFlowPlans";
import { useObjectivesPage } from "@/hooks/useObjectivesPage";
import { RothConversionsPage } from "./clientReport/RothConversionsPage";
import { FundingOrderPage } from "./clientReport/FundingOrderPage";
import { StatutoryFiguresPage } from "./clientReport/StatutoryFiguresPage";
import { SavingsPage } from "./clientReport/SavingsPage";
import { InputsAppendixPage } from "./clientReport/InputsAppendixPage";
import { IncomeExpensesPage } from "./clientReport/IncomeExpensesPage";
import { CashFlowPage } from "./clientReport/CashFlowPage";
import { TaxesPage } from "./clientReport/TaxesPage";
import { BracketSnapshotsPage } from "./clientReport/BracketSnapshotsPage";
import { MonteCarloReportPage } from "./clientReport/MonteCarloPage";
import { PairedMcPage } from "./clientReport/PairedMcPage";
import { RegimeCompareReportPage } from "./clientReport/RegimeComparePage";
import { LegacyPage } from "./clientReport/LegacyPage";
import { HeirRateSensitivityPage } from "./clientReport/HeirRateSensitivityPage";
import { BasisStepUpPage } from "./clientReport/BasisStepUpPage";
import { EpFlowchartPage, EpFlowchartComparePage, EpFlowchartCombinedComparePage } from "./clientReport/EpFlowchartPage";
import { SensitivityPage } from "./clientReport/SensitivityPage";
import { MonteCarloBehaviorCard } from "./clientReport/MonteCarloBehaviorCard";
import { SequenceRiskPage } from "./clientReport/SequenceRiskPage";
import { useSeqParams } from "@/hooks/useSeqParams";
import { ReportCustomizationCard } from "./clientReport/ReportCustomizationCard";
import { useSharedGuardrail } from "@/hooks/useSharedGuardrail";
import { useSharedHalt } from "@/hooks/useSharedHalt";

// ============================================================================
// Retirement & Wealth-Transfer Illustration — Attorney Edition — top-level orchestrator
// Handles data fetching (2 projections + Monte Carlo + AI review streaming) and
// composes the individual page components under ./clientReport/ into a single
// print/PDF-optimized document.
// ============================================================================

export const ClientReport = ({ scenario, setScenario }) => {
  const [branding, setBranding] = useState(loadBranding);
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);
  const [mcResult, setMcResult] = useState(null);
  const [mcRunning, setMcRunning] = useState(false);
  // Behavioral MC toggles — persist across sessions so advisors don't retoggle each login.
  // The conversion-halt rule and the spending guardrail are BOTH shared with the
  // Monte Carlo tab (`useSharedHalt` / `useSharedGuardrail`), so a change on
  // either surface propagates live (same-tab custom event + cross-tab storage
  // event) and the printed report can never be run on a different behavioral
  // rule than the one the advisor is looking at.
  const { haltOn, setHaltOn, haltDrop, setHaltDrop, haltResume, setHaltResume } = useSharedHalt();
  const { grOn, setGrOn, grCut, setGrCut } = useSharedGuardrail();
  // Sequence-of-returns page — same inputs as the Sequence Risk tab (shared store),
  // so the printed table always matches what the advisor configured there.
  const { seqParams, seqSig } = useSeqParams();
  const [seqOn, setSeqOn] = useState(() => {
    try { return window.localStorage.getItem("client_report_seq_v1") === "1"; } catch { return false; }
  });
  const [seqData, setSeqData] = useState(null);
  const [seqRunning, setSeqRunning] = useState(false);
  useEffect(() => {
    try { window.localStorage.setItem("client_report_seq_v1", seqOn ? "1" : "0"); } catch { /* ignore */ }
  }, [seqOn]);
  // Regime comparison — new print page (opt-in via toolbar toggle).
  const [regimeOn, setRegimeOn] = useState(() => {
    try { return window.localStorage.getItem("client_report_regime_v1") === "1"; } catch { return false; }
  });
  const [regimeData, setRegimeData] = useState(null);
  const [regimeRunning, setRegimeRunning] = useState(false);
  useEffect(() => { try { window.localStorage.setItem("client_report_regime_v1", regimeOn ? "1" : "0"); } catch {} }, [regimeOn]);
  const [downloading, setDownloading] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [logo] = useAdvisorLogo();
  const [advisorInfo] = useAdvisorInfo();
  // Merge advisor-level fields (name, firm, email, phone) into the branding
  // object consumed by the report pages. Report-level fields (client override,
  // subtitle, intro, date, confidentiality) still live in `branding`.
  const brandingWithAdvisor = { ...branding, ...advisorInfo };
  const [aiText, setAiText] = useState(() => {
    try { return window.localStorage.getItem(AI_TEXT_KEY) || ""; } catch { return ""; }
  });
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiError, setAiError] = useState("");

  // Custom milestone years for the Income & Expenses milestone table.
  // Persisted on the SCENARIO (`scenario.custom_milestones`) so the list travels
  // with a shared plan across advisors and machines. Uses the scenario as the
  // SINGLE SOURCE OF TRUTH — no local state, no two-way sync — to avoid render
  // loops. On first mount only, if the scenario has no milestones but a legacy
  // localStorage cache exists, migrate them into the scenario.
  const customMilestones = Array.isArray(scenario?.custom_milestones)
    ? scenario.custom_milestones : [];
  const setCustomMilestones = useCallback((next) => {
    if (!setScenario) return;
    const clean = (next || [])
      .filter((m) => m && (m.name || (m.year != null && m.year !== "")))
      .slice(0, 3);
    setScenario((s) => ({ ...s, custom_milestones: clean }));
    try { window.localStorage.setItem("client_report_milestones_v1", JSON.stringify(clean)); } catch {}
  }, [setScenario]);
  // One-time legacy localStorage migration: only runs when scenario is empty on
  // first mount AND the scenario doesn't have a `custom_milestones` KEY at all
  // (undefined, not just empty array). This distinguishes "fresh scenario, may
  // want to migrate" from "user explicitly reset, don't rehydrate stale cache".
  const migratedMilestonesRef = useRef(false);
  useEffect(() => {
    if (migratedMilestonesRef.current) return;
    if (!setScenario) return;
    if (customMilestones.length > 0) { migratedMilestonesRef.current = true; return; }
    // If the scenario has an explicit empty array, respect that (user reset).
    if (Array.isArray(scenario?.custom_milestones)) {
      migratedMilestonesRef.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem("client_report_milestones_v1");
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) {
        migratedMilestonesRef.current = true;
        setScenario((s) => ({ ...s, custom_milestones: parsed.slice(0, 3) }));
      } else {
        migratedMilestonesRef.current = true;
      }
    } catch { migratedMilestonesRef.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setScenario]);
  // Legacy-page PV discount rate slider — null means "use scenario's general_inflation".
  const [pvRateOverride, setPvRateOverride] = useState(() => {
    try {
      const raw = window.localStorage.getItem("client_report_pv_rate_v1");
      const v = raw ? parseFloat(raw) : NaN;
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  });
  useEffect(() => {
    try {
      if (pvRateOverride == null) window.localStorage.removeItem("client_report_pv_rate_v1");
      else window.localStorage.setItem("client_report_pv_rate_v1", String(pvRateOverride));
    } catch {}
  }, [pvRateOverride]);
  // State-exclusion map for the Client Report state-taxable chart. Kept as a per-browser
  // toolbar preference (not stored on the scenario) so advisors can experiment without
  // mutating the plan. Falls back to scenario.state_exclusions when localStorage is empty,
  // then to the CA-ish default (SS exempt, pension & RMDs taxable).
  const [stateExclusions, setStateExclusions] = useState(() => {
    try {
      const raw = window.localStorage.getItem("client_report_state_exclusions_v1");
      if (raw) return JSON.parse(raw);
    } catch {}
    return scenario?.state_exclusions || { ss: true, pension: false, rmds: false };
  });
  useEffect(() => {
    try { window.localStorage.setItem("client_report_state_exclusions_v1", JSON.stringify(stateExclusions)); } catch {}
  }, [stateExclusions]);

  // Basis Step-Up print page — same toggle pattern.
  const [basisOn, setBasisOn] = useState(() => {
    try { const raw = window.localStorage.getItem("client_report_basis_on_v1"); return raw ? JSON.parse(raw) : false; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("client_report_basis_on_v1", JSON.stringify(basisOn)); } catch {}
  }, [basisOn]);

  // Scenario signature for tracking changes
  const sig = mcScenarioSig(scenario);
  const mcSig = `${haltOn}|${haltDrop}|${haltResume}|${grOn}|${grCut}`;

  // Funding Order — The Hidden Lever page. Defaults ON. Compares the configured
  // plan under all three withdrawal orders (conversions unchanged).
  const [fundingOrderOn, setFundingOrderOn] = useState(() => {
    try { const raw = window.localStorage.getItem("client_report_funding_order_v1");
          return raw == null ? true : raw === "1"; } catch { return true; }
  });
  useEffect(() => { try { window.localStorage.setItem("client_report_funding_order_v1", fundingOrderOn ? "1" : "0"); } catch {} }, [fundingOrderOn]);
  const [fundingOrderData, setFundingOrderData] = useState(null);
  const [fundingOrderRunning, setFundingOrderRunning] = useState(false);
  useEffect(() => {
    if (!fundingOrderOn || !withRoth) { setFundingOrderData(null); return; }
    let alive = true;
    setFundingOrderRunning(true);
    compareFundingOrders(scenario, [
      "Cash → Taxable → IRA → Roth", "Cash → IRA → Taxable → Roth", "Split IRA & Taxable",
    ])
      .then((d) => { if (alive) setFundingOrderData(d); })
      .catch(() => { if (alive) { setFundingOrderData(null); toast.error("Funding order comparison failed."); } })
      .finally(() => { if (alive) setFundingOrderRunning(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, fundingOrderOn, withRoth]);

  // Statutory Figures & Authorities appendix — OPTIONAL, defaults OFF.
  const [statutoryOn, setStatutoryOn] = useState(() => {
    try { const raw = window.localStorage.getItem("client_report_statutory_v1");
          return raw == null ? false : raw === "1"; } catch { return false; }
  });
  useEffect(() => { try { window.localStorage.setItem("client_report_statutory_v1", statutoryOn ? "1" : "0"); } catch {} }, [statutoryOn]);
  const [lawData, setLawData] = useState(null);
  useEffect(() => {
    let alive = true;
    getLawConstants().then((d) => { if (alive) setLawData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Paired A/B (Roth vs no-conversions on identical seeds) print page —
  // defaults ON because the per-trial delta is the cleanest single-slide
  // argument for the strategy.
  const [pairedOn, setPairedOn] = useState(() => {
    try { const raw = window.localStorage.getItem("client_report_paired_mc_v1");
          return raw == null ? true : raw === "1"; } catch { return true; }
  });
  useEffect(() => { try { window.localStorage.setItem("client_report_paired_mc_v1", pairedOn ? "1" : "0"); } catch {} }, [pairedOn]);

  // Client Inputs appendix — defaults ON per advisor request. Snapshots every
  // scenario input at the back of the report so clients can trace any figure
  // back to what was assumed. Toggle-off keeps the appendix out of PDF/DOCX.
  const [inputsOn, setInputsOn] = useState(() => {
    try { const raw = window.localStorage.getItem("client_report_inputs_appendix_v1");
          return raw == null ? true : raw === "1"; } catch { return true; }
  });
  useEffect(() => { try { window.localStorage.setItem("client_report_inputs_appendix_v1", inputsOn ? "1" : "0"); } catch {} }, [inputsOn]);

  // Tax-bracket snapshot page (bucket diagrams at the first conversion year, the
  // year RMDs begin, and the final conversion year) — ON by default per advisor
  // request; toggle off to keep it out of the client PDF/DOCX.
  const [bracketOn, setBracketOn] = useState(() => {
    try { const raw = window.localStorage.getItem("client_report_bracket_snapshots_v1");
          return raw == null ? true : raw === "1"; } catch { return true; }
  });
  useEffect(() => { try { window.localStorage.setItem("client_report_bracket_snapshots_v1", bracketOn ? "1" : "0"); } catch {} }, [bracketOn]);

  // EP Projection flowchart pages — master toggle + per-plan selection + comparison page.
  const [flowOn, setFlowOn] = useState(() => {
    try { const raw = window.localStorage.getItem("client_report_flow_on_v1"); return raw ? JSON.parse(raw) : false; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("client_report_flow_on_v1", JSON.stringify(flowOn)); } catch {}
  }, [flowOn]);
  const { flowPlans, setFlowPlans } = useFlowPlans();
  const { objectivesOn } = useObjectivesPage();
  const [flowCompareOn, setFlowCompareOn] = useState(() => {
    try { const raw = window.localStorage.getItem("client_report_flow_compare_v1"); return raw ? JSON.parse(raw) : true; } catch { return true; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("client_report_flow_compare_v1", JSON.stringify(flowCompareOn)); } catch {}
  }, [flowCompareOn]);
  const [flowResult, setFlowResult] = useState(null);
  // Scenario comparison for the EP Flowchart pages (paired current-vs-saved deltas).
  const [flowScenarioCompareId, setFlowScenarioCompareId] = useState(() => {
    try { return window.localStorage.getItem("client_report_flow_scenario_compare_id_v1") || ""; }
    catch { return ""; }
  });
  useEffect(() => {
    try {
      if (flowScenarioCompareId) window.localStorage.setItem("client_report_flow_scenario_compare_id_v1", flowScenarioCompareId);
      else window.localStorage.removeItem("client_report_flow_scenario_compare_id_v1");
    } catch { /* ignore */ }
  }, [flowScenarioCompareId]);
  const [flowCompareResult, setFlowCompareResult] = useState(null);
  const [flowCompareLabel, setFlowCompareLabel] = useState("");
  // Single-variable sensitivity runs (schedule-only / funding-only / returns-only)
  // derived from the comparison scenario — feeds the Sensitivity print page.
  const [sensitivityData, setSensitivityData] = useState(null);

  const upd = (k, v) => setBranding((b) => ({ ...b, [k]: v }));
  const persistBranding = () => { saveBranding(branding); toast.success("Client Report settings saved."); };

  // Track the sig+mcSig that produced the CURRENT mcResult so the UI can prompt
  // the advisor to rerun when the projection or behavioral rules have changed
  // since the last successful run (e.g. their auto-rerun failed silently, or
  // they haven't opened the Client Report tab since editing Plan Inputs).
  const [mcResultSig, setMcResultSig] = useState(null);
  const mcStale = mcResult && mcResultSig !== `${sig}||${mcSig}`;

  useEffect(() => {
    let alive = true;
    setWithRoth(null); setNoRoth(null);
    const t = setTimeout(() => {
      const tasks = [runProjection(scenario)];
      const noCfg = JSON.parse(JSON.stringify(scenario));
      noCfg.roth = { ...(noCfg.roth || {}), enabled: false };
      tasks.push(runProjection(noCfg));
      Promise.all(tasks).then(([a, b]) => {
        if (!alive) return;
        setWithRoth(a); setNoRoth(b);
      }).catch(() => { if (alive) toast.error("Projection failed. Try reloading."); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const runMc = useCallback(() => {
    if (mcRunning) return;
    setMcRunning(true);
    const runSig = `${sig}||${mcSig}`;
    runMonteCarlo(scenario, {
      n_trials: 500,
      engine: "historical",
      anchor_to_plan: true,
      assets: allocationToAssets(scenario.allocation),
      guardrail: { enabled: grOn, cut_pct: grCut / 100 },
      conversion_halt: { enabled: haltOn, drop_threshold: haltDrop / 100,
                         resume_after_positive_years: haltResume },
      rebalance: { cadence: scenario.rebalance_cadence || "annual" },
    }).then((r) => { setMcResult(r); setMcResultSig(runSig); })
      .catch(() => toast.error("Monte Carlo failed."))
      .finally(() => setMcRunning(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, mcSig]);

  useEffect(() => {
    setMcResult(null);
    const t = setTimeout(runMc, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, mcSig]);

  // Beneficiary tax-rate sensitivity for the Legacy page — after-tax inheritance
  // at a low / middle / high heir marginal rate. One request; the backend only
  // re-prices the heirs' SECURE-10 horizon per rate.
  const [heirSens, setHeirSens] = useState(null);
  useEffect(() => {
    let alive = true;
    setHeirSens(null);
    const t = setTimeout(() => {
      runHeirRateSensitivity(scenario)
        .then((r) => { if (alive) setHeirSens(r); })
        .catch(() => { if (alive) setHeirSens(null); });
    }, 700);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Regime comparison fetch — auto-run when the advisor toggles it on, or when the
  // plan / behavioral rules change. Pairs with/without behavior when either the halt
  // or guardrail is active so clients see the "behavior lift" per regime.
  useEffect(() => {
    if (!regimeOn) { setRegimeData(null); return; }
    let alive = true;
    setRegimeRunning(true);
    setRegimeData(null);
    const t = setTimeout(() => {
      runRegimeCompare({
        config: scenario,
        n_trials: 300,
        engine: "historical",
        anchor_to_plan: true,
        assets: allocationToAssets(scenario.allocation),
        guardrail: { enabled: grOn, cut_pct: grCut / 100 },
        conversion_halt: { enabled: haltOn, drop_threshold: haltDrop / 100,
                           resume_after_positive_years: haltResume },
        include_no_behavior_pair: (grOn || haltOn),
        seed: 42,
      }).then((r) => { if (alive) setRegimeData(r); })
        .catch(() => { if (alive) toast.error("Regime comparison failed."); })
        .finally(() => { if (alive) setRegimeRunning(false); });
    }, 900);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, mcSig, regimeOn]);

  // Sequence-of-returns stress test — only fetched when the page is switched on
  // (9 paths x 2 projections is the heaviest call in the report).
  useEffect(() => {
    if (!seqOn) { setSeqData(null); return; }
    let alive = true;
    setSeqRunning(true);
    setSeqData(null);
    const t = setTimeout(() => {
      runSequenceStress(scenario, seqParams)
        .then((r) => { if (alive) setSeqData(r); })
        .catch(() => { if (alive) toast.error("Sequence stress test failed."); })
        .finally(() => { if (alive) setSeqRunning(false); });
    }, 900);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, seqSig, seqOn]);

  // EP flowchart fetch — same slice-at-first-death convention, but cash + house are
  // kept as their own display bucket (the workbook's "Cash, Trad IRA & House" boxes).
  useEffect(() => {
    if (!flowOn || !withRoth?.rows) { setFlowResult(null); return; }
    const h = scenario?.household || {};
    const clientDeath = (h.client_dob_year && h.client_life_expectancy) ? h.client_dob_year + h.client_life_expectancy : null;
    const spouseDeath = (h.spouse_dob_year && h.spouse_life_expectancy) ? h.spouse_dob_year + h.spouse_life_expectancy : null;
    if (!clientDeath && !spouseDeath) { setFlowResult(null); return; }
    const first = Math.min(clientDeath || spouseDeath, spouseDeath || clientDeath);
    const second = Math.max(clientDeath || spouseDeath, spouseDeath || clientDeath);
    const yrRow = withRoth.rows.find((r) => r.year >= first) || withRoth.rows[withRoth.rows.length - 1];
    if (!yrRow) { setFlowResult(null); return; }
    const y2Row = withRoth.rows.find((r) => r.year >= second) || withRoth.rows[withRoth.rows.length - 1];
    const taxAccts = (scenario?.accounts || []).filter((a) => a.tax_type === "Taxable");
    const taxTotalBal = taxAccts.reduce((s, a) => s + (a.beginning_balance || 0), 0);
    const derivedRate = taxTotalBal > 0
      ? taxAccts.reduce((s, a) => s + (a.return || 0) * (a.beginning_balance || 0), 0) / taxTotalBal
      : 0.06;
    const halfCashHouse = ((yrRow.cash || 0) + (yrRow.real_estate || 0)) / 2;
    let alive = true;
    runEpFlowchart({
      first_death_year: first, second_death_year: second,
      client_roth: (yrRow.roth || 0) / 2, client_taxable: (yrRow.taxable || 0) / 2,
      client_cash_house: halfCashHouse, client_traditional: (yrRow.traditional || 0) / 2,
      survivor_roth: (yrRow.roth || 0) / 2, survivor_taxable: (yrRow.taxable || 0) / 2,
      survivor_cash_house: halfCashHouse, survivor_traditional: (yrRow.traditional || 0) / 2,
      y2_roth: y2Row?.roth || 0, y2_taxable: y2Row?.taxable || 0,
      y2_cash_house: (y2Row?.cash || 0) + (y2Row?.real_estate || 0),
      y2_traditional: y2Row?.traditional || 0,
      growth_rate: derivedRate,
      cap_gains_rate: 0.24,
      // Heir marginal rate must include BOTH federal and state so the estate
      // flowchart pages agree with the Legacy page (heirRate on line ~514
      // adds both). Previously only heir_federal_rate was sent — that gave
      // pages 12-14 a 32% rate while page 11 used 36%, producing the
      // $1.634M vs $1.838M inconsistency in the printed report.
      heir_income_rate: (scenario?.legacy?.heir_federal_rate ?? 0.32)
                      + (scenario?.legacy?.heir_state_rate ?? 0.04),
      indexing_rate: scenario?.projection?.general_inflation ?? 0.03,
    })
      .then((r) => { if (alive) setFlowResult(r); })
      .catch(() => { if (alive) toast.error("EP flowchart failed."); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, flowOn, withRoth]);

  // Comparison-scenario flowchart — fetched when the advisor picks a saved
  // scenario for the paired EP-flowchart comparison pages. Same growth /
  // cap-gains / heir-income assumptions as the main flow so the delta reflects
  // only plan-input differences.
  useEffect(() => {
    if (!flowOn || !flowScenarioCompareId) {
      setFlowCompareResult(null); setFlowCompareLabel(""); setSensitivityData(null); return;
    }
    let alive = true;
    setSensitivityData(null);
    (async () => {
      try {
        const items = await listScenarios();
        const chosen = (items || []).find((s) => s.id === flowScenarioCompareId);
        if (!alive) return;
        if (!chosen?.config) { setFlowCompareResult(null); setFlowCompareLabel(""); return; }
        const proj = await runProjection(chosen.config);
        if (!alive) return;
        const hh = chosen.config?.household || {};
        const cD = (hh.client_dob_year && hh.client_life_expectancy) ? hh.client_dob_year + hh.client_life_expectancy : null;
        const sD = (hh.spouse_dob_year && hh.spouse_life_expectancy) ? hh.spouse_dob_year + hh.spouse_life_expectancy : null;
        if (!cD && !sD) { setFlowCompareResult(null); setFlowCompareLabel(""); return; }
        const cFirst = Math.min(cD || sD, sD || cD);
        const cSecond = Math.max(cD || sD, sD || cD);
        const row = (proj.rows || []).find((r) => r.year >= cFirst) || (proj.rows || []).slice(-1)[0];
        if (!row) { setFlowCompareResult(null); setFlowCompareLabel(""); return; }
        const cy2Row = (proj.rows || []).find((r) => r.year >= cSecond) || (proj.rows || []).slice(-1)[0];
        const halfCH = ((row.cash || 0) + (row.real_estate || 0)) / 2;
        // Match main flow's assumptions so the compare delta is apples-to-apples.
        const currentTaxAccts = (scenario?.accounts || []).filter((a) => a.tax_type === "Taxable");
        const curBal = currentTaxAccts.reduce((s, a) => s + (a.beginning_balance || 0), 0);
        const curRate = curBal > 0
          ? currentTaxAccts.reduce((s, a) => s + (a.return || 0) * (a.beginning_balance || 0), 0) / curBal
          : 0.06;
        const flow = await runEpFlowchart({
          first_death_year: cFirst, second_death_year: cSecond,
          client_roth: (row.roth || 0) / 2, client_taxable: (row.taxable || 0) / 2,
          client_cash_house: halfCH, client_traditional: (row.traditional || 0) / 2,
          survivor_roth: (row.roth || 0) / 2, survivor_taxable: (row.taxable || 0) / 2,
          survivor_cash_house: halfCH, survivor_traditional: (row.traditional || 0) / 2,
          y2_roth: cy2Row?.roth || 0, y2_taxable: cy2Row?.taxable || 0,
          y2_cash_house: (cy2Row?.cash || 0) + (cy2Row?.real_estate || 0),
          y2_traditional: cy2Row?.traditional || 0,
          growth_rate: curRate,
          cap_gains_rate: 0.24,
          heir_income_rate: (scenario?.legacy?.heir_federal_rate ?? 0.32) + (scenario?.legacy?.heir_state_rate ?? 0.04),
          indexing_rate: chosen.config?.projection?.general_inflation ?? scenario?.projection?.general_inflation ?? 0.03,
        });
        if (alive) { setFlowCompareResult(flow); setFlowCompareLabel(chosen.name); }
        // -- Single-variable sensitivity runs: each changes exactly ONE input of
        // the CURRENT scenario, taken from the comparison scenario, so each
        // delta is causally attributable (reviewer critique of pages 19-22).
        const chosenCfg = chosen.config;
        const clone = () => JSON.parse(JSON.stringify(scenario));
        const rothCfg = chosenCfg.roth || {};
        const schedDesc = rothCfg.enabled === false
          ? "conversions disabled"
          : `target ${Math.round((rothCfg.target_bracket || 0) * 100)}% bracket, ${rothCfg.start_year || "?"}–${rothCfg.end_year || "?"}`;
        const vA = clone(); vA.roth = JSON.parse(JSON.stringify(rothCfg));
        const orderB = chosenCfg?.withdrawal?.funding_order || scenario?.withdrawal?.funding_order || "";
        const vB = clone(); vB.withdrawal = { ...(vB.withdrawal || {}), funding_order: orderB };
        const avgByType = {};
        ["Cash", "Taxable", "Tax-Deferred", "Tax-Free", "Real Estate"].forEach((tt) => {
          const list = (chosenCfg.accounts || []).filter((a) => a.tax_type === tt);
          if (!list.length) return;
          const bal = list.reduce((s, a) => s + (a.beginning_balance || 0), 0);
          avgByType[tt] = bal > 0
            ? list.reduce((s, a) => s + (a.return || 0) * (a.beginning_balance || 0), 0) / bal
            : (list[0].return || 0);
        });
        const vC = clone();
        (vC.accounts || []).forEach((a) => { if (avgByType[a.tax_type] != null) a.return = avgByType[a.tax_type]; });
        const pctFmt = (x) => `${((x || 0) * 100).toFixed(1)}%`;
        const retDesc = ["Taxable", "Tax-Deferred", "Tax-Free", "Cash"]
          .filter((tt) => avgByType[tt] != null)
          .map((tt) => `${tt} ${pctFmt(avgByType[tt])}`).join(", ");
        const [pA, pB, pC] = await Promise.all([runProjection(vA), runProjection(vB), runProjection(vC)]);
        if (!alive) return;
        setSensitivityData({
          compareLabel: chosen.name,
          compareProj: proj,
          compareHousehold: chosenCfg.household,
          variants: [
            { key: "schedule", label: "A. Conversion schedule only", proj: pA,
              changed: `Roth conversion schedule swapped to “${chosen.name}” (${schedDesc}). Portfolio returns, funding order, expenses, and death years unchanged.` },
            { key: "funding", label: "B. Funding order only", proj: pB,
              changed: `Withdrawal funding order swapped to “${orderB}”. Conversion schedule, portfolio returns, and expenses unchanged.` },
            { key: "returns", label: "C. Return assumptions only", proj: pC,
              changed: `Per-account returns swapped to “${chosen.name}” tax-type averages (${retDesc}). Schedule, funding order, and expenses unchanged.` },
          ],
        });
      } catch {
        if (alive) toast.error("Comparison scenario flowchart failed.");
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, flowOn, flowScenarioCompareId]);

  const rows = useMemo(() => withRoth?.rows || [], [withRoth]);
  const s = useMemo(() => withRoth?.summary || {}, [withRoth]);
  const sn = useMemo(() => noRoth?.summary || {}, [noRoth]);
  const lg = useMemo(() => withRoth?.legacy || {}, [withRoth]);
  const lgn = useMemo(() => noRoth?.legacy || {}, [noRoth]);

  const h = scenario.household || {};
  // Anonymization: when the advisor has ticked the "Anonymize" toggle, every
  // printed page renders the client as "Client" and the partner as "Client
  // Partner". Preserves planning-model privacy for anything the report might
  // be shared with (LLM prompts, marketing samples, external review).
  const anonymize = !!branding.anonymize_names;
  const rawClientName = branding.client_name_override || h.client_name || "Client";
  const rawSpouseName = branding.spouse_name_override || h.spouse_name || "";
  const clientName = anonymize ? "Client" : rawClientName;
  const spouseName = anonymize ? (rawSpouseName ? "Client Partner" : "") : rawSpouseName;
  const household = spouseName ? `${clientName} & ${spouseName}` : clientName;
  // Anonymized label used for anything shared with an external LLM (advisor's
  // own Gemini/Claude key from AI Insights). Names are stripped before leaving
  // the app.
  // leaving the app.
  const anonymizedHousehold = spouseName ? "A married couple" : "A single client";
  const prettyDate = useMemo(() => {
    const d = new Date(branding.presentation_date + "T00:00:00");
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }, [branding.presentation_date]);

  const incomeData = useMemo(() => rows.map((r) => {
    const cf = r.cashflow || {};
    return {
      year: r.year,
      "Wages & Pension": cf.wages_pension || 0,
      SocialSecurity: cf.gross_ss || 0,
      Dividends: cf.dividends || 0,
      Interest: cf.interest || 0,
      RMD: cf.rmd || 0,
      Withdrawals: (cf.from_cash || 0) + (cf.from_taxable || 0) + (cf.from_ira || 0) + (cf.from_roth || 0),
      Need: (cf.expenses || 0) + (cf.income_tax || 0) + (cf.medicare || 0),
    };
  }), [rows]);

  const composeData = useMemo(() => rows.map((r) => ({
    year: r.year,
    Cash: r.cash || 0,
    Taxable: r.taxable || 0,
    Traditional: r.traditional || 0,
    Roth: r.roth || 0,
  })), [rows]);

  const taxCompData = useMemo(() => rows.map((r) => ({ year: r.year, ...(r.tax_breakdown || {}) })), [rows]);

  const nwSeries = useMemo(() => {
    const arr = rows.map((r) => ({
      year: r.year,
      withRoth: (r.cash || 0) + (r.traditional || 0) + (r.roth || 0) + (r.taxable || 0),
      withoutRoth: 0,
    }));
    (noRoth?.rows || []).forEach((n, i) => {
      if (arr[i]) arr[i].withoutRoth = (n.cash || 0) + (n.traditional || 0) + (n.roth || 0) + (n.taxable || 0);
    });
    return arr;
  }, [rows, noRoth]);

  const heirRate = (scenario?.legacy?.heir_federal_rate ?? 0.3165)
                 + (scenario?.legacy?.heir_state_rate ?? 0);

  const notReady = !withRoth || !noRoth;
  const marketPresets = useMarketPresets();
  const marketPreset = getActivePreset(scenario, marketPresets);

  const generateAiReview = async () => {
    if (aiStreaming || notReady) return;
    setAiStreaming(true); setAiText(""); setAiError("");
    const apiKey = window.localStorage.getItem("gemini_api_key") || "";
    const summary = {
      _focus:
        "You are writing the AI Review section at the end of a client-facing retirement report. " +
        "PRIVACY: The household is anonymized — refer to the clients only as 'the couple', 'the client', 'they', or 'you' throughout. " +
        "NEVER invent, guess, or output any personal names, and do not use placeholders like '[Client Name]'. " +
        "Produce output in TWO distinct sections, each preceded by a markdown-style header on its own line:\n" +
        "\n### For the Client (3-4 short paragraphs)\n" +
        "Plain-English narrative to the client. Acknowledge their situation, describe what the plan accomplishes, " +
        "identify strengths, honestly name the main risks, and explain the conversion rationale in simple terms. " +
        "Second-person ('you'), warm, respectful, no jargon.\n" +
        "\n### Advisor Talking Points (3-4 bullets)\n" +
        "Crisp bullets for the advisor to raise during the client meeting: the 3 most compelling numbers, " +
        "one caveat to proactively address, and one specific next-step recommendation.",
      report: "Retirement & Wealth-Transfer Illustration — Attorney Edition",
      household: anonymizedHousehold,
      strategy: getStrategyLabel(scenario)?.label,
      market_regime: marketPreset?.label,
      lifetime_taxes_with: s.lifetime_taxes,
      lifetime_taxes_without: sn.lifetime_taxes,
      total_roth_converted: s.total_roth_converted,
      after_tax_estate_with: lg.after_tax_estate_to_heirs,
      after_tax_estate_without: lgn.after_tax_estate_to_heirs,
      heir_ira_tax_with: lg.inherited_ira_tax,
      heir_ira_tax_without: lgn.inherited_ira_tax,
      heir_marginal_rate: heirRate,
      mc_success: mcResult?.with_conversions?.success,
      mc_p10_ending: mcResult?.with_conversions?.ending?.p10,
      mc_p50_ending: mcResult?.with_conversions?.ending?.p50,
      mc_p90_ending: mcResult?.with_conversions?.ending?.p90,
      funding_order: scenario?.withdrawal?.funding_order,
      ending_roth: s.ending_roth,
      ending_traditional: rows.length ? rows[rows.length - 1]?.traditional : null,
    };
    try {
      const res = await fetch(`${API}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ summary, api_key: apiKey }),
      });
      if (!res.ok) {
        let detail = "AI review generation failed.";
        try { const j = await res.json(); if (typeof j.detail === "string") detail = j.detail; } catch { /* noop */ }
        throw new Error(detail);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAiText(acc);
      }
      try { window.localStorage.setItem(AI_TEXT_KEY, acc); } catch { /* noop */ }
    } catch (e) {
      setAiError(e?.message || "AI review generation failed.");
    } finally {
      setAiStreaming(false);
    }
  };

  const editAiText = (v) => {
    setAiText(v);
    try { window.localStorage.setItem(AI_TEXT_KEY, v); } catch { /* noop */ }
  };
  const clearAiText = () => {
    setAiText("");
    try { window.localStorage.removeItem(AI_TEXT_KEY); } catch { /* noop */ }
  };

  // Export the advisor commentary to a standalone PDF or RTF file (advisor-only
  // working document — never bundled into the client PDF). RTF is generated
  // inline with a minimal RTF header so it opens in Word/LibreOffice without a
  // heavy dependency. PDF uses window.print() with an isolated content window.
  const exportAdvisorCommentary = (format) => {
    if (!aiText || aiStreaming) return;
    const dateStr = new Date().toLocaleDateString("en-US",
      { year: "numeric", month: "long", day: "numeric" });
    const header = `Advisor Commentary — ${household}\nPrepared ${dateStr}`;
    const doc = `${header}\n${"=".repeat(60)}\n\n${aiText}\n\n${"—".repeat(30)}\n` +
      `Advisor working document. Not for distribution to the client. This ` +
      `commentary was AI-drafted using the app's Advisor Commentary tool and ` +
      `reviewed by the advisor before internal use.`;
    if (format === "rtf") {
      // Minimal RTF wrapper — escape RTF-reserved chars, translate newlines.
      const rtfEscape = (s) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, (m) => `\\${m}`);
      const rtfBody = rtfEscape(doc).replace(/\r?\n/g, "\\par\n");
      const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\fs22 ${rtfBody}}`;
      const blob = new Blob([rtf], { type: "application/rtf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `advisor-commentary-${new Date().toISOString().slice(0, 10)}.rtf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast.success("Advisor commentary saved as RTF.");
      return;
    }
    // PDF via a print window — keeps the export self-contained and preserves
    // formatting through the OS print pipeline (Save as PDF).
    try {
      const w = window.open("", "_blank", "width=760,height=900");
      if (!w) { toast.error("Popup blocked — allow popups to save as PDF."); return; }
      const safe = doc.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      w.document.write(`<!doctype html><html><head><meta charset="utf-8">
        <title>Advisor Commentary — ${household}</title>
        <style>
          @page { size: Letter; margin: 0.75in; }
          body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt;
                 line-height: 1.55; color: #1A1A1A; white-space: pre-wrap; }
          h1 { font-family: "Outfit", sans-serif; font-size: 16pt; margin: 0 0 12pt; color: #4A6741; }
          .foot { margin-top: 30pt; padding-top: 10pt; border-top: 1px solid #C9C4B8;
                  font-size: 9.5pt; color: #666; font-style: italic; }
        </style></head><body>
        <h1>Advisor Commentary — ${household}</h1>
        <div style="font-size:10pt;color:#666;margin-bottom:16pt">Prepared ${dateStr}</div>
        <div>${safe.split("\n").slice(2).join("\n").replace(/={20,}/, "").trim()}</div>
        <div class="foot">Advisor working document. Not for distribution to the client.</div>
        <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
        </body></html>`);
      w.document.close();
      toast.success("Advisor commentary opened — use the browser's Save as PDF dialog.");
    } catch (e) {
      toast.error("Could not open the print window.");
    }
  };

  const doPrint = async () => {
    if (downloading) return;
    setDownloading(true);
    saveBranding(branding);
    const wrap = document.querySelector("[data-testid='client-report-preview-wrap']");
    const originalTransform = wrap ? wrap.style.transform : "";
    const originalWidth = wrap ? wrap.style.width : "";
    if (wrap) {
      wrap.style.setProperty("transform", "none", "important");
      wrap.style.setProperty("width", "100%", "important");
    }
    // Reset any "click-to-isolate" legend state so the printed PDF always
    // captures the full un-dimmed chart even if the advisor was using the
    // interactive legend on-screen. Each chart's useIsolation() hook listens
    // for this event and resets to null; we then wait 2 RAFs for the
    // resulting re-render to settle before html2canvas starts painting.
    window.dispatchEvent(new CustomEvent("cr-reset-isolation"));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await downloadElementAsPdf({
        target: "[data-testid='client-report-preview-inner']",
        filename: `${(clientName || "client").toLowerCase().replace(/\s+/g, "-")}-retirement-report.pdf`,
        format: "a4",
        orientation: "portrait",
        marginMm: 10,
      });
    } catch (e) {
      console.error("Client report PDF export failed", e);
      toast.error("PDF generation failed. Try again.");
    } finally {
      if (wrap) {
        wrap.style.transform = originalTransform;
        wrap.style.width = originalWidth;
      }
      setDownloading(false);
    }
  };

  const doDocx = async () => {
    // Semi-structured DOCX export — headings/paragraphs/tables are real
    // Word text; charts and mixed-media blocks are rasterized to PNGs and
    // embedded. See /app/frontend/src/lib/docx.js for the walker.
    if (downloadingDocx) return;
    setDownloadingDocx(true);
    saveBranding(branding);
    const wrap = document.querySelector("[data-testid='client-report-preview-wrap']");
    const originalTransform = wrap ? wrap.style.transform : "";
    const originalWidth = wrap ? wrap.style.width : "";
    if (wrap) {
      wrap.style.setProperty("transform", "none", "important");
      wrap.style.setProperty("width", "100%", "important");
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await downloadElementAsDocx({
        target: "[data-testid='client-report-preview-inner']",
        filename: `${(clientName || "client").toLowerCase().replace(/\s+/g, "-")}-retirement-report.docx`,
      });
      toast.success("Word document downloaded.");
    } catch (e) {
      console.error("Client report DOCX export failed", e);
      toast.error("DOCX generation failed. Try again.");
    } finally {
      if (wrap) {
        wrap.style.transform = originalTransform;
        wrap.style.width = originalWidth;
      }
      setDownloadingDocx(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print" data-testid="client-report-toolbar">
        <PlanControlStrip scenario={scenario} setScenario={setScenario}
          testidPrefix="cr-plan-control-strip" />
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <StrategyBadge scenario={scenario} testid="client-report-strategy-badge" />
          <MarketBadge scenario={scenario} testid="client-report-market-badge" />
        </div>

        <div className="rounded-xl border border-[#EBE8E0] bg-[#F9F8F6] p-5 mb-4">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-display text-base font-bold tracking-tight text-[#1A1A1A]">Retirement & Wealth-Transfer Illustration — Attorney Edition</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">
                  Long-form, print-ready narrative report for the client. Covers the plan overview, savings, income &amp; expenses, cash flow, taxes, Monte Carlo, the SECURE Act legacy analysis, and an AI-generated review the advisor can edit before delivering.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={persistBranding} data-testid="client-report-save"
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                <Save className="h-4 w-4" /> Save settings
              </Button>
              <Button size="sm" onClick={doPrint} disabled={notReady || downloading || downloadingDocx} data-testid="client-report-print-btn"
                className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
                {downloading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                  : <><Printer className="h-4 w-4" /> {notReady ? "Loading…" : "Generate PDF"}</>}
              </Button>
              <Button size="sm" variant="outline" onClick={doDocx}
                disabled={notReady || downloading || downloadingDocx}
                data-testid="client-report-docx-btn"
                title="Download an editable Word document — headings, paragraphs and tables are real Word text; charts embed as images"
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                {downloadingDocx
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Building Word…</>
                  : <><FileText className="h-4 w-4" /> Generate Word (.docx)</>}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label className="text-[11px] label-cap"><User className="inline h-3 w-3 mr-1" />Client name</Label>
              <Input data-testid="cr-input-client" value={branding.client_name_override}
                onChange={(e) => upd("client_name_override", e.target.value)}
                placeholder={h.client_name || "(from scenario)"} className="h-9 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-[11px] label-cap"><User className="inline h-3 w-3 mr-1" />Spouse name</Label>
              <Input data-testid="cr-input-spouse" value={branding.spouse_name_override}
                onChange={(e) => upd("spouse_name_override", e.target.value)}
                placeholder={h.spouse_name || "(optional)"} className="h-9 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-[11px] label-cap">Report date</Label>
              <Input data-testid="cr-input-date" type="date" value={branding.presentation_date}
                onChange={(e) => upd("presentation_date", e.target.value)} className="h-9 text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3 rounded-md border border-[#C87941] bg-[#FEFAF1] px-3 py-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <Switch data-testid="cr-anonymize-toggle" checked={!!branding.anonymize_names}
                  onCheckedChange={(v) => upd("anonymize_names", !!v)} className="mt-0.5" />
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-[#8A5A20]">
                    Anonymize client identity in this report
                  </p>
                  <p className="text-[10.5px] text-muted-foreground leading-snug mt-1">
                    When on, every page renders the client as <strong>&ldquo;Client&rdquo;</strong> and their partner as
                    <strong> &ldquo;Client Partner&rdquo;</strong> instead of the real names. This is important for
                    financial planning and legal engagements — client privacy is a core feature of any advisor
                    engagement, and it prevents attribution of any AI-generated
                    Advisor Commentary to any specific individual. This model is a
                    static tax planning engine and never asks for third-party account credentials.
                  </p>
                </div>
              </label>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Cover subtitle</Label>
              <Input data-testid="cr-input-subtitle" value={branding.cover_subtitle}
                onChange={(e) => upd("cover_subtitle", e.target.value)}
                placeholder="Retirement & Wealth-Transfer Illustration — Attorney Edition" className="h-9 text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Cover intro paragraph (optional)</Label>
              <Textarea data-testid="cr-input-intro" value={branding.cover_intro}
                onChange={(e) => upd("cover_intro", e.target.value)} rows={3}
                placeholder="Optional letter-style intro paragraph."
                className="text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3 rounded-md border border-[#EBE8E0] bg-[#FAFAF8] px-3 py-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <Switch data-testid="cr-cover-letter-toggle" checked={!!branding.cover_letter_on}
                  onCheckedChange={(v) => upd("cover_letter_on", !!v)} className="mt-0.5" />
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-[#1A1A1A]">
                    Include an advisor cover letter (page 2)
                  </p>
                  <p className="text-[10.5px] text-muted-foreground leading-snug mt-1">
                    Off by default. When on, a letter page prints straight after the cover — addressed to the
                    household, signed with your name and contact details. Leave a blank line between paragraphs.
                  </p>
                </div>
              </label>
              {branding.cover_letter_on && (
                <Textarea data-testid="cr-input-cover-letter" value={branding.cover_letter || ""}
                  onChange={(e) => upd("cover_letter", e.target.value)} rows={5}
                  placeholder={"The analysis that follows compares two paths for your retirement assets…\n\nWe should review the conversion schedule together before year-end."}
                  className="text-sm mt-2 bg-white" />
              )}
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Footer / confidentiality</Label>
              <Input data-testid="cr-input-confidentiality" value={branding.confidentiality}
                onChange={(e) => upd("confidentiality", e.target.value)}
                className="h-9 text-sm mt-1" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6 items-center">
            <label className="flex items-start gap-2 cursor-pointer max-w-[720px]">
              <Switch checked={branding.include_ai_review} onCheckedChange={(v) => upd("include_ai_review", v)}
                data-testid="cr-toggle-ai" />
              <span className="text-xs text-muted-foreground leading-snug">
                Enable <strong className="text-[#1A1A1A]">Advisor Commentary</strong> (optional) — an
                advisor-only working document; <strong>not printed into the client PDF</strong>.
                Export as a separate PDF or RTF when needed.
              </span>
            </label>
          </div>

          <div className="mt-3 rounded-md border border-[#EBE8E0] bg-[#FAFAF8] px-3 py-2">
            <label className="flex items-start gap-2 cursor-pointer max-w-[720px]">
              <Switch checked={fundingOrderOn} onCheckedChange={(v) => setFundingOrderOn(!!v)}
                data-testid="cr-funding-order-toggle" className="mt-0.5" />
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-[#1A1A1A]">
                  Include the &ldquo;Funding Order — The Hidden Lever&rdquo; page
                  {fundingOrderRunning && <span className="ml-2 text-[10.5px] font-normal text-muted-foreground">(computing…)</span>}
                </p>
                <p className="text-[10.5px] text-muted-foreground leading-snug mt-1">
                  On by default. Prints between &ldquo;Planned Roth Conversions by Year&rdquo; and &ldquo;Savings&rdquo;.
                  Runs the same plan under all three withdrawal funding orders and compares total conversions, heir
                  outcomes, estate tax and the beneficiary break-even rate side by side.
                </p>
              </div>
            </label>
          </div>

          <div className="mt-3 rounded-md border border-[#EBE8E0] bg-[#FAFAF8] px-3 py-2">
            <label className="flex items-start gap-2 cursor-pointer max-w-[720px]">
              <Switch checked={statutoryOn} onCheckedChange={(v) => setStatutoryOn(!!v)}
                data-testid="cr-statutory-toggle" className="mt-0.5" />
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-[#1A1A1A]">
                  Add the &ldquo;Statutory Figures &amp; Authorities&rdquo; appendix
                </p>
                <p className="text-[10.5px] text-muted-foreground leading-snug mt-1">
                  Off by default. Adds a final appendix page listing every statutory figure used (rates,
                  thresholds, exclusions) with its value, indexing assumption, and legal citation
                  {lawData?.LAW_AS_OF ? ` — tax law as of ${lawData.LAW_AS_OF}` : ""}.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Monte Carlo behavioral realism — halt + guardrail toggles that flow into the
            report's MC page. The methodology block auto-updates from the result payload. */}
        <MonteCarloBehaviorCard
          haltOn={haltOn} setHaltOn={setHaltOn}
          haltDrop={haltDrop} setHaltDrop={setHaltDrop}
          haltResume={haltResume} setHaltResume={setHaltResume}
          grOn={grOn} setGrOn={setGrOn}
          grCut={grCut} setGrCut={setGrCut}
          regimeOn={regimeOn} setRegimeOn={setRegimeOn}
          seqOn={seqOn} setSeqOn={setSeqOn} seqRunning={seqRunning}
          regimeRunning={regimeRunning}
          basisOn={basisOn} setBasisOn={setBasisOn}
          pairedOn={pairedOn} setPairedOn={setPairedOn}
          inputsOn={inputsOn} setInputsOn={setInputsOn}
          bracketOn={bracketOn} setBracketOn={setBracketOn}
          mcStale={mcStale} mcRunning={mcRunning} onRerun={runMc}
        />

        {/* Family objectives — printed as a dollar-free page ahead of the conversion
            analysis, and saved on the scenario so the deck prints the same page. */}
        <ObjectivesEditor scenario={scenario} setScenario={setScenario} testidPrefix="cr-objectives" />

        {/* Report extras: milestone customization + PV discount rate + state exclusions. */}
        <ReportCustomizationCard
          scenario={scenario}
          customMilestones={customMilestones} setCustomMilestones={setCustomMilestones}
          stateExclusions={stateExclusions} setStateExclusions={setStateExclusions}
          pvRateOverride={pvRateOverride} setPvRateOverride={setPvRateOverride}
          flowOn={flowOn} setFlowOn={setFlowOn}
          flowPlans={flowPlans} setFlowPlans={setFlowPlans}
          flowCompareOn={flowCompareOn} setFlowCompareOn={setFlowCompareOn}
          flowScenarioCompareId={flowScenarioCompareId} setFlowScenarioCompareId={setFlowScenarioCompareId}
        />

        {/* Advisor Commentary controls — advisor-only working document. Never included
            in the client PDF. Advisor can generate the narrative (via Claude Fable 5 or
            their own BYOK Gemini key), edit it, then export as a standalone PDF or RTF
            for internal analysis. Gated behind the branding.include_ai_review toggle. */}
        {branding.include_ai_review && (
          <div className="rounded-xl border border-[#4A6741] bg-[#F1F5EF] shadow-sm p-4 mb-4"
               data-testid="cr-advisor-commentary-card">
            <div className="flex items-start gap-3 mb-3">
              <Sparkles className="h-4 w-4 text-[#4A6741] mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-[#1A1A1A]">Advisor Commentary</p>
                  <span className="text-[9px] font-bold uppercase tracking-wide bg-[#4A6741] text-white
                                   rounded-full px-2 py-[2px]">Advisor-only</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Drafts internal advisor talking points and a plain-English synopsis for your working file.
                  <strong className="text-[#1A1A1A]"> Not included in the client PDF.</strong> Export as a
                  standalone PDF or RTF for internal review, peer consultation, or continuing-education notes.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {aiText && !aiStreaming && (
                  <Button size="sm" variant="outline" onClick={clearAiText}
                    data-testid="cr-ai-clear"
                    className="h-8 gap-1 text-[11px]">
                    <RotateCcw className="h-3 w-3" /> Clear
                  </Button>
                )}
                <Button size="sm" onClick={generateAiReview} disabled={aiStreaming || notReady}
                  data-testid="cr-ai-run"
                  className="h-8 gap-1 bg-[#4A6741] hover:bg-[#3B5234] text-white text-[11px]">
                  {aiStreaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {aiStreaming ? "Generating…" : (aiText ? "Regenerate" : "Generate Commentary")}
                </Button>
              </div>
            </div>
            {aiError && <p className="text-[11px] text-[#B84A4A] mb-2" data-testid="cr-ai-error">{aiError}</p>}
            <Textarea
              value={aiText}
              onChange={(e) => editAiText(e.target.value)}
              rows={8}
              placeholder="Click Generate Commentary to draft the advisor-facing narrative. Edit as needed before exporting."
              className="text-[12px] leading-relaxed"
              data-testid="cr-ai-text"
            />
            {aiText && !aiStreaming && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => exportAdvisorCommentary("pdf")}
                        className="h-8 gap-1 text-[11px]" data-testid="cr-ai-export-pdf">
                  <Download className="h-3 w-3" /> Save as PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportAdvisorCommentary("rtf")}
                        className="h-8 gap-1 text-[11px]" data-testid="cr-ai-export-rtf">
                  <Download className="h-3 w-3" /> Save as RTF
                </Button>
                <span className="text-[10.5px] text-muted-foreground italic">
                  Advisor working document — do not share with client.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Live on-screen preview */}
        <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] label-cap text-muted-foreground">Live preview (scaled) — click <em>Generate PDF</em> to save</p>
            <p className="text-[11px] text-muted-foreground">Page count is printed in each page footer</p>
          </div>
          <div className="rounded-lg border border-[#EBE8E0] bg-[#FAFAF8] p-4 overflow-hidden">
            <div style={{ transform: "scale(0.7)", transformOrigin: "top left", width: "142.85%" }}
                 data-testid="client-report-preview-wrap">
              <div className="preview-inner" data-testid="client-report-preview-inner">
                <ClientReportBody
                  branding={brandingWithAdvisor} household={household} clientName={clientName} spouseName={spouseName}
                  prettyDate={prettyDate} scenario={scenario} withRoth={withRoth} noRoth={noRoth}
                  incomeData={incomeData} composeData={composeData} taxCompData={taxCompData}
                  nwSeries={nwSeries} mcResult={mcResult} marketPreset={marketPreset}
                  heirRate={heirRate}
                  aiText={aiText}
                  logo={logo}
                  regimeOn={regimeOn} regimeData={regimeData} seqOn={seqOn} seqData={seqData}
                  basisOn={basisOn}
                  pairedOn={pairedOn}
                  inputsOn={inputsOn}
                  bracketOn={bracketOn}
                  heirSens={heirSens}
                  flowOn={flowOn} flowPlans={flowPlans} flowCompareOn={flowCompareOn} flowResult={flowResult}
                  flowCompareResult={flowCompareResult} flowCompareLabel={flowCompareLabel}
                  customMilestones={customMilestones}
                  stateExclusions={stateExclusions}
                  pvRateOverride={pvRateOverride}
                  objectivesOn={objectivesOn}
                  fundingOrderData={fundingOrderData}
                  statutoryOn={statutoryOn}
                  lawData={lawData}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print-only root */}
      <div className="presentation-print-block" data-testid="client-report-print-root">
        <ClientReportBody
          branding={brandingWithAdvisor} household={household} clientName={clientName} spouseName={spouseName}
          prettyDate={prettyDate} scenario={scenario} withRoth={withRoth} noRoth={noRoth}
          incomeData={incomeData} composeData={composeData} taxCompData={taxCompData}
          nwSeries={nwSeries} mcResult={mcResult} marketPreset={marketPreset}
          heirRate={heirRate}
          aiText={aiText}
          logo={logo}
          regimeOn={regimeOn} regimeData={regimeData} seqOn={seqOn} seqData={seqData}
          basisOn={basisOn}
          pairedOn={pairedOn}
          inputsOn={inputsOn}
          bracketOn={bracketOn}
          heirSens={heirSens}
          flowOn={flowOn} flowPlans={flowPlans} flowCompareOn={flowCompareOn} flowResult={flowResult}
          flowCompareResult={flowCompareResult} flowCompareLabel={flowCompareLabel}
          sensitivity={sensitivityData}
          customMilestones={customMilestones}
          stateExclusions={scenario?.state_exclusions}
          pvRateOverride={pvRateOverride}
          objectivesOn={objectivesOn}
          fundingOrderData={fundingOrderData}
          statutoryOn={statutoryOn}
          lawData={lawData}
        />
      </div>
    </div>
  );
};

// ---- Composed report body (used by live preview + print root) ----
const ClientReportBody = ({
  branding, household, clientName, spouseName, prettyDate, scenario, withRoth, noRoth,
  incomeData, composeData, taxCompData, nwSeries, mcResult, marketPreset, heirRate, aiText, logo,
  regimeOn, regimeData, seqOn, seqData, basisOn, pairedOn, inputsOn, bracketOn, heirSens,
  flowOn, flowPlans, flowCompareOn, flowResult,
  flowCompareResult, flowCompareLabel, sensitivity,
  customMilestones, stateExclusions, pvRateOverride, objectivesOn, fundingOrderData, statutoryOn, lawData,
}) => {
  if (!withRoth || !noRoth) {
    return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>Loading projection…</div>;
  }
  const strat = getStrategyLabel(scenario);
  const rows = withRoth.rows || [];
  const nrows = noRoth.rows || [];
  const foot = branding.confidentiality || "Confidential";
  const dateFoot = prettyDate;
  // EP flowchart pages: TWO per selected plan (the flow diagram gets a print
  // page of its own, the FET arithmetic and notes follow on the facing page)
  // + optional comparison table + (when a compare-scenario is resolved) ONE
  // single-variable sensitivity page and ONE combined-comparison page.
  const flowSel = (flowOn && flowResult) ? [1, 2, 3, 4, 5].filter((n) => flowPlans?.[n]) : [];
  const scenarioCompareOn = !!flowCompareResult && flowSel.length > 0;
  const flowPages = flowSel.length * 2
    + (flowCompareOn && flowSel.length >= 2 ? 1 : 0)
    + (scenarioCompareOn ? 2 : 0);
  // Cash/home split at the second death — feeds the gross-estate bridge on the
  // EP Projection pages.
  const hh = scenario?.household || {};
  const cDeath = (hh.client_dob_year && hh.client_life_expectancy) ? hh.client_dob_year + hh.client_life_expectancy : null;
  const sDeath = (hh.spouse_dob_year && hh.spouse_life_expectancy) ? hh.spouse_dob_year + hh.spouse_life_expectancy : null;
  const secondDeath = (cDeath || sDeath) ? Math.max(cDeath || sDeath, sDeath || cDeath) : null;
  const y2BridgeRow = (secondDeath && rows.find((r) => r.year >= secondDeath)) || rows[rows.length - 1];
  const y2Split = y2BridgeRow ? { cash: y2BridgeRow.cash || 0, home: y2BridgeRow.real_estate || 0 } : null;
  // Client PDF page count. Several sections span MULTIPLE printed pages because a
  // single page could not hold them at readable size (the PDF exporter used to
  // squeeze over-tall pages, producing squished text):
  // Base pages: Cover 1, [optional advisor cover letter], Assumptions, Overview,
  // Convert-or-Skip ×2, Roth Conversions, Savings, Income&Expenses ×3, Cash Flow,
  // Taxes, Monte Carlo, Legacy ×3.
  // Optional pages: bracket snapshots (after Taxes), paired MC + regime (after MC),
  // beneficiary rate band / basis / EP flowchart / appendix (after Legacy).
  const letterOn = !!(branding.cover_letter_on && (branding.cover_letter || "").trim());
  const L = letterOn ? 1 : 0;
  const O = objectivesOn ? 1 : 0;                    // "What are we planning for?" — opt-in
  const basePages = 15;
  const pairedActive = !!(pairedOn && mcResult?.paired_delta);
  const fundingOrderActive = !!(fundingOrderData?.results?.length);
  // Everything from the appendix divider onward is advisor / attorney reference
  // material rather than client conversation. The divider only prints when at
  // least one of those pages is switched on.
  const techPages = (basisOn ? 1 : 0) + flowPages + (inputsOn ? 2 : 0);
  const dividerOn = techPages > 0;
  const totalPages = basePages + L + O
    + (fundingOrderActive ? 1 : 0)
    + (bracketOn ? 1 : 0)
    + (pairedActive ? 1 : 0)
    + (regimeOn ? 1 : 0)
    + (seqOn && seqData ? 1 : 0)
    + (heirSens ? 1 : 0)
    + (dividerOn ? 1 : 0)
    + (basisOn ? 1 : 0)
    + flowPages
    + (inputsOn ? 2 : 0)
    + (statutoryOn ? 1 : 0);
  const lawAsOf = lawData?.LAW_AS_OF;
  const pageFooter = (n) => ({ pageNo: n, pageTotal: totalPages, footer: dateFoot, confidential: foot, logo, lawAsOf });
  const F = fundingOrderActive ? 1 : 0;             // Funding-order page shifts everything after Roth Conversions
  let cursor = 11 + L + O + F;                       // through the Taxes page
  const bracketPage = bracketOn ? ++cursor : null;
  const mcPage = ++cursor;
  const pairedPage = pairedActive ? ++cursor : null;
  const regimePage = regimeOn ? ++cursor : null;
  const seqPage = (seqOn && seqData) ? ++cursor : null;
  const legacyPage = cursor + 1;
  cursor += 3;                                       // Legacy spans 3 pages
  const heirSensPage = heirSens ? ++cursor : null;    // beneficiary rate band
  const dividerPage = dividerOn ? ++cursor : null;
  const basisPage = basisOn ? ++cursor : null;
  const flowPageStart = flowPages > 0 ? cursor + 1 : null;
  cursor += flowPages;
  const inputsPage = inputsOn ? cursor + 1 : null;

  const heirHorizon = scenario?.legacy?.post_death_years ?? 10;
  const secondDeathYear = withRoth?.legacy?.second_death_year
    ?? (rows.length ? rows[rows.length - 1].year : null);
  const heirDeliverYear = secondDeathYear ? secondDeathYear + heirHorizon : null;
  const pv = makePv(scenario, pvRateOverride, rows);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "Outfit, 'Helvetica Neue', sans-serif", color: "#1A1A1A" }}>
      <CoverPage branding={branding} household={household} prettyDate={prettyDate}
        strat={strat} marketPreset={marketPreset} scenario={scenario} logo={logo} {...pageFooter(1)} />
      {letterOn && (
        <CoverLetterPage branding={branding} household={household} prettyDate={prettyDate}
          logo={logo} {...pageFooter(2)} />
      )}
      <AssumptionsPage scenario={scenario} withRoth={withRoth} marketPreset={marketPreset}
        heirRate={heirRate} clientName={clientName} spouseName={spouseName} {...pageFooter(2 + L)} />
      {objectivesOn && (
        <ObjectivesPage scenario={scenario} household={household} {...pageFooter(3 + L)} />
      )}
      <OverviewPage scenario={scenario} withRoth={withRoth} noRoth={noRoth} rows={rows}
        nwSeries={nwSeries} mcResult={mcResult} {...pageFooter(3 + L + O)} />
      <ConvertSkipPage withRoth={withRoth} noRoth={noRoth} scenario={scenario}
        pvRateOverride={pvRateOverride} {...pageFooter(4 + L + O)} />
      <RothConversionsPage rows={rows} withRoth={withRoth} scenario={scenario} {...pageFooter(5 + L + O)} />
      {fundingOrderActive && (
        <FundingOrderPage data={fundingOrderData} {...pageFooter(6 + L + O)} />
      )}
      <SavingsPage rows={rows} composeData={composeData} withRoth={withRoth} {...pageFooter(6 + L + O + F)} />
      <IncomeExpensesPage incomeData={incomeData} rows={rows}
        customMilestones={customMilestones} stateExclusions={stateExclusions}
        {...pageFooter(7 + L + O + F)} />
      <CashFlowPage rows={rows} {...pageFooter(10 + L + O + F)} />
      <TaxesPage taxCompData={taxCompData} rows={rows} withRoth={withRoth} noRoth={noRoth}
        scenario={scenario} pvRateOverride={pvRateOverride} {...pageFooter(11 + L + O + F)} />
      {bracketOn && (
        <BracketSnapshotsPage scenario={scenario} rows={rows} {...pageFooter(bracketPage)} />
      )}
      <MonteCarloReportPage mcResult={mcResult} {...pageFooter(mcPage)} />
      {pairedActive && (
        <PairedMcPage mcResult={mcResult} {...pageFooter(pairedPage)} />
      )}
      {regimeOn && (
        <RegimeCompareReportPage regimeData={regimeData} {...pageFooter(regimePage)} />
      )}
      {seqOn && seqData && (
        <SequenceRiskPage seqData={seqData} {...pageFooter(seqPage)} />
      )}
      <LegacyPage scenario={scenario} withRoth={withRoth} noRoth={noRoth} heirRate={heirRate}
        rows={rows} nrows={nrows} pvDiscountRateOverride={pvRateOverride}
        {...pageFooter(legacyPage)} />
      {heirSens && (
        <HeirRateSensitivityPage heirSens={heirSens} heirRate={heirRate}
          pv={pv} deliverYear={heirDeliverYear}
          {...pageFooter(heirSensPage)} />
      )}
      {dividerOn && (
        <AppendixDividerPage items={[
          basisOn ? "Basis step-up analysis — which assets are worth holding until death untouched" : null,
          flowPages > 0 ? "Estate structure projections — flow diagrams plus the line-by-line federal estate-tax calculation, DSUE portability and GST allocation" : null,
          inputsOn ? "Complete input record — every assumption, account and cash-flow figure behind this report" : null,
        ].filter(Boolean)} {...pageFooter(dividerPage)} />
      )}
      {basisOn && (
        <BasisStepUpPage scenario={scenario} rows={rows} {...pageFooter(basisPage)} />
      )}
      {flowSel.map((n, i) => (
        <EpFlowchartPage key={`flow-${n}`} plan={flowResult.plans.find((p) => p.plan_no === n)}
          flowResult={flowResult} y2Split={y2Split} showFraming={i === 0}
          {...pageFooter(flowPageStart + i * 2)}
          detailFoot={pageFooter(flowPageStart + i * 2 + 1)} />
      ))}
      {flowCompareOn && flowSel.length >= 2 && (
        <EpFlowchartComparePage flowResult={flowResult} selected={flowSel}
          {...pageFooter(flowPageStart + flowSel.length * 2)} />
      )}
      {scenarioCompareOn && (() => {
        const offset = flowSel.length * 2 + (flowCompareOn && flowSel.length >= 2 ? 1 : 0);
        return (
          <>
            <SensitivityPage scenario={scenario} withRoth={withRoth} sensitivity={sensitivity}
              {...pageFooter(flowPageStart + offset)} />
            <EpFlowchartCombinedComparePage flowResult={flowResult} compareResult={flowCompareResult}
              compareLabel={flowCompareLabel} selected={flowSel}
              {...pageFooter(flowPageStart + offset + 1)} />
          </>
        );
      })()}
      {inputsOn && (
        <InputsAppendixPage scenario={scenario} {...pageFooter(inputsPage)} />
      )}
      {statutoryOn && (
        <StatutoryFiguresPage law={lawData} {...pageFooter(totalPages)} />
      )}
    </div>
  );
};

// Silence unused-import lint until we need `defaultBranding` again (kept as safety net for callers).
export { defaultBranding };

export default ClientReport;
