import { fmtPct, fmtUSD } from "@/lib/api";
import { Page, H2, P, Sub } from "./helpers";
import { McBehaviorNote } from "@/components/shared/McBehaviorNote";

// Pick the return rate for a given tax_type from the scenario's accounts.
// (Returns live on each account, not on the projection block.)
const returnForTaxType = (accounts, taxType) => {
  const list = (accounts || []).filter((a) => a.tax_type === taxType && Number.isFinite(a.return));
  if (!list.length) return null;
  // Weight by beginning balance so multi-account households show a realistic blended rate.
  const totalBal = list.reduce((t, a) => t + Math.max(0, a.beginning_balance || 0), 0);
  if (totalBal > 0) {
    return list.reduce((t, a) => t + (Math.max(0, a.beginning_balance || 0) / totalBal) * a.return, 0);
  }
  return list.reduce((t, a) => t + a.return, 0) / list.length;
};

export const AssumptionsPage = ({ scenario, withRoth, marketPreset, heirRate, clientName, spouseName, ...footProps }) => {
  const p = scenario?.projection || {};
  const l = scenario?.legacy || {};
  const w = scenario?.withdrawal || {};
  const r = scenario?.roth || {};
  const t = scenario?.tax || {};
  const accts = scenario?.accounts || [];
  const rows = withRoth?.rows || [];
  const firstYr = rows[0]?.year;
  const lastYr = rows[rows.length - 1]?.year;
  // Modeled vs permitted conversion window — the strategy may be allowed to
  // convert well past the year the Traditional IRA actually runs dry.
  const convYears = rows.filter((row) => (row.roth_conversion || 0) > 0).map((row) => row.year);
  const modeledWindow = convYears.length
    ? `${convYears[0]} – ${convYears[convYears.length - 1]} (${convYears.length} yr${convYears.length === 1 ? "" : "s"})`
    : "None";
  // 2-decimal rate so a 3.99% statutory rate never prints as "4.0%".
  const fmtRate2 = (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);

  const cashRet = returnForTaxType(accts, "Cash");
  const taxableRet = returnForTaxType(accts, "Taxable");
  const iraRet = returnForTaxType(accts, "Tax-Deferred");
  const rothRet = returnForTaxType(accts, "Tax-Free");

  return (
    <Page testid="cr-page-assumptions" {...footProps}>
      <H2>Assumptions</H2>
      <P>
        Every number in this report flows from the assumptions listed below. If any of them looks off relative to
        {" "}{clientName}{spouseName ? ` & ${spouseName}` : ""}&apos;s actual situation, tell us — the model updates
        instantly and every downstream figure moves with it.
      </P>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 6 }}>
        <tbody>
          {[
            ["Plan horizon", `${firstYr || p.start_year} – ${lastYr || p.end_year}`],
            ["Market scenario", marketPreset?.label || "Historical Average"],
            ["General inflation (CPI)", fmtPct(p.general_inflation)],
            ["Cash return (blended)", fmtPct(cashRet)],
            ["Taxable return (blended)", fmtPct(taxableRet)],
            ["Traditional IRA return (blended)", fmtPct(iraRet)],
            ["Roth return (blended)", fmtPct(rothRet)],
            ["Dividend yield (taxable)", fmtPct(scenario?.dividend_yield)],
            ["Filing status", scenario?.household?.filing_status || "MFJ"],
            ["State income tax rate (flat, held constant)", fmtRate2(t.state_rate)],
            ["IRMAA modeled", t.include_irmaa === false ? "No" : "Yes"],
            ["Roth conversion window (permitted)", r.enabled ? `${r.start_year} – ${r.end_year}` : "Not applied"],
            ["Roth conversions actually modeled", modeledWindow],
            ["Target conversion bracket", r.enabled ? fmtPct(r.target_bracket) : "—"],
            ["Funding order (withdrawals)", w.funding_order || "Cash → Taxable → IRA → Roth"],
            ["Heir marginal rate (ordinary)", fmtPct(heirRate)],
            ["Heir LTCG rate", fmtPct(l.heir_ltcg_rate)],
            ["SECURE Act post-death horizon", `${l.post_death_years ?? 10} years`],
            ["Estate settlement cost", fmtPct(l.estate_settlement_pct)],
            ["Heir realizes gains", l.heir_gains_realized ? "Yes (realized)" : "No (never-sell)"],
            ...((scenario?.household?.qcd_annual_amount || 0) > 0 ? [
              ["QCD annual amount", `${fmtUSD(scenario.household.qcd_annual_amount)}/yr`],
              ["QCD active window",
                `${scenario.household.qcd_start_year || (scenario.household.client_dob_year + 70)} – ${scenario.household.qcd_end_year || (lastYr || p.end_year)}`],
              ["Lifetime QCD (charity total)", fmtUSD(withRoth?.summary?.lifetime_qcd || 0)],
            ] : []),
          ].map(([k, v]) => (
            <tr key={k} style={{ borderBottom: "1px solid #F3F1EC" }}>
              <td style={{ padding: "6px 4px", color: "#5A5A5A" }}>{k}</td>
              <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: 600 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Sub>
        Return rates are the beginning-balance-weighted average of the return set on each account of that tax type
        (edit them on the Plan Inputs → Accounts tab). Numbers are geometric annual averages before the dividend-yield
        drag on the taxable bucket.
      </Sub>
      <div style={{ marginTop: 8, padding: 10, background: "#FAFAF8", border: "1px solid #EBE8E0",
                    borderRadius: 6 }}
           data-testid="cr-assumptions-simplifications">
        <p style={{ fontSize: 9.5, lineHeight: 1.55, color: "#5A5A5A", margin: 0 }}>
          <strong>Simplifying assumptions, not statements of current law.</strong> The state income tax is
          modeled as a single flat rate ({fmtRate2(t.state_rate)}) held constant for the entire horizon. Several
          states — North Carolina among them — have statutory mechanisms that can reduce the rate in later years
          (NCDOR currently lists 3.99% for years after 2025), and future legislatures can change any rate in
          either direction. Likewise, the heirs&apos; marginal rates ({fmtPct(l.heir_federal_rate)} federal +
          {" "}{fmtPct(l.heir_state_rate)} state = {fmtPct(heirRate)} combined) are assumptions about people whose
          future careers, residences, and tax brackets cannot be forecast — see the beneficiary tax-rate
          sensitivity on the Legacy page. Federal brackets, the standard deduction, and IRMAA thresholds index at
          the model&apos;s CPI assumption; the 2026 OBBBA federal structure is assumed to persist. For a
          decades-long hypothetical illustration these are reasonable simplifications, but they are simplifications.
        </p>
      </div>
      <McBehaviorNote variant="box" testid="cr-assumptions-mc-behavior-note" />
    </Page>
  );
};
