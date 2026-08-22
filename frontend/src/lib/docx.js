/**
 * DOCX export for report pages — semi-structured Option B.
 *
 * Approach: walk each `.pdf-page` section in the report preview and emit
 * proper Word primitives — Heading 1/2/3 paragraphs, body paragraphs, real
 * Word tables — while charts (Recharts SVG containers) are rasterized via
 * html2canvas and embedded as PNG images. Legends and KPI blocks get their
 * own compact renderers. Everything else recurses into children so nothing
 * goes missing from the DOM.
 *
 * The primitives (H1/H2/H3/P/Sub/Kpi/StaticLegend) all carry a `data-docx`
 * attribute so the walker never has to guess based on font-size. Chart blocks
 * are auto-detected by presence of `.recharts-responsive-container`.
 *
 * Files that emit these primitives:
 *   /app/frontend/src/components/clientReport/helpers.jsx
 *   /app/frontend/src/components/ssReport/helpers.jsx
 *
 * NOTE on docx v9 API: `ImageRun` REQUIRES `type: "png"` (or jpg/gif/bmp)
 * alongside `data`. TextRun does not expose `.options` — style attributes
 * must be tracked on plain descriptor objects until the moment we construct
 * a TextRun, otherwise bold/italic inheritance is silently dropped.
 */
import html2canvas from "html2canvas";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
  PageOrientation,
} from "docx";
import { saveAs } from "file-saver";

// ---------- page constants (A4 portrait, 10mm margins to match PDF) ----------
const A4_TWIPS_W = 11906;
const A4_TWIPS_H = 16838;
const MARGIN_TWIPS = 567;                    // 10mm
const USABLE_INCH_WIDTH = 7.48 - 0.79;       // A4 usable width in inches ≈ 6.69"
const USABLE_PIXEL_WIDTH = Math.round(USABLE_INCH_WIDTH * 96); // ~642 px at 96 DPI
const CHART_TARGET_WIDTH_PX = 720;

const cleanText = (raw) => (raw || "").replace(/\s+/g, " ").trim();

// ---------- Rasterize a DOM element ----------
// Returns { bytes, pxWidth, pxHeight } — bytes is a Uint8Array PNG suitable
// for docx's ImageRun. Throws (do not swallow) so emitChart can surface the
// error rather than silently omitting the chart.
async function rasterize(el) {
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#FFFFFF",
    windowWidth: el.scrollWidth || CHART_TARGET_WIDTH_PX,
    logging: false,
  });
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, pxWidth: canvas.width, pxHeight: canvas.height };
}

// ---------- Inline text walker ----------
// Returns an array of { text, bold, italic } DESCRIPTORS. Callers construct
// TextRun objects from these so we can layer additional attrs (size, color,
// font) at emission time without depending on TextRun.options (removed in v9).
function textRunDescriptors(node) {
  const out = [];
  const walk = (n, bold = false, italic = false) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent.replace(/\s+/g, " ");
      if (t.trim().length) out.push({ text: t, bold, italic });
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const tag = n.tagName.toLowerCase();
    if (tag === "br") { out.push({ text: "", break: 1 }); return; }
    const styleAttr = n.getAttribute("style") || "";
    const isBold = bold || tag === "strong" || tag === "b" ||
      /font-weight:\s*(bold|[6-9]00)/i.test(styleAttr);
    const isItalic = italic || tag === "em" || tag === "i" ||
      /font-style:\s*italic/i.test(styleAttr);
    for (const child of n.childNodes) walk(child, isBold, isItalic);
  };
  walk(node);
  return out.length ? out : [{ text: "" }];
}

// Materialize descriptors into TextRun objects with additional per-emitter
// style attributes (color, size in half-points, font).
function runsFromDescriptors(descs, extra = {}) {
  return descs.map((d) => new TextRun({
    text: d.text,
    bold: d.bold,
    italics: d.italic,
    break: d.break,
    ...extra,
  }));
}

// ---------- HTML <table> → Word Table ----------
function docxTableFromHtml(tableEl) {
  const rows = [];
  const trList = Array.from(tableEl.querySelectorAll("tr"));
  for (const tr of trList) {
    const cells = Array.from(tr.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
    if (!cells.length) continue;
    const isHeader = cells[0].tagName === "TH" || tr.parentElement.tagName === "THEAD";
    const tableCells = cells.map((td) => {
      const descs = textRunDescriptors(td);
      const runs = runsFromDescriptors(descs, {
        size: 18, font: "Calibri",
        // Header rows always render bold regardless of source markup.
        ...(isHeader ? { bold: true } : {}),
      });
      const raw = cleanText(td.textContent);
      const numeric = /^-?[$(]?[\d,.\s%()$-]+$/.test(raw) && /\d/.test(raw);
      const align = numeric ? AlignmentType.RIGHT : AlignmentType.LEFT;
      return new TableCell({
        children: [new Paragraph({ children: runs, alignment: align })],
        shading: isHeader ? { fill: "F9F8F6" } : undefined,
      });
    });
    rows.push(new TableRow({ children: tableCells, tableHeader: isHeader }));
  }
  if (!rows.length) return null;
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "EBE8E0" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "EBE8E0" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "EBE8E0" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "EBE8E0" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "EBE8E0" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "EBE8E0" },
    },
  });
}

// ---------- chart / kpi / legend detection ----------
const hasRechartsInside = (el) =>
  el.querySelector && el.querySelector(".recharts-responsive-container") != null;

const isChartWrapper = (el) => {
  // Chart wrapper = block with Recharts inside AND explicit fixed height (the
  // report positions every chart in `<div style={{ height: N }}>`). We do NOT
  // reject wrappers whose parent also contains recharts — sibling charts under
  // a common .pdf-page (which every report has) would mutually reject each
  // other via a broad hasRechartsInside check. Double-emission from nested
  // wrappers is already prevented by the `data-docx-chart-rasterized`
  // attribute + WeakSet `handled` guard in walkSection().
  if (!hasRechartsInside(el)) return false;
  const style = el.getAttribute("style") || "";
  return /height:\s*\d+/i.test(style);
};

// ---------- section walker ----------
async function walkSection(section) {
  const children = [];
  const handled = new WeakSet();

  const emitHeading = (level, node) => {
    const runs = runsFromDescriptors(textRunDescriptors(node), {
      bold: true, color: "1A1A1A",
      size: level === 1 ? 44 : level === 2 ? 32 : 25,
      font: "Calibri",
    });
    children.push(new Paragraph({
      children: runs,
      heading: level === 1 ? HeadingLevel.HEADING_1
        : level === 2 ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3,
      spacing: { before: level === 3 ? 160 : 220, after: 80 },
    }));
  };

  const emitParagraph = (node, muted = false) => {
    const runs = runsFromDescriptors(textRunDescriptors(node), {
      color: muted ? "777777" : "2A2A2A",
      size: muted ? 18 : 22,
      italics: muted ? true : undefined,
      font: "Calibri",
    });
    children.push(new Paragraph({
      children: runs,
      spacing: { after: 80, line: 300 },
    }));
  };

  const emitKpi = (node) => {
    const label = node.getAttribute("data-docx-kpi-label") || "";
    const value = node.getAttribute("data-docx-kpi-value") || cleanText(node.textContent);
    const sub = node.getAttribute("data-docx-kpi-sub") || "";
    children.push(new Paragraph({
      children: [
        new TextRun({ text: label.toUpperCase(), bold: true, color: "4A6741", size: 16, font: "Calibri" }),
        new TextRun({ text: "  ", size: 22 }),
        new TextRun({ text: value, bold: true, color: "1A1A1A", size: 30, font: "Calibri" }),
        ...(sub ? [new TextRun({ text: `   ${sub}`, color: "777777", size: 16, font: "Calibri" })] : []),
      ],
      spacing: { after: 60 },
    }));
  };

  const emitLegend = (node) => {
    // Read each legend item (span with a coloured swatch + label) and emit a
    // single line of colored bullet-labels.
    const items = Array.from(node.querySelectorAll(":scope > span, :scope > button"));
    const runs = [];
    items.forEach((it, i) => {
      const swatch = it.querySelector("span");
      const bg = swatch ? (swatch.style.background || swatch.style.backgroundColor || "").toString() : "";
      let hex = (bg.match(/#([0-9a-fA-F]{6})/) || [])[1]
        || (bg.match(/#([0-9a-fA-F]{3})/) || [])[1] || "999999";
      if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
      const label = cleanText(it.textContent);
      if (!label) return;
      if (i > 0) runs.push(new TextRun({ text: "   ", size: 16 }));
      runs.push(new TextRun({ text: "\u25A0 ", color: hex.toUpperCase(), size: 18 }));
      runs.push(new TextRun({ text: label, color: "2A2A2A", size: 16, font: "Calibri" }));
    });
    if (runs.length) children.push(new Paragraph({ children: runs, spacing: { after: 100 } }));
  };

  const emitChart = async (el) => {
    // Rasterize the chart wrapper + optional adjacent StaticLegend together.
    const next = el.nextElementSibling;
    const includeLegend = next && next.getAttribute && next.getAttribute("data-docx") === "legend";
    let wrapper = null;
    let composite = el;
    if (includeLegend) {
      wrapper = document.createElement("div");
      wrapper.style.width = (el.offsetWidth || CHART_TARGET_WIDTH_PX) + "px";
      wrapper.style.background = "#FFFFFF";
      el.parentNode.insertBefore(wrapper, el);
      wrapper.appendChild(el);
      wrapper.appendChild(next);
      composite = wrapper;
      handled.add(next);
    }
    try {
      const { bytes, pxWidth, pxHeight } = await rasterize(composite);
      // Fit width to usable page area, preserve aspect ratio. `transformation`
      // in docx v9 takes width/height in DEVICE PIXELS (which docx converts to
      // EMU internally).
      const width = USABLE_PIXEL_WIDTH;
      const height = Math.round(width * (pxHeight / pxWidth));
      children.push(new Paragraph({
        children: [new ImageRun({
          type: "png",                       // REQUIRED in docx v9
          data: bytes,
          transformation: { width, height },
        })],
        spacing: { before: 80, after: 120 },
      }));
    } catch (e) {
      // Surface the failure instead of silently dropping charts.
      console.error("[docx] chart rasterize failed for", el, e);
      children.push(new Paragraph({
        children: [new TextRun({
          text: `[chart could not be embedded: ${e.message || e}]`,
          color: "B84A4A", italics: true, size: 18,
        })],
        spacing: { after: 100 },
      }));
    } finally {
      if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.insertBefore(el, wrapper);
        if (next) wrapper.parentNode.insertBefore(next, wrapper);
        wrapper.parentNode.removeChild(wrapper);
      }
    }
  };

  const walk = async (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (handled.has(node)) return;

    // Explicit opt-out (unused today but keeps the door open for footers etc.)
    if (node.dataset && node.dataset.docxSkip === "true") return;

    // Skip everything under a chart wrapper we've already rasterized.
    if (node.closest && node.closest("[data-docx-chart-rasterized]")) return;

    // Explicit "rasterize me" marker. Used by pages that need to embed a
    // visual block that isn't a Recharts chart (e.g. the EP Flowchart tab's
    // hand-rolled two-column plan diagram). Handled before isChartWrapper so
    // callers can force rasterization even when no Recharts is present.
    if (node.getAttribute && node.getAttribute("data-docx-rasterize")) {
      node.setAttribute("data-docx-chart-rasterized", "true");
      await emitChart(node);
      node.removeAttribute("data-docx-chart-rasterized");
      handled.add(node);
      return;
    }

    // Chart wrapper → rasterize (adjacent legend picked up automatically).
    if (isChartWrapper(node)) {
      node.setAttribute("data-docx-chart-rasterized", "true");
      await emitChart(node);
      node.removeAttribute("data-docx-chart-rasterized");
      handled.add(node);
      return;
    }

    // Dispatch on our data-docx primitive marker.
    const kind = node.getAttribute("data-docx");
    if (kind === "h1") { emitHeading(1, node); handled.add(node); return; }
    if (kind === "h2") { emitHeading(2, node); handled.add(node); return; }
    if (kind === "h3") { emitHeading(3, node); handled.add(node); return; }
    if (kind === "p") { emitParagraph(node); handled.add(node); return; }
    if (kind === "sub") { emitParagraph(node, true); handled.add(node); return; }
    if (kind === "kpi") { emitKpi(node); handled.add(node); return; }
    if (kind === "legend") { emitLegend(node); handled.add(node); return; }

    // Native heading / paragraph / table fallbacks.
    const tag = node.tagName.toLowerCase();
    if (tag === "h1") { emitHeading(1, node); return; }
    if (tag === "h2") { emitHeading(2, node); return; }
    if (tag === "h3" || tag === "h4") { emitHeading(3, node); return; }
    if (tag === "p") {
      // Only emit as a paragraph if it hasn't already been matched by the
      // data-docx branch above. Avoids double-emission of <P data-docx="p">.
      if (!kind) emitParagraph(node);
      handled.add(node);
      return;
    }
    if (tag === "table") {
      const t = docxTableFromHtml(node);
      if (t) children.push(t, new Paragraph({ text: "", spacing: { after: 80 } }));
      handled.add(node);
      // Do not recurse into table cells — everything captured above.
      return;
    }
    if (tag === "svg" || tag === "img") return;

    // Recurse in document order.
    for (const child of node.childNodes) {
      // eslint-disable-next-line no-await-in-loop
      await walk(child);
    }
  };

  await walk(section);
  return children;
}

// ---------- top-level export ----------
export async function downloadElementAsDocx({
  target,
  filename = "report.docx",
  sectionSelector = ".pdf-page",
  onProgress,
}) {
  const rootEl = typeof target === "string" ? document.querySelector(target) : target;
  if (!rootEl) throw new Error(`downloadElementAsDocx: target ${target} not found`);

  // Reset any interactive chart-isolation / disclaimer-fallback state so the
  // exported DOCX captures the un-dimmed / un-fallback-toggled view — same
  // guarantee we give the PDF.
  window.dispatchEvent(new CustomEvent("cr-reset-isolation"));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 150));
  // Wait for webfonts before rasterizing charts — otherwise embedded PNGs
  // capture synthetic-bold Outfit fallback (same root cause as the PDF path).
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

  let sections = Array.from(rootEl.querySelectorAll(sectionSelector));
  if (!sections.length) sections = [rootEl];

  const docSections = [];
  for (let i = 0; i < sections.length; i++) {
    if (onProgress) onProgress({ page: i + 1, total: sections.length });
    // eslint-disable-next-line no-await-in-loop
    const kids = await walkSection(sections[i]);
    docSections.push({
      properties: {
        page: {
          size: { width: A4_TWIPS_W, height: A4_TWIPS_H, orientation: PageOrientation.PORTRAIT },
          margin: { top: MARGIN_TWIPS, right: MARGIN_TWIPS, bottom: MARGIN_TWIPS, left: MARGIN_TWIPS },
        },
      },
      children: kids.length ? kids : [new Paragraph({ text: "" })],
    });
  }

  const doc = new Document({
    creator: "Roth Retirement Planner",
    title: filename.replace(/\.docx$/i, ""),
    description: "Client Report exported from the Roth Retirement Planner",
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
    sections: docSections,
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}
