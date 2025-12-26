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

// ---------- UTILITIES ----------

function snapshot() {
    return JSON.stringify({ nodes, edges, boxes });
}

function restoreFromSnapshot(json) {
    const data = JSON.parse(json);
    nodes = data.nodes || {};
    edges = data.edges || [];
    boxes = data.boxes || {};
}

function pushUndo() {
    undoStack.push(snapshot());
    redoStack.length = 0;
}

function screenToWorld(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const x = (clientX - rect.left - view.tx) / view.scale;
    const y = (clientY - rect.top - view.ty) / view.scale;
    return { x, y };
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
        graph: { nodes, edges, boxes }
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

        nodeCounter = Object.keys(nodes).length;
        edgeCounter = edges.length;
        boxCounter = Object.keys(boxes).length;

        selectedNodeId = null;
        selectedEdgeId = null;
        selectedBoxId = null;
        undoStack.length = 0;
        redoStack.length = 0;

        render();
    } catch (e) {
        console.warn("Could not load /graph, starting empty:", e);
        nodes = {};
        edges = [];
        boxes = {};
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
    const graph = { nodes, edges, boxes };
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

        nodeCounter = Object.keys(nodes).length;
        edgeCounter = edges.length;
        boxCounter = Object.keys(boxes).length;

        selectedNodeId = null;
        selectedEdgeId = null;
        selectedBoxId = null;
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
        nodes = g.nodes || {};
        edges = g.edges || [];
        boxes = g.boxes || {};
        selectedNodeId = null;
        selectedEdgeId = null;
        selectedBoxId = null;
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

// ---------- LAYOUTS ----------

document.getElementById("apply-layout").addEventListener("click", () => {
    const type = document.getElementById("layout-select").value; // "grid" | "circle" | "hierarchical" | "force"

    pushUndo();

    Layout.apply(type, {
        nodes,
        edges,
        boxes,
        view
    });

    render();
});

// ---------- RENDER ----------

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

        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", src.x);
        line.setAttribute("y1", src.y);
        line.setAttribute("x2", tgt.x);
        line.setAttribute("y2", tgt.y);
        line.setAttribute("stroke", edge.color || "#888");
        line.setAttribute("stroke-width", edge.width || 2);
        line.dataset.edgeId = edge.id;

        if (edge.id === selectedEdgeId) {
            line.setAttribute("stroke", "#ff6600");
        }

        viewport.appendChild(line);

        if (edge.directed) {
            const mx = (src.x + tgt.x) / 2;
            const my = (src.y + tgt.y) / 2;
            const dx = tgt.x - src.x;
            const dy = tgt.y - src.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const size = 8;
            const x1 = mx - ux * size + uy * size * 0.5;
            const y1 = my - uy * size - ux * size * 0.5;
            const x2 = mx - ux * size - uy * size * 0.5;
            const y2 = my - uy * size + ux * size * 0.5;

            const arrow = document.createElementNS(NS, "polygon");
            arrow.setAttribute("points", `${mx},${my} ${x1},${y1} ${x2},${y2}`);
            arrow.setAttribute("fill", edge.color || "#888");
            arrow.dataset.edgeId = edge.id;
            viewport.appendChild(arrow);
        }

        if (edge.label) {
            const mx = (src.x + tgt.x) / 2;
            const my = (src.y + tgt.y) / 2;
            const text = document.createElementNS(NS, "text");
            text.textContent = edge.label;
            text.setAttribute("x", mx);
            text.setAttribute("y", my - 6);
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

        const circle = document.createElementNS(NS, "circle");
        circle.setAttribute("cx", n.x);
        circle.setAttribute("cy", n.y);
        circle.setAttribute("r", r);
        circle.setAttribute("fill", n.color || "#4682b4");
        circle.setAttribute("stroke", n.id === selectedNodeId ? "#ff9900" : "#333");
        circle.setAttribute("stroke-width", n.id === selectedNodeId ? "3" : "1");
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

initTheme();
updateAutosaveInfo();
loadGraphFromBackend();
