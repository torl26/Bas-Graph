# Directory Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the flat root-level bus-graph source and data files into a `src/` tree organized by feature (`src/features/bus-graph/`, a placeholder `src/features/hazard-map/`) and shared data (`src/data/`), with no behavior change.

**Architecture:** This is a pure file-move + import-path-fix refactor. No new abstractions, no logic changes. `App.jsx` moves unmodified into `src/features/bus-graph/`; data JSON files move unmodified into `src/data/`; `main.jsx` moves to `src/main.jsx` and its only change is the `App` import path; `index.html`'s script tag is updated to point at the new `main.jsx` location.

**Tech Stack:** React 18, Vite 4, vitest 0.34

**Spec:** `docs/superpowers/specs/2026-10-15-directory-restructure-design.md`

## Global Constraints

- No changes to `App.jsx`'s internal logic, structure, or behavior — only its file location and its two data-import paths.
- No changes to `docs/`, `README.md`, `ALGORITHMS.md`, `PDCA_PLAN.md` content or location.
- No changes to `vite.config.js` or `package.json` (no aliases, no new scripts) — Vite resolves `src/` paths via normal relative imports, no alias needed.
- Use `git mv` for every file move, never plain `mv` + `git add`, so file history is preserved (`git log --follow` still works).
- `population_data/scripts/assign_population.js` and `reverse_geocode.js` resolve `busData.json` via `__dirname`-relative paths (e.g. `DATA_DIR/../busData.json`). Since `population_data/` and `busData.json` move together into `src/data/`, these paths do not need editing — confirmed in the spec.

## Review Focus

- `index.html`'s `<script>` tag still pointing at the old `/main.jsx` after the move → blank page on `npm run dev` / `npm run build` preview. Covered by Task 1 Step 8's build check.
- `App.jsx`'s `./busData.json` / `./stationData.json` imports left unchanged after the file moves to a new directory depth → Vite build fails with "file not found". Covered by Task 1 Step 5 and the build check in Step 9.
- Test files (`buildGraph.test.js`, `removalSafety.test.js`) losing their relative import to the sibling file they test, if moved separately from it → covered by moving each test file in the same `git mv` batch as its source file (Task 1 Step 3), and by running the full test suite in Step 10.
- `population_data/scripts/*.js` relative-path assumptions silently breaking since they're never exercised by `npm test` or `npm run build` (they're run manually, outside the normal pipeline) → explicitly re-derived and confirmed safe in Task 1 Step 2, with the arithmetic shown.
- Leftover stale build artifacts in `dist/` (from before the move) making a broken build look like it succeeded, because old output is still on disk → Task 1 Step 9 clears `dist/` before building.

---

### Task 1: Move files into `src/` and fix all references

**Files:**
- Create: `src/features/bus-graph/` (via `git mv`), `src/features/hazard-map/README.md`, `src/data/` (via `git mv`)
- Move: `App.jsx`, `buildGraph.js`, `buildGraph.test.js`, `removalSafety.js`, `removalSafety.test.js`, `useOverpassBusStops.js` → `src/features/bus-graph/`
- Move: `main.jsx` → `src/main.jsx`
- Move: `busData.json`, `stationData.json`, `osm_bbox.json`, `osm_kurume.json`, `population_data/` → `src/data/`
- Modify: `src/features/bus-graph/App.jsx` (import paths only), `src/main.jsx` (import path only), `index.html` (script `src` only)

**Interfaces:**
- Produces: the app's entry point is `src/main.jsx`, which renders `App` imported from `./features/bus-graph/App.jsx`. `index.html` loads `/src/main.jsx`. This is the final state later tasks (and any future hazard-map work) build from.

- [ ] **Step 1: Create the new directory skeleton**

```bash
mkdir -p src/features/bus-graph src/features/hazard-map src/data
```

- [ ] **Step 2: Confirm the population_data script path arithmetic before moving (sanity check, no file changes)**

Both scripts resolve `busData.json` relative to their own file location:
- `assign_population.js`: `__dirname` = `population_data/scripts`, `DATA_DIR` = `path.join(__dirname, '..')` = `population_data`, `BUSDATA_PATH` = `path.join(DATA_DIR, '../busData.json')` = `population_data/../busData.json` = (repo root)/`busData.json`.
- `reverse_geocode.js`: `path.join(__dirname, '../../busData.json')` = `population_data/scripts/../../busData.json` = (repo root)/`busData.json`.

After this task, `population_data/` and `busData.json` both live under `src/data/`, at the same two-levels-up relationship (`src/data/population_data/scripts/../../busData.json` = `src/data/busData.json`). The relative arithmetic is unchanged, so no edits are needed in either script. (This step is a verification note only — nothing to run.)

- [ ] **Step 3: Move the bus-graph feature files with `git mv`**

```bash
git mv App.jsx src/features/bus-graph/App.jsx
git mv buildGraph.js src/features/bus-graph/buildGraph.js
git mv buildGraph.test.js src/features/bus-graph/buildGraph.test.js
git mv removalSafety.js src/features/bus-graph/removalSafety.js
git mv removalSafety.test.js src/features/bus-graph/removalSafety.test.js
git mv useOverpassBusStops.js src/features/bus-graph/useOverpassBusStops.js
git mv main.jsx src/main.jsx
```

- [ ] **Step 4: Move the data files with `git mv`**

```bash
git mv busData.json src/data/busData.json
git mv stationData.json src/data/stationData.json
git mv osm_bbox.json src/data/osm_bbox.json
git mv osm_kurume.json src/data/osm_kurume.json
git mv population_data src/data/population_data
```

- [ ] **Step 5: Fix the data-import paths in `App.jsx`**

In `src/features/bus-graph/App.jsx`, change:

```javascript
import busData from './busData.json';
import stationData from './stationData.json';
```

to:

```javascript
import busData from '../../data/busData.json';
import stationData from '../../data/stationData.json';
```

Leave the `./buildGraph.js` and `./removalSafety.js` imports unchanged — those files moved into the same directory as `App.jsx`, so the relative path still holds.

- [ ] **Step 6: Fix the `App` import path in `main.jsx`**

In `src/main.jsx`, change:

```javascript
import App from './App.jsx';
```

to:

```javascript
import App from './features/bus-graph/App.jsx';
```

- [ ] **Step 7: Fix the entry script path in `index.html`**

In `index.html`, change:

```html
<script type="module" src="/main.jsx"></script>
```

to:

```html
<script type="module" src="/src/main.jsx"></script>
```

- [ ] **Step 8: Create the hazard-map placeholder**

Create `src/features/hazard-map/README.md`:

```markdown
# hazard-map (placeholder)

This directory is reserved for the upcoming real-time hazard map feature
(shelter info, road conditions, river conditions, location risk scoring,
and routing to the nearest shelter). No code lives here yet — see
`docs/superpowers/specs/2026-10-15-directory-restructure-design.md` for
the directory-layout rationale. The feature itself will get its own
brainstorming session, spec, and plan when work on it starts.
```

- [ ] **Step 9: Clear stale build output and run a clean build**

```bash
rm -rf dist
npm run build
```

Expected: build completes with no errors, and `dist/index.html` / `dist/assets/*.js` are regenerated.

- [ ] **Step 10: Run the test suite**

```bash
npm test
```

Expected: all existing tests in `src/features/bus-graph/buildGraph.test.js` and `src/features/bus-graph/removalSafety.test.js` are discovered and pass (vitest's default test glob matches `**/*.test.js` regardless of directory depth, so no vitest config change is needed).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Restructure into src/features and src/data ahead of hazard-map work

Move the flat root-level bus-graph source and data files into
src/features/bus-graph/ and src/data/, with a src/features/hazard-map/
placeholder, to give the upcoming real-time hazard map feature a clean
home without disturbing the existing app's behavior.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Manual visual verification

**Files:**
- None (verification only; fix-forward into Task 1's files if an issue is found, no new files)

**Interfaces:**
- Consumes: the running app produced by Task 1.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: Vite starts and prints a local URL (default `http://localhost:5173`), with no error about `/src/main.jsx` or missing modules.

- [ ] **Step 2: Open the app in a browser and check the bus-stop dataset**

Open the printed URL. Expected: the graph renders with bus-stop nodes (not a blank page), the left panel shows the dataset toggle, and the importance-weight sliders are visible and change node sizing/color when dragged.

- [ ] **Step 3: Switch to the station dataset and check the map/network toggle**

Use the dataset switcher to load station data, and toggle between map mode and network (ForceAtlas2) mode. Expected: both render without console errors.

- [ ] **Step 4: Check removal-safety judgment on a node**

Click a node and confirm the removal-safety panel shows a 安全/注意/危険 judgment (exercises `removalSafety.js` after its move).

- [ ] **Step 5: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 6: If any issue was found, fix it in the relevant Task 1 file and re-run Steps 1–5; otherwise this task needs no commit.**
