import { Target, MinusCircle } from "lucide-react";
import { getStrategyLabel } from "@/lib/strategyLabel";

// Compact strategy identifier shown at the top of every page that renders
// results driven by the current scenario.roth config (Multi-Year Projection,
// Detail/Cashflow, Analytics, Presentation).
//
// Format: "Strategy: Fill 22% · 2026–2033 · Funding: Cash → Taxable → IRA → Roth"
export const StrategyBadge = ({ scenario, testid = "strategy-badge" }) => {
  const s = getStrategyLabel(scenario);
  const active = s.active;
  const Icon = active ? Target : MinusCircle;
  const accent = active ? "#4A6741" : "#8A8A82";
  const bg = active ? "#4A67410D" : "#F3F1EC";
  const border = active ? "#4A6741" : "#D9D5CC";

  return (
    <div
      data-testid={testid}
      className="rounded-lg px-4 py-2.5 flex items-center gap-3 flex-wrap"
      style={{ border: `1px solid ${border}`, background: bg }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <Icon className="h-4 w-4" style={{ color: accent }} />
        <span className="label-cap text-[10px]" style={{ color: accent }}>Strategy modeled</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span
          data-testid={`${testid}-label`}
          className="font-display text-sm font-bold tracking-tight text-[#1A1A1A] truncate"
          title={s.label}
        >
          {s.label}
        </span>
        <span className="text-muted-foreground text-xs">·</span>
        <span
          data-testid={`${testid}-funding`}
          className="text-xs text-muted-foreground"
          title={`Funding order: ${s.fundingOrder}`}
        >
          Funding: <span className="text-[#1A1A1A] font-medium">{s.fundingOrder}</span>
        </span>
      </div>
    </div>
  );
};
