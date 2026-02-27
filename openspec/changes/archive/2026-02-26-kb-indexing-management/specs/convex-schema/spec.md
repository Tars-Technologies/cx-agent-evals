## ADDED Requirements

### Requirement: Retrievers table
The system SHALL define a `retrievers` table with fields: `orgId` (string), `kbId` (Id referencing `knowledgeBases`), `name` (string, user-visible retriever name), `retrieverConfig` (v.any(), full pipeline config including index, query, search, refinement, and k), `indexConfigHash` (string, SHA-256 hash of the index stage config), `retrieverConfigHash` (string, SHA-256 hash of the full retriever config including k), `defaultK` (number, top-k for retrieval), `indexingJobId` (optional Id referencing `indexingJobs`), `status` (string, one of `"configuring"`, `"indexing"`, `"ready"`, `"error"`), `chunkCount` (optional number, populated when indexing completes), `error` (optional string), `createdBy` (Id referencing `users`), and `createdAt` (number). The table SHALL have indexes `by_org` on `["orgId"]`, `by_kb` on `["kbId"]`, and `by_kb_config_hash` on `["kbId", "retrieverConfigHash"]`.

#### Scenario: Query retrievers for a KB
- **WHEN** querying `retrievers` with index `by_kb` filtered by `kbId`
- **THEN** the query SHALL return all retrievers for that knowledge base

#### Scenario: Dedup check by KB and config hash
- **WHEN** querying `retrievers` with index `by_kb_config_hash` filtered by `kbId` and `retrieverConfigHash`
- **THEN** the query SHALL return at most one retriever, enabling duplicate detection

#### Scenario: List retrievers by org
- **WHEN** querying `retrievers` with index `by_org` filtered by `orgId`
- **THEN** the query SHALL return all retrievers for that organization

## MODIFIED Requirements

### Requirement: Experiments table
The system SHALL define an `experiments` table with fields: `orgId` (string), `datasetId` (Id referencing `datasets`), `name` (string), `retrieverId` (optional Id referencing `retrievers`, used by new experiment flow), `retrieverConfig` (optional object, retained for legacy experiments), `k` (optional number, retained for legacy experiments), `metricNames` (array of strings), `status` (string, one of `"pending"`, `"running"`, `"completed"`, `"failed"`), `indexConfigHash` (optional string), `scores` (optional object), `langsmithExperimentId` (optional string), `langsmithUrl` (optional string), `langsmithSyncStatus` (optional string), `error` (optional string), `createdBy` (Id referencing `users`), and `createdAt` (number). The table SHALL have indexes `by_org` on `["orgId"]`, `by_dataset` on `["datasetId"]`, and a new index `by_retriever` on `["retrieverId"]`.

#### Scenario: List experiments for a dataset
- **WHEN** querying `experiments` with index `by_dataset` and a valid dataset ID
- **THEN** the query SHALL return all experiments for that dataset

#### Scenario: List experiments for a retriever
- **WHEN** querying `experiments` with index `by_retriever` and a valid retriever ID
- **THEN** the query SHALL return all experiments that used that retriever

#### Scenario: Legacy experiment without retrieverId
- **WHEN** querying an experiment created before this change
- **THEN** the experiment SHALL have `retrieverConfig` and `k` fields set, with `retrieverId` being undefined
