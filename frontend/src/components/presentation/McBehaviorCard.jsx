import React from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity } from "lucide-react";
import { useSharedGuardrail } from "@/hooks/useSharedGuardrail";
import { useSharedHalt } from "@/hooks/useSharedHalt";

/**
 * McBehaviorCard — the Monte Carlo spending guardrail + drawdown conversion halt,
 * surfaced on the Presentation / Client Deck tab. Reads and writes the SAME
 * shared stores as the Monte Carlo tab and the Client Report, so a change on any
 * of the three flows through to the other two and to every printed note.
 */
export const McBehaviorCard = () => {
  const { grOn, setGrOn, grCut, setGrCut } = useSharedGuardrail();
  const { haltOn, setHaltOn, haltDrop, setHaltDrop, haltResume, setHaltResume } = useSharedHalt();

  return (
    <div className="mt-4 rounded-lg border border-[#4A6741]/30 bg-white p-4"
         data-testid="pres-mc-behavior-card">
      <p className="text-sm font-semibold text-[#1A1A1A] flex items-center gap-2">
        <Activity className="h-4 w-4 text-[#4A6741]" /> Monte Carlo behavioral rules
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5 mb-3 leading-relaxed">
        One shared setting with the <span className="font-medium">Monte Carlo</span> and{" "}
        <span className="font-medium">Client Report</span> tabs — change it here and it changes there. When either
        rule is on, the deck says so in the commentary on the assumptions, convert-or-don&apos;t-convert and
        caveats pages.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[#EBE8E0] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#1A1A1A]">Spending guardrail</span>
            <Switch checked={grOn} onCheckedChange={setGrOn} data-testid="pres-gr-toggle" />
          </div>
          {grOn && (
            <div className="mt-2 flex items-center gap-2">
              <Label className="text-[11px] text-muted-foreground shrink-0">Cut discretionary spending (%):</Label>
              <Input type="number" step={5} min={0} max={50} value={grCut} data-testid="pres-gr-cut"
                onChange={(e) => setGrCut(e.target.value)}
                className="h-7 w-20 text-right text-[11px] bg-white" />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Guyton-Klinger-lite: trim discretionary spending by this % in any year that follows a portfolio loss
            (taxes never flex).
          </p>
        </div>

        <div className="rounded-lg border border-[#EBE8E0] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#1A1A1A]">Halt conversions on drawdown</span>
            <Switch checked={haltOn} onCheckedChange={setHaltOn} data-testid="pres-halt-toggle" />
          </div>
          {haltOn && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">YoY drop threshold (%)</Label>
                <Input type="number" step={1} min={2} max={50} value={haltDrop} data-testid="pres-halt-drop"
                  onChange={(e) => setHaltDrop(e.target.value)}
                  className="h-7 mt-1 text-right text-[11px] bg-white" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Resume after N positive years</Label>
                <Input type="number" step={1} min={0} max={10} value={haltResume} data-testid="pres-halt-resume"
                  onChange={(e) => setHaltResume(e.target.value)}
                  className="h-7 mt-1 text-right text-[11px] bg-white" />
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Cancel remaining planned conversions in any trial where the prior-year return dropped by ≥ this %;
            resume after N consecutive positive years (0 = permanent halt for that trial).
          </p>
        </div>
      </div>
    </div>
  );
};

export default McBehaviorCard;
