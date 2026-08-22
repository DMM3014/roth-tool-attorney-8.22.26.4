# Known test debt (pre-existing, NOT regressions)

Recorded 2026-06 while implementing the report-review corrections.

## Root cause
The default scenario changed in an earlier session (cash/checking default set to
$500,000, heir_federal_rate + heir_state_rate now 32% + 4% = 36%). Several older
tests hardcode dollar/rate expectations from before that change, so they fail even
though the engine is behaving correctly.

## Failing with stale hardcoded numbers (need a decision: re-baseline or parametrize)
- tests/test_phase22_engine.py::test_plan_return_is_liquid_weighted
- tests/test_phase22_engine.py::test_anchor_on_by_default_and_recenters
- tests/test_phase25_path_anchor.py::test_lognormal_anchor_reports_plan_path_mode
- tests/test_phase18_inflation_and_attribution.py::test_conversion_math_unchanged_by_attribution
- tests/test_phase17_http_endpoints.py::test_projection_has_roth_compliance_and_math_unchanged
- tests/test_phase18_http_endpoints.py::test_projection_per_owner_ledger_and_math
- tests/test_phase18_http_endpoints.py::test_strategy_sweep_default_topN_fill32

## Already re-baselined / fixed
- tests/_golden.json regenerated (`python tests/golden_snapshot.py save`) — the
  baseline predated the $500K cash default.
- test_phase10_features.py: heir-rate assertion now derived from the config;
  state-rate test clears `state_code` (bracket schedule takes precedence over the
  flat `state_rate` fallback).
- test_phase9_features.py: heir-rate assertion derived from the config.
- test_phase39_state_tax.py: 2-cent rounding tolerance (independent roundings).

## Parallel-run artifacts (not real failures)
tests/test_phase52_*.py and tests/test_iter63_ep_flowchart_http.py ERROR under the
full parallel run (HTTP 429 rate limiting) but pass when run per-file.
