import { Page, H2, P, Sub } from "./helpers";

// Renders a LAW figure value (number / array / nested object) as readable text.
const fmtVal = (v) => {
  if (v == null) return "—";
  if (typeof v === "number") {
    return Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);
  }
  if (Array.isArray(v)) return v.map(fmtVal).join(", ");
  if (typeof v === "object") {
    return Object.entries(v)
      .map(([k, val]) => `${k.replace(/_/g, " ")}: ${fmtVal(val)}`)
      .join("; ");
  }
  return String(v);
};

// Optional final appendix: "Statutory Figures & Authorities" — a table of every
// statutory constant the engine uses, with the value applied, indexing assumption,
// and legal citation. Sourced from the backend single source of truth (LAW dict).
export const StatutoryFiguresPage = ({ law, ...footProps }) => {
  const figures = law?.figures || {};
  const rows = Object.values(figures);

  const th = {
    padding: "5px 8px", textAlign: "left", background: "#F9F8F6",
    borderBottom: "1.5px solid #4A6741", fontSize: 9, verticalAlign: "bottom",
  };
  const td = { padding: "4px 8px", textAlign: "left", fontSize: 8.5, verticalAlign: "top", borderBottom: "0.5px solid #EDEBE4" };

  return (
    <Page testid="cr-page-statutory-figures" {...footProps}>
      <H2>Statutory Figures &amp; Authorities</H2>
      <P>
        Every rate, threshold, and exclusion used in this illustration is drawn from the single set of statutory
        figures below (tax law as of {law?.LAW_AS_OF || "—"}). Figures marked as indexed are projected forward
        using the plan inflation assumption; figures fixed by statute are held constant.
      </P>

      <table data-testid="cr-statutory-table"
        style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, marginBottom: 10, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ ...th, width: "26%" }}>Figure</th>
            <th style={{ ...th, width: "34%" }}>Value used</th>
            <th style={{ ...th, width: "20%" }}>Indexing assumption</th>
            <th style={{ ...th, width: "20%" }}>Citation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ ...td, fontWeight: 600, color: "#1A1A1A" }}>{r.label}</td>
              <td style={{ ...td, color: "#1A1A1A", wordBreak: "break-word" }}>{fmtVal(r.value)}</td>
              <td style={{ ...td, color: "#5A5A5A" }}>{r.indexing}</td>
              <td style={{ ...td, color: "#5A5A5A" }}>{r.citation}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Sub>
        Citations reference the Internal Revenue Code (IRC) and, for Medicare IRMAA, Title 42 of the U.S. Code.
        Reflects the {law?.LAW_AS_OF || "current"}. This appendix is provided for transparency and is not legal or
        tax advice; confirm current figures against primary sources before relying on them.
      </Sub>
    </Page>
  );
};

export default StatutoryFiguresPage;
