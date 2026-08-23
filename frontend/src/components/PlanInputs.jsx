import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Coins, Receipt, PiggyBank, Landmark, MapPin, Users, HandHeart, PieChart, ChevronDown, Briefcase, Wallet, MoreHorizontal, HelpCircle, Gift, Heart } from "lucide-react";
import { BeneficiariesEditor } from "./BeneficiariesEditor";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { fmtUSD, fetchStates } from "@/lib/api";
import { MarketScenarioSelector } from "@/components/MarketScenarioSelector";
import { GoalPresetButtons } from "@/components/strategy/GoalPresetButtons";

const Cell = ({ children, w }) => <td className={`px-2 py-1.5 ${w || ""}`}>{children}</td>;

const parseField = (raw, type) => {
  if (type !== "number") return raw;
  return raw === "" ? null : parseFloat(raw);
};

const Txt = ({ value, onChange, type = "text", testid, step }) => (
  <Input type={type} step={step} value={value ?? ""} data-testid={testid}
    onChange={(e) => onChange(parseField(e.target.value, type))}
    className="h-8 bg-[#F9F8F6] text-xs px-2" />
);

// Percent-facing wrapper for decimal fields (COLA, inflation, survivor share).
// Storage stays a decimal (0.03) so the projection engine is untouched, but the
// user types and sees "3" for 3% — matching the labeled header on the table.
// step defaults to 0.5 so the up/down arrows nudge by half a percentage point.
const Pct = ({ value, onChange, testid, step = 0.5 }) => (
  <Input
    type="number" step={step}
    value={value == null || value === "" ? "" : +(value * 100).toFixed(4)}
    data-testid={testid}
    onChange={(e) => {
      const raw = e.target.value;
      onChange(raw === "" ? null : parseFloat(raw) / 100);
    }}
    className="h-8 bg-[#F9F8F6] text-xs px-2 text-right"
    aria-describedby={testid ? `${testid}-suffix` : undefined}
  />
);

const Sel = ({ value, onChange, options, testid }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="h-8 bg-[#F9F8F6] text-xs" data-testid={testid}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
  </Select>
);

// Date input — boundary years prorate by exact day-count in the engine.
// When `value` is empty and `defaultValue` is provided, we display the default in
// muted italic so the user sees the effective date (e.g. "second death") without
// mutating the underlying scenario data — the engine already treats null as
// "run through end of projection", which equals the second-death year for
// properly configured plans.
const DateInput = ({ value, onChange, testid, defaultValue, defaultLabel }) => {
  const usingDefault = !value && !!defaultValue;
  return (
    <Input
      type="date"
      value={value || defaultValue || ""}
      data-testid={testid}
      onChange={(e) => onChange(e.target.value || null)}
      title={usingDefault ? `Defaults to ${defaultLabel || "second death"} (${defaultValue}). Pick a date to override.` : undefined}
      className={`h-8 bg-[#F9F8F6] text-xs px-2 w-[140px] ${usingDefault ? "text-muted-foreground italic" : ""}`}
    />
  );
};

// Currency input: shows "$1,234,567" (no decimals, commas) when idle; a raw number field while editing
// (so precision like monthly $2,906.40 is preserved).
const Money = ({ value, onChange, testid, step }) => {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [editing]);
  if (editing) {
    return (
      <Input ref={ref} type="number" step={step} value={value ?? ""} data-testid={testid}
        onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
        onBlur={() => setEditing(false)}
        className="h-8 bg-[#F9F8F6] text-xs px-2 text-right" />
    );
  }
  return (
    <Input type="text" readOnly data-testid={testid}
      value={value == null || value === "" ? "" : `$${Math.round(value).toLocaleString("en-US")}`}
      onFocus={() => setEditing(true)}
      className="h-8 bg-[#F9F8F6] text-xs px-2 text-right cursor-text" />
  );
};

const yearOf = (d) => (d ? parseInt(String(d).slice(0, 4), 10) : null);

const OWNERS = ["Client", "Spouse", "Joint"];
const FREQS = ["Annual", "Monthly"];
const TAX_CHARS = ["Ordinary", "SS", "Annuity", "QDiv/LTCG"];
const TAX_TYPES = ["Cash", "Taxable", "Tax-Deferred", "Tax-Free", "Real Estate"];

// Inline help icon shown next to each Social Security stream. Explains the
// survivor-benefit rule (larger of the two SS benefits continues to the
// surviving spouse) so advisors understand why the ghost default stop dates
// are asymmetric.
const SSHelp = ({ isHigher, otherAmount, meAmount }) => {
  // Format the two SS amounts as monthly $ for the tooltip body.
  const fmtMo = (v) => (v ? `$${Math.round(v).toLocaleString("en-US")}/mo` : "—");
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <button type="button" className="ml-1 inline-flex items-center align-middle text-muted-foreground hover:text-[#4A6741] focus:outline-none"
                data-testid="ss-help-icon"
                onClick={(e) => e.preventDefault()}
                aria-label="Social Security survivor-benefit rule">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[320px] bg-[#1A1A1A] text-white text-[11px] leading-relaxed p-3">
        <p className="font-semibold mb-1">Social Security survivor benefit</p>
        <p className="mb-2">
          After the first spouse dies, the surviving spouse continues to receive the <em>larger</em> of
          the two benefits (their own or the deceased&apos;s). The smaller benefit stops.
        </p>
        {otherAmount != null && meAmount != null ? (
          <p className="mb-2">
            On this plan: <span className="font-semibold">{fmtMo(meAmount)}</span> vs&nbsp;
            <span className="font-semibold">{fmtMo(otherAmount)}</span>. This row is the{" "}
            <span className={isHigher ? "text-emerald-300 font-semibold" : "text-orange-300 font-semibold"}>
              {isHigher ? "HIGHER" : "LOWER"}
            </span>{" "}
            benefit, so it defaults to stop at the {isHigher ? "second death (survivor continues to collect it)" : "first death (survivor switches to the larger benefit)"}.
          </p>
        ) : (
          <p className="mb-2">
            With no counterpart SS row yet, this stream defaults to stop at the second death (end of the projection).
          </p>
        )}
        <p className="text-muted-foreground italic">Pick any date to override the default.</p>
      </TooltipContent>
    </Tooltip>
  );
};

export const PlanInputs = ({ scenario, setScenario, onRequestRunSweep = null }) => {
  const [states, setStates] = useState([]);
  useEffect(() => {
    fetchStates().then(setStates).catch(() => setStates([]));
  }, []);

  const mut = (key, idx, field, value) => {
    setScenario((p) => {
      const next = JSON.parse(JSON.stringify(p));
      next[key][idx][field] = value;
      return next;
    });
  };
  // set a date field and keep the matching *_year in sync (engine uses the date for proration)
  const mutDate = (key, idx, dateField, yearField, value) => {
    setScenario((p) => {
      const next = JSON.parse(JSON.stringify(p));
      next[key][idx][dateField] = value;
      next[key][idx][yearField] = yearOf(value);
      return next;
    });
  };
  const addRow = (key, template) => setScenario((p) => ({ ...p, [key]: [...p[key], template] }));
  const delRow = (key, idx) => setScenario((p) => ({ ...p, [key]: p[key].filter((_, i) => i !== idx) }));

  // Recompute the "second death" year (later of the two projected deaths) from a household object.
  const computeSecondDeath = (hh) => {
    const cd = (hh?.client_dob_year && hh?.client_life_expectancy)
      ? hh.client_dob_year + hh.client_life_expectancy : null;
    const sd = (hh?.spouse_dob_year && hh?.spouse_life_expectancy)
      ? hh.spouse_dob_year + hh.spouse_life_expectancy : null;
    return Math.max(cd || 0, sd || 0) || null;
  };

  // Longevity edits should cascade to projection.end_year — but only if the current end year
  // is still tied to the previous second-death year. If the user manually extended the horizon
  // (to run the heirs' SECURE-10 window on the projection tab), preserve that override.
  const LONGEVITY_KEYS = new Set(["client_dob_year", "spouse_dob_year", "client_life_expectancy", "spouse_life_expectancy"]);
  const updH = (k, v) => setScenario((p) => {
    const nextHousehold = { ...p.household, [k]: v };
    if (!LONGEVITY_KEYS.has(k)) {
      return { ...p, household: nextHousehold };
    }
    const prevSecondDeath = computeSecondDeath(p.household);
    const nextSecondDeath = computeSecondDeath(nextHousehold);
    const currentEnd = p.projection?.end_year;
    const isTracking = !currentEnd || currentEnd === prevSecondDeath;
    if (nextSecondDeath && isTracking && currentEnd !== nextSecondDeath) {
      return { ...p, household: nextHousehold, projection: { ...p.projection, end_year: nextSecondDeath } };
    }
    return { ...p, household: nextHousehold };
  });
  const updProj = (k, v) => setScenario((p) => ({ ...p, projection: { ...p.projection, [k]: v } }));

  // Keep the legacy integer age fields in sync with the new date fields. Many
  // downstream consumers (SS Analyzer, Client Report, backend projection) still
  // read `_ss_claim_age` and `_retirement_age` — mirror them so nothing breaks.
  useEffect(() => {
    const h0 = scenario?.household || {};
    const updates = {};
    // SS claim age from date (or default = 67 birthday)
    if (h0.client_dob_year) {
      const claimYr = h0.client_ss_claim_date
        ? parseInt(String(h0.client_ss_claim_date).slice(0, 4), 10)
        : (h0.client_dob_year + (h0.client_ss_claim_age || 67));
      const claimAge = Math.max(62, Math.min(70, claimYr - h0.client_dob_year));
      if (claimAge !== h0.client_ss_claim_age) updates.client_ss_claim_age = claimAge;
    }
    if (h0.spouse_dob_year) {
      const claimYr = h0.spouse_ss_claim_date
        ? parseInt(String(h0.spouse_ss_claim_date).slice(0, 4), 10)
        : (h0.spouse_dob_year + (h0.spouse_ss_claim_age || 67));
      const claimAge = Math.max(62, Math.min(70, claimYr - h0.spouse_dob_year));
      if (claimAge !== h0.spouse_ss_claim_age) updates.spouse_ss_claim_age = claimAge;
    }
    // Retirement age from date (or already-retired = current year)
    const thisYear = new Date().getFullYear();
    if (h0.client_dob_year) {
      const retYr = h0.client_already_retired
        ? thisYear
        : (h0.client_retirement_date ? parseInt(String(h0.client_retirement_date).slice(0, 4), 10) : null);
      const retAge = retYr ? retYr - h0.client_dob_year : (h0.client_retirement_age ?? null);
      if (retAge != null && retAge !== h0.client_retirement_age) updates.client_retirement_age = retAge;
    }
    if (h0.spouse_dob_year) {
      const retYr = h0.spouse_already_retired
        ? thisYear
        : (h0.spouse_retirement_date ? parseInt(String(h0.spouse_retirement_date).slice(0, 4), 10) : null);
      const retAge = retYr ? retYr - h0.spouse_dob_year : (h0.spouse_retirement_age ?? null);
      if (retAge != null && retAge !== h0.spouse_retirement_age) updates.spouse_retirement_age = retAge;
    }
    if (Object.keys(updates).length > 0) {
      setScenario((p) => ({ ...p, household: { ...p.household, ...updates } }));
    }
  }, [
    scenario?.household?.client_ss_claim_date, scenario?.household?.spouse_ss_claim_date,
    scenario?.household?.client_retirement_date, scenario?.household?.spouse_retirement_date,
    scenario?.household?.client_already_retired, scenario?.household?.spouse_already_retired,
    scenario?.household?.client_dob_year, scenario?.household?.spouse_dob_year,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  const taxableTotal = scenario.accounts
    .filter((a) => a.tax_type === "Taxable")
    .reduce((sum, a) => sum + (a.beginning_balance || 0), 0);
  const divDollars = (scenario.dividend_yield ?? 0.01) * taxableTotal;

  // "Second death" date — the later of client/spouse projected death year (dob + life exp).
  // Used as the default display value for empty stop_date inputs so users see the
  // effective stop instead of a blank "mm/dd/yyyy" placeholder. Data stays null.
  const h = scenario.household || {};
  const clientDeathYear = (h.client_dob_year && h.client_life_expectancy)
    ? h.client_dob_year + h.client_life_expectancy : null;
  const spouseDeathYear = (h.spouse_dob_year && h.spouse_life_expectancy)
    ? h.spouse_dob_year + h.spouse_life_expectancy : null;
  const secondDeathYear = Math.max(clientDeathYear || 0, spouseDeathYear || 0) || null;
  const secondDeathDate = secondDeathYear ? `${secondDeathYear}-12-31` : null;
  // First death = whichever spouse dies first. Used as the smart default stop-date
  // for the LOWER-benefit Social Security stream: at first death the surviving
  // spouse switches to the higher benefit as a "survivor benefit", so the lower
  // benefit effectively terminates at first-death regardless of which spouse it
  // belonged to. (See _income_from_stream in backend/projection.py — after first
  // death the household's SS = max(client_ss, spouse_ss).)
  const bothDeathYears = clientDeathYear && spouseDeathYear;
  const firstDeathYear = bothDeathYears ? Math.min(clientDeathYear, spouseDeathYear) : null;
  const firstDeathDate = firstDeathYear ? `${firstDeathYear}-12-31` : null;
  const startYear = scenario.projection?.start_year || null;
  const clientAgeStart = (startYear && h.client_dob_year) ? startYear - h.client_dob_year : null;
  const spouseAgeStart = (startYear && h.spouse_dob_year) ? startYear - h.spouse_dob_year : null;

  // For each SS stream on the plan, return `{stopDate, stopLabel}` for its ghost
  // default. Logic: compare this SS amount vs the OTHER spouse's SS amount.
  //   - Higher benefit → survivor gets it → default stop = second death.
  //   - Lower benefit  → dies at first death → default stop = first death.
  // Streams without a spouse counterpart, or when death years aren't set, fall
  // back to the traditional secondDeath default so existing single-owner plans
  // are unaffected.
  const ssStreamDefault = (row) => {
    if (row.tax_character !== "SS") return { stopDate: secondDeathDate, stopLabel: "second death", isHigher: null, otherAmount: null };
    if (!bothDeathYears) return { stopDate: secondDeathDate, stopLabel: "second death", isHigher: null, otherAmount: null };
    // Find the counterpart SS stream owned by the other spouse.
    const otherOwner = row.owner === "Client" ? "Spouse" : (row.owner === "Spouse" ? "Client" : null);
    if (!otherOwner) return { stopDate: secondDeathDate, stopLabel: "second death", isHigher: null, otherAmount: null };
    const other = (scenario.income_streams || []).find(
      (s) => s.tax_character === "SS" && s.owner === otherOwner && (s.use ?? true));
    if (!other) return { stopDate: secondDeathDate, stopLabel: "second death", isHigher: null, otherAmount: null };
    // Higher benefit → survivor benefit continues → second death; lower → first death.
    const meBigger = (row.amount || 0) >= (other.amount || 0);
    if (meBigger) return { stopDate: secondDeathDate, stopLabel: "second death (survivor benefit)", isHigher: true, otherAmount: other.amount || 0 };
    return { stopDate: firstDeathDate, stopLabel: "first death (survivor takes larger benefit)", isHigher: false, otherAmount: other.amount || 0 };
  };

  const stateCode = scenario.tax.state_code || "CUSTOM";
  const currentState = states.find((s) => s.code === scenario.tax.state_code);
  const onStateChange = (code) => {
    if (code === "CUSTOM") {
      setScenario((p) => ({ ...p, tax: { ...p.tax, state_code: "" } }));
      return;
    }
    const st = states.find((s) => s.code === code);
    if (!st) return;
    setScenario((p) => ({
      ...p,
      tax: { ...p.tax, state_code: code, state_rate: st.rate, community_property: st.is_community_property },
    }));
  };

  // ---- Add-income presets ---------------------------------------------------
  // Build ISO date strings from the household's retirement + life-expectancy fields
  // so newly-added Wages / Pension rows land with sensible defaults instead of
  // needing to be edited by hand.
  const todayISO = new Date().toISOString().slice(0, 10);
  const parseYear = (s) => (s ? parseInt(String(s).slice(0, 4), 10) : null);
  // Retirement dates — prefer the explicit household date, else derive from
  // dob_year + retirement_age. Fall back to a plausible "already retired" (today)
  // when the retirement year is in the past or missing.
  const clientRetYear = parseYear(h.client_retirement_date)
    || (h.client_dob_year && h.client_retirement_age ? h.client_dob_year + h.client_retirement_age : null);
  const spouseRetYear = parseYear(h.spouse_retirement_date)
    || (h.spouse_dob_year && h.spouse_retirement_age ? h.spouse_dob_year + h.spouse_retirement_age : null);
  const currentYear = new Date().getFullYear();
  const wagesStopDate = (owner) => {
    // "Wages should stop on the client's retirement date, or today if already retired."
    // We use 12/31 of the retirement year (fills the year at 100%) so the projection
    // engine emits the last full year of wages before retirement.
    const retYr = owner === "Spouse" ? spouseRetYear : clientRetYear;
    if (!retYr) return null;
    return retYr < currentYear ? todayISO : `${retYr}-12-31`;
  };
  const pensionStartDate = (owner) => {
    // Pensions typically begin at retirement; stream engine adjusts for mid-year starts.
    const retYr = owner === "Spouse" ? spouseRetYear : clientRetYear;
    if (!retYr) return `${(scenario.projection?.start_year) || currentYear}-01-01`;
    return `${retYr}-01-01`;
  };
  const pensionStopDate = (owner) => {
    // "End of life expectancy" — for owner-specific pensions we cap at that owner's
    // projected death year; for Joint pensions we cap at the later (second) death.
    if (owner === "Client" && clientDeathYear) return `${clientDeathYear}-12-31`;
    if (owner === "Spouse" && spouseDeathYear) return `${spouseDeathYear}-12-31`;
    return secondDeathDate;
  };
  const addIncomeStream = (preset) => {
    const base = {
      id: `INC${Date.now()}`, owner: "Joint", type: "Other", description: "New income",
      start_date: `${scenario.projection.start_year}-01-01`, stop_date: null,
      start_year: scenario.projection.start_year, stop_year: null, amount: 0, frequency: "Annual",
      cola: 0.03, tax_character: "Ordinary", taxable_pct: 1, survivor_pct: 1, use: true,
    };
    const withYears = (row) => ({
      ...row,
      start_year: row.start_date ? parseYear(row.start_date) : null,
      stop_year: row.stop_date ? parseYear(row.stop_date) : null,
    });
    if (preset === "client_wages") {
      return addRow("income_streams", withYears({
        ...base, owner: "Client", type: "Wages", description: "Client Wages",
        start_date: todayISO, stop_date: wagesStopDate("Client"), cola: 0.03,
        survivor_pct: 0,  // wages end at death or retirement; no survivor benefit
      }));
    }
    if (preset === "spouse_wages") {
      return addRow("income_streams", withYears({
        ...base, owner: "Spouse", type: "Wages", description: "Spouse Wages",
        start_date: todayISO, stop_date: wagesStopDate("Spouse"), cola: 0.03,
        survivor_pct: 0,
      }));
    }
    if (preset === "client_pension") {
      return addRow("income_streams", withYears({
        ...base, owner: "Client", type: "Pension", description: "Client Pension",
        start_date: pensionStartDate("Client"), stop_date: pensionStopDate("Client"),
        cola: 0.02, survivor_pct: 0.5,  // typical 50% joint-survivor annuity
      }));
    }
    if (preset === "spouse_pension") {
      return addRow("income_streams", withYears({
        ...base, owner: "Spouse", type: "Pension", description: "Spouse Pension",
        start_date: pensionStartDate("Spouse"), stop_date: pensionStopDate("Spouse"),
        cola: 0.02, survivor_pct: 0.5,
      }));
    }
    // Fallback / "Other income" — original blank preset.
    return addRow("income_streams", base);
  };
  const hasSpouse = !!(h.spouse_dob_year || h.spouse_name);

  return (
    <div className="space-y-6">
      {/* Market Scenario — what-if lens on returns & inflation */}
      <MarketScenarioSelector scenario={scenario} setScenario={setScenario} />

      {/* Optimization Goal Presets — framing decision, mirrored on the Strategy
          Optimizer page. Both write to scenario.optimizer.* so the choice
          persists with the plan. */}
      <Card className="p-5 border-[#4A6741]/30 bg-[#4A6741]/[0.03] shadow-none"
            data-testid="plan-inputs-goal-presets">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div>
            <h3 className="font-display text-lg font-bold tracking-tight">Planning Goal</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              Pick what this plan should illustrate. The Strategy Analyzer's sweep,
              ranked table, and AI analysis all follow this lens — change it anytime
              here or on the Strategy Analyzer tab.
            </p>
          </div>
        </div>
        <GoalPresetButtons scenario={scenario} setScenario={setScenario}
          showHeading={false} testidPrefix="plan-inputs-goal-preset"
          onRunSweep={onRequestRunSweep} />
      </Card>

      {/* Household & Longevity */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="household-card">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Household &amp; Longevity</h3>
          {(clientAgeStart != null || spouseAgeStart != null) && startYear && (
            <Badge variant="secondary"
              className="ml-2 bg-[#4A6741]/10 text-[#4A6741] border border-[#4A6741]/20 text-[10px] font-medium px-2 py-0.5"
              data-testid="ages-this-year-badge"
              title="Ages as of the projection start year. Cross-check retirement, SS-claim and Medicare dates against these ages.">
              {clientAgeStart != null && `Client ${clientAgeStart}`}
              {clientAgeStart != null && spouseAgeStart != null && " · "}
              {spouseAgeStart != null && `Spouse ${spouseAgeStart}`}
              {` in ${startYear}`}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
          Names, birth years and life expectancies (entered as an <span className="font-medium">age</span>, e.g. 91).
          The later of the two projected deaths (<span className="font-medium">dob + life expectancy</span>) anchors the plan:
          it drives the MFJ → survivor filing-status switch, the default stop date for income/expense streams, and the
          start of the heirs' SECURE-10 drawdown window.
          {secondDeathYear && (
            <span className="block mt-1">
              <span className="font-medium text-[#4A6741]">Currently projecting second death in {secondDeathYear}</span>
              {" "}({clientDeathYear ? `client ${clientDeathYear}` : ""}{clientDeathYear && spouseDeathYear ? " · " : ""}{spouseDeathYear ? `spouse ${spouseDeathYear}` : ""}).
            </span>
          )}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Client name</Label>
            <Input value={h.client_name ?? ""} data-testid="hh-client-name"
              onChange={(e) => updH("client_name", e.target.value)}
              className="mt-1 bg-[#F9F8F6]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Spouse name</Label>
            <Input value={h.spouse_name ?? ""} data-testid="hh-spouse-name"
              onChange={(e) => updH("spouse_name", e.target.value)}
              className="mt-1 bg-[#F9F8F6]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Client date of birth</Label>
            <Input type="date" value={h.client_dob ?? ""} data-testid="hh-client-dob"
              onChange={(e) => {
                const v = e.target.value;
                updH("client_dob", v || null);
                const y = v ? parseInt(v.slice(0, 4), 10) : null;
                if (y && !Number.isNaN(y)) updH("client_dob_year", y);
              }}
              className="mt-1 bg-[#F9F8F6]" />
            {h.client_dob_year && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Birth year {h.client_dob_year}{scenario.projection?.start_year ? ` · Age at plan start: ${scenario.projection.start_year - h.client_dob_year}` : ""}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Spouse date of birth</Label>
            <Input type="date" value={h.spouse_dob ?? ""} data-testid="hh-spouse-dob"
              onChange={(e) => {
                const v = e.target.value;
                updH("spouse_dob", v || null);
                const y = v ? parseInt(v.slice(0, 4), 10) : null;
                if (y && !Number.isNaN(y)) updH("spouse_dob_year", y);
              }}
              className="mt-1 bg-[#F9F8F6]" />
            {h.spouse_dob_year && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Birth year {h.spouse_dob_year}{scenario.projection?.start_year ? ` · Age at plan start: ${scenario.projection.start_year - h.spouse_dob_year}` : ""}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Client retirement date</Label>
            <Input type="date" data-testid="hh-client-retirement-date"
              value={h.client_retirement_date ?? ""}
              disabled={!!h.client_already_retired}
              onChange={(e) => updH("client_retirement_date", e.target.value || null)}
              placeholder={h.client_dob_year ? `${h.client_dob_year + 65}-01-01` : ""}
              className="mt-1 bg-[#F9F8F6] disabled:opacity-60" />
            <label className="flex items-center gap-2 mt-1 cursor-pointer">
              <Switch checked={!!h.client_already_retired}
                onCheckedChange={(v) => updH("client_already_retired", v || null)}
                data-testid="hh-client-already-retired" />
              <span className="text-[10px] text-muted-foreground">Already retired (use today's date)</span>
            </label>
            {h.client_dob_year && (h.client_retirement_date || h.client_already_retired) && (
              <p className="text-[10px] text-muted-foreground mt-1" data-testid="hh-client-retirement-age-derived">
                Retires at age {h.client_already_retired
                  ? (new Date().getFullYear() - h.client_dob_year)
                  : (parseInt(String(h.client_retirement_date).slice(0, 4), 10) - h.client_dob_year)}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Spouse retirement date</Label>
            <Input type="date" data-testid="hh-spouse-retirement-date"
              value={h.spouse_retirement_date ?? ""}
              disabled={!!h.spouse_already_retired}
              onChange={(e) => updH("spouse_retirement_date", e.target.value || null)}
              placeholder={h.spouse_dob_year ? `${h.spouse_dob_year + 65}-01-01` : ""}
              className="mt-1 bg-[#F9F8F6] disabled:opacity-60" />
            <label className="flex items-center gap-2 mt-1 cursor-pointer">
              <Switch checked={!!h.spouse_already_retired}
                onCheckedChange={(v) => updH("spouse_already_retired", v || null)}
                data-testid="hh-spouse-already-retired" />
              <span className="text-[10px] text-muted-foreground">Already retired (use today's date)</span>
            </label>
            {h.spouse_dob_year && (h.spouse_retirement_date || h.spouse_already_retired) && (
              <p className="text-[10px] text-muted-foreground mt-1" data-testid="hh-spouse-retirement-age-derived">
                Retires at age {h.spouse_already_retired
                  ? (new Date().getFullYear() - h.spouse_dob_year)
                  : (parseInt(String(h.spouse_retirement_date).slice(0, 4), 10) - h.spouse_dob_year)}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Client SS claim date</Label>
            <Input type="date" data-testid="hh-client-ss-claim-date"
              value={h.client_ss_claim_date ?? ""}
              onChange={(e) => updH("client_ss_claim_date", e.target.value || null)}
              placeholder={h.client_dob_year ? `${h.client_dob_year + 67}-01-01` : ""}
              className="mt-1 bg-[#F9F8F6]" />
            {h.client_dob_year && (
              <p className="text-[10px] text-muted-foreground mt-1" data-testid="hh-client-ss-claim-age-derived">
                Default: {h.client_dob_year + 67}-01-01 (67th birthday).
                {h.client_ss_claim_date && (() => {
                  const claimYear = parseInt(String(h.client_ss_claim_date).slice(0, 4), 10);
                  const claimAge = claimYear - h.client_dob_year;
                  return ` Claims at age ${claimAge}.`;
                })()}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Spouse SS claim date</Label>
            <Input type="date" data-testid="hh-spouse-ss-claim-date"
              value={h.spouse_ss_claim_date ?? ""}
              onChange={(e) => updH("spouse_ss_claim_date", e.target.value || null)}
              placeholder={h.spouse_dob_year ? `${h.spouse_dob_year + 67}-01-01` : ""}
              className="mt-1 bg-[#F9F8F6]" />
            {h.spouse_dob_year && (
              <p className="text-[10px] text-muted-foreground mt-1" data-testid="hh-spouse-ss-claim-age-derived">
                Default: {h.spouse_dob_year + 67}-01-01 (67th birthday).
                {h.spouse_ss_claim_date && (() => {
                  const claimYear = parseInt(String(h.spouse_ss_claim_date).slice(0, 4), 10);
                  const claimAge = claimYear - h.spouse_dob_year;
                  return ` Claims at age ${claimAge}.`;
                })()}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Client life expectancy (age)</Label>
            <Input type="number" value={h.client_life_expectancy ?? ""} data-testid="hh-client-le"
              onChange={(e) => updH("client_life_expectancy", e.target.value === "" ? null : parseInt(e.target.value, 10))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">
              {h.client_dob_year && h.client_life_expectancy
                ? `Projected death year ${h.client_dob_year + h.client_life_expectancy}`
                : "Enter as an age, not a year."}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Spouse life expectancy (age)</Label>
            <Input type="number" value={h.spouse_life_expectancy ?? ""} data-testid="hh-spouse-le"
              onChange={(e) => updH("spouse_life_expectancy", e.target.value === "" ? null : parseInt(e.target.value, 10))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">
              {h.spouse_dob_year && h.spouse_life_expectancy
                ? `Projected death year ${h.spouse_dob_year + h.spouse_life_expectancy}`
                : "Enter as an age, not a year."}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Projection start year</Label>
            <Input type="number" value={scenario.projection.start_year ?? ""} data-testid="hh-start-year"
              onChange={(e) => updProj("start_year", e.target.value === "" ? null : parseInt(e.target.value, 10))}
              className="mt-1 bg-[#F9F8F6]" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Projection end year</Label>
            <Input type="number" value={scenario.projection.end_year ?? ""} data-testid="hh-end-year"
              onChange={(e) => updProj("end_year", e.target.value === "" ? null : parseInt(e.target.value, 10))}
              className="mt-1 bg-[#F9F8F6]" />
            {(() => {
              const endYear = scenario.projection?.end_year || null;
              if (!secondDeathYear || !endYear) {
                return (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Defaults to the second-death year. The heirs' 10-year SECURE window is shown separately on Analytics, Concepts and Legacy.
                  </p>
                );
              }
              if (endYear === secondDeathYear) {
                return (
                  <p className="text-[10px] text-muted-foreground mt-1" data-testid="hh-end-year-status">
                    Synced to second death ({secondDeathYear}). Auto-adjusts when life expectancies change.
                    The main projection stops here — the heirs' 10-year SECURE window is shown separately on Analytics, Concepts and Legacy.
                  </p>
                );
              }
              if (endYear > secondDeathYear) {
                const extra = endYear - secondDeathYear;
                return (
                  <p className="text-[10px] text-[#8A6D3B] mt-1" data-testid="hh-end-year-status">
                    Note — end year is {extra} year{extra === 1 ? "" : "s"} past second death ({secondDeathYear}), but the main projection loop stops at the second death regardless. The heirs' 10-year SECURE drawdown is calculated separately on Analytics / Concepts / Legacy.
                    <button type="button" className="ml-1 underline hover:no-underline"
                      onClick={() => updProj("end_year", secondDeathYear)}
                      data-testid="hh-end-year-resync">Sync to second death</button>
                  </p>
                );
              }
              const gap = secondDeathYear - endYear;
              return (
                <p className="text-[10px] text-[#B84A4A] mt-1" data-testid="hh-end-year-status">
                  Warning — end year is {gap} year{gap === 1 ? "" : "s"} before second death ({secondDeathYear}). The plan will cut off before the surviving spouse dies.
                  <button type="button" className="ml-1 underline hover:no-underline"
                    onClick={() => updProj("end_year", secondDeathYear)}
                    data-testid="hh-end-year-resync">Sync to second death</button>
                </p>
              );
            })()}
          </div>
        </div>
      </Card>

      {/* Income streams */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="income-streams-editor">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Income Streams</h3>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="bg-[#4A6741] hover:bg-[#3B5234] text-white" data-testid="add-income-button">
                <Plus className="h-4 w-4 mr-1" /> Add
                <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-80" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64" data-testid="add-income-menu">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">Add income stream</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => addIncomeStream("client_wages")}
                data-testid="add-income-client-wages"
                className="text-xs cursor-pointer">
                <Briefcase className="h-3.5 w-3.5 mr-2 text-[#4A6741]" />
                <div className="flex flex-col">
                  <span>Client Wages</span>
                  <span className="text-[10px] text-muted-foreground">
                    {clientRetYear
                      ? (clientRetYear < currentYear ? "Ends today (already retired)" : `Ends ${clientRetYear}-12-31 (retirement)`)
                      : "Set client retirement date"}
                  </span>
                </div>
              </DropdownMenuItem>
              {hasSpouse && (
                <DropdownMenuItem onClick={() => addIncomeStream("spouse_wages")}
                  data-testid="add-income-spouse-wages"
                  className="text-xs cursor-pointer">
                  <Briefcase className="h-3.5 w-3.5 mr-2 text-[#4A6741]" />
                  <div className="flex flex-col">
                    <span>Spouse Wages</span>
                    <span className="text-[10px] text-muted-foreground">
                      {spouseRetYear
                        ? (spouseRetYear < currentYear ? "Ends today (already retired)" : `Ends ${spouseRetYear}-12-31 (retirement)`)
                        : "Set spouse retirement date"}
                    </span>
                  </div>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => addIncomeStream("client_pension")}
                data-testid="add-income-client-pension"
                className="text-xs cursor-pointer">
                <Wallet className="h-3.5 w-3.5 mr-2 text-[#C87941]" />
                <div className="flex flex-col">
                  <span>Client Pension</span>
                  <span className="text-[10px] text-muted-foreground">
                    {clientRetYear && clientDeathYear
                      ? `${clientRetYear}-01-01 → ${clientDeathYear}-12-31 (life expectancy)`
                      : "Set retirement date + life expectancy"}
                  </span>
                </div>
              </DropdownMenuItem>
              {hasSpouse && (
                <DropdownMenuItem onClick={() => addIncomeStream("spouse_pension")}
                  data-testid="add-income-spouse-pension"
                  className="text-xs cursor-pointer">
                  <Wallet className="h-3.5 w-3.5 mr-2 text-[#C87941]" />
                  <div className="flex flex-col">
                    <span>Spouse Pension</span>
                    <span className="text-[10px] text-muted-foreground">
                      {spouseRetYear && spouseDeathYear
                        ? `${spouseRetYear}-01-01 → ${spouseDeathYear}-12-31 (life expectancy)`
                        : "Set retirement date + life expectancy"}
                    </span>
                  </div>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => addIncomeStream("other")}
                data-testid="add-income-other"
                className="text-xs cursor-pointer">
                <MoreHorizontal className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <div className="flex flex-col">
                  <span>Other income</span>
                  <span className="text-[10px] text-muted-foreground">Blank — set dates manually</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="overflow-x-auto">
          <TooltipProvider>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-1">Description</th><th className="px-2">Owner</th><th className="px-2">Tax Character</th>
                <th className="px-2">Amount</th><th className="px-2">Freq</th><th className="px-2">COLA %</th>
                <th className="px-2">Start Date</th><th className="px-2">Stop Date</th><th className="px-2">Surv %</th><th className="px-2">Use</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scenario.income_streams.map((s, i) => {
                const ssDef = ssStreamDefault(s);
                const isSS = s.tax_character === "SS";
                return (
                <tr key={s.id} className="border-b border-[#F3F1EC]" data-testid={`income-row-${i}`}>
                  <Cell w="min-w-[160px]"><Txt value={s.description} onChange={(v) => mut("income_streams", i, "description", v)} testid={`inc-desc-${i}`} /></Cell>
                  <Cell><Sel value={s.owner} onChange={(v) => mut("income_streams", i, "owner", v)} options={OWNERS} testid={`inc-owner-${i}`} /></Cell>
                  <Cell>
                    <div className="flex items-center">
                      <Sel value={s.tax_character} onChange={(v) => mut("income_streams", i, "tax_character", v)} options={TAX_CHARS} testid={`inc-char-${i}`} />
                      {isSS && (
                        <SSHelp isHigher={ssDef.isHigher} otherAmount={ssDef.otherAmount} meAmount={s.amount || 0} />
                      )}
                    </div>
                  </Cell>
                  <Cell w="w-28"><Money value={s.amount} onChange={(v) => mut("income_streams", i, "amount", v)} testid={`inc-amt-${i}`} /></Cell>
                  <Cell><Sel value={s.frequency} onChange={(v) => mut("income_streams", i, "frequency", v)} options={FREQS} testid={`inc-freq-${i}`} /></Cell>
                  <Cell w="w-16"><Pct value={s.cola} onChange={(v) => mut("income_streams", i, "cola", v)} testid={`inc-cola-${i}`} /></Cell>
                  <Cell w="w-36"><DateInput value={s.start_date} onChange={(v) => mutDate("income_streams", i, "start_date", "start_year", v)} testid={`inc-start-${i}`} /></Cell>
                  <Cell w="w-36"><DateInput value={s.stop_date} defaultValue={ssDef.stopDate} defaultLabel={ssDef.stopLabel} onChange={(v) => mutDate("income_streams", i, "stop_date", "stop_year", v)} testid={`inc-stop-${i}`} /></Cell>
                  <Cell w="w-16"><Pct value={s.survivor_pct} onChange={(v) => mut("income_streams", i, "survivor_pct", v)} testid={`inc-surv-${i}`} step={5} /></Cell>
                  <Cell><Switch checked={s.use} onCheckedChange={(v) => mut("income_streams", i, "use", v)} data-testid={`inc-use-${i}`} /></Cell>
                  <Cell><button onClick={() => delRow("income_streams", i)} data-testid={`inc-del-${i}`}><Trash2 className="h-4 w-4 text-[#B84A4A]" /></button></Cell>
                </tr>
                );
              })}
            </tbody>
          </table>
          </TooltipProvider>
        </div>
      </Card>

      {/* Expenses */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="expenses-editor">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-[#C87941]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Expenses</h3>
          </div>
          <Button size="sm" onClick={() => addRow("expenses", {
            id: `EXP${Date.now()}`, owner: "Joint", category: "New expense",
            start_date: `${scenario.projection.start_year}-01-01`, stop_date: null,
            start_year: scenario.projection.start_year, stop_year: null, amount: 0,
            frequency: "Annual", inflation: 0.03, use: true,
          })} className="bg-[#4A6741] hover:bg-[#3B5234] text-white" data-testid="add-expense-button">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-1">Category</th><th className="px-2">Owner</th><th className="px-2">Amount</th>
                <th className="px-2">Freq</th><th className="px-2">Inflation %</th><th className="px-2">Start Date</th><th className="px-2">Stop Date</th><th className="px-2">Use</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scenario.expenses.map((e, i) => (
                <tr key={e.id} className="border-b border-[#F3F1EC]" data-testid={`expense-row-${i}`}>
                  <Cell w="min-w-[160px]"><Txt value={e.category} onChange={(v) => mut("expenses", i, "category", v)} testid={`exp-cat-${i}`} /></Cell>
                  <Cell><Sel value={e.owner} onChange={(v) => mut("expenses", i, "owner", v)} options={OWNERS} testid={`exp-owner-${i}`} /></Cell>
                  <Cell w="w-28"><Money value={e.amount} onChange={(v) => mut("expenses", i, "amount", v)} testid={`exp-amt-${i}`} /></Cell>
                  <Cell><Sel value={e.frequency} onChange={(v) => mut("expenses", i, "frequency", v)} options={FREQS} testid={`exp-freq-${i}`} /></Cell>
                  <Cell w="w-16"><Pct value={e.inflation} onChange={(v) => mut("expenses", i, "inflation", v)} testid={`exp-infl-${i}`} /></Cell>
                  <Cell w="w-36"><DateInput value={e.start_date} onChange={(v) => mutDate("expenses", i, "start_date", "start_year", v)} testid={`exp-start-${i}`} /></Cell>
                  <Cell w="w-36"><DateInput value={e.stop_date} defaultValue={secondDeathDate} onChange={(v) => mutDate("expenses", i, "stop_date", "stop_year", v)} testid={`exp-stop-${i}`} /></Cell>
                  <Cell><Switch checked={e.use} onCheckedChange={(v) => mut("expenses", i, "use", v)} data-testid={`exp-use-${i}`} /></Cell>
                  <Cell><button onClick={() => delRow("expenses", i)} data-testid={`exp-del-${i}`}><Trash2 className="h-4 w-4 text-[#B84A4A]" /></button></Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Accounts */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="accounts-editor">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <PiggyBank className="h-4 w-4 text-[#4A6741]" />
            <h3 className="font-display text-lg font-bold tracking-tight">Accounts</h3>
          </div>
          <Button size="sm" onClick={() => addRow("accounts", {
            id: `ACC${Date.now()}`, owner: "Joint", name: "Joint Taxable Brokerage", tax_type: "Taxable",
            beginning_balance: 0, cost_basis: 0, return: 0.07,
          })} className="bg-[#4A6741] hover:bg-[#3B5234] text-white" data-testid="add-account-button">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
          Enter each <span className="font-medium">taxable account's Expected Return as the GROSS total return</span> (e.g. 0.07).
          The engine pays out the dividend yield below as taxable cash income each year and grows the account at the
          <span className="font-medium"> appreciation rate = gross return − dividend yield</span> (so set the return gross; appreciation is computed net of dividends automatically).
          Tax-deferred, Roth, cash and real-estate accounts grow at their full return.
          <span className="block mt-1"><span className="font-medium">Owner</span> (Client / Spouse / Joint) drives the
          <span className="font-medium"> first-death cost-basis step-up</span> on taxable &amp; real-estate accounts:
          in a community-property state the full account steps up at the first death; in a common-law state the
          decedent's own accounts step up 100%, jointly-owned 50%, and the survivor's own accounts 0%.</span>
        </p>
        <div className="mb-4 max-w-sm">
          <Label className="text-xs text-muted-foreground">Other Dividends Realized — Rate (% of taxable)</Label>
          <Input type="number" step={0.005} value={scenario.dividend_yield ?? 0.01} data-testid="dividend-yield"
            onChange={(e) => setScenario((p) => ({ ...p, dividend_yield: parseFloat(e.target.value) || 0 }))}
            className="mt-1 bg-[#F9F8F6]" />
          <p className="text-[10px] text-muted-foreground mt-1" data-testid="dividend-derivation">
            Default 1% (0.01). ≈ <span className="font-medium text-[#4A6741]">{fmtUSD(divDollars)}/yr</span> on {fmtUSD(taxableTotal)} taxable balances — this is the
            <span className="font-medium"> Qualified Dividends + Recurring LTCG</span> used by the Single-Year Analyzer. Paid to cash as qualified dividends (taxed at LTCG rates).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-1">Account</th><th className="px-2">Owner</th><th className="px-2">Tax Type</th><th className="px-2">Beginning Balance</th>
                <th className="px-2">Cost Basis</th><th className="px-2">Expected Return</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scenario.accounts.map((a, i) => (
                <tr key={a.id} className="border-b border-[#F3F1EC]" data-testid={`account-row-${i}`}>
                  <Cell w="min-w-[180px]"><Txt value={a.name} onChange={(v) => mut("accounts", i, "name", v)} testid={`acc-name-${i}`} /></Cell>
                  <Cell><Sel value={a.owner} onChange={(v) => mut("accounts", i, "owner", v)} options={OWNERS} testid={`acc-owner-${i}`} /></Cell>
                  <Cell><Sel value={a.tax_type} onChange={(v) => mut("accounts", i, "tax_type", v)} options={TAX_TYPES} testid={`acc-type-${i}`} /></Cell>
                  <Cell w="w-36"><Money step={10000} value={a.beginning_balance} onChange={(v) => mut("accounts", i, "beginning_balance", v)} testid={`acc-bal-${i}`} /></Cell>
                  <Cell w="w-36">
                    {a.tax_type === "Taxable" || a.tax_type === "Real Estate" ? (
                      <Money step={10000} value={a.cost_basis} onChange={(v) => mut("accounts", i, "cost_basis", v)} testid={`acc-basis-${i}`} />
                    ) : (
                      <span
                        className="text-xs text-muted-foreground italic"
                        title="Cost basis doesn't apply to this account type — the tax engine ignores it."
                        data-testid={`acc-basis-${i}`}
                      >
                        N/A
                      </span>
                    )}
                  </Cell>
                  <Cell w="w-24"><Txt type="number" step={0.005} value={a.return} onChange={(v) => mut("accounts", i, "return", v)} testid={`acc-return-${i}`} /></Cell>
                  <Cell><button onClick={() => delRow("accounts", i)} data-testid={`acc-del-${i}`}><Trash2 className="h-4 w-4 text-[#B84A4A]" /></button></Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {/* Tax assumptions & heirs */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="tax-heirs-editor">
        <div className="flex items-center gap-2 mb-1">
          <Landmark className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Tax Assumptions & Heirs</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          The heir tax rate is what your beneficiaries pay to draw down an <span className="font-medium">inherited Traditional IRA</span> (SECURE 10-year). It drives the "Find Optimal Bracket" result — converting at a rate <span className="font-medium">higher</span> than your heirs' rate destroys value, so set this to your beneficiaries' real bracket.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> State of Residence
            </Label>
            <Select value={stateCode} onValueChange={onStateChange}>
              <SelectTrigger className="mt-1 h-9 bg-[#F9F8F6] text-sm" data-testid="tax-state-code">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="CUSTOM">Custom / Other</SelectItem>
                {states.map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {currentState && (
              <div className="flex flex-wrap gap-1 mt-1.5" data-testid="state-flags">
                {currentState.tax_meta?.type === "progressive" && (
                  <Badge variant="secondary" className="bg-[#4A6741]/15 text-[#4A6741] text-[10px] px-1.5 py-0" title="Uses actual per-bracket state rates">Progressive brackets</Badge>
                )}
                {currentState.tax_meta?.type === "flat" && (
                  <Badge variant="secondary" className="bg-[#4A6741]/15 text-[#4A6741] text-[10px] px-1.5 py-0" title={`Flat ${(currentState.tax_meta.flat_rate * 100).toFixed(2)}% state rate`}>Flat {(currentState.tax_meta.flat_rate * 100).toFixed(2)}%</Badge>
                )}
                {currentState.tax_meta?.type === "none" && (
                  <Badge variant="secondary" className="bg-[#4A6741]/15 text-[#4A6741] text-[10px] px-1.5 py-0">No income tax</Badge>
                )}
                {currentState.is_community_property && (
                  <Badge variant="secondary" className="bg-[#C87941]/10 text-[#C87941] text-[10px] px-1.5 py-0" title="100% basis step-up at first death">Community Property</Badge>
                )}
                {currentState.tax_meta?.exempts_ss && (
                  <Badge variant="secondary" className="bg-[#4A6741]/10 text-[#4A6741] text-[10px] px-1.5 py-0" title="Social Security benefits excluded from state income tax">Exempts SS</Badge>
                )}
                {currentState.tax_meta?.exempts_pension && (
                  <Badge variant="secondary" className="bg-[#4A6741]/10 text-[#4A6741] text-[10px] px-1.5 py-0" title="Pension / annuity income excluded from state income tax">Exempts Pension</Badge>
                )}
                {currentState.tax_meta?.exempts_ira && (
                  <Badge variant="secondary" className="bg-[#4A6741]/10 text-[#4A6741] text-[10px] px-1.5 py-0" title="Traditional IRA distributions excluded from state income tax">Exempts IRA</Badge>
                )}
                {currentState.tax_meta?.ret_exclusion_cap > 0 && (
                  <Badge variant="secondary" className="bg-[#C87941]/10 text-[#C87941] text-[10px] px-1.5 py-0" title={`Partial retirement-income exclusion: $${currentState.tax_meta.ret_exclusion_cap.toLocaleString()}/person${currentState.tax_meta.ret_exclusion_min_age ? ` age ${currentState.tax_meta.ret_exclusion_min_age}+` : ""}`}>${(currentState.tax_meta.ret_exclusion_cap / 1000).toFixed(0)}k retiree exclusion</Badge>
                )}
              </div>
            )}
            {currentState?.tax_meta?.note && (
              <p className="text-[10px] text-muted-foreground italic mt-1.5" data-testid="state-note">{currentState.tax_meta.note}</p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Your State Income Tax Rate</Label>
            <Input type="number" step={0.001} value={scenario.tax.state_rate} data-testid="tax-state-rate"
              onChange={(e) => setScenario((p) => ({ ...p, tax: { ...p.tax, state_rate: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]"
              disabled={!!scenario.tax.state_code} />
            <p className="text-[10px] text-muted-foreground mt-1">
              {scenario.tax.state_code
                ? <>Engine uses the full <span className="font-medium">{scenario.tax.state_code}</span> bracket schedule + retirement-income exclusions. This flat rate is unused; clear the state to re-enable.</>
                : <>Fallback flat rate applied to federal taxable income when no state is selected. e.g. 0.0399 = 3.99%.</>
              }
            </p>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={!!scenario.tax.community_property}
              onCheckedChange={(v) => setScenario((p) => ({ ...p, tax: { ...p.tax, community_property: v } }))}
              data-testid="tax-community-property" />
            <div>
              <Label className="text-xs text-muted-foreground">Community Property State</Label>
              <p className="text-[10px] text-muted-foreground">100% basis step-up at 1st death (else decedent/joint half).</p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={scenario.tax.merge_basis_at_first_death !== false}
              onCheckedChange={(v) => setScenario((p) => ({ ...p, tax: { ...p.tax, merge_basis_at_first_death: v } }))}
              data-testid="tax-merge-basis-toggle" />
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                Merge Basis at First Death
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-[#4A6741]/40 text-[#4A6741]">Workbook parity</Badge>
              </Label>
              <p className="text-[10px] text-muted-foreground">
                <span className="font-medium">On</span> (default): pool all taxable accounts into one blended-basis line at Y1 — matches the spreadsheet's Legacy page exactly.
                <span className="font-medium"> Off</span>: keep accounts separate — the stepped-up lot is spent first (tax-efficient, small positive delta vs sheet).
              </p>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">General Inflation (CPI, %)</Label>
            <Input type="number" step={0.5}
              value={scenario.projection?.general_inflation == null
                ? ""
                : +((scenario.projection.general_inflation) * 100).toFixed(4)}
              data-testid="general-inflation"
              onChange={(e) => {
                const pct = parseFloat(e.target.value);
                const v = Number.isFinite(pct) ? pct / 100 : 0;
                setScenario((p) => ({
                  ...p,
                  projection: {
                    ...p.projection,
                    // One control drives the whole inflation family so tax brackets
                    // and IRMAA thresholds track the assumed CPI. Otherwise setting
                    // inflation to 8% while leaving bracket_indexing at 3% would
                    // silently under-index the brackets and inflate the tax hit.
                    general_inflation: v,
                    bracket_indexing: v,
                    irmaa_indexing: v,
                  },
                }));
              }}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">
              Drives tax bracket + IRMAA indexing and PV discounting. Default <span className="font-medium">3%</span>.
              A non-baseline Market Scenario preset overrides this value.
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Heirs' Federal Tax Rate</Label>
            <Input type="number" step={0.01} value={scenario.legacy.heir_federal_rate} data-testid="heir-fed-rate"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, heir_federal_rate: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Heirs' marginal federal bracket.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Heirs' State Tax Rate</Label>
            <Input type="number" step={0.01} value={scenario.legacy.heir_state_rate} data-testid="heir-state-rate"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, heir_state_rate: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Heirs' state bracket (0 if none).</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Estate Settlement Cost</Label>
            <Input type="number" step={0.005} value={scenario.legacy.estate_settlement_pct} data-testid="estate-settlement-pct"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, estate_settlement_pct: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">% of gross estate at 2nd death.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Post-Death Horizon (years)</Label>
            <Input type="number" step={1} value={scenario.legacy.post_death_years ?? 10} data-testid="post-death-years"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, post_death_years: parseInt(e.target.value, 10) || 10 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">SECURE drawdown window (default 10).</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Heirs' Reinvestment Return</Label>
            <Input type="number" step={0.005} value={scenario.legacy.heir_reinvest_return ?? ""} placeholder="auto (account return)" data-testid="heir-reinvest-return"
              onChange={(e) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, heir_reinvest_return: e.target.value === "" ? null : parseFloat(e.target.value) } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Growth heirs earn post-death. Blank = use account returns.</p>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={!!scenario.legacy.heir_gains_realized}
              onCheckedChange={(v) => setScenario((p) => ({ ...p, legacy: { ...p.legacy, heir_gains_realized: v } }))}
              data-testid="heir-gains-realized-switch" />
            <div>
              <Label className="text-xs text-muted-foreground">Heirs Realize Gains at Horizon End</Label>
              <p className="text-[10px] text-muted-foreground">On: LTCG charged on post-death appreciation at the end of the SECURE window. Off (default): gains stay unrealized — heirs hold, spend dividends, or step up again at their own deaths.</p>
            </div>
          </div>
          <div className="md:col-span-2 flex items-end">
            <div className="rounded-lg border border-[#4A6741]/30 bg-[#4A6741]/5 p-3 w-full" data-testid="blended-heir-rate">
              <p className="label-cap text-[#4A6741] text-[10px] mb-1">Blended Heir Rate on Inherited IRA</p>
              <p className="font-display text-2xl font-bold text-[#4A6741]">
                {(((scenario.legacy.heir_federal_rate || 0) + (scenario.legacy.heir_state_rate || 0)) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
          <BeneficiariesEditor />
        </div>
      </Card>

      {/* Lifetime Giving Program — §2503(b) annual exclusion + §2503(e) direct pay */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="giving-editor">
        <div className="flex items-center gap-2 mb-1">
          <Gift className="h-4 w-4 text-[#C87941]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Lifetime Giving Program</h3>
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-[#C87941]/40 text-[#C87941]">Estate-shrink strategy</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
          Simulate annual exclusion gifts <span className="font-medium">(§2503(b): $19K/donor/donee in 2026)</span> and unlimited direct medical/tuition payments <span className="font-medium">(§2503(e))</span>. Each dollar is withdrawn from the taxable brokerage and tracked in a separate <span className="font-medium">family pot</span> that compounds at the heir reinvestment rate — showing the estate-shrink value without polluting your projected net worth.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Gift className="h-3 w-3" /> Annual Exclusion Gifts ($/yr)
            </Label>
            <Input type="number" step={1000} value={scenario.giving?.annual_gift_amount ?? 0} data-testid="giving-annual-gift"
              onChange={(e) => setScenario((p) => ({ ...p, giving: { ...(p.giving || {}), annual_gift_amount: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Both spouses combined. 2026 IRS cap: $19K × donees × 2 donors.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Heart className="h-3 w-3" /> §2503(e) Direct Pay ($/yr)
            </Label>
            <Input type="number" step={1000} value={scenario.giving?.section_2503e_amount ?? 0} data-testid="giving-2503e"
              onChange={(e) => setScenario((p) => ({ ...p, giving: { ...(p.giving || {}), section_2503e_amount: parseFloat(e.target.value) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Uncapped tuition + medical paid directly to the institution.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Start Year</Label>
            <Input type="number" step={1} value={scenario.giving?.start_year || ""} placeholder="auto (plan start)" data-testid="giving-start-year"
              onChange={(e) => setScenario((p) => ({ ...p, giving: { ...(p.giving || {}), start_year: parseInt(e.target.value, 10) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Blank = start immediately.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">End Year</Label>
            <Input type="number" step={1} value={scenario.giving?.end_year || ""} placeholder="auto (plan end)" data-testid="giving-end-year"
              onChange={(e) => setScenario((p) => ({ ...p, giving: { ...(p.giving || {}), end_year: parseInt(e.target.value, 10) || 0 } }))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">Blank = through 2nd death.</p>
          </div>
          <div className="md:col-span-4 rounded-lg border border-[#C87941]/25 bg-[#C87941]/5 p-3" data-testid="giving-summary-preview">
            <p className="label-cap text-[#C87941] text-[10px] mb-1">Estate Impact Preview</p>
            <p className="text-xs text-[#5D4037]">
              Total annual outflow: <span className="font-bold">{fmtUSD((scenario.giving?.annual_gift_amount || 0) + (scenario.giving?.section_2503e_amount || 0))}/yr</span>
              {" · "}
              These dollars leave the taxable estate immediately and grow tax-deferred outside your net worth. Family pot appears in the Estate tab at Y2+10.
            </p>
          </div>
        </div>
      </Card>

      {/* Asset Allocation — household-level weights for Monte Carlo */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="allocation-card">
        <div className="flex items-center gap-2 mb-4">
          <PieChart className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Asset Allocation (Monte Carlo)</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
          Household-level stocks / bonds / cash mix used by the Monte Carlo simulation to size its
          volatility draws. Should reflect the client&apos;s aggregate portfolio and how it&apos;s
          being rebalanced across accounts. Weights auto-normalize; if any of the three is blank,
          the simulation falls back to the default 60 / 30 / 10 mix. The deterministic projection
          continues to use each account&apos;s own <code>return</code> field — this input only
          affects MC dispersion.
        </p>
        {(() => {
          const alloc = scenario.allocation || { stocks: 0.6, bonds: 0.3, cash: 0.1 };
          const updAlloc = (k, v) => setScenario((p) => ({
            ...p,
            allocation: { ...(p.allocation || { stocks: 0.6, bonds: 0.3, cash: 0.1 }), [k]: v },
          }));
          const sum = (alloc.stocks || 0) + (alloc.bonds || 0) + (alloc.cash || 0);
          const sumPct = Math.round(sum * 1000) / 10;
          const sumClass = Math.abs(sum - 1) < 0.005 ? "text-[#4A6741]" : "text-[#C4A64A]";
          return (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Stocks (0–1)</Label>
                  <Input type="number" step={0.05} min={0} max={1}
                    value={alloc.stocks ?? ""} data-testid="alloc-stocks"
                    onChange={(e) => updAlloc("stocks", Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
                    className="mt-1 bg-[#F9F8F6]" />
                  <p className="text-[10px] text-muted-foreground mt-1">Default 0.60. Mean 8%, vol 18%.</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Bonds (0–1)</Label>
                  <Input type="number" step={0.05} min={0} max={1}
                    value={alloc.bonds ?? ""} data-testid="alloc-bonds"
                    onChange={(e) => updAlloc("bonds", Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
                    className="mt-1 bg-[#F9F8F6]" />
                  <p className="text-[10px] text-muted-foreground mt-1">Default 0.30. Mean 4%, vol 6%.</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Cash (0–1)</Label>
                  <Input type="number" step={0.05} min={0} max={1}
                    value={alloc.cash ?? ""} data-testid="alloc-cash"
                    onChange={(e) => updAlloc("cash", Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
                    className="mt-1 bg-[#F9F8F6]" />
                  <p className="text-[10px] text-muted-foreground mt-1">Default 0.10. Mean 3%, vol 1%.</p>
                </div>
              </div>
              <p className={`text-[11px] mt-3 ${sumClass}`} data-testid="alloc-sum">
                Weights sum to <strong>{sumPct}%</strong>
                {Math.abs(sum - 1) < 0.005
                  ? " ✓"
                  : ` (auto-normalized in the MC — target 100%)`}
              </p>
            </>
          );
        })()}
      </Card>

      {/* Charitable Giving (QCD) — placed at the bottom of the page per client request */}
      <Card className="p-6 border-[#EBE8E0] shadow-none" data-testid="qcd-card">
        <div className="flex items-center gap-2 mb-4">
          <HandHeart className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-lg font-bold tracking-tight">Charitable Giving — Qualified Charitable Distribution (QCD)</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
          A QCD sends dollars directly from your Traditional IRA to a 501(c)(3) charity. Amount counts toward your RMD dollar-for-dollar and is <strong>excluded from AGI</strong> — a powerful tax move for charitably-inclined households age 70½+. Annual per-taxpayer cap: <strong>$111,000</strong> (2026, IRS-indexed).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Annual QCD amount ($)</Label>
            <Input type="number" data-testid="hh-qcd-amount"
              value={h.qcd_annual_amount ?? ""}
              placeholder="0"
              onChange={(e) => updH("qcd_annual_amount", e.target.value === "" ? null : Math.max(0, parseFloat(e.target.value)))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">
              0 or blank = QCD off. Set to a positive $ to activate.
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Start year</Label>
            <Input type="number" data-testid="hh-qcd-start-year"
              value={h.qcd_start_year ?? ""}
              placeholder={h.client_dob_year ? String(h.client_dob_year + 70) : "e.g. 2028"}
              onChange={(e) => updH("qcd_start_year", e.target.value === "" ? null : parseInt(e.target.value, 10))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">
              Default: year Client turns 70{h.client_dob_year ? ` (${h.client_dob_year + 70})` : ""}. QCD is only allowed at 70½+.
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">End year (optional)</Label>
            <Input type="number" data-testid="hh-qcd-end-year"
              value={h.qcd_end_year ?? ""}
              placeholder={secondDeathYear ? `${secondDeathYear} (second death)` : "Blank = through end"}
              onChange={(e) => updH("qcd_end_year", e.target.value === "" ? null : parseInt(e.target.value, 10))}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">
              Blank = give until the end of the projection.
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Client share (%)</Label>
            <Input type="number" min="0" max="100" step="5" data-testid="hh-qcd-client-share"
              value={h.qcd_client_share != null ? Math.round(h.qcd_client_share * 100) : 100}
              onChange={(e) => {
                const raw = parseFloat(e.target.value);
                const clamped = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 100));
                updH("qcd_client_share", clamped / 100);
              }}
              className="mt-1 bg-[#F9F8F6]" />
            <p className="text-[10px] text-muted-foreground mt-1">
              Portion from Client's IRA vs Spouse's. 100 = all Client. Auto-shifts to eligible spouse if the other is under 70.
            </p>
          </div>
        </div>
        {(h.qcd_annual_amount || 0) > 111000 && (
          <p className="text-[11px] text-[#B84A4A] mt-3" data-testid="hh-qcd-cap-warning">
            ⚠ Amount above the 2026 IRS per-taxpayer cap of $111,000. Excess will be clipped at $111K/spouse when computing this year's QCD.
          </p>
        )}
        {h.qcd_annual_amount > 0 && !h.qcd_start_year && !h.client_dob_year && (
          <p className="text-[11px] text-[#8A6D3B] mt-3">
            Enter Client's date of birth first so we can default the start year to when Client turns 70.
          </p>
        )}
      </Card>
    </div>
  );
};
