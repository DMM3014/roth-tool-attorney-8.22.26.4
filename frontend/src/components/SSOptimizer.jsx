import { useState } from "react";
import { CalendarClock, Play, Loader2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { runSsOptimizer, fmtUSD } from "@/lib/api";

const AGES = [62, 65, 67, 70];

export const SSOptimizer = ({ scenario, setScenario }) => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const out = await runSsOptimizer(scenario, AGES);
      setResult(out);
    } catch (e) {
      setErr("Social Security sweep failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  const applyBest = () => {
    if (!result?.best) return;
    const b = result.best;
    const fra = result.fra_amounts;
    const dobY = { Client: scenario.household.client_dob_year, Spouse: scenario.household.spouse_dob_year };
    const fraAges = result.fra_ages;
    const factor = (owner, age) => {
      if (age == null || fra[owner] == null) return null;
      const f = fraAges[owner];
      if (age === f) return 1.0;
      if (age < f) {
        const monthsEarly = (f - age) * 12;
        const first = Math.min(36, monthsEarly);
        const rest = Math.max(0, monthsEarly - 36);
        return 1 - (first * (5 / 9) / 100 + rest * (5 / 12) / 100);
      }
      return 1 + 0.08 * (age - f);
    };
    setScenario((p) => {
      const next = JSON.parse(JSON.stringify(p));
      next.income_streams.forEach((s) => {
        if (s.tax_character !== "SS") return;
        if (s.owner === "Client" || s.owner === "Spouse") {
          const age = s.owner === "Client" ? b.client_age : b.spouse_age;
          if (age == null) return;
          const dob = dobY[s.owner];
          const f = factor(s.owner, age);
          if (f == null || dob == null) return;
          const startYear = dob + age;
          s.amount = Math.round(fra[s.owner] * f * 100) / 100;
          s.start_date = `${startYear}-01-01`;
          s.start_year = startYear;
          s.stop_date = null;
          s.stop_year = null;
          s.use = true;
        }
      });
      return next;
    });
    toast.success(`Applied: ${b.label}`, {
      description: `After-tax legacy ${fmtUSD(b.after_tax_estate)}`,
    });
  };

  const baseline = result?.baseline;
  const best = result?.best;
  const delta = best && baseline ? best.after_tax_estate - baseline.after_tax_estate : 0;

  return (
    <div className="space-y-6">
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="ss-controls">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Social Security Claiming-Age Optimizer</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          Sweeps <span className="font-medium">client &amp; spouse claim ages (62 / 65 / 67 / 70)</span> using
          the SSA reduction &amp; delayed-retirement-credit formulas
          (early: 5/9% first 36 mo + 5/12% beyond = 30% off at 62 for FRA-67;
          late: 8%/yr up to age 70 = +24%). Reruns the full projection at each pair —
          picking the pair that maximizes <span className="font-medium">after-tax legacy at 2nd death +
          horizon</span>, since delay interacts directly with your Roth-conversion window.
        </p>
        <Button onClick={run} disabled={running}
          className="bg-[#4A6741] hover:bg-[#3B5234] text-white"
          data-testid="ss-run">
          {running ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sweeping…</>)
            : (<><Play className="h-4 w-4 mr-1" /> Run SS optimizer</>)}
        </Button>
        {err && <p className="mt-3 text-xs text-[#B84A4A]" data-testid="ss-error">{err}</p>}
        {result?.fra_amounts && (
          <p className="mt-3 text-[10px] text-muted-foreground" data-testid="ss-fra-amounts">
            Implied FRA benefits (monthly at PIA): {Object.entries(result.fra_amounts).map(([k, v]) => (
              <span key={k} className="ml-1"><span className="font-medium">{k}</span> {fmtUSD(v)}</span>
            ))}
          </p>
        )}
      </Card>

      {best && (
        <Card className="p-6 border-[#4A6741]/40 bg-[#4A6741]/5 shadow-none" data-testid="ss-winner">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-[#4A6741]" />
                <span className="label-cap text-[#4A6741] text-[10px]">Optimal claim pair</span>
              </div>
              <h3 className="font-display text-2xl font-bold tracking-tight" data-testid="ss-winner-label">
                {best.label}
              </h3>
              <p className="text-xs mt-2">
                After-tax legacy (+horizon): <span className="font-bold text-[#4A6741]">{fmtUSD(best.after_tax_estate)}</span>
                {" · "}vs current <span className="font-medium">{fmtUSD(baseline?.after_tax_estate)}</span>
                {" ("}<span className={delta >= 0 ? "text-[#4A6741] font-medium" : "text-[#B84A4A] font-medium"}>
                  {delta >= 0 ? "+" : ""}{fmtUSD(delta)}</span>{")"}
              </p>
              <p className="text-xs mt-1">
                Lifetime SS collected: <span className="font-medium">{fmtUSD(best.lifetime_ss)}</span>
                {" · "}lifetime tax <span className="font-medium">{fmtUSD(best.lifetime_taxes)}</span>
              </p>
            </div>
            <Button onClick={applyBest} className="bg-[#4A6741] hover:bg-[#3B5234] text-white"
              data-testid="ss-apply">
              Apply optimal pair
            </Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="ss-results">
          <div className="mb-3">
            <h3 className="font-display text-lg font-bold tracking-tight">All claim-age combinations</h3>
            <p className="text-xs text-muted-foreground">
              Ranked by after-tax legacy at 2nd death + horizon (tiebreaker: lower lifetime tax).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b border-[#EBE8E0]">
                  <th className="px-2 py-1">#</th>
                  <th className="px-2">Client age</th>
                  <th className="px-2">Spouse age</th>
                  <th className="px-2 text-right">After-tax legacy (+horizon)</th>
                  <th className="px-2 text-right">Lifetime SS</th>
                  <th className="px-2 text-right">Lifetime tax</th>
                  <th className="px-2 text-right">Ending net worth</th>
                </tr>
              </thead>
              <tbody>
                {result.ranked.map((r, i) => (
                  <tr key={`${r.client_age}-${r.spouse_age}`}
                    className={`border-b border-[#F3F1EC] ${i === 0 ? "bg-[#4A6741]/5" : ""}`}
                    data-testid={`ss-row-${i}`}>
                    <td className="px-2 py-1.5 font-medium">{i + 1}</td>
                    <td className="px-2">{r.client_age}</td>
                    <td className="px-2">{r.spouse_age ?? "—"}</td>
                    <td className="px-2 text-right font-medium">{fmtUSD(r.after_tax_estate)}</td>
                    <td className="px-2 text-right">{fmtUSD(r.lifetime_ss)}</td>
                    <td className="px-2 text-right">{fmtUSD(r.lifetime_taxes)}</td>
                    <td className="px-2 text-right">{fmtUSD(r.ending_net_worth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!result && !running && (
        <Card className="p-8 border-[#EBE8E0] shadow-none text-center" data-testid="ss-empty">
          <CalendarClock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Run the sweep to compare the four canonical claim ages.</p>
        </Card>
      )}
    </div>
  );
};
