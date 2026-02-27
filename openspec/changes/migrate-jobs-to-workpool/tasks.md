## 1. Infrastructure & Schema

- [x] 1.1 Register `generationPool` and `experimentPool` in `convex.config.ts`
- [x] 1.2 Add `generationJobs` table to `schema.ts` (orgId, kbId, datasetId, strategy, status, phase, progress counters, error details, timestamps)
- [x] 1.3 Add progress fields to `experiments` table in `schema.ts` (totalQuestions, processedQuestions, failedQuestions, completedAt, phase; add "completed_with_errors"/"canceling"/"canceled" to status union)
- [x] 1.4 Remove `jobs` and `jobItems` table definitions from `schema.ts`

## 2. Question Generation — WorkPool Migration

- [x] 2.1 Create `generation.ts` with pool instance, `startGeneration` mutation (creates generationJob, enqueues items), dedup check for existing running jobs
- [x] 2.2 Create `generateForDocument` action in `generationActions.ts` — single doc SimpleStrategy generation
- [x] 2.3 Create `generateDimensionDriven` action — whole corpus DimensionDrivenStrategy generation (returns questionsGenerated)
- [x] 2.4 Create `generateRealWorldGrounded` action — whole corpus RealWorldGroundedStrategy generation (returns questionsGenerated)
- [x] 2.5 Create `onQuestionGenerated` onComplete callback mutation — increment counters, detect Phase 1 completion, enqueue Phase 2 GT actions
- [x] 2.6 Create `assignGroundTruthForQuestion` action — per-question GT assignment using GroundTruthAssigner
- [x] 2.7 Create `onGroundTruthAssigned` onComplete callback mutation — increment counters, detect Phase 2 completion, finalize (update dataset questionCount, mark job complete, fire-and-forget LangSmith sync)
- [x] 2.8 Create `cancelGeneration` mutation — set status to "canceling", cancel per-item via stored workIds
- [x] 2.9 Add queries: `getJob`, `listJobs`, `getJobInternal` for generationJobs table

## 3. Experiment Runner — WorkPool Migration

- [x] 3.1 Update `experiments.start` mutation — remove job record creation, just create experiment and schedule orchestrator
- [x] 3.2 Rewrite `runExperiment` orchestrator action — setup phases (indexing, sync), then enqueue single `runEvaluation` WorkPool item
- [x] 3.3 Create `runEvaluation` action — wraps `runLangSmithExperiment()` with CallbackRetriever backed by Convex vector search, onResult callback writes per-question results, aggregates scores on completion
- [x] 3.4 Create `onExperimentComplete` onComplete callback mutation — handles single item: no-op on success (action finalizes), marks failed/canceled
- [x] 3.5 Create `cancelExperiment` mutation — set status to "canceling", cancel per-item via stored workIds
- [x] 3.6 Update experiment queries to include new progress fields

## 4. eval-lib — LangSmith Raw API Helpers

- [x] 4.1 Create `createLangSmithExperiment()` helper in `src/langsmith/` — creates experiment via LangSmith client raw API, returns experimentId + URL
- [x] 4.2 Create `logLangSmithResult()` helper in `src/langsmith/` — logs single result to existing experiment with input/output/scores
- [x] 4.3 Export new helpers from `src/langsmith/index.ts`
- [x] 4.4 Verify existing `runLangSmithExperiment` still works (run existing tests)

## 5. Delete Old Infrastructure

- [x] 5.1 Delete `jobs.ts`
- [x] 5.2 Delete `jobItems.ts`
- [x] 5.3 Delete `lib/batchProcessor.ts`
- [x] 5.4 Remove watchdog cron from `crons.ts` (keep LangSmith retry cron if still needed)
- [x] 5.5 Remove all imports/references to jobs, jobItems, batchProcessor across backend files

## 6. Frontend Updates

- [x] 6.1 Update generation progress UI to query `generationJobs` instead of `jobs`
- [x] 6.2 Update experiment progress UI to read progress from `experiments` table directly (totalQuestions, processedQuestions)
- [x] 6.3 Remove any references to `jobs.get` / `jobs.listByOrg` queries

## 7. Code Review Fixes

- [x] 7.1 C1: Per-item cancellation — track WorkIds from `pool.enqueueAction()`, store on job/experiment, use `pool.cancel(ctx, workId)` instead of `pool.cancelAll()`
- [x] 7.2 C2: Empty dataset guard in experiment orchestrator — complete immediately with 0 questions
- [x] 7.3 C3: `experiments.get` query returns null instead of throwing for wrong org
- [x] 7.4 C4: Fix `logLangSmithResult` end_time from `Date.now()` to ISO 8601 timestamp
- [x] 7.5 I1: Preserve Phase 1 stats in `phase1Stats` before Phase 2 counter reset; factor into final status
- [x] 7.6 I2: Separate `skippedQuestions` counter for canceled items (not conflated with failed)
- [x] 7.7 I3: Set status to "canceling" BEFORE canceling items (cancel ordering)
- [x] 7.8 I5: LangSmith example ID linkage — store example IDs on questions after sync, pass to logLangSmithResult
- [x] 7.9 I7: Remove export from experiment pool instance (module-private)
- [x] 7.10 I8: Add `require` entry for `./langsmith` export in eval-lib package.json
- [x] 7.11 I9: Guard against stale Phase 1 callbacks after Phase 2 has started
- [x] 7.12 S1: Guard against undefined/zero totalQuestions in onQuestionEvaluated
- [x] 7.13 S2: Remove double-timestamping in LangSmith experiment name (use experimentName directly)
- [x] 7.14 S3: Extract shared `applyResult()` and `counterPatch()` helpers for counter logic

## 8. Testing & Verification

- [x] 8.1 Run `pnpm -C packages/eval-lib test` — verify eval-lib tests pass (205 pass, 3 pre-existing dimension failures)
- [x] 8.2 Write backend tests: `generation.test.ts` — 14 tests covering onQuestionGenerated, onGroundTruthAssigned, getJob (counter logic, phase transitions, phase1Stats, cancellation, auth scoping)
- [x] 8.3 Write backend tests: `experiments.test.ts` — 6 tests covering onExperimentComplete (success no-op, failure, cancellation, no-overwrite), get query (null for wrong org, correct org)
- [x] 8.4 Run `pnpm -C packages/backend test` — 20 tests pass (14 generation + 6 experiments)
- [x] 8.5 Deploy to dev (`pnpm dev:backend`) and verify schema applies cleanly
- [x] 8.6 End-to-end test: simple strategy question generation with GT assignment
- [x] 8.7 End-to-end test: experiment run with per-question evaluation and LangSmith sync
