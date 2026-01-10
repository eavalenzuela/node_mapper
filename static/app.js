// app.js – box-enabled graph editor

const svg = document.getElementById("graphCanvas");
const minimap = document.getElementById("minimap");
const NS = "http://www.w3.org/2000/svg";
const THEME_KEY = "graph-theme";

// ---------- STATE ----------

let nodes = {};   // id -> { id, x, y, label, color, size, desc, box, layer }
let edges = [];   // { id, source, target, label, color, width, directed, layer }
let boxes = {};   // id -> { id, label, x, y, width, height, nodes: [nodeId...], layer }

let layers = [];  // { id, name, visible, locked }
let activeLayerId = null;

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
let layerCounter = 0;

const LAYOUT_SETTINGS_KEY = "graph-layout-settings-v1";
const SNAP_SETTINGS_KEY = "graph-snap-settings-v1";
const SHAPE_DEFAULTS = {
    circle: { size: 25, color: "#4682b4", stroke: "#1f2937" },
    rect: { width: 130, height: 70, color: "#4f8bc9", stroke: "#1f2937" },
    rounded: { width: 130, height: 70, radius: 18, color: "#57a6a6", stroke: "#1f2937" },
    diamond: { width: 120, height: 90, color: "#8b6bd6", stroke: "#1f2937" },
    cylinder: { width: 130, height: 80, color: "#5cab7d", stroke: "#1f2937" },
    swimlane: { width: 200, height: 120, color: "#f2c94c", stroke: "#1f2937" }
};

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
let snapSettings = {
    gridEnabled: true,
    gridSize: 20,
    objectEnabled: true,
    showGuides: true,
    threshold: 8
};
let activeGuides = { vertical: [], horizontal: [] };

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

function defaultSnapSettings() {
    return {
        gridEnabled: true,
        gridSize: 20,
        objectEnabled: true,
        showGuides: true,
        threshold: 8
    };
}

function loadSnapSettingsFromStorage() {
    const raw = localStorage.getItem(SNAP_SETTINGS_KEY);
    if (!raw) return defaultSnapSettings();
    try {
        const parsed = JSON.parse(raw);
        return { ...defaultSnapSettings(), ...(parsed || {}) };
    } catch (e) {
        console.warn("Could not parse stored snap settings", e);
        return defaultSnapSettings();
    }
}

function saveSnapSettingsToStorage() {
    localStorage.setItem(SNAP_SETTINGS_KEY, JSON.stringify(snapSettings));
}

snapSettings = loadSnapSettingsFromStorage();

function getShapeDefaults(shapeType) {
    return SHAPE_DEFAULTS[shapeType] || SHAPE_DEFAULTS.circle;
}

function normalizeNode(node = {}) {
    const shapeType = node.shape || "circle";
    const defaults = getShapeDefaults(shapeType);
    const normalized = { ...node };
    normalized.shape = shapeType;
    normalized.color = node.color || defaults.color;
    normalized.stroke = node.stroke || defaults.stroke;

    if (shapeType === "circle") {
        normalized.size = Number.isFinite(node.size) ? node.size : defaults.size;
    } else {
        normalized.width = Number.isFinite(node.width) ? node.width : defaults.width;
        normalized.height = Number.isFinite(node.height) ? node.height : defaults.height;
        normalized.size = Number.isFinite(node.size)
            ? node.size
            : Math.round(Math.max(normalized.width, normalized.height) / 2);
    }

    normalized.label = normalized.label ?? "";
    normalized.desc = normalized.desc ?? "";
    normalized.group = normalized.group ?? "";
    return normalized;
}

function getNodeDimensions(node) {
    const shapeType = node.shape || "circle";
    if (shapeType === "circle") {
        const radius = node.size || getShapeDefaults("circle").size;
        return {
            width: radius * 2,
            height: radius * 2,
            halfWidth: radius,
            halfHeight: radius,
            radius
        };
    }

    const defaults = getShapeDefaults(shapeType);
    const width = Number.isFinite(node.width) ? node.width : defaults.width;
    const height = Number.isFinite(node.height) ? node.height : defaults.height;
    return {
        width,
        height,
        halfWidth: width / 2,
        halfHeight: height / 2,
        radius: Math.max(width, height) / 2
    };
}

function adjustColor(hex, amount) {
    if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return hex;
    let raw = hex.slice(1);
    if (raw.length === 3) {
        raw = raw.split("").map(ch => ch + ch).join("");
    }
    if (raw.length !== 6) return hex;
    const num = parseInt(raw, 16);
    const clamp = val => Math.max(0, Math.min(255, val));
    const r = clamp((num >> 16) + amount);
    const g = clamp(((num >> 8) & 0xff) + amount);
    const b = clamp((num & 0xff) + amount);
    return `#${[r, g, b].map(val => val.toString(16).padStart(2, "0")).join("")}`;
}

// ---------- LAYERS ----------

function normalizeLayers(incoming = []) {
    const list = Array.isArray(incoming) ? incoming : [];
    const normalized = list.map((layer, idx) => {
        const id = layer.id || `l${idx}`;
        return {
            id,
            name: layer.name || `Layer ${idx + 1}`,
            visible: layer.visible !== false,
            locked: !!layer.locked
        };
    });

    if (!normalized.length) {
        normalized.push({
            id: "l0",
            name: "Layer 1",
            visible: true,
            locked: false
        });
    }

    const numericIds = normalized
        .map(layer => parseInt(layer.id.replace(/[^\d]/g, ""), 10))
        .filter(n => !Number.isNaN(n));
    const maxId = numericIds.length ? Math.max(...numericIds) : normalized.length - 1;
    layerCounter = Math.max(layerCounter, maxId + 1);
    return normalized;
}

function ensureActiveLayer() {
    if (!layers.length) {
        layers = normalizeLayers([]);
    }
    if (!activeLayerId || !layers.find(layer => layer.id === activeLayerId)) {
        activeLayerId = layers[0].id;
    }
}

function getLayerById(layerId) {
    return layers.find(layer => layer.id === layerId);
}

function isLayerVisible(layerId) {
    const layer = getLayerById(layerId);
    return layer ? layer.visible !== false : true;
}

function isLayerLocked(layerId) {
    const layer = getLayerById(layerId);
    return layer ? !!layer.locked : false;
}

function ensureItemLayers() {
    ensureActiveLayer();
    Object.values(nodes).forEach(node => {
        if (!node.layer) {
            node.layer = activeLayerId;
        }
    });
    edges.forEach(edge => {
        if (!edge.layer) {
            edge.layer = nodes[edge.source]?.layer || nodes[edge.target]?.layer || activeLayerId;
        }
    });
    Object.values(boxes).forEach(box => {
        if (!box.layer) {
            box.layer = activeLayerId;
        }
    });
}

function setActiveLayer(layerId) {
    activeLayerId = layerId;
    renderLayersPanel();
}

function addLayer(name = null) {
    pushUndo();
    const id = `l${layerCounter++}`;
    const label = name || `Layer ${layers.length + 1}`;
    layers.push({ id, name: label, visible: true, locked: false });
    activeLayerId = id;
    renderLayersPanel();
    render();
}

function clearSelectionIfLayerUnavailable() {
    if (selectedNodeId && nodes[selectedNodeId] && (isLayerLocked(nodes[selectedNodeId].layer) || !isLayerVisible(nodes[selectedNodeId].layer))) {
        selectedNodeId = null;
    }
    const edge = edges.find(ed => ed.id === selectedEdgeId);
    if (edge && (isLayerLocked(edge.layer) || !isLayerVisible(edge.layer))) {
        selectedEdgeId = null;
    }
    if (selectedBoxId && boxes[selectedBoxId] && (isLayerLocked(boxes[selectedBoxId].layer) || !isLayerVisible(boxes[selectedBoxId].layer))) {
        selectedBoxId = null;
    }
}

function renderLayersPanel() {
    const list = document.getElementById("layers-list");
    if (!list) return;
    ensureActiveLayer();
    list.innerHTML = "";

    layers.forEach(layer => {
        const row = document.createElement("div");
        row.className = "layer-row";
        if (layer.id === activeLayerId) {
            row.classList.add("active");
        }

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = layer.name || layer.id;
        let pushedNameUndo = false;
        nameInput.addEventListener("input", () => {
            if (!pushedNameUndo) {
                pushUndo();
                pushedNameUndo = true;
            }
            layer.name = nameInput.value;
        });
        nameInput.addEventListener("blur", () => {
            renderLayersPanel();
        });

        const actions = document.createElement("div");
        actions.className = "layer-actions";

        const activeBtn = document.createElement("button");
        activeBtn.type = "button";
        activeBtn.className = "layer-action";
        activeBtn.textContent = layer.id === activeLayerId ? "Active" : "Set Active";
        activeBtn.disabled = layer.id === activeLayerId;
        activeBtn.addEventListener("click", () => {
            setActiveLayer(layer.id);
        });

        const visibilityBtn = document.createElement("button");
        visibilityBtn.type = "button";
        visibilityBtn.className = "layer-action";
        visibilityBtn.textContent = layer.visible !== false ? "Hide" : "Show";
        visibilityBtn.addEventListener("click", () => {
            pushUndo();
            layer.visible = !layer.visible;
            clearSelectionIfLayerUnavailable();
            renderLayersPanel();
            render();
        });

        const lockBtn = document.createElement("button");
        lockBtn.type = "button";
        lockBtn.className = "layer-action";
        lockBtn.textContent = layer.locked ? "Unlock" : "Lock";
        lockBtn.addEventListener("click", () => {
            pushUndo();
            layer.locked = !layer.locked;
            if (layer.locked && activeLayerId === layer.id) {
                const firstUnlocked = layers.find(item => !item.locked);
                if (firstUnlocked) {
                    activeLayerId = firstUnlocked.id;
                }
            }
            clearSelectionIfLayerUnavailable();
            renderLayersPanel();
            render();
        });

        actions.appendChild(activeBtn);
        actions.appendChild(visibilityBtn);
        actions.appendChild(lockBtn);

        row.appendChild(nameInput);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

// ---------- UTILITIES ----------

function snapshot() {
    return JSON.stringify({ nodes, edges, boxes, layers, activeLayerId, layoutSettings });
}

function restoreFromSnapshot(json) {
    const data = JSON.parse(json);
    const incomingNodes = data.nodes || {};
    nodes = {};
    Object.entries(incomingNodes).forEach(([id, node]) => {
        const normalized = normalizeNode({ ...node, id: node.id || id });
        nodes[normalized.id] = normalized;
    });
    edges = data.edges || [];
    boxes = data.boxes || {};
    layers = normalizeLayers(data.layers || []);
    activeLayerId = data.activeLayerId || (layers[0] ? layers[0].id : null);
    layoutSettings = normalizeLayoutSettings(data.layoutSettings);
    nodeCounter = Object.keys(nodes).length;
    edgeCounter = edges.length;
    boxCounter = Object.keys(boxes).length;
    ensureItemLayers();
    syncLayoutControlsFromSettings();
    saveLayoutSettingsToStorage();
}

function pushUndo() {
    undoStack.push(snapshot());
    redoStack.length = 0;
}

function applyGraphPayload(graph = {}) {
    const incomingNodes = graph.nodes || {};
    nodes = {};
    Object.entries(incomingNodes).forEach(([id, node]) => {
        const normalized = normalizeNode({ ...node, id: node.id || id });
        nodes[normalized.id] = normalized;
    });
    edges = (graph.edges || []).map((ed, i) => ({
        id: ed.id || `e${i}`,
        source: ed.source,
        target: ed.target,
        label: ed.label || "",
        color: ed.color || "#888888",
        width: ed.width || 2,
        directed: !!ed.directed,
        layer: ed.layer
    }));

    boxes = graph.boxes || {};
    layers = normalizeLayers(graph.layers || []);
    activeLayerId = graph.activeLayerId || (layers[0] ? layers[0].id : null);
    ensureItemLayers();

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

function isNodeVisible(node) {
    if (!isLayerVisible(node.layer)) return false;
    if (!searchTerm) return true;
    const text = ((node.label || "") + " " + (node.desc || "") + " " + (node.group || "")).toLowerCase();
    return text.includes(searchTerm);
}

function clearActiveGuides() {
    activeGuides = { vertical: [], horizontal: [] };
}

function getSnapCandidates({ excludeNodeId = null, excludeBoxId = null } = {}) {
    const x = [];
    const y = [];

    Object.values(nodes).forEach(n => {
        if (n.id === excludeNodeId) return;
        if (!isLayerVisible(n.layer)) return;
        const { halfWidth, halfHeight } = getNodeDimensions(n);
        x.push(n.x - halfWidth, n.x + halfWidth);
        y.push(n.y - halfHeight, n.y + halfHeight);
    });

    Object.values(boxes).forEach(b => {
        if (b.id === excludeBoxId) return;
        if (!isLayerVisible(b.layer)) return;
        x.push(b.x, b.x + b.width);
        y.push(b.y, b.y + b.height);
    });

    return { x, y };
}

function pickSnapCandidate(value, candidates, threshold) {
    let best = { value, guide: null, distance: threshold + 1 };
    candidates.forEach(option => {
        const distance = Math.abs(value - option.value);
        if (distance < best.distance) {
            best = { value: option.value, guide: option.guide, distance };
        }
    });
    return best;
}

function applyNodeSnapping(pos, node) {
    if (!snapSettings.gridEnabled && !snapSettings.objectEnabled) {
        return { x: pos.x, y: pos.y, guides: { vertical: [], horizontal: [] } };
    }

    const guides = { vertical: [], horizontal: [] };
    const options = getSnapCandidates({ excludeNodeId: node.id });
    const { halfWidth, halfHeight } = getNodeDimensions(node);

    const xCandidates = [];
    const yCandidates = [];

    if (snapSettings.gridEnabled) {
        const gridX = Math.round(pos.x / snapSettings.gridSize) * snapSettings.gridSize;
        const gridY = Math.round(pos.y / snapSettings.gridSize) * snapSettings.gridSize;
        xCandidates.push({ value: gridX, guide: gridX });
        yCandidates.push({ value: gridY, guide: gridY });
    }

    if (snapSettings.objectEnabled) {
        options.x.forEach(edge => {
            xCandidates.push({ value: edge + halfWidth, guide: edge });
            xCandidates.push({ value: edge - halfWidth, guide: edge });
        });
        options.y.forEach(edge => {
            yCandidates.push({ value: edge + halfHeight, guide: edge });
            yCandidates.push({ value: edge - halfHeight, guide: edge });
        });
    }

    const bestX = pickSnapCandidate(pos.x, xCandidates, snapSettings.threshold);
    const bestY = pickSnapCandidate(pos.y, yCandidates, snapSettings.threshold);

    const x = bestX.distance <= snapSettings.threshold ? bestX.value : pos.x;
    const y = bestY.distance <= snapSettings.threshold ? bestY.value : pos.y;

    if (bestX.distance <= snapSettings.threshold) guides.vertical.push(bestX.guide);
    if (bestY.distance <= snapSettings.threshold) guides.horizontal.push(bestY.guide);

    return { x, y, guides };
}

function applyBoxSnapping(pos, box) {
    if (!snapSettings.gridEnabled && !snapSettings.objectEnabled) {
        return { x: pos.x, y: pos.y, guides: { vertical: [], horizontal: [] } };
    }

    const guides = { vertical: [], horizontal: [] };
    const options = getSnapCandidates({ excludeBoxId: box.id });
    const xCandidates = [];
    const yCandidates = [];

    if (snapSettings.gridEnabled) {
        const gridX = Math.round(pos.x / snapSettings.gridSize) * snapSettings.gridSize;
        const gridY = Math.round(pos.y / snapSettings.gridSize) * snapSettings.gridSize;
        xCandidates.push({ value: gridX, guide: gridX });
        yCandidates.push({ value: gridY, guide: gridY });
    }

    if (snapSettings.objectEnabled) {
        options.x.forEach(edge => {
            xCandidates.push({ value: edge, guide: edge });
            xCandidates.push({ value: edge - box.width, guide: edge });
        });
        options.y.forEach(edge => {
            yCandidates.push({ value: edge, guide: edge });
            yCandidates.push({ value: edge - box.height, guide: edge });
        });
    }

    const bestX = pickSnapCandidate(pos.x, xCandidates, snapSettings.threshold);
    const bestY = pickSnapCandidate(pos.y, yCandidates, snapSettings.threshold);

    const x = bestX.distance <= snapSettings.threshold ? bestX.value : pos.x;
    const y = bestY.distance <= snapSettings.threshold ? bestY.value : pos.y;

    if (bestX.distance <= snapSettings.threshold) guides.vertical.push(bestX.guide);
    if (bestY.distance <= snapSettings.threshold) guides.horizontal.push(bestY.guide);

    return { x, y, guides };
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
        graph: { nodes, edges, boxes, layers, activeLayerId },
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
        layers = normalizeLayers([]);
        activeLayerId = layers[0].id;
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

// collapsible panels
document.querySelectorAll(".panel .panel-toggle").forEach(toggle => {
    toggle.addEventListener("click", () => {
        const panel = toggle.closest(".panel");
        if (panel) panel.classList.toggle("open");
    });
});

// mode buttons
document.querySelectorAll("#mode-toolbar button[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
        currentMode = btn.dataset.mode;
        updateModeButtons();
    });
});

function updateModeButtons() {
    document.querySelectorAll("#mode-toolbar button[data-mode]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === currentMode);
    });
}
updateModeButtons();

// top tabs
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        tabButtons.forEach(other => other.classList.toggle("active", other === btn));
        tabPanels.forEach(panel => panel.classList.toggle("active", panel.dataset.tab === tab));
    });
});

// mini-map toggle
const minimapToggle = document.getElementById("toggle-minimap");
const minimapContainer = document.getElementById("minimap-container");
if (minimapToggle && minimapContainer) {
    const syncMinimapVisibility = () => {
        minimapContainer.classList.toggle("hidden", !minimapToggle.checked);
    };
    minimapToggle.addEventListener("change", syncMinimapVisibility);
    syncMinimapVisibility();
}

const paletteItems = document.querySelectorAll(".shape-item");
paletteItems.forEach(item => {
    item.addEventListener("dragstart", e => {
        const shapeType = item.dataset.shape;
        if (!shapeType || !e.dataTransfer) return;
        e.dataTransfer.setData("text/plain", shapeType);
        e.dataTransfer.effectAllowed = "copy";
    });
});

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

const addLayerBtn = document.getElementById("add-layer");
if (addLayerBtn) {
    addLayerBtn.addEventListener("click", () => {
        addLayer();
    });
}

// node editor
function setEditorDisabled(editor, disabled) {
    if (!editor) return;
    editor.querySelectorAll("input, textarea, select, button").forEach(el => {
        el.disabled = disabled;
    });
}

function updateNodeEditor() {
    const editor = document.getElementById("node-editor");
    const empty = document.getElementById("node-empty-state");
    const chip = document.getElementById("node-selection-chip");
    const disabled = !selectedNodeId || !nodes[selectedNodeId];

    if (chip) {
        chip.textContent = disabled ? "No node selected" : `Node: ${nodes[selectedNodeId].label || selectedNodeId}`;
        chip.classList.toggle("chip-active", !disabled);
    }

    if (editor && empty) {
        editor.classList.toggle("hidden", disabled);
        empty.classList.toggle("hidden", !disabled);
    }

    if (disabled) {
        setEditorDisabled(editor, true);
        return;
    }

    const n = nodes[selectedNodeId];
    document.getElementById("edit-label").value = n.label || "";
    document.getElementById("edit-color").value = n.color || "#4682b4";
    document.getElementById("edit-size").value = n.size || 25;
    document.getElementById("edit-group").value = n.group || "";
    document.getElementById("edit-desc").value = n.desc || "";

    const locked = isLayerLocked(n.layer);
    setEditorDisabled(editor, locked);
    if (chip && locked) {
        chip.textContent += " (Locked)";
    }
    if (locked) return;
}

document.getElementById("apply-node-edit").addEventListener("click", () => {
    if (!selectedNodeId || !nodes[selectedNodeId]) return;
    if (isLayerLocked(nodes[selectedNodeId].layer)) return;
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
    const empty = document.getElementById("edge-empty-state");
    const chip = document.getElementById("edge-selection-chip");
    const e = edges.find(ed => ed.id === selectedEdgeId);
    const disabled = !e;

    if (chip) {
        chip.textContent = disabled ? "No edge selected" : `Edge: ${selectedEdgeId}`;
        chip.classList.toggle("chip-active", !disabled);
    }

    if (editor && empty) {
        editor.classList.toggle("hidden", disabled);
        empty.classList.toggle("hidden", !disabled);
    }

    if (disabled) {
        setEditorDisabled(editor, true);
        return;
    }

    document.getElementById("edge-label").value = e.label || "";
    document.getElementById("edge-color").value = e.color || "#888888";
    document.getElementById("edge-width").value = e.width || 2;
    document.getElementById("edge-directed").checked = !!e.directed;

    const locked = isLayerLocked(e.layer);
    setEditorDisabled(editor, locked);
    if (chip && locked) {
        chip.textContent += " (Locked)";
    }
    if (locked) return;
}

document.getElementById("apply-edge-edit").addEventListener("click", () => {
    const e = edges.find(ed => ed.id === selectedEdgeId);
    if (!e) return;
    if (isLayerLocked(e.layer)) return;
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

// ---------- IMPORT / EXPORT ----------

function assignCircularPositions(nodeIds) {
    const count = nodeIds.length || 1;
    const radius = Math.max(240, count * 12);
    const centerX = 400;
    const centerY = 400;
    const positioned = {};
    nodeIds.forEach((id, idx) => {
        const angle = (idx / count) * Math.PI * 2;
        positioned[id] = {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        };
    });
    return positioned;
}

function parseCSVEdgeList(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    const splitLine = line => line.split(",").map(s => s.trim());
    const headerCells = splitLine(lines[0]).map(h => h.toLowerCase());
    const hasHeader = headerCells.includes("source") && headerCells.includes("target");

    const rows = hasHeader ? lines.slice(1) : lines;
    const cellsToEdge = (cells, idx) => {
        const data = hasHeader ? headerCells.reduce((acc, key, i) => ({ ...acc, [key]: cells[i] }), {}) : {};
        if (!hasHeader) {
            data.source = cells[0];
            data.target = cells[1];
            if (cells[2]) data.label = cells[2];
        }
        if (!data.source || !data.target) return null;
        const directedVal = (data.directed || data.is_directed || data.oriented || "").toString().toLowerCase();
        const directed = directedVal === "true" || directedVal === "1" || directedVal === "yes";
        return {
            id: data.id || `e${idx}`,
            source: data.source,
            target: data.target,
            label: data.label || "",
            color: data.color || "#888888",
            width: parseFloat(data.width) || 2,
            directed
        };
    };

    const edgesFromCSV = rows
        .map((line, idx) => cellsToEdge(splitLine(line), idx))
        .filter(Boolean);
    const nodeIds = new Set();
    edgesFromCSV.forEach(e => {
        nodeIds.add(e.source);
        nodeIds.add(e.target);
    });
    const positions = assignCircularPositions([...nodeIds]);
    const parsedNodes = {};
    [...nodeIds].forEach(id => {
        parsedNodes[id] = {
            id,
            x: positions[id].x,
            y: positions[id].y,
            label: id
        };
    });
    return { nodes: parsedNodes, edges: edgesFromCSV, boxes: {} };
}

function parseGraphML(text) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) return null;

    const graphEl = doc.querySelector("graph");
    const defaultDirected = graphEl?.getAttribute("edgedefault") === "directed";
    const nodesInFile = [...doc.querySelectorAll("node")];
    const edgesInFile = [...doc.querySelectorAll("edge")];

    const nodesMap = {};
    const positions = assignCircularPositions(nodesInFile.map(n => n.getAttribute("id") || ""));
    nodesInFile.forEach((n, idx) => {
        const id = n.getAttribute("id") || `n${idx}`;
        let label = id;
        const dataLabel = n.querySelector("data[key='label']") || n.querySelector("y\\:NodeLabel");
        if (dataLabel && dataLabel.textContent.trim()) {
            label = dataLabel.textContent.trim();
        }
        const dataX = parseFloat(n.querySelector("data[key='x']")?.textContent || "");
        const dataY = parseFloat(n.querySelector("data[key='y']")?.textContent || "");
        nodesMap[id] = {
            id,
            label,
            x: Number.isFinite(dataX) ? dataX : positions[id]?.x || 300 + idx * 30,
            y: Number.isFinite(dataY) ? dataY : positions[id]?.y || 300
        };
    });

    const edgesFromXml = edgesInFile.map((e, idx) => {
        const source = e.getAttribute("source");
        const target = e.getAttribute("target");
        if (!source || !target) return null;
        const dataLabel = e.querySelector("data[key='label']") || e.querySelector("y\\:EdgeLabel");
        const directedAttr = e.getAttribute("directed");
        const directed = directedAttr ? directedAttr === "true" : defaultDirected;
        return {
            id: e.getAttribute("id") || `e${idx}`,
            source,
            target,
            label: dataLabel?.textContent?.trim() || "",
            color: "#888888",
            width: 2,
            directed
        };
    }).filter(Boolean);

    return { nodes: nodesMap, edges: edgesFromXml, boxes: {} };
}

function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function buildExportableSvg() {
    const clone = svg.cloneNode(true);
    const width = svg.clientWidth || parseFloat(svg.getAttribute("width")) || 1024;
    const height = svg.clientHeight || parseFloat(svg.getAttribute("height")) || 768;
    clone.setAttribute("width", width);
    clone.setAttribute("height", height);
    if (!clone.getAttribute("viewBox")) {
        clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }

    const computed = getComputedStyle(document.body);
    const canvasBg = computed.getPropertyValue("--canvas-bg")?.trim() || "#ffffff";
    const nodeLabelColor = computed.getPropertyValue("--node-label")?.trim() || "#0f172a";
    const bgRect = clone.querySelector("#svg-bg");
    if (bgRect) {
        bgRect.setAttribute("fill", canvasBg);
    }
    clone.querySelectorAll(".node-label").forEach(label => {
        label.setAttribute("fill", nodeLabelColor);
    });
    return { svg: clone, width, height, background: canvasBg };
}

function serializeSvgElement(element) {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(element);
}

function svgStringToPngBlob(svgString, width, height, background) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const blob = new Blob([svgString], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.fillStyle = background || "#ffffff";
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(image, 0, 0);
                canvas.toBlob(resultBlob => {
                    URL.revokeObjectURL(url);
                    if (resultBlob) resolve(resultBlob);
                    else reject(new Error("Unable to create PNG blob"));
                });
            } else {
                URL.revokeObjectURL(url);
                reject(new Error("No 2D context available"));
            }
        };
        image.onerror = err => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        image.src = url;
    });
}

document.getElementById("load-file").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const importFormat = document.getElementById("import-format").value;
    const reader = new FileReader();
    reader.onload = async () => {
        pushUndo();
        try {
            let graph = null;
            if (importFormat === "json") {
                graph = JSON.parse(reader.result);
            } else if (importFormat === "csv") {
                graph = parseCSVEdgeList(reader.result);
            } else if (importFormat === "graphml") {
                graph = parseGraphML(reader.result);
            }
            if (!graph) throw new Error("Unable to parse file.");
            applyGraphPayload(graph);
            render();
        } catch (err) {
            console.error("Import error", err);
            alert("Could not import file. Please verify the format.");
        } finally {
            e.target.value = "";
        }
    };
    reader.readAsText(file);
});

document.getElementById("export-graph").addEventListener("click", async () => {
    const format = document.getElementById("export-format").value;
    const graph = { nodes, edges, boxes, layers, activeLayerId, layoutSettings };
    if (format === "json") {
        const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
        downloadBlob(blob, "graph.json");
        return;
    }

    const { svg: svgCopy, width, height, background } = buildExportableSvg();
    const svgString = serializeSvgElement(svgCopy);
    if (format === "svg") {
        downloadBlob(new Blob([svgString], { type: "image/svg+xml" }), "graph.svg");
    } else if (format === "png") {
        try {
            const pngBlob = await svgStringToPngBlob(svgString, width, height, background);
            downloadBlob(pngBlob, "graph.png");
        } catch (err) {
            console.error("PNG export failed", err);
            alert("PNG export failed. Try SVG export instead.");
        }
    }
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
    if (boxes[selectedBoxId] && isLayerLocked(boxes[selectedBoxId].layer)) return;
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
        if (boxes[resizeId] && isLayerLocked(boxes[resizeId].layer)) return;
        // start resizing
        resizingBoxId = resizeId;
        resizeCorner = corner;
        svg.setPointerCapture(e.pointerId);
        return;
    }

    if (boxId && currentMode === "select") {
        const b = boxes[boxId];
        if (b && isLayerLocked(b.layer)) return;
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
        if (n && isLayerLocked(n.layer)) return;

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
        const edge = edges.find(ed => ed.id === edgeId);
        if (edge && isLayerLocked(edge.layer)) return;
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
            if (isLayerLocked(activeLayerId)) {
                alert("Active layer is locked. Unlock it to add nodes.");
                return;
            }
            pushUndo();
            createNodeAt(pos.x, pos.y);
            render();
            return;
        }

        if (currentMode === "box") {
            if (isLayerLocked(activeLayerId)) {
                alert("Active layer is locked. Unlock it to add boxes.");
                return;
            }
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

svg.addEventListener("dragover", e => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
});

svg.addEventListener("drop", e => {
    if (!e.dataTransfer) return;
    const shapeType = e.dataTransfer.getData("text/plain");
    if (!shapeType) return;
    e.preventDefault();

    if (isLayerLocked(activeLayerId)) {
        alert("Active layer is locked. Unlock it to add nodes.");
        return;
    }

    pushUndo();
    const pos = screenToWorld(e.clientX, e.clientY);
    createNodeAt(pos.x, pos.y, { shape: shapeType });
    render();
});

svg.addEventListener("pointermove", e => {
    // Dragging a node
    if (draggingNodeId) {
        const pos = screenToWorld(e.clientX, e.clientY);
        const n = nodes[draggingNodeId];
        const raw = { x: pos.x - dragOffset.x, y: pos.y - dragOffset.y };
        const snapped = applyNodeSnapping(raw, n);
        n.x = snapped.x;
        n.y = snapped.y;
        activeGuides = snapSettings.showGuides ? snapped.guides : { vertical: [], horizontal: [] };
        render();
        return;
    }

    // Resizing a box
    if (resizingBoxId) {
        clearActiveGuides();
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

        const raw = { x: pos.x - dragBoxOffset.x, y: pos.y - dragBoxOffset.y };
        const snapped = applyBoxSnapping(raw, b);
        b.x = snapped.x;
        b.y = snapped.y;
        activeGuides = snapSettings.showGuides ? snapped.guides : { vertical: [], horizontal: [] };

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
        clearActiveGuides();
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
    if (activeGuides.vertical.length || activeGuides.horizontal.length) {
        clearActiveGuides();
        render();
    }
});

// ---------- CREATION / DELETION HELPERS ----------

function createNodeAt(x, y, options = {}) {
    ensureActiveLayer();
    const id = "n" + (nodeCounter++);
    const shapeType = options.shape || "circle";
    const defaults = getShapeDefaults(shapeType);
    const baseNode = {
        id,
        x,
        y,
        label: "Node " + nodeCounter,
        color: options.color || defaults.color,
        stroke: options.stroke || defaults.stroke,
        size: options.size || defaults.size,
        width: options.width || defaults.width,
        height: options.height || defaults.height,
        shape: shapeType,
        desc: "",
        group: "",
        box: null,
        layer: activeLayerId
    };
    nodes[id] = normalizeNode(baseNode);
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
    ensureActiveLayer();
    const id = "e" + (edgeCounter++);
    edges.push({
        id,
        source: a,
        target: b,
        label: "",
        color: "#888888",
        width: 2,
        directed: false,
        layer: nodes[a]?.layer || activeLayerId
    });
    return id;
}

function createBoxAt(x, y) {
    ensureActiveLayer();
    const id = "b" + (boxCounter++);
    boxes[id] = {
        id,
        label: "Group " + boxCounter,
        x,
        y,
        width: 260,
        height: 200,
        nodes: [],
        layer: activeLayerId
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
    const empty = document.getElementById("box-empty-state");
    const chip = document.getElementById("box-selection-chip");
    if (!editor) return;

    const disabled = !selectedBoxId || !boxes[selectedBoxId];

    if (chip) {
        chip.textContent = disabled ? "No box selected" : `Box: ${boxes[selectedBoxId].label || selectedBoxId}`;
        chip.classList.toggle("chip-active", !disabled);
    }

    if (empty) {
        editor.classList.toggle("hidden", disabled);
        empty.classList.toggle("hidden", !disabled);
    }

    if (disabled) {
        setEditorDisabled(editor, true);
        return;
    }

    const b = boxes[selectedBoxId];
    document.getElementById("edit-box-label").value = b.label;
    const locked = isLayerLocked(b.layer);
    setEditorDisabled(editor, locked);
    if (chip && locked) {
        chip.textContent += " (Locked)";
    }
    if (locked) return;
}

function getArrangeTargets() {
    const candidates = [];
    if (selectedBoxId && boxes[selectedBoxId]) {
        boxes[selectedBoxId].nodes.forEach(id => {
            const node = nodes[id];
            if (node && isNodeVisible(node) && !isLayerLocked(node.layer)) candidates.push(node);
        });
        if (candidates.length) return candidates;
    }

    Object.values(nodes).forEach(node => {
        if (isNodeVisible(node) && !isLayerLocked(node.layer)) candidates.push(node);
    });
    return candidates;
}

function alignNodes(mode) {
    const targets = getArrangeTargets();
    if (targets.length < 2) return;
    pushUndo();

    const bounds = targets.map(node => {
        const { halfWidth, halfHeight } = getNodeDimensions(node);
        return {
            node,
            left: node.x - halfWidth,
            right: node.x + halfWidth,
            top: node.y - halfHeight,
            bottom: node.y + halfHeight,
            centerX: node.x,
            centerY: node.y
        };
    });

    const minLeft = Math.min(...bounds.map(b => b.left));
    const maxRight = Math.max(...bounds.map(b => b.right));
    const minTop = Math.min(...bounds.map(b => b.top));
    const maxBottom = Math.max(...bounds.map(b => b.bottom));
    const centerX = (minLeft + maxRight) / 2;
    const centerY = (minTop + maxBottom) / 2;

    bounds.forEach(b => {
        const { halfWidth, halfHeight } = getNodeDimensions(b.node);
        if (mode === "left") b.node.x = minLeft + halfWidth;
        if (mode === "center") b.node.x = centerX;
        if (mode === "right") b.node.x = maxRight - halfWidth;
        if (mode === "top") b.node.y = minTop + halfHeight;
        if (mode === "middle") b.node.y = centerY;
        if (mode === "bottom") b.node.y = maxBottom - halfHeight;
        updateNodeBoxMembership(b.node.id);
    });

    render();
}

function distributeNodes(axis) {
    const targets = getArrangeTargets();
    if (targets.length < 3) return;
    pushUndo();

    const sorted = [...targets].sort((a, b) => axis === "x" ? a.x - b.x : a.y - b.y);
    const start = axis === "x" ? sorted[0].x : sorted[0].y;
    const end = axis === "x" ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y;
    const step = (end - start) / (sorted.length - 1 || 1);

    sorted.forEach((node, index) => {
        if (axis === "x") node.x = start + step * index;
        if (axis === "y") node.y = start + step * index;
        updateNodeBoxMembership(node.id);
    });

    render();
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

    const layoutValue = layoutSettings.selectedLayout || (layoutSelect ? layoutSelect.value : "manual");
    updateLayoutSettingsVisibility(layoutValue);
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

function updateLayoutSettingsVisibility(selectedLayout) {
    const layoutValue = selectedLayout || (document.getElementById("layout-select")?.value || "manual");
    const sections = document.querySelectorAll(".layout-settings");
    sections.forEach(section => {
        const target = section.dataset.layout;
        const shouldShow = target === layoutValue || target === "edges";
        section.classList.toggle("active", !!shouldShow);
    });

    const hint = document.getElementById("layout-active-label");
    if (hint) {
        const pretty = layoutValue === "weightedTree" ? "Weighted tree" : layoutValue.charAt(0).toUpperCase() + layoutValue.slice(1);
        hint.textContent = `Showing options for ${pretty} layout.`;
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
    updateLayoutSettingsVisibility(e.target.value);
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

function syncSnapControlsFromSettings() {
    const gridToggle = document.getElementById("snap-grid-toggle");
    const gridSizeInput = document.getElementById("snap-grid-size");
    const objectToggle = document.getElementById("snap-object-toggle");
    const guideToggle = document.getElementById("guide-toggle");

    if (gridToggle) gridToggle.checked = !!snapSettings.gridEnabled;
    if (gridSizeInput) gridSizeInput.value = snapSettings.gridSize;
    if (objectToggle) objectToggle.checked = !!snapSettings.objectEnabled;
    if (guideToggle) guideToggle.checked = !!snapSettings.showGuides;
}

const snapGridToggle = document.getElementById("snap-grid-toggle");
if (snapGridToggle) {
    snapGridToggle.addEventListener("change", e => {
        snapSettings.gridEnabled = e.target.checked;
        saveSnapSettingsToStorage();
    });
}

const snapGridSize = document.getElementById("snap-grid-size");
if (snapGridSize) {
    snapGridSize.addEventListener("change", e => {
        const value = parseFloat(e.target.value);
        snapSettings.gridSize = Number.isFinite(value) && value > 0 ? value : snapSettings.gridSize;
        e.target.value = snapSettings.gridSize;
        saveSnapSettingsToStorage();
    });
}

const snapObjectToggle = document.getElementById("snap-object-toggle");
if (snapObjectToggle) {
    snapObjectToggle.addEventListener("change", e => {
        snapSettings.objectEnabled = e.target.checked;
        saveSnapSettingsToStorage();
    });
}

const guideToggle = document.getElementById("guide-toggle");
if (guideToggle) {
    guideToggle.addEventListener("change", e => {
        snapSettings.showGuides = e.target.checked;
        if (!snapSettings.showGuides) clearActiveGuides();
        saveSnapSettingsToStorage();
        render();
    });
}

const alignButtons = {
    left: document.getElementById("align-left"),
    center: document.getElementById("align-center"),
    right: document.getElementById("align-right"),
    top: document.getElementById("align-top"),
    middle: document.getElementById("align-middle"),
    bottom: document.getElementById("align-bottom")
};

Object.entries(alignButtons).forEach(([mode, button]) => {
    if (!button) return;
    button.addEventListener("click", () => alignNodes(mode));
});

const distributeH = document.getElementById("distribute-horizontal");
if (distributeH) {
    distributeH.addEventListener("click", () => distributeNodes("x"));
}

const distributeV = document.getElementById("distribute-vertical");
if (distributeV) {
    distributeV.addEventListener("click", () => distributeNodes("y"));
}

document.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
    if (!e.ctrlKey || !e.shiftKey) return;

    switch (e.key.toLowerCase()) {
        case "arrowleft":
            e.preventDefault();
            alignNodes("left");
            break;
        case "arrowright":
            e.preventDefault();
            alignNodes("right");
            break;
        case "arrowup":
            e.preventDefault();
            alignNodes("top");
            break;
        case "arrowdown":
            e.preventDefault();
            alignNodes("bottom");
            break;
        case "c":
            e.preventDefault();
            alignNodes("center");
            break;
        case "m":
            e.preventDefault();
            alignNodes("middle");
            break;
        case "h":
            e.preventDefault();
            distributeNodes("x");
            break;
        case "v":
            e.preventDefault();
            distributeNodes("y");
            break;
        default:
            break;
    }
});

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
    clearSelectionIfLayerUnavailable();
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
    Object.keys(nodes).forEach(id => {
        const n = nodes[id];
        visibleNodes[id] = isNodeVisible(n);
    });

    // draw boxes first
    Object.values(boxes).forEach(b => {
        if (!isLayerVisible(b.layer)) return;
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
        if (!isLayerVisible(edge.layer)) return;
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
    const computed = getComputedStyle(document.body);
    const fallbackStroke = computed.getPropertyValue("--node-stroke")?.trim() || "#1f2937";

    Object.values(nodes).forEach(n => {
        if (!visibleNodes[n.id]) return;

        const shapeType = n.shape || "circle";
        const { width, height, halfWidth, halfHeight, radius } = getNodeDimensions(n);
        const onPath = pathHighlights.nodes.has(n.id);
        const fill = n.color || getShapeDefaults(shapeType).color;
        const baseStroke = n.stroke || fallbackStroke;
        const stroke = onPath ? "#ff2d55" : (n.id === selectedNodeId ? "#ff9900" : baseStroke);
        const strokeWidth = onPath ? "4" : (n.id === selectedNodeId ? "3" : "1");
        const nodeGroup = document.createElementNS(NS, "g");
        nodeGroup.dataset.nodeId = n.id;

        if (shapeType === "circle") {
            const circle = document.createElementNS(NS, "circle");
            circle.setAttribute("cx", n.x);
            circle.setAttribute("cy", n.y);
            circle.setAttribute("r", radius);
            circle.setAttribute("fill", fill);
            circle.setAttribute("stroke", stroke);
            circle.setAttribute("stroke-width", strokeWidth);
            circle.dataset.nodeId = n.id;
            nodeGroup.appendChild(circle);
        } else if (shapeType === "diamond") {
            const diamond = document.createElementNS(NS, "polygon");
            const points = [
                `${n.x},${n.y - halfHeight}`,
                `${n.x + halfWidth},${n.y}`,
                `${n.x},${n.y + halfHeight}`,
                `${n.x - halfWidth},${n.y}`
            ].join(" ");
            diamond.setAttribute("points", points);
            diamond.setAttribute("fill", fill);
            diamond.setAttribute("stroke", stroke);
            diamond.setAttribute("stroke-width", strokeWidth);
            diamond.dataset.nodeId = n.id;
            nodeGroup.appendChild(diamond);
        } else if (shapeType === "cylinder") {
            const capHeight = Math.min(24, height * 0.3);
            const capRadius = capHeight / 2;
            const rect = document.createElementNS(NS, "rect");
            rect.setAttribute("x", n.x - halfWidth);
            rect.setAttribute("y", n.y - halfHeight + capRadius);
            rect.setAttribute("width", width);
            rect.setAttribute("height", Math.max(0, height - capHeight));
            rect.setAttribute("fill", fill);
            rect.setAttribute("stroke", stroke);
            rect.setAttribute("stroke-width", strokeWidth);
            rect.dataset.nodeId = n.id;
            nodeGroup.appendChild(rect);

            const top = document.createElementNS(NS, "ellipse");
            top.setAttribute("cx", n.x);
            top.setAttribute("cy", n.y - halfHeight + capRadius);
            top.setAttribute("rx", halfWidth);
            top.setAttribute("ry", capRadius);
            top.setAttribute("fill", adjustColor(fill, 10) || fill);
            top.setAttribute("stroke", stroke);
            top.setAttribute("stroke-width", strokeWidth);
            top.dataset.nodeId = n.id;
            nodeGroup.appendChild(top);

            const bottom = document.createElementNS(NS, "ellipse");
            bottom.setAttribute("cx", n.x);
            bottom.setAttribute("cy", n.y + halfHeight - capRadius);
            bottom.setAttribute("rx", halfWidth);
            bottom.setAttribute("ry", capRadius);
            bottom.setAttribute("fill", adjustColor(fill, -12) || fill);
            bottom.setAttribute("stroke", stroke);
            bottom.setAttribute("stroke-width", strokeWidth);
            bottom.dataset.nodeId = n.id;
            nodeGroup.appendChild(bottom);
        } else {
            const rect = document.createElementNS(NS, "rect");
            rect.setAttribute("x", n.x - halfWidth);
            rect.setAttribute("y", n.y - halfHeight);
            rect.setAttribute("width", width);
            rect.setAttribute("height", height);
            if (shapeType === "rounded" || shapeType === "swimlane") {
                rect.setAttribute("rx", getShapeDefaults(shapeType).radius || 14);
            } else {
                rect.setAttribute("rx", 4);
            }
            rect.setAttribute("fill", fill);
            rect.setAttribute("stroke", stroke);
            rect.setAttribute("stroke-width", strokeWidth);
            rect.dataset.nodeId = n.id;
            nodeGroup.appendChild(rect);

            if (shapeType === "swimlane") {
                const headerHeight = Math.min(28, height * 0.25);
                const header = document.createElementNS(NS, "rect");
                header.setAttribute("x", n.x - halfWidth);
                header.setAttribute("y", n.y - halfHeight);
                header.setAttribute("width", width);
                header.setAttribute("height", headerHeight);
                header.setAttribute("rx", getShapeDefaults(shapeType).radius || 14);
                header.setAttribute("fill", adjustColor(fill, 12) || fill);
                header.setAttribute("stroke", "none");
                header.dataset.nodeId = n.id;
                nodeGroup.appendChild(header);

                const divider = document.createElementNS(NS, "line");
                divider.setAttribute("x1", n.x - halfWidth);
                divider.setAttribute("y1", n.y - halfHeight + headerHeight);
                divider.setAttribute("x2", n.x + halfWidth);
                divider.setAttribute("y2", n.y - halfHeight + headerHeight);
                divider.setAttribute("stroke", stroke);
                divider.setAttribute("stroke-width", Math.max(1, parseFloat(strokeWidth) - 1));
                divider.dataset.nodeId = n.id;
                nodeGroup.appendChild(divider);
            }
        }

        viewport.appendChild(nodeGroup);

        const label = document.createElementNS(NS, "text");
        label.textContent = n.label || n.id;
        label.setAttribute("x", n.x);
        label.setAttribute("y", n.y + halfHeight + 16);
        label.setAttribute("font-size", "12");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "node-label");
        label.dataset.nodeId = n.id;
        viewport.appendChild(label);
    });

    if (snapSettings.showGuides && (activeGuides.vertical.length || activeGuides.horizontal.length)) {
        const guideLayer = document.createElementNS(NS, "g");
        guideLayer.setAttribute("class", "snap-guides");

        [...new Set(activeGuides.vertical)].forEach(x => {
            const line = document.createElementNS(NS, "line");
            line.setAttribute("x1", x);
            line.setAttribute("y1", -5000);
            line.setAttribute("x2", x);
            line.setAttribute("y2", 5000);
            line.setAttribute("class", "snap-guide");
            guideLayer.appendChild(line);
        });

        [...new Set(activeGuides.horizontal)].forEach(y => {
            const line = document.createElementNS(NS, "line");
            line.setAttribute("x1", -5000);
            line.setAttribute("y1", y);
            line.setAttribute("x2", 5000);
            line.setAttribute("y2", y);
            line.setAttribute("class", "snap-guide");
            guideLayer.appendChild(line);
        });

        viewport.appendChild(guideLayer);
    }

    updateNodeEditor();
    updateEdgeEditor();
    updateBoxEditor();
    renderLayersPanel();
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
        if (!isNodeVisible(n)) return;
        const { halfWidth, halfHeight } = getNodeDimensions(n);
        points.push({ x: n.x - halfWidth, y: n.y - halfHeight });
        points.push({ x: n.x + halfWidth, y: n.y + halfHeight });
    });
    Object.values(boxes).forEach(b => {
        if (!isLayerVisible(b.layer)) return;
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
        if (!isLayerVisible(edge.layer)) return;
        const a = nodes[edge.source];
        const b = nodes[edge.target];
        if (!a || !b) return;
        if (!isNodeVisible(a) || !isNodeVisible(b)) return;
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
        if (!isLayerVisible(b.layer)) return;
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
        if (!isNodeVisible(n)) return;
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
    Object.values(nodes).forEach(n => {
        if (!isNodeVisible(n)) return;
        const { halfWidth, halfHeight } = getNodeDimensions(n);
        points.push({ x: n.x - halfWidth, y: n.y - halfHeight });
        points.push({ x: n.x + halfWidth, y: n.y + halfHeight });
    });
        Object.values(boxes).forEach(b => {
            if (!isLayerVisible(b.layer)) return;
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
syncSnapControlsFromSettings();
initTheme();
updateAutosaveInfo();
renderAnalyticsPanel();
loadGraphFromBackend();
