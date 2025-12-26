from flask import Flask, jsonify, request, send_from_directory
from heapq import heappop, heappush
from uuid import uuid4

app = Flask(__name__, static_folder="static")

# In-memory graph
GRAPH = {
    "nodes": {},
    "edges": []
}

@app.route("/")
def serve_index():
    return send_from_directory("static", "index.html")

@app.route("/nodes", methods=["POST"])
def create_node():
    data = request.json
    node_id = str(uuid4())
    GRAPH["nodes"][node_id] = {
        "id": node_id,
        "x": data.get("x", 100),
        "y": data.get("y", 100),
        "label": data.get("label", "Node")
    }
    return GRAPH["nodes"][node_id]

@app.route("/edges", methods=["POST"])
def create_edge():
    data = request.json
    GRAPH["edges"].append({
        "source": data["source"],
        "target": data["target"]
    })
    return {"status": "ok"}

@app.route("/graph", methods=["GET"])
def get_graph():
    return GRAPH

@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)


# ---------- Analytics helpers ----------

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
    return {
        "nodeCount": node_count,
        "edgeCount": edge_count,
        "components": components,
        "averageDegree": round(avg_degree, 2),
        "maxDegree": max_degree,
        "isolated": isolated,
    }


def bfs_path(adj, start, end):
    if start not in adj or end not in adj:
        return None
    queue = [start]
    visited = {start}
    parent = {}
    while queue:
        node = queue.pop(0)
        if node == end:
            break
        for nxt, _, edge_id in adj[node]:
            if nxt not in visited:
                visited.add(nxt)
                parent[nxt] = (node, edge_id)
                queue.append(nxt)
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
    payload = request.json or {}
    graph = payload.get("graph") or {}
    start = payload.get("start")
    end = payload.get("end")
    algorithm = payload.get("algorithm") or "auto"

    stats = compute_stats(graph)
    path = None
    path_error = None

    nodes = graph.get("nodes") or {}
    if start and end:
        if start not in nodes or end not in nodes:
            path_error = "Start or end node not found."
        else:
            weighted_adj = build_adjacency(nodes, graph.get("edges") or [], weighted=True, directed=True)
            unweighted_adj = build_adjacency(nodes, graph.get("edges") or [], weighted=False, directed=True)
            if algorithm == "bfs":
                path = bfs_path(unweighted_adj, start, end)
            elif algorithm == "dijkstra":
                path = dijkstra_path(weighted_adj, start, end)
            else:
                path = dijkstra_path(weighted_adj, start, end) or bfs_path(unweighted_adj, start, end)
            if not path:
                path_error = "No path between the selected nodes."

    return jsonify({"stats": stats, "path": path, "pathError": path_error})


if __name__ == "__main__":
    app.run(debug=True)
