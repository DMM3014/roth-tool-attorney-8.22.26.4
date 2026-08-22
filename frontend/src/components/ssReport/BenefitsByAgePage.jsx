import { Fragment } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, LabelList,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub, Kpi, StaticLegend, useIsolation } from "./helpers";
import { CLAIM_AGES, claimFactor } from "./helpers";

// Table + bar chart of monthly benefit at 62/65/67/70 for each spouse.
// Nominal = today's dollars at the claim age.
// COLA-adjusted = today's dollars compounded forward by SS COLA from current age to claim age.
export const BenefitsByAgePage = ({ scenario, fraAmounts, fraAges, onClaimClick, ...footProps }) => {
  const iso = useIsolation();
  const h = scenario?.household || {};
  const startYear = scenario?.projection?.start_year;
  const cola = scenario?.projection?.ss_cola ?? 0.025;
  const clientAge = (startYear && h.client_dob_year) ? startYear - h.client_dob_year : null;
  const spouseAge = (startYear && h.spouse_dob_year) ? startYear - h.spouse_dob_year : null;

  const buildRow = (owner) => {
    const fra = fraAmounts?.[owner];
    const fraAge = fraAges?.[owner];
    const curAge = owner === "Client" ? clientAge : spouseAge;
    if (fra == null || fraAge == null) return null;
    const row = { owner };
    CLAIM_AGES.forEach((a) => {
      const monthly = Math.round(fra * claimFactor(a, fraAge));
      const yearsToClaim = Math.max(0, a - (curAge ?? 0));
      const colaAdj = Math.round(monthly * Math.pow(1 + cola, yearsToClaim));
      row[`age${a}`] = monthly;
      row[`age${a}_cola`] = colaAdj;
    });
    return row;
  };

  const clientRow = buildRow("Client");
  const spouseRow = buildRow("Spouse");

  // Chart data: one row per age with columns for each spouse's nominal + COLA-adj.
  const chartData = CLAIM_AGES.map((a) => {
    const row = { age: `Age ${a}` };
    if (clientRow) {
      row["Client — nominal"] = clientRow[`age${a}`];
      row["Client — COLA-adj"] = clientRow[`age${a}_cola`];
    }
    if (spouseRow) {
      row["Spouse — nominal"] = spouseRow[`age${a}`];
      row["Spouse — COLA-adj"] = spouseRow[`age${a}_cola`];
    }
    return row;
  });

  return (
    <Page testid="ssr-page-benefits-by-age" {...footProps}>
      <H2>Your Benefit at Each Claim Age</H2>
      <P>
        Using your Primary Insurance Amount (PIA) as the baseline, here&apos;s what your monthly Social Security check
        would look like at each of the four canonical claim ages. <strong>Nominal</strong> is expressed in today&apos;s
        dollars at the SSA reduction/credit factor. <strong>COLA-adjusted</strong> is what you would actually deposit
        in your bank account in the year you first claim, after {(cola * 100).toFixed(1)}%/yr cost-of-living increases
        from now until claim.
      </P>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Kpi label="Client PIA (FRA benefit)" tone="gold"
          value={fraAmounts?.Client ? `${fmtUSD(fraAmounts.Client)}/mo` : "—"}
          sub={fraAmounts?.Client ? `${fmtUSD(fraAmounts.Client * 12)}/yr in today's dollars` : ""} />
        <Kpi label="Spouse PIA (FRA benefit)" tone="gold"
          value={fraAmounts?.Spouse ? `${fmtUSD(fraAmounts.Spouse)}/mo` : "—"}
          sub={fraAmounts?.Spouse ? `${fmtUSD(fraAmounts.Spouse * 12)}/yr in today's dollars` : ""} />
      </div>

      <H3>Monthly benefit at each claim age (nominal + COLA-adjusted)</H3>
      {onClaimClick && (
        <p style={{ fontSize: 10, color: "#4A6741", marginBottom: 4, fontStyle: "italic" }} data-testid="ssr-benefit-click-hint">
          Tip: click any bar to instantly reproject the whole plan with that claim age applied.
        </p>
      )}
      <div style={{ height: 220, marginBottom: 8, cursor: onClaimClick ? "pointer" : "default" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}
            onClick={onClaimClick ? (e) => {
              if (!e?.activeLabel) return;
              // activeLabel = "Age 62"|"Age 65"|"Age 67"|"Age 70"
              const m = String(e.activeLabel).match(/(\d+)/);
              if (!m) return;
              const clickedAge = parseInt(m[1], 10);
              // For clicks, prefer the closer-owner bar per activePayload.dataKey — if we
              // can't disambiguate, apply to Client (larger PIA usually the higher earner).
              const key = e.activePayload?.[0]?.dataKey || "";
              const owner = key.startsWith("Spouse") ? "Spouse" : "Client";
              onClaimClick(owner, clickedAge);
            } : undefined}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="age" tick={{ fontSize: 10 }} tickLine={false} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 1000)}K`} width={42} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Bar dataKey="Client — nominal" fill="#4A6741" isAnimationActive={false} data-testid="ssr-bar-client-nom"
              {...iso.dim("Client — nominal")}>
              <LabelList dataKey="Client — nominal" position="top" formatter={(v) => v ? `$${Math.round(v / 100) / 10}K` : ""} style={{ fontSize: 9, fill: "#4A6741" }} />
            </Bar>
            <Bar dataKey="Client — COLA-adj" fill="#7A9B76" isAnimationActive={false} {...iso.dim("Client — COLA-adj")} />
            <Bar dataKey="Spouse — nominal" fill="#C87941" isAnimationActive={false} {...iso.dim("Spouse — nominal")} />
            <Bar dataKey="Spouse — COLA-adj" fill="#E5B87A" isAnimationActive={false} {...iso.dim("Spouse — COLA-adj")} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={[
          { label: "Client — nominal", color: "#4A6741", dataKey: "Client — nominal" },
          { label: "Client — COLA-adj", color: "#7A9B76", dataKey: "Client — COLA-adj" },
          { label: "Spouse — nominal", color: "#C87941", dataKey: "Spouse — nominal" },
          { label: "Spouse — COLA-adj", color: "#E5B87A", dataKey: "Spouse — COLA-adj" },
        ]}
        isolated={iso.isolated}
        onToggle={iso.toggle}
        size={9}
        testid="ssr-benefits-by-age-legend"
      />

      <H3>Detail table</H3>
      <table style={{ width: "100%", fontSize: 10.5, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #EBE8E0", background: "#F9F8F6" }}>
            <th style={{ textAlign: "left", padding: "5px 6px", fontWeight: 700, color: "#5A5A5A" }}>Spouse</th>
            {CLAIM_AGES.map((a) => (
              <th key={a} style={{ textAlign: "right", padding: "5px 6px", fontWeight: 700, color: "#5A5A5A" }} colSpan={2}>Age {a}</th>
            ))}
          </tr>
          <tr style={{ borderBottom: "1px solid #EBE8E0", background: "#F9F8F6" }}>
            <th></th>
            {CLAIM_AGES.map((a) => (
              <Fragment key={a}>
                <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 500, color: "#777", fontSize: 9 }}>Nom.</th>
                <th style={{ textAlign: "right", padding: "3px 6px", fontWeight: 500, color: "#777", fontSize: 9 }}>COLA-adj</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {clientRow && (
            <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
              <td style={{ padding: "6px 6px", fontWeight: 700 }}>Client (monthly)</td>
              {CLAIM_AGES.map((a) => (
                <Fragment key={a}>
                  <td style={{ textAlign: "right", padding: "6px 6px" }}>{fmtUSD(clientRow[`age${a}`])}</td>
                  <td style={{ textAlign: "right", padding: "6px 6px", color: "#4A6741", fontWeight: 700 }}>{fmtUSD(clientRow[`age${a}_cola`])}</td>
                </Fragment>
              ))}
            </tr>
          )}
          {spouseRow && (
            <tr style={{ borderBottom: "1px solid #F3F1EC" }}>
              <td style={{ padding: "6px 6px", fontWeight: 700 }}>Spouse (monthly)</td>
              {CLAIM_AGES.map((a) => (
                <Fragment key={a}>
                  <td style={{ textAlign: "right", padding: "6px 6px" }}>{fmtUSD(spouseRow[`age${a}`])}</td>
                  <td style={{ textAlign: "right", padding: "6px 6px", color: "#C87941", fontWeight: 700 }}>{fmtUSD(spouseRow[`age${a}_cola`])}</td>
                </Fragment>
              ))}
            </tr>
          )}
          {clientRow && (
            <tr style={{ borderBottom: "1px solid #F3F1EC", background: "#FAFAF8" }}>
              <td style={{ padding: "6px 6px", fontStyle: "italic", color: "#5A5A5A" }}>Client (annual, COLA-adj)</td>
              {CLAIM_AGES.map((a) => (
                <Fragment key={a}>
                  <td></td>
                  <td style={{ textAlign: "right", padding: "6px 6px", color: "#4A6741" }}>{fmtUSD(clientRow[`age${a}_cola`] * 12)}</td>
                </Fragment>
              ))}
            </tr>
          )}
          {spouseRow && (
            <tr style={{ background: "#FAFAF8" }}>
              <td style={{ padding: "6px 6px", fontStyle: "italic", color: "#5A5A5A" }}>Spouse (annual, COLA-adj)</td>
              {CLAIM_AGES.map((a) => (
                <Fragment key={a}>
                  <td></td>
                  <td style={{ textAlign: "right", padding: "6px 6px", color: "#C87941" }}>{fmtUSD(spouseRow[`age${a}_cola`] * 12)}</td>
                </Fragment>
              ))}
            </tr>
          )}
        </tbody>
      </table>

      <Sub>
        The COLA-adjusted figures assume a {(cola * 100).toFixed(1)}%/yr cost-of-living adjustment compounded from
        the current household age up to the claim age. Real (inflation-net-of-COLA) purchasing power is unchanged.
      </Sub>
    </Page>
  );
};
