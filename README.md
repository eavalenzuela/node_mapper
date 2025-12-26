# Node Mapper

A lightweight Flask app that serves an in-browser graph editor. The editor lets you create nodes, connect them with edges, group related items into boxes, and experiment with multiple layout algorithms—all without a database or external services.

## Features
- **Interactive graph canvas:** Create, drag, delete, and connect nodes with mouse interactions.
- **Grouping with boxes:** Draw resizable boxes that move their contained nodes together.
- **Property editing:** Update labels, colors, sizes, descriptions, and grouping metadata for nodes; edit edge labels, widths, colors, and directionality; rename boxes.
- **Layouts:** Switch between manual positioning, force-directed, grid, circular, hierarchical, and weighted tree layouts (`static/layout.js`).
- **Search and filtering:** Hide non-matching nodes by label, description, or group.
- **Undo/redo:** In-browser undo stack for most actions.
- **Autosave and file I/O:** LocalStorage autosave plus export/import of graph JSON files.
- **Mini-map:** Overview map that reflects the current viewport and can re-center the main canvas.

## Project structure
- `node_mapper.py` — Flask server exposing JSON endpoints and serving static assets.
- `static/index.html` — UI shell for the editor.
- `static/app.js` — Client-side logic for editing, rendering, and autosave.
- `static/layout.js` — Layout engines for arranging nodes and boxes.
- `static/styles.css` — Sidebar and canvas styling.

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

## Usage tips
- Use the **Modes** section to switch between selecting, creating nodes, linking nodes, deleting, or drawing boxes.
- Apply **Layouts** to reposition content automatically; manual tweaks are preserved until the next layout run.
- The **Mini-map** is clickable—use it to jump the viewport to a new area.
- Autosave writes to `localStorage` under the `graph-autosave-v1` key; use **Load Autosave** to restore it after a refresh.

