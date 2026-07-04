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

// "Primary" selection (drives the single-item property editors) plus
// set-based multi-selection (drives highlighting, marquee, copy/paste, group ops).
let selectedNodeId = null;
let selectedEdgeId = null;
let selectedBoxId = null;

let selectedNodes = new Set();
let selectedEdges = new Set();
let selectedBoxes = new Set();

// Data-driven visual encoding: color/size nodes by type / community / a metric.
const encoding = { mode: "none", min: 0, max: 1, sizeByMetric: "none", sizeMin: 0, sizeMax: 1 };

function isNodeSelected(id) { return selectedNodes.has(id); }
function isEdgeSelected(id) { return selectedEdges.has(id); }
function isBoxSelected(id) { return selectedBoxes.has(id) || selectedBoxId === id; }

function clearSelection() {
    selectedNodes.clear();
    selectedEdges.clear();
    selectedBoxes.clear();
    selectedNodeId = null;
    selectedEdgeId = null;
    selectedBoxId = null;
}

function selectNode(id, { additive = false } = {}) {
    if (!additive) { selectedNodes.clear(); selectedEdges.clear(); selectedBoxes.clear(); selectedEdgeId = null; selectedBoxId = null; }
    if (additive && selectedNodes.has(id)) {
        selectedNodes.delete(id);
        selectedNodeId = selectedNodes.size ? [...selectedNodes][selectedNodes.size - 1] : null;
    } else {
        selectedNodes.add(id);
        selectedNodeId = id;
    }
}

function selectEdge(id, { additive = false } = {}) {
    if (!additive) { selectedNodes.clear(); selectedEdges.clear(); selectedBoxes.clear(); selectedNodeId = null; selectedBoxId = null; }
    if (additive && selectedEdges.has(id)) {
        selectedEdges.delete(id);
        selectedEdgeId = selectedEdges.size ? [...selectedEdges][selectedEdges.size - 1] : null;
    } else {
        selectedEdges.add(id);
        selectedEdgeId = id;
    }
}

function selectBox(id, { additive = false } = {}) {
    if (!additive) { selectedNodes.clear(); selectedEdges.clear(); selectedBoxes.clear(); selectedNodeId = null; selectedEdgeId = null; }
    if (additive && selectedBoxes.has(id)) {
        selectedBoxes.delete(id);
        selectedBoxId = selectedBoxes.size ? [...selectedBoxes][selectedBoxes.size - 1] : null;
    } else {
        selectedBoxes.add(id);
        selectedBoxId = id;
    }
}

// Nodes to operate on for bulk actions: explicit multi-selection if present,
// otherwise fall back to the legacy single-primary node.
function getSelectedNodeIds() {
    if (selectedNodes.size) return [...selectedNodes];
    return selectedNodeId ? [selectedNodeId] : [];
}

// camera / viewport
let view = { scale: 1, tx: 0, ty: 0 };

// dragging
let draggingNodeId = null;
let dragOffset = { x: 0, y: 0 };
let dragUndoPushed = false;
let dragGroupStart = {};       // id -> {x,y} pre-drag positions (group drag)
let dragAnchorStart = { x: 0, y: 0 };

// marquee (rubber-band) selection
let marqueeActive = false;
let marqueeStart = { x: 0, y: 0 };
let marqueeRect = null;

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
    const entityType = node.entityType || "generic";
    const type = (typeof getEntityType === "function") ? getEntityType(entityType) : null;
    const shapeType = node.shape || (type && type.shape) || "circle";
    const defaults = getShapeDefaults(shapeType);
    const normalized = { ...node };
    normalized.entityType = entityType;
    normalized.value = node.value != null ? node.value : (node.label || "");
    normalized.properties = node.properties && typeof node.properties === "object" ? node.properties : {};
    normalized.provenance = node.provenance && typeof node.provenance === "object"
        ? node.provenance
        : { source: "manual", createdAt: node.createdAt || Date.now() };
    normalized.shape = shapeType;
    normalized.color = node.color || (type && type.color) || defaults.color;
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

// Optional size-by-metric encoding multiplier (1 when not encoding by size).
function nodeSizeFactor(node) {
    if (typeof encoding === "undefined") return 1;
    const m = encoding.sizeByMetric;
    if (!m || m === "none") return 1;
    if (!node.metrics || !Number.isFinite(node.metrics[m]) || !(encoding.sizeMax > encoding.sizeMin)) return 1;
    const t = (node.metrics[m] - encoding.sizeMin) / (encoding.sizeMax - encoding.sizeMin);
    return 0.7 + Math.max(0, Math.min(1, t)) * 1.8;
}

function getNodeDimensions(node) {
    const shapeType = node.shape || "circle";
    const f = nodeSizeFactor(node);
    if (shapeType === "circle") {
        const radius = (node.size || getShapeDefaults("circle").size) * f;
        return {
            width: radius * 2,
            height: radius * 2,
            halfWidth: radius,
            halfHeight: radius,
            radius
        };
    }

    const defaults = getShapeDefaults(shapeType);
    const width = (Number.isFinite(node.width) ? node.width : defaults.width) * f;
    const height = (Number.isFinite(node.height) ? node.height : defaults.height) * f;
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
        ...ed,
        id: ed.id || `e${i}`,
        source: ed.source,
        target: ed.target,
        label: ed.label || "",
        color: ed.color || undefined,
        width: Number.isFinite(ed.width) ? ed.width : 2,
        weight: Number.isFinite(ed.weight) ? ed.weight : undefined,
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

    clearSelection();
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

let filterType = "";          // entity-type id from the dropdown ("" = all)
let viewMode = "graph";        // graph | canvas | bubble | map | list
const timeFilter = { active: false, min: 0, max: 0 }; // timeline brush

// A node's timestamp (ms) for the timeline: explicit date/time property, else
// its provenance.createdAt. Returns null if the node has no temporal data.
function nodeTime(node) {
    const p = node.properties || {};
    const raw = p.date || p.time || p.timestamp || p.datetime;
    if (raw != null && raw !== "") {
        const t = Date.parse(raw);
        if (Number.isFinite(t)) return t;
        const num = Number(raw);
        if (Number.isFinite(num)) return num;
    }
    if (node.provenance && Number.isFinite(node.provenance.createdAt)) return node.provenance.createdAt;
    return null;
}

function isNodeVisible(node) {
    if (!isLayerVisible(node.layer)) return false;
    if (filterType && (node.entityType || "generic") !== filterType) return false;
    if (timeFilter.active) {
        const t = nodeTime(node);
        if (t != null && (t < timeFilter.min || t > timeFilter.max)) return false;
    }
    if (!searchTerm) return true;
    // support a "type:<id>" token alongside free text
    let term = searchTerm;
    const typeMatch = term.match(/type:(\S+)/);
    if (typeMatch) {
        if ((node.entityType || "generic").toLowerCase() !== typeMatch[1].toLowerCase()) return false;
        term = term.replace(/type:\S+/, "").trim();
        if (!term) return true;
    }
    const text = ((node.label || "") + " " + (node.value || "") + " " + (node.desc || "") + " " + (node.group || "") + " " +
        Object.values(node.properties || {}).join(" ")).toLowerCase();
    return text.includes(term);
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

// Number of connected components. Accepts a prebuilt undirected adjacency to
// avoid rebuilding it when the caller already has one (e.g. computeGraphStats).
function computeConnectedComponents(adj) {
    if (!adj) adj = buildAdjacency({ directed: false, weighted: false });
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

// Diameter and average shortest-path length over the largest component using
// unweighted BFS from every node. Capped for responsiveness; returns nulls when
// the graph is trivial or too large (matching the server's compute_distance_stats).
const MAX_DISTANCE_STATS_NODES = 1500;
function computeDistanceStats(adj) {
    const ids = Object.keys(adj);
    if (ids.length < 2 || ids.length > MAX_DISTANCE_STATS_NODES) return { diameter: null, avgPathLength: null };

    // Largest connected component so unreachable pairs don't distort averages.
    const seen = new Set();
    let largest = [];
    ids.forEach(start => {
        if (seen.has(start)) return;
        const comp = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
            const node = stack.pop();
            comp.push(node);
            adj[node].forEach(n => { if (!seen.has(n.to)) { seen.add(n.to); stack.push(n.to); } });
        }
        if (comp.length > largest.length) largest = comp;
    });
    if (largest.length < 2) return { diameter: null, avgPathLength: null };

    const compSet = new Set(largest);
    let diameter = 0, total = 0, pairs = 0;
    largest.forEach(source => {
        const dist = { [source]: 0 };
        const queue = [source];
        let head = 0;
        while (head < queue.length) {
            const node = queue[head++];
            const d = dist[node];
            adj[node].forEach(n => {
                if (compSet.has(n.to) && dist[n.to] === undefined) {
                    dist[n.to] = d + 1;
                    queue.push(n.to);
                }
            });
        }
        Object.keys(dist).forEach(target => {
            if (target === source) return;
            const d = dist[target];
            if (d > diameter) diameter = d;
            total += d;
            pairs += 1;
        });
    });
    return { diameter, avgPathLength: pairs ? Number((total / pairs).toFixed(3)) : null };
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

    const selfLoops = edges.reduce((acc, e) => acc + (e.source === e.target ? 1 : 0), 0);
    const possible = nodeCount > 1 ? nodeCount * (nodeCount - 1) / 2 : 0;
    const density = possible ? Number((edgeCount / possible).toFixed(4)) : 0;
    const { diameter, avgPathLength } = computeDistanceStats(adj);

    return {
        nodeCount,
        edgeCount,
        components: computeConnectedComponents(adj),
        averageDegree: nodeCount ? (edgeCount * 2 / nodeCount).toFixed(2) : "0.00",
        maxDegree,
        isolated,
        selfLoops,
        density,
        diameter,
        avgPathLength
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
            const fmt = v => (v === null || v === undefined) ? "n/a" : v;
            statsEl.innerHTML = `
                <div><strong>Nodes:</strong> ${s.nodeCount}</div>
                <div><strong>Edges:</strong> ${s.edgeCount}</div>
                <div><strong>Components:</strong> ${s.components}</div>
                <div><strong>Average degree:</strong> ${s.averageDegree}</div>
                <div><strong>Max degree:</strong> ${s.maxDegree}</div>
                <div><strong>Isolated nodes:</strong> ${s.isolated}</div>
                ${s.selfLoops !== undefined ? `<div><strong>Self-loops:</strong> ${s.selfLoops}</div>` : ""}
                ${s.density !== undefined ? `<div><strong>Density:</strong> ${s.density}</div>` : ""}
                ${"diameter" in s ? `<div><strong>Diameter:</strong> ${fmt(s.diameter)}</div>` : ""}
                ${"avgPathLength" in s ? `<div><strong>Avg path length:</strong> ${fmt(s.avgPathLength)}</div>` : ""}
            `;
        }
    }

    if (pathEl) {
        const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const p = analyticsState.pathResult;
        if (analyticsState.pathError) {
            pathEl.innerHTML = `<div class="error-text">${esc(analyticsState.pathError)}</div>`;
        } else if (!p) {
            pathEl.innerHTML = "<em>No path computed yet.</em>";
        } else {
            // show entity labels along the path, not raw ids
            const nodesStr = (p.nodes || []).map(id => esc((nodes[id] && (nodes[id].label || nodes[id].value)) || id)).join(" → ");
            const costStr = typeof p.cost === "number" ? ` (cost ${p.cost.toFixed(2)})` : "";
            pathEl.innerHTML = `
                <div><strong>Algorithm:</strong> ${esc(p.algorithm || "auto")}</div>
                <div><strong>Path:</strong> ${nodesStr || "n/a"}</div>
                ${costStr ? `<div><strong>Distance:</strong> ${p.cost.toFixed(2)}</div>` : ""}
                <div><strong>Edges:</strong> ${esc((p.edges || []).join(", ")) || "n/a"}</div>
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
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
        autosaveError = false;
    } catch (e) {
        // QuotaExceededError or private-mode failures must not crash the render loop
        if (!autosaveError) console.warn("Autosave failed (storage quota?):", e);
        autosaveError = true;
    }
    updateAutosaveInfo();
    if (typeof populateFilterTypes === "function") populateFilterTypes();
    if (typeof populateNodeDatalist === "function") populateNodeDatalist();
    // Mirror to the server project, if one is open (debounced separately).
    if (typeof scheduleServerSave === "function") scheduleServerSave();
}

// Debounced autosave so we don't serialize+write the whole graph on every
// pointermove frame. render() calls scheduleSave() instead of autosave().
let autosaveError = false;
let _autosaveTimer = null;
function scheduleSave(delay = 600) {
    if (_autosaveTimer) clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
        _autosaveTimer = null;
        autosave();
    }, delay);
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
const tabPanelsContainer = document.getElementById("tab-panels");
const syncTabPanelsVisibility = () => {
    if (!tabPanelsContainer) return;
    const hasActive = Array.from(tabPanels).some(panel => panel.classList.contains("active"));
    tabPanelsContainer.classList.toggle("has-active", hasActive);
};
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        const isActive = btn.classList.contains("active");
        tabButtons.forEach(other => other.classList.remove("active"));
        tabPanels.forEach(panel => panel.classList.remove("active"));
        if (!isActive) {
            btn.classList.add("active");
            tabPanels.forEach(panel => panel.classList.toggle("active", panel.dataset.tab === tab));
        }
        syncTabPanelsVisibility();
    });
});
syncTabPanelsVisibility();

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
    clearSelection();
    render();
});

document.getElementById("redo-btn").addEventListener("click", () => {
    if (!redoStack.length) return;
    const current = snapshot();
    const next = redoStack.pop();
    undoStack.push(current);
    restoreFromSnapshot(next);
    clearSelection();
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

    // entity type select
    const typeSel = document.getElementById("edit-entity-type");
    if (typeSel) {
        if (!typeSel.dataset.built) {
            const cats = (typeof listEntityCategories === "function") ? listEntityCategories() : {};
            typeSel.innerHTML = "";
            Object.keys(cats).forEach(cat => {
                const og = document.createElement("optgroup");
                og.label = cat;
                cats[cat].forEach(t => {
                    const o = document.createElement("option");
                    o.value = t.id; o.textContent = t.name;
                    og.appendChild(o);
                });
                typeSel.appendChild(og);
            });
            typeSel.dataset.built = "1";
        }
        typeSel.value = n.entityType || "generic";
    }

    document.getElementById("edit-value").value = n.value != null ? n.value : "";
    document.getElementById("edit-label").value = n.label || "";
    document.getElementById("edit-color").value = /^#/.test(n.color || "") ? n.color : "#4682b4";
    document.getElementById("edit-size").value = n.size || 25;
    document.getElementById("edit-shape").value = n.shape || "circle";
    document.getElementById("edit-width").value = Number.isFinite(n.width) ? n.width : 130;
    document.getElementById("edit-height").value = Number.isFinite(n.height) ? n.height : 70;
    document.getElementById("edit-group").value = n.group || "";
    document.getElementById("edit-desc").value = n.desc || "";
    const pinEl = document.getElementById("edit-pinned");
    if (pinEl) pinEl.checked = !!n.pinned;

    // show width/height only for non-circle shapes
    const dims = document.getElementById("edit-dimensions");
    if (dims) dims.style.display = (n.shape === "circle") ? "none" : "flex";

    renderTypedProperties(n);
    renderColorSwatches();
    showValueValidation(n);

    const prov = document.getElementById("edit-provenance");
    if (prov) {
        const src = n.provenance && n.provenance.source ? n.provenance.source : "manual";
        prov.textContent = "Source: " + src;
    }

    const locked = isLayerLocked(n.layer);
    setEditorDisabled(editor, locked);
    if (chip && locked) {
        chip.textContent += " (Locked)";
    }
    if (locked) return;
}

// Render the per-type property fields into #edit-properties.
function renderTypedProperties(n) {
    const wrap = document.getElementById("edit-properties");
    if (!wrap) return;
    wrap.innerHTML = "";
    const type = (typeof getEntityType === "function") ? getEntityType(n.entityType) : null;
    if (!type || !type.properties || !type.properties.length) return;
    const header = document.createElement("div");
    header.className = "eyebrow";
    header.textContent = "Properties";
    wrap.appendChild(header);
    type.properties.forEach(p => {
        const lbl = document.createElement("label");
        lbl.textContent = p.label || p.key;
        wrap.appendChild(lbl);
        const inp = document.createElement("input");
        inp.type = p.type === "number" ? "number" : "text";
        inp.dataset.propKey = p.key;
        inp.className = "prop-input";
        const provFields = (n.provenance && n.provenance.fields) || {};
        if (provFields[p.key] && String(provFields[p.key]).startsWith("transform")) inp.disabled = true;
        inp.value = (n.properties && n.properties[p.key] != null) ? n.properties[p.key] : "";
        wrap.appendChild(inp);
    });
}

function renderColorSwatches() {
    const wrap = document.getElementById("edit-color-swatches");
    if (!wrap) return;
    if (wrap.dataset.built) return;
    const swatches = ["#4682b4", "#e15759", "#59a14f", "#f28e2b", "#b07aa1", "#76b7b2", "#edc948", "#9c755f", "#0f172a", "#94a3b8"];
    wrap.innerHTML = "";
    swatches.forEach(c => {
        const s = document.createElement("button");
        s.type = "button";
        s.className = "swatch";
        s.style.background = c;
        s.title = c;
        s.addEventListener("click", () => { const ec = document.getElementById("edit-color"); if (ec) ec.value = c; });
        wrap.appendChild(s);
    });
    wrap.dataset.built = "1";
}

function showValueValidation(n) {
    const el = document.getElementById("edit-value-error");
    if (!el) return;
    const err = (typeof validateEntityValue === "function") ? validateEntityValue(n.entityType, n.value) : null;
    if (err) { el.textContent = err; el.classList.remove("hidden"); }
    else { el.textContent = ""; el.classList.add("hidden"); }
}

document.getElementById("apply-node-edit").addEventListener("click", () => {
    if (!selectedNodeId || !nodes[selectedNodeId]) return;
    if (isLayerLocked(nodes[selectedNodeId].layer)) return;
    pushUndo();

    const n = nodes[selectedNodeId];
    n.entityType = document.getElementById("edit-entity-type").value || "generic";
    n.value = document.getElementById("edit-value").value;
    n.label = document.getElementById("edit-label").value || n.value;
    n.color = document.getElementById("edit-color").value || "#4682b4";
    n.shape = document.getElementById("edit-shape").value || "circle";
    n.size = parseFloat(document.getElementById("edit-size").value) || 25;
    const w = parseFloat(document.getElementById("edit-width").value);
    const h = parseFloat(document.getElementById("edit-height").value);
    if (Number.isFinite(w)) n.width = w;
    if (Number.isFinite(h)) n.height = h;
    n.group = document.getElementById("edit-group").value || "";
    n.desc = document.getElementById("edit-desc").value || "";
    n.pinned = !!document.getElementById("edit-pinned").checked;

    // typed properties
    const props = {};
    document.querySelectorAll("#edit-properties .prop-input").forEach(inp => {
        props[inp.dataset.propKey] = inp.value;
    });
    n.properties = props;

    nodes[selectedNodeId] = normalizeNode(n);
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
    document.getElementById("edge-color").value = /^#/.test(e.color || "") ? e.color : "#888888";
    document.getElementById("edge-width").value = e.width || 2;
    const wEl = document.getElementById("edge-weight");
    if (wEl) wEl.value = Number.isFinite(e.weight) ? e.weight : "";
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
    const wVal = parseFloat(document.getElementById("edge-weight").value);
    e.weight = Number.isFinite(wVal) ? wVal : undefined;
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

// RFC-4180-aware CSV reader: returns an array of records (each an array of
// field strings), honouring double-quoted fields with embedded commas,
// newlines and "" escapes. Mirrors csvEscape() so the app's own export
// re-imports losslessly.
function parseCSVRecords(text) {
    const records = [];
    let field = "";
    let record = [];
    let inQuotes = false;
    let fieldStart = true; // a quote only opens a quoted field at the field's start
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
                else inQuotes = false;
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === '"' && fieldStart) { inQuotes = true; fieldStart = false; continue; }
        if (ch === ',') { record.push(field); field = ""; fieldStart = true; continue; }
        if (ch === '\r') { continue; }
        if (ch === '\n') { record.push(field); records.push(record); field = ""; record = []; fieldStart = true; continue; }
        field += ch; fieldStart = false;
    }
    if (inQuotes || field !== "" || record.length) { record.push(field); records.push(record); }
    return records;
}

function parseCSVEdgeList(text) {
    const records = parseCSVRecords(text)
        .map(cells => cells.map(s => s.trim()))
        .filter(cells => cells.some(Boolean)); // drop blank lines
    if (!records.length) return null;

    const headerCells = records[0].map(h => h.toLowerCase());
    const hasHeader = headerCells.includes("source") && headerCells.includes("target");

    const rows = hasHeader ? records.slice(1) : records;
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
        const edge = {
            id: data.id || `e${idx}`,
            source: data.source,
            target: data.target,
            label: data.label || "",
            color: data.color || "#888888",
            width: parseFloat(data.width) || 2,
            directed
        };
        // Preserve an explicit numeric weight for weighted shortest-path (round-trips buildCSV).
        const weight = parseFloat(data.weight);
        if (Number.isFinite(weight)) edge.weight = weight;
        return edge;
    };

    const edgesFromCSV = rows
        .map((cells, idx) => cellsToEdge(cells, idx))
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
        const node = {
            id,
            label,
            x: Number.isFinite(dataX) ? dataX : positions[id]?.x || 300 + idx * 30,
            y: Number.isFinite(dataY) ? dataY : positions[id]?.y || 300
        };
        // Restore entity type / value / color when present (round-trips buildGraphML).
        const rawType = n.querySelector("data[key='type']")?.textContent?.trim();
        if (rawType && rawType !== "generic") node.entityType = rawType;
        const rawValue = n.querySelector("data[key='value']")?.textContent?.trim();
        if (rawValue) node.value = rawValue;
        const rawColor = n.querySelector("data[key='color']")?.textContent?.trim();
        if (rawColor) node.color = rawColor;
        nodesMap[id] = node;
    });

    const edgesFromXml = edgesInFile.map((e, idx) => {
        const source = e.getAttribute("source");
        const target = e.getAttribute("target");
        if (!source || !target) return null;
        const dataLabel = e.querySelector("data[key='label']") || e.querySelector("data[key='elabel']") || e.querySelector("y\\:EdgeLabel");
        const directedAttr = e.getAttribute("directed");
        const directed = directedAttr ? directedAttr === "true" : defaultDirected;
        const edge = {
            id: e.getAttribute("id") || `e${idx}`,
            source,
            target,
            label: dataLabel?.textContent?.trim() || "",
            // Accept our own declared edge keys (ecolor/ewidth/eweight) and the
            // plain names other GraphML tools may use.
            color: (e.querySelector("data[key='ecolor']") || e.querySelector("data[key='color']"))?.textContent?.trim() || "#888888",
            width: parseFloat((e.querySelector("data[key='ewidth']") || e.querySelector("data[key='width']"))?.textContent || "") || 2,
            directed
        };
        const weight = parseFloat((e.querySelector("data[key='eweight']") || e.querySelector("data[key='weight']"))?.textContent || "");
        if (Number.isFinite(weight)) edge.weight = weight;
        return edge;
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

let exporting = false;

// Build a clean, standalone SVG for export — without editor chrome (resize
// handles, snap guides, selection/marquee rings). scope "content" fits the whole
// graph; "viewport" captures the current view. dpi multiplies raster output.
function buildExportableSvg({ scope = "viewport" } = {}) {
    // Re-render once with selection/guides cleared and the exporting flag set so
    // chrome is omitted, then clone the clean DOM and restore the live view.
    const saved = {
        n: [...selectedNodes], e: [...selectedEdges], b: [...selectedBoxes],
        nId: selectedNodeId, eId: selectedEdgeId, bId: selectedBoxId, guides: activeGuides
    };
    exporting = true;
    selectedNodes = new Set(); selectedEdges = new Set(); selectedBoxes = new Set();
    selectedNodeId = selectedEdgeId = selectedBoxId = null;
    activeGuides = { vertical: [], horizontal: [] };
    flushRender();
    const clone = svg.cloneNode(true);
    exporting = false;
    selectedNodes = new Set(saved.n); selectedEdges = new Set(saved.e); selectedBoxes = new Set(saved.b);
    selectedNodeId = saved.nId; selectedEdgeId = saved.eId; selectedBoxId = saved.bId;
    activeGuides = saved.guides;
    flushRender();

    const computed = getComputedStyle(document.body);
    const canvasBg = computed.getPropertyValue("--canvas-bg")?.trim() || "#ffffff";

    let width, height;
    const margin = 40;
    if (scope === "content") {
        const b = getGraphBounds();
        if (b) {
            width = Math.max(1, Math.round(b.width + 2 * margin));
            height = Math.max(1, Math.round(b.height + 2 * margin));
            const vp = clone.querySelector("#viewport");
            if (vp) vp.setAttribute("transform", `translate(${-b.minX + margin},${-b.minY + margin}) scale(1)`);
        } else {
            width = svg.clientWidth || 1024;
            height = svg.clientHeight || 768;
        }
    } else {
        width = svg.clientWidth || parseFloat(svg.getAttribute("width")) || 1024;
        height = svg.clientHeight || parseFloat(svg.getAttribute("height")) || 768;
    }

    clone.setAttribute("width", width);
    clone.setAttribute("height", height);
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.setAttribute("xmlns", NS);

    // full-bleed background rect so the output isn't transparent
    const fullBg = document.createElementNS(NS, "rect");
    fullBg.setAttribute("x", 0); fullBg.setAttribute("y", 0);
    fullBg.setAttribute("width", width); fullBg.setAttribute("height", height);
    fullBg.setAttribute("fill", canvasBg);
    clone.insertBefore(fullBg, clone.firstChild);

    return { svg: clone, width, height, background: canvasBg };
}

function serializeSvgElement(element) {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(element);
}

function svgStringToPngBlob(svgString, width, height, background, dpi = 1) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const blob = new Blob([svgString], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(width * dpi);
            canvas.height = Math.round(height * dpi);
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.fillStyle = background || "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
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
            } else if (importFormat === "dot") {
                graph = parseDot(reader.result);
            }
            if (!graph) throw new Error("Unable to parse file.");
            const merge = document.getElementById("import-merge")?.checked;
            if (merge) {
                ensureActiveLayer();
                mergeGraphPayload(graph);
            } else {
                applyGraphPayload(graph);
            }
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

// Build a context-rich export filename: node-mapper-[project-]YYYYMMDD-HHMM.ext
function exportFilename(ext) {
    const d = new Date();
    const p = n => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    const rawName = (document.getElementById("project-name")?.value || "").trim();
    const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return `node-mapper${slug ? "-" + slug : ""}-${stamp}.${ext}`;
}

document.getElementById("export-graph").addEventListener("click", async () => {
    const format = document.getElementById("export-format").value;
    const scope = document.getElementById("export-scope")?.value || "content";
    const dpi = parseInt(document.getElementById("png-scale")?.value || "2", 10);
    const graph = { nodes, edges, boxes, layers, activeLayerId, layoutSettings };

    if (format === "json") {
        downloadBlob(new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }), exportFilename("json"));
        return;
    }
    if (format === "csv") {
        downloadBlob(new Blob([buildCSV()], { type: "text/csv" }), exportFilename("csv"));
        return;
    }
    if (format === "graphml") {
        downloadBlob(new Blob([buildGraphML()], { type: "application/xml" }), exportFilename("graphml"));
        return;
    }
    if (format === "dot") {
        downloadBlob(new Blob([buildDot()], { type: "text/vnd.graphviz" }), exportFilename("dot"));
        return;
    }
    if (format === "markdown") {
        downloadBlob(new Blob([buildMarkdown()], { type: "text/markdown" }), exportFilename("md"));
        return;
    }
    if (format === "report") {
        downloadBlob(new Blob([buildReportHTML()], { type: "text/html" }), exportFilename("html"));
        return;
    }

    const { svg: svgCopy, width, height, background } = buildExportableSvg({ scope });
    const svgString = serializeSvgElement(svgCopy);
    if (format === "svg") {
        downloadBlob(new Blob([svgString], { type: "image/svg+xml" }), exportFilename("svg"));
    } else if (format === "png") {
        try {
            const pngBlob = await svgStringToPngBlob(svgString, width, height, background, dpi);
            downloadBlob(pngBlob, exportFilename("png"));
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
        const startRaw = (startInput?.value || "").trim();
        const endRaw = (endInput?.value || "").trim();
        const startId = startRaw ? resolveNodeRef(startRaw) : null;
        const endId = endRaw ? resolveNodeRef(endRaw) : null;
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

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

svg.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    const targetScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * zoomFactor));
    const effective = targetScale / view.scale;
    if (effective === 1) return; // already clamped at a limit

    const worldPos = screenToWorld(e.clientX, e.clientY);

    view.tx = (view.tx - worldPos.x * view.scale) * effective + worldPos.x * (view.scale * effective);
    view.ty = (view.ty - worldPos.y * view.scale) * effective + worldPos.y * (view.scale * effective);
    view.scale *= effective;

    render();
}, { passive: false });

// ---------- VIEW HELPERS (shared by zoom controls, minimap, export) ----------

// World-space bounding box of all visible nodes + boxes (null if empty).
function getGraphBounds({ visibleOnly = true } = {}) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;
    Object.values(nodes).forEach(n => {
        if (visibleOnly && !isNodeVisible(n)) return;
        const { halfWidth, halfHeight } = getNodeDimensions(n);
        minX = Math.min(minX, n.x - halfWidth);
        minY = Math.min(minY, n.y - halfHeight);
        maxX = Math.max(maxX, n.x + halfWidth);
        maxY = Math.max(maxY, n.y + halfHeight);
        any = true;
    });
    Object.values(boxes).forEach(b => {
        if (visibleOnly && !isLayerVisible(b.layer)) return;
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
        any = true;
    });
    if (!any) return null;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function fitToContent(padding = 80) {
    const b = getGraphBounds();
    if (!b) { resetView(); return; }
    const vw = svg.clientWidth || 800;
    const vh = svg.clientHeight || 600;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
        Math.min((vw - 2 * padding) / (b.width || 1), (vh - 2 * padding) / (b.height || 1))));
    view.scale = scale;
    view.tx = vw / 2 - (b.minX + b.width / 2) * scale;
    view.ty = vh / 2 - (b.minY + b.height / 2) * scale;
    render();
}

function resetView() {
    view.scale = 1;
    view.tx = 0;
    view.ty = 0;
    render();
}

function zoomAtCenter(factor) {
    const targetScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    const effective = targetScale / view.scale;
    if (effective === 1) return;
    const cx = (svg.clientWidth || 800) / 2;
    const cy = (svg.clientHeight || 600) / 2;
    const worldPos = screenToWorld(svg.getBoundingClientRect().left + cx, svg.getBoundingClientRect().top + cy);
    view.tx = (view.tx - worldPos.x * view.scale) * effective + worldPos.x * (view.scale * effective);
    view.ty = (view.ty - worldPos.y * view.scale) * effective + worldPos.y * (view.scale * effective);
    view.scale *= effective;
    render();
}

// ---------- POINTER INTERACTION ----------

svg.addEventListener("pointerdown", e => {
    const nodeId = e.target.dataset?.nodeId;
    const edgeId = e.target.dataset?.edgeId;
    const boxId  = e.target.dataset?.boxId;
    const resizeId = e.target.dataset?.resizeBoxId;
    const corner = e.target.dataset?.resizeCorner;

    if (e.button === 2) return;  // right button → handled by contextmenu

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
        dragUndoPushed = false;
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
        dragUndoPushed = false;

        selectBox(boxId, { additive: e.shiftKey });

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
            // Selecting must NOT push undo (it would wipe redo on a bare click).
            // If clicking an already-selected node without shift, keep the whole
            // multi-selection so a drag moves the group; otherwise (re)select.
            if (!(isNodeSelected(nodeId) && !e.shiftKey)) {
                selectNode(nodeId, { additive: e.shiftKey });
            } else {
                selectedNodeId = nodeId;
            }
            updateNodeEditor();
            updateEdgeEditor();

            const pos = screenToWorld(e.clientX, e.clientY);
            dragOffset.x = pos.x - n.x;
            dragOffset.y = pos.y - n.y;
            draggingNodeId = nodeId;
            dragUndoPushed = false;
            // capture pre-drag positions of the whole selection for group drag
            dragGroupStart = {};
            getSelectedNodeIds().forEach(id => {
                if (nodes[id] && !isLayerLocked(nodes[id].layer)) dragGroupStart[id] = { x: nodes[id].x, y: nodes[id].y };
            });
            dragAnchorStart = { x: n.x, y: n.y };
            svg.setPointerCapture(e.pointerId);
            render();
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
            selectEdge(edgeId, { additive: e.shiftKey });
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
            if (e.shiftKey) {
                // marquee (rubber-band) selection
                marqueeActive = true;
                marqueeStart = { x: pos.x, y: pos.y };
                marqueeRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
                svg.setPointerCapture(e.pointerId);
                return;
            }
            // start panning + clear selection
            panning = true;
            panStart = { x: e.clientX, y: e.clientY };
            panViewStart = { tx: view.tx, ty: view.ty };
            svg.setPointerCapture(e.pointerId);
            clearSelection();
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
    const dropped = e.dataTransfer.getData("text/plain");
    if (!dropped) return;
    e.preventDefault();

    if (isLayerLocked(activeLayerId)) {
        alert("Active layer is locked. Unlock it to add nodes.");
        return;
    }

    pushUndo();
    const pos = screenToWorld(e.clientX, e.clientY);
    // dropped value is an entity type id (registry includes plain shapes too)
    const id = createNodeAt(pos.x, pos.y, { entityType: dropped });
    selectNode(id);
    render();
});

svg.addEventListener("pointermove", e => {
    // Marquee (rubber-band) selection
    if (marqueeActive) {
        const pos = screenToWorld(e.clientX, e.clientY);
        marqueeRect = {
            x: Math.min(marqueeStart.x, pos.x),
            y: Math.min(marqueeStart.y, pos.y),
            w: Math.abs(pos.x - marqueeStart.x),
            h: Math.abs(pos.y - marqueeStart.y)
        };
        render();
        return;
    }

    // Dragging a node (and the rest of the selection, as a group)
    if (draggingNodeId) {
        const pos = screenToWorld(e.clientX, e.clientY);
        const n = nodes[draggingNodeId];
        const raw = { x: pos.x - dragOffset.x, y: pos.y - dragOffset.y };
        const snapped = applyNodeSnapping(raw, n);
        if (!dragUndoPushed) { pushUndo(); dragUndoPushed = true; }
        const groupIds = Object.keys(dragGroupStart);
        if (groupIds.length > 1) {
            const dx = snapped.x - dragAnchorStart.x;
            const dy = snapped.y - dragAnchorStart.y;
            groupIds.forEach(id => {
                const m = nodes[id];
                if (m) { m.x = dragGroupStart[id].x + dx; m.y = dragGroupStart[id].y + dy; }
            });
        } else {
            n.x = snapped.x;
            n.y = snapped.y;
        }
        activeGuides = snapSettings.showGuides ? snapped.guides : { vertical: [], horizontal: [] };
        render();
        return;
    }

    // Resizing a box
    if (resizingBoxId) {
        clearActiveGuides();
        const b = boxes[resizingBoxId];
        const pos = screenToWorld(e.clientX, e.clientY);
        if (!dragUndoPushed) { pushUndo(); dragUndoPushed = true; }

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
        if (!dragUndoPushed) { pushUndo(); dragUndoPushed = true; }

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
    // Finish marquee selection
    if (marqueeActive) {
        try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
        const r = marqueeRect;
        marqueeActive = false;
        marqueeRect = null;
        if (r && (r.w > 3 || r.h > 3)) {
            if (!e.shiftKey) clearSelection();
            Object.values(nodes).forEach(n => {
                if (!isNodeVisible(n) || isLayerLocked(n.layer)) return;
                if (n.x >= r.x && n.x <= r.x + r.w && n.y >= r.y && n.y <= r.y + r.h) {
                    selectedNodes.add(n.id);
                    selectedNodeId = n.id;
                }
            });
            // also catch boxes fully inside
            Object.values(boxes).forEach(b => {
                if (!isLayerVisible(b.layer)) return;
                if (b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.w && b.y + b.height <= r.y + r.h) {
                    selectedBoxes.add(b.id);
                }
            });
        }
        render();
        return;
    }

    if (draggingNodeId) {
        const moved = Object.keys(dragGroupStart);
        (moved.length ? moved : [draggingNodeId]).forEach(id => updateNodeBoxMembership(id));
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
    dragGroupStart = {};
    panning = false;
    if (activeGuides.vertical.length || activeGuides.horizontal.length) {
        clearActiveGuides();
        render();
    }
});

// ---------- CREATION / DELETION HELPERS ----------

// Server-authoritative unique ids so graphs from different sessions merge
// without id collisions (falls back to a time+random id on old browsers).
function genId(prefix) {
    nodeCounter++; // keep counters advancing for any legacy consumers
    if (typeof crypto !== "undefined" && crypto.randomUUID) return prefix + crypto.randomUUID();
    return prefix + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

function createNodeAt(x, y, options = {}) {
    ensureActiveLayer();
    const id = genId("n");
    const entityType = options.entityType || "generic";
    const type = (typeof getEntityType === "function") ? getEntityType(entityType) : null;
    const shapeType = options.shape || (type && type.shape) || "circle";
    const defaults = getShapeDefaults(shapeType);
    const label = options.label != null ? options.label
        : (options.value != null ? options.value
            : (type && type.id !== "generic" && !type.category.startsWith("Shapes") ? type.name : "Node " + nodeCounter));
    const baseNode = {
        id,
        x,
        y,
        entityType,
        value: options.value != null ? options.value : label,
        properties: options.properties || {},
        label,
        color: options.color || (type && type.color) || defaults.color,
        stroke: options.stroke || defaults.stroke,
        size: options.size || defaults.size,
        width: options.width || defaults.width,
        height: options.height || defaults.height,
        shape: shapeType,
        desc: "",
        group: "",
        box: null,
        layer: activeLayerId,
        provenance: options.provenance || { source: "manual", createdAt: Date.now() }
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
    const id = genId("e");
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

function createBoxAt(x, y, opts = {}) {
    ensureActiveLayer();
    const id = genId("b");
    boxes[id] = {
        id,
        label: opts.label || ("Group " + boxCounter),
        x,
        y,
        width: opts.width || 260,
        height: opts.height || 200,
        nodes: [],
        layer: activeLayerId
    };
    return id;
}

function deleteBox(id) {
    const b = boxes[id];
    if (!b) return;
    (b.nodes || []).forEach(nid => { if (nodes[nid]) nodes[nid].box = null; });
    delete boxes[id];
    selectedBoxes.delete(id);
    if (selectedBoxId === id) selectedBoxId = null;
}

// ---------- BULK EDIT: delete / copy / paste / group ----------

let clipboard = null;

function deleteSelection() {
    const nodeIds = [...selectedNodes];
    const edgeIds = [...selectedEdges];
    const boxIds = [...selectedBoxes];
    if (!nodeIds.length && !edgeIds.length && !boxIds.length && !selectedNodeId && !selectedEdgeId && !selectedBoxId) return;
    pushUndo();
    (nodeIds.length ? nodeIds : (selectedNodeId ? [selectedNodeId] : [])).forEach(id => {
        if (nodes[id] && !isLayerLocked(nodes[id].layer)) deleteNode(id);
    });
    const edgeSet = new Set(edgeIds.length ? edgeIds : (selectedEdgeId ? [selectedEdgeId] : []));
    if (edgeSet.size) edges = edges.filter(ed => !edgeSet.has(ed.id) || isLayerLocked(ed.layer));
    (boxIds.length ? boxIds : (selectedBoxId ? [selectedBoxId] : [])).forEach(id => {
        if (boxes[id] && !isLayerLocked(boxes[id].layer)) deleteBox(id);
    });
    clearSelection();
    render();
}

function copySelection() {
    const ids = getSelectedNodeIds();
    if (!ids.length) return;
    const idSet = new Set(ids);
    const copiedNodes = ids.map(id => JSON.parse(JSON.stringify(nodes[id]))).filter(Boolean);
    const copiedEdges = edges.filter(e => idSet.has(e.source) && idSet.has(e.target))
        .map(e => JSON.parse(JSON.stringify(e)));
    clipboard = { nodes: copiedNodes, edges: copiedEdges };
}

function pasteClipboard(offset = 40) {
    if (!clipboard || !clipboard.nodes.length) return;
    pushUndo();
    ensureActiveLayer();
    const idMap = {};
    clearSelection();
    clipboard.nodes.forEach(n => {
        const newId = genId("n");
        idMap[n.id] = newId;
        const copy = { ...n, id: newId, x: (n.x || 0) + offset, y: (n.y || 0) + offset, box: null, layer: activeLayerId };
        nodes[newId] = normalizeNode(copy);
        selectedNodes.add(newId);
        selectedNodeId = newId;
    });
    clipboard.edges.forEach(e => {
        const s = idMap[e.source], t = idMap[e.target];
        if (!s || !t) return;
        edges.push({ ...e, id: genId("e"), source: s, target: t, layer: activeLayerId });
    });
    render();
}

function duplicateSelection() {
    copySelection();
    pasteClipboard(30);
}

function groupSelection() {
    const ids = getSelectedNodeIds().filter(id => nodes[id]);
    if (ids.length < 1) return;
    pushUndo();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(id => {
        const n = nodes[id];
        const { halfWidth, halfHeight } = getNodeDimensions(n);
        minX = Math.min(minX, n.x - halfWidth);
        minY = Math.min(minY, n.y - halfHeight);
        maxX = Math.max(maxX, n.x + halfWidth);
        maxY = Math.max(maxY, n.y + halfHeight);
    });
    const pad = 36;
    const id = createBoxAt(minX - pad, minY - pad - 16, { width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 + 16 });
    ids.forEach(nid => {
        if (nodes[nid].box && boxes[nodes[nid].box]) {
            boxes[nodes[nid].box].nodes = boxes[nodes[nid].box].nodes.filter(x => x !== nid);
        }
        nodes[nid].box = id;
        boxes[id].nodes.push(nid);
    });
    selectBox(id);
    render();
}

function ungroupSelection() {
    const boxIds = selectedBoxes.size ? [...selectedBoxes] : (selectedBoxId ? [selectedBoxId] : []);
    if (!boxIds.length) return;
    pushUndo();
    boxIds.forEach(id => { if (boxes[id] && !isLayerLocked(boxes[id].layer)) deleteBox(id); });
    clearSelection();
    render();
}

function selectAll() {
    clearSelection();
    Object.values(nodes).forEach(n => { if (isNodeVisible(n) && !isLayerLocked(n.layer)) { selectedNodes.add(n.id); selectedNodeId = n.id; } });
    render();
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

    // capture positions for an animated transition
    const before = {};
    Object.keys(nodes).forEach(id => { before[id] = { x: nodes[id].x, y: nodes[id].y }; });

    // layout-on-selection: if 2+ nodes selected, only arrange those
    const selIds = getSelectedNodeIds().filter(id => nodes[id]);
    if (selIds.length >= 2) {
        const subNodes = {};
        selIds.forEach(id => { subNodes[id] = nodes[id]; });
        Layout.apply(type, { nodes: subNodes, edges, boxes: {}, view }, layoutSettings.options[type] || {});
    } else {
        Layout.apply(type, { nodes, edges, boxes, view }, layoutSettings.options[type] || {});
    }

    animateLayout(before);
});

// Animate nodes from their previous positions to the freshly-computed layout.
function animateLayout(before, dur = 420) {
    const target = {};
    Object.keys(nodes).forEach(id => { target[id] = { x: nodes[id].x, y: nodes[id].y }; });
    let t0 = null;
    const step = now => {
        if (t0 === null) t0 = now;
        const k = Math.min(1, (now - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
        Object.keys(target).forEach(id => {
            const n = nodes[id], b = before[id];
            if (n && b) { n.x = b.x + (target[id].x - b.x) * e; n.y = b.y + (target[id].y - b.y) * e; }
        });
        renderNow();
        if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

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

// Global editing shortcuts (delete, copy/paste/duplicate, select-all, undo/redo, group, escape)
document.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;

    if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodes.size || selectedEdges.size || selectedBoxes.size || selectedNodeId || selectedEdgeId || selectedBoxId) {
            e.preventDefault();
            deleteSelection();
        }
        return;
    }
    if (e.key === "Escape") {
        if (marqueeActive) { marqueeActive = false; marqueeRect = null; }
        hideContextMenu();
        clearSelection();
        render();
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (e.shiftKey && k === "z") { e.preventDefault(); document.getElementById("redo-btn").click(); return; }
        switch (k) {
            case "z": e.preventDefault(); document.getElementById("undo-btn").click(); return;
            case "y": e.preventDefault(); document.getElementById("redo-btn").click(); return;
            case "c": e.preventDefault(); copySelection(); return;
            case "v": e.preventDefault(); pasteClipboard(); return;
            case "d": e.preventDefault(); duplicateSelection(); return;
            case "a": e.preventDefault(); selectAll(); return;
            case "g": e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection(); return;
            default: break;
        }
    }
});

// ---------- PANEL HELPER ----------

function openPanel(panelId) {
    const p = document.getElementById(panelId);
    if (p) { p.classList.add("open"); p.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
}

// ---------- TRANSFORMS ----------

let availableTransforms = []; // [{id,name,inputTypes,description}]

async function loadTransforms() {
    try {
        const res = await fetch("/api/transforms");
        if (!res.ok) return;
        const data = await res.json();
        availableTransforms = Array.isArray(data) ? data : (data.transforms || []);
        if (typeof renderTransformsHub === "function") renderTransformsHub();
    } catch (e) { /* server offline → transforms simply unavailable */ }
}

function getApplicableTransforms(node) {
    const type = node.entityType || "generic";
    return availableTransforms.filter(t =>
        !t.inputTypes || !t.inputTypes.length || t.inputTypes.includes(type) || t.inputTypes.includes("*"));
}

async function runTransformOnNode(node, transformId, params = {}) {
    try {
        const res = await fetch("/api/transform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                transformId,
                entity: { type: node.entityType || "generic", value: node.value || node.label || "", properties: node.properties || {} },
                params
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert("Transform failed: " + (err.error || ("HTTP " + res.status)));
            return;
        }
        const data = await res.json();
        mergeTransformResults(node, transformId, data);
    } catch (e) {
        alert("Transform failed — is the server running?");
    }
}

function entityKey(type, value) {
    return (type || "generic") + "::" + String(value || "").trim().toLowerCase();
}

// Additively merge transform results into the graph, de-duplicating entities by
// type+value and links by endpoint pair, stamping provenance.
function mergeTransformResults(sourceNode, transformId, data) {
    const ents = (data && data.entities) || [];
    const links = (data && data.links) || [];
    if (!ents.length) { return; }
    pushUndo();
    const existingByKey = {};
    Object.keys(nodes).forEach(id => {
        const n = nodes[id];
        existingByKey[entityKey(n.entityType, n.value || n.label)] = id;
    });
    const n = ents.length;
    ents.forEach((ent, i) => {
        const key = entityKey(ent.type, ent.value);
        let targetId = existingByKey[key];
        if (!targetId) {
            const angle = (i / n) * Math.PI * 2;
            const r = 160;
            targetId = createNodeAt(sourceNode.x + Math.cos(angle) * r, sourceNode.y + Math.sin(angle) * r, {
                entityType: ent.type, value: ent.value, label: ent.value, properties: ent.properties || {}
            });
            nodes[targetId].provenance = { source: "transform:" + transformId, createdAt: Date.now() };
            existingByKey[key] = targetId;
        }
        const link = links[i] || links[0] || {};
        const exists = edges.some(e => (e.source === sourceNode.id && e.target === targetId));
        if (!exists && targetId !== sourceNode.id) {
            const eid = createEdge(sourceNode.id, targetId);
            const edge = edges.find(e => e.id === eid);
            if (edge) {
                edge.label = link.label || transformId;
                edge.directed = link.directed !== false;
                edge.provenance = { source: "transform:" + transformId, createdAt: Date.now() };
            }
        }
    });
    render();
}

// ---------- CONTEXT MENU ----------

let _contextMenuEl = null;
function hideContextMenu() {
    if (_contextMenuEl) { _contextMenuEl.remove(); _contextMenuEl = null; }
}
function buildMenuInto(menu, items) {
    items.forEach(item => {
        if (item.separator) {
            const d = document.createElement("div");
            d.className = "context-sep";
            menu.appendChild(d);
            return;
        }
        const el = document.createElement("div");
        el.className = "context-item" + (item.disabled ? " disabled" : "") + (item.submenu ? " has-sub" : "");
        const span = document.createElement("span");
        span.textContent = item.label;
        el.appendChild(span);
        if (item.submenu && item.submenu.length) {
            const sub = document.createElement("div");
            sub.className = "context-submenu";
            buildMenuInto(sub, item.submenu);
            el.appendChild(sub);
        } else if (!item.disabled && item.action) {
            el.addEventListener("click", ev => { ev.stopPropagation(); hideContextMenu(); item.action(); });
        }
        menu.appendChild(el);
    });
}
function showContextMenu(clientX, clientY, items) {
    hideContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu";
    buildMenuInto(menu, items);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(clientX, window.innerWidth - rect.width - 8) + "px";
    menu.style.top = Math.min(clientY, window.innerHeight - rect.height - 8) + "px";
    _contextMenuEl = menu;
}
document.addEventListener("click", () => hideContextMenu());
document.addEventListener("contextmenu", e => {
    // hide our menu for right-clicks outside the canvas
    if (!e.target.closest || !e.target.closest("#graphCanvas")) hideContextMenu();
});

svg.addEventListener("contextmenu", e => {
    e.preventDefault();
    const owner = e.target.closest ? e.target.closest("[data-node-id],[data-edge-id],[data-box-id],[data-resize-box-id]") : null;
    const ds = (owner && owner.dataset) || e.target.dataset || {};
    const nodeId = ds.nodeId;
    const edgeId = ds.edgeId;
    const boxId = ds.boxId || ds.resizeBoxId;
    const pos = screenToWorld(e.clientX, e.clientY);
    let items;

    if (nodeId && nodes[nodeId]) {
        if (!isNodeSelected(nodeId)) selectNode(nodeId);
        render();
        const n = nodes[nodeId];
        const tItems = getApplicableTransforms(n).map(t => ({ label: t.name, action: () => runTransformOnNode(n, t.id) }));
        items = [
            { label: "Run transform", submenu: tItems.length ? tItems : [{ label: "(no transforms for this type)", disabled: true }] },
            { separator: true },
            { label: "Edit properties", action: () => openPanel("panel-selection") },
            { label: n.pinned ? "Unpin position" : "Pin position", action: () => { pushUndo(); getSelectedNodeIds().forEach(id => { if (nodes[id]) nodes[id].pinned = !n.pinned; }); render(); } },
            { label: "Copy", action: copySelection },
            { label: "Duplicate", action: duplicateSelection },
            { label: "Group selection", action: groupSelection },
            { separator: true },
            { label: "Delete", action: deleteSelection }
        ];
    } else if (edgeId) {
        const edge = edges.find(x => x.id === edgeId);
        selectEdge(edgeId); render();
        items = [
            { label: "Edit edge", action: () => openPanel("panel-selection") },
            { label: edge && edge.directed ? "Make undirected" : "Make directed", action: () => { if (edge) { pushUndo(); edge.directed = !edge.directed; render(); } } },
            { label: "Reverse direction", action: () => { if (edge) { pushUndo(); const s = edge.source; edge.source = edge.target; edge.target = s; render(); } } },
            { separator: true },
            { label: "Delete edge", action: () => { pushUndo(); edges = edges.filter(x => x.id !== edgeId); clearSelection(); render(); } }
        ];
    } else if (boxId && boxes[boxId]) {
        selectBox(boxId); render();
        items = [
            { label: "Rename box", action: () => openPanel("panel-selection") },
            { label: "Ungroup", action: ungroupSelection },
            { label: "Delete box", action: () => { pushUndo(); deleteBox(boxId); render(); } }
        ];
    } else {
        items = [
            { label: "Add node here", action: () => { pushUndo(); const id = createNodeAt(pos.x, pos.y); selectNode(id); render(); } },
            { label: "Paste", action: () => pasteClipboard(), disabled: !clipboard },
            { label: "Select all", action: selectAll },
            { separator: true },
            { label: "Fit to content", action: () => fitToContent() }
        ];
    }
    showContextMenu(e.clientX, e.clientY, items);
});

// ---------- RENDER ----------

function getThemeTokens() {
    const c = getComputedStyle(document.body);
    const get = (name, fallback) => (c.getPropertyValue(name) || "").trim() || fallback;
    return {
        nodeStroke: get("--node-stroke", "#1f2937"),
        nodeLabel: get("--node-label", "#0f172a"),
        boxFill: get("--box-fill", "#fffce8"),
        boxStroke: get("--box-stroke", "#d4b66a"),
        boxStrokeActive: get("--box-stroke-active", "#e09020"),
        boxLabel: get("--box-label", "#9c7c30"),
        boxHandle: get("--box-handle", "#d4b66a"),
        boxHandleStroke: get("--box-handle-stroke", "#9c7c30"),
        edgeDefault: get("--edge-default", "#888888"),
        edgeLabel: get("--edge-label", "#444444"),
        edgeDerived: get("--edge-derived", "#7c5cd6"),
        minimapNode: get("--minimap-node", "#666666"),
        minimapEdge: get("--minimap-edge", "#bbbbbb"),
        minimapBg: get("--minimap-bg", "#ffffff"),
        minimapBorder: get("--minimap-border", "#cccccc")
    };
}

// Data-driven visual encoding palette + helpers (state object `encoding` lives in STATE).
const COMMUNITY_PALETTE = [
    "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
    "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"
];
function communityColor(idx) {
    return COMMUNITY_PALETTE[((idx % COMMUNITY_PALETTE.length) + COMMUNITY_PALETTE.length) % COMMUNITY_PALETTE.length];
}
function rampColor(t) {
    t = Math.max(0, Math.min(1, t));
    // blue (low) → yellow → red (high)
    const stops = [[70, 130, 180], [240, 200, 70], [225, 45, 57]];
    const seg = t < 0.5 ? 0 : 1;
    const local = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const a = stops[seg], b = stops[seg + 1];
    const ch = i => Math.round(a[i] + (b[i] - a[i]) * local);
    return `#${[ch(0), ch(1), ch(2)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}
function isMetricMode(m) {
    return m === "degree" || m === "betweenness" || m === "closeness" || m === "pagerank";
}
function getNodeFill(n) {
    const m = encoding.mode;
    if (m === "community" && n.community != null) return communityColor(n.community);
    if (isMetricMode(m) && n.metrics && Number.isFinite(n.metrics[m]) && encoding.max > encoding.min) {
        return rampColor((n.metrics[m] - encoding.min) / (encoding.max - encoding.min));
    }
    if (m !== "type" && n.color) return n.color;
    if (typeof getEntityType === "function") {
        const et = getEntityType(n.entityType);
        if (et && et.color) return et.color;
    }
    return n.color || getShapeDefaults(n.shape || "circle").color;
}

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

// Point on a node's border in the direction (dirx,diry) from its center.
function nodeBorderPoint(node, dirx, diry) {
    const { halfWidth, halfHeight, radius } = getNodeDimensions(node);
    const shape = node.shape || "circle";
    const len = Math.hypot(dirx, diry) || 1;
    const ux = dirx / len, uy = diry / len;
    if (shape === "circle") {
        return { x: node.x + ux * radius, y: node.y + uy * radius };
    }
    // rect / rounded / cylinder / swimlane / diamond → AABB approximation
    const sx = ux !== 0 ? halfWidth / Math.abs(ux) : Infinity;
    const sy = uy !== 0 ? halfHeight / Math.abs(uy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: node.x + ux * s, y: node.y + uy * s };
}

// Clip an edge polyline so its endpoints sit on the node borders, not centers.
function clipEdgeToBorders(points, src, tgt) {
    if (!points || points.length < 2) return points;
    if (src === tgt) return points;
    const p = points.map(pt => ({ ...pt }));
    const next = p[1];
    const prev = p[p.length - 2];
    p[0] = nodeBorderPoint(src, next.x - src.x, next.y - src.y);
    p[p.length - 1] = nodeBorderPoint(tgt, prev.x - tgt.x, prev.y - tgt.y);
    return p;
}

// rAF-batched render: many handlers call render() per frame (e.g. drag);
// coalesce them into one actual DOM rebuild per animation frame.
let _renderQueued = false;
function render() {
    if (_renderQueued) return;
    _renderQueued = true;
    requestAnimationFrame(() => { _renderQueued = false; renderNow(); });
}
// Force a synchronous render (used before reading the live SVG, e.g. export).
function flushRender() {
    _renderQueued = false;
    renderNow();
}

function renderNow() {
    clearSelectionIfLayerUnavailable();

    // Alternate workspace views (canvas / bubble / map / entity list).
    // NOTE: toggle the .hidden class (it uses !important) rather than style.display.
    const canvasEl = document.getElementById("graphCanvasGl");
    const altEl = document.getElementById("alt-view");
    const showEl = (el, show) => { if (el) el.classList.toggle("hidden", !show); };
    if (viewMode === "list") {
        svg.style.display = "none"; showEl(canvasEl, false); showEl(altEl, true);
        renderListView(altEl); finishRenderPanels(); return;
    }
    if (viewMode === "canvas") {
        svg.style.display = "none"; showEl(altEl, false); showEl(canvasEl, true);
        renderCanvasView(canvasEl); finishRenderPanels(); return;
    }
    showEl(canvasEl, false); showEl(altEl, false); svg.style.display = "block";
    if (viewMode === "bubble") { renderBubbleView(); finishRenderPanels(); return; }
    if (viewMode === "map") { renderMapView(); finishRenderPanels(); return; }

    svg.innerHTML = "";
    const theme = getThemeTokens();

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
        rect.setAttribute("fill", theme.boxFill);
        rect.setAttribute("fill-opacity", "0.85");
        rect.setAttribute("stroke", isBoxSelected(b.id) ? theme.boxStrokeActive : theme.boxStroke);
        rect.setAttribute("stroke-width", isBoxSelected(b.id) ? "3" : "2");
        rect.dataset.boxId = b.id;
        g.appendChild(rect);

        const label = document.createElementNS(NS, "text");
        label.textContent = b.label;
        label.setAttribute("x", b.x + 10);
        label.setAttribute("y", b.y + 20);
        label.setAttribute("font-size", "14");
        label.setAttribute("fill", theme.boxLabel);
        label.dataset.boxId = b.id;
        g.appendChild(label);

        // Resize handles (corners) — omitted in export output
        const corners = exporting ? [] : [
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
            h.setAttribute("fill", theme.boxHandle);
            h.setAttribute("stroke", theme.boxHandleStroke);
            h.setAttribute("cursor", "nwse-resize");
            h.setAttribute("class", "box-handle");
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

        const rawPoints = getEdgePointsForRouting(src, tgt);
        // Clip endpoints to node borders so arrowheads aren't hidden under fills.
        const points = clipEdgeToBorders(rawPoints, src, tgt);
        const onPath = pathHighlights.edges.has(edge.id);
        const derived = edge.provenance && typeof edge.provenance.source === "string" && edge.provenance.source.startsWith("transform");
        const baseColor = edge.color || (derived ? theme.edgeDerived : theme.edgeDefault);
        const strokeColor = onPath ? "#ff2d55" : (isEdgeSelected(edge.id) ? "#ff6600" : baseColor);
        const strokeWidth = (edge.width || 2) + (onPath ? 1.5 : 0) + (isEdgeSelected(edge.id) ? 1 : 0);
        const selfLoop = edge.source === edge.target;
        let edgeElement;

        if (selfLoop) {
            // self-loop: small arc above the node
            const { halfWidth, halfHeight } = getNodeDimensions(src);
            const r = Math.max(halfWidth, halfHeight);
            const path = document.createElementNS(NS, "path");
            const cx = src.x, cy = src.y - r;
            path.setAttribute("d", `M ${src.x - r * 0.5} ${src.y - r * 0.6} C ${cx - r} ${cy - r}, ${cx + r} ${cy - r}, ${src.x + r * 0.5} ${src.y - r * 0.6}`);
            path.setAttribute("fill", "none");
            edgeElement = path;
        } else if (points.length > 2) {
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
        edgeElement.setAttribute("fill", "none");
        edgeElement.dataset.edgeId = edge.id;
        edgeElement.setAttribute("pointer-events", "stroke");

        // transparent fat hit-area so thin edges are easily clickable
        const hit = edgeElement.cloneNode(false);
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", Math.max(12, strokeWidth + 8));
        hit.setAttribute("fill", "none");
        hit.dataset.edgeId = edge.id;
        hit.setAttribute("pointer-events", "stroke");
        viewport.appendChild(hit);
        edgeElement.setAttribute("pointer-events", "none");
        viewport.appendChild(edgeElement);

        if (edge.directed && !selfLoop && points.length >= 2) {
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
            text.setAttribute("fill", theme.edgeLabel);
            text.dataset.edgeId = edge.id;
            viewport.appendChild(text);
        }
    });

    // nodes
    const fallbackStroke = theme.nodeStroke;

    Object.values(nodes).forEach(n => {
        if (!visibleNodes[n.id]) return;

        const shapeType = n.shape || "circle";
        const { width, height, halfWidth, halfHeight, radius } = getNodeDimensions(n);
        const onPath = pathHighlights.nodes.has(n.id);
        const fill = getNodeFill(n);
        const baseStroke = n.stroke || fallbackStroke;
        const selectedNode = isNodeSelected(n.id);
        const stroke = onPath ? "#ff2d55" : (selectedNode ? "#ff9900" : baseStroke);
        const strokeWidth = onPath ? "4" : (selectedNode ? "3" : "1");
        const nodeGroup = document.createElementNS(NS, "g");
        nodeGroup.dataset.nodeId = n.id;
        if (n.pinned) nodeGroup.dataset.pinned = "1";

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

        // per-type icon glyph centered in the node
        const etype = (typeof getEntityType === "function") ? getEntityType(n.entityType) : null;
        if (etype && etype.icon) {
            const icon = document.createElementNS(NS, "text");
            icon.textContent = etype.icon;
            icon.setAttribute("x", n.x);
            icon.setAttribute("y", n.y);
            icon.setAttribute("text-anchor", "middle");
            icon.setAttribute("dominant-baseline", "central");
            icon.setAttribute("font-size", Math.max(11, Math.min(Math.min(halfWidth, halfHeight) * 1.1, 22)));
            icon.setAttribute("pointer-events", "none");
            icon.dataset.nodeId = n.id;
            nodeGroup.appendChild(icon);
        }

        viewport.appendChild(nodeGroup);

        // label with a readable halo so it stays legible over edges/nodes
        const label = document.createElementNS(NS, "text");
        label.textContent = n.label || n.value || n.id;
        label.setAttribute("x", n.x);
        label.setAttribute("y", n.y + halfHeight + 16);
        label.setAttribute("font-size", "12");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "node-label");
        label.setAttribute("paint-order", "stroke");
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

    // marquee rectangle
    if (marqueeActive && marqueeRect) {
        const m = document.createElementNS(NS, "rect");
        m.setAttribute("x", marqueeRect.x);
        m.setAttribute("y", marqueeRect.y);
        m.setAttribute("width", marqueeRect.w);
        m.setAttribute("height", marqueeRect.h);
        m.setAttribute("class", "marquee-rect");
        m.setAttribute("pointer-events", "none");
        viewport.appendChild(m);
    }

    finishRenderPanels();
}

// Shared render tail: refresh side panels + minimap + autosave. Called by the
// main SVG renderer and by every alternate view (canvas/bubble/map/list).
function finishRenderPanels() {
    updateNodeEditor();
    updateEdgeEditor();
    updateBoxEditor();
    renderLayersPanel();
    renderMinimap();
    if (typeof renderLegend === "function") renderLegend();
    if (typeof renderTransformsHub === "function") renderTransformsHub();
    scheduleSave();
}

// ---------- MINIMAP ----------

function renderMinimap() {
    if (!minimap) return;
    minimap.innerHTML = "";
    const theme = getThemeTokens();

    const mmWidth = minimap.clientWidth || 180;
    const mmHeight = minimap.clientHeight || 120;

    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", 0);
    bg.setAttribute("y", 0);
    bg.setAttribute("width", mmWidth);
    bg.setAttribute("height", mmHeight);
    bg.setAttribute("fill", theme.minimapBg);
    bg.setAttribute("stroke", theme.minimapBorder);
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
        line.setAttribute("stroke", theme.minimapEdge);
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
        rect.setAttribute("fill", theme.boxFill);
        rect.setAttribute("stroke", theme.boxStroke);
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
        c.setAttribute("fill", getNodeFill(n));
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

// ==================================================================
//                  NEW FEATURE WIRING
// ==================================================================

// ---------- ENTITY PALETTE ----------

function buildEntityPalette() {
    const wrap = document.getElementById("entity-palette");
    if (!wrap || typeof listEntityCategories !== "function") return;
    const q = (document.getElementById("palette-search")?.value || "").toLowerCase();
    const cats = listEntityCategories();
    wrap.innerHTML = "";
    Object.keys(cats).forEach(cat => {
        const types = cats[cat].filter(t => !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
        if (!types.length) return;
        const title = document.createElement("div");
        title.className = "entity-category-title";
        title.textContent = cat;
        wrap.appendChild(title);
        const grid = document.createElement("div");
        grid.className = "entity-palette";
        types.forEach(t => {
            const item = document.createElement("div");
            item.className = "entity-item";
            item.draggable = true;
            item.dataset.entityType = t.id;
            item.tabIndex = 0;
            item.title = "Drag onto canvas, or click to add at center";
            const glyph = document.createElement("span");
            if (t.icon) { glyph.className = "entity-glyph"; glyph.textContent = t.icon; }
            else { glyph.className = "entity-dot"; glyph.style.background = t.color; }
            const name = document.createElement("span");
            name.textContent = t.name;
            item.appendChild(glyph);
            item.appendChild(name);
            item.addEventListener("dragstart", e => {
                e.dataTransfer.setData("text/plain", t.id);
                e.dataTransfer.effectAllowed = "copy";
            });
            const addAtCenter = () => {
                if (isLayerLocked(activeLayerId)) { alert("Active layer is locked."); return; }
                pushUndo();
                const rect = svg.getBoundingClientRect();
                const c = screenToWorld(rect.left + svg.clientWidth / 2, rect.top + svg.clientHeight / 2);
                const id = createNodeAt(c.x, c.y, { entityType: t.id });
                selectNode(id);
                render();
            };
            item.addEventListener("click", addAtCenter);
            item.addEventListener("keydown", e => { if (e.key === "Enter") addAtCenter(); });
            grid.appendChild(item);
        });
        wrap.appendChild(grid);
    });
}

function populateFilterTypes() {
    const sel = document.getElementById("filter-type");
    if (!sel || typeof listEntityTypes !== "function") return;
    const present = new Set(Object.values(nodes).map(n => n.entityType || "generic"));
    const cur = sel.value;
    sel.innerHTML = '<option value="">All types</option>';
    listEntityTypes().filter(t => present.has(t.id)).forEach(t => {
        const o = document.createElement("option");
        o.value = t.id; o.textContent = t.name;
        sel.appendChild(o);
    });
    sel.value = cur;
}

// ---------- TYPE LEGEND ----------

function renderLegend() {
    const el = document.getElementById("canvas-legend");
    if (!el) return;
    const showLegend = document.getElementById("toggle-legend")?.checked;
    if (!showLegend) { el.classList.add("hidden"); return; }
    const present = {};
    Object.values(nodes).forEach(n => {
        if (!isNodeVisible(n)) return;
        const t = (typeof getEntityType === "function") ? getEntityType(n.entityType) : null;
        if (t && t.id !== "generic" && t.category !== "Shapes") present[t.id] = t;
    });
    const types = Object.values(present);
    if (!types.length) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    el.innerHTML = '<div class="legend-title">Entity types</div>';
    types.forEach(t => {
        const chip = document.createElement("div");
        chip.className = "legend-chip";
        chip.innerHTML = `<span class="legend-swatch" style="background:${t.color}"></span>${t.icon || ""} ${t.name}`;
        el.appendChild(chip);
    });
}

// ---------- DATA-DRIVEN ENCODING ----------

function metricRange(metric) {
    let min = Infinity, max = -Infinity;
    Object.values(nodes).forEach(n => {
        const v = n.metrics && n.metrics[metric];
        if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
    });
    if (min === Infinity) return { min: 0, max: 1 };
    return { min, max };
}

async function applyEncoding() {
    const mode = document.getElementById("encoding-mode")?.value || "none";
    const sizeBy = document.getElementById("encoding-size")?.value || "none";
    const needsMetrics = isMetricMode(mode) || isMetricMode(sizeBy) || mode === "community";
    if (needsMetrics && !Object.values(nodes).some(n => n.metrics)) {
        await runCentrality();
    }
    encoding.mode = mode;
    encoding.sizeByMetric = sizeBy;
    if (isMetricMode(mode)) { const r = metricRange(mode); encoding.min = r.min; encoding.max = r.max; }
    if (isMetricMode(sizeBy)) { const r = metricRange(sizeBy); encoding.sizeMin = r.min; encoding.sizeMax = r.max; }
    render();
}

// ---------- CENTRALITY & COMMUNITIES (client) ----------

function undirectedAdj() {
    const adj = {};
    Object.keys(nodes).forEach(id => { adj[id] = new Set(); });
    edges.forEach(e => {
        if (!nodes[e.source] || !nodes[e.target] || e.source === e.target) return;
        adj[e.source].add(e.target);
        adj[e.target].add(e.source);
    });
    const out = {};
    Object.keys(adj).forEach(id => { out[id] = [...adj[id]]; });
    return out;
}

function computeCentralityClient() {
    const ids = Object.keys(nodes);
    const metrics = {};
    ids.forEach(id => { metrics[id] = { degree: 0, inDegree: 0, outDegree: 0, betweenness: 0, closeness: 0, pagerank: 0 }; });
    // degrees
    edges.forEach(e => {
        if (!metrics[e.source] || !metrics[e.target]) return;
        metrics[e.source].outDegree++; metrics[e.source].degree++;
        metrics[e.target].inDegree++; metrics[e.target].degree++;
    });
    const adj = undirectedAdj();
    // Brandes betweenness + BFS closeness (unweighted, undirected)
    ids.forEach(s => {
        const stack = [];
        const pred = {}; const sigma = {}; const dist = {};
        ids.forEach(t => { pred[t] = []; sigma[t] = 0; dist[t] = -1; });
        sigma[s] = 1; dist[s] = 0;
        const queue = [s];
        let distSum = 0, reach = 0;
        while (queue.length) {
            const v = queue.shift();
            stack.push(v);
            adj[v].forEach(w => {
                if (dist[w] < 0) { dist[w] = dist[v] + 1; queue.push(w); }
                if (dist[w] === dist[v] + 1) { sigma[w] += sigma[v]; pred[w].push(v); }
            });
        }
        ids.forEach(t => { if (t !== s && dist[t] > 0) { distSum += dist[t]; reach++; } });
        if (distSum > 0) {
            // Wasserman-Faust normalization for disconnected graphs
            metrics[s].closeness = (reach / (ids.length - 1 || 1)) * (reach / distSum);
        }
        const delta = {};
        ids.forEach(t => { delta[t] = 0; });
        while (stack.length) {
            const w = stack.pop();
            pred[w].forEach(v => { delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]); });
            if (w !== s) metrics[w].betweenness += delta[w];
        }
    });
    // betweenness undirected: divide by 2
    ids.forEach(id => { metrics[id].betweenness /= 2; });
    // PageRank (power iteration over directed out-links)
    const outAdj = {}; ids.forEach(id => { outAdj[id] = []; });
    edges.forEach(e => {
        if (!outAdj[e.source] || !nodes[e.target]) return;
        outAdj[e.source].push(e.target);
        // Honour the `directed` flag: undirected edges are bidirectional links,
        // matching the server's PageRank adjacency so scores/rankings agree.
        if (!e.directed) outAdj[e.target].push(e.source);
    });
    const N = ids.length || 1;
    let pr = {}; ids.forEach(id => { pr[id] = 1 / N; });
    const d = 0.85;
    for (let iter = 0; iter < 40; iter++) {
        const next = {}; let dangling = 0;
        ids.forEach(id => { next[id] = (1 - d) / N; });
        ids.forEach(id => { if (outAdj[id].length === 0) dangling += pr[id]; });
        ids.forEach(id => {
            const share = outAdj[id].length ? pr[id] / outAdj[id].length : 0;
            outAdj[id].forEach(t => { next[t] += d * share; });
        });
        ids.forEach(id => { next[id] += d * dangling / N; });
        pr = next;
    }
    ids.forEach(id => { metrics[id].pagerank = pr[id]; });
    // Communities via label propagation (undirected)
    const label = {}; ids.forEach((id, i) => { label[id] = i; });
    for (let iter = 0; iter < 20; iter++) {
        let changed = false;
        ids.forEach(id => {
            const counts = {};
            adj[id].forEach(nb => { counts[label[nb]] = (counts[label[nb]] || 0) + 1; });
            let best = label[id], bestCount = -1;
            Object.keys(counts).forEach(l => { if (counts[l] > bestCount) { bestCount = counts[l]; best = parseInt(l, 10); } });
            if (best !== label[id] && bestCount > 0) { label[id] = best; changed = true; }
        });
        if (!changed) break;
    }
    // renumber communities to 0..k
    const remap = {}; let next = 0;
    const communities = {};
    ids.forEach(id => {
        if (remap[label[id]] === undefined) remap[label[id]] = next++;
        communities[id] = remap[label[id]];
    });
    return { metrics, communities };
}

async function runCentrality() {
    let result = null;
    if (Object.keys(nodes).length > ANALYTICS_BACKEND_THRESHOLD) {
        try {
            const res = await fetch("/api/centrality", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ graph: { nodes, edges } })
            });
            if (res.ok) result = await res.json();
        } catch (e) { /* fall back to client */ }
    }
    if (!result) result = computeCentralityClient();
    Object.keys(nodes).forEach(id => {
        if (result.metrics && result.metrics[id]) nodes[id].metrics = result.metrics[id];
        if (result.communities && result.communities[id] != null) nodes[id].community = result.communities[id];
    });
    renderRankTable();
}

function renderRankTable() {
    const wrap = document.getElementById("rank-table-wrap");
    if (!wrap) return;
    const metric = document.getElementById("rank-metric")?.value || "degree";
    const rows = Object.values(nodes).filter(n => n.metrics).map(n => ({ n, v: n.metrics[metric] || 0 }));
    if (!rows.length) { wrap.innerHTML = '<small class="muted">Compute centrality to rank entities.</small>'; return; }
    rows.sort((a, b) => b.v - a.v);
    const top = rows.slice(0, 15);
    // Build via DOM (textContent/dataset) rather than an innerHTML string: node
    // labels/values/ids are attacker-controlled (imports, editor) and would
    // otherwise be a stored-XSS sink.
    const table = document.createElement("table");
    table.className = "rank-table";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    ["#", "Entity", metric].forEach(h => { const th = document.createElement("th"); th.textContent = h; htr.appendChild(th); });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    top.forEach((r, i) => {
        const v = metric === "pagerank" || metric === "closeness" ? r.v.toFixed(3) : (metric === "betweenness" ? r.v.toFixed(1) : r.v);
        const tr = document.createElement("tr");
        tr.className = "clickable";
        tr.dataset.node = r.n.id;
        [String(i + 1), (r.n.label || r.n.value || r.n.id), String(v)].forEach(text => {
            const td = document.createElement("td");
            td.textContent = text;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.innerHTML = "";
    wrap.appendChild(table);
    wrap.querySelectorAll("tr.clickable").forEach(tr => {
        tr.addEventListener("click", () => { const id = tr.dataset.node; if (nodes[id]) { selectNode(id); centerOnNode(id); render(); } });
    });
}

function centerOnNode(id) {
    const n = nodes[id]; if (!n) return;
    view.tx = svg.clientWidth / 2 - n.x * view.scale;
    view.ty = svg.clientHeight / 2 - n.y * view.scale;
}

// ---------- PATH NODE PICKERS + NEIGHBORHOOD ----------

function populateNodeDatalist() {
    const dl = document.getElementById("node-options");
    if (!dl) return;
    dl.innerHTML = "";
    Object.values(nodes).forEach(n => {
        const o = document.createElement("option");
        o.value = n.label || n.value || n.id;
        o.label = n.id;
        dl.appendChild(o);
    });
}

function resolveNodeRef(text) {
    if (!text) return null;
    if (nodes[text]) return text;
    const exact = Object.values(nodes).find(n => (n.label || n.value || "") === text);
    if (exact) return exact.id;
    const ci = Object.values(nodes).find(n => (n.label || n.value || n.id).toLowerCase() === text.toLowerCase());
    return ci ? ci.id : text;
}

function selectNeighborhood(startId, hops) {
    if (!nodes[startId]) return;
    const adj = undirectedAdj();
    const seen = new Set([startId]);
    let frontier = [startId];
    for (let h = 0; h < hops; h++) {
        const nextF = [];
        frontier.forEach(id => (adj[id] || []).forEach(nb => { if (!seen.has(nb)) { seen.add(nb); nextF.push(nb); } }));
        frontier = nextF;
    }
    clearSelection();
    seen.forEach(id => { selectedNodes.add(id); selectedNodeId = id; });
    render();
}

// ---------- TRANSFORMS HUB ----------

function renderTransformsHub() {
    const list = document.getElementById("transforms-list");
    if (!list) return;
    if (!availableTransforms.length) { list.innerHTML = '<small class="muted">No transforms available (server offline?).</small>'; return; }
    const sel = selectedNodeId && nodes[selectedNodeId] ? nodes[selectedNodeId] : null;
    list.innerHTML = "";
    availableTransforms.forEach(t => {
        const applies = !sel || !t.inputTypes || !t.inputTypes.length || t.inputTypes.includes(sel.entityType || "generic") || t.inputTypes.includes("*");
        const row = document.createElement("div");
        row.className = "project-row";
        const label = document.createElement("div");
        label.innerHTML = `<b>${t.name}</b><br><small class="muted">${t.description || (t.inputTypes || []).join(", ")}</small>`;
        const btn = document.createElement("button");
        btn.textContent = "Run";
        btn.style.width = "auto";
        btn.disabled = !sel || !applies;
        btn.title = !sel ? "Select a node first" : (applies ? "Run on selected node" : "Not applicable to selected type");
        btn.addEventListener("click", () => { if (sel) runTransformOnNode(sel, t.id); });
        row.appendChild(label);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

// ---------- PROJECTS / AUTH (server persistence) ----------

let currentProjectId = null;
let currentUser = null;
let _serverSaveTimer = null;

function currentGraphPayload() {
    return { nodes, edges, boxes, layers, activeLayerId, layoutSettings };
}

function scheduleServerSave() {
    if (currentProjectId == null) return;
    if (Date.now() < _suppressServerSaveUntil) return; // don't echo a remote update
    if (_serverSaveTimer) clearTimeout(_serverSaveTimer);
    _serverSaveTimer = setTimeout(async () => {
        _serverSaveTimer = null;
        try {
            await fetch(`/api/projects/${currentProjectId}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ graph: currentGraphPayload(), clientId: MY_CLIENT_ID })
            });
        } catch (e) { /* offline */ }
    }, 1500);
}

async function refreshAuth() {
    try {
        const res = await fetch("/api/me");
        if (!res.ok) return;
        const data = await res.json();
        currentUser = data.user;
        const status = document.getElementById("auth-status");
        const inEl = document.getElementById("auth-logged-in");
        const outEl = document.getElementById("auth-logged-out");
        if (currentUser) {
            if (status) status.textContent = "Signed in as " + currentUser.username;
            inEl?.classList.remove("hidden");
            outEl?.classList.add("hidden");
        } else {
            if (status) status.textContent = "Working anonymously";
            inEl?.classList.add("hidden");
            outEl?.classList.remove("hidden");
        }
    } catch (e) { /* server offline */ }
}

async function refreshProjects() {
    const list = document.getElementById("project-list");
    if (!list) return;
    try {
        const res = await fetch("/api/projects");
        if (!res.ok) return;
        const data = await res.json();
        const projects = Array.isArray(data) ? data : (data.projects || []);
        list.innerHTML = "";
        if (!projects.length) { list.innerHTML = '<small class="muted">No saved projects yet.</small>'; return; }
        projects.forEach(p => {
            const row = document.createElement("div");
            row.className = "project-row" + (p.id === currentProjectId ? " active" : "");
            const open = document.createElement("button");
            open.className = "project-open";
            open.textContent = p.name + (p.updated_at ? "  ·  " + String(p.updated_at).slice(0, 16) : "");
            open.addEventListener("click", () => loadProject(p.id));
            const del = document.createElement("button");
            del.textContent = "✕"; del.style.width = "auto";
            del.addEventListener("click", async () => {
                if (!confirm("Delete project '" + p.name + "'?")) return;
                await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
                if (currentProjectId === p.id) currentProjectId = null;
                refreshProjects();
            });
            row.appendChild(open);
            row.appendChild(del);
            list.appendChild(row);
        });
    } catch (e) { list.innerHTML = '<small class="muted">Server offline — projects unavailable.</small>'; }
}

async function saveProject() {
    const nameEl = document.getElementById("project-name");
    const name = (nameEl?.value || "").trim() || "Untitled investigation";
    try {
        if (currentProjectId == null) {
            const res = await fetch("/api/projects", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, graph: currentGraphPayload() })
            });
            if (!res.ok) throw new Error("save failed");
            const data = await res.json();
            currentProjectId = data.id;
            startCollab(currentProjectId);
        } else {
            await fetch(`/api/projects/${currentProjectId}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, graph: currentGraphPayload(), clientId: MY_CLIENT_ID })
            });
        }
        refreshProjects();
        refreshVersions();
    } catch (e) { alert("Could not save project (server offline?)."); }
}

async function loadProject(id) {
    try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        pushUndo();
        _suppressServerSaveUntil = Date.now() + 2500; // opening must not re-PUT/broadcast
        applyGraphPayload(data.graph || {});
        currentProjectId = id;
        startCollab(id);
        const nameEl = document.getElementById("project-name");
        if (nameEl) nameEl.value = data.name || "";
        render();
        refreshProjects();
        refreshVersions();
    } catch (e) { alert("Could not load project."); }
}

async function refreshVersions() {
    const wrap = document.getElementById("version-list");
    if (!wrap || currentProjectId == null) { if (wrap) wrap.innerHTML = ""; return; }
    try {
        const res = await fetch(`/api/projects/${currentProjectId}/versions`);
        if (!res.ok) return;
        const vdata = await res.json();
        const versions = Array.isArray(vdata) ? vdata : (vdata.versions || []);
        if (!versions.length) { wrap.innerHTML = ""; return; }
        wrap.innerHTML = '<div class="entity-category-title">Version history</div>';
        versions.slice(0, 8).forEach(v => {
            const row = document.createElement("div");
            row.className = "project-row";
            const span = document.createElement("span");
            span.textContent = String(v.created_at || "").slice(0, 19);
            const btn = document.createElement("button");
            btn.textContent = "Restore"; btn.style.width = "auto";
            btn.addEventListener("click", async () => {
                const r = await fetch(`/api/projects/${currentProjectId}/versions/${v.id}/restore`, { method: "POST" });
                if (r.ok) { const d = await r.json(); pushUndo(); applyGraphPayload(d.graph || {}); render(); }
            });
            row.appendChild(span);
            row.appendChild(btn);
            wrap.appendChild(row);
        });
    } catch (e) { /* offline */ }
}

// ---------- EXPORT BUILDERS (CSV / GraphML / report) ----------

function csvEscape(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildCSV() {
    const header = "source,target,label,width,weight,directed";
    const rows = edges.map(e => [e.source, e.target, e.label || "", e.width || 2, Number.isFinite(e.weight) ? e.weight : "", !!e.directed].map(csvEscape).join(","));
    return [header].concat(rows).join("\n");
}
function buildGraphML() {
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    let out = '<?xml version="1.0" encoding="UTF-8"?>\n<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n';
    out += '  <key id="label" for="node" attr.name="label" attr.type="string"/>\n';
    out += '  <key id="type" for="node" attr.name="type" attr.type="string"/>\n';
    out += '  <key id="value" for="node" attr.name="value" attr.type="string"/>\n';
    out += '  <key id="color" for="node" attr.name="color" attr.type="string"/>\n';
    out += '  <key id="x" for="node" attr.name="x" attr.type="double"/>\n  <key id="y" for="node" attr.name="y" attr.type="double"/>\n';
    out += '  <key id="elabel" for="edge" attr.name="label" attr.type="string"/>\n';
    out += '  <key id="ecolor" for="edge" attr.name="color" attr.type="string"/>\n';
    out += '  <key id="ewidth" for="edge" attr.name="width" attr.type="double"/>\n';
    out += '  <key id="eweight" for="edge" attr.name="weight" attr.type="double"/>\n';
    out += '  <graph id="G" edgedefault="directed">\n';
    Object.values(nodes).forEach(n => {
        out += `    <node id="${esc(n.id)}"><data key="label">${esc(n.label || n.value || n.id)}</data><data key="type">${esc(n.entityType || "generic")}</data><data key="value">${esc(n.value || "")}</data><data key="color">${esc(n.color || "")}</data><data key="x">${n.x}</data><data key="y">${n.y}</data></node>\n`;
    });
    edges.forEach((e, i) => {
        const weightData = Number.isFinite(e.weight) ? `<data key="eweight">${e.weight}</data>` : "";
        out += `    <edge id="${esc(e.id || "e" + i)}" source="${esc(e.source)}" target="${esc(e.target)}"${e.directed ? ' directed="true"' : ""}><data key="elabel">${esc(e.label || "")}</data><data key="ecolor">${esc(e.color || "#888888")}</data><data key="ewidth">${Number.isFinite(e.width) ? e.width : 2}</data>${weightData}</edge>\n`;
    });
    out += "  </graph>\n</graphml>\n";
    return out;
}
// Entity-type breakdown: { typeId: count } sorted desc, for reports/summaries.
function entityTypeBreakdown() {
    const counts = {};
    Object.values(nodes).forEach(n => {
        const t = n.entityType || "generic";
        counts[t] = (counts[t] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function buildReportHTML() {
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const stats = computeGraphStats();
    const { svg: svgCopy } = buildExportableSvg({ scope: "content" });
    const svgStr = serializeSvgElement(svgCopy);
    const deg = {};
    Object.keys(nodes).forEach(id => { deg[id] = 0; });
    edges.forEach(e => { if (deg[e.source] != null) deg[e.source]++; if (deg[e.target] != null) deg[e.target]++; });
    const top = Object.values(nodes).sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0)).slice(0, 10);
    const rows = top.map(n => `<tr><td>${esc(n.label || n.value || n.id)}</td><td>${esc((getEntityType && getEntityType(n.entityType)?.name) || n.entityType || "")}</td><td>${deg[n.id] || 0}</td></tr>`).join("");
    const typeName = t => esc((getEntityType && getEntityType(t)?.name) || t);
    const typeRows = entityTypeBreakdown().map(([t, c]) => `<tr><td>${typeName(t)}</td><td>${c}</td></tr>`).join("");
    const fmt = v => (v === null || v === undefined) ? "n/a" : v;
    const generated = new Date().toLocaleString();
    return `<!doctype html><html><head><meta charset="utf-8"><title>Node Mapper Report</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;margin:24px;color:#0f172a;background:#fff}
h1{margin-bottom:4px}h2{margin-top:28px}
.meta{color:#64748b;font-size:13px;margin:0 0 12px}
table{border-collapse:collapse;margin-top:8px}
td,th{border:1px solid #d0d7de;padding:4px 10px;text-align:left}
th{background:#f1f5f9}
svg{max-width:100%;border:1px solid #e2e8f0;border-radius:6px}
@media (prefers-color-scheme:dark){
body{color:#e2e8f0;background:#0f172a}
td,th{border-color:#334155}th{background:#1e293b}
svg{border-color:#334155}.meta{color:#94a3b8}
}
</style></head>
<body><h1>Node Mapper — Investigation Report</h1>
<p class="meta">Generated ${esc(generated)}</p>
<p>Nodes: ${stats.nodeCount} · Edges: ${stats.edgeCount} · Components: ${stats.components} · Avg degree: ${stats.averageDegree} · Max degree: ${stats.maxDegree} · Density: ${stats.density} · Self-loops: ${stats.selfLoops} · Diameter: ${fmt(stats.diameter)} · Avg path: ${fmt(stats.avgPathLength)}</p>
<h2>Graph</h2>${svgStr}
<h2>Top entities by degree</h2><table><thead><tr><th>Entity</th><th>Type</th><th>Degree</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Entity type breakdown</h2><table><thead><tr><th>Type</th><th>Count</th></tr></thead><tbody>${typeRows}</tbody></table>
</body></html>`;
}

// ---------- GRAPHVIZ DOT & MARKDOWN EXPORT ----------

// Graphviz DOT. Node ids are quoted so uuids/special chars are safe. Directed
// edges use `->`; if any edge is undirected the whole graph is emitted as `graph`
// with `--` (DOT can't mix in one file), otherwise `digraph` with `->`.
function buildDot() {
    const q = s => '"' + String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    const anyUndirected = edges.some(e => !e.directed);
    const directed = !anyUndirected;
    const op = directed ? "->" : "--";
    const lines = [];
    lines.push((directed ? "digraph" : "graph") + " G {");
    lines.push("  node [style=filled];");
    Object.values(nodes).forEach(n => {
        const label = n.label || n.value || n.id;
        const attrs = [`label=${q(label)}`];
        if (n.color) attrs.push(`fillcolor=${q(n.color)}`);
        lines.push(`  ${q(n.id)} [${attrs.join(", ")}];`);
    });
    edges.forEach(e => {
        const attrs = [];
        if (e.label) attrs.push(`label=${q(e.label)}`);
        if (e.color) attrs.push(`color=${q(e.color)}`);
        const suffix = attrs.length ? ` [${attrs.join(", ")}]` : "";
        lines.push(`  ${q(e.source)} ${op} ${q(e.target)}${suffix};`);
    });
    lines.push("}");
    return lines.join("\n") + "\n";
}

// Minimal Graphviz DOT parser: reads node statements with optional [label=".."]
// and edge statements `A -> B` / `A -- B` with optional [label=".."]. Enough to
// round-trip buildDot and import simple hand-authored graphs.
function parseDot(text) {
    // Strip // and /* */ comments.
    const clean = text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const directedDefault = /\bdigraph\b/.test(clean);
    const body = clean.slice(clean.indexOf("{") + 1, clean.lastIndexOf("}"));
    const stmts = body.split(";").map(s => s.trim()).filter(Boolean);

    const nodesMap = {};
    const parsedEdges = [];
    const idRe = '(?:"((?:[^"\\\\]|\\\\.)*)"|([A-Za-z0-9_.]+))';
    const attrOf = (seg, key) => {
        const m = seg.match(new RegExp(key + '\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^,\\]\\s]+))', "i"));
        return m ? (m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2]) : null;
    };
    const ensureNode = id => {
        if (!nodesMap[id]) nodesMap[id] = { id, label: id };
        return nodesMap[id];
    };
    const edgeRe = new RegExp("^" + idRe + "\\s*(->|--)\\s*" + idRe + "(?:\\s*\\[([^\\]]*)\\])?", "");
    const nodeRe = new RegExp("^" + idRe + "\\s*(?:\\[([^\\]]*)\\])?$", "");

    stmts.forEach((stmt, idx) => {
        // Skip graph-level attribute statements like `node [..]`, `rankdir=LR`.
        if (/^(node|edge|graph)\b/i.test(stmt)) return;
        const em = stmt.match(edgeRe);
        if (em) {
            const src = em[1] !== undefined ? em[1] : em[2];
            const op = em[3];
            const tgt = em[4] !== undefined ? em[4] : em[5];
            const attrSeg = em[6] || "";
            ensureNode(src); ensureNode(tgt);
            const edge = { id: `e${idx}`, source: src, target: tgt, color: "#888888", width: 2, directed: op === "->" ? true : false };
            const label = attrOf(attrSeg, "label");
            if (label) edge.label = label;
            const color = attrOf(attrSeg, "color");
            if (color) edge.color = color;
            parsedEdges.push(edge);
            return;
        }
        const nm = stmt.match(nodeRe);
        if (nm) {
            const id = nm[1] !== undefined ? nm[1] : nm[2];
            if (!id) return;
            const node = ensureNode(id);
            const attrSeg = nm[3] || "";
            const label = attrOf(attrSeg, "label");
            if (label) node.label = label;
            const fill = attrOf(attrSeg, "fillcolor") || attrOf(attrSeg, "color");
            if (fill) node.color = fill;
        }
    });

    const ids = Object.keys(nodesMap);
    if (!ids.length) return null;
    const positions = assignCircularPositions(ids);
    ids.forEach(id => {
        nodesMap[id].x = positions[id].x;
        nodesMap[id].y = positions[id].y;
    });
    return { nodes: nodesMap, edges: parsedEdges, boxes: {} };
}

// Markdown investigation report: summary + top entities + edge list.
function buildMarkdown() {
    const stats = computeGraphStats();
    const fmt = v => (v === null || v === undefined) ? "n/a" : v;
    const deg = {};
    Object.keys(nodes).forEach(id => { deg[id] = 0; });
    edges.forEach(e => { if (deg[e.source] != null) deg[e.source]++; if (deg[e.target] != null) deg[e.target]++; });
    const labelOf = id => (nodes[id] && (nodes[id].label || nodes[id].value)) || id;
    const typeOf = n => (getEntityType && getEntityType(n.entityType)?.name) || n.entityType || "";
    const cell = s => String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
    const top = Object.values(nodes).sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0)).slice(0, 10);

    const out = [];
    out.push("# Node Mapper — Investigation Report");
    out.push("");
    out.push(`_Generated ${new Date().toLocaleString()}_`);
    out.push("");
    out.push("## Summary");
    out.push("");
    out.push("| Metric | Value |");
    out.push("| --- | --- |");
    out.push(`| Nodes | ${stats.nodeCount} |`);
    out.push(`| Edges | ${stats.edgeCount} |`);
    out.push(`| Components | ${stats.components} |`);
    out.push(`| Average degree | ${stats.averageDegree} |`);
    out.push(`| Max degree | ${stats.maxDegree} |`);
    out.push(`| Density | ${stats.density} |`);
    out.push(`| Self-loops | ${stats.selfLoops} |`);
    out.push(`| Diameter | ${fmt(stats.diameter)} |`);
    out.push(`| Avg path length | ${fmt(stats.avgPathLength)} |`);
    out.push("");
    out.push("## Top entities by degree");
    out.push("");
    out.push("| Entity | Type | Degree |");
    out.push("| --- | --- | --- |");
    top.forEach(n => out.push(`| ${cell(n.label || n.value || n.id)} | ${cell(typeOf(n))} | ${deg[n.id] || 0} |`));
    out.push("");
    out.push("## Edges");
    out.push("");
    out.push("| Source | Target | Label | Directed |");
    out.push("| --- | --- | --- | --- |");
    edges.forEach(e => out.push(`| ${cell(labelOf(e.source))} | ${cell(labelOf(e.target))} | ${cell(e.label || "")} | ${e.directed ? "yes" : "no"} |`));
    out.push("");
    return out.join("\n");
}

// ---------- MERGE-ON-IMPORT ----------

function mergeGraphPayload(graph) {
    const idMap = {};
    Object.entries(graph.nodes || {}).forEach(([id, node]) => {
        const newId = genId("n");
        idMap[id] = newId;
        nodes[newId] = normalizeNode({ ...node, id: newId, box: null, layer: activeLayerId });
    });
    (graph.edges || []).forEach(ed => {
        const s = idMap[ed.source] || ed.source;
        const t = idMap[ed.target] || ed.target;
        if (!nodes[s] || !nodes[t]) return;
        if (edges.some(e => e.source === s && e.target === t)) return;
        edges.push({ ...ed, id: genId("e"), source: s, target: t, layer: activeLayerId });
    });
}

// ---------- IN-PLACE LABEL EDIT (double-click) ----------

svg.addEventListener("dblclick", e => {
    const nodeId = e.target.dataset?.nodeId;
    if (!nodeId || !nodes[nodeId]) return;
    if (isLayerLocked(nodes[nodeId].layer)) return;
    const n = nodes[nodeId];
    const input = document.createElement("input");
    input.className = "inline-edit";
    input.value = n.label || n.value || "";
    const rect = svg.getBoundingClientRect();
    const screenX = rect.left + view.tx + n.x * view.scale;
    const screenY = rect.top + view.ty + n.y * view.scale;
    input.style.left = (screenX - 60) + "px";
    input.style.top = (screenY - 10) + "px";
    input.style.width = "120px";
    document.body.appendChild(input);
    input.focus(); input.select();
    let done = false;
    const commit = (save) => {
        if (done) return; done = true;
        if (save) { pushUndo(); n.label = input.value; render(); }
        input.remove();
    };
    input.addEventListener("keydown", ev => {
        if (ev.key === "Enter") commit(true);
        else if (ev.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));
});

// ---------- WIRE NEW CONTROLS ----------

function wireNewControls() {
    // zoom controls
    document.getElementById("zoom-in")?.addEventListener("click", () => zoomAtCenter(1.2));
    document.getElementById("zoom-out")?.addEventListener("click", () => zoomAtCenter(1 / 1.2));
    document.getElementById("zoom-fit")?.addEventListener("click", () => fitToContent());
    document.getElementById("zoom-reset")?.addEventListener("click", () => resetView());

    // palette filter
    document.getElementById("palette-search")?.addEventListener("input", buildEntityPalette);

    // type filter dropdown
    document.getElementById("filter-type")?.addEventListener("change", e => { filterType = e.target.value; render(); });

    // encoding + legend
    document.getElementById("encoding-mode")?.addEventListener("change", applyEncoding);
    document.getElementById("encoding-size")?.addEventListener("change", applyEncoding);
    document.getElementById("toggle-legend")?.addEventListener("change", renderLegend);

    // centrality / community / rank
    document.getElementById("compute-centrality")?.addEventListener("click", async () => { await runCentrality(); });
    document.getElementById("detect-communities")?.addEventListener("click", async () => {
        await runCentrality();
        const sel = document.getElementById("encoding-mode"); if (sel) sel.value = "community";
        applyEncoding();
    });
    document.getElementById("rank-metric")?.addEventListener("change", renderRankTable);

    // path pickers
    document.getElementById("path-start-sel")?.addEventListener("click", () => { if (selectedNodeId) document.getElementById("path-start").value = nodes[selectedNodeId].label || selectedNodeId; });
    document.getElementById("path-end-sel")?.addEventListener("click", () => { if (selectedNodeId) document.getElementById("path-end").value = nodes[selectedNodeId].label || selectedNodeId; });
    document.getElementById("select-neighborhood")?.addEventListener("click", () => {
        const startId = resolveNodeRef((document.getElementById("path-start")?.value || "").trim()) || selectedNodeId;
        const hops = parseInt(document.getElementById("hops-n")?.value || "1", 10);
        if (startId) selectNeighborhood(startId, hops);
    });

    // projects / auth
    document.getElementById("project-save")?.addEventListener("click", saveProject);
    document.getElementById("project-refresh")?.addEventListener("click", () => { refreshProjects(); refreshVersions(); });
    document.getElementById("project-new")?.addEventListener("click", () => {
        pushUndo();
        nodes = {}; edges = []; boxes = {}; layers = normalizeLayers([]); activeLayerId = layers[0].id;
        nodeCounter = edgeCounter = boxCounter = 0;
        currentProjectId = null;
        stopCollab();
        clearSelection(); render(); refreshProjects(); refreshVersions();
    });
    document.getElementById("auth-login")?.addEventListener("click", async () => {
        const username = document.getElementById("auth-username").value.trim();
        const password = document.getElementById("auth-password").value;
        const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
        if (res.ok) { await refreshAuth(); refreshProjects(); } else { alert("Login failed."); }
    });
    document.getElementById("auth-register")?.addEventListener("click", async () => {
        const username = document.getElementById("auth-username").value.trim();
        const password = document.getElementById("auth-password").value;
        const res = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
        if (res.ok) { await refreshAuth(); refreshProjects(); } else { const e = await res.json().catch(() => ({})); alert("Register failed: " + (e.error || res.status)); }
    });
    document.getElementById("auth-logout")?.addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); currentProjectId = null; await refreshAuth(); refreshProjects(); });

    // clipboard interop
    document.getElementById("copy-png")?.addEventListener("click", async () => {
        try {
            const { svg: svgCopy, width, height, background } = buildExportableSvg({ scope: "content" });
            const png = await svgStringToPngBlob(serializeSvgElement(svgCopy), width, height, background, 2);
            if (navigator.clipboard && window.ClipboardItem) {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
                alert("Graph image copied to clipboard.");
            } else { downloadBlob(png, "graph.png"); }
        } catch (e) { alert("Copy failed; downloading instead."); }
    });
    document.getElementById("copy-json")?.addEventListener("click", async () => {
        const ids = new Set(getSelectedNodeIds());
        const sub = ids.size
            ? { nodes: Object.fromEntries([...ids].map(id => [id, nodes[id]])), edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)), boxes: {} }
            : currentGraphPayload();
        try { await navigator.clipboard.writeText(JSON.stringify(sub, null, 2)); alert("Subgraph JSON copied."); }
        catch (e) { alert("Clipboard unavailable."); }
    });

    // minimap drag-to-reposition
    const mm = document.getElementById("minimap-container");
    if (mm) {
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
        const header = mm.querySelector(".minimap-header") || mm;
        header.addEventListener("pointerdown", e => {
            dragging = true; mm.classList.add("dragging");
            sx = e.clientX; sy = e.clientY;
            const r = mm.getBoundingClientRect(); const pr = mm.parentElement.getBoundingClientRect();
            ox = r.left - pr.left; oy = r.top - pr.top;
            mm.style.right = "auto"; mm.style.left = ox + "px"; mm.style.top = oy + "px";
            header.setPointerCapture(e.pointerId);
            e.stopPropagation();
        });
        header.addEventListener("pointermove", e => {
            if (!dragging) return;
            mm.style.left = (ox + e.clientX - sx) + "px";
            mm.style.top = (oy + e.clientY - sy) + "px";
        });
        header.addEventListener("pointerup", e => { dragging = false; mm.classList.remove("dragging"); try { header.releasePointerCapture(e.pointerId); } catch (_) {} });
    }

    // sidebar collapse toggle (added to top bar)
    const topLeft = document.querySelector(".top-left");
    if (topLeft && !document.getElementById("sidebar-collapse")) {
        const btn = document.createElement("button");
        btn.id = "sidebar-collapse"; btn.title = "Toggle sidebar"; btn.textContent = "☰";
        btn.style.cssText = "width:34px;cursor:pointer;border-radius:6px;border:1px solid var(--button-border);background:var(--button-bg);color:var(--button-text)";
        btn.addEventListener("click", () => document.body.classList.toggle("sidebar-collapsed"));
        topLeft.insertBefore(btn, topLeft.firstChild);
    }

    // onboarding
    const onboarding = document.getElementById("onboarding");
    if (onboarding && !localStorage.getItem("onboarding-dismissed-v1")) {
        // shown after initial graph load (see INIT)
    }
    document.getElementById("onboarding-dismiss")?.addEventListener("click", () => {
        document.getElementById("onboarding")?.classList.add("hidden");
        localStorage.setItem("onboarding-dismissed-v1", "1");
    });

    // ARIA for tabs
    document.querySelectorAll(".tab-button").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-button").forEach(b => b.setAttribute("aria-selected", b.classList.contains("active") ? "true" : "false"));
        });
    });
}

function maybeShowOnboarding() {
    const onboarding = document.getElementById("onboarding");
    if (!onboarding) return;
    if (Object.keys(nodes).length === 0 && !localStorage.getItem("onboarding-dismissed-v1")) {
        onboarding.classList.remove("hidden");
    }
}

// ==================================================================
//          ALTERNATE VIEWS, TIMELINE, ALL-PATHS, COLLABORATION
// ==================================================================

function _esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function degreeMap() {
    const deg = {};
    Object.keys(nodes).forEach(id => { deg[id] = 0; });
    edges.forEach(e => { if (deg[e.source] != null) deg[e.source]++; if (deg[e.target] != null) deg[e.target]++; });
    return deg;
}

function setViewMode(mode) {
    viewMode = mode;
    const sel = document.getElementById("view-mode");
    if (sel && sel.value !== mode) sel.value = mode;
    render();
}

// ----- Entity list view -----
function renderListView(container) {
    const deg = degreeMap();
    const rows = Object.values(nodes).filter(isNodeVisible).sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
    let html = `<div class="alt-view-header">Entity list — ${rows.length} entities</div>`;
    html += '<table class="rank-table"><thead><tr><th>Label</th><th>Type</th><th>Value</th><th>Degree</th></tr></thead><tbody>';
    rows.forEach(n => {
        const t = (typeof getEntityType === "function" && getEntityType(n.entityType)) || {};
        html += `<tr class="clickable" data-node="${_esc(n.id)}"><td>${(t.icon || "")} ${_esc(n.label || n.value || n.id)}</td><td>${_esc(t.name || n.entityType || "")}</td><td>${_esc(n.value || "")}</td><td>${deg[n.id] || 0}</td></tr>`;
    });
    html += "</tbody></table>";
    container.innerHTML = html;
    container.querySelectorAll("tr.clickable").forEach(tr => {
        tr.addEventListener("click", () => {
            const id = tr.dataset.node;
            if (nodes[id]) { selectNode(id); setViewMode("graph"); centerOnNode(id); render(); }
        });
    });
}

// ----- Bubble view (nodes sized by degree, packed in a grid) -----
function renderBubbleView() {
    svg.innerHTML = "";
    const theme = getThemeTokens();
    const viewport = document.createElementNS(NS, "g");
    viewport.setAttribute("id", "viewport");
    viewport.setAttribute("transform", `translate(${view.tx},${view.ty}) scale(${view.scale})`);
    svg.appendChild(viewport);
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", -5000); bg.setAttribute("y", -5000); bg.setAttribute("width", 10000); bg.setAttribute("height", 10000);
    bg.setAttribute("fill", "transparent"); bg.setAttribute("pointer-events", "all"); bg.setAttribute("id", "svg-bg");
    viewport.appendChild(bg);

    const deg = degreeMap();
    const list = Object.values(nodes).filter(isNodeVisible).sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
    const maxDeg = Math.max(1, ...list.map(n => deg[n.id] || 0));
    const cols = Math.ceil(Math.sqrt(list.length)) || 1;
    const cell = 150;
    list.forEach((n, i) => {
        const cx = (i % cols) * cell + cell / 2;
        const cy = Math.floor(i / cols) * cell + cell / 2;
        const r = 16 + (deg[n.id] || 0) / maxDeg * 46;
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
        c.setAttribute("fill", getNodeFill(n));
        c.setAttribute("stroke", isNodeSelected(n.id) ? "#ff9900" : theme.nodeStroke);
        c.setAttribute("stroke-width", isNodeSelected(n.id) ? 3 : 1);
        c.dataset.nodeId = n.id;
        viewport.appendChild(c);
        const t = document.createElementNS(NS, "text");
        t.textContent = n.label || n.value || n.id;
        t.setAttribute("x", cx); t.setAttribute("y", cy + r + 13);
        t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "11");
        t.setAttribute("class", "node-label"); t.dataset.nodeId = n.id;
        viewport.appendChild(t);
    });
}

// ----- Geographic map view (equirectangular projection, no tiles) -----
function renderMapView() {
    svg.innerHTML = "";
    const theme = getThemeTokens();
    const viewport = document.createElementNS(NS, "g");
    viewport.setAttribute("id", "viewport");
    viewport.setAttribute("transform", `translate(${view.tx},${view.ty}) scale(${view.scale})`);
    svg.appendChild(viewport);
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", -5000); bg.setAttribute("y", -5000); bg.setAttribute("width", 10000); bg.setAttribute("height", 10000);
    bg.setAttribute("fill", "transparent"); bg.setAttribute("pointer-events", "all"); bg.setAttribute("id", "svg-bg");
    viewport.appendChild(bg);

    const W = 1600, H = 800;
    const frame = document.createElementNS(NS, "rect");
    frame.setAttribute("x", 0); frame.setAttribute("y", 0); frame.setAttribute("width", W); frame.setAttribute("height", H);
    frame.setAttribute("fill", "none"); frame.setAttribute("stroke", theme.minimapEdge); frame.setAttribute("stroke-width", 1);
    viewport.appendChild(frame);
    for (let lng = -180; lng <= 180; lng += 30) {
        const x = (lng + 180) / 360 * W;
        const ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", x); ln.setAttribute("y1", 0); ln.setAttribute("x2", x); ln.setAttribute("y2", H);
        ln.setAttribute("stroke", theme.minimapEdge); ln.setAttribute("stroke-width", 0.5); ln.setAttribute("opacity", 0.5);
        viewport.appendChild(ln);
    }
    for (let lat = -90; lat <= 90; lat += 30) {
        const y = (90 - lat) / 180 * H;
        const ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", 0); ln.setAttribute("y1", y); ln.setAttribute("x2", W); ln.setAttribute("y2", y);
        ln.setAttribute("stroke", theme.minimapEdge); ln.setAttribute("stroke-width", 0.5); ln.setAttribute("opacity", 0.5);
        viewport.appendChild(ln);
    }
    const proj = (lat, lng) => ({ x: (lng + 180) / 360 * W, y: (90 - lat) / 180 * H });
    const located = {};
    Object.values(nodes).forEach(n => {
        if (!isNodeVisible(n)) return;
        const lat = parseFloat((n.properties || {}).lat);
        const lng = parseFloat((n.properties || {}).lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) located[n.id] = proj(lat, lng);
    });
    edges.forEach(e => {
        if (located[e.source] && located[e.target]) {
            const ln = document.createElementNS(NS, "line");
            ln.setAttribute("x1", located[e.source].x); ln.setAttribute("y1", located[e.source].y);
            ln.setAttribute("x2", located[e.target].x); ln.setAttribute("y2", located[e.target].y);
            ln.setAttribute("stroke", theme.edgeDefault); ln.setAttribute("stroke-width", 1);
            viewport.appendChild(ln);
        }
    });
    Object.keys(located).forEach(id => {
        const n = nodes[id]; const p = located[id];
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); c.setAttribute("r", 8);
        c.setAttribute("fill", getNodeFill(n)); c.setAttribute("stroke", theme.nodeStroke); c.dataset.nodeId = id;
        viewport.appendChild(c);
        const t = document.createElementNS(NS, "text");
        t.textContent = n.label || n.value || id;
        t.setAttribute("x", p.x); t.setAttribute("y", p.y - 12);
        t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "11"); t.setAttribute("class", "node-label");
        viewport.appendChild(t);
    });
    if (!Object.keys(located).length) {
        const t = document.createElementNS(NS, "text");
        t.textContent = "No located entities — add lat/lng properties (e.g. on Location entities).";
        t.setAttribute("x", W / 2); t.setAttribute("y", H / 2); t.setAttribute("text-anchor", "middle");
        t.setAttribute("font-size", "20"); t.setAttribute("fill", theme.minimapNode);
        viewport.appendChild(t);
    }
}

// ----- Canvas 2D renderer with viewport culling + level-of-detail -----
function renderCanvasView(canvas) {
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cs = getComputedStyle(document.body);
    const bg = (cs.getPropertyValue("--canvas-bg") || "#f0f0f0").trim();
    const edgeCol = (cs.getPropertyValue("--edge-default") || "#888").trim();
    const labelCol = (cs.getPropertyValue("--node-label") || "#0f172a").trim();
    const strokeCol = (cs.getPropertyValue("--node-stroke") || "#1f2937").trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    // visible world rect (with margin) for culling
    const wl = (0 - view.tx) / view.scale, wt = (0 - view.ty) / view.scale;
    const wr = (w - view.tx) / view.scale, wb = (h - view.ty) / view.scale;
    const m = 120;
    const vis = id => {
        const n = nodes[id]; if (!n || !isNodeVisible(n)) return false;
        return n.x >= wl - m && n.x <= wr + m && n.y >= wt - m && n.y <= wb + m;
    };
    ctx.lineWidth = 1;
    ctx.strokeStyle = edgeCol;
    edges.forEach(e => {
        const s = nodes[e.source], t = nodes[e.target];
        if (!s || !t) return;
        if (!isNodeVisible(s) || !isNodeVisible(t)) return;
        if (!vis(e.source) && !vis(e.target)) return;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    });
    const showLabels = view.scale > 0.5; // LOD
    Object.values(nodes).forEach(n => {
        if (!vis(n.id)) return;
        const { radius } = getNodeDimensions(n);
        ctx.beginPath();
        ctx.fillStyle = getNodeFill(n);
        ctx.arc(n.x, n.y, Math.max(4, radius), 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = isNodeSelected(n.id) ? 3 : 1;
        ctx.strokeStyle = isNodeSelected(n.id) ? "#ff9900" : strokeCol;
        ctx.stroke();
        if (showLabels) {
            ctx.fillStyle = labelCol;
            ctx.font = "12px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(n.label || n.value || n.id, n.x, n.y + radius + 14);
        }
    });
}

function canvasToWorld(canvas, clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - view.tx) / view.scale, y: (clientY - r.top - view.ty) / view.scale };
}
function hitTestNodeAt(wx, wy) {
    let best = null, bestD = Infinity;
    Object.values(nodes).forEach(n => {
        if (!isNodeVisible(n)) return;
        const { radius } = getNodeDimensions(n);
        const d = Math.hypot(n.x - wx, n.y - wy);
        if (d <= Math.max(8, radius) && d < bestD) { bestD = d; best = n.id; }
    });
    return best;
}

// Canvas-mode pointer handling (pan / zoom / select + drag)
function wireCanvasInteractions() {
    const canvas = document.getElementById("graphCanvasGl");
    if (!canvas || canvas.dataset.wired) return;
    canvas.dataset.wired = "1";
    let cPan = false, cPanStart = null, cViewStart = null, cDrag = null;
    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        const factor = (-e.deltaY) > 0 ? 1.1 : 0.9;
        const target = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
        const eff = target / view.scale; if (eff === 1) return;
        const wp = canvasToWorld(canvas, e.clientX, e.clientY);
        view.tx = (view.tx - wp.x * view.scale) * eff + wp.x * (view.scale * eff);
        view.ty = (view.ty - wp.y * view.scale) * eff + wp.y * (view.scale * eff);
        view.scale *= eff;
        render();
    }, { passive: false });
    canvas.addEventListener("pointerdown", e => {
        const wp = canvasToWorld(canvas, e.clientX, e.clientY);
        const hit = hitTestNodeAt(wp.x, wp.y);
        if (hit) {
            selectNode(hit, { additive: e.shiftKey });
            cDrag = hit; dragGroupStart = {}; dragUndoPushed = false;
            getSelectedNodeIds().forEach(id => { if (nodes[id]) dragGroupStart[id] = { x: nodes[id].x, y: nodes[id].y }; });
            dragAnchorStart = { x: nodes[hit].x, y: nodes[hit].y };
            dragOffset = { x: wp.x - nodes[hit].x, y: wp.y - nodes[hit].y };
        } else {
            clearSelection();
            cPan = true; cPanStart = { x: e.clientX, y: e.clientY }; cViewStart = { tx: view.tx, ty: view.ty };
        }
        canvas.setPointerCapture(e.pointerId);
        render();
    });
    canvas.addEventListener("pointermove", e => {
        if (cDrag) {
            const wp = canvasToWorld(canvas, e.clientX, e.clientY);
            if (!dragUndoPushed) { pushUndo(); dragUndoPushed = true; }
            const ax = wp.x - dragOffset.x, ay = wp.y - dragOffset.y;
            const dx = ax - dragAnchorStart.x, dy = ay - dragAnchorStart.y;
            Object.keys(dragGroupStart).forEach(id => { if (nodes[id]) { nodes[id].x = dragGroupStart[id].x + dx; nodes[id].y = dragGroupStart[id].y + dy; } });
            render();
        } else if (cPan) {
            view.tx = cViewStart.tx + (e.clientX - cPanStart.x);
            view.ty = cViewStart.ty + (e.clientY - cPanStart.y);
            render();
        }
    });
    canvas.addEventListener("pointerup", e => {
        if (cDrag) Object.keys(dragGroupStart).forEach(id => updateNodeBoxMembership(id));
        cDrag = null; cPan = false; dragGroupStart = {};
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener("contextmenu", e => {
        e.preventDefault();
        const wp = canvasToWorld(canvas, e.clientX, e.clientY);
        const hit = hitTestNodeAt(wp.x, wp.y);
        if (hit) { selectNode(hit); render(); }
    });
}

// ----- All paths up to length k (bounded DFS) -----
function allPathsUpToK(start, goal, k) {
    const adj = buildAdjacency({ directed: false, weighted: false });
    const nodeSet = new Set(), edgeSet = new Set();
    let count = 0;
    const path = [start], epath = [], visited = new Set([start]);
    (function dfs(u) {
        if (count >= 300) return;
        if (u === goal) {
            count++;
            path.forEach(n => nodeSet.add(n));
            epath.forEach(id => edgeSet.add(id));
            return;
        }
        if (epath.length >= k) return;
        (adj[u] || []).forEach(({ to, id }) => {
            if (!visited.has(to)) {
                visited.add(to); path.push(to); epath.push(id);
                dfs(to);
                epath.pop(); path.pop(); visited.delete(to);
            }
        });
    })(start);
    return { nodeSet, edgeSet, count };
}

function runAllPaths() {
    const startId = resolveNodeRef((document.getElementById("path-start")?.value || "").trim());
    const endId = resolveNodeRef((document.getElementById("path-end")?.value || "").trim());
    const k = Math.max(1, Math.min(6, parseInt(document.getElementById("allpaths-k")?.value || "4", 10)));
    const resEl = document.getElementById("analytics-path-result");
    if (!startId || !endId || !nodes[startId] || !nodes[endId]) {
        if (resEl) resEl.innerHTML = '<div class="error-text">Pick a valid start and target entity.</div>';
        return;
    }
    const { nodeSet, edgeSet, count } = allPathsUpToK(startId, endId, k);
    pathHighlights.nodes = nodeSet;
    pathHighlights.edges = edgeSet;
    render();
    if (resEl) resEl.innerHTML = `<div><strong>All paths ≤ ${k}:</strong> ${count} path(s)</div><div><strong>Entities on paths:</strong> ${nodeSet.size}</div>`;
}

// ----- Timeline -----
function timeExtent() {
    let min = Infinity, max = -Infinity;
    Object.values(nodes).forEach(n => {
        const t = nodeTime(n);
        if (t != null) { min = Math.min(min, t); max = Math.max(max, t); }
    });
    if (min === Infinity) return null;
    if (min === max) max = min + 1;
    return { min, max };
}
function updateTimeline() {
    const bar = document.getElementById("timeline");
    const range = document.getElementById("timeline-range");
    const readout = document.getElementById("timeline-readout");
    if (!bar || !range) return;
    const show = document.getElementById("toggle-timeline")?.checked;
    if (!show) { bar.classList.add("hidden"); timeFilter.active = false; return; }
    const ext = timeExtent();
    if (!ext) { bar.classList.add("hidden"); timeFilter.active = false; if (readout) readout.textContent = "no dated entities"; return; }
    bar.classList.remove("hidden");
    timeFilter.active = true;
    timeFilter.min = ext.min;
    const frac = parseInt(range.value, 10) / 100;
    timeFilter.max = ext.min + (ext.max - ext.min) * frac;
    if (readout) readout.textContent = "≤ " + new Date(timeFilter.max).toISOString().slice(0, 10);
}

// ----- Real-time collaboration (SSE) -----
const MY_CLIENT_ID = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(performance.now()) + "-c";
let _collabSource = null;
let _suppressServerSaveUntil = 0;

function startCollab(projectId) {
    stopCollab();
    if (typeof EventSource === "undefined" || projectId == null) return;
    try {
        _collabSource = new EventSource(`/api/projects/${projectId}/stream`);
        _collabSource.onmessage = ev => {
            let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
            if (d.type === "presence") updatePresence(d.count);
            else if (d.type === "updated" && d.clientId !== MY_CLIENT_ID) reloadCollabGraph(projectId);
        };
        _collabSource.onerror = () => { /* browser auto-reconnects */ };
    } catch (e) { /* unsupported */ }
}
function stopCollab() {
    if (_collabSource) { try { _collabSource.close(); } catch (e) {} _collabSource = null; }
    updatePresence(0);
}
async function reloadCollabGraph(id) {
    try {
        const r = await fetch(`/api/projects/${id}`);
        if (!r.ok) return;
        const d = await r.json();
        _suppressServerSaveUntil = Date.now() + 3000; // don't echo back
        applyGraphPayload(d.graph || {});
        render();
        showCollabToast("Synced changes from a collaborator");
    } catch (e) { /* offline */ }
}
function updatePresence(count) {
    const el = document.getElementById("presence-indicator");
    if (!el) return;
    if (count > 1) { el.style.display = "inline-flex"; el.textContent = "👥 " + count; }
    else el.style.display = "none";
}
let _toastTimer = null;
function showCollabToast(msg) {
    const el = document.getElementById("collab-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.add("hidden"), 2500);
}

// ----- Wire the deferred controls -----
function wireDeferredControls() {
    document.getElementById("view-mode")?.addEventListener("change", e => setViewMode(e.target.value));
    document.getElementById("toggle-timeline")?.addEventListener("change", () => { updateTimeline(); render(); });
    document.getElementById("timeline-range")?.addEventListener("input", () => { updateTimeline(); render(); });
    document.getElementById("find-all-paths")?.addEventListener("click", runAllPaths);
    wireCanvasInteractions();
}

// ---------- INIT ----------

syncLayoutControlsFromSettings();
syncSnapControlsFromSettings();
initTheme();
updateAutosaveInfo();
renderAnalyticsPanel();
buildEntityPalette();
wireNewControls();
wireDeferredControls();
refreshAuth();
refreshProjects();
loadTransforms();
loadGraphFromBackend().then(() => {
    populateFilterTypes();
    populateNodeDatalist();
    maybeShowOnboarding();
});
