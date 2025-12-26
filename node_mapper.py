from flask import Flask, jsonify, request, send_from_directory
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

if __name__ == "__main__":
    app.run(debug=True)
