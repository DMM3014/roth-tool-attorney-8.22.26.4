/**
 * Death+10 Detail — per-heir breakdown + heir-rate sensitivity matrix.
 *
 * Renders TWO tables that mirror the uploaded workbook's Legacy page:
 *   1. Per-heir slice at Y2+10 (Roth / Taxable / Traditional buckets × each
 *      beneficiary's share_pct × their individual heir_federal_rate +
 *      heir_state_rate). Uses BeneficiariesEditor's localStorage list.
 *   2. 5×5 heir-rate sensitivity matrix showing net-to-family at Y2+10 as
 *      federal (22 / 24 / 32 / 35 / 37%) × state (0 / 5 / 9.3 / 13.3%) rates
 *      shift. This is the "what if your heirs move states or brackets rise?"
 *      panel and comes directly from the spreadsheet's Legacy sensitivity grid.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtUSD } from "@/lib/api";
import { loadBeneficiaries } from "@/components/clientReport/helpers";
import { Users, Grid3x3 } from "lucide-react";

const FED_GRID = [0.22, 0.24, 0.32, 0.35, 0.37];
const STATE_GRID = [0.0, 0.05, 0.093, 0.133];

const STRATEGY_LABELS = {
  portability: "Portability",
  bypass: "Bypass",
  qtip_bypass: "Bypass + QTIP",
  gst_layered: "Layered GST",
};

const DeathPlusTenDetail = ({ result, winner, scenario }) => {
  if (!result) return null;
  // Prefer Y2+10; fall back to the last horizon if the user shortened the window.
  const horizons = result.post_death_horizons || [];
  const y210 = horizons.find((h) => h.years_after_second_death === 10) || horizons[horizons.length - 1];
  if (!y210) return null;

  const beneficiaries = loadBeneficiaries() || [];
  const totalShare = beneficiaries.reduce((s, b) => s + (Number(b.share_pct) || 0), 0) || 100;

  // Per-heir table uses the WINNER strategy's household mix + trust value.
  const w = winner || "gst_layered";
  const trust  = y210[`${w}_trust`] || 0;
  const rothH  = y210[`${w}_household_roth`] || 0;
  const taxH   = y210[`${w}_household_taxable`] || 0;
  const tradH  = y210[`${w}_household_traditional`] || 0;
  // Note: household_roth / household_taxable are already after step-up and
  // heir-brokerage drag (see estate.py _grow_outright_*). Traditional is AT
  // heir marginal rate in `_grow_outright_traditional`. So the values in
  // horizons are AFTER-TAX already at the "default" heir marginal rate. We
  // still allow the user to see per-heir slices with their own rates below.

  const baseHeirRate = (scenario?.legacy?.heir_federal_rate ?? 0.3165) + (scenario?.legacy?.heir_state_rate ?? 0);

  // Reverse-engineer a rough Traditional PRE-TAX value so we can re-apply
  // per-heir rates. The engine's Traditional post-tax = pretax * (1 - baseRate).
  const tradPretax = (baseHeirRate > 0 && baseHeirRate < 1)
    ? tradH / (1 - baseHeirRate)
    : tradH;

  // Sensitivity matrix — vary fed × state on the Traditional slice only
  // (Roth and Taxable buckets are largely rate-insensitive after step-up).
  const cellNet = (fed, state) => {
    const heirRate = Math.max(0, Math.min(0.9, fed + state));
    const tradNet = tradPretax * (1 - heirRate);
    return trust + rothH + taxH + tradNet;
  };

  return (
    <div className="space-y-4">
      {/* Per-heir breakdown */}
      <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-per-heir-detail">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Death+10 per-heir breakdown</h3>
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-[#4A6741]/40 text-[#4A6741]">
            {STRATEGY_LABELS[w] || w}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Beneficiary slices at Y{y210.year} ({y210.years_after_second_death}y after 2nd death), using each heir's individual bracket. Roth / Taxable / trust are already after step-up & heir-brokerage drag; Traditional is re-taxed at each heir's personal rate.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="estate-per-heir-table">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-2">Beneficiary</th>
                <th className="px-2 py-2 text-right">Share %</th>
                <th className="px-2 py-2 text-right">Fed rate</th>
                <th className="px-2 py-2 text-right">State rate</th>
                <th className="px-2 py-2 text-right">Trust slice</th>
                <th className="px-2 py-2 text-right">Roth slice</th>
                <th className="px-2 py-2 text-right">Taxable slice</th>
                <th className="px-2 py-2 text-right">Trad (after their tax)</th>
                <th className="px-2 py-2 text-right font-bold">Net to this heir</th>
              </tr>
            </thead>
            <tbody>
              {beneficiaries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-2 py-3 text-muted-foreground italic">
                    No beneficiaries defined. Add them on the Plan Inputs tab under Tax Assumptions & Heirs.
                  </td>
                </tr>
              ) : beneficiaries.map((b, i) => {
                const share = (Number(b.share_pct) || 0) / totalShare;
                const fed = Number(b.fed_rate) || 0;
                const st  = Number(b.state_rate) || 0;
                const rate = Math.max(0, Math.min(0.9, fed + st));
                const trustSlice = trust * share;
                const rothSlice = rothH * share;
                const taxSlice = taxH * share;
                const tradSlice = tradPretax * share * (1 - rate);
                const net = trustSlice + rothSlice + taxSlice + tradSlice;
                return (
                  <tr key={i} className="border-b border-[#F3F1EC]" data-testid={`estate-per-heir-row-${i}`}>
                    <td className="px-2 py-2 font-medium">{b.name || `Heir ${i + 1}`}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{(share * 100).toFixed(1)}%</td>
                    <td className="px-2 py-2 text-right tabular-nums">{(fed * 100).toFixed(1)}%</td>
                    <td className="px-2 py-2 text-right tabular-nums">{(st * 100).toFixed(1)}%</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#4A6741]">{fmtUSD(trustSlice)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(rothSlice)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(taxSlice)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(tradSlice)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-bold text-[#4A6741]">{fmtUSD(net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 5×4 heir-rate sensitivity matrix */}
      <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-heir-rate-matrix">
        <div className="flex items-center gap-2 mb-1">
          <Grid3x3 className="h-4 w-4 text-[#C87941]" />
          <h3 className="font-display text-base font-bold tracking-tight">Heir-rate sensitivity — net to family at Y{y210.year}</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          What if your heirs move states or federal brackets shift before they inherit? Each cell holds Trust + Roth + Taxable constant (rate-insensitive post-step-up) and re-taxes the Traditional slice at that heir bracket combo. Green = highest, orange = lowest.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="estate-heir-rate-matrix-table">
            <thead className="text-muted-foreground">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-2 text-left">Federal ↓ / State →</th>
                {STATE_GRID.map((st) => (
                  <th key={st} className="px-2 py-2 text-right">{(st * 100).toFixed(1)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const values = FED_GRID.map((f) => STATE_GRID.map((s) => cellNet(f, s)));
                const flat = values.flat();
                const max = Math.max(...flat);
                const min = Math.min(...flat);
                const uniform = max - min < 1;  // flat matrix = nothing to highlight
                return FED_GRID.map((f, i) => (
                  <tr key={f} className="border-b border-[#F3F1EC]">
                    <td className="px-2 py-2 font-medium">{(f * 100).toFixed(0)}%</td>
                    {STATE_GRID.map((s, j) => {
                      const v = values[i][j];
                      const isMax = !uniform && v === max;
                      const isMin = !uniform && v === min;
                      return (
                        <td key={s} className={`px-2 py-2 text-right tabular-nums ${isMax ? "bg-[#4A6741]/15 text-[#4A6741] font-bold" : ""} ${isMin ? "bg-[#C87941]/15 text-[#C87941]" : ""}`}
                            data-testid={`estate-heir-rate-cell-${i}-${j}`}>
                          {fmtUSD(v)}
                        </td>
                      );
                    })}
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 italic">
          {tradPretax < 1
            ? "This heir-rate matrix is currently flat because there's no Traditional IRA balance flowing to heirs — post-conversion, the entire inherited estate is rate-insensitive. That's exactly the point of Roth conversion: eliminating heir-bracket tail risk entirely."
            : "Delta best-vs-worst quantifies the \"state move\" or heir-bracket-shift tail risk your heirs carry on the Traditional side. Converting more to Roth during your life shrinks this delta to zero."}
        </p>
      </Card>
    </div>
  );
};

export default DeathPlusTenDetail;
