/**
 * TabDownloadMenu — floating "Download this tab" button visible on every
 * planner tab. Reads the currently-active `[role="tabpanel"][data-state="active"]`
 * DOM node and rasterizes it into a PDF or Word file (see `lib/tabExport.js`).
 *
 * Kept as a floating action instead of per-tab buttons so the menu doesn't
 * have to be threaded into 18+ tab components. Pinned bottom-right so it
 * never sits on top of a chart the reader is trying to see. Marked
 * `data-export-ignore` so it's stripped from the exported artifact itself.
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Download, FileText, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadNodeAsPdf, downloadNodeAsWord } from "@/lib/tabExport";

const TAB_LABELS = {
  inputs: "Plan Inputs",
  projection: "Conversion & Plan Controls",
  scenarios: "Scenarios",
  optimizer: "Single-Year Analyzer",
  strategy: "Strategy Analyzer",
  ssopt: "SS Analyzer",
  cashflow: "Accounts & Cashflow",
  tax: "Tax Detail",
  "bracket-viz": "Bracket Visualizer",
  "cashflow-detail": "Cashflow",
  analytics: "Analytics",
  montecarlo: "Monte Carlo",
  compare: "Compare",
  presentation: "Presentation",
  "client-report": "Client Report",
  "ss-report": "SS Report",
  "convert-compare": "Convert vs Skip",
  estate: "Estate",
  "ep-flowchart": "EP Flowchart",
  dsue: "DSUE Checklist",
  concepts: "Concepts",
  whitepaper: "White Paper",
  "advisor-info": "Advisor Info",
  admin: "Admin",
};

const slug = (s) => (s || "tab").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const TabDownloadMenu = ({ activeTab }) => {
  const [busy, setBusy] = useState(null); // 'pdf' | 'word' | null
  const [open, setOpen] = useState(false);
  const label = TAB_LABELS[activeTab] || "Tab";
  const filenameStem = `${slug(label)}-${new Date().toISOString().slice(0, 10)}`;

  const grabActivePanel = () => {
    // The Radix tabs implementation sets data-state="active" on the currently
    // visible panel. There is only ever one such element in the DOM.
    return document.querySelector('[role="tabpanel"][data-state="active"]');
  };

  const run = async (fmt) => {
    if (busy) return;
    const node = grabActivePanel();
    if (!node) { toast.error("Couldn't find the active tab panel to export."); return; }
    setBusy(fmt);
    setOpen(false);
    try {
      if (fmt === "pdf") {
        await downloadNodeAsPdf(node, filenameStem);
      } else {
        await downloadNodeAsWord(node, filenameStem, label);
      }
      toast.success(`Downloaded ${label} as ${fmt.toUpperCase()}.`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("tab export failed", err);
      toast.error(`Export failed: ${err?.message || "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-export-ignore
         className="fixed bottom-6 right-6 z-40 print:hidden">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm"
                  data-testid="tab-download-menu-trigger"
                  disabled={!!busy}
                  title={`Download ${label} as PDF or Word`}
                  className="rounded-full shadow-lg bg-[#4A6741] text-white hover:bg-[#3E5637] gap-2 px-4">
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Exporting {busy}…</>
              : <><Download className="h-4 w-4" /> Download tab</>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-56 p-1"
                        data-testid="tab-download-menu">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <button type="button"
                  onClick={() => run("pdf")}
                  disabled={!!busy}
                  data-testid="tab-download-pdf"
                  className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-[12px] text-[#1A1A1A] hover:bg-[#F1F5EF] transition-colors disabled:opacity-40 text-left">
            <FileDown className="h-3.5 w-3.5" />
            Download as PDF
          </button>
          <button type="button"
                  onClick={() => run("word")}
                  disabled={!!busy}
                  data-testid="tab-download-word"
                  className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-[12px] text-[#1A1A1A] hover:bg-[#F1F5EF] transition-colors disabled:opacity-40 text-left">
            <FileText className="h-3.5 w-3.5" />
            Download as Word (.docx)
          </button>
          <div className="px-2 pt-1 pb-0.5 text-[9.5px] leading-snug text-muted-foreground">
            Exports what you see on this tab. Interactive charts and tables are
            rasterized as images.
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default TabDownloadMenu;
