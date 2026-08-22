"""Phase 51 — report-critique corrections.

1. Monte Carlo plan-anchor path is bounded when the deterministic plan depletes
   (regime-analysis P90 tail anomaly fix).
2. Estate engine re-bases onto the retirement projection's actual second-death
   balances when y2_* targets are provided (page-12 vs pages-14-18 base mismatch).
3. Legacy (no-y2) estate behavior is unchanged.
"""
import numpy as np
import pytest

from montecarlo import _plan_return_path
from estate import project_estate


def _rows(liq_series):
    return [{"cash": v, "taxable": 0.0, "traditional": 0.0, "roth": 0.0} for v in liq_series]


class TestPlanReturnPathGuardrails:
    def test_depleted_plan_path_bounded_and_filled_with_fallback(self):
        # Plan starts at 1M, collapses to ~0 by year 5, then huge outflows keep coming.
        liq = [800_000, 500_000, 200_000, 10_000, 0.0, 0.0, 0.0, 0.0]
        T = len(liq)
        ext = np.zeros(T)
        exp = np.full(T, 300_000.0)
        tax = np.zeros(T)
        path = _plan_return_path(_rows(liq), 1_000_000.0, (ext, exp, tax), fallback=0.015)
        assert path.max() <= 0.50 + 1e-9
        assert path.min() >= -0.50 - 1e-9
        # Years where prev balance < 5% of start must be filled with the fallback.
        # prev for t=4..7 is [0, 0, 0, 0] → below floor → fallback.
        assert np.allclose(path[5:], 0.015)

    def test_no_more_100pct_clip_years(self):
        # Old behavior: near-zero prev balances produced ratios clipped at +1.0
        # which compounded a ~1.87x factor per year in the bootstrap.
        liq = [1_000_000, 600_000, 5_000, 4_000, 3_000, 2_000]
        T = len(liq)
        ext = np.zeros(T)
        exp = np.full(T, 400_000.0)
        tax = np.zeros(T)
        path = _plan_return_path(_rows(liq), 1_000_000.0, (ext, exp, tax), fallback=0.02)
        assert (path >= 0.999).sum() == 0

    def test_healthy_plan_path_identical_to_implied_returns(self):
        # Balances stay far above the 5% floor → the guardrails must not change anything.
        liq = [1_070_000, 1_144_900, 1_225_043, 1_310_796]
        T = len(liq)
        ext = np.zeros(T)
        exp = np.zeros(T)
        tax = np.zeros(T)
        path = _plan_return_path(_rows(liq), 1_000_000.0, (ext, exp, tax), fallback=0.07)
        prev = [1_000_000] + liq[:-1]
        expected = [(liq[i]) / prev[i] - 1.0 for i in range(T)]
        assert np.allclose(path, expected, atol=1e-9)


BASE = dict(
    first_death_year=2050,
    second_death_year=2060,
    deceased_roth_at_y1=4_000_000.0,
    deceased_taxable_at_y1=3_000_000.0,
    survivor_roth_at_y1=4_000_000.0,
    survivor_taxable_at_y1=3_000_000.0,
    traditional_at_y1=1_000_000.0,
    trust_growth_rate=0.07,
    survivor_growth_rate=0.06,
    heir_marginal_rate=0.30,
    indexing_rate=0.03,
)

Y2 = dict(y2_roth=18_000_000.0, y2_taxable=9_000_000.0, y2_traditional=500_000.0)


class TestEstateRebase:
    def test_growth_basis_flag(self):
        legacy = project_estate(**BASE)
        rebased = project_estate(**BASE, **Y2)
        assert legacy["growth_basis"] == "rates"
        assert legacy["implied_growth"] is None
        assert rebased["growth_basis"] == "projection"
        assert set(rebased["implied_growth"].keys()) == {"roth", "taxable", "trad"}

    def test_portability_estate_equals_projection_targets(self):
        r = project_estate(**BASE, **Y2)
        port = r["outcomes"]["portability"]
        total = Y2["y2_roth"] + Y2["y2_taxable"] + Y2["y2_traditional"]
        assert port["estate_y2"] == pytest.approx(total, abs=1.0)

    def test_per_class_conservation_across_all_strategies(self):
        # Trust-held + survivor-held portions of each class must sum exactly to
        # the projection's Y2 class balance in EVERY strategy.
        r = project_estate(**BASE, **Y2)
        for name, o in r["outcomes"].items():
            roth_sum = o["roth_at_y2"] + o["bypass_roth_y2"] + o["qtip_roth_y2"]
            tax_sum = o["taxable_at_y2"] + o["bypass_taxable_y2"] + o["qtip_taxable_y2"]
            assert roth_sum == pytest.approx(Y2["y2_roth"], abs=1.0), name
            assert tax_sum == pytest.approx(Y2["y2_taxable"], abs=1.0), name
            assert o["traditional_at_y2"] == pytest.approx(Y2["y2_traditional"], abs=1.0), name

    def test_h0_horizon_matches_y2_trust_value(self):
        r = project_estate(**BASE, **Y2)
        h0 = next(h for h in r["post_death_horizons"] if h["years_after_second_death"] == 0)
        for name, o in r["outcomes"].items():
            assert h0[f"{name}_trust"] == pytest.approx(o["trust_value_at_y2"], rel=1e-6), name

    def test_legacy_mode_unchanged_without_y2(self):
        r = project_estate(**BASE)
        port = r["outcomes"]["portability"]
        yrs = BASE["second_death_year"] - BASE["first_death_year"]
        roth = (BASE["deceased_roth_at_y1"] + BASE["survivor_roth_at_y1"]) * 1.06 ** yrs
        taxable = (BASE["deceased_taxable_at_y1"] + BASE["survivor_taxable_at_y1"]) * 1.06 ** yrs
        trad = BASE["traditional_at_y1"] * 1.06 ** yrs
        assert port["estate_y2"] == pytest.approx(roth + taxable + trad, rel=1e-9)

    def test_orphan_class_credits_survivor(self):
        # Roth is zero at Y1 but nonzero at Y2 (conversions between the deaths) —
        # the Y2 roth must be credited to the survivor, not dropped.
        cfg = dict(BASE, deceased_roth_at_y1=0.0, survivor_roth_at_y1=0.0)
        r = project_estate(**cfg, **Y2)
        port = r["outcomes"]["portability"]
        assert port["roth_at_y2"] == pytest.approx(Y2["y2_roth"], abs=1.0)

    def test_implied_growth_annualization(self):
        r = project_estate(**BASE, **Y2)
        yrs = BASE["second_death_year"] - BASE["first_death_year"]
        factor = Y2["y2_roth"] / (BASE["deceased_roth_at_y1"] + BASE["survivor_roth_at_y1"])
        assert r["implied_growth"]["roth"] == pytest.approx(factor ** (1 / yrs) - 1, abs=1e-4)
