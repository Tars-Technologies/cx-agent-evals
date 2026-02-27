## ADDED Requirements

### Requirement: Experiment WorkPool instance
The system SHALL create a `Workpool` instance backed by `components.experimentPool` with `maxParallelism: 10`, `retryActionsByDefault: true`, and `defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2000, base: 2 }`.

#### Scenario: Pool is available
- **WHEN** the Convex backend is deployed
- **THEN** the `experimentPool` component SHALL be available via `components.experimentPool`

### Requirement: Experiment progress fields
The `experiments` table SHALL include progress tracking fields: `totalQuestions` (optional number), `processedQuestions` (optional number, default 0), `failedQuestions` (optional number, default 0). These fields SHALL be used directly for progress display instead of a separate `jobs` record.

#### Scenario: Progress visible during evaluation
- **WHEN** an experiment is running with 15/50 questions evaluated
- **THEN** the `experiments` record SHALL have `totalQuestions: 50`, `processedQuestions: 15`

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

### Requirement: Per-question evaluation action
The system SHALL provide an `evaluateQuestion` action that:
1. Loads the question and its ground truth spans
2. Retrieves chunks using the same retrieval logic as `retrieverActions.retrieve` (embed query → vector search filtered by kbId → post-filter by indexConfigHash → take top-K)
3. Computes metrics (recall, precision, IoU, F1) by comparing retrieved spans to ground truth
4. Inserts an `experimentResults` record
5. Logs the result to LangSmith via `logLangSmithResult`
6. Returns `{ scores: Record<string, number> }`

The retrieval logic SHALL use the `kbId` and `indexConfigHash` from the experiment's associated retriever (or computed from legacy config).

#### Scenario: Question evaluated successfully
- **WHEN** the action runs for a question with ground truth
- **THEN** it SHALL retrieve chunks, compute metrics, store the result, and log to LangSmith

#### Scenario: Question with empty ground truth
- **WHEN** the action runs for a question with no ground truth spans
- **THEN** it SHALL still retrieve chunks and compute metrics (which will be 0 for recall/precision)

### Requirement: Experiment completion callback (onQuestionEvaluated)
The system SHALL provide an `onQuestionEvaluated` mutation as the WorkPool `onComplete` callback. It SHALL increment `processedQuestions` (on success) or `failedQuestions` (on failure) on the experiment record. When all questions are handled (processedQuestions + failedQuestions >= totalQuestions), it SHALL:
1. Query all `experimentResults` for the experiment
2. Compute average scores per metric
3. Update experiment with `scores`, `status: "completed"` (or `"completed_with_errors"`), and `completedAt`

#### Scenario: All questions evaluated
- **WHEN** the last question evaluation completes (50/50)
- **THEN** the callback SHALL aggregate scores and mark the experiment complete

#### Scenario: Some evaluations failed
- **WHEN** 48/50 succeed and 2/50 fail
- **THEN** the experiment SHALL be marked `"completed_with_errors"` with scores averaged over the 48 successful results

### Requirement: Cancel experiment
The system SHALL provide a `cancelExperiment` mutation that sets status to `"canceling"` and calls `pool.cancelAll(ctx)` on the experiment pool. The experiment SHALL transition to `"canceled"` when all in-flight evaluations finish.

#### Scenario: Cancel mid-evaluation
- **WHEN** a user cancels with 20/50 questions evaluated
- **THEN** pending evaluations SHALL be canceled and the experiment SHALL eventually reach `"canceled"` status
