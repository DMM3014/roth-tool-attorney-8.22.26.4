// Market Scenario selector + read-only badge/ribbon.
//
// The selector patches `scenario.market_scenario.id` — every result tab reruns
// automatically because the existing debounced projection watches JSON.stringify(scenario).
//
// Compat: when the scenario has no `market_scenario` block, we treat the plan as
// running under `historical_avg` (the default, and a mathematical no-op).

import { useEffect, useState } from "react";
import { AlertTriangle, LineChart } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { fetchMarketScenarios } from "@/lib/api";

// Shared cache — the presets library is static per app run, no reason to refetch.
let _presetsCache = null;
let _presetsPromise = null;
export const useMarketPresets = () => {
  const [data, setData] = useState(_presetsCache);
  useEffect(() => {
    if (_presetsCache) return;
    if (!_presetsPromise) _presetsPromise = fetchMarketScenarios().catch(() => null);
    _presetsPromise.then((res) => { if (res) { _presetsCache = res; setData(res); } });
  }, []);
  return data;
};

// Small helper to keep the id lookup consistent everywhere.
export const getActivePreset = (scenario, presets) => {
  if (!presets) return null;
  const id = scenario?.market_scenario?.id || presets.default_id;
  return presets.presets.find((p) => p.id === id) || presets.presets.find((p) => p.id === presets.default_id) || null;
};

// ---------------------------------------------------------------------------
// Dropdown (used on Plan Inputs)
// ---------------------------------------------------------------------------
export const MarketScenarioSelector = ({ scenario, setScenario }) => {
  const data = useMarketPresets();
  if (!data) {
    return (
      <div className="rounded-lg border border-[#EBE8E0] bg-white p-4">
        <p className="label-cap text-muted-foreground text-[10px]">Loading market scenarios…</p>
      </div>
    );
  }
  const activeId = scenario?.market_scenario?.id || data.default_id;
  const active = data.presets.find((p) => p.id === activeId) || data.presets.find((p) => p.id === data.default_id);
  const isDefault = activeId === data.default_id;

  const setId = (id) => {
    setScenario((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      next.market_scenario = { ...(next.market_scenario || {}), id };
      return next;
    });
  };

  return (
    <div
      data-testid="market-scenario-selector"
      className="rounded-xl border p-4 md:p-5"
      style={{
        borderColor: isDefault ? "#EBE8E0" : "#C87941",
        background: isDefault ? "#F9F8F6" : "#FBF3EC",
      }}
    >
      <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
        <div className="flex items-center gap-2 shrink-0 md:min-w-[180px]">
          <LineChart className="h-4 w-4 text-[#4A6741]" />
          <div>
            <Label className="text-[11px] label-cap block">Market Scenario</Label>
            <p className="text-[10px] text-muted-foreground leading-tight max-w-[220px]">
              What-if lens on returns &amp; inflation. Historical Average is the default and reproduces the baseline projection.
            </p>
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <Select value={activeId} onValueChange={setId}>
            <SelectTrigger
              data-testid="market-scenario-trigger"
              className="h-9 text-sm bg-white"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.presets.map((p) => (
                <SelectItem
                  key={p.id}
                  value={p.id}
                  data-testid={`market-scenario-option-${p.id}`}
                >
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {active && (
            <p
              data-testid="market-scenario-description"
              className="text-[11px] text-muted-foreground mt-2 leading-snug"
            >
              {active.description}
            </p>
          )}
          {!isDefault && (
            <div
              data-testid="market-scenario-warning-inline"
              className="mt-2 flex items-start gap-1.5 text-[10px] text-[#C87941]"
            >
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>
                Non-baseline regime — results on every tab reflect these assumptions, not your default plan.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Compact read-only badge (used at the top of result pages, next to StrategyBadge)
// ---------------------------------------------------------------------------
export const MarketBadge = ({ scenario, testid = "market-badge" }) => {
  const data = useMarketPresets();
  if (!data) return null;
  const activeId = scenario?.market_scenario?.id || data.default_id;
  const active = data.presets.find((p) => p.id === activeId);
  if (!active) return null;
  const isDefault = activeId === data.default_id;

  const accent = isDefault ? "#4A6741" : "#C87941";
  const bg = isDefault ? "#4A67410D" : "#C879410D";
  const border = isDefault ? "#4A6741" : "#C87941";

  return (
    <div
      data-testid={testid}
      className="rounded-lg px-4 py-2.5 flex items-center gap-3 flex-wrap"
      style={{ border: `1px solid ${border}`, background: bg }}
      title={active.description}
    >
      <div className="flex items-center gap-2 shrink-0">
        <LineChart className="h-4 w-4" style={{ color: accent }} />
        <span className="label-cap text-[10px]" style={{ color: accent }}>Market regime</span>
      </div>
      <span
        data-testid={`${testid}-label`}
        className="font-display text-sm font-bold tracking-tight text-[#1A1A1A]"
      >
        {active.label}
      </span>
      {!isDefault && (
        <span
          data-testid={`${testid}-warning`}
          className="inline-flex items-center gap-1 text-[10px] font-medium"
          style={{ color: "#C87941" }}
        >
          <AlertTriangle className="h-3 w-3" /> Non-baseline
        </span>
      )}
    </div>
  );
};
