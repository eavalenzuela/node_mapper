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


# --- Density, self-loops, and distance stats -------------------------------

def test_stats_density_and_self_loops():
    graph = {
        "nodes": {"a": {"id": "a"}, "b": {"id": "b"}, "c": {"id": "c"}},
        # a-b, b-c, plus a self-loop on a.
        "edges": [
            {"source": "a", "target": "b"},
            {"source": "b", "target": "c"},
            {"source": "a", "target": "a"},
        ],
    }
    stats = client().post("/analytics", json={"graph": graph}).get_json()["stats"]
    assert stats["selfLoops"] == 1
    # 3 edges out of C(3,2)=3 possible undirected pairs -> density 1.0.
    assert stats["density"] == 1.0


def test_stats_diameter_and_avg_path_on_chain():
    # a-b-c chain: diameter 2 (a..c), avg path length over the component.
    stats = client().post("/analytics", json={"graph": SAMPLE}).get_json()["stats"]
    assert stats["diameter"] == 2
    assert stats["avgPathLength"] is not None
    assert stats["avgPathLength"] > 0


def test_stats_empty_graph_has_zero_density():
    stats = client().post("/analytics", json={"graph": {"nodes": {}, "edges": []}}).get_json()["stats"]
    assert stats["density"] == 0
    assert stats["selfLoops"] == 0
    assert stats["diameter"] is None


# --- Malformed payload guards ----------------------------------------------

def test_analytics_rejects_list_nodes():
    r = client().post("/analytics", json={"graph": {"nodes": [1, 2], "edges": []}})
    assert r.status_code == 400


def test_centrality_rejects_bad_edges():
    r = client().post("/api/centrality", json={"graph": {"nodes": {}, "edges": {"nope": 1}}})
    assert r.status_code == 400


# --- New transforms ---------------------------------------------------------

def test_new_transforms_are_listed():
    r = client().get("/api/transforms")
    ids = {t["id"] for t in r.get_json()["transforms"]}
    for tid in ["reverse_ip", "to_asn", "geolocate", "to_url", "person_to_social"]:
        assert tid in ids, "missing transform " + tid


def test_reverse_ip_transform():
    r = client().post("/api/transform", json={"transformId": "reverse_ip", "entity": {"type": "ipv4", "value": "10.0.0.1"}})
    assert r.status_code == 200
    ents = r.get_json()["entities"]
    assert ents and all(e["type"] == "domain" for e in ents)


def test_geolocate_and_asn_transforms():
    geo = client().post("/api/transform", json={"transformId": "geolocate", "entity": {"type": "ipv4", "value": "8.8.8.8"}})
    assert geo.status_code == 200
    assert geo.get_json()["entities"][0]["type"] == "location"
    asn = client().post("/api/transform", json={"transformId": "to_asn", "entity": {"type": "ipv4", "value": "8.8.8.8"}})
    assert asn.status_code == 200
    assert asn.get_json()["entities"][0]["type"] == "organization"


def test_person_to_social_and_to_url_transforms():
    soc = client().post("/api/transform", json={"transformId": "person_to_social", "entity": {"type": "person", "value": "Jane Doe"}})
    assert soc.status_code == 200
    assert all(e["type"] == "url" for e in soc.get_json()["entities"])
    url = client().post("/api/transform", json={"transformId": "to_url", "entity": {"type": "domain", "value": "example.com"}})
    assert url.status_code == 200
    assert all(e["value"].startswith("https://example.com") for e in url.get_json()["entities"])


def test_transform_rejects_wrong_input_type():
    # reverse_ip only accepts ipv4; a domain must be rejected.
    r = client().post("/api/transform", json={"transformId": "reverse_ip", "entity": {"type": "domain", "value": "x.com"}})
    assert r.status_code == 400


def test_transforms_are_deterministic():
    body = {"transformId": "geolocate", "entity": {"type": "ipv4", "value": "1.2.3.4"}}
    first = client().post("/api/transform", json=body).get_json()
    second = client().post("/api/transform", json=body).get_json()
    assert first == second
