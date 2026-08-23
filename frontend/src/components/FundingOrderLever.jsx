import { useState } from "react";
import { Shuffle, Play, Loader2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { compareFundingOrders } from "@/lib/api";
import {
  VALID_FUNDING_ORDERS, FUNDING_ORDER_SHORT, DEFAULT_ORDERS,
  METRIC_ROWS, FUNDING_ORDER_EXPLAINER,
} from "@/lib/fundingOrderRows";

export const FundingOrderLever = ({ scenario }) => {
  const [selected, setSelected] = useState(DEFAULT_ORDERS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const toggleOrder = (order) => {
    setSelected((prev) =>
      prev.includes(order) ? prev.filter((o) => o !== order) : [...prev, order]);
  };

  const run = async () => {
    if (selected.length < 2) {
      toast.error("Pick at least two funding orders to compare.");
      return;
    }
    setRunning(true); setError("");
    try {
      // Preserve the engine's canonical order so columns read Taxable-first → IRA-first → Split.
      const orders = VALID_FUNDING_ORDERS.filter((o) => selected.includes(o));
      const data = await compareFundingOrders(scenario, orders);
      setResult(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Comparison failed.");
      toast.error("Funding order comparison failed.");
    } finally {
      setRunning(false);
    }
  };

  const results = result?.results || [];

  return (
    <div className="space-y-4" data-testid="funding-order-lever">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[#4A6741]/10 p-2">
            <Shuffle className="h-5 w-5 text-[#4A6741]" />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-xl font-bold tracking-tight">
              Funding Order — The Hidden Lever
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              {FUNDING_ORDER_EXPLAINER[0]}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          {VALID_FUNDING_ORDERS.map((order) => (
            <label key={order} className="flex items-center gap-2 text-sm cursor-pointer select-none"
                   data-testid={`fo-checkbox-${FUNDING_ORDER_SHORT[order]}`}>
              <Checkbox checked={selected.includes(order)} onCheckedChange={() => toggleOrder(order)} />
              <span className="font-medium">{FUNDING_ORDER_SHORT[order]}</span>
              <span className="text-muted-foreground text-xs">({order})</span>
            </label>
          ))}
          <Button onClick={run} disabled={running || selected.length < 2}
                  className="ml-auto gap-2" data-testid="fo-run-btn">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running projections…" : "Run comparison"}
          </Button>
        </div>
        {selected.length < 2 && (
          <p className="text-xs text-amber-600 mt-2">Select at least two funding orders.</p>
        )}
      </Card>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <div className="flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        </Card>
      )}

      {results.length > 0 && (
        <Card className="p-5" data-testid="fo-results">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse" data-testid="fo-table">
              <thead>
                <tr className="border-b-2 border-[#4A6741]">
                  <th className="text-left py-2 pr-4 font-semibold">Metric</th>
                  {results.map((r) => (
                    <th key={r.funding_order} className="text-right py-2 px-4 font-semibold whitespace-nowrap">
                      {FUNDING_ORDER_SHORT[r.funding_order] || r.funding_order}
                      <div className="text-[10px] font-normal text-muted-foreground">{r.funding_order}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row) => (
                  <tr key={row.key} className="border-b border-gray-100">
                    <td className={`py-1.5 pr-4 ${row.indent ? "pl-6 text-muted-foreground text-xs" : ""} ${row.strong ? "font-semibold" : ""}`}>
                      {row.indent ? "— " : ""}{row.label}
                    </td>
                    {results.map((r) => (
                      <td key={r.funding_order}
                          className={`text-right py-1.5 px-4 tabular-nums whitespace-nowrap ${row.indent ? "text-muted-foreground text-xs" : ""} ${row.strong ? "font-semibold text-[#4A6741]" : ""}`}>
                        {row.fmt(r[row.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 rounded-lg bg-[#F9F8F6] p-4 text-sm space-y-2 leading-relaxed">
            <div className="font-semibold text-[#4A6741]">Why the order matters</div>
            {FUNDING_ORDER_EXPLAINER.slice(1).map((p, i) => (
              <p key={i} className="text-muted-foreground">{p}</p>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default FundingOrderLever;
