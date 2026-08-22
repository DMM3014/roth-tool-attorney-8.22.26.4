"""Beneficiary tax-rate sensitivity (Legacy page) — engine-level tests.

The heirs' ordinary marginal rate feeds ONLY the post-death SECURE-10 horizon, so:
  * the parents' projection must be identical across the whole rate band, and
  * with a fully converted Traditional IRA the heir rate stops mattering.
"""
import copy

from defaults import DEFAULT_SCENARIO
from projection import DEFAULT_HEIR_SENS_RATES, heir_rate_sensitivity


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


class TestHeirRateSensitivity:
    def test_shape_and_modeled_rate_included(self):
        res = heir_rate_sensitivity(_cfg())
        modeled = round(DEFAULT_SCENARIO["legacy"]["heir_federal_rate"]
                        + DEFAULT_SCENARIO["legacy"]["heir_state_rate"], 4)
        assert res["modeled_rate"] == modeled
        # The modeled rate is always present alongside the low/middle/high band.
        for r in DEFAULT_HEIR_SENS_RATES:
            assert r in res["rates"]
        assert modeled in res["rates"]
        for branch in ("with_conversions", "no_conversions"):
            entries = res["branches"][branch]
            assert len(entries) == len(res["rates"])
            assert sum(1 for e in entries if e["is_modeled"]) == 1
            for e in entries:
                assert e["after_tax_estate_to_heirs"] > 0

    def test_higher_heir_rate_shrinks_inheritance_without_conversions(self):
        res = heir_rate_sensitivity(_cfg(), [0.12, 0.24, 0.40])
        no_conv = {e["rate"]: e for e in res["branches"]["no_conversions"]}
        assert no_conv[0.12]["after_tax_estate_to_heirs"] > no_conv[0.24]["after_tax_estate_to_heirs"]
        assert no_conv[0.24]["after_tax_estate_to_heirs"] > no_conv[0.40]["after_tax_estate_to_heirs"]
        assert no_conv[0.12]["inherited_ira_tax"] < no_conv[0.40]["inherited_ira_tax"]

    def test_parents_projection_unchanged_across_band(self):
        res = heir_rate_sensitivity(_cfg(), [0.12, 0.40])
        # Lifetime taxes are a parents-only figure: one number per branch, not per rate.
        assert res["lifetime_taxes"]["no_conversions"] > res["lifetime_taxes"]["with_conversions"]

    def test_full_conversion_removes_heir_rate_exposure(self):
        # The default plan converts the Traditional IRA in full, so the heirs
        # inherit no pre-tax IRA and their rate cannot touch the inheritance.
        res = heir_rate_sensitivity(_cfg(), [0.12, 0.40])
        with_conv = res["branches"]["with_conversions"]
        assert all(e["inherited_ira_tax"] == 0 for e in with_conv)
        vals = {round(e["after_tax_estate_to_heirs"], 2) for e in with_conv}
        assert len(vals) == 1

    def test_rates_are_clamped_and_deduped(self):
        res = heir_rate_sensitivity(_cfg(), [0.20, 0.20, 5.0, -1.0])
        assert res["rates"] == sorted(set(res["rates"]))
        assert all(0.0 <= r <= 0.6 for r in res["rates"])
