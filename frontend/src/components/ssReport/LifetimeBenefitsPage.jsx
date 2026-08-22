import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub, StaticLegend, useIsolation } from "./helpers";
import { CLAIM_AGES, claimFactor } from "./helpers";

// Cumulative-lifetime-benefit-by-claim-age chart + break-even analysis for a single earner.
// One line per claim age, x-axis = spouse's current age → life expectancy.
export const LifetimeBenefitsPage = ({ scenario, fraAmounts, fraAges, owner = "Client", ...footProps }) => {
  const iso = useIsolation();
  const h = scenario?.household || {};
  const cola = scenario?.projection?.ss_cola ?? 0.025;
  const startYear = scenario?.projection?.start_year;
  const fra = fraAmounts?.[owner];
  const fraAge = fraAges?.[owner];
  const birthYear = owner === "Client" ? h.client_dob_year : h.spouse_dob_year;
  const le = owner === "Client" ? h.client_life_expectancy : h.spouse_life_expectancy;
  const currentAge = (startYear && birthYear) ? startYear - birthYear : null;

  if (!fra || !fraAge || !birthYear || !le || currentAge == null) {
    return (
      <Page testid="ssr-page-lifetime-benefits" {...footProps}>
        <H2>Cumulative Lifetime Benefits by Claim Age</H2>
        <P>Enter this spouse&apos;s DOB, life expectancy, and Social Security stream on the Plan Inputs tab to generate this analysis.</P>
      </Page>
    );
  }

  // Build a chart: rows for each age from currentAge → le, columns for each claim age (62/65/67/70).
  // Value = cumulative-benefits-received by that age, in nominal dollars (with COLA).
  const buildSeries = () => {
    const series = [];
    let cumByClaim = { 62: 0, 65: 0, 67: 0, 70: 0 };
    for (let a = currentAge; a <= le; a++) {
      const row = { age: a };
      CLAIM_AGES.forEach((claimAge) => {
        if (a >= claimAge) {
          // Annual benefit at this year, COLA-adjusted from `claimAge` forward.
          const monthlyAtClaim = fra * claimFactor(claimAge, fraAge);
          const yearsSinceClaim = a - claimAge;
          const annualThisYear = monthlyAtClaim * 12 * Math.pow(1 + cola, yearsSinceClaim);
          cumByClaim[claimAge] += annualThisYear;
        }
        row[`Claim ${claimAge}`] = Math.round(cumByClaim[claimAge]);
      });
      series.push(row);
    }
    return series;
  };
  const series = buildSeries();

  // Break-even ages — compare 62 vs 70 first (most common analysis)
  const findBreakEven = (claimEarly, claimLate) => {
    for (const row of series) {
      if (row.age >= claimLate && row[`Claim ${claimLate}`] > row[`Claim ${claimEarly}`]) {
        return row.age;
      }
    }
    return null;
  };
  const be62v70 = findBreakEven(62, 70);
  const be62v67 = findBreakEven(62, 67);
  const be67v70 = findBreakEven(67, 70);

  // Total collected at LE
  const lastRow = series[series.length - 1] || {};
  const totalByAge = CLAIM_AGES.reduce((acc, a) => {
    acc[a] = lastRow[`Claim ${a}`] || 0;
    return acc;
  }, {});
  const bestAge = CLAIM_AGES.reduce((best, a) => totalByAge[a] > totalByAge[best] ? a : best, 62);

  return (
    <Page testid="ssr-page-lifetime-benefits" {...footProps}>
      <H2>Cumulative Lifetime Benefits — {owner === "Client" ? h.client_name || "Client" : h.spouse_name || "Spouse"}</H2>
      <P>
        Total nominal dollars received from Social Security, cumulated year by year from current age to the modeled life
        expectancy of <strong>{le}</strong>, at each of the four canonical claim ages. Later-claim curves start below the
        earlier-claim curves (because you receive nothing before you claim) but grow faster (because your monthly benefit
        is larger). The <strong>break-even age</strong> is where a delayed-claim curve crosses an earlier-claim curve — after
        that point, the delayed strategy has paid off in cumulative dollars.
      </P>

      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="age" tick={{ fontSize: 10 }} tickLine={false}
              label={{ value: `${owner === "Client" ? h.client_name || "Client" : h.spouse_name || "Spouse"}'s age`, position: "insideBottom", offset: -4, fontSize: 9, fill: "#777" }} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1000)}K`} width={52} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            {be62v70 && <ReferenceLine x={be62v70} stroke="#B84A4A" strokeDasharray="3 3"
              label={{ value: `Break-even 62 vs 70: age ${be62v70}`, position: "insideTopLeft", fontSize: 9, fill: "#B84A4A" }} />}
            <Line type="monotone" dataKey="Claim 62" stroke="#B84A4A" strokeWidth={1.8} dot={false} isAnimationActive={false} {...iso.dim("Claim 62")} />
            <Line type="monotone" dataKey="Claim 65" stroke="#C87941" strokeWidth={1.8} dot={false} isAnimationActive={false} {...iso.dim("Claim 65")} />
            <Line type="monotone" dataKey="Claim 67" stroke="#C4A64A" strokeWidth={1.8} dot={false} isAnimationActive={false} {...iso.dim("Claim 67")} />
            <Line type="monotone" dataKey="Claim 70" stroke="#4A6741" strokeWidth={2.2} dot={false} isAnimationActive={false} {...iso.dim("Claim 70")} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={[
          { label: "Claim 62", color: "#B84A4A", dataKey: "Claim 62" },
          { label: "Claim 65", color: "#C87941", dataKey: "Claim 65" },
          { label: "Claim 67", color: "#C4A64A", dataKey: "Claim 67" },
          { label: "Claim 70", color: "#4A6741", dataKey: "Claim 70" },
        ]}
        isolated={iso.isolated}
        onToggle={iso.toggle}
        size={9}
        testid="ssr-lifetime-benefits-legend"
      />

      <H3>Break-even ages</H3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 8 }}>
        <div style={{ border: "1px solid #EBE8E0", borderRadius: 8, padding: "8px 10px", background: "#F9F8F6" }}>
          <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700 }}>62 → 70</div>
          <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, marginTop: 2 }}>{be62v70 ? `Age ${be62v70}` : "—"}</div>
          <div style={{ fontSize: 9, color: "#777", marginTop: 2 }}>Live past this age → age-70 wins</div>
        </div>
        <div style={{ border: "1px solid #EBE8E0", borderRadius: 8, padding: "8px 10px", background: "#F9F8F6" }}>
          <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#C4A64A", fontWeight: 700 }}>62 → 67</div>
          <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, marginTop: 2 }}>{be62v67 ? `Age ${be62v67}` : "—"}</div>
        </div>
        <div style={{ border: "1px solid #EBE8E0", borderRadius: 8, padding: "8px 10px", background: "#F9F8F6" }}>
          <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700 }}>67 → 70</div>
          <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 16, fontWeight: 700, marginTop: 2 }}>{be67v70 ? `Age ${be67v70}` : "—"}</div>
        </div>
      </div>

      <H3>Total collected by age {le} (nominal, with COLA)</H3>
      <table style={{ width: "100%", fontSize: 10.5, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #EBE8E0", background: "#F9F8F6" }}>
            <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Claim age</th>
            <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Total received</th>
            <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>vs Age {bestAge}</th>
          </tr>
        </thead>
        <tbody>
          {CLAIM_AGES.map((a) => (
            <tr key={a} style={{ borderBottom: "1px solid #F3F1EC", background: a === bestAge ? "#4A67410D" : "transparent" }}>
              <td style={{ padding: "5px 8px", fontWeight: a === bestAge ? 700 : 400 }}>Claim at {a}</td>
              <td style={{ textAlign: "right", padding: "5px 8px", fontWeight: a === bestAge ? 700 : 400 }}>{fmtUSD(totalByAge[a])}</td>
              <td style={{ textAlign: "right", padding: "5px 8px", color: a === bestAge ? "#4A6741" : "#B84A4A", fontWeight: 700 }}>
                {a === bestAge ? "Best" : fmtUSD(totalByAge[a] - totalByAge[bestAge])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Sub>
        Cumulative benefits assume the modeled life expectancy and the plan&apos;s SS COLA of {(cola * 100).toFixed(1)}%/yr.
        These totals ignore the <em>use</em> of the dollars — even the &ldquo;highest lifetime SS&rdquo; row is not
        automatically the best plan. The household-level analysis on the next page accounts for how the claim decision
        interacts with Roth conversions, RMDs, and taxes.
      </Sub>
    </Page>
  );
};
