"""Phase 43 — Excel-parity engine corrections (2026-06).

1. Cost-basis consumption: every taxable sale consumes pro-rata basis, mirroring the
   workbook's "Basis Consumed" rows (consumed = wd × (1 − gain%); basis_EOY =
   MAX(0, basis_BOY − consumed) + sweep). Previously basis never decreased, so realized
   LTCG was understated in withdrawal-heavy (Taxable-first) strategies — flipping the
   Taxable-first vs IRA-first ranking relative to the workbook's Legacy page.
2. Survivor Social Security: the widow(er) keeps the HIGHER of the two benefits
   (SSA rule / workbook "survivor = higher benefit" convention), not just their own.
3. Inherited home in the Death+10 heir model compounds at the heir taxable-reinvestment
   rate (heirs sell tax-free via step-up and reinvest), matching the workbook's
   (Taxable + Home) × (1 + r_heir)^n.
"""
import copy
import os
import sys
from types import SimpleNamespace

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from projection import (  # noqa: E402
    _withdraw, _apply_year_flows, _post_death_horizon, YearFlows, run_projection,
)


def _mini_plan(order="Cash → Taxable → IRA → Roth"):
    return SimpleNamespace(
        funding_order=order, ira_ids=["IRA"], taxable_ids=["TX"], roth_ids=["RO"],
        ira_split=0.5, surplus_sweep_to="Taxable",
        acct={"cash": ["CASH"], "ira": ["IRA"], "taxable": ["TX"], "roth": ["RO"],
              "taxable_set": {"TX"}},
    )


class TestBasisConsumption:
    def test_taxable_sale_consumes_prorata_basis(self):
        plan = _mini_plan()
        bal = {"CASH": 0.0, "TX": 1000.0, "IRA": 0.0, "RO": 0.0}
        basis = {"TX": 400.0}
        wd, ltcg, _iw, _rw, consumed = _withdraw(plan, 250.0, bal, basis, {})
        assert wd == {"TX": 250.0}
        assert abs(ltcg - 150.0) < 1e-9            # 60% gain fraction
        assert abs(consumed["TX"] - 100.0) < 1e-9  # 40% basis fraction

    def test_apply_year_flows_reduces_basis(self):
        plan = _mini_plan()
        bal = {"CASH": 0.0, "TX": 1000.0, "IRA": 0.0, "RO": 0.0}
        basis = {"TX": 400.0}
        flows = YearFlows(cash_need=0.0, rmd_by={}, ira_draw=0.0, wd={"TX": 250.0},
                          roth_withdraw=0.0, conversion=0.0, surplus=0.0,
                          basis_consumed={"TX": 100.0})
        _apply_year_flows(plan, bal, basis, flows)
        assert abs(bal["TX"] - 750.0) < 1e-9
        assert abs(basis["TX"] - 300.0) < 1e-9

    def test_zero_basis_consumes_nothing(self):
        plan = _mini_plan()
        bal = {"CASH": 0.0, "TX": 1000.0, "IRA": 0.0, "RO": 0.0}
        basis = {"TX": 0.0}
        _wd, ltcg, _iw, _rw, consumed = _withdraw(plan, 250.0, bal, basis, {})
        assert abs(ltcg - 250.0) < 1e-9
        assert abs(consumed.get("TX", 0.0)) < 1e-9

    def test_loss_position_consumes_full_withdrawal(self):
        # basis > balance -> gain% floored at 0 (workbook MAX(0, 1-basis/bal)),
        # so the whole withdrawal is basis consumption.
        plan = _mini_plan()
        bal = {"CASH": 0.0, "TX": 1000.0, "IRA": 0.0, "RO": 0.0}
        basis = {"TX": 1200.0}
        _wd, ltcg, _iw, _rw, consumed = _withdraw(plan, 250.0, bal, basis, {})
        assert abs(ltcg) < 1e-9
        assert abs(consumed["TX"] - 250.0) < 1e-9

    def test_basis_floor_zero_after_apply(self):
        plan = _mini_plan()
        bal = {"CASH": 0.0, "TX": 100.0, "IRA": 0.0, "RO": 0.0}
        basis = {"TX": 10.0}
        flows = YearFlows(cash_need=0.0, rmd_by={}, ira_draw=0.0, wd={"TX": 100.0},
                          roth_withdraw=0.0, conversion=0.0, surplus=0.0,
                          basis_consumed={"TX": 50.0})
        _apply_year_flows(plan, bal, basis, flows)
        assert basis["TX"] == 0.0


def _workbook_mirror_cfg(order):
    """Inputs mirroring the user's 'Estate Plan 8.12.26' workbook (see memory notes)."""
    return {
        "household": {"client_dob_year": 1965, "client_life_expectancy": 91,
                      "spouse_dob_year": 1966, "spouse_life_expectancy": 96,
                      "filing_status": "Married Filing Jointly"},
        "projection": {"start_year": 2026, "end_year": 2062, "general_inflation": 0.03,
                       "bracket_indexing": 0.03, "irmaa_indexing": 0.03},
        "income_streams": [
            {"id": "WAG01", "owner": "Client", "type": "Wages", "description": "Client Wages",
             "start_year": 2026, "stop_year": 2027, "amount": 350000, "frequency": "Annual",
             "cola": 0.03, "tax_character": "Ordinary", "taxable_pct": 1, "survivor_pct": 0, "use": True},
            {"id": "SS01", "owner": "Client", "type": "Social Security", "description": "Client SS",
             "start_year": 2035, "stop_year": None, "amount": 4152, "frequency": "Monthly",
             "cola": 0.03, "tax_character": "SS", "taxable_pct": 0, "survivor_pct": 1, "use": True},
            {"id": "SS02", "owner": "Spouse", "type": "Social Security", "description": "Spouse SS",
             "start_year": 2028, "stop_year": None, "amount": 2906.4, "frequency": "Monthly",
             "cola": 0.03, "tax_character": "SS", "taxable_pct": 0, "survivor_pct": 1, "use": True},
            {"id": "PEN01", "owner": "Client", "type": "Pension", "description": "Client Pension 1",
             "start_year": 2027, "stop_year": 2032, "amount": 4950, "frequency": "Monthly",
             "cola": 0.04, "tax_character": "Ordinary", "taxable_pct": 1, "survivor_pct": 0.5, "use": True},
            {"id": "PEN03", "owner": "Spouse", "type": "Pension", "description": "Spouse Pension 1",
             "start_year": 2032, "stop_year": 2062, "amount": 700, "frequency": "Monthly",
             "cola": 0.04, "tax_character": "Ordinary", "taxable_pct": 1, "survivor_pct": 0.5, "use": True},
        ],
        "expenses": [
            {"id": "EXP01", "owner": "Joint", "category": "Living Expenses", "start_year": 2026,
             "stop_year": None, "amount": 240000, "frequency": "Annual", "inflation": 0.03, "use": True},
            {"id": "EXP07", "owner": "Joint", "category": "Travel / Discretionary", "start_year": 2026,
             "stop_year": None, "amount": 10000, "frequency": "Annual", "inflation": 0.04, "use": True},
        ],
        "accounts": [
            {"id": "CASH", "owner": "Joint", "name": "Cash", "tax_type": "Cash",
             "beginning_balance": 1000000, "cost_basis": 0, "return": 0.03},
            {"id": "TAXC", "owner": "Client", "name": "Client Taxable", "tax_type": "Taxable",
             "beginning_balance": 1000000, "cost_basis": 300000, "return": 0.07},
            {"id": "TAXS", "owner": "Spouse", "name": "Spouse Taxable", "tax_type": "Taxable",
             "beginning_balance": 1000000, "cost_basis": 300000, "return": 0.07},
            {"id": "IRAC", "owner": "Client", "name": "Client IRA", "tax_type": "Tax-Deferred",
             "beginning_balance": 3850000, "cost_basis": 0, "return": 0.07},
            {"id": "IRAS", "owner": "Spouse", "name": "Spouse IRA", "tax_type": "Tax-Deferred",
             "beginning_balance": 1150000, "cost_basis": 0, "return": 0.07},
            {"id": "ROTC", "owner": "Client", "name": "Client Roth", "tax_type": "Tax-Free",
             "beginning_balance": 0, "cost_basis": 0, "return": 0.07},
            {"id": "ROTS", "owner": "Spouse", "name": "Spouse Roth", "tax_type": "Tax-Free",
             "beginning_balance": 0, "cost_basis": 0, "return": 0.07},
            {"id": "HOME", "owner": "Joint", "name": "Home", "tax_type": "Real Estate",
             "beginning_balance": 1000000, "cost_basis": 600000, "return": 0.035},
        ],
        "roth": {"enabled": True, "start_year": 2026, "end_year": 2062,
                 "target_bracket": 0.24, "max_annual": 0, "stop_at_rmd_age": False},
        "withdrawal": {"funding_order": order, "ira_split": 0.5, "surplus_sweep_to": "Taxable"},
        "tax": {"state_rate": 0.0399, "state_code": "NC", "community_property": False,
                "include_irmaa": True, "survivor_filing_status": "Single",
                "survivor_spending_reduction": 0.0},
        "legacy": {"estate_settlement_pct": 0.01, "heir_federal_rate": 0.32,
                   "heir_state_rate": 0.04, "heir_ltcg_rate": 0.2345,
                   "heir_gains_realized": False, "step_up_at_death": True,
                   "post_death_years": 10, "heir_reinvest_return": None},
        "dividend_yield": 0.01,
        "mortgage_balance": 0,
    }


class TestWorkbookRankingParity:
    def test_ira_first_beats_taxable_first_at_death_plus_10(self):
        """The workbook's Legacy page ranks Fill-24% IRA-first ($67.6M) above
        Taxable-first ($65.6M) at Death+10. Before the basis-consumption fix the web
        engine flipped that ranking; this locks the corrected ordering in place."""
        tf = run_projection(_workbook_mirror_cfg("Cash → Taxable → IRA → Roth"))
        ifr = run_projection(_workbook_mirror_cfg("Cash → IRA → Taxable → Roth"))
        assert (ifr["legacy"]["after_tax_estate_to_heirs"]
                > tf["legacy"]["after_tax_estate_to_heirs"])
        # Taxable-first converts materially more (workbook: $6.2M vs $4.1M)
        assert (tf["summary"]["total_roth_converted"]
                > ifr["summary"]["total_roth_converted"] * 1.3)

    def test_taxable_first_pays_high_gain_fraction_late(self):
        """With basis consumption, the client taxable account's basis erodes as it is
        spent down — realized-gain fractions stay high instead of decaying to zero."""
        r = run_projection(_workbook_mirror_cfg("Cash → Taxable → IRA → Roth"))
        # realized LTCG = preferential income minus recurring dividends
        ltcg_total = sum(row["preferential_income"] - row["cashflow"]["dividends"]
                         for row in r["rows"])
        wd_total = sum(row["cashflow"].get("from_taxable", 0.0) for row in r["rows"])
        assert wd_total > 1_000_000
        assert ltcg_total / wd_total > 0.60


class TestSurvivorSSHigherBenefit:
    def _cfg(self):
        return {
            "household": {"client_dob_year": 1960, "client_life_expectancy": 68,
                          "spouse_dob_year": 1960, "spouse_life_expectancy": 90,
                          "filing_status": "Married Filing Jointly"},
            "projection": {"start_year": 2026, "end_year": 2035, "general_inflation": 0.0,
                           "bracket_indexing": 0.0, "irmaa_indexing": 0.0},
            "income_streams": [
                {"id": "SSC", "owner": "Client", "type": "Social Security", "description": "Client SS",
                 "start_year": 2026, "stop_year": None, "amount": 2000, "frequency": "Monthly",
                 "cola": 0.0, "tax_character": "SS", "survivor_pct": 1, "use": True},
                {"id": "SSS", "owner": "Spouse", "type": "Social Security", "description": "Spouse SS",
                 "start_year": 2026, "stop_year": None, "amount": 1000, "frequency": "Monthly",
                 "cola": 0.0, "tax_character": "SS", "survivor_pct": 1, "use": True},
            ],
            "expenses": [{"id": "E1", "owner": "Joint", "category": "Living Expenses",
                          "start_year": 2026, "stop_year": None, "amount": 40000,
                          "frequency": "Annual", "inflation": 0.0, "use": True}],
            "accounts": [
                {"id": "CASH", "owner": "Joint", "name": "Cash", "tax_type": "Cash",
                 "beginning_balance": 2000000, "cost_basis": 0, "return": 0.0},
            ],
            "roth": {"enabled": False},
            "withdrawal": {"funding_order": "Cash → Taxable → IRA → Roth"},
            "tax": {"state_rate": 0.0, "survivor_filing_status": "Single",
                    "survivor_spending_reduction": 0.0},
            "legacy": {"estate_settlement_pct": 0.0, "heir_federal_rate": 0.24,
                       "heir_state_rate": 0.0},
        }

    def test_widow_steps_up_to_deceased_higher_benefit(self):
        # Client (higher $24K/yr benefit) dies at 68 -> 2028 is the last alive year;
        # from 2029 the surviving spouse must receive the client's $24K, not her $12K.
        r = run_projection(self._cfg())
        by_year = {row["year"]: row for row in r["rows"]}
        assert abs(by_year[2027]["gross_ss"] - 36000) < 1.0     # both alive: 24K + 12K
        survivor_row = by_year[2030]
        assert survivor_row["filing_status"] == "Single"
        assert abs(survivor_row["gross_ss"] - 24000) < 1.0      # higher benefit kept

    def test_survivor_line_items_include_step_up_row(self):
        r = run_projection(self._cfg())
        row = next(row for row in r["rows"] if row["year"] == 2030)
        items = row["line_items"]["income"]
        ss_total = sum(i["amount"] for i in items if i.get("kind") == "ss")
        assert abs(ss_total - 24000) < 1.0                      # line items tie to gross_ss
        assert any("step-up" in i["source"].lower() for i in items if i.get("kind") == "ss")

    def test_survivor_with_only_own_lower_benefit_unchanged_when_higher(self):
        # If the SURVIVOR holds the higher benefit, no step-up applies.
        cfg = self._cfg()
        cfg["income_streams"][0]["amount"] = 800    # client (deceased) lower
        r = run_projection(cfg)
        row = next(row for row in r["rows"] if row["year"] == 2030)
        assert abs(row["gross_ss"] - 12000) < 1.0   # spouse keeps her own 12K
        assert not any("step-up" in i["source"].lower()
                       for i in row["line_items"]["income"] if i.get("kind") == "ss")


class TestHeirHomeGrowthRate:
    ACCOUNTS = [
        {"id": "TX", "tax_type": "Taxable", "return": 0.07},
        {"id": "RE", "tax_type": "Real Estate", "return": 0.035},
        {"id": "RO", "tax_type": "Tax-Free", "return": 0.07},
        {"id": "IR", "tax_type": "Tax-Deferred", "return": 0.07},
        {"id": "CA", "tax_type": "Cash", "return": 0.03},
    ]

    def test_home_compounds_at_heir_taxable_rate(self):
        final = {"roth": 0, "traditional": 0, "taxable": 0, "cash": 0, "real_estate": 1_000_000}
        rows, total, _ = _post_death_horizon(
            final, self.ACCOUNTS, heir_rate=0.36, settlement_pct=0.01, years=10,
            heir_ltcg_rate=0.228, div_yield=0.01, gains_realized=False)
        heir_net = 0.07 - 0.01 * 0.228          # workbook B65: total return − yield×LTCG
        expected = 1_000_000 * 0.99 * (1 + heir_net) ** 10
        assert abs(rows[-1]["real_estate"] - expected) < 1.0
        assert abs(total - expected) < 1.0

    def test_heir_return_override_applies_to_home(self):
        final = {"roth": 0, "traditional": 0, "taxable": 0, "cash": 0, "real_estate": 1_000_000}
        rows, _, _ = _post_death_horizon(
            final, self.ACCOUNTS, heir_rate=0.36, settlement_pct=0.0, years=10,
            heir_return=0.05, heir_ltcg_rate=0.228, div_yield=0.01, gains_realized=False)
        assert abs(rows[-1]["real_estate"] - 1_000_000 * 1.05 ** 10) < 1.0
