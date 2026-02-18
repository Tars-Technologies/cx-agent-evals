## ADDED Requirements

### Requirement: Dataset sync to LangSmith action
The system SHALL provide an internal action `langsmithSync.syncDataset` in `convex/langsmithSync.ts` (a `"use node"` file) that accepts a `datasetId`. It SHALL: (1) set `langsmithSyncStatus` to `"syncing"`, (2) read all questions for the dataset, (3) convert them to eval-lib's `GroundTruth[]` format using `QueryId`, `QueryText`, `DocumentId` branded types, (4) call eval-lib's `uploadDataset()` to create/update the LangSmith dataset, (5) update the `datasets` record with `langsmithDatasetId`, `langsmithUrl`, and `langsmithSyncStatus: "synced"`. If no questions exist, it SHALL set status to `"skipped"`. If the sync fails, it SHALL set `langsmithSyncStatus: "failed: <error message>"` (prefixed with "failed:" for cron retry detection).

#### Scenario: Successful dataset sync
- **WHEN** `langsmithSync.syncDataset` is called for a dataset with 100 questions
- **THEN** a LangSmith dataset SHALL be created with 100 examples, and the Convex dataset record SHALL be updated with the LangSmith ID and URL

#### Scenario: Sync failure does not affect Convex data
- **WHEN** `langsmithSync.syncDataset` fails due to LangSmith API error
- **THEN** the dataset's `langsmithSyncStatus` SHALL be set to `"failed"`, but all questions and data in Convex SHALL remain intact

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

### Requirement: Sync status visible in queries
All queries that return datasets or experiments SHALL include the `langsmithSyncStatus` and `langsmithUrl` fields, allowing the frontend to show sync status and provide "View in LangSmith" links.

#### Scenario: Dataset query includes sync status
- **WHEN** querying datasets for an organization
- **THEN** each dataset SHALL include `langsmithSyncStatus` (null, "syncing", "synced", "skipped", or "failed: <message>") and `langsmithUrl` (if synced)

### Requirement: Cron job for failed sync retry
The system SHALL define a cron job in `convex/crons.ts` that runs every hour via `crons.interval("retry failed langsmith syncs", { hours: 1 }, internal.langsmithSyncRetry.retryFailed)`. The `langsmithSyncRetry.retryFailed` internal action in `convex/langsmithSyncRetry.ts` (a `"use node"` file) SHALL: (1) query for datasets with `langsmithSyncStatus` starting with `"failed:"` via `langsmithSyncRetry.getFailedDatasets` internal query, (2) schedule `langsmithSync.syncDataset` for each.

Note: The current implementation scans all datasets (no dedicated index on sync status). A `MAX_AUTO_RETRIES` constant is defined but retry counting is not yet tracked per-resource.

#### Scenario: Cron retries failed syncs
- **WHEN** the hourly cron runs and finds datasets with `langsmithSyncStatus` starting with `"failed:"`
- **THEN** sync actions SHALL be scheduled for those datasets
