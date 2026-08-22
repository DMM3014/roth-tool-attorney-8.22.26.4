import { useEffect, useMemo, useState, useRef } from "react";
import { Sliders, Check, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { runProjection, runSsOptimizer, fmtUSD } from "@/lib/api";
import { CLAIM_AGES, claimFactor } from "./helpers";

// ============================================================================
// What-If Slider — interactive SS claim-age exploration
// - Live client-side monthly + COLA-adj benefit updates as sliders drag.
// - Debounced (700ms) full projection re-run to show updated after-tax legacy.
// - Debounced (1500ms) full 16-pair SS sweep to update the winner comparison.
// - "Apply to plan" persists the claim ages back to the household so the whole
//   report + Plan Inputs reflect the new decision.
// ============================================================================
export const WhatIfSlider = ({ scenario, setScenario, fraAmounts, fraAges, ssResult }) => {
  const h = scenario?.household || {};
  const initialClient = h.client_ss_claim_age || fraAges?.Client || 67;
  const initialSpouse = h.spouse_ss_claim_age || fraAges?.Spouse || 67;
  const hasSpouse = h.spouse_dob_year != null;
  const cola = scenario?.projection?.ss_cola ?? 0.025;
  const startYear = scenario?.projection?.start_year;
  const clientCurAge = (startYear && h.client_dob_year) ? startYear - h.client_dob_year : null;
  const spouseCurAge = (startYear && h.spouse_dob_year) ? startYear - h.spouse_dob_year : null;

  const [clientAge, setClientAge] = useState(Math.round(initialClient));
  const [spouseAge, setSpouseAge] = useState(Math.round(initialSpouse));
  // On scenario change (e.g. user Apply on another tab), reset the sliders.
  useEffect(() => { setClientAge(Math.round(initialClient)); }, [initialClient]);
  useEffect(() => { setSpouseAge(Math.round(initialSpouse)); }, [initialSpouse]);

  const [projected, setProjected] = useState(null);       // { after_tax_estate, lifetime_taxes }
  const [projecting, setProjecting] = useState(false);
  const [sweep, setSweep] = useState(null);               // full sweep result at these ages
  const [sweeping, setSweeping] = useState(false);
  const projTimerRef = useRef(null);
  const sweepTimerRef = useRef(null);

  // Live client-side benefit math — instant on every drag.
  const monthly = useMemo(() => {
    const c = fraAmounts?.Client;
    const s = fraAmounts?.Spouse;
    const cFraAge = fraAges?.Client || 67;
    const sFraAge = fraAges?.Spouse || 67;
    const yearsToClient = clientCurAge != null ? Math.max(0, clientAge - clientCurAge) : 0;
    const yearsToSpouse = spouseCurAge != null ? Math.max(0, spouseAge - spouseCurAge) : 0;
    return {
      client_nominal: c ? Math.round(c * claimFactor(clientAge, cFraAge)) : null,
      client_cola:    c ? Math.round(c * claimFactor(clientAge, cFraAge) * Math.pow(1 + cola, yearsToClient)) : null,
      spouse_nominal: s ? Math.round(s * claimFactor(spouseAge, sFraAge)) : null,
      spouse_cola:    s ? Math.round(s * claimFactor(spouseAge, sFraAge) * Math.pow(1 + cola, yearsToSpouse)) : null,
    };
  }, [clientAge, spouseAge, fraAmounts, fraAges, cola, clientCurAge, spouseCurAge]);

  // Compose the modified scenario (used for projection + sweep API calls).
  const modifiedScenario = useMemo(() => ({
    ...scenario,
    household: {
      ...(scenario.household || {}),
      client_ss_claim_age: clientAge,
      spouse_ss_claim_age: hasSpouse ? spouseAge : null,
    },
  }), [scenario, clientAge, spouseAge, hasSpouse]);

  const modSig = `${clientAge}-${spouseAge}-${scenario?.household?.client_dob_year}-${scenario?.household?.spouse_dob_year}`;

  // Debounced /api/projection ~700ms — updates after-tax legacy + lifetime taxes.
  useEffect(() => {
    if (projTimerRef.current) clearTimeout(projTimerRef.current);
    // Skip network call if nothing changed vs. household's current claim ages.
    const isCurrent = clientAge === (h.client_ss_claim_age || fraAges?.Client || 67)
                   && spouseAge === (h.spouse_ss_claim_age || fraAges?.Spouse || 67);
    if (isCurrent) { setProjected(null); return; }
    projTimerRef.current = setTimeout(() => {
      setProjecting(true);
      runProjection(modifiedScenario)
        .then((r) => setProjected({
          after_tax_estate: r?.legacy?.after_tax_estate_to_heirs ?? null,
          lifetime_taxes: r?.summary?.lifetime_taxes ?? null,
        }))
        .catch(() => { /* stay quiet on transient errors */ })
        .finally(() => setProjecting(false));
    }, 700);
    return () => { if (projTimerRef.current) clearTimeout(projTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modSig]);

  // Debounced /api/ss-optimizer ~1500ms — updates the "recommended pair" comparison.
  useEffect(() => {
    if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current);
    const isCurrent = clientAge === (h.client_ss_claim_age || fraAges?.Client || 67)
                   && spouseAge === (h.spouse_ss_claim_age || fraAges?.Spouse || 67);
    if (isCurrent) { setSweep(null); return; }
    sweepTimerRef.current = setTimeout(() => {
      setSweeping(true);
      runSsOptimizer(modifiedScenario, CLAIM_AGES)
        .then((r) => setSweep(r))
        .catch(() => { /* stay quiet */ })
        .finally(() => setSweeping(false));
    }, 1500);
    return () => { if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modSig]);

  const applyToPlan = () => {
    setScenario({
      ...scenario,
      household: {
        ...(scenario.household || {}),
        client_ss_claim_age: clientAge,
        spouse_ss_claim_age: hasSpouse ? spouseAge : null,
      },
    });
    toast.success(`Applied. Client claims at ${clientAge}${hasSpouse ? `, Spouse at ${spouseAge}` : ""}.`);
  };

  const resetToCurrent = () => {
    setClientAge(Math.round(h.client_ss_claim_age || fraAges?.Client || 67));
    if (hasSpouse) setSpouseAge(Math.round(h.spouse_ss_claim_age || fraAges?.Spouse || 67));
  };

  const isDirty = clientAge !== (h.client_ss_claim_age || fraAges?.Client || 67)
               || (hasSpouse && spouseAge !== (h.spouse_ss_claim_age || fraAges?.Spouse || 67));

  // Comparison vs the winner card in the report
  const winnerLegacy = ssResult?.best?.after_tax_estate;
  const modifiedLegacy = sweep?.best?.after_tax_estate ?? projected?.after_tax_estate;
  const deltaVsWinner = (modifiedLegacy != null && winnerLegacy != null)
    ? modifiedLegacy - winnerLegacy : null;

  return (
    <div className="rounded-xl border border-[#EBE8E0] bg-white shadow-sm p-5 mb-4" data-testid="whatif-slider-card">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#4A6741] flex items-center justify-center shrink-0">
            <Sliders className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1A1A1A]">What-if — try different claim ages</p>
            <p className="text-[11px] text-muted-foreground max-w-xl leading-relaxed mt-0.5">
              Drag the sliders to see monthly + COLA-adjusted benefits update instantly. After a short pause, the after-tax legacy re-projects and the recommended pair re-sweeps. Use <em>Apply to plan</em> to lock in the change.
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {isDirty && (
            <Button size="sm" variant="outline" onClick={resetToCurrent} data-testid="whatif-reset"
              className="h-8 gap-1 text-[11px]">
              <RotateCcw className="h-3 w-3" /> Reset
            </Button>
          )}
          <Button size="sm" onClick={applyToPlan} disabled={!isDirty} data-testid="whatif-apply"
            className="h-8 gap-1 bg-[#4A6741] hover:bg-[#3B5234] text-white text-[11px]">
            <Check className="h-3 w-3" /> Apply to plan
          </Button>
        </div>
      </div>

      <div className={`grid grid-cols-1 ${hasSpouse ? "md:grid-cols-2" : ""} gap-5`}>
        <SliderRow
          label={`${h.client_name || "Client"} claim age`}
          testid="whatif-slider-client"
          age={clientAge} onChange={setClientAge}
          nominal={monthly.client_nominal} cola={monthly.client_cola}
          fraAge={fraAges?.Client || 67}
        />
        {hasSpouse && (
          <SliderRow
            label={`${h.spouse_name || "Spouse"} claim age`}
            testid="whatif-slider-spouse"
            age={spouseAge} onChange={setSpouseAge}
            nominal={monthly.spouse_nominal} cola={monthly.spouse_cola}
            fraAge={fraAges?.Spouse || 67}
          />
        )}
      </div>

      {/* Live-computed impact block */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ImpactTile label="After-tax legacy at these ages"
          testid="whatif-legacy"
          value={modifiedLegacy != null ? fmtUSD(modifiedLegacy) : (isDirty ? "—" : "Current plan")}
          sub={
            projecting || sweeping
              ? "Re-projecting…"
              : (deltaVsWinner != null
                ? (deltaVsWinner >= 0 ? `+${fmtUSD(deltaVsWinner)} vs optimizer` : `${fmtUSD(deltaVsWinner)} vs optimizer`)
                : "Move a slider to preview")
          }
          tone={deltaVsWinner != null ? (deltaVsWinner >= 0 ? "green" : "orange") : "muted"}
          loading={projecting || sweeping}
        />
        <ImpactTile label="Lifetime taxes at these ages"
          testid="whatif-taxes"
          value={projected?.lifetime_taxes != null ? fmtUSD(projected.lifetime_taxes) : "—"}
          sub={projecting ? "Computing…" : "Full plan re-projected"}
          tone="muted" loading={projecting}
        />
        <ImpactTile label="Best pair (from sweep)"
          testid="whatif-best-pair"
          value={sweep?.best?.label || (sweeping ? "…" : (ssResult?.best?.label || "—"))}
          sub={sweep?.best ? "This what-if changed the optimum" : (sweeping ? "Re-sweeping 16 pairs…" : "Optimum unchanged so far")}
          tone={sweep?.best && sweep.best.label !== ssResult?.best?.label ? "gold" : "muted"}
          loading={sweeping}
        />
      </div>

      {isDirty && (
        <p className="text-[10.5px] text-[#8A6D3B] mt-3">
          These sliders are a scratchpad — nothing is saved to the plan until you press <strong>Apply to plan</strong>.
          The report body below still reflects the household's current claim ages.
        </p>
      )}
    </div>
  );
};

const SliderRow = ({ label, testid, age, onChange, nominal, cola, fraAge }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <Label className="text-[11px] label-cap">{label}</Label>
      <span className="text-[11px] font-semibold text-[#4A6741]" data-testid={`${testid}-age`}>
        Age {age}
        {age === Math.floor(fraAge) && <span className="ml-1 text-[9px] text-muted-foreground">(FRA)</span>}
        {age === 70 && <span className="ml-1 text-[9px] text-muted-foreground">(max)</span>}
        {age === 62 && <span className="ml-1 text-[9px] text-muted-foreground">(min)</span>}
      </span>
    </div>
    <Slider
      value={[age]}
      onValueChange={(v) => onChange(v[0])}
      min={62}
      max={70}
      step={1}
      data-testid={testid}
    />
    <div className="flex items-center justify-between mt-2 text-[10.5px]">
      <span className="text-muted-foreground">62</span>
      <span className="font-semibold text-[#1A1A1A]" data-testid={`${testid}-monthly`}>
        {nominal != null ? `$${nominal.toLocaleString()}/mo nominal` : "—"}
      </span>
      <span className="text-muted-foreground">70</span>
    </div>
    <div className="text-[10.5px] text-[#4A6741] text-center mt-1" data-testid={`${testid}-cola`}>
      {cola != null ? `${'$' + cola.toLocaleString()}/mo COLA-adj at claim` : ""}
    </div>
  </div>
);

const ImpactTile = ({ label, value, sub, tone = "muted", loading, testid }) => {
  const color = tone === "green" ? "#4A6741" : tone === "orange" ? "#C87941" : tone === "gold" ? "#8A6A20" : "#5A5A5A";
  return (
    <div data-testid={testid} className="rounded-md border border-[#EBE8E0] bg-[#F9F8F6] px-3 py-2">
      <div className="flex items-center gap-1">
        <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color }}>{label}</div>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="font-display text-[15px] font-bold text-[#1A1A1A] mt-0.5">{value}</div>
      <div className="text-[9.5px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
};
