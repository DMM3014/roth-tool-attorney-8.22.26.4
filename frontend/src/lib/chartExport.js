/**
 * chartExport.js — chart & data export helpers for the Analytics tab.
 *
 * Every panel on the Analytics page already carries the source data + the
 * DOM node of its Card. This helper wraps three concerns:
 *
 *   1. Rasterize a chart panel to a PNG blob (via html2canvas).
 *   2. Build a Word (.docx) file that embeds one or more chart images and,
 *      optionally, a data table beneath each image.
 *   3. Build an Excel (.xlsx) workbook that embeds one or more chart images
 *      and, optionally, one data sheet per chart. Uses `exceljs` because
 *      SheetJS free doesn't support embedded images.
 *
 * All three code paths are async because both html2canvas and the DOCX / XLSX
 * builders return promises.
 *
 * Consumers (see `ExportChip` + Analytics toolbar):
 *   • Per-chart chip supplies { node, title, data, filenameStem } for one chart.
 *   • The "Export all charts" toolbar supplies an ordered list of the same
 *     tuple objects.
 *
 * Kept in one file so the DOCX / XLSX libraries are lazy-loaded together on
 * the first export click, keeping the initial bundle small.
 */

import { saveAs } from "file-saver";

const MAX_SHEET_NAME = 31;
const sanitizeSheetName = (s) => {
  if (!s) return "Chart";
  return String(s).replace(/[\\/*?:[\]]/g, "").slice(0, MAX_SHEET_NAME) || "Chart";
};

/**
 * Wait for webfonts to finish loading + let Recharts settle a couple of RAFs
 * before rasterizing. Prevents synthetic-bold fallback text and captures
 * mid-transition SVG width — same fix we apply in the Client Report PDF path.
 */
async function settleForRasterize() {
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await Promise.all([
        document.fonts.load('700 16px "Outfit"'),
        document.fonts.load('600 14px "Outfit"'),
        document.fonts.load('400 12px "Outfit"'),
      ]);
    } catch { /* ignore */ }
    try { await document.fonts.ready; } catch { /* ignore */ }
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 120));
}

/**
 * Rasterize a DOM node to a { blob, dataUrl, width, height } PNG bundle.
 * Uses html2canvas at 2× to keep image sharp when embedded in Word.
 */
export async function chartToPng(node) {
  if (!node) throw new Error("chartToPng: node is required");
  await settleForRasterize();
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(node, {
    backgroundColor: "#FFFFFF",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const dataUrl = canvas.toDataURL("image/png");
  const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  return { blob, dataUrl, width: canvas.width, height: canvas.height };
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

/**
 * Build a Word document containing one section per chart. Each section has a
 * heading, an embedded PNG image (rasterized from the chart's DOM node), and
 * an optional data table below the image.
 *
 * @param {Array<{title, node, data, includeChart, includeData}>} charts
 * @param {string} filename  — e.g. "analytics-charts.docx"
 * @param {object} opts      — { docTitle }
 */
export async function exportChartsToWord(charts, filename, opts = {}) {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, HeadingLevel, ImageRun, Table, TableRow,
          TableCell, TextRun, WidthType, BorderStyle, AlignmentType } = docx;

  const children = [];
  // Cover heading
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: opts.docTitle || "Analytics — Chart & Data Export", bold: true })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Generated ${new Date().toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      })}`,
      italics: true, color: "888888",
    })],
    spacing: { after: 240 },
  }));

  for (const [idx, chart] of charts.entries()) {
    if (idx > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "" })],
                                    pageBreakBefore: true }));
    }
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: chart.title || `Chart ${idx + 1}`, bold: true })],
      spacing: { after: 120 },
    }));
    // Chart image
    if (chart.includeChart && chart.node) {
      try {
        const png = await chartToPng(chart.node);
        // Scale width to a Word-friendly 6.5 inches (page-safe) preserving aspect.
        const ratio = png.height / Math.max(1, png.width);
        const targetW = 600;
        const targetH = Math.round(targetW * ratio);
        // ImageRun needs the raw ArrayBuffer — grab it from the blob.
        const buf = await png.blob.arrayBuffer();
        children.push(new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new ImageRun({
            data: buf, transformation: { width: targetW, height: targetH },
          })],
          spacing: { after: 200 },
        }));
      } catch (err) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `(Chart image unavailable: ${err?.message || err})`,
                                    color: "999999", italics: true })],
        }));
      }
    }
    // Data table
    if (chart.includeData && Array.isArray(chart.data) && chart.data.length > 0) {
      const keys = Object.keys(chart.data[0]);
      const headerRow = new TableRow({
        tableHeader: true,
        children: keys.map((k) => new TableCell({
          shading: { fill: "F1F5EF" },
          children: [new Paragraph({
            children: [new TextRun({ text: prettifyKey(k), bold: true, size: 18 })],
          })],
        })),
      });
      const bodyRows = chart.data.map((row) => new TableRow({
        children: keys.map((k) => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: fmtCell(row[k]), size: 18 })],
          })],
        })),
      }));
      children.push(new Table({
        rows: [headerRow, ...bodyRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: uniformBorders("C0C0C0"),
      }));
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename.endsWith(".docx") ? filename : `${filename}.docx`);
}

function uniformBorders(color) {
  const b = { style: "single", size: 4, color };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

const prettifyKey = (k) => String(k)
  .replace(/_/g, " ")
  .replace(/\b\w/g, (c) => c.toUpperCase());

const fmtCell = (v) => {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
};

// ---------------------------------------------------------------------------
// XLSX (exceljs — supports embedded images)
// ---------------------------------------------------------------------------

/**
 * Build an .xlsx workbook. If `includeChart` is true for a chart, that
 * chart's image is embedded in its data sheet above the data table (or in a
 * dedicated image sheet if no data is requested). If `includeData` is true
 * for a chart, the chart's rows appear as a table.
 */
export async function exportChartsToExcel(charts, filename, opts = {}) {
  const ExcelJS = (await import("exceljs")).default || (await import("exceljs"));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = opts.creator || "Roth Retirement Planner";
  workbook.created = new Date();

  for (const chart of charts) {
    const sheetName = sanitizeSheetName(chart.title);
    const ws = workbook.addWorksheet(sheetName);
    let cursorRow = 1;

    // Chart title
    ws.getCell(cursorRow, 1).value = chart.title || "Chart";
    ws.getCell(cursorRow, 1).font = { bold: true, size: 14, color: { argb: "FF4A6741" } };
    cursorRow += 2;

    // Chart image
    if (chart.includeChart && chart.node) {
      try {
        const png = await chartToPng(chart.node);
        const b64 = png.dataUrl.split(",")[1];
        const imageId = workbook.addImage({ base64: b64, extension: "png" });
        // Anchor image starting at current cursor; give it 10 rows × 12 cols
        // of real estate scaled to reasonable Excel display dimensions.
        const ratio = png.height / Math.max(1, png.width);
        const imgW = 640;
        const imgH = Math.round(imgW * ratio);
        ws.addImage(imageId, {
          tl: { col: 0, row: cursorRow - 1 },
          ext: { width: imgW, height: imgH },
        });
        // Reserve enough rows so the data table starts below the image.
        const rowsReserved = Math.max(16, Math.ceil(imgH / 18));
        cursorRow += rowsReserved + 1;
      } catch (err) {
        ws.getCell(cursorRow, 1).value = `(Chart image unavailable: ${err?.message || err})`;
        ws.getCell(cursorRow, 1).font = { italic: true, color: { argb: "FF888888" } };
        cursorRow += 2;
      }
    }

    // Data
    if (chart.includeData && Array.isArray(chart.data) && chart.data.length > 0) {
      const keys = Object.keys(chart.data[0]);
      const header = ws.getRow(cursorRow);
      keys.forEach((k, i) => {
        header.getCell(i + 1).value = prettifyKey(k);
        header.getCell(i + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        header.getCell(i + 1).fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: "FF4A6741" },
        };
        header.getCell(i + 1).alignment = { horizontal: "left" };
      });
      cursorRow += 1;
      chart.data.forEach((row) => {
        const r = ws.getRow(cursorRow);
        keys.forEach((k, i) => {
          const v = row[k];
          r.getCell(i + 1).value = typeof v === "number" ? v : (v == null ? "" : String(v));
          if (typeof v === "number") {
            r.getCell(i + 1).numFmt = Number.isInteger(v) ? "#,##0" : "#,##0.00";
          }
        });
        cursorRow += 1;
      });
      // Auto-fit widths
      keys.forEach((k, i) => {
        const maxLen = Math.max(prettifyKey(k).length,
          ...chart.data.map((row) => String(row[k] ?? "").length));
        ws.getColumn(i + 1).width = Math.min(28, Math.max(10, maxLen + 2));
      });
    }
  }

  const buf = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
         filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
