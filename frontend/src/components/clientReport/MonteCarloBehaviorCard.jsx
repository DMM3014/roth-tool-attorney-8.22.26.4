/**
 * Monte Carlo behavioral realism toolbar — halt + guardrail + regime toggles.
 *
 * Extracted from ClientReport.jsx (Phase 40 refactor). Every toggle here flows
 * into the report's MC page and the methodology block auto-updates from the
 * result payload. Any change re-runs the simulation (~2 sec).
 *
 * Halt-conversions inputs mirror the Monte Carlo tab EXACTLY (threshold %
 * drop AND resume-after-N-positive-years) so the Client Report never silently
 * drops behavioral rules the advisor configured on the MC tab. A stale banner
 * appears when the MC result no longer reflects the current inputs, with a
 * one-click "Rerun now" button.
 */
import React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

export const MonteCarloBehaviorCard = ({
  haltOn, setHaltOn, haltDrop, setHaltDrop,
  haltResume, setHaltResume,
  grOn, setGrOn, grCut, setGrCut,
  regimeOn, setRegimeOn, regimeRunning,
  seqOn, setSeqOn, seqRunning,
  basisOn, setBasisOn,
  pairedOn, setPairedOn,
  inputsOn, setInputsOn,
  bracketOn, setBracketOn,
  mcStale, mcRunning, onRerun,
}) => {
  return (
    <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-4 mb-4"
         data-testid="cr-mc-behavior-card">
      <p className="text-sm font-semibold text-[#1A1A1A] mb-1">Monte Carlo — behavioral realism</p>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        Layer real-world advisor rules onto the MC simulation. Both flow into the printed
        client report and its methodology block automatically. Any change re-runs the
        simulation (~2 sec).
      </p>
      {mcStale && (
        <div data-testid="cr-mc-stale-banner"
             className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[#E5B87A] bg-[#FDF6EC] px-3 py-2">
          <div className="flex items-start gap-2 text-[11px] text-[#8A5A20] leading-relaxed">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Monte Carlo inputs or plan data have changed since the last run — the results
              shown below are <strong>out of date</strong>. Click <em>Rerun now</em> to refresh.
            </span>
          </div>
          <Button size="sm" variant="outline"
                  onClick={onRerun} disabled={!!mcRunning}
                  data-testid="cr-mc-rerun-btn"
                  className="h-7 text-[11px] shrink-0 border-[#8A5A20] text-[#8A5A20] hover:bg-[#F6E4C6]">
            {mcRunning ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running…</> : "Rerun now"}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[#EBE8E0] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#1A1A1A]">Halt conversions on drawdown</span>
            <Switch checked={haltOn} onCheckedChange={setHaltOn} data-testid="cr-halt-toggle" />
          </div>
          {haltOn && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] text-muted-foreground shrink-0">YoY drop threshold (%)</Label>
                <Input type="number" step={1} min={2} max={50} value={haltDrop} data-testid="cr-halt-drop"
                  onChange={(e) => setHaltDrop(Math.max(2, Math.min(50, parseInt(e.target.value, 10) || 10)))}
                  className="h-7 mt-1 text-right text-[11px] bg-white" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground shrink-0">
                  Resume after N positive years
                </Label>
                <Input type="number" step={1} min={0} max={10}
                  value={haltResume ?? 2} data-testid="cr-halt-resume"
                  onChange={(e) => setHaltResume(Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0)))}
                  className="h-7 mt-1 text-right text-[11px] bg-white" />
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Cancel remaining planned Roth conversions in any trial where the prior-year
            portfolio return dropped by ≥ this %. Conversions <strong>resume</strong> after N
            consecutive positive-return years (0 = permanent halt for that trial).
          </p>
        </div>

        <div className="rounded-lg border border-[#EBE8E0] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#1A1A1A]">Spending guardrail</span>
            <Switch checked={grOn} onCheckedChange={setGrOn} data-testid="cr-gr-toggle" />
          </div>
          {grOn && (
            <div className="mt-2 flex items-center gap-2">
              <Label className="text-[11px] text-muted-foreground shrink-0">Cut discretionary spending (%):</Label>
              <Input type="number" step={5} min={0} max={50} value={grCut} data-testid="cr-gr-cut"
                onChange={(e) => setGrCut(Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 10)))}
                className="h-7 w-20 text-right text-[11px] bg-white" />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Guyton-Klinger-lite: trim discretionary spending by this % in any year that follows
            a portfolio loss (taxes never flex).
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-6 items-center border-t border-[#EBE8E0] pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={regimeOn} onCheckedChange={setRegimeOn} data-testid="cr-regime-toggle" />
          <span className="text-xs text-muted-foreground">
            Include Regime Comparison print page {regimeRunning && "(re-running...)"} — reruns the sim under every
            named market regime and prints a side-by-side success-rate table
            {(grOn || haltOn) && ", with a paired 'without behavior' row per regime"}
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={!!seqOn} onCheckedChange={setSeqOn} data-testid="cr-seq-toggle" />
          <span className="text-xs text-muted-foreground">
            Include Sequence-of-returns print page {seqRunning && "(running...)"} — the same long-run average
            delivered early-bear, late-bear and volatile, each run with and without the conversion schedule.
            Settings come from the <span className="font-medium">Sequence Risk</span> tab
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={!!pairedOn} onCheckedChange={setPairedOn} data-testid="cr-paired-toggle" />
          <span className="text-xs text-muted-foreground">
            Include Paired A/B print page — per-trial Δ ending wealth (Roth minus no-conversions) on identical
            market seeds, plus a percentile table and ±p95 histogram
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={!!basisOn} onCheckedChange={setBasisOn} data-testid="cr-basis-toggle" />
          <span className="text-xs text-muted-foreground">
            Include Basis Step-Up print page — after-tax value to heirs by account type (Roth / Taxable / Traditional)
            at second death with the Roth-conversion inheritance-upside callout
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={!!bracketOn} onCheckedChange={setBracketOn} data-testid="cr-bracket-snapshots-toggle" />
          <span className="text-xs text-muted-foreground">
            Include Tax Bracket snapshots print page — bucket diagrams at the first conversion year, the year
            RMDs begin, and the final conversion year, on one shared dollar scale
            <em> (recommended — on by default)</em>
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={!!inputsOn} onCheckedChange={setInputsOn} data-testid="cr-inputs-appendix-toggle" />
          <span className="text-xs text-muted-foreground">
            Include Client Inputs appendix — snapshots household, accounts, income streams, expenses, tax
            settings, Roth strategy, and projection settings at the back of the report so clients can trace
            any figure back to what was assumed <em>(recommended — on by default)</em>
          </span>
        </label>
      </div>
    </div>
  );
};
