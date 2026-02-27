## ADDED Requirements

### Requirement: Generation WorkPool instance
The system SHALL create a `Workpool` instance backed by `components.generationPool` with `maxParallelism: 10`, `retryActionsByDefault: true`, and `defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2000, base: 2 }`.

#### Scenario: Pool is available
- **WHEN** the Convex backend is deployed
- **THEN** the `generationPool` component SHALL be available via `components.generationPool`

### Requirement: Start generation mutation
The system SHALL provide a `startGeneration` mutation that creates a `generationJobs` record with `status: "running"` and `phase: "generating"`, then enqueues work items into the `generationPool`. For "simple" strategy, it SHALL enqueue one action per document. For "dimension-driven" and "real-world-grounded" strategies, it SHALL enqueue a single action for the entire corpus. Each enqueued item SHALL specify `onComplete: onQuestionGenerated` with context containing the `jobId`. The mutation SHALL collect `WorkId` values from each `pool.enqueueAction()` call and store them on the job record as `workIds` for selective cancellation.

#### Scenario: Simple strategy enqueues per-document
- **WHEN** a user starts generation with "simple" strategy on a KB with 10 documents
- **THEN** the system SHALL create a `generationJobs` record with `totalItems: 10`, enqueue 10 actions into the pool, and store 10 `workIds` on the job

#### Scenario: Dimension-driven strategy enqueues single item
- **WHEN** a user starts generation with "dimension-driven" strategy
- **THEN** the system SHALL create a `generationJobs` record with `totalItems: 1`, enqueue 1 action into the pool, and store 1 `workId` on the job

### Requirement: Per-document generation action
The system SHALL provide a `generateForDocument` action that receives a single document ID, loads the document, runs `SimpleStrategy.generate()`, and inserts the resulting questions via `questions.insertBatch`. The action SHALL return `{ questionsGenerated: number }`.

#### Scenario: Generate questions for one document
- **WHEN** the action runs for a document
- **THEN** it SHALL generate questions using SimpleStrategy and insert them into the questions table with `relevantSpans: []`

### Requirement: Whole-corpus generation action
The system SHALL provide `generateDimensionDriven` and `generateRealWorldGrounded` actions that load the full corpus from the KB, run the respective strategy, and insert all resulting questions. Each action SHALL return `{ questionsGenerated: number }`.

#### Scenario: Dimension-driven generates for full corpus
- **WHEN** the action runs
- **THEN** it SHALL run `DimensionDrivenStrategy.generate()` on the full corpus and insert all questions

#### Scenario: Real-world-grounded generates for full corpus
- **WHEN** the action runs
- **THEN** it SHALL run `RealWorldGroundedStrategy.generate()` on the full corpus and insert all questions

### Requirement: Phase 1 completion callback (onQuestionGenerated)
The system SHALL provide an `onQuestionGenerated` mutation as the WorkPool `onComplete` callback for Phase 1. It SHALL use the shared `applyResult()` helper to compute counter increments based on `RunResult.kind` (success → processedItems, failed → failedItems, canceled → skippedItems). When all Phase 1 items have completed (processedItems + failedItems + skippedItems >= totalItems), it SHALL preserve Phase 1 statistics in a `phase1Stats` field on the job, then transition to Phase 2 by: updating `phase` to `"ground-truth"`, querying all generated questions for the dataset, setting `totalItems` to the question count, resetting `processedItems`/`failedItems`/`skippedItems` to 0, and enqueueing one `assignGroundTruthForQuestion` action per question. The Phase 2 `workIds` SHALL replace the Phase 1 `workIds` on the job record. If the callback fires but the job's phase is already `"ground-truth"`, it SHALL return early (stale Phase 1 callback guard).

#### Scenario: Partial completion
- **WHEN** 3 of 10 generation items have completed
- **THEN** the callback SHALL update `processedItems` to 3 and NOT trigger Phase 2

#### Scenario: All Phase 1 items complete triggers Phase 2
- **WHEN** the last generation item completes (10 of 10)
- **THEN** the callback SHALL store `phase1Stats`, transition to Phase 2, query all questions, and enqueue GT actions with new `workIds`

#### Scenario: Failed items counted
- **WHEN** a generation item fails after all retries
- **THEN** the callback SHALL increment `failedItems` and the item's error SHALL be recorded in `failedItemDetails`

#### Scenario: Stale Phase 1 callback after Phase 2 started
- **WHEN** an `onQuestionGenerated` callback fires but the job's phase is already `"ground-truth"`
- **THEN** the callback SHALL return early without modifying any counters

#### Scenario: Job already canceled
- **WHEN** an `onQuestionGenerated` callback fires but the job status is `"canceled"`
- **THEN** the callback SHALL return early without modifying any counters

### Requirement: Per-question ground truth action
The system SHALL provide an `assignGroundTruthForQuestion` action that receives a question ID, loads the question and corpus, runs `GroundTruthAssigner.assign()`, and updates the question's `relevantSpans` via `questions.updateSpans`. The action SHALL return `{ spansFound: number }`.

#### Scenario: Ground truth found
- **WHEN** the action runs and the LLM identifies relevant spans
- **THEN** it SHALL update the question with the character spans

#### Scenario: No ground truth found
- **WHEN** the action runs and the LLM finds no relevant spans
- **THEN** the question SHALL retain empty `relevantSpans`

### Requirement: Phase 2 completion callback (onGroundTruthAssigned)
The system SHALL provide an `onGroundTruthAssigned` mutation as the WorkPool `onComplete` callback for Phase 2. It SHALL use the shared `applyResult()` helper to compute counter increments. When all Phase 2 items complete, it SHALL finalize the job by: updating `datasets.questionCount`, determining final status considering BOTH Phase 2 failures and Phase 1 failures (from `phase1Stats`), setting `completedAt`, and scheduling a fire-and-forget LangSmith sync. The final status SHALL be `"completed"` if total failures across both phases is 0, `"failed"` if all Phase 2 items failed, or `"completed_with_errors"` otherwise.

#### Scenario: All GT items complete with no failures across both phases
- **WHEN** all ground truth items complete successfully and Phase 1 had no failures
- **THEN** the job status SHALL be set to `"completed"` and dataset `questionCount` SHALL be updated

#### Scenario: Phase 1 had failures but Phase 2 succeeded
- **WHEN** all Phase 2 items complete successfully but `phase1Stats.failedItems > 0`
- **THEN** the job status SHALL be set to `"completed_with_errors"`

#### Scenario: Some Phase 2 items failed
- **WHEN** some ground truth items failed after retries
- **THEN** the job status SHALL be set to `"completed_with_errors"`

### Requirement: Cancel generation
The system SHALL provide a `cancelGeneration` mutation that first sets the job status to `"canceling"` (so in-flight callbacks see the updated status), then iterates over the job's stored `workIds` and calls `pool.cancel(ctx, workId)` for each one. This provides selective cancellation — only this job's items are canceled, not other jobs sharing the same pool. Pending pool items SHALL be canceled; in-flight items SHALL complete normally. The job SHALL transition to `"canceled"` when all items finish (via the onComplete callbacks).

#### Scenario: Cancel mid-generation
- **WHEN** a user cancels during Phase 1 with 5/10 items processed
- **THEN** the status SHALL be set to `"canceling"` first, then only this job's pending items SHALL be canceled via per-item `pool.cancel()`, and the job SHALL eventually reach `"canceled"` status

#### Scenario: Multiple concurrent generation jobs
- **WHEN** two generation jobs are running in the same pool and one is canceled
- **THEN** only the canceled job's work items SHALL be affected; the other job's items SHALL continue running
