// Presentation chart wrapper — replaces the repeated
//   <div style={{ minHeight: X, marginTop: 4, marginBottom: 14 }}>{chart}</div>
// pattern that appeared 6+ times in Presentation.jsx. Centralising it here
// prevents the vertical-spacing drift bug that landed on advisors' clients:
// when a new page was added and the author forgot the `minHeight + margin`
// combo, the Sub caption overlapped the chart legend.
//
// Now also serves as the export point for chart data — pass `exportData`
// (array of flat records) + `exportFilename` (stem) and the wrapper renders
// small CSV / Excel buttons in the top-right that download the underlying
// series. Both buttons are `print:hidden` so they don't leak into the
// generated client PDF.
//
// Props:
//   minHeight       — CSS minHeight (px). Default 420 = plenty of room for
//                     Panel title + subtitle + 280px chart body + legend +
//                     Sub caption.
//   testid          — data-testid attribute for the wrapper.
//   exportData      — optional array of records that back the chart.
//   exportFilename  — optional filename stem (no extension).
//   children        — the chart component (typically a Panel-wrapped chart
//                     from AnalyticsCharts.jsx).
import ExportChip from "./ExportChip";

const ChartCard = ({ minHeight = 420, testid, exportData, exportFilename, children }) => {
  const canExport = Array.isArray(exportData) && exportData.length > 0 && !!exportFilename;
  return (
    <div style={{ minHeight, marginTop: 4, marginBottom: 14 }}
         data-testid={testid}
         className="relative">
      {canExport && (
        <div className="absolute top-3 right-3 z-20">
          <ExportChip data={exportData} filename={exportFilename} testid={testid} />
        </div>
      )}
      {children}
    </div>
  );
};

export default ChartCard;
