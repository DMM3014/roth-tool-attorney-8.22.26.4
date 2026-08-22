// Formatting helpers shared by all horizontal spreadsheet-style grids
// (TaxDetail, DetailCashflow, Cashflow). The `scale` value comes from the
// GridControls toolbar and controls whether we render full USD, thousands ($k)
// or millions ($M) — advisors switch to $M during screen-share to keep long
// numbers legible on a projector.
import { fmtUSD } from "@/lib/api";

// scale: "full" | "k" | "m"
export const scaleMoney = (v, scale = "full") => {
  if (v == null || v === "") return "—";
  if (typeof v !== "number") return v;
  if (Math.abs(v) < 0.5) return "—";
  if (scale === "k") {
    // one decimal for numbers < 100k so precision doesn't collapse to "$0k"
    const kv = v / 1_000;
    const decimals = Math.abs(kv) < 100 ? 1 : 0;
    const sign = kv < 0 ? "-" : "";
    return `${sign}$${Math.abs(kv).toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: 0 })}k`;
  }
  if (scale === "m") {
    const mv = v / 1_000_000;
    // two decimals under 10M, one decimal 10–100M, zero above
    const decimals = Math.abs(mv) < 10 ? 2 : Math.abs(mv) < 100 ? 1 : 0;
    const sign = mv < 0 ? "-" : "";
    return `${sign}$${Math.abs(mv).toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}M`;
  }
  return fmtUSD(v);
};

// Density → tailwind class fragments applied to the horizontal grid tables.
// Applied to <th>/<td> padding + min-widths of year columns.
export const densityClasses = (density = "compact") => {
  if (density === "roomy") {
    return {
      // header + body cell padding
      cell: "px-3 py-2.5",
      headCell: "px-3 py-3",
      // per-year column width
      colWidth: "min-w-[130px]",
      firstColWidth: "min-w-[260px]",
      textSize: "text-[13px]",
    };
  }
  return {
    cell: "px-2 py-1.5",
    headCell: "px-2 py-2",
    colWidth: "min-w-[95px]",
    firstColWidth: "min-w-[220px]",
    textSize: "text-xs",
  };
};
