# Experiment Runner Module

> Experiment lifecycle, orchestration, LangSmith evaluate() integration, and result aggregation.

[Back to Architecture Overview](./architecture.md)

---

## Files

| File | Lines | Role |
|------|-------|------|
| `experiments.ts` | ~273 | Start mutation, WorkPool enqueue, cancel, onComplete callback, queries |
| `experimentActions.ts` | ~354 | `"use node"` actions: orchestrator + evaluation runner |
| `experimentResults.ts` | ~65 | Per-question result storage and queries |

Supporting files touched:
- `langsmithSync.ts` — dataset sync before evaluation (inlined `uploadDataset()` from former eval-lib)
- `indexing.ts` — indexing check/trigger during orchestration
- `rag.ts` — chunk hydration after vector search
- `retrievers.ts` — retriever config lookup

---

## Pipeline Overview

Unlike generation (fan-out per document) and indexing (fan-out per document), experiments use a **single WorkPool item** wrapping LangSmith's `evaluate()` function:

```
┌──────────────────────────────────────────────────────────────────┐
│                    experiments.start (mutation)                   │
│                                                                  │
│  1. Validate auth + dataset + retriever                         │
│  2. Create experiment record (status: pending)                  │
│  3. Schedule orchestrator action                                │
└──────────────────────┬───────────────────────────────────────────┘
                       │ scheduler.runAfter(0, ...)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│             experimentActions.runExperiment (orchestrator)        │
│                                                                  │
│  Step 0: Set status = "running", phase = "initializing"         │
│                                                                  │
│  Step 1: Ensure KB is indexed                                   │
│    ├── Retriever path: load retriever, verify status = "ready"  │
│    └── Legacy path: compute indexConfigHash, trigger indexing,  │
│        poll until complete (2s intervals)                        │
│                                                                  │
│  Step 2: Ensure dataset synced to LangSmith                     │
│    └── If no langsmithDatasetId, call syncDataset action        │
│                                                                  │
│  Step 3: Count questions, guard against empty dataset           │
│                                                                  │
│  Step 4: Enqueue single evaluation WorkPool item                │
│    └── experiments.enqueueExperiment (internalMutation)          │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│           experimentActions.runEvaluation (WorkPool item)        │
│                                                                  │
│  1. Load experiment + documents + questions                     │
│  2. Build corpus from documents                                 │
│  3. Create query→questionId lookup map                          │
│  4. Create CallbackRetriever with Convex vector search          │
│  5. Call runLangSmithExperiment({                                │
│       corpus, retriever, k, datasetName,                        │
│       experimentPrefix, metadata,                               │
│       onResult: async (result) => {                             │
│         • Insert experimentResult record                        │
│         • Update processedQuestions counter                     │
│       }                                                         │
│     })                                                          │
│  6. Aggregate scores across all results                         │
│  7. Mark experiment completed with avgScores                    │
└──────────────────────┬───────────────────────────────────────────┘
                       │ WorkPool onComplete
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│           experiments.onExperimentComplete (callback)             │
│                                                                  │
│  success  → no-op (action already marked complete)              │
│  failed   → mark experiment as failed with error                │
│  canceled → mark experiment as canceled                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Two Paths: Retriever vs Legacy

The experiment runner supports two ways to specify retrieval configuration:

### Retriever Path (Current)

```
experiment.retrieverId → load retriever record
  → indexConfigHash from retriever
  → embeddingModel from retriever.retrieverConfig.index
  → k from retriever.defaultK
  → Skip indexing (retriever must already be "ready")
```

### Legacy Path

```
experiment.retrieverConfig → raw config object
  → Compute indexConfigHash from config
  → Trigger indexing if needed (poll until done)
  → embeddingModel from config.index
  → k from experiment.k ?? 5
```

The legacy path exists for backward compatibility. It includes a polling loop that waits for indexing to complete:

```typescript
while (!indexingDone) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const indexJob = await ctx.runQuery(internal.indexing.getJobInternal, { jobId });
  // check status...
}
```

---

## CallbackRetriever

The experiment runner bridges Convex vector search to eval-lib's `Retriever` interface using `CallbackRetriever`:

```typescript
const retriever = new CallbackRetriever({
  name: "convex-vector-search",
  retrieveFn: async (query: string, topK: number) => {
    // 1. Embed query
    const queryEmbedding = await embedder.embedQuery(query);

    // 2. Vector search (over-fetch, filter by kbId)
    const searchResults = await ctx.vectorSearch("documentChunks", "by_embedding", {
      vector: queryEmbedding,
      limit: Math.min(topK * 4, 256),
      filter: (q) => q.eq("kbId", kbId),
    });

    // 3. Hydrate with full chunk + doc data
    const chunks = await ctx.runQuery(internal.rag.fetchChunksWithDocs, {
      ids: searchResults.map((r) => r._id),
    });

    // 4. Post-filter by indexConfigHash, take top-K
    return chunks
      .filter((c) => c.indexConfigHash === indexConfigHash)
      .slice(0, topK)
      .map((c) => ({
        id: PositionAwareChunkId(c.chunkId),
        content: c.content,
        metadata: c.metadata ?? {},
        docId: DocumentId(c.docId),
        start: c.start,
        end: c.end,
      }));
  },
});
```

This design keeps Convex-specific code (vector search, hydration) in the backend while eval-lib's `runLangSmithExperiment` remains storage-agnostic.

---

## LangSmith Integration

> **Note:** LangSmith integration code previously lived in eval-lib under `src/langsmith/`. It has been fully migrated to the Convex backend. The `runLangSmithExperiment()` function is inlined in `experimentActions.ts`, and `uploadDataset()` is inlined in `langsmithSync.ts`. eval-lib is now a pure evaluation library with zero LangSmith dependency.

### Dataset Sync

Before evaluation can run, the dataset must exist in LangSmith:

```
datasets table.langsmithDatasetId exists?
  ├── Yes → use it
  └── No → call langsmithSync.syncDataset
           → uploadDataset() (inlined in langsmithSync.ts)
           → link example IDs back to questions
```

The `uploadDataset()` function (previously in eval-lib's `src/langsmith/upload.ts`) is now inlined in `langsmithSync.ts`. It converts questions to `GroundTruth[]` format using branded types (`QueryId`, `QueryText`, `DocumentId`) from eval-lib, then uploads to LangSmith using the `langsmith` SDK directly.

### Experiment Execution

`runLangSmithExperiment()` is defined locally in `experimentActions.ts` (inlined from eval-lib's former `src/langsmith/experiment-runner.ts`). It wraps LangSmith's native `evaluate()` function:

- Creates a `CallbackRetriever` (from eval-lib) backed by Convex vector search
- Defines a target function that runs retrieval and converts results to serialized spans
- Creates LangSmith evaluators from eval-lib's metric functions (`recall`, `precision`, `iou`, `f1`)
- Calls `langsmith/evaluation.evaluate()` directly (not via eval-lib)
- Calls `onResult` callback after each example completes

### Metrics

The experiment runner imports individual metric objects directly from eval-lib:

```typescript
import { recall, precision, iou, f1, type Metric } from "rag-evaluation-system";
```

These are used to create LangSmith evaluator functions that compute span-based scores for each example.

### Result Correlation

Questions are matched to LangSmith examples by query text:

```typescript
const queryToQuestionId = new Map<string, Id<"questions">>();
for (const q of questions) {
  queryToQuestionId.set(q.queryText, q._id);
}

// In onResult callback:
const questionId = queryToQuestionId.get(result.query);
```

---

## Score Aggregation

After `evaluate()` completes, scores are averaged across all results:

```typescript
const metricNames = experiment.metricNames;  // e.g. ["recall", "precision", "iou", "f1"]
const avgScores: Record<string, number> = {};

for (const name of metricNames) {
  const values = results
    .map((r) => r.scores[name])
    .filter((v): v is number => typeof v === "number");

  avgScores[name] = values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;
}
```

These aggregated scores are stored on the experiment record.

---

## WorkPool Configuration

```typescript
const pool = new Workpool(components.experimentPool, {
  maxParallelism: 1,    // Only 1 experiment at a time
  retryActionsByDefault: false,  // No retry: evaluate() processes full dataset
});
```

**Why no retry?** `evaluate()` processes the entire dataset sequentially. If it times out midway, retrying from scratch would re-process already-completed examples (LangSmith would create duplicate runs). The single-item, no-retry approach ensures clean experiment results.

**Why parallelism 1?** Each experiment is a long-running evaluation that makes many API calls. Running multiple experiments concurrently would risk action timeouts and rate limiting.

---

## Cancellation

```typescript
cancelExperiment(experimentId):
  1. Validate auth + experiment ownership
  2. Guard: only "running" or "pending" can be canceled
  3. Set status to "canceling"
  4. Cancel this experiment's workIds via pool.cancel()
```

The `onExperimentComplete` callback handles the terminal states:
- `result.kind === "canceled"` → status = "canceled"
- `result.kind === "failed"` → status = "failed" (only if not already failed)
- `result.kind === "success"` → no-op (action already marked complete)

---

## Database Records

### experiments

| Field | Type | Notes |
|-------|------|-------|
| `orgId` | string | Org scope |
| `datasetId` | Id<"datasets"> | Source dataset |
| `name` | string | Display name / LangSmith experiment prefix |
| `retrieverId` | Id<"retrievers">? | Retriever path |
| `retrieverConfig` | any? | Legacy path (raw config) |
| `k` | number? | Legacy path top-K override |
| `metricNames` | string[] | Metrics to compute (e.g. ["recall", "precision", "iou", "f1"]) |
| `status` | union | pending / running / completed / completed_with_errors / failed / canceling / canceled |
| `phase` | string? | Current phase: initializing / indexing / syncing / evaluating / done |
| `totalQuestions` | number? | Total questions in dataset |
| `processedQuestions` | number? | Questions evaluated so far |
| `failedQuestions` | number? | (not currently populated) |
| `skippedQuestions` | number? | (not currently populated) |
| `workIds` | string[]? | WorkPool item IDs for cancellation |
| `indexConfigHash` | string? | (not currently populated from experiments.ts) |
| `scores` | any? | Aggregated avg scores: `{ recall: 0.85, precision: 0.72, ... }` |
| `langsmithExperimentId` | string? | (not currently populated) |
| `langsmithUrl` | string? | (not currently populated) |
| `error` | string? | Error message if failed |

### experimentResults

| Field | Type | Notes |
|-------|------|-------|
| `experimentId` | Id<"experiments"> | Parent experiment |
| `questionId` | Id<"questions"> | Source question |
| `retrievedSpans` | CharacterSpan[] | Spans returned by retriever |
| `scores` | any | Per-question scores: `{ recall, precision, iou, f1 }` |
| `metadata` | any | Additional metadata |

---

## Phases

The experiment moves through these phases:

| Phase | Set By | What's Happening |
|-------|--------|------------------|
| `initializing` | Orchestrator | Loading experiment, resolving config |
| `indexing` | Orchestrator | Waiting for KB indexing to complete (legacy path only) |
| `syncing` | Orchestrator | Syncing dataset to LangSmith |
| `evaluating` | Orchestrator / Evaluation | Running evaluate() — `processedQuestions` updated per result |
| `done` | Evaluation | All results processed, scores aggregated |

---

## Queries

| Function | Type | Auth | Purpose |
|----------|------|------|---------|
| `experiments.start` | mutation | Yes | Start a new experiment |
| `experiments.cancelExperiment` | mutation | Yes | Cancel running experiment |
| `experiments.byDataset` | query | Yes | List experiments for a dataset |
| `experiments.get` | query | Yes | Get single experiment (returns null for wrong org, C3) |
| `experiments.getInternal` | internalQuery | No | Get experiment (throws if not found) |
| `experiments.updateStatus` | internalMutation | No | Update experiment status/scores/error |
| `experiments.enqueueExperiment` | internalMutation | No | Enqueue single WorkPool evaluation item |
| `experimentResults.byExperiment` | query | Yes | List all results for an experiment |
| `experimentResults.byExperimentInternal` | internalQuery | No | Same, no auth |
| `experimentResults.insert` | internalMutation | No | Insert a per-question result |

---

## Test Coverage

**File**: `tests/experiments.test.ts` (6 tests)

Covered:
- `onExperimentComplete`: success no-op, failure marking, cancel marking, no-overwrite guard
- `experiments.get`: null for wrong org (C3), returns for correct org

Not covered:
- `experiments.start` mutation
- `experiments.cancelExperiment` mutation
- `experiments.byDataset` query
- `experiments.enqueueExperiment` mutation
- `experimentActions.runExperiment` orchestrator
- `experimentActions.runEvaluation` (would need LangSmith mocking)
- Score aggregation logic
- Phase transitions

See [Refactoring Suggestions](./refactoring-suggestions.md#testing) for recommended additions.
