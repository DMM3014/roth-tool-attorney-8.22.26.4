/**
 * Client Report — "The Estate + GST Case for Roth Conversions" narrative page.
 *
 * A prose-driven, advisor-voice page inserted BEFORE the numeric Estate Planning
 * page. It answers the WHY (why does this recommendation exist), so the client
 * can then turn the page and read the WHAT (the numeric strategy comparison).
 *
 * Content faithfully preserves the analytical framing the advisor wrote:
 *   1. The pre-conversion dilemma (conduit vs. accumulation, forced choice)
 *   2. Why conversion dissolves the dilemma
 *   3. The GST-portability asymmetry (not portable via DSUE)
 *   4. Trustee discretion (retain vs. DNI carry-out)
 *   5. Drafting cautions
 *   6. Closing recommendation (CFP + estate attorney in the same room)
 */
import React from "react";
import { Page, H2, H3, P, Sub } from "./helpers.jsx";

export const RothTrustNarrativePage = ({ ...footProps }) => (
  <Page testid="cr-page-roth-trust-narrative" {...footProps}>
    <H2>The Estate + GST Case for Roth Conversions</H2>
    <P>
      The next page (Estate Planning) compares four post-mortem structures side-by-side against your household&apos;s
      balances and shows the after-tax dollar differences. This page explains the reasoning behind the comparison — a
      narrative worth reading before the numeric outcomes, because the reasoning holds even in years when the
      point-estimate delta is modest, and because the reasoning is what your estate attorney will want to interrogate.
    </P>

    <H3>1. Trusts are terrible at receiving ordinary income</H3>
    <P>
      The core problem with trusts as retirement-account beneficiaries was never the trust structure itself — it&apos;s
      that <strong>trusts are terrible at receiving ordinary income</strong>. An accumulation trust hits the 37% + 3.8%
      NIIT ceiling at roughly <strong>$16,000 of retained income</strong>, so a Traditional IRA draining through the
      SECURE Act 10-year window into a trust converts a family&apos;s ordinary 24–36% tax problem into a ~41% one.
      Historically the workaround was <em>conduit</em> trust language — pass the distributions straight out to
      beneficiaries so they&apos;re taxed at individual rates — but that gutted the trust&apos;s purpose: under the
      10-year rule, a conduit trust must hand the entire IRA to the beneficiaries within a decade, which means no
      creditor protection, no divorce protection, no spendthrift control, and no GST leverage on those dollars.
      Pre-conversion, you faced a forced choice: <strong>tax efficiency (conduit) or asset control (accumulation),
      never both.</strong>
    </P>

    <H3>2. Conversion dissolves the dilemma</H3>
    <P>
      A Roth flowing to an <em>accumulation</em> trust still faces the 10-year payout — but the distributions
      <strong> arrive tax-free</strong>, so the compressed trust brackets have nothing to bite. The trustee then
      retains and reinvests the full proceeds behind the trust&apos;s protections. One nuance worth keeping in view:
      the tax-free character applies to the <em>Roth distributions themselves</em>. Once the money is reinvested inside
      the trust, the ongoing dividends, interest, and realized gains it generates are taxed at trust rates (37% federal
      ordinary / 20% federal LTCG above the ~$16K threshold) — <em>or</em> carried out to beneficiaries via DNI at
      their individual rates, at the trustee&apos;s discretion each year.
    </P>
    <P>
      The trustee&apos;s year-by-year math typically splits by income character. <strong>Ordinary income</strong> —
      dividends, interest, and other DNI — is best carried out to beneficiaries: the trust&apos;s 37% top ordinary
      bracket vs. a beneficiary&apos;s 24–32% is a 5–13 point saving on every dollar (and larger still — sometimes
      double-digit — when the beneficiary is an adult child in peak-earning years with substantial W-2 or business
      income). <strong>Capital gains</strong>, by contrast, are usually <em>retained</em>: the trust&apos;s 20% top LTCG
      rate is only about 5 points above the individual 15% LTCG rate, so the retention penalty is small relative to the
      creditor protection, spendthrift control, and continued tax-advantaged compounding gained by keeping the corpus
      intact. That split — distribute ordinary, retain LTCG — is itself a form of control the conduit structure never
      offered: the trustee can steer income to whichever return (trust or beneficiary) taxes it lightest, year by year,
      character by character.
    </P>

    <H3>3. The GST asymmetry — DSUE portability does NOT cover the GST exemption</H3>
    <P>
      A frequently overlooked technical point compounds the case for building a bypass/GST trust at the first death
      rather than relying on portability. The <strong>estate tax exemption</strong> ($15M in 2026 under OBBBA, chained-CPI
      indexed) IS portable via DSUE — a timely-filed Form 706 lets the surviving spouse claim the decedent&apos;s
      unused exclusion. The <strong>GST exemption</strong>, however, <em>is not portable</em>. If the first spouse to
      die leaves everything to the surviving spouse via marital deduction and no GST-exempt trust is funded at that
      first death, <strong>the entire first-death GST exemption is not utilized</strong> and cannot be recovered
      later. Creating a bypass/GST
      trust at the first death — and allocating the decedent&apos;s GST exemption to it — is the standard workaround:
      the trust becomes a permanently GST-exempt vehicle that shelters every subsequent generation&apos;s transfers
      from the 40% GST tax, and does so <em>on top of</em> the estate-tax shelter. For families expecting to transfer
      wealth to grandchildren, preserving both spouses&apos; GST exemptions is often more valuable than the estate-tax
      saving reflected in the headline strategy delta.
    </P>

    <H3>4. Why this compounds over multi-decade horizons</H3>
    <P>
      Because the trust receives the Roth at the first spouse&apos;s death using their exemption(s), all subsequent
      growth compounds <em>outside</em> every later estate — the survivor&apos;s, the children&apos;s, potentially the
      grandchildren&apos;s. This is where the dynasty math gets genuinely large: even at a modest 6–7% real growth
      rate, an amount that starts as a modest fraction of the estate exemption today becomes an outsized fraction of
      the family&apos;s wealth two or three generations from now — all of it having escaped estate tax at every death
      along the way, and (during each successive SECURE 10-year window) income-tax free as well.
    </P>

    <H3>5. What this means for the conversion program</H3>
    <P>
      Every dollar converted before death is a dollar that can go to the trust with <strong>full control AND full tax
      efficiency</strong>. Every un-converted Traditional dollar forces the old bad choice at death — spousal rollover
      (deferral but no trust protection and back into the survivor&apos;s estate) or trust funding at punitive
      compressed rates. This retroactively strengthens the case for finishing conversions before the first death, and
      for opening the 32% relief valve in high-return futures: the conversion program isn&apos;t just about lifetime
      tax arbitrage — it&apos;s what determines how much of the family&apos;s wealth can eventually be routed to a
      trust with both control and efficiency intact.
    </P>

    <H3>6. Practical drafting cautions</H3>
    <P>
      The sequencing and drafting must match the strategy for it to deliver the promised benefits:
    </P>
    <ul style={{ fontSize: 10.5, lineHeight: 1.6, color: "#1A1A1A", paddingLeft: 18, marginTop: 4, marginBottom: 8 }}>
      <li style={{ marginBottom: 4 }}>
        The trust needs <strong>accumulation</strong> (not conduit) language for the Roth strategy to deliver the
        control benefits — a conduit trust forces the 10-year distributions out to beneficiaries and defeats the
        whole point.
      </li>
      <li style={{ marginBottom: 4 }}>
        The beneficiary designation forms at each custodian have to name the trust with the <strong>disclaimer
        cascade correctly ordered</strong> (surviving spouse as primary, trust as contingent) so that whatever is
        unconverted at first death still has a viable routing path.
      </li>
      <li style={{ marginBottom: 4 }}>
        The trust should qualify as a <strong>see-through trust</strong> so the 10-year (rather than 5-year) window
        applies to any inherited retirement account.
      </li>
      <li style={{ marginBottom: 4 }}>
        Form 706 <strong>Schedule R</strong> must correctly allocate the decedent&apos;s GST exemption to the trust
        at the first death — this is the mechanical step that makes the trust permanently GST-exempt.
      </li>
    </ul>

    <div style={{ padding: 12, background: "#F1F5EF", border: "1px solid #4A6741", borderRadius: 6, marginTop: 10 }}>
      <p style={{ fontSize: 10.5, lineHeight: 1.55, color: "#1A1A1A", margin: 0 }}>
        <strong>The single recommendation to hold onto most firmly:</strong> whatever else changes in this plan, get
        your CFP and your estate attorney in the same room with the current beneficiary-designation forms on the
        table. Model outputs and trust documents can silently diverge; that meeting is the one that reconciles them.
      </p>
    </div>

    <Sub>
      This narrative is an <em>advisory framing</em> of the numeric analysis on the following page — not tax or legal
      advice. Estate and GST tax rules, especially state-level variations, community-property titling, and Rule
      Against Perpetuities considerations, vary materially by jurisdiction. Consult a qualified estate-planning
      attorney before implementing any of the strategies discussed.
    </Sub>
  </Page>
);
