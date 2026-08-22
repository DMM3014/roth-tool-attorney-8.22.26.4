import SequenceRiskTable from "@/components/sequenceRisk/SequenceRiskTable";
import ReturnPathChart from "@/components/sequenceRisk/ReturnPathChart";
import { fmtUSD, fmtPct } from "@/lib/api";
import { Page, H2, P, Sub } from "./helpers";

/**
 * SequenceRiskPage — the Client Report's sequence-of-returns stress test. Prints
 * only when the advisor switches it on AND a run exists (the data comes from the
 * Sequence Risk tab's shared settings, re-run for the report).
 */
export const SequenceRiskPage = ({ seqData, ...footProps }) => {
  if (!seqData) return null;
  const base = seqData.baseline;
  const mp = (key) => (seqData.scenarios || []).find(
    (s) => s.scenario === key && s.variant === "mean_preserved");
  const early = mp("early_bear");
  const late = mp("late_bear_projection");
  const bearPct = Math.round((seqData.params?.bear_return ?? -0.15) * 100);

  return (
    <Page testid="cr-page-sequence-risk" {...footProps}>
      <H2>Sequence of Returns — the same average, a different order</H2>
      <P>
        Every other page in this report grows your accounts at {fmtPct(seqData.reference_return)} every single year.
        Markets do not work that way. This page keeps that long-run average exactly where it is and only changes
        <strong> when</strong> the good and bad years arrive — a {Math.abs(bearPct)}% equity decline early in
        retirement, the same decline late, and a volatile path that averages out to the same place. Each path is run
        twice, once with your conversion schedule and once with no conversions at all, so the table reports what the
        conversion actually saved under that sequence.
      </P>

      <ReturnPathChart data={seqData} height={150} testid="cr-seq-path-chart" />

      <SequenceRiskTable data={seqData} testid="cr-seq-table" />

      <div style={{ marginTop: 10, padding: "9px 13px", borderRadius: 8,
                    border: "1px solid #4A6741", background: "#F1F5EF" }}
           data-testid="cr-seq-note">
        <p style={{ fontSize: 10.5, lineHeight: 1.6, margin: 0, color: "#1A1A1A" }}>
          <strong style={{ color: "#4A6741" }}>Why timing changes the answer.</strong>{" "}
          {early && late ? (
            <>Holding the average identical, a bear market at the <strong>start</strong> leaves the conversion
            saving {fmtUSD(early.tax_saved_by_converting)} of lifetime tax, while the same bear market at the
            <strong> end</strong> leaves it saving {fmtUSD(late.tax_saved_by_converting)} — against{" "}
            {fmtUSD(base?.tax_saved_by_converting)} on the flat-rate plan. </>
          ) : null}
          A loss early in retirement is withdrawn against for decades; the same loss near the end is not. Converting
          moves tax forward, so it is most valuable when the portfolio has time to recover inside the Roth and least
          valuable when the market falls immediately after the tax is paid.
        </p>
      </div>

      <Sub>
        Only the equity sleeve is shocked — {Math.round((seqData.equity_share || 0.6) * 100)}% of each
        market-exposed account, taken from the household allocation card — so a {Math.abs(bearPct)}% equity year is
        roughly a {Math.round(Math.abs(bearPct) * (seqData.equity_share || 0.6))}% year for a blended account. Cash
        and the residence keep their own assumed rates. The left block of the table lifts the recovery years just
        enough that each path compounds to the plan&apos;s own {fmtPct(seqData.reference_return)} assumption, so any
        difference in the results is caused by ORDER alone; the right block lets the bear years stand without
        compensation, which is a lower-returning market as well as a differently-ordered one. These are illustrative
        paths chosen to bracket the risk, not forecasts, and no path here should be read as a prediction of any
        particular decade.
      </Sub>
    </Page>
  );
};

export default SequenceRiskPage;
