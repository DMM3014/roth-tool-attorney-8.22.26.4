import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, LabelList,
} from "recharts";
import { fmtUSD, fmtPct, pvSeries } from "@/lib/api";
import { WidowTaxTrapPrint } from "@/components/WidowTaxTrap";
import { HoldConstantBand } from "@/components/shared/PrintBlocks";
import { Page, H2, H3, Sub, P, StaticLegend, useIsolation } from "./helpers";

export const LegacyPage = ({ scenario, withRoth, noRoth, heirRate, rows, nrows, pvDiscountRateOverride, ...footProps }) => {
  const iso = useIsolation();
  const s = withRoth?.summary || {};
  const sn = noRoth?.summary || {};
  const lg = withRoth?.legacy || {};
  const lgn = noRoth?.legacy || {};

  // Heir-horizon rows are keyed by `year_after_death` (1..10), NOT a calendar
  // year. Deriving the calendar year from the last projection year keeps the
  // NPV discounting and the chart x-axis correct — reading a non-existent
  // `p.year` was what printed "$NaN" in the NPV rows of this table.
  const lastPlanYear = rows.length ? rows[rows.length - 1].year : null;
  const heirYearOf = (p, i) => (p?.year != null
    ? p.year
    : (lastPlanYear || 0) + (p?.year_after_death != null ? p.year_after_death : i + 1));

  const aLifetimeParents = sn.lifetime_taxes || 0;
  const bLifetimeParents = s.lifetime_taxes || 0;
  const aHeirTax = lgn.inherited_ira_tax || 0;
  const bHeirTax = lg.inherited_ira_tax || 0;
  const aTotalFamily = aLifetimeParents + aHeirTax;
  const bTotalFamily = bLifetimeParents + bHeirTax;
  const aAfterTax = lgn.after_tax_estate_to_heirs || 0;
  const bAfterTax = lg.after_tax_estate_to_heirs || 0;
  const deltaLegacy = bAfterTax - aAfterTax;
  const deltaFamilyTax = aTotalFamily - bTotalFamily;

  const totalConverted = s.total_roth_converted || 0;
  const effRateConverted = totalConverted > 0
    ? (bLifetimeParents - aLifetimeParents) / totalConverted
    : null;
  const endTraditionalA = nrows.length ? nrows.at(-1).traditional : 0;
  const effRateInheritedA = endTraditionalA > 0 ? aHeirTax / endTraditionalA : null;

  // Compute Present Value equivalents so the Nominal + PV pair mirrors the Analytics tab.
  // pvSeries(withRoth, noRoth, scenario) returns { ntf: { pvWith, pvNo, pvRothWith, pvRothNo,
  // discountRate, deliverYear, horizon } } — same shape used by PvNetToFamilyChart.
  const pv = useMemo(() => pvSeries(withRoth, noRoth, scenario, pvDiscountRateOverride),
    [withRoth, noRoth, scenario, pvDiscountRateOverride]);
  const ntf = pv?.ntf;

  // Data for the paired horizontal stacked bar chart: nominal (top) + PV (bottom).
  const nominalBars = useMemo(() => [
    { name: "With Conversions",
      roth: lg.tax_free_roth_to_heirs || 0,
      other: Math.max(0, bAfterTax - (lg.tax_free_roth_to_heirs || 0)),
      total: bAfterTax },
    { name: "No Conversions",
      roth: lgn.tax_free_roth_to_heirs || 0,
      other: Math.max(0, aAfterTax - (lgn.tax_free_roth_to_heirs || 0)),
      total: aAfterTax },
  ], [lg, lgn, aAfterTax, bAfterTax]);
  const pvBars = useMemo(() => (ntf ? [
    { name: "With Conversions",
      roth: ntf.pvRothWith || 0,
      other: Math.max(0, (ntf.pvWith || 0) - (ntf.pvRothWith || 0)),
      total: ntf.pvWith || 0 },
    { name: "No Conversions",
      roth: ntf.pvRothNo || 0,
      other: Math.max(0, (ntf.pvNo || 0) - (ntf.pvRothNo || 0)),
      total: ntf.pvNo || 0 },
  ] : []), [ntf]);
  const pvDelta = ntf ? (ntf.pvWith - ntf.pvNo) : 0;

  // NPV of lifetime + heir IRA tax paid — advisor-requested replacement for
  // the nominal "lifetime tax savings" figure. We reuse the same discount
  // rate (`ntf.discountRate`) that PV net-to-family uses, so the two numbers
  // are self-consistent.
  const npvTax = useMemo(() => {
    const startYr = scenario?.projection?.start_year ?? (withRoth?.rows?.[0]?.year || 0);
    const r = ntf?.discountRate;
    if (r == null || !withRoth?.rows?.length || !noRoth?.rows?.length) return null;
    const disc = (y) => 1 / Math.pow(1 + r, Math.max(0, y - startYr));
    const yearTax = (row) => {
      const tb = row?.tax_breakdown || {};
      // Sum federal ordinary + preferential + state + NIIT + medicare (IRMAA).
      // Same convention as the nominal `summary.lifetime_taxes` bucket.
      return (tb.ordinary || 0) + (tb.preferential || 0) + (tb.state || 0)
           + (tb.niit || 0) + (tb.medicare || 0);
    };
    let pvParentsWith = 0, pvParentsNo = 0;
    for (const row of withRoth.rows) pvParentsWith += yearTax(row) * disc(row.year);
    for (const row of noRoth.rows)   pvParentsNo   += yearTax(row) * disc(row.year);
    // Heir IRA income tax — paid year-by-year across `legacy.post_death_rows`
    // (up to 10 years after the second death under SECURE). Falls back to the
    // aggregate `inherited_ira_tax` bucketed at the horizon year when the
    // yearly rows aren't present.
    const heirYearly = (l) => {
      if (Array.isArray(l?.post_death_rows) && l.post_death_rows.length) {
        return l.post_death_rows.reduce(
          (sum, p, i) => sum + (p.ira_tax_paid || 0) * disc(heirYearOf(p, i)), 0);
      }
      const y = (lastPlanYear || 0) + (l?.horizon_years || 10);
      return (l?.inherited_ira_tax || 0) * disc(y);
    };
    const pvHeirsWith = heirYearly(lg);
    const pvHeirsNo   = heirYearly(lgn);
    const pvFamilyWith = pvParentsWith + pvHeirsWith;
    const pvFamilyNo   = pvParentsNo   + pvHeirsNo;
    // Never let a bad input reach the page as "$NaN" — the row is dropped instead.
    if (![pvParentsWith, pvParentsNo, pvHeirsWith, pvHeirsNo].every(Number.isFinite)) return null;
    return {
      discountRate: r,
      pvParentsWith, pvParentsNo,
      pvHeirsWith,   pvHeirsNo,
      pvFamilyWith,  pvFamilyNo,
      pvParentsDelta: pvParentsNo - pvParentsWith,   // + = Roth saves in PV
      pvFamilyDelta:  pvFamilyNo  - pvFamilyWith,
    };
  }, [scenario, withRoth, noRoth, ntf, lg, lgn]);
  /* eslint-disable-next-line react-hooks/exhaustive-deps */

  const heirData = useMemo(() => {
    const yrsA = (lgn.post_death_rows || []).map((p, i) => ({ year: heirYearOf(p, i), rmd: p.ira_rmd || 0, tax: p.ira_tax_paid || 0 }));
    const yrsB = (lg.post_death_rows || []).map((p, i) => ({ year: heirYearOf(p, i), rmd: p.ira_rmd || 0, tax: p.ira_tax_paid || 0 }));
    const yrs = yrsA.length >= yrsB.length ? yrsA : yrsB;
    return yrs.map((_, i) => ({
      year: yrsA[i]?.year || yrsB[i]?.year,
      taxA: yrsA[i]?.tax || 0,
      taxB: yrsB[i]?.tax || 0,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lg, lgn, lastPlanYear]);


  // Lifetime tax bridge: decompose Δ lifetime tax (with vs without conversions)
  // into conversion-era federal / state / NIIT, lifetime IRMAA (2-yr MAGI
  // lookback pushes surcharges past the conversion years), later-year savings,
  // and the heirs' SECURE-10 change. Residual folding on the later-year row
  // guarantees the bridge ties to the headline delta to the cent.
  const bridge = useMemo(() => {
    const rw = withRoth?.rows, rn = noRoth?.rows;
    if (!rw?.length || !rn?.length) return null;
    const byYear = new Map(rn.map((r) => [r.year, r]));
    let convFed = 0, convState = 0, convNiit = 0, irmaaAll = 0, hasConv = false;
    for (const r of rw) {
      const b = byYear.get(r.year);
      if (!b) continue;
      const tb = r.tax_breakdown || {}, nb = b.tax_breakdown || {};
      irmaaAll += (tb.medicare || 0) - (nb.medicare || 0);
      if ((r.roth_conversion || 0) > 0) {
        hasConv = true;
        convFed += ((tb.ordinary || 0) + (tb.preferential || 0)) - ((nb.ordinary || 0) + (nb.preferential || 0));
        convState += (tb.state || 0) - (nb.state || 0);
        convNiit += (tb.niit || 0) - (nb.niit || 0);
      }
    }
    if (!hasConv) return null;
    const dParents = bLifetimeParents - aLifetimeParents;
    const later = dParents - convFed - convState - convNiit - irmaaAll;
    const dHeirs = bHeirTax - aHeirTax;
    return { convFed, convState, convNiit, irmaaAll, later, dParents, dHeirs, dFamily: dParents + dHeirs };
  }, [withRoth, noRoth, aLifetimeParents, bLifetimeParents, aHeirTax, bHeirTax]);

  // Spans THREE printed pages — comparison, what the family nets, and the tax
  // mechanics (the beneficiary rate band is its own page). One page had grown past 2,300px
  // (twice the printable height) and the PDF exporter had to squeeze it, producing
  // the squished text advisors reported. `foot(i)` offsets the parent's page number.
  const foot = (i) => ({
    ...footProps,
    pageNo: footProps.pageNo != null ? footProps.pageNo + i : undefined,
  });

  return (
    <>
    <Page testid="cr-page-legacy" {...foot(0)}>
      <H2>Roth Conversion &amp; Legacy — the SECURE Act 10-Year Window</H2>
      <HoldConstantBand testid="cr-legacy-band"
        variable="Roth conversions — the modeled schedule vs none at all"
        constant="spending, returns, longevity, funding order, beneficiary assumption" />
      <P>
        This is one of the most consequential tax and legacy decisions modeled. Under the SECURE Act of 2019, non-spouse
        beneficiaries who inherit a Traditional IRA must withdraw the entire balance within 10 years — and every
        dollar of it is taxed as ordinary income, stacked on top of the children&apos;s peak-earning-years salary.
        A Roth account inherited under the same rule <strong>continues to compound income-tax free through the
        SECURE 10-year distribution window</strong>. Deciding whether — and how much — to convert now, at your
        rates, versus letting the account pass to heirs, at their rates, is the trade-off this section quantifies.
      </P>
      <Sub>
        A note on Roth inherited through a trust: after year 10 the Roth wrapper terminates. If the account passes
        to individual beneficiaries, subsequent income is taxed at their marginal rates; if it stays in an
        accumulation trust, retained income is taxed at the compressed trust brackets (37% federal above ~$16K).
        Trustees typically distribute ordinary income (DNI carry-out) and appreciated assets in-kind so the
        beneficiary&apos;s lower rate applies rather than the trust&apos;s 37%.
      </Sub>

      <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8,
                    border: "1px solid #C4A64A", background: "#C4A64A14" }}
           data-testid="cr-legacy-heir-assumption">
        <p style={{ fontSize: 10.5, lineHeight: 1.6, margin: 0, color: "#1A1A1A" }}>
          <strong style={{ color: "#8A6A12" }}>Key assumption — the beneficiaries&apos; tax rate.</strong>{" "}
          Every number on this page rests on an assumed <strong>{fmtPct(heirRate)} combined ordinary marginal
          rate</strong> for the heirs during the SECURE-10 distribution window. That single assumption drives a
          meaningful share of the legacy case. If the eventual beneficiaries are highly compensated physicians,
          attorneys, executives, or business owners during those ten years, a high rate is appropriate. If they
          are teachers, nonprofit employees, retirees, or otherwise modest-income taxpayers, the economics look
          materially different. Rather than pick one presumed future, the dedicated sensitivity page in this
          section reruns the identical plan across a low / middle / high beneficiary rate band.
        </p>
      </div>

      <H3>Side-by-side: the two strategies compared</H3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginTop: 4 }} data-testid="cr-legacy-table">
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
            <th style={{ padding: "6px 4px", width: "40%" }}></th>
            <th style={{ padding: "6px 4px", textAlign: "right" }}>A. No conversions / RMD-only baseline</th>
            <th style={{ padding: "6px 4px", textAlign: "right", background: "#4A67410D" }}>B. Convert at parents’ rates</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Parents’ lifetime tax (nominal)", fmtUSD(aLifetimeParents), fmtUSD(bLifetimeParents)],
            npvTax && [`Parents’ lifetime tax — NPV @ ${fmtPct(npvTax.discountRate)}`,
                       fmtUSD(npvTax.pvParentsNo), fmtUSD(npvTax.pvParentsWith)],
            ["Heirs’ SECURE-10 IRA tax (nominal)", fmtUSD(aHeirTax), fmtUSD(bHeirTax)],
            npvTax && [`Heirs’ SECURE-10 IRA tax — NPV @ ${fmtPct(npvTax.discountRate)}`,
                       fmtUSD(npvTax.pvHeirsNo), fmtUSD(npvTax.pvHeirsWith)],
            ["Total family tax paid (nominal)", fmtUSD(aTotalFamily), fmtUSD(bTotalFamily), true],
            npvTax && [`Total family tax — NPV @ ${fmtPct(npvTax.discountRate)}`,
                       fmtUSD(npvTax.pvFamilyNo), fmtUSD(npvTax.pvFamilyWith), true],
            ["Traditional IRA left at 2nd death", fmtUSD(endTraditionalA), fmtUSD(rows.length ? rows.at(-1).traditional : 0)],
            ["After-tax wealth to heirs (+10 yr)", fmtUSD(aAfterTax), fmtUSD(bAfterTax), true],
          ].filter(Boolean).map(([k, av, bv, bold], i) => (
            <tr key={i} style={{
              borderBottom: "1px solid #F3F1EC",
              background: bold ? "#F9F8F6" : "transparent",
              fontWeight: bold ? 700 : 400,
            }}>
              <td style={{ padding: "5px 4px" }}>{k}</td>
              <td style={{ padding: "5px 4px", textAlign: "right" }}>{av}</td>
              <td style={{ padding: "5px 4px", textAlign: "right", background: "#4A67410D" }}>{bv}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {npvTax && (
        <p style={{ fontSize: 10, color: "#7A756A", marginTop: 6, lineHeight: 1.55 }}
           data-testid="cr-legacy-npv-note">
          <strong>NPV rows</strong> discount each year&apos;s tax at
          {" "}{fmtPct(npvTax.discountRate)} back to {scenario?.projection?.start_year || "the plan start"}.
          Nominal savings of{" "}
          <strong>{fmtUSD((aTotalFamily) - (bTotalFamily))}</strong> compress to{" "}
          <strong>{fmtUSD(npvTax.pvFamilyDelta)}</strong> in present-value terms — the honest apples-to-apples
          comparison across strategies with different tax timing.
        </p>
      )}

      <div style={{
        marginTop: 12, padding: "10px 14px", borderRadius: 8,
        border: `1px solid ${deltaLegacy >= 0 ? "#4A6741" : "#C87941"}`,
        background: deltaLegacy >= 0 ? "#4A67410D" : "#C879410D",
      }}>
        <p style={{ fontSize: 11, lineHeight: 1.6, margin: 0 }} data-testid="cr-legacy-verdict">
          <strong style={{ color: deltaLegacy >= 0 ? "#4A6741" : "#C87941" }}>
            {deltaLegacy >= 0
              ? `On the after-tax-to-heirs measure, converting at parents' rates delivers ${fmtUSD(deltaLegacy)} more`
              : `On the after-tax-to-heirs measure, skipping conversions leaves ${fmtUSD(Math.abs(deltaLegacy))} more`}
          </strong>{" "}
          {deltaLegacy >= 0
            ? `at the modeled heir marginal rate of ${fmtPct(heirRate)}. The family also pays ${fmtUSD(Math.abs(deltaFamilyTax))} ${deltaFamilyTax >= 0 ? "less" : "more"} in total tax across both generations. This is one measure of success among several — see the beneficiary tax-rate sensitivity page before reading it as a recommendation.`
            : `at the modeled heir marginal rate of ${fmtPct(heirRate)} — the up-front tax cost of converting exceeds the SECURE-10 savings on this measure. A lower conversion amount, or a higher beneficiary rate, changes the answer: see the beneficiary tax-rate sensitivity page.`}
        </p>
      </div>
    </Page>

    {/* ---- Page 2: what the family actually nets at second death ---- */}
    <Page testid="cr-page-legacy-networth" {...foot(1)}>
      <H2>Legacy — What the Family Actually Nets</H2>
      <P>
        The comparison on the previous page is measured in taxes paid. This page measures what lands in the
        beneficiaries&apos; hands: the after-tax inheritance in future dollars, the same figure discounted to
        today&apos;s dollars, and the year-by-year income tax the heirs pay while emptying an inherited
        Traditional IRA. The beneficiary tax rate behind these numbers is stress-tested on the page that follows.
      </P>

      {/* Net to Family at Second Death — Nominal + Present Value paired charts.
          Answers the two questions clients always ask together: "How much do the
          kids get in future dollars?" and "What's that worth to us today?" */}
      {ntf && (
        <>
          <H3>Net to Family at Second Death — Nominal vs Present Value</H3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}
               data-testid="cr-legacy-nominal-pv">
            <div>
              <p style={{ fontSize: 10, color: "#5A5A5A", margin: "0 0 4px", fontWeight: 600 }}>
                Nominal (year {ntf.deliverYear} dollars)
              </p>
              <div style={{ height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nominalBars} layout="vertical" margin={{ top: 2, right: 60, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={100} tickLine={false} />
                    <Tooltip formatter={(v) => fmtUSD(v)} />
                    <Bar dataKey="roth" name="Inherited Roth (SECURE-10 sheltered)" stackId="s" fill="#4A6741" isAnimationActive={false} />
                    <Bar dataKey="other" name="Other after-tax" stackId="s" fill="#E6B89C" isAnimationActive={false} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="total" position="right"
                        formatter={(v) => fmtUSD(v)} style={{ fontSize: 9.5, fontWeight: 700, fill: "#1A1A1A" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p style={{ fontSize: 9.5, color: "#5A5A5A", margin: "2px 0 0" }}>
                Converting changes the family&apos;s <strong>nominal</strong> inheritance by
                {" "}<strong style={{ color: deltaLegacy >= 0 ? "#4A6741" : "#C87941" }}>
                  {deltaLegacy >= 0 ? "+" : ""}{fmtUSD(deltaLegacy)}
                </strong>.
              </p>
            </div>
            <div>
              <p style={{ fontSize: 10, color: "#5A5A5A", margin: "0 0 4px", fontWeight: 600 }}>
                Present Value (today&apos;s dollars @ {fmtPct(ntf.discountRate)})
              </p>
              <div style={{ height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pvBars} layout="vertical" margin={{ top: 2, right: 60, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={100} tickLine={false} />
                    <Tooltip formatter={(v) => fmtUSD(v)} />
                    <Bar dataKey="roth" name="Inherited Roth (SECURE-10 sheltered, PV)" stackId="s" fill="#4A6741" isAnimationActive={false} />
                    <Bar dataKey="other" name="Other after-tax (PV)" stackId="s" fill="#E6B89C" isAnimationActive={false} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="total" position="right"
                        formatter={(v) => fmtUSD(v)} style={{ fontSize: 9.5, fontWeight: 700, fill: "#1A1A1A" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p style={{ fontSize: 9.5, color: "#5A5A5A", margin: "2px 0 0" }}>
                In today&apos;s dollars the swing is
                {" "}<strong style={{ color: pvDelta >= 0 ? "#4A6741" : "#C87941" }}>
                  {pvDelta >= 0 ? "+" : ""}{fmtUSD(pvDelta)}
                </strong>{" "}
                — a fair &ldquo;cost-of-money&rdquo; comparison to the numbers on the left.
              </p>
            </div>
          </div>
          <Sub>
            Both charts show the SAME plan; the right-hand chart discounts each dollar back to today so a
            $6M inheritance in the year 2050 isn&apos;t compared against a $6M inheritance in 2029. Green =
            inherited Roth (income-tax free through the SECURE 10-yr window); sand = other after-tax dollars
            (after the heirs&apos; inherited-IRA tax and any LTCG on taxable-brokerage assets). Choose whichever
            framing resonates more with the client&apos;s intuition — the plan hasn&apos;t changed.
          </Sub>
        </>
      )}
      {heirData.length > 0 && (
        <>
          <H3>Heirs&apos; forced-distribution tax over the 10-year window</H3>
          <div style={{ height: 145 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={heirData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
                <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={42} tickLine={false} />
                <Tooltip formatter={(v) => fmtUSD(v)} />
                <Bar dataKey="taxA" fill="#C87941" name="A. No conversions" isAnimationActive={false} {...iso.dim("taxA")} />
                <Bar dataKey="taxB" fill="#4A6741" name="B. Convert at parents' rates" isAnimationActive={false} {...iso.dim("taxB")} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <StaticLegend
            items={[
              { label: "A. No conversions", color: "#C87941", dataKey: "taxA" },
              { label: "B. Convert at parents' rates", color: "#4A6741", dataKey: "taxB" },
            ]}
            isolated={iso.isolated}
            onToggle={iso.toggle}
            size={9}
            testid="cr-legacy-heir-legend"
          />
          <Sub>
            Under strategy A, the heirs face large ordinary-rate distributions each year of the SECURE-10 window,
            stacked on their peak-earning years. Under strategy B, the balance to be drained is smaller because
            it was converted at your rates — often 22–24% — instead of the 32–37% brackets the children may sit in.
          </Sub>
        </>
      )}
    </Page>

    {/* ---- Page 3: tax mechanics (effective rates, bridge) ---- */}
    <Page testid="cr-page-legacy-mechanics" {...foot(2)}>
      <H2>Legacy — The Tax Mechanics Behind the Numbers</H2>

      <H3>Effective tax rate per dollar</H3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginTop: 4 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
            <th style={{ padding: "6px 4px" }}>Dollar type</th>
            <th style={{ padding: "6px 4px", textAlign: "right" }}>Effective rate</th>
            <th style={{ padding: "6px 4px", textAlign: "left" }}>Interpretation</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: "5px 4px" }}>Each dollar converted — lifetime tax efficiency</td>
            <td style={{ padding: "5px 4px", textAlign: "right", fontWeight: 700, color: "#4A6741" }}
                data-testid="cr-legacy-lifetime-efficiency">
              {effRateConverted != null ? fmtPct(effRateConverted) : "—"}
            </td>
            <td style={{ padding: "5px 4px", color: "#5A5A5A" }}>
              Δ lifetime household tax ÷ total converted. This is <strong>not</strong> the marginal rate paid at
              conversion — a negative value means the plan&apos;s projected lifetime taxes <em>fall</em> by that many
              cents per converted dollar (see the bridge below for the year-by-year mechanics).
            </td>
          </tr>
          <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: "5px 4px" }}>Each inherited-IRA dollar (SECURE-10)</td>
            <td style={{ padding: "5px 4px", textAlign: "right", fontWeight: 700, color: "#C87941" }}>
              {effRateInheritedA != null ? fmtPct(effRateInheritedA) : "—"}
            </td>
            <td style={{ padding: "5px 4px", color: "#5A5A5A" }}>Heirs&apos; ordinary rate during 10-yr window</td>
          </tr>
        </tbody>
      </table>

      {bridge && (
        <>
          <H3>Conversion tax bridge — where the dollars actually move</H3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginTop: 4 }}
                 data-testid="cr-legacy-tax-bridge">
            <thead>
              <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
                <th style={{ padding: "6px 4px" }}>Component (with conversions vs. without)</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>Δ tax</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Federal ordinary + LTCG tax in conversion years", bridge.convFed],
                ["State tax in conversion years", bridge.convState],
                ["NIIT in conversion years", bridge.convNiit],
                ["Medicare/IRMAA surcharges — lifetime Δ (2-yr MAGI lookback)", bridge.irmaaAll],
                ["Later-year tax change (smaller RMDs, lower SS taxation, residual)", bridge.later],
                ["= Δ parents' lifetime tax", bridge.dParents, true],
                ["Heirs' SECURE-10 IRA tax change", bridge.dHeirs],
                ["= Net family tax change (both generations)", bridge.dFamily, true],
              ].map(([label, v, bold], i) => (
                <tr key={i} style={{
                  borderBottom: "1px solid #F3F1EC",
                  background: bold ? "#F9F8F6" : "transparent",
                  fontWeight: bold ? 700 : 400,
                }}>
                  <td style={{ padding: "5px 4px" }}>{label}</td>
                  <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                               color: v < 0 ? "#4A6741" : "#1A1A1A" }}>
                    {v < 0 ? `−${fmtUSD(Math.abs(v))}` : `+${fmtUSD(v)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Sub>
            Positive = more tax paid under the conversion plan; negative = less. &ldquo;Conversion years&rdquo; are
            the years the plan actually converts; IRMAA is shown as a lifetime delta because Medicare surcharges
            follow MAGI with a two-year lookback and can land after the conversion window closes. The later-year row
            absorbs any residual so the bridge ties exactly to the headline Δ lifetime tax above.
          </Sub>
        </>
      )}

      <Sub>
        Note: &ldquo;Wait-and-see / RMD-only&rdquo; scenarios are logically identical to strategy A in this model —
        RMDs are distributions, not conversions, and don&apos;t move dollars from Traditional to Roth.
        A meaningful third strategy would require an opportunistic conversion heuristic; ask your advisor if
        that&apos;s something to model.
      </Sub>

      <WidowTaxTrapPrint rows={rows} />

      {/* Estate/inheritance tax caveat — always shown regardless of the Estate
          Planning page toggle so the client and advisor see it in every report. */}
      <div style={{ marginTop: 12, padding: 10, background: "#FAFAF8", border: "1px solid #EBE8E0", borderRadius: 6 }}
           data-testid="cr-estate-tax-caveat">
        <p style={{ fontSize: 9.5, lineHeight: 1.55, color: "#5A5A5A", margin: 0 }}>
          <strong>Note on estate &amp; inheritance taxes:</strong> The illustrations above <strong>do NOT
          include</strong> analysis of federal or state estate/inheritance taxes — they cover the parents&apos;
          lifetime income taxes and the heirs&apos; SECURE-10 income tax on inherited IRA distributions only. If the client anticipates leaving
          assets worth more than the current federal estate-tax exemption (currently <strong>$15,000,000
          per person</strong> for 2026 under OBBBA, indexed for inflation), the client should also consult a qualified attorney
          or other tax professional regarding estate-tax planning opportunities and potential pitfalls
          (marital deduction, QTIP elections, GST-exempt trusts, DSUE portability, state estate-tax
          exposure, etc.). Add the Estate Planning print page to this report — or open the Estate tab —
          for a layered GST-exempt trust analysis.
        </p>
      </div>
    </Page>
    </>
  );
};
