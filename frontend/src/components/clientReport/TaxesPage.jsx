import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";
import { fmtUSD, fmtPct, pvSeries } from "@/lib/api";
import { Page, H2, H3, P, Sub, Kpi, StaticLegend, useIsolation } from "./helpers";

export const TaxesPage = ({ taxCompData, rows, withRoth, noRoth, scenario, pvRateOverride, ...footProps }) => {
  const s = withRoth?.summary || {};
  const sn = noRoth?.summary || {};

  const totalOrd = rows.reduce((t, r) => t + (r.tax_detail?.taxable_ordinary_before_ss || 0)
    + (r.tax_detail?.taxable_ss || 0), 0);
  const totalPref = rows.reduce((t, r) => t + (r.tax_detail?.total_preferential || 0), 0);
  const lifetimeQcd = s.lifetime_qcd || 0;
  // Approximate tax savings: QCD kept out of AGI, taxed at the plan's average marginal ordinary rate.
  const marginalYears = rows.filter((r) => (r.qcd || 0) > 0);
  const avgMarginal = marginalYears.length > 0
    ? marginalYears.reduce((t, r) => t + (r.marginal_rate || 0), 0) / marginalYears.length : 0;
  const qcdTaxSaved = Math.round(lifetimeQcd * avgMarginal);
  const iso = useIsolation();

  // NPV of parents' lifetime tax paid — advisor-requested comparison. Uses
  // the same discount rate as the PV net-to-family chart on the Legacy page
  // for internal consistency across the report.
  const npv = useMemo(() => {
    if (!scenario || !withRoth?.rows?.length || !noRoth?.rows?.length) return null;
    const pv = pvSeries(withRoth, noRoth, scenario, pvRateOverride);
    const r = pv?.ntf?.discountRate;
    if (r == null) return null;
    const startYr = scenario?.projection?.start_year ?? withRoth.rows[0].year;
    const disc = (y) => 1 / Math.pow(1 + r, Math.max(0, y - startYr));
    const yr = (row) => {
      const tb = row?.tax_breakdown || {};
      return (tb.ordinary || 0) + (tb.preferential || 0) + (tb.state || 0)
           + (tb.niit || 0) + (tb.medicare || 0);
    };
    let w = 0, n = 0;
    for (const row of withRoth.rows) w += yr(row) * disc(row.year);
    for (const row of noRoth.rows)   n += yr(row) * disc(row.year);
    return { r, w, n, delta: n - w };
  }, [scenario, withRoth, noRoth, pvRateOverride]);

  return (
    <Page testid="cr-page-taxes" {...footProps}>
      <H2>Taxes</H2>
      <P>
        Retirement taxes are complicated because different dollars are taxed differently. The plan preserves the
        separation between ordinary income (wages, IRA withdrawals, pensions, and the taxable portion of Social
        Security) and preferential income (long-term capital gains and qualified dividends), which have their own
        0% / 15% / 20% brackets that stack on top of ordinary income.
      </P>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Kpi label="Lifetime taxes — with strategy (nominal)" value={fmtUSD(s.lifetime_taxes)} tone="green" />
        <Kpi label="Lifetime taxes — no conversions (nominal)" value={fmtUSD(sn.lifetime_taxes)} tone="orange"
          sub={`Δ ${fmtUSD((sn.lifetime_taxes || 0) - (s.lifetime_taxes || 0))} ${(sn.lifetime_taxes || 0) > (s.lifetime_taxes || 0) ? "saved" : "additional"}`} />
        {npv && (
          <>
            <Kpi label={`Lifetime taxes — with strategy (NPV @ ${fmtPct(npv.r)})`}
                 value={fmtUSD(npv.w)} tone="green" />
            <Kpi label={`Lifetime taxes — no conversions (NPV @ ${fmtPct(npv.r)})`}
                 value={fmtUSD(npv.n)} tone="orange"
                 sub={`NPV Δ ${fmtUSD(npv.delta)} ${npv.delta >= 0 ? "saved" : "additional"}`} />
          </>
        )}
      </div>
      {npv && (
        <Sub>
          The NPV row discounts each year&apos;s tax bill at {fmtPct(npv.r)} back to
          {" "}{scenario?.projection?.start_year || "the plan start"}. Present-value comparison is the
          apples-to-apples measure across strategies that shift tax to different years — a $1 tax paid in
          2026 costs the plan more than the same dollar paid in 2050.
        </Sub>
      )}
      <H3>Estimated taxes by type</H3>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={taxCompData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="year" tick={{ fontSize: 9 }} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1e3)}K`} width={46} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Bar dataKey="ordinary" stackId="t" fill="#4A6741" name="Federal Ordinary" isAnimationActive={false} {...iso.dim("ordinary")} />
            <Bar dataKey="preferential" stackId="t" fill="#7A9B76" name="LTCG / Dividends" isAnimationActive={false} {...iso.dim("preferential")} />
            <Bar dataKey="niit" stackId="t" fill="#4A78A6" name="NIIT 3.8%" isAnimationActive={false} {...iso.dim("niit")} />
            <Bar dataKey="state" stackId="t" fill="#C4A64A" name="State" isAnimationActive={false} {...iso.dim("state")} />
            <Bar dataKey="medicare" stackId="t" fill="#C87941" name="Medicare + IRMAA" isAnimationActive={false} {...iso.dim("medicare")} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={[
          { label: "Federal Ordinary", color: "#4A6741", dataKey: "ordinary" },
          { label: "LTCG / Dividends", color: "#7A9B76", dataKey: "preferential" },
          { label: "NIIT 3.8%", color: "#4A78A6", dataKey: "niit" },
          { label: "State", color: "#C4A64A", dataKey: "state" },
          { label: "Medicare + IRMAA", color: "#C87941", dataKey: "medicare" },
        ]}
        isolated={iso.isolated}
        onToggle={iso.toggle}
        testid="cr-taxes-legend"
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <Kpi label="Total ordinary income" value={fmtUSD(totalOrd)}
          sub="Wages, pensions, IRA/RMD, taxable SS" />
        <Kpi label="Total preferential income" value={fmtUSD(totalPref)}
          sub="LTCG + qualified dividends" />
      </div>
      {lifetimeQcd > 0 && (
        <>
          <H3>Charitable Giving — Qualified Charitable Distributions</H3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }} data-testid="cr-taxes-qcd-tiles">
            <Kpi label="Lifetime QCD directed to charity" tone="gold" value={fmtUSD(lifetimeQcd)}
              sub={`Across ${marginalYears.length} year(s), directly from IRA → 501(c)(3)`} />
            <Kpi label="Estimated tax saved by QCD" tone="green" value={fmtUSD(qcdTaxSaved)}
              sub={`Kept out of AGI at avg. ${(avgMarginal * 100).toFixed(0)}% marginal ordinary rate`} />
          </div>
          <Sub>
            QCD dollars satisfy the RMD requirement without entering AGI — so they never push you toward the SS taxability
            phase-in or an IRMAA cliff. Even a modest $10-20K/yr QCD by a charitably-inclined couple can move real dollars.
          </Sub>
        </>
      )}
      <Sub>
        The green Roth-conversion bar you see spike in earlier years is what pushes the terra-cotta &ldquo;no
        conversions&rdquo; line higher later — those RMD-driven ordinary-income years are exactly what the
        conversion strategy is designed to avoid.
      </Sub>
    </Page>
  );
};
