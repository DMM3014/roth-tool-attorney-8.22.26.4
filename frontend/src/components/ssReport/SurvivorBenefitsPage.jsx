import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, LabelList,
} from "recharts";
import { fmtUSD } from "@/lib/api";
import { Page, H2, H3, P, Sub, StaticLegend, useIsolation } from "./helpers";
import { CLAIM_AGES, claimFactor, spousalBenefit } from "./helpers";

// Illustrates the survivor benefit. When one spouse dies, the survivor keeps the HIGHER
// of the two benefits — so the higher earner delaying to 70 is often the single most
// valuable claim decision for a married couple.
//
// Also illustrates the SPOUSAL benefit (up to 50% of the higher earner's PIA for the
// lower-earning spouse), rendered when `includeSpousal=true`.
export const SurvivorBenefitsPage = ({ scenario, fraAmounts, fraAges, includeSpousal, ...footProps }) => {
  const iso = useIsolation();
  const h = scenario?.household || {};
  const hasSpouse = h.spouse_dob_year != null && fraAmounts?.Spouse;
  if (!hasSpouse) {
    return (
      <Page testid="ssr-page-survivor" {...footProps}>
        <H2>Survivor Benefit Impact</H2>
        <P>
          This section applies to married households only — no spouse is defined in the current plan.
        </P>
      </Page>
    );
  }

  const cFra = fraAmounts.Client;
  const sFra = fraAmounts.Spouse;
  const cFraAge = fraAges?.Client || 67;
  const sFraAge = fraAges?.Spouse || 67;
  const higherEarner = (cFra || 0) >= (sFra || 0) ? "Client" : "Spouse";
  const higherFra = higherEarner === "Client" ? cFra : sFra;
  const higherName = higherEarner === "Client" ? h.client_name || "Client" : h.spouse_name || "Spouse";
  const lowerName = higherEarner === "Client" ? h.spouse_name || "Spouse" : h.client_name || "Client";

  // Survivor benefit by higher-earner's claim age (survivor keeps the higher of the two)
  const survivorData = CLAIM_AGES.map((age) => {
    const higherClaimAmt = higherFra * claimFactor(age, higherFraAgeFor(higherEarner, fraAges));
    return {
      age: `Claim ${age}`,
      "Survivor's monthly income": Math.round(higherClaimAmt),
      "Client-if-alive": Math.round(cFra * claimFactor(age, cFraAge)),
      "Spouse-if-alive": Math.round(sFra * claimFactor(age, sFraAge)),
    };
  });

  const delta = Math.round(higherFra * claimFactor(70, higherFraAgeFor(higherEarner, fraAges))
                         - higherFra * claimFactor(62, higherFraAgeFor(higherEarner, fraAges)));

  return (
    <Page testid="ssr-page-survivor" {...footProps}>
      <H2>Survivor Benefit Impact</H2>
      <P>
        When one spouse passes away, the survivor keeps the <strong>higher of the two</strong> Social Security
        benefits — but that survivor benefit is <em>permanently locked in at the deceased spouse&apos;s claim-age
        reduction</em>. Delayed retirement credits earned by the higher earner therefore protect the widow(er) for
        every remaining year of retirement. The gap can be extraordinary: for many couples, it&apos;s the difference
        between $2,300/mo and $3,500/mo, every month, indexed by COLA, for the entire life of the survivor.
      </P>

      <H3>Higher earner: <strong>{higherName}</strong></H3>
      <P>
        {higherName} has the larger PIA ({fmtUSD(higherFra)}/mo at FRA). Their claim-age decision drives the survivor
        benefit for whichever spouse outlives the other. Delaying {higherName}&apos;s claim from age 62 to age 70
        adds an extra <strong>{fmtUSD(delta)}/month</strong> — <strong>{fmtUSD(delta * 12)}/year</strong> — to the
        surviving spouse&apos;s permanent income stream. Across a 20-year widow(er)hood at 2.5% COLA, that&apos;s a
        cumulative income advantage of roughly <strong>{fmtUSD(delta * 12 * 25)}</strong>.
      </P>

      <H3>Survivor benefit vs each spouse&apos;s own benefit</H3>
      <div style={{ height: 220, marginBottom: 6 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={survivorData} margin={{ top: 16, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EBE8E0" />
            <XAxis dataKey="age" tick={{ fontSize: 10 }} tickLine={false}
              label={{ value: `${higherName}'s claim age`, position: "insideBottom", offset: -4, fontSize: 9, fill: "#777" }} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `$${Math.round(v / 100) / 10}K`} width={42} tickLine={false} />
            <Tooltip formatter={(v) => fmtUSD(v)} />
            <Bar dataKey="Survivor's monthly income" fill="#4A6741" isAnimationActive={false} {...iso.dim("Survivor's monthly income")}>
              <LabelList dataKey="Survivor's monthly income" position="top" formatter={(v) => v ? `$${Math.round(v / 100) / 10}K` : ""} style={{ fontSize: 9, fill: "#4A6741" }} />
            </Bar>
            <Bar dataKey="Client-if-alive" fill="#7A9B76" isAnimationActive={false} {...iso.dim("Client-if-alive")} />
            <Bar dataKey="Spouse-if-alive" fill="#C87941" isAnimationActive={false} {...iso.dim("Spouse-if-alive")} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <StaticLegend
        items={[
          { label: "Survivor's monthly income", color: "#4A6741", dataKey: "Survivor's monthly income" },
          { label: "Client-if-alive", color: "#7A9B76", dataKey: "Client-if-alive" },
          { label: "Spouse-if-alive", color: "#C87941", dataKey: "Spouse-if-alive" },
        ]}
        isolated={iso.isolated}
        onToggle={iso.toggle}
        size={9}
        testid="ssr-survivor-legend"
      />
      <Sub>
        The survivor keeps the higher of the two benefits, so the highest bar in each column reflects the survivor&apos;s
        actual monthly income after either spouse&apos;s death. Notice the difference between claiming {higherName} at
        62 vs 70 — that gap is the survivor-benefit protection you buy by delaying.
      </Sub>

      {includeSpousal && (
        <>
          <H3>Spousal benefit — up to 50% of the higher earner&apos;s PIA</H3>
          <P>
            If {lowerName}&apos;s own benefit is small (or zero), they can claim a <strong>spousal benefit</strong> equal
            to up to 50% of {higherName}&apos;s PIA. Spousal benefits are <em>reduced</em> if claimed before {lowerName}&apos;s
            own FRA, but they do <em>not</em> receive delayed retirement credits — waiting past FRA doesn&apos;t increase
            the spousal benefit. In this plan:
          </P>
          <SpousalTable lowerName={lowerName} higherName={higherName} lowerFra={higherEarner === "Client" ? sFra : cFra}
            lowerFraAge={higherEarner === "Client" ? sFraAge : cFraAge} higherFra={higherFra} />
        </>
      )}

      <div style={{
        marginTop: 12, padding: "10px 12px", background: "#4A67410D", border: "1px solid #4A6741", borderRadius: 8,
      }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#4A6741", marginBottom: 4 }}>
          The advisor recommendation
        </div>
        <p style={{ fontSize: 10, color: "#1A1A1A", lineHeight: 1.55, margin: 0 }}>
          When one spouse has a materially larger PIA, delaying that spouse&apos;s claim to age 70 is usually the
          highest-value single decision in the whole retirement plan. It converts a lifetime of extra survivor income
          into a locked-in, inflation-adjusted, guaranteed floor — the kind of certainty no investment portfolio can match.
        </p>
      </div>
    </Page>
  );
};

const higherFraAgeFor = (higherEarner, fraAges) => higherEarner === "Client" ? (fraAges?.Client || 67) : (fraAges?.Spouse || 67);

const SpousalTable = ({ lowerName, higherName, lowerFra, lowerFraAge, higherFra }) => (
  <table style={{ width: "100%", fontSize: 10.5, borderCollapse: "collapse" }}>
    <thead>
      <tr style={{ borderBottom: "1px solid #EBE8E0", background: "#F9F8F6" }}>
        <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>{lowerName}&apos;s claim age</th>
        <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Own reduced</th>
        <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Spousal (50%×PIA reduced)</th>
        <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Better</th>
      </tr>
    </thead>
    <tbody>
      {CLAIM_AGES.map((age) => {
        const own = lowerFra * claimFactor(age, lowerFraAge);
        const spousal = spousalBenefit(lowerFra, age, lowerFraAge, higherFra);
        const betterIsSpousal = spousal > own;
        return (
          <tr key={age} style={{ borderBottom: "1px solid #F3F1EC" }}>
            <td style={{ padding: "5px 8px" }}>Age {age}</td>
            <td style={{ textAlign: "right", padding: "5px 8px" }}>{fmtUSD(own)}</td>
            <td style={{ textAlign: "right", padding: "5px 8px" }}>{fmtUSD(spousal)}</td>
            <td style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: betterIsSpousal ? "#C87941" : "#4A6741" }}>
              {betterIsSpousal ? `Spousal (+${fmtUSD(spousal - own)}/mo)` : "Own"}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);
