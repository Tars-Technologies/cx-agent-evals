## ADDED Requirements

### Requirement: Experiment WorkPool instance
The system SHALL create a `Workpool` instance backed by `components.experimentPool` with `maxParallelism: 1` and `retryActionsByDefault: false`. Retry is disabled because `evaluate()` processes the full dataset sequentially — retrying after a timeout restarts from scratch. Parallelism is 1 because the single WorkPool item runs the entire evaluation.

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
The system SHALL provide a `runExperiment` orchestrator action that performs sequential setup, then enqueues a single evaluation WorkPool item. The orchestrator SHALL support two paths:

**Retriever path** (when `experiment.retrieverId` is set):
1. Load retriever record and verify `status === "ready"`
2. Use retriever's `indexConfigHash` and `defaultK` directly — skip indexing entirely
3. Sync dataset to LangSmith if not already synced
4. Update experiment status to `"running"` with `totalQuestions` set
5. Enqueue a single `runEvaluation` action into `experimentPool` with `onComplete: onExperimentComplete`

**Legacy path** (when `experiment.retrieverConfig` is set):
1. Compute `indexConfigHash` from inline config
2. Trigger KB indexing via `indexing.startIndexing` and poll until complete
3. Continue with steps 3-5 from retriever path above

The orchestrator SHALL update the experiment's `status` and `phase` fields at each step for progress visibility.

#### Scenario: Retriever already ready — skip indexing
- **WHEN** the experiment references a retriever with `status: "ready"`
- **THEN** the orchestrator SHALL skip indexing entirely and proceed to dataset sync

#### Scenario: Legacy path triggers indexing
- **WHEN** the experiment uses inline `retrieverConfig` and KB is not yet indexed
- **THEN** the orchestrator SHALL trigger indexing and poll until complete before proceeding

#### Scenario: Orchestrator enqueues evaluation
- **WHEN** setup completes for a dataset with 50 questions
- **THEN** the orchestrator SHALL enqueue a single `runEvaluation` action and return

#### Scenario: Orchestrator fails during setup
- **WHEN** dataset sync fails
- **THEN** the experiment status SHALL be set to `"failed"` with the error message

#### Scenario: Empty dataset
- **WHEN** the dataset has zero questions
- **THEN** the orchestrator SHALL mark the experiment as `"completed"` with `totalQuestions: 0` and phase `"done"` without enqueueing any evaluation actions

### Requirement: Single evaluation action (runEvaluation)
The system SHALL provide a `runEvaluation` action that wraps LangSmith's `evaluate()` function as a single WorkPool item. It SHALL:
1. Load experiment config and all KB documents to build a corpus
2. Create a `CallbackRetriever` backed by Convex vector search (embed query → vector search filtered by kbId → post-filter by indexConfigHash → take top-K)
3. Call `runLangSmithExperiment()` which internally uses LangSmith's `evaluate()` API — this handles creating the experiment, running the target per example, computing metrics via evaluator adapters, and creating properly linked runs
4. The `onResult` callback SHALL write per-question results to `experimentResults` and update `processedQuestions` on the experiment for real-time progress
5. After `evaluate()` completes, aggregate average scores per metric and mark the experiment as `"completed"` (or `"completed_with_errors"`)

LangSmith's `evaluate()` is used (instead of raw API) because it produces the full per-example UI in LangSmith (diffs, individual metrics, traces) that cannot be replicated via raw API calls.

#### Scenario: Evaluation completes successfully
- **WHEN** the action runs for a dataset with 50 questions
- **THEN** it SHALL call evaluate() on the full dataset, stream per-question results to Convex via onResult, aggregate scores, and mark the experiment complete

#### Scenario: Per-question progress updates
- **WHEN** evaluate() processes each question
- **THEN** the onResult callback SHALL increment `processedQuestions` on the experiment for real-time UI progress

### Requirement: Experiment completion callback (onExperimentComplete)
The system SHALL provide an `onExperimentComplete` mutation as the WorkPool `onComplete` callback for the single evaluation item. Since there is only one WorkPool item per experiment:
- On `success`: the action itself has already marked the experiment as completed with aggregated scores. The callback SHALL be a no-op.
- On `failed`: the callback SHALL mark the experiment as `"failed"` with the error message (if not already marked failed by the action's error handling).
- On `canceled`: the callback SHALL mark the experiment as `"canceled"`.

#### Scenario: Evaluation succeeds
- **WHEN** the single evaluation action completes successfully
- **THEN** the callback SHALL do nothing (action already finalized the experiment)

#### Scenario: Evaluation fails (timeout or error)
- **WHEN** the evaluation action fails
- **THEN** the callback SHALL mark the experiment as `"failed"` with error details

#### Scenario: Evaluation canceled
- **WHEN** the evaluation action is canceled via WorkPool
- **THEN** the callback SHALL mark the experiment as `"canceled"`

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
