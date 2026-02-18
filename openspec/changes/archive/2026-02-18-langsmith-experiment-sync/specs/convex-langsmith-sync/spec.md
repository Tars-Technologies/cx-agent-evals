## REMOVED Requirements

### Requirement: Experiment sync to LangSmith action
**Reason**: Experiment sync via `client.createRun()` created orphaned runs not linked to LangSmith datasets. Replaced by using `evaluate()` from `langsmith/evaluation` directly within the experiment execution action, which creates proper dataset-linked experiments.
**Migration**: Experiments now sync to LangSmith natively during execution via `runLangSmithExperiment()`. No separate sync step needed. The `syncExperiment` action and `syncDatasetDirect` helper in `langsmithSync.ts` are deleted. The `langsmithRetry.retryExperimentSync` mutation is also removed since experiment sync is no longer a separate operation.

## MODIFIED Requirements

### Requirement: Automatic sync after completion
The system SHALL automatically schedule a LangSmith dataset sync action when a generation job completes. Experiment sync is no longer a separate post-completion step — it happens during experiment execution via `runLangSmithExperiment()`.

#### Scenario: Sync scheduled after generation completes
- **WHEN** a question generation job reaches `status: "completed"`
- **THEN** a LangSmith dataset sync action SHALL be automatically scheduled

#### Scenario: Experiment syncs during execution
- **WHEN** an experiment runs via `runLangSmithExperiment()`
- **THEN** the experiment SHALL be synced to LangSmith as part of the `evaluate()` call, not as a separate post-completion action

### Requirement: Manual sync retry
The system SHALL provide a Convex mutation `langsmithRetry.retryDatasetSync` in `convex/langsmithRetry.ts` (a regular file, NOT `"use node"`) that accepts a `datasetId`, verifies the dataset belongs to the user's org, and schedules `langsmithSync.syncDataset`. The `retryExperimentSync` mutation is removed since experiment sync is no longer a separate operation.

#### Scenario: Retry failed dataset sync
- **WHEN** a user calls `langsmithRetry.retryDatasetSync` for a dataset
- **THEN** a new `langsmithSync.syncDataset` action SHALL be scheduled
