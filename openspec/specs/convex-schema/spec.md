## Requirements

### Requirement: Org-scoped Convex schema definition
The system SHALL define a Convex schema with the following tables, all scoped by `orgId` where applicable: `users`, `knowledgeBases`, `documents`, `datasets`, `questions`, `experiments`, `experimentResults`, `jobs`, `jobItems`, `documentChunks`. All table definitions SHALL use Convex's `defineTable` with `v` validators. The schema SHALL be defined in a single `schema.ts` file within the `convex/` directory. A shared `spanValidator` (`v.object({ docId: v.string(), start: v.number(), end: v.number(), text: v.string() })`) SHALL be used for CharacterSpan-shaped fields in both `questions.relevantSpans` and `experimentResults.retrievedSpans`.

#### Scenario: Schema file exists and is valid
- **WHEN** the Convex backend is deployed
- **THEN** the schema SHALL be successfully validated by Convex with all tables, indexes, vector indexes, and search indexes created

### Requirement: Users table
The system SHALL define a `users` table with fields: `clerkId` (string, the Clerk user ID), `email` (string), `name` (string), and `createdAt` (number, Unix timestamp). The table SHALL have an index `by_clerk_id` on `["clerkId"]`.

#### Scenario: User lookup by Clerk ID
- **WHEN** querying `users` with index `by_clerk_id` and a valid Clerk user ID
- **THEN** the query SHALL return the matching user document or null

### Requirement: Knowledge bases table
The system SHALL define a `knowledgeBases` table with fields: `orgId` (string, Clerk org ID), `name` (string), `description` (optional string), `metadata` (v.any()), `createdBy` (Id referencing `users`), and `createdAt` (number). The table SHALL have an index `by_org` on `["orgId"]`.

#### Scenario: List knowledge bases for organization
- **WHEN** querying `knowledgeBases` with index `by_org` and a valid org ID
- **THEN** the query SHALL return all knowledge bases belonging to that organization

### Requirement: Documents table
The system SHALL define a `documents` table with fields: `orgId` (string), `kbId` (Id referencing `knowledgeBases`), `docId` (string, the eval-lib DocumentId e.g. filename), `title` (string, original filename), `content` (string, full markdown text), `fileId` (Id referencing `_storage`, the uploaded file), `contentLength` (number), `metadata` (object), and `createdAt` (number). The table SHALL have indexes `by_kb` on `["kbId"]` and `by_org` on `["orgId"]`. The table SHALL have a search index `search_content` with `searchField: "content"` and `filterFields: ["kbId"]`.

#### Scenario: List documents in a knowledge base
- **WHEN** querying `documents` with index `by_kb` and a valid knowledge base ID
- **THEN** the query SHALL return all documents belonging to that knowledge base

#### Scenario: Full-text search within knowledge base
- **WHEN** searching `documents` with search index `search_content` filtered by `kbId`
- **THEN** the query SHALL return documents whose content matches the search query within that knowledge base

### Requirement: Datasets table
The system SHALL define a `datasets` table with fields: `orgId` (string), `kbId` (Id referencing `knowledgeBases`), `name` (string), `strategy` (string, one of `"simple"`, `"dimension-driven"`, `"real-world-grounded"`), `strategyConfig` (object, strategy-specific parameters), `questionCount` (number), `langsmithDatasetId` (optional string), `langsmithUrl` (optional string), `langsmithSyncStatus` (optional string, one of `"pending"`, `"synced"`, `"failed"`), `metadata` (object), `createdBy` (Id referencing `users`), and `createdAt` (number). The table SHALL have indexes `by_org` on `["orgId"]` and `by_kb` on `["kbId"]`.

#### Scenario: List datasets for organization
- **WHEN** querying `datasets` with index `by_org` and a valid org ID
- **THEN** the query SHALL return all datasets belonging to that organization

### Requirement: Questions table
The system SHALL define a `questions` table with fields: `datasetId` (Id referencing `datasets`), `queryId` (string, eval-lib QueryId), `queryText` (string), `sourceDocId` (string, which document generated this question), `relevantSpans` (array of objects, each with `docId` (string), `start` (number), `end` (number), `text` (string)), and `metadata` (object). The table SHALL have indexes `by_dataset` on `["datasetId"]` and `by_source_doc` on `["datasetId", "sourceDocId"]`.

#### Scenario: List questions in a dataset
- **WHEN** querying `questions` with index `by_dataset` and a valid dataset ID
- **THEN** the query SHALL return all questions belonging to that dataset

#### Scenario: List questions by source document
- **WHEN** querying `questions` with index `by_source_doc` filtered by dataset ID and source doc ID
- **THEN** the query SHALL return only questions generated from that specific document

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

### Requirement: Experiment results table
The system SHALL define an `experimentResults` table with fields: `experimentId` (Id referencing `experiments`), `questionId` (Id referencing `questions`), `retrievedSpans` (array of objects, each with `docId`, `start`, `end`, `text`), `scores` (object, per-question metric scores), and `metadata` (object). The table SHALL have an index `by_experiment` on `["experimentId"]`.

#### Scenario: List results for an experiment
- **WHEN** querying `experimentResults` with index `by_experiment` and a valid experiment ID
- **THEN** the query SHALL return all per-question results for that experiment

### Requirement: Jobs table
The system SHALL define a `jobs` table with fields: `orgId` (string), `type` (string, one of `"generation"`, `"experiment"`, `"langsmith-sync"`, `"indexing"`), `status` (string, one of `"pending"`, `"running"`, `"completed"`, `"failed"`), `phase` (optional string, current pipeline phase), `progress` (optional object with `current` (number), `total` (number), `message` (optional string)), `result` (optional object, final output), `error` (optional string), `retryCount` (number, default 0), `maxRetries` (number, default 3), `intermediateState` (optional object, for passing state between chained actions), `createdBy` (Id referencing `users`), and `createdAt` (number). The table SHALL have an index `by_org_status` on `["orgId", "status"]`.

#### Scenario: Query running jobs for organization
- **WHEN** querying `jobs` with index `by_org_status` filtered by org ID and status `"running"`
- **THEN** the query SHALL return all currently running jobs for that organization

### Requirement: Job items table
The system SHALL define a `jobItems` table with fields: `jobId` (Id referencing `jobs`), `phase` (string, e.g. `"summarize"`, `"generate"`, `"ground-truth"`), `itemKey` (string, e.g. docId or questionId), `status` (string, one of `"pending"`, `"done"`, `"failed"`), `result` (optional object, item-specific output), `error` (optional string), and `processedAt` (optional number). The table SHALL have indexes `by_job_phase` on `["jobId", "phase"]` and `by_job_phase_status` on `["jobId", "phase", "status"]`.

#### Scenario: Get pending items for a job phase
- **WHEN** querying `jobItems` with index `by_job_phase_status` filtered by job ID, phase, and status `"pending"`
- **THEN** the query SHALL return all unprocessed items for that phase

#### Scenario: Count completed items for progress
- **WHEN** querying `jobItems` with index `by_job_phase` filtered by job ID and phase
- **THEN** the results can be counted by status to compute progress (done/total)

### Requirement: Document chunks table with vector index
The system SHALL define a `documentChunks` table with fields: `documentId` (Id referencing `documents`), `kbId` (Id referencing `knowledgeBases`), `indexConfigHash` (string, SHA-256 hash of the IndexConfig used to create these chunks), `chunkId` (string, PositionAwareChunkId), `content` (string, chunk text), `start` (number, character position in source document), `end` (number, character position in source document), `embedding` (optional array of float64 — null during Phase A of two-phase indexing, set during Phase B), and `metadata` (object). The table SHALL have indexes `by_document` on `["documentId"]`, `by_kb` on `["kbId"]`, `by_kb_config` on `["kbId", "indexConfigHash"]`, and `by_doc_config` on `["documentId", "indexConfigHash"]`. The table SHALL have a vector index `by_embedding` with `vectorField: "embedding"`, `dimensions: 1536`, and `filterFields: ["kbId", "indexConfigHash"]`. Chunks with no embedding set SHALL be automatically excluded from vector search results by Convex's vector index behavior.

#### Scenario: Vector search within knowledge base scoped by index config
- **WHEN** performing a vector search on `documentChunks` with index `by_embedding` filtered by `kbId` and `indexConfigHash`
- **THEN** the query SHALL return only chunks that have embeddings, ordered by embedding similarity, scoped to the specified knowledge base and index configuration

#### Scenario: Chunks preserve character positions
- **WHEN** a document chunk is stored
- **THEN** the `start` and `end` fields SHALL accurately represent the character-level positions in the source document, such that `document.content.substring(chunk.start, chunk.end) === chunk.content`

#### Scenario: Un-embedded chunks invisible to search
- **WHEN** chunks are inserted without embeddings (Phase A of two-phase indexing)
- **THEN** those chunks SHALL NOT appear in vector search results until their embeddings are patched in Phase B

#### Scenario: Query chunks by document and config
- **WHEN** querying `documentChunks` with index `by_doc_config` filtered by `documentId` and `indexConfigHash`
- **THEN** the query SHALL return all chunks for that document under that specific index configuration

### Requirement: Indexing jobs table
The system SHALL define an `indexingJobs` table with fields: `orgId` (string), `kbId` (Id referencing `knowledgeBases`), `indexConfigHash` (string), `indexConfig` (any, serialized IndexConfig for display), `status` (string, one of `"pending"`, `"running"`, `"completed"`, `"completed_with_errors"`, `"failed"`, `"canceling"`, `"canceled"`), `totalDocs` (number), `processedDocs` (number), `failedDocs` (number), `skippedDocs` (number), `totalChunks` (number), `error` (optional string, job-level error), `failedDocDetails` (optional array of objects with `documentId` (Id referencing `documents`) and `error` (string)), `createdBy` (Id referencing `users`), `createdAt` (number, epoch ms), and `completedAt` (optional number, epoch ms). The table SHALL have indexes `by_kb_config` on `["kbId", "indexConfigHash"]`, `by_org` on `["orgId"]`, and `by_status` on `["orgId", "status"]`.

#### Scenario: Query active indexing job for a KB config
- **WHEN** querying `indexingJobs` with index `by_kb_config` filtered by `kbId` and `indexConfigHash`
- **THEN** the query SHALL return all indexing jobs for that KB and config combination, allowing dedup checks

#### Scenario: List indexing jobs by org
- **WHEN** querying `indexingJobs` with index `by_org` filtered by `orgId`
- **THEN** the query SHALL return all indexing jobs for that organization

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
