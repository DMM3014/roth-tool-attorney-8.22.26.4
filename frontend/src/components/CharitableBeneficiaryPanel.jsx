// Charitable Beneficiary — death-time IRA-to-charity designation vs conversions.
// Three cases at the user's settings: no charity; charity + current conversions;
// charity + conversions off. QCDs give from the pre-tax IRA during life; a
// beneficiary designation gives from the same pool at death — the two compete.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, HandHeart, Play } from "lucide-react";
import { toast } from "sonner";
import { runCharitableBeneficiary, fmtUSD, fmtPct } from "@/lib/api";

const CASE_META = [
  { key: "no_charity", label: "No charity (family only)" },
  { key: "charity_with_conversions", label: "Charity + current conversions" },
  { key: "charity_no_conversions", label: "Charity + conversions off" },
];

const signed = (v) => `${v >= 0 ? "+" : "−"}${fmtUSD(Math.abs(v))}`;

export const CharitableBeneficiaryPanel = ({ scenario }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const run = async () => {
    setLoading(true);
    try { setData(await runCharitableBeneficiary(scenario)); }
    catch { toast.error("Charitable beneficiary comparison failed"); }
    finally { setLoading(false); }
  };
  const cases = data?.cases || {};
  const d = data?.combined_delta_conversions_effect;

  return (
    <Card className="p-6 border-[#EBE8E0] shadow-none mt-6" data-testid="charity-panel">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <HandHeart className="h-5 w-5 text-[#4A6741] mt-0.5" />
          <div>
            <h3 className="font-display text-lg font-bold tracking-tight">Charitable Beneficiary</h3>
            <p className="text-[11px] text-muted-foreground max-w-2xl mt-1 leading-relaxed">
              Naming a qualified charity as death-time beneficiary on the Traditional IRA passes that fraction free of
              income <em>and</em> estate tax. Compared here against the current conversion program and against leaving
              the IRA unconverted for charity.
            </p>
          </div>
        </div>
        <Button onClick={run} disabled={loading} variant="outline" size="sm" className="h-8 text-xs shrink-0" data-testid="charity-run">
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          {data ? "Re-run" : "Run comparison"}
        </Button>
      </div>

      {data && (
        <div className="mt-5 overflow-x-auto">
          <p className="text-[11px] text-muted-foreground mb-2">
            IRA fraction designated to charity: <strong>{fmtPct(data.fraction)}</strong>
            {data.fraction_is_illustrative && <span className="text-[#B8863A]"> (illustrative — no designation set in Plan Inputs)</span>}. Charity is tax-exempt, so its
            receipt is grown over the SECURE-10 horizon (parallel to an inherited Roth) for an apples-to-apples combined total.
          </p>
          <table className="w-full text-sm" data-testid="charity-table">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b border-[#EBE8E0]">
                <th className="text-left px-2 py-1.5 font-semibold">Case</th>
                <th className="text-right px-2 font-semibold">Family after-tax</th>
                <th className="text-right px-2 font-semibold">Charity receipt</th>
                <th className="text-right px-2 font-semibold">Combined family + charity</th>
                <th className="text-right px-2 font-semibold">Total tax (everyone)</th>
              </tr>
            </thead>
            <tbody>
              {CASE_META.map((c) => {
                const row = cases[c.key] || {};
                const isWinner = data.winner === c.key;
                return (
                  <tr key={c.key} data-testid={`charity-row-${c.key}`} className="border-b border-[#F3F1EC]"
                    style={{ background: isWinner ? "#4A67410D" : undefined }}>
                    <td className="px-2 py-2 font-medium">
                      {c.label}{isWinner && <span className="ml-1 text-[10px] text-[#4A6741] font-bold">▸ best</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs">{fmtUSD(row.family_after_tax)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs text-[#4A6741]">{fmtUSD(row.charity_receipt)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs font-semibold">{fmtUSD(row.combined_family_charity)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-xs text-[#B84A4A]">{fmtUSD(row.total_tax_everyone)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {d && (
            <p className="mt-3 text-[11px] max-w-3xl leading-relaxed" data-testid="charity-delta">
              Conversions&apos; effect on the combined total (charity cases):{" "}
              <strong style={{ color: d.nominal >= 0 ? "#4A6741" : "#B84A4A" }}>{signed(d.nominal)}</strong>
              <span className="text-muted-foreground"> / {signed(d.today)} in today&apos;s $</span>. A negative figure
              means converting <em>reduces</em> the family + charity total — the correct-response comparison, not a hardcoded conclusion.
            </p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground max-w-3xl leading-relaxed border-l-2 border-[#4A6741] pl-3" data-testid="charity-qcd-note">
            {data.note} A QCD (see the QCD page) and a beneficiary designation both give from the pre-tax IRA — plan them
            together so lifetime QCDs and the death-time bequest don&apos;t double-count the same dollars.
          </p>
        </div>
      )}
    </Card>
  );
};

export default CharitableBeneficiaryPanel;
