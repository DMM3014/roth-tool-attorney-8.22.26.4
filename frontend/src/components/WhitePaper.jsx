import { useEffect, useState } from "react";
import { BookOpen, Sparkles, ListChecks, FlaskConical, Play, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { runProjection, runMonteCarlo } from "@/lib/api";

const REFS = [
  { n: 1, text: "Cook, K. A., Meyer, W., & Reichenstein, W. (2015). Tax-Efficient Withdrawal Strategies. Financial Analysts Journal, 71(2), 16–29.", url: "https://ideas.repec.org/a/taf/ufajxx/v71y2015i2p16-29.html" },
  { n: 2, text: "Reichenstein, W., & Meyer, W. (2020). Tax-Efficient Withdrawal Strategies. Financial Planning Association.", url: "https://www.financialplanningassociation.org/sites/default/files/2020-09/Feb2020_Research_Reichenstein.pdf" },
  { n: 3, text: "Kitces, M. (2023). The Arithmetic of Roth Conversions (pay the tax from high-basis outside funds; step-up caveat). Journal of Financial Planning.", url: "https://www.financialplanningassociation.org/learning/publications/journal/MAY23-arithmetic-roth-conversions-OPEN" },
  { n: 4, text: "26 U.S. Code §1014 — Basis of property acquired from a decedent (incl. §1014(b)(6) community-property 100% step-up; §1014(c) exclusion of income in respect of a decedent such as IRAs). Cornell Legal Information Institute.", url: "https://www.law.cornell.edu/uscode/text/26/1014" },
  { n: 5, text: "SECURE Act of 2019, 10-year rule for most non-spouse beneficiaries; inherited traditional IRA distributions taxed as ordinary income. IRS, Retirement Topics — Beneficiary.", url: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-beneficiary" },
  { n: 6, text: "IRS, Topic No. 409, Capital Gains and Losses — long-term capital gains and qualified dividends taxed at 0/15/20%.", url: "https://www.irs.gov/taxtopics/tc409" },
  { n: 7, text: "IRS, Questions and Answers on the Net Investment Income Tax (3.8% on net investment income above MAGI thresholds).", url: "https://www.irs.gov/newsroom/questions-and-answers-on-the-net-investment-income-tax" },
  { n: 8, text: "One Big Beautiful Bill Act of 2025 — permanence and continued inflation indexing of the TCJA individual brackets and standard deduction. (Tax Foundation / Tax Policy Center analyses.)", url: null },
  { n: 9, text: "Vanguard. Roth conversions could offer more value than your clients expect.", url: "https://advisors.vanguard.com/insights/article/roth-conversions-could-offer-more-value-than-your-clients-expect" },
  { n: 10, text: "Fidelity. Tax diversification and Roth conversions (illustrative custodian guidance).", url: "https://www.fidelity.com/learning-center/personal-finance/tax-diversification-roth-conversion" },
  { n: 11, text: "IRS, IRA FAQs — Recharacterization of IRA Contributions. Roth-conversion recharacterization repealed for tax years beginning after 2017 (TCJA; IRC §408A(d)(6)(B)(iii)).", url: "https://www.irs.gov/retirement-plans/ira-faqs-recharacterization-of-ira-contributions" },
];

// tiny superscript footnote marker
const Fn = ({ n }) => <sup className="text-[#4A6741] font-semibold text-[0.7em] ml-0.5">{n}</sup>;

const H2 = ({ children }) => (
  <h2 className="font-display text-xl font-bold tracking-tight text-[#1A1A1A] mt-10 mb-3">{children}</h2>
);
const H3 = ({ children }) => (
  <h3 className="font-display text-base font-bold tracking-tight text-[#4A6741] mt-6 mb-2">{children}</h3>
);
const P = ({ children }) => <p className="text-[15px] leading-7 text-[#2A2A2A] mb-4">{children}</p>;

// compact results table (first column left-aligned, rest right-aligned)
const Tbl = ({ head, rows, testid, note }) => (
  <div className="my-4" data-testid={testid}>
    <div className="overflow-x-auto rounded-lg border border-[#EBE8E0]">
      <table className="w-full text-[13px]">
        <thead className="bg-[#F9F8F6] text-[11px] text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-[#EBE8E0]">
              {r.map((c, ci) => (
                <td key={ci} className={`px-3 py-1.5 ${ci === 0 ? "text-left" : "text-right"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {note && <p className="text-[11px] italic text-muted-foreground mt-1.5">{note}</p>}
  </div>
);
const W = ({ children }) => <span className="font-bold text-[#4A6741]">{children}</span>; // winning cell

const fmtM = (v) => (v == null ? "—" : `$${(v / 1e6).toFixed(2)}M`);
const fmtPc = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const TAXABLE_FIRST = "Cash → Taxable → IRA → Roth";
const IRA_FIRST = "Cash → IRA → Taxable → Roth";
// The paper's five strategies, expressed as overrides on the reader's own plan:
// only conversion enablement/target and the funding order change — everything else is theirs.
const CASE_DEFS = [
  { key: "A", label: "A. No conversions", mut: (c) => { c.roth = { ...c.roth, enabled: false }; } },
  { key: "B", label: "B. Convert to 24% · spend taxable first", mut: (c) => { c.roth = { ...c.roth, enabled: true, target_bracket: 0.24 }; c.withdrawal = { ...c.withdrawal, funding_order: TAXABLE_FIRST }; } },
  { key: "C", label: "C. Convert to 24% · spend IRA first", mut: (c) => { c.roth = { ...c.roth, enabled: true, target_bracket: 0.24 }; c.withdrawal = { ...c.withdrawal, funding_order: IRA_FIRST }; } },
  { key: "D", label: "D. Convert to 32% · spend taxable first", mut: (c) => { c.roth = { ...c.roth, enabled: true, target_bracket: 0.32 }; c.withdrawal = { ...c.withdrawal, funding_order: TAXABLE_FIRST }; } },
  { key: "E", label: "E. Convert to 35% · spend taxable first", mut: (c) => { c.roth = { ...c.roth, enabled: true, target_bracket: 0.35 }; c.withdrawal = { ...c.withdrawal, funding_order: TAXABLE_FIRST }; } },
];
const caseConfig = (scenario, def, realized) => {
  const c = JSON.parse(JSON.stringify(scenario));
  def.mut(c);
  c.legacy = { ...(c.legacy || {}), heir_gains_realized: realized };
  return c;
};

// "run live" control row shown above each results table (app view only, never in print)
const RunRow = ({ onRun, running, isLive, onRevert, testid, label }) => (
  <div className="flex flex-wrap items-center gap-3 mt-3 -mb-1">
    <Button size="sm" variant="outline" onClick={onRun} disabled={running} data-testid={testid}
      className="gap-1.5 rounded-full border-[#4A6741]/40 text-[#4A6741] hover:bg-[#4A6741]/10 hover:text-[#3B5234] h-7 text-xs">
      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      {running ? "Running on your plan…" : label}
    </Button>
    {isLive && (
      <>
        <span className="inline-flex items-center rounded-full bg-[#4A6741] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white" data-testid={`${testid}-live-badge`}>
          YOUR PLAN · LIVE
        </span>
        <button onClick={onRevert} data-testid={`${testid}-revert`}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-[#1A1A1A]">
          <Undo2 className="h-3 w-3" /> Show published base case
        </button>
      </>
    )}
  </div>
);


export const WhitePaper = ({ print = false, scenario = null }) => {
  const [live, setLive] = useState(null);       // per-strategy deterministic results
  const [liveMc, setLiveMc] = useState(null);   // { t24, t32 } Monte Carlo results
  const [runningCases, setRunningCases] = useState(false);
  const [runningMc, setRunningMc] = useState(false);

  // editing the plan invalidates previous live runs
  const scenarioSig = scenario ? JSON.stringify(scenario) : "";
  useEffect(() => { setLive(null); setLiveMc(null); }, [scenarioSig]);

  const runCases = async () => {
    if (!scenario || runningCases) return;
    setRunningCases(true);
    try {
      // each strategy is run under both realization bounds (10 projections total)
      const runs = await Promise.all(
        CASE_DEFS.flatMap((d) => [
          runProjection(caseConfig(scenario, d, true)),
          runProjection(caseConfig(scenario, d, false)),
        ])
      );
      const out = {};
      CASE_DEFS.forEach((d, i) => {
        const realized = runs[i * 2], never = runs[i * 2 + 1];
        out[d.key] = {
          converted: realized.summary.total_roth_converted,
          endIra: realized.summary.ending_traditional,
          endRoth: realized.summary.ending_roth,
          lifetimeTaxes: realized.summary.lifetime_taxes,
          heirIraTax: realized.legacy.inherited_ira_tax,
          atDeath: realized.legacy.after_tax_estate_at_death,
          plus10Realized: realized.legacy.after_tax_estate_to_heirs,
          plus10Never: never.legacy.after_tax_estate_to_heirs,
        };
      });
      setLive(out);
      toast.success("§5 tables recomputed live from your current plan.");
    } catch (e) {
      console.error("whitepaper live case runs failed", e);
      toast.error("Could not run the five strategies on your plan (rate limit or server error). Try again in a minute.");
    } finally {
      setRunningCases(false);
    }
  };

  const runMc = async () => {
    if (!scenario || runningMc) return;
    setRunningMc(true);
    try {
      const [r24, r32] = await Promise.all([
        runMonteCarlo(caseConfig(scenario, CASE_DEFS[1], false), { n_trials: 1000, seed: 42 }),
        runMonteCarlo(caseConfig(scenario, CASE_DEFS[3], false), { n_trials: 1000, seed: 42 }),
      ]);
      const pick = (r) => ({ success: r.with_conversions.success, ...r.with_conversions.ending });
      setLiveMc({ t24: pick(r24), t32: pick(r32) });
      toast.success("Monte Carlo comparison recomputed from your plan (1,000 seed-matched trials each).");
    } catch (e) {
      console.error("whitepaper live MC failed", e);
      toast.error("Monte Carlo run failed or timed out. Try again shortly.");
    } finally {
      setRunningMc(false);
    }
  };

  const liveBest = live && {
    plus10: Math.max(...CASE_DEFS.map((d) => live[d.key].plus10Realized)),
    atDeath: Math.max(...CASE_DEFS.map((d) => live[d.key].atDeath)),
    never: Math.max(...CASE_DEFS.map((d) => live[d.key].plus10Never)),
  };

  return (
    <div className={print ? "whitepaper-print-block" : ""} data-testid={print ? "whitepaper-print" : "whitepaper"}>
      <article className={print ? "max-w-none" : "max-w-3xl mx-auto"}>
        {/* Title block */}
        <header className="border-b border-[#EBE8E0] pb-6 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4A6741]/30 bg-[#4A6741]/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#4A6741]">
              <BookOpen className="h-3 w-3" /> White Paper · Second Edition
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-[#1A1A1A]" data-testid="whitepaper-title">
            Why Simplified Roth-Conversion Calculators Get the Funding Decision Wrong
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Preferential Income, the Step-Up in Basis, and What the Model Actually Shows: The Conversion Is First-Order,
            the Ceiling Is the Heirs&apos; Rate — the Rest Is Sensitivity
          </p>
          <p className="mt-3 text-xs italic text-muted-foreground max-w-2xl">
            Second edition. A white paper of the Roth Conversion &amp; Retirement Planner. Educational analysis, not tax or legal
            advice. Figures should be verified against current IRS tables. Assumes current federal law following the One Big
            Beautiful Bill Act of 2025 (OBBBA), which made the TCJA individual brackets permanent and inflation-indexed.
          </p>
        </header>

        {/* Plain-English summary box */}
        <div className="my-6 rounded-xl border border-[#C87941]/30 bg-[#C87941]/5 p-5" data-testid="whitepaper-summary">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-[#C87941]" />
            <p className="label-cap text-[11px] text-[#C87941]">In plain English</p>
          </div>
          <p className="text-[15px] leading-7 text-[#2A2A2A]">
            Free online Roth calculators ask two questions — your tax rate now versus later — then nudge you to convert
            aggressively and pay the tax by selling brokerage investments. This edition goes further than arguing with them:
            we ran the full decision through this planner&apos;s own tax engine. Three lessons came out:
          </p>
          <ul className="mt-3 space-y-2 text-[15px] leading-7 text-[#2A2A2A]">
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">1.</span><span><span className="font-semibold">Converting is the decision.</span> A bracket-managed program left the heirs 7–16% more after taxes, erased a <span className="font-semibold">$5.6M tax bill</span> on the inherited IRA, and cut the couple&apos;s own lifetime taxes nearly in half.</span></li>
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">2.</span><span><span className="font-semibold">Convert at the lowest bracket that empties the IRA within your window</span> — and never above your children&apos;s rate. Higher brackets only pay when a deadline (late start, health, a surviving spouse&apos;s single-filer brackets) compresses the runway.</span></li>
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">3.</span><span><span className="font-semibold">Which account you spend from matters far less than advertised</span> (≤1.8%) — and the winner flips depending on whether your heirs ever sell what they inherit. The step-up is real, but it&apos;s a snapshot; the Roth protects the future.</span></li>
          </ul>
        </div>

        {/* What changed in this edition */}
        <div className="my-6 rounded-xl border border-[#7A9B76]/40 bg-[#7A9B76]/10 p-5" data-testid="whitepaper-changes">
          <div className="flex items-center gap-2 mb-2">
            <FlaskConical className="h-4 w-4 text-[#4A6741]" />
            <p className="label-cap text-[11px] text-[#4A6741]">What changed in this edition</p>
          </div>
          <ol className="space-y-2 text-sm leading-6 text-[#2A2A2A] list-decimal pl-5">
            <li><span className="font-semibold">A new empirical section (§5)</span> reports full model runs on a representative $13M household — disciplined by two sensitivity analyses (§5.5 heir-realization behavior, §5.7 market risk).</li>
            <li><span className="font-semibold">The conversion policy is the first-order decision, and the only robust one:</span> +$20.1M (+15.9%) to heirs under full realization, +$9.7M (+6.9%) even if heirs never realize a gain.</li>
            <li><span className="font-semibold">The funding-order recommendation is demoted — twice.</span> Taxable-first won the ten-year metric; the verdict flipped back under never-realized gains. A ≤1.8% lever whose sign depends on the heirs&apos; behavior is a preference, not a rule.</li>
            <li><span className="font-semibold">The step-up is a snapshot; the Roth is permanent</span> — and the planner now exposes the pivotal assumption as a Heir-realization toggle, defaulting to <em>never realized</em>.</li>
            <li><span className="font-semibold">The measurement horizon changes the answer:</span> at-death rankings and ten-year rankings disagree.</li>
            <li><span className="font-semibold">The conversion window, not ambition, sets the right bracket.</span> With a full runway, 24% beats 32% under both realization assumptions; only a deadline justifies climbing toward the heirs&apos; rate.</li>
            <li><span className="font-semibold">A Monte Carlo risk analysis:</span> converting at the heirs&apos; rate doesn&apos;t raise ruin risk — but with a full runway it buys nothing while front-loading irreversible tax payments.</li>
          </ol>
        </div>

        {/* Formal paper */}
        <H2>Executive Summary</H2>
        <P>
          The most widely distributed retirement-planning tools — including the free Roth-conversion calculators offered by large
          custodians such as Fidelity and Schwab — reduce a genuinely multi-dimensional decision to a single comparison: the
          retiree&apos;s current marginal tax rate versus an assumed future marginal rate. That simplification systematically biases
          the recommendation and hides the levers that actually move family wealth.
        </P>
        <P>
          This paper argues, on the basis of the Internal Revenue Code, IRS guidance, peer-reviewed and practitioner research,
          <span className="font-semibold"> and full simulations from the planner&apos;s own tax engine</span>, that the single-rate framing is structurally flawed
          in three ways. It (1) conflates ordinary income with preferentially-taxed qualified-dividend and long-term-capital-gain
          (LTCG) income; (2) ignores the §1014 step-up in basis and — equally important — mis-weights it, because the step-up
          shields only pre-death appreciation; and (3) cannot see that a household&apos;s <em>spending withdrawals</em> and its <em>Roth
          conversions</em> compete for the same ordinary-income bracket headroom each year.
        </P>
        <P>
          Correctly framed, the key variable is <span className="font-semibold">not</span> &ldquo;the retiree&apos;s current vs. future rate.&rdquo; It is whether the
          <span className="font-semibold"> family pays the ordinary-income tax embedded in the traditional IRA at the couple&apos;s own controlled, bracket-managed
          rates during their lifetimes, or leaves a large pre-tax IRA to heirs</span> who must empty it within ten years under the SECURE Act —
          frequently during the heirs&apos; peak earning years, stacked on top of their wages at 32–37% marginal rates. In the model&apos;s
          base case, doing nothing left the heirs a <span className="font-semibold">$12.9M IRA carrying a $5.64M income-tax liability</span>; a bracket-managed
          conversion program running the full plan horizon <span className="font-semibold">eliminated that liability entirely</span> and raised what the heirs
          actually keep, ten years after the second death, from <span className="font-semibold">$126.1M to $146.2M (+15.9%)</span>. That gain survives the paper&apos;s
          most contestable assumption: even if the heirs never realize a post-death gain — so the step-up&apos;s shelter extends
          indefinitely — the program still adds <span className="font-semibold">+$9.7M (+6.9%)</span>.
        </P>

        {/* Premises of the analysis */}
        <div className="my-6 rounded-xl border border-[#4A6741]/30 bg-[#4A6741]/5 p-5" data-testid="whitepaper-premises">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks className="h-4 w-4 text-[#4A6741]" />
            <p className="label-cap text-[11px] text-[#4A6741]">Premises of this analysis</p>
          </div>
          <p className="text-[15px] leading-7 text-[#2A2A2A] mb-3">
            <span className="font-semibold">The core premise: parents should pay the tax on their own IRA at controlled rates during their lifetimes,
            rather than leave that liability to children who will pay it at higher rates.</span> Two conditions make this true for most
            successful savers:
          </p>
          <ol className="space-y-3 text-[15px] leading-7 text-[#2A2A2A]">
            <li className="flex gap-2">
              <span className="text-[#4A6741] font-bold shrink-0">1.</span>
              <span>
                <span className="font-semibold">Heirs pay a higher rate than the parents.</span> Successful families&apos; children usually earn at least average
                incomes and inherit the IRA during their own peak earning years (50s–60s). Under the SECURE 10-year rule those
                distributions are taxed as ordinary income on top of their wages — often at <span className="font-semibold">32–37%</span>. The model&apos;s default heirs
                pay a blended <span className="font-semibold">31.65% ordinary rate</span> and <span className="font-semibold">23.45%</span> on dividends and long-term gains.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#4A6741] font-bold shrink-0">2.</span>
              <span>
                <span className="font-semibold">Conventional calculators miss this.</span> The Roth tools from firms like <span className="font-semibold">Fidelity and Schwab</span> don&apos;t
                separate preferential LTCG and qualified-dividend income (0/15/20%) from ordinary IRA income, so they can neither price
                the heirs&apos; liability nor the benefit of managing it — which this planner measures as the after-tax inheritance to heirs
                <span className="font-semibold"> ten years after the second death</span>.
              </span>
            </li>
          </ol>
        </div>

        <H2>1. The Problem: Single-Rate Simplification</H2>
        <P>
          Mainstream consumer Roth-conversion calculators typically ask for two numbers — a current marginal tax rate and an assumed
          future/retirement marginal rate — and then report a break-even. This is useful for building awareness, and it captures the
          first-order insight (convert when your rate today is lower than your expected rate later). But it treats the household&apos;s
          portfolio as a single pre-tax bucket and, in doing so, omits five factors that materially change the answer:
        </P>
        <ul className="list-disc pl-6 space-y-1.5 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li>The <span className="font-semibold">character</span> of income (ordinary vs. preferential).</li>
          <li>The <span className="font-semibold">cost basis</span> of taxable assets and the <span className="font-semibold">§1014 step-up</span> at death.</li>
          <li><span className="font-semibold">Asset location</span> and the source of funds used to pay spending and the conversion tax.</li>
          <li>The <span className="font-semibold">SECURE Act 10-year rule</span> and the tax rate of the <em>heirs</em> who ultimately inherit a pre-tax IRA.</li>
          <li>The <span className="font-semibold">competition for bracket headroom</span>: every dollar of ordinary income spent from the IRA is a dollar that cannot be converted at the same rate that year.</li>
        </ul>
        <P>
          Michael Kitces&apos; detailed &ldquo;arithmetic of Roth conversions&rdquo; analysis shows that simplified break-even framing routinely
          misstates the true benefit precisely because it ignores where the tax is paid from and what that funding source costs.<Fn n={3} />
        </P>

        <H2>2. Three Structural Errors</H2>
        <H3>2.1 Conflating ordinary income with preferential income</H3>
        <P>
          Qualified dividends and long-term capital gains are taxed under a <span className="font-semibold">separate, preferential schedule of 0%, 15%, and 20%</span>,
          stacked <em>on top of</em> ordinary taxable income — not at ordinary rates that reach 37%.<Fn n={6} /> High-income households may also owe
          the <span className="font-semibold">3.8% Net Investment Income Tax</span> on that same investment income.<Fn n={7} /> A model that lumps all income into one
          bucket at one rate mis-prices <em>both</em> sides of the decision.
        </P>
        <P>
          This separation also exposes a channel single-rate tools never see: <span className="font-semibold">a large taxable account is itself a recurring tax
          liability.</span> At the model&apos;s 2% qualified-dividend yield, a $35–45M taxable account throws off $700k–$900k of preferential income
          every year, which is taxed annually, feeds the NIIT, and raises IRMAA surcharges. Part of the measured benefit of conversions is
          simply that assets sheltered in the Roth stop generating this drag. The separation of ordinary income from LTCG/dividend income
          is not a refinement — it is fundamental to pricing the trade-off correctly.
        </P>
        <H3>2.2 Ignoring the §1014 step-up in basis</H3>
        <P>
          Under <span className="font-semibold">IRC §1014</span>, property acquired from a decedent takes a basis equal to its fair market value at the date of death —
          <span className="font-semibold"> permanently eliminating the capital-gains tax on all appreciation during the owner&apos;s lifetime</span>.<Fn n={4} /> In the nine
          community-property states, <span className="font-semibold">§1014(b)(6)</span> steps up <span className="font-semibold">100%</span> of the community property at the first spouse&apos;s death;
          in common-law states, jointly-held property receives a step-up only on the decedent&apos;s half.<Fn n={4} />
        </P>
        <P>
          Crucially, <span className="font-semibold">§1014(c) denies the step-up to &ldquo;income in respect of a decedent,&rdquo; which includes traditional IRAs and 401(k)s.</span><Fn n={4} />
          Retirement accounts carry their deferred ordinary-income tax through to the heirs; taxable brokerage assets do not.
        </P>
        <P>
          But the step-up must be weighed correctly, and the first edition of this paper over-weighted it. <span className="font-semibold">The step-up is a snapshot:
          it erases the gain accrued up to the date of death and nothing after.</span> From the moment of inheritance, the stepped-up taxable account
          resumes generating taxed dividends and accruing gains the heirs will owe LTCG on, while an inherited Roth compounds entirely tax-free
          for the full ten-year SECURE window. Which effect dominates is an empirical question — one the model answers in §5.
        </P>
        <H3>2.3 Missing the bracket-headroom competition between spending and converting</H3>
        <P>
          The correct general rule is well established: <span className="font-semibold">pay the conversion tax from outside funds, not by withholding from the IRA</span>, so
          that 100% of the converted amount lands in the Roth and compounds tax-free.<Fn n={3} /> The literature attaches a caveat — outside funds with
          large unrealized gains trigger LTCG (and possibly NIIT) the step-up would otherwise have erased<Fn n={3} /> — and the first edition of this paper
          elevated that caveat into a rule: preserve the taxable account, spend the IRA.
        </P>
        <P>
          The model reveals what that rule misses. <span className="font-semibold">Spending withdrawals from the IRA and Roth conversions compete for the same
          ordinary-bracket headroom.</span> Every dollar of ordinary income drawn from the IRA to fund living expenses crowds out a dollar of conversion at
          that same controlled rate. Meeting spending from the taxable account instead realizes gains at <span className="font-semibold">preferential</span> rates while freeing
          the <span className="font-semibold">ordinary</span> brackets for conversions: <em>spend the cheap bucket, convert the expensive one.</em> Whether the headroom effect
          ultimately outweighs the forfeited step-up, however, depends on what the heirs do after inheriting — §5 tests both assumptions rather than
          declaring a winner by slogan.
        </P>

        <H2>3. Two Forces Every Conversion Analysis Must Balance</H2>
        <H3>3.1 The case for converting early and aggressively</H3>
        <P>
          The first force favors converting as much as possible, as early in retirement as possible. Dollars moved into a Roth compound
          <span className="font-semibold"> tax-free</span> for the rest of the owners&apos; lives and for the full ten-year window the heirs then hold the account. The
          low-income years between retirement and the onset of Social Security and RMDs are the natural window, deliberately filling the
          22%–24% brackets.<Fn n={1} />
        </P>
        <H3>3.2 The ceiling: the &ldquo;common rate&rdquo; between the couple and their heirs</H3>
        <P>
          The second force sets a ceiling on that enthusiasm. A conversion only creates value when the rate the couple pays today is no
          higher than the rate that would otherwise apply when the money is eventually taxed — for most successful savers, the rate their
          <span className="font-semibold"> heirs</span> will pay. There is therefore an assumed <span className="font-semibold">common rate</span>, and <span className="font-semibold">conversions pushed above it destroy
          value rather than create it.</span> High-earning children in the 32–37% brackets <em>raise</em> the common rate and justify more conversion —
          but only up to it, never above it. §5.5–5.6 show this ceiling emerging from the model itself.
        </P>

        <H2>4. The Correct Framing: Whose Rate Pays the IRA&apos;s Tax?</H2>
        <P>
          A traditional IRA is best understood as a <span className="font-semibold">deferred ordinary-income liability held jointly with the U.S. Treasury.</span> The relevant
          question is <span className="font-semibold">who eventually pays the ordinary tax on those dollars, and at what rate:</span>
        </P>
        <ul className="list-disc pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">The couple, during their lifetimes</span>, converting (or drawing) at <em>controlled, bracket-filled rates</em> in low-income years before Social Security and RMDs;<Fn n={1} /> <span className="font-semibold">or</span></li>
          <li><span className="font-semibold">The heirs</span>, who under the <span className="font-semibold">SECURE Act must fully distribute an inherited traditional IRA within ten years</span>, every dollar taxed as <span className="font-semibold">ordinary income</span> — commonly in their 50s and 60s, stacked on peak-earnings wages at <span className="font-semibold">32%, 35%, or 37%.</span><Fn n={5} /></li>
        </ul>
        <P>
          This is consistent with the peer-reviewed record. Cook, Meyer, and Reichenstein show that early tax-deferred drawdown and Roth
          conversions that fill low brackets can extend portfolio longevity by roughly <span className="font-semibold">two to three years</span> versus the conventional
          &ldquo;spend taxable first&rdquo; ordering.<Fn n={1} /><Fn n={2} /> Vanguard&apos;s advisor research similarly finds the value of well-structured conversions is
          routinely larger than clients expect once bracket management and heirs are considered.<Fn n={9} />
        </P>

        <H2>5. What the Model Shows: An Empirical Case Study</H2>
        <P>
          <em>New in this edition.</em> The planner&apos;s engine — which separates ordinary from preferential income, tracks per-account cost basis,
          applies the §1014 step-up, models IRMAA and the NIIT, and simulates the heirs&apos; 10-year SECURE drawdown at their own rates — was run
          on its representative base household:
        </P>
        <div className="my-4 rounded-lg border-l-4 border-[#4A6741]/40 bg-[#F9F8F6] px-4 py-3 text-[13px] leading-6 text-[#2A2A2A]" data-testid="whitepaper-base-household">
          <span className="font-semibold">Base household.</span> Married couple, ages 61/60 in 2026, planned to ages 91/96 (second death 2062, a 37-year horizon).
          Starting assets ≈ <span className="font-semibold">$13.0M</span>: $1.0M cash, $6.0M taxable brokerage with a $2.0M basis (<span className="font-semibold">67% embedded gain</span>),
          $5.0M traditional IRA, $0 Roth, $1.0M residence. Final wages through 2027, pensions, Social Security claimed 2028/2032. Core spending
          $240k/yr plus medical, inflated 3%. State tax 3.99%; IRMAA modeled. Heirs: <span className="font-semibold">31.65%</span> ordinary, <span className="font-semibold">23.45%</span> dividend/LTCG;
          1% estate settlement; step-up at death; 10-year SECURE horizon. Conversions, when enabled, are bracket-managed and run the full plan
          horizon: each year RMDs come out first and conversions fill the remaining headroom up to the target bracket. Dollar figures are nominal
          model outputs, not present values.
        </div>
        {!print && scenario && (
          <RunRow onRun={runCases} running={runningCases} isLive={!!live} onRevert={() => setLive(null)}
            testid="wp-run-cases" label="Run this table on YOUR plan" />
        )}
        {live ? (
          <Tbl
            testid="whitepaper-case-table"
            head={["Strategy", "Converted", "IRA at 2nd death", "Roth at 2nd death", "Lifetime taxes", "Heir tax on IRA", "At-death estate", "To heirs (+10 yr)"]}
            rows={CASE_DEFS.map((d) => {
              const r = live[d.key];
              return [
                d.label, fmtM(r.converted), fmtM(r.endIra), fmtM(r.endRoth), fmtM(r.lifetimeTaxes), fmtM(r.heirIraTax),
                r.atDeath === liveBest.atDeath ? <W key="d">{fmtM(r.atDeath)}</W> : fmtM(r.atDeath),
                r.plus10Realized === liveBest.plus10 ? <W key="t">{fmtM(r.plus10Realized)}</W> : fmtM(r.plus10Realized),
              ];
            })}
            note="Computed live from your current plan inputs. Each strategy overrides only the conversion enablement/target and the funding order — your ages, income, spending, accounts, taxes, and legacy settings are unchanged. The +10 yr column uses the realized bound; the §5.5 table shows both bounds."
          />
        ) : (
          <Tbl
            testid="whitepaper-case-table"
            head={["Strategy", "Converted", "IRA at 2nd death", "Roth at 2nd death", "Lifetime taxes", "Heir tax on IRA", "At-death estate", "To heirs (+10 yr)"]}
            rows={[
              ["A. No conversions (either order)", "$0", "$12.91M", "$0", "$12.68M", "$5.64M", "$75.29M", "$126.09M"],
              [<span key="b" className="font-semibold">B. Convert to 24% · spend taxable first</span>, "$10.96M", "$0", "$57.09M", "$6.78M", "$0", "$78.18M", <W key="bw">$146.20M</W>],
              ["C. Convert to 24% · spend IRA first", "$7.42M", "$0", "$40.95M", "$7.08M", "$0", <W key="cw">$79.44M</W>, "$143.65M"],
              ["D. Convert to 32% · spend taxable first", "$9.20M", "$0", "$60.93M", "$6.19M", "$0", "$77.01M", "$145.35M"],
              ["E. Convert to 35% · spend taxable first", "$7.22M", "≈$0", "$61.12M", "$5.53M", "$0", "$76.11M", "$143.89M"],
            ]}
            note="A 50/50 split order lands between B and C on the realized ten-year metric: $143.76M. The +10 yr column uses the realized bound; §5.5 re-scores every strategy under never-realized — the planner's default."
          />
        )}

        <H3>5.1 The conversion policy is the first-order lever</H3>
        <P>
          Moving from no conversions (A) to a bracket-managed program (B) raised the heirs&apos; ten-year after-tax inheritance by
          <span className="font-semibold"> +$20.1M (+15.9%)</span> — and, counter to intuition, <em>also cut the household&apos;s own cumulative lifetime taxes from $12.68M
          to $6.78M</em>, because assets sheltered in the Roth stopped generating taxed dividends, taxable RMDs, NIIT, and IRMAA surcharges for
          decades. Doing nothing is the expensive strategy on <span className="font-semibold">both</span> generations&apos; tax bills.
        </P>
        <H3>5.2 The heirs&apos; liability is the headline number</H3>
        <P>
          Unconverted, the IRA compounds to <span className="font-semibold">$12.9M</span> at the second death and — because §1014(c) denies it any step-up — arrives as a
          <span className="font-semibold"> $5.64M ordinary-income tax bill</span> for children already earning at 32%+ rates. Every bracket-managed program in the table
          retires that bill <span className="font-semibold">completely</span>: given the full plan horizon, even the modest 24% target converts the entire IRA — $10.96M of
          cumulative conversions once growth is included — before the second death. This is precisely the transfer of the tax from the heirs&apos;
          31.65% rate to the parents&apos; controlled 24% rate that §4 frames — executed in full, with its dollar value attached.
        </P>
        <H3>5.3 The measurement horizon changes the funding-order answer</H3>
        <P>
          Compare B and C — identical conversion policy, opposite funding order. Ranked <span className="font-semibold">at the date of the second death</span>, the IRA-first
          order (C) wins: $79.44M vs. $78.18M. Ranked <span className="font-semibold">ten years later</span>, after the SECURE drawdown and post-death compounding, the ranking
          <span className="font-semibold"> reverses</span>: taxable-first (B) delivers $146.20M vs. $143.65M, a <span className="font-semibold">+$2.55M (+1.8%)</span> advantage. An at-death snapshot points to
          the wrong funding order. The heirs do not receive a snapshot; they receive ten more years of differentially-taxed compounding. (Whether that
          compounding is ever taxed at all is the subject of §5.5.)
        </P>
        <H3>5.4 Why taxable-first wins under full realization: the step-up is a snapshot, the Roth is permanent</H3>
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Bracket headroom is reallocated from spending to converting.</span> Both orders eventually retire the whole IRA — but in C, roughly $3.5M of IRA dollars exit through <em>spending withdrawals</em> that never reach the Roth, while in B every IRA dollar exits through <em>conversion</em>. Cumulative conversions: <span className="font-semibold">$10.96M vs. $7.42M</span>; Roth at the second death: <span className="font-semibold">$57.1M vs. $41.0M</span>.</li>
          <li><span className="font-semibold">Spending is paid with preferential dollars.</span> Realizing taxable gains for spending costs 15/20% + NIIT — cheaper than the ordinary rates the same spending costs when drawn from the IRA. Lifetime household taxes are <em>lower</em> under taxable-first ($6.78M vs. $7.08M) even though it converts $3.5M more.</li>
          <li><span className="font-semibold">Post-death, the Roth outruns the stepped-up taxable account.</span> The heirs&apos; taxable assets grow net of a 2% qualified-dividend drag at 23.45% and accrue LTCG on post-death appreciation, while the inherited Roth compounds fully tax-free. The Roth-heavy mix (B: 76.1% Roth) finishes ahead of the taxable-heavy mix (C: 55.5%).</li>
        </ol>
        <P>
          The revised principle: <span className="font-semibold">the §1014 step-up erases the past; the Roth protects the future.</span> But the margin (~1.8%) rests entirely
          on an assumption: that the heirs&apos; accrued gains are <em>realized</em> at the end of the horizon. That assumption deserves its own section.
        </P>
        <H3>5.5 Sensitivity: what if the heirs never sell?</H3>
        <P>
          The model can score the heirs&apos; decade either way, and the planner exposes the choice as a <span className="font-semibold">Heir-realization toggle</span> (its
          shipped default: <em>never realized</em>). The realized bound charges the heirs&apos; 23.45% LTCG rate against all post-death appreciation at the
          end of the ten-year horizon — as if the inherited account were liquidated on the last day. That is a conservative bound, not a certainty:
          <span className="font-semibold"> post-death gains are unrealized and may never be realized.</span> Heirs can hold the stepped-up portfolio indefinitely, live on its
          dividends, borrow against it, or hold until their own deaths — when §1014 applies <em>again</em>. Re-scoring every strategy with post-death
          appreciation never taxed (annual dividend taxes still apply) brackets the truth:
        </P>
        {!print && scenario && (
          <RunRow onRun={runCases} running={runningCases} isLive={!!live} onRevert={() => setLive(null)}
            testid="wp-run-realization" label="Run this table on YOUR plan" />
        )}
        {live ? (
          <Tbl
            testid="whitepaper-realization-table"
            head={["Strategy", "Gains realized at +10 yr", "Gains never realized"]}
            rows={CASE_DEFS.map((d) => {
              const r = live[d.key];
              return [
                d.label,
                r.plus10Realized === liveBest.plus10 ? <W key="r">{fmtM(r.plus10Realized)}</W> : fmtM(r.plus10Realized),
                r.plus10Never === liveBest.never ? <W key="n">{fmtM(r.plus10Never)}</W> : fmtM(r.plus10Never),
              ];
            })}
            note="Computed live from your current plan inputs — both realization bounds, same five strategies."
          />
        ) : (
          <Tbl
            testid="whitepaper-realization-table"
            head={["Strategy", "Gains realized at +10 yr", "Gains never realized (default)"]}
            rows={[
              ["A. No conversions", "$126.09M", "$140.57M"],
              ["B. Convert to 24% · spend taxable first", <W key="b">$146.20M</W>, "$150.29M"],
              ["C. Convert to 24% · spend IRA first", "$143.65M", <W key="c">$151.31M</W>],
              ["D. Convert to 32% · spend taxable first", "$145.35M", "$148.41M"],
              ["E. Convert to 35% · spend taxable first", "$143.89M", "$146.72M"],
            ]}
          />
        )}
        <ul className="list-disc pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Survives — convert.</span> +$20.1M (+15.9%) under full realization; +$9.7M (+6.9%) if no gain is ever realized. No-realization flatters the do-nothing strategy most — and it still loses decisively.</li>
          <li><span className="font-semibold">Survives — the heirs&apos; IRA bill.</span> The $5.64M liability is eliminated under every conversion program, under any behavioral assumption: §1014(c) never shelters the IRA.</li>
          <li><span className="font-semibold">Strengthened — 24% beats 32% under both assumptions</span> (+$0.85M realized, +$1.88M never-realized), and 35% trails everywhere. An earlier draft, run with conversions artificially stopped at RMD age, showed 32% winning — §5.6 explains why the <em>deadline</em>, not the bracket, was doing the work.</li>
          <li><span className="font-semibold">Does not survive — the funding order.</span> Taxable-first wins by $2.55M under full realization; IRA-first wins by $1.02M under none. A lever whose sign depends on the heirs&apos; unknowable behavior, with magnitude ≤1.8%, should be chosen on liquidity, simplicity, and basis diversification — not sold as a wealth-maximization rule.</li>
        </ul>
        <H3>5.6 The common-rate ceiling — and the window that decides how close to push it</H3>
        <P>
          Sweeping the conversion target now traces a <em>monotone</em> curve: filling to <span className="font-semibold">24%</span> yields <span className="font-semibold">$146.20M</span> to heirs;
          <span className="font-semibold"> 32%</span> yields $145.35M; <span className="font-semibold">35%</span> yields $143.89M. With the entire plan horizon available — conversions running
          alongside RMDs into the owners&apos; nineties — the 24% program converts the whole IRA anyway, so climbing into higher brackets only prepays
          the same liability at worse rates.
        </P>
        <P>
          The ceiling of §3.2 has not disappeared; it has moved to where it belongs: <span className="font-semibold">the deadline decides the bracket.</span> In a variant run
          that forces conversions to stop at RMD age, the window shrinks to about fourteen years and the ranking inverts — filling toward the heirs&apos;
          ~31.65% rate beats the 24% program ($144.2M vs. $142.4M) because the 24% pace cannot finish the job in time. The operational rule:
          <span className="font-semibold"> convert at the lowest bracket that fully retires the IRA within the window you actually have</span>, and climb toward — never past —
          the heirs&apos; rate only when the window is short: a late start, reduced life expectancy, or the survivor&apos;s imminent single-filer bracket compression.
        </P>
        <H3>5.7 Is converting at the heirs&apos; rate worth the risk?</H3>
        <P>
          Converting to the 32% bracket front-loads real tax dollars: <span className="font-semibold">$902k vs. $689k over the plan&apos;s first five years (+31%)</span>,
          $2.31M vs. $1.75M over ten. Money paid to the Treasury early is a certain cost set against uncertain future growth — and, since the TCJA
          repealed recharacterization, <span className="font-semibold">a Roth conversion cannot be undone</span>.<Fn n={11} /> The natural worry: if markets fall after aggressive
          conversion, the family has prepaid 32% tax on wealth that evaporated. The planner&apos;s Monte Carlo engine puts numbers on that worry —
          1,000 seed-matched trials, so both strategies face <em>identical</em> market paths:
        </P>
        {!print && scenario && (
          <RunRow onRun={runMc} running={runningMc} isLive={!!liveMc} onRevert={() => setLiveMc(null)}
            testid="wp-run-mc" label="Run this table on YOUR plan (≈1 min)" />
        )}
        {liveMc ? (
          <Tbl
            testid="whitepaper-mc-table"
            head={["", "24% target · taxable first", "32% target · taxable first"]}
            rows={[
              ["Plan success (never depleted)", fmtPc(liveMc.t24.success), fmtPc(liveMc.t32.success)],
              ["Ending liquid assets, 5th percentile", fmtM(liveMc.t24.p5), fmtM(liveMc.t32.p5)],
              ["Ending liquid assets, median", fmtM(liveMc.t24.p50), fmtM(liveMc.t32.p50)],
              ["Ending liquid assets, mean", fmtM(liveMc.t24.mean), fmtM(liveMc.t32.mean)],
            ]}
            note="Computed live from your current plan: 1,000 seed-matched trials per strategy — both face identical market paths."
          />
        ) : (
          <Tbl
            testid="whitepaper-mc-table"
            head={["", "24% target", "32% target"]}
            rows={[
              ["Plan success (never depleted)", "98.2%", "98.5%"],
              ["Ending liquid assets, 5th percentile", "$7.25M", "$8.31M"],
              ["Ending liquid assets, median", "$73.49M", "$72.71M"],
              ["Ending liquid assets, mean", "$106.1M", "$104.2M"],
            ]}
          />
        )}
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Ruin risk does not increase.</span> Success is statistically identical and the <em>worst</em> outcomes are marginally better under 32%: prepaying the IRA&apos;s tax shrinks future mandatory outflows — RMDs, dividend drag, IRMAA — precisely in the states where the portfolio is weakest. (These figures are nominal and character-blind — a Roth dollar counts the same as an IRA dollar — so they <em>understate</em> the 32% run&apos;s true after-tax position.)</li>
          <li><span className="font-semibold">But there is nothing to buy.</span> The median path surrenders ~$0.8M, and §5.5–5.6 showed the programmatic 32% target <em>losing</em> deterministically under both realization assumptions once the full conversion runway is used.</li>
        </ol>
        <P>The synthesis is not &ldquo;avoid the 32% bracket&rdquo; — it is <span className="font-semibold">&ldquo;don&apos;t program it&rdquo;:</span></P>
        <ul className="list-disc pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Program the floor; harvest the ceiling opportunistically.</span> Run the standing plan at the comfortable bracket. Convert into the higher band <em>conditionally</em>: in down markets (a bear market is a conversion sale), in unusually low-income years, or as the survivor&apos;s single-filer compression approaches. The planner&apos;s strategy optimizer lands exactly here: its top-ranked policy on this household is &ldquo;Fill 32% pre-Social-Security (2026–27), then 24% after&rdquo; — statistically tied with the pure 24% program.</li>
          <li><span className="font-semibold">A bracket-managed annual program already is the &ldquo;stretched&rdquo; strategy.</span> The 24% plan spreads $11.0M of conversions across the full plan horizon — dollar-cost averaging the tax basis. The 32% plan compresses more of it into the earliest, most sequence-sensitive years.</li>
          <li><span className="font-semibold">Irreversibility favors the lower default.</span> An under-converter can accelerate in any future year; an over-converter can never claw back. When the higher bracket carries no expected edge, the option value of waiting dominates.</li>
        </ul>
        <H3>5.8 Limitations</H3>
        <P>
          These are nominal-dollar results for one household under fixed assumptions. §5.5 and §5.7 bracket the two largest sensitivities — the
          heirs&apos; realization behavior and market risk — but heir tax rates, tax-law drift, state regimes, and longevity remain modeled only as
          fixed inputs. The strategy optimizer and Monte Carlo engine should be run per household rather than assuming this case study generalizes.
        </P>

        <H2>6. Why the Aggressive Front-Load Strategy Wins — And When It Bites Back</H2>
        <P>
          The empirical result of §5 — that the highest-legacy strategy on this household compresses conversions into the
          earliest years at the highest rate the heirs&apos; ceiling permits — feels counter-intuitive. It contradicts the
          folk rule &ldquo;fill 22–24% and stop.&rdquo; Section 6 gives the mechanical reason it happens, and the market-path
          conditions under which it stops working.
        </P>

        <H3>6.1 The three-account exchange rate</H3>
        <P>
          The dollars in the three retirement accounts are <em>not</em> equivalent in &ldquo;post-tax to heirs&rdquo; terms.
          Under the model&apos;s baseline assumptions (§4 heir rate 31.65%, +40% state = ~36% blended), a dollar of principal
          on the day of the second death is worth:
        </P>
        <Tbl
          testid="whitepaper-account-value-table"
          head={["Account", "Post-tax value to heir (per $1 principal)", "Reason"]}
          rows={[
            ["Traditional IRA / 401(k)", "$0.64", "SECURE 10-year ordinary-rate distribution at heir marginal rate ~36%"],
            ["Taxable brokerage (step-up basis)", "$1.00", "§1014 basis reset at death — heir immediately sells with zero gain"],
            ["Roth IRA", "$1.00", "Tax-free forever, no RMDs, ten-year distribution but no tax within"],
          ]}
          note="A $1 Traditional dollar is worth ≈ 56% less to the heir than a $1 Roth dollar. This is the raw arbitrage every conversion is trying to capture."
        />
        <P>
          Converting $1 of Traditional to $1 of Roth <em>increases the heir&apos;s post-tax value by ~56%</em> — before
          considering compounding, before considering the tax on the conversion itself, and before considering the survivor
          filing-status compression. That single fact makes the &ldquo;fill only 24%&rdquo; heuristic wrong on any horizon
          long enough for the heir&apos;s ordinary-rate distribution to matter — which is all of them.
        </P>

        <H3>6.2 The compounding spread between Roth and Taxable</H3>
        <P>
          Filling the low bracket and letting the IRA grow feels efficient, but it silently accepts a second, larger loss:
          the dollars <em>never converted</em> spend the remaining plan horizon in an account that grows more slowly than
          the Roth. Under the model&apos;s defaults, taxable brokerage returns roughly 7% gross but is docked ~2 pp/year for
          qualified-dividend tax plus the 3.8% NIIT — a real net-of-tax growth rate of ~5%. Roth compounds at the full 7%
          forever.
        </P>
        <P>
          Over a 30-year retirement plus the heirs&apos; 10-year SECURE distribution window (a typical 40-year horizon
          for a 65-year-old couple), the spread compounds to
          <span className="font-semibold"> (1.05/1.07)<sup>40</sup> ≈ 0.475</span>. Expressed another way: <em>every dollar
          left in the taxable bracket-drag pool at year zero is worth roughly 47.5 cents of a dollar left in Roth by the
          end of the horizon</em>. The exchange rate of &ldquo;pay the conversion tax now to escape 40 years of drag&rdquo;
          is generous by any reasonable discount rate.
        </P>
        <P>
          Formally, converting $1 today at marginal rate <em>m_now</em>, financing the tax bill from taxable, yields a net
          incremental heir gain of
        </P>
        <p className="text-center italic text-[15px] text-[#1A1A1A] my-4 leading-7">
          Δ<sub>heir</sub>&nbsp;=&nbsp;(1+r)<sup>n</sup>&nbsp;×&nbsp;m<sub>heir</sub>&nbsp;−&nbsp;(1+r<sub>tax</sub>)<sup>n</sup>&nbsp;×&nbsp;m<sub>now</sub>
        </p>
        <P>
          which is positive whenever <span className="font-semibold">m<sub>now</sub> &lt; m<sub>heir</sub> ×
          ((1+r)/(1+r<sub>tax</sub>))<sup>n</sup></span>. At n = 30, r = 7%, r<sub>tax</sub> = 5%, m<sub>heir</sub> = 36%,
          the break-even conversion rate is <span className="font-semibold">~65%</span> — meaningfully above the top
          statutory federal ordinary bracket. The result is not fragile: even a conservative 15-year horizon puts
          break-even at ~48%. The math tolerates a great deal of assumption error before the recommendation flips.
        </P>

        <H3>6.3 The pre-Social-Security window is a compounding accelerator</H3>
        <P>
          The engine&apos;s preferred aggressive strategy (&ldquo;Fill 37% pre-SS 2026–2027, then 24% after&rdquo;)
          exploits the specific structural feature of the household&apos;s early plan years: <em>Social Security is not
          yet claimed, RMDs have not begun, and taxable dividend income is the primary ordinary line</em>. Two years of
          37%-bracket-filling here converts roughly $2.2M into Roth — where it compounds tax-free for the next 45 years
          of the +10-yr horizon (client mortality year 2056 + 10 = 2066; plan end 2072 for the surviving spouse&apos;s
          heirs). At 7% for 45 years, each converted dollar grows 21.0×. Each corresponding dollar left in the taxable
          drag pool over that same period grows (1.05)<sup>45</sup> = 9.0×. The <em>ratio</em> of tax-free Roth
          compounding to net-of-drag taxable compounding over this horizon is <span className="font-semibold">21.0 /
          9.0 ≈ 2.33×</span>. This is the multiplier the strategy sweep is capturing.
        </P>

        <H3>6.4 Why the ranking is stable but not the numbers</H3>
        <P>
          The formal condition above is a function of five parameters — n, r, r<sub>tax</sub>, m<sub>now</sub>,
          m<sub>heir</sub>. In the shipped 24% base case with a 36%-blended heir rate and a 40-year horizon, the
          aggressive front-load wins comfortably; if either the heir rate falls below ~24% or the horizon shrinks
          below ~10 years, the ranking flattens and the &ldquo;fill 24%&rdquo; heuristic re-emerges as a defensible
          answer. The <em>direction</em> of the recommendation is robust for retirees with (a) large tax-deferred
          balances, (b) heirs in higher brackets than themselves, and (c) 25+ year horizons — which describes essentially
          every high-net-worth planning case this tool exists to solve.
        </P>

        <H3>6.5 The risk this analysis ignores: sequence-of-returns and mean reversion</H3>
        <blockquote className="border-l-4 border-[#C87941] bg-[#C87941]/5 pl-4 pr-3 py-3 my-4 italic text-[15px] text-[#1A1A1A] font-medium leading-7">
          &ldquo;Never pay taxes early because an assumption produces a better result. Taxes are real; assumptions are hypothetical.&rdquo;
        </blockquote>
        <P>
          The section-6.2 arithmetic uses the household&apos;s assumed real returns as certain — 7% on equity-heavy IRA
          and Roth, 5% net on taxable. Two market realities can invalidate the assumed exchange rate <em>during the plan</em>:
        </P>
        <ol className="list-decimal pl-6 space-y-3 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li>
            <span className="font-semibold">Sequence-of-returns risk in the early conversion years.</span> If markets fall
            15–30% shortly after aggressively converting at 32–37%, the family has prepaid a large real tax bill on shares
            that no longer exist at anywhere near the pre-conversion valuation. Because the conversion tax is <em>final</em>
            (TCJA repealed recharacterization for tax years after 2017 — IRC §408A(d)(6)(B)(iii)<Fn n={11} />), the
            over-conversion cannot be unwound. The <em>Roth still recovers</em> when markets do — but the &ldquo;free
            option&rdquo; of waiting to see the market path before committing is spent, permanently.
          </li>
          <li>
            <span className="font-semibold">Mean reversion around a long-term ~8% nominal average.</span> Long-run
            equity returns have averaged roughly 8% nominal, 6–7% real, since 1927 — but the distribution around that
            average is heavy-tailed and clumpy. A decade of above-trend returns (2010–2020) is often followed by a decade
            of below-trend returns as valuations normalize. The aggressive strategy&apos;s calculated edge is largest
            when it&apos;s <em>compounded</em> on above-trend growth in the conversion years; if the years right after
            the conversion deliver mean-reversion (below-trend returns), the calculated median outperformance shrinks
            or reverses on realized paths.
          </li>
        </ol>
        <P>
          The Monte Carlo results in §5.7 quantify how much room the aggressive strategy has under stochastic returns.
          On the shipped household, 1,000 seed-matched trials show the aggressive plan&apos;s <em>ruin probability
          does not increase</em> — prepaying the IRA&apos;s tax shrinks the future forced-outflow (RMD + IRMAA + dividend
          drag) precisely in the states where the portfolio is weakest, so the 5th-percentile ending liquid asset value
          is actually marginally <em>better</em>. But this is not a general result. Households with lower Taxable
          buffers relative to conversion tax, or heirs whose brackets are close to the parents&apos;, will see a
          different Monte Carlo picture. The strategy optimizer&apos;s deterministic ranking should always be
          re-run through Monte Carlo on your own plan before committing to a phased front-load.
        </P>

        <H3>6.6 The practical synthesis</H3>
        <P>
          The engine&apos;s finding — &ldquo;convert aggressively while the heir rate is materially above your own and
          the horizon is long&rdquo; — is defensible on the deterministic math and reasonably robust to stochastic
          returns. Its <em>implementation</em> should still respect the four disciplines from §5.7:
        </P>
        <ul className="list-disc pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Phase, don&apos;t bullet.</span> Two or three years of aggressive conversion, dollar-cost-averaging the tax basis, dominates one heroic year in the presence of any return uncertainty.</li>
          <li><span className="font-semibold">Convert opportunistically in bear markets.</span> A 25% drawdown effectively puts every dollar of Roth conversion on 25% sale — the tax is fixed on the current-year balance, but the shares are cheap, and when they recover the recovery is inside the Roth.</li>
          <li><span className="font-semibold">Program the floor, harvest the ceiling.</span> Set the standing plan at the conservative bracket (24%) and let the higher-bracket harvest happen conditionally — narrow windows, low-income years, pre-SS pre-RMD gaps.</li>
          <li><span className="font-semibold">Irreversibility asymmetry.</span> An under-converter can always accelerate later; an over-converter can never claw back. When two strategies score statistically close, the option value of waiting favors the lower default.</li>
        </ul>
        <P>
          The strategy sweep&apos;s deterministic top result should be read as an upper bound on the front-load argument
          under your own assumptions — a ceiling to price against, not a floor to commit to. The rest of the app — Monte
          Carlo, phased schedules in the sweep itself, the &ldquo;Reset to defaults&rdquo; sandbox for stress-testing —
          exists so this ceiling can be pressure-tested before it becomes an irreversible tax payment.
        </P>
        <P>
          The disciplining principle behind every one of these guardrails is the same: <span className="font-semibold italic">never pay
          taxes early because an assumption produces a better result</span>. Taxes are real dollars written to the
          Treasury and irrecoverable; assumptions are hypothetical parameters carried by a spreadsheet. When the
          deterministic model and the Monte Carlo agree that an aggressive front-load survives 5th-percentile paths,
          the discount to the deterministic answer is small; when they disagree, the discount is whatever it takes
          to sleep well through the next bear market.
        </P>

        <H2>7. What a Defensible Model Must Do</H2>
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Separate ordinary income from preferential income</span>, stacking qualified dividends and LTCG at 0/15/20% plus the 3.8% NIIT, exactly as the Code does.<Fn n={6} /><Fn n={7} /></li>
          <li><span className="font-semibold">Track cost basis per account</span> and apply the <span className="font-semibold">§1014 step-up at death</span> — while correctly denying any step-up to IRAs (IRD).<Fn n={4} /></li>
          <li><span className="font-semibold">Model spending withdrawals and conversions as competitors for the same bracket headroom</span>, and let the planner choose the funding order for both spending and the conversion tax.</li>
          <li><span className="font-semibold">Model the SECURE 10-year drawdown at the heirs&apos; ordinary rate — and the post-death taxation of the heirs&apos; dividends and capital gains at their preferential rates</span> — then measure the after-tax value to heirs at the <span className="font-semibold">end</span> of that window, not at the date of death.<Fn n={5} /></li>
          <li><span className="font-semibold">Assume current law</span> — the OBBBA-2025 permanent, inflation-indexed TCJA brackets — rather than a lapsed sunset.<Fn n={8} /></li>
        </ol>

        <H2>8. Conclusion</H2>
        <P>
          Simplified, single-rate Roth-conversion calculators are a reasonable first screen, but they are not a planning engine. The model&apos;s own
          runs sharpen the first edition&apos;s doctrine into three ranked, quantified rules:
        </P>
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Convert — this is the decision.</span> +15.9% to heirs under the realized bound and +6.9% even if the heirs never realize a post-death gain; the heirs&apos; $5.64M IRA tax bill eliminated outright; the household&apos;s own lifetime taxes cut from $12.68M to $6.78M. This conclusion survived every assumption tested.</li>
          <li><span className="font-semibold">The window picks the bracket; the heirs&apos; rate caps it.</span> With a full runway, the lowest bracket that retires the whole IRA dominates. Higher targets earn their keep only when a deadline compresses the window — and never above the heirs&apos; rate. Monte Carlo shows no ruin-risk penalty in either direction: program the floor, convert into the higher band opportunistically.</li>
          <li><span className="font-semibold">Treat the funding order and the step-up as preferences, not theorems.</span> The ≤1.8% funding-order gap flips sign with the heirs&apos; realization behavior. The step-up remains a powerful reason never to <em>gratuitously</em> realize gains — but it is a snapshot, not a talisman, and it is never a reason to leave the IRA&apos;s ordinary-income liability to children in their peak earning years.</li>
        </ol>
        <P>That is the decision this planner is built to model honestly — and, as of this edition, to measure.</P>

        {/* References */}
        <H2>References</H2>
        <ol className="space-y-2.5 mb-2" data-testid="whitepaper-references">
          {REFS.map((r) => (
            <li key={r.n} className="text-xs leading-6 text-muted-foreground flex gap-2">
              <span className="text-[#4A6741] font-semibold shrink-0">{r.n}.</span>
              <span>
                {r.text}{" "}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[#4A6741] underline decoration-dotted underline-offset-2 break-all hover:text-[#3B5234]">
                    {r.url}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ol>
      </article>
    </div>
  );
};
