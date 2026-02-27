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
- Per-item parallelism and retry with exponential backoff for generation and experiments
- Experiments scale to any dataset size (no 10-minute timeout for evaluation loop)
- Maintain LangSmith integration for experiment results (using raw API instead of `evaluate()`)

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

### D3: Per-question experiment evaluation with raw LangSmith API
Replace `runLangSmithExperiment()` (which wraps LangSmith's `evaluate()`) with:
1. A `createLangSmithExperiment()` helper that creates an experiment record via LangSmith client
2. Per-question actions that evaluate and call `logLangSmithResult()` to log each result

Alternative considered: keeping `evaluate()`. Rejected because it processes questions sequentially in a single action, risking 10-minute timeout for datasets with 100+ questions and preventing per-question retry.

### D4: Experiment table as its own tracking record
Add progress fields (`totalQuestions`, `processedQuestions`, `failedQuestions`) directly to the `experiments` table. No separate `jobs` record needed — the experiment IS the job. The orchestrator action updates the experiment record directly.

### D5: Orchestrator action for experiment setup
Keep a single orchestrator action (`runExperiment`) that handles sequential setup, then fans out evaluation. Two paths:
- **Retriever path** (primary): experiment references a pre-indexed retriever (`retrieverId`). Orchestrator verifies `status === "ready"`, reads `indexConfigHash` and `defaultK` directly. No indexing needed.
- **Legacy path**: experiment has inline `retrieverConfig`. Orchestrator computes hash, triggers indexing, polls until complete.

Both paths then: sync dataset to LangSmith → create LangSmith experiment via raw API → enqueue per-question evaluation items. The `evaluateQuestion` action reuses the same retrieval logic as `retrieverActions.retrieve` (embed → vector search → post-filter by indexConfigHash).

### D6: Generation job tracking via generationJobs table
Mirror the `indexingJobs` pattern with a `generationJobs` table. Fields: orgId, datasetId, kbId, strategy, phase, status, progress counters (totalItems, processedItems, failedItems), error details, timestamps. The frontend queries this table directly for progress display.

## Risks / Trade-offs

- **[Phase transition race condition]** → The `onComplete` callback that triggers Phase 2 runs when the last Phase 1 item completes. Since `onComplete` is a mutation (atomic), the "check if all done → enqueue Phase 2" logic is safe. No race.
- **[LangSmith raw API stability]** → Using raw `Client.createRun()` instead of `evaluate()` couples us to LangSmith's lower-level API. Mitigation: the helpers are thin wrappers, easy to update if API changes.
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
