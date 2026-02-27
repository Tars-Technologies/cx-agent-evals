## ADDED Requirements

### Requirement: Create retriever action
The system SHALL provide a Convex action `retrieverActions.create` (in a "use node" file for Node.js crypto access) that accepts `kbId` (Id referencing `knowledgeBases`) and `retrieverConfig` (object containing `name`, `index`, `query`, `search`, `refinement`, and `k` fields), and computes both `indexConfigHash` (from the index stage config) and `retrieverConfigHash` (from the full config including `k`). Before creating, it SHALL check for an existing retriever with the same `(kbId, retrieverConfigHash)` — if found, return the existing retriever ID with `existing: true`. Otherwise, it SHALL create a `retrievers` record with status `"configuring"` (indexing is NOT triggered at creation time) and return the new retriever ID with `existing: false`.

#### Scenario: Create new retriever without triggering indexing
- **WHEN** calling `retrieverActions.create` with a KB and pipeline config that has no existing retriever
- **THEN** a retriever record SHALL be created with status `"configuring"`, no indexing SHALL be triggered, and the retriever ID SHALL be returned with `existing: false`

#### Scenario: Duplicate retriever returns existing
- **WHEN** calling `retrieverActions.create` with a `(kbId, retrieverConfig)` that matches an existing retriever's `retrieverConfigHash`
- **THEN** the existing retriever's ID SHALL be returned with `existing: true` without creating a new record

### Requirement: Start indexing action
The system SHALL provide a Convex action `retrieverActions.startIndexing` that accepts a `retrieverId`, loads the retriever config, and triggers indexing via `internal.indexing.startIndexing`. It SHALL only be callable when the retriever status is `"configuring"` or `"error"`. If the indexing service reports `alreadyCompleted`, the retriever status SHALL be set to `"ready"` immediately; otherwise it SHALL be set to `"indexing"`.

#### Scenario: Start indexing for a new retriever
- **WHEN** calling `startIndexing` on a retriever with status `"configuring"`
- **THEN** the indexing service SHALL be triggered, the retriever status SHALL change to `"indexing"`, and the `indexingJobId` SHALL be linked

#### Scenario: Shared index config skips re-indexing
- **WHEN** starting indexing for a retriever whose `indexConfigHash` matches an already-completed indexing job for the same KB
- **THEN** the indexing service SHALL return `alreadyCompleted: true` and the retriever status SHALL be set to `"ready"` immediately

#### Scenario: Retry indexing after error
- **WHEN** calling `startIndexing` on a retriever with status `"error"`
- **THEN** the indexing service SHALL be triggered and the retriever status SHALL change to `"indexing"`

### Requirement: List retrievers by KB query
The system SHALL provide a Convex query `retrievers.byKb` that accepts a `kbId` and returns all retrievers for that KB, including `name`, `status`, `retrieverConfig`, `indexConfigHash`, `retrieverConfigHash`, `chunkCount`, `createdAt`, and `indexingJobId`. Results SHALL be ordered by creation date descending.

#### Scenario: List retrievers for a KB
- **WHEN** calling `retrievers.byKb` with a valid KB ID
- **THEN** the query SHALL return all retrievers for that KB with their current status

### Requirement: List retrievers by org query
The system SHALL provide a Convex query `retrievers.byOrg` that returns all retrievers for the current user's org, optionally filtered by `status`. This enables the experiments page to list all "ready" retrievers across KBs.

#### Scenario: List ready retrievers for org
- **WHEN** calling `retrievers.byOrg` with status filter `"ready"`
- **THEN** the query SHALL return only retrievers with status `"ready"` across all KBs in the org

### Requirement: Get retriever query
The system SHALL provide a Convex query `retrievers.get` that accepts a retriever ID and returns the full retriever record including config, status, and indexing job details.

#### Scenario: Get retriever with indexing progress
- **WHEN** calling `retrievers.get` for a retriever with status `"indexing"`
- **THEN** the query SHALL return the retriever record with the `indexingJobId` that can be used to query indexing progress

### Requirement: Delete retriever mutation (with cascade)
The system SHALL provide a Convex mutation `retrievers.remove` that accepts a retriever ID, verifies org ownership, and deletes the retriever record. Before deleting, if the retriever has an indexing job and is in "ready" or "indexing" status, it SHALL check if any other retriever shares the same `(kbId, indexConfigHash)` — if not, it SHALL schedule cleanup of the indexed chunks via `indexingActions.cleanupAction`.

#### Scenario: Delete retriever cascades to delete unshared index
- **WHEN** deleting a retriever whose index is not shared by any other retriever
- **THEN** the retriever record SHALL be deleted AND the indexed chunks SHALL be cleaned up

#### Scenario: Delete retriever preserves shared index
- **WHEN** deleting a retriever whose index IS shared by another retriever on the same KB
- **THEN** the retriever record SHALL be deleted but the indexed chunks SHALL be preserved

### Requirement: Delete index mutation
The system SHALL provide a Convex mutation `retrievers.deleteIndex` that accepts a retriever ID, verifies the retriever is in "ready" or "error" status, deletes the indexed chunks for `(kbId, indexConfigHash)` (verifying no other retriever shares them), and resets the retriever status to `"configuring"`. The retriever record itself is preserved.

#### Scenario: Delete index resets retriever to configuring
- **WHEN** deleting the index for a ready retriever whose index is not shared
- **THEN** the chunks SHALL be deleted and the retriever status SHALL change to `"configuring"`

#### Scenario: Delete index blocked when chunks are shared
- **WHEN** deleting the index for a retriever whose `indexConfigHash` is shared by another retriever on the same KB
- **THEN** the deletion SHALL fail with an error indicating the chunks are shared

### Requirement: Reset retriever after indexing cancel
The system SHALL provide a Convex mutation `retrievers.resetAfterCancel` that accepts a retriever ID and resets its status to `"configuring"`, clearing `indexingJobId`, `chunkCount`, and `error`. This is called by the frontend after `indexing.cancelIndexing` completes.

#### Scenario: Reset after cancel
- **WHEN** the frontend cancels an indexing job and then calls `resetAfterCancel`
- **THEN** the retriever status SHALL be reset to `"configuring"` with all indexing fields cleared

### Requirement: Update retriever status on indexing completion
The system SHALL update the retriever's status from `"indexing"` to `"ready"` when the linked indexing job completes successfully, and to `"error"` when the indexing job fails. The `chunkCount` field SHALL be populated from the indexing job's `totalChunks`. This can be achieved by querying the indexing job status reactively or via a callback.

#### Scenario: Retriever becomes ready after indexing
- **WHEN** the indexing job linked to a retriever completes with status `"completed"`
- **THEN** the retriever's status SHALL be updated to `"ready"` and `chunkCount` SHALL be set

#### Scenario: Retriever shows error after indexing failure
- **WHEN** the indexing job linked to a retriever fails
- **THEN** the retriever's status SHALL be updated to `"error"` with the error message from the indexing job

### Requirement: Compute retrieverConfigHash
The system SHALL compute `retrieverConfigHash` as a deterministic SHA-256 hash of the full retriever config including all four stages (index, query, search, refinement) and `k`. The hash SHALL use sorted keys for deterministic serialization, matching the pattern used by `computeIndexConfigHash` in eval-lib.

#### Scenario: Same config produces same hash
- **WHEN** two retriever configs have identical index, query, search, refinement, and k values but different names
- **THEN** they SHALL produce the same `retrieverConfigHash`

#### Scenario: Different k produces different hash
- **WHEN** two retriever configs are identical except for k (k=5 vs k=10)
- **THEN** they SHALL produce different `retrieverConfigHash` values
