import SequenceRiskTable from "@/components/sequenceRisk/SequenceRiskTable";
import ReturnPathChart from "@/components/sequenceRisk/ReturnPathChart";
import { fmtUSD, fmtPct } from "@/lib/api";
import { Page, H2, P, Sub } from "./printPrimitives";

/**
 * SequenceRiskDeckPage — deck version of the sequence-of-returns stress test.
 * Same table and chart as the Client Report page, shorter narrative.
 */
export const SequenceRiskDeckPage = ({ seqData, includeNarrative = true }) => {
  if (!seqData) return null;
  const base = seqData.baseline;
  const mp = (key) => (seqData.scenarios || []).find(
    (s) => s.scenario === key && s.variant === "mean_preserved");
  const early = mp("early_bear");
  const late = mp("late_bear_projection");
  const bearPct = Math.abs(Math.round((seqData.params?.bear_return ?? -0.15) * 100));

  return (
    <Page testid="presentation-page-sequence-risk">
      <H2>What if the good years and the bad years swap places?</H2>
      {includeNarrative && (
        <P>
          The rest of this deck grows your money at {fmtPct(seqData.reference_return)} every year. Here that same
          long-run average is kept exactly as it is and only the <strong>order</strong> changes: a {bearPct}% equity
          decline early in retirement, the same decline late, and a volatile path that ends up averaging the same.
          Each one is run with your conversion schedule and again with no conversions, so you can see how much of
          the conversion case depends on markets behaving themselves early on.
        </P>
      )}

      <ReturnPathChart data={seqData} height={155} testid="deck-seq-path-chart" />

      <SequenceRiskTable data={seqData} testid="deck-seq-table" />

      {early && late && (
        <div style={{ marginTop: 10, padding: "9px 13px", borderRadius: 8,
                      border: "1px solid #4A6741", background: "#F1F5EF" }}
             data-testid="deck-seq-note">
          <p style={{ fontSize: 10.5, lineHeight: 1.6, margin: 0, color: "#1A1A1A" }}>
            <strong style={{ color: "#4A6741" }}>Timing, not average.</strong> Same long-run return in every case:
            a bear market at the start leaves the conversion saving {fmtUSD(early.tax_saved_by_converting)} of
            lifetime tax, the same bear market at the end leaves it saving{" "}
            {fmtUSD(late.tax_saved_by_converting)}, against {fmtUSD(base?.tax_saved_by_converting)} on the
            flat-rate plan. A loss early is withdrawn against for decades; a loss late is not.
          </p>
        </div>
      )}

      <Sub>
        Only the equity portion of each market account is shocked
        ({Math.round((seqData.equity_share || 0.6) * 100)}% from the household allocation card); cash and the
        residence keep their own rates. Illustrative paths chosen to bracket the risk — not forecasts, and not a
        prediction of any particular decade.
      </Sub>
    </Page>
  );
};

export default SequenceRiskDeckPage;
