import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { fetSensitivity, fmtUSD } from "@/lib/api";

const GROWTH_RATES = [0.05, 0.07, 0.09];
const DEATH_OFFSETS = [-5, 0, 5];
const OFFSET_LABELS = { "-5": "Early (−5 yrs)", 0: "Expected", 5: "Late (+5 yrs)" };

// 3×3 FET sensitivity — growth rate × death timing, Portability-Only vs.
// Layered GST paired in every cell. Bold marks the highest FET of the pair.
const FetSensitivityGrid = ({ baseRequest }) => {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const sig = useMemo(() => (baseRequest ? JSON.stringify(baseRequest) : null), [baseRequest]);

  useEffect(() => {
    if (!baseRequest) return;
    let alive = true;
    setErr(false);
    fetSensitivity({ ...baseRequest, horizons_after_second_death: [0],
      growth_rates: GROWTH_RATES, death_offsets: DEATH_OFFSETS })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const cellMap = useMemo(() => {
    const m = new Map();
    for (const c of data?.cells || []) m.set(`${c.death_offset}|${c.growth_rate}`, c);
    return m;
  }, [data]);

  if (err) return null;

  return (
    <Card className="p-5 border-[#EBE8E0] shadow-none" data-testid="estate-fet-sensitivity">
      <h3 className="font-display text-base font-bold tracking-tight mb-1">
        Federal estate tax sensitivity — growth × death timing
      </h3>
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        The projected FET rests on assumptions decades out. Each cell pairs the <strong>Portability-Only</strong> and{" "}
        <strong>Layered GST</strong> federal estate tax at that growth rate and death timing — <strong>bold marks the
        highest of the pair</strong>. These cells compound the Y1 balances at stylized rates (the projection re-basing
        is intentionally dropped so the growth axis actually moves the outcome), so the Expected · 7% cell approximates —
        not equals — the Strategy detail table above.
      </p>
      {!data ? (
        <p className="text-xs text-muted-foreground">Computing sensitivity grid…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="estate-fet-sensitivity-table">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-[#EBE8E0]">
                <th className="px-2 py-2">Death timing \ Growth</th>
                {GROWTH_RATES.map((g) => (
                  <th key={g} className="px-2 py-2 text-right">{Math.round(g * 100)}% return</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEATH_OFFSETS.map((off) => (
                <tr key={off} className="border-b border-[#F3F1EC]">
                  <td className="px-2 py-2 font-medium">
                    {OFFSET_LABELS[off]}
                    {cellMap.get(`${off}|0.07`) && (
                      <span className="text-muted-foreground font-normal">
                        {" "}({cellMap.get(`${off}|0.07`).second_death_year})
                      </span>
                    )}
                  </td>
                  {GROWTH_RATES.map((g) => {
                    const c = cellMap.get(`${off}|${g}`);
                    if (!c) return <td key={g} className="px-2 py-2 text-right">—</td>;
                    const bothZero = !c.portability_fet && !c.gst_fet;
                    const portHighest = !bothZero && c.highest === "portability";
                    const gstHighest = !bothZero && c.highest === "gst_layered";
                    return (
                      <td key={g} className="px-2 py-2 text-right tabular-nums"
                          data-testid={`fet-cell-${off}-${Math.round(g * 100)}`}>
                        <div className={portHighest ? "font-bold text-[#B84A4A]" : "text-muted-foreground"}>
                          Port {fmtUSD(c.portability_fet)}
                        </div>
                        <div className={gstHighest ? "font-bold text-[#B84A4A]" : "text-muted-foreground"}>
                          GST {fmtUSD(c.gst_fet)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-2 italic">
        Death-timing rows shift BOTH deaths by the offset; the federal + state exclusions index to the shifted years.
      </p>
    </Card>
  );
};

export default FetSensitivityGrid;
