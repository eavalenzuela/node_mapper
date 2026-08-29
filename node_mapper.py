"""Node Mapper backend.

A Flask application that serves the static client and provides:
  * the original in-memory graph endpoints (/, /nodes, /edges, /graph)
  * graph analytics (/analytics) and per-node centrality (/api/centrality)
  * SQLite-backed projects, version history, and optional session auth
  * a transform framework (/api/transform[s]) over keyless public sources

Transforms query real sources -- system DNS, RDAP, crt.sh, the Wayback CDX
index, Shodan's InternetDB, ipwho.is -- with no API keys and no extra
packages. Three of them (to_emails, reverse_ip, person_to_social) still return
synthetic data because nothing keyless answers them honestly; those are
flagged synthetic in the listing and in every response. Only tcp_scan touches
the subject, and only when NM_ACTIVE_SCAN=1.
"""

import contextlib
import hashlib
import ipaddress
import json
import os
import queue
import re
import secrets
import socket
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict, deque
from concurrent import futures
from datetime import datetime, timezone
from heapq import heappop, heappush
from uuid import uuid4

from flask import Flask, Response, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

# ============================================================================
# App configuration & security hardening
# ============================================================================

app = Flask(__name__, static_folder="static")

# Cap request bodies (8 MiB) to limit memory pressure / abuse.
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

# Secret key for signed session cookies. Override in production via env.
# We deliberately DO NOT ship a fixed fallback: a published constant would let
# anyone forge a validly-signed session cookie and impersonate any account. When
# SECRET_KEY is unset we mint a random per-process key instead; the trade-off is
# that existing sessions do not survive a restart.
_secret_key = os.environ.get("SECRET_KEY")
if not _secret_key:
    _secret_key = secrets.token_hex(32)
app.config["SECRET_KEY"] = _secret_key

# Path to the SQLite database, kept next to this script.
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "graph.db")

# Safety caps for the analytics endpoint (before running expensive algorithms).
MAX_ANALYTICS_NODES = 20000
MAX_ANALYTICS_EDGES = 100000

# Diameter / average-path-length require an all-pairs BFS (O(V * (V + E))), so
# they are only computed when the graph is small enough to stay responsive.
MAX_DISTANCE_STATS_NODES = 1500


def now_iso():
    """UTC timestamp in ISO-8601, used for created_at/updated_at columns."""
    return datetime.now(timezone.utc).isoformat()


def json_error(message, status):
    """Helper to return a consistent JSON error body with a status code."""
    return jsonify({"error": message}), status


# ============================================================================
# In-memory graph (legacy endpoints, retained for compatibility)
# ============================================================================

GRAPH = {
    "nodes": {},
    "edges": []
}


@app.route("/")
def serve_index():
    return send_from_directory("static", "index.html")


@app.route("/nodes", methods=["POST"])
def create_node():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Invalid or missing JSON body.", 400)
    node_id = str(uuid4())
    GRAPH["nodes"][node_id] = {
        "id": node_id,
        "x": data.get("x", 100),
        "y": data.get("y", 100),
        "label": data.get("label", "Node"),
    }
    return jsonify(GRAPH["nodes"][node_id])


@app.route("/edges", methods=["POST"])
def create_edge():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Invalid or missing JSON body.", 400)
    if "source" not in data or "target" not in data:
        return json_error("Edge requires 'source' and 'target'.", 400)
    GRAPH["edges"].append({
        "source": data["source"],
        "target": data["target"],
    })
    return jsonify({"status": "ok"})


@app.route("/graph", methods=["GET"])
def get_graph():
    return jsonify(GRAPH)


@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)


# ============================================================================
# SQLite persistence layer
# ============================================================================

def get_db():
    """Return a request-scoped SQLite connection (row access by name)."""
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_db(_exc):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they do not already exist (called on startup)."""
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE,
                password_hash TEXT,
                created_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                name TEXT,
                owner_id INTEGER,
                owner_token TEXT,
                data_json TEXT,
                created_at TEXT,
                updated_at TEXT
            )
            """
        )
        # Migrate older databases that predate per-session anonymous scoping.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(projects)").fetchall()}
        if "owner_token" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN owner_token TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS project_versions (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                data_json TEXT,
                created_at TEXT
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


# ============================================================================
# Authentication (session-based, OPTIONAL — anonymous use still works)
# ============================================================================

def current_user_id():
    """Return the logged-in user's id, or None for anonymous sessions."""
    return session.get("user_id")


def current_owner_token():
    """Stable per-session token identifying an anonymous owner.

    Authenticated users are scoped by their user_id and never need a token. For
    anonymous sessions we mint a random token (persisted in the signed session
    cookie) so distinct anonymous visitors cannot read, edit or delete each
    other's projects — previously every anonymous visitor shared one pool.
    """
    tok = session.get("owner_token")
    if not tok:
        tok = secrets.token_hex(16)
        session["owner_token"] = tok
    return tok


def _user_public(row):
    return {"id": row["id"], "username": row["username"]}


@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Invalid or missing JSON body.", 400)
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return json_error("Username and password are required.", 400)

    db = get_db()
    existing = db.execute(
        "SELECT id FROM users WHERE username = ?", (username,)
    ).fetchone()
    if existing is not None:
        return json_error("Username already exists.", 400)

    cur = db.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
        (username, generate_password_hash(password), now_iso()),
    )
    db.commit()
    user_id = cur.lastrowid
    session["user_id"] = user_id
    return jsonify({"id": user_id, "username": username})


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Invalid or missing JSON body.", 400)
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    db = get_db()
    row = db.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        return json_error("Invalid username or password.", 401)

    session["user_id"] = row["id"]
    return jsonify(_user_public(row))


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("user_id", None)
    return jsonify({"status": "ok"})


@app.route("/api/me", methods=["GET"])
def api_me():
    uid = current_user_id()
    if uid is None:
        return jsonify({"user": None})
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if row is None:
        # Stale session (user deleted) — treat as anonymous.
        session.pop("user_id", None)
        return jsonify({"user": None})
    return jsonify({"user": _user_public(row)})


# ============================================================================
# Projects, versions & ownership
# ============================================================================

def _owner_filter_clause(uid):
    """SQL fragment + params restricting rows to the current visibility scope.

    Authenticated users see only their own projects; anonymous sessions see
    only the anonymous projects created within their own session (scoped by a
    per-session owner_token), not every anonymous project.
    """
    if uid is None:
        return "owner_id IS NULL AND owner_token = ?", (current_owner_token(),)
    return "owner_id = ?", (uid,)


def _load_project_for_access(project_id, uid, require_owner=False):
    """Fetch a project row and check visibility.

    Returns (row, error_response). On success error_response is None.
    `require_owner` is used for mutating operations: an authenticated user may
    only mutate projects they own; anonymous sessions may only mutate
    anonymous-owned projects.
    """
    db = get_db()
    row = db.execute(
        "SELECT * FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    if row is None:
        return None, json_error("Project not found.", 404)

    owner_id = row["owner_id"]
    if uid is None:
        # Anonymous: may only touch anonymous projects created in THIS session.
        if owner_id is not None or row["owner_token"] != current_owner_token():
            return None, json_error("Not authorized for this project.", 403)
    else:
        # Authenticated: may only touch own projects.
        if owner_id != uid:
            return None, json_error("Not authorized for this project.", 403)
    return row, None


def _insert_version(db, project_id, data_json):
    db.execute(
        "INSERT INTO project_versions (project_id, data_json, created_at) "
        "VALUES (?, ?, ?)",
        (project_id, data_json, now_iso()),
    )


@app.route("/api/projects", methods=["GET"])
def list_projects():
    uid = current_user_id()
    where, params = _owner_filter_clause(uid)
    db = get_db()
    rows = db.execute(
        f"SELECT id, name, updated_at FROM projects WHERE {where} "
        "ORDER BY updated_at DESC",
        params,
    ).fetchall()
    projects = [
        {"id": r["id"], "name": r["name"], "updated_at": r["updated_at"]}
        for r in rows
    ]
    return jsonify({"projects": projects})


@app.route("/api/projects", methods=["POST"])
def create_project():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Invalid or missing JSON body.", 400)
    name = (data.get("name") or "Untitled Project").strip() or "Untitled Project"
    graph = data.get("graph") or {}
    data_json = json.dumps(graph)
    ts = now_iso()
    uid = current_user_id()
    # Anonymous projects are scoped to the creating session; authenticated
    # projects are scoped by owner_id and leave owner_token NULL.
    owner_token = None if uid is not None else current_owner_token()

    db = get_db()
    cur = db.execute(
        "INSERT INTO projects (name, owner_id, owner_token, data_json, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (name, uid, owner_token, data_json, ts, ts),
    )
    project_id = cur.lastrowid
    _insert_version(db, project_id, data_json)
    db.commit()
    return jsonify({"id": project_id, "name": name})


@app.route("/api/projects/<int:project_id>", methods=["GET"])
def get_project(project_id):
    uid = current_user_id()
    row, err = _load_project_for_access(project_id, uid)
    if err:
        return err
    try:
        graph = json.loads(row["data_json"]) if row["data_json"] else {}
    except (ValueError, TypeError):
        graph = {}
    return jsonify({"id": row["id"], "name": row["name"], "graph": graph})


@app.route("/api/projects/<int:project_id>", methods=["PUT"])
def update_project(project_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("Invalid or missing JSON body.", 400)
    uid = current_user_id()
    row, err = _load_project_for_access(project_id, uid, require_owner=True)
    if err:
        return err

    db = get_db()
    name = row["name"]
    data_json = row["data_json"]
    if "name" in data and data["name"] is not None:
        name = str(data["name"]).strip() or row["name"]
    graph_changed = "graph" in data and data["graph"] is not None
    if graph_changed:
        data_json = json.dumps(data["graph"])

    ts = now_iso()
    db.execute(
        "UPDATE projects SET name = ?, data_json = ?, updated_at = ? WHERE id = ?",
        (name, data_json, ts, project_id),
    )
    # Record a version snapshot whenever the graph changes.
    if graph_changed:
        _insert_version(db, project_id, data_json)
    db.commit()
    if graph_changed:
        _publish(project_id, {"type": "updated", "clientId": data.get("clientId")})
    return jsonify({"id": project_id, "name": name})


@app.route("/api/projects/<int:project_id>", methods=["DELETE"])
def delete_project(project_id):
    uid = current_user_id()
    _row, err = _load_project_for_access(project_id, uid, require_owner=True)
    if err:
        return err
    db = get_db()
    db.execute("DELETE FROM project_versions WHERE project_id = ?", (project_id,))
    db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    db.commit()
    return jsonify({"status": "ok"})


@app.route("/api/projects/<int:project_id>/versions", methods=["GET"])
def list_versions(project_id):
    uid = current_user_id()
    _row, err = _load_project_for_access(project_id, uid)
    if err:
        return err
    db = get_db()
    rows = db.execute(
        "SELECT id, created_at FROM project_versions WHERE project_id = ? "
        "ORDER BY id DESC",
        (project_id,),
    ).fetchall()
    versions = [{"id": r["id"], "created_at": r["created_at"]} for r in rows]
    return jsonify({"versions": versions})


@app.route(
    "/api/projects/<int:project_id>/versions/<int:version_id>/restore",
    methods=["POST"],
)
def restore_version(project_id, version_id):
    uid = current_user_id()
    _row, err = _load_project_for_access(project_id, uid, require_owner=True)
    if err:
        return err
    db = get_db()
    ver = db.execute(
        "SELECT * FROM project_versions WHERE id = ? AND project_id = ?",
        (version_id, project_id),
    ).fetchone()
    if ver is None:
        return json_error("Version not found.", 404)

    db.execute(
        "UPDATE projects SET data_json = ?, updated_at = ? WHERE id = ?",
        (ver["data_json"], now_iso(), project_id),
    )
    db.commit()
    try:
        graph = json.loads(ver["data_json"]) if ver["data_json"] else {}
    except (ValueError, TypeError):
        graph = {}
    _publish(project_id, {"type": "updated", "clientId": None})
    return jsonify({"graph": graph})


# ============================================================================
# Real-time collaboration: per-project pub/sub over Server-Sent Events.
# Whole-graph broadcast — when one client saves a project, others subscribed to
# its stream are told to reload. Works on the plain Flask dev server (threaded).
# ============================================================================

_sub_lock = threading.Lock()
_subscribers = {}  # project_id -> set[queue.Queue]


def _publish(project_id, event):
    """Push an event to every subscriber of a project (non-blocking)."""
    with _sub_lock:
        subs = list(_subscribers.get(project_id, set()))
    for q in subs:
        with contextlib.suppress(queue.Full):
            q.put_nowait(event)


def _presence_count(project_id):
    with _sub_lock:
        return len(_subscribers.get(project_id, set()))


@app.route("/api/projects/<int:project_id>/stream")
def project_stream(project_id):
    uid = current_user_id()
    _row, err = _load_project_for_access(project_id, uid)
    if err:
        return err

    q = queue.Queue(maxsize=128)
    with _sub_lock:
        _subscribers.setdefault(project_id, set()).add(q)
    _publish(project_id, {"type": "presence", "count": _presence_count(project_id)})

    def gen():
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                try:
                    ev = q.get(timeout=20)
                    yield "data: " + json.dumps(ev) + "\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            with _sub_lock:
                subs = _subscribers.get(project_id)
                if subs and q in subs:
                    subs.discard(q)
            _publish(project_id, {"type": "presence", "count": _presence_count(project_id)})

    return Response(
        gen(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ============================================================================
# Analytics helpers (shared by /analytics and /api/centrality)
# ============================================================================

def build_adjacency(nodes, edges, weighted=True, directed=True):
    adj = {node_id: [] for node_id in nodes}
    for idx, edge in enumerate(edges):
        if not isinstance(edge, dict):
            continue
        src = edge.get("source")
        tgt = edge.get("target")
        if src not in adj or tgt not in adj:
            continue
        if weighted:
            # dict.get only substitutes the default for a MISSING key, so a
            # present-but-null weight would yield None; coerce defensively and
            # fall back to width, then 1, rather than raising on bad input.
            raw = edge.get("weight")
            if raw is None:
                raw = edge.get("width", 1)
            try:
                weight = float(raw)
            except (TypeError, ValueError):
                weight = 1.0
        else:
            weight = 1.0
        weight = max(weight, 0.0001)
        edge_id = edge.get("id") or f"e{idx}"
        adj[src].append((tgt, weight, edge_id))
        if not directed or not edge.get("directed"):
            adj[tgt].append((src, weight, edge_id))
    return adj


def compute_components(adj):
    visited = set()
    components = 0
    for start in adj:
        if start in visited:
            continue
        components += 1
        stack = [start]
        visited.add(start)
        while stack:
            node = stack.pop()
            for nxt, _, _ in adj[node]:
                if nxt not in visited:
                    visited.add(nxt)
                    stack.append(nxt)
    return components


def _count_self_loops(edges):
    """Number of edges whose source and target are the same node."""
    return sum(1 for e in edges if isinstance(e, dict) and e.get("source") == e.get("target"))


def compute_distance_stats(adj):
    """Diameter and average shortest-path length over the largest component.

    Uses unweighted BFS from every node in the largest connected component. Runs
    only when the graph is small enough (see MAX_DISTANCE_STATS_NODES); returns
    (None, None) otherwise so callers can render an "n/a" placeholder.
    """
    node_ids = list(adj.keys())
    if len(node_ids) < 2 or len(node_ids) > MAX_DISTANCE_STATS_NODES:
        return None, None

    # Identify the largest connected component so disconnected pairs (which have
    # infinite distance) do not poison the averages.
    seen = set()
    largest = []
    for start in node_ids:
        if start in seen:
            continue
        comp = []
        stack = [start]
        seen.add(start)
        while stack:
            node = stack.pop()
            comp.append(node)
            for nxt, _w, _e in adj[node]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        if len(comp) > len(largest):
            largest = comp
    if len(largest) < 2:
        return None, None

    comp_set = set(largest)
    diameter = 0
    total = 0
    pairs = 0
    for source in largest:
        dist = {source: 0}
        dq = deque([source])
        while dq:
            node = dq.popleft()
            d = dist[node]
            for nxt, _w, _e in adj[node]:
                if nxt in comp_set and nxt not in dist:
                    dist[nxt] = d + 1
                    dq.append(nxt)
        for target, d in dist.items():
            if target == source:
                continue
            diameter = max(diameter, d)
            total += d
            pairs += 1
    avg_path = round(total / pairs, 3) if pairs else None
    return diameter, avg_path


def compute_stats(graph):
    nodes = graph.get("nodes") or {}
    edges = graph.get("edges") or []
    adj = build_adjacency(nodes, edges, weighted=False, directed=False)
    node_count = len(nodes)
    edge_count = len(edges)
    max_degree = 0
    isolated = 0
    for _node_id, neighbors in adj.items():
        degree = len(neighbors)
        max_degree = max(max_degree, degree)
        if degree == 0:
            isolated += 1

    components = compute_components(adj) if node_count else 0
    avg_degree = (edge_count * 2 / node_count) if node_count else 0
    # Density: fraction of the possible undirected edges that are present.
    possible = node_count * (node_count - 1) / 2 if node_count > 1 else 0
    density = round(edge_count / possible, 4) if possible else 0
    diameter, avg_path = compute_distance_stats(adj)
    return {
        "nodeCount": node_count,
        "edgeCount": edge_count,
        "components": components,
        "averageDegree": round(avg_degree, 2),
        "maxDegree": max_degree,
        "isolated": isolated,
        "selfLoops": _count_self_loops(edges),
        "density": density,
        "diameter": diameter,
        "avgPathLength": avg_path,
    }


def bfs_path(adj, start, end):
    if start not in adj or end not in adj:
        return None
    frontier = deque([start])
    visited = {start}
    parent = {}
    while frontier:
        node = frontier.popleft()
        if node == end:
            break
        for nxt, _, edge_id in adj[node]:
            if nxt not in visited:
                visited.add(nxt)
                parent[nxt] = (node, edge_id)
                frontier.append(nxt)
    if end not in visited:
        return None
    node_path = []
    edge_path = []
    cur = end
    while True:
        node_path.append(cur)
        if cur not in parent:
            break
        prev, edge_id = parent[cur]
        edge_path.append(edge_id)
        cur = prev
    node_path.reverse()
    edge_path.reverse()
    return {"nodes": node_path, "edges": edge_path, "algorithm": "bfs"}


def dijkstra_path(adj, start, end):
    if start not in adj or end not in adj:
        return None
    dist = {node: float("inf") for node in adj}
    prev = {}
    dist[start] = 0.0
    heap = [(0.0, start)]
    while heap:
        cost, node = heappop(heap)
        if cost > dist[node]:
            continue
        if node == end:
            break
        for nxt, weight, edge_id in adj[node]:
            alt = dist[node] + weight
            if alt < dist[nxt]:
                dist[nxt] = alt
                prev[nxt] = (node, edge_id)
                heappush(heap, (alt, nxt))
    if dist[end] == float("inf"):
        return None
    node_path = []
    edge_path = []
    cur = end
    while True:
        node_path.append(cur)
        if cur not in prev:
            break
        prev_node, edge_id = prev[cur]
        edge_path.append(edge_id)
        cur = prev_node
    node_path.reverse()
    edge_path.reverse()
    return {
        "nodes": node_path,
        "edges": edge_path,
        "algorithm": "dijkstra",
        "cost": dist[end],
    }


@app.route("/analytics", methods=["POST"])
def analytics():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return json_error("Invalid or missing JSON body.", 400)
    graph = payload.get("graph") or {}
    start = payload.get("start")
    end = payload.get("end")
    algorithm = payload.get("algorithm") or "auto"

    # Cap graph size before running pathfinding.
    nodes = graph.get("nodes") or {}
    edges = graph.get("edges") or []
    if not isinstance(nodes, dict) or not isinstance(edges, list):
        return json_error("Graph 'nodes' must be an object and 'edges' a list.", 400)
    if len(nodes) > MAX_ANALYTICS_NODES or len(edges) > MAX_ANALYTICS_EDGES:
        return json_error("Graph too large for server-side analytics.", 413)

    stats = compute_stats(graph)
    path = None
    path_error = None

    if start and end:
        if start not in nodes or end not in nodes:
            path_error = "Start or end node not found."
        else:
            weighted_adj = build_adjacency(nodes, edges, weighted=True, directed=True)
            unweighted_adj = build_adjacency(nodes, edges, weighted=False, directed=True)
            if algorithm == "bfs":
                path = bfs_path(unweighted_adj, start, end)
            elif algorithm == "dijkstra":
                path = dijkstra_path(weighted_adj, start, end)
            else:
                path = dijkstra_path(weighted_adj, start, end) or bfs_path(unweighted_adj, start, end)
            if not path:
                path_error = "No path between the selected nodes."

    return jsonify({"stats": stats, "path": path, "pathError": path_error})


# ============================================================================
# Centrality & community detection (POST /api/centrality)
# ============================================================================

def _closeness_for_node(adj, source):
    """Single-source shortest-path closeness using the heap pattern from
    dijkstra_path. Returns closeness centrality (0 if unreachable/alone)."""
    dist = {node: float("inf") for node in adj}
    dist[source] = 0.0
    heap = [(0.0, source)]
    while heap:
        cost, node = heappop(heap)
        if cost > dist[node]:
            continue
        for nxt, weight, _edge_id in adj[node]:
            alt = cost + weight
            if alt < dist[nxt]:
                dist[nxt] = alt
                heappush(heap, (alt, nxt))
    reachable = [d for n, d in dist.items() if n != source and d != float("inf")]
    total = sum(reachable)
    if not reachable or total <= 0:
        return 0.0
    # Wasserman-Faust normalization for disconnected graphs:
    # (reachable / (N-1)) * ((reachable) / total_distance)
    n_minus_1 = len(adj) - 1
    if n_minus_1 <= 0:
        return 0.0
    return (len(reachable) / total) * (len(reachable) / n_minus_1)


def compute_betweenness(adj):
    """Brandes' algorithm for betweenness centrality (unweighted BFS form)."""
    nodes = list(adj.keys())
    betweenness = {n: 0.0 for n in nodes}

    for s in nodes:
        stack = []
        pred = {n: [] for n in nodes}
        sigma = {n: 0.0 for n in nodes}
        dist = {n: -1 for n in nodes}
        sigma[s] = 1.0
        dist[s] = 0
        frontier = deque([s])
        while frontier:
            v = frontier.popleft()
            stack.append(v)
            for w, _weight, _edge_id in adj[v]:
                if dist[w] < 0:
                    dist[w] = dist[v] + 1
                    frontier.append(w)
                if dist[w] == dist[v] + 1:
                    sigma[w] += sigma[v]
                    pred[w].append(v)
        delta = {n: 0.0 for n in nodes}
        while stack:
            w = stack.pop()
            for v in pred[w]:
                if sigma[w] > 0:
                    delta[v] += (sigma[v] / sigma[w]) * (1.0 + delta[w])
            if w != s:
                betweenness[w] += delta[w]

    return betweenness


def compute_pagerank(adj, damping=0.85, iterations=100, tol=1.0e-6):
    """Damped PageRank over the (directed) adjacency."""
    nodes = list(adj.keys())
    n = len(nodes)
    if n == 0:
        return {}
    rank = {node: 1.0 / n for node in nodes}
    out_degree = {node: len(adj[node]) for node in nodes}

    for _ in range(iterations):
        new_rank = {}
        # Dangling-node mass (nodes with no out-links) redistributed evenly.
        dangling = sum(rank[node] for node in nodes if out_degree[node] == 0)
        for node in nodes:
            new_rank[node] = (1.0 - damping) / n + damping * (dangling / n)
        for node in nodes:
            if out_degree[node] == 0:
                continue
            share = damping * rank[node] / out_degree[node]
            for nxt, _weight, _edge_id in adj[node]:
                new_rank[nxt] += share
        diff = sum(abs(new_rank[node] - rank[node]) for node in nodes)
        rank = new_rank
        if diff < tol:
            break
    return rank


def detect_communities(adj, iterations=20):
    """Synchronous-ish label propagation community detection.

    Returns {nodeId: communityIndex} with contiguous integer indices.
    """
    labels = {node: node for node in adj}
    nodes = sorted(adj.keys())

    for _ in range(iterations):
        changed = False
        for node in nodes:
            neighbors = adj[node]
            if not neighbors:
                continue
            counts = {}
            for nxt, weight, _edge_id in neighbors:
                counts[labels[nxt]] = counts.get(labels[nxt], 0.0) + weight
            if not counts:
                continue
            # Pick the highest-weight label; break ties deterministically.
            best_label = max(counts.items(), key=lambda kv: (kv[1], str(kv[0])))[0]
            if labels[node] != best_label:
                labels[node] = best_label
                changed = True
        if not changed:
            break

    # Re-map opaque labels to contiguous community indices.
    index_of = {}
    communities = {}
    for node in nodes:
        lbl = labels[node]
        if lbl not in index_of:
            index_of[lbl] = len(index_of)
        communities[node] = index_of[lbl]
    return communities


@app.route("/api/centrality", methods=["POST"])
def api_centrality():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return json_error("Invalid or missing JSON body.", 400)
    graph = payload.get("graph") or {}
    nodes = graph.get("nodes") or {}
    edges = graph.get("edges") or []

    if not isinstance(nodes, dict) or not isinstance(edges, list):
        return json_error("Graph 'nodes' must be an object and 'edges' a list.", 400)
    if len(nodes) > MAX_ANALYTICS_NODES or len(edges) > MAX_ANALYTICS_EDGES:
        return json_error("Graph too large for server-side analytics.", 413)

    node_ids = list(nodes.keys())

    # Directed adjacency for in/out degree, PageRank, communities.
    directed_adj = build_adjacency(nodes, edges, weighted=True, directed=True)
    # Undirected adjacency for closeness / betweenness reachability.
    undirected_adj = build_adjacency(nodes, edges, weighted=True, directed=False)
    undirected_unweighted = build_adjacency(
        nodes, edges, weighted=False, directed=False
    )

    # In/out degree from raw edges.
    in_degree = {n: 0 for n in node_ids}
    out_degree = {n: 0 for n in node_ids}
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        src = edge.get("source")
        tgt = edge.get("target")
        if src in out_degree:
            out_degree[src] += 1
        if tgt in in_degree:
            in_degree[tgt] += 1

    betweenness = compute_betweenness(undirected_unweighted)
    # The graph is scored as undirected here, so each shortest path is counted
    # from both endpoints; halve to match the standard undirected definition
    # (and the client-side implementation) so scores don't jump at the
    # server/client threshold.
    betweenness = {n: b / 2.0 for n, b in betweenness.items()}
    pagerank = compute_pagerank(directed_adj)
    communities = detect_communities(undirected_adj)

    metrics = {}
    for n in node_ids:
        total_degree = in_degree[n] + out_degree[n]
        metrics[n] = {
            "degree": total_degree,
            "inDegree": in_degree[n],
            "outDegree": out_degree[n],
            # Unweighted (hop-count) closeness, matching the client's BFS so
            # values/rankings agree on both sides of the analytics threshold.
            "closeness": round(_closeness_for_node(undirected_unweighted, n), 6),
            "betweenness": round(betweenness.get(n, 0.0), 6),
            "pagerank": round(pagerank.get(n, 0.0), 6),
        }

    return jsonify({"metrics": metrics, "communities": communities})


# ============================================================================
# Transforms
# ============================================================================
#
# Transforms query real, keyless public sources: the system resolver, RDAP via
# rdap.org, certificate transparency via crt.sh, the Wayback CDX index, Shodan's
# InternetDB and ipwho.is. No API keys, no registration, no extra packages.
#
# Three transforms -- to_emails, reverse_ip and person_to_social -- still return
# synthetic data, because no keyless source answers those questions honestly.
# They carry synthetic:true in the listing and in every response so the client
# can mark what they create; fabricated nodes must never sit unlabelled next to
# real ones in an investigation graph.
#
# Everything below is reachable through an UNAUTHENTICATED endpoint, so two
# rules hold throughout:
#   * inputs are validated before they reach a URL or a socket, and private /
#     loopback / reserved addresses are refused -- both to keep internal
#     addressing out of third-party query logs, and to stop the server being
#     used to probe the network it sits inside.
#   * only one transform touches the subject at all (tcp_scan), and it is off
#     unless the operator sets NM_ACTIVE_SCAN=1. Everything else talks to the
#     source, never to the target.

NET_TIMEOUT = float(os.environ.get("NM_NET_TIMEOUT", "8"))
# crt.sh answers large domains slowly enough that the default would time out on
# results it was going to return.
CRTSH_TIMEOUT = float(os.environ.get("NM_CRTSH_TIMEOUT", "25"))
ARCHIVE_TIMEOUT = float(os.environ.get("NM_ARCHIVE_TIMEOUT", "20"))
NET_USER_AGENT = "node-mapper/1.0 (+https://github.com/eavalenzuela/node_mapper)"
MAX_LOOKUP_BYTES = 4 * 1024 * 1024
MAX_URL_LENGTH = 256

ACTIVE_SCAN_ENABLED = os.environ.get("NM_ACTIVE_SCAN", "0") == "1"
ACTIVE_SCAN_TIMEOUT = float(os.environ.get("NM_ACTIVE_SCAN_TIMEOUT", "1.0"))

# A lodan instance (`lodan serve`) holding scan results for ranges the operator
# owns. Unset means the lodan transforms list as unavailable rather than failing
# when run.
LODAN_URL = os.environ.get("LODAN_URL", "").rstrip("/")
LODAN_TOKEN = os.environ.get("LODAN_TOKEN", "")
LODAN_TIMEOUT = float(os.environ.get("LODAN_TIMEOUT", "20"))

LOOKUP_CACHE_TTL = int(os.environ.get("NM_LOOKUP_CACHE_TTL", "600"))
LOOKUP_CACHE_MAX = 512

TRANSFORM_DEFAULT_LIMIT = 12
TRANSFORM_MAX_LIMIT = 50
TRANSFORM_MAX_EDGES = 200


class TransformInputError(Exception):
    """Bad request: unusable value, refused target, or a disabled transform."""

    status = 400


class TransformSourceError(Exception):
    """The upstream source failed: unreachable, too slow, or unparseable."""

    status = 502


# --- lookup cache -----------------------------------------------------------
#
# Sources are shared and mostly rate-limited (crt.sh in particular), and running
# the same transform twice while arranging a graph is normal. Values are always
# 1-tuples so a cached "nothing found" is distinguishable from a cache miss.

_lookup_cache = OrderedDict()
_lookup_cache_lock = threading.Lock()


def _cache_get(key):
    with _lookup_cache_lock:
        hit = _lookup_cache.get(key)
        if hit is None:
            return None
        expires, value = hit
        if expires < time.time():
            _lookup_cache.pop(key, None)
            return None
        _lookup_cache.move_to_end(key)
        return value


def _cache_put(key, value):
    with _lookup_cache_lock:
        _lookup_cache[key] = (time.time() + LOOKUP_CACHE_TTL, value)
        _lookup_cache.move_to_end(key)
        while len(_lookup_cache) > LOOKUP_CACHE_MAX:
            _lookup_cache.popitem(last=False)


def _source_label(url):
    try:
        return urllib.parse.urlsplit(url).netloc or url
    except ValueError:
        return url


def _fetch_json(url, timeout=None, allow_404=False, headers=None, cache=True):
    """GET one of the pinned JSON sources, through the TTL cache.

    Returns None for a 404 when allow_404 is set: several sources use 404 to
    mean "nothing known about this target", which is an empty result rather
    than a failure.
    """
    if cache:
        cached = _cache_get(url)
        if cached is not None:
            return cached[0]

    request_obj = urllib.request.Request(url, headers={
        "User-Agent": NET_USER_AGENT,
        "Accept": "application/json",
        **(headers or {}),
    })
    try:
        with urllib.request.urlopen(request_obj, timeout=timeout or NET_TIMEOUT) as response:
            raw = response.read(MAX_LOOKUP_BYTES + 1)
    except urllib.error.HTTPError as exc:
        if exc.code == 404 and allow_404:
            if cache:
                _cache_put(url, (None,))
            return None
        raise TransformSourceError(f"{_source_label(url)} returned HTTP {exc.code}.") from None
    except (TimeoutError, urllib.error.URLError, OSError) as exc:
        reason = getattr(exc, "reason", None) or exc.__class__.__name__
        raise TransformSourceError(f"{_source_label(url)} is unreachable ({reason}).") from None

    if len(raw) > MAX_LOOKUP_BYTES:
        raise TransformSourceError(
            f"{_source_label(url)} returned more than {MAX_LOOKUP_BYTES // 1024} KiB.")
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        raise TransformSourceError(
            f"{_source_label(url)} returned a non-JSON response.") from None

    if cache:
        _cache_put(url, (data,))
    return data


# --- input validation -------------------------------------------------------

_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")

# Suffixes that only mean something inside a private network. A third-party
# source cannot answer for them, and asking leaks internal naming.
_INTERNAL_SUFFIXES = (
    ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home",
    ".home.arpa", ".corp", ".test", ".invalid", ".example",
)


def _clean_hostname(value, allow_internal=False):
    """Normalise a user-supplied domain/host down to a bare hostname.

    `allow_internal` keeps names like `nas.lan`, which are refused for the
    public sources (no third party can answer for them, and asking leaks
    internal naming) but are exactly what a local lodan workspace holds.
    """
    text = str(value or "").strip().lower()
    if not text:
        raise TransformInputError("Entity value is empty.")
    if "://" in text:  # a pasted URL rather than a bare name
        text = urllib.parse.urlsplit(text).netloc or text
    text = text.split("/")[0].split("@")[-1].split(":")[0].rstrip(".")
    try:
        text = text.encode("idna").decode("ascii")
    except (UnicodeError, UnicodeDecodeError):
        raise TransformInputError(f"{str(value)[:80]!r} is not a valid hostname.") from None
    if not _HOSTNAME_RE.match(text):
        raise TransformInputError(f"{str(value)[:80]!r} is not a valid public hostname.")
    if text.endswith(_INTERNAL_SUFFIXES) and not allow_internal:
        raise TransformInputError(
            f"{text} is an internal name; no public source can resolve it.")
    return text


def _public_ip(value):
    """Validate an IP and refuse anything a public source has no business seeing."""
    try:
        addr = ipaddress.ip_address(str(value or "").strip())
    except ValueError:
        raise TransformInputError(f"{str(value)[:80]!r} is not an IP address.") from None
    # is_global already excludes private, loopback, link-local and reserved
    # ranges; multicast is checked separately because it is global-but-useless.
    if not addr.is_global or addr.is_multicast:
        raise TransformInputError(
            f"{addr} is not a public address -- refusing to send it to a third-party source.")
    return str(addr)


def _any_ip(value):
    """Validate an IP without the public-address guard.

    The guard exists to keep internal addressing out of third-party query logs.
    A lodan workspace is the operator's own record of their own ranges, so it is
    the one source where a private address is the expected input.
    """
    try:
        return str(ipaddress.ip_address(str(value or "").strip()))
    except ValueError:
        raise TransformInputError(f"{str(value)[:80]!r} is not an IP address.") from None


def _scan_target(value):
    """Validate an active-scan target. Private ranges are allowed here: mapping
    your own network is the reason the operator turned scanning on."""
    try:
        addr = ipaddress.ip_address(str(value or "").strip())
    except ValueError:
        raise TransformInputError(f"{str(value)[:80]!r} is not an IP address.") from None
    if addr.is_multicast or addr.is_unspecified:
        raise TransformInputError(f"{addr} is not a scannable host address.")
    return str(addr)


def _valid_edge(edge):
    """An edge is only usable if both endpoints name a (type, value) pair."""
    if not isinstance(edge, dict):
        return False
    for side in ("from", "to"):
        end = edge.get(side)
        if not isinstance(end, dict) or not end.get("type") or not end.get("value"):
            return False
    return True


def _result_limit(params, meta=None):
    """How many entities a run may return.

    The default cap suits an open-ended enumeration, where a source could hand
    back thousands and the analyst wants a sample. A transform reading a bounded
    local record -- one host's real attack surface -- says so with its own
    default_limit / max_limit, because truncating that to twelve would silently
    drop most of the answer.
    """
    meta = meta or {}
    default = meta.get("default_limit", TRANSFORM_DEFAULT_LIMIT)
    cap = meta.get("max_limit", TRANSFORM_MAX_LIMIT)
    try:
        limit = int((params or {}).get("limit", default))
    except (TypeError, ValueError):
        limit = default
    return max(1, min(limit, cap))


def _transform_available(meta):
    """A transform may gate itself on configuration; the listing reports why."""
    check = meta.get("available")
    return bool(check()) if callable(check) else True


# --- RDAP helpers -----------------------------------------------------------

def _vcard_field(rdap_entity, field):
    """Pull one field out of an RDAP entity's jCard (its vcardArray)."""
    card = rdap_entity.get("vcardArray")
    if not isinstance(card, list) or len(card) < 2 or not isinstance(card[1], list):
        return None
    for item in card[1]:
        if isinstance(item, list) and len(item) >= 4 and item[0] == field:
            value = item[3]
            if isinstance(value, list):
                value = " ".join(str(part) for part in value if part)
            text = str(value or "").strip()
            if text:
                return text
    return None


def _rdap_entities(node, role):
    """Every RDAP entity carrying `role`, at any depth -- registrars nest their
    abuse contact inside themselves rather than listing it at the top level."""
    found = []

    def walk(items):
        for item in items or []:
            if not isinstance(item, dict):
                continue
            if role in (item.get("roles") or []):
                found.append(item)
            walk(item.get("entities"))

    walk(node.get("entities"))
    return found


def _rdap_event(node, action):
    for event in node.get("events") or []:
        if isinstance(event, dict) and event.get("eventAction") == action:
            return str(event.get("eventDate") or "").strip() or None
    return None


# --- result helpers ---------------------------------------------------------

def _entity(etype, value, properties=None, label=None):
    """One result entity.

    `value` is the identity -- the client de-duplicates on (type, value), so it
    has to be unique across the whole graph. `label` is what the node reads as
    on canvas, for the cases where a unique value is not a readable one (a port
    keyed '10.0.0.1:22' should still say '22/ssh').
    """
    # Empty values are dropped rather than emitted: a source that has no country
    # for a netblock should leave the field unset, not stamp "" over whatever the
    # analyst typed there. 0 and False are kept -- only None and "" go.
    props = {k: v for k, v in (properties or {}).items() if v is not None and v != ""}
    entity = {"type": etype, "value": value, "properties": props}
    if label and label != value:
        entity["label"] = label
    return entity


def _link(label, directed=True):
    """An edge from the entity the transform ran on to entities[i]."""
    return {"label": label, "directed": directed}


def _edge(from_entity, to_entity, label, directed=True):
    """An edge between two named endpoints, neither of which need be the source.

    `links` can only ever attach a result to the entity the transform ran on,
    which cannot express 'this certificate covers that domain' or 'these two
    addresses are one machine'. Endpoints are matched by (type, value) against
    the entities in the same response and everything already in the graph;
    an endpoint that matches nothing is skipped rather than conjured.
    """
    return {
        "from": {"type": from_entity[0], "value": from_entity[1]},
        "to": {"type": to_entity[0], "value": to_entity[1]},
        "label": label,
        "directed": directed,
    }


def _seed_int(*parts):
    """Deterministic integer seed derived from the joined string parts.

    Only the three synthetic placeholder transforms still use this.
    """
    raw = "::".join(str(p) for p in parts).encode("utf-8")
    return int(hashlib.sha256(raw).hexdigest(), 16)


# --- real transforms --------------------------------------------------------

def transform_to_ip(entity, params):
    """domain/host -> the A and AAAA records the system resolver returns."""
    name = _clean_hostname(entity.get("value"))
    try:
        infos = socket.getaddrinfo(name, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise TransformSourceError(
            f"DNS lookup for {name} failed ({exc.strerror or exc}).") from None
    except OSError as exc:
        raise TransformSourceError(f"DNS lookup for {name} failed ({exc}).") from None

    entities, links, seen = [], [], set()
    for family, _stype, _proto, _canon, sockaddr in infos:
        address = sockaddr[0]
        if address in seen:
            continue
        seen.add(address)
        entities.append(_entity(
            "ipv6" if family == socket.AF_INET6 else "ipv4", address, {"resolvedFrom": name}))
        links.append(_link("resolves_to"))
    if not entities:
        raise TransformSourceError(f"{name} has no A or AAAA records.")
    return {"entities": entities, "links": links}


def _ct_names(raw_names, domain):
    """Filter certificate DNS names down to real subdomains of `domain`."""
    suffix = "." + domain
    names = set()
    for raw in raw_names:
        # A wildcard cert contributes '*.example.com', which collapses to the
        # apex -- a subdomain transform must not return its own input.
        name = str(raw or "").strip().lower().lstrip("*.").rstrip(".")
        if name != domain and name.endswith(suffix) and _HOSTNAME_RE.match(name):
            names.add(name)
    return names


def _subdomains_from_crtsh(domain):
    rows = _fetch_json(
        f"https://crt.sh/?q={urllib.parse.quote('%.' + domain)}&output=json",
        timeout=CRTSH_TIMEOUT)
    if not isinstance(rows, list):
        raise TransformSourceError("crt.sh returned an unexpected document.")
    raw = []
    for row in rows:
        if isinstance(row, dict):
            # One certificate can name many hosts; crt.sh newline-joins them.
            raw.extend(str(row.get("name_value", "")).splitlines())
    return _ct_names(raw, domain)


def _subdomains_from_certspotter(domain):
    rows = _fetch_json(
        f"https://api.certspotter.com/v1/issuances?domain={urllib.parse.quote(domain)}&include_subdomains=true"
        "&expand=dns_names")
    if not isinstance(rows, list):
        raise TransformSourceError("api.certspotter.com returned an unexpected document.")
    raw = []
    for row in rows:
        if isinstance(row, dict):
            raw.extend(row.get("dns_names") or [])
    return _ct_names(raw, domain)


def transform_to_subdomains(entity, params):
    """domain -> names seen in Certificate Transparency logs.

    crt.sh is the better index but is down often enough that a single-source
    transform would fail most weeks; CertSpotter covers the same logs keyless.
    """
    domain = _clean_hostname(entity.get("value"))
    note = None
    try:
        names = _subdomains_from_crtsh(domain)
    except TransformSourceError as crtsh_error:
        try:
            names = _subdomains_from_certspotter(domain)
        except TransformSourceError as certspotter_error:
            raise TransformSourceError(
                f"Both certificate-transparency sources failed -- "
                f"{crtsh_error} {certspotter_error}") from None
        note = f"crt.sh failed ({crtsh_error}) -- these came from api.certspotter.com."

    # Shallowest first: 'mail.example.com' is more useful than a four-label
    # build artefact when the result set is about to be clamped.
    ordered = sorted(names, key=lambda n: (n.count("."), n))
    entities = [_entity("domain", name, {}) for name in ordered]
    if not entities:
        note = f"No certificate-transparency record names a subdomain of {domain}."
    return {
        "entities": entities,
        "links": [_link("subdomain_of") for _ in entities],
        "note": note,
    }


def transform_whois(entity, params):
    """domain -> registrar, contacts and nameservers, from RDAP."""
    domain = _clean_hostname(entity.get("value"))
    data = _fetch_json(
        f"https://rdap.org/domain/{urllib.parse.quote(domain)}", allow_404=True)
    if not isinstance(data, dict):
        return {"entities": [], "links": [],
                "note": f"No RDAP record exists for {domain}."}

    entities, links, source_props = [], [], {}

    registrars = _rdap_entities(data, "registrar")
    if registrars:
        name = _vcard_field(registrars[0], "fn") or registrars[0].get("handle")
        if name:
            entities.append(_entity("organization", name, {"domain": domain}))
            links.append(_link("registrar"))
            source_props["registrar"] = name

    seen_emails = set()
    for role in ("abuse", "registrant", "administrative", "technical"):
        for contact in _rdap_entities(data, role):
            address = _vcard_field(contact, "email")
            if address and address.lower() not in seen_emails:
                seen_emails.add(address.lower())
                entities.append(_entity("email", address, {"displayName": f"{role} contact"}))
                links.append(_link(f"{role}_contact"))

    for nameserver in (data.get("nameservers") or [])[:8]:
        name = str((nameserver or {}).get("ldhName") or "").strip().lower().rstrip(".")
        if name:
            entities.append(_entity("host", name, {"ip": ""}))
            links.append(_link("nameserver"))

    for action, key in (("registration", "registered"), ("expiration", "expires")):
        value = _rdap_event(data, action)
        if value:
            source_props[key] = value

    note = None
    if not entities:
        note = (f"RDAP holds a record for {domain} but names no registrar, contact or "
                "nameserver -- registries commonly redact all three.")
    return {"entities": entities, "links": links,
            "sourceProperties": source_props, "note": note}


def transform_to_asn(entity, params):
    """ipv4 -> the organisation holding the netblock, from RDAP."""
    ip = _public_ip(entity.get("value"))
    data = _fetch_json(f"https://rdap.org/ip/{urllib.parse.quote(ip)}", allow_404=True)
    if not isinstance(data, dict):
        return {"entities": [], "links": [], "note": f"No RDAP record covers {ip}."}

    org = None
    for role in ("registrant", "administrative", "technical", "abuse"):
        for contact in _rdap_entities(data, role):
            org = _vcard_field(contact, "fn")
            if org:
                break
        if org:
            break
    label = org or str(data.get("name") or "").strip() or str(data.get("handle") or "").strip()
    if not label:
        return {"entities": [], "links": [],
                "note": f"RDAP names no organisation for {ip}."}

    cidrs = []
    for block in data.get("cidr0_cidrs") or []:
        if not isinstance(block, dict):
            continue
        prefix = block.get("v4prefix") or block.get("v6prefix")
        length = block.get("length")
        if prefix and length is not None:
            cidrs.append(f"{prefix}/{length}")

    country = str(data.get("country") or "").strip()
    props = {"country": country}
    if cidrs:
        props["netblock"] = ", ".join(cidrs)
    if data.get("handle"):
        props["handle"] = str(data["handle"])

    source_props = {}
    # ARIN publishes the originating AS; the other RIRs mostly do not, so this
    # is best-effort rather than a guarantee.
    origins = [str(a) for a in (data.get("arin_originas0_originautnums") or []) if a]
    if origins:
        source_props["asn"] = "AS" + origins[0]
    if country:
        source_props["geo"] = country

    return {"entities": [_entity("organization", label, props)],
            "links": [_link("netblock_owner")],
            "sourceProperties": source_props}


def transform_geolocate(entity, params):
    """ipv4 -> approximate location, from ipwho.is."""
    ip = _public_ip(entity.get("value"))
    data = _fetch_json(f"https://ipwho.is/{urllib.parse.quote(ip)}")
    if not isinstance(data, dict) or data.get("success") is False:
        reason = (data or {}).get("message") or "no reason given"
        raise TransformSourceError(f"ipwho.is could not locate {ip} ({reason}).")

    lat, lng = data.get("latitude"), data.get("longitude")
    if lat is None or lng is None:
        return {"entities": [], "links": [],
                "note": f"ipwho.is has no coordinates for {ip}."}

    parts = [str(data.get(k) or "").strip() for k in ("city", "region", "country")]
    label = ", ".join(p for p in parts if p) or ip
    # The map view reads properties.lat / properties.lng -- these key names are
    # load-bearing, do not rename them to lon/latitude.
    return {
        "entities": [_entity("location", label, {"lat": lat, "lng": lng, "address": label})],
        "links": [_link("located_in")],
        "sourceProperties": {"geo": label},
    }


# Port -> service name is the IANA assignment, not an observed banner: it says
# what usually listens there, which is why the property is named accordingly.
WELL_KNOWN_PORTS = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns", 80: "http",
    110: "pop3", 135: "msrpc", 139: "netbios-ssn", 143: "imap", 443: "https",
    445: "smb", 465: "smtps", 587: "submission", 631: "ipp", 993: "imaps",
    995: "pop3s", 1433: "mssql", 1521: "oracle", 2049: "nfs", 2222: "ssh-alt",
    3000: "http-dev", 3306: "mysql", 3389: "rdp", 5432: "postgres",
    5900: "vnc", 6379: "redis", 8000: "http-alt", 8080: "http-alt",
    8443: "https-alt", 9200: "elasticsearch", 11211: "memcached",
    27017: "mongodb",
}


def _port_entity(ip, number, protocol="tcp", service=None):
    """A port node scoped to its host.

    The value carries the address because the client de-duplicates on
    (type, value) across the entire graph: a bare "22" would collapse every
    ssh port in an investigation into one node with edges to every host.
    """
    service = service or WELL_KNOWN_PORTS.get(number)
    label = f"{number}/{service}" if service else str(number)
    return _entity(
        "port", f"{ip}:{number}",
        {"port": number, "protocol": protocol, "service": service, "host": ip},
        label=label,
    )


def transform_known_ports(entity, params):
    """ipv4 -> ports Shodan has already observed open. Sends nothing to the target."""
    ip = _public_ip(entity.get("value"))
    data = _fetch_json(
        f"https://internetdb.shodan.io/{urllib.parse.quote(ip)}", allow_404=True)
    if not isinstance(data, dict):
        return {"entities": [], "links": [],
                "note": f"Shodan's InternetDB has no record of {ip}."}

    entities, links = [], []
    for port in (data.get("ports") or []):
        try:
            number = int(port)
        except (TypeError, ValueError):
            continue
        entities.append(_port_entity(ip, number))
        links.append(_link("open_port"))

    for hostname in (data.get("hostnames") or [])[:10]:
        name = str(hostname or "").strip().lower().rstrip(".")
        if name and _HOSTNAME_RE.match(name):
            entities.append(_entity("domain", name, {}))
            links.append(_link("hostname"))

    source_props = {}
    vulns = [str(v) for v in (data.get("vulns") or []) if v]
    if vulns:
        source_props["vulns"] = ", ".join(vulns[:20])
    tags = [str(t) for t in (data.get("tags") or []) if t]
    if tags:
        source_props["tags"] = ", ".join(tags[:10])

    note = None
    if not entities:
        note = f"InternetDB knows {ip} but lists no open port or hostname."
    return {"entities": entities, "links": links,
            "sourceProperties": source_props, "note": note}


def transform_to_url(entity, params):
    """domain -> URLs the Wayback Machine has actually archived."""
    domain = _clean_hostname(entity.get("value"))
    # filter=statuscode:200 keeps the noise down: without it the index hands back
    # every 404 and spam path anyone ever crawled under the domain.
    # Ask for more rows than the caller wants: the length filter below discards
    # some, and the endpoint clamps back down to the real limit afterwards.
    url = (f"https://web.archive.org/cdx/search/cdx?url={urllib.parse.quote(domain)}"
           f"&matchType=domain&output=json&fl=original&collapse=urlkey"
           f"&filter=statuscode:200&limit={_result_limit(params) * 5}")
    rows = _fetch_json(url, timeout=ARCHIVE_TIMEOUT)
    if not isinstance(rows, list) or not rows:
        return {"entities": [], "links": [],
                "note": f"The Wayback Machine has nothing archived for {domain}."}

    entities, links, seen = [], [], set()
    for row in rows[1:]:  # row 0 is the CDX column header
        if not isinstance(row, list) or not row:
            continue
        candidate = str(row[0]).strip()
        if not candidate.lower().startswith(("http://", "https://")) or candidate in seen:
            continue
        # The archive holds spam paths kilobytes long -- real URLs, but each one
        # becomes a node label here, so anything past a sane length is dropped.
        if len(candidate) > MAX_URL_LENGTH:
            continue
        seen.add(candidate)
        entities.append(_entity("url", candidate, {"status": "archived"}))
        links.append(_link("hosts_url"))
    return {"entities": entities, "links": links,
            "note": None if entities else
                    f"The Wayback Machine has nothing archived for {domain}."}


COMMON_SCAN_PORTS = (
    21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 587, 993, 995,
    1433, 3306, 3389, 5432, 5900, 6379, 8000, 8080, 8443, 9200, 27017,
)


def transform_tcp_scan(entity, params):
    """ipv4 -> ports accepting a TCP connection right now.

    The only transform that touches the subject rather than a third-party
    source, which is why it stays off until the operator opts in.
    """
    if not ACTIVE_SCAN_ENABLED:
        raise TransformInputError(
            "Active scanning is disabled. Restart the server with NM_ACTIVE_SCAN=1 "
            "to enable it.")
    ip = _scan_target(entity.get("value"))

    def probe(port):
        try:
            with socket.create_connection((ip, port), timeout=ACTIVE_SCAN_TIMEOUT):
                return port
        except OSError:
            return None

    # Sequentially this is 26 ports x the timeout; the pool keeps a full sweep
    # inside a couple of seconds.
    with futures.ThreadPoolExecutor(max_workers=16) as pool:
        open_ports = sorted(p for p in pool.map(probe, COMMON_SCAN_PORTS) if p)

    entities = [_port_entity(ip, port) for port in open_ports]
    return {
        "entities": entities,
        "links": [_link("open_port") for _ in entities],
        "note": None if entities else
                f"No common TCP port accepted a connection on {ip}.",
    }


# --- lodan workspace --------------------------------------------------------
#
# The one source that is neither public nor third-party: a lodan instance
# holding scans of ranges the operator owns. That inverts two rules that hold
# everywhere else here -- private addresses and internal names are the expected
# input, not a refusal -- and it is the only transform whose results describe
# infrastructure the analyst is responsible for.
#
# node_mapper can only read. lodan's authorization model is an allowlist
# enforced twice with no disable flag, and widening it is a deliberate operator
# act through `lodan manage`; an integration that could add scope on demand
# would make the allowlist decorative. An address outside it comes back with
# authorized:false and this transform says so rather than offering to fix it.

def _lodan_get(path, allow_404=False):
    headers = {"X-Lodan-Token": LODAN_TOKEN} if LODAN_TOKEN else {}
    return _fetch_json(
        LODAN_URL + path, timeout=LODAN_TIMEOUT, allow_404=allow_404,
        headers=headers,
        # Not cached: unlike a public source, this one changes when the operator
        # rescans, and a stale answer to "what is on my network" is the wrong
        # kind of wrong.
        cache=False,
    )


def _lodan_configured():
    return bool(LODAN_URL)


def _cve_entity(vuln):
    """A CVE match, carrying the confidence that qualifies it.

    lodan scores a match against a version-less CPE around 0.45 -- it matched
    the product and nothing more. Dropping that number would turn "possibly,
    if this build is ancient" into a flat assertion on the canvas.
    """
    props = {
        "epss": vuln.get("epss"),
        "priority": vuln.get("priority"),
        "confidence": vuln.get("confidence"),
    }
    if vuln.get("kev"):
        props["kev"] = "yes" + (f" ({vuln['kev_date_added']})" if vuln.get("kev_date_added") else "")
    return _entity("cve", str(vuln.get("cve")), props)


def _lodan_host(ip, params):
    data = _lodan_get(f"/api/v1/host/{urllib.parse.quote(ip)}?include=all", allow_404=True)
    if not isinstance(data, dict):
        raise TransformSourceError(f"lodan has no host endpoint for {ip}.")
    if not data.get("found"):
        if not data.get("authorized"):
            note = (f"{ip} is outside the lodan workspace's authorized_ranges. Authorize it "
                    f"with `lodan manage`, then rescan -- node_mapper cannot widen that scope.")
        else:
            note = f"{ip} is in scope but lodan scan {data.get('scan_id')} never saw it."
        return {"entities": [], "links": [], "note": note}

    host = data.get("host") or {}
    entities, links, edges = [], [], []
    source_props = {}
    for key, value in (("asn", host.get("asn")), ("geo", host.get("country"))):
        if value:
            source_props[key] = f"AS{value}" if key == "asn" else value
    # Map onto the schema's own keys, or the values are stored but never shown.
    # rdns is deliberately absent: it becomes its own node below.
    operating_system = host.get("os_guess") or host.get("os_family")
    if operating_system:
        source_props["os"] = operating_system
    if host.get("device_type"):
        source_props["device"] = host["device_type"]

    if host.get("rdns"):
        entities.append(_entity("domain", str(host["rdns"]).rstrip(".").lower(), {}))
        links.append(_link("rdns"))
    if host.get("asn_org"):
        entities.append(_entity("organization", host["asn_org"], {"country": host.get("country")}))
        links.append(_link("netblock_owner"))

    for service in data.get("services") or []:
        port = service.get("port")
        if port is None:
            continue
        entity = _port_entity(ip, int(port), protocol=service.get("proto") or "tcp",
                              service=service.get("service"))
        if service.get("banner"):
            entity["properties"]["banner"] = str(service["banner"])[:300]
        entities.append(entity)
        links.append(_link("open_port"))

    port_key = lambda p: ("port", f"{ip}:{int(p)}")  # noqa: E731

    for cert in data.get("certs") or []:
        fingerprint = cert.get("sha256")
        if not fingerprint:
            continue
        entities.append(_entity("certificate", fingerprint, {
            "subject": cert.get("subject"), "issuer": cert.get("issuer"),
            "notAfter": cert.get("not_after"), "keyBits": cert.get("key_bits"),
            "sigHash": cert.get("sig_algo"),
        }, label=cert.get("subject") or fingerprint[:16]))
        # None: a certificate hangs off the port that presented it, not off the
        # host -- the edge below says which.
        links.append(None)
        if cert.get("port") is not None:
            edges.append(_edge(port_key(cert["port"]), ("certificate", fingerprint),
                               "presents_cert"))

    for vuln in data.get("vulns") or []:
        if not vuln.get("cve"):
            continue
        entities.append(_cve_entity(vuln))
        links.append(None)
        if vuln.get("port") is not None:
            edges.append(_edge(port_key(vuln["port"]), ("cve", str(vuln["cve"])),
                               "vulnerable_to"))

    for finding in data.get("findings") or []:
        category = finding.get("category") or "finding"
        port = finding.get("port")
        # Scoped like a port node: two hosts with the same missing header must
        # not collapse into one node with edges to both.
        value = f"{ip}:{port if port is not None else '-'}:{category}"
        entities.append(_entity("finding", value, {
            "severity": finding.get("severity"), "kind": category,
            "evidence": json.dumps(finding.get("detail")) if finding.get("detail") else None,
        }, label=finding.get("title") or category))
        if port is None:
            links.append(_link("has_finding"))
        else:
            links.append(None)
            edges.append(_edge(port_key(port), ("finding", value), "has_finding"))

    topology = data.get("topology") or {}
    for sibling in topology.get("clock_siblings") or []:
        other = sibling.get("ip")
        if not other or other == ip:
            continue
        entities.append(_entity("ipv4", other, {}))
        links.append(None)
        # lodan's TCP-timestamp clustering: the two addresses answered with the
        # same boot-time estimate. Undirected -- neither end is the primary.
        edges.append(_edge(("ipv4", ip), ("ipv4", other), "same_machine", directed=False))

    note = None
    if topology.get("min_backend_count", 1) and topology.get("nat_suspected"):
        note = (f"lodan flags {ip} as fronting at least "
                f"{topology['min_backend_count']} machines.")
    return {"entities": entities, "links": links, "edges": edges,
            "sourceProperties": source_props, "note": note}


def _lodan_domain(name, params):
    data = _lodan_get(f"/api/v1/domain/{urllib.parse.quote(name)}?include=subdomains",
                      allow_404=True)
    if not isinstance(data, dict):
        raise TransformSourceError(f"lodan has no domain endpoint for {name}.")

    entities, links = [], []
    for address in data.get("addresses") or []:
        ip = address.get("ip")
        if not ip:
            continue
        entities.append(_entity("ipv4", ip, {}))
        links.append(_link("resolves_to"))
    for subdomain in data.get("subdomains") or []:
        sub = subdomain.get("subdomain")
        if sub:
            entities.append(_entity("domain", sub, {}))
            links.append(_link("subdomain_of"))

    notes = []
    if not data.get("authorized"):
        notes.append(f"{name} is not one of the workspace's authorized_domains.")
    if not data.get("found"):
        notes.append(f"lodan scan {data.get('scan_id')} did not resolve {name}.")
    # Names lodan declined to follow because they leave the authorized domains:
    # third-party infrastructure this name depends on, worth an analyst's eye.
    refused = [r.get("target") for r in (data.get("refused") or []) if r.get("target")]
    if refused:
        notes.append("Refused as out-of-scope CNAME targets: " + ", ".join(refused[:5]) + ".")
    return {"entities": entities, "links": links, "note": " ".join(notes) or None}


def transform_lodan_lookup(entity, params):
    """ipv4/domain/host -> what the operator's own lodan workspace recorded."""
    if not _lodan_configured():
        raise TransformInputError(
            "No lodan instance configured. Point LODAN_URL at a running "
            "`lodan serve` (and set LODAN_TOKEN if it requires one).")
    value = entity.get("value")
    if entity.get("type") == "ipv4":
        return _lodan_host(_any_ip(value), params)
    return _lodan_domain(_clean_hostname(value, allow_internal=True), params)


# --- synthetic placeholders -------------------------------------------------
#
# No keyless source answers these honestly, so they still fabricate. Every one
# is flagged synthetic in the registry, which is what puts the warning in the
# UI and the 'synthetic:' marker in node provenance.

def transform_to_emails(entity, params):
    """domain/person -> 2-3 synthetic email addresses."""
    val = entity.get("value", "")
    etype = entity.get("type", "")
    if etype == "domain":
        domain = val
        locals_ = ["info", "admin", "contact", "support"]
    else:
        # Person/other: derive a slug and a synthetic domain.
        slug = "".join(c for c in val.lower() if c.isalnum()) or "user"
        domain = "example.com"
        locals_ = [slug, f"{slug}.work", f"{slug}1"]
    count = 2 + (_seed_int(val, "emailcount") % 2)  # 2 or 3
    entities = []
    for i in range(min(count, len(locals_))):
        addr = f"{locals_[i]}@{domain}"
        entities.append(_entity("email", addr, {"source": val}))
    return {"entities": entities, "links": [_link("has_email") for _ in entities]}


def transform_reverse_ip(entity, params):
    """ipv4 -> 2-3 synthetic domains sharing the address."""
    val = entity.get("value", "")
    words = ["nimbus", "harbor", "atlas", "vertex", "quarry", "beacon", "cinder"]
    tlds = [".com", ".net", ".io", ".org"]
    count = 2 + (_seed_int(val, "revcount") % 2)
    entities = []
    for i in range(count):
        word = words[_seed_int(val, f"w{i}") % len(words)]
        tld = tlds[_seed_int(val, f"t{i}") % len(tlds)]
        entities.append(_entity("domain", f"{word}{i or ''}{tld}", {"sharedIp": val}))
    return {"entities": entities, "links": [_link("hosted_on", directed=False) for _ in entities]}


def transform_person_to_social(entity, params):
    """person -> 2-3 synthetic social-profile URLs."""
    val = entity.get("value", "")
    slug = "".join(c for c in val.lower() if c.isalnum()) or "user"
    sites = ["linkedin.com/in", "twitter.com", "github.com", "instagram.com"]
    count = 2 + (_seed_int(val, "soccount") % 2)
    entities = []
    for i in range(count):
        site = sites[_seed_int(val, f"s{i}") % len(sites)]
        entities.append(_entity("url", f"https://{site}/{slug}", {"platform": site}))
    return {"entities": entities, "links": [_link("profile") for _ in entities]}


TRANSFORMS = {
    "to_ip": {
        "name": "Resolve to IP",
        "description": "Resolve a domain or host to its A and AAAA records.",
        "input_types": ["domain", "host"],
        "source": "system DNS",
        "run": transform_to_ip,
    },
    "to_subdomains": {
        "name": "Enumerate Subdomains",
        "description": "Find subdomains named in Certificate Transparency logs.",
        "input_types": ["domain"],
        "source": "crt.sh, api.certspotter.com",
        "run": transform_to_subdomains,
    },
    "whois": {
        "name": "WHOIS / RDAP Lookup",
        "description": "Registrar, contact addresses and nameservers for a domain.",
        "input_types": ["domain"],
        "source": "rdap.org",
        "run": transform_whois,
    },
    "to_asn": {
        "name": "IP → Organization (RDAP)",
        "description": "The organisation holding the netblock an address sits in.",
        "input_types": ["ipv4"],
        "source": "rdap.org",
        "run": transform_to_asn,
    },
    "geolocate": {
        "name": "Geolocate IP",
        "description": "Approximate location of an IPv4 address.",
        "input_types": ["ipv4"],
        "source": "ipwho.is",
        "run": transform_geolocate,
    },
    "to_ports": {
        "name": "Known Ports (passive)",
        "description": "Ports, hostnames and CVEs Shodan has already observed. "
                       "Sends nothing to the target.",
        "input_types": ["ipv4"],
        "source": "internetdb.shodan.io",
        "run": transform_known_ports,
    },
    "to_url": {
        "name": "Domain → Archived URLs",
        "description": "URLs under a domain that the Wayback Machine has archived.",
        "input_types": ["domain"],
        "source": "web.archive.org",
        "run": transform_to_url,
    },
    "tcp_scan": {
        "name": "TCP Connect Scan (active)",
        "description": "Probe common TCP ports on the target directly. Sends traffic "
                       "from this server; requires NM_ACTIVE_SCAN=1.",
        "input_types": ["ipv4"],
        "source": "direct probe",
        "active": True,
        "available": lambda: ACTIVE_SCAN_ENABLED,
        "reason": "Disabled on this server. Restart it with NM_ACTIVE_SCAN=1.",
        "run": transform_tcp_scan,
    },
    "lodan_lookup": {
        "name": "lodan Workspace Lookup",
        "description": "Hosts, services, certificates, CVE matches and findings "
                       "from your own lodan scans. Reads only -- it cannot start a "
                       "scan or widen lodan's authorized ranges.",
        "input_types": ["ipv4", "domain", "host"],
        "source": "lodan workspace",
        "available": _lodan_configured,
        "reason": "No lodan instance configured. Set LODAN_URL on this server.",
        # One host's real attack surface, not an open-ended enumeration: the
        # default twelve would drop most of a scanned host's record.
        "default_limit": 200,
        "max_limit": 500,
        "run": transform_lodan_lookup,
    },
    "to_emails": {
        "name": "Find Emails",
        "description": "Placeholder: invents plausible addresses for a domain or person. "
                       "No keyless source answers this.",
        "input_types": ["domain", "person"],
        "source": "synthetic",
        "synthetic": True,
        "run": transform_to_emails,
    },
    "reverse_ip": {
        "name": "Reverse IP",
        "description": "Placeholder: invents co-hosted domains for an address. "
                       "No keyless source answers this.",
        "input_types": ["ipv4"],
        "source": "synthetic",
        "synthetic": True,
        "run": transform_reverse_ip,
    },
    "person_to_social": {
        "name": "Person → Social Profiles",
        "description": "Placeholder: invents profile URLs for a person. "
                       "No keyless source answers this.",
        "input_types": ["person"],
        "source": "synthetic",
        "synthetic": True,
        "run": transform_person_to_social,
    },
}

@app.route("/api/transforms", methods=["GET"])
def api_list_transforms():
    listing = [
        {
            "id": tid,
            "name": meta["name"],
            "inputTypes": meta["input_types"],
            "description": meta["description"],
            "source": meta.get("source", ""),
            "synthetic": bool(meta.get("synthetic")),
            "active": bool(meta.get("active")),
            # A gated transform stays listed while unavailable so the UI can say
            # why instead of silently omitting it.
            "available": _transform_available(meta),
            "reason": "" if _transform_available(meta) else meta.get("reason", ""),
        }
        for tid, meta in TRANSFORMS.items()
    ]
    return jsonify({"transforms": listing})


@app.route("/api/transform", methods=["POST"])
def api_run_transform():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return json_error("Invalid or missing JSON body.", 400)

    transform_id = payload.get("transformId")
    entity = payload.get("entity")
    params = payload.get("params") or {}

    meta = TRANSFORMS.get(transform_id)
    if meta is None:
        return json_error("Unknown transformId.", 400)
    if not isinstance(entity, dict) or "type" not in entity or "value" not in entity:
        return json_error("Entity with 'type' and 'value' is required.", 400)
    if not entity.get("value"):
        return json_error("Entity value must not be empty.", 400)
    if entity.get("type") not in meta["input_types"]:
        return json_error(
            f"Entity type '{entity.get('type')}' is not valid for transform '{transform_id}'.",
            400,
        )

    limit = _result_limit(params, meta)

    try:
        result = meta["run"](entity, params)
    except (TransformInputError, TransformSourceError) as exc:
        # A refused input or an unreachable source is an expected outcome, not a
        # crash: the client shows the message, so keep it readable.
        return json_error(str(exc), exc.status)
    except Exception as exc:  # noqa: BLE001 - return controlled error to client
        return json_error(f"Transform failed: {exc}", 500)

    entities = (result.get("entities") or [])[:limit]
    links = (result.get("links") or [])[:limit]
    # Edges are capped separately: they are cheap, they carry no new nodes, and
    # a dense result (every port of every host) needs more of them than there
    # are entities.
    edges = [e for e in (result.get("edges") or []) if _valid_edge(e)][:TRANSFORM_MAX_EDGES]
    return jsonify({
        "entities": entities,
        "links": links,
        "edges": edges,
        # Facts about the entity the transform ran ON, merged onto that node.
        "sourceProperties": result.get("sourceProperties") or {},
        "note": result.get("note") or "",
        "synthetic": bool(meta.get("synthetic")),
    })


# ============================================================================
# Entrypoint
# ============================================================================

# Initialize the database at import time so it is ready under any WSGI server.
init_db()


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    # threaded=True so SSE streaming connections don't block other requests.
    app.run(host=host, port=port, debug=debug, threaded=True)
