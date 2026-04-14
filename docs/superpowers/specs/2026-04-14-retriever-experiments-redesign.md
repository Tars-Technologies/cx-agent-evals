# Retriever Experiments Redesign — Design Spec

## Problem

The current experiments system creates one experiment record per retriever. Running 3 retrievers produces 3 separate experiment rows with no grouping concept. Scores are shown as decimals with all 4 metrics equally weighted. There is no ranking, no contest-like UI, and no clear answer to "which retriever is best?"

## Goals

1. Group multiple retriever evaluations into a single **experiment run**
2. Rank retrievers by a weighted composite score and present results in an **Olympic podium-style UI**
3. Add experiment functionality **directly to the Retrievers page** (as a second mode alongside the existing create/inspect flow)
4. Keep the standalone Experiments page untouched (it serves agent experiments)

## Non-Goals

- Agent experiments — deferred, existing functionality left as-is
- Per-question drill-down UI (View Details) — placeholder only, built later
- LangSmith integration changes — experiment runs still sync to LangSmith via the existing mechanism

---

## Data Model

### New Table: `experimentRuns`

A parent table that groups multiple experiments under one run.

```
experimentRuns: defineTable({
  orgId: v.string(),
  kbId: v.id("knowledgeBases"),
  datasetId: v.id("datasets"),
  name: v.string(),
  retrieverIds: v.array(v.id("retrievers")),
  metricNames: v.array(v.string()),
  scoringWeights: v.object({
    recall: v.number(),
    precision: v.number(),
  }),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("completed_with_errors"),
    v.literal("failed"),
    v.literal("canceling"),
    v.literal("canceled"),
  ),
  totalRetrievers: v.number(),
  completedRetrievers: v.number(),
  failedRetrievers: v.number(),
  winnerId: v.optional(v.id("retrievers")),
  winnerName: v.optional(v.string()),
  winnerScore: v.optional(v.number()),
  error: v.optional(v.string()),
  createdBy: v.id("users"),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_org", ["orgId"])
  .index("by_kb", ["kbId"])
  .index("by_dataset", ["datasetId"])
```

### Changes to Existing `experiments` Table

Add an optional field linking each experiment to its parent run:

```
experimentRunId: v.optional(v.id("experimentRuns")),
```

Existing experiments without this field continue to work unchanged (backwards compatible).

---

## Scoring & Ranking

### Composite Score Formula

```
score = (weights.recall × recall) + (weights.precision × precision)
```

- **Default weights**: `{ recall: 0.7, precision: 0.3 }`
- Weights are stored per experiment run (configurable at creation time)
- Displayed as percentages (e.g., "87.3%" not "0.873")

### Ranking

Retrievers are ranked by composite score (descending). The top retriever is the "winner" — stored as `winnerId` + `winnerScore` on the experiment run for quick display in lists.

---

## Retrievers Page Redesign

### Page Modes

The Retrievers page gains a **Create / Experiment** toggle in the top row. This controls which mode the page is in.

### Top Row Layout (left to right)

1. **Create / Experiment** toggle (far left)
2. Separator
3. **KB dropdown** (always visible)
4. **Create mode only**: Retriever dropdown (select an existing retriever to inspect)
5. Spacer
6. **Primary button** (far right):
   - Create mode: "Create Retriever" (opens wizard modal)
   - Experiment mode: "Create Experiment" (opens experiment config modal)

### Create Mode

Same as current Retrievers page but without the sidebar:
- Retriever selected via dropdown in top row
- Tab bar: **Index**, **Query + Search**, **Refine**, **Playground**
- Full-width tab content area

### Experiment Mode

**Left sidebar (280px):**
- List of past experiment runs for the selected KB
- Each entry shows: name, retriever count, question count, date, winner name + score, status indicator
- Clicking an experiment shows its results in the main area
- One experiment visible at a time

**Main area:**
- Header: experiment name, dataset info, retriever count, date
- Results visualization (varies by retriever count — see below)
- Full results table: ALL retrievers ranked, with columns: Rank, Retriever, Recall, Precision, Score, View Details
- View Details button: expands a placeholder panel below the table (per-question drill-down built later)

---

## Results Visualization States

### 1 Retriever — Solo Card

Centered card with:
- "Retriever Score" label
- Retriever name
- Large composite score
- Recall and Precision values

### 2 Retrievers — Head-to-Head

Side-by-side cards:
- Winner (left): accent border, "Winner" badge, score, "+X% ahead" delta badge
- Runner-up (right): muted styling, "2nd" badge
- "vs" divider between cards

### 3+ Retrievers — Olympic Podium

Three podium slots with pedestals of different heights:
- 2nd place (left, medium pedestal)
- 1st place (center, tallest pedestal) — gold/accent coloring
- 3rd place (right, shortest pedestal) — bronze coloring

Each slot shows: medal label, retriever name, composite score, recall + precision breakdown.

### 4+ Retrievers — Podium + Table

Podium shows top 3 only. Full ranked table below includes ALL retrievers (including top 3) with View Details buttons.

---

## Create Experiment Modal

Triggered by "Create Experiment" button in experiment mode. Fields:

1. **Experiment Name** — text input (auto-suggested: "{KB name} comparison")
2. **Dataset** — dropdown (datasets for selected KB)
3. **Retrievers** — multi-select checkboxes (ready retrievers for selected KB)
4. **Metrics** — checkboxes: Recall (default on), Precision (default on), F1, IoU. All selected metrics are computed and stored. F1 and IoU are **display-only** — shown in the results table as additional columns but not used in ranking. At least Recall or Precision must be selected (they feed the ranking formula).
5. **Ranking Formula** — two number inputs for weights (default 0.7 recall, 0.3 precision), must sum to 1.0. Only Recall and Precision participate in ranking.

On submit: creates the `experimentRun` record, then creates one `experiment` per selected retriever (linked via `experimentRunId`), triggers evaluation.

---

## Backend Changes

### New Functions

- `experimentRuns.create` — mutation: validates inputs, creates run + child experiments, schedules evaluation
- `experimentRuns.byKb` — query: list runs for a KB (for sidebar)
- `experimentRuns.get` — query: get run with child experiment scores
- `experimentRuns.updateStatus` — internal mutation: called as child experiments complete
- `experimentRuns.onChildComplete` — internal mutation: checks if all children done, computes rankings, sets winner

### Orchestration Flow

1. `experimentRuns.create` (public mutation with auth) inserts the parent `experimentRun` record, then **directly inserts** child `experiments` rows (setting `experimentRunId`, `retrieverId`, `datasetId`, `metricNames` from the run, `status: "pending"`, and `createdBy` from the current auth context). It then schedules one `internal.experiments.actions.runExperiment` per child via `ctx.scheduler.runAfter(0, ...)` — this reuses the **full existing pipeline** (retriever config loading, indexing verification, LangSmith dataset sync, status phase updates, WorkPool enqueue). The only difference from the standalone flow is that child experiments have `experimentRunId` set.
2. Each child experiment goes through the complete existing pipeline: `runExperiment` action → loads retriever config → checks indexing → syncs LangSmith → calls `enqueueExperiment` → WorkPool runs `runEvaluation`. The existing `experimentPool` has `maxParallelism: 1`, so children serialize through the WorkPool.
3. The existing `onExperimentComplete` callback fires when each child experiment finishes. A new check is added there: if the experiment has an `experimentRunId`, it additionally calls `internal.experimentRuns.onChildComplete` to update the parent run's progress.
4. `experimentRuns.onChildComplete` increments `completedRetrievers` (or `failedRetrievers`). When all children are done: queries all child experiment scores, computes composite scores using the run's `scoringWeights`, determines the winner, and patches the run with `winnerId`, `winnerName`, `winnerScore`, `status: "completed"`, and `completedAt`.

### Existing Code Untouched

- Standalone Experiments page and its queries/mutations
- Agent experiment flow (`startAgentExperiment`, `agentActions`, `agentResults`)
- LangSmith sync mechanism

---

## Frontend Changes

### Modified Files

- `packages/frontend/src/app/retrievers/page.tsx` — add mode toggle, experiment mode, top row restructure
- `packages/frontend/src/components/Header.tsx` — no changes (Experiments nav link stays)

### New Components

- `ExperimentSidebar.tsx` — experiment run list for sidebar
- `ExperimentResults.tsx` — podium + table + detail placeholder
- `PodiumView.tsx` — Olympic podium visualization (1/2/3+ states)
- `CreateExperimentModal.tsx` — modal form for experiment creation
- `HeadToHeadView.tsx` — 2-retriever comparison layout
- `SoloScoreCard.tsx` — 1-retriever result display

### Design Tokens

Uses existing app theme:
- Background: `bg` (#0c0c0f), `bg-elevated` (#141419), `bg-surface` (#1a1a22)
- Accent: `accent` (#6ee7b7) for winner/1st place
- Gold: #fbbf24 (1st medal), Silver: #94a3b8 (2nd medal), Bronze: #d97706 (3rd medal)
- Font: JetBrains Mono throughout
- Scores displayed as percentages

---

## Migration & Compatibility

- New `experimentRuns` table is additive — no existing data affected
- Optional `experimentRunId` field on `experiments` is backwards compatible
- Existing experiments (without `experimentRunId`) continue to display on the standalone Experiments page
- No schema migration needed for existing data
