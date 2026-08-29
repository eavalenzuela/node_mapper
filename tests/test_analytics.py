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


def test_centrality_survives_null_weight_and_nondict_edge():
    # A present-but-null weight, a non-dict edge, and a non-numeric width must
    # not raise a 500 out of build_adjacency.
    graph = {
        "nodes": {"a": {"id": "a"}, "b": {"id": "b"}},
        "edges": [
            {"source": "a", "target": "b", "weight": None},
            "x",
            {"source": "a", "target": "b", "width": "abc"},
        ],
    }
    r = client().post("/api/centrality", json={"graph": graph})
    assert r.status_code == 200


def test_analytics_survives_nondict_edge():
    graph = {"nodes": {"a": {"id": "a"}, "b": {"id": "b"}}, "edges": ["x", {"source": "a", "target": "b"}]}
    r = client().post("/analytics", json={"graph": graph})
    assert r.status_code == 200
    assert r.get_json()["stats"]["edgeCount"] == 2


# --- Centrality alignment with the client implementation --------------------

def test_centrality_betweenness_undirected_halved():
    # Undirected betweenness on the a-b-c chain: broker b == 1.0 (raw Brandes 2.0
    # halved), matching the client's /2 correction.
    m = client().post("/api/centrality", json={"graph": SAMPLE}).get_json()["metrics"]
    assert m["b"]["betweenness"] == 1.0
    assert m["a"]["betweenness"] == 0.0


def test_centrality_closeness_ignores_edge_width():
    # Closeness is unweighted (hop counts) on both server and client, so the
    # broker b stays equidistant to both leaves regardless of differing widths.
    graph = {
        "nodes": {"a": {"id": "a"}, "b": {"id": "b"}, "c": {"id": "c"}},
        "edges": [
            {"source": "a", "target": "b", "width": 9},
            {"source": "b", "target": "c", "width": 1},
        ],
    }
    m = client().post("/api/centrality", json={"graph": graph}).get_json()["metrics"]
    assert round(m["b"]["closeness"], 3) == 1.0


# --- Anonymous project isolation -------------------------------------------

def test_anonymous_projects_are_scoped_per_session():
    a = client()
    b = client()
    pid = a.post("/api/projects", json={"name": "SecretA", "graph": SAMPLE}).get_json()["id"]
    # A different anonymous session must not list, read or delete A's project.
    b_ids = {p["id"] for p in b.get("/api/projects").get_json()["projects"]}
    assert pid not in b_ids
    assert b.get(f"/api/projects/{pid}").status_code in (403, 404)
    assert b.delete(f"/api/projects/{pid}").status_code in (403, 404)
    # A can still reach its own project.
    assert a.get(f"/api/projects/{pid}").status_code == 200


# --- Transforms -------------------------------------------------------------
#
# Transforms hit real sources, so every test here stubs the one seam they go
# through -- node_mapper._fetch_json for HTTP sources, socket.getaddrinfo for
# DNS. Nothing in this file may touch the network.


def run(transform_id, etype, value, **params):
    return client().post("/api/transform", json={
        "transformId": transform_id,
        "entity": {"type": etype, "value": value},
        "params": params,
    })


def stub_fetch(monkeypatch, payload, expect_url=None):
    """Point _fetch_json at a canned document; payload may be a dict/list or a
    callable taking the url."""
    seen = {}

    def fake(url, timeout=None, allow_404=False):
        seen["url"] = url
        result = payload(url) if callable(payload) else payload
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(node_mapper, "_fetch_json", fake)
    return seen


def test_to_ip_returns_both_address_families(monkeypatch):
    monkeypatch.setattr(node_mapper.socket, "getaddrinfo", lambda *a, **k: [
        (node_mapper.socket.AF_INET, None, None, "", ("93.184.216.34", 0)),
        (node_mapper.socket.AF_INET, None, None, "", ("93.184.216.34", 0)),  # duplicate
        (node_mapper.socket.AF_INET6, None, None, "", ("2606:2800:220:1::248", 0, 0, 0)),
    ])
    body = run("to_ip", "domain", "example.com").get_json()
    assert [e["type"] for e in body["entities"]] == ["ipv4", "ipv6"]
    assert body["synthetic"] is False


def test_to_ip_reports_dns_failure_as_bad_gateway(monkeypatch):
    def boom(*a, **k):
        raise node_mapper.socket.gaierror(-2, "Name or service not known")

    monkeypatch.setattr(node_mapper.socket, "getaddrinfo", boom)
    r = run("to_ip", "domain", "nx.example.com")
    assert r.status_code == 502
    assert "DNS lookup" in r.get_json()["error"]


def test_subdomains_strip_wildcards_and_drop_the_apex(monkeypatch):
    stub_fetch(monkeypatch, [
        {"name_value": "*.example.com\nmail.example.com"},
        {"name_value": "example.com"},               # the apex is not a subdomain
        {"name_value": "deep.dev.example.com"},
        {"name_value": "elsewhere.org"},             # unrelated name in the same cert
    ])
    ents = run("to_subdomains", "domain", "example.com").get_json()["entities"]
    values = [e["value"] for e in ents]
    assert values == ["mail.example.com", "deep.dev.example.com"]


def test_subdomains_fall_back_to_certspotter_when_crtsh_fails(monkeypatch):
    def by_url(url):
        if "crt.sh" in url:
            return node_mapper.TransformSourceError("crt.sh returned HTTP 502.")
        return [{"dns_names": ["*.atlas.example.com", "atlas.example.com"]}]

    stub_fetch(monkeypatch, by_url)
    body = run("to_subdomains", "domain", "example.com").get_json()
    assert [e["value"] for e in body["entities"]] == ["atlas.example.com"]
    assert "certspotter" in body["note"]


def test_both_ct_sources_failing_is_an_error(monkeypatch):
    stub_fetch(monkeypatch, node_mapper.TransformSourceError("down."))
    r = run("to_subdomains", "domain", "example.com")
    assert r.status_code == 502
    assert "Both certificate-transparency sources failed" in r.get_json()["error"]


def test_empty_property_values_are_dropped(monkeypatch):
    # A source with no country must leave the field unset rather than stamping
    # "" over whatever the analyst typed.
    stub_fetch(monkeypatch, {
        "name": "EXAMPLE-NET",
        "country": "",
        "entities": [{"roles": ["registrant"],
                      "vcardArray": ["vcard", [["fn", {}, "text", "Example Inc"]]]}],
    })
    props = run("to_asn", "ipv4", "8.8.8.8").get_json()["entities"][0]["properties"]
    assert "country" not in props


def test_whois_maps_rdap_roles_and_lifts_registrar_to_the_source(monkeypatch):
    stub_fetch(monkeypatch, {
        "events": [{"eventAction": "registration", "eventDate": "1995-08-14T04:00:00Z"}],
        "nameservers": [{"ldhName": "NS1.EXAMPLE.NET."}],
        "entities": [{
            "roles": ["registrar"],
            "vcardArray": ["vcard", [["fn", {}, "text", "Reserved Registrar"]]],
            "entities": [{
                "roles": ["abuse"],
                "vcardArray": ["vcard", [["email", {}, "text", "abuse@registrar.test"]]],
            }],
        }],
    })
    body = run("whois", "domain", "example.com").get_json()
    by_type = {e["type"]: e["value"] for e in body["entities"]}
    assert by_type["organization"] == "Reserved Registrar"
    # The abuse contact is nested inside the registrar entity, not top level.
    assert by_type["email"] == "abuse@registrar.test"
    assert by_type["host"] == "ns1.example.net"
    assert body["sourceProperties"]["registrar"] == "Reserved Registrar"
    assert body["sourceProperties"]["registered"].startswith("1995")


def test_asn_uses_rdap_org_and_origin_as(monkeypatch):
    stub_fetch(monkeypatch, {
        "name": "GOOGLE",
        "country": "US",
        "handle": "NET-8-8-8-0-1",
        "cidr0_cidrs": [{"v4prefix": "8.8.8.0", "length": 24}],
        "arin_originas0_originautnums": [15169],
        "entities": [{
            "roles": ["registrant"],
            "vcardArray": ["vcard", [["fn", {}, "text", "Google LLC"]]],
        }],
    })
    body = run("to_asn", "ipv4", "8.8.8.8").get_json()
    assert body["entities"][0]["type"] == "organization"
    assert body["entities"][0]["value"] == "Google LLC"
    assert body["entities"][0]["properties"]["netblock"] == "8.8.8.0/24"
    assert body["sourceProperties"]["asn"] == "AS15169"


def test_geolocate_emits_lng_for_map(monkeypatch):
    # The map view reads properties.lng; the transform must emit 'lng', not 'lon'.
    stub_fetch(monkeypatch, {"success": True, "latitude": 37.4, "longitude": -122.1,
                             "city": "Mountain View", "region": "California", "country": "United States"})
    props = run("geolocate", "ipv4", "8.8.8.8").get_json()["entities"][0]["properties"]
    assert "lng" in props
    assert "lon" not in props
    assert props["address"] == "Mountain View, California, United States"


def test_known_ports_reads_internetdb(monkeypatch):
    stub_fetch(monkeypatch, {
        "ports": [22, 443, "not-a-port"],
        "hostnames": ["dns.google"],
        "vulns": ["CVE-2021-1234"],
    })
    body = run("to_ports", "ipv4", "8.8.8.8").get_json()
    ports = [e for e in body["entities"] if e["type"] == "port"]
    assert [p["value"] for p in ports] == ["22", "443"]
    assert ports[0]["properties"]["service"] == "ssh"
    assert any(e["type"] == "domain" and e["value"] == "dns.google" for e in body["entities"])
    assert body["sourceProperties"]["vulns"] == "CVE-2021-1234"


def test_unknown_host_is_an_empty_result_not_an_error(monkeypatch):
    # InternetDB answers 404 for an address it has never seen; _fetch_json turns
    # that into None, which is "nothing found", not a failure.
    stub_fetch(monkeypatch, None)
    r = run("to_ports", "ipv4", "8.8.8.8")
    assert r.status_code == 200
    assert r.get_json()["entities"] == []
    assert "no record" in r.get_json()["note"].lower()


def test_archived_urls_skip_the_cdx_header_row(monkeypatch):
    stub_fetch(monkeypatch, [["original"], ["https://example.com/a"], ["https://example.com/b"]])
    values = [e["value"] for e in run("to_url", "domain", "example.com").get_json()["entities"]]
    assert values == ["https://example.com/a", "https://example.com/b"]


def test_absurdly_long_archived_urls_are_dropped(monkeypatch):
    # The archive really does hold kilobyte-long spam paths; each one would
    # become a node label.
    spam = "https://example.com/" + ("x" * 4000)
    stub_fetch(monkeypatch, [["original"], [spam], ["https://example.com/ok"]])
    values = [e["value"] for e in run("to_url", "domain", "example.com").get_json()["entities"]]
    assert values == ["https://example.com/ok"]


def test_source_failure_is_reported_as_bad_gateway(monkeypatch):
    stub_fetch(monkeypatch, node_mapper.TransformSourceError("crt.sh is unreachable (timeout)."))
    r = run("to_subdomains", "domain", "example.com")
    assert r.status_code == 502
    assert "crt.sh" in r.get_json()["error"]


def test_private_addresses_are_refused(monkeypatch):
    # Nothing may send an internal address to a third-party source, so this must
    # fail before any fetch happens.
    called = []
    monkeypatch.setattr(node_mapper, "_fetch_json",
                        lambda *a, **k: called.append(a) or {})
    for value in ("10.0.0.1", "127.0.0.1", "169.254.1.1", "192.168.1.10"):
        r = run("geolocate", "ipv4", value)
        assert r.status_code == 400, value
    assert not called


def test_internal_hostnames_are_refused():
    for value in ("nas.local", "printer.lan", "box.internal"):
        assert run("to_subdomains", "domain", value).status_code == 400, value


def test_pasted_urls_are_normalised_to_a_hostname(monkeypatch):
    seen = stub_fetch(monkeypatch, [])
    run("to_url", "domain", "https://Example.COM/some/path?q=1")
    assert "example.com" in seen["url"]


def test_active_scan_is_off_unless_enabled(monkeypatch):
    monkeypatch.setattr(node_mapper, "ACTIVE_SCAN_ENABLED", False)
    r = run("tcp_scan", "ipv4", "8.8.8.8")
    assert r.status_code == 400
    assert "NM_ACTIVE_SCAN" in r.get_json()["error"]


def test_active_scan_probes_when_enabled(monkeypatch):
    monkeypatch.setattr(node_mapper, "ACTIVE_SCAN_ENABLED", True)
    opened = {22, 443}

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_connect(address, timeout=None):
        if address[1] in opened:
            return FakeConn()
        raise OSError("refused")

    monkeypatch.setattr(node_mapper.socket, "create_connection", fake_connect)
    # A private target is allowed here: mapping your own network is the point of
    # opting in.
    body = run("tcp_scan", "ipv4", "192.168.1.10").get_json()
    assert sorted(int(e["value"]) for e in body["entities"]) == [22, 443]


def test_listing_flags_synthetic_and_unavailable(monkeypatch):
    monkeypatch.setattr(node_mapper, "ACTIVE_SCAN_ENABLED", False)
    listing = {t["id"]: t for t in client().get("/api/transforms").get_json()["transforms"]}
    for tid in ("to_ip", "to_subdomains", "whois", "to_asn", "geolocate", "to_ports",
                "to_url", "tcp_scan", "reverse_ip", "person_to_social"):
        assert tid in listing, "missing transform " + tid
    assert listing["reverse_ip"]["synthetic"] is True
    assert listing["to_ip"]["synthetic"] is False
    assert listing["tcp_scan"]["available"] is False
    assert listing["to_ip"]["available"] is True


def test_synthetic_transforms_say_so_in_the_response():
    body = run("person_to_social", "person", "Jane Doe").get_json()
    assert body["synthetic"] is True
    assert all(e["type"] == "url" for e in body["entities"])


def test_transform_rejects_wrong_input_type():
    # reverse_ip only accepts ipv4; a domain must be rejected.
    r = run("reverse_ip", "domain", "x.com")
    assert r.status_code == 400


def test_synthetic_transforms_are_deterministic():
    first = run("reverse_ip", "ipv4", "1.2.3.4").get_json()
    second = run("reverse_ip", "ipv4", "1.2.3.4").get_json()
    assert first == second
