"""Iteration 84 — HTTP tests for POST /api/longevity/funding-order."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

ORDER_KEYS = ("after_tax_estate", "lifetime_taxes", "ending_roth", "ending_taxable", "ending_traditional")


@pytest.fixture(scope="module")
def default_cfg():
    from defaults import DEFAULT_SCENARIO
    import copy
    return copy.deepcopy(DEFAULT_SCENARIO)


@pytest.fixture(scope="module")
def default_result(default_cfg):
    r = requests.post(f"{BASE_URL}/api/longevity/funding-order",
                      json={"config": default_cfg}, timeout=180)
    assert r.status_code == 200, r.text[:500]
    return r.json()


class TestLongevityFundingOrder:
    def test_shape(self, default_result):
        d = default_result
        assert d["survivor"] in ("client", "spouse")
        assert isinstance(d["orders"], list) and len(d["orders"]) == 3
        assert d["baseline_order"] in d["orders"]
        assert isinstance(d["rows"], list) and len(d["rows"]) >= 3
        assert "_id" not in d

    def test_rows_fields(self, default_result):
        for row in default_result["rows"]:
            assert isinstance(row["extra_years"], int)
            assert isinstance(row["second_death_year"], int)
            assert row["survivor_age_at_death"] > 0
            assert row["leader"] in default_result["orders"]
            for order in default_result["orders"]:
                o = row["orders"][order]
                for k in ORDER_KEYS:
                    assert o[k] is not None
                    assert isinstance(o[k], (int, float))

    def test_zero_row_present(self, default_result):
        assert 0 in [r["extra_years"] for r in default_result["rows"]]

    def test_plus_ten_offset(self, default_result):
        by = {r["extra_years"]: r for r in default_result["rows"]}
        assert 10 in by, "expected a +10 row in the default deltas"
        assert by[10]["second_death_year"] - by[0]["second_death_year"] == 10

    def test_estate_grows_with_longevity(self, default_result):
        rows = sorted(default_result["rows"], key=lambda r: r["extra_years"])
        for order in default_result["orders"]:
            vals = [r["orders"][order]["after_tax_estate"] for r in rows]
            assert vals == sorted(vals), f"{order} estate not monotonic: {vals}"

    def test_clamp_and_dedupe(self, default_cfg):
        r = requests.post(f"{BASE_URL}/api/longevity/funding-order",
                          json={"config": default_cfg, "extra_years": [0, 5, 5, 99, -99]},
                          timeout=180)
        assert r.status_code == 200, r.text[:500]
        got = [row["extra_years"] for row in r.json()["rows"]]
        assert got == sorted(set(got))
        assert all(-15 <= v <= 30 for v in got)
        # 99 -> 30 and -99 -> -15 (clamped, then deduped/sorted). The -15 row is
        # legitimately skipped because the second death lands before the first.
        assert set(got) <= {-15, 0, 5, 30}
        assert 0 in got and 5 in got and 30 in got
