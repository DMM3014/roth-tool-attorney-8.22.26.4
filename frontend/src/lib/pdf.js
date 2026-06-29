import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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
