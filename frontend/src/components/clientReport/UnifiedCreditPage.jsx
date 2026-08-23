/**
 * Client Report — Lifetime Giving & the Unified Credit page.
 *
 * Shows, for a household running a lifetime-giving program:
 *   - cumulative annual-exclusion (§2503(b)/(e)) gifts vs. taxable gifts (§2001(b)),
 *   - per-spouse unified exclusion consumed vs. remaining, and the DSUE effect,
 *   - the §1015 carryover-basis after-tax value of the family gift pot, and
 *   - a side-by-side of federal estate tax at second death WITH vs. WITHOUT the
 *     gifting program (the saving = 40% of the appreciation that escaped the estate,
 *     since under §2001(b) the gifted principal is added back to the tentative base).
 *
 * All figures are derived from the projection result (`withRoth.giving`) so the
 * page needs no extra API call.
 */
import React from "react";
import { Page, H2, H3, P, Sub } from "./helpers.jsx";
import { fmtUSD, fmtPct } from "@/lib/api";

const FED_BASE = 15_000_000;      // OBBBA base (2026), matches backend law_constants
const FED_BASE_YEAR = 2026;
const FED_RATE = 0.40;

const fedExclusion = (year, infl) => {
  const yrs = (year || FED_BASE_YEAR) - FED_BASE_YEAR;
  return FED_BASE * Math.pow(1 + (infl || 0.03), yrs);
};

export const UnifiedCreditPage = ({ scenario, withRoth, ...footProps }) => {
  const giving = withRoth?.giving || {};
  const tg = giving.taxable_gifts;
  const infl = scenario?.projection?.general_inflation ?? 0.03;
  const h = scenario?.household || {};

  const clientDeath = (h.client_dob_year && h.client_life_expectancy) ? h.client_dob_year + h.client_life_expectancy : null;
  const spouseDeath = (h.spouse_dob_year && h.spouse_life_expectancy) ? h.spouse_dob_year + h.spouse_life_expectancy : null;
  const firstYr = (clientDeath && spouseDeath) ? Math.min(clientDeath, spouseDeath) : (clientDeath || spouseDeath);
  const secondYr = (clientDeath && spouseDeath) ? Math.max(clientDeath, spouseDeath) : (clientDeath || spouseDeath);

  if (!tg || !(tg.total > 0)) {
    return (
      <Page testid="cr-page-unified-credit" {...footProps}>
        <H2>Lifetime Giving &amp; the Unified Credit</H2>
        <P>
          No taxable lifetime gifts (above the annual exclusion) are modeled in this plan. Add one or more
          gifts on Plan Inputs → Lifetime Giving Program → <em>Taxable Gifts</em> to see how they consume the
          unified credit and shrink the taxable estate.
        </P>
      </Page>
    );
  }

  const exclY1 = fedExclusion(firstYr, infl);
  const exclY2 = fedExclusion(secondYr, infl);
  const firstDecedent = tg.first_decedent || "Client";
  const secondDecedent = firstDecedent === "Client" ? "Spouse" : "Client";
  const consumedFirst = tg.adjusted_gifts_first_death || 0;
  const consumedSecond = tg.adjusted_gifts_second_death || 0;
  const remainingFirst = Math.max(0, exclY1 - consumedFirst);
  const remainingSecond = Math.max(0, exclY2 - consumedSecond);
  // DSUE ported from the first decedent = their unused exclusion (net of their gifts).
  const dsue = remainingFirst;

  // Cumulative exclusion (non-taxable) gifts = lifetime gifted minus taxable gifts.
  const totalGifted = giving.total_gifted || 0;
  const exclusionGifts = Math.max(0, totalGifted - (tg.total || 0));

  // Family gift pot at second death + §1015 carryover-basis after-tax view.
  const pot = giving.ending_pot || 0;
  const cob = giving.carryover_basis || {};
  const appreciationEscaped = Math.max(0, pot - (tg.total || 0));

  // Actual counterfactual estate-tax saving. Estate WITHOUT gifting would be larger
  // by the whole gift pot; WITH gifting the §2001(b) base adds back only the gifted
  // principal. Both are sheltered by the combined exclusion + DSUE — so the saving is
  // $0 when the household stays under the ceiling (matches the Estate tab).
  const estateY2 = (() => {
    const prows = withRoth?.rows || [];
    const r = prows.find((x) => x.year >= secondYr) || prows[prows.length - 1] || {};
    return r.net_worth || 0;
  })();
  const shelter = exclY2 + dsue;                       // survivor exclusion + ported DSUE
  const principal = tg.total || 0;
  const taxWithout = FED_RATE * Math.max(0, estateY2 + pot - shelter);
  const taxWith = FED_RATE * Math.max(0, estateY2 + principal - shelter);
  const estateTaxSaved = Math.max(0, taxWithout - taxWith);

  const cell = { padding: 6, fontVariantNumeric: "tabular-nums" };

  return (
    <Page testid="cr-page-unified-credit" {...footProps}>
      <H2>Lifetime Giving &amp; the Unified Credit</H2>
      <P>
        The federal gift and estate taxes share a single <strong>unified credit</strong>. Gifts above the annual
        exclusion consume that credit during life and are added back to the estate&apos;s tentative-tax base at
        death (§2001(b)) — so a gift <em>within</em> the exclusion adds no estate tax. The real payoff is that all
        <strong> future appreciation</strong> on the gifted assets grows <em>outside</em> the taxable estate.
      </P>

      {/* Gift program summary */}
      <H3>Gifting program summary</H3>
      <table style={{ width: "100%", fontSize: 10, marginBottom: 8, borderCollapse: "collapse" }}>
        <tbody>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ ...cell, textAlign: "left" }}>Annual-exclusion &amp; §2503(e) gifts (cumulative)</td>
            <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmtUSD(exclusionGifts)}</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #F3F1EC", background: "#FEFAF1" }}>
            <td style={{ ...cell, textAlign: "left", fontWeight: 700, color: "#8A5A20" }}>Taxable gifts consuming unified credit (§2001(b))</td>
            <td style={{ ...cell, textAlign: "right", fontWeight: 700, color: "#8A5A20" }}>{fmtUSD(tg.total)}</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ ...cell, textAlign: "left" }}>Family gift pot at second death (Y{secondYr})</td>
            <td style={{ ...cell, textAlign: "right" }}>{fmtUSD(pot)}</td>
          </tr>
          <tr style={{ borderTop: "2px solid #4A6741", background: "#F1F5EF" }}>
            <td style={{ ...cell, textAlign: "left", fontWeight: 800, color: "#4A6741" }}>Appreciation that escaped the estate</td>
            <td style={{ ...cell, textAlign: "right", fontWeight: 800, color: "#4A6741" }}>{fmtUSD(appreciationEscaped)}</td>
          </tr>
        </tbody>
      </table>

      {/* Per-spouse exclusion consumed vs remaining */}
      <H3>Unified exclusion — consumed vs. remaining per spouse</H3>
      <table style={{ width: "100%", fontSize: 10, marginBottom: 8, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid #4A6741", background: "#F9F8F6" }}>
            <th style={{ ...cell, textAlign: "left" }}>Spouse</th>
            <th style={{ ...cell, textAlign: "right" }}>Exclusion at death</th>
            <th style={{ ...cell, textAlign: "right" }}>Taxable gifts made</th>
            <th style={{ ...cell, textAlign: "right" }}>Exclusion remaining</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={cell}>{firstDecedent} (first death, Y{firstYr})</td>
            <td style={{ ...cell, textAlign: "right" }}>{fmtUSD(exclY1)}</td>
            <td style={{ ...cell, textAlign: "right", color: "#8A5A20" }}>{fmtUSD(consumedFirst)}</td>
            <td style={{ ...cell, textAlign: "right", fontWeight: 700, color: "#4A6741" }}>{fmtUSD(remainingFirst)}</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={cell}>{secondDecedent} (second death, Y{secondYr})</td>
            <td style={{ ...cell, textAlign: "right" }}>{fmtUSD(exclY2)}</td>
            <td style={{ ...cell, textAlign: "right", color: "#8A5A20" }}>{fmtUSD(consumedSecond)}</td>
            <td style={{ ...cell, textAlign: "right", fontWeight: 700, color: "#4A6741" }}>{fmtUSD(remainingSecond)}</td>
          </tr>
        </tbody>
      </table>
      <Sub>
        DSUE (portability): the first decedent&apos;s unused exclusion of <strong>{fmtUSD(dsue)}</strong> ports to the
        surviving spouse via a Form 706 election, stacking on top of the survivor&apos;s own Y{secondYr} exclusion of
        {" "}{fmtUSD(exclY2)} for a combined shelter of <strong>{fmtUSD(dsue + exclY2)}</strong> at the second death.
      </Sub>

      {/* Estate tax with vs without gifting */}
      <H3>Federal estate tax at second death — with vs. without the gifting program</H3>
      <div style={{ padding: 10, background: "#F1F5EF", border: "1px solid #4A6741", borderRadius: 6, marginBottom: 8 }}
           data-testid="cr-unified-credit-savings">
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ ...cell, textAlign: "left" }}>Federal estate tax WITHOUT the gifting program</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmtUSD(taxWithout)}</td>
            </tr>
            <tr>
              <td style={{ ...cell, textAlign: "left" }}>Federal estate tax WITH the gifting program (§2001(b) add-back)</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{fmtUSD(taxWith)}</td>
            </tr>
            <tr style={{ borderTop: "2px solid #4A6741" }}>
              <td style={{ ...cell, textAlign: "left", fontWeight: 800, color: "#4A6741" }}>Federal estate tax saved by gifting</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 800, color: "#4A6741" }} data-testid="cr-unified-credit-tax-saved">{fmtUSD(estateTaxSaved)}</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 9.5, lineHeight: 1.5, color: "#5A5A5A", margin: 0, marginTop: 6 }}>
          Estimated on the projected household estate at Y{secondYr} ({fmtUSD(estateY2)}) against the combined shelter
          ({fmtUSD(shelter)} = Y{secondYr} exclusion + ported DSUE, net of the first decedent&apos;s lifetime gifts).
          {estateTaxSaved <= 0 && (
            <> This household stays under the combined shelter, so the cash estate-tax saving is <strong>{fmtUSD(0)}</strong> —
            the benefit is preserved exclusion headroom and {fmtUSD(appreciationEscaped)} of appreciation kept out of the estate.</>
          )}
          {" "}This page uses a simplified flat {fmtPct(FED_RATE)} federal model; the Estate Planning tab&apos;s engine
          figure (which includes state estate tax and trust strategies) is authoritative.
        </p>
      </div>

      {/* Carryover-basis trade-off */}
      <H3>The §1015 carryover-basis trade-off</H3>
      <P>
        Gifted appreciated assets carry the donor&apos;s cost basis (§1015) — they do <strong>not</strong> receive the
        §1014 step-up they would have gotten if held until death. The family gift pot of {fmtUSD(pot)} carries an
        embedded gain of <strong>{fmtUSD(cob.embedded_gain || 0)}</strong>; heirs owe roughly{" "}
        <strong>{fmtUSD(cob.ltcg_owed_at_sale || 0)}</strong> of long-term capital-gains tax
        ({fmtPct(cob.heir_ltcg_rate || 0)}) at eventual sale, leaving an after-tax pot of{" "}
        <strong>{fmtUSD(cob.pot_after_tax || pot)}</strong>. The estate-tax saving above (40%) generally dwarfs this
        LTCG cost (≈{fmtPct(cob.heir_ltcg_rate || 0)}) for a taxable estate — which is why gifting appreciating
        assets out of a large estate is efficient even after forgoing the step-up.
      </P>
      <Sub>
        Figures assume the modeled gift schedule, growth, and heir LTCG rate from Plan Inputs. §2001(b) gift-tax-payable
        offsets are applied so within-exclusion gifts create no phantom estate tax. Consult a qualified estate-tax
        professional — GST allocation, state gift/estate conformity, and valuation discounts are not modeled here.
      </Sub>
    </Page>
  );
};
