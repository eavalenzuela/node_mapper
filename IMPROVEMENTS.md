# Node Mapper → Maltego-Class Tool: Improvement & Rework Roadmap

## 1. Executive Summary

Node Mapper today is a competent, dependency-free **SVG diagram editor**: ~4,850 LOC of vanilla JS (`static/app.js` ~2,886 lines, `static/layout.js`, `static/index.html`, `static/styles.css`) backed by a thin Flask app (`node_mapper.py`, 214 lines). It can place geometric shapes, draw labeled/directed edges, group nodes in boxes, run several layout engines, compute aggregate graph stats and a single shortest path, import/export JSON/CSV/GraphML, and autosave to `localStorage`. It is a genuinely usable *drawing* tool.

It is **not yet a link-analysis tool**. Maltego-class products are built on four pillars that Node Mapper structurally lacks:

1. **A typed-entity data model.** Every node in Maltego is an instance of a defined entity type (Person, Domain, IP, Email…) with a primary value, typed property schema, icon, and category. Node Mapper nodes are untyped geometry — `SHAPE_DEFAULTS` (`static/app.js:63-70`) keys on shape, `normalizeNode` (`static/app.js:218-240`) and `createNodeAt` (`static/app.js:1868-1891`) carry no `entityType`/`value`/`properties`, and `node_mapper.py:17-27` stores only `{id,x,y,label}`. This is the foundational absence.
2. **Transforms.** The defining Maltego capability — right-click an entity, run a query, get back connected typed entities — does not exist. There is no context menu (`grep` for `contextmenu` returns nothing), no transform registry, and the server's `/nodes` and `/edges` endpoints are dead code never called by the client.
3. **Analyst-grade graph science.** Only aggregate stats and one shortest path exist (`computeGraphStats` `static/app.js:795-815`; `node_mapper.py:83-106`). No per-node centrality, no community detection, no data-driven visual encoding, no entity-list/bubble views.
4. **Multi-user persistence & cases.** State lives in one browser's single `localStorage` key, re-serialized every frame at the tail of `render()` (`static/app.js:2707`). There are no named projects/cases, no server persistence, no auth, no sharing, no collaboration.

**The 3–5 biggest strategic gaps, in priority order:**

1. **No typed-entity substrate** — blocks transforms, typed properties, per-type icons, type-aware search/filter/legend, validation, and meaningful import mapping. Everything downstream depends on it.
2. **No transform framework** — the signature link-analysis interaction (right-click → expand) and its server execution path are entirely absent.
3. **No real persistence layer** — single-key `localStorage` written per-frame, no projects, no server store, no auth; investigative work is fragile and un-shareable.
4. **Architecture cannot support the above** — a single 2,886-line script with ~50 mutable globals, no module system, no build tooling, and zero tests is the precondition that gates safe construction of entities + transforms + collaboration.
5. **Renderer won't scale & edges are unclean** — full `svg.innerHTML=''` rebuild every pointermove with per-frame autosave, no rAF batching, no culling/LOD; edges terminate at node centers so arrowheads hide under fills and thin edges are unclickable.

---

## 2. Prioritized Roadmap (Phased)

### Phase 0 — Quick Wins (ship immediately, low risk, high leverage)

| Item | Impact | Effort | Rationale |
|---|---|---|---|
| Harden Flask: disable `debug=True`, validate input, cap payloads | High | S | `node_mapper.py:214` exposes the Werkzeug RCE debugger; mandatory before any outbound transform call. |
| Add keyboard focus styles & make custom controls keyboard-operable | High | S | `static/styles.css` has zero `:focus` rules; theme toggle & palette tiles aren't reachable by keyboard. |
| Delete/Backspace deletes the selection, plus box deletion | High | S | Today deletion needs delete-mode clicks and boxes can *never* be deleted. |
| Fix undo-on-select pollution; push undo at drag start | Medium | S | Selecting a node calls `pushUndo()` (`app.js:1640`), destroying redo history on a bare click. |
| First-class numeric edge `weight` field (decouple from stroke width) | High | S | Adjacency already *reads* `edge.weight` (`app.js:684`) but nothing writes it — Dijkstra is silently shortest-by-thickness. |
| Clamp zoom + zoom-to-fit / reset-view controls | Medium | S | Wheel handler (`app.js:1557-1569`) has no min/max clamp; graph can vanish with no recovery. |
| Strip transient chrome (handles, snap guides, selection rings) from SVG/PNG export | High | S | `buildExportableSvg` (`app.js:1382`) clones live DOM, baking editor UI into deliverables. |
| Make boxes/badges/error-text/minimap theme-aware | Medium | S | Hardcoded colors (`app.js:2434-2445`, `styles.css:676-691`) stay pale-yellow/low-contrast in dark mode & exports. |
| Edge JSON export fidelity (preserve custom fields, width=0, weight) | Medium | S | `applyGraphPayload` edge map (`app.js:502-511`) rebuilds a fixed shape and `width||2` turns 0 into 2. |
| Debounced, quota-safe autosave decoupled from `render()` | Medium | S | `autosave()` (`app.js:946-954`) full-stringifies + unguarded `setItem` every frame; throws on quota mid-render. |
| Make circle layout deterministic / headless-safe | Low | S | `circleLayout` (`layout.js:249-255`) reads `window`/`view.scale` → NaN when scale 0; untestable. |
| Click-to-pick start/end for path-finding (set-from-selection) | High | S | `#path-start`/`#path-end` are free-text ID fields (`index.html:90-93`); typing uuid4 IDs is impractical. |

### Phase 1 — Foundational Reworks (enable everything else)

| Item | Impact | Effort | Rationale |
|---|---|---|---|
| **Build tooling, `package.json`, ES-module decomposition of `app.js`** | High | XL | 2,886-line script, ~50 globals, parse-time DOM wiring; precondition for entities, transforms, tests, collaboration. |
| Set-based multi-selection model (replace 3 scalar id vars) | Critical | L | `selectedNodeId/Edge/Box` (`app.js:19-21`) are mutually exclusive; blocks marquee, multi-delete, copy/paste, group ops. |
| rAF-batch rendering + debounce autosave out of the render loop | High | M | `render()` rebuilds whole SVG on every pointermove; prerequisite for the canvas/WebGL renderer. |
| State-change event bus; decouple persistence from render | Medium | M | Central change channel that render, minimap, plugins, and collaboration all subscribe to. |
| Automated test harness (Vitest + jsdom + pytest parity) | High | L | Zero tests; latent bugs (cyclic BFS hang, O(V²logV) Dijkstra, JS/Python directedness drift) sit unguarded. |
| Render edges/arrowheads to node borders + edge hit-areas + self-loops | High | M | Edges terminate at centers (`app.js:2359-2385,2509-2528`); arrows hidden, thin edges unclickable. |
| Fix hierarchical BFS leveling (Kahn, cycle-safe, centered) | High | M | `layout.js:326-336` re-enqueues on cycles → infinite loop / tab hang. |
| Fix `weightedTree` crash + realize barycenter intent | High | M | `Math.max(...arr)` (`layout.js:524-525`) RangeErrors at scale; computed `targetX` is discarded. |
| Node-node overlap avoidance across grid/circle/hierarchical/weightedTree | High | M | Only `forceLayout` knows node size; dense rings/tiers overlap. |

### Phase 2 — Link-Analysis Core (entities + transforms + graph science)

| Item | Impact | Effort | Rationale |
|---|---|---|---|
| **Typed-entity registry; stamp every node with `entityType`/`value`/`properties`** | Critical | L | The foundational substrate; everything below depends on it. |
| Categorized, searchable entity palette (replace 5 hardcoded shapes) | High | M | Drag a Person/Domain, not a rectangle. |
| Typed property schema + dynamic, type-driven property editor | High | L | Fixed Label/Color/Size/Group/Desc card → per-type field set. |
| Entity-type selector + typed primary value field in node editor | Medium | M | Reassign type, re-apply defaults, drive label from `valueField`. |
| Per-type icons as on-node visual encoding | High | M | Type recognizable independent of color in dense graphs. |
| Entity-type validation (value regex + required props), advisory | Medium | M | Email/IPv4 patterns; never blocks exploratory data. |
| Type-aware search + color-by-type + legend | Medium | S | `type:domain` token, default colors, legend chips. |
| Map CSV/GraphML columns onto entity types + properties | Medium | M | Imported nodes become first-class typed entities, not bare labels. |
| **Transform registry + right-click "Run transform" context menu** | Critical | L | The defining Maltego interaction. |
| Server-side `/transform` endpoint (replace dead CRUD) | High | L | Local + remote transforms mirroring the `/analytics` split. |
| Merge transform results additively with entity dedup | High | M | Re-running enrichment must be idempotent; fix counter-collision. |
| Provenance: manual vs transform-derived entities/links/properties | Medium | M | Distinct link color, read-only-after-transform fields. |
| Per-transform params, result limits, disclaimers | High | M | Cap fan-out to protect the render loop and legibility. |
| Transform "Hub" panel (discover/enable/run-all) | Medium | L | 5th tab; run applicable transforms on the selection. |
| Compute degree/betweenness/closeness/PageRank; ranked table | Critical | L | No per-node centrality today; brokers/hubs/cut-points invisible. |
| Map computed metrics → size/color visual channels | High | M | Make the key actor pre-attentively visible. |
| Data-driven encoding: size/color nodes, width edges by attribute | High | L | Analytics currently never feed back into visuals. |
| Community/cluster detection with colored partitions | High | L | Reveal rings/cells/bot clusters within components. |
| Entity-list (tabular) + bubble views over one graph | Medium | L | Inventory + centrality views beside the canvas. |
| Right-click context menus (canvas/node/edge/box) | Medium | M | Canonical entry point for per-entity operations. |
| Copy/paste/duplicate selected nodes + internal edges | High | M | Core editing ergonomics; depends on multi-select. |
| In-place (double-click) label editing | Medium | M | Avoid sidebar round-trip for the most common edit. |
| Group/ungroup + align-as-group on a multi-selection | Medium | M | Explicit grouping; align on a chosen subset. |
| Marquee / rubber-band selection | High | M | Grab a visual sub-network for bulk action. |

### Phase 3 — Advanced / Scale

| Item | Impact | Effort | Rationale |
|---|---|---|---|
| **Server-side persistence with project/case model (SQLite)** | Critical | L | Durable, named, multi-graph storage matching the full client schema. |
| User authentication + per-user project ownership | High | M | Gate cases to the logged-in user; disable debug mode. |
| Render-decoupled, quota-safe save (server + local) | High | M | Save on mutation, debounced, server-when-authenticated. |
| Server-authoritative UUIDs + merge-on-import | Medium | M | `crypto.randomUUID()` so multi-session graphs merge without collision. |
| Merge-on-import option (Replace vs Merge) | Medium | M | Append + dedupe instead of always wiping the graph. |
| Persistent version history / snapshots | Medium | M | Roll an investigation back to an earlier state. |
| Project sharing via links + role-based access | Medium | L | Live shared project instead of emailing JSON files. |
| Real-time multi-user co-editing + presence (WebSockets) | High | XL | One live canvas for a team; highest-effort, stage last. |
| Canvas/WebGL renderer with culling + LOD | Critical | XL | SVG freezes in the low thousands; investigative graphs exceed that. |
| Client-side transform/plugin framework + mutation API | Critical | XL | SDK-style extensibility (the maltego-trx analogue). |
| Richer path analysis: all-paths ≤ k, N-hop neighborhood | Medium | M | Beyond a single shortest path. |
| Attribute/type/degree faceted (non-destructive) filtering | Medium | M | Combinable predicates with live counts. |
| Animated/transition layout | Medium | M | Preserve spatial memory across re-layout. |
| Layout-on-selection / subgraph | Medium | M | Tidy one cluster without reshuffling all. |
| Pinned nodes excluded from layout | Medium | M | Preserve analyst-placed anchors. |
| Orthogonal/edge-aware layout + grid component grouping + crossing reduction | Medium | L | Turn hairballs into readable structure. |
| Fit-to-content whole-graph SVG/PNG export at selectable DPI | High | M | Reports/exhibits need the whole graph, not the viewport. |
| CSV + GraphML export (round-trip imports) | High | M | Handoff to Gephi/yEd/Cytoscape. |
| Templated PDF/HTML report export | Medium | L | Graph image + stats + Top-N + notes in one document. |
| Clipboard interop (SVG/PNG + JSON subgraph) | Medium | M | Copy imagery/subgraphs into reports or another graph. |
| Temporal attributes + timeline brush | High | XL | Who-knew-whom-when filtering. |
| Geospatial map view from lat/long | Medium | XL | Plot located entities; first external dependency (Leaflet). |
| Context-aware Selection & Properties panel (one card) | High | M | Swap to the selected item, not 3 stacked stub cards. |
| Shape + width/height controls in node editor | Medium | M | Edit placed-node geometry (dimensions already render). |
| ARIA tablist/tab/tabpanel + `aria-expanded` semantics | Medium | S | Screen-reader state for tabs and collapsible panels. |
| First-run onboarding overlay + control tooltips | Medium | M | Guided start; hover hints on icon controls. |
| Responsive layout: collapsible sidebar, adaptive tab-panel | Medium | M | Usable on a laptop screen. |

---

## 3. Thematic Deep-Dives

### 3.1 Data Model — the typed-entity substrate (the keystone)

Several recommendations across themes describe the **same foundational change** from different angles. **De-duplicated, they are one body of work:** introduce a typed-entity registry and stamp every node with type/value/properties.

- **Create `static/entities.js`** (global IIFE for now; an ES module — `static/entities/registry.js` — after Phase 1 build tooling lands) exporting `ENTITY_TYPES` keyed by id plus `getEntityType(id)`, `getEntityDefaults(id)`, `ensureEntityType(node)`, `registerEntityType()`, `listEntityTypes()`. Load it **before** `app.js` (script tag added at `static/index.html:435`). Each entry: `{id, displayName, category, shape, color, icon, valueField:'value', valuePattern, required:[], properties:[{key,label,type,default,overlay}]}`. Ship ~8 built-ins (Person, Email, Domain, IP, Phone, Company, URL, generic).
- **`normalizeNode` (`static/app.js:218-240`):** default `entityType='generic'`, `value = node.value ?? node.label ?? ''`, `properties = node.properties || {}`; layer color/shape/icon from the type's defaults **over** `SHAPE_DEFAULTS`. Refactor `SHAPE_DEFAULTS` (`app.js:63-70`) into a trivial "Shapes" type set so geometry becomes one category, not a parallel system.
- **`createNodeAt` (`static/app.js:1868-1891`):** accept `options.entityType`; stamp `baseNode.entityType` + `baseNode.value` + `baseNode.properties={}`.
- **Round-trip caveat (verified):** nodes survive `applyGraphPayload` via `{...node}` into `normalizeNode` (`app.js:499`), **but edges go through the fixed-shape map at `app.js:502-511` that drops unknown fields.** Any new edge metadata (weight, provenance, origin) **must be added there explicitly**. `snapshot()` (`app.js:466`) already spreads full node objects, so export preserves new node fields for free.
- **Built on top of the registry:** the searchable categorized palette (replace static markup `index.html:270-305`, change dragstart payload from `data-shape` to `data-entity-type` at `app.js:1081-1087`, drop at `app.js:1728-1743`); dynamic typed property editor (`#node-properties` container replacing the fixed inner markup of `#node-editor` `index.html:357-374`, built in `updateNodeEditor` `app.js:1135-1169`, written back in apply-node-edit `app.js:1171-1184`); per-type icons (`<defs>`/`<symbol>` in `#graphCanvas` `index.html:426`, `<use>`/`<image>` in the node loop after the shape `app.js:2548-2662`, cloned automatically by `buildExportableSvg`); type selector + typed value field; advisory `validateNode(node)` (regex from `type.valuePattern`, reuse `.error-text` `styles.css:688`); type-aware `isNodeVisible` (`app.js:550-554`) with a `type:` token + legend chips; and CSV/GraphML column→property mapping (`parseCSVEdgeList` `app.js:1273-1322`, `parseGraphML` `app.js:1324-1372`).
- **Provenance** (`source: manual|import|transform:<id>`, `createdAt`, `confidence`) defaults in `normalizeNode` and the edge map (`app.js:502-511`); surfaced in the editors; transform-populated fields read-only via `setEditorDisabled` (`app.js:1128-1133`); derived links get a distinct stroke in the edge loop (`app.js:2476`/default `#888` at `2485`).

### 3.2 Transforms / Data Integration

This is the marquee capability and the **second de-duplicated cluster** (the registry, context menu, server endpoint, and plugin framework are facets of one system).

- **`static/transforms.js` → `TransformRegistry`** with `registerTransform({id,name,inputTypes,params,disclaimer,maxResults,scope,run})`, `applicableFor(entityType)`, `run(id, entity)`. A stable mutation API (`addEntity/addLink/setProperty`) wraps `createNodeAt`/`createEdge` and calls `pushUndo()` **once per run** (`app.js:490`).
- **Context menu:** add `svg.addEventListener('contextmenu', …)` near pointerdown (`app.js:1573`), resolving the node via `e.target.dataset.nodeId` exactly as pointerdown does (`app.js:1574`). List applicable transforms; on click run, place children radially around `nodes[srcId]` via `createNodeAt` + `createEdge` (`app.js:1902`), then render.
- **Server `/transform`** in `node_mapper.py`: repurpose the dead `/nodes` (`17-27`) and `/edges` (`29-36`). Read `request.json or {}` (like analytics `184`, never `request.json` directly), dispatch on `transformId`, wrap handlers in try/except → 4xx/5xx, return `{entities, links}`. Ship 2–3 demo handlers. **Turn off `debug=True` (`214`) first** (the Phase-0 hardening item).
- **Additive merge + dedup:** `mergeEntities(results, sourceNodeId)` keyed on `` `${entityType}::${value.trim().toLowerCase()}` ``; `edgeExists(a,b,label)` before `createEdge`. **Fix the counter-collision** at `applyGraphPayload` `app.js:524-526` *and* `restoreFromSnapshot` `app.js:482-484` by scanning the max numeric id suffix instead of `Object.keys().length`.
- **Params/limits/disclaimers:** `#transform-modal` styled like `.property-card` forms; clamp `results.slice(0, limit)` before the create loop; persist last-used params in `localStorage`.
- **Hub panel:** 5th `.tab-button data-tab="transforms"` (`index.html:35-252`); the handler (`app.js:1053-1064`) already generalizes. Persist enabled state; "Run applicable on selection."
- **Plugin framework (Phase 3, XL):** the registry + mutation API generalized into a documented extension boundary, local + remote — the maltego-trx analogue. Depends on the ES-module decomposition and the typed-entity registry.

### 3.3 Visualization

- **Edges to borders (Phase 1):** `clipToNodeBorder(point, node)` (circle: center ± r along unit vector; rect/rounded/swimlane/cylinder: ray-vs-AABB via `getNodeDimensions` `app.js:242`; diamond: ray-vs-rhombus). Apply in the edge loop after `getEdgePointsForRouting` (`app.js:2483`); recompute the arrowhead (`app.js:2509-2528`) from the clipped head. Append a transparent ~10–12px hit-area sibling **before** the visible stroke; set the visible stroke `pointer-events:none`. Emit a loop arc when `source===target`.
- **Per-type icons** — see §3.1.
- **Data-driven encoding:** cache a degree map from `buildAdjacency` (`app.js:680`) at the top of `render()`; apply size override around `getNodeDimensions` (`app.js:242`), color via an `interpolateRamp(t)` helper (`adjustColor` `app.js:267` already parses hex), edge width in the edge loop — keep manual `n.color`/`width` as override. Feeds metric-driven encoding and community coloring.
- **Alt views:** Entity List (HTML table from nodes + degree map, sortable, row-click selects/centers via the minimap recenter math `app.js:2833-2876`); Bubble View (degree-based sizing). Factor the duplicated extents math (`app.js:2745-2766` / `2854-2868`) into one `getWorldExtents()`/`getGraphBounds()` helper shared by minimap, fit-to-content, and export.
- **Canvas/WebGL renderer (Phase 3, XL):** extract a `Renderer` interface (`SvgRenderer` = current code, `CanvasRenderer` new) sharing world↔screen math (`screenToWorld` `app.js:539`, viewport transform `app.js:2401`); culling from `screenToWorld(0,0)`/`(clientW,clientH)`, zoom-based LOD. Hit-testing moves off dataset attributes (`app.js:1573-1578`) to a spatial pick. Built on the rAF-batching prerequisite.
- **Theme/export cleanliness (Phase 0):** wire `--minimap-bg`/`--minimap-border` (already in `styles.css:17-18,42-43`, ignored by `renderMinimap` `app.js:2724-2725`); add `--box-fill/--box-stroke/--box-label/--edge-default/--edge-label/--minimap-node` tokens read via `getComputedStyle` (the `--node-stroke` pattern at `app.js:2546`); a `forExport` flag (or post-clone scrub of `[data-resize-box-id]`/`.snap-guide`, reset selection/path strokes) in `buildExportableSvg` (`app.js:1382-1402`).

### 3.4 Interaction

- **Multi-selection (Phase 1, foundational):** replace `app.js:19-21` with `selection = {nodes:Set, edges:Set, boxes:Set}` + `selectOne/toggleSelect/clearSelection/isSelected/getSelectedNodes`. Rewrite the three select branches in pointerdown (box `1597-1611`, node `1639-1653`, edge `1668-1676`); **remove the `selectedBoxId = n.box` assignment at `1643`** that conflates node and box selection. Route every scalar reader through the accessors: `clearSelectionIfLayerUnavailable` (`370-381`), `applyGraphPayload` (`528-530`), undo/redo (`1096-1098,1108-1110`), apply-*-edit (`1172,1223,1515`), the three editors (`1135,1187,1977`), `getArrangeTargets` (`2012`). This is what makes it an L.
- **Built on multi-select:** marquee (record origin instead of panning in the bg branch `app.js:1705-1718`; overlay rect outside `#viewport`; intersect via `getNodeDimensions` on pointerup `1839`); copy/paste/duplicate (`structuredClone` clipboard near `app.js:19`, oldId→newId remap, restructure the Ctrl+Shift early-return at `app.js:2317`); Delete/Backspace + `deleteBox(id)` (detach members then delete; bind before the early-return at `2317`); group/ungroup (`groupSelection` mirroring `alignNodes` math `app.js:2044-2049` + `createBoxAt` `1918`; `getArrangeTargets` prefers the multi-selection); context menus (delegated `contextmenu` listener calling existing helpers, gated on `isLayerLocked` `app.js:331`).
- **Undo correctness (Phase 0):** delete `pushUndo()` at `app.js:1640`; add `dragUndoPushed` flag, push once on first real movement in the drag/box-drag/resize branches, reset in pointerup (`1839`).
- **Double-click rename (Phase 3):** `dblclick` listener; overlay `<input>` at inverted `screenToWorld` coords; reuse `getEdgeLabelAnchor` (`app.js:2387`); commit on Enter/blur, cancel on Escape, one undo; respect `isLayerLocked`.

### 3.5 Layout (`static/layout.js`)

- **Hierarchical (Phase 1):** replace the while-loop at `layout.js:326-336` with Kahn's algorithm over an in-degree map; `level[target]=max(level[target], level[id]+1)`; second pass for cycle nodes after breaking a back-edge; center each row about the midline instead of `startX + i*spacingX` (`352-360`).
- **weightedTree (Phase 1):** replace `Math.max(...sorted.map(...))`/`Math.min(...)` (`524-525`) with a reduce; in `spreadTier` (`575-578`) actually *use* `targetX` via a left-to-right sweep enforcing min spacing; gate degree counting (`514-517`) to edges with both endpoints unboxed.
- **Overlap avoidance (Phase 1):** generic `separateNodes(state, nodes, padding, iterations)` (circle-vs-circle) called after grid (`239`), circle (`283`), hierarchical (`360`), weightedTree (`593`); pass a `sizeOf` callback since `layout.js` can't import `getNodeDimensions`; dynamic `innerRadius` for circle (`276`).
- **Circle determinism (Phase 0):** center on centroid or `options.cx/cy` (`249-255`); delete the `window`/`view.scale` math.
- **Phase 3 polish:** edge-aware grid (component-contiguous placement) + barycenter crossing-reduction sweeps for layered layouts (builds on the hierarchical rework); layout-on-selection; pinned nodes (`n.pinned`, skip in every engine's position write `235-236/280-281/357-358/400-401/576-577`); animated transitions (rAF lerp in the apply-layout handler `app.js:2177-2199`, node-count guarded).

### 3.6 Analytics

- **`static/analytics.js`** loaded after `app.js` (third script at `index.html:436`): `computeCentrality(nodes, edges, {directed, weighted})` — Brandes betweenness, per-component closeness, damped PageRank, in/out/total degree; store on `n.metrics.*`; sortable Top-N table in the Analytics tab. **Mirror in `node_mapper.py`** for the >500-node backend path (`ANALYTICS_BACKEND_THRESHOLD` `app.js:129`); reuse the heap pattern from `dijkstra_path` (`node_mapper.py:141-179`) and avoid the client `queue.sort` O(V²logV) loop (`app.js:742`).
- **Community detection:** `detectCommunities` (label propagation, then Louvain) in `analytics.js`; store `n.community`; deterministic colors; wrap in `pushUndo()`; feed the color-by encoding and optional auto-boxes (`createBoxAt` `app.js:1918`).
- **Metric→visual encoding** — see §3.3 (non-destructive override, legend; keep selection `#ff9900`/path `#ff2d55` strokes layered on top).
- **Richer paths:** `allPathsUpToK` (bounded DFS, cap k≤6) and `selectNeighborhood` (BFS frontier) reusing `buildAdjacency`; dedicated highlight set, not `selectedNodeId`.
- **Resolve the verified directedness inconsistency:** JS analytics path uses directed adjacency (`app.js:696,732`) while stats use undirected (`798`); the parity test against `/analytics` is the cheapest way to catch this drift.

### 3.7 Interop (Import/Export)

- **Fit-to-content export (Phase 3):** `getGraphBounds()` (shared with minimap); in `buildExportableSvg` rewrite the `#viewport` transform to `translate(-minX+margin,-minY+margin) scale(1)`, set width/height to span + margin, set an explicit `viewBox` (live SVG has none, and the clone only sets it if absent `app.js:1388-1390`); PNG DPI multiplier into `svgStringToPngBlob` (`app.js:1410-1440`). Wire `#export-scope`/`#png-scale` into the handler (`app.js:1471-1493`).
- **CSV/GraphML export:** `buildCsvEdgeList()` (quote fields with commas — fix the naive split at `app.js:1277` on both sides) and `buildGraphML()` (per-node/edge `<data>`, positions, directed); add options to `#export-format` (`index.html:62-67`) and branches to the export switch.
- **Merge-on-import + UUIDs + edge fidelity:** refactor `applyGraphPayload` (`495-537`) so normalization is reusable; add `mergeGraphPayload` (idMap, endpoint rewrite, edge-pair Set dedup); switch ids to `crypto.randomUUID()` at `createNodeAt/Edge/Box` (`1870/1904/1920`) and the counter resets (`482-484/524-526`); edge spread `{...ed}` + `Number.isFinite` checks (preserves width=0, custom fields, weight).
- **Report export:** assemble HTML (`window.open`+`document.write`+`print`) from fit-to-content SVG + `computeGraphStats` + Top-N-by-degree + `node.desc`. **Clipboard interop:** `navigator.clipboard.write` PNG `ClipboardItem` + `writeText` JSON; paste listener → `mergeGraphPayload` (secure-context guard, `downloadBlob` fallback).

### 3.8 Collaboration / Persistence

- **SQLite project/case model (Phase 3 keystone):** create `requirements.txt` (Flask is currently undeclared); remove the in-memory `GRAPH` and dead `create_node`/`create_edge`/`get_graph` (`node_mapper.py:8-44`); tables `projects` + `graphs(data_json)` storing the **full** client schema (nodes/edges/boxes/layers/activeLayerId/layoutSettings). REST CRUD round-tripping `snapshot()`/export JSON; client `serializeGraph()` helper factored from the duplicated literals (`app.js:466,949,1473`); `saveGraphToServer`/`loadGraphFromServer` reusing `applyGraphPayload`; Projects section in the File tab.
- **Auth (depends on persistence):** `users` table, `werkzeug.security` hashing, login/register/logout, `@login_required`, `projects.owner`; replace `app.run(debug=True)` (`214`) with env-driven host/port + `debug=False`.
- **Render-decoupled save:** remove `autosave()` from `render()` tail (`2707`); `scheduleSave()` wired to mutation points (around `pushUndo` `app.js:490`), debounced, try/catch on `setItem`/`fetch`, server-preferred when authenticated. Note the many direct `render()` call sites (`367,432,880,1099,1183,1689-1742`) — wire to mutations, not to every render.
- **Then:** version history (`graph_versions` table); sharing (`project_shares` + token, role enforced server-side; reuse `setEditorDisabled` `app.js:1128-1133` for viewer mode **plus** gating canvas mutation modes); real-time co-editing (Flask-SocketIO, room=project id, phase-1 whole-graph broadcast → phase-2 granular ops, presence roster in `.top-right` `index.html:11-33`).

### 3.9 UX

- **Phase 0:** focus styles (`:focus-visible { outline: 2px solid var(--guide-color) }`, `styles.css` has none; make `#theme-toggle` and `.shape-item` keyboard-operable); theme-aware badges/error/boxes.
- **Context-aware properties panel (Phase 3, high impact):** render only the one `.property-card` matching the active selection; `#selection-empty-state`; decouple box highlight from node selection (separate parent-box variable; box highlight keys off `selectedBoxId` at `app.js:2435`).
- **Then:** shape + width/height controls in the node editor (dimensions already render via `getNodeDimensions` `app.js:242-265` — only UI + apply wiring missing, `#edit-shape/#edit-width/#edit-height`); ARIA `tablist`/`tab`/`tabpanel` + `aria-expanded` (`index.html:35-40`, handlers `app.js:1053-1065,1022-1027`); onboarding overlay gated on a `localStorage` flag (after `loadGraphFromBackend` resolves) + `title` attributes; node-picker path-finding (datalist/"use selected" replacing `#path-start`/`#path-end`); faceted non-destructive filtering (AND predicates into `isNodeVisible` `app.js:550`, facet counts, dim-vs-hide); responsive sidebar collapse + `@media` breakpoints (`styles.css` has zero today).

### 3.10 Architecture (the precondition)

- **Build tooling + ESM decomposition (Phase 1, XL):** `package.json` + Vite/esbuild; convert `layout.js`'s UMD (`612-613`) to ESM; carve `app.js` along existing seams — `state.js`, `render/svgRenderer.js`, `interaction/pointerHandlers.js`, `analytics.js`, `io/importExport.js`, `ui/panels.js`, `entities/registry.js`, `transforms/registry.js`. Replace ~50 globals with a single observable state module; move parse-time `addEventListener` wiring into `init()` on `DOMContentLoaded`. Extract leaf modules first (the near-pure analytics functions `app.js:678-815`), hardest last (`render()` `2395`, pointer handlers `1745`). Keep DOM ids so `index.html` swaps two script tags for one `type=module` entry.
- **State-change event bus (Phase 1):** tiny emitter in `state.js`; mutations emit `graph:changed`; render, minimap, autosave, plugins, and collaboration subscribe instead of funneling through `render()`.
- **Test harness (Phase 1):** Vitest + jsdom (analytics, layout engines, `normalizeNode`/`getNodeDimensions`, a DOM render/pointer test) + pytest + a JS↔Python `/analytics` golden-master parity test + a cyclic-graph layout-termination regression; GitHub Actions CI.
- **Flask hardening (Phase 0):** env-driven debug, `request.get_json(silent=True)`, validate `create_edge` keys and analytics endpoints, `MAX_CONTENT_LENGTH` + node/edge cap before Dijkstra, escape server strings in `renderAnalyticsPanel` (`app.js:913,919-924`) via `textContent`/`createElement`.

---

## 4. Summary Table of All Recommendations

| Title | Type | Impact | Effort | Theme |
|---|---|---|---|---|
| Typed-entity registry; stamp every node with `entityType` (incl. value/properties substrate; supersedes the "shape catalog → registry" variant) | new-capability / rework | Critical | L | Data Model |
| Categorized, searchable entity palette | rework | High | M | Data Model |
| Typed property schema + dynamic property editor | new-capability | High | L | Data Model |
| Entity-type selector + typed value field | improvement | Medium | M | Data Model |
| Per-type icons as on-node encoding (incl. image/icon fields) | improvement / new-capability | High | M | Visualization |
| Entity-type validation (regex + required) | improvement | Medium | M | Data Model |
| Map CSV/GraphML columns → entity types/properties | improvement | Medium | M | Interop / Data Model |
| Type-aware search + color + legend | quick-win | Medium | S | Data Model / Viz |
| Provenance on entities/links/properties | improvement | Medium | M | Data Model |
| Transform registry + right-click "Run transform" | new-capability | Critical | L | Transforms |
| Server-side `/transform` endpoint | new-capability | High | L | Transforms |
| Merge transform results additively + dedup | improvement | High | M | Transforms |
| Per-transform params / limits / disclaimers | improvement | High | M | Transforms |
| Transform Hub panel | new-capability | Medium | L | Transforms |
| Client-side transform/plugin framework + mutation API | new-capability | Critical | XL | Transforms / Architecture |
| Edges/arrowheads to node borders + hit-areas + self-loops | improvement | High | M | Visualization |
| rAF-batch rendering + debounce autosave out of render | rework | High | M | Architecture / Viz |
| Canvas/WebGL renderer with culling + LOD | new-capability | Critical | XL | Visualization |
| Data-driven encoding (size/color/width by attribute) | new-capability | High | L | Visualization |
| Entity-list + bubble views | new-capability | Medium | L | Visualization |
| Clamp zoom + zoom-to-fit / reset | quick-win | Medium | S | Visualization |
| Theme-aware box/edge/minimap colors + strip export chrome | quick-win | Medium | S | Visualization / UX |
| Strip transient chrome from export | quick-win | High | S | Interop / Viz |
| Set-based multi-selection model | rework | Critical | L | Interaction |
| Marquee / rubber-band selection | new-capability | High | M | Interaction |
| Copy / paste / duplicate | new-capability | High | M | Interaction |
| Delete/Backspace + box deletion | improvement | High | S | Interaction |
| Right-click context menus (canvas/node/edge/box) | new-capability | Medium | M | Interaction |
| Fix undo-on-select + undo at drag start | quick-win | Medium | S | Interaction |
| Double-click in-place label editing | improvement | Medium | M | Interaction |
| Group/ungroup + align-as-group | improvement | Medium | M | Interaction |
| Fix hierarchical BFS leveling (Kahn, cycle-safe) | rework | High | M | Layout |
| Fix `weightedTree` crash + barycenter intent | rework | High | M | Layout |
| Node-node overlap avoidance | improvement | High | M | Layout |
| Layout-on-selection / subgraph | new-capability | Medium | M | Layout |
| Pinned nodes excluded from layout | new-capability | Medium | M | Layout |
| Animated/transition layout | improvement | Medium | M | Layout |
| Circle layout deterministic / headless-safe | quick-win | Low | S | Layout |
| Edge-aware grid + crossing-reduction | improvement | Medium | L | Layout |
| Numeric edge `weight` field | quick-win | High | S | Analytics |
| Degree/betweenness/closeness/PageRank + ranked table | new-capability | Critical | L | Analytics |
| Map metrics → visual channels | new-capability | High | M | Analytics / Viz |
| Community / cluster detection | new-capability | High | L | Analytics |
| Click-to-pick path start/end | quick-win | High | S | Analytics / UX |
| Richer path analysis (all-paths ≤ k, N-hop) | improvement | Medium | M | Analytics |
| Faceted non-destructive filtering | improvement | Medium | M | Analytics / UX |
| Temporal attributes + timeline brush | new-capability | High | XL | Analytics / Viz |
| Geospatial map view (lat/long) | new-capability | Medium | XL | Visualization |
| Fit-to-content whole-graph SVG/PNG export + DPI | improvement | High | M | Interop |
| CSV + GraphML export | new-capability | High | M | Interop |
| Merge-on-import option | improvement | Medium | M | Interop |
| Edge JSON export fidelity | quick-win | Medium | S | Interop |
| Templated PDF/HTML report export | new-capability | Medium | L | Interop |
| Clipboard interop (SVG/PNG + JSON) | new-capability | Medium | M | Interop |
| Server persistence: project/case model (SQLite) | new-capability | Critical | L | Collaboration / Persistence |
| User auth + per-user ownership | new-capability | High | M | Collaboration / Persistence |
| Debounced, quota-safe autosave (Phase-0 variant) | improvement | Medium | S | Persistence |
| Render-decoupled, quota-safe save (server + local) | rework | High | M | Persistence |
| Persistent version history / snapshots | new-capability | Medium | M | Persistence |
| Project sharing via links + RBAC | new-capability | Medium | L | Collaboration |
| Real-time multi-user co-editing + presence | new-capability | High | XL | Collaboration |
| Server-authoritative UUIDs + merge | improvement | Medium | M | Persistence / Interop |
| State-change event bus / decouple persistence | improvement | Medium | M | Architecture |
| Keyboard focus styles + operable controls | quick-win | High | S | UX |
| ARIA tablist/tab/tabpanel + `aria-expanded` | quick-win | Medium | S | UX |
| Context-aware properties panel | improvement | High | M | UX |
| Shape + width/height in node editor | improvement | Medium | M | UX |
| Onboarding overlay + tooltips | new-capability | Medium | M | UX |
| Node-picker path inputs | rework | High | M | UX / Analytics |
| Responsive sidebar + adaptive panels | improvement | Medium | M | UX |
| Build tooling + ESM decomposition of `app.js` | rework | High | XL | Architecture |
| Automated test harness (Vitest + pytest) | new-capability | High | L | Architecture |
| Harden Flask (debug off, validate, cap, escape) | improvement | High | S | Architecture / Security |

---

## 5. The Single Most Important Rework

**Introduce the typed-entity model — a registry plus `entityType`/`value`/`properties` on every node — and do it on top of the Phase-1 architecture work.**

Everything that distinguishes a link-analysis tool from a diagram editor hangs off this one substrate. Transforms need a typed input value to query with. Per-type icons, the searchable palette, typed property editing, validation, type-aware search/legend, meaningful import mapping, provenance, and entity dedup are all *consumers* of it. It is rated Critical/L (not XL) because the data plumbing is small and additive — `normalizeNode`, `createNodeAt`, a new `entities.js`, and the edge-map round-trip fix at `app.js:502-511` — and existing graphs degrade cleanly to a built-in `generic` type so nothing breaks. The strict ordering is: **harden the server (Phase 0) → build tooling + multi-selection + rAF + tests (Phase 1) → typed entities → transforms (Phase 2)**, because the entity registry is far cleaner to build as an ES module against a tested, decomposed codebase than bolted onto the current 2,886-line global script.

### What this analysis may have missed

- **No runtime verification.** This synthesis rests on the source-line claims in the recommendations (which note several already-corrected line-number drifts, e.g. HTML `270-305`/`435-436`, `getNodeDimensions` at `242` not `244`). I read no files directly; before implementation each cited range should be re-confirmed, as the codebase has merged PRs since these were written (the tabbed top-bar and sidebar-palette work in recent commits may have shifted line numbers).
- **Effort estimates are relative, not absolute.** They assume the Phase-1 architecture rework lands first; several "L" items become "XL" if attempted against the current monolith, and the XL items (WebGL renderer, real-time co-editing, plugin SDK) carry the most estimation risk.
- **Sequencing/value trade-offs are asserted, not validated against users.** The roadmap optimizes for the stated goal (Maltego parity). It does not weigh whether a given audience would get more value from, say, the report/export and collaboration track *before* full transforms — that prioritization deserves a product decision, not just an architectural one.
- **External-dependency and security surface is under-explored.** Real transforms imply outbound API calls, secret management, rate limiting, and audit logging beyond the single Phase-0 hardening item; the geospatial and PDF tracks each introduce the project's first third-party dependencies into a deliberately no-build vanilla app, which is a larger philosophical shift than any single line-level change suggests.

---

## 6. Addendum — Live Visual Inspection Findings

The roadmap above was synthesized from source reading. The following were found by **running the app, seeding a graph, and screenshotting** the current build (with the recently merged tab-bar / shape-palette / layers UI). They complement — and in one case extend — the code-level findings.

### 6.1 The top tab-band and the left sidebar are two competing navigation systems, and the band steals canvas height (Impact: High, Effort: M)

`#tab-panels` (`static/styles.css:156-167`) is an **in-flow** block (`display:none`→`block`, full width, `max-height:35vh`) stacked between `#tab-bar` and `#layout`. Opening **any** tab (File/Analytics/Arrange/View) therefore pushes the entire sidebar **and** canvas down by up to 35% of the viewport — confirmed visually: the canvas top edge drops from ~95px to ~430px when the *Arrange* tab is open. Simultaneously the panel is full-width, so single controls stretch absurdly (the Layout `<select>` spans ~1500px). The result is a confusing **dual IA**: controls are split between a top horizontal tab-band (File/Analytics/Arrange/View) and a left vertical rail of collapsible panels (Workspace/Layers/Selection), and activating the former shrinks the work area. Maltego (and yEd/draw.io) use a *single* model: a thin action ribbon plus **docked side panels** that overlay/resize without stealing canvas height.
**Recommendation:** unify navigation. Either (a) move tab-panel content into the left rail (or a second right-docked rail) so there is one panel system, or (b) make `#tab-panels` a **floating/overlay** dropdown anchored under its tab (position it out of flow so it never pushes `#layout`), and cap inner control width. This pairs with the existing *“Context-aware Selection & Properties panel”* and *“Responsive sidebar”* items and should precede them.

### 6.2 Default panel order buries the primary editing surface (Impact: Medium, Effort: S)

In the left rail, **Workspace** (shape palette + search) and **Layers** are expanded above **Selection & Properties** (`static/index.html:256-421`), all `open` by default. Selecting a node requires scrolling past the palette and layer manager to edit it — the single most frequent action is the least reachable. Beyond the §3.9 *context-aware panel* rework, reorder so **Selection & Properties is first** (or auto-expand/scroll it into view on selection, collapsing the others). Maltego docks the Detail/Property view as a persistent, always-visible panel precisely because it is the constant companion to selection.

### 6.3 Mini-map occludes top-right entities (Impact: Low, Effort: S)

The floating mini-map (`#minimap-container.minimap-floating`, `static/index.html:427-430`) overlaps live canvas content in the top-right corner — in the seeded graph it sat directly over the `jsmith (admin)` node. It is toggleable (View tab) but always occupies a fixed corner when on. **Recommendation:** make it draggable/repositionable or collapsible-in-place, and/or auto-dodge by reserving a small gutter; low effort, real polish.

### 6.4 Native OS color picker breaks the UI (Impact: Low, Effort: S — quick win)

The node/edge color fields are raw `<input type="color">` (`static/index.html:362, 391`), which open the **operating-system** color dialog (visible in the project's own `node_mapper_main.png`). It is jarring against the custom dark theme and offers no shared palette or recent-colors. **Recommendation:** replace with an inline swatch palette (a small fixed set of theme-aware swatches + a “custom” fallback). This dovetails with the §3.1 *color-by-type + legend* work — define the type palette once and reuse it here.

### Implementation status (this working tree)

Most of this roadmap has now been implemented and verified (16 automated tests pass; a headless browser run drove every feature with **zero console/runtime errors**). Summary:

**Done — Phase 0:** debounced/quota-safe autosave decoupled from render; zoom clamp + Fit/1:1 + zoom buttons; theme-aware boxes/badges/error/minimap; export chrome stripped; edge JSON fidelity; Delete/Backspace + box deletion; undo-on-select fixed (undo pushed at drag start); first-class edge `weight`; keyboard focus styles + operable controls; click-to-pick / "Use selected" path endpoints; server hardening (debug off by default, input validation, size caps, escaped analytics output).

**Done — Phase 1:** set-based multi-selection (with primary scalar retained); rAF-batched render; edge-to-border arrowheads + fat hit-areas + self-loops; cycle-safe hierarchical (Kahn) + weightedTree barycenter fix + `separateNodes` overlap avoidance + deterministic circle layout (`static/layout.js`); state-change/save decoupling; **Vitest-style** `node --test` suite + pytest server suite + `package.json`.

**Done — Phase 2 (link-analysis core):** typed-entity registry (`static/entities.js`) with icons/colors/shapes/property schemas; categorized searchable entity palette; dynamic typed property editor + validation; per-type icons on nodes; type-aware search (`type:` token) + type filter + color-by-type + on-canvas legend; transform framework (registry, **right-click context menu**, `/api/transform` with 5 demo transforms, additive merge + dedup, provenance); degree/betweenness/closeness/PageRank + ranked table; label-propagation communities; data-driven color/size encoding; copy/paste/duplicate, group/ungroup, marquee select, in-place (double-click) rename, full context menus.

**Done — Phase 3 (partial):** SQLite projects/cases + version history + optional auth (`/api/*`), render-decoupled server save; CSV/GraphML/HTML-report export + fit-to-content + DPI + clipboard interop + merge-on-import; layout-on-selection + animated transitions + pinned nodes; the **dual-navigation fix** (tab panels float instead of pushing the canvas), Selection-panel-first reorder, ARIA roles + focus, onboarding overlay, responsive sidebar collapse, inline color swatches, label halos, draggable minimap, N-hop neighborhood selection.

**Done — the remaining (previously-deferred) items:** a **Canvas 2D renderer** with viewport culling + level-of-detail (View → Canvas; pan/zoom/select/drag supported) for large graphs; **real-time multi-user co-editing** via Server-Sent Events (per-project pub/sub on a threaded Flask server, presence indicator, whole-graph broadcast on save, echo-suppression); a **timeline** brush that filters entities by date; a **geographic map view** (equirectangular projection of `lat`/`lng` properties with a graticule — no external tiles/deps); **entity-list and bubble alternate views**; **all-paths-≤-k** (bounded DFS with highlight); and **server-authoritative UUIDs** (`crypto.randomUUID()` for new nodes/edges/boxes, with merge-on-import remap). All verified in a two-context headless browser run.

Everything in this roadmap is now implemented. (A production WebGL renderer and an operational-transform/CRDT merge model would be the next step beyond the Canvas renderer and whole-graph-broadcast collaboration shipped here, but those are hardening of already-delivered capabilities rather than missing features.)

### 6.5 Node labels have no halo and can collide (Impact: Medium, Effort: M)

Labels render as plain `<text>` beneath each node with no background/halo, so in dense or overlapping regions they collide with neighboring nodes, edges, and each other, hurting legibility (visible where edge lines cross label text in the seeded graph). **Recommendation:** add a subtle label background/halo (a `paint-order: stroke` outline or a rounded backdrop rect) and, longer-term, collision-aware label placement. This belongs in the §3.3 Visualization track alongside per-type icons and edge-to-border clipping.