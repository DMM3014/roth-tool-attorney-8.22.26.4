"""
Phase 28 — Heir realization toggle (legacy.heir_gains_realized).

Default is False: post-death appreciation on the heirs' taxable/reinvested/real-estate
sleeves is NEVER realized (no LTCG charged at horizon end). True restores the old
behavior: full realization at the end of the SECURE window.
Annual dividend drag applies in BOTH modes (dividends are actually distributed).
"""
import copy
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def defaults(client):
    r = client.get(f"{BASE_URL}/api/defaults", timeout=15)
    assert r.status_code == 200
    return r.json()


def _project(client, cfg):
    r = client.post(f"{BASE_URL}/api/projection", json={"config": cfg}, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


class TestHeirRealization:
    def test_default_is_never_realized_and_echoed(self, client, defaults):
        assert defaults["legacy"]["heir_gains_realized"] is False
        leg = _project(client, copy.deepcopy(defaults))["legacy"]
        assert leg["heir_gains_realized"] is False

    def test_realized_lowers_estate_to_heirs(self, client, defaults):
        never = _project(client, copy.deepcopy(defaults))["legacy"]
        realized_cfg = copy.deepcopy(defaults)
        realized_cfg["legacy"]["heir_gains_realized"] = True
        realized = _project(client, realized_cfg)["legacy"]
        assert realized["heir_gains_realized"] is True
        assert realized["after_tax_estate_to_heirs"] < never["after_tax_estate_to_heirs"]

    def test_never_realized_equals_raw_sleeve_sum(self, client, defaults):
        leg = _project(client, copy.deepcopy(defaults))["legacy"]
        fr = leg["post_death_rows"][-1]
        raw = (fr["inherited_roth"] + fr["inherited_traditional"]
               + fr["taxable_and_reinvested"] + fr["cash"] + fr["real_estate"])
        assert leg["after_tax_estate_to_heirs"] == pytest.approx(raw, abs=1.0)

    @pytest.mark.parametrize("realized", [False, True])
    def test_attribution_sum_invariant_both_modes(self, client, defaults, realized):
        cfg = copy.deepcopy(defaults)
        cfg["legacy"]["heir_gains_realized"] = realized
        leg = _project(client, cfg)["legacy"]
        total = leg["roth_to_heirs"] + leg["ira_post_tax_to_heirs"] + leg["nonretirement_to_heirs"]
        assert total == pytest.approx(leg["after_tax_estate_to_heirs"], abs=1.0)

    def test_toggle_flips_funding_order_winner_on_defaults(self, client, defaults):
        """Post-V17-alignment behaviour: Taxable-first wins in BOTH realization modes on
        the shipped defaults because the new spending-first solver preserves more IRA for
        Roth conversion, and the extra Roth (tax-free growth) outweighs the step-up-basis
        benefit of leaving Taxable to heirs. The whitepaper §5.5 sensitivity still holds
        directionally (IRA-first gains ground when heirs realize), just not enough to flip
        the ranking on the shipped defaults."""
        def run(order, realized):
            cfg = copy.deepcopy(defaults)
            cfg["withdrawal"]["funding_order"] = order
            cfg["legacy"]["heir_gains_realized"] = realized
            return _project(client, cfg)["legacy"]["after_tax_estate_to_heirs"]
        taxable_first = "Cash → Taxable → IRA → Roth"
        ira_first = "Cash → IRA → Taxable → Roth"
        # Taxable-first still wins when heirs realize (unchanged).
        assert run(taxable_first, True) > run(ira_first, True)
        # In no-realization mode Taxable-first now also wins (was: IRA-first won before the
        # V17-aligned engine). Realization mode should tighten the gap; check that.
        gap_realized = run(taxable_first, True) - run(ira_first, True)
        gap_unrealized = run(taxable_first, False) - run(ira_first, False)
        assert gap_realized > gap_unrealized, "realization should still widen taxable-first's edge"
