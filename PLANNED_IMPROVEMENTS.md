# Planned Improvements & Features

Scope: `node_mapper` — a Flask + vanilla-JS link-analysis graph editor. Each item
below is specific to this repo, keeps JS/Python parity where analytics are mirrored,
and matches the existing dependency-free, offline-first conventions.

## Improvements (existing behavior / quality / robustness / perf / UX / docs / tests)

1. **Graph density + self-loop metrics in stats.** Add `density` and `selfLoops`
   to both the server `compute_stats` and client `computeGraphStats`, surface them
   in the Analytics panel, and document them. *Rationale:* density and self-loop
   counts are standard link-analysis measures that the current summary omits.

2. **Server pathfinding perf: use `collections.deque`.** Replace O(n) `list.pop(0)`
   in `bfs_path` and `compute_betweenness` with `deque.popleft()`. *Rationale:*
   Brandes' betweenness runs a BFS per node; `pop(0)` makes each O(V) → the whole
   pass quadratic-per-source on large graphs.

3. **CSV import parses the `weight` column.** `buildCSV` exports `weight`, but
   `parseCSVEdgeList` never reads it, so a CSV round-trip silently drops edge
   weights. *Rationale:* export/import fidelity; Dijkstra depends on weight.

4. **GraphML import parses entity `type` and `color`.** The exporter already writes
   `<data key="type">`/color, but the parser ignored them. *Rationale:* round-trip
   fidelity — imported nodes keep their entity typing and color.

5. **GraphML export is lossless-ish.** Emit node `color`/`value` and edge
   `weight`/`width`/`color` data keys. *Rationale:* pairs with #4 so exported
   GraphML re-imports without losing weights, colors, or values.

6. **Client `computeGraphStats` builds adjacency once.** It currently builds the
   undirected adjacency and then calls `computeConnectedComponents`, which builds
   it *again*. Thread the adjacency through. *Rationale:* avoid double O(V+E) work.

7. **Robustness: guard malformed analytics payloads.** `/analytics` and
   `/api/centrality` assumed `graph.nodes` is a dict and `graph.edges` a list; a
   list-valued `nodes` currently 500s on `.keys()`. Validate types → 400.
   *Rationale:* never crash on hostile/garbage input.

8. **Timestamped, project-aware export filenames.** All exports downloaded as
   `graph.json`/`graph.png`/… collide and lose context. Name them
   `node-mapper-[project-]YYYYMMDD-HHMM.ext`. *Rationale:* usable artifact names.

9. **Richer HTML report export.** Add a generated timestamp, dark-friendly styling,
   density/self-loop line, and a top-entities-by-degree table caption plus a
   type-breakdown summary. *Rationale:* the exported report is a deliverable.

10. **Tests for the above.** Add pytest coverage for density/self-loops, malformed
    payload guards, and the new transforms; add JS tests for CSV weight round-trip
    and GraphML type/color parsing. *Rationale:* lock in parity and prevent
    regressions in interop.

## New Features

1. **Expanded OSINT transform library.** Add offline, deterministic transforms:
   `reverse_ip` (ipv4 → domains), `to_asn` (ipv4 → organization/ASN),
   `geolocate` (ipv4 → location), `to_url` (domain → urls),
   `person_to_social` (person → social profile urls). *Rationale:* transforms are
   the signature capability; these round out the ipv4/domain/person pivots.

2. **Graphviz DOT export.** New `buildDot()` + an export-format option producing a
   `.dot` file with node labels/colors and directed/undirected edges. *Rationale:*
   interop with the ubiquitous Graphviz toolchain.

3. **Graphviz DOT import.** New `parseDot()` + import-format option that reads basic
   `A -> B [label="…"]` / `A -- B` statements. *Rationale:* round-trips #2 and lets
   users bring in graphs authored elsewhere.

4. **Markdown investigation report export.** New `buildMarkdown()` + export option:
   summary stats, top entities, and an edge list in Markdown. *Rationale:* a
   paste-into-a-ticket/wiki deliverable that plain HTML/SVG can't be.

5. **Graph diameter & average shortest-path length.** Compute on the largest
   component (capped for safety) in `/analytics` and client-side, and display them
   in the Analytics panel. *Rationale:* diameter and mean path length are core
   structural measures the tool currently can't report.
