import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub, Kpi, StaticLegend, useIsolation } from "./helpers";

// Shows the Roth-conversion interaction: as SS starts, ordinary income jumps and Roth
// conversion room within the 22-24% brackets collapses. Uses the current scenario
// projection to plot marginal rate + ordinary income + roth conversion side by side.
export const RothInteractionPage = ({ withRoth, scenario, ...footProps }) => {
  const iso = useIsolation();
  const rows = withRoth?.rows || [];
  const h = scenario?.household || {};
  const cSsAge = h.client_ss_claim_age;
  const sSsAge = h.spouse_ss_claim_age;
  const cSsYear = (h.client_dob_year && cSsAge != null) ? h.client_dob_year + cSsAge : null;
  const sSsYear = (h.spouse_dob_year && sSsAge != null) ? h.spouse_dob_year + sSsAge : null;
  const rmdStartYear = rows.find((r) => (r.cashflow?.rmd || 0) > 0)?.year;

  const chartData = rows.map((r) => ({
    year: r.year,
    "Roth conversion": r.roth_conversion || 0,
    "SS income": r.cashflow?.gross_ss || 0,
    "RMD": r.cashflow?.rmd || 0,
    "Marginal rate (%)": (r.marginal_rate || 0) * 100,
  }));

  const preSsConvSum = rows.filter((r) => (r.cashflow?.gross_ss || 0) === 0)
    .reduce((t, r) => t + (r.roth_conversion || 0), 0);
  const postSsConvSum = rows.filter((r) => (r.cashflow?.gross_ss || 0) > 0)
    .reduce((t, r) => t + (r.roth_conversion || 0), 0);

  return (
    <Page testid="ssr-page-roth-interaction" {...footProps}>
      <H2>The Roth-Conversion Interaction</H2>
      <P>
        This is the single most important insight for households with a large Traditional IRA. Claiming Social Security
        early <strong>fills the low 12% and 22% brackets with taxable ordinary income</strong>, closing the window during
        which Roth conversions can be executed cheaply. Once RMDs also start (age 73–75), the pressure compounds.
      </P>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Kpi label="Roth converted BEFORE SS starts" tone="green"
          value={fmtUSD(preSsConvSum)}
          sub={cSsYear ? `Years before ${Math.min(cSsYear, sSsYear || cSsYear)}` : "Pre-SS window"} />
        <Kpi label="Roth converted AFTER SS starts" tone="orange"
          value={fmtUSD(postSsConvSum)}
          sub="Compressed by SS ordinary income + RMDs" />
      </div>

      <H3>Roth conversions, SS &amp; RMDs — timeline</H3>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1000)}K`} width={48} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Bar yAxisId="left" dataKey="Roth conversion" stackId="a" fill="#4A6741" isAnimationActive={false} {...iso.dim("Roth conversion")} />
            <Bar yAxisId="left" dataKey="SS income" stackId="b" fill="#C87941" isAnimationActive={false} {...iso.dim("SS income")} />
            <Bar yAxisId="left" dataKey="RMD" stackId="b" fill="#C4A64A" isAnimationActive={false} {...iso.dim("RMD")} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={[
          { label: "Roth conversion", color: "#4A6741", dataKey: "Roth conversion" },
          { label: "SS income", color: "#C87941", dataKey: "SS income" },
          { label: "RMD", color: "#C4A64A", dataKey: "RMD" },
        ]}
        isolated={iso.isolated}
        onToggle={iso.toggle}
        size={9}
        testid="ssr-roth-interaction-legend"
      />

      <H3>What this chart shows</H3>
      <ul style={{ fontSize: 10.5, lineHeight: 1.6, color: "#2A2A2A", paddingLeft: 20, marginBottom: 8 }}>
        <li>
          <strong>Green bars (Roth conversions)</strong> are largest before Social Security starts — that&apos;s when the
          household has the most room in the 12% and 22% brackets.
        </li>
        <li>
          <strong>Orange bars (SS income)</strong> begin at your planned claim ages
          {cSsYear ? ` (Client at age ${cSsAge} in ${cSsYear}` : ""}
          {sSsYear ? `${cSsYear ? ", Spouse " : " (Spouse "}at age ${sSsAge} in ${sSsYear})` : cSsYear ? ")" : ""}.
        </li>
        {rmdStartYear && (
          <li>
            <strong>Gold bars (RMDs)</strong> kick in at age 73–75 (year {rmdStartYear}), adding a second source of
            forced ordinary income. Together with SS, they can shove the household into the 24%, 32%, or even 37%
            bracket — the exact brackets you were trying to avoid.
          </li>
        )}
      </ul>

      <H3>The claim-age trade-off, restated</H3>
      <P>
        Claiming SS at 62 <em>maximizes lifetime SS collected</em> but <em>shrinks the Roth window</em>. Delaying to 70
        <em> costs 8 years of SS income</em> but <em>keeps the Roth window wide open</em> during peak conversion years —
        and buys a higher survivor benefit for the widow(er). For households with ≥ $2M in Traditional IRA, the delayed-claim
        strategy usually wins on after-tax legacy despite the shorter SS-collection window.
      </P>

      <div style={{
        padding: "10px 12px", background: "#4A67410D", border: "1px solid #4A6741",
        borderRadius: 8, marginTop: 6,
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#4A6741", marginBottom: 4 }}>
          Advisor rule of thumb
        </div>
        <p style={{ fontSize: 10, color: "#1A1A1A", lineHeight: 1.55, margin: 0 }}>
          Delay the <strong>higher earner&apos;s</strong> claim to age 70 whenever possible (for survivor-benefit
          protection). The lower earner&apos;s claim age is a smaller decision — pick the age that maximizes
          Roth-conversion room during the 62-to-73 window.
        </p>
      </div>

      <Sub>
        The bars above are drawn from your actual projection at the current strategy. If the Roth-conversion schedule
        or SS claim ages change on the Plan Inputs / SS Analyzer tabs, this chart updates automatically.
      </Sub>
    </Page>
  );
};
