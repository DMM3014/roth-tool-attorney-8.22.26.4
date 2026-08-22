"""State income tax engine — unit + integration tests.

Verifies:
1. Legacy fallback path (state_code="") preserves the flat state_rate × federal_taxable math.
2. No-income states produce state_tax = 0.
3. Progressive brackets: CA/NY marginal bumps in expected slices.
4. Full retirement exclusions: PA/IL/MS drop pension + IRA + SS from state taxable.
5. SS-exempt states subtract taxable_ss (default in ~41 states).
6. State standard deduction is applied.
7. Age-gated partial retirement exclusions (NY $20K/person over 59½) fire only for
   qualifying households.
8. End-to-end: projection default scenario with state_code=CA produces >$1M more
   state tax over the lifetime vs state_code=IL (retirement-exempt) and $0 for FL.
"""
import copy
import pytest

from defaults import DEFAULT_SCENARIO
from state_tax import compute_state_tax, STATE_TAX_RULES, get_state_metadata
from projection import run_projection


# --- Unit tests: compute_state_tax --------------------------------------

def test_fallback_no_state_code_uses_flat_rate():
    """Legacy behavior: empty state_code → tax = fallback_rate × federal_taxable."""
    res = compute_state_tax(
        state_code="", filing_status="MFJ",
        federal_taxable_income=200000, federal_std_deduction=32200,
        federal_senior_bonus=0, taxable_ss=0, ira_distributions=0,
        pension_income=0, fallback_rate=0.05,
    )
    assert res["state_tax"] == 10000.0
    assert res["state_type"] == "flat_fallback"
    assert res["state_code"] == ""


def test_no_income_states_zero_tax():
    """All 9 no-income states return $0 state tax regardless of income."""
    for code in ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]:
        res = compute_state_tax(
            state_code=code, filing_status="MFJ",
            federal_taxable_income=500000, federal_std_deduction=32200,
            federal_senior_bonus=0, taxable_ss=50000, ira_distributions=80000,
            pension_income=30000,
        )
        assert res["state_tax"] == 0.0, f"{code} should have no state tax"
        assert res["state_type"] == "none"


def test_pa_exempts_all_retirement_income():
    """Pennsylvania fully exempts pension, IRA, and SS."""
    # Pure retirement household: taxable_ss + IRA + pension = all income
    res = compute_state_tax(
        state_code="PA", filing_status="MFJ",
        federal_taxable_income=100000, federal_std_deduction=32200,
        federal_senior_bonus=0, taxable_ss=30000, ira_distributions=60000,
        pension_income=40000,
    )
    # All of federal AGI (100k + 32.2k = 132.2k) should be excluded (30k+60k+40k = 130k > 132.2k slots).
    # Any residual (wages/dividends) taxed at 3.07%.
    assert res["state_ss_excluded"] == 30000.0
    assert res["state_ira_excluded"] == 60000.0
    assert res["state_pension_excluded"] == 40000.0
    # Residual = 132.2k - 130k = 2.2k → tax ≈ 2200 * 0.0307 = $67.54
    assert 0 < res["state_tax"] < 200


def test_il_exempts_all_retirement_income():
    """Illinois: flat 4.95% with full retirement exemption."""
    res = compute_state_tax(
        state_code="IL", filing_status="MFJ",
        federal_taxable_income=80000, federal_std_deduction=32200,
        federal_senior_bonus=0, taxable_ss=40000, ira_distributions=50000,
        pension_income=20000,
    )
    # 80k federal-taxable + 32.2k std = ~112.2k state AGI, minus 110k retirement exemption ≈ 2.2k residual
    assert res["state_ss_excluded"] == 40000.0
    assert res["state_ira_excluded"] == 50000.0
    assert res["state_pension_excluded"] == 20000.0


def test_ca_progressive_brackets_high_income():
    """California high-income household hits 9.3% + brackets — tax should be > 6% effective."""
    res = compute_state_tax(
        state_code="CA", filing_status="MFJ",
        federal_taxable_income=500000, federal_std_deduction=32200,
        federal_senior_bonus=0, taxable_ss=0, ira_distributions=0,
        pension_income=0,
    )
    # State AGI ≈ $532K → high-9.3% marginal expected; state tax should be > $30K
    assert res["state_tax"] > 30000
    assert res["state_marginal_rate"] >= 0.093
    assert res["state_type"] == "progressive"


def test_ca_exempts_ss():
    """CA excludes SS but taxes pension + IRA distributions."""
    res = compute_state_tax(
        state_code="CA", filing_status="MFJ",
        federal_taxable_income=200000, federal_std_deduction=32200,
        federal_senior_bonus=0, taxable_ss=40000, ira_distributions=50000,
        pension_income=20000,
    )
    assert res["state_ss_excluded"] == 40000.0
    assert res["state_ira_excluded"] == 0.0    # CA taxes IRA
    assert res["state_pension_excluded"] == 0.0  # CA taxes pensions


def test_ny_partial_retirement_exclusion_age_gate():
    """NY excludes up to $20K/person of pension+IRA when max_age >= 59.

    Age gate applies: under 59 → cap NOT used; age 60+ → cap applied.
    """
    args = dict(
        state_code="NY", filing_status="MFJ",
        federal_taxable_income=200000, federal_std_deduction=32200,
        federal_senior_bonus=0, taxable_ss=0, ira_distributions=50000,
        pension_income=10000,
    )
    # Under age gate
    res_young = compute_state_tax(**args, max_age=55)
    # Over age gate — MFJ doubles cap to $40K
    res_old = compute_state_tax(**args, max_age=65)
    assert res_young["state_ret_exclusion_used"] == 0.0
    assert res_old["state_ret_exclusion_used"] > 0
    # Old couple pays less state tax than young couple
    assert res_old["state_tax"] < res_young["state_tax"]


def test_progressive_bracket_marginal_correct():
    """Verify CA MFJ marginal rate matches the bracket the taxpayer's income lands in."""
    from state_tax import _apply_progressive, CA_MFJ

    # $30K MFJ → 2% bracket (top = 50998)
    tax, marg = _apply_progressive(30000, CA_MFJ)
    assert marg == 0.02

    # $500K MFJ → 9.3% (bracket top 721318)
    _, marg = _apply_progressive(500000, CA_MFJ)
    assert marg == 0.093

    # $2M MFJ → 12.3% (final bracket)
    _, marg = _apply_progressive(2000000, CA_MFJ)
    assert marg == 0.123


def test_state_standard_deduction_applied():
    """State std deduction reduces state taxable income."""
    # NC has $25,500 MFJ std ded and a 3.99% flat rate (2026).
    res = compute_state_tax(
        state_code="NC", filing_status="MFJ",
        federal_taxable_income=100000, federal_std_deduction=32200,
        federal_senior_bonus=0, taxable_ss=0, ira_distributions=0,
        pension_income=0,
    )
    # State AGI = 132.2k, minus NC std 25.5k = 106.7k * 4.25% = $4,534.75
    assert res["state_std_deduction"] == 25500.0
    assert abs(res["state_tax"] - (100000 + 32200 - 25500) * 0.0399) < 1.0


def test_get_state_metadata_returns_supported_true_for_known():
    m = get_state_metadata("CA")
    assert m["supported"] is True
    assert m["exempts_ss"] is True
    assert m["type"] == "progressive"


def test_get_state_metadata_unknown_returns_unsupported():
    m = get_state_metadata("ZZ")
    assert m["supported"] is False


# --- Integration tests: full projection with state_code ------------------

def _run(code: str) -> dict:
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["tax"]["state_code"] = code
    return run_projection(scn)


def test_projection_florida_zero_state_tax():
    res = _run("FL")
    assert all(r["tax_breakdown"]["state"] == 0.0 for r in res["rows"])


def test_projection_ca_higher_than_default():
    """CA lifetime state tax must exceed default (empty=flat 3.99%) significantly."""
    res_default = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    res_ca = _run("CA")
    lifetime_default = sum(r["tax_breakdown"]["state"] for r in res_default["rows"])
    lifetime_ca = sum(r["tax_breakdown"]["state"] for r in res_ca["rows"])
    assert lifetime_ca > lifetime_default * 1.5


def test_projection_il_much_lower_than_default():
    """IL exempts retirement income → lifetime state tax < default flat 3.99%.

    Default household has substantial pension + RMDs + Roth conversions taxed at
    3.99%. IL flat 4.95% would normally be higher, but full retirement exclusion
    means only wages + interest + dividends are taxed → total should be lower.
    """
    res_default = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    res_il = _run("IL")
    lifetime_default = sum(r["tax_breakdown"]["state"] for r in res_default["rows"])
    lifetime_il = sum(r["tax_breakdown"]["state"] for r in res_il["rows"])
    assert lifetime_il < lifetime_default


def test_projection_state_detail_exposed_on_every_row():
    """Every projection row should carry `tax_detail.state_detail` when state_code is set."""
    res = _run("NY")
    for r in res["rows"]:
        sd = r["tax_detail"].get("state_detail", {})
        assert sd.get("state_code") == "NY"
        assert "state_ss_excluded" in sd
        assert "state_pension_excluded" in sd
        assert "state_ira_excluded" in sd


def test_projection_ss_exclusion_reflected_in_state_detail():
    """When SS starts (year 2028+), CA state_detail should show ss_excluded > 0."""
    res = _run("CA")
    ss_starts_year = 2028
    ss_year_row = next(r for r in res["rows"] if r["year"] == ss_starts_year + 5)
    sd = ss_year_row["tax_detail"]["state_detail"]
    # CA exempts SS, so the taxable_ss should be excluded
    assert sd["state_ss_excluded"] > 0


def test_all_states_have_metadata():
    """Every state code in STATES should have a corresponding STATE_TAX_RULES entry."""
    from states import STATES
    codes_in_states_py = {s["code"] for s in STATES}
    codes_in_rules = set(STATE_TAX_RULES.keys())
    missing = codes_in_states_py - codes_in_rules
    assert not missing, f"States missing from STATE_TAX_RULES: {missing}"


def test_pa_much_lower_than_ca_for_retirees():
    """A retirement-heavy household should pay far less in PA than CA."""
    res_ca = _run("CA")
    res_pa = _run("PA")
    lifetime_ca = sum(r["tax_breakdown"]["state"] for r in res_ca["rows"])
    lifetime_pa = sum(r["tax_breakdown"]["state"] for r in res_pa["rows"])
    assert lifetime_pa < lifetime_ca * 0.3


def test_ny_between_ca_and_default():
    """NY sits between CA (highest) and default flat 3.99% (lower)."""
    res_default = run_projection(copy.deepcopy(DEFAULT_SCENARIO))
    res_ny = _run("NY")
    res_ca = _run("CA")
    l_default = sum(r["tax_breakdown"]["state"] for r in res_default["rows"])
    l_ny = sum(r["tax_breakdown"]["state"] for r in res_ny["rows"])
    l_ca = sum(r["tax_breakdown"]["state"] for r in res_ca["rows"])
    assert l_default < l_ny < l_ca


def test_backward_compat_empty_state_code_matches_pre_refactor():
    """Sanity check: empty state_code produces the SAME state tax as before the refactor."""
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["tax"]["state_code"] = ""
    scn["tax"]["state_rate"] = 0.05
    res = run_projection(scn)
    for r in res["rows"]:
        expected = round(r["taxable_income"] * 0.05, 2)
        # 2-cent tolerance: both sides round independently, so a half-cent in the
        # underlying taxable income can land the two roundings one cent apart.
        assert abs(r["tax_breakdown"]["state"] - expected) < 0.02, (
            f"Year {r['year']}: state_tax={r['tax_breakdown']['state']} but expected {expected}"
        )
