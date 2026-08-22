"""
Focused bug verification plan for PDF download/print-dialog regression.

User-reported bug:
  On preview environment, clicking 'Download PDF' on the White Paper tab and
  'Generate PDF' on the Presentation tab does nothing — no PDF is downloaded,
  no browser print dialog opens.

Affected flow:
  Master login (PIN 140431) -> White Paper tab PDF download -> Presentation tab
  PDF generation/download.

No relevant testing skill found for PDF download/window.print/preview iframe.

Code inspected:
  /app/frontend/src/lib/pdf.js
  /app/frontend/src/components/WhitePaper.jsx
  /app/frontend/src/components/Presentation.jsx
  /app/frontend/src/index.css
  package.json dependency additions for html2pdf/html2canvas/jsPDF.

Direct proof needed:
  - White Paper button exists and triggers a browser download named
    roth-conversion-white-paper.pdf.
  - Presentation Generate PDF button becomes enabled and triggers a browser
    download named client-roth-plan.pdf.
  - Both downloaded files start with %PDF- and are >100 KB.
  - No console errors, no page navigation, body classes are cleaned up.
  - Presentation preview scale briefly changes to 100% and returns to 70%.

Important edge cases:
  - Fresh browser context, no persisted auth/branding state.
  - Run inside the Emergent preview URL, not only standalone localhost.
  - Button loading states must recover after generation.
"""
