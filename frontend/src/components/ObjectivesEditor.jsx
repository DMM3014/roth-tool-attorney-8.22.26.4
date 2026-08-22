import { Target } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { OBJECTIVES, PRIORITIES, PRIORITY_COLOR, readObjectives } from "@/lib/objectives";
import { useObjectivesPage } from "@/hooks/useObjectivesPage";

/**
 * ObjectivesEditor — advisor picks which family objectives this plan is being
 * weighed against, and how hard each one presses. Saved on the SCENARIO
 * (`planning_objectives`) so the selection travels with a shared plan and both
 * the Client Report and the deck print the same page.
 *
 * The page itself is OPT-IN (off by default) — one switch governs both
 * deliverables via useObjectivesPage.
 */
export const ObjectivesEditor = ({ scenario, setScenario, testidPrefix = "objectives" }) => {
  const map = readObjectives(scenario);
  const count = Object.keys(map).length;
  const { objectivesOn, setObjectivesOn } = useObjectivesPage();

  const write = (next) => {
    if (!setScenario) return;
    setScenario((s) => ({ ...s, planning_objectives: next }));
  };
  const toggle = (key, on) => {
    const next = { ...map };
    if (on) next[key] = next[key] || "high";
    else delete next[key];
    write(next);
  };
  const setPriority = (key, p) => write({ ...map, [key]: p });

  return (
    <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-4 mb-4"
         data-testid={`${testidPrefix}-card`}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-start gap-2">
          <Target className="h-4 w-4 text-[#4A6741] mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#1A1A1A]">What are we planning for?</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed max-w-3xl">
              Optional page, off by default. When included, it prints as a dollar-free page ahead of the
              conversion analysis in both the Client Report and the deck, so every later page reads as evidence
              for a stated objective. Tick the objectives this family is actually weighing, and how hard each one
              presses — the selection is saved with the plan, not your browser.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">Include page</span>
          <Switch checked={objectivesOn} onCheckedChange={(v) => setObjectivesOn(!!v)}
                  data-testid={`${testidPrefix}-include-toggle`} />
          <span className="text-[11px] text-muted-foreground tabular-nums"
                data-testid={`${testidPrefix}-count`}>{count} of {OBJECTIVES.length}</span>
          {count > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-[10px]"
                    onClick={() => write({})} data-testid={`${testidPrefix}-clear`}>
              Clear all
            </Button>
          )}
        </div>
      </div>

      <div className={`mt-3 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1 ${objectivesOn ? "" : "opacity-50"}`}>
        {OBJECTIVES.map((o) => {
          const p = map[o.key];
          const on = !!p;
          return (
            <div key={o.key} className="flex items-center gap-2 py-1 border-b border-[#F3F1EC]">
              <Switch checked={on} onCheckedChange={(v) => toggle(o.key, !!v)}
                      data-testid={`${testidPrefix}-toggle-${o.key}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-[11.5px] leading-tight ${on ? "text-[#1A1A1A] font-medium" : "text-muted-foreground"}`}>
                  {o.label}
                </p>
              </div>
              {on && (
                <div className="inline-flex rounded-full border border-[#EBE8E0] p-0.5 text-[10px] shrink-0">
                  {PRIORITIES.map((pr) => (
                    <button key={pr.key} onClick={() => setPriority(o.key, pr.key)}
                            title={pr.blurb}
                            data-testid={`${testidPrefix}-priority-${o.key}-${pr.key}`}
                            className={`px-2 py-[1px] rounded-full transition-colors ${
                              p === pr.key ? "text-white" : "text-muted-foreground hover:text-[#4A6741]"}`}
                            style={p === pr.key ? { background: PRIORITY_COLOR[pr.key] } : undefined}>
                      {pr.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ObjectivesEditor;
