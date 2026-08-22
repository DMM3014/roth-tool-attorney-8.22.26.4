"""State move modeling — mid-plan state_code change (Phase 43)."""
import copy
from defaults import DEFAULT_SCENARIO
from projection import run_projection, _normalize_state_move, _effective_state_code


def test_normalize_valid_move():
    m = _normalize_state_move({"year": 2035, "from": "NY", "to": "FL"})
    assert m == {"year": 2035, "from": "NY", "to": "FL"}


def test_normalize_missing_year_returns_none():
    assert _normalize_state_move({"from": "NY", "to": "FL"}) is None


def test_normalize_missing_to_returns_none():
    assert _normalize_state_move({"year": 2035, "from": "NY"}) is None


def test_normalize_same_state_no_op():
    assert _normalize_state_move({"year": 2035, "from": "NY", "to": "NY"}) is None


def test_normalize_lowercase_coerced_to_upper():
    m = _normalize_state_move({"year": 2035, "from": "ny", "to": "fl"})
    assert m["from"] == "NY" and m["to"] == "FL"


def test_effective_state_before_move_returns_from():
    move = {"year": 2035, "from": "NY", "to": "FL"}
    assert _effective_state_code("NY", move, 2030) == "NY"


def test_effective_state_at_or_after_move_returns_to():
    move = {"year": 2035, "from": "NY", "to": "FL"}
    assert _effective_state_code("NY", move, 2035) == "FL"
    assert _effective_state_code("NY", move, 2036) == "FL"


def test_effective_state_no_move_returns_plan_code():
    assert _effective_state_code("NY", None, 2035) == "NY"


def test_projection_state_move_ny_to_fl_zeros_state_tax_from_move_year():
    """A NY→FL move at 2030 should zero out state tax from 2030 onward."""
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["tax"]["state_code"] = "NY"
    scn["tax"]["state_move"] = {"year": 2030, "from": "NY", "to": "FL"}
    res = run_projection(scn)
    ny_years = [r for r in res["rows"] if r["year"] < 2030]
    fl_years = [r for r in res["rows"] if r["year"] >= 2030]
    # Pre-move: NY tax applies (all rows should have some state tax if there's income).
    # Post-move: FL has no income tax → state_tax must be 0.
    assert all(r["tax_breakdown"]["state"] == 0 for r in fl_years), \
        f"expected zero state tax after move but got: {[(r['year'], r['tax_breakdown']['state']) for r in fl_years[:5]]}"
    # And at least one pre-move year should show state tax > 0 (income exists in NY).
    if ny_years and any(r["taxable_income"] > 0 for r in ny_years):
        assert any(r["tax_breakdown"]["state"] > 0 for r in ny_years)


def test_projection_backward_compat_no_state_move():
    """When state_move is missing, projection state tax matches the plain state engine."""
    baseline = copy.deepcopy(DEFAULT_SCENARIO)
    baseline["tax"]["state_code"] = "CA"
    res1 = run_projection(baseline)

    with_none = copy.deepcopy(DEFAULT_SCENARIO)
    with_none["tax"]["state_code"] = "CA"
    with_none["tax"]["state_move"] = None
    res2 = run_projection(with_none)

    for r1, r2 in zip(res1["rows"], res2["rows"]):
        assert r1["tax_breakdown"]["state"] == r2["tax_breakdown"]["state"]


def test_projection_state_move_malformed_ignored():
    """A malformed state_move (missing to) is ignored — same result as no move."""
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["tax"]["state_code"] = "CA"
    scn["tax"]["state_move"] = {"year": 2030, "from": "CA"}  # missing 'to'
    res = run_projection(scn)
    # Should behave as if no move — all rows use CA.
    assert res["rows"][10]["tax_detail"]["state_detail"]["state_code"] == "CA"


def test_projection_state_move_switches_state_detail():
    """The state_detail block in each row's tax_detail reflects the active state per year."""
    scn = copy.deepcopy(DEFAULT_SCENARIO)
    scn["tax"]["state_code"] = "OR"
    scn["tax"]["state_move"] = {"year": 2035, "from": "OR", "to": "FL"}
    res = run_projection(scn)
    pre = next(r for r in res["rows"] if r["year"] == 2030)
    post = next(r for r in res["rows"] if r["year"] == 2040)
    assert pre["tax_detail"]["state_detail"]["state_code"] == "OR"
    assert post["tax_detail"]["state_detail"]["state_code"] == "FL"
