import { Rows3, Rows2, Coins, Target } from "lucide-react";
import { FOCUS_OPTIONS } from "@/lib/useGridPrefs";

// Shared toolbar for horizontal spreadsheet grids: density (compact/roomy),
// currency scale (full / thousands / millions), and focus range (which
// milestone window is visible). Rendered above each grid so advisors can
// adjust readability during client / screen-share sessions without changing
// app-wide settings. All three are purely visual and controlled by the parent.
const GridControls = ({
  density, setDensity,
  scale, setScale,
  focus, setFocus,
  testidPrefix = "grid",
}) => (
  <div className="flex flex-wrap items-center gap-3">
    {typeof setFocus === "function" && (
      <div className="inline-flex items-center gap-1.5">
        <span className="text-[10px] label-cap text-muted-foreground">Focus</span>
        <div className="inline-flex items-center gap-1 rounded-full border border-[#EBE8E0] bg-[#F9F8F6] px-2 py-0.5">
          <Target className="h-3 w-3 text-[#4A6741]" />
          <select value={focus} onChange={(e) => setFocus(e.target.value)}
                  data-testid={`${testidPrefix}-focus-select`}
                  className="text-[11px] bg-transparent focus:outline-none py-0.5 text-[#4A6741] font-medium cursor-pointer">
            {FOCUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
    )}
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[10px] label-cap text-muted-foreground">Density</span>
      <div className="inline-flex rounded-full border border-[#EBE8E0] p-0.5 bg-[#F9F8F6]">
        <button type="button" onClick={() => setDensity("compact")}
                data-testid={`${testidPrefix}-density-compact`}
                title="Compact rows — fit more years on screen"
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${density === "compact" ? "bg-[#4A6741] text-white" : "text-[#4A6741] hover:bg-[#EBE8E0]"}`}>
          <Rows3 className="h-3 w-3" /> Compact
        </button>
        <button type="button" onClick={() => setDensity("roomy")}
                data-testid={`${testidPrefix}-density-roomy`}
                title="Roomy rows — larger padding, wider number columns for zoomed / projector view"
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${density === "roomy" ? "bg-[#4A6741] text-white" : "text-[#4A6741] hover:bg-[#EBE8E0]"}`}>
          <Rows2 className="h-3 w-3" /> Roomy
        </button>
      </div>
    </div>
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[10px] label-cap text-muted-foreground">Format</span>
      <div className="inline-flex rounded-full border border-[#EBE8E0] p-0.5 bg-[#F9F8F6]">
        <button type="button" onClick={() => setScale("full")}
                data-testid={`${testidPrefix}-scale-full`}
                title="Full dollars — $1,234,567"
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${scale === "full" ? "bg-[#4A6741] text-white" : "text-[#4A6741] hover:bg-[#EBE8E0]"}`}>
          <Coins className="h-3 w-3" /> $
        </button>
        <button type="button" onClick={() => setScale("k")}
                data-testid={`${testidPrefix}-scale-thousands`}
                title="Thousands — $1,235k"
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${scale === "k" ? "bg-[#4A6741] text-white" : "text-[#4A6741] hover:bg-[#EBE8E0]"}`}>
          $k
        </button>
        <button type="button" onClick={() => setScale("m")}
                data-testid={`${testidPrefix}-scale-millions`}
                title="Millions — $1.23M"
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${scale === "m" ? "bg-[#4A6741] text-white" : "text-[#4A6741] hover:bg-[#EBE8E0]"}`}>
          $M
        </button>
      </div>
    </div>
  </div>
);

export default GridControls;
