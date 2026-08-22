"""Market Scenario preset & engine-integration tests.

Snapshot guarantee: historical_avg (or no market_scenario at all) MUST reproduce
the default projection output to the penny — otherwise the 213 V17-alignment
tests would drift. Other presets must produce meaningfully-different lifetime
tax and heirs-value numbers to prove they actually flow into the engine.
"""
import copy
import pytest

from defaults import DEFAULT_SCENARIO
from market_scenarios import PRESETS, apply_market_scenario, list_presets
from projection import run_projection


# --------------------------------------------------------------------------- #
# Preset library structural checks                                            #
# --------------------------------------------------------------------------- #

def test_preset_library_shape():
    presets = list_presets()
    ids = {p["id"] for p in presets}
    # V1 ships these 6 canonical regimes plus 'custom'
    assert ids >= {"historical_avg", "last_50_years", "70s_stagflation", "lost_decade",
                   "high_inflation", "low_return", "custom"}
    for p in presets:
        assert "id" in p and "label" in p and "description" in p


def test_last_50_years_preset_matches_docs():
    """The Last 50 Years preset uses 1975–2024 US market averages:
    S&P 500 ~11.5%, T-Bills ~4.3%, CPI ~3.7%. Locks in the numbers we quote to
    advisors in the description so we can't silently drift them later."""
    p = next(x for x in list_presets() if x["id"] == "last_50_years")
    ov = p["overrides"]
    assert ov["general_inflation"] == 0.037
    assert ov["cash_return"] == 0.043
    assert ov["taxable_return"] == 0.115
    assert ov["ira_return"] == 0.115
    assert ov["roth_return"] == 0.115


def test_last_50_years_produces_higher_legacy_than_baseline():
    """Nominal ending net worth and after-tax legacy must be materially HIGHER
    under Last-50-Years than under Long-term-Average (11.5% return vs 7%)."""
    base = run_projection(DEFAULT_SCENARIO)
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": "last_50_years"}
    hot = run_projection(scn)
    assert hot["summary"]["ending_net_worth"] > base["summary"]["ending_net_worth"]
    assert hot["legacy"]["after_tax_estate_to_heirs"] > base["legacy"]["after_tax_estate_to_heirs"]


def test_custom_preset_is_no_op():
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": "custom"}
    # Deep-copy check so we can compare AFTER apply
    original = copy.deepcopy(scn)
    out = apply_market_scenario(scn)
    # Should return an unmodified copy (or the same dict); either way, contents match
    assert out["projection"] == original["projection"]
    for a_before, a_after in zip(original["accounts"], out["accounts"]):
        assert a_before["return"] == a_after["return"]


def test_unknown_id_falls_back_gracefully():
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": "not_a_real_preset"}
    out = apply_market_scenario(scn)
    # Unknown id -> silent no-op (no exception, no changes)
    assert out["projection"]["general_inflation"] == scn["projection"]["general_inflation"]


# --------------------------------------------------------------------------- #
# Snapshot: historical_avg reproduces the default output                       #
# --------------------------------------------------------------------------- #

def test_historical_avg_matches_baseline_to_the_penny():
    """historical_avg preset overrides == default scenario values, so applying
    it must NOT change any output. This locks in the invariant so all 213
    existing pytest cases stay green when the market_scenario feature ships."""
    base = run_projection(DEFAULT_SCENARIO)

    scn_hist = copy.deepcopy(DEFAULT_SCENARIO)
    scn_hist["market_scenario"] = {"id": "historical_avg"}
    hist = run_projection(scn_hist)

    assert hist["summary"]["lifetime_taxes"] == base["summary"]["lifetime_taxes"]
    assert hist["summary"]["ending_net_worth"] == base["summary"]["ending_net_worth"]
    assert hist["summary"]["total_roth_converted"] == base["summary"]["total_roth_converted"]
    assert hist["legacy"]["after_tax_estate_to_heirs"] == base["legacy"]["after_tax_estate_to_heirs"]


# --------------------------------------------------------------------------- #
# Non-default presets: engine wire-up proof                                    #
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("preset_id", ["last_50_years", "70s_stagflation", "lost_decade",
                                       "high_inflation", "low_return"])
def test_non_default_preset_alters_headline_numbers(preset_id):
    """Every non-default preset MUST produce a meaningfully different lifetime
    tax bill AND a different after-tax-legacy vs. the historical baseline —
    proves the overrides actually flow through the engine, not just get logged."""
    base = run_projection(DEFAULT_SCENARIO)
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": preset_id}
    alt = run_projection(scn)

    d_tax = abs(alt["summary"]["lifetime_taxes"] - base["summary"]["lifetime_taxes"])
    d_leg = abs(alt["legacy"]["after_tax_estate_to_heirs"]
                - base["legacy"]["after_tax_estate_to_heirs"])
    # A >$50k swing on either metric is a low bar the engine easily passes;
    # this is a "did it flow through?" gate, not a precise value check.
    assert d_tax > 50_000, f"{preset_id} left lifetime taxes unchanged (Δ=${d_tax:,.0f})"
    assert d_leg > 50_000, f"{preset_id} left after-tax legacy unchanged (Δ=${d_leg:,.0f})"


def test_stagflation_shifts_directionally_sensibly():
    """1970s stagflation: real return of ~5.5% is well below the ~7% baseline,
    so over the ~35-year plan the compounded ending nominal net worth must be
    LOWER than the historical baseline (the higher CPI does NOT compensate for
    the lower equity return over this horizon). This is the direction that
    proves the return-override half of the preset is wired to the engine — the
    inflation half is already checked by test_inflation_family_mirrors_general_inflation."""
    base = run_projection(DEFAULT_SCENARIO)
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": "70s_stagflation"}
    stag = run_projection(scn)
    assert stag["summary"]["ending_net_worth"] < base["summary"]["ending_net_worth"]


def test_low_return_reduces_ending_net_worth():
    """Bogle 4% preset: markedly lower ending net worth vs 7% historical baseline."""
    base = run_projection(DEFAULT_SCENARIO)
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": "low_return"}
    low = run_projection(scn)
    assert low["summary"]["ending_net_worth"] < base["summary"]["ending_net_worth"]


# --------------------------------------------------------------------------- #
# Override key mapping                                                         #
# --------------------------------------------------------------------------- #

def test_overrides_apply_by_account_tax_type():
    """taxable_return should only touch Taxable accounts, cash_return only Cash, etc."""
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": "lost_decade"}
    out = apply_market_scenario(scn)
    ov = PRESETS["lost_decade"]["overrides"]

    key = {"Cash": "cash_return", "Taxable": "taxable_return",
           "Tax-Deferred": "ira_return", "Tax-Free": "roth_return"}
    for a in out["accounts"]:
        expected = ov.get(key.get(a["tax_type"], ""))
        if expected is not None:
            assert a["return"] == expected, (
                f"{a['id']} ({a['tax_type']}) return {a['return']} != preset {expected}"
            )


def test_inflation_family_mirrors_general_inflation():
    """When we boost general_inflation, bracket & IRMAA indexing must track it
    (otherwise stagflation would silently under-index the brackets)."""
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": "high_inflation"}
    out = apply_market_scenario(scn)
    expected = PRESETS["high_inflation"]["overrides"]["general_inflation"]
    assert out["projection"]["general_inflation"] == expected
    assert out["projection"]["bracket_indexing"] >= expected
    assert out["projection"]["irmaa_indexing"] >= expected


def test_apply_does_not_mutate_input_scenario():
    """apply_market_scenario returns a deep copy — the caller's dict is untouched.
    This is important because the frontend sends the same scenario to multiple
    endpoints and expects it to be immutable."""
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["market_scenario"] = {"id": "70s_stagflation"}
    original_infl = scn["projection"]["general_inflation"]
    _ = apply_market_scenario(scn)
    assert scn["projection"]["general_inflation"] == original_infl
