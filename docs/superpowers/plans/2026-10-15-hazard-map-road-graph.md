# Hazard Map: Road Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graph the Kurume city road network from OpenStreetMap and apply the existing bus/station graph-theory logic (centrality, articulation points, vitality) to visualize road importance and removal risk, as the first sub-project of the real-time hazard map feature.

**Architecture:** Move the dataset-agnostic graph logic (`buildGraph.js`, `removalSafety.js`) to `src/shared/graphAnalysis/` so both the existing bus/station feature and the new road graph can use it unmodified. Build a one-time Node.js pipeline (Overpass fetch → OSM-ways-to-graph conversion) that outputs `src/data/roadData.json` in the same `{ stops: [...] }` shape as `busData.json`, so `buildGraphFromLocalData()`/`assessRemovalSafety()` need zero changes. Add a new minimal visualization component, reachable via a lightweight path-based branch in `main.jsx` (no routing library).

**Tech Stack:** React 18, Vite 4, vitest 0.34, graphology, @react-sigma/core, Overpass API

**Spec:** `docs/superpowers/specs/2026-10-15-hazard-map-road-graph-design.md`

## Global Constraints

- `roadData.json` must have the exact shape `{ stops: [{id, name, lat, lng, connectedStopIds}] }` — identical to `busData.json` — so `buildGraphFromLocalData()` and `assessRemovalSafety()` in `src/shared/graphAnalysis/` work completely unmodified.
- Road data is limited to these OSM `highway` values only: `motorway, trunk, primary, secondary, tertiary, unclassified, residential`. Footways, cycleways, service roads, and tracks are excluded.
- No per-edge length/weight is computed or stored — `roadData.json`'s shape has no place for it and nothing downstream consumes it (dropped from the spec during plan-writing; see the spec's data-flow section).
- The Overpass query reuses the Kurume city boundary pattern already established in `src/features/bus-graph/useOverpassBusStops.js`: `KURUME_RELATION_ID = 4008314`, `KURUME_AREA_ID = 3600000000 + KURUME_RELATION_ID`, querying by area id (not by name) to avoid 504/429 errors on the public Overpass instance.
- No routing library (react-router, etc.) is introduced. The dev-time switch between the bus-graph view and the road-graph view is a single `window.location.pathname` check in `main.jsx`.
- `src/features/bus-graph/App.jsx`'s behavior must not change except for its two import paths (Task 1) — no logic changes.
- `fetch_roads.js` and `build_road_graph.js`'s CLI entry point are not unit tested, matching the existing convention for `population_data/scripts/*.js` (manually-run, one-time scripts). Only the pure conversion function `osmWaysToRoadGraph()` is unit tested.

## Review Focus

- A way references a node id that has no matching `type: 'node'` element in the fetched data (a dangling reference — common when Overpass returns a way whose geometry extends slightly outside the requested area). The conversion must skip it, not crash or produce a stop with `NaN`/`undefined` coordinates. Covered in Task 2.
- A node shared between two different ways at a non-endpoint (middle) position — a true T-junction/intersection — must be promoted to a graph node even though it isn't the first/last node of either way. This is the core correctness property of the whole conversion; a bug here silently drops real intersections. Covered in Task 2.
- A way that revisits its own starting node (a short loop, e.g. a roundabout drawn as one way) must not produce a self-loop edge (a stop whose own id appears in its own `connectedStopIds`), which would make `findArticulationPoints`'s DFS over-count degree. Covered in Task 2.
- Visiting any path other than exactly `/hazard-map` (e.g. `/`, a typo, a trailing slash) must still render the existing bus-graph `App`, not a blank page or a crash — the path check must fail safe to the current default behavior. Covered in Task 4.
- The road intersection count after the real Overpass fetch is a four-digit-or-larger number, not zero and not absurdly small — a silent empty or near-empty result (e.g. from a mistyped highway filter or an empty area match) would otherwise look like "it worked" in the UI (empty graph still renders, just with nothing in it). Covered in Task 3's sanity check and Task 4's manual verification.

---

### Task 1: Move graph-analysis logic to `src/shared/graphAnalysis/`

**Files:**
- Move: `src/features/bus-graph/buildGraph.js` → `src/shared/graphAnalysis/buildGraph.js`
- Move: `src/features/bus-graph/buildGraph.test.js` → `src/shared/graphAnalysis/buildGraph.test.js`
- Move: `src/features/bus-graph/removalSafety.js` → `src/shared/graphAnalysis/removalSafety.js`
- Move: `src/features/bus-graph/removalSafety.test.js` → `src/shared/graphAnalysis/removalSafety.test.js`
- Modify: `src/features/bus-graph/App.jsx` (import paths only, lines 6-7)
- Modify: `src/shared/graphAnalysis/buildGraph.js` (label fallback wording, 2 lines — see Step 4)

**Interfaces:**
- Produces: `buildGraphFromLocalData(data, options)`, `buildGraphFromOSM(stopElements, routeElements)`, `scoreToColor(score)` exported from `src/shared/graphAnalysis/buildGraph.js`; `findArticulationPoints(graph)`, `computeVitality(graph)`, `haversineDistance(lat1,lon1,lat2,lon2)`, `assessRemovalSafety(graph, data)` exported from `src/shared/graphAnalysis/removalSafety.js`. Signatures and behavior are unchanged from their current location — Task 2's road-data pipeline and Task 4's `RoadGraphView.jsx` both import from this new path.

- [ ] **Step 1: Create the shared directory and move the files with `git mv`**

```bash
mkdir -p src/shared/graphAnalysis
git mv src/features/bus-graph/buildGraph.js src/shared/graphAnalysis/buildGraph.js
git mv src/features/bus-graph/buildGraph.test.js src/shared/graphAnalysis/buildGraph.test.js
git mv src/features/bus-graph/removalSafety.js src/shared/graphAnalysis/removalSafety.js
git mv src/features/bus-graph/removalSafety.test.js src/shared/graphAnalysis/removalSafety.test.js
```

- [ ] **Step 2: Fix the import paths in `App.jsx`**

In `src/features/bus-graph/App.jsx`, change:

```javascript
import { buildGraphFromLocalData } from './buildGraph.js';
import { assessRemovalSafety } from './removalSafety.js';
```

to:

```javascript
import { buildGraphFromLocalData } from '../../shared/graphAnalysis/buildGraph.js';
import { assessRemovalSafety } from '../../shared/graphAnalysis/removalSafety.js';
```

- [ ] **Step 3: Run the test suite to confirm the move didn't break anything**

```bash
npm test
```

Expected: both test files are discovered at their new path and all 15 tests pass (vitest's default glob matches `**/*.test.js` regardless of directory).

- [ ] **Step 4: Fix the hardcoded bus-stop wording in the dataset-agnostic label fallback**

This label fallback is used by every dataset `buildGraph.js` builds a graph for, including the road-intersection data this plan adds in Task 2-3 (which has no `name`, so this fallback fires for every node). Fix it to use neutral wording instead of "停留所" (bus stop).

In `src/shared/graphAnalysis/buildGraph.js`, change:

```javascript
      label: s.name || `停留所 ${nodeId}`,
```

(inside `buildGraphFromLocalData`) to:

```javascript
      label: s.name || `地点 ${nodeId}`,
```

And change:

```javascript
      label: el.tags?.name || el.tags?.['name:ja'] || `停留所 ${el.id}`,
```

(inside `buildGraphFromOSM`) to:

```javascript
      label: el.tags?.name || el.tags?.['name:ja'] || `地点 ${el.id}`,
```

- [ ] **Step 5: Run the test suite again and build**

```bash
npm test
npm run build
```

Expected: 15/15 tests passing (no test asserts on the old "停留所" fallback text, so this is a safe rename), build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Move graph-analysis logic to src/shared/graphAnalysis/

Pull buildGraph.js and removalSafety.js out of src/features/bus-graph/
into a shared location, since the upcoming road-graph visualization
(hazard-map sub-project) needs the same dataset-agnostic centrality,
articulation-point, and vitality logic. Also fix the node-label
fallback's hardcoded "停留所" (bus stop) wording to the neutral "地点",
since it will now fire for every road intersection (which has no name).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Road-graph conversion logic (`osmWaysToRoadGraph`)

**Files:**
- Create: `src/data/road_data/scripts/build_road_graph.js`
- Create: `src/data/road_data/scripts/build_road_graph.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `osmWaysToRoadGraph(elements)`, a pure function exported from `src/data/road_data/scripts/build_road_graph.js`. Takes an array of OSM elements (a mix of `{type:'node', id, lat, lon}` and `{type:'way', id, nodes: [nodeId,...], tags}`) and returns `{ stops: [{id: string, name: null, lat: number, lng: number, connectedStopIds: string[]}] }`. Task 3's CLI wiring and fetch script read/write the files this function's exported shape feeds into.

- [ ] **Step 1: Write the failing tests**

Create `src/data/road_data/scripts/build_road_graph.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { osmWaysToRoadGraph } from './build_road_graph.js';

describe('osmWaysToRoadGraph', () => {
  it('builds a connection between endpoints, skipping a shape-only intermediate point', () => {
    const elements = [
      { type: 'node', id: 1, lat: 33.000, lon: 130.000 },
      { type: 'node', id: 2, lat: 33.001, lon: 130.001 },
      { type: 'node', id: 3, lat: 33.002, lon: 130.002 },
      { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential' } },
    ];

    const result = osmWaysToRoadGraph(elements);

    const ids = result.stops.map(s => s.id).sort();
    expect(ids).toEqual(['1', '3']);
    const stop1 = result.stops.find(s => s.id === '1');
    const stop3 = result.stops.find(s => s.id === '3');
    expect(stop1.connectedStopIds).toEqual(['3']);
    expect(stop3.connectedStopIds).toEqual(['1']);
  });

  it('promotes a node shared between two ways to a graph node, even at a middle position', () => {
    const elements = [
      { type: 'node', id: 1, lat: 33.000, lon: 130.000 },
      { type: 'node', id: 2, lat: 33.001, lon: 130.001 },
      { type: 'node', id: 3, lat: 33.002, lon: 130.002 },
      { type: 'node', id: 4, lat: 33.003, lon: 130.000 },
      { type: 'node', id: 5, lat: 33.003, lon: 130.002 },
      { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential' } },
      { type: 'way', id: 101, nodes: [4, 2, 5], tags: { highway: 'residential' } },
    ];

    const result = osmWaysToRoadGraph(elements);

    const ids = result.stops.map(s => s.id).sort();
    expect(ids).toEqual(['1', '2', '3', '4', '5']);
    const stop2 = result.stops.find(s => s.id === '2');
    expect(stop2.connectedStopIds.slice().sort()).toEqual(['1', '3', '4', '5']);
  });

  it('skips way-node references with no matching node element', () => {
    const elements = [
      { type: 'node', id: 1, lat: 33.000, lon: 130.000 },
      { type: 'node', id: 3, lat: 33.002, lon: 130.002 },
      // node 2 is referenced by the way but has no corresponding node element
      { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential' } },
    ];

    expect(() => osmWaysToRoadGraph(elements)).not.toThrow();
    const result = osmWaysToRoadGraph(elements);
    const ids = result.stops.map(s => s.id).sort();
    expect(ids).toEqual(['1', '3']);
    expect(result.stops.find(s => s.id === '1').connectedStopIds).toEqual(['3']);
  });

  it('does not create a self-loop when a way revisits its own starting node', () => {
    const elements = [
      { type: 'node', id: 1, lat: 33.000, lon: 130.000 },
      { type: 'node', id: 2, lat: 33.001, lon: 130.001 },
      { type: 'node', id: 3, lat: 33.002, lon: 130.000 },
      { type: 'node', id: 4, lat: 33.003, lon: 130.003 },
      // way 100 is a short loop back to node 1; way 101 connects node 1 to node 4,
      // so node 1 is a real intersection and must still appear in the output
      { type: 'way', id: 100, nodes: [1, 2, 3, 1], tags: { highway: 'residential' } },
      { type: 'way', id: 101, nodes: [1, 4], tags: { highway: 'residential' } },
    ];

    const result = osmWaysToRoadGraph(elements);

    const stop1 = result.stops.find(s => s.id === '1');
    expect(stop1).toBeDefined();
    expect(stop1.connectedStopIds).not.toContain('1');
    expect(stop1.connectedStopIds).toContain('4');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/road_data/scripts/build_road_graph.test.js`
Expected: FAIL — `build_road_graph.js` does not exist yet / `osmWaysToRoadGraph` is not exported.

- [ ] **Step 3: Write the implementation**

Create `src/data/road_data/scripts/build_road_graph.js`:

```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 久留米市の道路網OSM要素(node/way)から、交差点をノード・道路区間をエッジとする
// { stops: [{id, name, lat, lng, connectedStopIds}] } 形式のグラフデータに変換する。
//
// graph node(交差点)になる条件:
//   - wayの端点(最初/最後のノード)、または
//   - 2つ以上のwayに共有されているノード
// それ以外のノードは道路の形状を表す点として扱い、交差点同士を結ぶ際にスキップする。
export function osmWaysToRoadGraph(elements) {
  const nodeById = new Map();
  const ways = [];

  elements.forEach(el => {
    if (el.type === 'node') {
      nodeById.set(el.id, { lat: el.lat, lon: el.lon });
    } else if (el.type === 'way' && Array.isArray(el.nodes)) {
      ways.push(el);
    }
  });

  // 各ノードが何本のwayに現れるか数える(同じway内の重複は1回とする)
  const nodeWayCount = new Map();
  ways.forEach(way => {
    const uniqueNodeIds = new Set(way.nodes);
    uniqueNodeIds.forEach(nodeId => {
      nodeWayCount.set(nodeId, (nodeWayCount.get(nodeId) || 0) + 1);
    });
  });

  const isIntersection = (nodeId, way, index) => {
    if (index === 0 || index === way.nodes.length - 1) return true;
    return (nodeWayCount.get(nodeId) || 0) >= 2;
  };

  const graphNodeIds = new Set();
  const connections = new Map(); // nodeId -> Set(connectedNodeId)

  const addConnection = (a, b) => {
    if (a === b) return;
    graphNodeIds.add(a);
    graphNodeIds.add(b);
    if (!connections.has(a)) connections.set(a, new Set());
    if (!connections.has(b)) connections.set(b, new Set());
    connections.get(a).add(b);
    connections.get(b).add(a);
  };

  ways.forEach(way => {
    let segmentStart = null; // 直前に見つかった交差点のノードID

    for (let i = 0; i < way.nodes.length; i++) {
      const nodeId = way.nodes[i];
      if (!nodeById.has(nodeId)) continue; // 座標が無い(欠損)参照はスキップ

      if (isIntersection(nodeId, way, i)) {
        if (segmentStart !== null && segmentStart !== nodeId) {
          addConnection(segmentStart, nodeId);
        }
        segmentStart = nodeId;
      }
    }
  });

  const stops = Array.from(graphNodeIds).map(nodeId => {
    const coords = nodeById.get(nodeId);
    return {
      id: String(nodeId),
      name: null,
      lat: coords.lat,
      lng: coords.lon,
      connectedStopIds: Array.from(connections.get(nodeId) || []).map(String),
    };
  });

  return { stops };
}

// ===== CLI実行部 =====
// `node build_road_graph.js` のように直接実行された場合のみ、
// osm_roads_raw.json を読み込んで roadData.json を書き出す。
// osmWaysToRoadGraph() をテストからimportするだけではこのブロックは実行されない。
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rawPath = path.join(__dirname, '../osm_roads_raw.json');
  const outPath = path.join(__dirname, '../../roadData.json');
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const roadData = osmWaysToRoadGraph(raw.elements);
  fs.writeFileSync(outPath, JSON.stringify(roadData, null, 2));
  console.log(`Wrote ${roadData.stops.length} intersections to ${outPath}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/road_data/scripts/build_road_graph.test.js`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

```bash
npm test
```

Expected: 15 existing tests (now at `src/shared/graphAnalysis/`) + 4 new tests = 19 passing.

- [ ] **Step 6: Commit**

```bash
git add src/data/road_data/scripts/build_road_graph.js src/data/road_data/scripts/build_road_graph.test.js
git commit -m "$(cat <<'EOF'
Add OSM-ways-to-road-graph conversion logic

osmWaysToRoadGraph() converts raw Overpass way/node elements into the
same { stops: [...] } shape busData.json uses, by promoting way
endpoints and multi-way-shared nodes to graph nodes (intersections)
and connecting them directly, skipping shape-only points in between.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Fetch road data and generate `roadData.json`

**Files:**
- Create: `src/data/road_data/scripts/fetch_roads.js`
- Create (generated, not hand-written): `src/data/road_data/osm_roads_raw.json`
- Create (generated, not hand-written): `src/data/roadData.json`

**Interfaces:**
- Consumes: `osmWaysToRoadGraph(elements)` from Task 2 (`src/data/road_data/scripts/build_road_graph.js`), invoked via that file's own CLI block — this task does not import it directly.
- Produces: `src/data/roadData.json` with shape `{ stops: [...] }`, which Task 4's `RoadGraphView.jsx` imports directly.

- [ ] **Step 1: Write the Overpass fetch script**

Create `src/data/road_data/scripts/fetch_roads.js`:

```javascript
// 久留米市内の主要道路網をOverpass APIから取得する。
// 久留米市の行政境界リレーション(OSM relation id: 4008314)をarea idに変換して
// 直接指定する(area id = 3600000000 + relation id)。名前検索を避けることで、
// 公開Overpassインスタンスでの504/429を防ぐ
// (src/features/bus-graph/useOverpassBusStops.js と同じ方針)。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KURUME_RELATION_ID = 4008314;
const KURUME_AREA_ID = 3600000000 + KURUME_RELATION_ID;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// 車両が使う主要な道路網に絞る(歩道・自転車道・サービス道路は除外)
const HIGHWAY_TYPES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'];

async function fetchRoads() {
  const highwayFilter = HIGHWAY_TYPES.join('|');
  const query = `
    [out:json][timeout:90];
    area(${KURUME_AREA_ID})->.kurume;
    way[highway~"^(${highwayFilter})$"](area.kurume);
    out body;
    >;
    out skel qt;
  `;

  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  return res.json();
}

const outPath = path.join(__dirname, '../osm_roads_raw.json');
const data = await fetchRoads();
fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`Wrote ${data.elements.length} elements to ${outPath}`);
```

- [ ] **Step 2: Run the fetch script**

```bash
mkdir -p src/data/road_data
node src/data/road_data/scripts/fetch_roads.js
```

Expected: prints `Wrote N elements to .../osm_roads_raw.json` with N in at least the low thousands (ways + nodes combined, for Kurume city's road network). If this fails with a network error, an Overpass 429/504, or a timeout: retry once; if it still fails, report BLOCKED with the exact error — do not fabricate or hand-write `osm_roads_raw.json`.

- [ ] **Step 3: Run the conversion script**

```bash
node src/data/road_data/scripts/build_road_graph.js
```

Expected: prints `Wrote N intersections to .../roadData.json` with N clearly greater than zero (sanity check: should be at least in the hundreds for a city the size of Kurume — if N is 0 or under 10, something is wrong with the query or conversion; report DONE_WITH_CONCERNS and show the actual count rather than silently proceeding).

- [ ] **Step 4: Spot-check the output shape**

```bash
node -e "const d = JSON.parse(require('fs').readFileSync('src/data/roadData.json', 'utf8')); console.log(d.stops.length, JSON.stringify(d.stops[0]))"
```

Expected: a stop count matching Step 3's output, and the first stop printed has exactly the fields `id` (string), `name` (null), `lat` (number), `lng` (number), `connectedStopIds` (array of strings).

- [ ] **Step 5: Run the full test suite to confirm nothing broke**

```bash
npm test
```

Expected: still 19/19 passing (this task adds no new tests — `fetch_roads.js` and the CLI invocation are untested by convention, per Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add src/data/road_data/scripts/fetch_roads.js src/data/road_data/osm_roads_raw.json src/data/roadData.json
git commit -m "$(cat <<'EOF'
Fetch Kurume road network and generate roadData.json

fetch_roads.js queries Overpass for motorway/trunk/primary/secondary/
tertiary/unclassified/residential ways inside Kurume city's OSM
boundary (same area-id pattern as useOverpassBusStops.js), and
build_road_graph.js's CLI entry converts the raw result into
roadData.json via osmWaysToRoadGraph().

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Road-graph visualization UI

**Files:**
- Create: `src/features/hazard-map/RoadGraphView.jsx`
- Modify: `src/main.jsx` (add the dev-time path switch)
- Modify: `src/features/hazard-map/README.md` (replace placeholder with this sub-project's status)

**Interfaces:**
- Consumes: `roadData.json` from Task 3 (`src/data/roadData.json`), `buildGraphFromLocalData`/`assessRemovalSafety` from Task 1 (`src/shared/graphAnalysis/`).
- Produces: `RoadGraphView` (default export) from `src/features/hazard-map/RoadGraphView.jsx`, mounted by `src/main.jsx` when `window.location.pathname === '/hazard-map'`.

- [ ] **Step 1: Create the road-graph view component**

Create `src/features/hazard-map/RoadGraphView.jsx`:

```javascript
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { SigmaContainer, useRegisterEvents, useSigma } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import roadData from '../../data/roadData.json';
import { buildGraphFromLocalData } from '../../shared/graphAnalysis/buildGraph.js';
import { assessRemovalSafety } from '../../shared/graphAnalysis/removalSafety.js';

// ===== ホバー時のみ表示するラベル（背景ボックス付き） =====
function drawHoverLabel(context, data, settings) {
  if (!data.label) return;
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  context.font = `${weight} ${size}px ${font}`;

  const paddingX = 5, paddingY = 3;
  const textWidth = context.measureText(data.label).width;
  const boxX = data.x + data.size + 4;
  const boxY = data.y - size / 2 - paddingY;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = size + paddingY * 2;

  context.fillStyle = 'rgba(11,15,25,0.82)';
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(boxX - paddingX, boxY, boxWidth, boxHeight, 4);
  } else {
    context.rect(boxX - paddingX, boxY, boxWidth, boxHeight);
  }
  context.fill();

  context.fillStyle = '#f8fafc';
  context.fillText(data.label, boxX, data.y + size / 3);
}

function GraphEvents({ onNodeClick, onStageClick }) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();

  useEffect(() => {
    registerEvents({
      clickNode: (e) => {
        const attrs = sigma.getGraph().getNodeAttributes(e.node);
        onNodeClick({ ...attrs, id: e.node });
      },
      clickStage: () => onStageClick(),
    });
  }, [registerEvents, sigma, onNodeClick, onStageClick]);

  return null;
}

const SAFETY_STYLE = {
  safe: { label: '安全', color: '#4ade80' },
  caution: { label: '注意', color: '#fbbf24' },
  unsafe: { label: '危険', color: '#f87171' },
};
const SAFETY_LEVEL_ORDER = { unsafe: 2, caution: 1, safe: 0 };

export default function RoadGraphView() {
  const [graph, setGraph] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);

  const load = useCallback(() => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const g = buildGraphFromLocalData(roadData, { layout: 'geo' });
      setGraph(g);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message);
      setStatus('error');
    }
  }, []);

  const removalSafety = useMemo(() => {
    if (!graph) return null;
    return assessRemovalSafety(graph, roadData);
  }, [graph]);

  const ranking = useMemo(() => {
    if (!graph) return [];
    const arr = [];
    graph.forEachNode((node, attrs) => {
      arr.push({ id: node, label: attrs.label, color: attrs.color, score: Math.round(attrs.importance * 100) });
    });
    arr.sort((a, b) => b.score - a.score);
    return arr;
  }, [graph]);

  const dangerRanking = useMemo(() => {
    if (!graph || !removalSafety) return [];
    const arr = [];
    graph.forEachNode((node, attrs) => {
      const safety = removalSafety[node];
      if (!safety) return;
      arr.push({ id: node, label: attrs.label, level: safety.level, vitality: safety.vitality });
    });
    arr.sort((a, b) => SAFETY_LEVEL_ORDER[b.level] - SAFETY_LEVEL_ORDER[a.level] || b.vitality - a.vitality);
    return arr;
  }, [graph, removalSafety]);

  const handleSelectFromRanking = (nodeId) => {
    if (!graph) return;
    setSelectedNode({ ...graph.getNodeAttributes(nodeId), id: nodeId });
  };

  const badgeLabel = {
    idle: '未読込',
    loading: '読込中',
    done: graph ? `${graph.order}交差点` : '読込済',
    error: 'エラー',
  }[status] ?? '読込中';

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>久留米市 道路網グラフ（ハザードマップ基盤）</span>
        <span style={styles.badge}>{badgeLabel}</span>
        <button onClick={load} disabled={status === 'loading'} style={styles.loadBtn}>
          {status === 'loading' ? '読込中...' : 'データ読込・描画'}
        </button>
      </div>

      <div style={styles.main}>
        <div style={styles.leftPanel}>
          <p style={styles.sectionTitle}>凡例</p>
          <p style={styles.legendDesc}>円の色・大きさ = 重要度スコア（次数中心性・媒介中心性）</p>
          <div style={styles.legendGrad} />
          <div style={styles.legendLabels}><span>低</span><span>高</span></div>
        </div>

        <div style={styles.sigmaWrapper}>
          {status === 'idle' && (
            <div style={styles.placeholder}>
              <p style={styles.placeholderTitle}>「データ読込・描画」を押してください</p>
              <p style={styles.placeholderSub}>
                roadData.json から道路交差点ネットワークを読み込み、<br />
                重要度・削除安全度を可視化します
              </p>
            </div>
          )}
          {status === 'loading' && (
            <div style={styles.placeholder}>
              <p style={styles.placeholderSub}>読込中...</p>
            </div>
          )}
          {status === 'error' && (
            <div style={styles.placeholder}>
              <p style={{ color: '#ef4444', fontWeight: 500 }}>エラー: {errorMsg}</p>
              <button onClick={load} style={styles.loadBtn}>再試行</button>
            </div>
          )}
          {status === 'done' && graph && (
            <SigmaContainer
              graph={graph}
              style={{ width: '100%', height: '100%', background: 'transparent' }}
              settings={{
                defaultNodeColor: '#3b82f6',
                defaultEdgeColor: '#334155',
                renderLabels: false,
                labelFont: 'system-ui, sans-serif',
                labelSize: 12,
                labelWeight: '600',
                labelColor: { color: '#f8fafc' },
                defaultDrawNodeHover: drawHoverLabel,
                minEdgeThickness: 0.5,
                maxEdgeThickness: 2,
                renderEdgeLabels: false,
                enableEdgeEvents: false,
                nodeReducer: (node, data) => {
                  if (selectedNode && node === selectedNode.id) {
                    return { ...data, color: '#fef08a', size: data.size + 8, forceLabel: true, zIndex: 1 };
                  }
                  return data;
                },
              }}
            >
              <GraphEvents
                onNodeClick={attrs => setSelectedNode(attrs)}
                onStageClick={() => setSelectedNode(null)}
              />
            </SigmaContainer>
          )}
        </div>

        <div style={styles.rightPanel}>
          {ranking.length > 0 && (
            <div>
              <p style={styles.sectionTitle}>重要度ランキング</p>
              <div style={styles.rankingList}>
                {ranking.slice(0, 15).map((n, i) => (
                  <div key={n.id} style={styles.rankingRow} onClick={() => handleSelectFromRanking(n.id)}>
                    <span style={styles.rankNum}>{i + 1}</span>
                    <span style={{ ...styles.rankDot, background: n.color }} />
                    <span style={styles.rankName}>{n.label}</span>
                    <span style={styles.rankScore}>{n.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dangerRanking.length > 0 && (
            <div>
              <p style={styles.sectionTitle}>危険度ランキング（関節点・Vitality）</p>
              <div style={styles.rankingList}>
                {dangerRanking.slice(0, 15).map((n, i) => {
                  const s = SAFETY_STYLE[n.level];
                  return (
                    <div key={n.id} style={styles.rankingRow} onClick={() => handleSelectFromRanking(n.id)}>
                      <span style={styles.rankNum}>{i + 1}</span>
                      <span style={{ ...styles.rankDot, background: s.color }} />
                      <span style={styles.rankName}>{n.label}</span>
                      <span style={{ ...styles.rankScore, color: s.color }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', width: '100vw',
    background: '#0b0f19', color: '#e2e8f0',
    fontFamily: 'system-ui, sans-serif', fontSize: 13,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '18px 28px', flexShrink: 0,
  },
  headerTitle: { fontWeight: 700, fontSize: 19, color: '#f8fafc' },
  badge: {
    background: 'rgba(217,119,6,0.15)',
    border: '1px solid rgba(217,119,6,0.5)',
    color: '#fbbf24', borderRadius: 4,
    padding: '3px 10px', fontSize: 12, fontWeight: 500,
  },
  loadBtn: {
    marginLeft: 'auto', padding: '6px 16px',
    background: '#3b82f6', color: '#fff',
    border: 'none', borderRadius: 6,
    cursor: 'pointer', fontWeight: 500, fontSize: 13,
  },
  main: { display: 'flex', flex: 1, overflow: 'hidden' },
  leftPanel: {
    width: 260, flexShrink: 0,
    borderRight: '1px solid rgba(148,163,184,0.12)',
    padding: 24, overflowY: 'auto',
  },
  rightPanel: {
    width: 320, flexShrink: 0,
    borderLeft: '1px solid rgba(148,163,184,0.12)',
    padding: 24, overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 20,
  },
  sectionTitle: { margin: '0 0 16px', fontWeight: 600, fontSize: 13, color: '#cbd5e1' },
  legendDesc: { margin: '0 0 10px', fontSize: 12, color: '#64748b' },
  legendGrad: {
    height: 10, borderRadius: 5,
    background: 'linear-gradient(to right, #38bdf8, #2dd4bf, #ca8a04, #f97316)',
  },
  legendLabels: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 11, color: '#64748b', marginTop: 4,
  },
  sigmaWrapper: {
    flex: 1, position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0b0f19',
    backgroundImage:
      'linear-gradient(rgba(148,163,184,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.07) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
  },
  placeholder: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12,
    color: '#64748b', textAlign: 'center',
  },
  placeholderTitle: { fontSize: 16, fontWeight: 500, color: '#94a3b8', margin: 0 },
  placeholderSub: { fontSize: 13, lineHeight: 1.7, margin: 0, color: '#475569' },
  rankingList: { display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto' },
  rankingRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 0', borderBottom: '1px solid rgba(148,163,184,0.06)',
    cursor: 'pointer',
  },
  rankNum: { width: 16, color: '#64748b', fontSize: 12, textAlign: 'right' },
  rankDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  rankName: { flex: 1, color: '#e2e8f0', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rankScore: { color: '#f1f5f9', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
};
```

- [ ] **Step 2: Add the dev-time path switch to `main.jsx`**

In `src/main.jsx`, change:

```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './features/bus-graph/App.jsx';

// スピナーアニメーション
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { overflow: hidden; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

to:

```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './features/bus-graph/App.jsx';
import RoadGraphView from './features/hazard-map/RoadGraphView.jsx';

// スピナーアニメーション
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { overflow: hidden; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

// 開発用の最小限の画面切り替え: /hazard-map を開くと道路グラフ画面、
// それ以外は従来通りバス停/駅グラフ画面を表示する。
// 本格的なUI統合(タブ切り替え等)は別サブプロジェクトで決定する。
const RootComponent = window.location.pathname === '/hazard-map' ? RoadGraphView : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
```

- [ ] **Step 3: Update the hazard-map placeholder README**

Replace the full contents of `src/features/hazard-map/README.md` with:

```markdown
# hazard-map

This directory holds the real-time hazard map feature (shelter info,
road conditions, river conditions, location risk scoring, and routing
to the nearest shelter), built as a series of sub-projects.

## Sub-projects

- **Road graph (done):** `RoadGraphView.jsx` graphs the Kurume road
  network (OSM) and reuses `src/shared/graphAnalysis/` (centrality,
  articulation points, vitality) to visualize road importance and
  removal risk. See
  `docs/superpowers/specs/2026-10-15-hazard-map-road-graph-design.md`.
  Reachable at `/hazard-map` during development (see `src/main.jsx`).
- **River/shelter data integration, risk scoring, route calculation:**
  not started — each gets its own brainstorming session, spec, and plan.
```

- [ ] **Step 4: Run the full test suite and build**

```bash
npm test
npm run build
```

Expected: 19/19 tests passing, build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/hazard-map/RoadGraphView.jsx src/main.jsx src/features/hazard-map/README.md
git commit -m "$(cat <<'EOF'
Add road-graph visualization UI at /hazard-map

RoadGraphView.jsx reuses buildGraphFromLocalData/assessRemovalSafety
from src/shared/graphAnalysis/ to render the Kurume road network with
importance-based coloring and a removal-danger ranking, matching the
existing bus/station graph's visual style. main.jsx switches to it
when the path is /hazard-map; no routing library is introduced.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Manual visual verification

**Files:**
- None (verification only; fix-forward into Task 4's files if an issue is found, no new files)

**Interfaces:**
- Consumes: the running app produced by Tasks 1-4.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: Vite starts with no errors, printing a local URL (default `http://localhost:5173`).

- [ ] **Step 2: Verify the default path still shows the bus-graph app**

Open the printed URL (e.g. `http://localhost:5173/`). Expected: the existing bus-stop/station graph app renders exactly as before (dataset toggle, sliders, map).

- [ ] **Step 3: Verify `/hazard-map` shows the road graph**

Open `http://localhost:5173/hazard-map`. Click "データ読込・描画". Expected: the road network renders as a graph of intersections and connecting edges, colored by importance score (blue→orange gradient), with the 重要度ランキング and 危険度ランキング panels populated on the right. The badge in the header should show a non-trivial intersection count (matching Task 3's generated `roadData.json`).

- [ ] **Step 4: Verify a mistyped/other path still falls back to the bus-graph app**

Open `http://localhost:5173/hazard-map/` (trailing slash) and `http://localhost:5173/some-other-path`. Expected: both render the bus-graph app (the `main.jsx` check is an exact string match, so anything other than exactly `/hazard-map` falls back safely — per this plan's Review Focus).

- [ ] **Step 5: Click a node in the road graph and confirm the danger ranking is consistent**

Click a highly-ranked node from the 危険度ランキング list in `/hazard-map`. Expected: no console errors; the clicked node highlights on the graph.

- [ ] **Step 6: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 7: If any issue was found, fix it in the relevant Task 1/3/4 file and re-run Steps 1-6; otherwise this task needs no commit.**
