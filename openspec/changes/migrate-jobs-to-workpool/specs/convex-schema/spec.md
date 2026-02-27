## ADDED Requirements

### Requirement: Generation jobs table
The system SHALL define a `generationJobs` table with fields: `orgId` (string), `kbId` (Id referencing `knowledgeBases`), `datasetId` (Id referencing `datasets`), `strategy` (string, one of `"simple"`, `"dimension-driven"`, `"real-world-grounded"`), `status` (string, one of `"pending"`, `"running"`, `"completed"`, `"completed_with_errors"`, `"failed"`, `"canceling"`, `"canceled"`), `phase` (string, one of `"generating"`, `"ground-truth"`), `totalItems` (number), `processedItems` (number), `failedItems` (number), `skippedItems` (number), `error` (optional string), `failedItemDetails` (optional array of objects with `itemKey` (string) and `error` (string)), `createdBy` (Id referencing `users`), `createdAt` (number), and `completedAt` (optional number). The table SHALL have indexes `by_dataset` on `["datasetId"]`, `by_org` on `["orgId"]`, and `by_status` on `["orgId", "status"]`.

#### Scenario: Query active generation job for a dataset
- **WHEN** querying `generationJobs` with index `by_dataset` filtered by `datasetId`
- **THEN** the query SHALL return all generation jobs for that dataset

#### Scenario: List generation jobs by org
- **WHEN** querying `generationJobs` with index `by_org` filtered by `orgId`
- **THEN** the query SHALL return all generation jobs for that organization

## MODIFIED Requirements

### Requirement: Experiments table
The system SHALL define an `experiments` table with fields: `orgId` (string), `datasetId` (Id referencing `datasets`), `name` (string), `retrieverId` (optional Id referencing `retrievers`), `retrieverConfig` (optional object, legacy inline config), `k` (optional number, top-k retrieval count), `metricNames` (array of strings), `status` (string, one of `"pending"`, `"running"`, `"completed"`, `"completed_with_errors"`, `"failed"`, `"canceling"`, `"canceled"`), `phase` (optional string, one of `"initializing"`, `"indexing"`, `"syncing"`, `"evaluating"`, `"aggregating"`, `"done"`), `totalQuestions` (optional number), `processedQuestions` (optional number), `failedQuestions` (optional number), `indexConfigHash` (optional string), `scores` (optional object, aggregate metric scores), `langsmithExperimentId` (optional string), `langsmithUrl` (optional string), `error` (optional string), `createdBy` (Id referencing `users`), `createdAt` (number), `completedAt` (optional number). The table SHALL have indexes `by_org` on `["orgId"]`, `by_dataset` on `["datasetId"]`, and `by_retriever` on `["retrieverId"]`.

#### Scenario: List experiments for a dataset
- **WHEN** querying `experiments` with index `by_dataset` and a valid dataset ID
- **THEN** the query SHALL return all experiments for that dataset

#### Scenario: Track experiment progress
- **WHEN** an experiment is running
- **THEN** the `totalQuestions`, `processedQuestions`, and `failedQuestions` fields SHALL reflect current evaluation progress

#### Scenario: List experiments by retriever
- **WHEN** querying `experiments` with index `by_retriever` and a valid retriever ID
- **THEN** the query SHALL return all experiments that used that retriever

## REMOVED Requirements

### Requirement: Jobs table
**Reason**: Replaced by dedicated tracking tables (`generationJobs` for generation, `experiments` table with added progress fields for experiments, existing `indexingJobs` for indexing).
**Migration**: Query `generationJobs` for generation progress, `experiments` for experiment progress. No data migration needed — jobs are transient operational data.

### Requirement: Job items table
**Reason**: WorkPool tracks individual work items internally. No application-level item tracking needed.
**Migration**: Remove all references to `jobItems` queries/mutations. WorkPool's `onComplete` callback handles per-item result processing.
