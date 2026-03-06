# Frontend KB-First Flow & Data Visibility Design

## Problem

The frontend has three modules (Generate, Retrievers, Experiments) that operate as isolated state islands with no cross-page context sharing. Key issues:

1. **Generation page**: No way to view existing datasets for a KB — can only create new ones
2. **Experiments page**: No KB selector — retriever selection implicitly determines KB, making the flow unintuitive
3. **No URL-based state**: No query parameters, so navigating between pages loses context
4. **No batch experiments**: Can only run one retriever at a time

## Decisions

- **Architecture**: URL query params (`?kb=<kbId>`) as the sole cross-page state mechanism. No React Context or shared state providers. Each page remains self-contained.
- **Experiment display**: Progressive reveal — show experiments at KB level, filter by dataset, further filter by retriever.
- **Multi-retriever**: Batch run (N separate experiments) with multi-select UI. No pairwise comparison yet.
- **Dataset viewing**: Browse existing datasets on generation page with read-only question display.
- **Backend**: Denormalize `kbId` into experiments table for direct querying.

## Design

### 1. URL Parameter Convention

All three pages read/write `?kb=<kbId>`:

- `/generate?kb=<kbId>` — pre-selects KB on generation page
- `/retrievers?kb=<kbId>` — pre-selects KB on retrievers page
- `/experiments?kb=<kbId>` — pre-selects KB on experiments page

Behavior:
- On mount: read `?kb=` param, validate it's a real KB in the org, auto-select
- On KB change: update URL param via `router.replace()` (no history push)
- Invalid/missing param: fall back to no selection
- Cross-page links include current KB: "Create Dataset" → `/generate?kb=<id>`

### 2. Generation Page — Dataset Browser

**Two modes** controlled by local state:

**Browse mode** (default when datasets exist for selected KB):
- Left sidebar shows KB selector + list of existing datasets (from `datasets.byKb(kbId)`)
- Each dataset card: name, question count, strategy, creation date
- Clicking a dataset loads its questions into QuestionList (read-only)
- "+ New Dataset" button switches to generate mode

**Generate mode** (clicking "+ New Dataset" or when no datasets exist):
- Identical to current behavior: strategy selector, config, generate button
- Questions populate as generation runs
- After generation completes, new dataset appears in browse mode

Center panel (QuestionList) and right panel (DocumentViewer) work the same in both modes — the only difference is whether questions are loaded from an existing dataset or being generated live.

### 3. Experiments Page — KB-First Redesign

**Sidebar flow (progressive reveal, top to bottom):**

1. **KB Selector** — same component as other pages
2. **Dataset Selector** — dropdown from `datasets.byKb(kbId)`, shows name + question count. Empty state: "No datasets" + link to `/generate?kb=<id>`
3. **Retriever Selector** — multi-select checkboxes from `retrievers.byKb(kbId)` filtered to status="ready". Empty state: "No retrievers" + link to `/retrievers?kb=<id>`
4. **Experiment Config** — metrics checkboxes + auto-generated name + "Run Experiment(s)" button

**Main content — progressive experiment display:**

| Selection State | Experiments Shown |
|----------------|-------------------|
| KB only | All experiments for that KB (via `experiments.byKb(kbId)`) |
| KB + Dataset | Experiments for that dataset (via `experiments.byDataset(datasetId)`) |
| KB + Dataset + Retriever(s) | Client-side filter to selected retriever(s) |

**Experiment results table columns:**
- Name, Retriever, Dataset, Status, Scores (recall/precision/iou/f1), LangSmith link, Created

**Batch run:**
- Multi-select retrievers → "Run Experiments" calls `experiments.start()` N times
- Each experiment runs independently
- Results appear progressively as each completes

### 4. Retrievers Page — Minimal Changes

Only change: read `?kb=` query param on mount and auto-select KB. Update URL when KB changes. No other modifications.

### 5. Backend Changes

**Schema change:**
- Add `kbId: v.id("knowledgeBases")` to experiments table
- Add `by_kb` index on `(kbId)`
- Populate `kbId` in `experiments.start` mutation (already has access via dataset lookup)

**New query:**
- `experiments.byKb(kbId)` — list experiments by KB using the new `by_kb` index

**No other backend changes.** Batch runs use existing `experiments.start()` called N times.

## Out of Scope

- Pairwise experiment comparison (LangSmith `evaluateComparative()`)
- Retriever page redesign (already works well)
- Strategy configuration changes
- New batch mutation (use existing `start()` N times)
- Passing dataset/retriever IDs in URL params (only KB ID)
