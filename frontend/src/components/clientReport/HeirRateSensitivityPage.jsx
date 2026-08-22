import { useMemo } from "react";
import { fmtUSD, fmtPct } from "@/lib/api";
import { HoldConstantBand } from "@/components/shared/PrintBlocks";
import { Page, H2, H3, P, Sub, Kpi } from "./helpers";

/**
 * HeirRateSensitivityPage — the beneficiaries' marginal tax rate is an
 * ASSUMPTION about people whose careers, residences, and brackets cannot be
 * forecast decades out, yet it drives a large share of the legacy case. Rather
 * than bury one presumed future in the assumptions appendix, this page shows the
 * after-tax inheritance across a low / middle / high beneficiary rate band.
 *
 * Data comes from POST /api/legacy/heir-rate-sensitivity, which re-prices ONLY
 * the heirs' SECURE-10 horizon per rate — the parents' projection, conversion
 * schedule, spending, and returns are identical in every row.
 */
export const HeirRateSensitivityPage = ({ heirSens, heirRate, pv, deliverYear, ...footProps }) => {
  const rows = useMemo(() => {
    const withB = heirSens?.branches?.with_conversions;
    const noB = heirSens?.branches?.no_conversions;
    if (!Array.isArray(withB) || !Array.isArray(noB) || !withB.length) return null;
    const noByRate = new Map(noB.map((e) => [e.rate, e]));
    return withB.map((e) => {
      const n = noByRate.get(e.rate);
      const a = n?.after_tax_estate_to_heirs ?? 0;
      const b = e.after_tax_estate_to_heirs ?? 0;
      return {
        rate: e.rate,
        isModeled: !!e.is_modeled,
        noConv: a,
        withConv: b,
        delta: b - a,
        heirTaxNo: n?.inherited_ira_tax ?? 0,
        heirTaxWith: e.inherited_ira_tax ?? 0,
      };
    });
  }, [heirSens]);

  // Break-even beneficiary rate — where both strategies leave the family the
  // same after-tax inheritance. Linear interpolation between bracketing rows.
  const breakEven = useMemo(() => {
    if (!rows || rows.length < 2) return null;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if ((a.delta <= 0 && b.delta >= 0) || (a.delta >= 0 && b.delta <= 0)) {
        const span = b.delta - a.delta;
        if (Math.abs(span) < 1e-9) return a.rate;
        return a.rate + (b.rate - a.rate) * (-a.delta / span);
      }
    }
    return null;
  }, [rows]);

  if (!rows) return null;
  const withFlat = rows.every((r) => Math.abs(r.withConv - rows[0].withConv) < 1);
  const lowest = rows[0];
  const highest = rows[rows.length - 1];
  const f = pv ? pv.at(deliverYear) : 1;

  return (
    <Page testid="cr-page-heir-rate-sensitivity" {...footProps}>
      <H2>Beneficiary Tax-Rate Sensitivity</H2>
      <HoldConstantBand testid="cr-heir-sens-band"
        variable="the beneficiaries' assumed combined ordinary rate"
        constant="conversion schedule, spending, returns, longevity, estate structure" />
      <P>
        The legacy analysis assumes the heirs pay a <strong>{fmtPct(heirRate)} combined ordinary marginal
        rate</strong> on every dollar distributed from an inherited Traditional IRA during the SECURE Act&apos;s
        ten-year window. That single assumption moves a large share of the result — so this page re-runs the same
        plan across a band of beneficiary rates instead of presenting one presumed future as the answer.
      </P>
      <P>
        Family circumstances, not formulas, decide which row is closest to reality. If the eventual beneficiaries
        are highly compensated physicians, attorneys, executives, or business owners during those ten years, a
        high rate is appropriate. If they are teachers, nonprofit employees, retirees, or otherwise
        modest-income taxpayers, the economics look materially different — and beneficiaries can differ from
        each other, move between states, or see their circumstances change before the money is ever inherited.
      </P>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 6 }}
           data-testid="cr-heir-sens-kpis">
        <Kpi label="Modeled beneficiary rate" value={fmtPct(heirRate)} tone="black"
             sub="Used everywhere else in this report" />
        <Kpi label="Rate band tested"
             value={`${fmtPct(lowest.rate)} – ${fmtPct(highest.rate)}`} tone="black"
             sub="Combined federal + state ordinary" />
        <Kpi label="Break-even beneficiary rate"
             value={breakEven != null ? fmtPct(breakEven) : "None in tested band"}
             tone="black"
             sub={breakEven != null
               ? "The two strategies tie at this rate"
               : `Conversion delta remains ${rows.every((r) => r.delta >= 0) ? "positive" : "negative"} across the tested beneficiary-rate range`} />
      </div>

      <H3>After-tax inheritance across the rate band</H3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginTop: 4 }}
             data-testid="cr-legacy-heir-sensitivity">
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
            <th style={{ padding: "6px 4px", width: "26%" }}>Beneficiaries&apos; combined ordinary rate</th>
            <th style={{ padding: "6px 4px", textAlign: "right" }}>After-tax to heirs — no conversions</th>
            <th style={{ padding: "6px 4px", textAlign: "right", background: "#4A67410D" }}>After-tax to heirs — with conversions</th>
            <th style={{ padding: "6px 4px", textAlign: "right" }}>Δ nominal</th>
            <th style={{ padding: "6px 4px", textAlign: "right", background: "#F9F8F6" }}>Δ in today&apos;s $</th>
            <th style={{ padding: "6px 4px", textAlign: "right" }}>Heirs&apos; IRA tax — no conversions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rate} style={{
              borderBottom: "1px solid #F3F1EC",
              background: r.isModeled ? "#F9F8F6" : "transparent",
              fontWeight: r.isModeled ? 700 : 400,
            }} data-testid={`cr-legacy-heir-sens-row-${Math.round(r.rate * 10000)}`}>
              <td style={{ padding: "5px 4px" }}>
                {fmtPct(r.rate)}
                {r.isModeled && (
                  <span style={{ fontSize: 9, color: "#4A6741", marginLeft: 6, fontWeight: 700 }}>
                    ← as modeled in this report
                  </span>
                )}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmtUSD(r.noConv)}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", background: "#4A67410D",
                           fontVariantNumeric: "tabular-nums" }}>
                {fmtUSD(r.withConv)}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                           color: r.delta >= 0 ? "#4A6741" : "#C87941" }}>
                {r.delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(r.delta))}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                           background: "#F9F8F6", color: r.delta >= 0 ? "#4A6741" : "#C87941" }}>
                {r.delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(r.delta * f))}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                           color: "#777" }}>
                {fmtUSD(r.heirTaxNo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Sub>
        Only the heirs&apos; assumed marginal rate changes down the rows — the parents&apos; projection,
        conversion schedule, market returns, and spending are identical in every row.
        {withFlat && (
          <> The &ldquo;with conversions&rdquo; column is flat because this plan converts the Traditional IRA in
          full: with no pre-tax IRA left to inherit, the beneficiaries&apos; ordinary rate no longer touches the
          inheritance at all. Transferring that rate risk off the next generation is itself one of the reasons
          families convert.</>
        )}
        {breakEven != null && (
          <> The two strategies leave the family the same after-tax inheritance at a beneficiary rate of about
          {" "}<strong>{fmtPct(breakEven)}</strong>: below it, not converting leaves more; above it, converting
          does.</>
        )}
        {" "}This is a range of family possibilities, not a forecast of the careers or tax brackets of children
        and grandchildren — which is why this report presents alternatives rather than a ranking. Nominal figures
        are dollars at the end of the ten-year horizon{deliverYear ? ` (${deliverYear})` : ""} and exclude any
        federal or state estate tax, which is modeled separately in the estate section. The today&apos;s-dollar
        column discounts that same difference back to {pv ? pv.start : "the plan start"}
        {pv ? ` at ${fmtPct(pv.rate)}` : ""}, because a difference delivered decades from now is worth
        considerably less than the same figure today.
      </Sub>
    </Page>
  );
};

export default HeirRateSensitivityPage;
