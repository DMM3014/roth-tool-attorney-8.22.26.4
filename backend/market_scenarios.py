"""Named market scenarios — a *deterministic* what-if lens on the projection engine.

The user picks a preset (Historical Average / 1970s Stagflation / Lost Decade /
Persistent 5% Inflation / Permanently Lower Returns) and the engine reruns the
same conversion plan under a different set of return + inflation assumptions.

Distinct from Monte Carlo: Monte Carlo is stochastic RISK (thousands of paths).
Market scenarios are a fixed alternate ASSUMPTION set — one number per input, per
regime — so the deterministic result table itself shifts, and the advisor can talk
through "here's what your plan looks like if we're in a 1970s-style decade" without
handing the client a probability distribution.

# How the override is applied
`scenario.market_scenario.id` selects a preset by key. When applied, its
`overrides` dict rewrites:
  - `scenario.projection.general_inflation` (also mirrors into bracket_indexing +
    irmaa_indexing so the tax brackets track the assumed CPI — otherwise a
    stagflation regime would silently under-index the brackets and inflate the
    tax hit unrealistically)
  - `scenario.accounts[*].return` — mapped BY TAX-TYPE so Cash accounts get the
    cash rate, Tax-Deferred + Tax-Free get the "equity" rate, Taxable gets the
    taxable rate. Individual accounts keep any custom return set by the user
    ONLY if the scenario preset id is `custom` (i.e. do not touch).

The `custom` id is a special no-op passthrough — it just labels the user's
current inputs as "custom" for display purposes.

# Snapshot guarantee
The `historical_avg` preset MUST reproduce the default-scenario projection to the
penny (accounts return 0.07 / cash 0.03, general_inflation 0.03). A regression
test locks this in so the 213 existing pytest cases stay green.
"""
from __future__ import annotations
import copy

# --- Preset library --------------------------------------------------------

# Each preset ships ONE flat set of overrides. Return_path (year-by-year sequences
# from Robert Shiller / Ibbotson data) is a follow-up feature — flat regime
# averages already tell the story for V1.
PRESETS = {
    "historical_avg": {
        "label": "Long-term Average (1928+)",
        "description": (
            "Long-run US average since 1928 (~100 years): ~7% real return on stocks, "
            "~3% cash, ~3% CPI. The most conservative default and the one most CFPs use "
            "for retirement planning — this reproduces the app's baseline projection."
        ),
        "overrides": {
            "general_inflation": 0.03,
            "cash_return": 0.03,
            "taxable_return": 0.07,
            "ira_return": 0.07,
            "roth_return": 0.07,
        },
    },
    "last_50_years": {
        "label": "Last 50 Years (1975–2024)",
        "description": (
            "The last 50-year window (favorably starts after the 1973–74 bear): S&P 500 "
            "total return CAGR ~11.5%, 3-month T-Bills ~4.3%, CPI ~3.7%. More cheerful "
            "than the long-run average — most of the equity outperformance came from a "
            "one-time P/E multiple expansion during 1982–2000 that may not repeat."
        ),
        "overrides": {
            "general_inflation": 0.037,
            "cash_return": 0.043,
            "taxable_return": 0.115,
            "ira_return": 0.115,
            "roth_return": 0.115,
        },
    },
    "70s_stagflation": {
        "label": "1970s Stagflation",
        "description": (
            "Replay of the 1973–1982 climate: high inflation, cash rates lag CPI, "
            "equities post low real returns, tax brackets scramble to keep up."
        ),
        "overrides": {
            "general_inflation": 0.075,
            "cash_return": 0.06,
            "taxable_return": 0.055,
            "ira_return": 0.055,
            "roth_return": 0.055,
        },
    },
    "lost_decade": {
        "label": "Lost Decade (2000–2009)",
        "description": (
            "Two crashes bookending a flat decade for equities. Low inflation, "
            "low cash rates, and a nominal ~1%/yr equity return."
        ),
        "overrides": {
            "general_inflation": 0.024,
            "cash_return": 0.02,
            "taxable_return": 0.015,
            "ira_return": 0.015,
            "roth_return": 0.015,
        },
    },
    "high_inflation": {
        "label": "Persistent 5% Inflation",
        "description": (
            "Elevated but not extreme CPI, with returns barely keeping up. Stress "
            "test for real purchasing power and IRMAA / bracket drift."
        ),
        "overrides": {
            "general_inflation": 0.05,
            "cash_return": 0.045,
            "taxable_return": 0.065,
            "ira_return": 0.065,
            "roth_return": 0.065,
        },
    },
    "low_return": {
        "label": "Permanently Lower Returns (Bogle 4%)",
        "description": (
            "Bogle's 'reasonable expectations' — 4% nominal equity, low inflation. "
            "Nothing catastrophic happens, everything just compounds more slowly."
        ),
        "overrides": {
            "general_inflation": 0.02,
            "cash_return": 0.015,
            "taxable_return": 0.04,
            "ira_return": 0.04,
            "roth_return": 0.04,
        },
    },
    "custom": {
        "label": "Custom (user inputs)",
        "description": (
            "Whatever growth rates and inflation are set in Plan Inputs. Selecting "
            "this preset does not modify anything — it just labels the current inputs."
        ),
        "overrides": None,  # sentinel: do not override
    },
}

DEFAULT_ID = "historical_avg"


def list_presets():
    """Return the presets library serialized for the frontend selector."""
    return [
        {"id": pid, "label": p["label"], "description": p["description"],
         "overrides": p["overrides"]}
        for pid, p in PRESETS.items()
    ]


# Map account tax_type → override key
_TAX_TYPE_TO_KEY = {
    "Cash": "cash_return",
    "Taxable": "taxable_return",
    "Tax-Deferred": "ira_return",
    "Tax-Free": "roth_return",
    # "Real Estate" is left untouched — it's usually a residence and not a
    # market-linked asset in the projection.
}


def apply_market_scenario(scenario: dict) -> dict:
    """If scenario['market_scenario']['id'] names a preset (and is not 'custom'),
    apply that preset's overrides in place to a DEEP COPY and return the new dict.

    Returns the scenario unchanged when:
      - no market_scenario block is present, OR
      - id is missing / unknown / "custom", OR
      - overrides is None (custom preset).

    Never raises on unknown ids — bad data falls back to the user's inputs.
    """
    ms = (scenario or {}).get("market_scenario")
    if not ms:
        return scenario
    pid = ms.get("id")
    preset = PRESETS.get(pid) if pid else None
    if not preset or preset["overrides"] is None:
        return scenario

    ov = preset["overrides"]
    out = copy.deepcopy(scenario)

    # 1) Inflation family — mirror general_inflation into bracket + IRMAA indexing
    #    so tax brackets track the assumed CPI. Users who set explicit indexing
    #    values above the general rate keep the higher of the two.
    proj = out.setdefault("projection", {})
    infl = ov["general_inflation"]
    proj["general_inflation"] = infl
    proj["bracket_indexing"] = max(proj.get("bracket_indexing", 0.0), infl)
    proj["irmaa_indexing"] = max(proj.get("irmaa_indexing", 0.0), infl)

    # 2) Per-account returns by tax_type
    for a in out.get("accounts", []) or []:
        key = _TAX_TYPE_TO_KEY.get(a.get("tax_type"))
        if key and key in ov:
            a["return"] = ov[key]

    return out
