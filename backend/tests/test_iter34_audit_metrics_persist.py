"""Iteration 34 — Audit Mode enhancements over HTTP.

Covers:
  * POST /api/audit/compare -> attribution_by_metric (3 metrics, each waterfall closes)
  * legacy top-level `attribution` == attribution_by_metric.after_tax_to_heirs_secure10
  * PUT/GET /api/audit/{workspace_id} persistence + error cases
"""
import copy
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

_fe = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")

MASTER_PIN = "i4m07MnVDhpTYkc1giC6wWDv"
METRICS = ["after_tax_to_heirs_secure10", "lifetime_tax_nominal", "federal_estate_tax_no_trust"]


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/pin/verify", json={"pin": MASTER_PIN},
                      headers={"X-Test-No-Auth": "1"}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"master pin verify failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("token")
    assert isinstance(tok, str) and tok
    return tok


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}",
                      "X-Session-Token": str(uuid.uuid4())})
    return s


@pytest.fixture(scope="session")
def default_cfg(client):
    from defaults import DEFAULT_SCENARIO
    return copy.deepcopy(DEFAULT_SCENARIO)


@pytest.fixture(scope="session")
def two_cfgs(default_cfg):
    review = copy.deepcopy(default_cfg)
    planner = copy.deepcopy(default_cfg)
    ti = next(i for i, a in enumerate(review["accounts"]) if a["tax_type"] == "Taxable")
    review["accounts"][ti]["return"] = 0.07
    planner["accounts"][ti]["return"] = 0.08
    review["legacy"]["heir_federal_rate"] = 0.36
    planner["legacy"]["heir_federal_rate"] = 0.26
    return review, planner, ti


@pytest.fixture(scope="session")
def compare_result(client, two_cfgs):
    review, planner, _ = two_cfgs
    r = client.post(f"{BASE_URL}/api/audit/compare",
                    json={"review_config": review, "planner_config": planner}, timeout=180)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
    return r.json()


# ---------------- per-metric attribution ----------------
class TestAttributionByMetric:
    def test_keys_and_labels(self, compare_result):
        by = compare_result["attribution_by_metric"]
        assert set(by.keys()) == set(METRICS)
        assert set(compare_result["metric_labels"].keys()) == set(METRICS)

    @pytest.mark.parametrize("metric", METRICS)
    def test_waterfall_closes(self, compare_result, metric):
        wf_obj = compare_result["attribution_by_metric"][metric]
        assert wf_obj["metric"] == metric
        wf = wf_obj["waterfall"]
        assert wf[0]["type"] == "start"
        assert wf[0]["value"] == pytest.approx(wf_obj["planner_outcome"], abs=0.5)
        assert wf[-1]["type"] == "end"
        assert wf[-1]["value"] == pytest.approx(wf_obj["review_outcome"], abs=0.5)
        steps = [w for w in wf if w["type"] == "step"]
        residual = [w for w in wf if w["type"] == "residual"]
        assert len(residual) == 1
        explained = sum(s["value"] for s in steps)
        assert explained == pytest.approx(wf_obj["explained"], abs=0.5)
        assert explained + wf_obj["interaction_residual"] == pytest.approx(wf_obj["total_gap"], abs=0.5)
        # total_gap must equal review - planner for that metric
        d = compare_result["outcomes"]["deltas"][metric]
        assert wf_obj["total_gap"] == pytest.approx(d["delta_nominal"], abs=0.5)

    @pytest.mark.parametrize("metric", METRICS)
    def test_top_driver_is_largest_step(self, compare_result, metric):
        wf_obj = compare_result["attribution_by_metric"][metric]
        steps = [w for w in wf_obj["waterfall"] if w["type"] == "step"]
        if not steps:
            assert wf_obj["top_driver"] is None
            return
        largest = max(steps, key=lambda s: abs(s["value"]))["label"]
        assert wf_obj["top_driver"] == largest
        paths = {d["path"] for d in compare_result["assumption_diff"]["list"]}
        assert wf_obj["top_driver"] in paths

    def test_legacy_attribution_matches_heirs_metric(self, compare_result):
        assert compare_result["attribution"] == compare_result["attribution_by_metric"]["after_tax_to_heirs_secure10"]

    def test_metrics_differ_from_each_other(self, compare_result):
        by = compare_result["attribution_by_metric"]
        gaps = [by[m]["total_gap"] for m in METRICS]
        # heirs vs lifetime tax must not be the identical waterfall
        assert by["after_tax_to_heirs_secure10"]["waterfall"] != by["lifetime_tax_nominal"]["waterfall"], gaps


# ---------------- workspace persistence ----------------
class TestAuditPersistence:
    @pytest.fixture(scope="class")
    def workspace_id(self, client):
        r = client.post(f"{BASE_URL}/api/workspaces", json={"name": "TEST_audit_ws"}, timeout=60)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        wid = r.json()["id"]
        yield wid
        client.delete(f"{BASE_URL}/api/workspaces/{wid}", timeout=60)

    def test_put_then_get_roundtrip(self, client, workspace_id, two_cfgs):
        _, planner, ti = two_cfgs
        r = client.put(f"{BASE_URL}/api/audit/{workspace_id}",
                       json={"planner_config": planner, "label": "TEST_planner_v1"}, timeout=60)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.json().get("ok") is True

        g = client.get(f"{BASE_URL}/api/audit/{workspace_id}", timeout=60)
        assert g.status_code == 200, g.text[:300]
        body = g.json()
        assert body["label"] == "TEST_planner_v1"
        assert body["updated_at"]
        got = body["planner_config"]
        assert got["accounts"][ti]["return"] == pytest.approx(0.08)
        assert got["legacy"]["heir_federal_rate"] == pytest.approx(0.26)
        assert got == planner

    def test_overwrite_updates_config(self, client, workspace_id, two_cfgs):
        _, planner, ti = two_cfgs
        cfg2 = copy.deepcopy(planner)
        cfg2["accounts"][ti]["return"] = 0.055
        r = client.put(f"{BASE_URL}/api/audit/{workspace_id}",
                       json={"planner_config": cfg2, "label": "TEST_planner_v2"}, timeout=60)
        assert r.status_code == 200
        g = client.get(f"{BASE_URL}/api/audit/{workspace_id}", timeout=60)
        assert g.json()["planner_config"]["accounts"][ti]["return"] == pytest.approx(0.055)
        assert g.json()["label"] == "TEST_planner_v2"

    def test_bad_id_rejected(self, client, two_cfgs):
        _, planner, _ = two_cfgs
        r = client.put(f"{BASE_URL}/api/audit/not-a-uuid", json={"planner_config": planner}, timeout=60)
        assert r.status_code == 400, f"{r.status_code}: {r.text[:200]}"
        g = client.get(f"{BASE_URL}/api/audit/not-a-uuid", timeout=60)
        assert g.status_code == 400

    def test_nonexistent_id_404(self, client, two_cfgs):
        _, planner, _ = two_cfgs
        missing = "11111111-2222-3333-4444-555555555555"
        r = client.put(f"{BASE_URL}/api/audit/{missing}", json={"planner_config": planner}, timeout=60)
        assert r.status_code == 404, f"{r.status_code}: {r.text[:200]}"
        g = client.get(f"{BASE_URL}/api/audit/{missing}", timeout=60)
        assert g.status_code == 404

    def test_requires_auth(self, two_cfgs):
        _, planner, _ = two_cfgs
        missing = "11111111-2222-3333-4444-555555555555"
        r = requests.get(f"{BASE_URL}/api/audit/{missing}",
                         headers={"X-Test-No-Auth": "1"}, timeout=60)
        assert r.status_code in (401, 403), f"{r.status_code}: {r.text[:200]}"
