/**
 * deckPages — the Client Deck page manifest.
 *
 * The curated deck used to be a fixed short list expressed as scattered
 * `!curated` gates. The advisor now ticks exactly which pages print, so the
 * manifest lives here and both the picker UI and the deck body read from it.
 *
 * `src` tells the picker where a row's state lives:
 *   "deck"       — this module's own selection map (persisted per browser)
 *   "branding"   — an existing presentation_branding_v1 flag (shared with the
 *                  full Presentation deck, so one control, not two)
 *   "objectives" — the shared useObjectivesPage switch (also drives the report)
 */
export const DECK_PAGES = [
  { key: "summary", label: "Executive summary", src: "deck" },
  { key: "assumptions", label: "Assumptions", src: "branding", flag: "include_assumptions" },
  { key: "objectives", label: "What are we planning for? (family objectives)", src: "objectives" },
  { key: "convert_skip", label: "Convert or don't convert — the verdict", src: "deck" },
  { key: "income", label: "Sources of income and spending", src: "deck" },
  { key: "wealth", label: "Total household wealth over time", src: "deck" },
  { key: "composition", label: "Where the money lives — account composition", src: "deck" },
  { key: "account_values", label: "Account values by year", src: "deck" },
  { key: "conversions", label: "The Roth conversion schedule", src: "deck" },
  { key: "tax", label: "What this strategy costs in tax", src: "deck" },
  { key: "legacy", label: "What your heirs receive", src: "deck" },
  { key: "estate", label: "Estate structures — one page, side by side", src: "deck",
    hint: "Uses the plans selected on the EP Flowchart tab",
    missingHint: "Waiting for the estate projection to finish" },
  {
    key: "robustness", label: "Robustness — market-crash stress test",
    src: "branding", flag: "include_robustness",
    missingHint: "Run the stress test on the Strategy Analyzer tab first",
  },
  {
    key: "regimes", label: "Six market futures — regime comparison",
    src: "branding", flag: "include_regimes",
    missingHint: "Run the Regime Comparison on the Monte Carlo tab first",
  },
  {
    key: "sequence_risk", label: "Sequence of returns — early / late bear + volatile paths",
    src: "branding", flag: "include_sequence_risk",
    missingHint: "Run the stress test on the Sequence Risk tab first",
  },
  { key: "longevity", label: "Longevity trade-off grid", src: "branding", flag: "include_longevity" },
  { key: "beneficiary_band", label: "Beneficiary tax-rate band", src: "branding", flag: "include_beneficiary_band" },
  {
    key: "two_way", label: "Two-way sensitivity — heir rate × market regime",
    src: "branding", flag: "include_two_way",
    missingHint: "Computing the heir-rate × regime surface — try again in a moment",
  },
  {
    key: "recs", label: "Planning considerations + perspective & caveats",
    src: "branding", flag: "include_recommendations", hint: "Prints as two pages",
  },
];

// Pages whose on/off state is owned by this module (everything else maps onto an
// existing advisor toggle).
export const DECK_CONTENT_KEYS = DECK_PAGES.filter((p) => p.src === "deck").map((p) => p.key);

// The short deck the advisor asked for originally — the starting point that the
// picker then lets them add to or trim.
export const DECK_DEFAULTS = {
  summary: true,
  convert_skip: true,
  income: false,
  wealth: true,
  composition: false,
  account_values: false,
  conversions: true,
  tax: false,
  legacy: true,
  estate: true,
};

// Always printed, listed in the picker as fixed rows so the advisor can see the
// full deck at a glance.
export const DECK_FIXED_PAGES = ["Cover", "Methodology & disclosures"];

// Rows that print more than one page, so the picker's counter matches reality.
export const DECK_PAGE_SPAN = { recs: 2 };
