"""Unit tests for the Conversion Halt Monte Carlo feature.

The halt feature ceases planned Roth conversions in a given MC trial once that
trial's prior-year gross portfolio return drops below (1 - drop_threshold), for
the remainder of the conversion window. Because the aggregate liquid recursion
only differs between with/without-conversion in the tax cashflow, swapping in
the no-conversion tax vector from the halt year onward correctly models the
"cancel remaining conversions" behavior at the aggregate level.
"""
import os
import sys
import copy

import numpy as np
import pytest

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from defaults import DEFAULT_SCENARIO
from montecarlo import run_montecarlo


@pytest.fixture(scope="module")
def config_with_conversions():
    """Default scenario with the fill-to-24% Roth conversion window active."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    cfg.setdefault("roth", {})
    cfg["roth"]["enabled"] = True
    return cfg


@pytest.fixture(scope="module")
def config_no_conversions():
    """Same scenario with conversions turned off — nothing for the halt to bite on."""
    cfg = copy.deepcopy(DEFAULT_SCENARIO)
    cfg.setdefault("roth", {})["enabled"] = False
    return cfg


def test_halt_disabled_produces_no_halt_info(config_with_conversions):
    """Result payload must NOT include a conversion_halt block when the feature is off."""
    res = run_montecarlo(config_with_conversions, n_trials=100, seed=42,
                        engine="historical", conversion_halt=None)
    assert res["conversion_halt"] is None


def test_halt_enabled_reports_metadata(config_with_conversions):
    """When enabled + conversions active, the halt info should describe the window and
    report per-trial trigger statistics."""
    res = run_montecarlo(config_with_conversions, n_trials=200, seed=42,
                        engine="historical",
                        conversion_halt={"enabled": True, "drop_threshold": 0.10})
    halt = res["conversion_halt"]
    assert halt is not None
    assert halt["enabled"] is True
    assert 0.02 <= halt["drop_threshold"] <= 0.50
    assert halt["conversion_window_start"] is not None
    assert halt["conversion_window_end"] >= halt["conversion_window_start"]
    assert 0 <= halt["triggered_pct"] <= 1.0
    assert halt["trials_triggered"] >= 0
    # With a 10% threshold on 200 historical trials, at least some trials should trigger
    # (1928-2024 US market data has enough big drawdowns).
    assert halt["trials_triggered"] > 0


def test_halt_with_no_conversions_reports_no_halt(config_no_conversions):
    """If the plan has no conversions, halt cannot bite regardless of threshold — the
    feature auto-disables in the result (no conversion window to protect)."""
    res = run_montecarlo(config_no_conversions, n_trials=100, seed=42,
                        engine="historical",
                        conversion_halt={"enabled": True, "drop_threshold": 0.10})
    assert res["conversion_halt"] is None


def test_halt_alters_results_when_triggered(config_with_conversions):
    """The halt must actually influence the results — flipping the switch has to change
    the ending wealth distribution and success rate materially (not just by rounding).
    Whether P10 goes up or down depends on the trade-off between saved conversion tax
    (upfront) and higher future RMD tax (later) — the sim correctly captures BOTH sides,
    which is exactly the "bear-market realism" the user asked for."""
    seed = 12345
    base = run_montecarlo(config_with_conversions, n_trials=400, seed=seed,
                         engine="historical", conversion_halt=None)
    halted = run_montecarlo(config_with_conversions, n_trials=400, seed=seed,
                           engine="historical",
                           conversion_halt={"enabled": True, "drop_threshold": 0.10})
    # Halt must trigger on some trials for the test to be meaningful.
    assert halted["conversion_halt"]["trials_triggered"] > 0
    # The ending-wealth distribution must differ materially in at least one percentile.
    ends_base = base["with_conversions"]["ending"]
    ends_halted = halted["with_conversions"]["ending"]
    diffs = [abs(ends_halted[k] - ends_base[k]) for k in ("p10", "p25", "p50", "p75", "p90")]
    assert max(diffs) > 10_000, f"Halt should shift at least one percentile by >$10k; diffs={diffs}"


def test_halt_trigger_thresholds_are_monotonic(config_with_conversions):
    """Looser threshold (e.g. 25% drop required) should trigger fewer trials than a
    tighter one (e.g. 5% drop required). Guards against sign errors in the comparison."""
    seed = 999
    loose = run_montecarlo(config_with_conversions, n_trials=300, seed=seed,
                          engine="historical",
                          conversion_halt={"enabled": True, "drop_threshold": 0.25})
    tight = run_montecarlo(config_with_conversions, n_trials=300, seed=seed,
                          engine="historical",
                          conversion_halt={"enabled": True, "drop_threshold": 0.05})
    assert tight["conversion_halt"]["trials_triggered"] >= loose["conversion_halt"]["trials_triggered"]


def test_halt_result_shape_unchanged(config_with_conversions):
    """Adding conversion_halt must not remove or rename any existing result keys."""
    expected_keys = {
        "years", "n_trials", "engine", "plan_return", "anchor", "historical",
        "guardrail", "conversion_halt", "allocation", "assets", "portfolio_mean",
        "portfolio_vol", "liquid_start", "with_conversions", "without_conversions",
        "sequence_risk", "shock", "inflation", "correlation",
    }
    res = run_montecarlo(config_with_conversions, n_trials=100, seed=1,
                        engine="historical",
                        conversion_halt={"enabled": True, "drop_threshold": 0.10})
    assert expected_keys.issubset(set(res.keys()))


def test_halt_year_counts_histogram(config_with_conversions):
    """The trigger_year_counts array must be same length as res.years, non-negative,
    and sum to trials_triggered — this powers the frontend histogram."""
    res = run_montecarlo(config_with_conversions, n_trials=300, seed=42,
                        engine="historical",
                        conversion_halt={"enabled": True, "drop_threshold": 0.10})
    halt = res["conversion_halt"]
    counts = halt["trigger_year_counts"]
    assert isinstance(counts, list)
    assert len(counts) == len(res["years"])
    assert all(c >= 0 for c in counts)
    assert sum(counts) == halt["trials_triggered"]
    # Triggers should NOT happen before the conversion window opens.
    win_start = halt["conversion_window_start"]
    for i, y in enumerate(res["years"]):
        if y < win_start:
            assert counts[i] == 0, f"trigger in year {y} predates window start {win_start}"


def test_halt_recovery_allows_re_entry(config_with_conversions):
    """With resume_after_positive_years=2, a trial that triggers on an early drop can
    un-halt after 2 consecutive positive years and re-halt on a later drop. So the total
    number of DISTINCT triggers per trial can exceed 1 — but the first-trigger reporting
    is still the FIRST year. Success/legacy should differ vs. permanent-halt mode because
    the trial spends some middle years converting again."""
    seed = 7
    perm = run_montecarlo(config_with_conversions, n_trials=400, seed=seed,
                         engine="historical",
                         conversion_halt={"enabled": True, "drop_threshold": 0.10,
                                          "resume_after_positive_years": 0})
    recov = run_montecarlo(config_with_conversions, n_trials=400, seed=seed,
                          engine="historical",
                          conversion_halt={"enabled": True, "drop_threshold": 0.10,
                                           "resume_after_positive_years": 2})
    # Recovery mode reports the resume_after_positive_years it ran with.
    assert perm["conversion_halt"]["resume_after_positive_years"] == 0
    assert recov["conversion_halt"]["resume_after_positive_years"] == 2
    # The two runs must produce different ending-wealth distributions — recovery lets
    # some trials pay MORE conversion tax later than permanent halt would.
    diffs = [abs(recov["with_conversions"]["ending"][k] - perm["with_conversions"]["ending"][k])
             for k in ("p10", "p50", "p90")]
    assert max(diffs) > 10_000, f"Recovery vs permanent should shift a percentile >$10k; diffs={diffs}"


def test_rebalance_cadence_default_is_annual(config_with_conversions):
    """When rebalance is not passed, the result reports cadence='annual' (backwards compat)."""
    res = run_montecarlo(config_with_conversions, n_trials=100, seed=1,
                        engine="historical")
    assert res.get("rebalance") == {"cadence": "annual"}


def test_rebalance_never_widens_dispersion(config_with_conversions):
    """Never-rebalance should produce a DIFFERENT ending distribution than annual because
    weight drift compounds over 30+ years. Guards against the cadence knob being a no-op."""
    seed = 42
    annual = run_montecarlo(config_with_conversions, n_trials=400, seed=seed,
                           engine="historical",
                           rebalance={"cadence": "annual"})
    never = run_montecarlo(config_with_conversions, n_trials=400, seed=seed,
                          engine="historical",
                          rebalance={"cadence": "never"})
    assert never["rebalance"]["cadence"] == "never"
    assert annual["rebalance"]["cadence"] == "annual"
    diffs = [abs(never["with_conversions"]["ending"][k] - annual["with_conversions"]["ending"][k])
             for k in ("p10", "p25", "p50", "p75", "p90")]
    assert max(diffs) > 100_000, f"Never-rebalance should shift dispersion >$100k; diffs={diffs}"


def test_rebalance_biennial_differs_from_annual_and_never(config_with_conversions):
    """Biennial must produce a materially different ending distribution than both annual
    and never (proving the cadence enum is wired correctly — ordering isn't guaranteed to
    be monotonic because weight drift interacts non-linearly with returns)."""
    seed = 42
    ann = run_montecarlo(config_with_conversions, n_trials=200, seed=seed,
                       engine="historical", rebalance={"cadence": "annual"})
    bi  = run_montecarlo(config_with_conversions, n_trials=200, seed=seed,
                       engine="historical", rebalance={"cadence": "biennial"})
    nev = run_montecarlo(config_with_conversions, n_trials=200, seed=seed,
                       engine="historical", rebalance={"cadence": "never"})
    a_p50, b_p50, n_p50 = (ann["with_conversions"]["ending"]["p50"],
                           bi["with_conversions"]["ending"]["p50"],
                           nev["with_conversions"]["ending"]["p50"])
    assert abs(b_p50 - a_p50) > 100_000, "biennial P50 must differ from annual by >$100k"
    assert abs(b_p50 - n_p50) > 100_000, "biennial P50 must differ from never by >$100k"


def test_halt_resume_histogram(config_with_conversions):
    """When resume mode is on, the halt payload must include a valid resume histogram:
    counts sum to trials_resumed, no resumes before window opens, and resumed_pct is a
    valid fraction of trials_triggered."""
    res = run_montecarlo(config_with_conversions, n_trials=300, seed=42,
                        engine="historical",
                        conversion_halt={"enabled": True, "drop_threshold": 0.10,
                                         "resume_after_positive_years": 2})
    halt = res["conversion_halt"]
    assert "resume_year_counts" in halt
    counts = halt["resume_year_counts"]
    assert isinstance(counts, list)
    assert len(counts) == len(res["years"])
    assert all(c >= 0 for c in counts)
    assert sum(counts) == halt["trials_resumed"]
    # Resumes cannot happen before triggers — earliest possible resume is trigger+2 years.
    assert halt["trials_resumed"] > 0
    assert halt["median_resume_year"] is not None
    assert halt["median_resume_year"] >= halt["conversion_window_start"] + 2
    # Resume% should be a valid fraction of trials_triggered.
    assert 0.0 <= halt["resumed_pct"] <= 1.0


def test_halt_resume_zero_when_permanent(config_with_conversions):
    """When resume_after_positive_years=0 (permanent halt), no trial should ever resume."""
    res = run_montecarlo(config_with_conversions, n_trials=200, seed=42,
                        engine="historical",
                        conversion_halt={"enabled": True, "drop_threshold": 0.10,
                                         "resume_after_positive_years": 0})
    halt = res["conversion_halt"]
    assert halt["trials_resumed"] == 0
    assert halt["resumed_pct"] == 0.0
    assert sum(halt["resume_year_counts"]) == 0
    assert halt["median_resume_year"] is None


def test_guardrail_persistence_metrics(config_with_conversions):
    """The guardrail_info block must expose the persistence metrics needed for the UI
    parity with the halt histogram card: trials_with_cuts_pct, distribution percentiles,
    and mean_cut_years."""
    res = run_montecarlo(config_with_conversions, n_trials=200, seed=42,
                        engine="historical",
                        guardrail={"enabled": True, "cut_pct": 0.10})
    gr = res["guardrail"]
    for key in ("trials_with_cuts", "trials_with_cuts_pct", "median_cut_years",
                "p10_cut_years", "p90_cut_years", "max_cut_years", "mean_cut_years"):
        assert key in gr, f"missing key: {key}"
    assert 0 <= gr["trials_with_cuts"] <= 200
    assert 0.0 <= gr["trials_with_cuts_pct"] <= 1.0
    assert gr["p10_cut_years"] <= gr["median_cut_years"] <= gr["p90_cut_years"] <= gr["max_cut_years"]
    assert isinstance(gr["mean_cut_years"], float)
