// Unit tests for the layout engines (run with `node --test`).
const test = require("node:test");
const assert = require("node:assert");
const Layout = require("../static/layout.js");

test("hierarchical layout terminates on a 2-cycle and yields finite positions", () => {
    const s = {
        nodes: { a: { id: "a", x: 0, y: 0, size: 25 }, b: { id: "b", x: 0, y: 0, size: 25 } },
        edges: [{ source: "a", target: "b" }, { source: "b", target: "a" }],
        boxes: {}, view: { scale: 1, tx: 0, ty: 0 }
    };
    Layout.apply("hierarchical", s, {});
    assert.ok(Number.isFinite(s.nodes.a.x) && Number.isFinite(s.nodes.b.y));
});

test("separateNodes pushes coincident nodes apart", () => {
    const a = { id: "a", x: 0, y: 0, size: 25 };
    const b = { id: "b", x: 0, y: 0, size: 25 };
    Layout.separateNodes([a, b], { padding: 20, iterations: 100 });
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(d > 10, "expected separation, got dist=" + d);
});

test("pinned nodes are not moved by a layout", () => {
    const s = {
        nodes: { p: { id: "p", x: 5, y: 7, size: 25, pinned: true }, q: { id: "q", x: 50, y: 50, size: 25 } },
        edges: [], boxes: {}, view: { scale: 1, tx: 0, ty: 0 }
    };
    Layout.apply("grid", s, {});
    assert.strictEqual(s.nodes.p.x, 5);
    assert.strictEqual(s.nodes.p.y, 7);
});

test("weightedTree handles a large chain without throwing (no RangeError)", () => {
    const nodes = {}; const edges = [];
    for (let i = 0; i < 400; i++) {
        nodes["n" + i] = { id: "n" + i, x: 0, y: 0, size: 20 };
        if (i > 0) edges.push({ source: "n" + (i - 1), target: "n" + i });
    }
    const s = { nodes, edges, boxes: {}, view: { scale: 1, tx: 0, ty: 0 } };
    assert.doesNotThrow(() => Layout.apply("weightedTree", s, {}));
});

test("circle layout is deterministic / headless-safe", () => {
    const nodes = {};
    for (let i = 0; i < 8; i++) nodes["n" + i] = { id: "n" + i, x: i, y: 0, size: 25 };
    const s = { nodes, edges: [], boxes: {}, view: { scale: 1, tx: 0, ty: 0 } };
    assert.doesNotThrow(() => Layout.apply("circle", s, { cx: 0, cy: 0 }));
    Object.values(s.nodes).forEach(n => assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y)));
});
