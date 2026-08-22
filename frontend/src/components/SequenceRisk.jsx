import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Waves, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { runSequenceStress, fmtUSD } from "@/lib/api";
import { mcScenarioSig } from "@/lib/mcSignature";
import { useSeqParams } from "@/hooks/useSeqParams";
import SequenceRiskTable from "@/components/sequenceRisk/SequenceRiskTable";
import ReturnPathChart from "@/components/sequenceRisk/ReturnPathChart";

const Num = ({ label, value, onChange, step = 1, min, max, suffix, testid }) => (
  <div>
    <Label className="text-[11px] label-cap">{label}</Label>
    <div className="flex items-center gap-1 mt-1">
      <Input type="number" step={step} min={min} max={max} value={value} data-testid={testid}
        onChange={(e) => onChange(e.target.value)} className="h-8 text-sm text-right" />
      {suffix && <span className="text-[11px] text-muted-foreground shrink-0">{suffix}</span>}
    </div>
  </div>
);

/**
 * SequenceRisk — "does the ORDER of returns change the answer?".
 * The engine runs each return path twice (with the conversion schedule and with
 * conversions off) so every row reports the tax the conversion actually saved
 * under that sequence, not just an ending balance.
 */
export const SequenceRisk = ({ scenario, seqResult, setSeqResult }) => {
  const { seqParams, setSeqParam, resetSeqParams, seqSig } = useSeqParams();
  const [loading, setLoading] = useState(false);
  const [ranSig, setRanSig] = useState(null);
  const sig = `${mcScenarioSig(scenario)}||${seqSig}`;
  const stale = !!seqResult && ranSig !== sig;

  const run = useCallback(() => {
    setLoading(true);
    runSequenceStress(scenario, seqParams)
      .then((r) => { setSeqResult(r); setRanSig(sig); })
      .catch(() => toast.error("Sequence stress test failed."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    if (seqResult || loading) return;
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mp = (key) => (seqResult?.scenarios || []).find(
    (s) => s.scenario === key && s.variant === "mean_preserved");
  const base = seqResult?.baseline;
  const spread = (() => {
    const vals = (seqResult?.scenarios || [])
      .filter((s) => s.variant === "mean_preserved")
      .map((s) => s.tax_saved_by_converting);
    if (!vals.length) return null;
    return { lo: Math.min(...vals), hi: Math.max(...vals) };
  })();

  return (
    <div className="space-y-4" data-testid="sequence-risk-tab">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-display text-base font-bold tracking-tight text-[#1A1A1A] flex items-center gap-2">
              <Waves className="h-4 w-4 text-[#4A6741]" /> Sequence of returns — does the order matter?
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl leading-relaxed">
              The plan compounds at one flat rate every year. This test replaces that with year-by-year paths and
              runs each one twice — with your conversion schedule and with no conversions — so you can see what a
              bad decade does to the conversion case depending on <span className="font-medium">when</span> it
              lands. Only the equity sleeve is shocked ({Math.round((seqResult?.equity_share ?? 0.6) * 100)}% of
              each market account, from the allocation card); cash and the residence keep their own rates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={resetSeqParams} data-testid="seq-reset-btn"
                    className="h-8 gap-1.5 text-[11px] rounded-full">
              <RotateCcw className="h-3 w-3" /> Defaults
            </Button>
            <Button size="sm" onClick={run} disabled={loading} data-testid="seq-run-btn"
                    className="h-8 gap-1.5 text-[11px] rounded-full bg-[#4A6741] hover:bg-[#3B5334]">
              {loading ? <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
                       : <><RefreshCw className="h-3 w-3" /> Run stress test</>}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          <Num label="Bear year return" testid="seq-bear-return" suffix="%" step={1}
               value={Math.round(seqParams.bear_return * 100)}
               onChange={(v) => setSeqParam("bear_return", Math.max(-90, Math.min(0, parseFloat(v) || 0)) / 100)} />
          <Num label="Early bear length" testid="seq-early-years" suffix="yrs" min={1} max={20}
               value={seqParams.early_years}
               onChange={(v) => setSeqParam("early_years", Math.max(1, Math.min(20, parseInt(v, 10) || 1)))} />
          <Num label="Late bear length" testid="seq-late-years" suffix="yrs" min={1} max={20}
               value={seqParams.late_years}
               onChange={(v) => setSeqParam("late_years", Math.max(1, Math.min(20, parseInt(v, 10) || 1)))} />
          <Num label="Volatility floor" testid="seq-vol-min" suffix="%" step={1}
               value={Math.round(seqParams.vol_min * 100)}
               onChange={(v) => setSeqParam("vol_min", Math.max(-90, Math.min(0, parseFloat(v) || 0)) / 100)} />
          <Num label="Volatility ceiling" testid="seq-vol-max" suffix="%" step={1}
               value={Math.round(seqParams.vol_max * 100)}
               onChange={(v) => setSeqParam("vol_max", Math.max(0, Math.min(100, parseFloat(v) || 0)) / 100)} />
        </div>

        {stale && (
          <p className="mt-3 text-[11px] text-[#C87941]" data-testid="seq-stale-banner">
            Plan or settings changed since this ran — click <span className="font-medium">Run stress test</span> for
            current numbers.
          </p>
        )}
      </Card>

      {loading && !seqResult && (
        <Card className="p-10 text-center text-sm text-muted-foreground" data-testid="seq-loading">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-[#4A6741]" />
          Running 8 return paths plus the flat plan, each with and without the conversion schedule…
        </Card>
      )}

      {seqResult && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="seq-kpis">
            <Card className="p-4">
              <p className="text-[10px] label-cap text-muted-foreground">Conversion tax saved — flat plan</p>
              <p className="font-display text-2xl font-bold text-[#4A6741] mt-1">
                {fmtUSD(base?.tax_saved_by_converting)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">The number the rest of the app reports</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] label-cap text-muted-foreground">Same average, different order</p>
              <p className="font-display text-2xl font-bold text-[#1A1A1A] mt-1">
                {spread ? `${fmtUSD(spread.lo)} – ${fmtUSD(spread.hi)}` : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Range of conversion tax saved across the mean-preserved paths
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] label-cap text-muted-foreground">Early crash vs late crash</p>
              <p className="font-display text-2xl font-bold text-[#C87941] mt-1">
                {mp("early_bear") && mp("late_bear_projection")
                  ? fmtUSD(mp("late_bear_projection").tax_saved_by_converting
                           - mp("early_bear").tax_saved_by_converting)
                  : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                What the timing of the same bear market is worth to the conversion case
              </p>
            </Card>
          </div>

          <Card className="p-5">
            <p className="text-sm font-semibold text-[#1A1A1A] mb-1">The four return paths</p>
            <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
              Equity return by year. Every line here compounds to the same long-run average as the dashed plan
              assumption — only the order differs.
            </p>
            <ReturnPathChart data={seqResult} />
          </Card>

          <Card className="p-5">
            <p className="text-sm font-semibold text-[#1A1A1A] mb-1">Results</p>
            <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
              Left block holds the long-run average constant, so the differences are pure sequence risk. Right block
              lets the bear years bite without compensation — a worse market, not just a reordered one.
            </p>
            <SequenceRiskTable data={seqResult} testid="seq-tab-table" />
            <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
              &ldquo;Heirs Δ from converting&rdquo; is the after-tax inheritance with conversions minus the same
              figure with none, measured under that sequence. Switch the Client Report&apos;s{" "}
              <span className="font-medium">Sequence-of-returns page</span> on to print this table for a client.
            </p>
          </Card>
        </>
      )}
    </div>
  );
};

export default SequenceRisk;
