import { useMemo } from "react";
import { fmtUSD, fmtPct } from "@/lib/api";
import { HoldConstantBand } from "@/components/shared/PrintBlocks";
import { Page, H2, H3, P, Sub } from "./printPrimitives";

/**
 * BeneficiaryBandPage — the deck version of the Client Report's beneficiary
 * tax-rate band. The heirs' marginal rate is an assumption about people whose
 * careers and brackets cannot be forecast decades out, yet it drives a large
 * share of the legacy case, so the deck shows a low / middle / high band rather
 * than presenting one presumed future as the answer.
 *
 * Data: POST /api/legacy/heir-rate-sensitivity (only the heirs' SECURE-10
 * horizon is re-priced per rate; the parents' projection is identical in every
 * row).
 */
export const BeneficiaryBandPage = ({ heirSens, heirRate, pv, deliverYear, includeNarrative = true }) => {
  const rows = useMemo(() => {
    const withB = heirSens?.branches?.with_conversions;
    const noB = heirSens?.branches?.no_conversions;
    if (!Array.isArray(withB) || !Array.isArray(noB) || !withB.length) return null;
    const noByRate = new Map(noB.map((e) => [e.rate, e]));
    return withB.map((e) => {
      const n = noByRate.get(e.rate);
      const a = n?.after_tax_estate_to_heirs ?? 0;
      const b = e.after_tax_estate_to_heirs ?? 0;
      return { rate: e.rate, isModeled: !!e.is_modeled, noConv: a, withConv: b, delta: b - a,
               heirTaxNo: n?.inherited_ira_tax ?? 0 };
    });
  }, [heirSens]);

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
  const f = pv ? pv.at(deliverYear) : 1;

  return (
    <Page testid="presentation-page-beneficiary-band">
      <H2>Beneficiary Tax-Rate Band — whose bracket are we planning around?</H2>
      <HoldConstantBand testid="deck-beneficiary-band-band"
        variable="the beneficiaries' assumed combined ordinary rate"
        constant="conversion schedule, spending, returns, longevity, estate structure" />
      <P>
        The legacy figures in this deck assume the heirs pay a{" "}
        <strong>{fmtPct(heirRate)} combined ordinary marginal rate</strong> on every dollar distributed from an
        inherited Traditional IRA during the SECURE Act&apos;s ten-year window. That single assumption moves a
        large share of the result, so the table below re-runs the same plan across a band of beneficiary rates.
        Only the heirs&apos; assumed rate changes down the rows — conversions, markets, and spending are identical.
      </P>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}
             data-testid="presentation-beneficiary-band-table">
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
            <th style={{ padding: "6px 4px", fontSize: 9.5, width: "26%" }}>Beneficiaries&apos; combined ordinary rate</th>
            <th style={{ padding: "6px 4px", fontSize: 9.5, textAlign: "right" }}>After-tax to heirs — no conversions</th>
            <th style={{ padding: "6px 4px", fontSize: 9.5, textAlign: "right", background: "#4A67410D" }}>After-tax to heirs — with conversions</th>
            <th style={{ padding: "6px 4px", fontSize: 9.5, textAlign: "right" }}>Δ nominal</th>
            <th style={{ padding: "6px 4px", fontSize: 9.5, textAlign: "right", background: "#F9F8F6" }}>Δ in today&apos;s $</th>
            <th style={{ padding: "6px 4px", fontSize: 9.5, textAlign: "right" }}>Heirs&apos; IRA tax — no conversions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rate}
                style={{ borderBottom: "1px solid #F3F1EC", background: r.isModeled ? "#F9F8F6" : "transparent",
                         fontWeight: r.isModeled ? 700 : 400 }}
                data-testid={`presentation-beneficiary-band-row-${Math.round(r.rate * 10000)}`}>
              <td style={{ padding: "5px 4px", fontSize: 10.5 }}>
                {fmtPct(r.rate)}
                {r.isModeled && (
                  <span style={{ fontSize: 9, color: "#4A6741", marginLeft: 6, fontWeight: 700 }}>
                    ← as modeled in this deck
                  </span>
                )}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10.5 }}>
                {fmtUSD(r.noConv)}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10.5, background: "#4A67410D" }}>
                {fmtUSD(r.withConv)}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10.5,
                           color: r.delta >= 0 ? "#4A6741" : "#C87941", fontWeight: 600 }}>
                {r.delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(r.delta))}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10.5,
                           background: "#F9F8F6", color: r.delta >= 0 ? "#4A6741" : "#C87941" }}>
                {r.delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(r.delta * f))}
              </td>
              <td style={{ padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10.5, color: "#777" }}>
                {fmtUSD(r.heirTaxNo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Sub>
        {withFlat && (
          <>The &ldquo;with conversions&rdquo; column is flat because this plan converts the Traditional IRA in
          full: with no pre-tax IRA left to inherit, the beneficiaries&apos; rate no longer touches the
          inheritance. Moving that rate risk off the next generation is itself one reason families convert.{" "}</>
        )}
        {breakEven != null && (
          <>Both strategies leave the family the same after-tax inheritance at a beneficiary rate of about{" "}
          <strong>{fmtPct(breakEven)}</strong>: below it, not converting leaves more; above it, converting does.{" "}</>
        )}
        Nominal figures are dollars at the end of the ten-year horizon
        {deliverYear ? ` (${deliverYear})` : ""} and exclude estate tax, which is modeled separately. The
        today&apos;s-dollar column discounts that same difference back to {pv ? pv.start : "the plan start"}
        {pv ? ` at ${fmtPct(pv.rate)}` : ""} — a reminder that a large future difference is a smaller difference
        in money this household could spend now.
      </Sub>

      {includeNarrative && (
        <>
          <H3>Read this with your own family in mind</H3>
          <P>
            If the eventual beneficiaries are highly compensated physicians, attorneys, executives, or business
            owners during those ten years, a high marginal-rate assumption is appropriate and the case for
            converting today is stronger. If they are teachers, nonprofit employees, retirees, or otherwise
            modest-income taxpayers, the economics look materially different. Beneficiaries can also differ from
            one another, move between states, or see their circumstances change before the money is ever
            inherited — which is why this deck presents a range of family possibilities rather than a ranking.
          </P>
        </>
      )}
    </Page>
  );
};

export default BeneficiaryBandPage;
