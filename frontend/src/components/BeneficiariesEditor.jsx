// Beneficiaries editor — extracted from ClientReport so it can live on the Plan
// Inputs page (single source of truth) and be read from any report page.
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtPct } from "@/lib/api";
import {
  loadBeneficiaries, saveBeneficiaries, beneficiaryWeightedRate,
} from "./clientReport/helpers";
import { useEffect, useState } from "react";

export const BeneficiariesEditor = () => {
  const [beneficiaries, setBeneficiaries] = useState(loadBeneficiaries);

  const updateBeneficiary = (idx, key, val) => setBeneficiaries((list) => {
    const next = [...list];
    next[idx] = { ...next[idx], [key]: val };
    saveBeneficiaries(next);
    return next;
  });
  const addBeneficiary = () => setBeneficiaries((list) => {
    const next = [
      ...list,
      { name: `Beneficiary ${list.length + 1}`, share_pct: list.length === 0 ? 100 : 0, fed_rate: 0.32, state_rate: 0.05 },
    ];
    saveBeneficiaries(next);
    return next;
  });
  const removeBeneficiary = (idx) => setBeneficiaries((list) => {
    const next = list.filter((_, i) => i !== idx);
    saveBeneficiaries(next);
    return next;
  });

  // Keep tabs in the same window in sync (e.g. user edits on ClientReport and returns to Plan Inputs)
  useEffect(() => {
    const refresh = () => setBeneficiaries(loadBeneficiaries());
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  const weightedBene = beneficiaryWeightedRate(beneficiaries);
  const shareSum = beneficiaries.reduce((t, b) => t + (b.share_pct || 0), 0);

  return (
    <div className="rounded-lg border border-[#EBE8E0] bg-[#F9F8F6] p-4 mt-4 col-span-full" data-testid="beneficiaries-card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2">
          <Users className="h-4 w-4 text-[#4A6741] mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#1A1A1A]">Beneficiaries — per-heir bracket modeling (optional)</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed max-w-xl">
              Add each non-spouse beneficiary with their share of the inheritance and their expected federal + state
              marginal rate during the 10-year SECURE window. When any beneficiary has a non-zero share, the report
              uses a share-weighted average heir rate (overriding the single-rate fields above).
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={addBeneficiary} data-testid="pi-beneficiary-add"
          className="h-8 gap-1 text-[11px] shrink-0">
          <Plus className="h-3 w-3" /> Add beneficiary
        </Button>
      </div>

      {beneficiaries.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground py-2">
          No beneficiaries defined — the single-rate fields above are being used for the SECURE-Act analysis.
        </p>
      ) : (
        <>
          <table className="w-full text-[12px]" data-testid="pi-beneficiaries-table">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-[#EBE8E0]">
                <th className="text-left py-1 font-semibold">Name / relationship</th>
                <th className="text-right py-1 font-semibold w-24">Share %</th>
                <th className="text-right py-1 font-semibold w-32">Federal rate</th>
                <th className="text-right py-1 font-semibold w-32">State rate</th>
                <th className="w-9"></th>
              </tr>
            </thead>
            <tbody>
              {beneficiaries.map((b, i) => (
                <tr key={i} className="border-b border-[#F3F1EC]" data-testid={`pi-beneficiary-row-${i}`}>
                  <td className="py-1 pr-1">
                    <Input value={b.name || ""} onChange={(e) => updateBeneficiary(i, "name", e.target.value)}
                      placeholder="e.g. Daughter — lawyer"
                      data-testid={`pi-beneficiary-name-${i}`}
                      className="h-8 text-[12px]" />
                  </td>
                  <td className="py-1 pr-1">
                    <Input type="number" step="1" min="0" max="100"
                      value={b.share_pct ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateBeneficiary(i, "share_pct", v === "" ? 0 : Math.max(0, Math.min(100, parseFloat(v))));
                      }}
                      data-testid={`pi-beneficiary-share-${i}`}
                      className="h-8 text-[12px] text-right" />
                  </td>
                  <td className="py-1 pr-1">
                    <Input type="number" step="0.01" min="0" max="0.5"
                      value={b.fed_rate ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateBeneficiary(i, "fed_rate", v === "" ? 0 : Math.max(0, Math.min(0.5, parseFloat(v))));
                      }}
                      placeholder="0.32"
                      data-testid={`pi-beneficiary-fed-${i}`}
                      className="h-8 text-[12px] text-right" />
                  </td>
                  <td className="py-1 pr-1">
                    <Input type="number" step="0.01" min="0" max="0.15"
                      value={b.state_rate ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateBeneficiary(i, "state_rate", v === "" ? 0 : Math.max(0, Math.min(0.15, parseFloat(v))));
                      }}
                      placeholder="0.05"
                      data-testid={`pi-beneficiary-state-${i}`}
                      className="h-8 text-[12px] text-right" />
                  </td>
                  <td className="py-1 pl-1 text-right">
                    <Button size="sm" variant="ghost"
                      onClick={() => removeBeneficiary(i)}
                      data-testid={`pi-beneficiary-remove-${i}`}
                      className="h-7 w-7 p-0 text-[#B84A4A] hover:bg-[#B84A4A]/5">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10.5px] text-muted-foreground mt-2 flex items-center justify-between">
            <span>
              Weighted average rate:{" "}
              <strong className="text-[#4A6741]">
                {weightedBene
                  ? `${fmtPct(weightedBene.fed)} federal + ${fmtPct(weightedBene.state)} state = ${fmtPct(weightedBene.fed + weightedBene.state)} combined`
                  : "n/a"}
              </strong>
            </span>
            <span>
              Share sum: <strong className={shareSum === 100 ? "text-[#4A6741]" : "text-[#C87941]"}>{shareSum}%</strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
};
