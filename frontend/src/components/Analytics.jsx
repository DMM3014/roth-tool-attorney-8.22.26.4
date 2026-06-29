import { useEffect, useMemo, useState } from "react";
import { runProjection } from "@/lib/api";
import {
  IncomeSourcesChart, BracketFillChart, SurplusChart, TaxCompositionChart,
  RmdBalanceChart, IrmaaChart, RateTrendChart, CumulativeTaxChart,
} from "@/components/AnalyticsCharts";

const BRACKET_LABELS = ["10%", "12%", "22%", "24%", "32%", "35%", "37%"];

export const Analytics = ({ scenario }) => {
  const [withRoth, setWithRoth] = useState(null);
  const [noRoth, setNoRoth] = useState(null);

  const sig = JSON.stringify(scenario);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const tasks = [runProjection(scenario)];
      if (scenario.roth?.enabled) {
        const noCfg = JSON.parse(JSON.stringify(scenario));
        noCfg.roth.enabled = false;
        tasks.push(runProjection(noCfg));
      }
      Promise.all(tasks).then(([a, b]) => {
        if (alive) { setWithRoth(a); setNoRoth(b || a); }
      });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const rows = useMemo(() => withRoth?.rows || [], [withRoth]);

  const incomeData = useMemo(() => rows.map((r) => {
    const cf = r.cashflow || {};
    return {
      year: r.year,
      Wages: cf.wages_pension || 0,
      SocialSecurity: cf.gross_ss || 0,
      Dividends: cf.dividends || 0,
      Interest: cf.interest || 0,
      RMD: cf.rmd || 0,
      Conversion: cf.conversion || 0,
      Withdrawals: (cf.from_cash || 0) + (cf.from_taxable || 0) + (cf.from_ira || 0) + (cf.from_roth || 0),
      Need: (cf.expenses || 0) + (cf.income_tax || 0) + (cf.medicare || 0),
    };
  }), [rows]);

  const bracketData = useMemo(() => rows.map((r) => {
    const o = { year: r.year, marginal: r.marginal_rate };
    (r.bracket_fill || []).forEach((b) => { o[`${Math.round(b.rate * 100)}%`] = b.amount; });
    return o;
  }), [rows]);

  const surplusData = useMemo(() => rows.map((r) => ({ year: r.year, surplus: r.cashflow?.surplus || 0 })), [rows]);
  const taxCompData = useMemo(() => rows.map((r) => ({ year: r.year, ...(r.tax_breakdown || {}) })), [rows]);
  const rmdData = useMemo(() => rows.map((r) => ({ year: r.year, rmd: r.rmd, traditional: r.traditional, roth: r.roth })), [rows]);
  const irmaaData = useMemo(() => rows.map((r) => {
    const t = r.irmaa_thresholds || [];
    return { year: r.year, magi: r.magi, t0: t[0], t1: t[1], t2: t[2], t3: t[3], t4: t[4] };
  }), [rows]);
  const rateData = useMemo(() => rows.map((r) => ({ year: r.year, effective: r.effective_rate, marginal: r.marginal_rate })), [rows]);
  const cumData = useMemo(() => {
    let cy = 0, cn = 0;
    return rows.map((r, i) => {
      cy += r.total_tax || 0;
      cn += noRoth?.rows?.[i]?.total_tax || 0;
      return { year: r.year, cumYes: Math.round(cy), cumNo: Math.round(cn) };
    });
  }, [rows, noRoth]);

  if (!withRoth) {
    return <div className="py-20 text-center text-muted-foreground animate-pulse label-cap">Running analytics…</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="analytics-grid">
      <IncomeSourcesChart data={incomeData} />
      <BracketFillChart data={bracketData} brackets={BRACKET_LABELS} />
      <SurplusChart data={surplusData} />
      <TaxCompositionChart data={taxCompData} />
      <RmdBalanceChart data={rmdData} />
      <IrmaaChart data={irmaaData} />
      <RateTrendChart data={rateData} />
      <CumulativeTaxChart data={cumData} />
    </div>
  );
};
