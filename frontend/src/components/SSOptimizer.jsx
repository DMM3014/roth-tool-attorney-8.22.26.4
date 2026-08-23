import { useMemo, useState } from "react";
import { CalendarClock, Play, Loader2, Sparkles, AlertTriangle, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import { runSsOptimizer, fmtUSD, fmtPct } from "@/lib/api";
import AIAnalysisCard from "@/components/AIAnalysisCard";

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
      // Also update the household's SS claim age fields so both places stay in sync.
      next.household = next.household || {};
      if (b.client_age != null) next.household.client_ss_claim_age = b.client_age;
      if (b.spouse_age != null) next.household.spouse_ss_claim_age = b.spouse_age;
      return next;
    });
    toast.success(`Applied: ${b.label}`, {
      description: `After-tax legacy ${fmtUSD(b.after_tax_estate)}`,
    });
  };

  const baseline = result?.baseline;
  const best = result?.best;
  const delta = best && baseline ? best.after_tax_estate - baseline.after_tax_estate : 0;

  // -------- Plan Inputs echo (read-only summary of household inputs) --------
  const h = scenario.household || {};
  const startYear = scenario?.projection?.start_year;
  const clientAge = (startYear && h.client_dob_year) ? startYear - h.client_dob_year : null;
  const spouseAge = (startYear && h.spouse_dob_year) ? startYear - h.spouse_dob_year : null;
  const ssStreams = (scenario?.income_streams || []).filter((s) => s.tax_character === "SS" && s.use !== false);
  const clientSs = ssStreams.find((s) => s.owner === "Client");
  const spouseSs = ssStreams.find((s) => s.owner === "Spouse");
  const cola = scenario?.projection?.ss_cola ?? scenario?.ss?.cola ?? 0.025;

  // -------- Benefit-by-age chart data (with COLA-adjusted amount at claim) --------
  const fraByOwner = result?.fra_amounts || {};
  const fraAgeByOwner = result?.fra_ages || {};
  const ageFactor = (age, fraAge) => {
    if (age == null || fraAge == null) return 1;
    if (age === fraAge) return 1.0;
    if (age < fraAge) {
      const mEarly = (fraAge - age) * 12;
      const first = Math.min(36, mEarly);
      const rest = Math.max(0, mEarly - 36);
      return 1 - (first * (5 / 9) / 100 + rest * (5 / 12) / 100);
    }
    return 1 + 0.08 * (age - fraAge);
  };
  const chartData = useMemo(() => AGES.map((age) => {
    const row = { age: `Age ${age}` };
    for (const owner of ["Client", "Spouse"]) {
      const fra = fraByOwner[owner];
      const fraAge = fraAgeByOwner[owner];
      const curAge = owner === "Client" ? clientAge : spouseAge;
      if (fra == null || fraAge == null) continue;
      const monthly = Math.round(fra * ageFactor(age, fraAge));
      const yearsToClaim = Math.max(0, age - (curAge ?? 0));
      const colaInflated = Math.round(monthly * Math.pow(1 + cola, yearsToClaim));
      row[`${owner} monthly`] = monthly;
      row[`${owner} COLA-adj`] = colaInflated;
    }
    return row;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [fraByOwner, fraAgeByOwner, clientAge, spouseAge, cola]);

  const householdSummary = (
    <Card className="p-4 border-[#EBE8E0] shadow-none bg-[#FAFAF8]" data-testid="ss-plan-echo">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[#4A6741]" />
          <p className="text-sm font-semibold text-[#1A1A1A]">Plan inputs — for reference before you run the sweep</p>
        </div>
        <p className="text-[10px] text-muted-foreground italic">
          Edit any of these on the <strong>Plan Inputs</strong> tab; this echo updates live.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11.5px]">
        <EchoItem label="Client" value={h.client_name || "—"}
          sub={clientAge != null ? `Age ${clientAge}${h.client_ss_claim_age ? ` · plans to claim at ${h.client_ss_claim_age}` : ""}` : ""} />
        <EchoItem label="Spouse" value={h.spouse_name || "—"}
          sub={spouseAge != null ? `Age ${spouseAge}${h.spouse_ss_claim_age ? ` · plans to claim at ${h.spouse_ss_claim_age}` : ""}` : ""} />
        <EchoItem label="Client FRA benefit" value={clientSs ? `${fmtUSD(clientSs.amount || 0)}/yr` : "—"}
          sub={clientSs?.start_year ? `From year ${clientSs.start_year}` : ""} />
        <EchoItem label="Spouse FRA benefit" value={spouseSs ? `${fmtUSD(spouseSs.amount || 0)}/yr` : "—"}
          sub={spouseSs?.start_year ? `From year ${spouseSs.start_year}` : ""} />
        <EchoItem label="Filing status" value={h.filing_status || "MFJ"} />
        <EchoItem label="SS COLA" value={fmtPct(cola)} />
        <EchoItem label="Plan horizon" value={`${scenario?.projection?.start_year ?? "?"} – ${scenario?.projection?.end_year ?? "?"}`} />
        <EchoItem label="Retirement ages" value={`${h.client_retirement_age ?? "?"} / ${h.spouse_retirement_age ?? "?"}`}
          sub="Client / Spouse" />
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      {householdSummary}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="ss-controls">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Social Security Claiming-Age Analyzer</h3>
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
            : (<><Play className="h-4 w-4 mr-1" /> Run SS analyzer</>)}
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
              Ranked by after-tax legacy at 2nd death + horizon (tiebreaker: lower lifetime tax). The <strong>COLA-adjusted claim</strong>
              {" "}column shows what each spouse&apos;s year-one benefit would be inflated by the plan&apos;s SS COLA ({fmtPct(cola)}) from the current age up to the claim age.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr className="border-b border-[#EBE8E0]">
                  <th className="px-2 py-1">#</th>
                  <th className="px-2">Client age</th>
                  <th className="px-2">Spouse age</th>
                  <th className="px-2 text-right">Client COLA-adj @ claim</th>
                  <th className="px-2 text-right">Spouse COLA-adj @ claim</th>
                  <th className="px-2 text-right">After-tax legacy (+horizon)</th>
                  <th className="px-2 text-right">Lifetime SS</th>
                  <th className="px-2 text-right">Lifetime tax</th>
                  <th className="px-2 text-right">Ending net worth</th>
                </tr>
              </thead>
              <tbody>
                {result.ranked.map((r, i) => {
                  const cFra = fraByOwner.Client;
                  const cFraAge = fraAgeByOwner.Client;
                  const sFra = fraByOwner.Spouse;
                  const sFraAge = fraAgeByOwner.Spouse;
                  const cYears = clientAge != null && r.client_age != null ? Math.max(0, r.client_age - clientAge) : 0;
                  const sYears = spouseAge != null && r.spouse_age != null ? Math.max(0, r.spouse_age - spouseAge) : 0;
                  const cCola = cFra ? Math.round(cFra * ageFactor(r.client_age, cFraAge) * 12 * Math.pow(1 + cola, cYears)) : null;
                  const sCola = sFra && r.spouse_age ? Math.round(sFra * ageFactor(r.spouse_age, sFraAge) * 12 * Math.pow(1 + cola, sYears)) : null;
                  return (
                    <tr key={`${r.client_age}-${r.spouse_age}`}
                      className={`border-b border-[#F3F1EC] ${i === 0 ? "bg-[#4A6741]/5" : ""}`}
                      data-testid={`ss-row-${i}`}>
                      <td className="px-2 py-1.5 font-medium">{i + 1}</td>
                      <td className="px-2">{r.client_age}</td>
                      <td className="px-2">{r.spouse_age ?? "—"}</td>
                      <td className="px-2 text-right">{cCola != null ? fmtUSD(cCola) : "—"}</td>
                      <td className="px-2 text-right">{sCola != null ? fmtUSD(sCola) : "—"}</td>
                      <td className="px-2 text-right font-medium">{fmtUSD(r.after_tax_estate)}</td>
                      <td className="px-2 text-right">{fmtUSD(r.lifetime_ss)}</td>
                      <td className="px-2 text-right">{fmtUSD(r.lifetime_taxes)}</td>
                      <td className="px-2 text-right">{fmtUSD(r.ending_net_worth)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Benefit-by-age chart */}
      {result?.fra_amounts && (
        <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="ss-benefit-chart">
          <div className="mb-3">
            <h3 className="font-display text-lg font-bold tracking-tight">Monthly benefit by claim age — nominal vs COLA-adjusted</h3>
            <p className="text-xs text-muted-foreground">
              For each spouse, monthly benefit computed at ages 62 / 65 / 67 / 70 using SSA reduction &amp; delayed
              credit factors. <span className="font-medium">Nominal</span> is today&apos;s dollars; <span className="font-medium">COLA-adj</span> shows
              the benefit inflated by the plan&apos;s SS COLA ({fmtPct(cola)}) from the current age to the claim age.
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
                <XAxis dataKey="age" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={48} tickLine={false} />
                <Tooltip formatter={(v) => fmtUSD(v)} />
                <Legend iconSize={9} wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="Client monthly" fill="#4A6741" name="Client — nominal" isAnimationActive={false} />
                <Bar dataKey="Client COLA-adj" fill="#7A9B76" name="Client — COLA-adjusted" isAnimationActive={false} />
                <Bar dataKey="Spouse monthly" fill="#C87941" name="Spouse — nominal" isAnimationActive={false} />
                <Bar dataKey="Spouse COLA-adj" fill="#E5B87A" name="Spouse — COLA-adjusted" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* "Highest ≠ Best" callout */}
      {result && (
        <div className="rounded-xl border border-[#E5B87A] bg-[#FFF4E6] p-5" data-testid="ss-highest-not-best">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-[#8A5A20] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#8A5A20] mb-1">Highest lifetime benefit isn&apos;t always the best strategy</p>
              <p className="text-[12px] text-[#5A4020] leading-relaxed">
                Claiming Social Security early (62 or 65) produces ordinary income before age 70, which{" "}
                <strong>competes with Roth conversions</strong> for headroom in the 12% and 22% brackets. The pair that
                maximizes lifetime SS collected can therefore leave the household paying <em>more</em> total tax and
                delivering <em>less</em> after-tax legacy — because it forces conversions into higher brackets or
                skips them entirely. The analyzer above uses <strong>after-tax legacy at 2nd death</strong> as the
                objective for exactly this reason. If the &quot;highest lifetime SS&quot; row and the &quot;highest after-tax legacy&quot;
                row differ, the second is usually the better plan.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* AI plain-English analysis of the SS claim-age comparison */}
      {result?.best && result?.baseline && (
        <AIAnalysisCard
          testid="ss-ai-analysis"
          title="AI analysis of this Social Security comparison"
          focus="You are reviewing a Social Security claim-age optimization result across (Client claim age, Spouse claim age) pairs at 62/65/67/70. Explain the trade-offs of the optimal pair in plain English — early claim vs delayed benefit, survivor benefits, tax interaction with Roth conversions, and the impact on after-tax legacy. 4-5 crisp bullets max."
          summary={{
            page: "SS Analyzer",
            fra_amounts: result.fra_amounts,
            optimal: result.best,
            baseline: result.baseline,
            ranked_pairs: (result.ranked || []).map((r) => ({
              client_age: r.client_age,
              spouse_age: r.spouse_age,
              after_tax_estate: r.after_tax_estate,
              lifetime_taxes: r.lifetime_taxes,
              ending_net_worth: r.ending_net_worth,
            })),
          }}
        />
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

const EchoItem = ({ label, value, sub }) => (
  <div>
    <div className="text-[9px] uppercase tracking-wider text-[#5A5A5A] font-semibold">{label}</div>
    <div className="font-medium text-[#1A1A1A]">{value}</div>
    {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
  </div>
);
