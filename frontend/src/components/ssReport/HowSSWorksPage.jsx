import { Page, H2, H3, P, Sub } from "./helpers";

export const HowSSWorksPage = ({ fraAges, ...footProps }) => {
  const clientFra = fraAges?.Client;
  const spouseFra = fraAges?.Spouse;

  return (
    <Page testid="ssr-page-how-ss-works" {...footProps}>
      <H2>How Social Security Works</H2>
      <P>
        Social Security retirement benefits are calculated from your highest 35 years of indexed earnings and
        summarized as your <strong>Primary Insurance Amount (PIA)</strong> — the monthly benefit you receive at
        your <strong>Full Retirement Age (FRA)</strong>. Every claim age adjustment is expressed relative to that
        PIA baseline.
      </P>

      <H3>Full Retirement Age (FRA)</H3>
      <P>
        FRA is set by your birth year:
      </P>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div style={{ border: "1px solid #EBE8E0", borderRadius: 8, padding: "10px 12px", background: "#F9F8F6" }}>
          <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700 }}>Your FRA</div>
          <div style={{ fontFamily: "Outfit, sans-serif", fontSize: 18, fontWeight: 700, color: "#1A1A1A", marginTop: 3 }}>
            Client: age {clientFra ? clientFra.toFixed(2).replace(".00", "") : "67"}
            {spouseFra != null && (
              <span style={{ display: "block", marginTop: 2 }}>Spouse: age {spouseFra.toFixed(2).replace(".00", "")}</span>
            )}
          </div>
        </div>
        <div style={{ border: "1px solid #EBE8E0", borderRadius: 8, padding: "10px 12px", background: "#F9F8F6" }}>
          <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700 }}>FRA table (birth-year rules)</div>
          <div style={{ fontSize: 10.5, color: "#2A2A2A", marginTop: 3, lineHeight: 1.5 }}>
            1943–1954: 66 · 1955: 66y 2mo · 1956: 66y 4mo · 1957: 66y 6mo · 1958: 66y 8mo · 1959: 66y 10mo · 1960+: 67
          </div>
        </div>
      </div>

      <H3>Claim earlier than FRA — permanent reduction</H3>
      <P>
        You can claim as early as age 62, but every month before FRA reduces your benefit by an SSA-set formula:
        <strong>5⁄9 of 1% for the first 36 months early</strong> plus <strong>5⁄12 of 1% for each additional month</strong>.
        For someone whose FRA is 67, that works out to:
      </P>
      <table style={{ width: "100%", fontSize: 10.5, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #EBE8E0", background: "#F9F8F6" }}>
            <th style={{ textAlign: "left", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Claim age (FRA 67)</th>
            <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>% of PIA</th>
            <th style={{ textAlign: "right", padding: "5px 8px", fontWeight: 700, color: "#5A5A5A" }}>Change vs FRA</th>
          </tr>
        </thead>
        <tbody>
          {[
            [62, 70.0, "−30.0%"],
            [63, 75.0, "−25.0%"],
            [64, 80.0, "−20.0%"],
            [65, 86.67, "−13.3%"],
            [66, 93.33, "−6.7%"],
            [67, 100.0, "FRA"],
            [68, 108.0, "+8.0%"],
            [69, 116.0, "+16.0%"],
            [70, 124.0, "+24.0%"],
          ].map(([age, pct, chg]) => (
            <tr key={age} style={{ borderBottom: "1px solid #F3F1EC", background: age === 67 ? "#4A67410D" : "transparent" }}>
              <td style={{ padding: "4px 8px" }}>{age}</td>
              <td style={{ textAlign: "right", padding: "4px 8px", fontWeight: age === 67 ? 700 : 400 }}>{pct.toFixed(2)}%</td>
              <td style={{ textAlign: "right", padding: "4px 8px", color: chg.startsWith("−") ? "#B84A4A" : chg.startsWith("+") ? "#4A6741" : "#5A5A5A", fontWeight: 700 }}>{chg}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <H3>Claim later than FRA — delayed retirement credits</H3>
      <P>
        For every full year you delay past FRA (up to age 70), your benefit grows by <strong>8% per year</strong>.
        There is <strong>no benefit</strong> to claiming after age 70 — the credits stop.
      </P>

      <H3>COLA — annual cost-of-living adjustment</H3>
      <P>
        Once you claim, your benefit rises each year by the same COLA the SSA announces (tied to CPI-W). This
        planner models the COLA compounded forward year by year, so &ldquo;COLA-adjusted&rdquo; numbers in the tables
        that follow show what you would <em>actually receive</em> in the year you first claim.
      </P>

      <H3>Spousal & survivor rules (quick reference)</H3>
      <ul style={{ fontSize: 10.5, lineHeight: 1.6, color: "#2A2A2A", paddingLeft: 20 }}>
        <li>
          <strong>Spousal benefit</strong>: a spouse who never earned enough for a large benefit can claim up to
          <strong> 50% of the higher earner&apos;s PIA</strong> (reduced if claimed before their own FRA — but no
          delayed credits apply).
        </li>
        <li>
          <strong>Survivor benefit</strong>: when one spouse dies, the survivor keeps the higher of the two
          benefits (adjusted for the deceased&apos;s claim age). This is why the higher earner delaying to 70 is
          often the single most valuable claim decision for a married couple.
        </li>
        <li>
          <strong>Earnings test</strong>: claiming before FRA while still working can temporarily reduce your
          benefit. Not modeled here (the plan assumes retirement is timed to the claim date).
        </li>
      </ul>

      <Sub>
        Sources: SSA Publication No. 05-10035 (When to Start Receiving Retirement Benefits) and 20 CFR § 404.410.
        Rules current as of 2025; SSA formulas may adjust annually for COLA and other statutory triggers.
      </Sub>
    </Page>
  );
};
