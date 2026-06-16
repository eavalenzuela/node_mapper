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

    const defaultOptions = {
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
        force: {
            iterations: 150,
            repulsion: 20000,
            idealEdgeLength: 220,
            separationPadding: 40,
            separationIterations: 30
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
    };

    function mergedOptions(type, overrides = {}) {
        const base = defaultOptions[type] ? { ...defaultOptions[type] } : {};
        return { ...base, ...overrides };
    }

    function apply(type, state, options = {}) {
        const opts = mergedOptions(type, options);
        switch (type) {
            case "grid":
                gridLayout(state, opts);
                break;
            case "circle":
                circleLayout(state, opts);
                break;
            case "hierarchical":
                hierarchicalLayout(state, opts);
                break;
            case "force":
                forceLayout(state, opts);
                break;
            case "weightedTree":
                weightedTreeLayout(state, opts);
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

    // Default radius estimator for a node when no sizeOf callback is supplied.
    // Mirrors the conventions used elsewhere in the app: prefer an explicit
    // `size`, otherwise derive a radius from width/height.
    function defaultNodeRadius(n) {
        if (n.size) return n.size;
        return Math.max(n.width || 60, n.height || 40) / 2;
    }

    // Generic circle-vs-circle overlap avoidance for an arbitrary array of
    // node objects. Pinned nodes act as immovable anchors: other nodes are
    // pushed away from them, but pinned nodes themselves never move.
    //
    // options:
    //   sizeOf(node) -> radius   (optional; defaults to defaultNodeRadius)
    //   padding                  (default 24) extra gap kept between circles
    //   iterations               (default 60) relaxation passes
    function separateNodes(nodes, options = {}) {
        if (!Array.isArray(nodes) || nodes.length < 2) return;

        const sizeOf = typeof options.sizeOf === "function"
            ? options.sizeOf
            : defaultNodeRadius;
        const padding = options.padding ?? 24;
        const iterations = options.iterations ?? 60;

        // Precompute radii once.
        const radii = nodes.map(n => sizeOf(n));

        for (let iter = 0; iter < iterations; iter++) {
            let moved = false;

            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i];
                    const b = nodes[j];

                    const minDist = radii[i] + radii[j] + padding;

                    let dx = a.x - b.x;
                    let dy = a.y - b.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist >= minDist) continue; // no overlap

                    // Avoid divide-by-zero when two nodes are coincident:
                    // nudge along a deterministic direction.
                    if (dist < 1e-6) {
                        dx = (i - j) || 1;
                        dy = 1;
                        dist = Math.sqrt(dx * dx + dy * dy);
                    }

                    const overlap = minDist - dist;
                    const ux = dx / dist;
                    const uy = dy / dist;

                    const aPinned = a.pinned === true;
                    const bPinned = b.pinned === true;

                    if (aPinned && bPinned) {
                        // Both fixed: nothing we can do.
                        continue;
                    } else if (aPinned) {
                        // Only b may move; push it fully away from a.
                        b.x -= ux * overlap;
                        b.y -= uy * overlap;
                    } else if (bPinned) {
                        // Only a may move; push it fully away from b.
                        a.x += ux * overlap;
                        a.y += uy * overlap;
                    } else {
                        // Both free: split the correction evenly.
                        const half = overlap / 2;
                        a.x += ux * half;
                        a.y += uy * half;
                        b.x -= ux * half;
                        b.y -= uy * half;
                    }

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
        const boxHMargin = options.boxHMargin ?? 400;
        const boxVMargin = options.boxVMargin ?? 280;
        const startX = options.boxStartX ?? 100;
        const startY = options.boxStartY ?? 100;

        // 1. arrange boxes in a grid
        boxIds.forEach((id, i) => {
            const row = Math.floor(i / boxCols);
            const col = i % boxCols;
            const nx = startX + col * boxHMargin;
            const ny = startY + row * boxVMargin;
            moveBoxAndChildren(state, id, nx, ny);
        });

        // resolve overlaps between boxes
        separateBoxes(state, options.separationPadding ?? 40, options.separationIterations ?? 50);

        // 2. layout unboxed nodes in a grid below all boxes
        if (unboxed.length > 0) {
            const rect = computeBoxesBoundingRect(state);
            const topY = rect ? rect.maxY + 80 : 200;
            const nodeCols = Math.ceil(Math.sqrt(unboxed.length));
            const nodeHMargin = options.nodeHMargin ?? 150;
            const nodeVMargin = options.nodeVMargin ?? 150;

            unboxed.forEach((n, i) => {
                if (n.pinned === true) return; // never move pinned nodes
                const row = Math.floor(i / nodeCols);
                const col = i % nodeCols;
                n.x = startX + col * nodeHMargin;
                n.y = topY + row * nodeVMargin;
            });

            // resolve residual node-vs-node overlaps
            separateNodes(unboxed, {
                sizeOf: options.sizeOf,
                padding: options.nodeSeparationPadding ?? 24,
                iterations: options.nodeSeparationIterations ?? 60
            });
        }
    }

    // ------------------------
    // CIRCLE LAYOUT
    // ------------------------

    function circleLayout(state, options = {}) {
        const boxIds = getBoxIds(state);
        const unboxed = getUnboxedNodes(state);

        // Deterministic, headless-safe center: explicit cx/cy if given,
        // otherwise the centroid of the current unboxed positions,
        // falling back to the origin when there are no nodes.
        let cx, cy;
        if (options.cx != null && options.cy != null) {
            cx = options.cx;
            cy = options.cy;
        } else if (unboxed.length > 0) {
            let sx = 0, sy = 0;
            unboxed.forEach(n => { sx += n.x; sy += n.y; });
            cx = options.cx != null ? options.cx : sx / unboxed.length;
            cy = options.cy != null ? options.cy : sy / unboxed.length;
        } else {
            cx = options.cx != null ? options.cx : 0;
            cy = options.cy != null ? options.cy : 0;
        }

        // 1. boxes on outer circle
        if (boxIds.length > 0) {
            const count = boxIds.length;
            const outerRadius = options.outerRadius ?? 600;

            boxIds.forEach((id, i) => {
                const b = state.boxes[id];
                const angle = (i / count) * Math.PI * 2;
                const nx = cx + Math.cos(angle) * outerRadius - b.width / 2;
                const ny = cy + Math.sin(angle) * outerRadius - b.height / 2;
                moveBoxAndChildren(state, id, nx, ny);
            });

            separateBoxes(state, options.separationPadding ?? 40, options.separationIterations ?? 50);
        }

        // 2. unboxed nodes on inner circle
        if (unboxed.length > 0) {
            const count = unboxed.length;

            // Average node "size" used to size the ring so circumference fits.
            const sizeOf = typeof options.sizeOf === "function"
                ? options.sizeOf
                : defaultNodeRadius;
            let avgNodeSize = 0;
            unboxed.forEach(n => { avgNodeSize += sizeOf(n); });
            avgNodeSize = count ? avgNodeSize / count : 0;

            // Dynamic minimum radius: enough circumference so that nodes
            // (diameter ~= 2*avgNodeSize, plus a little padding) don't overlap.
            // circumference = 2*pi*r must be >= count * spacingPerNode.
            const spacingPerNode = avgNodeSize * 2 + (options.nodeSeparationPadding ?? 24);
            const fitRadius = (count * spacingPerNode) / (2 * Math.PI);
            const innerRadius = Math.max(options.innerRadius ?? 350, fitRadius);

            unboxed.forEach((n, i) => {
                if (n.pinned === true) return; // never move pinned nodes
                const angle = (i / count) * Math.PI * 2;
                n.x = cx + Math.cos(angle) * innerRadius;
                n.y = cy + Math.sin(angle) * innerRadius;
            });

            // resolve residual node-vs-node overlaps
            separateNodes(unboxed, {
                sizeOf: options.sizeOf,
                padding: options.nodeSeparationPadding ?? 24,
                iterations: options.nodeSeparationIterations ?? 60
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
            const hMargin = options.boxHMargin ?? 400;
            const vMargin = options.boxVMargin ?? 260;
            const startX = options.boxStartX ?? 150;
            const startY = options.boxStartY ?? 80;

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

            separateBoxes(state, options.separationPadding ?? 40, options.separationIterations ?? 50);
        }

        // 2. Cycle-safe leveling for unboxed nodes beneath boxes.
        if (unboxed.length > 0) {
            const idSet = new Set(unboxed.map(n => n.id));

            // Build directed adjacency + in-degree over edges whose BOTH
            // endpoints are unboxed (boxed children are ignored here).
            const adjacency = {};   // source -> [targets]
            const inDegree = {};    // node -> remaining in-degree
            unboxed.forEach(n => {
                adjacency[n.id] = [];
                inDegree[n.id] = 0;
            });
            state.edges.forEach(edge => {
                if (!idSet.has(edge.source) || !idSet.has(edge.target)) return;
                if (edge.source === edge.target) return; // ignore self-loops
                adjacency[edge.source].push(edge.target);
                inDegree[edge.target]++;
            });

            // Kahn-style longest-path leveling. Seed the queue with all
            // in-degree-0 nodes (the natural roots). If there are none (a pure
            // cycle), seed with the lowest-id node so processing can start.
            const levelOf = {};
            unboxed.forEach(n => { levelOf[n.id] = 0; });

            const queue = [];
            const enqueued = new Set();
            unboxed.forEach(n => {
                if (inDegree[n.id] === 0) {
                    queue.push(n.id);
                    enqueued.add(n.id);
                }
            });
            if (queue.length === 0) {
                // Pure cycle among unboxed nodes: break it deterministically by
                // forcing the lowest-id node to act as a root.
                const rootId = unboxed
                    .map(n => n.id)
                    .reduce((lo, id) => (id < lo ? id : lo));
                queue.push(rootId);
                enqueued.add(rootId);
            }

            // Process in topological order using a head pointer (avoids the
            // O(n) cost of Array.shift). A processed-count guard guarantees
            // termination even if the in-degree bookkeeping is confounded by a
            // forced root inside a cycle.
            let head = 0;
            let processed = 0;
            const totalNodes = unboxed.length;
            while (head < queue.length && processed < totalNodes) {
                const id = queue[head++];
                processed++;

                adjacency[id].forEach(target => {
                    // Longest-path: a node sits one level below its deepest parent.
                    if (levelOf[target] < levelOf[id] + 1) {
                        levelOf[target] = levelOf[id] + 1;
                    }
                    inDegree[target]--;
                    if (inDegree[target] <= 0 && !enqueued.has(target)) {
                        queue.push(target);
                        enqueued.add(target);
                    }
                });
            }

            // Any nodes never reached (left inside cycles) are parked on a row
            // below everything assigned so far so the layout still terminates.
            let maxLevel = 0;
            unboxed.forEach(n => {
                if (enqueued.has(n.id) && levelOf[n.id] > maxLevel) {
                    maxLevel = levelOf[n.id];
                }
            });
            unboxed.forEach(n => {
                if (!enqueued.has(n.id)) {
                    levelOf[n.id] = maxLevel + 1;
                }
            });

            // group by level
            const groups = {};
            Object.keys(levelOf).forEach(id => {
                const lvl = levelOf[id];
                if (!groups[lvl]) groups[lvl] = [];
                groups[lvl].push(id);
            });

            const rect = computeBoxesBoundingRect(state);
            const baseY = rect ? rect.maxY + 120 : (options.nodeStartY ?? 200);
            const spacingX = options.nodeHMargin ?? 180;
            const spacingY = options.nodeVMargin ?? 120;
            const startX = options.nodeStartX ?? 150;

            // Center each row horizontally about the common midline x = startX,
            // rather than every row starting flush-left at startX.
            Object.keys(groups).forEach(levelStr => {
                const lvl = parseInt(levelStr, 10);
                const arr = groups[lvl];
                const rowWidth = (arr.length - 1) * spacingX;
                const rowStartX = startX - rowWidth / 2;
                arr.forEach((id, i) => {
                    const n = state.nodes[id];
                    if (n.pinned === true) return; // never move pinned nodes
                    n.x = rowStartX + i * spacingX;
                    n.y = baseY + lvl * spacingY;
                });
            });

            // resolve residual node-vs-node overlaps
            separateNodes(unboxed, {
                sizeOf: options.sizeOf,
                padding: options.nodeSeparationPadding ?? 24,
                iterations: options.nodeSeparationIterations ?? 60
            });
        }
    }

    // ------------------------
    // FORCE LAYOUT (very simple, boxes + unboxed nodes)
    // ------------------------

    function forceLayout(state, options = {}) {
        const boxIds = getBoxIds(state);
        const unboxed = getUnboxedNodes(state);

        const iterations = options.iterations ?? 150;

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
            // Pinned nodes are fixed anchors: they still occupy space and
            // repel other bodies (via their getters being read), but writes
            // to their position are ignored so they never move.
            const pinned = n.pinned === true;
            bodies.push({
                type: "node",
                id: n.id,
                pinned,
                get x() { return n.x; },
                get y() { return n.y; },
                set x(val) { if (!pinned) n.x = val; },
                set y(val) { if (!pinned) n.y = val; },
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

                    const force = (options.repulsion ?? 20000) / (dist * dist);

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
                const ideal = options.idealEdgeLength ?? 220;
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
        separateBoxes(state, options.separationPadding ?? 40, options.separationIterations ?? 30);
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
            const startX = options.boxStartX ?? 100;
            const startY = options.boxStartY ?? 100;
            const hMargin = options.boxHMargin ?? 400;
            const vMargin = options.boxVMargin ?? 260;

            boxIds.forEach(id => {
                const row = Math.floor(i / cols);
                const col = i % cols;
                moveBoxAndChildren(state, id, startX + col * hMargin, startY + row * vMargin);
                i++;
            });

            separateBoxes(state, options.separationPadding ?? 40, options.separationIterations ?? 30);
        }

        const boxRect = computeBoxesBoundingRect(state);
        const topY = boxRect ? boxRect.maxY + 200 : 200;

        if (!unboxed.length) return;

        const unboxedIds = new Set(unboxed.map(n => n.id));

        // degree calculation — only count edges where BOTH endpoints are
        // unboxed, so boxed children don't inflate a node's degree.
        const degree = {};
        unboxed.forEach(n => (degree[n.id] = 0));
        state.edges.forEach(edge => {
            if (!unboxedIds.has(edge.source) || !unboxedIds.has(edge.target)) return;
            degree[edge.source]++;
            degree[edge.target]++;
        });

        // sort by degree
        const sorted = [...unboxed].sort((a, b) => degree[a.id] - degree[b.id]);

        // tiering. Use reduce-based max/min: spreading a very large array into
        // Math.max(...arr) can throw RangeError (call-stack/arg-count limits).
        const tierCount = options.tiers ?? 4;
        const degList = sorted.map(n => degree[n.id]);
        const maxDeg = degList.length
            ? degList.reduce((m, d) => (d > m ? d : m), -Infinity)
            : 0;
        const minDeg = degList.length
            ? degList.reduce((m, d) => (d < m ? d : m), Infinity)
            : 0;
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

            // Each node's desired X is the barycenter (average X) of its
            // parents in the tier above; nodes with no parents fall back to baseX.
            let weighted = tierNodes.map(n => {
                let targetX;

                if (adj && adj[n.id] && adj[n.id].length) {
                    const xs = adj[n.id].map(id => state.nodes[id].x);
                    const sum = xs.reduce((s, v) => s + v, 0);
                    targetX = sum / xs.length; // barycenter of parents
                } else {
                    targetX = baseX;
                }

                return { node: n, targetX };
            });

            // Sort by desired X, then sweep left-to-right placing each node as
            // close to its barycenter as possible while enforcing a minimum
            // horizontal spacing between consecutive nodes.
            weighted.sort((a, b) => a.targetX - b.targetX);

            let prevX = -Infinity;
            weighted.forEach(entry => {
                const desiredX = entry.targetX;
                // Keep desired position unless it would crowd the previous node.
                const placedX = prevX === -Infinity
                    ? desiredX
                    : Math.max(desiredX, prevX + spacing);
                prevX = placedX;

                if (entry.node.pinned === true) return; // never move pinned nodes
                entry.node.x = placedX;
                entry.node.y = y;
            });
        }

        const tierSpacing = options.tierSpacing ?? 180;
        const nodeSpacing = options.nodeSpacing ?? 150;
        const baseX = options.nodeStartX ?? 200;

        // 8. Place tiers using X-spreading
        for (let t = 0; t < tiers.length; t++) {
            const tierNodes = tiers[t];
            const upperNodes = t > 0 ? tiers[t - 1] : [];

            const y = topY + t * tierSpacing;

            spreadTier(tierNodes, upperNodes, y, baseX, nodeSpacing);
        }

        // resolve residual node-vs-node overlaps across all tiers
        separateNodes(unboxed, {
            sizeOf: options.sizeOf,
            padding: options.nodeSeparationPadding ?? 24,
            iterations: options.nodeSeparationIterations ?? 60
        });
    }



    // ------------------------
    // Export API
    // ------------------------

    const Layout = {
        apply,
        grid: gridLayout,
        circle: circleLayout,
        hierarchical: hierarchicalLayout,
        weightedTree: weightedTreeLayout,
        force: forceLayout,
        separateNodes,
        defaults: () => JSON.parse(JSON.stringify(defaultOptions))
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = Layout;
    } else {
        global.Layout = Layout;
    }

})(this);
