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
