"""Server-side tests for analytics, centrality, transforms and projects.

Run with:  python -m pytest -q tests
Uses the Flask test client (no network bind, debug stays off).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import node_mapper  # noqa: E402

SAMPLE = {
    "nodes": {"a": {"id": "a"}, "b": {"id": "b"}, "c": {"id": "c"}},
    "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "c"}],
}


def client():
    node_mapper.app.config["TESTING"] = True
    return node_mapper.app.test_client()


def test_analytics_stats():
    r = client().post("/analytics", json={"graph": SAMPLE})
    assert r.status_code == 200
    stats = r.get_json()["stats"]
    assert stats["nodeCount"] == 3
    assert stats["edgeCount"] == 2
    assert stats["components"] == 1


def test_shortest_path_bfs():
    r = client().post("/analytics", json={"graph": SAMPLE, "start": "a", "end": "c", "algorithm": "bfs"})
    assert r.status_code == 200
    assert r.get_json()["path"]["nodes"] == ["a", "b", "c"]


def test_centrality_broker_has_highest_betweenness():
    r = client().post("/api/centrality", json={"graph": SAMPLE})
    assert r.status_code == 200
    m = r.get_json()["metrics"]
    assert m["b"]["betweenness"] >= m["a"]["betweenness"]
    assert m["b"]["degree"] == 2


def test_transform_returns_entities():
    r = client().post("/api/transform", json={"transformId": "to_ip", "entity": {"type": "domain", "value": "x.com"}})
    assert r.status_code == 200
    assert len(r.get_json()["entities"]) >= 1


def test_bad_transform_id_is_rejected():
    r = client().post("/api/transform", json={"transformId": "nope", "entity": {"type": "domain", "value": "x"}})
    assert r.status_code in (400, 404)


def test_project_round_trip():
    c = client()
    created = c.post("/api/projects", json={"name": "T", "graph": SAMPLE})
    assert created.status_code in (200, 201)
    pid = created.get_json()["id"]
    got = c.get(f"/api/projects/{pid}")
    assert got.status_code == 200
    assert got.get_json()["graph"]["nodes"].keys() == SAMPLE["nodes"].keys()
