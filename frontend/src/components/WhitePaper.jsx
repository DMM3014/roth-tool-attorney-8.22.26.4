import { useEffect, useState } from "react";
import { BookOpen, Sparkles, ListChecks, Play, Loader2, Undo2, HeartPulse, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { runProjection, runMonteCarlo } from "@/lib/api";
import { downloadElementAsPdf } from "@/lib/pdf";

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
  { n: 12, text: "Kitces, M. (2019). Navigating the Capital Gains Bump Zone: When Ordinary Income Crowds Out Favorable Capital Gains Rates. Nerd's Eye View, Kitces.com.", url: "https://www.kitces.com/blog/long-term-capital-gains-bump-zone-higher-marginal-tax-rate-phase-in-0-rate/" },
  { n: 13, text: "Kitces, M. (2016). Tax-Efficient Spending Strategies From Retirement Portfolios. Nerd's Eye View, Kitces.com.", url: "https://www.kitces.com/blog/tax-efficient-retirement-withdrawal-strategies-to-fund-retirement-spending-needs/" },
  { n: 14, text: "Geisler, G., Harden, B., & Hulse, D. S. (2021). A Comparison of the Tax Efficiency of Decumulation Strategies. Journal of Financial Planning, 34(3), 72–89.", url: "https://www.financialplanningassociation.org/article/journal/MAR21-comparison-tax-efficiency-decumulation-strategies" },
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
              <th key={h} className={`px-3 py-2 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r[0] ?? `row-${ri}`} className="border-t border-[#EBE8E0]">
              {r.map((c, ci) => (
                <td key={`${ri}-${ci}`} className={`px-3 py-1.5 ${ci === 0 ? "text-left" : "text-right"}`}>{c}</td>
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
// Published Monte Carlo assumptions = the app's current default allocation
const MC_ASSETS = {
  stocks: { weight: 0.65, mean: 0.08, vol: 0.18 },
  bonds: { weight: 0.25, mean: 0.04, vol: 0.06 },
  cash: { weight: 0.10, mean: 0.03, vol: 0.01 },
};
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
        runMonteCarlo(caseConfig(scenario, CASE_DEFS[1], false), { n_trials: 1000, seed: 42, assets: MC_ASSETS }),
        runMonteCarlo(caseConfig(scenario, CASE_DEFS[3], false), { n_trials: 1000, seed: 42, assets: MC_ASSETS }),
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

  // ---- PDF download ----
  // Emergent's preview iframe blocks the native print dialog, so we use
  // html2pdf.js (html2canvas → jsPDF) which produces a real PDF file download
  // with no modal involved. The body class keeps our existing @media print
  // rules effective while html2canvas rasterizes the article.
  const [downloading, setDownloading] = useState(false);
  const doPrint = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadElementAsPdf({
        target: ".whitepaper-standalone",
        filename: "roth-conversion-white-paper.pdf",
        bodyClass: "print-whitepaper-standalone",
        format: "a4",
        orientation: "portrait",
        marginMm: 12,
      });
    } catch (e) {
      console.error("White Paper PDF export failed", e);
      toast.error("PDF download failed. Try again or use Ctrl/Cmd+P as a fallback.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={print ? "whitepaper-print-block" : "whitepaper-standalone"} data-testid={print ? "whitepaper-print" : "whitepaper"}>
      <article className={print ? "max-w-none" : "max-w-3xl mx-auto"}>
        {/* Title block */}
        <header className="border-b border-[#EBE8E0] pb-6 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4A6741]/30 bg-[#4A6741]/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#4A6741]">
              <BookOpen className="h-3 w-3" /> White Paper
            </span>
            {!print && (
              <Button
                size="sm"
                variant="outline"
                onClick={doPrint}
                disabled={downloading}
                data-testid="whitepaper-download-pdf"
                className="no-print ml-auto gap-1.5 rounded-full border-[#4A6741]/40 text-[#4A6741] hover:bg-[#4A6741]/10 hover:text-[#3B5234] h-7 text-xs"
                title="Download the White Paper as a PDF file."
              >
                {downloading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
                  : <><Download className="h-3.5 w-3.5" /> Download PDF</>}
              </Button>
            )}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-[#1A1A1A]" data-testid="whitepaper-title">
            The Parents&apos; Rate vs. the Heirs&apos; Rate: Roth Conversions, Longevity, and the Limits of the Step-Up
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Why the Conversion Decision Is First-Order, Funding Order Is a Longevity-Dependent Footnote, and Certain
            Taxes Should Never Be Prepaid on Speculative Returns
          </p>
          <p className="mt-3 text-xs italic text-muted-foreground max-w-2xl">
            A white paper of the Roth Conversion &amp; Retirement Planner. Educational analysis, not tax or legal advice.
            Figures should be verified against current IRS tables. Assumes current federal law following the One Big
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
            Free online Roth calculators ask two questions — your tax rate now versus later — then nudge you toward a
            one-size answer. We ran the full decision through this planner&apos;s own tax engine instead. Three lessons:
          </p>
          <ul className="mt-3 space-y-2 text-[15px] leading-7 text-[#2A2A2A]">
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">1.</span><span><span className="font-semibold">Convert while your rate is below your heirs&apos; rate — that is the decision.</span> On the model&apos;s base household it retires a <span className="font-semibold">$7.98M tax bill</span> on the inherited IRA and leaves the heirs 10–20% more after taxes. And the converse holds with equal force: <span className="font-semibold">if your heirs&apos; rate is below yours, do not convert automatically</span> — the same arithmetic then runs against you.</span></li>
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">2.</span><span><span className="font-semibold">Longevity — not funding order — is the second-order driver, and it is inherently unpredictable.</span> A long life amplifies the conversion payoff and favors funding conversions from taxable assets early; a short one favors preserving the step-up. The funding-order gap itself is small (≤2% on the model&apos;s default assumptions) and its sign flips with lifespan and with what the heirs do after inheriting.</span></li>
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">3.</span><span><span className="font-semibold">Taxes are certain; assumed returns are speculative predictions.</span> Never prepay large, irreversible tax bills at high brackets because a straight-line growth assumption says it works out. Markets do not compound in straight lines — the planner&apos;s own Monte Carlo shows both conversion paces depleting in roughly 1 of 7 simulated market paths.</span></li>
          </ul>
        </div>

        {/* Formal paper */}
        <H2>Executive Summary</H2>
        <P>
          The most widely distributed retirement-planning tools — including the free Roth-conversion calculators offered by large
          custodians — reduce a genuinely multi-dimensional decision to a single comparison: the retiree&apos;s current marginal tax
          rate versus an assumed future marginal rate. That simplification systematically biases the recommendation and hides the
          levers that actually move family wealth.
        </P>
        <P>
          This paper argues, on the basis of the Internal Revenue Code, IRS guidance, peer-reviewed and practitioner research,
          <span className="font-semibold"> and full simulations from the planner&apos;s own tax engine</span>, that the correct organizing question is:
          <span className="font-semibold"> does the family pay the ordinary-income tax embedded in the traditional IRA at the parents&apos; controlled,
          bracket-managed rates during their lifetimes, or at the heirs&apos; rates</span> under the SECURE Act&apos;s compressed 10-year drawdown —
          frequently during the heirs&apos; peak earning years, stacked on top of their wages.<Fn n={5} /> When the parents&apos; achievable
          conversion rate sits below the heirs&apos; assumed rate, converting creates value; when it does not, it destroys value. Everything
          else — which account funds the conversions, how hard to push the brackets, how to weigh the §1014 step-up — is sensitivity
          analysis around that single decision, and the sensitivities turn principally on <span className="font-semibold">longevity</span>, which no one
          can predict.
        </P>
        <P>
          In the model&apos;s base case, doing nothing left the heirs a <span className="font-semibold">$16.0M IRA carrying a $7.98M income-tax
          liability</span>; a bracket-managed conversion program essentially eliminated that liability and raised what the heirs actually
          keep, ten years after the second death, from <span className="font-semibold">$42.8M to $47.2M (+10.2%)</span> under the model&apos;s default
          assumption that heirs never realize post-death gains — and by <span className="font-semibold">+19.8%</span> if they realize everything at the
          end of the SECURE window.
        </P>

        {/* Premises of the analysis */}
        <div className="my-6 rounded-xl border border-[#4A6741]/30 bg-[#4A6741]/5 p-5" data-testid="whitepaper-premises">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks className="h-4 w-4 text-[#4A6741]" />
            <p className="label-cap text-[11px] text-[#4A6741]">Premises of this analysis</p>
          </div>
          <p className="text-[15px] leading-7 text-[#2A2A2A] mb-3">
            <span className="font-semibold">The core premise: proceed with conversions while the parents&apos; tax rate is less than the heirs&apos;
            assumed tax rate — and only then.</span> Two conditions make the premise operative for most successful savers, and one
            caution keeps it honest:
          </p>
          <ol className="space-y-3 text-[15px] leading-7 text-[#2A2A2A]">
            <li className="flex gap-2">
              <span className="text-[#4A6741] font-bold shrink-0">1.</span>
              <span>
                <span className="font-semibold">Heirs typically pay a higher rate than the parents.</span> Successful families&apos; children usually earn at least
                average incomes and inherit the IRA during their own peak earning years (50s–60s). Under the SECURE 10-year rule those
                distributions are taxed as ordinary income on top of their wages.<Fn n={5} /> The model&apos;s default heirs pay a blended
                <span className="font-semibold"> 36% ordinary rate</span> (32% federal + 4% state) and <span className="font-semibold">22.8%</span> on dividends and long-term gains (15% + 3.8% NIIT + 4% state).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#4A6741] font-bold shrink-0">2.</span>
              <span>
                <span className="font-semibold">Conventional calculators cannot see the heirs at all.</span> Tools that don&apos;t separate preferential
                LTCG/qualified-dividend income (0/15/20%) from ordinary IRA income can neither price the heirs&apos; liability nor the benefit
                of managing it — which this planner measures as the after-tax inheritance to heirs <span className="font-semibold">ten years after the
                second death</span>.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#C87941] font-bold shrink-0">⚠</span>
              <span>
                <span className="font-semibold">The premise cuts both ways.</span> If the heirs&apos; assumed rate is <em>below</em> the parents&apos; achievable
                conversion rate — children in modest brackets, charitable beneficiaries (who pay 0% on inherited IRAs), or heirs in
                no-income-tax states — <span className="font-semibold">conversion is not automatic and may destroy value</span>. The rule is a comparison,
                not a slogan.
              </span>
            </li>
          </ol>
        </div>

        <H2>1. The Problem: Single-Rate Simplification</H2>
        <P>
          Mainstream consumer Roth-conversion calculators typically ask for two numbers — a current marginal tax rate and an assumed
          future/retirement marginal rate — and then report a break-even. This is useful for building awareness, and it captures the
          first-order insight (convert when your rate today is lower than the rate the money will eventually face). But it treats the
          household&apos;s portfolio as a single pre-tax bucket and, in doing so, omits five factors that materially change the answer:
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
          liability.</span> At the model&apos;s 1% qualified-dividend yield, a $2M taxable account throws off roughly $20k of preferential income in
          year one — growing as the account compounds — which is taxed annually, feeds the NIIT, and raises IRMAA surcharges. Part of the measured
          benefit of conversions is simply that assets sheltered in the Roth stop generating this drag. The separation of ordinary income from
          LTCG/dividend income is not a refinement — it is fundamental to pricing the trade-off correctly.
        </P>
        <P>
          The stacking mechanics also cut the other way — and create a hidden hazard for conversion sizing. Because preferential income sits
          <em> on top of</em> ordinary income, every additional dollar of ordinary income (an IRA withdrawal, or a Roth conversion) can shove
          long-term gains and qualified dividends across a preferential-rate threshold. Kitces calls this the <span className="font-semibold">capital-gains
          &ldquo;bump zone&rdquo;</span>: a dollar of ordinary income nominally taxed at 12% can carry an effective marginal rate of 27% when it
          drags a dollar of gains from the 0% band into the 15% band — and interactions with Social Security&apos;s taxability phase-in can push
          effective marginal rates near 50%.<Fn n={12} /> A single-rate calculator cannot even represent this; an engine that stacks the two
          schedules the way the Code does prices it automatically.
        </P>
        <H3>2.2 Mis-weighting the §1014 step-up in basis</H3>
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
          But the step-up must be weighed correctly. <span className="font-semibold">The step-up is a snapshot: it erases the gain accrued up to the date of
          death and nothing after.</span> From the moment of inheritance, the stepped-up taxable account resumes generating taxed dividends and
          accruing gains, while an inherited Roth compounds entirely tax-free through the SECURE window. How much the snapshot is worth therefore
          depends on <em>how long the owners live</em> (more years alive = more Roth compounding runway before the snapshot is taken) and on
          <em> what the heirs do</em> with the inherited taxable account afterward. Both are examined empirically in §5.
        </P>
        <H3>2.3 Missing the bracket-headroom competition between spending and converting</H3>
        <P>
          The correct general rule is well established: <span className="font-semibold">pay the conversion tax from outside funds, not by withholding from the IRA</span>, so
          that 100% of the converted amount lands in the Roth and compounds tax-free.<Fn n={3} /> The literature attaches a caveat — outside funds with
          large unrealized gains trigger LTCG (and possibly NIIT) the step-up would otherwise have erased.<Fn n={3} />
        </P>
        <P>
          The model reveals the deeper mechanic behind the rule. <span className="font-semibold">Spending withdrawals from the IRA and Roth conversions compete for the same
          ordinary-bracket headroom.</span> Every dollar of ordinary income drawn from the IRA to fund living expenses crowds out a dollar of conversion at
          that same controlled rate. Meeting spending from the taxable account instead realizes gains at <span className="font-semibold">preferential</span> rates while freeing
          the <span className="font-semibold">ordinary</span> brackets for conversions: <em>spend the cheap bucket, convert the expensive one.</em> This is the practitioner
          playbook Kitces has long recommended — spend the brokerage account while systematically filling the low ordinary brackets with partial
          Roth conversions, precisely because letting the IRA compound untouched builds an RMD problem that forces higher brackets later; in his
          comparisons, the partial-conversion strategy produced more after-tax wealth over 30 years than spend-IRA-first, spend-brokerage-first,
          or an even split.<Fn n={13} /> It is what makes taxable
          assets the natural funding source for an <em>early, larger</em> conversion program — and whether that headroom effect outweighs the forfeited
          step-up depends on longevity and on the heirs&apos; behavior, as §5 shows.
        </P>

        <H2>3. The Decision Rule — and Its Ceiling</H2>
        <H3>3.1 The case for converting early, given time</H3>
        <P>
          The first force favors converting early. Dollars moved into a Roth compound <span className="font-semibold">tax-free</span> for the rest of the owners&apos;
          lives and for the full ten-year window the heirs then hold the account. Given a long life expectancy, this tax-efficient compounding is
          the dominant term: over enough years, the growth sheltered inside the Roth outweighs the tax savings from preserving the step-up on
          taxable assets. The low-income years between retirement and the onset of Social Security and RMDs are the natural window, deliberately
          filling the moderate brackets.<Fn n={1} />
        </P>
        <H3>3.2 The ceiling: never convert above the heirs&apos; rate — and not at all if theirs is lower</H3>
        <P>
          The second force sets a hard ceiling on that enthusiasm. A conversion only creates value when the rate the couple pays today is no
          higher than the rate that would otherwise apply when the money is eventually taxed — for most successful savers, the rate their
          <span className="font-semibold"> heirs</span> will pay. <span className="font-semibold">Conversions pushed above the heirs&apos; rate destroy value rather than create it</span> —
          and if the heirs&apos; assumed rate is at or below the parents&apos; own achievable rate, the correct amount of tax-arbitrage conversion may
          be <span className="font-semibold">zero</span>. High-earning children in the 32–37% brackets <em>raise</em> the ceiling and justify more conversion; modest-earning
          children, charitable beneficiaries, or heirs in no-tax states lower it, sometimes below the parents&apos; floor. The comparison must be made,
          not assumed.
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
          routinely larger than clients expect once bracket management and heirs are considered<Fn n={9} /> — and custodian guidance on tax
          diversification points the same direction.<Fn n={10} /> A <em>Journal of Financial Planning</em> comparison of decumulation strategies
          reaches the same structural conclusion across three nest-egg sizes: client-focused sequencing that accelerates income into the
          low-bracket window before Social Security begins — partial Roth conversions included — extended portfolio life by up to
          <span className="font-semibold"> 11.6%</span> versus the conventional &ldquo;taxable first, IRA second, Roth last&rdquo; ordering and versus
          proportional-withdrawal rules, while deliberately paying <em>more</em> tax in the earliest years to avoid the Social Security
          &ldquo;tax torpedo&rdquo; (up to a 46.25% effective marginal rate) and IRMAA cliffs later.<Fn n={14} />
        </P>

        <H2>5. What the Model Shows: An Empirical Case Study</H2>
        <P>
          The planner&apos;s engine — which separates ordinary from preferential income, tracks per-account cost basis, applies the §1014 step-up,
          models IRMAA and the NIIT, and simulates the heirs&apos; 10-year SECURE drawdown at their own rates — was run on its base household:
        </P>
        <div className="my-4 rounded-lg border-l-4 border-[#4A6741]/40 bg-[#F9F8F6] px-4 py-3 text-[13px] leading-6 text-[#2A2A2A]" data-testid="whitepaper-base-household">
          <span className="font-semibold">Base household.</span> Married couple, ages 61/60 in 2026, planned to ages 85/90 (second death 2056, a 31-year horizon).
          Starting assets ≈ <span className="font-semibold">$9.0M</span>: $500,000 cash, $2.0M taxable brokerage with a $800,000 basis (<span className="font-semibold">67% embedded gain</span>),
          $5.0M traditional IRA, $0 Roth, $1.0M residence. Final wages through mid-2027, pensions, Social Security claimed 2028/2032. Core spending
          $240k/yr plus medical, inflated 3%. Qualified-dividend yield 1%. State tax 3.99% (NC); IRMAA modeled. Market assumptions: long-term-average
          regime — 7% equities, 3% cash, 3% CPI. Spending order: <span className="font-semibold">Cash → Taxable → IRA → Roth</span>. Heirs: <span className="font-semibold">36%</span> blended ordinary (32% federal + 4% state), <span className="font-semibold">22.8%</span> dividend/LTCG (15% + 3.8% NIIT + 4% state);
          1% estate settlement; step-up at death; 10-year SECURE horizon; <span className="font-semibold">default heir-realization assumption: post-death gains never
          realized</span>. Conversions, when enabled, are bracket-managed within a 2026–2056 window: each year RMDs come out first and conversions fill
          the remaining headroom up to the target bracket. Dollar figures are nominal model outputs, not present values.
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
                r.plus10Never === liveBest.never ? <W key="t">{fmtM(r.plus10Never)}</W> : fmtM(r.plus10Never),
              ];
            })}
            note="Computed live from your current plan inputs. Each strategy overrides only the conversion enablement/target and the funding order — your ages, income, spending, accounts, taxes, and legacy settings are unchanged. The +10 yr column uses the default never-realized bound; the §5.3 table shows both bounds."
          />
        ) : (
          <Tbl
            testid="whitepaper-case-table"
            head={["Strategy", "Converted", "IRA at 2nd death", "Roth at 2nd death", "Lifetime taxes", "Heir tax on IRA", "At-death estate", "To heirs (+10 yr)"]}
            rows={[
              ["A. No conversions", "$0", "$16.04M", "$0", "$5.66M", "$7.98M", "$22.75M", "$42.80M"],
              [<span key="b" className="font-semibold">B. Convert to 24% · spend taxable first</span>, "$4.87M", "$0.86M", "$21.57M", "$4.96M", "$0.43M", "$24.78M", <W key="bw">$47.15M</W>],
              ["C. Convert to 24% · spend IRA first", "$2.17M", "$2.36M", "$8.50M", "$4.72M", "$1.17M", <W key="cw">$24.83M</W>, "$46.74M"],
              ["D. Convert to 32% · spend taxable first", "$6.30M", "$0", "$21.85M", "$4.09M", "$0", "$24.51M", "$46.61M"],
              ["E. Convert to 35% · spend taxable first", "$6.53M", "$0", "$20.32M", "$3.49M", "$0", "$22.99M", "$43.62M"],
            ]}
            note="The +10 yr column uses the model's default assumption (heirs never realize post-death gains); §5.3 re-scores every strategy under full realization. Nominal dollars."
          />
        )}

        <H3>5.1 The conversion policy is the first-order lever</H3>
        <P>
          Moving from no conversions (A) to a bracket-managed program (B) raised the heirs&apos; ten-year after-tax inheritance by
          <span className="font-semibold"> +$4.35M (+10.2%)</span> under the default never-realized assumption — and by <span className="font-semibold">+$7.74M (+19.8%)</span> if
          the heirs realize their gains — while <em>also cutting the household&apos;s own cumulative lifetime taxes from $5.66M to $4.96M</em>,
          because assets sheltered in the Roth stopped generating taxed dividends, taxable RMDs, NIIT, and IRMAA surcharges for decades. Doing
          nothing is the expensive strategy on <span className="font-semibold">both</span> generations&apos; tax bills.
        </P>
        <P>
          One table row deserves special attention: strategy E (fill 35%) produces the <em>lowest</em> lifetime tax bill for the couple ($3.49M)
          and one of the <em>worst</em> outcomes for the heirs ($43.62M). Minimizing the parents&apos; lifetime taxes is not the objective;
          maximizing what the family keeps is — and those two goals part company as soon as conversions climb toward the heirs&apos; own rate.
        </P>
        <H3>5.2 The heirs&apos; liability is the headline number</H3>
        <P>
          Unconverted, the IRA compounds to <span className="font-semibold">$16.0M</span> at the second death and — because §1014(c) denies it any step-up — arrives as a
          <span className="font-semibold"> $7.98M ordinary-income tax bill</span> for children already earning at 32%+ rates.<Fn n={4} /><Fn n={5} /> The 24% taxable-first
          program shrinks that bill to $0.43M; the 32% program retires it entirely. This is precisely the transfer of the tax from the heirs&apos;
          36% blended rate to the parents&apos; controlled 24% rate that §4 frames — executed with its dollar value attached.
        </P>
        <H3>5.3 What the heirs do with the inherited taxable account changes the funding-order answer</H3>
        <P>
          The paper&apos;s most contestable assumption is behavioral, not fiscal: <span className="font-semibold">do the heirs ever sell what they inherit?</span> If
          they hold the stepped-up taxable portfolio indefinitely — living on its dividends, borrowing against it, or holding until their own
          deaths when §1014 applies <em>again</em> — the inherited taxable account behaves much like an inherited Roth: growth is effectively
          never taxed, and preserving a large taxable balance costs the family little. But if the heirs <em>realize</em> gains during their
          lifetimes — and in particular during the 10-year SECURE window, when many beneficiaries reposition or spend inherited portfolios —
          post-death appreciation is taxed at their 22.8% preferential rate, and strategies that converted taxable wealth into Roth wealth pull
          further ahead. The planner exposes this choice as a <span className="font-semibold">Heir-realization toggle</span> (shipped default: <em>never realized</em>).
          Re-scoring every strategy under both bounds brackets the truth:
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
              ["A. No conversions", "$39.06M", "$42.80M"],
              ["B. Convert to 24% · spend taxable first", <W key="b">$46.80M</W>, <W key="bn">$47.15M</W>],
              ["C. Convert to 24% · spend IRA first", "$43.65M", "$46.74M"],
              ["D. Convert to 32% · spend taxable first", "$46.33M", "$46.61M"],
              ["E. Convert to 35% · spend taxable first", "$43.35M", "$43.62M"],
            ]}
          />
        )}
        <ul className="list-disc pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">The conversion decision survives both bounds.</span> +10.2% to heirs if no gain is ever realized; +19.8% under full realization. No-realization flatters the do-nothing strategy most — and it still loses decisively.</li>
          <li><span className="font-semibold">The heirs&apos; IRA bill survives both bounds.</span> The $7.98M liability is nearly or fully eliminated under every conversion program, under any behavioral assumption: §1014(c) never shelters the IRA.</li>
          <li><span className="font-semibold">The funding-order gap widens or narrows with heir behavior.</span> Taxable-first (B) beats IRA-first (C) by <span className="font-semibold">$3.15M (+7.2%)</span> when heirs realize their gains — but by only <span className="font-semibold">$0.41M (+0.9%)</span> when they never do. Heirs who will spend or reposition the inherited portfolio make taxable assets the more attractive funding source; heirs who will simply hold make the choice nearly a wash.</li>
        </ul>
        <H3>5.4 Longevity is the pivot — and it cannot be predicted</H3>
        <P>
          Everything above was computed at the plan&apos;s assumed life expectancies (85/90). But life expectancy is the least knowable input in
          the entire model, and it is precisely the input the funding-order and bracket answers turn on. Re-running all five strategies at a
          shorter horizon (ages 80/85, second death 2051) and a longer one (ages 95/100, second death 2066):
        </P>
        <Tbl
          testid="whitepaper-longevity-table"
          head={["Strategy", "80/85 realized", "80/85 never", "85/90 realized", "85/90 never", "95/100 realized", "95/100 never"]}
          rows={[
            ["A. No conversions", "$31.64M", "$34.45M", "$39.06M", "$42.80M", "$60.06M", "$66.81M"],
            ["B. 24% · taxable first", "$36.67M", "$37.16M", <W key="r2">$46.80M</W>, <W key="n2">$47.15M</W>, <W key="r3">$75.07M</W>, <W key="n3">$75.47M</W>],
            ["C. 24% · IRA first", "$34.73M", <W key="n1c">$37.23M</W>, "$43.65M", "$46.74M", "$69.83M", "$74.27M"],
            ["D. 32% · taxable first", <W key="r1">$37.16M</W>, <W key="n1">$37.39M</W>, "$46.33M", "$46.61M", "$73.24M", "$73.63M"],
            ["E. 35% · taxable first", "$35.04M", "$35.27M", "$43.35M", "$43.62M", "$67.37M", "$67.76M"],
          ]}
          note="After-tax value to heirs ten years after the second death, under both heir-realization bounds, at three longevity assumptions. Bold = column leader (at 80/85 never-realized, D and C finish within $0.16M — effectively tied). To test other lifespans, change the life expectancies in Plan Inputs and re-run the §5 tables on your plan."
        />
        <P>Three structural lessons fall out of this table:</P>
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li>
            <span className="font-semibold">A long life amplifies the conversion payoff.</span> The premium for converting (best program vs. A) grows from
            +8.5% at ages 80/85, to +10.2% at 85/90, to <span className="font-semibold">+13.0%</span> at 95/100 under the default bound — and from +17% to +25%
            under full realization. Every additional year alive is another year the converted dollars compound tax-free inside the Roth, and the
            longer runway lets tax-efficient compounding <em>outweigh</em> the tax savings from preserving the step-up on taxable assets.
          </li>
          <li>
            <span className="font-semibold">Longevity picks the funding source.</span> With a long horizon, spending from <em>taxable</em> assets early is what
            permits early, larger conversions — the ordinary brackets stay open for conversion instead of being filled by IRA withdrawals used to
            fund spending (B&apos;s Roth at second death: $21.6M vs. C&apos;s $8.5M). With a short horizon the calculus reverses: there is little
            runway for Roth compounding to repay the forfeited step-up, so preserving the taxable account and letting IRA withdrawals carry the
            spending (and the conversion taxes) becomes the defensible choice — at 80/85 under never-realized gains, IRA-first (C) actually edges
            taxable-first (B).
          </li>
          <li>
            <span className="font-semibold">The runway also picks the bracket.</span> At 85/90 and beyond, the 24% program wins — it retires nearly the whole
            IRA anyway, so climbing to 32% just prepays the same liability at a worse rate. At 80/85 the shortened window flips the ranking: the
            24% pace leaves $3.0M unconverted at death and the 32% program&apos;s faster pace wins. Higher brackets earn their keep only when a
            deadline — late start, reduced life expectancy, a survivor&apos;s imminent single-filer compression — compresses the window; and never
            above the heirs&apos; rate.
          </li>
        </ol>
        <H3>5.5 Funding order: a small, longevity-dependent difference — not a rule</H3>
        <P>
          Isolating the funding-order lever (B minus C — identical conversion policy, opposite spending order) across the three lifespans:
        </P>
        <Tbl
          testid="whitepaper-funding-delta-table"
          head={["Longevity", "Taxable-first advantage (gains realized)", "Taxable-first advantage (never realized)"]}
          rows={[
            ["Ages 80/85 (short)", "+$1.94M", <span key="s" className="text-[#C87941] font-semibold">−$0.07M (IRA-first wins)</span>],
            ["Ages 85/90 (base)", "+$3.15M", "+$0.41M"],
            ["Ages 95/100 (long)", "+$5.24M", "+$1.20M"],
          ]}
          note="Positive = spending taxable assets first (freeing ordinary brackets for conversions) leaves heirs more; negative = preserving the step-up wins."
        />
        <P>
          Under the model&apos;s default assumptions the gap is <span className="font-semibold">≤1.6% of the estate, and its sign flips</span> with lifespan and heir
          behavior. The honest conclusion is that <span className="font-semibold">funding order produces only small differences in expected outcomes, and the
          differences vary with longevity — which is inherently unpredictable</span>. It should be chosen on liquidity, simplicity, basis
          diversification, and an honest conversation about family longevity and what the heirs are likely to do — not sold as a
          wealth-maximization rule. The conversion decision itself dwarfs it at every horizon tested. The academic record agrees on both points:
          Geisler, Harden, and Hulse conclude there is <em>no single best decumulation sequence for all clients</em> — the leader shifts with the
          account mix, income level, and horizon, and the spread between sensible sequences is measured in single-digit percentages — while
          confirming that bracket-managed acceleration beats any fixed rule of thumb.<Fn n={14} />
        </P>
        <H3>5.6 Markets do not compound in straight lines</H3>
        <P>
          Every number above assumes returns arrive in a smooth 7% line. They will not — and this matters most for strategies that
          front-load tax payments. Filling the 32% bracket instead of 24% pays <span className="font-semibold">$0.99M vs. $0.74M (+33%)</span> of tax over the
          conversion window&apos;s first five years, and $2.12M vs. $1.65M over ten. Money paid to the Treasury early is a certain cost set against
          uncertain future growth — and, since the TCJA repealed recharacterization, <span className="font-semibold">a Roth conversion cannot be undone</span>.<Fn n={11} />
          If markets decline after aggressive early conversions, the family has depleted assets it may need later — prepaying tax at 32% on wealth
          that no longer exists at the pre-conversion valuation. The planner&apos;s Monte Carlo engine (1,000 seed-matched trials — both strategies
          face <em>identical</em> market paths — at the app&apos;s default 65% stocks / 25% bonds / 10% cash allocation) puts numbers on the risk:
        </P>
        <div className="my-4 rounded-lg border border-[#4A6741]/25 bg-[#4A6741]/5 px-4 py-3 text-[13px] leading-6 text-[#2A2A2A]" data-testid="whitepaper-mc-methodology">
          <span className="font-semibold text-[#4A6741]">Methodology notes.</span> The engine ships with four defaults that materially affect what
          these tables report — advisors should know each before trusting the numbers:
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><span className="font-semibold">Correlated cross-asset draws</span> are ON. Stocks, bonds and cash move together during risk-off
              regimes exactly as they do in observed history — independent draws would flatter safety artificially and are available only as an
              opt-out teaching mode.</li>
            <li><span className="font-semibold">Early bear-market shock</span> is ON by default (−20% for the first two years). Sequence-of-returns
              risk is the specific danger front-loaded conversions run into, so the base stress-test faces it head-on. Advisors can dial the depth
              or turn it off.</li>
            <li><span className="font-semibold">Halt conversions on a 25% drawdown, resume after 2 consecutive positive years.</span> This is the
              &ldquo;program the floor, harvest the ceiling opportunistically&rdquo; discipline of §6.3 made operational: the engine will not keep
              prepaying tax at high brackets into a bear market. Turn it off to see what an undisciplined schedule looks like.</li>
            <li><span className="font-semibold">Plan-anchored regime paths.</span> In the block-bootstrap regime the deterministic plan defines a
              floor and ceiling for terminal outcomes; a lucky 500-year run of resampled 1950s decades cannot fabricate a billion-dollar tail on a
              depleting plan, and a very unlucky run cannot show negative wealth when the deterministic plan sits at zero. Distribution shapes are
              honest even when the plan is thin.</li>
          </ul>
        </div>
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
            note="Computed live from your current plan: 1,000 seed-matched trials per strategy at 65/25/10 — both face identical market paths."
          />
        ) : (
          <Tbl
            testid="whitepaper-mc-table"
            head={["", "24% target", "32% target"]}
            rows={[
              ["Plan success (never depleted)", "86.4%", "86.6%"],
              ["Ending liquid assets, 5th percentile", "$0.0M", "$0.0M"],
              ["Ending liquid assets, median", "$21.4M", "$20.6M"],
              ["Ending liquid assets, mean", "$33.9M", "$32.9M"],
            ]}
          />
        )}
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Roughly 1 in 7 simulated paths depletes the liquid portfolio under either pace.</span> The deterministic projection — where the same household sails through with $20M+ to spare — never shows this. A plan that looks bulletproof on a straight 7% line is not bulletproof against sequences of real markets. Assumed rates of return are speculative predictions; the taxes paid on conversions are not.</li>
          <li><span className="font-semibold">Climbing to 32% buys nothing here.</span> Success is statistically identical (86.4% vs. 86.6%), the 5th percentile is depleted either way, and the median path surrenders ~$0.8M — while §5.4 showed the 32% program also losing deterministically at the base and long horizons. Front-loading an extra 33% of early tax produced no additional safety and less median wealth.</li>
        </ol>
        <H3>5.7 Limitations</H3>
        <P>
          These are nominal-dollar results for one household under fixed assumptions. §5.3, §5.4 and §5.6 bracket the three largest
          sensitivities — the heirs&apos; realization behavior, longevity, and market risk — but heir tax rates, tax-law drift, state regimes, and
          spending shocks remain modeled only as fixed inputs. The strategy analyzer and Monte Carlo engine should be run per household rather
          than assuming this case study generalizes.
        </P>
        <P>
          <span className="font-semibold">Reading the sensitivity pages carefully.</span> The planner reports single-variable sensitivities and
          combined ones on separate pages by design: a single-variable view moves one lever (funding, conversion policy, allocation, market regime)
          against a single controlled base, so any observed delta is <em>causal</em>; the combined view stacks multiple non-orthogonal levers and is
          therefore correlational only — useful as a &ldquo;how big could the answer move&rdquo; envelope, not as a driver-of-outcome analysis.
          Deltas read off the combined page cannot be attributed to any one lever without the single-variable page beneath it.
        </P>

        <H2>6. Why It Works — and When to Hold Back</H2>
        <H3>6.1 The three-account exchange rate</H3>
        <P>
          The dollars in the three retirement accounts are <em>not</em> equivalent in &ldquo;post-tax to heirs&rdquo; terms.
          Under the model&apos;s baseline assumptions (heirs&apos; blended ordinary rate 36%), a dollar of principal
          on the day of the second death is worth:
        </P>
        <Tbl
          testid="whitepaper-account-value-table"
          head={["Account", "Post-tax value to heir (per $1 principal)", "Reason"]}
          rows={[
            ["Traditional IRA / 401(k)", "$0.64", "SECURE 10-year ordinary-rate distribution at heir marginal rate ~36%"],
            ["Taxable brokerage (step-up basis)", "$1.00", "§1014 basis reset at death — but post-death growth is sheltered only if the heirs never sell"],
            ["Roth IRA", "$1.00", "Tax-free during owner's life and during the SECURE 10-year window after death; no RMDs during owner's life; ten-year distribution but no income tax within the wrapper — regardless of heir behavior"],
          ]}
          note="A $1 Traditional dollar is worth ≈36% less to the heir than a $1 Roth or stepped-up taxable dollar. This is the arbitrage every conversion below the heirs' rate captures — and the arbitrage that reverses when the heirs' rate is below the parents'."
        />
        <P>
          The Taxable and Roth rows tie <em>on the day of death</em> — that is the step-up&apos;s snapshot. They diverge afterward: the Roth&apos;s
          $1.00 keeps compounding tax-free no matter what the heirs do, while the taxable $1.00 stays whole only under the never-sell assumption.
          The longer the parents live before the snapshot is taken, and the more the heirs transact after it, the more the Roth column dominates.
        </P>
        <H3>6.2 The estate and GST case — the only trust-compatible retirement asset</H3>
        <P>
          The three-account exchange rate above measures the &ldquo;post-tax to heirs&rdquo; value of each account at the day of
          death. It does <em>not</em> capture a distinct, structurally larger effect that only shows up when trusts enter
          the picture: the Roth is uniquely well-suited to be a trust beneficiary — the Traditional IRA is uniquely
          ill-suited — and that asymmetry produces an entirely separate case for lifetime conversions, on top of the
          bracket arbitrage already documented.
        </P>
        <P>
          <span className="font-semibold">The pre-conversion dilemma.</span> Trusts are terrible at receiving ordinary
          income. An accumulation trust hits the 37% + 3.8% NIIT ceiling at roughly $16,000 of retained income, so a
          Traditional IRA draining through the SECURE 10-year window into a trust converts a family&apos;s 24–36% tax
          problem into a ~41% one. The historical workaround was <em>conduit</em> trust drafting — pass the
          distributions straight out to beneficiaries so they&apos;re taxed at individual rates — but the 10-year rule
          then forces the entire IRA out of the trust within a decade: no creditor protection, no divorce protection,
          no spendthrift control, no GST leverage on those dollars. Pre-conversion, families faced a forced choice:
          <span className="font-semibold"> tax efficiency (conduit) or asset control (accumulation), never both.</span>
        </P>
        <P>
          <span className="font-semibold">Conversion dissolves the dilemma.</span> A Roth flowing to an accumulation
          trust still faces the 10-year payout, but the distributions <em>arrive tax-free</em>, so the compressed trust
          brackets have nothing to bite. The trustee retains and reinvests the full proceeds behind the trust&apos;s
          protections. Ongoing dividends, interest, and realized gains generated inside the trust <em>after</em> the
          Roth wrapper terminates are taxed at trust rates (37% ordinary / 20% LTCG above ~$16K) — or carried out
          annually to beneficiaries via DNI at their individual rates, at trustee discretion.
        </P>
        <P>
          <span className="font-semibold">The income-character split.</span> The trustee&apos;s year-by-year math
          typically splits by character. <em>Ordinary income</em> — dividends, interest, other DNI — favors distribution:
          the trust&apos;s 37% top ordinary bracket versus a beneficiary&apos;s 24–32% is a 5–13 point saving on every
          dollar, and the differential is even larger when the beneficiary is an adult child in peak-earning years.
          <em> Capital gains</em>, by contrast, typically favor retention: the trust&apos;s 20% top LTCG rate is only
          about 5 points above the individual 15% LTCG rate, so the retention penalty is modest relative to the creditor
          protection, spendthrift control, and continued tax-advantaged compounding preserved by keeping the corpus
          intact. That distribute-ordinary / retain-LTCG discretion is itself a form of control the conduit structure
          never offered.
        </P>
        <P>
          <span className="font-semibold">The GST asymmetry.</span> The federal estate tax exemption ($15M in 2026 under OBBBA,
          chained-CPI indexed) is portable via DSUE — a timely-filed Form 706 lets the surviving spouse claim the
          decedent&apos;s unused exclusion. The GST exemption is <em>not</em> portable. If the first spouse to die
          leaves everything to the surviving spouse via marital deduction and no GST-exempt trust is funded at that
          first death, the entire first-death GST exemption is <span className="font-semibold">not utilized</span> and
          cannot be recovered later.
          Creating a bypass/GST trust at first death — and allocating the decedent&apos;s GST exemption to it via Form 706
          Schedule R — is the standard workaround: the trust becomes a permanently GST-exempt vehicle that shelters every
          subsequent generation&apos;s transfers from the 40% GST tax, on top of the estate-tax shelter.
        </P>
        <P>
          <span className="font-semibold">Compounding across generations.</span> Because the trust receives the Roth at
          the first spouse&apos;s death using their exemption(s), all subsequent growth compounds outside every later
          estate — the survivor&apos;s, the children&apos;s, potentially the grandchildren&apos;s. Even at a modest 6–7%
          real growth rate, an amount that starts as a modest fraction of the estate exemption today becomes an outsized
          fraction of the family&apos;s wealth two or three generations later — all of it having escaped estate tax at
          every death along the way, and (during each successive SECURE 10-year window) income-tax free as well.
        </P>
        <P>
          <span className="font-semibold">What this means for the conversion program.</span> Every dollar converted
          before death is a dollar that can go to the trust with full control AND full tax efficiency. Every un-converted
          Traditional dollar forces the old bad choice at death — spousal rollover (deferral but no trust protection, back
          into the survivor&apos;s estate) or trust funding at punitive compressed rates. This retroactively strengthens
          the case for finishing conversions before the first death, and for opening the 32% relief valve in high-return
          futures: the conversion program isn&apos;t just about lifetime tax arbitrage — it&apos;s what determines how much
          of the family&apos;s wealth can eventually be routed to a trust with both control and efficiency intact.
        </P>
        <p className="text-[13px] leading-6 text-[#5A5A5A] italic mb-4">
          Drafting caveats: the trust must be an accumulation see-through trust (not conduit) for this to deliver the
          control benefit; the beneficiary designation forms at each custodian must name the trust with the disclaimer
          cascade correctly ordered; and Form 706 Schedule R must correctly allocate the decedent&apos;s GST exemption
          to the trust at first death. The model&apos;s output and the estate attorney&apos;s documents can silently
          diverge — get the CFP and the estate attorney in the same room with the current beneficiary forms before
          finalizing.
        </p>

        <H3>6.3 The discipline of restraint</H3>
        <blockquote className="border-l-4 border-[#C87941] bg-[#C87941]/5 pl-4 pr-3 py-3 my-4 italic text-[15px] text-[#1A1A1A] font-medium leading-7">
          &ldquo;Be very careful before paying current taxes based upon projections of future returns and tax rates.
          Current taxes are real and reduce assets available to support your and your spouse&apos;s lifestyle.
          Current taxes are real and not refundable; assumptions are hypothetical. This paper&apos;s illustrations
          rest upon assumptions — such as linear, constant investment returns — which, while grounded in historical
          experience, are simplified for projection purposes and are not promises.&rdquo;
        </blockquote>
        <P>
          Two market realities discipline every aggressive conversion schedule:
        </P>
        <ol className="list-decimal pl-6 space-y-3 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li>
            <span className="font-semibold">Sequence-of-returns risk in the early conversion years.</span> If markets fall
            15–30% shortly after converting heavily at high brackets, the family has prepaid a large, <em>final</em> tax bill (recharacterization
            was repealed for tax years after 2017<Fn n={11} />) and depleted liquid assets that may be needed later, precisely when the portfolio
            is weakest. The Roth itself recovers when markets do — but the option of waiting to see the market path before committing is spent,
            permanently.
          </li>
          <li>
            <span className="font-semibold">Mean reversion around the long-run average.</span> Long-run equity returns have averaged roughly 8% nominal
            since 1928, but the distribution around that average is heavy-tailed and clumpy: decades of above-trend returns are often followed by
            decades below it. A conversion schedule calibrated to a straight-line average is calibrated to a path that has never actually occurred.
          </li>
        </ol>
        <P>The practical synthesis is not &ldquo;avoid conversions&rdquo; — it is <span className="font-semibold">&ldquo;program the floor, harvest the ceiling opportunistically&rdquo;:</span></P>
        <ul className="list-disc pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Run the standing plan at the comfortable bracket</span> — the lowest one that retires the IRA within the window you actually have.</li>
          <li><span className="font-semibold">Convert into higher bands conditionally, not automatically:</span> in down markets (a bear market puts every conversion on sale — the tax is fixed on the depressed balance and the recovery happens inside the Roth), in unusually low-income years, or as a survivor&apos;s single-filer compression approaches.</li>
          <li><span className="font-semibold">Phase, don&apos;t bullet.</span> A bracket-managed annual program dollar-cost-averages the tax basis across many market states; a heroic single-year conversion bets the whole tax bill on one valuation.</li>
          <li><span className="font-semibold">Size each year&apos;s conversion against the bump zone.</span> A conversion dollar that pushes qualified dividends or harvested gains across the 0/15/20% thresholds — or across a NIIT or IRMAA cliff — carries an effective marginal cost well above its statutory bracket.<Fn n={12} /> The planner&apos;s single-year analyzer prices these cliffs before each year&apos;s conversion is committed.</li>
          <li><span className="font-semibold">Respect the irreversibility asymmetry.</span> An under-converter can accelerate in any future year; an over-converter can never claw back. When two strategies score close — as 24% and 32% do here — the option value of waiting favors the lower default.</li>
        </ul>

        <H2>7. What a Defensible Model Must Do</H2>
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Separate ordinary income from preferential income</span>, stacking qualified dividends and LTCG at 0/15/20% plus the 3.8% NIIT, exactly as the Code does.<Fn n={6} /><Fn n={7} /></li>
          <li><span className="font-semibold">Track cost basis per account</span> and apply the <span className="font-semibold">§1014 step-up at death</span> — while correctly denying any step-up to IRAs (IRD).<Fn n={4} /></li>
          <li><span className="font-semibold">Model spending withdrawals and conversions as competitors for the same bracket headroom</span>, and let the planner choose the funding order for both spending and the conversion tax.</li>
          <li><span className="font-semibold">Model the SECURE 10-year drawdown at the heirs&apos; ordinary rate — and expose the heirs&apos; realization behavior as an assumption</span> — then measure the after-tax value to heirs at the <span className="font-semibold">end</span> of that window, not at the date of death.<Fn n={5} /></li>
          <li><span className="font-semibold">Test the plan across lifespans and across stochastic market paths</span>, not just one deterministic line — because the funding-order and bracket answers change with both.</li>
          <li><span className="font-semibold">Assume current law</span> — the OBBBA-2025 permanent, inflation-indexed TCJA brackets — rather than a lapsed sunset.<Fn n={8} /></li>
          <li><span className="font-semibold">Reconcile the estate model to the retirement projection year by year.</span> If the plan says the couple will hold $X of Roth and $Y of taxable at year Y2, the estate-planning tab must inherit those exact numbers rather than re-growing an independent series from a different rate table. Two engines that pretend to describe one household but silently disagree on its balance sheet undermine every downstream number.</li>
          <li><span className="font-semibold">Print the federal estate tax as a line-by-line calculation, not a single dollar figure.</span> Exclusion, DSUE, combined shelter, taxable overage, ×40% — each on its own row. A three-page memorandum that ends in a black-box FET number cannot be defended in a client meeting; a ten-line arithmetic block can.</li>
          <li><span className="font-semibold">Model state estate regimes with the same specificity as federal.</span> Every state exclusion, its indexing rule, and its statutory-freeze exceptions (IL/MA/MD/MN/OR/VT freeze the exclusion — inflation adjustment does not apply). A model that assumes federal-style indexing everywhere will systematically under-price the state tax bite in freeze-states.</li>
          <li><span className="font-semibold">Halt aggressive conversion schedules on drawdowns automatically.</span> The engine should refuse to keep prepaying high-bracket tax into a bear market. Ship the guardrail on by default (25% trigger / 2-year resume) — advisors who want to see an undisciplined schedule can turn it off; a schedule that runs through a −40% drawdown untouched is a bug, not a feature.</li>
          <li><span className="font-semibold">Separate causal (single-variable) sensitivities from correlational (combined) ones on different pages.</span> Every conclusion the model draws should trace to a page where one lever moved against a controlled base. Combined views are useful as envelopes; they must never be dressed up as driver-of-outcome analysis.</li>
          <li><span className="font-semibold">Anchor stochastic outcomes to the deterministic plan.</span> Under regime resampling a lucky 500-year run cannot fabricate wealth that the deterministic plan says has run out; under any engine, the terminal distribution must be honestly bounded by the plan itself. Runaway tails are a warning that the sampler is compounding independent of the plan, not a genuine upside signal.</li>
          <li><span className="font-semibold">Ship a defensible base scenario, not a blank slate.</span> A model whose defaults are &ldquo;whatever the user typed last&rdquo; is a model without a base case. This planner ships with a fully-specified NC household (state 3.99%, heir Fed 32%/State 4%, LTCG 22.8%, IRMAA on, block-bootstrap regime, halt-on-drawdown 25%/2yr, correlated draws on, early-bear shock on) so every reader starts from the same coordinate system and can measure their own household as a delta from it.</li>
        </ol>

        <H2>8. Conclusion</H2>
        <P>
          Simplified, single-rate Roth-conversion calculators are a reasonable first screen, but they are not a planning engine. The model&apos;s
          own runs reduce the decision to three ranked, quantified rules:
        </P>
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Convert while the parents&apos; rate is below the heirs&apos; assumed rate — and only then.</span> On the base household: +10.2% to heirs under the default assumption, +19.8% under full realization, and a $7.98M inherited-IRA tax bill retired. If the heirs&apos; rate is at or below the parents&apos;, conversion is not automatic — the same arithmetic runs in reverse.</li>
          <li><span className="font-semibold">Treat funding order as a longevity-informed preference, not a theorem.</span> A long life favors funding early, larger conversions from taxable assets — the ordinary brackets stay open for converting and the Roth&apos;s tax-free compounding eventually outweighs the forfeited step-up. A short life favors preserving the step-up and letting IRA withdrawals carry the load. The measured gap is small (≤2% on default assumptions), flips sign with lifespan and with whether the heirs ever sell — and no one can predict either.</li>
          <li><span className="font-semibold">Never let a straight-line return assumption set the pace.</span> Taxes paid on conversions are certain and irreversible; assumed rates of return are speculative predictions. Avoid excessive high-bracket early conversions that deplete assets the family may need if markets decline — program the comfortable bracket, and climb only when a deadline or a bear market makes the higher band genuinely cheap. This planner now ships that discipline as a default: aggressive conversions halt automatically after a 25% drawdown and resume only after two consecutive positive-return years.</li>
        </ol>
        <P>That is the decision this planner is built to model honestly — and to measure, household by household.</P>

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
