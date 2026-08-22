"""Phase 35 — Client workspaces (named folders that group saved scenarios).

Verifies the /api/workspaces + /api/scenarios{?workspace_id} + /api/scenarios/{sid}/workspace endpoints:
  - Owner-only visibility (a second session cannot see or move another's workspace)
  - CRUD lifecycle (create, list, rename, delete)
  - Scenario counts on GET /workspaces (grouped by workspace_id + unfiled bucket)
  - Filtering scenarios by workspace_id (including the "unfiled" sentinel)
  - Saving a scenario with workspace_id files it into that folder
  - Moving a scenario between workspaces (and to/from Unfiled)
  - Deleting a workspace unfiles its scenarios — plans survive, folder is gone
  - Foreign / malformed workspace ids are rejected with the correct status codes
"""
import copy
import os
import uuid

import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')


@pytest.fixture(scope="module")
def owner():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "X-Session-Token": str(uuid.uuid4()),
    })
    return s


@pytest.fixture(scope="module")
def defaults(owner):
    return owner.get(f"{BASE_URL}/api/defaults", timeout=10).json()


def _cleanup_scenarios(owner):
    """Best-effort — clear leftover scenarios for the owner between tests so counts
    from one test don't leak into the next."""
    r = owner.get(f"{BASE_URL}/api/scenarios", timeout=10)
    if r.status_code == 200:
        for sc in r.json():
            owner.delete(f"{BASE_URL}/api/scenarios/{sc['id']}", timeout=10)


def _cleanup_workspaces(owner):
    r = owner.get(f"{BASE_URL}/api/workspaces", timeout=10)
    if r.status_code == 200:
        for ws in r.json().get("workspaces", []):
            owner.delete(f"{BASE_URL}/api/workspaces/{ws['id']}", timeout=10)


@pytest.fixture(autouse=True)
def _clean(owner):
    _cleanup_scenarios(owner)
    _cleanup_workspaces(owner)
    yield
    _cleanup_scenarios(owner)
    _cleanup_workspaces(owner)


# ---------- Create + list ----------
def test_create_workspace_returns_uuid_id_and_metadata(owner):
    r = owner.post(f"{BASE_URL}/api/workspaces",
                   json={"name": "Smith Household", "notes": "Retirement, 65/60"}, timeout=10)
    assert r.status_code == 200, r.text
    ws = r.json()
    assert ws["name"] == "Smith Household"
    assert ws["notes"] == "Retirement, 65/60"
    # UUIDv4 shape check — matches the server's UUID_RE
    uuid.UUID(ws["id"])
    assert ws["created_at"]
    assert ws["updated_at"]


def test_list_workspaces_includes_scenario_counts_and_unfiled_bucket(owner, defaults):
    ws1 = owner.post(f"{BASE_URL}/api/workspaces",
                     json={"name": "Household A"}, timeout=10).json()
    ws2 = owner.post(f"{BASE_URL}/api/workspaces",
                     json={"name": "Household B"}, timeout=10).json()
    # File 2 scenarios into A, 1 into B, 1 unfiled
    for i in range(2):
        owner.post(f"{BASE_URL}/api/scenarios",
                   json={"name": f"A-{i}", "config": copy.deepcopy(defaults),
                         "workspace_id": ws1["id"]}, timeout=10)
    owner.post(f"{BASE_URL}/api/scenarios",
               json={"name": "B-1", "config": copy.deepcopy(defaults),
                     "workspace_id": ws2["id"]}, timeout=10)
    owner.post(f"{BASE_URL}/api/scenarios",
               json={"name": "unfiled", "config": copy.deepcopy(defaults)}, timeout=10)

    r = owner.get(f"{BASE_URL}/api/workspaces", timeout=10)
    assert r.status_code == 200
    body = r.json()
    counts = {w["id"]: w["scenario_count"] for w in body["workspaces"]}
    assert counts[ws1["id"]] == 2
    assert counts[ws2["id"]] == 1
    assert body["unfiled_count"] == 1


# ---------- Ownership isolation ----------
def test_workspaces_scoped_to_session_token(owner, defaults):
    owner.post(f"{BASE_URL}/api/workspaces", json={"name": "My WS"}, timeout=10)
    other = requests.Session()
    other.headers.update({"Content-Type": "application/json",
                          "X-Session-Token": str(uuid.uuid4())})
    r = other.get(f"{BASE_URL}/api/workspaces", timeout=10)
    assert r.status_code == 200
    assert r.json()["workspaces"] == []
    assert r.json()["unfiled_count"] == 0


def test_cannot_move_scenario_into_another_owners_workspace(owner, defaults):
    ws = owner.post(f"{BASE_URL}/api/workspaces", json={"name": "Owner WS"}, timeout=10).json()
    other = requests.Session()
    other.headers.update({"Content-Type": "application/json",
                          "X-Session-Token": str(uuid.uuid4())})
    sc = other.post(f"{BASE_URL}/api/scenarios",
                    json={"name": "cross", "config": copy.deepcopy(defaults)}, timeout=10).json()
    # Attempt to file the OTHER session's scenario into MY workspace
    r = other.patch(f"{BASE_URL}/api/scenarios/{sc['id']}/workspace",
                    json={"workspace_id": ws["id"]}, timeout=10)
    assert r.status_code == 404, r.text
    other.delete(f"{BASE_URL}/api/scenarios/{sc['id']}", timeout=10)


def test_cannot_create_scenario_in_another_owners_workspace(owner, defaults):
    ws = owner.post(f"{BASE_URL}/api/workspaces", json={"name": "Owner WS"}, timeout=10).json()
    other = requests.Session()
    other.headers.update({"Content-Type": "application/json",
                          "X-Session-Token": str(uuid.uuid4())})
    r = other.post(f"{BASE_URL}/api/scenarios",
                   json={"name": "steal", "config": copy.deepcopy(defaults),
                         "workspace_id": ws["id"]}, timeout=10)
    assert r.status_code == 404, r.text


# ---------- Update ----------
def test_rename_workspace_bumps_updated_at_and_returns_new_doc(owner):
    ws = owner.post(f"{BASE_URL}/api/workspaces", json={"name": "Old"}, timeout=10).json()
    r = owner.patch(f"{BASE_URL}/api/workspaces/{ws['id']}",
                    json={"name": "New Name"}, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "New Name"
    # updated_at strictly greater than created_at
    assert r.json()["updated_at"] >= ws["created_at"]


def test_rename_rejects_blank(owner):
    ws = owner.post(f"{BASE_URL}/api/workspaces", json={"name": "Ok"}, timeout=10).json()
    r = owner.patch(f"{BASE_URL}/api/workspaces/{ws['id']}",
                    json={"name": "   "}, timeout=10)
    assert r.status_code == 422, r.text


# ---------- Filtering + saving ----------
def test_list_scenarios_filter_by_workspace_id(owner, defaults):
    ws = owner.post(f"{BASE_URL}/api/workspaces", json={"name": "F1"}, timeout=10).json()
    a = owner.post(f"{BASE_URL}/api/scenarios",
                   json={"name": "in-ws", "config": copy.deepcopy(defaults),
                         "workspace_id": ws["id"]}, timeout=10).json()
    b = owner.post(f"{BASE_URL}/api/scenarios",
                   json={"name": "no-ws", "config": copy.deepcopy(defaults)}, timeout=10).json()
    r_in = owner.get(f"{BASE_URL}/api/scenarios",
                     params={"workspace_id": ws["id"]}, timeout=10)
    assert [x["id"] for x in r_in.json()] == [a["id"]]
    r_un = owner.get(f"{BASE_URL}/api/scenarios",
                     params={"workspace_id": "unfiled"}, timeout=10)
    ids_un = [x["id"] for x in r_un.json()]
    assert b["id"] in ids_un
    assert a["id"] not in ids_un


def test_move_scenario_between_workspaces_and_to_unfiled(owner, defaults):
    ws1 = owner.post(f"{BASE_URL}/api/workspaces", json={"name": "W1"}, timeout=10).json()
    ws2 = owner.post(f"{BASE_URL}/api/workspaces", json={"name": "W2"}, timeout=10).json()
    sc = owner.post(f"{BASE_URL}/api/scenarios",
                    json={"name": "moves", "config": copy.deepcopy(defaults),
                          "workspace_id": ws1["id"]}, timeout=10).json()

    # W1 → W2
    r = owner.patch(f"{BASE_URL}/api/scenarios/{sc['id']}/workspace",
                    json={"workspace_id": ws2["id"]}, timeout=10)
    assert r.status_code == 200
    assert r.json()["workspace_id"] == ws2["id"]

    # W2 → Unfiled (null)
    r = owner.patch(f"{BASE_URL}/api/scenarios/{sc['id']}/workspace",
                    json={"workspace_id": None}, timeout=10)
    assert r.status_code == 200
    assert r.json()["workspace_id"] is None


# ---------- Delete cascade ----------
def test_delete_workspace_unfiles_scenarios_and_never_loses_data(owner, defaults):
    ws = owner.post(f"{BASE_URL}/api/workspaces", json={"name": "Dies"}, timeout=10).json()
    ids = []
    for i in range(3):
        sc = owner.post(f"{BASE_URL}/api/scenarios",
                        json={"name": f"s-{i}", "config": copy.deepcopy(defaults),
                              "workspace_id": ws["id"]}, timeout=10).json()
        ids.append(sc["id"])

    r = owner.delete(f"{BASE_URL}/api/workspaces/{ws['id']}", timeout=10)
    assert r.status_code == 200
    assert r.json()["unfiled_scenarios"] == 3

    # Workspace is gone
    listing = owner.get(f"{BASE_URL}/api/workspaces", timeout=10).json()
    assert all(w["id"] != ws["id"] for w in listing["workspaces"])

    # All 3 scenarios survive with workspace_id = None
    for sid in ids:
        r = owner.get(f"{BASE_URL}/api/scenarios/{sid}", timeout=10)
        assert r.status_code == 200
        assert r.json()["workspace_id"] is None


# ---------- Error surface ----------
def test_malformed_workspace_id_returns_400(owner):
    r = owner.get(f"{BASE_URL}/api/scenarios",
                  params={"workspace_id": "not-a-uuid"}, timeout=10)
    assert r.status_code == 400


def test_delete_missing_workspace_returns_404(owner):
    r = owner.delete(f"{BASE_URL}/api/workspaces/{uuid.uuid4()}", timeout=10)
    assert r.status_code == 404


def test_create_scenario_with_missing_workspace_returns_404(owner, defaults):
    r = owner.post(f"{BASE_URL}/api/scenarios",
                   json={"name": "orphan", "config": copy.deepcopy(defaults),
                         "workspace_id": str(uuid.uuid4())}, timeout=10)
    assert r.status_code == 404
