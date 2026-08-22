import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import html2pdf from "html2pdf.js";

const usd = (v) =>
  v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Build a single branded multi-page PDF: cover + metrics summary, then each chart node.
export async function exportPresentationPDF({ title, subtitle, household, metrics, chartNodes, filename = "retirement_presentation.pdf" }) {
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 40;
  const contentW = W - M * 2;

  const footer = (pageLabel) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text("Educational model · LTCG/QDIV stacked at 0/15/20% · NIIT · IRMAA · indexed brackets. Verify against current IRS tables.", M, H - 22);
    pdf.text(pageLabel, W - M, H - 22, { align: "right" });
  };

  // ---------- Cover + summary ----------
  pdf.setFillColor(74, 103, 65); // #4A6741
  pdf.rect(0, 0, W, 96, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text(title, M, 50);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(subtitle, M, 72);

  let y = 132;
  pdf.setTextColor(30, 30, 30);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(`Prepared for ${household}`, M, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(120, 120, 120);
  pdf.text(`Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, M, y + 16);

  y += 50;
  // table header
  const colWith = M + contentW * 0.62;
  const colNo = M + contentW;
  pdf.setFontSize(8.5);
  pdf.setTextColor(120, 120, 120);
  pdf.text("STRATEGY METRIC", M, y);
  pdf.text("WITH CONVERSIONS", colWith, y, { align: "right" });
  pdf.text("NO CONVERSIONS", colNo, y, { align: "right" });
  y += 6;
  pdf.setDrawColor(74, 103, 65);
  pdf.setLineWidth(1);
  pdf.line(M, y, colNo, y);
  y += 18;

  metrics.forEach((m) => {
    pdf.setFontSize(10.5);
    pdf.setTextColor(40, 40, 40);
    pdf.setFont("helvetica", "normal");
    pdf.text(m.label, M, y);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(74, 103, 65);
    pdf.text(usd(m.withV), colWith, y, { align: "right" });
    pdf.setTextColor(90, 90, 90);
    pdf.setFont("helvetica", "normal");
    pdf.text(usd(m.noV), colNo, y, { align: "right" });
    y += 12;
    pdf.setDrawColor(235, 232, 224);
    pdf.setLineWidth(0.5);
    pdf.line(M, y, colNo, y);
    y += 16;
  });

  y += 6;
  pdf.setFontSize(9);
  pdf.setTextColor(120, 120, 120);
  pdf.setFont("helvetica", "italic");
  pdf.text("The following pages chart the year-by-year mechanics behind these figures.", M, y);
  footer("Page 1");

  // ---------- Chart pages ----------
  let page = 1;
  pdf.addPage();
  page += 1;
  y = M;
  for (const node of chartNodes) {
    if (!node) continue;
    const canvas = await html2canvas(node, { scale: 1.5, backgroundColor: "#ffffff", logging: false, useCORS: true });
    const imgH = (canvas.height * contentW) / canvas.width;
    if (y + imgH > H - M - 24) {
      footer(`Page ${page}`);
      pdf.addPage();
      page += 1;
      y = M;
    }
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", M, y, contentW, imgH);
    y += imgH + 16;
  }
  footer(`Page ${page}`);

  pdf.save(filename);
}


// -----------------------------------------------------------------------------
// downloadElementAsPdf — generic client-side element→PDF export.
//
// Why not window.print()? Emergent's preview iframe silently blocks modal
// dialogs (including the browser print dialog), so `window.print()` calls
// appear to do nothing to the user. html2pdf.js runs entirely in JS
// (html2canvas → jsPDF) without opening a native modal, so the download works
// uniformly in preview, production, and sandboxed iframe embeds.
//
// Strategy:
//   1. Optionally toggle a body class so the app's existing @media print rules
//      apply while html2canvas captures the DOM.
//   2. Rasterize the target element at 2× scale.
//   3. Stream the canvas into a multi-page A4/letter PDF via jsPDF.
//   4. Trigger a real .pdf file download (Blob URL → anchor click).
//   5. Restore the body class.
// -----------------------------------------------------------------------------
export async function downloadElementAsPdf({
  target,
  filename,
  bodyClass,
  format = "a4",
  orientation = "portrait",
  marginMm = 10,
  beforeSave,
  windowWidth,
  pageSelector = ".pdf-page",   // if the target contains child sections with this
                                // class, we render each one to its own PDF page
                                // (a true "chunked" export). Otherwise we fall back
                                // to single-canvas rendering (works for the White Paper).
}) {
  const rootEl = typeof target === "string" ? document.querySelector(target) : target;
  if (!rootEl) throw new Error(`downloadElementAsPdf: target "${target}" not found`);
  if (typeof beforeSave === "function") {
    try { beforeSave(); } catch (e) { console.warn("beforeSave hook threw", e); }
  }
  if (bodyClass) document.body.classList.add(bodyClass);
  try {
    const chunks = pageSelector ? Array.from(rootEl.querySelectorAll(pageSelector)) : [];
    if (chunks.length > 1) {
      // Chunked export: one PDF page per source section. Avoids all the
      // fragility of CSS `page-break-before` interacting with html2pdf's canvas
      // slicing — sections always start at the top of their PDF page.
      await renderChunkedPdf(chunks, { filename, format, orientation, marginMm });
    } else {
      // Single-canvas export (used for the White Paper).
      await renderSingleCanvasPdf(rootEl, { filename, format, orientation, marginMm, windowWidth, bodyClass });
    }
  } finally {
    if (bodyClass) document.body.classList.remove(bodyClass);
  }
}

// ---------- Chunked mode: one canvas per .pdf-page section ----------
// The Recharts tick-label crop bug (last x-axis label showing as "205" instead
// of "2056") comes from html2canvas serializing SVG elements at their declared
// width — any tick text that overflows the SVG viewBox on the right gets
// clipped. The per-chart fix is to give each chart enough `margin.right` so
// labels stay inside the SVG. This helper's job is to (a) rasterize each
// .pdf-page section at a sharper scale so the downscale-to-190mm doesn't
// produce blurry text, and (b) give Recharts a beat to re-layout after the
// wrap goes from `scale(0.7); width:142.85%` (preview) to full-size print.
async function renderChunkedPdf(sections, { filename, format, orientation, marginMm }) {
  const pdf = new jsPDF({ unit: "mm", format, orientation, compress: true });
  const pageWmm = pdf.internal.pageSize.getWidth();
  const pageHmm = pdf.internal.pageSize.getHeight();
  const usableWmm = pageWmm - 2 * marginMm;
  const usableHmm = pageHmm - 2 * marginMm;

  // Give Recharts' ResponsiveContainer (ResizeObserver-driven) two RAFs plus
  // a small settle delay to re-measure and re-render before we rasterize.
  // This matters because the caller flips the wrap from `scale(0.7);
  // width:142.85%` (preview) to full-size just before invoking us — without
  // the delay, some charts get captured mid-transition with a stale SVG width.
  // eslint-disable-next-line no-promise-executor-return
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // eslint-disable-next-line no-promise-executor-return
  await new Promise((r) => setTimeout(r, 200));
  // Wait for ALL webfonts (Outfit display + body) to finish loading before
  // html2canvas rasterizes. Without this, if any weight is still in-flight
  // when we start capture, browsers substitute a fallback font and paint
  // synthetic-bold over the already-bold Outfit weight — producing the
  // "mushy / smeared" heading text advisors report on the printed PDF.
  // We also nudge the load explicitly for the two weights the report
  // actually uses so a lazy fallback path doesn't slip through.
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await Promise.all([
        document.fonts.load('700 16px "Outfit"'),
        document.fonts.load('600 14px "Outfit"'),
        document.fonts.load('400 12px "Outfit"'),
      ]);
    } catch { /* font.load rejects only on network errors — fall through */ }
    try { await document.fonts.ready; } catch { /* ignore */ }
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    // eslint-disable-next-line no-await-in-loop
    const canvas = await html2canvas(section, {
      // scale=3 gives sharper text on downscale to A4 190mm. scale=2 was
      // producing visible blur when the source section was ~1400px wide (a
      // ~0.5x downscale rasterized to 190mm). At scale=3 the source canvas
      // is oversampled enough to stay crisp after fit-to-page scaling.
      scale: 3,
      useCORS: true,
      backgroundColor: "#FFFFFF",
      windowWidth: section.scrollWidth || 794,
      logging: false,
    });
    if (i > 0) pdf.addPage();
    // Aspect ratio is NEVER distorted. Earlier this clamped the height to the
    // usable page height while keeping full width, which vertically compressed
    // any over-tall section — the "squished text" advisors reported on the
    // Income & Expenses / Legacy / Appendix pages. Now:
    //   * fits-on-a-page  → draw at full width,
    //   * slightly taller → scale down proportionally and center,
    //   * much taller     → slice into page-height strips at full width.
    const fullHmm = (canvas.height * usableWmm) / canvas.width;
    if (fullHmm <= usableHmm + 0.5) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG",
        marginMm, marginMm, usableWmm, fullHmm, undefined, "FAST");
      continue;
    }
    const fitScale = usableHmm / fullHmm;
    if (fitScale >= 0.85) {
      const wmm = usableWmm * fitScale;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG",
        marginMm + (usableWmm - wmm) / 2, marginMm, wmm, usableHmm, undefined, "FAST");
      continue;
    }
    // Slice mode — keep text at full readable size across N pages.
    const stripHpx = Math.floor((canvas.width * usableHmm) / usableWmm);
    const strips = Math.ceil(canvas.height / stripHpx);
    for (let s = 0; s < strips; s++) {
      const hpx = Math.min(stripHpx, canvas.height - s * stripHpx);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = hpx;
      const ctx = slice.getContext("2d");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, s * stripHpx, canvas.width, hpx, 0, 0, canvas.width, hpx);
      if (s > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.94), "JPEG",
        marginMm, marginMm, usableWmm, (hpx * usableWmm) / canvas.width, undefined, "FAST");
    }
  }

  pdf.save(filename);
}

// ---------- Single-canvas mode: used for the White Paper ----------
async function renderSingleCanvasPdf(rootEl, { filename, format, orientation, marginMm, windowWidth, bodyClass }) {
  // Same font-race fix as renderChunkedPdf — wait for Outfit weights to
  // finish loading so html2pdf's internal html2canvas doesn't paint the
  // page with synthetic-bold fallback text.
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
  const targetSelector = rootEl.getAttribute("data-testid")
    ? `[data-testid="${rootEl.getAttribute("data-testid")}"]`
    : (rootEl.className ? `.${rootEl.className.split(" ")[0]}` : null);
  const measured = rootEl.scrollWidth || rootEl.offsetWidth || 0;
  const width = windowWidth || (measured >= 320 ? measured : 794);
  await html2pdf()
    .from(rootEl)
    .set({
      margin: marginMm,
      filename,
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#FFFFFF",
        windowWidth: width,
        onclone: (clonedDoc) => {
          if (bodyClass) clonedDoc.body.classList.add(bodyClass);
          if (!targetSelector) return;
          const clone = clonedDoc.querySelector(targetSelector);
          if (!clone) return;
          clone.remove();
          clonedDoc.body.appendChild(clone);
          const setImp = (n, k, v) => n.style.setProperty(k, v, "important");
          setImp(clone, "position", "static");
          setImp(clone, "left", "auto");
          setImp(clone, "top", "auto");
          setImp(clone, "display", "block");
          setImp(clone, "visibility", "visible");
          setImp(clone, "opacity", "1");
          setImp(clone, "transform", "none");
          setImp(clone, "width", `${width}px`);
          setImp(clone, "max-width", "none");
          setImp(clone, "height", "auto");
          setImp(clone, "max-height", "none");
          setImp(clone, "overflow", "visible");
          setImp(clone, "margin", "0");
          setImp(clone, "background", "#FFFFFF");
        },
      },
      jsPDF: { unit: "mm", format, orientation, compress: true },
      pagebreak: { mode: ["css", "avoid-all"] },
    })
    .save();
}
