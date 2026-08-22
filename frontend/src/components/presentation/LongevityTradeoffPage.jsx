import { fmtUSD, fmtPct } from "@/lib/api";
import { HoldConstantBand } from "@/components/shared/PrintBlocks";
import { Page, H2, H3, P, Sub } from "./printPrimitives";

/**
 * LongevityTradeoffPage — the funding-order trade-off is largely a LONGEVITY bet,
 * so show it instead of asserting it.
 *
 * Funding conversion tax from the taxable brokerage buys a bigger Roth (tax-free
 * compounding for the survivor and then through the heirs' SECURE-10 window) at
 * the cost of the §1014 step-up on those liquidated taxable assets. Funding it
 * from the IRA keeps the step-up intact but shrinks the balance available to
 * convert. Which side leads depends on how long the surviving spouse lives —
 * this grid runs the SAME conversion strategy at several survivor lifespans
 * (data from POST /api/longevity/funding-order).
 */
const SHORT = {
  "Cash → Taxable → IRA → Roth": "Taxable-first",
  "Cash → IRA → Taxable → Roth": "IRA-first",
  "Split IRA & Taxable": "Split",
};

const th = { padding: "6px 4px", textAlign: "right", fontSize: 9.5 };
const td = { padding: "5px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10.5 };

export const LongevityTradeoffPage = ({ data, pv, horizon = 10, includeNarrative = true }) => {
  const rows = data?.rows || [];
  if (rows.length < 2) return null;
  const orders = data.orders || Object.keys(rows[0].orders || {});
  const survivorWord = data.survivor === "client" ? "client" : "surviving spouse";
  const taxableKey = "Cash → Taxable → IRA → Roth";
  const iraKey = "Cash → IRA → Taxable → Roth";
  const hasPair = orders.includes(taxableKey) && orders.includes(iraKey);
  const deltaOf = (r) => (hasPair
    ? (r.orders[taxableKey]?.after_tax_estate || 0) - (r.orders[iraKey]?.after_tax_estate || 0)
    : null);
  // Does the leader actually change across the tested lifespans?
  const leaders = [...new Set(rows.map((r) => r.leader))];
  const flips = leaders.length > 1;
  const baseRow = rows.find((r) => r.extra_years === 0) || rows[0];
  const pvOf = (v, r) => (pv ? v * pv.at((r.second_death_year || 0) + horizon) : v);

  return (
    <Page testid="presentation-page-longevity">
      <H2>Funding Order &amp; Longevity — the trade-off in both directions</H2>
      <HoldConstantBand testid="deck-longevity-band"
        variable="how long the survivor lives (and the withdrawal order across columns)"
        constant="conversion schedule, brackets, spending, returns, beneficiary assumption" />
      <P>
        The funding-order section explained why this is a trade-off rather than a leader. This page quantifies it.
        Every row below runs the <strong>identical conversion strategy</strong> — same brackets, same window, same
        markets, same spending — and changes only one thing: how long the {survivorWord} lives. The columns show
        the after-tax inheritance under each withdrawal order.
      </P>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}
             data-testid="presentation-longevity-table">
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
            <th style={{ padding: "6px 4px", fontSize: 9.5 }}>{survivorWord === "client" ? "Client" : "Survivor"} lifespan</th>
            <th style={th}>2nd death</th>
            {orders.map((o) => (
              <th key={o} style={{ ...th, background: o === taxableKey ? "#4A67410D" : undefined }}>
                {SHORT[o] || o}
              </th>
            ))}
            {hasPair && <th style={th}>Taxable-first − IRA-first</th>}
            {hasPair && <th style={{ ...th, background: "#F9F8F6" }}>Same, in today&apos;s $</th>}
            <th style={{ padding: "6px 4px", fontSize: 9.5 }}>Leads</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = deltaOf(r);
            const isBase = r.extra_years === 0;
            return (
              <tr key={r.extra_years}
                  style={{ borderBottom: "1px solid #F3F1EC", background: isBase ? "#F9F8F6" : "transparent",
                           fontWeight: isBase ? 700 : 400 }}
                  data-testid={`presentation-longevity-row-${r.extra_years}`}>
                <td style={{ padding: "5px 4px", fontSize: 10.5 }}>
                  {r.extra_years === 0
                    ? `As planned (age ${r.survivor_age_at_death})`
                    : `${r.extra_years > 0 ? "+" : "−"}${Math.abs(r.extra_years)} yrs (age ${r.survivor_age_at_death})`}
                </td>
                <td style={td}>{r.second_death_year}</td>
                {orders.map((o) => (
                  <td key={o} style={{ ...td, background: o === taxableKey ? "#4A67410D" : undefined }}>
                    {fmtUSD(r.orders[o]?.after_tax_estate)}
                  </td>
                ))}
                {hasPair && (
                  <td style={{ ...td, color: d >= 0 ? "#4A6741" : "#C87941", fontWeight: 600 }}>
                    {d >= 0 ? "+" : "−"}{fmtUSD(Math.abs(d))}
                  </td>
                )}
                {hasPair && (
                  <td style={{ ...td, background: "#F9F8F6", color: d >= 0 ? "#4A6741" : "#C87941" }}>
                    {d >= 0 ? "+" : "−"}{fmtUSD(Math.abs(pvOf(d, r)))}
                  </td>
                )}
                <td style={{ padding: "5px 4px", fontSize: 10 }}>{SHORT[r.leader] || r.leader}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Sub>
        &ldquo;Leads&rdquo; = highest after-tax inheritance in that row only, on these assumptions. It is not a
        recommendation, and lifespans this long (or short) are illustrations, not forecasts. Everything else in the
        plan is held constant, so the movement across rows is attributable to longevity alone. The
        today&apos;s-dollar column discounts each row&apos;s difference from its own delivery year (that row&apos;s
        second death plus the {horizon}-year heirs&apos; window) back to {pv ? pv.start : "the plan start"}
        {pv ? ` at ${fmtPct(pv.rate)}` : ""} — later deaths deliver later, so the same nominal gap is worth less
        today.
      </Sub>

      {includeNarrative && (
        <>
          <H3>What the pattern means for your family</H3>
          <P>
            {flips ? (
              <>
                <strong>The leader changes across these lifespans.</strong> Shorter survivorship favours{" "}
                <strong>{SHORT[rows[0].leader] || rows[0].leader}</strong>, because taxable assets that are never
                liquidated receive a full basis step-up at the second death and their embedded gain simply
                disappears. Longer survivorship favours{" "}
                <strong>{SHORT[rows[rows.length - 1].leader] || rows[rows.length - 1].leader}</strong>, because a
                larger Roth balance has more years to compound income-tax free before the heirs&apos; ten-year
                window even begins. Your plan as written sits at{" "}
                <strong>{baseRow.second_death_year}</strong>, near where the two paths cross — which is precisely
                why neither can be declared the right answer in advance.
              </>
            ) : (
              <>
                Across every lifespan tested here, <strong>{SHORT[baseRow.leader] || baseRow.leader}</strong>{" "}
                produced the larger after-tax inheritance — but notice how the <em>size</em> of the advantage
                changes. The trade-off is not whether one order is theoretically better; it is how much of the
                advantage survives if the {survivorWord} lives materially longer or shorter than assumed. A margin
                that only appears under an optimistic lifespan is not a margin to pay current tax for.
              </>
            )}
          </P>
          <P>
            Read this alongside two other pages: the beneficiary tax-rate band (which changes who benefits from the
            larger Roth) and the caveats page (which reminds you these projections assume constant, linear returns).
            Longevity, beneficiary brackets, and market path are three independent unknowns; the funding-order
            decision should be revisited as each of them becomes clearer.
          </P>
        </>
      )}
    </Page>
  );
};

export default LongevityTradeoffPage;
