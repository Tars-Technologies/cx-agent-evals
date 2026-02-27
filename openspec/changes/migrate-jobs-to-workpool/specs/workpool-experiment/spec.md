## ADDED Requirements

### Requirement: Experiment WorkPool instance
The system SHALL create a `Workpool` instance backed by `components.experimentPool` with `maxParallelism: 10`, `retryActionsByDefault: true`, and `defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2000, base: 2 }`.

#### Scenario: Pool is available
- **WHEN** the Convex backend is deployed
- **THEN** the `experimentPool` component SHALL be available via `components.experimentPool`

### Requirement: Experiment progress fields
The `experiments` table SHALL include progress tracking fields: `totalQuestions` (optional number), `processedQuestions` (optional number, default 0), `failedQuestions` (optional number, default 0), `skippedQuestions` (optional number, default 0), and `workIds` (optional array of strings for selective cancellation). These fields SHALL be used directly for progress display instead of a separate `jobs` record. The `skippedQuestions` counter SHALL track items canceled by the WorkPool (distinct from `failedQuestions` which tracks items that errored after all retries).

#### Scenario: Progress visible during evaluation
- **WHEN** an experiment is running with 15/50 questions evaluated
- **THEN** the `experiments` record SHALL have `totalQuestions: 50`, `processedQuestions: 15`

#### Scenario: Canceled items tracked separately from failures
- **WHEN** an experiment is canceled with 10 processed, 2 failed, and 3 canceled
- **THEN** `processedQuestions: 10`, `failedQuestions: 2`, `skippedQuestions: 3`

### Requirement: Start experiment mutation
The system SHALL provide an `experiments.start` mutation that creates an `experiments` record with `status: "pending"` and schedules the orchestrator action (`runExperiment`). It SHALL accept either `retrieverId` (new path — references a pre-indexed retriever) or `retrieverConfig` (legacy path — inline config). It SHALL NOT create a separate `jobs` record.

#### Scenario: Experiment started with retrieverId
- **WHEN** a user starts an experiment with a `retrieverId`
- **THEN** the system SHALL verify the retriever has `status: "ready"` and belongs to the same KB as the dataset, create an experiment record, and schedule the orchestrator action

#### Scenario: Experiment started with legacy retrieverConfig
- **WHEN** a user starts an experiment with inline `retrieverConfig`
- **THEN** the system SHALL create an experiment record and schedule the orchestrator action

### Requirement: Orchestrator action
The system SHALL provide a `runExperiment` orchestrator action that performs sequential setup, then fans out per-question evaluation. The orchestrator SHALL support two paths:

**Retriever path** (when `experiment.retrieverId` is set):
1. Load retriever record and verify `status === "ready"`
2. Use retriever's `indexConfigHash` and `defaultK` directly — skip indexing entirely
3. Sync dataset to LangSmith if not already synced
4. Create a LangSmith experiment via raw API (`createLangSmithExperiment`)
5. Update experiment status to `"running"` with `totalQuestions` set
6. Enqueue one `evaluateQuestion` action per question into `experimentPool` with `onComplete: onQuestionEvaluated`

**Legacy path** (when `experiment.retrieverConfig` is set):
1. Compute `indexConfigHash` from inline config
2. Trigger KB indexing via `indexing.startIndexing` and poll until complete
3. Continue with steps 3-6 from retriever path above

The orchestrator SHALL update the experiment's `status` and `phase` fields at each step for progress visibility.

#### Scenario: Retriever already ready — skip indexing
- **WHEN** the experiment references a retriever with `status: "ready"`
- **THEN** the orchestrator SHALL skip indexing entirely and proceed to dataset sync

#### Scenario: Legacy path triggers indexing
- **WHEN** the experiment uses inline `retrieverConfig` and KB is not yet indexed
- **THEN** the orchestrator SHALL trigger indexing and poll until complete before proceeding

#### Scenario: Orchestrator sets up and fans out
- **WHEN** setup completes for a dataset with 50 questions
- **THEN** the orchestrator SHALL enqueue 50 evaluation actions and return

#### Scenario: Orchestrator fails during setup
- **WHEN** dataset sync or LangSmith experiment creation fails
- **THEN** the experiment status SHALL be set to `"failed"` with the error message

#### Scenario: Empty dataset
- **WHEN** the dataset has zero questions
- **THEN** the orchestrator SHALL mark the experiment as `"completed"` with `totalQuestions: 0` and phase `"done"` without enqueueing any evaluation actions

### Requirement: Per-question evaluation action
The system SHALL provide an `evaluateQuestion` action that:
1. Loads the question and its ground truth spans
2. Retrieves chunks using the same retrieval logic as `retrieverActions.retrieve` (embed query → vector search filtered by kbId → post-filter by indexConfigHash → take top-K)
3. Computes metrics (recall, precision, IoU, F1) by comparing retrieved spans to ground truth
4. Inserts an `experimentResults` record
5. Logs the result to LangSmith via `logLangSmithResult`, passing the question's `langsmithExampleId` (if available) for proper experiment-to-dataset correlation
6. Returns `{ scores: Record<string, number> }`

The retrieval logic SHALL use the `kbId` and `indexConfigHash` from the experiment's associated retriever (or computed from legacy config).

#### Scenario: Question evaluated successfully
- **WHEN** the action runs for a question with ground truth
- **THEN** it SHALL retrieve chunks, compute metrics, store the result, and log to LangSmith

#### Scenario: Question with empty ground truth
- **WHEN** the action runs for a question with no ground truth spans
- **THEN** it SHALL still retrieve chunks and compute metrics (which will be 0 for recall/precision)

### Requirement: Experiment completion callback (onQuestionEvaluated)
The system SHALL provide an `onQuestionEvaluated` mutation as the WorkPool `onComplete` callback. It SHALL increment `processedQuestions` (on success), `failedQuestions` (on failure), or `skippedQuestions` (on canceled) on the experiment record. If `totalQuestions` is 0 or undefined, the callback SHALL return early without processing. When all questions are handled (processedQuestions + failedQuestions + skippedQuestions >= totalQuestions), it SHALL:
1. Query all `experimentResults` for the experiment
2. Compute average scores per metric
3. Update experiment with `scores`, `status: "completed"` (or `"completed_with_errors"`), `skippedQuestions`, and `completedAt`

#### Scenario: All questions evaluated
- **WHEN** the last question evaluation completes (50/50)
- **THEN** the callback SHALL aggregate scores and mark the experiment complete

#### Scenario: Some evaluations failed
- **WHEN** 48/50 succeed and 2/50 fail
- **THEN** the experiment SHALL be marked `"completed_with_errors"` with scores averaged over the 48 successful results

#### Scenario: Canceled items tracked as skipped
- **WHEN** a work item result has `kind: "canceled"`
- **THEN** it SHALL increment `skippedQuestions`, NOT `failedQuestions`

#### Scenario: Zero totalQuestions guard
- **WHEN** the callback fires but `totalQuestions` is 0 or undefined
- **THEN** the callback SHALL return early without modifying the experiment

### Requirement: Cancel experiment
The system SHALL provide a `cancelExperiment` mutation that first sets status to `"canceling"` (so in-flight callbacks see the updated status), then iterates over the experiment's stored `workIds` and calls `pool.cancel(ctx, workId)` for each one. This provides selective cancellation — only this experiment's items are canceled, not other experiments sharing the same pool. The experiment SHALL transition to `"canceled"` when all items finish (via the onComplete callbacks).

#### Scenario: Cancel mid-evaluation
- **WHEN** a user cancels with 20/50 questions evaluated
- **THEN** the status SHALL be set to `"canceling"` first, then only this experiment's pending items SHALL be canceled via per-item `pool.cancel()`, and the experiment SHALL eventually reach `"canceled"` status

#### Scenario: Multiple concurrent experiments
- **WHEN** two experiments are running in the same pool and one is canceled
- **THEN** only the canceled experiment's work items SHALL be affected; the other experiment's items SHALL continue running

### Requirement: WorkPool instance visibility
The `Workpool` instance for experiments SHALL be a module-private constant (not exported). Only the mutations and queries in `experiments.ts` SHALL access it directly.

### Requirement: Public experiment query null safety
The `experiments.get` public query SHALL return `null` (not throw) when the experiment is not found or belongs to a different org. This prevents `useQuery` from throwing when called with a stale or deleted experiment ID.
