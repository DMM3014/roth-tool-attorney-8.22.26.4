# Why Simplified Roth‑Conversion Calculators Get the Funding Decision Wrong

### Preferential Income, the Step‑Up in Basis, and What the Model Actually Shows: The Conversion Is First‑Order, the Ceiling Is the Heirs' Rate — the Rest Is Sensitivity

*Second edition (draft). A white paper of the Roth Conversion & Retirement Planner. Educational analysis, not tax or legal advice. Figures should be verified against current IRS tables. Assumes current federal law following the One Big Beautiful Bill Act of 2025 (OBBBA), which made the TCJA individual brackets permanent and inflation‑indexed.*

---

## What Changed in This Edition

The first edition made the doctrinal case — from the Code, IRS guidance, and the research literature — that single‑rate calculators mis‑price the conversion decision. This edition tests that doctrine **against the planner's own engine** and revises the paper where the numbers disagree with the slogans:

1. **A new empirical section (§5)** reports full model runs on a representative $13M household, quantifying each lever — disciplined by two sensitivity analyses (§5.5 realization behavior, §5.7 market risk).
2. **The conversion policy is the first‑order decision, and the only robust one.** Bracket‑managed conversions add **+$16.3M (+13%)** to what heirs keep under the model's default assumptions — and **+$9.3M (+6.6%)** even if the heirs never realize a single post‑death gain.
3. **The funding‑order recommendation is demoted — twice.** The first edition argued for spending the IRA and preserving the taxable account. The model first showed the reverse order winning on the ten‑year metric (§5.3–5.4) — and then showed that verdict *flipping back* when post‑death gains are assumed never realized (§5.5). A ≤1.5% lever whose sign depends on the heirs' unknowable behavior is a preference, not a rule.
4. **The step‑up is a snapshot; the Roth is permanent (§5.4) — but the snapshot's value depends on whether the heirs ever sell.** §1014 erases the tax on appreciation up to death; whether the *next* decade of taxable growth is ever taxed is the pivotal assumption, so this edition reports both bounds.
5. **The measurement horizon changes the answer (§5.3).** Ranked at the date of the second death, the IRA‑first order wins. Ranked ten years later — after the SECURE drawdown and post‑death compounding — the rankings reverse. A paper that argues for the ten‑year metric must also accept its verdicts.
6. **The "common rate" ceiling is now demonstrated, not asserted (§5.6).** Converting *above* the heirs' ~31.65% ordinary rate loses under **both** realization assumptions; where the optimum sits *within* the band below it does not.
7. **A risk analysis is added (§5.7).** Monte Carlo shows converting to the heirs' rate does not raise ruin risk — but its expected edge is small, sign‑uncertain, front‑loaded, and irreversible. The recommendation: program the comfortable bracket, harvest the higher band opportunistically.

---

## Executive Summary

The most widely distributed retirement‑planning tools — including the free Roth‑conversion calculators offered by large custodians such as Fidelity and Schwab — reduce a genuinely multi‑dimensional decision to a single comparison: the retiree's current marginal tax rate versus an assumed future marginal rate. That simplification systematically biases the recommendation and hides the levers that actually move family wealth.

This paper argues, on the basis of the Internal Revenue Code, IRS guidance, peer‑reviewed and practitioner research, **and full simulations from the planner's own tax engine**, that the single‑rate framing is structurally flawed in three ways. It (1) conflates ordinary income with preferentially‑taxed qualified‑dividend and long‑term‑capital‑gain (LTCG) income; (2) ignores the §1014 step‑up in basis and — equally important — mis‑weights it, because the step‑up shields only pre‑death appreciation; and (3) cannot see that a household's *spending withdrawals* and its *Roth conversions* compete for the same ordinary‑income bracket headroom each year.

Correctly framed, the key variable is **not** "the retiree's current vs. future rate." It is whether the **family pays the ordinary‑income tax embedded in the traditional IRA at the couple's own controlled, bracket‑managed rates during their lifetimes, or leaves a large pre‑tax IRA to heirs** who must empty it within ten years under the SECURE Act — frequently during the heirs' peak earning years, stacked on top of their wages at 32–37% marginal rates. In the model's base case, doing nothing left the heirs a **$12.9M IRA carrying a $5.6M income‑tax liability**; a disciplined conversion program cut that liability to **$2.0M** and raised what the heirs actually keep, ten years after the second death, from **$126.1M to $142.4M**.

---

## Premises of This Analysis

**The core premise: parents should pay the tax on their own IRA at controlled rates during their lifetimes, rather than leave that liability to children who will pay it at higher rates.** Two conditions make this true for most successful savers:

1. **Heirs pay a higher rate than the parents.** Successful families' children usually earn at least average incomes and inherit the IRA during their own peak earning years (50s–60s). Under the SECURE 10‑year rule those distributions are taxed as ordinary income on top of their wages — often at **32–37%**, above the parents' controlled lifetime rate. The model's default heirs pay a blended **31.65% ordinary rate** and a **23.45% rate on dividends and long‑term gains** (20% top LTCG bracket plus the 3.8% NIIT).

2. **Conventional calculators miss this.** The Roth tools from firms like **Fidelity and Schwab** don't separate preferential LTCG and qualified‑dividend income (0/15/20%) from ordinary IRA income, so they can neither price the heirs' liability nor the benefit of managing it — which this planner measures as the after‑tax inheritance to heirs **ten years after the second death**.

## 1. The Problem: Single‑Rate Simplification

Mainstream consumer Roth‑conversion calculators typically ask for two numbers — a current marginal tax rate and an assumed future/retirement marginal rate — and then report a break‑even. This is useful for building awareness, and it captures the first‑order insight (convert when your rate today is lower than your expected rate later). But it treats the household's portfolio as a single pre‑tax bucket and, in doing so, omits five factors that materially change the answer:

- The **character** of income (ordinary vs. preferential).
- The **cost basis** of taxable assets and the **§1014 step‑up** at death.
- **Asset location** and the source of funds used to pay spending and the conversion tax.
- The **SECURE Act 10‑year rule** and the tax rate of the *heirs* who ultimately inherit a pre‑tax IRA.
- The **competition for bracket headroom**: every dollar of ordinary income spent from the IRA is a dollar that cannot be converted at the same rate that year.

Michael Kitces' detailed "arithmetic of Roth conversions" analysis shows that simplified break‑even framing routinely misstates the true benefit precisely because it ignores where the tax is paid from and what that funding source costs.[^3]

## 2. Three Structural Errors

### 2.1 Conflating ordinary income with preferential income

Qualified dividends and long‑term capital gains are taxed under a **separate, preferential schedule of 0%, 15%, and 20%**, stacked *on top of* ordinary taxable income — not at ordinary rates that reach 37%.[^6] High‑income households may also owe the **3.8% Net Investment Income Tax** on that same investment income.[^7] A model that lumps all income into one bucket at one rate mis‑prices *both* sides of the decision: it overstates the cost of holding appreciated taxable assets and understates the value of managing ordinary income (conversions, IRA distributions) against the preferential stack.

This separation also exposes a channel single‑rate tools never see: **a large taxable account is itself a recurring tax liability.** At the model's 2% qualified‑dividend yield, a $35–45M taxable account throws off $700k–$900k of preferential income every year, which is taxed annually, feeds the NIIT, and raises IRMAA surcharges. Part of the measured benefit of conversions is simply that assets sheltered in the Roth stop generating this drag. The separation of ordinary income from LTCG/dividend income is not a refinement — it is fundamental to pricing the trade‑off correctly.

### 2.2 Ignoring the §1014 step‑up in basis

Under **IRC §1014**, property acquired from a decedent takes a basis equal to its fair market value at the date of death — **permanently eliminating the capital‑gains tax on all appreciation during the owner's lifetime**.[^4] In the nine community‑property states, **§1014(b)(6)** steps up **100%** of the community property (not merely the decedent's half) at the first spouse's death; in common‑law states, jointly‑held property receives a step‑up only on the decedent's half.[^4]

Crucially, **§1014(c) denies the step‑up to "income in respect of a decedent," which includes traditional IRAs and 401(k)s.**[^4] Retirement accounts carry their deferred ordinary‑income tax through to the heirs; taxable brokerage assets do not.

But the step‑up must be weighed correctly, and the first edition of this paper over‑weighted it. **The step‑up is a snapshot: it erases the gain accrued up to the date of death and nothing after.** From the moment of inheritance, the stepped‑up taxable account resumes generating taxed dividends and accruing gains the heirs will owe LTCG on, while an inherited Roth compounds entirely tax‑free for the full ten‑year SECURE window. Which effect dominates is an empirical question — one the model answers in §5.

### 2.3 Missing the bracket‑headroom competition between spending and converting

The correct general rule is well established: **pay the conversion tax from outside funds, not by withholding from the IRA**, so that 100% of the converted amount lands in the Roth and compounds tax‑free.[^3] The literature attaches a caveat — outside funds with large unrealized gains trigger LTCG (and possibly NIIT) the step‑up would otherwise have erased[^3] — and the first edition of this paper elevated that caveat into a rule: preserve the taxable account, spend the IRA.

The model reveals what that rule misses. **Spending withdrawals from the IRA and Roth conversions compete for the same ordinary‑bracket headroom.** In a bracket‑managed plan, every dollar of ordinary income drawn from the IRA to fund living expenses crowds out a dollar of conversion at that same controlled rate — and the crowded‑out dollar ends up either converted later at a worse time, taxed to the heirs, or trapped in the taxable account generating annual dividend drag. Meeting spending from the taxable account instead realizes gains at **preferential** rates (15/20% + NIIT) while freeing the **ordinary** brackets for conversions. Character separation is exactly what makes this arbitrage visible: *spend the cheap bucket, convert the expensive one.* Whether the headroom effect ultimately outweighs the forfeited step‑up, however, depends on what the heirs do after inheriting — §5 tests both assumptions rather than declaring a winner by slogan.

## 3. Two Forces Every Conversion Analysis Must Balance

Every credible Roth‑conversion analysis is a contest between two forces, and the optimum lives where they meet.

### 3.1 The case for converting early and aggressively

The first force favors converting as much as possible, as early in retirement as possible. Dollars moved into a Roth compound **tax‑free** for the rest of the owners' lives and for the full ten‑year window the heirs then hold the account — so the earlier a conversion happens, the longer that tax‑free compounding runs. The low‑income years between retirement and the onset of Social Security and RMDs are the natural window to do this, deliberately filling the 22%–24% brackets.[^1]

### 3.2 The ceiling: the "common rate" between the couple and their heirs

The second force sets a ceiling on that enthusiasm. A conversion only creates value when the rate the couple pays today is no higher than the rate that would otherwise apply when the money is eventually taxed — for most successful savers, the rate their **heirs** will pay. There is therefore an assumed **common rate** — the equilibrium between the couple's controlled lifetime rate and the heirs' expected ordinary rate — and **conversions pushed above that common rate destroy value rather than create it.** A couple that has raised successful, high‑earning children faces heirs in the 32%–37% brackets; that high heir rate *raises* the common rate and so justifies *more* conversion — but only up to it, never above it. §5.5 shows this ceiling emerging from the model itself.

## 4. The Correct Framing: Whose Rate Pays the IRA's Tax?

A traditional IRA is best understood as a **deferred ordinary‑income liability held jointly with the U.S. Treasury.** The relevant question is not the retiree's current‑vs‑future rate; it is **who eventually pays the ordinary tax on those dollars, and at what rate:**

- **The couple, during their lifetimes**, converting (or drawing) at *controlled, bracket‑filled rates* in low‑income years before Social Security and RMDs;[^1] **or**
- **The heirs**, who under the **SECURE Act of 2019 must fully distribute an inherited traditional IRA within ten years**, with every dollar taxed as **ordinary income**.[^5] Adult children commonly inherit in their 50s and 60s — their **peak earning years** — so those distributions stack on top of existing wages and are frequently taxed at **32%, 35%, or 37%.**[^5]

This is consistent with the peer‑reviewed record. Cook, Meyer, and Reichenstein show that early tax‑deferred drawdown and Roth conversions that fill low brackets can extend portfolio longevity by roughly **two to three years** relative to the conventional "spend taxable first" ordering.[^1][^2] Vanguard's advisor research similarly finds the value of well‑structured conversions is routinely larger than clients expect once bracket management and heirs are considered.[^9]

## 5. What the Model Shows: An Empirical Case Study

*New in this edition.* The planner's engine — which separates ordinary from preferential income, tracks per‑account cost basis, applies the §1014 step‑up, models IRMAA and the NIIT, and simulates the heirs' 10‑year SECURE drawdown at their own rates — was run on its representative base household:

> **Base household.** Married couple, ages 61/60 in 2026, planned to ages 91/96 (second death 2062, a 37‑year horizon). Starting assets ≈ **$13.0M**: $1.0M cash, $6.0M taxable brokerage with a $2.0M basis (**67% embedded gain**), $5.0M traditional IRA, $0 Roth, $1.0M residence. Final wages through 2027, pensions, and Social Security claimed 2028/2032. Core spending $240k/yr plus medical, inflated 3%. State tax 3.99%; IRMAA modeled. Heirs: **31.65%** ordinary, **23.45%** dividend/LTCG; 1% estate settlement; step‑up applied at death; 10‑year SECURE horizon. Conversions, when enabled, are bracket‑managed (fill to target bracket, stop at RMD age), with the conversion tax and spending funded per the stated order. Dollar figures are nominal model outputs, not present values.

| Strategy | Converted | IRA at 2nd death | Roth at 2nd death | Household lifetime taxes | Heir tax on inherited IRA | After‑tax estate at death | **After‑tax to heirs (+10 yr)** |
|---|---|---|---|---|---|---|---|
| **A. No conversions** (either order) | $0 | $12.91M | $0 | $12.68M | $5.64M | $75.29M | **$126.09M** |
| **B. Convert to 24% · spend taxable first** | $5.69M | $4.61M | $40.09M | $7.44M | $2.02M | $78.59M | **$142.43M** |
| **C. Convert to 24% · spend IRA first** | $3.89M | $4.52M | $29.47M | $7.77M | $1.98M | $79.18M | **$140.35M** |
| **D. Convert to 32% · spend taxable first** | $7.56M | $1.60M | $53.99M | $6.24M | $0.70M | $77.43M | **$144.20M** |
| **E. Convert to 35% · spend taxable first** | $7.22M | ≈$0 | $61.12M | $5.53M | $0 | $76.11M | **$143.89M** |

*(A 50/50 split order lands between B and C on every metric.)*

### 5.1 The conversion policy is the first‑order lever

Moving from no conversions (A) to a bracket‑managed program (B) raised the heirs' ten‑year after‑tax inheritance by **+$16.3M (+13.0%)** — and, counter to intuition, *also cut the household's own cumulative lifetime taxes from $12.68M to $7.44M*, because assets sheltered in the Roth stopped generating taxed dividends, taxable RMDs, NIIT, and IRMAA surcharges for decades. Doing nothing is the expensive strategy on **both** generations' tax bills.

### 5.2 The heirs' liability is the headline number

Unconverted, the IRA compounds to **$12.9M** at the second death and — because §1014(c) denies it any step‑up — arrives as a **$5.64M ordinary‑income tax bill** for children already earning at 32%+ rates. The 24% program cuts that bill to **$2.0M**; the 32% program to **$0.7M**. This is precisely the transfer of the tax from the heirs' 31.65% rate to the parents' controlled 24–32% rates that §4 frames — now with its dollar value attached.

### 5.3 The measurement horizon changes the funding‑order answer

Compare B and C — identical conversion policy, opposite funding order. Ranked **at the date of the second death**, the IRA‑first order (C) wins: $79.18M vs. $78.59M. Ranked **ten years later**, after the SECURE drawdown and post‑death compounding, the ranking **reverses**: taxable‑first (B) delivers $142.43M vs. $140.35M, a **+$2.08M (+1.5%)** advantage. An at‑death snapshot — the metric most tools report, when they report an estate value at all — points to the wrong funding order. The heirs do not receive a snapshot; they receive ten more years of differentially‑taxed compounding. (Whether that compounding is ever taxed at all is the subject of §5.5.)

### 5.4 Why taxable‑first wins under full realization: the step‑up is a snapshot, the Roth is permanent

Three mechanisms drive the reversal, all visible only to a character‑aware, basis‑aware model:

1. **Bracket headroom is reallocated from spending to converting.** With spending met from the taxable account, the 24%‑bracket program converts **$5.69M**; when spending consumes the IRA (and its ordinary headroom) first, only **$3.89M** gets converted. The Roth at the second death is **$40.1M vs. $29.5M**.
2. **Spending is paid with preferential dollars.** Realizing taxable gains for spending costs 15/20% + NIIT — cheaper than the ordinary rates the same spending costs when drawn from the IRA. Lifetime household taxes are *lower* under taxable‑first ($7.44M vs. $7.77M) even though it converts $1.8M more.
3. **Post‑death, the Roth outruns the stepped‑up taxable account.** Both runs deliver a stepped‑up taxable sleeve at death. But over the following decade the heirs' taxable assets grow net of a 2% qualified‑dividend drag at 23.45% and accrue LTCG on all post‑death appreciation, while the inherited Roth compounds fully tax‑free. The Roth‑heavy mix (B: 54.8% Roth / 41.2% non‑retirement) therefore finishes ahead of the taxable‑heavy mix (C: 40.9% / 55.2%).

The revised principle: **the §1014 step‑up erases the past; the Roth protects the future.** In this base case — even with 67% embedded gains — ten years of tax‑free compounding plus the headroom effect outweighed the forfeited step‑up. But the margin (~1.5%) rests entirely on an assumption the model's default makes silently: that the heirs' accrued gains are *realized* at the end of the horizon. That assumption deserves its own section.

### 5.5 Sensitivity: what if the heirs never sell?

The model's default charges the heirs' 23.45% LTCG rate against all post‑death appreciation at the end of the ten‑year horizon — as if the inherited taxable account were liquidated on the last day. That is a conservative bound, not a certainty: **post‑death gains are unrealized and may never be realized.** Heirs can hold the stepped‑up portfolio indefinitely, live on its dividends, borrow against it, or hold until their own deaths — when §1014 applies *again*. Re‑scoring every strategy with post‑death appreciation never taxed (annual dividend taxes still apply — those are actually distributed) brackets the truth:

| Strategy | To heirs (+10 yr) · gains realized (default) | To heirs (+10 yr) · gains never realized |
|---|---|---|
| A. No conversions | $126.09M | $140.57M |
| B. Convert to 24% · spend taxable first | $142.43M | $149.84M |
| C. Convert to 24% · spend IRA first | $140.35M | **$150.07M** |
| D. Convert to 32% · spend taxable first | **$144.20M** | $148.69M |
| E. Convert to 35% · spend taxable first | $143.89M | $146.72M |

Three conclusions survive the assumption change; two do not:

- **Survives — convert.** The program beats no conversions by **+$16.3M (+13.0%)** under full realization and **+$9.3M (+6.6%)** if no gain is ever realized. (No‑realization flatters the do‑nothing strategy most — its huge taxable account receives the largest forgiveness — and it still loses decisively.)
- **Survives — never convert above the common rate.** The 35% target trails the 32% target under *both* assumptions.
- **Survives — the heirs' IRA bill.** The $5.64M → $2.0M liability transfer is untouched: §1014(c) never shelters the IRA, under any behavioral assumption.
- **Does not survive — the funding order.** Taxable‑first wins by $2.08M under full realization; IRA‑first wins by $0.22M under none. A lever whose sign depends on the heirs' unknowable behavior, with magnitude ≤1.5%, should be chosen on liquidity, simplicity, and basis diversification — not sold as a wealth‑maximization rule.
- **Does not survive — 32% over 24%.** The +$1.78M edge becomes −$1.15M. Where the optimum sits *within* the band between the couple's comfortable bracket and the heirs' rate depends on what the heirs do with the taxable inheritance.

### 5.6 The common‑rate ceiling, located empirically

Sweeping the conversion target while holding everything else fixed traces the ceiling of §3.2 directly: filling to the **24%** bracket yields $142.43M to heirs; filling to **32%** — almost exactly the heirs' 31.65% blended rate — yields **$144.20M**, the maximum; pushing into the **35%** bracket *falls back* to $143.89M. Converting up to the common rate creates value; converting through it prepays tax at a rate the family never needed to pay. Note also that the at‑death estate metric is *monotonically misleading* here — it prefers less conversion at every step (B $78.59M > D $77.43M > E $76.11M) even as the heirs' actual outcome improves through D. Only the ten‑year metric sees the optimum. What is robust is the *ceiling* — converting through the heirs' rate loses under both of §5.5's bounds; the exact within‑band optimum is not, which is why §5.7 treats the top of the band as an option rather than a program.

### 5.7 Is converting at the heirs' rate worth the risk?

Converting to the 32% bracket front‑loads real tax dollars: **$902k vs. $689k over the plan's first five years (+31%)**, $2.31M vs. $1.75M over ten. Money paid to the Treasury early is a certain cost set against uncertain future growth — and, since the TCJA repealed recharacterization, **a Roth conversion cannot be undone**.[^11] The natural worry: if markets fall after aggressive conversion, the family has prepaid 32% tax on wealth that evaporated.

The planner's Monte Carlo engine puts numbers on that worry — 1,000 seed‑matched trials, so both strategies face *identical* market paths:

| | 24% target | 32% target |
|---|---|---|
| Plan success (never depleted) | 98.4% | 98.7% |
| Ending liquid assets, 5th percentile | $8.20M | $8.92M |
| Ending liquid assets, median | $75.39M | $73.42M |
| Ending liquid assets, mean | $108.4M | $105.3M |

Two honest readings coexist:

1. **Ruin risk does not increase.** Success is statistically identical and the *worst* outcomes are marginally better under 32%: prepaying the IRA's tax shrinks future mandatory outflows — RMDs, dividend drag, IRMAA — precisely in the states where the portfolio is weakest. For a household of this size, aggressive conversion is not a solvency risk. (These figures are nominal, pre‑tax, and character‑blind — a Roth dollar counts the same as an IRA dollar — so they *understate* the 32% run's true after‑tax position.)
2. **But the median household is slightly worse off, and the expected edge is fragile.** The median path surrenders ~$2M of ending assets, the deterministic edge is only +$1.78M (+1.2%), and §5.5 showed that edge flipping negative under the no‑realization bound.

The synthesis is not "avoid the 32% bracket" — it is **"don't program it":**

- **Program the floor; harvest the ceiling opportunistically.** Run the standing plan at the comfortable bracket (24% here). Convert into the higher band *conditionally*: in down markets (the same shares convert at a lower dollar cost — a bear market is a conversion sale), in unusually low‑income years, or as the survivor's single‑filer bracket compression approaches.
- **A bracket‑managed annual program already is the "stretched" strategy.** The 24% plan spreads $5.7M of conversions over roughly a dozen years to RMD age — dollar‑cost averaging the tax basis. The 32% plan compresses more of it into the earliest, most sequence‑sensitive years.
- **Irreversibility favors the lower default.** An under‑converter can accelerate in any future year; an over‑converter can never claw back. When the expected edge is ~1% and sign‑uncertain, the option value of waiting dominates.

### 5.8 Limitations

These are nominal‑dollar results for one household under fixed assumptions. §5.5 and §5.7 bracket the two largest sensitivities — the heirs' realization behavior and market risk — but heir tax rates, tax‑law drift, state regimes, and longevity remain modeled only as fixed inputs. The strategy optimizer and Monte Carlo engine should be run per household rather than assuming this case study generalizes.

## 6. What a Defensible Model Must Do

A model fit to guide this decision — and the design of this planner — must:

1. **Separate ordinary income from preferential income**, stacking qualified dividends and LTCG at 0/15/20% plus the 3.8% NIIT, exactly as the Code does.[^6][^7]
2. **Track cost basis per account** and apply the **§1014 step‑up at death** — 100% in community‑property states, 100% of a decedent‑owned account, 50% of a common‑law joint account, 0% of a survivor‑owned account — while correctly denying any step‑up to IRAs (IRD).[^4]
3. **Model spending withdrawals and conversions as competitors for the same bracket headroom**, and let the planner choose the funding order for both spending and the conversion tax.
4. **Model the SECURE 10‑year inherited‑IRA drawdown at the heirs' ordinary rate — and the post‑death taxation of the heirs' dividends and capital gains at the heirs' preferential rates** — then measure the after‑tax value to heirs at the **end** of that window, not at the date of death.[^5]
5. **Assume current law** — the OBBBA‑2025 permanent, inflation‑indexed TCJA brackets — rather than a lapsed sunset.[^8]

## 7. Conclusion

Simplified, single‑rate Roth‑conversion calculators are a reasonable first screen, but they are not a planning engine. Because they cannot see income character, cost basis, the step‑up, or the heirs' tax rate, they cannot price the decision that actually moves family wealth. The model's own runs sharpen the first edition's doctrine into three ranked, quantified rules:

1. **Convert — this is the decision.** A bracket‑managed program raised the heirs' after‑tax inheritance by **+13.0%** under the model's default assumptions and **+6.6%** even if the heirs never realize a post‑death gain, cut the heirs' IRA tax bill from $5.64M to $2.0M, and lowered the household's own cumulative lifetime taxes from $12.68M to $7.44M. This conclusion survived every assumption tested.
2. **Respect the ceiling; program the floor.** Converting above the heirs' rate loses under both realization assumptions — the common‑rate ceiling is real. But within the band below it, the incremental edge of chasing the heirs' rate is small (~1%), sign‑uncertain, front‑loaded, and irreversible, while Monte Carlo shows no ruin‑risk penalty in either direction. The disciplined play: run the standing program at the comfortable bracket, and convert into the higher band opportunistically — in down markets, low‑income years, or ahead of the survivor's filing‑status compression.
3. **Treat the funding order and the step‑up as preferences, not theorems.** The ≤1.5% funding‑order gap flips sign with the heirs' realization behavior. The step‑up remains a powerful reason never to *gratuitously* realize gains — but it is a snapshot, not a talisman, and it is never a reason to leave the IRA's ordinary‑income liability to children in their peak earning years.

That is the decision this planner is built to model honestly — and, as of this edition, to measure.

---

## References

[^1]: Cook, K. A., Meyer, W., & Reichenstein, W. (2015). *Tax‑Efficient Withdrawal Strategies.* Financial Analysts Journal, 71(2), 16–29. https://ideas.repec.org/a/taf/ufajxx/v71y2015i2p16-29.html

[^2]: Reichenstein, W., & Meyer, W. (2020). *Tax‑Efficient Withdrawal Strategies.* Financial Planning Association. https://www.financialplanningassociation.org/sites/default/files/2020-09/Feb2020_Research_Reichenstein.pdf

[^3]: Kitces, M. (2023). *The Arithmetic of Roth Conversions* (and why to pay the tax from high‑basis outside funds; step‑up caveat). Journal of Financial Planning. https://www.financialplanningassociation.org/learning/publications/journal/MAY23-arithmetic-roth-conversions-OPEN

[^4]: 26 U.S. Code §1014 — Basis of property acquired from a decedent (incl. §1014(b)(6) community property 100% step‑up; §1014(c) exclusion of income in respect of a decedent such as IRAs). Cornell Legal Information Institute. https://www.law.cornell.edu/uscode/text/26/1014

[^5]: SECURE Act of 2019, 10‑year rule for most non‑spouse beneficiaries; distributions from an inherited traditional IRA taxed as ordinary income. IRS, Retirement Topics — Beneficiary. https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-beneficiary

[^6]: IRS, Topic No. 409, Capital Gains and Losses — long‑term capital gains and qualified dividends taxed at 0/15/20%. https://www.irs.gov/taxtopics/tc409

[^7]: IRS, Questions and Answers on the Net Investment Income Tax (3.8% on net investment income above MAGI thresholds). https://www.irs.gov/newsroom/questions-and-answers-on-the-net-investment-income-tax

[^8]: One Big Beautiful Bill Act of 2025 — permanence and continued inflation indexing of the TCJA individual income‑tax brackets and standard deduction. (See Tax Foundation and Tax Policy Center analyses.)

[^9]: Vanguard. *Roth conversions could offer more value than your clients expect.* https://advisors.vanguard.com/insights/article/roth-conversions-could-offer-more-value-than-your-clients-expect

[^10]: Fidelity. *Tax diversification and Roth conversions* (illustrative custodian guidance). https://www.fidelity.com/learning-center/personal-finance/tax-diversification-roth-conversion

[^11]: IRS, IRA FAQs — Recharacterization of IRA Contributions. Roth‑conversion recharacterization repealed for tax years beginning after 2017 (Tax Cuts and Jobs Act; IRC §408A(d)(6)(B)(iii)). https://www.irs.gov/retirement-plans/ira-faqs-recharacterization-of-ira-contributions
