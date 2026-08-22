import { TrendingUp, ChevronDown, AlertTriangle } from "lucide-react";

// ---------------------------------------------------------------------------
// Collapsible educator card that explains why the sweep favors early / high-
// bracket conversions. Extracted from StrategyOptimizer.jsx so the parent stays
// focused on the ranking + chip-strip logic. Purely presentational — no state.
// ---------------------------------------------------------------------------
const AggressiveStrategyExplainer = ({ visible }) => {
  if (!visible) return null;
  return (
    <details className="group border border-[#EBE8E0] rounded-lg bg-white shadow-none"
             data-testid="aggressive-strategy-explainer">
      <summary className="cursor-pointer list-none px-6 py-4 flex items-center justify-between hover:bg-[#F9F8F6]/60 transition-colors rounded-lg">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-4 w-4 text-[#4A6741]" />
          <div>
            <span className="font-display text-sm font-bold text-[#1A1A1A]">Why does the optimizer favor early high-tax conversions?</span>
            <p className="text-[11px] text-muted-foreground mt-0.5">Five structural forces push the ranking toward front-loaded conversions at 32–37% — plus the sequence-of-returns risk the deterministic math ignores.</p>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground group-open:rotate-180 transition-transform" />
      </summary>
      <div className="px-6 pb-6 pt-2 border-t border-[#EBE8E0]/60 space-y-4 text-[13px] leading-6 text-[#2A2A2A]">
        <p className="text-muted-foreground italic">
          The ranking metric is <span className="font-medium text-[#1A1A1A]">nominal after-tax legacy at second death + horizon</span>
          (tiebreak: lifetime tax). Under that objective, five compounding structural forces stack in favor of
          front-loaded, high-bracket conversions. Roth conversion isn&apos;t a tax bill — it&apos;s an asset transfer at
          an exchange rate: you pay today&apos;s rate to move a dollar from the &ldquo;taxed-at-heir-rate&rdquo; pool into the
          &ldquo;never-taxed&rdquo; pool.
        </p>

        <div>
          <p className="font-semibold text-[#1A1A1A] mb-1">1 · Tax-free compounding runway 🌱</p>
          <p className="text-muted-foreground">
            Every dollar moved to Roth <em>earlier</em> earns more years of tax-free growth. At 7% real, a dollar
            converted at 61 is worth <span className="font-medium text-[#1A1A1A]">~1.97×</span> more at 91 than the same
            dollar converted at 71. The extra decade of untaxed compounding swamps a lot of &ldquo;extra&rdquo; upfront tax.
            Roth compounds at the full gross return; Taxable leaks a fraction of a point every year to dividend tax, NIIT,
            and IRMAA surcharges (~0.25 pp/year at the model&apos;s 1% qualified-dividend yield and 23.45% LTCG rate — larger
            once high-income households cross the NIIT and IRMAA thresholds). That gap compounds meaningfully over a 30-year
            horizon and grows the longer the money stays in the taxable account.
          </p>
        </div>

        <div>
          <p className="font-semibold text-[#1A1A1A] mb-1">2 · The RMD wall 🧱</p>
          <p className="text-muted-foreground">
            Traditional IRA balances explode into forced ordinary income at age 73/75. Once RMDs start they
            push you into higher brackets on their own, make up to <span className="font-medium text-[#1A1A1A]">85% of Social
            Security taxable</span>, and trigger <span className="font-medium text-[#1A1A1A]">IRMAA</span> Medicare surcharges
            and <span className="font-medium text-[#1A1A1A]">NIIT</span> on investment income. Draining the IRA <em>before</em>
            RMDs start eliminates all four snowballs at once. That&apos;s why the pre-SS/pre-RMD window (typically ages 62–70)
            is the cheapest tax you&apos;ll ever pay: even 32–37% here is often the same rate you&apos;d face later on
            <em> much larger</em> RMD dollars.
          </p>
        </div>

        <div>
          <p className="font-semibold text-[#1A1A1A] mb-1">3 · The widow&apos;s tax cliff 🪦</p>
          <p className="text-muted-foreground">
            When the first spouse dies, filing status flips <span className="font-medium text-[#1A1A1A]">MFJ → Single</span>.
            Single brackets are roughly half as wide, so the same IRA withdrawal costs dramatically more tax. Every dollar
            the optimizer moves to Roth <em>while both spouses are alive</em> locks in the wider MFJ brackets forever —
            and the &ldquo;Single-year survivor with a big IRA&rdquo; scenario is the single most expensive setup this
            model can produce.
          </p>
        </div>

        <div>
          <p className="font-semibold text-[#1A1A1A] mb-1">4 · Heir bracket arbitrage (SECURE 10-year) 🎯</p>
          <p className="text-muted-foreground">
            Under the <span className="font-medium text-[#1A1A1A]">SECURE Act</span>, most heirs must drain an inherited
            Traditional IRA within 10 years — a compression that regularly puts them in the top brackets. Every dollar in
            a Traditional IRA is worth about <span className="font-medium text-[#1A1A1A]">$0.64</span> in
            &ldquo;after-heir-tax&rdquo; terms (at a 36% heir marginal); every dollar in Roth is worth
            <span className="font-medium text-[#1A1A1A]"> $1.00</span>. If heirs&apos; expected marginal ≥ your conversion
            rate, converting is <span className="font-semibold">pure arbitrage</span> — even 32% or 35% now beats an
            inherited-IRA drawdown at 32–37% compressed into 10 years.
          </p>
        </div>

        <div>
          <p className="font-semibold text-[#1A1A1A] mb-1">5 · IRAs get no §1014 step-up (IRD) 💀</p>
          <p className="text-muted-foreground">
            Taxable brokerage assets get a <span className="font-medium text-[#1A1A1A]">§1014 cost-basis step-up</span> at
            death — the built-in gain is wiped clean and heirs pay zero tax on it. Traditional IRAs are
            <span className="font-medium text-[#1A1A1A]"> Income in Respect of a Decedent</span> and receive
            <em> no</em> step-up: heirs pay full ordinary tax on every inherited IRA dollar. So the after-tax estate math
            heavily penalizes &ldquo;leave the IRA to the kids&rdquo; and rewards &ldquo;convert now so the Roth passes
            tax-free.&rdquo;
          </p>
        </div>

        <div className="rounded-lg border border-[#C87941]/40 bg-[#C87941]/5 p-4">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-[#C87941] shrink-0 mt-0.5" />
            <p className="font-semibold text-[#C87941] text-[13px]">The risk: sequence-of-returns and mean reversion</p>
          </div>
          <blockquote className="border-l-4 border-[#C87941] bg-white/60 pl-3 pr-2 py-2 mb-3 italic text-[13px] text-[#1A1A1A] font-medium leading-6">
            &ldquo;Be very careful before paying current taxes based upon projections of future returns and tax
            rates. Current taxes are real and reduce assets available to support your and your spouse&apos;s
            lifestyle. Current taxes are real and not refundable; assumptions are hypothetical. This analysis is
            based upon assumptions — such as linear, constant investment returns — which, while grounded in
            historical experience, are simplified for projection purposes and are not promises.&rdquo;
          </blockquote>
          <p className="text-muted-foreground mb-2">
            The math above assumes the historical long-term average return (roughly 8% pre-inflation, 7% real) holds
            over your remaining horizon. It usually does — <em>eventually</em>. But if markets deliver <em>below-average
            returns in the years immediately after</em> you convert (a bear market, a lost decade, or a mean-reversion
            episode), you&apos;ve already prepaid tax on wealth that no longer exists at the moment you needed it to
            compound. And unlike pre-2018, <span className="font-semibold">a Roth conversion cannot be recharacterized</span> —
            TCJA closed that door in 2017. You cannot unwind an over-conversion after the fact.
          </p>
          <p className="text-muted-foreground mb-2 font-medium text-[#1A1A1A]">Practical mitigation:</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li><span className="font-medium text-[#1A1A1A]">Phase the conversion</span> across several years rather than one big bullet — the sweep&apos;s &ldquo;phased&rdquo; strategies do this automatically.</li>
            <li><span className="font-medium text-[#1A1A1A]">Convert <em>more</em> in down markets</span> — a bear market is effectively a &ldquo;Roth conversion sale.&rdquo; The dollar amount converted is fixed for tax, but the shares are cheap; when they recover, all the recovery lands in the Roth tax-free.</li>
            <li><span className="font-medium text-[#1A1A1A]">Program the floor, harvest the ceiling opportunistically</span> — bake in the safer bracket (24%) as your baseline, and convert into 32–37% only in years with clearly favorable circumstances (bear market, unusually low income, pre-SS window closing, pre-widow bracket compression).</li>
            <li><span className="font-medium text-[#1A1A1A]">Stress-test with Monte Carlo</span> — the app&apos;s Monte Carlo tab runs 1,000+ market paths against each strategy. If the aggressive plan holds up at the 5th percentile, you&apos;re not just chasing the median.</li>
          </ul>
        </div>

        <p className="text-[11px] text-muted-foreground italic pt-1">
          The sweep&apos;s deterministic leader uses your assumed real return every year. The rankings are only as reliable
          as those assumptions — but their <em>direction</em> (convert aggressively when the heir rate exceeds your
          current rate and the horizon is long) is robust to most reasonable return paths.
        </p>
      </div>
    </details>
  );
};

export default AggressiveStrategyExplainer;
