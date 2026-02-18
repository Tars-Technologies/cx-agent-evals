## Context

The system has two experiment execution paths that diverged during the Convex migration:

1. **Old (Next.js)**: Called `runLangSmithExperiment()` → `evaluate()` from `langsmith/evaluation`. Experiments properly linked to datasets, evaluator scores recorded natively, comparison UI worked. But used in-memory vector store (slow to initialize, re-indexed every run).

2. **Current (Convex)**: 3-phase pipeline (indexing → evaluation → aggregation) using Convex vector search + batch processor. Fast execution with pre-indexed KB. But "sync" to LangSmith uses `createRun()` which creates orphaned runs — experiments never appear on LangSmith dataset pages.

The Convex evaluation action currently does metrics computation inline (imported from eval-lib) and stores results in `experimentResults`. LangSmith sync is a broken fire-and-forget afterthought.

## Goals / Non-Goals

**Goals:**
- Experiments created on Convex appear as proper LangSmith experiments linked to datasets
- LangSmith comparison/analytics UI works for these experiments
- Evaluation logic (retrieval + metrics) stays in eval-lib, not duplicated in Convex actions
- Per-question results are saved to Convex `experimentResults` table in real-time during the run
- eval-lib remains backend-agnostic (no Convex dependency)

**Non-Goals:**
- Matching the speed of the current Convex-only approach (LangSmith API calls add ~2x overhead — this is acceptable)
- Changing the dataset sync flow (it works correctly)
- Changing the frontend experiments UI (it already reactively watches experiment/job status)
- Supporting experiment execution without LangSmith (users must have `LANGSMITH_API_KEY`)

## Decisions

### Decision 1: CallbackRetriever in eval-lib

**Choice**: Add a `CallbackRetriever` class to eval-lib that implements the `Retriever` interface via user-provided callback functions.

**Why**: The existing `Retriever` interface is the right abstraction — `init()`, `retrieve()`, `cleanup()`. But the only concrete implementation (`VectorRAGRetriever`) is tightly coupled to eval-lib's chunker/embedder/vectorStore chain. Convex needs to use its own vector search. A callback-based implementation lets any external system plug in without eval-lib knowing the details.

**Alternatives considered**:
- *Convex-specific retriever in eval-lib*: Would couple eval-lib to Convex — rejected.
- *Let Convex implement the interface directly*: Works but forces Convex to create a class that satisfies TypeScript's structural typing. A factory function in eval-lib is cleaner.

**Interface**:
```ts
interface CallbackRetrieverConfig {
  name: string;
  retrieveFn: (query: string, k: number) => Promise<PositionAwareChunk[]>;
  initFn?: (corpus: Corpus) => Promise<void>;      // default: no-op
  cleanupFn?: () => Promise<void>;                  // default: no-op
}
```

### Decision 2: onResult callback on runLangSmithExperiment

**Choice**: Add an optional `onResult` callback to `LangSmithExperimentConfig` that fires after each question is evaluated (after the target runs but before/during evaluator execution).

**Why**: The caller (Convex action) needs to persist per-question results to the `experimentResults` table as they're computed. Without this hook, `runLangSmithExperiment()` is a black box that only talks to LangSmith.

**Implementation approach**: Wrap the target function to intercept results and call `onResult` before returning to LangSmith's `evaluate()`. The evaluators then compute scores and LangSmith records them. `onResult` receives the query, retrieved spans, and (later) the evaluator scores.

**Signature**:
```ts
onResult?: (result: {
  query: string;
  retrievedSpans: Array<{ docId: string; start: number; end: number; text: string }>;
  scores: Record<string, number>;
}) => Promise<void>;
```

**Challenge**: LangSmith's `evaluate()` runs target and evaluators separately — we may not have evaluator scores at target-call time. Two sub-options:
- (A) Fire `onResult` from within the evaluator (has access to both outputs and scores)
- (B) Fire `onResult` from the target (only has retrievedSpans), then fire a separate callback after evaluators run

Going with **(A)**: Create a custom evaluator wrapper that computes all metrics AND calls `onResult` with the complete data. This is cleaner — one callback with everything.

### Decision 3: Single-action experiment pipeline

**Choice**: Replace the 3-phase Convex pipeline (indexing → evaluation → aggregation) with a single action that:
1. Checks/runs indexing (same as before — skip if already indexed)
2. Ensures dataset is synced to LangSmith
3. Calls `runLangSmithExperiment()` with a Convex-backed `CallbackRetriever`
4. Aggregates scores and updates experiment status

**Why**: The multi-phase batch processor was needed because evaluation was done per-question in Convex. With `evaluate()` handling the loop, the batch processor is unnecessary for the evaluation phase. Indexing still uses the existing flow.

**Indexing**: Before calling `runLangSmithExperiment()`, the action checks `rag.isIndexed` and indexes if needed (reusing existing `indexSingleDocument` from `ragActions.ts`). This is a pre-step, not a separate phase.

### Decision 4: Dataset must be synced before experiment runs

**Choice**: The experiment action ensures the LangSmith dataset exists before calling `evaluate()`. If not synced, it triggers `syncDataset` inline.

**Why**: `evaluate()` loads examples from a named LangSmith dataset (`data: datasetName`). If the dataset doesn't exist in LangSmith, the call fails. The dataset name stored in the Convex `datasets` table is used as the LangSmith dataset identifier.

### Decision 5: Remove syncExperiment, keep syncDataset

**Choice**: Delete `syncExperiment` and `syncDatasetDirect` from `langsmithSync.ts`. Keep `syncDataset` (it still serves the generation → dataset upload flow).

**Why**: Experiment sync is now handled natively by `evaluate()` inside `runLangSmithExperiment()`. There's no need for a post-hoc sync step. Dataset sync remains necessary for uploading ground truth after question generation.

## Risks / Trade-offs

**[~2x slower experiments]** → Acceptable trade-off for proper LangSmith integration. 100 questions: ~60-70s vs ~27s. Users see results streaming into the UI via the `onResult` callback, so perceived wait time is lower than wall time.

**[Convex action timeout]** → Convex actions have a 10-minute timeout. For very large datasets (500+ questions), the `evaluate()` call might exceed this. → Mitigation: Monitor timing. If needed, future work could batch `evaluate()` calls or use Convex's scheduler for continuation.

**[langsmith package in Convex runtime]** → `langsmith` must be importable in Convex's Node.js action runtime. It's already a peer dependency of eval-lib. → Verify it's listed in the backend's `package.json` dependencies.

**[Indexing still uses batch processor]** → The indexing pre-step still uses the existing batch processor pattern if the KB isn't indexed. This is fine — indexing is separate from evaluation and only runs once per KB.

## Open Questions

- Should we keep the Convex-only experiment path as a fallback for users without `LANGSMITH_API_KEY`? (Current decision: no — require LangSmith for experiments. The value of the tool is the LangSmith analytics.)
