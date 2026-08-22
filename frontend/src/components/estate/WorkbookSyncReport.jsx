/**
 * Workbook Sync Report — dollar-for-dollar reconciliation vs the uploaded
 * "Estate Plan 8.12.26.2xlsm.xlsm" Legacy page.
 *
 * These reference values come from the client's own spreadsheet (post-
 * corrections to basis consumption and survivor SS logic; merge_basis=ON
 * default). If the web engine drifts more than 2%, the pass/fail chip flips.
 * This is the trust-anchor advisors need before showing projections to a
 * client — a one-look confirmation that the online tool matches the
 * workbook the client already trusts.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtUSD } from "@/lib/api";
import { FileSpreadsheet, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { useState } from "react";

// Workbook baseline (Excel Estate Plan 8.12.26.2xlsm — Legacy page, IRA-first
// & Taxable-first orderings at Y2 and Y2+10). Post-corrections rebuild.
const WORKBOOK_BASELINE = {
  ira_first_y2: 47_500_000,
  ira_first_y2_plus_10: 67_600_000,
  taxable_first_y2: 46_100_000,
  taxable_first_y2_plus_10: 65_600_000,
};

const CHIP_FOR = (deltaPct) => {
  const abs = Math.abs(deltaPct);
  if (abs < 2)  return { icon: CheckCircle2, tone: "bg-[#4A6741]/10 text-[#4A6741]", label: "In sync (< 2%)" };
  if (abs < 5)  return { icon: AlertCircle,  tone: "bg-[#C87941]/10 text-[#C87941]", label: "Close (2–5%)" };
  return { icon: XCircle, tone: "bg-[#B84A4A]/10 text-[#B84A4A]", label: "Drift (> 5%)" };
};

const WorkbookSyncReport = ({ result }) => {
  const [open, setOpen] = useState(false);
  if (!result) return null;

  // Winner strategy's household+trust total is the closest analog to the
  // spreadsheet's Legacy-page "IRA-first" outcome (marital deduction, Roth-
  // first funding). "Taxable-first" is the Portability-only outcome.
  const iraFirst_y2   = result.outcomes.gst_layered.net_to_heirs_at_y2 || 0;
  const iraFirst_y210 = (result.post_death_horizons || []).find((h) => h.years_after_second_death === 10)?.gst_layered_total || 0;
  const taxFirst_y2   = result.outcomes.portability.net_to_heirs_at_y2 || 0;
  const taxFirst_y210 = (result.post_death_horizons || []).find((h) => h.years_after_second_death === 10)?.portability_total || 0;

  const rows = [
    { label: "IRA-first · Y2",       web: iraFirst_y2,   sheet: WORKBOOK_BASELINE.ira_first_y2 },
    { label: "IRA-first · Y2+10",    web: iraFirst_y210, sheet: WORKBOOK_BASELINE.ira_first_y2_plus_10 },
    { label: "Taxable-first · Y2",   web: taxFirst_y2,   sheet: WORKBOOK_BASELINE.taxable_first_y2 },
    { label: "Taxable-first · Y2+10",web: taxFirst_y210, sheet: WORKBOOK_BASELINE.taxable_first_y2_plus_10 },
  ].map((r) => {
    const delta = r.web - r.sheet;
    const pct = r.sheet !== 0 ? (delta / r.sheet) * 100 : 0;
    return { ...r, delta, pct, chip: CHIP_FOR(pct) };
  });

  const overallDelta = rows.reduce((s, r) => s + Math.abs(r.pct), 0) / rows.length;
  const overallChip = CHIP_FOR(overallDelta);
  const OverallIcon = overallChip.icon;

  return (
    <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="workbook-sync-report">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-[#4A6741]" />
          <h3 className="font-display text-base font-bold tracking-tight">Workbook Sync Report</h3>
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-[#4A6741]/40 text-[#4A6741]">Excel parity check</Badge>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${overallChip.tone}`} data-testid="workbook-sync-overall-chip">
          <OverallIcon className="h-3.5 w-3.5" />
          Avg drift {overallDelta.toFixed(2)}% — {overallChip.label}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Side-by-side of the web engine vs the client's uploaded workbook (<em>Estate Plan 8.12.26.2xlsm — Legacy page</em>), reconciled after the basis-consumption + survivor SS + merge-basis fixes. Deltas under 2% mean the two models are functionally identical.
        {overallDelta >= 5 && (
          <span className="block mt-1 text-[#8A5A20]">
            <strong>Note:</strong> Large drift here usually means your current scenario has different starting balances / cashflows than the client whose workbook is baselined here. Load the matching client scenario before treating this as a math discrepancy.
          </span>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="workbook-sync-table">
          <thead className="text-muted-foreground text-left">
            <tr className="border-b border-[#EBE8E0]">
              <th className="px-2 py-2">Metric</th>
              <th className="px-2 py-2 text-right">Web engine</th>
              <th className="px-2 py-2 text-right">Workbook</th>
              <th className="px-2 py-2 text-right">Δ</th>
              <th className="px-2 py-2 text-right">Δ %</th>
              <th className="px-2 py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const Icon = r.chip.icon;
              return (
                <tr key={i} className="border-b border-[#F3F1EC]" data-testid={`workbook-sync-row-${i}`}>
                  <td className="px-2 py-2 font-medium">{r.label}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUSD(r.web)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{fmtUSD(r.sheet)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.delta >= 0 ? "text-[#4A6741]" : "text-[#B84A4A]"}`}>
                    {r.delta >= 0 ? "+" : "−"}{fmtUSD(Math.abs(r.delta))}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums font-semibold ${Math.abs(r.pct) < 2 ? "text-[#4A6741]" : Math.abs(r.pct) < 5 ? "text-[#C87941]" : "text-[#B84A4A]"}`}>
                    {r.pct >= 0 ? "+" : "−"}{Math.abs(r.pct).toFixed(2)}%
                  </td>
                  <td className="px-2 py-2 text-right">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${r.chip.tone}`}>
                      <Icon className="h-3 w-3" /> {r.chip.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-xs text-[#4A6741] font-semibold hover:underline"
        data-testid="workbook-sync-expand"
      >
        {open ? "Hide" : "Show"} — Why the numbers may differ
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] p-3 text-xs text-muted-foreground leading-relaxed space-y-2" data-testid="workbook-sync-explanation">
          <p>
            <strong>Basis consumption at every taxable sale</strong> — the web engine now reduces cost basis proportionally on each withdrawal from a Taxable brokerage (matches the workbook's amortization schedule). Prior to Feb 2026 it drained balance without touching basis, which slightly under-taxed the ending years.
          </p>
          <p>
            <strong>Survivor Social Security</strong> — engine now steps the widow up to the deceased spouse's higher benefit (SSA §202(e)/(f)) instead of dropping to just her own record. Adds real ordinary income to the post-Y1 stack, which is exactly what the sheet does.
          </p>
          <p>
            <strong>Basis merge at first death</strong> — with the toggle ON (default), all Taxable accounts pool into a single blended-basis line at Y1, matching the spreadsheet convention. Turn OFF to let the survivor spend the stepped-up lot first (small favorable delta vs sheet — the sheet is intentionally conservative here).
          </p>
          <p>
            <strong>Residual drift under 2%</strong> is expected and comes from (a) the web engine's fully-modeled progressive state brackets vs the sheet's blended flat rate, and (b) IRMAA 2-year lookback vs the sheet's current-year approximation.
          </p>
        </div>
      )}
    </Card>
  );
};

export default WorkbookSyncReport;
