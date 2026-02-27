## Context

The backend currently has three execution architectures for long-running work:
1. **KB indexing** — Uses `@convex-dev/workpool` with `indexingPool`. Clean pattern: tracking table → fan-out → onComplete → finalize.
2. **Question generation** — Uses custom `jobs`/`jobItems` tables + `batchProcessor.ts` with 8-minute time budgets, manual continuation scheduling, and watchdog recovery. Two phases: generate questions, then assign ground truth.
3. **Experiment execution** — Uses a single monolithic action with `runLangSmithExperiment()` (LangSmith's `evaluate()` API). Risk of 10-minute timeout for large datasets. No per-question retry.

The indexing pattern is the simplest and most reliable. We unify all three onto WorkPool.

## Goals / Non-Goals

**Goals:**
- All long-running operations follow the same pattern: tracking table → start mutation → enqueue → per-item action → onComplete → finalize
- Delete custom job infrastructure: `jobs.ts`, `jobItems.ts`, `lib/batchProcessor.ts`, watchdog cron
- Per-item parallelism and retry with exponential backoff for generation
- Experiments run within WorkPool for tracking and cancellation, using LangSmith's `evaluate()` for full per-example UI fidelity (diffs, individual metrics, traces)
- Maintain LangSmith integration for experiment results

**Non-Goals:**
- Changing the eval-lib strategy interfaces (SimpleStrategy, DimensionDrivenStrategy, etc.)
- Modifying the existing indexing WorkPool implementation
- Adding new evaluation metrics or retriever types
- Changing the frontend UI components (beyond updating data source queries)

## Decisions

### D1: Three separate WorkPool instances
Register `generationPool` and `experimentPool` alongside existing `indexingPool`. Each gets independent parallelism settings and cancel-all scope. Alternative considered: sharing a single pool — rejected because canceling one workflow would cancel others, and parallelism tuning would conflict.

### D2: Two-phase generation with phase transition in onComplete
Question generation uses two sequential fan-outs through the same `generationPool`:
- Phase 1: Enqueue generation actions (1 per doc for simple, 1 total for dim/rwg)
- Phase 2: When all Phase 1 items complete, the last `onComplete` callback queries all generated questions and enqueues GT assignment actions

Alternative considered: pipeline approach (enqueue GT immediately per-doc as generation completes). Rejected for simplicity — counter tracking is complex when you don't know total GT items upfront, and the latency difference is negligible since WorkPool processes items in parallel within each phase.

### D3: Single evaluate() call wrapped in WorkPool item
Keep LangSmith's `evaluate()` API as the experiment execution engine, wrapped as a single WorkPool item with retry disabled. The `evaluate()` function handles the full per-example lifecycle (creating runs, linking to dataset examples, running evaluators, attaching feedback), which is required for LangSmith's per-example UI (diffs, individual metrics, traces).

Initially, we replaced `evaluate()` with raw API calls (`createLangSmithExperiment` + per-question `logLangSmithResult`). However, testing revealed that LangSmith's per-example UI depends on internal metadata created by `evaluate()` that cannot be replicated via raw API or `traceable()` wrappers. Both approaches were attempted and failed to produce per-example views.

The `evaluate()` call is wrapped in a single WorkPool item for consistent tracking and cancellation. Retry is disabled because `evaluate()` processes the full dataset sequentially — retrying after a 10-minute timeout restarts from scratch, which won't help. The `onResult` callback streams per-question results to Convex for real-time progress.

Alternative considered: chunked `evaluate()` (split dataset, multiple WorkPool items each calling evaluate() on a subset, all writing to same project). Investigation confirmed this is technically feasible (SDK supports passing an existing project object and Example arrays), but adds complexity without clear benefit at current dataset sizes.

### D4: Experiment table as its own tracking record
Add progress fields (`totalQuestions`, `processedQuestions`, `failedQuestions`) directly to the `experiments` table. No separate `jobs` record needed — the experiment IS the job. The orchestrator action updates the experiment record directly.

### D5: Orchestrator action for experiment setup
Keep a single orchestrator action (`runExperiment`) that handles sequential setup, then enqueues a single evaluation WorkPool item. Two paths:
- **Retriever path** (primary): experiment references a pre-indexed retriever (`retrieverId`). Orchestrator verifies `status === "ready"`, reads `indexConfigHash` and `defaultK` directly. No indexing needed.
- **Legacy path**: experiment has inline `retrieverConfig`. Orchestrator computes hash, triggers indexing, polls until complete.

Both paths then: sync dataset to LangSmith → enqueue a single `runEvaluation` action. The `runEvaluation` action creates a `CallbackRetriever` backed by Convex vector search and calls `runLangSmithExperiment()` (which internally calls LangSmith's `evaluate()`). The `onResult` callback streams per-question results to Convex. After `evaluate()` completes, the action aggregates scores and marks the experiment complete.

### D6: Generation job tracking via generationJobs table
Mirror the `indexingJobs` pattern with a `generationJobs` table. Fields: orgId, datasetId, kbId, strategy, phase, status, progress counters (totalItems, processedItems, failedItems), error details, timestamps. The frontend queries this table directly for progress display.

### D7: Per-item cancellation via stored WorkIds
Each job/experiment stores an array of `WorkId` strings returned by `pool.enqueueAction()`. Cancellation iterates these IDs and calls `pool.cancel(ctx, workId)` per item, instead of `pool.cancelAll(ctx)`. This ensures that canceling one job doesn't affect other jobs sharing the same pool. For generation's two-phase flow, Phase 2 `workIds` replace Phase 1 `workIds` on the job record.

### D8: Phase 1 statistics preservation
When generation transitions from Phase 1 to Phase 2, counters are reset to track Phase 2 progress. Phase 1 stats (`processedItems`, `failedItems`, `skippedItems`) are saved to `phase1Stats` before the reset. The final job status considers failures from BOTH phases — if Phase 1 had failures but Phase 2 succeeded, the job is `"completed_with_errors"`, not `"completed"`.

### D9: Separate skipped vs failed counters
WorkPool's `RunResult` has three kinds: `"success"`, `"failed"`, `"canceled"`. Originally, both `"failed"` and `"canceled"` incremented the same failure counter. Now they're tracked separately: `failedItems`/`failedQuestions` for errors, `skippedItems`/`skippedQuestions` for cancellations. This gives accurate progress reporting during partial cancellation.

### D10: Cancel ordering — status before items
Cancellation mutations set `status: "canceling"` BEFORE canceling individual work items. This ensures that any in-flight `onComplete` callbacks that execute during the cancel loop see the `"canceling"` status and behave accordingly (e.g., transitioning to `"canceled"` instead of `"completed"`).

### D11: LangSmith example ID linkage
After dataset sync to LangSmith, the system queries back the created examples and stores their IDs on the corresponding question records (`langsmithExampleId`). During evaluation, each `logLangSmithResult` call passes this ID as `reference_example_id`, linking experiment runs to their dataset examples. This enables LangSmith's comparison views to work correctly. The linkage is non-fatal — experiments still work without it.

### D12: Experiments table is NOT renamed to experimentJobs
Analysis confirmed that `experiments` serves a fundamentally different role than `indexingJobs`/`generationJobs`. The job tables are ephemeral progress trackers with a parent entity that stores config. `experiments` IS the primary entity — it stores configuration, execution progress, AND results (scores, LangSmith URLs). The frontend queries experiments as permanent, named records for comparison. The naming asymmetry is architecturally correct.

### D13: Shared counter helpers (applyResult / counterPatch)
Both `onQuestionGenerated` and `onGroundTruthAssigned` use the same counter update logic. Extracted into shared `applyResult()` (computes new counters from `RunResult`) and `counterPatch()` (formats counters for `ctx.db.patch()`) helpers to reduce duplication and ensure consistent handling of the three result kinds.

## Risks / Trade-offs

- **[Phase transition race condition]** → The `onComplete` callback that triggers Phase 2 runs when the last Phase 1 item completes. Since `onComplete` is a mutation (atomic), the "check if all done → enqueue Phase 2" logic is safe. No race.
- **[Experiment evaluation timeout]** → The `runEvaluation` action runs `evaluate()` on the full dataset sequentially. For large datasets (100+ questions), this risks the 10-minute Convex action timeout. Retry is disabled because restarting from scratch won't help. Mitigation: monitor dataset sizes; if timeouts occur, consider chunked `evaluate()` approach (D3 alternative).
- **[Experiment orchestrator timeout]** → The orchestrator action polls indexing completion (could take minutes). If indexing takes >10 minutes, the orchestrator action times out. Mitigation: same pattern as today; indexing is already WorkPool-based so it runs independently. If orchestrator times out, WorkPool retry restarts it, and indexing dedup check returns `alreadyCompleted`.
- **[Breaking change for frontend]** → Frontend references `jobs` queries for progress. Must update to use `generationJobs` queries and `experiments` fields instead.

## Migration Plan

1. Add new schema tables (`generationJobs`) and new fields on `experiments` — backward compatible
2. Register new WorkPool components in `convex.config.ts`
3. Implement new generation and experiment actions/mutations
4. Update frontend to query new data sources
5. Delete old infrastructure (`jobs.ts`, `jobItems.ts`, `batchProcessor.ts`, watchdog cron)
6. Remove old `jobs`/`jobItems` tables from schema
7. Deploy — no data migration needed since jobs/jobItems are transient (not user data)
