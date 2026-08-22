/**
 * Planning objectives — "What are we planning for?"
 *
 * The competing family objectives a Roth-conversion / estate conversation
 * actually turns on. Printed BEFORE any conversion arithmetic so every
 * quantitative page that follows reads as evidence relevant to a stated
 * objective rather than as evidence for a predetermined solution.
 *
 * Stored on the scenario (`scenario.planning_objectives`) as a flat map of
 * `{ [key]: "high" | "medium" | "watch" }` so the selection travels with a
 * shared plan instead of living in one advisor's browser.
 */
export const PRIORITIES = [
  { key: "high", label: "High", blurb: "A stated priority for this family" },
  { key: "medium", label: "Medium", blurb: "Matters, but not decisive" },
  { key: "watch", label: "Watch", blurb: "Not a priority today — revisit" },
];

export const PRIORITY_COLOR = {
  high: "#4A6741",
  medium: "#C4A64A",
  watch: "#8A8578",
};

export const OBJECTIVES = [
  {
    key: "lifetime_security",
    label: "Lifetime retirement security",
    question: "Will the money last for both of us, in any market?",
    evidence: "Monte Carlo, market-regime and cash-flow pages",
  },
  {
    key: "survivor_flexibility",
    label: "Flexibility for the surviving spouse",
    question: "Does the survivor keep choices — including the choice to do nothing?",
    evidence: "Widow-bracket discussion, estate structure pages",
  },
  {
    key: "lifetime_tax",
    label: "Minimizing unnecessary lifetime tax",
    question: "Are we paying tax at rates we would not have to pay?",
    evidence: "Tax pages, bracket snapshots, conversion schedule",
  },
  {
    key: "children",
    label: "Preserving assets for children",
    question: "What actually reaches our children, after their tax?",
    evidence: "Two-milestone comparison, legacy pages",
  },
  {
    key: "later_generations",
    label: "Protecting assets for grandchildren and later generations",
    question: "Do we want this to skip a generation, and at what cost?",
    evidence: "Estate structure pages (GST allocation)",
  },
  {
    key: "basis_step_up",
    label: "Basis step-up",
    question: "Which assets are worth holding until death untouched?",
    evidence: "Basis step-up page, funding-order pages",
  },
  {
    key: "creditor_protection",
    label: "Creditor, divorce and spendthrift protection",
    question: "Does an inheritance need protecting from events, not just tax?",
    evidence: "Estate structure pages (trust variants)",
  },
  {
    key: "simplicity",
    label: "Simplicity and control",
    question: "How much complexity is this family willing to administer?",
    evidence: "Estate structure comparison, conversion schedule",
  },
  {
    key: "charitable",
    label: "Charitable goals",
    question: "Is any part of the pre-tax balance destined for charity at 0%?",
    evidence: "Legacy pages, QCD assumptions in the appendix",
  },
  {
    key: "adaptability",
    label: "Flexibility if family circumstances change",
    question: "What decisions can we defer instead of locking in now?",
    evidence: "Disclaimer-trust optionality, annual-review considerations",
  },
];

export const OBJECTIVES_BY_KEY = Object.fromEntries(OBJECTIVES.map((o) => [o.key, o]));

// Normalize whatever is on the scenario into a clean {key: priority} map.
export const readObjectives = (scenario) => {
  const raw = scenario?.planning_objectives;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const valid = new Set(PRIORITIES.map((p) => p.key));
  const out = {};
  OBJECTIVES.forEach((o) => {
    const v = raw[o.key];
    if (typeof v === "string" && valid.has(v)) out[o.key] = v;
  });
  return out;
};

export const hasSelections = (map) => Object.keys(map || {}).length > 0;
