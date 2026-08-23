"""Iteration 31 — HTTP tests for POST /api/two-way-sensitivity (heir rate x regime).

Goes through the public ingress URL with a master token (auth is rate-limited so one
token is fetched per session and reused).
"""
import os
import time

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"

EXPECTED_REGIMES = {
    "historical_avg", "last_50_years", "70s_stagflation", "lost_decade",
    "high_inflation", "low_return",
}
EXPECTED_RATES = [0.0, 0.10, 0.14, 0.26, 0.36, 0.41]
CAPTION_PREFIX = "The case for conversion should be judged across this whole surface"
CAPTION_FULL = (
    "The case for conversion should be judged across this whole surface, not at a "
    "single assumed cell. The break-even rate is an output of this household's facts "
    "and this model's assumptions — it moves with the dividend yield, the funding "
    "order, and the heirs' realization behavior, and should never be quoted from a "
    "case study."
)


@pytest.fixture(scope="module")
def client():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": MASTER_PIN}, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"master auth failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("token")
    assert tok, "no token in auth response"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def default_cfg(client):
    r = client.get(f"{BASE_URL}/api/defaults", timeout=60)
    assert r.status_code == 200, r.text[:300]
    return r.json()


@pytest.fixture(scope="module")
def two_way(client, default_cfg):
    t0 = time.time()
    r = client.post(f"{BASE_URL}/api/two-way-sensitivity", json={"config": default_cfg}, timeout=600)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:500]}"
    print(f"first call latency: {time.time() - t0:.1f}s")
    return r.json()


# --- contract / shape ---
def test_rates_and_labels(two_way):
    assert two_way["rates"] == EXPECTED_RATES
    labels = two_way["rate_labels"]
    assert len(labels) == 6
    assert labels[0] == "0% (charity / no income tax)"
    assert labels[1:] == ["10%", "14%", "26%", "36%", "41%"]


def test_regimes_six_custom_excluded(two_way):
    ids = [rg["preset_id"] for rg in two_way["regimes"]]
    assert len(ids) == 6, ids
    assert set(ids) == EXPECTED_REGIMES
    assert "custom" not in ids
    for rg in two_way["regimes"]:
        assert rg["label"] and isinstance(rg["label"], str)
        assert isinstance(rg["general_inflation"], (int, float))


def test_matrix_dimensions_and_numeric(two_way):
    m = two_way["matrix"]
    assert len(m) == 6, "expected 6 rate rows"
    for row in m:
        assert len(row) == 6, "expected 6 regime columns"
        for v in row:
            assert v is None or isinstance(v, (int, float))
    # deltas should not be an all-zero / all-null surface
    flat = [v for row in m for v in row if v is not None]
    assert len(flat) == 36, "matrix has null cells"
    assert any(abs(v) > 1 for v in flat), "matrix is degenerate (all ~0)"


def test_break_even_per_regime(two_way):
    be = two_way["break_even"]
    regime_ids = [rg["preset_id"] for rg in two_way["regimes"]]
    assert [b["preset_id"] for b in be] == regime_ids, "break_even order must match regimes"
    for b in be:
        assert b["rate"] is None or isinstance(b["rate"], (int, float))
        assert isinstance(b["extrapolated"], bool)


def test_break_even_consistent_with_matrix(two_way):
    """A non-extrapolated break-even must sit inside the 0-41% band; an
    extrapolated one must correspond to a column with no sign crossover."""
    m = two_way["matrix"]
    rates = two_way["rates"]
    for ci, b in enumerate(two_way["break_even"]):
        col = [m[ri][ci] for ri in range(len(rates))]
        if all(v == 0 for v in col if v is not None):
            continue  # degenerate/flat column covered by test_flat_column_break_even
        signs = {v > 0 for v in col if v is not None}
        has_cross = len(signs) > 1
        if b["rate"] is not None and not b["extrapolated"]:
            assert 0.0 <= b["rate"] <= 0.41 + 1e-9, (b, col)
            assert has_cross, f"{b['preset_id']}: non-extrapolated break-even but no crossover {col}"
        if b["extrapolated"]:
            assert not has_cross, f"{b['preset_id']}: flagged extrapolated but column crosses zero {col}"


def test_flat_column_break_even(two_way):
    """A regime whose whole column is exactly 0 (conversion changes nothing for
    heirs) has no meaningful break-even; reporting a hard 0% un-flagged is
    misleading. Expect n/a (null) or extrapolated=True."""
    m = two_way["matrix"]
    for ci, b in enumerate(two_way["break_even"]):
        col = [m[ri][ci] for ri in range(len(two_way["rates"]))]
        if all(v == 0 for v in col if v is not None):
            assert b["rate"] is None or b["extrapolated"], (
                f"{b['preset_id']}: all-zero delta column but break_even reported as "
                f"{b['rate']} with extrapolated={b['extrapolated']}")


def test_caption_verbatim(two_way):
    assert two_way["caption"].startswith(CAPTION_PREFIX)
    assert two_way["caption"] == CAPTION_FULL


def test_modeled_rate(two_way):
    mr = two_way["modeled_rate"]
    assert mr is None or (isinstance(mr, (int, float)) and 0.0 <= mr <= 0.6)


def test_no_mongo_id_leak(two_way):
    assert "_id" not in two_way


# --- caching / idempotency ---
def test_repeat_call_cached_same_values(client, default_cfg, two_way):
    t0 = time.time()
    r = client.post(f"{BASE_URL}/api/two-way-sensitivity", json={"config": default_cfg}, timeout=600)
    assert r.status_code == 200, r.text[:300]
    elapsed = time.time() - t0
    print(f"cached call latency: {elapsed:.2f}s")
    assert r.json() == two_way, "cached repeat call returned different values"


# --- auth / validation ---
def test_requires_auth(default_cfg):
    r = requests.post(f"{BASE_URL}/api/two-way-sensitivity", json={"config": default_cfg},
                      headers={"X-Test-No-Auth": "1"}, timeout=120)
    assert r.status_code in (401, 403), f"unauthenticated call returned {r.status_code}"


def test_bad_config_rejected(client):
    r = client.post(f"{BASE_URL}/api/two-way-sensitivity", json={"config": {"garbage": True}}, timeout=300)
    assert r.status_code in (400, 422), f"expected 4xx for junk config, got {r.status_code}: {r.text[:300]}"
