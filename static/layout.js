// layout.js
// Modular layout engines with basic overlap avoidance.
// Exposes Layout.apply(type, state, options?)

(function (global) {
    const NS = "http://www.w3.org/2000/svg";

    /**
     * state: {
     *   nodes: { [id]: { id, x, y, box?: string } },
     *   edges: [ { source, target, ... } ],
     *   boxes: { [id]: { id, x, y, width, height, nodes: [nodeId...] } },
     *   view: { scale, tx, ty }
     * }
     */

    function apply(type, state, options = {}) {
        switch (type) {
            case "grid":
                gridLayout(state, options);
                break;
            case "circle":
                circleLayout(state, options);
                break;
            case "hierarchical":
                hierarchicalLayout(state, options);
                break;
            case "force":
                forceLayout(state, options);
                break;
            case "weightedTree":
                weightedTreeLayout(state, options);
                break;
            default:
                console.warn("Unknown layout type:", type);
        }
    }

    // ------------------------
    // Core helpers
    // ------------------------

    function moveBoxAndChildren(state, boxId, newX, newY) {
        const b = state.boxes[boxId];
        if (!b) return;

        const dx = newX - b.x;
        const dy = newY - b.y;

        b.x = newX;
        b.y = newY;

        (b.nodes || []).forEach(nodeId => {
            const n = state.nodes[nodeId];
            if (n) {
                n.x += dx;
                n.y += dy;
            }
        });
    }

    function getBoxIds(state) {
        return Object.keys(state.boxes || {});
    }

    function getUnboxedNodes(state) {
        const res = [];
        for (const id in state.nodes) {
            const n = state.nodes[id];
            if (!n.box) res.push(n);
        }
        return res;
    }

    function computeBoxesBoundingRect(state) {
        const ids = getBoxIds(state);
        if (!ids.length) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        ids.forEach(id => {
            const b = state.boxes[id];
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        });

        return { minX, minY, maxX, maxY };
    }

    function boxesOverlap(a, b, padding) {
        return !(
            a.x + a.width + padding < b.x ||
            b.x + b.width + padding < a.x ||
            a.y + a.height + padding < b.y ||
            b.y + b.height + padding < a.y
        );
    }

    // basic separation pass so boxes don't overlap
    function separateBoxes(state, padding = 40, iterations = 50) {
        const ids = getBoxIds(state);
        if (ids.length < 2) return;

        for (let iter = 0; iter < iterations; iter++) {
            let moved = false;

            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = state.boxes[ids[i]];
                    const b = state.boxes[ids[j]];
                    if (!a || !b) continue;

                    if (!boxesOverlap(a, b, padding)) continue;

                    const acx = a.x + a.width / 2;
                    const acy = a.y + a.height / 2;
                    const bcx = b.x + b.width / 2;
                    const bcy = b.y + b.height / 2;

                    let dx = acx - bcx;
                    let dy = acy - bcy;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                    dx /= dist;
                    dy /= dist;

                    const push = padding;

                    // push each half way
                    moveBoxAndChildren(state, a.id, a.x + dx * push * 0.5, a.y + dy * push * 0.5);
                    moveBoxAndChildren(state, b.id, b.x - dx * push * 0.5, b.y - dy * push * 0.5);

                    moved = true;
                }
            }

            if (!moved) break;
        }
    }

    // ------------------------
    // GRID LAYOUT
    // ------------------------

    function gridLayout(state, options = {}) {
        const boxIds = getBoxIds(state);
        const unboxed = getUnboxedNodes(state);

        const boxCols = Math.ceil(Math.sqrt(boxIds.length || 1));
        const boxHMargin = options.boxHMargin || 400;
        const boxVMargin = options.boxVMargin || 280;
        const startX = options.boxStartX || 100;
        const startY = options.boxStartY || 100;

        // 1. arrange boxes in a grid
        boxIds.forEach((id, i) => {
            const row = Math.floor(i / boxCols);
            const col = i % boxCols;
            const nx = startX + col * boxHMargin;
            const ny = startY + row * boxVMargin;
            moveBoxAndChildren(state, id, nx, ny);
        });

        // resolve overlaps between boxes
        separateBoxes(state, options.separationPadding || 40, options.separationIterations || 50);

        // 2. layout unboxed nodes in a grid below all boxes
        if (unboxed.length > 0) {
            const rect = computeBoxesBoundingRect(state);
            const topY = rect ? rect.maxY + 80 : 200;
            const nodeCols = Math.ceil(Math.sqrt(unboxed.length));
            const nodeHMargin = options.nodeHMargin || 150;
            const nodeVMargin = options.nodeVMargin || 150;

            unboxed.forEach((n, i) => {
                const row = Math.floor(i / nodeCols);
                const col = i % nodeCols;
                n.x = startX + col * nodeHMargin;
                n.y = topY + row * nodeVMargin;
            });
        }
    }

    // ------------------------
    // CIRCLE LAYOUT
    // ------------------------

    function circleLayout(state, options = {}) {
        const boxIds = getBoxIds(state);
        const unboxed = getUnboxedNodes(state);

        const view = state.view || { scale: 1, tx: 0, ty: 0 };
        const cx = (options.cx != null)
            ? options.cx
            : (window.innerWidth || 1200) / view.scale / 2 - view.tx / view.scale;
        const cy = (options.cy != null)
            ? options.cy
            : (window.innerHeight || 800) / view.scale / 2 - view.ty / view.scale;

        // 1. boxes on outer circle
        if (boxIds.length > 0) {
            const count = boxIds.length;
            const outerRadius = options.outerRadius || 600;

            boxIds.forEach((id, i) => {
                const b = state.boxes[id];
                const angle = (i / count) * Math.PI * 2;
                const nx = cx + Math.cos(angle) * outerRadius - b.width / 2;
                const ny = cy + Math.sin(angle) * outerRadius - b.height / 2;
                moveBoxAndChildren(state, id, nx, ny);
            });

            separateBoxes(state, options.separationPadding || 40, options.separationIterations || 50);
        }

        // 2. unboxed nodes on inner circle
        if (unboxed.length > 0) {
            const count = unboxed.length;
            const innerRadius = options.innerRadius || 350;

            unboxed.forEach((n, i) => {
                const angle = (i / count) * Math.PI * 2;
                n.x = cx + Math.cos(angle) * innerRadius;
                n.y = cy + Math.sin(angle) * innerRadius;
            });
        }
    }

    // ------------------------
    // HIERARCHICAL LAYOUT (simple BFS-levels for unboxed nodes)
    // ------------------------

    function hierarchicalLayout(state, options = {}) {
        const boxIds = getBoxIds(state);
        const unboxed = getUnboxedNodes(state);

        // 1. Place boxes in a simple grid at top
        if (boxIds.length > 0) {
            const cols = Math.ceil(Math.sqrt(boxIds.length));
            const hMargin = options.boxHMargin || 400;
            const vMargin = options.boxVMargin || 260;
            const startX = options.boxStartX || 150;
            const startY = options.boxStartY || 80;

            boxIds.forEach((id, i) => {
                const row = Math.floor(i / cols);
                const col = i % cols;
                moveBoxAndChildren(
                    state,
                    id,
                    startX + col * hMargin,
                    startY + row * vMargin
                );
            });

            separateBoxes(state, options.separationPadding || 40, options.separationIterations || 50);
        }

        // 2. BFS layers for unboxed nodes beneath boxes
        if (unboxed.length > 0) {
            const idSet = new Set(unboxed.map(n => n.id));

            // Initialize levels
            const levelOf = {};
            unboxed.forEach(n => { levelOf[n.id] = 0; });

            let queue = unboxed.map(n => n.id);

            while (queue.length) {
                const id = queue.shift();
                state.edges.forEach(edge => {
                    if (!idSet.has(edge.source) || !idSet.has(edge.target)) return;

                    if (edge.source === id && levelOf[edge.target] <= levelOf[id]) {
                        levelOf[edge.target] = levelOf[id] + 1;
                        queue.push(edge.target);
                    }
                });
            }

            // group by level
            const groups = {};
            Object.keys(levelOf).forEach(id => {
                const lvl = levelOf[id];
                if (!groups[lvl]) groups[lvl] = [];
                groups[lvl].push(id);
            });

            const rect = computeBoxesBoundingRect(state);
            const baseY = rect ? rect.maxY + 120 : (options.nodeStartY || 200);
            const spacingX = options.nodeHMargin || 180;
            const spacingY = options.nodeVMargin || 120;
            const startX = options.nodeStartX || 150;

            Object.keys(groups).forEach(levelStr => {
                const lvl = parseInt(levelStr, 10);
                const arr = groups[lvl];
                arr.forEach((id, i) => {
                    const n = state.nodes[id];
                    n.x = startX + i * spacingX;
                    n.y = baseY + lvl * spacingY;
                });
            });
        }
    }

    // ------------------------
    // FORCE LAYOUT (very simple, boxes + unboxed nodes)
    // ------------------------

    function forceLayout(state, options = {}) {
        const boxIds = getBoxIds(state);
        const unboxed = getUnboxedNodes(state);

        const iterations = options.iterations || 150;

        // Build force "bodies": boxes + unboxed nodes
        const bodies = [];

        boxIds.forEach(id => {
            const b = state.boxes[id];
            bodies.push({
                type: "box",
                id,
                get x() { return b.x + b.width / 2; },
                get y() { return b.y + b.height / 2; },
                set x(val) {
                    moveBoxAndChildren(state, id, val - b.width / 2, b.y);
                },
                set y(val) {
                    moveBoxAndChildren(state, id, b.x, val - b.height / 2);
                },
                radius: Math.max(b.width, b.height) / 2
            });
        });

        unboxed.forEach(n => {
            bodies.push({
                type: "node",
                id: n.id,
                get x() { return n.x; },
                get y() { return n.y; },
                set x(val) { n.x = val; },
                set y(val) { n.y = val; },
                radius: (n.size || 25) * 2
            });
        });

        if (bodies.length === 0) return;

        const bodyIndex = {};
        bodies.forEach((b, i) => { bodyIndex[b.id] = i; });

        // repulsion + springs along edges (only for unboxed nodes)
        for (let iter = 0; iter < iterations; iter++) {
            // Repulsion between all
            for (let i = 0; i < bodies.length; i++) {
                for (let j = i + 1; j < bodies.length; j++) {
                    const a = bodies[i];
                    const b = bodies[j];
                    let dx = a.x - b.x;
                    let dy = a.y - b.y;
                    let dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
                    const minDist = (a.radius + b.radius) * 0.75;
                    if (dist < 1) dist = 1;

                    const force = (options.repulsion || 20000) / (dist * dist);

                    dx /= dist;
                    dy /= dist;

                    a.x += dx * force * 0.01;
                    a.y += dy * force * 0.01;
                    b.x -= dx * force * 0.01;
                    b.y -= dy * force * 0.01;

                    // Slight extra push if very close
                    if (dist < minDist) {
                        const extra = (minDist - dist) * 0.05;
                        a.x += dx * extra;
                        a.y += dy * extra;
                        b.x -= dx * extra;
                        b.y -= dy * extra;
                    }
                }
            }

            // Springs only for edges connecting unboxed nodes
            state.edges.forEach(edge => {
                const aNode = state.nodes[edge.source];
                const bNode = state.nodes[edge.target];
                if (!aNode || !bNode) return;
                if (aNode.box || bNode.box) return; // ignore boxed children

                const ia = bodyIndex[edge.source];
                const ib = bodyIndex[edge.target];
                if (ia == null || ib == null) return;

                const a = bodies[ia];
                const b = bodies[ib];

                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
                const ideal = options.idealEdgeLength || 220;
                const force = (dist - ideal) * 0.02;

                dx /= dist;
                dy /= dist;

                a.x += dx * force;
                a.y += dy * force;
                b.x -= dx * force;
                b.y -= dy * force;
            });
        }

        // After forces, a quick separation pass for boxes to avoid lingering overlaps
        separateBoxes(state, options.separationPadding || 40, options.separationIterations || 30);
    }

    // ------------------------
    // WEIGHTED TREE LAYOUT
    // ------------------------

    function weightedTreeLayout(state, options = {}) {
        const boxIds = Object.keys(state.boxes);
        const unboxed = Object.values(state.nodes).filter(n => !n.box);

        // 1. Layout boxes at top (same as before)
        if (boxIds.length > 0) {
            const cols = Math.ceil(Math.sqrt(boxIds.length));
            let i = 0;
            const startX = options.boxStartX || 100;
            const startY = options.boxStartY || 100;
            const hMargin = options.boxHMargin || 400;
            const vMargin = options.boxVMargin || 260;

            boxIds.forEach(id => {
                const row = Math.floor(i / cols);
                const col = i % cols;
                moveBoxAndChildren(state, id, startX + col * hMargin, startY + row * vMargin);
                i++;
            });

            separateBoxes(state, 40, 30);
        }

        const boxRect = computeBoxesBoundingRect(state);
        const topY = boxRect ? boxRect.maxY + 200 : 200;

        if (!unboxed.length) return;

        // degree calculation
        const degree = {};
        unboxed.forEach(n => (degree[n.id] = 0));
        state.edges.forEach(edge => {
            if (degree[edge.source] != null) degree[edge.source]++;
            if (degree[edge.target] != null) degree[edge.target]++;
        });

        // sort by degree
        const sorted = [...unboxed].sort((a, b) => degree[a.id] - degree[b.id]);

        // tiering
        const tierCount = options.tiers || 4;
        const maxDeg = Math.max(...sorted.map(n => degree[n.id]));
        const minDeg = Math.min(...sorted.map(n => degree[n.id]));
        const range = maxDeg - minDeg || 1;

        const tiers = Array.from({ length: tierCount }, () => []);

        sorted.forEach(n => {
            const norm = (degree[n.id] - minDeg) / range;
            const tier = Math.floor(norm * (tierCount - 1));
            tiers[tier].push(n);
        });

        // helper to compute adjacency between nodes and previous tier
        function getUpperAdjacency(tierNodes, upperNodes) {
            const setUpper = new Set(upperNodes.map(n => n.id));
            const adj = {};

            tierNodes.forEach(n => {
                adj[n.id] = [];
                state.edges.forEach(edge => {
                    if (edge.source === n.id && setUpper.has(edge.target)) adj[n.id].push(edge.target);
                    if (edge.target === n.id && setUpper.has(edge.source)) adj[n.id].push(edge.source);
                });
            });

            return adj;
        }

        // horizontal spreading for a single tier
        function spreadTier(tierNodes, upperNodes, y, baseX, spacing) {
            if (tierNodes.length === 0) return;

            const adj = upperNodes.length ? getUpperAdjacency(tierNodes, upperNodes) : null;

            let weighted = tierNodes.map(n => {
                let targetX = 0;

                if (adj && adj[n.id] && adj[n.id].length) {
                    // compute median or average X of parent tier
                    const xs = adj[n.id].map(id => state.nodes[id].x);
                    xs.sort((a, b) => a - b);
                    targetX = xs[Math.floor(xs.length / 2)];
                } else {
                    targetX = baseX;
                }

                return { node: n, targetX };
            });

            weighted.sort((a, b) => a.targetX - b.targetX);

            weighted.forEach((entry, i) => {
                entry.node.x = baseX + i * spacing;
                entry.node.y = y;
            });
        }

        const tierSpacing = options.tierSpacing || 180;
        const nodeSpacing = options.nodeSpacing || 150;
        const baseX = options.nodeStartX || 200;

        // 8. Place tiers using X-spreading
        for (let t = 0; t < tiers.length; t++) {
            const tierNodes = tiers[t];
            const upperNodes = t > 0 ? tiers[t - 1] : [];

            const y = topY + t * tierSpacing;

            spreadTier(tierNodes, upperNodes, y, baseX, nodeSpacing);
        }
    }



    // ------------------------
    // Export API
    // ------------------------

    const Layout = {
        apply,
        grid: gridLayout,
        circle: circleLayout,
        hierarchical: hierarchicalLayout,
        force: forceLayout
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = Layout;
    } else {
        global.Layout = Layout;
    }

})(this);
