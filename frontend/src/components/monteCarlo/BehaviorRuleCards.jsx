/**
 * MonteCarlo behavior-rule cards — guardrail + halt + rebalance cadence.
 *
 * Extracted from MonteCarlo.jsx (Phase 40 refactor). Three collapsible option
 * cards that layer real-world advisor rules on the simulation:
 *   1. Spending Guardrail — Guyton-Klinger cut on discretionary expenses.
 *   2. Conversion Halt — cancel remaining planned Roth conversions after a
 *      YoY drawdown (with optional recovery-based resume).
 *   3. Rebalance Cadence — annual / biennial / never (drives portfolio drift).
 */
import React from "react";
import { LifeBuoy, PauseCircle, RefreshCw } from "lucide-react";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

export const GuardrailCard = ({ grOn, setGrOn, grCut, setGrCut }) => (
  <div className="rounded-lg border border-[#EBE8E0] p-3" data-testid="mc-guardrail-card">
    <div className="flex items-center justify-between">
      <Label className="text-xs flex items-center gap-1.5">
        <LifeBuoy className="h-3.5 w-3.5 text-[#4A6741]" /> Spending guardrail
      </Label>
      <Switch checked={grOn} onCheckedChange={setGrOn} data-testid="mc-guardrail-toggle" />
    </div>
    {grOn && (
      <div className="mt-3">
        <Label className="text-[10px] text-muted-foreground">Cut discretionary spending after a loss year by %</Label>
        <Input type="number" step={5} min={0} max={50} value={grCut} data-testid="mc-guardrail-cut"
          onChange={(e) => setGrCut(Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)))}
          className="h-8 text-right bg-white" />
      </div>
    )}
    <p className="text-[10px] text-muted-foreground mt-2">
      Real retirees trim spending after bad markets (Guyton-Klinger guardrails). When on, expenses — never
      taxes — are cut in any year that follows a portfolio loss, and the success-rate lift is reported.
    </p>
  </div>
);

export const HaltCard = ({ haltOn, setHaltOn, haltDrop, setHaltDrop, haltResume, setHaltResume }) => (
  <div className="rounded-lg border border-[#EBE8E0] p-3" data-testid="mc-halt-card">
    <div className="flex items-center justify-between">
      <Label className="text-xs flex items-center gap-1.5">
        <PauseCircle className="h-3.5 w-3.5 text-[#4A6741]" /> Halt conversions on drawdown
      </Label>
      <Switch checked={haltOn} onCheckedChange={setHaltOn} data-testid="mc-halt-toggle" />
    </div>
    {haltOn && (
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">YoY drop % that halts</Label>
          <Input type="number" step={1} min={2} max={50} value={haltDrop} data-testid="mc-halt-drop"
            onChange={(e) => setHaltDrop(Math.max(2, Math.min(50, parseFloat(e.target.value) || 0)))}
            className="h-8 text-right bg-white" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Resume after N positive years (0 = permanent)</Label>
          <Input type="number" step={1} min={0} max={20} value={haltResume} data-testid="mc-halt-resume"
            onChange={(e) => setHaltResume(Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)))}
            className="h-8 text-right bg-white" />
        </div>
      </div>
    )}
    <p className="text-[10px] text-muted-foreground mt-2">
      Advisor behavioral rule: cancel remaining planned conversions in any trial whose prior-year portfolio
      return fell below the threshold. Recovery mode: after N consecutive positive-return years the trial
      RESUMES conversions (and can be halted again by a later drop). N=0 keeps the halt permanent.
    </p>
  </div>
);

export const RebalanceCadenceCard = ({ rebalCadence, setRebalCadence }) => (
  <div className="rounded-lg border border-[#EBE8E0] p-3" data-testid="mc-rebalance-card">
    <div className="flex items-center justify-between">
      <Label className="text-xs flex items-center gap-1.5">
        <RefreshCw className="h-3.5 w-3.5 text-[#4A6741]" /> Rebalance cadence
      </Label>
      <div className="inline-flex rounded-full border border-[#EBE8E0] p-0.5 text-[11px]">
        {["annual", "biennial", "never"].map((c) => (
          <button key={c} onClick={() => setRebalCadence(c)}
            data-testid={`mc-rebalance-${c}`}
            className={`px-2 py-0.5 rounded-full transition-colors ${rebalCadence === c ? "bg-[#4A6741] text-white" : "text-muted-foreground hover:text-[#4A6741]"}`}>
            {c === "annual" ? "Annual" : c === "biennial" ? "Biennial" : "Never"}
          </button>
        ))}
      </div>
    </div>
    <p className="text-[10px] text-muted-foreground mt-2">
      How often the household portfolio is rebalanced back to the target stocks / bonds / cash mix.
      <strong> Annual</strong> resets every year (default). <strong>Biennial</strong> lets weights drift 1 year
      then snaps back. <strong>Never</strong> lets weights drift for the full horizon — dispersion widens as the
      stock allocation compounds up in bull runs and shrinks in busts.
    </p>
  </div>
);
