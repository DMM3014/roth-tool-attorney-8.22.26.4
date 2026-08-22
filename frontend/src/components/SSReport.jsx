import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Printer, FileText, User, Save, Loader2, Sparkles, RotateCcw, Download, Play, Presentation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  API, authHeaders, runProjection, runSsOptimizer, fmtUSD,
} from "@/lib/api";
import { downloadElementAsPdf } from "@/lib/pdf";
import { downloadElementAsDocx } from "@/lib/docx";
import { useAdvisorLogo } from "@/lib/advisorLogo";
import { useAdvisorInfo } from "@/lib/advisorInfo";

import {
  defaultBranding, loadBranding, saveBranding, SS_AI_TEXT_KEY, CLAIM_AGES,
} from "./ssReport/helpers";
import { CoverPage } from "./ssReport/CoverPage";
import { HowSSWorksPage } from "./ssReport/HowSSWorksPage";
import { BenefitsByAgePage } from "./ssReport/BenefitsByAgePage";
import { LifetimeBenefitsPage } from "./ssReport/LifetimeBenefitsPage";
import { CoordinatedClaimingPage } from "./ssReport/CoordinatedClaimingPage";
import { RothInteractionPage } from "./ssReport/RothInteractionPage";
import { TaxationIRMAAPage } from "./ssReport/TaxationIRMAAPage";
import { SurvivorBenefitsPage } from "./ssReport/SurvivorBenefitsPage";
import { RecommendationsPage } from "./ssReport/RecommendationsPage";
import { WhatIfSlider } from "./ssReport/WhatIfSlider";
import { PresenterMode } from "./ssReport/PresenterMode";

// ============================================================================
// Social Security Report — top-level orchestrator
// Long-form, print-optimized narrative Social Security analysis. Similar
// pattern to ClientReport but focused entirely on SS strategy.
// ============================================================================
export const SSReport = ({ scenario, setScenario }) => {
  const [branding, setBranding] = useState(loadBranding);
  const [withRoth, setWithRoth] = useState(null);
  const [ssResult, setSsResult] = useState(null);
  const [ssRunning, setSsRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [logo] = useAdvisorLogo();
  const [advisorInfo] = useAdvisorInfo();
  const brandingWithAdvisor = { ...branding, ...advisorInfo };
  const [aiText, setAiText] = useState(() => {
    try { return window.localStorage.getItem(SS_AI_TEXT_KEY) || ""; } catch { return ""; }
  });
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiError, setAiError] = useState("");
  const [presenterOpen, setPresenterOpen] = useState(false);

  const upd = (k, v) => setBranding((b) => ({ ...b, [k]: v }));
  const persistBranding = () => { saveBranding(branding); toast.success("SS Report settings saved."); };

  const sig = JSON.stringify(scenario);

  useEffect(() => {
    let alive = true;
    setWithRoth(null);
    const t = setTimeout(() => {
      runProjection(scenario)
        .then((a) => { if (alive) setWithRoth(a); })
        .catch(() => { if (alive) toast.error("Projection failed. Try reloading."); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Also auto-run the SS sweep on first load (so the report has data to show).
  const runSweep = useCallback(() => {
    if (ssRunning) return;
    setSsRunning(true);
    runSsOptimizer(scenario, CLAIM_AGES)
      .then((r) => setSsResult(r))
      .catch(() => toast.error("SS sweep failed. Try again."))
      .finally(() => setSsRunning(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    setSsResult(null);
    const t = setTimeout(runSweep, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const fraAmounts = ssResult?.fra_amounts;
  const fraAges = ssResult?.fra_ages;
  const notReady = !withRoth;

  const h = scenario.household || {};
  const anonymize = !!branding.anonymize_names;
  const rawClientName = branding.client_name_override || h.client_name || "Client";
  const rawSpouseName = branding.spouse_name_override || h.spouse_name || "";
  const clientName = anonymize ? "Client" : rawClientName;
  const spouseName = anonymize ? (rawSpouseName ? "Client Partner" : "") : rawSpouseName;
  const household = spouseName ? `${clientName} & ${spouseName}` : clientName;
  // When anonymized: build an effective scenario with household names replaced so
  // every downstream SS subpage (Cover, Lifetime chart title, Survivor page,
  // What-If slider, Recommendations) picks up the anonymized names without each
  // one needing separate prop-drilling changes.
  const scenarioForReport = useMemo(() => {
    if (!anonymize) return scenario;
    return {
      ...scenario,
      household: {
        ...(scenario.household || {}),
        client_name: "Client",
        spouse_name: rawSpouseName ? "Client Partner" : "",
      },
    };
  }, [scenario, anonymize, rawSpouseName]);
  // Anonymized label used for anything shared with an external LLM (AI Review +
  // "Chat with Gemini" second-opinion clipboard). Names are stripped before
  // leaving the app.
  const anonymizedHousehold = spouseName ? "A married couple" : "A single client";
  const prettyDate = useMemo(() => {
    const d = new Date(branding.presentation_date + "T00:00:00");
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }, [branding.presentation_date]);

  const generateAiReview = async () => {
    if (aiStreaming || notReady) return;
    setAiStreaming(true); setAiText(""); setAiError("");
    const apiKey = window.localStorage.getItem("gemini_api_key") || "";
    const best = ssResult?.best;
    const baseline = ssResult?.baseline;
    const summary = {
      _focus:
        "You are writing the AI Review section at the end of a client-facing Social Security analysis report. " +
        "PRIVACY: The household is anonymized — refer to the clients only as 'the couple', 'the client', 'they', or 'you' throughout. " +
        "NEVER invent, guess, or output any personal names, and do not use placeholders like '[Client Name]'. " +
        "Produce output in TWO distinct sections, each preceded by a markdown-style header on its own line:\n" +
        "\n### For the Client (3-4 short paragraphs)\n" +
        "Plain-English narrative to the client. Acknowledge their SS decision, describe the recommended claim ages, " +
        "explain why the recommended pair maximizes after-tax legacy (Roth interaction + survivor benefit), and honestly " +
        "name the trade-off vs. earliest-claim. Second-person ('you'), warm, respectful, no jargon.\n" +
        "\n### Advisor Talking Points (3-4 bullets)\n" +
        "Crisp bullets for the advisor to raise during the client meeting: the most compelling number, one caveat, and " +
        "one next-step action.",
      report: "Social Security Analysis & Strategy Report",
      household: anonymizedHousehold,
      client_fra_benefit: fraAmounts?.Client,
      spouse_fra_benefit: fraAmounts?.Spouse,
      client_fra_age: fraAges?.Client,
      spouse_fra_age: fraAges?.Spouse,
      client_ss_claim_age_current: h.client_ss_claim_age,
      spouse_ss_claim_age_current: h.spouse_ss_claim_age,
      recommended_pair_label: best?.label,
      recommended_client_age: best?.client_age,
      recommended_spouse_age: best?.spouse_age,
      recommended_after_tax_estate: best?.after_tax_estate,
      current_after_tax_estate: baseline?.after_tax_estate,
      legacy_delta: best && baseline ? best.after_tax_estate - baseline.after_tax_estate : null,
      recommended_lifetime_ss: best?.lifetime_ss,
      recommended_lifetime_taxes: best?.lifetime_taxes,
      cola: scenario?.projection?.ss_cola,
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
      try { window.localStorage.setItem(SS_AI_TEXT_KEY, acc); } catch { /* noop */ }
    } catch (e) {
      setAiError(e?.message || "AI review generation failed.");
    } finally {
      setAiStreaming(false);
    }
  };

  const editAiText = (v) => {
    setAiText(v);
    try { window.localStorage.setItem(SS_AI_TEXT_KEY, v); } catch { /* noop */ }
  };
  const clearAiText = () => {
    setAiText("");
    try { window.localStorage.removeItem(SS_AI_TEXT_KEY); } catch { /* noop */ }
  };

  // Handler for clicking a bar in the "Benefits by Age" chart. Reprojects the
  // plan by writing the clicked claim age back to the household (setScenario).
  const handleClaimClick = (owner, age) => {
    if (!setScenario || !age) return;
    const dobKey = owner === "Client" ? "client_dob_year" : "spouse_dob_year";
    const dateKey = owner === "Client" ? "client_ss_claim_date" : "spouse_ss_claim_date";
    const ageKey = owner === "Client" ? "client_ss_claim_age" : "spouse_ss_claim_age";
    setScenario((prev) => {
      const next = { ...prev, household: { ...(prev.household || {}) } };
      // Update both fields so downstream systems stay in sync.
      next.household[ageKey] = age;
      if (next.household[dobKey]) {
        next.household[dateKey] = `${next.household[dobKey] + age}-01-01`;
      }
      return next;
    });
    toast.success(`${owner} claim age set to ${age} — projection updated.`);
  };

  // Export the Advisor Commentary as a standalone PDF or RTF (advisor-only —
  // never bundled into the client PDF). Mirror of the Client Report export.
  const exportAdvisorCommentary = (format) => {
    if (!aiText || aiStreaming) return;
    const dateStr = new Date().toLocaleDateString("en-US",
      { year: "numeric", month: "long", day: "numeric" });
    const header = `Advisor Commentary — Social Security Analysis — ${household}\nPrepared ${dateStr}`;
    const doc = `${header}\n${"=".repeat(60)}\n\n${aiText}\n\n${"—".repeat(30)}\n` +
      `Advisor working document. Not for distribution to the client.`;
    if (format === "rtf") {
      const rtfEscape = (s) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, (m) => `\\${m}`);
      const rtfBody = rtfEscape(doc).replace(/\r?\n/g, "\\par\n");
      const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\fs22 ${rtfBody}}`;
      const blob = new Blob([rtf], { type: "application/rtf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ss-advisor-commentary-${new Date().toISOString().slice(0, 10)}.rtf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast.success("Advisor commentary saved as RTF.");
      return;
    }
    try {
      const w = window.open("", "_blank", "width=760,height=900");
      if (!w) { toast.error("Popup blocked — allow popups to save as PDF."); return; }
      const safe = doc.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      w.document.write(`<!doctype html><html><head><meta charset="utf-8">
        <title>Advisor Commentary (SS) — ${household}</title>
        <style>
          @page { size: Letter; margin: 0.75in; }
          body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt;
                 line-height: 1.55; color: #1A1A1A; white-space: pre-wrap; }
          h1 { font-family: "Outfit", sans-serif; font-size: 16pt; margin: 0 0 12pt; color: #4A6741; }
          .foot { margin-top: 30pt; padding-top: 10pt; border-top: 1px solid #C9C4B8;
                  font-size: 9.5pt; color: #666; font-style: italic; }
        </style></head><body>
        <h1>Advisor Commentary — Social Security Analysis (${household})</h1>
        <div style="font-size:10pt;color:#666;margin-bottom:16pt">Prepared ${dateStr}</div>
        <div>${safe.split("\n").slice(2).join("\n").replace(/={20,}/, "").trim()}</div>
        <div class="foot">Advisor working document. Not for distribution to the client.</div>
        <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
        </body></html>`);
      w.document.close();
      toast.success("Advisor commentary opened — use the browser's Save as PDF dialog.");
    } catch { toast.error("Could not open the print window."); }
  };

  const doPrint = async () => {
    if (downloading) return;
    setDownloading(true);
    saveBranding(branding);
    const wrap = document.querySelector("[data-testid='ss-report-preview-wrap']");
    const originalTransform = wrap ? wrap.style.transform : "";
    const originalWidth = wrap ? wrap.style.width : "";
    if (wrap) {
      wrap.style.setProperty("transform", "none", "important");
      wrap.style.setProperty("width", "100%", "important");
    }
    // Reset any "click-to-isolate" legend state so the printed PDF always
    // captures the full un-dimmed chart. Each chart's useIsolation() hook
    // listens for "cr-reset-isolation" and resets to null.
    window.dispatchEvent(new CustomEvent("cr-reset-isolation"));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await downloadElementAsPdf({
        target: "[data-testid='ss-report-preview-inner']",
        filename: `${(clientName || "client").toLowerCase().replace(/\s+/g, "-")}-social-security-report.pdf`,
        format: "a4",
        orientation: "portrait",
        marginMm: 10,
      });
    } catch (e) {
      console.error("SS report PDF export failed", e);
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
    // Semi-structured DOCX export — same DOM contract as doPrint but the
    // walker in /app/frontend/src/lib/docx.js emits real Word primitives
    // (Heading 1/2/3, paragraphs, real tables) and only rasterizes charts.
    if (downloadingDocx) return;
    setDownloadingDocx(true);
    saveBranding(branding);
    const wrap = document.querySelector("[data-testid='ss-report-preview-wrap']");
    const originalTransform = wrap ? wrap.style.transform : "";
    const originalWidth = wrap ? wrap.style.width : "";
    if (wrap) {
      wrap.style.setProperty("transform", "none", "important");
      wrap.style.setProperty("width", "100%", "important");
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await downloadElementAsDocx({
        target: "[data-testid='ss-report-preview-inner']",
        filename: `${(clientName || "client").toLowerCase().replace(/\s+/g, "-")}-social-security-report.docx`,
      });
      toast.success("Word document downloaded.");
    } catch (e) {
      console.error("SS report DOCX export failed", e);
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
      <div className="no-print" data-testid="ss-report-toolbar">
        <div className="rounded-xl border border-[#EBE8E0] bg-[#F9F8F6] p-5 mb-4">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-display text-base font-bold tracking-tight text-[#1A1A1A]">Social Security Analysis &amp; Strategy Report</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">
                  Long-form, print-optimized narrative Social Security analysis. Covers how SS works, benefits by claim age (62/65/67/70), cumulative lifetime benefits, coordinated household claiming, the Roth-conversion interaction, SS taxation &amp; IRMAA, survivor and spousal benefits, and an AI-generated review.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={runSweep} disabled={ssRunning} data-testid="ssr-run-sweep"
                className="gap-2 rounded-full">
                {ssRunning
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Sweeping…</>
                  : <><Play className="h-4 w-4" /> {ssResult ? "Re-run sweep" : "Run SS sweep"}</>}
              </Button>
              <Button size="sm" variant="outline" onClick={persistBranding} data-testid="ss-report-save"
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                <Save className="h-4 w-4" /> Save settings
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => setPresenterOpen(true)} disabled={notReady}
                data-testid="ss-report-present"
                className="gap-2 rounded-full border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5">
                <Presentation className="h-4 w-4" /> Present
              </Button>
              <Button size="sm" onClick={doPrint} disabled={notReady || downloading || downloadingDocx} data-testid="ss-report-print-btn"
                className="gap-2 bg-[#4A6741] hover:bg-[#3B5234] text-white rounded-full">
                {downloading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                  : <><Printer className="h-4 w-4" /> {notReady ? "Loading…" : "Generate PDF"}</>}
              </Button>
              <Button size="sm" variant="outline" onClick={doDocx}
                disabled={notReady || downloading || downloadingDocx}
                data-testid="ss-report-docx-btn"
                title="Download an editable Word document — text is editable; charts embed as images"
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
              <Input data-testid="ssr-input-client" value={branding.client_name_override}
                onChange={(e) => upd("client_name_override", e.target.value)}
                placeholder={h.client_name || "(from scenario)"} className="h-9 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-[11px] label-cap"><User className="inline h-3 w-3 mr-1" />Spouse name</Label>
              <Input data-testid="ssr-input-spouse" value={branding.spouse_name_override}
                onChange={(e) => upd("spouse_name_override", e.target.value)}
                placeholder={h.spouse_name || "(optional)"} className="h-9 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-[11px] label-cap">Report date</Label>
              <Input data-testid="ssr-input-date" type="date" value={branding.presentation_date}
                onChange={(e) => upd("presentation_date", e.target.value)} className="h-9 text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3 rounded-md border border-[#C87941] bg-[#FEFAF1] px-3 py-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <Switch data-testid="ssr-anonymize-toggle" checked={!!branding.anonymize_names}
                  onCheckedChange={(v) => upd("anonymize_names", !!v)} className="mt-0.5" />
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-[#8A5A20]">
                    Anonymize client identity in this Social Security report
                  </p>
                  <p className="text-[10.5px] text-muted-foreground leading-snug mt-1">
                    Renders the client as <strong>&ldquo;Client&rdquo;</strong> and their partner as
                    <strong> &ldquo;Client Partner&rdquo;</strong>. Turn on when this report may be shared
                    outside the client engagement (e.g. marketing samples, LLM-assisted review).
                  </p>
                </div>
              </label>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Cover subtitle</Label>
              <Input data-testid="ssr-input-subtitle" value={branding.cover_subtitle}
                onChange={(e) => upd("cover_subtitle", e.target.value)}
                placeholder="Social Security Analysis & Strategy Report" className="h-9 text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Cover intro paragraph (optional)</Label>
              <Textarea data-testid="ssr-input-intro" value={branding.cover_intro}
                onChange={(e) => upd("cover_intro", e.target.value)} rows={3}
                placeholder="Optional letter-style intro paragraph."
                className="text-sm mt-1" />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <Label className="text-[11px] label-cap">Footer / confidentiality</Label>
              <Input data-testid="ssr-input-confidentiality" value={branding.confidentiality}
                onChange={(e) => upd("confidentiality", e.target.value)}
                className="h-9 text-sm mt-1" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6 items-center">
            <label className="flex items-start gap-2 cursor-pointer max-w-[560px]">
              <Switch checked={branding.include_ai_review} onCheckedChange={(v) => upd("include_ai_review", v)}
                data-testid="ssr-toggle-ai" />
              <span className="text-xs text-muted-foreground leading-snug">
                Enable <strong className="text-[#1A1A1A]">Advisor Commentary</strong> (optional) — an
                advisor-only working document; <strong>not printed into the client PDF</strong>.
                Export as a separate PDF or RTF when needed.
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={branding.include_spousal} onCheckedChange={(v) => upd("include_spousal", v)}
                data-testid="ssr-toggle-spousal" />
              <span className="text-xs text-muted-foreground">Include spousal benefit modeling on Survivor page</span>
            </label>
          </div>
        </div>

        {/* Advisor Commentary controls — advisor-only working document. Never included
            in the client SS Report PDF. Advisor can export as standalone PDF or RTF. */}
        {branding.include_ai_review && (
          <div className="rounded-xl border border-[#4A6741] bg-[#F1F5EF] shadow-sm p-4 mb-4"
               data-testid="ssr-advisor-commentary-card">
            <div className="flex items-start gap-3 mb-3">
              <Sparkles className="h-4 w-4 text-[#4A6741] mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-[#1A1A1A]">Advisor Commentary — Social Security analysis</p>
                  <span className="text-[9px] font-bold uppercase tracking-wide bg-[#4A6741] text-white
                                   rounded-full px-2 py-[2px]">Advisor-only</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Drafts internal talking points about the recommended claim pair.
                  <strong className="text-[#1A1A1A]"> Not included in the client PDF.</strong> Export as a
                  standalone PDF or RTF for internal review.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {aiText && !aiStreaming && (
                  <Button size="sm" variant="outline" onClick={clearAiText} data-testid="ssr-ai-clear"
                    className="h-8 gap-1 text-[11px]">
                    <RotateCcw className="h-3 w-3" /> Clear
                  </Button>
                )}
                <Button size="sm" onClick={generateAiReview} disabled={aiStreaming || notReady || !ssResult}
                  data-testid="ssr-ai-run"
                  className="h-8 gap-1 bg-[#4A6741] hover:bg-[#3B5234] text-white text-[11px]">
                  {aiStreaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {aiStreaming ? "Generating…" : (aiText ? "Regenerate" : "Generate Commentary")}
                </Button>
              </div>
            </div>
            {aiError && <p className="text-[11px] text-[#B84A4A] mb-2" data-testid="ssr-ai-error">{aiError}</p>}
            <Textarea
              value={aiText}
              onChange={(e) => editAiText(e.target.value)}
              rows={8}
              placeholder="Click Generate Commentary to draft the advisor-facing narrative. Edit as needed before exporting."
              className="text-[12px] leading-relaxed"
              data-testid="ssr-ai-text"
            />
            {aiText && !aiStreaming && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => exportAdvisorCommentary("pdf")}
                        className="h-8 gap-1 text-[11px]" data-testid="ssr-ai-export-pdf">
                  <Download className="h-3 w-3" /> Save as PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportAdvisorCommentary("rtf")}
                        className="h-8 gap-1 text-[11px]" data-testid="ssr-ai-export-rtf">
                  <Download className="h-3 w-3" /> Save as RTF
                </Button>
                <span className="text-[10.5px] text-muted-foreground italic">
                  Advisor working document — do not share with client.
                </span>
              </div>
            )}
          </div>
        )}

        {/* What-if slider — try different claim ages interactively */}
        {setScenario && (
          <WhatIfSlider scenario={scenario} setScenario={setScenario}
            fraAmounts={fraAmounts} fraAges={fraAges} ssResult={ssResult} />
        )}

        {/* Live on-screen preview */}
        <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] label-cap text-muted-foreground">Live preview (scaled) — click <em>Generate PDF</em> to save</p>
            <p className="text-[11px] text-muted-foreground">Approx. 9 pages</p>
          </div>
          <div className="rounded-lg border border-[#EBE8E0] bg-[#FAFAF8] p-4 overflow-hidden">
            <div style={{ transform: "scale(0.7)", transformOrigin: "top left", width: "142.85%" }}
                 data-testid="ss-report-preview-wrap">
              <div className="preview-inner" data-testid="ss-report-preview-inner">
                <SSReportBody
                  branding={brandingWithAdvisor} household={household} clientName={clientName} spouseName={spouseName}
                  prettyDate={prettyDate} scenario={scenarioForReport} withRoth={withRoth} ssResult={ssResult}
                  fraAmounts={fraAmounts} fraAges={fraAges}
                  aiText={aiText} logo={logo}
                  onClaimClick={setScenario ? handleClaimClick : undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print-only root */}
      <div className="presentation-print-block" data-testid="ss-report-print-root">
        <SSReportBody
          branding={brandingWithAdvisor} household={household} clientName={clientName} spouseName={spouseName}
          prettyDate={prettyDate} scenario={scenarioForReport} withRoth={withRoth} ssResult={ssResult}
          fraAmounts={fraAmounts} fraAges={fraAges}
          aiText={aiText} logo={logo}
        />
      </div>

      {/* Presenter Mode — fullscreen dark-mode slide deck */}
      {presenterOpen && !notReady && (
        <PresenterMode
          branding={brandingWithAdvisor} household={household} prettyDate={prettyDate}
          scenario={scenario} withRoth={withRoth} ssResult={ssResult}
          fraAmounts={fraAmounts} fraAges={fraAges} aiText={aiText} logo={logo}
          onClose={() => setPresenterOpen(false)}
        />
      )}
    </div>
  );
};

// ---- Composed report body (used by live preview + print root) ----
const SSReportBody = ({
  branding, household, clientName, spouseName, prettyDate, scenario, withRoth, ssResult,
  fraAmounts, fraAges, aiText, logo, onClaimClick,
}) => {
  if (!withRoth) {
    return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>Loading projection…</div>;
  }
  const foot = branding.confidentiality || "Confidential";
  const dateFoot = prettyDate;
  const totalPages = 9;  // Advisor Commentary is NEVER printed into the client SS PDF.
  const pageFooter = (n) => ({ pageNo: n, pageTotal: totalPages, footer: dateFoot, confidential: foot, logo });
  const hasSpouse = scenario?.household?.spouse_dob_year != null;

  // If we have a spouse, we include a "lifetime benefits" page for BOTH, otherwise just Client.
  // For a 10-page target we keep Client's lifetime chart only (Spouse's mirror is on-tab).
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "Outfit, 'Helvetica Neue', sans-serif", color: "#1A1A1A" }}>
      <CoverPage branding={branding} household={household} prettyDate={prettyDate} scenario={scenario}
        fraAges={fraAges} fraAmounts={fraAmounts} logo={logo} {...pageFooter(1)} />
      <HowSSWorksPage fraAges={fraAges} {...pageFooter(2)} />
      <BenefitsByAgePage scenario={scenario} fraAmounts={fraAmounts} fraAges={fraAges}
        onClaimClick={onClaimClick} {...pageFooter(3)} />
      <LifetimeBenefitsPage scenario={scenario} fraAmounts={fraAmounts} fraAges={fraAges} owner="Client" {...pageFooter(4)} />
      <CoordinatedClaimingPage ssResult={ssResult} {...pageFooter(5)} />
      <RothInteractionPage withRoth={withRoth} scenario={scenario} {...pageFooter(6)} />
      <TaxationIRMAAPage withRoth={withRoth} scenario={scenario} {...pageFooter(7)} />
      <SurvivorBenefitsPage scenario={scenario} fraAmounts={fraAmounts} fraAges={fraAges}
        includeSpousal={branding.include_spousal} {...pageFooter(8)} />
      <RecommendationsPage ssResult={ssResult} scenario={scenario} fraAmounts={fraAmounts} {...pageFooter(9)} />
    </div>
  );
};

export { defaultBranding };
export default SSReport;
