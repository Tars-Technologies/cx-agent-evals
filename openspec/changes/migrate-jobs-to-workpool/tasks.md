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
- [x] 2.8 Create `cancelGeneration` mutation — set status to "canceling", call pool.cancelAll
- [x] 2.9 Add queries: `getJob`, `listJobs`, `getJobInternal` for generationJobs table

## 3. Experiment Runner — WorkPool Migration

- [x] 3.1 Update `experiments.start` mutation — remove job record creation, just create experiment and schedule orchestrator
- [x] 3.2 Rewrite `runExperiment` orchestrator action — setup phases (indexing, sync, create LangSmith experiment), then enqueue per-question evaluation into experimentPool
- [x] 3.3 Create `evaluateQuestion` action — embed query, vector search, compute metrics, insert experimentResult, log to LangSmith raw API
- [x] 3.4 Create `onQuestionEvaluated` onComplete callback mutation — increment experiment progress counters, detect completion, aggregate scores, mark complete
- [x] 3.5 Create `cancelExperiment` mutation — set status to "canceling", call pool.cancelAll
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

## 7. Testing & Verification

- [x] 7.1 Run `pnpm -C packages/eval-lib test` — verify eval-lib tests pass (205 pass, 3 pre-existing dimension failures)
- [x] 7.2 Run `pnpm -C packages/backend test` — no test files remain (old batchProcessor tests deleted, WorkPool tested via component)
- [ ] 7.3 Deploy to dev (`pnpm dev:backend`) and verify schema applies cleanly
- [ ] 7.4 End-to-end test: simple strategy question generation with GT assignment
- [ ] 7.5 End-to-end test: experiment run with per-question evaluation and LangSmith sync
