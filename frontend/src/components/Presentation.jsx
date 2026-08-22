import { useEffect, useMemo, useState } from "react";
import { Printer, Presentation as PresentationIcon, User, Building2, Mail, Save, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { runEpFlowchart, runProjection, runHeirRateSensitivity, runFundingOrderLongevity, fmtUSD, fmtPct } from "@/lib/api";
import { downloadElementAsPdf } from "@/lib/pdf";
import { downloadElementAsDocx } from "@/lib/docx";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from "recharts";
import {
  IncomeSourcesChart, RothConversionsChart, PvNetWorthChart, TaxCompositionChart,
  HeirLegacyCompareChart, AccountCompositionChart, AccountValuesStackedBarChart,
} from "@/components/AnalyticsCharts";
import AIAnalysisCard from "@/components/AIAnalysisCard";
import ChartCard from "@/components/presentation/ChartCard";
import { StrategyBadge } from "@/components/StrategyBadge";
import { getStrategyLabel } from "@/lib/strategyLabel";
import { MarketBadge, useMarketPresets, getActivePreset } from "@/components/MarketScenarioSelector";
import { PlanControlStrip } from "@/components/PlanControlStrip";
import { useAdvisorLogo, LogoHeader } from "@/lib/advisorLogo";
import { useAdvisorInfo } from "@/lib/advisorInfo";
import { Page, H2, H3, P, Sub } from "@/components/presentation/printPrimitives";
import LongevityTradeoffPage from "@/components/presentation/LongevityTradeoffPage";
import BeneficiaryBandPage from "@/components/presentation/BeneficiaryBandPage";
import ConvertSkipDeckPage from "@/components/presentation/ConvertSkipDeckPage";
import ObjectivesDeckPage from "@/components/presentation/ObjectivesDeckPage";
import EstateComparePage from "@/components/presentation/EstateComparePage";
import AppendixDividerDeckPage from "@/components/presentation/AppendixDividerDeckPage";
import ObjectivesEditor from "@/components/ObjectivesEditor";
import { HoldConstantBand } from "@/components/shared/PrintBlocks";
import { makePv } from "@/lib/pv";
import { mcScenarioSig } from "@/lib/mcSignature";
import { useObjectivesPage } from "@/hooks/useObjectivesPage";
import { useFlowPlans } from "@/hooks/useFlowPlans";
import { useDeckPages } from "@/hooks/useDeckPages";
import DeckPagePicker from "@/components/presentation/DeckPagePicker";
import McBehaviorCard from "@/components/presentation/McBehaviorCard";
import { McBehaviorNote } from "@/components/shared/McBehaviorNote";
import SequenceRiskDeckPage from "@/components/presentation/SequenceRiskDeckPage";
import { DECK_CONTENT_KEYS } from "@/lib/deckPages";
import { buildEpFlowchartRequest, loadEpSettings } from "@/lib/epFlowchart";
import { usePresentationBranding, saveBranding } from "@/hooks/usePresentationBranding";


export const Presentation = ({ scenario, setScenario, stressResult, regimeResult,
                               seqResult = null, curated = false }) => {
  // Shared + written through on every change, so a page switched off in the
  // Client Deck picker stays off when the advisor moves between tabs.
  const [branding, setBranding] = usePresentationBranding();
  const [logo] = useAdvisorLogo();
  const [advisorInfo] = useAdvisorInfo();
  // Merge advisor-level fields into branding for report body consumption.
  const brandingWithAdvisor = { ...branding, ...advisorInfo };
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);
  // Comparison of the recommended strategy against the 2 alternative funding orders.
  // Populates the "Why this funding order?" narrative on the Recommendations page.
  // Shape: { orderVariants: [{ order, after_tax_estate, lifetime_taxes, ending_taxable, ending_roth }],
  //          winningOrder, baselineOrder }
  const [orderCompare, setOrderCompare] = useState(null);
  const { objectivesOn, setObjectivesOn } = useObjectivesPage();
  const { selected: flowSelected } = useFlowPlans();
  // Which pages the curated Client Deck prints (advisor-ticked, persisted).
  const { deckPages, toggleDeckPage, resetDeckPages } = useDeckPages();
  // Estate structures for the curated deck's one-page comparison. Only fetched
  // in curated mode so the full deck keeps its existing request count. Rates
  // come from the EP Flowchart tab's saved settings so the two agree.
  const [flowResult, setFlowResult] = useState(null);

  // Present-value discount rate for every "today's dollars" figure in the deck.
  // null = use the plan's own general-inflation assumption, so the PV columns can
  // never contradict the rest of the model. Advisor-adjustable; persisted per browser.
  const [pvRateOverride, setPvRateOverride] = useState(() => {
    try {
      const raw = window.localStorage.getItem("presentation_pv_rate_v1");
      const v = raw ? parseFloat(raw) : NaN;
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  });
  useEffect(() => {
    try {
      if (pvRateOverride == null) window.localStorage.removeItem("presentation_pv_rate_v1");
      else window.localStorage.setItem("presentation_pv_rate_v1", String(pvRateOverride));
    } catch { /* ignore */ }
  }, [pvRateOverride]);

  const upd = (k, v) => setBranding((b) => ({ ...b, [k]: v }));
  const persist = () => { saveBranding(branding); toast.success("Presentation settings saved."); };

  const sig = mcScenarioSig(scenario);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const tasks = [runProjection(scenario)];
      if (scenario.roth?.enabled) {
        const noCfg = JSON.parse(JSON.stringify(scenario));
        noCfg.roth.enabled = false;
        tasks.push(runProjection(noCfg));
      }
      Promise.all(tasks).then(([a, b]) => {
        if (alive) { setWithRoth(a); setNoRoth(b || a); }
      });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Funding-order comparison: run the recommended strategy against ALL 3 funding
  // orders so the Recommendations page can explain WHY the chosen order was picked
  // with concrete $ deltas. Only runs when conversions are enabled — otherwise
  // funding order is a less interesting question for the client narrative.
  useEffect(() => {
    if (!scenario?.roth?.enabled) { setOrderCompare(null); return; }
    let alive = true;
    const baselineOrder = scenario?.withdrawal?.funding_order || "Cash → Taxable → IRA → Roth";
    const ORDERS = [
      "Cash → Taxable → IRA → Roth",
      "Cash → IRA → Taxable → Roth",
      "Split IRA & Taxable",
    ];
    const t = setTimeout(() => {
      const runs = ORDERS.map((order) => {
        const c = JSON.parse(JSON.stringify(scenario));
        c.withdrawal = c.withdrawal || {};
        c.withdrawal.funding_order = order;
        return runProjection(c).then((res) => ({ order, res }));
      });
      Promise.all(runs).then((all) => {
        if (!alive) return;
        const variants = all.map(({ order, res }) => {
          const lastRow = res.rows?.[res.rows.length - 1] || {};
          return {
            order,
            after_tax_estate: res.legacy?.after_tax_estate_to_heirs || 0,
            lifetime_taxes: res.summary?.lifetime_taxes || 0,
            total_converted: res.summary?.total_roth_converted || 0,
            ending_taxable: lastRow.taxable || 0,
            ending_roth: res.summary?.ending_roth || 0,
            ending_traditional: lastRow.traditional || 0,
          };
        });
        // Rank by after-tax legacy (highest wins) with lifetime-tax tiebreak
        const ranked = [...variants].sort((a, b) =>
          (b.after_tax_estate - a.after_tax_estate) || (a.lifetime_taxes - b.lifetime_taxes)
        );
        setOrderCompare({
          variants,
          ranked,
          baselineOrder,
          winningOrder: ranked[0].order,
        });
      }).catch(() => { if (alive) setOrderCompare(null); });
    }, 500);  // slight extra delay so we don't hammer the API right after the main projection
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Longevity trade-off grid + beneficiary tax-rate band. Both are single
  // backend calls that internally run the whole matrix, so the deck stays at two
  // extra requests no matter how many rows are shown.
  const [longevity, setLongevity] = useState(null);
  const [heirSens, setHeirSens] = useState(null);
  useEffect(() => {
    let alive = true;
    setLongevity(null);
    setHeirSens(null);
    const t = setTimeout(() => {
      if (scenario?.roth?.enabled) {
        runFundingOrderLongevity(scenario)
          .then((r) => { if (alive) setLongevity(r); })
          .catch(() => { if (alive) setLongevity(null); });
      }
      runHeirRateSensitivity(scenario)
        .then((r) => { if (alive) setHeirSens(r); })
        .catch(() => { if (alive) setHeirSens(null); });
    }, 800);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Estate structures — curated deck only (two extra requests, and only on that
  // tab): the projection the flowchart reconciles to, then the flowchart itself.
  // Rates come from the EP Flowchart tab's saved settings so the two agree.
  useEffect(() => {
    if (!curated) { setFlowResult(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      const rates = loadEpSettings();
      runProjection(scenario)
        .then((proj) => {
          const req = buildEpFlowchartRequest(scenario, proj, rates);
          return req ? runEpFlowchart(req) : null;
        })
        .then((r) => { if (alive) setFlowResult(r); })
        .catch(() => { if (alive) setFlowResult(null); });
    }, 1100);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, curated]);

  const [downloading, setDownloading] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const doPrint = async () => {
    if (downloading) return;
    setDownloading(true);
    saveBranding(branding);
    // Capture the on-screen "Live preview" which is a real, visible copy of the
    // report at natural width but shown at 70% via a CSS scale transform on its
    // parent. Undo that scale before capture so html2canvas rasterizes it at
    // 100% (readable, non-blurry). The user briefly sees the preview zoom to
    // 100% while the PDF is generating.
    const wrap = document.querySelector("[data-testid='presentation-preview-wrap']");
    const originalTransform = wrap ? wrap.style.transform : "";
    const originalWidth = wrap ? wrap.style.width : "";
    if (wrap) {
      wrap.style.setProperty("transform", "none", "important");
      wrap.style.setProperty("width", "100%", "important");
    }
    // Reset any "click-to-isolate" legend state so the printed PDF captures
    // the full un-dimmed chart. Each chart's useIsolation() hook listens for
    // this event.
    window.dispatchEvent(new CustomEvent("cr-reset-isolation"));
    // Wait for the browser to apply the layout change before html2canvas measures
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await downloadElementAsPdf({
        target: "[data-testid='presentation-preview-inner']",
        filename: `${(branding.client_name_override || "client").toLowerCase().replace(/\s+/g, "-")}-${curated ? "client-deck" : "roth-plan"}.pdf`,
        format: "a4",
        orientation: "portrait",
        marginMm: 10,
      });
    } catch (e) {
      console.error("Presentation PDF export failed", e);
      toast.error("PDF generation failed. Try again or reload the page.");
    } finally {
      if (wrap) {
        wrap.style.transform = originalTransform;
        wrap.style.width = originalWidth;
      }
      setDownloading(false);
    }
  };

  const doDocx = async () => {
    // Semi-structured DOCX export — mirrors doPrint but hands the target off
    // to the docx walker instead of the PDF pipeline. See /app/frontend/src/lib/docx.js
    if (downloadingDocx) return;
    setDownloadingDocx(true);
    saveBranding(branding);
    const wrap = document.querySelector("[data-testid='presentation-preview-wrap']");
    const originalTransform = wrap ? wrap.style.transform : "";
    const originalWidth = wrap ? wrap.style.width : "";
    if (wrap) {
      wrap.style.setProperty("transform", "none", "important");
      wrap.style.setProperty("width", "100%", "important");
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await downloadElementAsDocx({
        target: "[data-testid='presentation-preview-inner']",
        filename: `${(branding.client_name_override || "client").toLowerCase().replace(/\s+/g, "-")}-${curated ? "client-deck" : "roth-plan"}.docx`,
      });
      toast.success("Word document downloaded.");
    } catch (e) {
      console.error("Presentation DOCX export failed", e);
      toast.error("DOCX generation failed. Try again.");
    } finally {
      if (wrap) {
        wrap.style.transform = originalTransform;
        wrap.style.width = originalWidth;
      }
      setDownloadingDocx(false);
    }
  };
  const rows = useMemo(() => withRoth?.rows || [], [withRoth]);
  const s = withRoth?.summary || {};
  const sn = noRoth?.summary || {};
  const lg = withRoth?.legacy || {};
  const lgn = noRoth?.legacy || {};
  const h = scenario.household || {};

  const anonymize = !!branding.anonymize_names;
  const rawClientName = branding.client_name_override || h.client_name || "Client";
  const rawSpouseName = branding.spouse_name_override || h.spouse_name || "";
  const clientName = anonymize ? "Client" : rawClientName;
  const spouseName = anonymize ? (rawSpouseName ? "Client Partner" : "") : rawSpouseName;
  const household = spouseName ? `${clientName} & ${spouseName}` : clientName;
  const prettyDate = useMemo(() => {
    const d = new Date(branding.presentation_date + "T00:00:00");
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }, [branding.presentation_date]);

  const incomeData = useMemo(() => rows.map((r) => {
    const cf = r.cashflow || {};
    return {
      year: r.year,
      Wages: cf.wages_pension || 0,
      SocialSecurity: cf.gross_ss || 0,
      Dividends: cf.dividends || 0,
      Interest: cf.interest || 0,
      RMD: cf.rmd || 0,
      // Roth conversions are excluded — they're internal transfers between
      // accounts (Traditional → Roth), not new household income. The tax
      // paid on the conversion is real and still flows into the `Need` line
      // via `income_tax`.
      Withdrawals: (cf.from_cash || 0) + (cf.from_taxable || 0) + (cf.from_ira || 0) + (cf.from_roth || 0),
      Need: (cf.expenses || 0) + (cf.income_tax || 0) + (cf.medicare || 0),
    };
  }), [rows]);

  const nwSeries = useMemo(() => rows.map((r) => ({
    year: r.year,
    withRoth: r.cash + r.traditional + r.roth + r.taxable + (r.real_estate || 0),
    withoutRoth: 0,
  })), [rows]);
  useEffect(() => {
    if (!noRoth?.rows) return;
    nwSeries.forEach((row, i) => {
      const n = noRoth.rows[i];
      if (n) row.withoutRoth = n.cash + n.traditional + n.roth + n.taxable + (n.real_estate || 0);
    });
  }, [noRoth, nwSeries]);

  const taxCompData = useMemo(() => rows.map((r) => ({ year: r.year, ...(r.tax_breakdown || {}) })), [rows]);

  // Highest conversion year (for the "spotlight" narrative)
  const bigYear = useMemo(() => {
    let best = null, bv = -1;
    rows.forEach((r) => { if ((r.roth_conversion || 0) > bv) { bv = r.roth_conversion; best = r; } });
    return best;
  }, [rows]);

  // Key numbers
  const kpis = [
    { label: "Lifetime Taxes (with strategy)", value: fmtUSD(s.lifetime_taxes), sub: `vs ${fmtUSD(sn.lifetime_taxes)} without` },
    { label: "Total Roth Conversions", value: fmtUSD(s.total_roth_converted), sub: `across ${(scenario.roth?.stop_year || 2062) - (scenario.roth?.start_year || 2026) + 1} eligible years` },
    { label: "Estate at 2nd Death", value: fmtUSD(s.ending_net_worth), sub: "gross of settlement / heir tax" },
    { label: "Wealth to Heirs (+10 yr)", value: fmtUSD(lg.after_tax_estate_to_heirs), sub: `vs ${fmtUSD(lgn.after_tax_estate_to_heirs)} without strategy` },
  ];
  const heirDelta = (lg.after_tax_estate_to_heirs || 0) - (lgn.after_tax_estate_to_heirs || 0);
  const heirTaxSaved = (lgn.inherited_ira_tax || 0) - (lg.inherited_ira_tax || 0);

  const notReady = !withRoth;
  const stressStale = !!stressResult && stressResult.scenarioSig !== sig;
  const stress = branding.include_robustness && stressResult ? stressResult : null;
  const regimeStale = !!regimeResult && regimeResult.scenarioSig !== sig;
  const regimes = branding.include_regimes && regimeResult ? regimeResult : null;
  const marketPresets = useMarketPresets();
  const marketPreset = getActivePreset(scenario, marketPresets);

  return (
    <div className="space-y-6">
      {/* Non-print form + toolbar */}
      <div className="no-print" data-testid="presentation-toolbar">
        {setScenario && (
          <PlanControlStrip scenario={scenario} setScenario={setScenario}
            testidPrefix="pres-plan-control-strip" />
        )}
        <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <StrategyBadge scenario={scenario} testid="presentation-strategy-badge" />
          <MarketBadge scenario={scenario} testid="presentation-market-badge" />
        </div>
        <div className="rounded-xl border border-[#EBE8E0] bg-[#F9F8F6] p-5 mb-4">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
                <PresentationIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-display text-base font-bold tracking-tight text-[#1A1A1A]"
                   data-testid="presentation-header-title">
                  {curated ? "Client Deck — the short, client-facing version" : "Client-facing PDF presentation"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">
                  {curated
                    ? <>One click, one short deck: cover, what the family is planning for, convert-or-skip, total household wealth, the conversion schedule, what the heirs receive, a one-page estate-structure comparison, and the disclosures. The year-by-year income, account-composition and tax-cost detail pages and the advisor / technical appendix stay in the full Presentation and the Client Report. The optional pages below still follow their own toggles.</>
                    : <>Advisor-branded narrative report your client can read on their own. Configure branding and client identification below, then click <span className="font-medium">Generate PDF</span> to download the finished deck.</>}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={persist} data-testid="presentation-save"
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                <Save className="h-4 w-4" /> Save settings
              </Button>
              <Button size="sm" onClick={doPrint} disabled={notReady || downloading || downloadingDocx} data-testid="presentation-print-btn"
                className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
                {downloading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                  : <><Printer className="h-4 w-4" /> {notReady ? "Loading…" : "Generate PDF"}</>}
              </Button>
              <Button size="sm" variant="outline" onClick={doDocx}
                disabled={notReady || downloading || downloadingDocx}
                data-testid="presentation-docx-btn"
                title="Download an editable Word document — text is editable; charts embed as images"
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                {downloadingDocx
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Building Word…</>
                  : <><FileText className="h-4 w-4" /> Generate Word (.docx)</>}
              </Button>
            </div>
          </div>

          {/* Branding form */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label className="text-[11px] label-cap"><User className="inline h-3 w-3 mr-1" />Client name</Label>
              <Input data-testid="pres-input-client" value={branding.client_name_override}
                onChange={(e) => upd("client_name_override", e.target.value)}
                placeholder={h.client_name || "(from scenario)"} className="h-9 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-[11px] label-cap"><User className="inline h-3 w-3 mr-1" />Spouse name</Label>
              <Input data-testid="pres-input-spouse" value={branding.spouse_name_override}
                onChange={(e) => upd("spouse_name_override", e.target.value)}
                placeholder={h.spouse_name || "(optional)"} className="h-9 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-[11px] label-cap">Presentation date</Label>
              <Input data-testid="pres-input-date" type="date" value={branding.presentation_date}
                onChange={(e) => upd("presentation_date", e.target.value)} className="h-9 text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3 rounded-md border border-[#C87941] bg-[#FEFAF1] px-3 py-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <Switch data-testid="pres-anonymize-toggle" checked={!!branding.anonymize_names}
                  onCheckedChange={(v) => upd("anonymize_names", !!v)} className="mt-0.5" />
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-[#8A5A20]">
                    Anonymize client identity in this presentation
                  </p>
                  <p className="text-[10.5px] text-muted-foreground leading-snug mt-1">
                    Renders the client as <strong>&ldquo;Client&rdquo;</strong> and their partner as
                    <strong> &ldquo;Client Partner&rdquo;</strong>. Preserves privacy when the deck is used
                    as a marketing sample or shared with any AI-assisted review.
                  </p>
                </div>
              </label>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Cover subtitle</Label>
              <Input data-testid="pres-input-subtitle" value={branding.cover_subtitle}
                onChange={(e) => upd("cover_subtitle", e.target.value)}
                placeholder="Roth Conversion & Retirement Analysis" className="h-9 text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Cover intro paragraph (optional)</Label>
              <Textarea data-testid="pres-input-intro" value={branding.cover_intro}
                onChange={(e) => upd("cover_intro", e.target.value)} rows={3}
                placeholder="Optional letter-style intro that appears on the cover page — e.g. 'This report explores how Roth conversions between now and Social Security can shift your family&apos;s lifetime after-tax outcome.'"
                className="text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Closing notes (optional)</Label>
              <Textarea data-testid="pres-input-closing" value={branding.closing_notes}
                onChange={(e) => upd("closing_notes", e.target.value)} rows={2}
                placeholder="Optional closing message — e.g. next steps, meeting date, etc." className="text-sm mt-1" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6 items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={branding.include_narrative} onCheckedChange={(v) => upd("include_narrative", v)}
                data-testid="pres-toggle-narrative" />
              <span className="text-xs text-muted-foreground">Client-friendly explanations under each chart</span>
            </label>
            {!curated && (<>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={branding.include_assumptions} onCheckedChange={(v) => upd("include_assumptions", v)}
                data-testid="pres-toggle-assumptions" />
              <span className="text-xs text-muted-foreground">Include assumptions page</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={branding.include_recommendations} onCheckedChange={(v) => upd("include_recommendations", v)}
                data-testid="pres-toggle-recs" />
              <span className="text-xs text-muted-foreground">Include recommendations page</span>
            </label>
            <label className={`flex items-center gap-2 ${stressResult ? "cursor-pointer" : "opacity-60"}`}>
              <Switch checked={branding.include_robustness && !!stressResult} disabled={!stressResult}
                onCheckedChange={(v) => upd("include_robustness", v)}
                data-testid="pres-toggle-robustness" />
              <span className="text-xs text-muted-foreground">
                Include robustness page (market-crash stress test)
                {!stressResult && (
                  <span className="block text-[10px] text-[#C87941]">
                    Run the Monte Carlo stress test on the Strategy Optimizer tab first.
                  </span>
                )}
                {stressResult && stressStale && (
                  <span className="block text-[10px] text-[#C87941]" data-testid="pres-robustness-stale">
                    Plan changed since the stress test ran — re-run it on the Strategy Optimizer tab for current numbers.
                  </span>
                )}
              </span>
            </label>
            <label className={`flex items-center gap-2 ${regimeResult ? "cursor-pointer" : "opacity-60"}`}>
              <Switch checked={branding.include_regimes && !!regimeResult} disabled={!regimeResult}
                onCheckedChange={(v) => upd("include_regimes", v)}
                data-testid="pres-toggle-regimes" />
              <span className="text-xs text-muted-foreground">
                Include regime-comparison page (6 market futures)
                {!regimeResult && (
                  <span className="block text-[10px] text-[#C87941]">
                    Run the Regime Comparison on the Monte Carlo tab first.
                  </span>
                )}
                {regimeResult && regimeStale && (
                  <span className="block text-[10px] text-[#C87941]" data-testid="pres-regimes-stale">
                    Plan changed since the comparison ran — re-run it on the Monte Carlo tab for current numbers.
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={branding.include_longevity} onCheckedChange={(v) => upd("include_longevity", v)}
                data-testid="pres-toggle-longevity" />
              <span className="text-xs text-muted-foreground">
                Include longevity page (funding-order trade-off at −5 / +5 / +10 / +20 survivor years)
              </span>
            </label>
            <label className={`flex items-center gap-2 ${seqResult ? "cursor-pointer" : "opacity-60"}`}>
              <Switch checked={branding.include_sequence_risk && !!seqResult} disabled={!seqResult}
                onCheckedChange={(v) => upd("include_sequence_risk", v)}
                data-testid="pres-toggle-sequence-risk" />
              <span className="text-xs text-muted-foreground">
                Include sequence-of-returns page (early / late bear + volatile paths)
                {!seqResult && (
                  <span className="block text-[10px] text-[#C87941]">
                    Run the stress test on the Sequence Risk tab first.
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={branding.include_beneficiary_band}
                onCheckedChange={(v) => upd("include_beneficiary_band", v)}
                data-testid="pres-toggle-beneficiary-band" />
              <span className="text-xs text-muted-foreground">
                Include beneficiary tax-rate band page (low / middle / high heir marginal rate)
              </span>
            </label>
            </>)}
          </div>

          <McBehaviorCard />

          {curated && (
            <DeckPagePicker deckPages={deckPages} toggleDeckPage={toggleDeckPage}
              resetDeckPages={resetDeckPages} branding={branding} upd={upd}
              objectivesOn={objectivesOn} setObjectivesOn={setObjectivesOn}
              availability={{ robustness: !!stressResult, regimes: !!regimeResult,
                              longevity: !!longevity, beneficiary_band: !!heirSens,
                              sequence_risk: !!seqResult, estate: !!flowResult }} />
          )}
        </div>

        {/* Family objectives — printed as a dollar-free page ahead of the conversion
            analysis, and saved on the scenario so the Client Report prints the same. */}
        <ObjectivesEditor scenario={scenario} setScenario={setScenario} testidPrefix="pres-objectives" />

        {/* Present-value framing — a difference decades out is not the same
            difference today, so every comparative table carries both. */}
        <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-4 mb-4"
             data-testid="pres-pv-card">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-[#1A1A1A]">Present-value framing (today&apos;s dollars)</p>
            <span className="text-xs font-bold text-[#4A6741] tabular-nums" data-testid="pres-pv-rate-value">
              {(pvRateOverride ?? (scenario?.projection?.general_inflation ?? 0.03))
                .toLocaleString(undefined, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2 })}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
            Discount rate behind every &ldquo;in today&apos;s dollars&rdquo; column in this deck — the
            convert-or-skip milestones, the year-by-year drivers, the beneficiary band, the longevity grid and
            the legacy comparison. Defaults to the plan&apos;s own general-inflation assumption
            ({((scenario?.projection?.general_inflation ?? 0.03) * 100).toFixed(1)}%) so the PV figures never
            contradict the rest of the model.
          </p>
          <div className="flex items-center gap-2">
            <input type="range" min="0" max="10" step="0.25"
              value={((pvRateOverride ?? (scenario?.projection?.general_inflation ?? 0.03)) * 100).toFixed(2)}
              onChange={(e) => setPvRateOverride(parseFloat(e.target.value) / 100)}
              className="flex-1 accent-[#4A6741]"
              data-testid="pres-pv-rate-slider" />
            <Button size="sm" variant="outline" onClick={() => setPvRateOverride(null)}
              data-testid="pres-pv-rate-reset" className="h-7 text-[10px] shrink-0">Reset to plan</Button>
          </div>
        </div>

        <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] label-cap text-muted-foreground">Live preview (scaled) — click <em>Generate PDF</em> to save</p>
            <p className="text-[11px] text-muted-foreground">
            Approx. {(curated
              ? 2 + DECK_CONTENT_KEYS.filter((k) => deckPages[k] && (k !== "estate" || !!flowResult)).length
              : 12) + (branding.include_assumptions ? 1 : 0)
              + (objectivesOn ? 1 : 0)
              + (branding.include_recommendations ? 2 : 0)
              + (stress ? 1 : 0) + (regimes ? 1 : 0)
              + (branding.include_longevity && longevity ? 1 : 0)
              + (branding.include_beneficiary_band && heirSens ? 1 : 0)
              + (branding.include_sequence_risk && seqResult ? 1 : 0)} pages
          </p>
          </div>

          {/* AI analysis of the presentation content — screen preview only,
              stays out of the printed PDF so client-facing deck reads clean. */}
          <div className="mb-4">
            <AIAnalysisCard
              testid="presentation-ai-analysis"
              title="AI analysis for your client walkthrough"
              focus="You are helping an advisor walk a client through this printed retirement plan presentation. Summarize what the deck shows in plain English, highlight the 3 most compelling numbers to emphasize during the meeting, and suggest one honest caveat the advisor should proactively address. 4-5 short paragraphs OR crisp bullets — the advisor may read this aloud."
              summary={{
                page: "Presentation",
                client_name: clientName,
                headline_kpis: kpis,
                after_tax_to_heirs_with: withRoth?.legacy?.after_tax_estate_to_heirs,
                after_tax_to_heirs_without: noRoth?.legacy?.after_tax_estate_to_heirs,
                heir_delta: heirDelta,
                heir_tax_saved: heirTaxSaved,
                total_roth_converted: withRoth?.summary?.total_roth_converted,
                biggest_conversion_year: bigYear,
                lifetime_taxes_with: withRoth?.summary?.lifetime_taxes,
                lifetime_taxes_without: noRoth?.summary?.lifetime_taxes,
                market_preset: marketPreset,
              }}
            />
          </div>

          <div className="rounded-lg border border-[#EBE8E0] bg-[#FAFAF8] p-4 overflow-hidden">
            <div style={{ transform: "scale(0.7)", transformOrigin: "top left", width: "142.85%" }}
                 data-testid="presentation-preview-wrap">
              <div className="preview-inner" data-testid="presentation-preview-inner">
                <PresentationReport
                  branding={brandingWithAdvisor} household={household} clientName={clientName}
                  prettyDate={prettyDate} scenario={scenario} withRoth={withRoth} noRoth={noRoth}
                  incomeData={incomeData} nwSeries={nwSeries} taxCompData={taxCompData}
                  kpis={kpis} heirDelta={heirDelta} heirTaxSaved={heirTaxSaved} bigYear={bigYear}
                  stress={stress} regimes={regimes} marketPreset={marketPreset} orderCompare={orderCompare}
                  longevity={longevity} heirSens={heirSens} pvRateOverride={pvRateOverride}
          objectivesOn={objectivesOn}
          curated={curated} flowResult={flowResult} flowSelected={flowSelected}
          deckPages={deckPages} seqResult={seqResult}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print-only block — visible only when body has .print-presentation */}
      <div className="presentation-print-block" data-testid="presentation-print-root">
        <PresentationReport
          branding={branding} household={household} clientName={clientName}
          prettyDate={prettyDate} scenario={scenario} withRoth={withRoth} noRoth={noRoth}
          incomeData={incomeData} nwSeries={nwSeries} taxCompData={taxCompData}
          kpis={kpis} heirDelta={heirDelta} heirTaxSaved={heirTaxSaved} bigYear={bigYear}
          stress={stress} regimes={regimes} marketPreset={marketPreset} orderCompare={orderCompare}
          longevity={longevity} heirSens={heirSens} pvRateOverride={pvRateOverride}
          objectivesOn={objectivesOn}
          curated={curated} flowResult={flowResult} flowSelected={flowSelected}
          deckPages={deckPages} seqResult={seqResult}
        />
      </div>
    </div>
  );
};

// ================================================================================
// Robustness page — deterministic winner vs the P10 robust winner, side by side.
// Data comes from the Strategy Optimizer's Monte Carlo stress test (lifted via Planner).
// ================================================================================
const StressWinnerCard = ({ tag, tagColor, s, seqPct }) => (
  <div style={{ flex: 1, border: `1px solid ${tagColor}`, background: `${tagColor}0D`, borderRadius: 8, padding: "12px 14px" }}>
    <div style={{ fontSize: 9, letterSpacing: 0.5, color: tagColor, fontWeight: 700, textTransform: "uppercase" }}>{tag}</div>
    <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 15, fontWeight: 700, color: "#1A1A1A", marginTop: 4, lineHeight: 1.25 }}>
      {s.label}
    </div>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginTop: 8 }}>
      <tbody>
        {[
          ["Legacy — average-market assumption", fmtUSD(s.det_after_tax_estate)],
          ["Legacy — P10 market assumption", fmtUSD(s.legacy?.p10)],
          ["Plan success rate", `${(s.success * 100).toFixed(1)}%`],
          [`Worst-${seqPct}% early crash`, s.seq_cohort?.success != null
            ? `${(s.seq_cohort.success * 100).toFixed(0)}% · ${fmtUSD(s.seq_cohort.median_legacy)}`
            : "—"],
        ].map(([k, v]) => (
          <tr key={k} style={{ borderBottom: "1px solid #EBE8E0" }}>
            <td style={{ padding: "4px 2px", color: "#5A5A5A" }}>{k}</td>
            <td style={{ padding: "4px 2px", textAlign: "right", fontWeight: 700 }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const StressP10Chart = ({ res, det, robust, baseline }) => {
  const same = det.label === robust.label;
  const data = res.years.map((y, i) => ({
    year: y,
    robust: robust.paths?.p10?.[i],
    det: same ? undefined : det.paths?.p10?.[i],
    baseline: baseline && baseline.label !== robust.label ? baseline.paths?.p10?.[i] : undefined,
  }));
  const fmtM = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`);
  return (
    <div data-testid="robustness-path-chart">
      <div style={{ height: 195, marginTop: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 8.5 }} tickLine={false} />
            <YAxis tickFormatter={fmtM} tick={{ fontSize: 8.5 }} width={42} tickLine={false} />
            {baseline && baseline.label !== robust.label && (
              <Line type="monotone" dataKey="baseline" dot={false} stroke="#999999" strokeWidth={1.3} strokeDasharray="5 4" isAnimationActive={false} />
            )}
            {!same && (
              <Line type="monotone" dataKey="det" dot={false} stroke="#C87941" strokeWidth={1.8} isAnimationActive={false} />
            )}
            <Line type="monotone" dataKey="robust" dot={false} stroke="#4A6741" strokeWidth={2.2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", gap: 14, justifyContent: "center", fontSize: 9, color: "#5A5A5A", marginTop: 2, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 16, borderTop: "2.5px solid #4A6741", verticalAlign: "middle", marginRight: 4 }} />{same ? det.label : robust.label}</span>
        {!same && <span><span style={{ display: "inline-block", width: 16, borderTop: "2px solid #C87941", verticalAlign: "middle", marginRight: 4 }} />{det.label}</span>}
        {baseline && baseline.label !== robust.label && (
          <span><span style={{ display: "inline-block", width: 16, borderTop: "2px dashed #999", verticalAlign: "middle", marginRight: 4 }} />No conversions</span>
        )}
      </div>
      <Sub>
        Liquid wealth, year by year, when markets run at the pessimistic 10th percentile. The early dip is the crash
        arriving right after conversion taxes were paid — watch how the strategies recover as tax-free compounding
        takes over. Only 1-in-10 market futures end below these lines.
      </Sub>
    </div>
  );
};

const RobustnessPage = ({ stress, includeNarrative }) => {
  const res = stress.result;
  const byLabel = Object.fromEntries(res.strategies.map((x) => [x.label, x]));
  const det = byLabel[res.deterministic_best_label];
  const robust = byLabel[res.robust_best_label];
  const baseline = res.strategies.find((x) => x.kind === "baseline");
  const same = !res.robust_differs;
  const seqPct = res.cohort?.worst_pct || 5;
  const engineLabel = res.engine === "historical"
    ? `real market history (${res.historical?.years_span || "1928–2024"})`
    : "statistically-modeled returns";
  const top = [...res.strategies].sort((a, b) => a.robust_rank - b.robust_rank).slice(0, 5);
  if (baseline && !top.some((x) => x.label === baseline.label)) top.push(baseline);
  if (!det || !robust) return null;

  return (
    <Page testid="presentation-page-robustness">
      <H2>What If Markets Crash Right After You Convert?</H2>
      <HoldConstantBand testid="deck-robustness-band"
        variable="the market path (average-market vs P10) and the candidate conversion schedule"
        constant="spending, longevity, funding order, beneficiary assumption, tax law" />
      {includeNarrative && (
        <P>
          A fair objection to any Roth-conversion plan: <em>&ldquo;you&apos;re asking me to pay real tax today based on an
          assumed return — what if the market falls right after I write that check?&rdquo;</em> To answer it, we replayed
          this plan against <strong>{res.n_trials.toLocaleString()} different market futures</strong> drawn from {engineLabel} —
          including bear markets and lost decades arriving in the very first years. Every candidate strategy faced the{" "}
          <strong>identical</strong> set of market paths, so any difference below comes from the strategy itself, not luck.
        </P>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        {same ? (
          <StressWinnerCard tag="Leads under both the average-market and P10 market assumptions" tagColor="#4A6741" s={det} seqPct={seqPct} />
        ) : (
          <>
            <StressWinnerCard tag="Result under the average-market assumption" tagColor="#C87941" s={det} seqPct={seqPct} />
            <StressWinnerCard tag="Result under the P10 market assumption" tagColor="#4A6741" s={robust} seqPct={seqPct} />
          </>
        )}
      </div>

      <div style={{
        marginTop: 12, padding: "10px 14px", borderRadius: 8,
        border: `1px solid ${same ? "#4A6741" : "#C87941"}`,
        background: same ? "#4A67410D" : "#C879410D",
      }}>
        <p style={{ fontSize: 11, lineHeight: 1.55, color: "#1A1A1A", margin: 0 }}>
          {same ? (
            <><strong style={{ color: "#4A6741" }}>The illustrated schedule does not depend on favorable markets.</strong>{" "}
              <strong>{det.label}</strong> leads under the average-market assumption <em>and</em> under the
              pessimistic 10th-percentile assumption. Even in the worst {seqPct}% of early-market sequences it
              preserves more for the family than the alternatives tested — a point about the sensitivity of the
              result, not a forecast.</>
          ) : (
            <><strong style={{ color: "#C87941" }}>The answer is assumption-dependent.</strong>{" "}
              <strong>{det.label}</strong> leads under the average-market assumption, while{" "}
              <strong>{robust.label}</strong> preserves more after-tax wealth under the pessimistic 10th-percentile
              assumption. One approach worth discussing: treat the more conservative schedule as the floor and
              consider accelerating conversions in down markets, reviewed annually.</>
          )}
        </p>
      </div>

      <StressP10Chart res={res} det={det} robust={robust} baseline={baseline} />

      <H3>How every candidate held up</H3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginTop: 4 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", textAlign: "left", color: "#5A5A5A" }}>
            <th style={{ padding: "5px 4px" }}>#</th>
            <th style={{ padding: "5px 4px" }}>Strategy</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Legacy — average-market assumption</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Legacy — P10 assumption</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Success</th>
          </tr>
        </thead>
        <tbody>
          {top.map((x) => (
            <tr key={x.label} style={{
              borderBottom: "1px solid #F3F1EC",
              background: x.label === res.robust_best_label ? "#4A67410D" : "transparent",
            }}>
              <td style={{ padding: "5px 4px", fontWeight: 600 }}>{x.robust_rank}</td>
              <td style={{ padding: "5px 4px" }}>
                {x.label}
                {x.label === res.deterministic_best_label && <span style={{ color: "#C87941", fontSize: 9, fontWeight: 700 }}> · leads on average markets</span>}
                {x.label === res.robust_best_label && <span style={{ color: "#4A6741", fontSize: 9, fontWeight: 700 }}> · leads at P10</span>}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right" }}>{fmtUSD(x.det_after_tax_estate)}</td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontWeight: 700 }}>{fmtUSD(x.legacy?.p10)}</td>
              <td style={{ padding: "5px 4px", textAlign: "right" }}>{(x.success * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Sub>
        Method: {res.n_trials.toLocaleString()} paired Monte Carlo trials ({res.engine === "historical"
          ? `block bootstrap of ${res.historical?.years_span || "1928–2024"} US market data`
          : "lognormal return model"}), anchored to the plan&apos;s assumed return; each strategy&apos;s conversion
        schedule and taxes are locked from its own deterministic projection. &ldquo;Legacy&rdquo; is the after-tax
        wealth reaching heirs at second death + SECURE 10-year horizon; Monte Carlo values are approximated from each
        strategy&apos;s ending account mix. P10 = only 1-in-10 market futures end worse.
      </Sub>
    </Page>
  );
};

// ================================================================================
// Regime Comparison page — the same simulation re-run under all six named market
// regimes. Data comes from the Monte Carlo tab's Regime Comparison panel (lifted
// via Planner). Print-friendly mirror of RegimeComparePanel's table.
// ================================================================================
const regimeBarColor = (s) => (s >= 0.90 ? "#4A6741" : s >= 0.75 ? "#C4A64A" : "#C87941");
const regimeTextColor = (s) => (s >= 0.90 ? "#4A6741" : s >= 0.75 ? "#8A6820" : "#B84A4A");

const RegimeComparePage = ({ regimes, includeNarrative }) => {
  const res = regimes.result;
  const rows = res?.rows || [];
  if (!rows.length) return null;
  const baseline = rows.find((r) => r.preset_id === res.baseline_id) || rows[0];
  const weak = rows.filter((r) => r.success < 0.75);
  const passing = rows.length - weak.length;
  const winner = rows[0];
  const loser = rows[rows.length - 1];
  const spreadPts = Math.round((winner.success - loser.success) * 100);
  const allHold = weak.length === 0;

  const verdict = allHold
    ? (spreadPts <= 5
      ? `The plan holds up in all ${rows.length} futures we tested — the success rate barely moves whichever era plays out. The illustrated schedule does not depend on being right about the market.`
      : `The plan holds up in all ${rows.length} futures we tested, though success spans ${spreadPts} points between the friendliest era (${winner.label}) and the harshest (${loser.label}).`)
    : `The exception${weak.length > 1 ? "s" : ""}: ${weak.map((r) => `${r.label} (${fmtPct(r.success)} success)`).join("; ")} — worth a contingency conversation, not a reason to abandon the strategy.`;

  return (
    <Page testid="presentation-page-regimes">
      <H2>Does the Plan Survive Different Futures?</H2>
      <HoldConstantBand testid="deck-regimes-band"
        variable="the market regime (return and volatility assumptions)"
        constant="conversion schedule, spending, longevity, funding order, beneficiary assumption" />
      {includeNarrative && (
        <P>
          Nobody knows which market era comes next. So instead of betting the plan on one forecast, we re-ran the{" "}
          <strong>same {res.n_trials.toLocaleString()}-trial simulation</strong> under six named market regimes — from
          the long-run historical average to a 1970s-style stagflation and a 2000s-style lost decade. Every regime faced
          the identical sequence of random shocks, so the differences below come entirely from each regime&apos;s return
          and inflation assumptions — not luck.
        </P>
      )}

      <div style={{
        marginTop: 10, marginBottom: 12, padding: "10px 14px", borderRadius: 8,
        border: `1px solid ${allHold ? "#4A6741" : "#C87941"}`,
        background: allHold ? "#4A67410D" : "#C879410D",
      }}>
        <p style={{ fontSize: 11, lineHeight: 1.55, color: "#1A1A1A", margin: 0 }} data-testid="regime-page-verdict">
          <strong style={{ color: allHold ? "#4A6741" : "#C87941" }}>
            {allHold ? "Regime-resilient." : `The plan works in ${passing} of ${rows.length} futures.`}
          </strong>{" "}{verdict}
        </p>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }} data-testid="regime-page-table">
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", textAlign: "left", color: "#5A5A5A" }}>
            <th style={{ padding: "5px 4px" }}>Market Regime</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Success</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>Δ vs. baseline</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>P10 legacy</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>P50 legacy</th>
            <th style={{ padding: "5px 4px", textAlign: "right" }}>P90 legacy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isBaseline = r.preset_id === res.baseline_id;
            const isTopSuccess = i === 0;
            const isLoser = i === rows.length - 1;
            const delta = r.success - baseline.success;
            return (
              <tr key={r.preset_id} data-testid={`regime-page-row-${r.preset_id}`} style={{
                borderBottom: "1px solid #F3F1EC",
                background: isBaseline ? "#4A67410D" : "transparent",
              }}>
                <td style={{ padding: "6px 4px" }}>
                  <span style={{ fontWeight: 600 }}>{r.label}</span>
                  {isTopSuccess && (
                    <span style={{ marginLeft: 6, fontSize: 8, color: "#4A6741", fontWeight: 700,
                                   textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>
                      highest success in this set
                    </span>
                  )}
                  {isBaseline && (
                    <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: "#C87941", border: "1px solid #C87941", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
                      Your baseline
                    </span>
                  )}
                  {isLoser && !isBaseline && (
                    <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: "#5A5A5A", border: "1px solid #C9C6BD", background: "#F3F1EC", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
                      Worst case
                    </span>
                  )}
                  <div style={{ marginTop: 4, height: 5, borderRadius: 3, background: "#F3F1EC", maxWidth: 260, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      width: `${Math.max(2, Math.round(r.success * 100))}%`,
                      background: regimeBarColor(r.success),
                      WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
                    }} />
                  </div>
                </td>
                <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: 700, color: regimeTextColor(r.success) }}>{fmtPct(r.success)}</td>
                <td style={{ padding: "6px 4px", textAlign: "right", fontSize: 9.5, color: delta > 0.001 ? "#4A6741" : delta < -0.001 ? "#C87941" : "#8A8A82" }}>
                  {isBaseline ? "—" : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} pts`}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "right", fontSize: 9.5 }}>{fmtUSD(r.p10)}</td>
                <td style={{ padding: "6px 4px", textAlign: "right", fontSize: 9.5 }}>{fmtUSD(r.p50)}</td>
                <td style={{ padding: "6px 4px", textAlign: "right", fontSize: 9.5 }}>{fmtUSD(r.p90)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Sub>
        Method: the same conversion plan and the same {res.n_trials.toLocaleString()} random market paths (shared seed)
        re-run under each regime&apos;s return + inflation assumptions ({res.engine === "historical" ? "historical bootstrap" : "lognormal"} engine).
        &ldquo;Success&rdquo; = the portfolio is never depleted. Legacy percentiles approximate the after-tax value reaching
        heirs. Bars: green ≥ 90% · amber 75–90% · orange &lt; 75%.
      </Sub>
    </Page>
  );
};

// ================================================================================
// Funding-Order Rationale — trade-off narrative + 3-row comparison
// The comparison table stays (it is data), but the narrative deliberately does
// NOT crown a winner: which side of the trade-off wins depends on longevity and
// on facts nobody can know in advance. Advisor-authored copy, do not "improve".
// ================================================================================
const ORDER_MECHANIC = {
  "Cash → Taxable → IRA → Roth":
    "spends down Taxable brokerage first, preserving IRA balance for future conversions and RMDs",
  "Cash → IRA → Taxable → Roth":
    "draws down IRA first, forcing early ordinary-rate tax but shrinking future RMD burdens",
  "Split IRA & Taxable":
    "blends IRA and Taxable withdrawals to smooth marginal-rate exposure across years",
};

const FundingOrderRationale = ({ scenario, orderCompare }) => {
  if (!scenario?.roth?.enabled || !orderCompare || !orderCompare.ranked?.length) return null;

  const baselineOrder = orderCompare.baselineOrder;
  const baseline = orderCompare.variants.find((v) => v.order === baselineOrder);
  const top = orderCompare.ranked[0];
  const loser = orderCompare.ranked[orderCompare.ranked.length - 1];
  if (!baseline || !top) return null;

  const taxDelta = top.lifetime_taxes - loser.lifetime_taxes;

  return (
    <div data-testid="presentation-funding-rationale">
      <H3>3. Funding order — a trade-off, not a leader</H3>
      <P>
        Funding order represents a trade-off. Using Traditional IRA assets to fund tax liabilities associated
        with conversion creates a circular income tax calculation, which can also reduce Traditional IRA balances
        available for conversion to Roth IRA assets with positive tax-free compounding benefits. If instead
        taxable assets are liquidated to pay taxes associated with Roth conversions, the step-up in basis at death
        capital-gains tax benefit available to the Client and the surviving Spouse is reduced. Using taxable assets
        to subsidize Roth IRA conversions results in higher Roth IRA balances, and whether one strategy or the
        other produces a benefit is often a function of the longevity of the Client and the surviving Spouse.
        There is no one-size-fits-all leader to this trade-off.
      </P>
      <P>
        Your plan currently uses <strong>{baselineOrder}</strong>, which{" "}
        {ORDER_MECHANIC[baselineOrder]}. The table below shows the same conversion strategy run through all three
        withdrawal orders so you can see how the trade-off plays out under these particular assumptions.
      </P>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 10.5,
          marginTop: 4,
          marginBottom: 10,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A" }}>
            <th style={{ padding: "5px 4px", textAlign: "left", fontWeight: 600 }}>Withdrawal Order</th>
            <th style={{ padding: "5px 4px", textAlign: "right", fontWeight: 600 }}>After-tax legacy</th>
            <th style={{ padding: "5px 4px", textAlign: "right", fontWeight: 600 }}>Lifetime tax</th>
            <th style={{ padding: "5px 4px", textAlign: "right", fontWeight: 600 }}>Ending Taxable (step-up)</th>
            <th style={{ padding: "5px 4px", textAlign: "right", fontWeight: 600 }}>Ending Roth</th>
          </tr>
        </thead>
        <tbody>
          {orderCompare.ranked.map((v, i) => {
            const isTop = i === 0;
            const isCurrent = v.order === baselineOrder;
            return (
              <tr
                key={v.order}
                data-testid={`funding-rationale-row-${i}`}
                style={{
                  borderBottom: "1px solid #F3F1EC",
                  background: isTop ? "#4A67410D" : undefined,
                  fontWeight: isTop ? 700 : 500,
                }}
              >
                <td style={{ padding: "5px 4px" }}>
                  {isTop && <span style={{ color: "#4A6741" }}>★ </span>}
                  {v.order}
                  {isCurrent && (
                    <span
                      style={{
                        marginLeft: 6,
                        display: "inline-block",
                        border: "1px solid #C87941",
                        color: "#C87941",
                        borderRadius: 999,
                        padding: "1px 6px",
                        fontSize: 8.5,
                        fontWeight: 700,
                        letterSpacing: 0.3,
                        textTransform: "uppercase",
                      }}
                    >
                      Current
                    </span>
                  )}
                </td>
                <td style={{ padding: "5px 4px", textAlign: "right", color: isTop ? "#4A6741" : undefined }}>
                  {fmtUSD(v.after_tax_estate)}
                </td>
                <td style={{ padding: "5px 4px", textAlign: "right", color: "#C87941" }}>
                  {fmtUSD(v.lifetime_taxes)}
                </td>
                <td style={{ padding: "5px 4px", textAlign: "right" }}>
                  {fmtUSD(v.ending_taxable)}
                </td>
                <td style={{ padding: "5px 4px", textAlign: "right" }}>
                  {fmtUSD(v.ending_roth)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Sub>
        Same conversion strategy, three withdrawal orders. Lifetime tax is nominal; the last two columns
        show ending account balances, which drive step-up (Taxable) vs SECURE-10 taxation (Traditional IRA
        left to heirs) at second death. ★ marks the order that produced the highest after-tax legacy under
        these particular assumptions — it is a projection outcome, not a recommendation, and it can reverse
        with different longevity, market, or beneficiary-rate assumptions.{" "}
        {taxDelta > 0
          ? `That order also carries ${fmtUSD(taxDelta)} more lifetime tax than the lowest-legacy order: current tax paid earlier in exchange for a projected later benefit.`
          : taxDelta < 0
            ? `That order also carries ${fmtUSD(Math.abs(taxDelta))} less lifetime tax under these assumptions.`
            : ""}
      </Sub>
    </div>
  );
};

// ================================================================================
// The report itself — used both for the on-screen preview and the print output
// ================================================================================
const PresentationReport = ({
  branding, household, clientName, prettyDate, scenario, withRoth, noRoth,
  incomeData, nwSeries, taxCompData, kpis, heirDelta, heirTaxSaved, bigYear, stress,
  regimes, marketPreset, orderCompare, longevity, heirSens, pvRateOverride, objectivesOn,
  curated = false, flowResult, flowSelected, deckPages, seqResult,
}) => {
  // The curated Client Deck prints exactly the pages the advisor ticked; the
  // full Presentation always prints its complete page set.
  const show = (k) => (curated ? !!deckPages?.[k] : true);
  const [logo] = useAdvisorLogo();
  const s = withRoth?.summary || {};
  const sn = noRoth?.summary || {};
  const lg = withRoth?.legacy || {};
  const lgn = noRoth?.legacy || {};
  // Shared PV engine for every "today's dollars" figure in the deck.
  const pv = useMemo(() => makePv(scenario, pvRateOverride, withRoth?.rows),
    [scenario, pvRateOverride, withRoth]);
  const heirHorizon = scenario?.legacy?.post_death_years ?? 10;
  const secondDeathYear = withRoth?.legacy?.second_death_year
    ?? (withRoth?.rows?.length ? withRoth.rows[withRoth.rows.length - 1].year : null);
  const heirDeliverYear = secondDeathYear ? secondDeathYear + heirHorizon : null;
  const rothStart = scenario.roth?.start_year;
  // The scenario field is `end_year`; an earlier `stop_year` read left the deck
  // printing "between 2026 and " with a blank stop year. Kept as a fallback.
  const rothStop = scenario.roth?.end_year ?? scenario.roth?.stop_year;
  // Window ACTUALLY modeled (permitted window vs the years the engine converted in).
  const convYears = (withRoth?.rows || []).filter((r) => (r.roth_conversion || 0) > 0).map((r) => r.year);
  const modeledStart = convYears.length ? convYears[0] : null;
  const modeledStop = convYears.length ? convYears[convYears.length - 1] : null;
  const rothTargetPct = fmtPct(scenario.roth?.target_bracket_pct);
  const stateName = scenario.tax?.state_code || "your state";
  const filingStatus = scenario.household?.filing_status || "MFJ";
  const genInflation = fmtPct(scenario.projection?.general_inflation);
  const strat = getStrategyLabel(scenario);

  // Approximate tax paid on the Roth conversions themselves — sum of
  // (conversion amount × that year's ordinary marginal rate). Each year's
  // conversion sits at the top of ordinary income, so its last-dollar tax
  // rate IS the marginal rate. Always non-negative; robust when noRoth
  // hasn't loaded yet. Powers the cashflow summary chip below the
  // Sources of Income chart.
  const conversionTaxApprox = (withRoth?.rows || []).reduce(
    (acc, r) => acc + (r.roth_conversion || 0) * (r.marginal_rate || 0), 0);

  // ---- Dynamic base-household narrative (mirrors the White Paper block) ----
  // Every field is computed from the live scenario so the Assumptions page never
  // drifts from the actual inputs driving the projection.
  const baseHousehold = useMemo(() => {
    const hh = scenario.household || {};
    const startYear = scenario.projection?.start_year;
    const endYear = scenario.projection?.end_year;
    const clientAge = startYear && hh.client_dob_year ? startYear - hh.client_dob_year : null;
    const spouseAge = startYear && hh.spouse_dob_year ? startYear - hh.spouse_dob_year : null;
    const clientEnd = hh.client_dob_year && hh.client_life_expectancy ? hh.client_dob_year + hh.client_life_expectancy : null;
    const spouseEnd = hh.spouse_dob_year && hh.spouse_life_expectancy ? hh.spouse_dob_year + hh.spouse_life_expectancy : null;
    const secondDeath = clientEnd && spouseEnd ? Math.max(clientEnd, spouseEnd) : endYear;
    const horizon = secondDeath && startYear ? secondDeath - startYear : null;

    const accounts = scenario.accounts || [];
    const sumOf = (types) => accounts
      .filter((a) => types.includes(a.tax_type))
      .reduce((t, a) => t + (a.beginning_balance || 0), 0);
    const basisOf = (types) => accounts
      .filter((a) => types.includes(a.tax_type))
      .reduce((t, a) => t + (a.cost_basis || 0), 0);

    const cash = sumOf(["Cash"]);
    const taxable = sumOf(["Taxable"]);
    const taxableBasis = basisOf(["Taxable"]);
    const ira = sumOf(["Tax-Deferred"]);
    const roth = sumOf(["Tax-Free"]);
    const home = sumOf(["Real Estate"]);
    const totalAssets = cash + taxable + ira + roth + home;
    const embeddedGainPct = taxable > 0 ? Math.round(((taxable - taxableBasis) / taxable) * 100) : 0;

    // Core annual spending — sum of "Living Expenses" category (annual frequency)
    const coreSpending = (scenario.expenses || [])
      .filter((e) => e.category === "Living Expenses" && e.frequency === "Annual" && e.use !== false)
      .reduce((t, e) => t + (e.amount || 0), 0);
    const spendingInflation = ((scenario.projection?.general_inflation || 0) * 100).toFixed(0);
    const dividendYield = ((scenario.dividend_yield || 0) * 100).toFixed(0);
    const stateRate = ((scenario.tax?.state_rate || 0) * 100).toFixed(2);
    const irmaaOn = scenario.tax?.include_irmaa !== false;

    const heirFed = ((scenario.legacy?.heir_federal_rate || 0) * 100);
    const heirState = ((scenario.legacy?.heir_state_rate || 0) * 100);
    const heirBlended = (heirFed + heirState).toFixed(0);
    const heirLtcgPct = ((scenario.legacy?.heir_ltcg_rate || 0) * 100).toFixed(2);
    const estatePct = ((scenario.legacy?.estate_settlement_pct || 0) * 100).toFixed(0);
    const postDeath = scenario.legacy?.post_death_years || 10;
    const realized = scenario.legacy?.heir_gains_realized;

    const fundingOrder = scenario.withdrawal?.funding_order || "Cash → Taxable → IRA → Roth";
    const rothEnabled = !!scenario.roth?.enabled;

    const equity = ((scenario.projection?.ira_return || 0.07) * 100).toFixed(0);
    const cashRet = ((scenario.projection?.cash_return || 0.03) * 100).toFixed(0);
    const cpi = ((scenario.projection?.general_inflation || 0.03) * 100).toFixed(0);
    const regimeLbl = marketPreset ? marketPreset.label : "long-term-average";

    return {
      hasAges: clientAge != null && spouseAge != null,
      clientAge, spouseAge, secondDeath, horizon,
      totalAssets, cash, taxable, taxableBasis, embeddedGainPct, ira, roth, home,
      coreSpending, spendingInflation, dividendYield, stateRate, irmaaOn,
      heirBlended, heirFed: heirFed.toFixed(0), heirState: heirState.toFixed(0), heirLtcgPct,
      estatePct, postDeath, realized, fundingOrder, rothEnabled,
      equity, cashRet, cpi, regimeLbl, rothStart, rothStop,
    };
  }, [scenario, marketPreset, rothStart, rothStop]);

  const fmtM = (v) => {
    if (v == null) return "—";
    const abs = Math.abs(v);
    if (abs >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 1)}M`;
    if (abs >= 1e3) return `$${Math.round(v / 1e3)}K`;
    return `$${Math.round(v)}`;
  };

  if (!withRoth) return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>Loading projection…</div>;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "Outfit, 'Helvetica Neue', sans-serif", color: "#1A1A1A" }}>
      {/* ---------- Page 1: Cover ---------- */}
      <Page testid="presentation-page-cover" first>
        <LogoHeader logo={logo} testid="presentation-cover-logo" />
        <div style={{ background: "linear-gradient(135deg, #4A6741 0%, #3B5234 100%)", color: "#fff", padding: "28px 30px", borderRadius: 8, marginBottom: 18 }}>
          <div style={{ fontSize: 10, opacity: 0.85, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            {branding.advisor_firm || "Retirement Analysis"}
          </div>
          <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 26, lineHeight: 1.15 }}>
            {branding.cover_subtitle || "Roth Conversion & Retirement Analysis"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 8 }}>
            Prepared for <strong>{household}</strong>
          </div>
          <div
            data-testid="presentation-cover-strategy"
            style={{
              marginTop: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.35)",
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 11,
              lineHeight: 1.3,
              color: "#fff",
              maxWidth: "100%",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", opacity: 0.85, fontWeight: 700 }}>Strategy modeled</span>
            <strong style={{ fontWeight: 700 }}>{strat.label}</strong>
            <span style={{ opacity: 0.7 }}>·</span>
            <span>Funding: <strong style={{ fontWeight: 600 }}>{strat.fundingOrder}</strong></span>
          </div>
          {marketPreset && (
            <div
              data-testid="presentation-cover-market"
              style={{
                marginTop: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.35)",
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 11,
                lineHeight: 1.3,
                color: "#fff",
                maxWidth: "100%",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", opacity: 0.85, fontWeight: 700 }}>Market assumption</span>
              <strong style={{ fontWeight: 700 }}>{marketPreset.label}</strong>
            </div>
          )}
        </div>

        {branding.cover_intro && (
          <div style={{ padding: "12px 16px", background: "#F9F8F6", borderLeft: "4px solid #4A6741", marginBottom: 20 }}>
            <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "#2A2A2A", fontStyle: "italic", margin: 0 }}>
              {branding.cover_intro}
            </p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 20 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ padding: "12px 14px", border: "1px solid #EBE8E0", borderRadius: 8, background: "#F9F8F6" }}>
              <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700 }}>{k.label}</div>
              <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 700, color: "#1A1A1A", marginTop: 4 }}>{k.value}</div>
              <div style={{ fontSize: 9, color: "#777", marginTop: 2 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
          <div style={{ flex: 1, border: "1px solid #4A6741", background: "#4A67410D", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, letterSpacing: 0.5, color: "#4A6741", fontWeight: 700, textTransform: "uppercase" }}>Extra Inheritance</div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 22, fontWeight: 700, color: heirDelta >= 0 ? "#4A6741" : "#C87941" }}>
              {heirDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(heirDelta))}
            </div>
            <div style={{ fontSize: 9, color: "#777", marginTop: 2 }}>more to heirs at 2nd death + {lg.horizon_years || 10} yrs</div>
          </div>
          <div style={{ flex: 1, border: "1px solid #C87941", background: "#C879410D", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, letterSpacing: 0.5, color: "#C87941", fontWeight: 700, textTransform: "uppercase" }}>Heir Tax Saved</div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 22, fontWeight: 700, color: heirTaxSaved >= 0 ? "#4A6741" : "#C87941" }}>
              {heirTaxSaved >= 0 ? "−" : "+"}{fmtUSD(Math.abs(heirTaxSaved))}
            </div>
            <div style={{ fontSize: 9, color: "#777", marginTop: 2 }}>less tax on the inherited IRA over 10 yrs</div>
          </div>
        </div>

        {/* AI-use disclosure footnote for Presentation deck cover. */}
        <div data-testid="pres-cover-ai-disclosure"
             style={{ marginTop: 18, padding: "10px 12px", background: "#FFF4E6",
                      border: "1px solid #E5B87A", borderRadius: 6, fontSize: 9.5,
                      lineHeight: 1.55, color: "#5A3A0F" }}>
          <strong style={{ display: "block", marginBottom: 4, color: "#8A5A20", letterSpacing: 0.3 }}>
            A note on AI-assisted evaluations
          </strong>
          This presentation is generated by a static tax-planning engine — no
          AI-assisted evaluations were used to produce the numbers or narrative.
          If you wish to run an AI-generated second opinion, you may download
          this PDF and evaluate it using any AI tool of your choice, at your own
          expense and subject to that AI program&apos;s privacy restrictions and
          data-handling limitations.
        </div>

        <div style={{ marginTop: 30, paddingTop: 14, borderTop: "1px solid #EBE8E0", fontSize: 10, color: "#777", display: "flex", justifyContent: "space-between" }}>
          <div>
            {branding.advisor_name && <div style={{ color: "#1A1A1A", fontWeight: 600 }}>{branding.advisor_name}</div>}
            {branding.advisor_email && <div>{branding.advisor_email}</div>}
            {branding.advisor_phone && <div>{branding.advisor_phone}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div>Prepared {prettyDate}</div>
            <div style={{ marginTop: 4, display: "inline-block", border: "1px solid #4A6741", borderRadius: 999, padding: "2px 10px", fontSize: 9, color: "#4A6741", fontWeight: 600 }}>
              Current law · OBBBA 2025 permanent brackets
            </div>
          </div>
        </div>
      </Page>

      {show("summary") && (<>
      {/* ---------- Page 2: Executive Summary (narrative) ---------- */}
      <Page testid="presentation-page-summary">
        <H2>Executive Summary</H2>
        <P>
          This analysis models {household}&apos;s income, taxes, and account balances year-by-year through both spouses&apos;
          projected lifetimes, then continues for {lg.horizon_years || 10} additional years to capture the SECURE-Act
          10-year distribution window for your heirs. The engine tracks ordinary income and preferential-rate (dividends and
          long-term capital gains) separately, applies IRMAA, NIIT, and state tax with a two-year lookback, and honors the
          {filingStatus === "MFJ" ? " Married-Filing-Jointly " : ` ${filingStatus} `} bracket transitions at first death.
        </P>
        <P>
          The illustrated Roth-conversion schedule fills{rothTargetPct ? ` up to the ${rothTargetPct} bracket` : " the target bracket"}
          {rothStart && rothStop ? ` between ${rothStart} and ${rothStop}` : ""}, using{" "}
          <strong>{scenario.withdrawal?.funding_order || "Cash → IRA → Taxable → Roth"}</strong> as the spending order.
          Compared with leaving the IRA to compound and pass to heirs at their assumed marginal rate, this
          illustration produces:
        </P>
        <ul style={{ fontSize: 11, lineHeight: 1.6, color: "#2A2A2A", paddingLeft: 18, marginBottom: 10 }}>
          <li><strong>{fmtUSD(s.total_roth_converted)}</strong> moved from Traditional to Roth over the plan horizon</li>
          <li><strong>{heirDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(heirDelta))}</strong> in additional wealth passed to heirs (after all taxes)</li>
          <li><strong>{heirTaxSaved >= 0 ? "−" : "+"}{fmtUSD(Math.abs(heirTaxSaved))}</strong> in heir income tax saved on the inherited IRA</li>
          <li>Ending Roth balance of <strong>{fmtUSD(s.ending_roth)}</strong> — no RMDs during life; income-tax free through the SECURE Act 10-year distribution window for heirs</li>
        </ul>
        <P>
          {show("income")
            ? <>The chart on the next page shows year-by-year income sources; the pages after that trace wealth by
                account, the conversion schedule itself, and the tax cost that pays for the strategy.</>
            : <>The pages that follow trace total household wealth, the conversion schedule itself, and what reaches
                your heirs after every tax is paid.</>}
        </P>
      </Page>
      </>)}

      {/* ---------- Page 3: Assumptions (optional) ---------- */}
      {branding.include_assumptions && (
        <Page testid="presentation-page-assumptions">
          <H2>Assumptions</H2>
          <P>
            All figures below assume current federal tax law (OBBBA 2025 — the permanent, inflation-indexed extension of
            TCJA brackets). Actual future rates and inflation may differ; this report should be re-run whenever tax law or
            economic assumptions materially change.
          </P>

          {/* Base-household narrative — mirrors the White Paper block, but every
              field is computed live from the current scenario so this page
              always matches the projection driving the rest of the deck. */}
          <div data-testid="presentation-base-household"
               style={{ borderLeft: "3px solid rgba(74,103,65,0.5)", background: "#F9F8F6", padding: "10px 14px", fontSize: 11, lineHeight: 1.55, color: "#2A2A2A", marginBottom: 12, borderRadius: 4 }}>
            <strong>Base household.</strong> {filingStatus === "Married Filing Jointly" ? "Married couple" : "Household"}
            {baseHousehold.hasAges && `, ages ${baseHousehold.clientAge}/${baseHousehold.spouseAge}`} in
            {" "}{scenario.projection?.start_year}
            {baseHousehold.secondDeath && `, planned to second death ${baseHousehold.secondDeath}${baseHousehold.horizon ? ` (a ${baseHousehold.horizon}-year horizon)` : ""}`}.
            Starting assets ≈ <strong>{fmtM(baseHousehold.totalAssets)}</strong>: {fmtM(baseHousehold.cash)} cash,
            {" "}{fmtM(baseHousehold.taxable)} taxable brokerage with a {fmtM(baseHousehold.taxableBasis)} basis
            {baseHousehold.taxable > 0 && (
              <> (<strong>{baseHousehold.embeddedGainPct}% embedded gain</strong>)</>
            )},
            {" "}{fmtM(baseHousehold.ira)} traditional IRA, {fmtM(baseHousehold.roth)} Roth, {fmtM(baseHousehold.home)} residence.
            {baseHousehold.coreSpending > 0 && (
              <> Core spending {fmtM(baseHousehold.coreSpending)}/yr plus medical, inflated {baseHousehold.spendingInflation}%.</>
            )}{" "}
            Qualified-dividend yield {baseHousehold.dividendYield}%. State tax {baseHousehold.stateRate}%
            {baseHousehold.irmaaOn ? "; IRMAA modeled" : "; IRMAA not modeled"}.
            {" "}Market assumptions: {baseHousehold.regimeLbl} regime — {baseHousehold.equity}% equities,
            {" "}{baseHousehold.cashRet}% cash, {baseHousehold.cpi}% CPI.
            {" "}Spending order: <strong>{baseHousehold.fundingOrder}</strong>. Heirs:
            {" "}<strong>{baseHousehold.heirBlended}%</strong> blended ordinary ({baseHousehold.heirFed}% federal + {baseHousehold.heirState}% state),
            {" "}<strong>{baseHousehold.heirLtcgPct}%</strong> dividend/LTCG; {baseHousehold.estatePct}% estate settlement; step-up at death;
            {" "}{baseHousehold.postDeath}-year SECURE horizon;{" "}
            <strong>default heir-realization assumption: post-death gains {baseHousehold.realized ? "fully realized" : "never realized"}</strong>.
            {baseHousehold.rothEnabled && baseHousehold.rothStart && baseHousehold.rothStop && (
              <> Conversions are bracket-managed within a {baseHousehold.rothStart}–{baseHousehold.rothStop} window: each year RMDs come out first and conversions fill the remaining headroom up to the target bracket.</>
            )}{" "}
            Dollar figures are nominal model outputs, not present values.
          </div>

          <McBehaviorNote variant="box" testid="deck-assumptions-mc-behavior-note" />

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 8 }}>
            <tbody>
              {[
                ["Filing status", filingStatus],
                ["Plan window", `${scenario.projection?.start_year} → ${scenario.projection?.end_year}`],
                ["Market scenario", marketPreset ? marketPreset.label : "Historical Average"],
                ["General inflation", genInflation],
                ["Portfolio assumed return (IRA / Roth)", fmtPct(scenario.projection?.ira_return || 0.07)],
                ["Taxable account net return (after dividend tax)", `≈ ${((scenario.projection?.ira_return || 0.07) * 100 - (scenario.dividend_yield || 0.01) * 100 * 0.2345).toFixed(1)}% (${((scenario.projection?.ira_return || 0.07) * 100).toFixed(0)}% gross − ${((scenario.dividend_yield || 0.01) * 100).toFixed(0)}% dividend drag)`],
                ["Cash return", fmtPct(scenario.projection?.cash_return || 0.03)],
                ["Roth conversion window (permitted)", `${rothStart || "—"} → ${rothStop || "—"}`],
                ["Roth conversion window (actually modeled)",
                  modeledStart && modeledStop ? `${modeledStart} → ${modeledStop}` : "No conversions modeled"],
                ["Target bracket", rothTargetPct || "—"],
                ["State (income tax)", stateName],
                ["Heir federal + state marginal rate", `${fmtPct(scenario.legacy?.heir_federal_rate || 0)} + ${fmtPct(scenario.legacy?.heir_state_rate || 0)}`],
                ["Post-death horizon (SECURE)", `${scenario.legacy?.post_death_years || 10} years`],
              ].map(([k, v]) => (
                <tr key={k} style={{ borderBottom: "1px solid #F3F1EC" }}>
                  <td style={{ padding: "6px 4px", color: "#5A5A5A" }}>{k}</td>
                  <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: 600 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Sub>
            The engine has been reconciled to a benchmark spreadsheet (Retirement Optimizer V17) to within 0.4% on total conversions
            and 0.3% on wealth-to-heirs. Full methodology in the White Paper.
          </Sub>
        </Page>
      )}

      {/* ---------- Page 3a: What are we planning for? (objectives, opt-in) ---------- */}
      {objectivesOn && (
        <ObjectivesDeckPage scenario={scenario} household={household}
          includeNarrative={branding.include_narrative} />
      )}

      {/* ---------- Page 3b: Convert or Don't Convert ---------- */}
      {show("convert_skip") && noRoth && <ConvertSkipDeckPage withRoth={withRoth} noRoth={noRoth} scenario={scenario}
        pvRateOverride={pvRateOverride} includeNarrative={branding.include_narrative} />}

      {/* ---------- Pages 4–5c: the full-deck detail run (dropped from the
           curated client deck, which keeps only the pages a client should see) ---------- */}
      {show("income") && (<>
      {/* ---------- Page 4: Sources of Income & Spending ---------- */}
      <Page testid="presentation-page-income">
        <H2>Sources of Income and Spending</H2>
        {branding.include_narrative && (
          <P>
            The stacked bars show every year&apos;s <em>real</em> income sources — wages / pension, Social Security,
            dividends, interest, RMDs and portfolio withdrawals — against the total spending + tax need shown as a
            black line. <strong>Roth conversions do not appear on this chart</strong>: they&apos;re internal transfers
            from your Traditional IRA to your Roth IRA (same household, different tax pocket), not new dollars arriving.
            The income tax you owe on each conversion is real — it&apos;s already included in the black spending line.
          </P>
        )}
        <ChartCard minHeight={460}
                   testid="chart-income-sources-card"
                   exportFilename="income-sources"
                   exportData={incomeData}>
          <IncomeSourcesChart data={incomeData} />
        </ChartCard>
        {branding.include_narrative && (
          <div className="mt-3 rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] px-4 py-3"
               data-testid="presentation-conversion-cashflow-summary"
               style={{ pageBreakInside: "avoid" }}>
            <p className="text-[11px] text-muted-foreground">
              <strong className="text-[#4A6741]">Total dollars converted:</strong>{" "}
              <span className="tabular-nums text-[#1A1A1A] font-semibold"
                    data-testid="presentation-conversion-cashflow-total">{fmtUSD(s.total_roth_converted || 0)}</span>
              {" · "}
              <strong className="text-[#C87941]">Total tax paid on conversions:</strong>{" "}
              <span className="tabular-nums text-[#1A1A1A] font-semibold"
                    data-testid="presentation-conversion-cashflow-tax">{fmtUSD(conversionTaxApprox)}</span>
              {" (approximated as each year's conversion × that year's marginal ordinary rate — the tax cost of the conversion event itself, already embedded in the black spending line above)"}
            </p>
          </div>
        )}
        {branding.include_narrative && bigYear && (
          <Sub>
            Peak conversion year: <strong>{bigYear.year}</strong> — {fmtUSD(bigYear.roth_conversion)} converted at a marginal rate of {fmtPct(bigYear.marginal_ordinary_rate)}. (Not shown as a bar — see explanation above.)
          </Sub>
        )}
      </Page>
      </>)}

      {show("wealth") && (<>
      {/* ---------- Page 5: Wealth Projection ---------- */}
      <Page testid="presentation-page-wealth">
        <H2>Total Household Wealth Over Time</H2>
        <HoldConstantBand testid="deck-wealth-band"
          variable="Roth conversions — the modeled schedule vs none at all"
          constant="spending, returns, longevity, funding order, beneficiary assumption" />
        {branding.include_narrative && (
          <P>
            This line chart traces total household wealth (Cash + Taxable + IRA + Roth + Home) with the illustrated
            conversion schedule versus a plan with no Roth conversions. The two lines usually track closely during
            your lifetimes — because a conversion doesn&apos;t remove wealth from the family, it just moves it from a
            taxable pool to a future-tax-sheltered pool. The wider the gap between the lines, the more of the
            family&apos;s wealth the schedule has moved out of reach of future taxation.
          </P>
        )}
        <ChartCard minHeight={440}
                   testid="chart-wealth-projection-card"
                   exportFilename="total-household-wealth"
                   exportData={nwSeries.map((r) => ({ year: r.year, with_conversions: r.withRoth, no_conversions: r.withoutRoth }))}>
          <PvNetWorthChart data={nwSeries.map((r) => ({ year: r.year, pvWith: r.withRoth, pvNo: r.withoutRoth }))} />
        </ChartCard>
      </Page>
      </>)}

      {show("composition") && (<>
      {/* ---------- Page 5b: Account Composition Over Time ---------- */}
      <Page testid="presentation-page-composition">
        <H2>Where the Money Lives — Account Composition Over Time</H2>
        {branding.include_narrative && (
          <P>
            The same total wealth from the previous page, now sliced by <em>account type</em> year by year:
            Cash, Taxable brokerage, Traditional IRA and Roth IRA. Watch what the Roth conversions do —
            the terra-cotta Traditional band shrinks as those dollars migrate into the deep-green Roth band above.
            <strong> Notice the total top of the stacked area stays roughly the same in each year — the money isn&apos;t
            lost, just moved.</strong> After the conversions are complete, the Roth compounds income-tax free for the
            rest of your lives and, under current law, for a further 10 years in your heirs&apos; hands (the SECURE
            Act distribution window). If any Roth balance is retained in a trust past year 10, retained trust income
            is thereafter taxed at compressed trust brackets — see the Estate Planning section for details.
          </P>
        )}
        <ChartCard minHeight={440}
                   testid="chart-account-composition-card"
                   exportFilename="account-composition"
                   exportData={withRoth.rows.map((r) => ({
                     year: r.year, Cash: r.cash, Taxable: r.taxable, Traditional: r.traditional, Roth: r.roth,
                     Total: (r.cash || 0) + (r.taxable || 0) + (r.traditional || 0) + (r.roth || 0),
                   }))}>
          <AccountCompositionChart data={withRoth.rows.map((r) => ({
            year: r.year, Cash: r.cash, Taxable: r.taxable, Traditional: r.traditional, Roth: r.roth,
          }))} />
        </ChartCard>
        {branding.include_narrative && (
          <Sub>
            Roth conversions do not change the top line of total wealth in a given year — they change
            <em> what fraction of that wealth is sheltered from future income tax</em>. That&apos;s the real prize.
          </Sub>
        )}
      </Page>
      </>)}

      {show("account_values") && (<>
      {/* ---------- Page 5c: Account Values by Year (stacked bars) ---------- */}
      <Page testid="presentation-page-account-values">
        <H2>Account Values by Year — Year-by-Year Snapshots</H2>
        {branding.include_narrative && (
          <P>
            Same data as the previous page, redrawn as discrete stacked bars — one bar per year. Bars make each
            year&apos;s snapshot unambiguous, so it&apos;s easier to answer questions like <em>&ldquo;What will my
            Roth balance be in {new Date().getFullYear() + 10}?&rdquo;</em> at a glance. The colour segments still
            add up to the total household portfolio in that year.
          </P>
        )}
        <ChartCard minHeight={460}
                   testid="chart-account-values-card"
                   exportFilename="account-values-by-year"
                   exportData={withRoth.rows.map((r) => ({
                     year: r.year, Cash: r.cash, Taxable: r.taxable, Traditional: r.traditional, Roth: r.roth,
                     Total: (r.cash || 0) + (r.taxable || 0) + (r.traditional || 0) + (r.roth || 0),
                   }))}>
          <AccountValuesStackedBarChart data={withRoth.rows.map((r) => ({
            year: r.year, Cash: r.cash, Taxable: r.taxable, Traditional: r.traditional, Roth: r.roth,
          }))} />
        </ChartCard>
      </Page>

      </>)}

      {show("conversions") && (<>
      {/* ---------- Page 6: Roth Conversion Schedule ---------- */}
      <Page testid="presentation-page-conversions">
        <H2>The Roth Conversion Schedule</H2>
        {branding.include_narrative && (
          <P>
            Each bar shows the dollars converted from Traditional IRA to Roth in that year. <em>These are transfers,
            not withdrawals</em> — the same dollars move from one pocket of your portfolio (Traditional IRA) to another
            (Roth IRA), triggering ordinary income tax today so they&apos;ll never be taxed again. The strategy fills your
            {rothTargetPct ? ` ${rothTargetPct} tax bracket ceiling` : " target bracket ceiling"} with conversions —
            paying tax now at a rate <em>you control</em>, before larger RMDs force your hand later. Larger conversions
            in the early years exploit the pre-Social-Security window, where ordinary income is at its lowest.
          </P>
        )}
        <ChartCard minHeight={420}
                   testid="chart-conversion-schedule-card"
                   exportFilename="roth-conversion-schedule"
                   exportData={nwSeries.map((r, i) => ({
                     year: r.year,
                     roth_conversion: withRoth.rows[i]?.roth_conversion || 0,
                     marginal_ordinary_rate: withRoth.rows[i]?.marginal_ordinary_rate || 0,
                     ordinary_taxable_income: withRoth.rows[i]?.ordinary_taxable_income || 0,
                   }))}>
          <RothConversionsChart data={nwSeries.map((r, i) => ({ year: r.year, conversion: withRoth.rows[i]?.roth_conversion || 0 }))} />
        </ChartCard>
        {branding.include_narrative && (
          <Sub>
            The engine chose these amounts to fill the target bracket while respecting the IRA balance, IRMAA cap
            (if set), and the surviving-spouse bracket transition after first death.
          </Sub>
        )}
      </Page>

      </>)}

      {show("tax") && (<>
      {/* ---------- Page 7: Tax Cost Composition ---------- */}
      <Page testid="presentation-page-tax">
        <H2>What This Strategy Costs You in Tax</H2>
        {branding.include_narrative && (
          <P>
            The bars below break out the tax cost by category each year: federal ordinary tax, federal preferential
            (LTCG/QDIV), state, NIIT, and Medicare IRMAA surcharges. The peaks correspond to the biggest conversion
            years — that&apos;s the price you pay to move that money into the Roth. The years <em>after</em>
            the conversion window drop back down because the smaller IRA balance no longer forces big RMDs.
          </P>
        )}
        <ChartCard minHeight={440}
                   testid="chart-tax-composition-card"
                   exportFilename="tax-cost-by-category"
                   exportData={taxCompData}>
          <TaxCompositionChart data={taxCompData} />
        </ChartCard>
      </Page>
      </>)}

      {show("legacy") && (<>
      {/* ---------- Page 8: Legacy Comparison ---------- */}
      <Page testid="presentation-page-legacy">
        <H2>What Your Heirs Receive</H2>
        <HoldConstantBand testid="deck-legacy-band"
          variable="Roth conversions — the modeled schedule vs none at all"
          constant="spending, returns, longevity, funding order, beneficiary assumption" />
        {branding.include_narrative && (
          <P>
            This side-by-side comparison shows what your beneficiaries take home under two scenarios: with the
            modeled Roth-conversion schedule versus no conversions. The chart is drawn <em>after</em> all taxes are
            paid — including the SECURE-Act 10-year mandatory distribution and its ordinary-rate tax to your heirs.
            This is the figure worth focusing on: not what sits in the accounts at your death, but what actually
            reaches your family after the IRS takes its share.
          </P>
        )}
        <ChartCard minHeight={420}
                   testid="chart-heir-legacy-card"
                   exportFilename="heir-legacy-comparison"
                   exportData={[
                     { metric: "Tax-free Roth to heirs", with_strategy: lg.tax_free_roth_to_heirs, no_conversions: lgn.tax_free_roth_to_heirs },
                     { metric: "Traditional IRA to heirs (pre-tax)", with_strategy: lg.traditional_ira_to_heirs, no_conversions: lgn.traditional_ira_to_heirs },
                     { metric: "Inherited-IRA tax owed", with_strategy: lg.inherited_ira_tax, no_conversions: lgn.inherited_ira_tax },
                     { metric: "Taxable + reinvested to heirs", with_strategy: lg.taxable_and_reinvested_to_heirs, no_conversions: lgn.taxable_and_reinvested_to_heirs },
                     { metric: "Other assets to heirs", with_strategy: lg.other_assets_to_heirs, no_conversions: lgn.other_assets_to_heirs },
                     { metric: "After-tax total to heirs", with_strategy: lg.after_tax_estate_to_heirs, no_conversions: lgn.after_tax_estate_to_heirs },
                   ]}>
          <HeirLegacyCompareChart withLegacy={lg} noLegacy={lgn} />
        </ChartCard>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <div style={{ padding: "10px 12px", border: "1px solid #4A6741", background: "#4A67410D", borderRadius: 6 }}>
            <div style={{ fontSize: 9, color: "#4A6741", fontWeight: 700, textTransform: "uppercase" }}>With conversions</div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 700, color: "#4A6741" }}>{fmtUSD(lg.after_tax_estate_to_heirs)}</div>
            <div style={{ fontSize: 9, color: "#777", marginTop: 2 }}>
              {fmtUSD((lg.after_tax_estate_to_heirs || 0) * pv.at(heirDeliverYear))} in today&apos;s dollars
            </div>
          </div>
          <div style={{ padding: "10px 12px", border: "1px solid #C87941", background: "#C879410D", borderRadius: 6 }}>
            <div style={{ fontSize: 9, color: "#C87941", fontWeight: 700, textTransform: "uppercase" }}>Without conversions</div>
            <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 20, fontWeight: 700, color: "#C87941" }}>{fmtUSD(lgn.after_tax_estate_to_heirs)}</div>
            <div style={{ fontSize: 9, color: "#777", marginTop: 2 }}>
              {fmtUSD((lgn.after_tax_estate_to_heirs || 0) * pv.at(heirDeliverYear))} in today&apos;s dollars
            </div>
          </div>
        </div>
        <Sub>
          The difference between the two columns is{" "}
          <strong>{heirDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(heirDelta))}</strong> in dollars delivered around{" "}
          {heirDeliverYear || "the end of the heirs' window"} — or{" "}
          <strong>{heirDelta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(heirDelta * pv.at(heirDeliverYear)))}</strong>{" "}
          discounted back to {pv.start} at {fmtPct(pv.rate)}. Both figures describe the same outcome; the second
          is the one to weigh against decisions being made with today&apos;s money.
        </Sub>
      </Page>
      </>)}

      {/* ---------- Page 8b: Robustness — market-crash stress test (optional) ---------- */}
      {stress && <RobustnessPage stress={stress} includeNarrative={branding.include_narrative} />}

      {/* ---------- Page 8c: Regime comparison — six market futures (optional) ---------- */}
      {regimes && <RegimeComparePage regimes={regimes} includeNarrative={branding.include_narrative} />}

      {/* ---------- Page 9: Planning Considerations (optional, full deck) ---------- */}
      {branding.include_recommendations && (
        <Page testid="presentation-page-recs">
          <H2>Planning Considerations</H2>
          <H3>1. Illustrated conversion approach and annual review considerations</H3>
          <P>
            The schedule illustrated here converts {fmtUSD(s.total_roth_converted)}
            {modeledStart && modeledStop
              ? <> across {convYears.length} year{convYears.length === 1 ? "" : "s"}, {modeledStart}–{modeledStop}
                  {rothStart && rothStop && (rothStart !== modeledStart || rothStop !== modeledStop)
                    ? <> (inside a permitted window of {rothStart}–{rothStop})</> : null}</>
              : (rothStart && rothStop ? <> between {rothStart} and {rothStop}</> : null)}.
            Rather than converting in one large year, the illustration phases conversions across the whole window.
            Phasing smooths the tax bill, avoids single-year IRMAA cliffs, and leaves room to re-evaluate each year
            against realized market returns — which is the point of reviewing this annually rather than committing
            to a multi-year schedule up front.
          </P>
          <H3>2. Funding Roth conversions from Taxable vs. Retirement accounts — a decision to make in consultation with a professional</H3>
          <P>
            Every dollar of conversion tax you pay from your Taxable brokerage account is a dollar that lands in the
            Roth to compound. However, those same Taxable assets and their embedded capital gains would
            never be taxed if held until death — the taxable assets receive a <strong>step-up in basis</strong> at the
            second death, and the embedded gain disappears. Given long compounding periods, maximizing Roth
            conversions by funding early conversions with Taxable assets can produce gains — often very modest —{" "}
            <em>if</em>, but only if, Roth compounding and positive markets produce favorable results.
          </P>
          <P>
            The basic benefit of a long lifespan combined with early Roth conversions is that your heirs will receive
            additional Roth IRA assets that continue to compound <strong>income-tax free through the SECURE Act 10-year
            distribution window</strong>. Taxable brokerage assets will step up in basis at the second death but will
            not enjoy the 10-year tax-sheltered growth window that (unspent) Roth balances get in the heirs&apos; hands.
            After the 10-year window the Roth wrapper must be emptied; if the account is retained in an accumulation
            trust, retained trust income is thereafter taxed at compressed trust brackets (37% federal above ~$16K), so
            trustees typically distribute ordinary income and appreciated assets in-kind to beneficiaries in lower brackets.
          </P>
          <P>
            <strong>Beneficiary behavior matters.</strong> If your heirs spend their inheritance in the year following
            the surviving spouse&apos;s death, there is no 10-year compounding benefit — a key driver of Roth-conversion
            value evaporates. <strong>Longevity is also an unpredictable factor:</strong> early mortality favors
            preserving the step-up in basis over Roth-driven compounding. And finally, this is a linear model
            that assumes constant positive returns — an assumption not supported by historically volatile stock and
            bond markets.
          </P>
          <FundingOrderRationale scenario={scenario} orderCompare={orderCompare} />
        </Page>
      )}

      {/* ---------- Page 9b: Longevity trade-off grid (optional) ---------- */}
      {branding.include_longevity && longevity && (
        <LongevityTradeoffPage data={longevity} pv={pv} horizon={heirHorizon}
          includeNarrative={branding.include_narrative} />
      )}

      {/* ---------- Page 9c: Beneficiary tax-rate band (optional) ---------- */}
      {branding.include_beneficiary_band && heirSens && (
        <BeneficiaryBandPage heirSens={heirSens} heirRate={heirSens.modeled_rate}
          pv={pv} deliverYear={heirDeliverYear}
          includeNarrative={branding.include_narrative} />
      )}

      {/* ---------- Curated deck only: one-page estate scenario comparison ---------- */}
      {curated && show("estate") && flowResult && (
        <EstateComparePage flowResult={flowResult} selected={flowSelected}
          includeNarrative={branding.include_narrative} />
      )}

      {/* ---------- Page 9d: Perspective & caveats (split off the recommendations
           page — one page could not hold six numbered sections at full size) ---------- */}
      {branding.include_recommendations && (
        <Page testid="presentation-page-caveats">
          <H2>Perspective &amp; Caveats</H2>
          <H3>4. What could change this answer</H3>
          <P>
            This projection assumes positive, linear compounding. An early Roth conversion may end up paying tax on
            investments that could have been converted later at a lower rate — for example, after a market decline or
            correction. Volatile markets, sequence-of-return risk, and unexpected changes to tax law can each shift
            the optimal path materially. Treat the after-tax-legacy dollar figures on this report as directional, not
            precise.
          </P>
          <P>
            Keep in mind that <strong>the ultimate goal of retirement planning is not to outlive your assets — not to
            maximize what your heirs will receive.</strong> This planner exists to make you aware that Traditional IRA
            and 401(k) balances will ultimately be withdrawn and taxed as ordinary income — to you, to your heirs, or
            to charity (at a 0% rate). Each family should think about who receives the Traditional IRA / 401(k)
            windfall and under what circumstances, and how that intent should shape the size and timing of Roth
            conversions today.
          </P>
          <H3>5. Convert more in down markets</H3>
          <P>
            A market drawdown is effectively a Roth conversion sale: the shares you convert are cheaper, and when they
            recover, all the recovery lands in the Roth and continues to compound income-tax free (through the SECURE
            10-year window for heirs). If markets fall 15%+ during your conversion window, consider accelerating the
            schedule.
          </P>
          <H3>6. Re-run this analysis after any material life change</H3>
          <P>
            Widowhood, a large inheritance, a business sale, a residence-state change, or a change in tax law can
            materially shift the optimal conversion path. This report should be treated as a starting point, not a
            commitment — re-run the model annually or at any life event.
          </P>

          <McBehaviorNote variant="box" testid="deck-caveats-mc-behavior-note" />

          {branding.closing_notes && (
            <div style={{ padding: "12px 16px", background: "#F9F8F6", borderLeft: "4px solid #4A6741", marginTop: 20 }}>
              <p style={{ fontSize: 11, lineHeight: 1.6, color: "#2A2A2A", margin: 0 }}>
                {branding.closing_notes}
              </p>
            </div>
          )}
        </Page>
      )}

      {branding.include_sequence_risk && seqResult && (
        <SequenceRiskDeckPage seqData={seqResult} includeNarrative={branding.include_narrative} />
      )}

      {/* ---------- Advisor & technical appendix divider — everything after this
           page is reference material rather than client conversation ---------- */}
      {!curated && <AppendixDividerDeckPage items={[
        "Methodology & disclosures — the tax engine, the reconciliation benchmark, and what this analysis is not",
        "Assumption sources for every figure shown in the client pages",
        "The full input record is in the Client Report appendix",
      ]} />}

      {/* ---------- Page 10: Disclosures ---------- */}
      <Page testid="presentation-page-disclosures">
        <H2>Methodology & Disclosures</H2>
        <P>
          This report was generated by an educational retirement-tax model that separates ordinary income from preferential
          long-term-capital-gain and qualified-dividend income, applies the OBBBA-2025 permanent inflation-indexed federal
          brackets, computes Medicare IRMAA with a two-year lookback, applies the 3.8% NIIT to investment income above the
          MAGI threshold, and enforces state tax at the household&apos;s residence rate.
        </P>
        <P>
          Roth conversion illustrations are generated by a bracket-fill algorithm that maximises modeled after-tax
          legacy while respecting the IRA balance, IRMAA cap (if configured), and the surviving-spouse&apos;s
          Single-filer transition at first death. The engine has been reconciled to a benchmark spreadsheet (V17)
          within 0.4% on total conversions and 0.3% on wealth-to-heirs. Maximising a modeled quantity is not the
          same as recommending a course of action; which objective should be maximised is a family decision, set
          out on the &ldquo;What are we planning for?&rdquo; page.
        </P>
        <H3>What this analysis is not</H3>
        <ul style={{ fontSize: 11, lineHeight: 1.6, color: "#2A2A2A", paddingLeft: 18, marginBottom: 10 }}>
          <li>This is not a guarantee of investment return. Actual returns will differ from the assumed rates.</li>
          <li>This is not tax or legal advice. Consult a qualified tax professional before executing any conversion.</li>
          <li>This is not a substitute for annual review. Tax law and personal circumstances change.</li>
        </ul>
        <div style={{ padding: "12px 16px", background: "#C879410D", borderLeft: "4px solid #C87941", marginTop: 16 }}>
          <p style={{ fontSize: 11, lineHeight: 1.6, color: "#1A1A1A", margin: 0, fontStyle: "italic", fontWeight: 500 }}>
            &ldquo;Be very careful before paying current taxes based upon projections of future returns and tax
            rates. Current taxes are real and reduce assets available to support your and your spouse&apos;s
            lifestyle. Current taxes are real and not refundable; assumptions are hypothetical. This presentation
            is based upon assumptions — such as linear, constant investment returns — which, while grounded in
            historical experience, are simplified for projection purposes and are not promises.&rdquo;
          </p>
        </div>
        <div style={{ marginTop: 30, paddingTop: 14, borderTop: "1px solid #EBE8E0", fontSize: 10, color: "#777" }}>
          {branding.advisor_firm && <div style={{ color: "#1A1A1A", fontWeight: 600 }}>{branding.advisor_firm}</div>}
          {branding.advisor_name && <div>{branding.advisor_name}</div>}
          {branding.advisor_email && <div>{branding.advisor_email}</div>}
          <div style={{ marginTop: 6, opacity: 0.7 }}>
            Report generated {prettyDate} · Model engine v3.1 (V17-reconciled)
          </div>
        </div>
      </Page>
    </div>
  );
};
