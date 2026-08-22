/**
 * Report customization toolbar — milestone editor + state exclusions + PV slider.
 *
 * Extracted from ClientReport.jsx (Phase 40 refactor). Fine-tunes the Income &
 * Expenses milestone table, the state-taxable chart, and the Legacy page's
 * Present Value framing. All settings are per-browser and persist between
 * sessions except custom milestones which persist on the scenario itself.
 */
import React, { useEffect, useState } from "react";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { suggestMilestoneYear, fmtPct } from "./helpers.jsx";
import { listScenarios } from "@/lib/api";

export const ReportCustomizationCard = ({
  scenario,
  customMilestones, setCustomMilestones,
  stateExclusions, setStateExclusions,
  pvRateOverride, setPvRateOverride,
  flowOn, setFlowOn,
  flowPlans, setFlowPlans,
  flowCompareOn, setFlowCompareOn,
  flowScenarioCompareId, setFlowScenarioCompareId,
}) => {
  const [savedScenarios, setSavedScenarios] = useState([]);
  useEffect(() => {
    let alive = true;
    listScenarios()
      .then((items) => { if (alive) setSavedScenarios(items || []); })
      .catch(() => { if (alive) setSavedScenarios([]); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-4 mb-4"
         data-testid="cr-extras-card">
      <p className="text-sm font-semibold text-[#1A1A1A] mb-1">Report customization</p>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        Fine-tune the Income &amp; Expenses milestone table, the state-taxable chart, and the Legacy
        page&apos;s Present Value framing. All settings are per browser and persist between sessions.
      </p>

      {/* Custom milestone years — up to 3 named columns */}
      <div className="rounded-lg border border-[#EBE8E0] p-3 mb-3">
        <p className="text-xs font-medium text-[#1A1A1A] mb-2">Custom milestone columns (up to 3)</p>
        <p className="text-[10.5px] text-muted-foreground mb-2 leading-relaxed">
          Adds a labeled column to the Income &amp; Expenses milestone tables alongside the fixed Today / +5 /
          +10 / +20 / End slots. Sorted chronologically. Type a common label
          (<em>Retirement</em>, <em>RMDs Begin</em>, <em>First Death</em>, <em>Second Death</em>,
          <em> Medicare</em>) and the year auto-fills from the household&apos;s DOBs, retirement dates and
          life expectancy — you can always override it.
        </p>
        {[0, 1, 2].map((i) => {
          const m = customMilestones[i] || { name: "", year: "" };
          const updateM = (patch) => {
            const next = [0, 1, 2].map((k) => customMilestones[k] || { name: "", year: "" });
            next[i] = { ...next[i], ...patch };
            setCustomMilestones(next);
          };
          const onNameChange = (v) => {
            const patch = { name: v };
            const suggested = suggestMilestoneYear(v, scenario);
            if (suggested != null && !m.year) patch.year = suggested;
            updateM(patch);
          };
          return (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <Input type="text" placeholder="Label (e.g. Retirement)" value={m.name}
                onChange={(e) => onNameChange(e.target.value)}
                className="h-7 flex-1 text-[11px] bg-white"
                data-testid={`cr-milestone-name-${i}`} />
              <Input type="number" placeholder="Year" value={m.year}
                onChange={(e) => updateM({ year: e.target.value ? parseInt(e.target.value, 10) : "" })}
                className="h-7 w-24 text-right text-[11px] bg-white"
                data-testid={`cr-milestone-year-${i}`} />
            </div>
          );
        })}
      </div>

      {/* State exclusions — controls the state-taxable stacked chart on Income & Expenses */}
      <div className="rounded-lg border border-[#EBE8E0] p-3 mb-3">
        <p className="text-xs font-medium text-[#1A1A1A] mb-2">State-taxable exclusions</p>
        <p className="text-[10.5px] text-muted-foreground mb-2 leading-relaxed">
          Which federal-taxable categories the client&apos;s state exempts. Feeds the &ldquo;State taxable
          income by source&rdquo; chart on the Income &amp; Expenses page. <strong>Display-only</strong>
          — actual state tax in the projection engine uses the full state bracket schedule + real
          retirement-income exclusions (set the state on Plan Inputs).
        </p>
        {[
          ["ss", "Social Security exempt (most states)"],
          ["pension", "Pension income exempt (e.g. Illinois, Mississippi)"],
          ["rmds", "Traditional-IRA / 401(k) RMDs exempt (rare — e.g. Illinois)"],
        ].map(([key, label]) => {
          const cur = stateExclusions?.[key] ?? true;
          return (
            <label key={key} className="flex items-center gap-2 cursor-pointer mb-1">
              <Switch checked={!!cur}
                onCheckedChange={(v) => setStateExclusions((p) => ({ ...(p || {}), [key]: !!v }))}
                data-testid={`cr-state-excl-${key}`} />
              <span className="text-[11px] text-muted-foreground">{label}</span>
            </label>
          );
        })}
      </div>

      {/* EP Projection flowchart pages — plan selection for the printed report */}
      <div className="rounded-lg border border-[#EBE8E0] p-3 mb-3" data-testid="cr-flow-card">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-[#1A1A1A]">EP Projection flowchart pages</p>
          <Switch checked={!!flowOn} onCheckedChange={(v) => setFlowOn(!!v)} data-testid="cr-flow-toggle" />
        </div>
        <p className="text-[10.5px] text-muted-foreground mb-2 leading-relaxed">
          Adds the estate flowchart pages (one per plan) replicating the workbook&apos;s EP Projection tab —
          repopulated from this scenario&apos;s balances at the first-death year. Pick which plans print — the
          same selection drives the EP Flowchart tab.
        </p>
        {flowOn && (
          <>
            {[[1, "Plan 1 — No Trust Planning"],
              [2, "Plan 2 — Disclaimer Trust (Roth disclaimed, 2nd step-up preserved)"],
              [3, "Plan 3 — Taxable-First GST Trust"],
              [4, "Plan 4 — Roth-Only GST Trust"],
              [5, "Plan 5 — GST Trust at Second Death"]].map(([n, label]) => (
              <label key={n} className="flex items-center gap-2 cursor-pointer mb-1">
                <Switch checked={!!flowPlans?.[n]}
                  onCheckedChange={(v) => setFlowPlans((p) => ({ ...(p || {}), [n]: !!v }))}
                  data-testid={`cr-flow-plan-toggle-${n}`} />
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 cursor-pointer mt-2 pt-2 border-t border-[#F3F1EC]">
              <Switch checked={!!flowCompareOn} onCheckedChange={(v) => setFlowCompareOn(!!v)}
                data-testid="cr-flow-compare" />
              <span className="text-[11px] text-muted-foreground">Include plan-comparison table page (needs ≥ 2 plans)</span>
            </label>
            {setFlowScenarioCompareId && (
              <div className="mt-3 pt-3 border-t border-[#F3F1EC]">
                <p className="text-[11px] font-medium text-[#1A1A1A] mb-1">
                  Scenario comparison page (optional)
                </p>
                <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
                  Adds one paired page per selected plan showing current-scenario vs. saved-scenario deltas
                  (e.g. how a stronger Roth conversion schedule changes total-to-children). Same growth /
                  cap-gains / heir-income assumptions on both sides.
                </p>
                <Select value={flowScenarioCompareId || "NONE"}
                        onValueChange={(v) => setFlowScenarioCompareId(v === "NONE" ? "" : v)}>
                  <SelectTrigger className="h-8 bg-white text-[11px]" data-testid="cr-flow-scenario-compare-select">
                    <SelectValue placeholder="Choose a saved scenario…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No comparison — skip these pages</SelectItem>
                    {savedScenarios.length === 0 && (
                      <SelectItem value="EMPTY" disabled>No saved scenarios yet</SelectItem>
                    )}
                    {savedScenarios.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}
      </div>

      {/* Legacy PV discount rate slider */}
      <div className="rounded-lg border border-[#EBE8E0] p-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-[#1A1A1A]">Present-value framing — today&apos;s dollars</p>
          <span className="text-[11px] text-[#4A6741] tabular-nums" data-testid="cr-pv-rate-display">
            {(pvRateOverride ?? (scenario?.projection?.general_inflation ?? 0.03)).toLocaleString(undefined, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2 })}
          </span>
        </div>
        <p className="text-[10.5px] text-muted-foreground mb-2 leading-relaxed">
          Discount rate behind every &ldquo;in today&apos;s dollars&rdquo; figure in the report — the
          convert-or-skip milestones, the year-by-year drivers, the beneficiary-rate band and the Legacy page&apos;s
          Present Value chart. Higher rates shrink future dollars more aggressively. Defaults to the
          scenario&apos;s general inflation ({fmtPct(scenario?.projection?.general_inflation ?? 0.03)}) so the
          PV figures never contradict the rest of the model.
        </p>
        <div className="flex items-center gap-2">
          <input type="range" min="0" max="10" step="0.25"
            value={((pvRateOverride ?? (scenario?.projection?.general_inflation ?? 0.03)) * 100).toFixed(2)}
            onChange={(e) => setPvRateOverride(parseFloat(e.target.value) / 100)}
            className="flex-1 accent-[#4A6741]"
            data-testid="cr-pv-rate-slider" />
          <Button size="sm" variant="outline" onClick={() => setPvRateOverride(null)}
            data-testid="cr-pv-rate-reset"
            className="h-7 text-[10px] shrink-0">Reset to plan</Button>
        </div>
      </div>
    </div>
  );
};
