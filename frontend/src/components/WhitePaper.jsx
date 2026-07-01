import { BookOpen, Sparkles, ListChecks } from "lucide-react";

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

export const WhitePaper = ({ print = false }) => {
  return (
    <div className={print ? "whitepaper-print-block" : ""} data-testid={print ? "whitepaper-print" : "whitepaper"}>
      <article className={print ? "max-w-none" : "max-w-3xl mx-auto"}>
        {/* Title block */}
        <header className="border-b border-[#EBE8E0] pb-6 mb-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4A6741]/30 bg-[#4A6741]/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#4A6741]">
              <BookOpen className="h-3 w-3" /> White Paper
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-[#1A1A1A]" data-testid="whitepaper-title">
            Why Simplified Roth-Conversion Calculators Get the Funding Decision Wrong
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Preferential Income, the Step-Up in Basis, and the Case for Depleting the IRA During the Owners' Lifetimes
          </p>
          <p className="mt-3 text-xs italic text-muted-foreground max-w-2xl">
            A white paper of the Roth Conversion &amp; Retirement Planner. Educational analysis, not tax or legal advice.
            Figures should be verified against current IRS tables. Assumes current federal law following the One Big Beautiful
            Bill Act of 2025 (OBBBA), which made the TCJA individual brackets permanent and inflation-indexed.
          </p>
        </header>

        {/* Plain-English summary box */}
        <div className="my-6 rounded-xl border border-[#C87941]/30 bg-[#C87941]/5 p-5" data-testid="whitepaper-summary">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-[#C87941]" />
            <p className="label-cap text-[11px] text-[#C87941]">In plain English</p>
          </div>
          <p className="text-[15px] leading-7 text-[#2A2A2A]">
            Free online Roth calculators usually ask just two questions — your tax rate now versus later — then nudge you to
            convert aggressively and pay the tax by <span className="font-semibold">selling your brokerage investments</span>.
            That advice can quietly cost your family money, because it ignores three things this planner is built around:
          </p>
          <ul className="mt-3 space-y-2 text-[15px] leading-7 text-[#2A2A2A]">
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">1.</span><span>Dividends and long-term gains are taxed at <span className="font-semibold">lower rates (0/15/20%)</span>, not your top ordinary rate.</span></li>
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">2.</span><span>Assets held until death get a <span className="font-semibold">"step-up"</span> that can erase the tax on a lifetime of growth.</span></li>
            <li className="flex gap-2"><span className="text-[#4A6741] font-bold">3.</span><span>A large pre-tax IRA left to your children must be <span className="font-semibold">emptied within 10 years</span> — often taxed at their peak-earning 32–37% rates.</span></li>
          </ul>
          <p className="mt-3 text-[15px] leading-7 text-[#2A2A2A]">
            There is real value in converting early — Roth dollars then grow tax-free for life — but only up to the point where your
            tax rate matches the rate your children would pay; <span className="font-semibold">converting above that line simply prepays tax at a worse rate.</span>
          </p>
          <p className="mt-3 text-[15px] leading-7 text-[#2A2A2A]">
            The smarter question is usually: <span className="font-semibold">should you draw the IRA down at your own controlled rates now,
            while protecting the taxable account for the step-up at death?</span> This planner is built to answer that honestly.
          </p>
        </div>

        {/* Formal paper */}
        <H2>Executive Summary</H2>
        <P>
          The most widely distributed retirement-planning tools — including the free Roth-conversion calculators offered by large
          custodians such as Fidelity and Schwab — reduce a genuinely multi-dimensional decision to a single comparison: the
          retiree's current marginal tax rate versus an assumed future marginal rate. That simplification systematically biases the
          recommendation toward converting aggressively and, critically, toward <span className="font-semibold">using taxable (brokerage) assets to pay the conversion tax</span>.
        </P>
        <P>
          This paper argues, on the basis of the Internal Revenue Code, IRS guidance, and peer-reviewed and practitioner research,
          that this simplification is structurally flawed in three ways. It (1) conflates ordinary income with preferentially-taxed
          qualified-dividend and long-term-capital-gain (LTCG) income; (2) ignores the §1014 step-up in basis that can permanently
          eliminate the tax on a taxable account's embedded gains at death; and (3) as a result, over-recommends liquidating taxable
          assets to fund conversions — realizing gains the step-up would otherwise have erased.
        </P>
        <P>
          Correctly framed, the key variable is <span className="font-semibold">not</span> "the retiree's current vs. future rate." It is whether the
          <span className="font-semibold"> family pays the ordinary-income tax embedded in the traditional IRA at the couple's own controlled, bracket-managed
          rates during their lifetimes, or leaves a large pre-tax IRA to heirs</span> who must empty it within ten years under the SECURE Act —
          frequently during the heirs' peak earning years, stacked on top of their wages at 32–37% marginal rates. A defensible model
          must separate income character, track cost basis, apply the step-up, and let the planner choose the conversion-tax funding
          source. This planner does.
        </P>

        {/* Premises of the analysis */}
        <div className="my-6 rounded-xl border border-[#4A6741]/30 bg-[#4A6741]/5 p-5" data-testid="whitepaper-premises">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks className="h-4 w-4 text-[#4A6741]" />
            <p className="label-cap text-[11px] text-[#4A6741]">Premises of this analysis</p>
          </div>
          <p className="text-[15px] leading-7 text-[#2A2A2A] mb-3">
            This paper's conclusion rests on two premises. Where they hold — as they do for most successful savers — the case
            for depleting the IRA during the owners' lifetimes is strong; where they do not, the recommendation can change.
          </p>
          <ol className="space-y-3 text-[15px] leading-7 text-[#2A2A2A]">
            <li className="flex gap-2">
              <span className="text-[#4A6741] font-bold shrink-0">1.</span>
              <span>
                <span className="font-semibold">The heirs' tax rate exceeds the parents' controlled rate.</span> Successful families typically raise children who go on
                to earn at least average incomes, and those children usually inherit the parents' IRA and taxable assets during their
                <em> own peak earning years</em> — commonly their 50s and 60s. Under the SECURE Act's 10-year rule, inherited traditional-IRA
                distributions are taxed as ordinary income and stacked on top of the heirs' wages, so they land in
                <span className="font-semibold"> higher ordinary brackets (often 32–37%)</span> than the parents would face converting at low, controlled rates during
                their own lifetimes.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#4A6741] font-bold shrink-0">2.</span>
              <span>
                <span className="font-semibold">Conventional calculators ignore the separate character of investment income.</span> The Roth-conversion tools offered by
                large financial firms such as <span className="font-semibold">Fidelity and Schwab</span> do not account for the separate, preferential treatment of long-term
                capital gains and qualified dividends (0/15/20%) versus the ordinary-income treatment of IRA distributions. Omitting that
                distinction <span className="font-semibold">understates the true benefit</span> of conversions — a benefit this planner measures on an apples-to-apples basis by
                valuing the after-tax inheritance delivered to the heirs <span className="font-semibold">ten years after the second spouse's death</span>, once the inherited IRA
                has been fully drawn down.
              </span>
            </li>
          </ol>
        </div>

        <H2>1. The Problem: Single-Rate Simplification</H2>
        <P>
          Mainstream consumer Roth-conversion calculators typically ask for two numbers — a current marginal tax rate and an assumed
          future/retirement marginal rate — and then report a break-even. This is useful for building awareness, and it captures the
          first-order insight (convert when your rate today is lower than your expected rate later). But it treats the household's
          portfolio as a single pre-tax bucket and, in doing so, omits four factors that materially change the answer:
        </P>
        <ul className="list-disc pl-6 space-y-1.5 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li>The <span className="font-semibold">character</span> of income (ordinary vs. preferential).</li>
          <li>The <span className="font-semibold">cost basis</span> of taxable assets and the <span className="font-semibold">§1014 step-up</span> at death.</li>
          <li><span className="font-semibold">Asset location</span> and the source of funds used to pay the conversion tax.</li>
          <li>The <span className="font-semibold">SECURE Act 10-year rule</span> and the tax rate of the <em>heirs</em> who ultimately inherit a pre-tax IRA.</li>
        </ul>
        <P>
          Michael Kitces' detailed "arithmetic of Roth conversions" analysis shows that simplified break-even framing routinely
          misstates the true benefit precisely because it ignores where the tax is paid from and what that funding source costs.<Fn n={3} />
        </P>

        <H2>2. Three Structural Errors</H2>
        <H3>2.1 Conflating ordinary income with preferential income</H3>
        <P>
          Qualified dividends and long-term capital gains are taxed under a <span className="font-semibold">separate, preferential schedule of 0%, 15%, and 20%</span>,
          stacked <em>on top of</em> ordinary taxable income — not at ordinary rates that reach 37%.<Fn n={6} /> High-income households may also owe
          the <span className="font-semibold">3.8% Net Investment Income Tax</span> on that same investment income.<Fn n={7} /> A model that lumps all income into one
          bucket at one rate mis-prices <em>both</em> sides of the decision: it overstates the cost of holding appreciated taxable assets and
          understates the value of managing ordinary income (conversions, IRA distributions) against the preferential stack. The
          separation of ordinary income from LTCG/dividend income is not a refinement — it is fundamental to pricing the trade-off correctly.
        </P>
        <H3>2.2 Ignoring the §1014 step-up in basis</H3>
        <P>
          Under <span className="font-semibold">IRC §1014</span>, property acquired from a decedent takes a basis equal to its fair market value at the date of death —
          <span className="font-semibold"> permanently eliminating the capital-gains tax on all appreciation during the owner's lifetime</span>.<Fn n={4} /> In the nine
          community-property states, <span className="font-semibold">§1014(b)(6)</span> steps up <span className="font-semibold">100%</span> of the community property (not merely the decedent's half)
          at the first spouse's death; in common-law states, jointly-held property receives a step-up only on the decedent's half.<Fn n={4} />
        </P>
        <P>
          Crucially, <span className="font-semibold">§1014(c) denies the step-up to "income in respect of a decedent," which includes traditional IRAs and 401(k)s.</span><Fn n={4} />
          Retirement accounts carry their deferred ordinary-income tax through to the heirs; taxable brokerage assets do not. A model that
          ignores the step-up implicitly assumes a dollar of embedded taxable gain will eventually be taxed — when, held to death, it may
          never be taxed at all. This asymmetry is the single largest omission in single-rate calculators.
        </P>
        <H3>2.3 Over-recommending taxable assets as the conversion-tax funding source</H3>
        <P>
          The correct general rule is well established: <span className="font-semibold">pay the conversion tax from outside funds, not by withholding from the IRA</span>, so
          that 100% of the converted amount lands in the Roth and compounds tax-free.<Fn n={3} /> But the same literature attaches a caveat that
          consumer calculators omit: this holds cleanly only when the outside funds have a <span className="font-semibold">high cost basis</span>. When the taxable assets
          used to pay the tax carry large <span className="font-semibold">unrealized gains, selling them triggers LTCG (and possibly NIIT) that the §1014 step-up would
          otherwise have eliminated</span> — degrading, and sometimes reversing, the apparent benefit.<Fn n={3} /> Because single-rate tools track neither
          basis nor the step-up, they cannot see this cost and therefore default to recommending taxable assets as the funding source.
        </P>

        <H2>3. Two Forces Every Conversion Analysis Must Balance</H2>
        <P>
          Every credible Roth-conversion analysis is a contest between two forces, and the optimum lives where they meet.
        </P>
        <H3>3.1 The case for converting early and aggressively</H3>
        <P>
          The first force favors converting as much as possible, as early in retirement as possible. Dollars moved into a Roth
          compound <span className="font-semibold">tax-free</span> for the rest of the owners' lives and for the full ten-year window the heirs then hold the
          account — so the earlier a conversion happens, the longer that tax-free compounding runs. On this logic it can be worth
          paying the conversion tax now <em>even on growth that has not yet happened and may never occur</em>, because the future compounding
          inside the Roth is itself never taxed. The low-income years between retirement and the onset of Social Security and RMDs
          are the natural window to do this, deliberately filling the 22%–24% brackets.<Fn n={1} />
        </P>
        <H3>3.2 The ceiling: the "common rate" between the couple and their heirs</H3>
        <P>
          The second force sets a ceiling on that enthusiasm. A conversion only creates value when the rate the couple pays today is
          no higher than the rate that would otherwise apply when the money is eventually taxed — for most successful savers, the rate
          their <span className="font-semibold">heirs</span> will pay. There is therefore an assumed <span className="font-semibold">common rate</span> — the equilibrium between the couple's controlled
          lifetime rate and the heirs' expected ordinary rate — and <span className="font-semibold">conversions pushed above that common rate destroy value rather than
          create it.</span> A couple that has raised successful, high-earning children faces heirs in the 32%–37% brackets; that high heir rate
          <em> raises</em> the common rate and so justifies <em>more</em> conversion — but only up to it, never above it. Converting into the couple's own
          32%+ brackets to chase compounding, when the heirs' rate is no higher, simply prepays tax at a bad rate.
        </P>
        <P>
          Coupled with the §1014 step-up in basis on inherited taxable accounts — which erases the capital-gains tax on a lifetime of
          appreciation — these two forces point to a single disciplined strategy: <span className="font-semibold">convert early, but only up to the common rate; fund
          the conversion tax and later spending by depleting the traditional IRA at those controlled rates; and leave the taxable account
          untouched so it passes to the heirs with a stepped-up basis.</span>
        </P>

        <H2>4. The Correct Framing: Whose Rate Pays the IRA's Tax?</H2>
        <P>
          A traditional IRA is best understood as a <span className="font-semibold">deferred ordinary-income liability held jointly with the U.S. Treasury.</span> The relevant
          question is not the retiree's current-vs-future rate; it is <span className="font-semibold">who eventually pays the ordinary tax on those dollars, and at what rate:</span>
        </P>
        <ul className="list-disc pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li>
            <span className="font-semibold">The couple, during their lifetimes</span>, drawing the IRA down (or converting) at <em>controlled, bracket-filled rates</em> —
            often 22%–24% — in low-income years before Social Security and RMDs, deliberately "filling" the lower brackets;<Fn n={1} /> <span className="font-semibold">or</span>
          </li>
          <li>
            <span className="font-semibold">The heirs</span>, who under the <span className="font-semibold">SECURE Act of 2019 must fully distribute an inherited traditional IRA within ten years</span>, with
            every dollar taxed as <span className="font-semibold">ordinary income</span>.<Fn n={5} /> Adult children commonly inherit in their 50s and 60s — their <span className="font-semibold">peak earning years</span> —
            so those distributions stack on top of existing wages and are frequently taxed at <span className="font-semibold">32%, 35%, or 37%.</span><Fn n={5} />
          </li>
        </ul>
        <P>
          Framed this way, the decision hinges on a comparison the simplified tools never make: <span className="font-semibold">the family's controlled lifetime ordinary
          rate versus the heirs' peak-earnings ordinary rate — net of the taxable step-up preserved by <em>not</em> selling appreciated brokerage
          assets.</span> When the heirs' rate exceeds the couple's controlled rate (the common case for successful savers with high-earning children),
          the analysis favors <span className="font-semibold">depleting the pre-tax IRA during the owners' lifetimes</span> — paying that tax from the IRA itself at controlled
          rates — while <span className="font-semibold">preserving the taxable account intact to receive the step-up.</span>
        </P>
        <P>
          This is consistent with the peer-reviewed record. Cook, Meyer, and Reichenstein, in the <em>Financial Analysts Journal</em>, show that
          early tax-deferred drawdown and Roth conversions that fill low brackets can extend portfolio longevity by roughly
          <span className="font-semibold"> two to three years</span> relative to the conventional "spend taxable first" ordering.<Fn n={1} /><Fn n={2} /> Vanguard's advisor research
          similarly finds the value of well-structured conversions is routinely larger than clients expect once bracket management and
          heirs are considered.<Fn n={9} />
        </P>

        <H2>5. What a Defensible Model Must Do</H2>
        <P>A model fit to guide this decision — and the design of this planner — must:</P>
        <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-[#2A2A2A] mb-4">
          <li><span className="font-semibold">Separate ordinary income from preferential income</span>, stacking qualified dividends and LTCG at 0/15/20% plus the 3.8% NIIT, exactly as the Code does.<Fn n={6} /><Fn n={7} /></li>
          <li><span className="font-semibold">Track cost basis per account</span> and apply the <span className="font-semibold">§1014 step-up at death</span> — 100% in community-property states, 100% of a decedent-owned account, 50% of a common-law joint account, 0% of a survivor-owned account — while correctly denying any step-up to IRAs (IRD).<Fn n={4} /></li>
          <li><span className="font-semibold">Let the planner choose the conversion-tax funding source</span> (deplete the IRA at controlled rates vs. sell taxable assets) and <span className="font-semibold">compare the after-tax value delivered to heirs at the second death and again ten years later</span>, when the inherited IRA has been drawn down.</li>
          <li><span className="font-semibold">Model the SECURE 10-year inherited-IRA drawdown at the heirs' ordinary rate</span>, not the retiree's.<Fn n={5} /></li>
          <li><span className="font-semibold">Assume current law</span> — the OBBBA-2025 permanent, inflation-indexed TCJA brackets — rather than a lapsed sunset.<Fn n={8} /></li>
        </ol>

        <H2>6. Conclusion</H2>
        <P>
          Simplified, single-rate Roth-conversion calculators are a reasonable first screen, but they are not a planning engine. Because
          they cannot see income character, cost basis, the step-up, or the heirs' tax rate, they lean toward converting with — and
          liquidating — taxable assets, quietly forfeiting a step-up that can eliminate the tax on decades of appreciation. A basis-aware,
          character-aware model frequently reaches the opposite conclusion: <span className="font-semibold">deplete the pre-tax IRA at the family's controlled rates
          during the owners' lifetimes, preserve the taxable account for the step-up at death, and avoid handing a large, fully-taxable IRA
          to heirs during their peak earning years.</span> That is the decision this planner is built to model honestly.
        </P>

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
