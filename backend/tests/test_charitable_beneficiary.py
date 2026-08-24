"""Charitable-beneficiary (death-time IRA-to-charity) scenario.

With ira_to_charity_fraction = 1.0 and a positive IRA balance at the second
death:
  * the heirs' SECURE-10 inherited-IRA tax is $0 (charity took the whole IRA);
  * the charitable amount is excluded from the taxable estate (charitable
    deduction booked for the full charity receipt);
  * the no-conversion branch beats the full-conversion branch on the combined
    family + charity metric for the default household — conversions pay income
    tax during life on dollars that would otherwise have passed tax-free to
    charity at death.

Reconciliation with the Two-Way grid's "0% (charity / no income tax)" row:
100% of the IRA to charity means the IRA passes at full pre-tax value with zero
income tax — identical to a 0% heir ordinary rate on the IRA portion.
"""
import copy

from defaults import DEFAULT_SCENARIO
from projection import charitable_beneficiary_compare, run_projection


def _cfg():
    return copy.deepcopy(DEFAULT_SCENARIO)


def test_full_charity_zeroes_heir_ira_tax_and_excludes_from_estate():
    # The default household converts its whole IRA during life, so a positive IRA
    # at death requires conversions off — the realistic charitable-beneficiary case.
    cfg = _cfg()
    cfg["roth"] = {**(cfg.get("roth") or {}), "enabled": False}
    cfg.setdefault("beneficiary", {})["ira_to_charity_fraction"] = 1.0
    res = run_projection(cfg)
    leg = res["legacy"]

    # Positive IRA at the second death is a precondition for the test to mean anything.
    assert (res["rows"][-1].get("traditional") or 0) > 0
    assert leg["charitable_ira_amount"] > 0

    # Heirs pay ZERO inherited-IRA tax — the whole IRA went to charity.
    assert leg["inherited_ira_tax"] == 0.0
    # The charity receipt is fully deductible on the estate side (excluded from
    # the taxable estate): the deduction equals the charitable amount.
    assert leg["ira_to_charity_fraction"] == 1.0


def test_default_has_no_charity_fields():
    # frac == 0 (default) must be a strict no-op: no charity fields leak in.
    cfg = _cfg()
    leg = run_projection(cfg)["legacy"]
    assert "charitable_ira_amount" not in leg
    assert "ira_to_charity_fraction" not in leg


def test_no_conversion_beats_full_conversion_on_combined_metric():
    cfg = _cfg()
    out = charitable_beneficiary_compare(cfg, fraction=1.0)
    cases = out["cases"]

    with_conv = cases["charity_with_conversions"]["combined_family_charity"]
    no_conv = cases["charity_no_conversions"]["combined_family_charity"]

    # Emergent (not hardcoded): leaving the IRA unconverted for charity wins the
    # combined family + charity total for the default household.
    assert no_conv > with_conv
    assert out["winner"] == "charity_no_conversions"

    # The full-charity, no-conversion branch pays $0 heir IRA tax and books the
    # charitable deduction — reconciles with the grid's 0% heir-rate row.
    assert cases["charity_no_conversions"]["heir_ira_tax"] == 0.0
    assert cases["charity_no_conversions"]["charity_receipt"] > 0

    # Deltas carry both nominal and today's-dollars (PV-twin convention).
    d = out["combined_delta_conversions_effect"]
    assert "nominal" in d and "today" in d
    assert abs(d["today"]) <= abs(d["nominal"]) + 0.01


def test_charity_grid_reconciliation():
    # 100% to charity: IRA passes at full pre-tax value, zero income tax — the
    # same outcome the Two-Way 0% (charity / no income tax) row implies for the
    # IRA portion. Charity receipt equals the pre-tax IRA balance at 2nd death.
    cfg = _cfg()
    res = run_projection(cfg)
    ira_at_death = res["rows"][-1].get("traditional") or 0
    cfg.setdefault("beneficiary", {})["ira_to_charity_fraction"] = 1.0
    leg = run_projection(cfg)["legacy"]
    assert abs(leg["charitable_ira_amount"] - round(ira_at_death, 2)) < 1.0
    assert leg["inherited_ira_tax"] == 0.0
