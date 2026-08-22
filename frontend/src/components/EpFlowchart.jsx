/**
 * EP Flowchart tab — web replica of the workbook's "EP Projection" flowchart page.
 *
 * Five estate-funding plans, stacked vertically, repopulated from the loaded
 * scenario: balances are sliced from the projection at the first-death year,
 * split 50/50 between spouses (community-property convention, same as the
 * Estate tab), then carried to the second death using the retirement
 * projection's actual per-asset-class balances — so this page reconciles to
 * the full cash-flow/tax model. Federal-only, exclusions indexed at the
 * model's assumed CPI.
 */
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Workflow, Info, AlertTriangle, Printer, FileText, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { runProjection, runEpFlowchart, fmtUSD } from "@/lib/api";
import { useFlowPlans, ALL_PLANS } from "@/hooks/useFlowPlans";
import { buildEpFlowchartRequest, taxableFallbackRate } from "@/lib/epFlowchart";
import { toast } from "sonner";
import { PlanFlowchart } from "@/components/flowchart/PlanFlowchart";
import { PlanComparisonTable } from "@/components/flowchart/PlanComparisonTable";
import { ScenarioCompareBar } from "@/components/flowchart/ScenarioCompareBar";
import { ScenarioCompareOverlay } from "@/components/flowchart/ScenarioCompareOverlay";
import { downloadElementAsDocx } from "@/lib/docx";

const STORAGE_KEY = "ep_flowchart_settings_v1";
const loadSettings = () => { try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; } };
const saveSettings = (s) => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} };

const PctInput = ({ label, value, onChange, testid, step = 0.1 }) => (
  <div>
    <Label className="text-[11px] label-cap">{label}</Label>
    <div className="flex items-center gap-1 mt-1">
      <Input type="number" step={step} value={(value * 100).toFixed(2)}
        onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(Math.max(0, v) / 100); }}
        className="h-9 text-sm w-24 text-right" data-testid={testid} />
      <span className="text-xs text-muted-foreground">%</span>
    </div>
  </div>
);

export const EpFlowchart = ({ scenario }) => {
  const [projectionRows, setProjectionRows] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const printableRef = useRef(null);

  // Scenario comparison state (Feature: Flowchart Scenario Compare).
  const [compareId, setCompareId] = useState("");
  const [compareResult, setCompareResult] = useState(null);
  const [compareLabel, setCompareLabel] = useState("");
  const handleCompareResult = useCallback((name, flow) => {
    setCompareLabel(name || "");
    setCompareResult(flow || null);
  }, []);

  const initial = loadSettings();
  const [capGains, setCapGains] = useState(initial.capGains ?? 0.24);
  const [heirIncome, setHeirIncome] = useState(initial.heirIncome ?? (scenario?.legacy?.heir_federal_rate ?? 0.3165));

  // Which of the five plans to render — shared with the Client Report so this
  // tab and the printed report always show the same set (default Plans 1–3).
  const { flowPlans, togglePlan } = useFlowPlans();
  const visiblePlans = useMemo(
    () => (result?.plans || []).filter((p) => flowPlans?.[p.plan_no]),
    [result, flowPlans],
  );

  // Fallback growth rate — used by the engine ONLY for asset classes with a
  // zero balance at first death; every other class follows the projection.
  const fallbackRate = useMemo(() => taxableFallbackRate(scenario), [scenario]);

  useEffect(() => { saveSettings({ capGains, heirIncome }); }, [capGains, heirIncome]);

  useEffect(() => {
    let alive = true;
    setBusy(true); setError("");
    runProjection(scenario)
      .then((r) => { if (alive) setProjectionRows(r); })
      .catch((e) => { if (alive) setError(e?.message || "Projection failed."); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [scenario]);

  useEffect(() => {
    if (!projectionRows?.rows?.length) return;
    let alive = true;
    const req = buildEpFlowchartRequest(scenario, projectionRows, { capGains, heirIncome });
    if (!req) return;
    runEpFlowchart(req)
      .then((r) => { if (alive) setResult(r); })
      .catch((e) => { if (alive) { setError(e?.message || "EP flowchart failed."); toast.error("EP flowchart failed."); } });
    return () => { alive = false; };
  }, [projectionRows, scenario, capGains, heirIncome]);

  const hasSpouse = !!(scenario?.household?.spouse_dob_year);

  // In-tab print — reuse the browser's print pipeline; the printable region
  // matches the same html2canvas-safe inline styles used in the Client Report.
  const handlePrint = () => {
    try { window.print(); } catch { toast.error("Print failed."); }
  };

  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const doDocx = async () => {
    // The EP tab doesn't render `.pdf-page` sections — the walker falls back
    // to sectionizing on the printable root. Sectionize per PLAN card so each
    // plan starts on its own Word page.
    if (!printableRef.current) return;
    if (downloadingDocx) return;
    setDownloadingDocx(true);
    try {
      await downloadElementAsDocx({
        target: printableRef.current,
        filename: "ep-projection-plans.docx",
        sectionSelector: "[data-testid^='flow-plan-']",
      });
      toast.success("Word document downloaded.");
    } catch (e) {
      console.error("EP flowchart DOCX export failed", e);
      toast.error("DOCX generation failed. Try again.");
    } finally {
      setDownloadingDocx(false);
    }
  };

  // Plans keyed by number for the compare overlay renders.
  const currentPlansByNo = useMemo(() => {
    const map = {};
    (result?.plans || []).forEach((p) => { map[p.plan_no] = p; });
    return map;
  }, [result]);
  const comparePlansByNo = useMemo(() => {
    const map = {};
    (compareResult?.plans || []).forEach((p) => { map[p.plan_no] = p; });
    return map;
  }, [compareResult]);

  return (
    <div className="space-y-6" data-testid="ep-flowchart-root">
      {/* Header + print button */}
      <div className="flex items-start gap-3 print:hidden">
        <div className="w-10 h-10 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
          <Workflow className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="font-display text-2xl font-bold tracking-tight text-[#1A1A1A]">EP Projection — Estate Flowchart</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl leading-relaxed">
            The estate-funding plans you have selected above, traced from the first death to the children, repopulated from the loaded
            scenario&apos;s projected balances at the first-death year (50/50 spousal split) and carried to the
            second death using the retirement projection&apos;s actual balances — the totals on this page reconcile
            to the Projection tab. Plan 1 is the no-planning baseline; Plan 2 uses a Disclaimer Trust that preserves the
            Spouse&apos;s 9-month post-mortem election to fund (or not) the Client&apos;s GST exemption on the Roth;
            Plans 3–5 fund a GST-exempt trust at different times with different assets. Federal estate tax only —
            exclusions index at the model&apos;s CPI assumption.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={!result}
                  className="h-8 gap-1 text-xs" data-testid="flow-print-btn">
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={doDocx}
                  disabled={!result || downloadingDocx}
                  className="h-8 gap-1 text-xs border-[#4A6741] text-[#4A6741] hover:bg-[#4A6741]/5"
                  data-testid="flow-docx-btn"
                  title="Download an editable Word document — headings and tables are real Word text; plan flowchart boxes embed as images">
            {downloadingDocx
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building…</>
              : <><FileText className="h-3.5 w-3.5" /> Word (.docx)</>}
          </Button>
        </div>
      </div>

      {!hasSpouse && (
        <Card className="p-4 border-[#C87941]/50 bg-[#FEFAF1] shadow-none flex items-start gap-2" data-testid="flow-no-spouse-warning">
          <AlertTriangle className="h-4 w-4 text-[#8A5A20] mt-0.5 shrink-0" />
          <p className="text-xs text-[#8A5A20] leading-relaxed">
            The EP flowchart is designed for a two-spouse household (first death → survivor → second death).
            Add a spouse on Plan Inputs for a meaningful comparison.
          </p>
        </Card>
      )}

      {/* Assumptions */}
      <Card className="p-5 border-[#EBE8E0] shadow-none print:hidden" data-testid="flow-assumptions-card">
        <div className="flex flex-wrap items-end gap-6">
          <PctInput label="Capital gains rate (heirs)" value={capGains} onChange={setCapGains} testid="flow-capgains-input" />
          <PctInput label="Heir income tax rate (Trad. IRA)" value={heirIncome} onChange={setHeirIncome} testid="flow-heir-input" />
          <div data-testid="flow-plan-picker">
            <Label className="text-[11px] label-cap">Plans to display</Label>
            <div className="flex items-center gap-3 mt-2">
              {ALL_PLANS.map((n) => (
                <label key={n} className="flex items-center gap-1.5 cursor-pointer">
                  <Switch checked={!!flowPlans?.[n]} onCheckedChange={(v) => togglePlan(n, !!v)}
                          data-testid={`flow-plan-toggle-${n}`} />
                  <span className={`text-xs ${flowPlans?.[n] ? "text-[#1A1A1A] font-medium" : "text-muted-foreground"}`}>
                    {n}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Shared with the Client Report — changing it here changes the printed report too
            </p>
          </div>
          {result && (
            <div className="flex flex-wrap gap-6 text-xs text-muted-foreground pb-1" data-testid="flow-exclusion-summary">
              <span>First death <strong className="text-[#1A1A1A]">{result.first_death_year}</strong> · Fed exclusion <strong className="text-[#4A6741] tabular-nums">{fmtUSD(result.fed_excl_y1)}</strong></span>
              <span>Second death <strong className="text-[#1A1A1A]">{result.second_death_year}</strong> · Fed exclusion <strong className="text-[#4A6741] tabular-nums">{fmtUSD(result.fed_excl_y2)}</strong></span>
              {result.y2_reconciled_total != null && (
                <span data-testid="flow-reconciled-total">Second-death balances from retirement projection · <strong className="text-[#4A6741] tabular-nums">{fmtUSD(result.y2_reconciled_total)}</strong></span>
              )}
              <span>CPI indexing <strong className="text-[#1A1A1A]">{((scenario?.projection?.general_inflation ?? 0.03) * 100).toFixed(1)}%</strong></span>
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
          Balances at <em>both</em> deaths come from the loaded scenario&apos;s full retirement cash-flow and tax
          projection — each asset class is carried from the first death to the second death at the projection&apos;s
          actual path (spending, taxes, RMDs, and conversions included), not a uniform growth rate. All five plans
          start from identical balances, so the combined pre-tax total at the second death is the same in every plan;
          the plans differ only in <em>where</em> the assets sit and what tax they attract.
        </p>
      </Card>

      {busy && !result && (
        <div className="text-sm text-muted-foreground animate-pulse py-8 text-center" data-testid="flow-loading">Running projection…</div>
      )}
      {error && <p className="text-sm text-[#B84A4A]" data-testid="flow-error">{error}</p>}

      {/* Scenario compare bar (recommendation banner removed per user directive 2026-02-13). */}
      {result && (
        <ScenarioCompareBar
          currentScenario={scenario}
          assumptions={{ capGains, heirIncome, fallbackRate }}
          compareId={compareId} setCompareId={setCompareId}
          onResult={handleCompareResult}
        />
      )}

      {/* Selected plans, stacked (printable region — the printableRef wraps this + banner) */}
      {result && (
        <div ref={printableRef} className="space-y-8" data-testid="flow-plans-stack">
          {visiblePlans.map((p) => (
            <div key={p.key}>
              {compareResult && comparePlansByNo[p.plan_no] && (
                <ScenarioCompareOverlay
                  currentPlan={currentPlansByNo[p.plan_no]}
                  comparePlan={comparePlansByNo[p.plan_no]}
                  currentLabel="Current plan"
                  compareLabel={compareLabel || "Comparison"}
                  testid={`flow-compare-overlay-${p.plan_no}`}
                />
              )}
              <PlanFlowchart plan={p} ctx={result} />
            </div>
          ))}
          {visiblePlans.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="flow-no-plans">
              No plans selected — switch at least one on above.
            </p>
          )}
        </div>
      )}

      {/* Comparison matrix */}
      {result && (
        <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="flow-compare-card">
          <h3 className="font-display text-lg font-bold text-[#1A1A1A] mb-1">Plan comparison</h3>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            &ldquo;Economic net&rdquo; subtracts the embedded capital-gains liability on trust-held Taxable
            (which forgoes the second §1014 step-up) from the total reaching the children. The best structure
            depends on family objectives, asset growth, death timing, and future law — differences among plans
            may be small when the estate is below the exemption.
          </p>
          <PlanComparisonTable plans={visiblePlans} capGainsRate={result.cap_gains_rate} />
        </Card>
      )}

      {/* Methodology footnote */}
      {result && (
        <Card className="p-4 border-[#EBE8E0] bg-[#F9F8F6] shadow-none" data-testid="flow-methodology-note">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-[#4A6741] mt-0.5 shrink-0" />
            <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
              <p>
                <strong className="text-[#1A1A1A]">Methodology.</strong> Balances are sliced from the loaded scenario&apos;s
                projection at the first-death year and split 50/50 between spouses. Each asset class is then carried to
                the second death at the retirement projection&apos;s actual balance for that class — spending, taxes,
                RMDs, and conversions included — so this page reconciles to the Projection tab. Trusts are funded only
                from Roth + Taxable (Traditional never enters a trust; cash/house only in Plan&nbsp;4&apos;s
                everything-at-second-death funding). The family home and cash are assumed sold at the survivor&apos;s
                death and reinvested at the Taxable rate. Federal estate tax at 40% applies above (Fed exclusion at
                second death + DSUE).
              </p>
              <p>
                <strong className="text-[#1A1A1A]">GST is not portable.</strong> The second-death trust can be funded up to
                the estate-tax shelter (exclusion + DSUE), but only the survivor&apos;s <em>own</em> exemption is GST-exempt —
                which is why Plans 2, 3 and 4 (funding at first death, whether pre-committed or disclaimer-elected)
                preserve more dynasty shelter than Plan 5. State estate taxes are not modeled on this page — see the Estate tab.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default EpFlowchart;
