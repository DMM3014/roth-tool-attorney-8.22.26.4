/**
 * Print blocks shared by the Client Report and the Presentation deck.
 *
 * All styling is inline (no Tailwind) because these render inside the print /
 * html2canvas pipelines used by both surfaces, and the DOCX walker reads the
 * computed DOM rather than class names.
 */

/**
 * HoldConstantBand — the baseline-vs-scenario discipline, made visually
 * persistent. Every comparative page states what was held identical and what
 * single input was changed, so a reader cannot mistakenly attribute an outcome
 * to something that never moved.
 */
export const HoldConstantBand = ({
  variable,
  constant = "spending, returns, longevity, beneficiary assumption",
  testid = "hold-constant-band",
  compact = false,
}) => (
  <div data-testid={testid}
       style={{ display: "flex", border: "1px solid #EBE8E0", borderRadius: 6, overflow: "hidden",
                marginBottom: compact ? 6 : 9 }}>
    <div style={{ flex: 1, padding: "5px 9px", background: "#F9F8F6", borderRight: "1px solid #EBE8E0" }}>
      <div style={{ fontSize: 7.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#8A8578", fontWeight: 700 }}>
        Constant in both scenarios
      </div>
      <div style={{ fontSize: 9.5, color: "#2A2A2A", lineHeight: 1.4 }}>{constant}</div>
    </div>
    <div style={{ flex: 1, padding: "5px 9px", background: "#4A67410D" }}>
      <div style={{ fontSize: 7.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741", fontWeight: 700 }}>
        Variable changed
      </div>
      <div style={{ fontSize: 9.5, color: "#1A1A1A", lineHeight: 1.4, fontWeight: 600 }}>{variable}</div>
    </div>
  </div>
);

/**
 * EstateThreeQuestions — estate planning, visual first. The three questions a
 * family actually asks, printed ahead of the flow diagram; the IRC mechanics
 * (DSUE, GST allocation, disclaimer timing) follow as advisor / attorney detail.
 */
export const EstateThreeQuestions = ({ testid = "estate-three-questions" }) => (
  <div data-testid={testid}
       style={{ border: "1px solid #EBE8E0", borderRadius: 8, background: "#F9F8F6",
                padding: "9px 12px", marginBottom: 9 }}>
    <div style={{ fontSize: 8, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741",
                  fontWeight: 700, marginBottom: 5 }}>
      Read every diagram on this page with three questions
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {[
        ["1", "Where does the asset go?", "Which person or trust ends up holding it"],
        ["2", "What tax characteristics are preserved or lost?", "Step-up, tax-free status, GST exemption"],
        ["3", "What flexibility does the surviving spouse retain?", "What can still be decided later"],
      ].map(([n, q, sub]) => (
        <div key={n} style={{ borderLeft: "2px solid #4A6741", paddingLeft: 7 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: "#1A1A1A", lineHeight: 1.35 }}>{q}</div>
          <div style={{ fontSize: 8.5, color: "#777", lineHeight: 1.35, marginTop: 1 }}>{sub}</div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * AdvisorDetailTag — marks a dense technical block (federal estate-tax
 * arithmetic, GST allocation) as advisor / attorney reference rather than
 * client conversation material.
 */
export const AdvisorDetailTag = ({ children = "Advisor & attorney detail", testid }) => (
  <span data-testid={testid}
        style={{ display: "inline-block", fontSize: 7.5, fontWeight: 700, letterSpacing: 0.5,
                 textTransform: "uppercase", color: "#8A5A20", background: "#FDF6EC",
                 border: "1px solid #E5B87A", borderRadius: 999, padding: "1px 7px" }}>
    {children}
  </span>
);

/**
 * BasisTradeoffCaveat — prints ONLY when the "Forgone 2nd step-up" line reads
 * ~$0 for every plan on the page. In that case two structures that differ
 * precisely in whether taxable assets are moved into a first-death trust look
 * numerically identical, and a reader can wrongly generalize that funding a
 * GST trust with taxable assets never costs a second basis step-up.
 */
export const BasisTradeoffCaveat = ({ plans = [], testid = "basis-tradeoff-caveat" }) => {
  const shown = (plans || []).filter(Boolean);
  if (shown.length < 2) return null;
  if (shown.some((p) => Math.abs(p.metrics?.forgone_step_up || 0) >= 1000)) return null;
  const nums = shown.map((p) => p.plan_no);
  const list = nums.length === 2
    ? `Plans ${nums[0]} and ${nums[1]}`
    : `Plans ${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
  return (
    <div data-testid={testid}
         style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #C4A64A", background: "#C4A64A14",
                  fontSize: 10, lineHeight: 1.55, color: "#1A1A1A" }}>
      <div style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: "uppercase",
                    color: "#8A6A12", fontWeight: 700, marginBottom: 3 }}>
        Why these columns look almost identical — scenario-specific
      </div>
      In this modeled scenario, little or no taxable brokerage remains at the relevant
      estate-planning point, so the usual second-basis-step-up tradeoff is not visible and the
      &ldquo;Forgone 2nd step-up&rdquo; line reads $0 under every structure shown. In another
      asset-growth or funding scenario, {list} could diverge materially. Read this table as
      specific to this projection — not as evidence that moving taxable assets into a
      first-death GST trust never creates a basis tradeoff.
    </div>
  );
};

/**
 * AppendixDividerBody — the content of the "Advisor & Technical Appendix"
 * divider. Wrapped in each surface's own <Page> so footers and page numbering
 * stay with the surface that owns them.
 */
export const AppendixDividerBody = ({ items = [], testid = "appendix-divider-body" }) => (
  <div data-testid={testid} style={{ paddingTop: 40 }}>
    <div style={{ borderTop: "3px solid #4A6741", borderBottom: "3px solid #4A6741", padding: "26px 0",
                  marginBottom: 22 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8A8578",
                    fontWeight: 700, marginBottom: 6 }}>
        End of the client conversation
      </div>
      <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 26, color: "#1A1A1A",
                    lineHeight: 1.1 }}>
        Advisor &amp; Technical Appendix
      </div>
    </div>
    <p style={{ fontSize: 11, lineHeight: 1.65, color: "#2A2A2A", marginBottom: 10 }}>
      Everything after this page is <strong>reference material</strong> — the arithmetic, statutory
      mechanics and full input record behind the pages you have just read. It is written for the advisor,
      the CPA and the estate-planning attorney, and it is deliberately dense. Nothing here introduces a
      new conclusion; it exists so any figure in the client pages can be traced back to a disclosed
      assumption and reproduced line by line.
    </p>
    {items.length > 0 && (
      <ul style={{ fontSize: 10.5, lineHeight: 1.75, color: "#2A2A2A", paddingLeft: 20, margin: 0 }}>
        {items.map((it) => <li key={it}>{it}</li>)}
      </ul>
    )}
    <p style={{ fontSize: 10, color: "#777", fontStyle: "italic", marginTop: 16 }}>
      A client meeting does not need these pages. They are included so the analysis can be checked rather
      than taken on trust.
    </p>
  </div>
);

/**
 * ObjectiveTensions — the classic conflicts between the objectives above,
 * stated plainly so the report reads as a trade-off study rather than a search
 * for one optimal answer.
 */
export const ObjectiveTensions = ({ testid = "objective-tensions" }) => (
  <div data-testid={testid} style={{ marginTop: 10 }}>
    <div style={{ fontSize: 8, letterSpacing: 0.5, textTransform: "uppercase", color: "#4A6741",
                  fontWeight: 700, marginBottom: 6 }}>
      Where these objectives pull against each other
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 9 }}>
      {[
        ["Lifetime tax vs basis step-up",
         "Converting pays tax now to remove it later. Taxable assets held until death have their gain erased entirely — so the asset you convert and the asset you hold are not interchangeable."],
        ["Children's inheritance vs survivor flexibility",
         "Locking a structure at the first death can maximize what eventually transfers while narrowing the choices left to the surviving spouse. Deferring decisions costs certainty but buys optionality."],
        ["Protection and control vs simplicity",
         "Trusts add creditor, divorce and spendthrift protection — and administration, trustee cost, and compressed tax brackets on retained income. Not every family wants that trade."],
      ].map(([title, body]) => (
        <div key={title} style={{ border: "1px solid #EBE8E0", borderRadius: 6, background: "#F9F8F6",
                                  padding: "7px 9px" }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: "#1A1A1A", lineHeight: 1.3, marginBottom: 3 }}>
            {title}
          </div>
          <div style={{ fontSize: 8.5, color: "#5A5A5A", lineHeight: 1.45 }}>{body}</div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * ObjectivesBody — "What are we planning for?" Shared by the Client Report page
 * and the deck slide so the two can never drift.
 */
export const ObjectivesBody = ({ objectives, priorities, priorityColor, all, testid = "objectives-body" }) => {
  const selected = Object.keys(objectives || {});
  const any = selected.length > 0;
  const label = (p) => (priorities.find((x) => x.key === p)?.label || "");
  return (
    <div data-testid={testid}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #4A6741", color: "#5A5A5A", textAlign: "left" }}>
            <th style={{ padding: "5px 4px", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.4, width: "34%" }}>
              Objective
            </th>
            <th style={{ padding: "5px 4px", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
              The family question behind it
            </th>
            <th style={{ padding: "5px 4px", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.4, width: "22%" }}>
              Where this report speaks to it
            </th>
            <th style={{ padding: "5px 4px", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.4,
                         width: "12%", textAlign: "right" }}>
              Priority
            </th>
          </tr>
        </thead>
        <tbody>
          {all.map((o) => {
            const p = objectives?.[o.key];
            const on = !!p;
            return (
              <tr key={o.key} data-testid={`objectives-row-${o.key}`}
                  style={{ borderBottom: "1px solid #F3F1EC",
                           background: on ? "#4A674108" : "transparent",
                           opacity: any && !on ? 0.55 : 1 }}>
                <td style={{ padding: "5px 4px", fontSize: 10, fontWeight: on ? 700 : 500, color: "#1A1A1A" }}>
                  {o.label}
                </td>
                <td style={{ padding: "5px 4px", fontSize: 9.5, color: "#2A2A2A", lineHeight: 1.4 }}>
                  {o.question}
                </td>
                <td style={{ padding: "5px 4px", fontSize: 8.5, color: "#777", lineHeight: 1.35 }}>
                  {o.evidence}
                </td>
                <td style={{ padding: "5px 4px", fontSize: 9, textAlign: "right", fontWeight: 700,
                             color: on ? priorityColor[p] : "#B8B4A8" }}>
                  {on ? label(p) : "To discuss"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
