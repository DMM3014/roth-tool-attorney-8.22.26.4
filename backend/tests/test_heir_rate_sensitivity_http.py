"""HTTP tests for POST /api/legacy/heir-rate-sensitivity (Iteration 82).

Verifies auth gate + shape + monotonicity + clamp/dedupe behavior end-to-end.
"""
import os
import pytest
import requests
from dotenv import dotenv_values

_frontend_env = dotenv_values("/app/frontend/.env")
_base = os.environ.get("REACT_APP_BACKEND_URL") or _frontend_env.get("REACT_APP_BACKEND_URL")
if not _base:
    raise RuntimeError("REACT_APP_BACKEND_URL missing from env and /app/frontend/.env")
BASE_URL = _base.rstrip("/")
MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify",
                      json={"pin": MASTER_PIN}, timeout=15)
    assert r.status_code == 200, f"auth failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def default_config(token):
    r = requests.get(f"{BASE_URL}/api/defaults",
                     headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestHeirRateSensitivityHttp:
    def test_requires_auth(self, default_config):
        # conftest auto-injects a bearer; opt out via X-Test-No-Auth (see conftest).
        r = requests.post(f"{BASE_URL}/api/legacy/heir-rate-sensitivity",
                          json={"config": default_config},
                          headers={"X-Test-No-Auth": "1"}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_default_rates_shape(self, token, default_config):
        r = requests.post(f"{BASE_URL}/api/legacy/heir-rate-sensitivity",
                          json={"config": default_config},
                          headers={"Authorization": f"Bearer {token}"},
                          timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "modeled_rate" in data and isinstance(data["modeled_rate"], (int, float))
        assert isinstance(data["rates"], list) and len(data["rates"]) >= 3
        assert set(("with_conversions", "no_conversions")).issubset(data["branches"])
        for branch in ("with_conversions", "no_conversions"):
            entries = data["branches"][branch]
            assert len(entries) == len(data["rates"])
            for e in entries:
                assert "after_tax_estate_to_heirs" in e
                assert "rate" in e
                assert "is_modeled" in e
        assert "no_conversions" in data["lifetime_taxes"]
        assert "with_conversions" in data["lifetime_taxes"]

    def test_higher_rate_reduces_no_conv_inheritance(self, token, default_config):
        r = requests.post(f"{BASE_URL}/api/legacy/heir-rate-sensitivity",
                          json={"config": default_config,
                                "heir_rates": [0.12, 0.24, 0.40]},
                          headers={"Authorization": f"Bearer {token}"},
                          timeout=60)
        assert r.status_code == 200, r.text
        no_conv = {round(e["rate"], 4): e["after_tax_estate_to_heirs"]
                   for e in r.json()["branches"]["no_conversions"]}
        assert no_conv[0.12] > no_conv[0.24] > no_conv[0.40]

    def test_full_conversion_flat_across_rates(self, token, default_config):
        r = requests.post(f"{BASE_URL}/api/legacy/heir-rate-sensitivity",
                          json={"config": default_config,
                                "heir_rates": [0.12, 0.40]},
                          headers={"Authorization": f"Bearer {token}"},
                          timeout=60)
        assert r.status_code == 200
        vals = {round(e["after_tax_estate_to_heirs"], 2)
                for e in r.json()["branches"]["with_conversions"]}
        assert len(vals) == 1, f"expected flat with-conversions inheritance, got {vals}"

    def test_rates_clamped_and_deduped(self, token, default_config):
        r = requests.post(f"{BASE_URL}/api/legacy/heir-rate-sensitivity",
                          json={"config": default_config,
                                "heir_rates": [0.2, 0.2, 5.0, -1.0]},
                          headers={"Authorization": f"Bearer {token}"},
                          timeout=60)
        assert r.status_code == 200
        rates = r.json()["rates"]
        assert rates == sorted(set(rates))
        assert all(0.0 <= r <= 0.6 for r in rates)
