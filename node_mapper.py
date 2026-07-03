"""Node Mapper backend.

A Flask application that serves the static client and provides:
  * the original in-memory graph endpoints (/, /nodes, /edges, /graph)
  * graph analytics (/analytics) and per-node centrality (/api/centrality)
  * SQLite-backed projects, version history, and optional session auth
  * an offline, deterministic transform framework (/api/transform[s])

The transforms perform NO real network calls. They return synthetic,
deterministic data so the application works fully offline.
"""

import os
import json
import queue
import sqlite3
import hashlib
import threading
from collections import deque
from datetime import datetime, timezone
from uuid import uuid4
from heapq import heappop, heappush

from flask import Flask, jsonify, request, send_from_directory, session, g, Response
from werkzeug.security import generate_password_hash, check_password_hash


# ============================================================================
# App configuration & security hardening
# ============================================================================

app = Flask(__name__, static_folder="static")

# Cap request bodies (8 MiB) to limit memory pressure / abuse.
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

# Secret key for signed session cookies. Override in production via env.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-insecure-change-me")

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
                data_json TEXT,
                created_at TEXT,
                updated_at TEXT
            )
            """
        )
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
    only projects with a NULL owner.
    """
    if uid is None:
        return "owner_id IS NULL", ()
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
        # Anonymous: may only touch anonymous-owned projects.
        if owner_id is not None:
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
        "SELECT id, name, updated_at FROM projects WHERE %s "
        "ORDER BY updated_at DESC" % where,
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

    db = get_db()
    cur = db.execute(
        "INSERT INTO projects (name, owner_id, data_json, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (name, uid, data_json, ts, ts),
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
        try:
            q.put_nowait(event)
        except queue.Full:
            pass


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
    adj = {node_id: [] for node_id in nodes.keys()}
    for idx, edge in enumerate(edges):
        src = edge.get("source")
        tgt = edge.get("target")
        if src not in adj or tgt not in adj:
            continue
        weight = edge.get("weight", edge.get("width", 1)) if weighted else 1
        weight = max(float(weight), 0.0001)
        edge_id = edge.get("id") or f"e{idx}"
        adj[src].append((tgt, weight, edge_id))
        if not directed or not edge.get("directed"):
            adj[tgt].append((src, weight, edge_id))
    return adj


def compute_components(adj):
    visited = set()
    components = 0
    for start in adj.keys():
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
    return sum(1 for e in edges if e.get("source") == e.get("target"))


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
    for node_id, neighbors in adj.items():
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
    dist = {node: float("inf") for node in adj.keys()}
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
    dist = {node: float("inf") for node in adj.keys()}
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
    labels = {node: node for node in adj.keys()}
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
        src = edge.get("source")
        tgt = edge.get("target")
        if src in out_degree:
            out_degree[src] += 1
        if tgt in in_degree:
            in_degree[tgt] += 1

    betweenness = compute_betweenness(undirected_unweighted)
    pagerank = compute_pagerank(directed_adj)
    communities = detect_communities(undirected_adj)

    metrics = {}
    for n in node_ids:
        total_degree = in_degree[n] + out_degree[n]
        metrics[n] = {
            "degree": total_degree,
            "inDegree": in_degree[n],
            "outDegree": out_degree[n],
            "closeness": round(_closeness_for_node(undirected_adj, n), 6),
            "betweenness": round(betweenness.get(n, 0.0), 6),
            "pagerank": round(pagerank.get(n, 0.0), 6),
        }

    return jsonify({"metrics": metrics, "communities": communities})


# ============================================================================
# Transforms (offline, deterministic — NO real network calls)
# ============================================================================

def _seed_int(*parts):
    """Deterministic integer seed derived from the joined string parts."""
    raw = "::".join(str(p) for p in parts).encode("utf-8")
    return int(hashlib.sha256(raw).hexdigest(), 16)


def _synthetic_octet(seed, salt):
    """Return an IPv4 octet in 1..254 derived deterministically."""
    return 1 + (_seed_int(seed, salt) % 254)


def _entity(etype, value, properties=None):
    return {"type": etype, "value": value, "properties": properties or {}}


def _link(label, directed=True):
    return {"label": label, "directed": directed}


def transform_to_ip(entity, params):
    """domain/host -> 1-2 synthetic IPv4 addresses."""
    val = entity.get("value", "")
    count = 1 + (_seed_int(val, "ipcount") % 2)  # 1 or 2
    entities = []
    for i in range(count):
        ip = "{}.{}.{}.{}".format(
            _synthetic_octet(val, f"a{i}"),
            _synthetic_octet(val, f"b{i}"),
            _synthetic_octet(val, f"c{i}"),
            _synthetic_octet(val, f"d{i}"),
        )
        entities.append(_entity("ipv4", ip, {"resolvedFrom": val}))
    return {"entities": entities, "links": [_link("resolves_to") for _ in entities]}


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


def transform_to_subdomains(entity, params):
    """domain -> 3 synthetic subdomains."""
    val = entity.get("value", "")
    prefixes = ["www", "mail", "api", "dev", "vpn", "shop"]
    start = _seed_int(val, "substart") % len(prefixes)
    entities = []
    for i in range(3):
        prefix = prefixes[(start + i) % len(prefixes)]
        entities.append(_entity("domain", f"{prefix}.{val}", {"parent": val}))
    return {"entities": entities, "links": [_link("subdomain_of") for _ in entities]}


def transform_to_ports(entity, params):
    """ipv4 -> common open ports."""
    val = entity.get("value", "")
    common = [
        (22, "ssh"),
        (80, "http"),
        (443, "https"),
    ]
    entities = []
    for port, service in common:
        entities.append(
            _entity("port", str(port), {"service": service, "host": val})
        )
    return {"entities": entities, "links": [_link("open_port") for _ in entities]}


def transform_whois(entity, params):
    """domain -> 1 registrant person + 1 phone."""
    val = entity.get("value", "")
    first = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley"]
    last = ["Smith", "Nguyen", "Patel", "Garcia", "Khan", "Jones"]
    fn = first[_seed_int(val, "fn") % len(first)]
    ln = last[_seed_int(val, "ln") % len(last)]
    person_name = f"{fn} {ln}"
    area = 200 + (_seed_int(val, "area") % 800)
    mid = 100 + (_seed_int(val, "mid") % 900)
    last4 = 1000 + (_seed_int(val, "last4") % 9000)
    phone = f"+1-{area}-{mid}-{last4}"
    entities = [
        _entity("person", person_name, {"role": "registrant", "domain": val}),
        _entity("phone", phone, {"role": "registrant", "domain": val}),
    ]
    links = [_link("registrant"), _link("registrant_phone")]
    return {"entities": entities, "links": links}


def transform_reverse_ip(entity, params):
    """ipv4 -> 1-2 synthetic domains that resolve to it (reverse DNS / PTR)."""
    val = entity.get("value", "")
    tlds = ["com", "net", "io", "org"]
    words = ["acme", "globex", "initech", "umbrella", "hooli", "stark"]
    count = 1 + (_seed_int(val, "revcount") % 2)  # 1 or 2
    entities = []
    for i in range(count):
        word = words[_seed_int(val, f"revw{i}") % len(words)]
        tld = tlds[_seed_int(val, f"revt{i}") % len(tlds)]
        entities.append(_entity("domain", f"{word}.{tld}", {"resolvesTo": val}))
    return {"entities": entities, "links": [_link("resolves_from") for _ in entities]}


def transform_to_asn(entity, params):
    """ipv4 -> the owning organization / ASN (synthetic)."""
    val = entity.get("value", "")
    orgs = [
        "Cloudflare, Inc.", "Amazon.com, Inc.", "Google LLC", "Hetzner Online GmbH",
        "OVH SAS", "DigitalOcean, LLC", "Akamai Technologies",
    ]
    org = orgs[_seed_int(val, "asnorg") % len(orgs)]
    asn = 1000 + (_seed_int(val, "asn") % 64000)
    entity_out = _entity(
        "organization", org, {"asn": f"AS{asn}", "role": "network operator", "ip": val}
    )
    return {"entities": [entity_out], "links": [_link("announced_by")]}


def transform_geolocate(entity, params):
    """ipv4 -> an approximate geographic location (synthetic)."""
    val = entity.get("value", "")
    cities = [
        ("San Francisco, US", 37.7749, -122.4194),
        ("Ashburn, US", 39.0438, -77.4874),
        ("Frankfurt, DE", 50.1109, 8.6821),
        ("Amsterdam, NL", 52.3676, 4.9041),
        ("Singapore, SG", 1.3521, 103.8198),
        ("London, GB", 51.5074, -0.1278),
    ]
    name, lat, lon = cities[_seed_int(val, "geo") % len(cities)]
    ent = _entity("location", name, {"lat": lat, "lon": lon, "ip": val})
    return {"entities": [ent], "links": [_link("located_in")]}


def transform_to_url(entity, params):
    """domain -> 2 synthetic URLs served by that domain."""
    val = entity.get("value", "")
    paths = ["", "/login", "/about", "/api", "/admin", "/blog"]
    start = _seed_int(val, "urlstart") % len(paths)
    entities = []
    for i in range(2):
        path = paths[(start + i) % len(paths)]
        entities.append(_entity("url", f"https://{val}{path}", {"host": val}))
    return {"entities": entities, "links": [_link("hosts_url") for _ in entities]}


def transform_person_to_social(entity, params):
    """person -> 2-3 synthetic social-profile URLs."""
    val = entity.get("value", "")
    slug = "".join(c for c in val.lower() if c.isalnum()) or "user"
    sites = ["linkedin.com/in", "twitter.com", "github.com", "facebook.com"]
    count = 2 + (_seed_int(val, "soccount") % 2)  # 2 or 3
    entities = []
    for i in range(min(count, len(sites))):
        site = sites[i]
        entities.append(
            _entity("url", f"https://{site}/{slug}", {"profileOf": val, "platform": site.split("/")[0]})
        )
    return {"entities": entities, "links": [_link("has_profile") for _ in entities]}


# Registry: id -> metadata + runner. input_types declares applicable entity types.
TRANSFORMS = {
    "to_ip": {
        "name": "Resolve to IP",
        "description": "Resolve a domain or host to synthetic IPv4 addresses.",
        "input_types": ["domain", "host"],
        "run": transform_to_ip,
    },
    "to_emails": {
        "name": "Find Emails",
        "description": "Discover synthetic email addresses for a domain or person.",
        "input_types": ["domain", "person"],
        "run": transform_to_emails,
    },
    "to_subdomains": {
        "name": "Enumerate Subdomains",
        "description": "Enumerate synthetic subdomains of a domain.",
        "input_types": ["domain"],
        "run": transform_to_subdomains,
    },
    "to_ports": {
        "name": "Scan Common Ports",
        "description": "List commonly open ports for an IPv4 host.",
        "input_types": ["ipv4"],
        "run": transform_to_ports,
    },
    "whois": {
        "name": "WHOIS Lookup",
        "description": "Return a synthetic registrant person and phone for a domain.",
        "input_types": ["domain"],
        "run": transform_whois,
    },
    "reverse_ip": {
        "name": "Reverse IP",
        "description": "Find synthetic domains that resolve to an IPv4 address.",
        "input_types": ["ipv4"],
        "run": transform_reverse_ip,
    },
    "to_asn": {
        "name": "IP → Organization (ASN)",
        "description": "Identify the synthetic network operator / ASN owning an IPv4.",
        "input_types": ["ipv4"],
        "run": transform_to_asn,
    },
    "geolocate": {
        "name": "Geolocate IP",
        "description": "Return an approximate synthetic location for an IPv4 address.",
        "input_types": ["ipv4"],
        "run": transform_geolocate,
    },
    "to_url": {
        "name": "Domain → URLs",
        "description": "Enumerate synthetic URLs hosted on a domain.",
        "input_types": ["domain"],
        "run": transform_to_url,
    },
    "person_to_social": {
        "name": "Person → Social Profiles",
        "description": "Discover synthetic social-media profile URLs for a person.",
        "input_types": ["person"],
        "run": transform_person_to_social,
    },
}

TRANSFORM_DEFAULT_LIMIT = 12
TRANSFORM_MAX_LIMIT = 50


@app.route("/api/transforms", methods=["GET"])
def api_list_transforms():
    listing = [
        {
            "id": tid,
            "name": meta["name"],
            "inputTypes": meta["input_types"],
            "description": meta["description"],
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
            "Entity type '%s' is not valid for transform '%s'."
            % (entity.get("type"), transform_id),
            400,
        )

    # Resolve and clamp the result limit.
    try:
        limit = int(params.get("limit", TRANSFORM_DEFAULT_LIMIT))
    except (TypeError, ValueError):
        limit = TRANSFORM_DEFAULT_LIMIT
    limit = max(1, min(limit, TRANSFORM_MAX_LIMIT))

    try:
        result = meta["run"](entity, params)
    except Exception as exc:  # noqa: BLE001 - return controlled error to client
        return json_error("Transform failed: %s" % exc, 500)

    entities = (result.get("entities") or [])[:limit]
    links = (result.get("links") or [])[:limit]
    return jsonify({"entities": entities, "links": links})


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
