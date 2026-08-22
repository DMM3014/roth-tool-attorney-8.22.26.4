// Per-chart export dropdown.
//
// The Analytics tab used to expose only "Data → CSV" and "Data → Excel" as
// two pill buttons. Advisor request 2026-02: also export the CHART image and
// combinations of chart + data as Word or Excel. This component now renders a
// single "Export" pill that opens a small popover with the six combinations:
//
//   Data only     → CSV · Excel · Word
//   Chart only    → PNG · Word · Excel
//   Chart + data  → Word · Excel
//
// PNG-only stays as a "quick" option because dropping a raw chart image into a
// slide deck is the highest-frequency use case advisors mentioned.
//
// Props:
//   data     — flat array of records that back the chart.
//   filename — filename stem (no extension), also used as the DOCX heading /
//              XLSX sheet title.
//   testid   — test id prefix (buttons pick up `${testid}-csv`, `-xlsx`, etc.).
//   chartRef — React ref pointing at the DOM element html2canvas should
//              rasterize (typically the Card that contains the ResponsiveContainer).
//   title    — human-friendly title used in Word / Excel exports (falls back to filename).
//
// Renders nothing when neither `data` nor `chartRef.current` is available.
import { useState, useCallback } from "react";
import { downloadCSV, downloadWorkbook } from "@/lib/api";
import { FileSpreadsheet, FileDown, FileText, Image as ImageIcon, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chartToPng, exportChartsToWord, exportChartsToExcel } from "@/lib/chartExport";
import { toast } from "sonner";
import { saveAs } from "file-saver";

const ExportChip = ({ data, filename, testid, chartRef, title }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useCallback(async (fn) => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("export error", err);
      toast.error(`Export failed: ${err?.message || "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);
  const hasData = Array.isArray(data) && data.length > 0;
  const hasChart = !!chartRef?.current;
  if (!filename || (!hasData && !hasChart)) return null;
  const chartTitle = title || filename;

  const onCsv = () => wrap(async () => {
    downloadCSV(data, `${filename}.csv`);
  });
  const onXlsxData = () => wrap(async () => {
    downloadWorkbook([{ name: filename, rows: data }], `${filename}.xlsx`);
  });
  const onWordData = () => wrap(async () => {
    await exportChartsToWord(
      [{ title: chartTitle, node: null, data, includeChart: false, includeData: true }],
      `${filename}.docx`,
    );
  });
  const onPng = () => wrap(async () => {
    const png = await chartToPng(chartRef.current);
    saveAs(png.blob, `${filename}.png`);
  });
  const onWordChart = () => wrap(async () => {
    await exportChartsToWord(
      [{ title: chartTitle, node: chartRef.current, data,
         includeChart: true, includeData: false }],
      `${filename}.docx`,
    );
  });
  const onXlsxChart = () => wrap(async () => {
    await exportChartsToExcel(
      [{ title: chartTitle, node: chartRef.current, data,
         includeChart: true, includeData: false }],
      `${filename}.xlsx`,
    );
  });
  const onWordBoth = () => wrap(async () => {
    await exportChartsToWord(
      [{ title: chartTitle, node: chartRef.current, data,
         includeChart: true, includeData: true }],
      `${filename}.docx`,
    );
  });
  const onXlsxBoth = () => wrap(async () => {
    await exportChartsToExcel(
      [{ title: chartTitle, node: chartRef.current, data,
         includeChart: true, includeData: true }],
      `${filename}.xlsx`,
    );
  });

  const rowCls = "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-[#1A1A1A] hover:bg-[#F1F5EF] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-left";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button"
                data-testid={testid ? `${testid}-export` : "chart-export"}
                data-busy={busy ? "true" : "false"}
                disabled={busy}
                title="Download this chart or its data"
                className="inline-flex items-center gap-1 rounded-full border border-[#EBE8E0] bg-white/90 px-2 py-0.5 text-[10px] font-medium text-[#4A6741] hover:bg-[#F1F5EF] transition-colors print:hidden disabled:opacity-50">
          <FileDown className="h-3 w-3" />
          {busy ? "Exporting…" : "Export"}
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1"
                      data-testid={testid ? `${testid}-export-menu` : "chart-export-menu"}>
        <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">Chart</div>
        <button type="button" disabled={!hasChart} onClick={onPng} className={rowCls}
                data-testid={testid ? `${testid}-png` : "chart-png"}>
          <ImageIcon className="h-3 w-3 shrink-0" /> Chart image (PNG)
        </button>
        <button type="button" disabled={!hasChart} onClick={onWordChart} className={rowCls}
                data-testid={testid ? `${testid}-word-chart` : "chart-word-chart"}>
          <FileText className="h-3 w-3 shrink-0" /> Chart in Word (.docx)
        </button>
        <button type="button" disabled={!hasChart} onClick={onXlsxChart} className={rowCls}
                data-testid={testid ? `${testid}-xlsx-chart` : "chart-xlsx-chart"}>
          <FileSpreadsheet className="h-3 w-3 shrink-0" /> Chart in Excel (.xlsx)
        </button>
        <div className="px-2 py-1 mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">Data</div>
        <button type="button" disabled={!hasData} onClick={onCsv} className={rowCls}
                data-testid={testid ? `${testid}-csv` : "chart-csv"}>
          <FileDown className="h-3 w-3 shrink-0" /> Data as CSV
        </button>
        <button type="button" disabled={!hasData} onClick={onXlsxData} className={rowCls}
                data-testid={testid ? `${testid}-xlsx` : "chart-xlsx"}>
          <FileSpreadsheet className="h-3 w-3 shrink-0" /> Data as Excel
        </button>
        <button type="button" disabled={!hasData} onClick={onWordData} className={rowCls}
                data-testid={testid ? `${testid}-word-data` : "chart-word-data"}>
          <FileText className="h-3 w-3 shrink-0" /> Data as Word
        </button>
        <div className="px-2 py-1 mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">Chart + Data</div>
        <button type="button" disabled={!hasChart || !hasData} onClick={onWordBoth} className={rowCls}
                data-testid={testid ? `${testid}-word-both` : "chart-word-both"}>
          <FileText className="h-3 w-3 shrink-0" /> Chart + data in Word
        </button>
        <button type="button" disabled={!hasChart || !hasData} onClick={onXlsxBoth} className={rowCls}
                data-testid={testid ? `${testid}-xlsx-both` : "chart-xlsx-both"}>
          <FileSpreadsheet className="h-3 w-3 shrink-0" /> Chart + data in Excel
        </button>
      </PopoverContent>
    </Popover>
  );
};

export default ExportChip;
