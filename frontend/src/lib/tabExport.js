/**
 * tabExport.js — download the currently-active planner tab as a PDF or Word
 * document.
 *
 * The planner has 18+ top-level tabs (Plan Inputs, Conversion & Plan Controls,
 * Scenarios, Optimizers, Cashflow, Analytics, Monte Carlo, Estate, EP Flowchart,
 * Concepts, White Paper, etc.). Every tab is a rich, arbitrary-height React
 * subtree — some (Analytics, Client Report preview) run 4000+ CSS pixels tall
 * with dozens of charts. Instead of adding per-tab custom exporters we
 * rasterize the whole panel via html2canvas and either:
 *   • Wrap it into a multi-page PDF (chunked at page boundaries), or
 *   • Embed the full-height image inside a single-page Word (.docx) document
 *     (Word autofits large images to page width; the reader scrolls the
 *     rendered image).
 *
 * Callers pass in the DOM node of the active tab panel (see TabDownloadMenu:
 * it snapshots `[role="tabpanel"][data-state="active"]`).
 *
 * Notes:
 *   - We await `document.fonts.ready` + 2 RAFs + a small settle before
 *     rasterizing — same fix as the Client Report PDF path to prevent
 *     synthetic-bold Outfit text.
 *   - Print-only sections (`.print:hidden`) or interactive-only widgets
 *     (`.no-export`) are hidden during capture so the exported artifact
 *     shows only the content the reader sees.
 */

import { saveAs } from "file-saver";
import jsPDF from "jspdf";

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

async function rasterize(node, scale = 2) {
  const { default: html2canvas } = await import("html2canvas");
  return html2canvas(node, {
    backgroundColor: "#FFFFFF",
    scale,
    useCORS: true,
    logging: false,
    // Ignore any element that opts out (e.g. floating action bars or the
    // download button itself sitting inside the same panel).
    ignoreElements: (el) => el.hasAttribute && (el.hasAttribute("data-export-ignore") ||
      el.classList?.contains("no-export")),
  });
}

/**
 * Slice a tall canvas into page-sized chunks and add each to the PDF.
 * Preserves the source aspect ratio and prevents charts from being scaled
 * to unreadable sizes on very tall tabs.
 */
function paintChunkedIntoPdf(pdf, canvas, opts) {
  const { pageWidth, pageHeight, marginX = 8, marginY = 10 } = opts;
  const contentWidth = pageWidth - marginX * 2;
  const contentHeight = pageHeight - marginY * 2;
  const pxToMm = contentWidth / canvas.width;
  const totalHeightMm = canvas.height * pxToMm;
  if (totalHeightMm <= contentHeight) {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(dataUrl, "JPEG", marginX, marginY, contentWidth, totalHeightMm);
    return;
  }
  const pageSourcePx = Math.floor(contentHeight / pxToMm);
  let y = 0;
  let first = true;
  const scratch = document.createElement("canvas");
  scratch.width = canvas.width;
  scratch.height = pageSourcePx;
  const scratchCtx = scratch.getContext("2d");
  while (y < canvas.height) {
    const h = Math.min(pageSourcePx, canvas.height - y);
    if (h !== scratch.height) { scratch.height = h; }
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    scratchCtx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, scratch.width, h);
    const chunkDataUrl = scratch.toDataURL("image/jpeg", 0.92);
    if (!first) pdf.addPage();
    pdf.addImage(chunkDataUrl, "JPEG", marginX, marginY, contentWidth, h * pxToMm);
    first = false;
    y += h;
  }
}

export async function downloadNodeAsPdf(node, filenameStem, opts = {}) {
  if (!node) throw new Error("downloadNodeAsPdf: node is required");
  await settleForRasterize();
  const canvas = await rasterize(node, opts.scale ?? 2);
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "letter", compress: true });
  paintChunkedIntoPdf(pdf, canvas, {
    pageWidth: pdf.internal.pageSize.getWidth(),
    pageHeight: pdf.internal.pageSize.getHeight(),
    marginX: 8, marginY: 10,
  });
  pdf.save(filenameStem.endsWith(".pdf") ? filenameStem : `${filenameStem}.pdf`);
}

/**
 * Downloads the tab as a Word document. We slice the full-height canvas into
 * page-height chunks (same as the PDF path) and embed each chunk as its own
 * ImageRun paragraph. That way Word renders the tab across N pages instead
 * of forcing the reader to scroll a single giant image.
 */
export async function downloadNodeAsWord(node, filenameStem, title, opts = {}) {
  if (!node) throw new Error("downloadNodeAsWord: node is required");
  await settleForRasterize();
  const canvas = await rasterize(node, opts.scale ?? 2);
  const docx = await import("docx");
  const { Document, Packer, Paragraph, HeadingLevel, ImageRun, TextRun } = docx;

  // Word page: 8.5x11 in with 0.5in margins → content = 7.5in wide = 720px @ 96dpi.
  const contentPxWidth = 720;
  const scaleRatio = contentPxWidth / canvas.width;
  // Chunk source height so each embedded image lands within one Word page.
  // Standard letter page @ 96dpi with 0.5" margins ≈ 960px tall content area
  // → sourcePx per page = 960 / scaleRatio.
  const perPageSrcPx = Math.max(400, Math.floor(960 / scaleRatio));

  const children = [];
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: title || filenameStem, bold: true })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      italics: true, color: "888888",
    })],
    spacing: { after: 200 },
  }));

  const scratch = document.createElement("canvas");
  scratch.width = canvas.width;
  scratch.height = perPageSrcPx;
  const scratchCtx = scratch.getContext("2d");
  let y = 0;
  let firstImage = true;
  while (y < canvas.height) {
    const h = Math.min(perPageSrcPx, canvas.height - y);
    if (h !== scratch.height) { scratch.height = h; }
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    scratchCtx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, scratch.width, h);
    const blob = await new Promise((r) => scratch.toBlob((b) => r(b), "image/png"));
    const buf = await blob.arrayBuffer();
    const displayW = Math.round(canvas.width * scaleRatio);
    const displayH = Math.round(h * scaleRatio);
    children.push(new Paragraph({
      pageBreakBefore: !firstImage,
      children: [new ImageRun({ data: buf, transformation: { width: displayW, height: displayH } })],
    }));
    firstImage = false;
    y += h;
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children,
    }],
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filenameStem.endsWith(".docx") ? filenameStem : `${filenameStem}.docx`);
}
