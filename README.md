# Node Mapper

A lightweight Flask app that serves an in-browser graph editor. The editor lets you create nodes, connect them with edges, group related items into boxes, and experiment with multiple layout algorithms—all without a database or external services.

## Features
- **Interactive graph canvas:** Create, drag, delete, and connect nodes with mouse interactions.
- **Grouping with boxes:** Draw resizable boxes that move their contained nodes together.
- **Property editing:** Update labels, colors, sizes, descriptions, and grouping metadata for nodes; edit edge labels, widths, colors, and directionality; rename boxes.
- **Layouts:** Switch between manual positioning, force-directed, grid, circular, hierarchical, and weighted tree layouts (`static/layout.js`) with tunable spacing/radius/force controls.
- **Edge routing:** Choose straight or orthogonal edge routing to reduce visual clutter on dense graphs.
- **Search and filtering:** Hide non-matching nodes by label, description, or group.
- **Undo/redo:** In-browser undo stack for most actions.
- **Autosave and file I/O:** LocalStorage autosave plus export/import of graph JSON files, including layout settings and routing preferences.
- **Mini-map:** Overview map that reflects the current viewport and can re-center the main canvas.
- **Analytics:** Sidebar tools to compute graph metrics and find shortest paths (BFS or Dijkstra), with optional server-side computation for very large graphs.
- **Import/Export formats:** Load graphs from JSON, CSV edge lists, or GraphML; export to JSON, SVG, or PNG directly from the UI.

## Layout modes and parameters
- **Manual:** Drag items directly. Use the **Edges → Routing style** control to toggle straight vs. orthogonal segments.
- **Force layout:** Configure repulsion strength, ideal edge length, and iteration count for faster or looser packing.
- **Grid layout:** Control horizontal/vertical spacing for both boxes and unboxed nodes.
- **Circular layout:** Set inner and outer radii for box and node rings.
- **Hierarchical layout:** Adjust node spacing horizontally and vertically across BFS-like tiers.
- **Weighted tree:** Set tier count along with tier and node spacing for degree-weighted layers.

Layout and routing settings persist in `localStorage` and are bundled into JSON exports/imports so collaborators can reproduce the same view.

## Project structure
- `node_mapper.py` — Flask server exposing JSON endpoints and serving static assets.
- `static/index.html` — UI shell for the editor.
- `static/app.js` — Client-side logic for editing, rendering, and autosave.
- `static/layout.js` — Layout engines for arranging nodes and boxes.
- `static/styles.css` — Sidebar and canvas styling.

## Import / Export formats
Use the **Import / Export** section in the sidebar to choose a format, select a file, and download exports:

- **JSON:** Full graph (nodes, edges, boxes, layout settings). Uses the same structure as autosave exports.
- **CSV edge list:** Rows describing edges. Headers are optional; when present the parser looks for `source`, `target`, `label`, `width`, `color`, and `directed` columns.
  ```csv
  source,target,label,directed
  A,B,Depends on,true
  B,C,Uses,false
  ```
- **GraphML:** Basic GraphML with node/edge IDs. Edge direction uses the `<graph edgedefault>` attribute or per-edge `directed` attributes. Labels are pulled from `<data key="label">` (or `y:NodeLabel` when present).
  ```xml
  <graphml xmlns="http://graphml.graphdrawing.org/xmlns">
    <graph id="G" edgedefault="directed">
      <node id="A"><data key="label">Service A</data></node>
      <node id="B"><data key="label">Service B</data></node>
      <edge id="e1" source="A" target="B"><data key="label">Calls</data></edge>
    </graph>
  </graphml>
  ```
- **SVG / PNG:** Exports use the current SVG canvas (`#graphCanvas`) so visuals match what you see (including themes, labels, and routing).

## Running locally
1. Install Python 3.10+ and create a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies (only Flask is required):
   ```bash
   pip install flask
   ```
3. Start the development server:
   ```bash
   python node_mapper.py
   ```
4. Open http://localhost:5000 in your browser.

The server uses an in-memory graph (`GRAPH` in `node_mapper.py`). Data is not persisted between restarts beyond the browser’s LocalStorage autosave.

## API endpoints
- `GET /graph` — Return the current in-memory graph.
- `POST /nodes` — Create a node; accepts `x`, `y`, and `label` (defaults provided).
- `POST /edges` — Create an edge between `source` and `target` node IDs.
- `GET /` and `GET /static/*` — Serve the front-end assets.

## Analytics
- Use the **Analytics** panel in the sidebar to compute node/edge counts, component counts, average/max degree, and isolated node totals.
- Enter two node IDs to run **Find path A→B** using BFS (unweighted) or Dijkstra (weighted) shortest paths; paths highlight on the canvas.
- For large graphs (default: 500+ nodes), analytics requests automatically fall back to the Flask `/analytics` endpoint to avoid blocking the browser.

## Usage tips
- Use the **Modes** section to switch between selecting, creating nodes, linking nodes, deleting, or drawing boxes.
- Apply **Layouts** to reposition content automatically; manual tweaks are preserved until the next layout run.
- The **Mini-map** is clickable—use it to jump the viewport to a new area.
- Autosave writes to `localStorage` under the `graph-autosave-v1` key; use **Load Autosave** to restore it after a refresh.
