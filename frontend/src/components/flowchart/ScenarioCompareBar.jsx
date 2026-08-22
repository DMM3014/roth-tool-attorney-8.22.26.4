/**
 * ScenarioCompareBar — dropdown that lets advisors overlay a saved scenario's
 * flowchart totals next to the currently-loaded scenario, so clients can see
 * how Roth conversions (or any other plan change) shift the trust math.
 *
 * Pattern: fetches the list of saved scenarios once on mount, plus a live
 * flowchart response for the picked comparison scenario using the SAME
 * cap-gains / heir-income assumptions as the current scenario, with each
 * side's death-year balances coming from its own retirement projection.
 */
import { useEffect, useMemo, useState } from "react";
import { GitCompareArrows, X, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { listScenarios, runProjection, runEpFlowchart } from "@/lib/api";

const STORAGE_KEY = "ep_flowchart_compare_id_v1";

/** Same convention as EpFlowchart.jsx — derive death years from household. */
const deriveDeathYears = (scenario) => {
  const h = scenario?.household || {};
  const c = (h.client_dob_year && h.client_life_expectancy) ? h.client_dob_year + h.client_life_expectancy : null;
  const s = (h.spouse_dob_year && h.spouse_life_expectancy) ? h.spouse_dob_year + h.spouse_life_expectancy : null;
  const first = (c != null && s != null) ? Math.min(c, s) : (c || s || scenario?.projection?.end_year);
  const second = (c != null && s != null) ? Math.max(c, s) : (c || s || scenario?.projection?.end_year);
  return { first, second };
};

/**
 * Props:
 *   currentScenario — the scenario currently loaded into the planner
 *   assumptions     — {growthRate, capGains, heirIncome} shared with current tab
 *   compareId, setCompareId — controlled selection
 *   onResult(name, flowResult|null) — callback with the resolved flowchart data
 */
export const ScenarioCompareBar = ({ currentScenario, assumptions, compareId, setCompareId, onResult }) => {
  const [scenarios, setScenarios] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // One-time list fetch on mount. Cheap — user's saved scenarios are ≤ dozens.
  useEffect(() => {
    listScenarios().then((items) => setScenarios(items || [])).catch(() => setScenarios([]));
  }, []);

  // Hydrate compareId from localStorage on first successful list fetch.
  useEffect(() => {
    if (scenarios.length === 0 || compareId) return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && scenarios.some((s) => s.id === saved)) setCompareId(saved);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios]);

  useEffect(() => {
    try {
      if (compareId) window.localStorage.setItem(STORAGE_KEY, compareId);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, [compareId]);

  const chosen = useMemo(() => scenarios.find((s) => s.id === compareId), [scenarios, compareId]);

  // Run the comparison flowchart whenever the chosen scenario OR the shared
  // assumptions change. If nothing chosen: clear result.
  useEffect(() => {
    if (!chosen?.config) { onResult(null, null); return; }
    let alive = true;
    setBusy(true); setError("");
    (async () => {
      try {
        const proj = await runProjection(chosen.config);
        if (!alive) return;
        const { first, second } = deriveDeathYears(chosen.config);
        const rows = proj.rows || [];
        const rowAt = (yr) => rows.find((r) => r.year >= yr) || rows[rows.length - 1];
        const row = rowAt(first);
        const row2 = rowAt(second);
        if (!row || !row2) throw new Error("No projection rows for comparison scenario.");
        const halfCashHouse = ((row.cash || 0) + (row.real_estate || 0)) / 2;
        const flow = await runEpFlowchart({
          first_death_year: first,
          second_death_year: second,
          client_roth: (row.roth || 0) / 2,
          client_taxable: (row.taxable || 0) / 2,
          client_cash_house: halfCashHouse,
          client_traditional: (row.traditional || 0) / 2,
          survivor_roth: (row.roth || 0) / 2,
          survivor_taxable: (row.taxable || 0) / 2,
          survivor_cash_house: halfCashHouse,
          survivor_traditional: (row.traditional || 0) / 2,
          // The comparison scenario's own second-death balances — each side
          // reconciles to its own retirement projection.
          y2_roth: row2.roth || 0,
          y2_taxable: row2.taxable || 0,
          y2_cash_house: (row2.cash || 0) + (row2.real_estate || 0),
          y2_traditional: row2.traditional || 0,
          // SHARED cap-gains / heir-income assumptions so the delta reflects plan-input changes.
          growth_rate: assumptions.fallbackRate ?? 0.06,
          cap_gains_rate: assumptions.capGains,
          heir_income_rate: assumptions.heirIncome,
          indexing_rate: chosen.config?.projection?.general_inflation ?? currentScenario?.projection?.general_inflation ?? 0.03,
        });
        if (alive) onResult(chosen.name, flow);
      } catch (e) {
        if (alive) { setError(e?.message || "Comparison failed."); onResult(null, null); }
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, assumptions.capGains, assumptions.heirIncome, assumptions.fallbackRate]);

  return (
    <Card className="p-4 border-[#EBE8E0] shadow-none" data-testid="flow-compare-scenario-bar">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-2 pt-2">
          <GitCompareArrows className="h-4 w-4 text-[#4A6741] shrink-0" />
          <Label className="text-sm font-semibold text-[#1A1A1A]">Compare against saved scenario</Label>
        </div>
        <div className="flex-1 min-w-[240px]">
          <Select value={compareId || "NONE"} onValueChange={(v) => setCompareId(v === "NONE" ? "" : v)}>
            <SelectTrigger className="h-9 bg-[#F9F8F6]" data-testid="flow-compare-select">
              <SelectValue placeholder="Choose a saved scenario…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">No comparison — hide overlay</SelectItem>
              {scenarios.length === 0 && (
                <SelectItem value="EMPTY" disabled>No saved scenarios yet</SelectItem>
              )}
              {scenarios.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground italic mt-1">
            Both scenarios share the cap-gains / heir-income assumptions on this tab, and each side&apos;s balances at
            both deaths come from its own retirement projection — the delta reflects the plan-input differences
            (e.g. Roth conversion schedule, expenses).
          </p>
        </div>
        {compareId && (
          <div className="flex items-center gap-2 pt-1">
            {busy && <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin" />}
            <Button variant="ghost" size="sm" onClick={() => setCompareId("")}
                    className="h-7 gap-1 text-[11px]" data-testid="flow-compare-clear">
              <X className="h-3 w-3" /> Clear
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-[#B84A4A] mt-2" data-testid="flow-compare-error">{error}</p>}
    </Card>
  );
};

export default ScenarioCompareBar;
