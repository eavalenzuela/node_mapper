// app.js – box-enabled graph editor

const svg = document.getElementById("graphCanvas");
const minimap = document.getElementById("minimap");
const NS = "http://www.w3.org/2000/svg";
const THEME_KEY = "graph-theme";

// ---------- STATE ----------

let nodes = {};   // id -> { id, x, y, label, color, size, desc, box }
let edges = [];   // { id, source, target, label, color, width, directed }
let boxes = {};   // id -> { id, label, x, y, width, height, nodes: [nodeId...] }

let currentMode = "select";  // "select" | "node" | "link" | "delete" | "box"

let selectedNodeId = null;
let selectedEdgeId = null;
let selectedBoxId = null;

// camera / viewport
let view = { scale: 1, tx: 0, ty: 0 };

// dragging
let draggingNodeId = null;
let dragOffset = { x: 0, y: 0 };

let draggingBoxId = null;
let dragBoxOffset = { x: 0, y: 0 };

let panning = false;
let panStart = { x: 0, y: 0 };
let panViewStart = { tx: 0, ty: 0 };

// resizing
let resizingBoxId = null;
let resizeCorner = null;

// link mode helper
let linkStartNodeId = null;

// undo / redo
let undoStack = [];
let redoStack = [];

// search
let searchTerm = "";

// autosave
const AUTOSAVE_KEY = "graph-autosave-v1";
let currentTheme = "light";

// id counters for new elements
let nodeCounter = 0;
let edgeCounter = 0;
let boxCounter = 0;

const LAYOUT_SETTINGS_KEY = "graph-layout-settings-v1";

function defaultLayoutSettings() {
    return {
        selectedLayout: "manual",
        edgeRouting: "straight",
        options: {
            force: {
                iterations: 150,
                repulsion: 20000,
                idealEdgeLength: 220,
                separationPadding: 40,
                separationIterations: 30
            },
            grid: {
                boxHMargin: 400,
                boxVMargin: 280,
                boxStartX: 100,
                boxStartY: 100,
                separationPadding: 40,
                separationIterations: 50,
                nodeHMargin: 150,
                nodeVMargin: 150
            },
            circle: {
                outerRadius: 600,
                innerRadius: 350,
                separationPadding: 40,
                separationIterations: 50
            },
            hierarchical: {
                boxHMargin: 400,
                boxVMargin: 260,
                boxStartX: 150,
                boxStartY: 80,
                separationPadding: 40,
                separationIterations: 50,
                nodeHMargin: 180,
                nodeVMargin: 120,
                nodeStartX: 150,
                nodeStartY: 200
            },
            weightedTree: {
                boxStartX: 100,
                boxStartY: 100,
                boxHMargin: 400,
                boxVMargin: 260,
                separationPadding: 40,
                separationIterations: 30,
                tiers: 4,
                tierSpacing: 180,
                nodeSpacing: 150,
                nodeStartX: 200
            }
        }
    };
}

let layoutSettings = defaultLayoutSettings();
const ANALYTICS_BACKEND_THRESHOLD = 500;

const analyticsState = {
    stats: null,
    pathResult: null,
    pathError: null,
    usingBackend: false
};

let pathHighlights = {
    nodes: new Set(),
    edges: new Set()
};

function normalizeLayoutSettings(incoming = {}) {
    const base = defaultLayoutSettings();
    const payload = incoming || {};
    base.selectedLayout = payload.selectedLayout || payload.type || base.selectedLayout;
    base.edgeRouting = payload.edgeRouting || payload.routing || base.edgeRouting;

    const optionSource = payload.options || payload;
    Object.keys(base.options).forEach(key => {
        base.options[key] = {
            ...base.options[key],
            ...(optionSource[key] || {})
        };
    });

    return base;
}

function loadLayoutSettingsFromStorage() {
    const raw = localStorage.getItem(LAYOUT_SETTINGS_KEY);
    if (!raw) return defaultLayoutSettings();
    try {
        const parsed = JSON.parse(raw);
        return normalizeLayoutSettings(parsed);
    } catch (e) {
        console.warn("Could not parse stored layout settings", e);
        return defaultLayoutSettings();
    }
}

function saveLayoutSettingsToStorage() {
    localStorage.setItem(LAYOUT_SETTINGS_KEY, JSON.stringify(layoutSettings));
}

layoutSettings = loadLayoutSettingsFromStorage();

// ---------- UTILITIES ----------

function snapshot() {
    return JSON.stringify({ nodes, edges, boxes, layoutSettings });
}

function restoreFromSnapshot(json) {
    const data = JSON.parse(json);
    nodes = data.nodes || {};
    edges = data.edges || [];
    boxes = data.boxes || {};
    layoutSettings = normalizeLayoutSettings(data.layoutSettings);
    nodeCounter = Object.keys(nodes).length;
    edgeCounter = edges.length;
    boxCounter = Object.keys(boxes).length;
    syncLayoutControlsFromSettings();
    saveLayoutSettingsToStorage();
}

function pushUndo() {
    undoStack.push(snapshot());
    redoStack.length = 0;
}

function applyGraphPayload(graph = {}) {
    nodes = graph.nodes || {};
    edges = (graph.edges || []).map((ed, i) => ({
        id: ed.id || `e${i}`,
        source: ed.source,
        target: ed.target,
        label: ed.label || "",
        color: ed.color || "#888888",
        width: ed.width || 2,
        directed: !!ed.directed
    }));

    boxes = graph.boxes || {};

    const incomingLayout = graph.layoutSettings || graph.layout;
    if (incomingLayout) {
        layoutSettings = normalizeLayoutSettings(incomingLayout);
        saveLayoutSettingsToStorage();
    }

    nodeCounter = Object.keys(nodes).length;
    edgeCounter = edges.length;
    boxCounter = Object.keys(boxes).length;

    selectedNodeId = null;
    selectedEdgeId = null;
    selectedBoxId = null;
    analyticsState.stats = null;
    analyticsState.pathResult = null;
    analyticsState.pathError = null;
    resetPathHighlights();
    renderAnalyticsPanel();
    syncLayoutControlsFromSettings();
}

function screenToWorld(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const x = (clientX - rect.left - view.tx) / view.scale;
    const y = (clientY - rect.top - view.ty) / view.scale;
    return { x, y };
}

function resetPathHighlights() {
    pathHighlights = { nodes: new Set(), edges: new Set() };
}

// ---------- ANALYTICS HELPERS ----------

function buildAdjacency({ directed = true, weighted = false } = {}) {
    const adj = {};
    Object.keys(nodes).forEach(id => { adj[id] = []; });

    edges.forEach(edge => {
        if (!nodes[edge.source] || !nodes[edge.target]) return;
        const weight = weighted ? Math.max(0.0001, Number(edge.weight || edge.width || 1)) : 1;
        const entry = { to: edge.target, id: edge.id, weight };
        adj[edge.source].push(entry);
        if (!directed || !edge.directed) {
            adj[edge.target].push({ to: edge.source, id: edge.id, weight });
        }
    });

    return adj;
}

function bfsShortestPath(start, goal) {
    const adj = buildAdjacency({ directed: true, weighted: false });
    if (!adj[start] || !adj[goal]) return null;
    const queue = [start];
    const visited = new Set([start]);
    const parent = {};

    while (queue.length) {
        const node = queue.shift();
        if (node === goal) break;
        adj[node].forEach(next => {
            if (!visited.has(next.to)) {
                visited.add(next.to);
                parent[next.to] = { node, edgeId: next.id };
                queue.push(next.to);
            }
        });
    }

    if (!visited.has(goal)) return null;

    const nodePath = [];
    const edgePath = [];
    let cur = goal;
    while (cur !== undefined) {
        nodePath.push(cur);
        const meta = parent[cur];
        if (!meta) break;
        edgePath.push(meta.edgeId);
        cur = meta.node;
    }
    nodePath.reverse();
    edgePath.reverse();
    return { nodes: nodePath, edges: edgePath, algorithm: "bfs" };
}

function dijkstraShortestPath(start, goal) {
    const adj = buildAdjacency({ directed: true, weighted: true });
    if (!adj[start] || !adj[goal]) return null;

    const dist = {};
    const prev = {};
    Object.keys(adj).forEach(id => { dist[id] = Infinity; });
    dist[start] = 0;

    const queue = Object.keys(adj);
    while (queue.length) {
        queue.sort((a, b) => dist[a] - dist[b]);
        const u = queue.shift();
        if (u === goal || dist[u] === Infinity) break;
        adj[u].forEach(({ to, id, weight }) => {
            const alt = dist[u] + weight;
            if (alt < dist[to]) {
                dist[to] = alt;
                prev[to] = { node: u, edgeId: id };
            }
        });
    }

    if (dist[goal] === Infinity) return null;

    const nodePath = [];
    const edgePath = [];
    let cur = goal;
    while (cur !== undefined) {
        nodePath.push(cur);
        const meta = prev[cur];
        if (!meta) break;
        edgePath.push(meta.edgeId);
        cur = meta.node;
    }
    nodePath.reverse();
    edgePath.reverse();
    return { nodes: nodePath, edges: edgePath, cost: dist[goal], algorithm: "dijkstra" };
}

function computeConnectedComponents() {
    const adj = buildAdjacency({ directed: false, weighted: false });
    const visited = new Set();
    let components = 0;

    Object.keys(adj).forEach(start => {
        if (visited.has(start)) return;
        components += 1;
        const stack = [start];
        visited.add(start);
        while (stack.length) {
            const node = stack.pop();
            adj[node].forEach(next => {
                if (!visited.has(next.to)) {
                    visited.add(next.to);
                    stack.push(next.to);
                }
            });
        }
    });

    return components;
}

function computeGraphStats() {
    const nodeCount = Object.keys(nodes).length;
    const edgeCount = edges.length;
    const adj = buildAdjacency({ directed: false, weighted: false });
    let maxDegree = 0;
    let isolated = 0;
    Object.keys(adj).forEach(id => {
        const deg = adj[id].length;
        if (deg === 0) isolated += 1;
        maxDegree = Math.max(maxDegree, deg);
    });

    return {
        nodeCount,
        edgeCount,
        components: computeConnectedComponents(),
        averageDegree: nodeCount ? (edgeCount * 2 / nodeCount).toFixed(2) : "0.00",
        maxDegree,
        isolated
    };
}

function deriveHighlights(pathResult) {
    resetPathHighlights();
    if (!pathResult) return;
    (pathResult.nodes || []).forEach(id => pathHighlights.nodes.add(id));
    (pathResult.edges || []).forEach(id => pathHighlights.edges.add(id));
}

async function runAnalytics({ startId, endId, algorithm }) {
    const shouldUseBackend = Object.keys(nodes).length > ANALYTICS_BACKEND_THRESHOLD;
    const graphPayload = { nodes, edges };
    analyticsState.pathError = null;

    if (shouldUseBackend) {
        try {
            const res = await fetch("/analytics", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ graph: graphPayload, start: startId, end: endId, algorithm })
            });
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            analyticsState.stats = data.stats || null;
            analyticsState.pathResult = data.path || null;
            analyticsState.pathError = data.pathError || null;
            analyticsState.usingBackend = true;
            deriveHighlights(analyticsState.pathResult);
            renderAnalyticsPanel();
            render();
            return;
        } catch (e) {
            console.warn("Falling back to client-side analytics:", e);
        }
    }

    analyticsState.usingBackend = false;
    analyticsState.stats = computeGraphStats();

    if (startId && endId) {
        if (!nodes[startId] || !nodes[endId]) {
            analyticsState.pathResult = null;
            analyticsState.pathError = "Start or end node not found.";
            resetPathHighlights();
            renderAnalyticsPanel();
            render();
            return;
        }
        let path;
        if (algorithm === "dijkstra") {
            path = dijkstraShortestPath(startId, endId);
        } else if (algorithm === "bfs") {
            path = bfsShortestPath(startId, endId);
        } else {
            path = dijkstraShortestPath(startId, endId) || bfsShortestPath(startId, endId);
        }
        analyticsState.pathResult = path;
        analyticsState.pathError = path ? null : "No path between the selected nodes.";
        deriveHighlights(path);
    } else {
        analyticsState.pathResult = null;
        analyticsState.pathError = null;
        resetPathHighlights();
    }
    renderAnalyticsPanel();
    render();
}

function renderAnalyticsPanel() {
    const statsEl = document.getElementById("analytics-stats");
    const pathEl = document.getElementById("analytics-path-result");
    const backendBadge = document.getElementById("analytics-backend-badge");
    const usingBackend = analyticsState.usingBackend;

    if (backendBadge) {
        backendBadge.textContent = usingBackend ? "Backend" : "In-browser";
        backendBadge.className = usingBackend ? "badge badge-green" : "badge badge-gray";
    }

    if (statsEl) {
        const s = analyticsState.stats;
        if (!s) {
            statsEl.innerHTML = "<em>No stats computed yet.</em>";
        } else {
            statsEl.innerHTML = `
                <div><strong>Nodes:</strong> ${s.nodeCount}</div>
                <div><strong>Edges:</strong> ${s.edgeCount}</div>
                <div><strong>Components:</strong> ${s.components}</div>
                <div><strong>Average degree:</strong> ${s.averageDegree}</div>
                <div><strong>Max degree:</strong> ${s.maxDegree}</div>
                <div><strong>Isolated nodes:</strong> ${s.isolated}</div>
            `;
        }
    }

    if (pathEl) {
        const p = analyticsState.pathResult;
        if (analyticsState.pathError) {
            pathEl.innerHTML = `<div class="error-text">${analyticsState.pathError}</div>`;
        } else if (!p) {
            pathEl.innerHTML = "<em>No path computed yet.</em>";
        } else {
            const nodesStr = (p.nodes || []).join(" → ");
            const costStr = typeof p.cost === "number" ? ` (cost ${p.cost.toFixed(2)})` : "";
            pathEl.innerHTML = `
                <div><strong>Algorithm:</strong> ${p.algorithm || "auto"}</div>
                <div><strong>Path:</strong> ${nodesStr || "n/a"}</div>
                ${costStr ? `<div><strong>Distance:</strong> ${p.cost.toFixed(2)}</div>` : ""}
                <div><strong>Edges:</strong> ${(p.edges || []).join(", ") || "n/a"}</div>
            `;
        }
    }
}

function updateAutosaveInfo() {
    const info = document.getElementById("autosave-info");
    if (!info) return;
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) {
        info.textContent = "No autosave yet.";
        return;
    }
    try {
        const data = JSON.parse(raw);
        const d = new Date(data.timestamp);
        info.textContent = "Last autosave: " + d.toLocaleString();
    } catch {
        info.textContent = "Autosave corrupted.";
    }
}

function autosave() {
    const payload = {
        timestamp: Date.now(),
        graph: { nodes, edges, boxes },
        layoutSettings
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    updateAutosaveInfo();
}

// ---------- THEME ----------

function applyTheme(theme) {
    currentTheme = theme === "dark" ? "dark" : "light";
    document.body.classList.toggle("dark", currentTheme === "dark");
    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
        toggle.classList.toggle("active", currentTheme === "dark");
        toggle.setAttribute("aria-checked", currentTheme === "dark");
    }
    localStorage.setItem(THEME_KEY, currentTheme);
}

function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") {
        applyTheme(saved);
        return;
    }
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
}

const themeToggle = document.getElementById("theme-toggle");
if (themeToggle) {
    themeToggle.addEventListener("click", () => {
        applyTheme(currentTheme === "dark" ? "light" : "dark");
    });
}

// ---------- LOAD INITIAL GRAPH (optional backend) ----------

async function loadGraphFromBackend() {
    try {
        const res = await fetch("/graph");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const graph = await res.json();

        applyGraphPayload(graph);
        undoStack.length = 0;
        redoStack.length = 0;

        render();
    } catch (e) {
        console.warn("Could not load /graph, starting empty:", e);
        nodes = {};
        edges = [];
        boxes = {};
        nodeCounter = 0;
        edgeCounter = 0;
        boxCounter = 0;
        analyticsState.stats = null;
        analyticsState.pathResult = null;
        analyticsState.pathError = null;
        resetPathHighlights();
        syncLayoutControlsFromSettings();
        renderAnalyticsPanel();
        render();
    }
}

// ---------- SIDEBAR UI ----------

// mode buttons
document.querySelectorAll("#sidebar button[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
        currentMode = btn.dataset.mode;
        updateModeButtons();
    });
});

function updateModeButtons() {
    document.querySelectorAll("#sidebar button[data-mode]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === currentMode);
    });
}
updateModeButtons();

// undo / redo
document.getElementById("undo-btn").addEventListener("click", () => {
    if (!undoStack.length) return;
    const current = snapshot();
    const prev = undoStack.pop();
    redoStack.push(current);
    restoreFromSnapshot(prev);
    selectedNodeId = null;
    selectedEdgeId = null;
    selectedBoxId = null;
    render();
});

document.getElementById("redo-btn").addEventListener("click", () => {
    if (!redoStack.length) return;
    const current = snapshot();
    const next = redoStack.pop();
    undoStack.push(current);
    restoreFromSnapshot(next);
    selectedNodeId = null;
    selectedEdgeId = null;
    selectedBoxId = null;
    render();
});

// search
document.getElementById("search-input").addEventListener("input", e => {
    searchTerm = e.target.value.trim().toLowerCase();
    render();
});

// node editor
function updateNodeEditor() {
    const editor = document.getElementById("node-editor");
    const disabled = !selectedNodeId || !nodes[selectedNodeId];
    editor.style.opacity = disabled ? "0.4" : "1";

    if (disabled) return;

    const n = nodes[selectedNodeId];
    document.getElementById("edit-label").value = n.label || "";
    document.getElementById("edit-color").value = n.color || "#4682b4";
    document.getElementById("edit-size").value = n.size || 25;
    document.getElementById("edit-group").value = n.group || "";
    document.getElementById("edit-desc").value = n.desc || "";
}

document.getElementById("apply-node-edit").addEventListener("click", () => {
    if (!selectedNodeId || !nodes[selectedNodeId]) return;
    pushUndo();

    const n = nodes[selectedNodeId];
    n.label = document.getElementById("edit-label").value;
    n.color = document.getElementById("edit-color").value || "#4682b4";
    n.size = parseFloat(document.getElementById("edit-size").value) || 25;
    n.group = document.getElementById("edit-group").value || "";
    n.desc = document.getElementById("edit-desc").value || "";

    render();
});

// edge editor
function updateEdgeEditor() {
    const editor = document.getElementById("edge-editor");
    const e = edges.find(ed => ed.id === selectedEdgeId);
    const disabled = !e;
    editor.style.opacity = disabled ? "0.4" : "1";

    if (disabled) return;

    document.getElementById("edge-label").value = e.label || "";
    document.getElementById("edge-color").value = e.color || "#888888";
    document.getElementById("edge-width").value = e.width || 2;
    document.getElementById("edge-directed").checked = !!e.directed;
}

document.getElementById("apply-edge-edit").addEventListener("click", () => {
    const e = edges.find(ed => ed.id === selectedEdgeId);
    if (!e) return;
    pushUndo();

    e.label = document.getElementById("edge-label").value;
    e.color = document.getElementById("edge-color").value || "#888888";
    e.width = parseFloat(document.getElementById("edge-width").value) || 2;
    e.directed = document.getElementById("edge-directed").checked;

    render();
});

function moveBoxAndChildren(boxId, newX, newY) {
    const b = boxes[boxId];
    if (!b) return;

    const dx = newX - b.x;
    const dy = newY - b.y;

    b.x = newX;
    b.y = newY;

    b.nodes.forEach(nodeId => {
        const n = nodes[nodeId];
        if (n) {
            n.x += dx;
            n.y += dy;
        }
    });
}

// save / load JSON
document.getElementById("save-json").addEventListener("click", () => {
    const graph = { nodes, edges, boxes, layoutSettings };
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "graph.json";
    a.click();
});

document.getElementById("load-json").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        pushUndo();
        const graph = JSON.parse(reader.result);
        applyGraphPayload(graph);
        render();
    };
    reader.readAsText(file);
});

// autosave load
document.getElementById("load-autosave").addEventListener("click", () => {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    try {
        pushUndo();
        const data = JSON.parse(raw);
        const g = data.graph || {};
        applyGraphPayload({
            ...g,
            layoutSettings: data.layoutSettings || g.layoutSettings
        });
        render();
    } catch (e) {
        console.error("Error reading autosave", e);
    }
});

// box editor
document.getElementById("apply-box-edit").addEventListener("click", () => {
    if (!selectedBoxId) return;
    pushUndo();
    const b = boxes[selectedBoxId];
    b.label = document.getElementById("edit-box-label").value;
    render();
});

// analytics
const computeStatsBtn = document.getElementById("compute-stats");
if (computeStatsBtn) {
    computeStatsBtn.addEventListener("click", () => {
        runAnalytics({ algorithm: "auto" });
    });
}

const findPathBtn = document.getElementById("find-path-btn");
if (findPathBtn) {
    findPathBtn.addEventListener("click", () => {
        const startInput = document.getElementById("path-start");
        const endInput = document.getElementById("path-end");
        const algoSelect = document.getElementById("path-algorithm");
        const startId = (startInput?.value || "").trim();
        const endId = (endInput?.value || "").trim();
        const algorithm = algoSelect?.value || "auto";
        runAnalytics({ startId: startId || null, endId: endId || null, algorithm });
    });
}

const clearPathBtn = document.getElementById("clear-path-btn");
if (clearPathBtn) {
    clearPathBtn.addEventListener("click", () => {
        analyticsState.pathResult = null;
        analyticsState.pathError = null;
        resetPathHighlights();
        renderAnalyticsPanel();
        render();
    });
}

// ---------- PAN & ZOOM ----------

svg.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.1 : 0.9;

    const worldPos = screenToWorld(e.clientX, e.clientY);

    view.tx = (view.tx - worldPos.x * view.scale) * zoomFactor + worldPos.x * (view.scale * zoomFactor);
    view.ty = (view.ty - worldPos.y * view.scale) * zoomFactor + worldPos.y * (view.scale * zoomFactor);
    view.scale *= zoomFactor;

    render();
}, { passive: false });

// ---------- POINTER INTERACTION ----------

svg.addEventListener("pointerdown", e => {
    const nodeId = e.target.dataset?.nodeId;
    const edgeId = e.target.dataset?.edgeId;
    const boxId  = e.target.dataset?.boxId;
    const resizeId = e.target.dataset?.resizeBoxId;
    const corner = e.target.dataset?.resizeCorner;

    if (e.button === 1) {  // middle mouse
        panning = true;
        panStart = { x: e.clientX, y: e.clientY };
        panViewStart = { tx: view.tx, ty: view.ty };
        svg.setPointerCapture(e.pointerId);
        return;
    }

    if (resizeId && corner && currentMode === "select") {
        // start resizing
        resizingBoxId = resizeId;
        resizeCorner = corner;
        svg.setPointerCapture(e.pointerId);
        return;
    }

    if (boxId && currentMode === "select") {
        const b = boxes[boxId];
        const pos = screenToWorld(e.clientX, e.clientY);
        dragBoxOffset.x = pos.x - b.x;
        dragBoxOffset.y = pos.y - b.y;
        draggingBoxId = boxId;

        selectedBoxId = boxId;
        selectedNodeId = null;
        selectedEdgeId = null;

        svg.setPointerCapture(e.pointerId);
        return;
    }

    // NODE interactions
    if (nodeId) {
        const n = nodes[nodeId];

        if (currentMode === "delete") {
            pushUndo();
            deleteNode(nodeId);
            render();
            return;
        }

        if (currentMode === "link") {
            if (!linkStartNodeId) {
                linkStartNodeId = nodeId;
            } else {
                if (linkStartNodeId !== nodeId) {
                    pushUndo();
                    createEdge(linkStartNodeId, nodeId);
                }
                linkStartNodeId = null;
            }
            render();
            return;
        }

        if (currentMode === "select") {
            pushUndo();
            selectedNodeId = nodeId;
            selectedEdgeId = null;
            selectedBoxId = n.box || null;
            updateNodeEditor();
            updateEdgeEditor();

            const pos = screenToWorld(e.clientX, e.clientY);
            dragOffset.x = pos.x - n.x;
            dragOffset.y = pos.y - n.y;
            draggingNodeId = nodeId;
            svg.setPointerCapture(e.pointerId);
            return;
        }
    }

    // EDGE interactions
    if (edgeId) {
        if (currentMode === "delete") {
            pushUndo();
            edges = edges.filter(ed => ed.id !== edgeId);
            if (selectedEdgeId === edgeId) selectedEdgeId = null;
            render();
            return;
        }

        if (currentMode === "select") {
            selectedEdgeId = edgeId;
            selectedNodeId = null;
            selectedBoxId = null;
            updateEdgeEditor();
            updateNodeEditor();
            render();
            return;
        }
    }

    // BACKGROUND
    if (e.target.id === "svg-bg") {
        const pos = screenToWorld(e.clientX, e.clientY);

        if (currentMode === "node") {
            pushUndo();
            createNodeAt(pos.x, pos.y);
            render();
            return;
        }

        if (currentMode === "box") {
            pushUndo();
            createBoxAt(pos.x, pos.y);
            render();
            return;
        }

        if (currentMode === "select") {
            // start panning
            panning = true;
            panStart = { x: e.clientX, y: e.clientY };
            panViewStart = { tx: view.tx, ty: view.ty };
            svg.setPointerCapture(e.pointerId);
            selectedNodeId = null;
            selectedEdgeId = null;
            selectedBoxId = null;
            updateNodeEditor();
            updateEdgeEditor();
            render();
            return;
        }
    }
});

svg.addEventListener("pointermove", e => {
    // Dragging a node
    if (draggingNodeId) {
        const pos = screenToWorld(e.clientX, e.clientY);
        const n = nodes[draggingNodeId];
        n.x = pos.x - dragOffset.x;
        n.y = pos.y - dragOffset.y;
        render();
        return;
    }

    // Resizing a box
    if (resizingBoxId) {
        const b = boxes[resizingBoxId];
        const pos = screenToWorld(e.clientX, e.clientY);

        const minW = 100;
        const minH = 80;

        if (resizeCorner === "nw") {
            const newW = (b.x + b.width) - pos.x;
            const newH = (b.y + b.height) - pos.y;
            if (newW > minW) { b.width = newW; b.x = pos.x; }
            if (newH > minH) { b.height = newH; b.y = pos.y; }
        }
        if (resizeCorner === "ne") {
            const newW = pos.x - b.x;
            const newH = (b.y + b.height) - pos.y;
            if (newW > minW)  b.width = newW;
            if (newH > minH) { b.height = newH; b.y = pos.y; }
        }
        if (resizeCorner === "sw") {
            const newW = (b.x + b.width) - pos.x;
            const newH = pos.y - b.y;
            if (newW > minW) { b.width = newW; b.x = pos.x; }
            if (newH > minH)  b.height = newH;
        }
        if (resizeCorner === "se") {
            const newW = pos.x - b.x;
            const newH = pos.y - b.y;
            if (newW > minW) b.width = newW;
            if (newH > minH) b.height = newH;
        }

        render();
        return;
    }


    // Dragging a box
    if (draggingBoxId) {
        const b = boxes[draggingBoxId];
        const pos = screenToWorld(e.clientX, e.clientY);

        const oldX = b.x;
        const oldY = b.y;

        b.x = pos.x - dragBoxOffset.x;
        b.y = pos.y - dragBoxOffset.y;

        const dx = b.x - oldX;
        const dy = b.y - oldY;

        b.nodes.forEach(id => {
            const n = nodes[id];
            if (n) {
                n.x += dx;
                n.y += dy;
            }
        });

        render();
        return;
    }

    // Panning
    if (panning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        view.tx = panViewStart.tx + dx;
        view.ty = panViewStart.ty + dy;
        render();
        return;
    }
});

svg.addEventListener("pointerup", e => {
    if (draggingNodeId) {
        updateNodeBoxMembership(draggingNodeId);
    }

    if (draggingNodeId || draggingBoxId || panning) {
        try {
            svg.releasePointerCapture(e.pointerId);
        } catch (_) {}
    }

    if (resizingBoxId) {
        svg.releasePointerCapture(e.pointerId);
        resizingBoxId = null;
        resizeCorner = null;
        return;
    }

    draggingNodeId = null;
    draggingBoxId = null;
    panning = false;
});

// ---------- CREATION / DELETION HELPERS ----------

function createNodeAt(x, y) {
    const id = "n" + (nodeCounter++);
    nodes[id] = {
        id,
        x,
        y,
        label: "Node " + nodeCounter,
        color: "#4682b4",
        size: 25,
        desc: "",
        group: "",
        box: null
    };
    return id;
}

function deleteNode(id) {
    const n = nodes[id];
    if (n && n.box && boxes[n.box]) {
        boxes[n.box].nodes = boxes[n.box].nodes.filter(nid => nid !== id);
    }
    delete nodes[id];
    edges = edges.filter(e => e.source !== id && e.target !== id);
}

function createEdge(a, b) {
    const id = "e" + (edgeCounter++);
    edges.push({
        id,
        source: a,
        target: b,
        label: "",
        color: "#888888",
        width: 2,
        directed: false
    });
    return id;
}

function createBoxAt(x, y) {
    const id = "b" + (boxCounter++);
    boxes[id] = {
        id,
        label: "Group " + boxCounter,
        x,
        y,
        width: 260,
        height: 200,
        nodes: []
    };
    return id;
}

// Box membership: assign node to box if inside; remove from previous if needed
function updateNodeBoxMembership(nodeId) {
    const n = nodes[nodeId];
    const SNAP_MARGIN = 30;
    if (!n) return;

    let targetBox = null;
    let bestDist = Infinity;

    for (const [bid, b] of Object.entries(boxes)) {
        const inside =
            n.x > b.x && n.x < b.x + b.width &&
            n.y > b.y && n.y < b.y + b.height;

        const near =
            n.x > b.x - SNAP_MARGIN && n.x < b.x + b.width + SNAP_MARGIN &&
            n.y > b.y - SNAP_MARGIN && n.y < b.y + b.height + SNAP_MARGIN;

        if (inside || near) {
            // distance to box center for tie-breaking
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            const d = (n.x - cx)**2 + (n.y - cy)**2;
            if (d < bestDist) {
                bestDist = d;
                targetBox = bid;
            }
        }
    }

    // remove from old box
    if (n.box && boxes[n.box]) {
        boxes[n.box].nodes = boxes[n.box].nodes.filter(id => id !== nodeId);
    }

    n.box = targetBox;

    if (targetBox && boxes[targetBox]) {
        const arr = boxes[targetBox].nodes;
        if (!arr.includes(nodeId)) arr.push(nodeId);
    }
}

function updateBoxEditor() {
    const editor = document.getElementById("box-editor");
    if (!editor) return;

    const disabled = !selectedBoxId || !boxes[selectedBoxId];
    editor.style.opacity = disabled ? "0.4" : "1";

    if (disabled) return;

    const b = boxes[selectedBoxId];
    document.getElementById("edit-box-label").value = b.label;
}

function getNumberInputValue(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const val = parseFloat(el.value);
    return Number.isFinite(val) ? val : fallback;
}

function setNumberInputValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
}

function syncLayoutControlsFromSettings() {
    const layoutSelect = document.getElementById("layout-select");
    if (layoutSelect) {
        layoutSelect.value = layoutSettings.selectedLayout || "manual";
    }

    const routingSelect = document.getElementById("edge-routing");
    if (routingSelect) {
        routingSelect.value = layoutSettings.edgeRouting || "straight";
    }

    const opts = layoutSettings.options;
    setNumberInputValue("force-repulsion", opts.force.repulsion);
    setNumberInputValue("force-ideal", opts.force.idealEdgeLength);
    setNumberInputValue("force-iterations", opts.force.iterations);

    setNumberInputValue("grid-box-hmargin", opts.grid.boxHMargin);
    setNumberInputValue("grid-box-vmargin", opts.grid.boxVMargin);
    setNumberInputValue("grid-node-hmargin", opts.grid.nodeHMargin);
    setNumberInputValue("grid-node-vmargin", opts.grid.nodeVMargin);

    setNumberInputValue("circle-outer-radius", opts.circle.outerRadius);
    setNumberInputValue("circle-inner-radius", opts.circle.innerRadius);

    setNumberInputValue("hier-node-hmargin", opts.hierarchical.nodeHMargin);
    setNumberInputValue("hier-node-vmargin", opts.hierarchical.nodeVMargin);

    setNumberInputValue("weighted-tiers", opts.weightedTree.tiers);
    setNumberInputValue("weighted-tier-spacing", opts.weightedTree.tierSpacing);
    setNumberInputValue("weighted-node-spacing", opts.weightedTree.nodeSpacing);
}

function syncLayoutSettingsFromInputs() {
    const opts = layoutSettings.options;
    opts.force.repulsion = Math.max(0, getNumberInputValue("force-repulsion", opts.force.repulsion));
    opts.force.idealEdgeLength = Math.max(0, getNumberInputValue("force-ideal", opts.force.idealEdgeLength));
    opts.force.iterations = Math.max(1, Math.round(getNumberInputValue("force-iterations", opts.force.iterations)));

    opts.grid.boxHMargin = Math.max(0, getNumberInputValue("grid-box-hmargin", opts.grid.boxHMargin));
    opts.grid.boxVMargin = Math.max(0, getNumberInputValue("grid-box-vmargin", opts.grid.boxVMargin));
    opts.grid.nodeHMargin = Math.max(0, getNumberInputValue("grid-node-hmargin", opts.grid.nodeHMargin));
    opts.grid.nodeVMargin = Math.max(0, getNumberInputValue("grid-node-vmargin", opts.grid.nodeVMargin));

    opts.circle.outerRadius = Math.max(0, getNumberInputValue("circle-outer-radius", opts.circle.outerRadius));
    opts.circle.innerRadius = Math.max(0, getNumberInputValue("circle-inner-radius", opts.circle.innerRadius));

    opts.hierarchical.nodeHMargin = Math.max(0, getNumberInputValue("hier-node-hmargin", opts.hierarchical.nodeHMargin));
    opts.hierarchical.nodeVMargin = Math.max(0, getNumberInputValue("hier-node-vmargin", opts.hierarchical.nodeVMargin));

    opts.weightedTree.tiers = Math.max(1, Math.round(getNumberInputValue("weighted-tiers", opts.weightedTree.tiers)));
    opts.weightedTree.tierSpacing = Math.max(0, getNumberInputValue("weighted-tier-spacing", opts.weightedTree.tierSpacing));
    opts.weightedTree.nodeSpacing = Math.max(0, getNumberInputValue("weighted-node-spacing", opts.weightedTree.nodeSpacing));

    const routingSelect = document.getElementById("edge-routing");
    if (routingSelect) {
        layoutSettings.edgeRouting = routingSelect.value || layoutSettings.edgeRouting;
    }
}

// ---------- LAYOUTS ----------

document.getElementById("apply-layout").addEventListener("click", () => {
    const type = document.getElementById("layout-select").value; // "grid" | "circle" | "hierarchical" | "force"

    syncLayoutSettingsFromInputs();
    layoutSettings.selectedLayout = type;
    saveLayoutSettingsToStorage();

    if (type === "manual") {
        render();
        return;
    }

    pushUndo();

    Layout.apply(type, {
        nodes,
        edges,
        boxes,
        view
    }, layoutSettings.options[type] || {});

    render();
});

document.getElementById("layout-select").addEventListener("change", e => {
    layoutSettings.selectedLayout = e.target.value;
    saveLayoutSettingsToStorage();
});

const layoutInputs = [
    "force-repulsion",
    "force-ideal",
    "force-iterations",
    "grid-box-hmargin",
    "grid-box-vmargin",
    "grid-node-hmargin",
    "grid-node-vmargin",
    "circle-outer-radius",
    "circle-inner-radius",
    "hier-node-hmargin",
    "hier-node-vmargin",
    "weighted-tiers",
    "weighted-tier-spacing",
    "weighted-node-spacing"
];

layoutInputs.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
        syncLayoutSettingsFromInputs();
        saveLayoutSettingsToStorage();
    });
});

const edgeRoutingSelect = document.getElementById("edge-routing");
if (edgeRoutingSelect) {
    edgeRoutingSelect.addEventListener("change", () => {
        syncLayoutSettingsFromInputs();
        saveLayoutSettingsToStorage();
        render();
    });
}

// ---------- RENDER ----------

function getEdgePointsForRouting(src, tgt) {
    if (layoutSettings.edgeRouting === "orthogonal") {
        const horizontalFirst = Math.abs(src.x - tgt.x) > Math.abs(src.y - tgt.y);
        if (horizontalFirst) {
            const midX = (src.x + tgt.x) / 2;
            return [
                { x: src.x, y: src.y },
                { x: midX, y: src.y },
                { x: midX, y: tgt.y },
                { x: tgt.x, y: tgt.y }
            ];
        } else {
            const midY = (src.y + tgt.y) / 2;
            return [
                { x: src.x, y: src.y },
                { x: src.x, y: midY },
                { x: tgt.x, y: midY },
                { x: tgt.x, y: tgt.y }
            ];
        }
    }

    return [
        { x: src.x, y: src.y },
        { x: tgt.x, y: tgt.y }
    ];
}

function getEdgeLabelAnchor(points) {
    if (points.length === 0) return { x: 0, y: 0 };
    const midIndex = Math.floor((points.length - 1) / 2);
    const a = points[midIndex];
    const b = points[midIndex + 1] || a;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function render() {
    svg.innerHTML = "";

    const viewport = document.createElementNS(NS, "g");
    viewport.setAttribute("id", "viewport");
    viewport.setAttribute("transform", `translate(${view.tx},${view.ty}) scale(${view.scale})`);
    svg.appendChild(viewport);

    // big background rect for pan & creation
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", -5000);
    bg.setAttribute("y", -5000);
    bg.setAttribute("width", 10000);
    bg.setAttribute("height", 10000);
    bg.setAttribute("fill", "transparent");
    bg.setAttribute("pointer-events", "all");
    bg.setAttribute("id", "svg-bg");
    viewport.appendChild(bg);

    // visibility based on search
    let visibleNodes = {};
    const term = searchTerm;
    Object.keys(nodes).forEach(id => {
        const n = nodes[id];
        if (!term) {
            visibleNodes[id] = true;
        } else {
            const text = ((n.label || "") + " " + (n.desc || "") + " " + (n.group || "")).toLowerCase();
            visibleNodes[id] = text.includes(term);
        }
    });

    // draw boxes first
    Object.values(boxes).forEach(b => {
        const g = document.createElementNS(NS, "g");
        g.dataset.boxId = b.id;

        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", b.x);
        rect.setAttribute("y", b.y);
        rect.setAttribute("width", b.width);
        rect.setAttribute("height", b.height);
        rect.setAttribute("rx", 8);
        rect.setAttribute("fill", "#fffce8");
        rect.setAttribute("stroke", selectedBoxId === b.id ? "#e09020" : "#d4b66a");
        rect.setAttribute("stroke-width", selectedBoxId === b.id ? "3" : "2");
        rect.dataset.boxId = b.id;
        g.appendChild(rect);

        const label = document.createElementNS(NS, "text");
        label.textContent = b.label;
        label.setAttribute("x", b.x + 10);
        label.setAttribute("y", b.y + 20);
        label.setAttribute("font-size", "14");
        label.setAttribute("fill", "#9c7c30");
        label.dataset.boxId = b.id;
        g.appendChild(label);

        // Resize handles (corners)
        const corners = [
            { name: "nw", cx: b.x, cy: b.y },
            { name: "ne", cx: b.x + b.width, cy: b.y },
            { name: "sw", cx: b.x, cy: b.y + b.height },
            { name: "se", cx: b.x + b.width, cy: b.y + b.height }
        ];

        corners.forEach(c => {
            const h = document.createElementNS(NS, "rect");
            h.setAttribute("x", c.cx - 6);
            h.setAttribute("y", c.cy - 6);
            h.setAttribute("width", 12);
            h.setAttribute("height", 12);
            h.setAttribute("fill", "#d4b66a");
            h.setAttribute("stroke", "#9c7c30");
            h.setAttribute("cursor", "nwse-resize");
            h.dataset.resizeBoxId = b.id;
            h.dataset.resizeCorner = c.name;
            g.appendChild(h);
        });


        viewport.appendChild(g);
    });

    // edges
    edges.forEach(edge => {
        const src = nodes[edge.source];
        const tgt = nodes[edge.target];
        if (!src || !tgt) return;
        if (!visibleNodes[edge.source] || !visibleNodes[edge.target]) return;

        const points = getEdgePointsForRouting(src, tgt);
        const onPath = pathHighlights.edges.has(edge.id);
        const strokeColor = onPath ? "#ff2d55" : (edge.id === selectedEdgeId ? "#ff6600" : (edge.color || "#888"));
        const strokeWidth = (edge.width || 2) + (onPath ? 1.5 : 0);
        let edgeElement;

        if (points.length > 2) {
            const poly = document.createElementNS(NS, "polyline");
            poly.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
            poly.setAttribute("fill", "none");
            edgeElement = poly;
        } else {
            const line = document.createElementNS(NS, "line");
            line.setAttribute("x1", points[0].x);
            line.setAttribute("y1", points[0].y);
            line.setAttribute("x2", points[1].x);
            line.setAttribute("y2", points[1].y);
            edgeElement = line;
        }

        edgeElement.setAttribute("stroke", strokeColor);
        edgeElement.setAttribute("stroke-width", strokeWidth);
        edgeElement.dataset.edgeId = edge.id;
        edgeElement.setAttribute("pointer-events", "stroke");
        viewport.appendChild(edgeElement);

        if (edge.directed && points.length >= 2) {
            const tail = points[points.length - 2];
            const head = points[points.length - 1];
            const dx = head.x - tail.x;
            const dy = head.y - tail.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const size = 8;
            const x1 = head.x - ux * size + uy * size * 0.6;
            const y1 = head.y - uy * size - ux * size * 0.6;
            const x2 = head.x - ux * size - uy * size * 0.6;
            const y2 = head.y - uy * size + ux * size * 0.6;

            const arrow = document.createElementNS(NS, "polygon");
            arrow.setAttribute("points", `${head.x},${head.y} ${x1},${y1} ${x2},${y2}`);
            arrow.setAttribute("fill", strokeColor);
            arrow.dataset.edgeId = edge.id;
            viewport.appendChild(arrow);
        }

        if (edge.label) {
            const mid = getEdgeLabelAnchor(points);
            const text = document.createElementNS(NS, "text");
            text.textContent = edge.label;
            text.setAttribute("x", mid.x);
            text.setAttribute("y", mid.y - 6);
            text.setAttribute("font-size", "11");
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("fill", "#444");
            text.dataset.edgeId = edge.id;
            viewport.appendChild(text);
        }
    });

    // nodes
    Object.values(nodes).forEach(n => {
        if (!visibleNodes[n.id]) return;

        const r = n.size || 25;
        const onPath = pathHighlights.nodes.has(n.id);

        const circle = document.createElementNS(NS, "circle");
        circle.setAttribute("cx", n.x);
        circle.setAttribute("cy", n.y);
        circle.setAttribute("r", r);
        circle.setAttribute("fill", n.color || "#4682b4");
        circle.setAttribute("stroke", onPath ? "#ff2d55" : (n.id === selectedNodeId ? "#ff9900" : "#333"));
        circle.setAttribute("stroke-width", onPath ? "4" : (n.id === selectedNodeId ? "3" : "1"));
        circle.dataset.nodeId = n.id;
        viewport.appendChild(circle);

        const label = document.createElementNS(NS, "text");
        label.textContent = n.label || n.id;
        label.setAttribute("x", n.x);
        label.setAttribute("y", n.y + r + 14);
        label.setAttribute("font-size", "12");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "node-label");
        label.dataset.nodeId = n.id;
        viewport.appendChild(label);
    });

    updateNodeEditor();
    updateEdgeEditor();
    updateBoxEditor();
    renderMinimap();
    autosave();
}

// ---------- MINIMAP ----------

function renderMinimap() {
    if (!minimap) return;
    minimap.innerHTML = "";

    const mmWidth = minimap.clientWidth || 180;
    const mmHeight = minimap.clientHeight || 120;

    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", 0);
    bg.setAttribute("y", 0);
    bg.setAttribute("width", mmWidth);
    bg.setAttribute("height", mmHeight);
    bg.setAttribute("fill", "#ffffff");
    bg.setAttribute("stroke", "#ccc");
    minimap.appendChild(bg);

    // compute world extents from nodes + boxes
    let points = [];

    Object.values(nodes).forEach(n => {
        points.push({ x: n.x, y: n.y });
    });
    Object.values(boxes).forEach(b => {
        points.push({ x: b.x, y: b.y });
        points.push({ x: b.x + b.width, y: b.y + b.height });
    });

    if (!points.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });

    const padding = 10;
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const scale = Math.min(
        (mmWidth - 2 * padding) / spanX,
        (mmHeight - 2 * padding) / spanY
    );

    function worldToMini(x, y) {
        return {
            x: padding + (x - minX) * scale,
            y: padding + (y - minY) * scale
        };
    }

    // edges
    edges.forEach(edge => {
        const a = nodes[edge.source];
        const b = nodes[edge.target];
        if (!a || !b) return;
        const p1 = worldToMini(a.x, a.y);
        const p2 = worldToMini(b.x, b.y);
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", p1.x);
        line.setAttribute("y1", p1.y);
        line.setAttribute("x2", p2.x);
        line.setAttribute("y2", p2.y);
        line.setAttribute("stroke", "#bbb");
        line.setAttribute("stroke-width", "1");
        minimap.appendChild(line);
    });

    // boxes
    Object.values(boxes).forEach(b => {
        const tl = worldToMini(b.x, b.y);
        const br = worldToMini(b.x + b.width, b.y + b.height);
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", tl.x);
        rect.setAttribute("y", tl.y);
        rect.setAttribute("width", Math.max(4, br.x - tl.x));
        rect.setAttribute("height", Math.max(4, br.y - tl.y));
        rect.setAttribute("fill", "#fffce8");
        rect.setAttribute("stroke", "#d4b66a");
        rect.setAttribute("stroke-width", "1");
        minimap.appendChild(rect);
    });

    // nodes
    Object.values(nodes).forEach(n => {
        const p = worldToMini(n.x, n.y);
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", p.x);
        c.setAttribute("cy", p.y);
        c.setAttribute("r", 2.5);
        c.setAttribute("fill", "#666");
        minimap.appendChild(c);
    });

    // viewport rectangle
    const tlWorld = screenToWorld(0, 0);
    const brWorld = screenToWorld(svg.clientWidth, svg.clientHeight);
    const tlMini = worldToMini(tlWorld.x, tlWorld.y);
    const brMini = worldToMini(brWorld.x, brWorld.y);

    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", tlMini.x);
    rect.setAttribute("y", tlMini.y);
    rect.setAttribute("width", Math.max(10, brMini.x - tlMini.x));
    rect.setAttribute("height", Math.max(10, brMini.y - tlMini.y));
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "#0077dd");
    rect.setAttribute("stroke-width", "1.5");
    minimap.appendChild(rect);
}

// click minimap to recenter
if (minimap) {
    minimap.addEventListener("click", e => {
        const mmRect = minimap.getBoundingClientRect();
        const x = e.clientX - mmRect.left;
        const y = e.clientY - mmRect.top;

        // reuse extents logic
        let points = [];
        Object.values(nodes).forEach(n => points.push({ x: n.x, y: n.y }));
        Object.values(boxes).forEach(b => {
            points.push({ x: b.x, y: b.y });
            points.push({ x: b.x + b.width, y: b.y + b.height });
        });
        if (!points.length) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        const padding = 10;
        const spanX = maxX - minX || 1;
        const spanY = maxY - minY || 1;
        const scale = Math.min(
            (minimap.clientWidth - 2 * padding) / spanX,
            (minimap.clientHeight - 2 * padding) / spanY
        );

        const worldX = (x - padding) / scale + minX;
        const worldY = (y - padding) / scale + minY;

        view.tx = svg.clientWidth / 2 - worldX * view.scale;
        view.ty = svg.clientHeight / 2 - worldY * view.scale;
        render();
    });
}

// ---------- INIT ----------

syncLayoutControlsFromSettings();
initTheme();
updateAutosaveInfo();
renderAnalyticsPanel();
loadGraphFromBackend();
