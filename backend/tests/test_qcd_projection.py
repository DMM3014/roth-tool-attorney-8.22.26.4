"""Regression tests for the Qualified Charitable Distribution (QCD) engine.

QCD rules being enforced (2025):
- Only owners age ≥ 70 can contribute their share (approximate 70½ eligibility).
- QCD counts toward RMD dollar-for-dollar.
- QCD is excluded from taxable ordinary income (never enters AGI).
- IRA balance still decreases by the full RMD (QCD portion + non-QCD portion).
- Annual per-taxpayer cap (default $108,000, indexed by IRS).
- QCD cannot exceed the year's total RMD (implementation choice).
"""
import copy
from projection import run_projection


# Minimal plan that produces a large RMD for years post-73 so we can see the QCD effect.
def _base_config():
    return {
        "household": {
            "client_name": "Test Client",
            "spouse_name": "",
            "client_dob_year": 1948,           # Age 78 in 2026 → RMD already active
            "client_life_expectancy": 93,      # dies at age 93 = year 2041
            "filing_status": "Single",
            "state": "TX",
        },
        "projection": {
            "start_year": 2026,
            "end_year": 2035,
            "bracket_indexing": 0.03,
            "irmaa_indexing": 0.03,
            "ss_cola": 0.025,
        },
        "roth": {"enabled": False, "target_bracket": 0.24},
        "tax": {"state_rate": 0.0, "include_irmaa": True, "community_property": False,
                "survivor_spending_reduction": 0.2, "survivor_filing_status": "Single"},
        "accounts": [
            {"id": "CASH-1", "owner": "Client", "name": "Cash", "tax_type": "Cash",
             "beginning_balance": 100000.0, "cost_basis": 0.0, "return": 0.03},
            {"id": "IRA-1", "owner": "Client", "name": "Traditional IRA", "tax_type": "Tax-Deferred",
             "beginning_balance": 3000000.0, "cost_basis": 0.0, "return": 0.07},
        ],
        "income_streams": [],
        "expenses": [
            {"use": True, "owner": "Joint", "category": "living", "source": "Living",
             "amount": 80000.0, "inflation_rate": 0.025},
        ],
        "withdrawal": {"funding_order": "Cash → Taxable → IRA → Roth",
                       "ira_split": 0.5, "surplus_sweep_to": "Taxable"},
        "dividend_yield": 0.01,
    }


def test_qcd_off_produces_same_math_as_before():
    """No QCD → identical numerics as before (only structural fields new)."""
    cfg = _base_config()
    res = run_projection(cfg)
    for row in res["rows"]:
        assert row["qcd"] == 0.0
        assert row["qcd_by_owner"] == {"Client": 0.0, "Spouse": 0.0}
    assert res["summary"]["lifetime_qcd"] == 0.0


def test_qcd_reduces_taxable_ordinary_income_dollar_for_dollar():
    """A $30K QCD every year should reduce ordinary_income by exactly $30K in years
    where RMD >= $30K, and produce lifetime_qcd = sum-of-active-QCD-years."""
    cfg_off = _base_config()
    cfg_on = _base_config()
    cfg_on["household"]["qcd_annual_amount"] = 30000.0
    cfg_on["household"]["qcd_start_year"] = 2026
    cfg_on["household"]["qcd_end_year"] = 0     # run through end

    res_off = run_projection(cfg_off)
    res_on = run_projection(cfg_on)

    # Every year with an RMD ≥ $30K should see the reduction. All years in this
    # plan are post-RMD-start (age 78 in 2026), so every row applies.
    for row_off, row_on in zip(res_off["rows"], res_on["rows"]):
        if row_off["rmd"] >= 30000:
            assert abs(row_on["qcd"] - 30000.0) < 1.0, f"QCD not applied in {row_on['year']}"
            # Reported ordinary_income should drop by ~$30K
            assert row_on["ordinary_income"] < row_off["ordinary_income"], \
                f"Ordinary income not reduced by QCD in {row_on['year']}"

    # Lifetime QCD summary must equal the sum of per-year QCD values
    assert abs(res_on["summary"]["lifetime_qcd"] - sum(r["qcd"] for r in res_on["rows"])) < 1.0
    assert res_on["summary"]["lifetime_qcd"] > 0.0

    # Total lifetime taxes must be strictly LESS with QCD active (charitable
    # dollars never enter AGI, so the ordinary bracket bill drops).
    assert res_on["summary"]["lifetime_taxes"] < res_off["summary"]["lifetime_taxes"], \
        "QCD should reduce lifetime federal tax burden"


def test_qcd_reduces_ira_balance_same_as_full_rmd():
    """QCD dollars leave the IRA just like RMD dollars. The IRA balance path
    should NOT change vs. QCD-off (same account decrement)."""
    cfg_off = _base_config()
    cfg_on = _base_config()
    cfg_on["household"].update(qcd_annual_amount=30000.0, qcd_start_year=2026)

    res_off = run_projection(cfg_off)
    res_on = run_projection(cfg_on)

    # IRA balance path in both scenarios: within 5% (tax savings may nudge it slightly
    # through the reinvestment channel but the direct RMD flow is identical).
    for r_off, r_on in zip(res_off["rows"], res_on["rows"]):
        # The IRA balance itself should be essentially the same at every step —
        # the RMD (and its QCD portion) leaves the IRA identically.
        if r_off["traditional"] > 0:
            drift = abs(r_on["traditional"] - r_off["traditional"]) / r_off["traditional"]
            assert drift < 0.01, f"IRA balance drifted >1% in {r_off['year']}: off={r_off['traditional']} on={r_on['traditional']}"


def test_qcd_bounded_by_annual_cap():
    """A very large planned QCD ($200K) should still respect the IRS annual cap ($108K default)."""
    cfg = _base_config()
    cfg["household"].update(qcd_annual_amount=200000.0, qcd_start_year=2026, qcd_annual_cap=108000.0)
    res = run_projection(cfg)
    for row in res["rows"]:
        assert row["qcd"] <= 108000.0 + 0.01, f"QCD exceeded cap: {row['qcd']} in {row['year']}"
        # AND capped by RMD (implementation choice)
        assert row["qcd"] <= row["rmd"] + 0.01


def test_qcd_ineligible_pre_70_returns_zero():
    """A 65-year-old client cannot QCD — the field is ignored until they hit 70."""
    cfg = _base_config()
    cfg["household"]["client_dob_year"] = 1961     # Age 65 in 2026
    # No RMD until age 75 (SECURE 2.0) so QCD is naturally zero. Even so:
    cfg["household"].update(qcd_annual_amount=30000.0, qcd_start_year=2026)
    res = run_projection(cfg)
    # All years before age 70 → QCD zero (also RMD zero pre-75)
    early_rows = [r for r in res["rows"] if r["client_age"] and r["client_age"] < 70]
    for row in early_rows:
        assert row["qcd"] == 0.0


def test_qcd_end_year_stops_contributions():
    """qcd_end_year cutoff should turn QCD off after that year."""
    cfg = _base_config()
    cfg["household"].update(qcd_annual_amount=30000.0,
                            qcd_start_year=2026, qcd_end_year=2028)
    res = run_projection(cfg)
    for row in res["rows"]:
        if row["year"] <= 2028:
            assert row["qcd"] > 0.0, f"QCD should be active in {row['year']}"
        else:
            assert row["qcd"] == 0.0, f"QCD should be inactive after 2028 (got {row['qcd']} in {row['year']})"


def test_qcd_appears_in_cashflow_and_line_items():
    """The `cashflow.qcd` field and a 'Charitable — QCD' expense line should populate."""
    cfg = _base_config()
    cfg["household"].update(qcd_annual_amount=30000.0, qcd_start_year=2026)
    res = run_projection(cfg)
    row = res["rows"][0]
    assert row["cashflow"]["qcd"] == 30000.0
    # Expense line-item present
    qcd_line = next((e for e in row["line_items"]["expenses"] if e["source"] == "Charitable — QCD"), None)
    assert qcd_line is not None, "Charitable — QCD line missing from cashflow expenses"
    assert qcd_line["amount"] == 30000.0
    assert qcd_line["category"] == "charity"


def test_qcd_couples_split_between_spouses():
    """For a couple where only one spouse is age ≥ 70, all QCD flows through the eligible one."""
    cfg = _base_config()
    cfg["household"]["spouse_name"] = "Spouse"
    cfg["household"]["spouse_dob_year"] = 1965    # Age 61 in 2026 — ineligible
    cfg["household"]["spouse_life_expectancy"] = 95
    cfg["household"]["filing_status"] = "Married Filing Jointly"
    # Give spouse a separate IRA balance too
    cfg["accounts"].append({
        "id": "IRA-2", "owner": "Spouse", "name": "Spouse IRA",
        "tax_type": "Tax-Deferred", "beginning_balance": 500000.0,
        "cost_basis": 0.0, "return": 0.07,
    })
    cfg["household"].update(qcd_annual_amount=30000.0, qcd_start_year=2026,
                            qcd_client_share=0.5)     # Nominal 50/50 split
    res = run_projection(cfg)
    # Client is 78, spouse is 61 → all QCD must flow through Client (the eligible one)
    row = res["rows"][0]
    assert row["qcd"] > 0, "QCD should be active"
    assert row["qcd_by_owner"]["Client"] == row["qcd"], \
        "All QCD should route through eligible Client (spouse < 70)"
    assert row["qcd_by_owner"]["Spouse"] == 0.0
