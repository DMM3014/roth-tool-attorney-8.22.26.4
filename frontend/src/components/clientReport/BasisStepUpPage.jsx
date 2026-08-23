/**
 * Client Report — Basis Step-Up Comparison page.
 *
 * Shows the after-tax value of each account type at second death to demonstrate
 * why the Roth is uniquely powerful to leave to heirs and why converting
 * Traditional to Roth during life is a step-up-preservation win:
 *
 *   ROTH        — $1 in → $1 out to heirs DURING the SECURE Act 10-year
 *                 distribution window. During that window the Roth wrapper
 *                 continues to compound income-tax free. After year 10 the
 *                 wrapper terminates; if distributed to individual heirs, their
 *                 marginal rate applies to subsequent income. If retained in
 *                 trust, compressed trust rates (37% above ~$16K) apply on
 *                 retained income — favoring DNI carry-out and in-kind
 *                 distribution of appreciated assets to beneficiaries in
 *                 lower brackets. §1014 step-up doesn't apply because
 *                 pre-distribution the Roth is already income-tax free.
 *   TAXABLE     — Full §1014 step-up at each death (in-estate). Heirs receive
 *                 FMV basis, can sell without capital gains on unrealized gains.
 *                 So $1 in → $1 out (assuming they sell at that FMV).
 *   TRADITIONAL — NO step-up. Heirs inherit IRD (Income in Respect of Decedent),
 *                 draw down over SECURE Act 10-year window at their ordinary
 *                 rate. $1 in → $(1 - heir_marginal_rate) out.
 */
import React from "react";
import { Page, H2, H3, P, Sub } from "./helpers.jsx";
import { fmtUSD, fmtPct } from "@/lib/api";
import { TRUSTEE_DISTRIBUTION_NOTE } from "@/lib/rothTrustCaveat";

export const BasisStepUpPage = ({ scenario, rows, ...footProps }) => {
  if (!rows || rows.length === 0) {
    return (
      <Page testid="cr-page-basis-stepup" {...footProps}>
        <H2>Basis Step-Up Comparison</H2>
        <P>Projection unavailable — set the household DOBs and life expectancies on Plan Inputs.</P>
      </Page>
    );
  }
  const h = scenario?.household || {};
  // Blended heir ordinary rate = federal + state. Prior versions of this page
  // read ONLY `heir_federal_rate` (32%), which is why page 12 disagreed with
  // pages 2 & 9 (36% blended). Fixed to add both — matches every other estate
  // page and matches how the projection engine internally computes heir_ord_rate.
  const heirFed = scenario?.legacy?.heir_federal_rate ?? 0.32;
  const heirState = scenario?.legacy?.heir_state_rate ?? 0.04;
  const heirRate = heirFed + heirState;
  const ltcgRate = 0.15;
  const fundingOrder = scenario?.withdrawal?.funding_order || "Cash → IRA → Taxable → Roth";

  // Death years — final row is the second death.
  const clientDeath = (h.client_dob_year && h.client_life_expectancy) ? h.client_dob_year + h.client_life_expectancy : null;
  const spouseDeath = (h.spouse_dob_year && h.spouse_life_expectancy) ? h.spouse_dob_year + h.spouse_life_expectancy : null;
  const firstYr = (clientDeath && spouseDeath) ? Math.min(clientDeath, spouseDeath) : (clientDeath || spouseDeath);
  const secondYr = (clientDeath && spouseDeath) ? Math.max(clientDeath, spouseDeath) : (clientDeath || spouseDeath);

  const rowAt = (yr) => rows.find((r) => r.year >= yr) || rows[rows.length - 1];
  const y1 = rowAt(firstYr);
  const y2 = rowAt(secondYr);

  // For each account type at Y2, compute:
  //   Nominal value | After-tax to heirs
  const roth_y2 = y2?.roth || 0;
  const taxable_y2 = y2?.taxable || 0;
  const trad_y2 = y2?.traditional || 0;

  // After-tax by account type:
  const roth_after = roth_y2;  // no tax, no step-up needed
  const taxable_after = taxable_y2;  // full step-up (survivor's estate) → 100% to heirs
  const trad_after = trad_y2 * (1 - heirRate);  // no step-up, heirs pay ordinary rate

  const total_nominal = roth_y2 + taxable_y2 + trad_y2;
  const total_after = roth_after + taxable_after + trad_after;
  const tax_drag = total_nominal - total_after;
  const drag_pct = total_nominal > 0 ? tax_drag / total_nominal : 0;

  // What if the entire Traditional balance had been converted to Roth during life?
  // (Nominal comparison — doesn't model the conversion tax cost, but shows the
  // "how much basis step-up power is being wasted by holding Traditional?" gap.)
  const if_all_roth_after = roth_y2 + taxable_y2 + trad_y2;  // no heir tax
  const roth_conversion_upside = if_all_roth_after - total_after;

  return (
    <Page testid="cr-page-basis-stepup" {...footProps}>
      <H2>Basis Step-Up Comparison</H2>
      <P>
        This page shows the <strong>after-tax value to heirs</strong> of each account type at second death.
        The story: <strong>Roth is uniquely powerful</strong> to leave to heirs because it is income-tax free
        <em> during the SECURE Act 10-year distribution window</em> that follows death (§1014 step-up is unnecessary
        while the Roth wrapper is in force). Taxable accounts get a full basis step-up at each death, so heirs can
        sell without capital gains. Traditional IRA / 401(k) balances have <strong>no step-up</strong> — heirs inherit
        the deceased&apos;s cost basis (Income in Respect of Decedent) and must pay ordinary income tax on distributions
        over the same SECURE 10-year window.
      </P>
      <P>
        <em>Important trust caveat.</em> After the 10-year window the inherited Roth wrapper terminates. If the account
        passes to individual beneficiaries, subsequent income is taxed at their marginal rates. If it stays in an
        accumulation trust, <strong>retained trust income is taxed at compressed trust brackets (37% federal above
        ~$16,000/yr).</strong> Trustees typically distribute ordinary income (DNI carry-out) to beneficiaries in the
        year it arises and distribute appreciated assets in-kind so the beneficiary&apos;s lower marginal rate applies
        rather than the trust&apos;s 37% top bracket.
      </P>

      {/* Balances at Y2 by account type */}
      <H3>Balances at Y{secondYr} (second death)</H3>
      <table style={{ width: "100%", fontSize: 10, marginBottom: 8, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid #4A6741", background: "#F9F8F6" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Account type</th>
            <th style={{ padding: 6, textAlign: "right" }}>Balance</th>
            <th style={{ padding: 6, textAlign: "center" }}>§1014 step-up?</th>
            <th style={{ padding: 6, textAlign: "right" }}>Heir tax rate</th>
            <th style={{ padding: 6, textAlign: "right" }}>Net to heirs</th>
            <th style={{ padding: 6, textAlign: "right" }}>Tax drag</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: "1px solid #F3F1EC", background: "#F1F5EF" }}>
            <td style={{ padding: 6, fontWeight: 700, color: "#4A6741" }}>Roth IRA / Roth 401(k)</td>
            <td style={{ padding: 6, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(roth_y2)}</td>
            <td style={{ padding: 6, textAlign: "center", color: "#4A6741" }}>N/A — Roth wrapper</td>
            <td style={{ padding: 6, textAlign: "right", color: "#4A6741", fontWeight: 700 }}>0%*</td>
            <td style={{ padding: 6, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#4A6741" }}>{fmtUSD(roth_after)}</td>
            <td style={{ padding: 6, textAlign: "right", color: "#4A6741" }}>—</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: 6, fontWeight: 700 }}>Taxable brokerage</td>
            <td style={{ padding: 6, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(taxable_y2)}</td>
            <td style={{ padding: 6, textAlign: "center", color: "#4A6741" }}>YES — full step-up</td>
            <td style={{ padding: 6, textAlign: "right", color: "#4A6741", fontWeight: 700 }}>0%*</td>
            <td style={{ padding: 6, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmtUSD(taxable_after)}</td>
            <td style={{ padding: 6, textAlign: "right" }}>—</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #F3F1EC", background: "#FEFAF1" }}>
            <td style={{ padding: 6, fontWeight: 700, color: "#8A5A20" }}>Traditional IRA / 401(k)</td>
            <td style={{ padding: 6, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUSD(trad_y2)}</td>
            <td style={{ padding: 6, textAlign: "center", color: "#B84A4A" }}>NO — no step-up</td>
            <td style={{ padding: 6, textAlign: "right", color: "#B84A4A", fontWeight: 700 }}>{fmtPct(heirRate)}</td>
            <td style={{ padding: 6, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#8A5A20" }}>{fmtUSD(trad_after)}</td>
            <td style={{ padding: 6, textAlign: "right", color: "#B84A4A", fontWeight: 700 }}>−{fmtUSD(trad_y2 - trad_after)}</td>
          </tr>
          <tr style={{ borderTop: "2px solid #4A6741", background: "#F9F8F6" }}>
            <td style={{ padding: 6, fontWeight: 800 }}>Total investable accounts</td>
            <td style={{ padding: 6, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(total_nominal)}</td>
            <td colSpan={2}></td>
            <td style={{ padding: 6, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(total_after)}</td>
            <td style={{ padding: 6, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#B84A4A" }}>
              −{fmtUSD(tax_drag)} ({fmtPct(drag_pct)})
            </td>
          </tr>
        </tbody>
      </table>
      <Sub>
        * The 0% heir tax rate on the Roth applies to distributions <strong>during the SECURE Act 10-year window</strong>.
        After year 10 the wrapper is emptied; subsequent income is taxed at the beneficiary&apos;s rate (if distributed
        outright) or at compressed trust brackets (if retained in an accumulation trust). Taxable brokerage step-up
        assumes accounts are held OUTSIDE any irrevocable trust (in the surviving spouse&apos;s estate at Y{secondYr}).
        If any Taxable balance is inside a bypass or GST-exempt trust, that portion locks in its funding-date FMV
        as basis (§1014 step-up applies at the funding death, then no further step-ups) and heirs pay 15% federal
        LTCG on trust-internal appreciation from that date to eventual sale — see the Estate Planning page for the
        trust-strategy breakdown. <strong>Scope note:</strong> this table covers investable retirement and brokerage
        accounts only — the cash sleeve and family residence are excluded here (the home passes income-tax free with
        a full §1014 step-up, so it has no heir income-tax story). The EP Projection pages report the
        <em> gross estate</em>, which adds the projected Cash &amp; House balance to these investable accounts.
      </Sub>

      {/* The "Roth conversion opportunity" callout */}
      <H3>The Roth-conversion opportunity for heirs</H3>
      <div style={{ padding: 10, background: "#F1F5EF", border: "1px solid #4A6741", borderRadius: 6, marginBottom: 8 }}>
        <p style={{ fontSize: 10, lineHeight: 1.55, color: "#1A1A1A", margin: 0 }}>
          The <strong>{fmtUSD(trad_y2)}</strong> Traditional IRA balance at Y{secondYr} will lose
          <strong style={{ color: "#B84A4A" }}> {fmtUSD(trad_y2 - trad_after)}</strong> to heir&apos;s income taxes at
          the projected <strong>{fmtPct(heirRate)}</strong> marginal rate — <em>no step-up applies to pre-tax retirement
          accounts.</em> If that entire Traditional balance had been converted to Roth during the client&apos;s lifetime
          (paying the conversion tax up-front at potentially lower rates), the same $ would reach heirs as
          <strong style={{ color: "#4A6741" }}> {fmtUSD(trad_y2)}</strong> which compounds
          <strong> income-tax free through the SECURE 10-year window</strong> — a Roth conversion upside of
          <strong style={{ color: "#4A6741" }}> {fmtUSD(roth_conversion_upside)}</strong> in inheritance value
          (before subtracting the lifetime conversion tax).
        </p>
        <p style={{ fontSize: 10, lineHeight: 1.55, color: "#5A5A5A", margin: 0, marginTop: 6 }}>
          The Roth Analyzer tab quantifies this trade-off exactly — comparing lifetime conversion tax paid against
          the estate-tax + heir-drawdown-tax avoided.
        </p>
      </div>

      {/* Funding-order statement — states the engine's ACTUAL rule and the
          taxable-assets-fund-conversions insight; no alternative spending
          sequence is suggested anywhere in this report. */}
      <H3>How the projection funds spending &amp; conversions</H3>
      <div style={{ padding: 10, background: "#F9F8F6", border: "1px solid #EBE8E0", borderRadius: 6, marginBottom: 8 }}
           data-testid="cr-funding-order-statement">
        <p style={{ fontSize: 10, lineHeight: 1.55, color: "#1A1A1A", margin: 0 }}>
          Every projection in this report follows a single withdrawal rule — the funding order set on Plan Inputs:
          {" "}<strong>{fundingOrder}</strong>. No other spending sequence is assumed anywhere in this document.
        </p>
        <p style={{ fontSize: 10, lineHeight: 1.55, color: "#1A1A1A", margin: 0, marginTop: 6 }}>
          <strong>A note on paying for Roth conversions:</strong> in many situations, using <strong>taxable
          assets</strong> to fund Roth conversions — even if selling them realizes taxable capital gains — can
          produce <strong>larger Roth IRA balances passing to heirs</strong>, because dollars kept inside the IRA
          convert to Roth instead of being consumed by the tax bill. The Roth Analyzer&apos;s funding-order
          refinement quantifies this trade-off on this plan.
        </p>
        <p style={{ fontSize: 10, lineHeight: 1.55, color: "#5A5A5A", margin: 0, marginTop: 6 }}>
          Qualified Charitable Distributions (QCDs) can send up to <strong>$111,000</strong> per taxpayer per year
          (2026, IRS-indexed) directly from a Traditional IRA to charity — counting toward the RMD dollar-for-dollar
          and excluded from AGI.
        </p>
      </div>
      <Sub>
        Sensitivities: SS provisional-income cliffs, IRMAA tiers, and NIIT bumps can shift the year-by-year optimum —
        the Roth Analyzer sweeps these edges. {TRUSTEE_DISTRIBUTION_NOTE}
      </Sub>

      {/* Legal caveat */}
      <div style={{ marginTop: 10, padding: 10, background: "#FAFAF8", border: "1px solid #EBE8E0", borderRadius: 6 }}>
        <p style={{ fontSize: 9, lineHeight: 1.5, color: "#5A5A5A", margin: 0 }}>
          <strong>Note:</strong> Heir tax rate above uses the assumption from Plan Inputs ({fmtPct(heirRate)} blended
          federal + state); adjust it to match your beneficiaries&apos; actual marginal bracket. §1014 step-up applies
          only to assets included in the deceased&apos;s gross estate — irrevocable-trust assets do not qualify.
          Basis pass-through, unrealized-gain treatment on non-marketable assets, and state estate-tax step-up
          conformity vary — <strong>consult a qualified tax professional</strong>.
        </p>
      </div>
    </Page>
  );
};
