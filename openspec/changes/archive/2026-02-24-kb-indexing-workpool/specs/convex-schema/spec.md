## MODIFIED Requirements

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

### Requirement: Experiments table — indexConfigHash field
The `experiments` table SHALL include an optional `indexConfigHash` field (`v.optional(v.string())`). This field records the index configuration hash used during the experiment's indexing phase, enabling cleanup of specific index configurations after experiment completion.

#### Scenario: Experiment stores its index config hash
- **WHEN** an experiment runs and indexes a KB
- **THEN** the `indexConfigHash` used for that indexing SHALL be persisted on the experiment record for future reference

## ADDED Requirements

### Requirement: Indexing jobs table
The system SHALL define an `indexingJobs` table with fields: `orgId` (string), `kbId` (Id referencing `knowledgeBases`), `indexConfigHash` (string), `indexConfig` (any, serialized IndexConfig for display), `status` (string, one of `"pending"`, `"running"`, `"completed"`, `"completed_with_errors"`, `"failed"`, `"canceling"`, `"canceled"`), `totalDocs` (number), `processedDocs` (number), `failedDocs` (number), `skippedDocs` (number), `totalChunks` (number), `error` (optional string, job-level error), `failedDocDetails` (optional array of objects with `documentId` (Id referencing `documents`) and `error` (string)), `createdBy` (Id referencing `users`), `createdAt` (number, epoch ms), and `completedAt` (optional number, epoch ms). The table SHALL have indexes `by_kb_config` on `["kbId", "indexConfigHash"]`, `by_org` on `["orgId"]`, and `by_status` on `["orgId", "status"]`.

#### Scenario: Query active indexing job for a KB config
- **WHEN** querying `indexingJobs` with index `by_kb_config` filtered by `kbId` and `indexConfigHash`
- **THEN** the query SHALL return all indexing jobs for that KB and config combination, allowing dedup checks

#### Scenario: List indexing jobs by org
- **WHEN** querying `indexingJobs` with index `by_org` filtered by `orgId`
- **THEN** the query SHALL return all indexing jobs for that organization
