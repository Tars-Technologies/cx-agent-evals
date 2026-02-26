## ADDED Requirements

### Requirement: Standalone retrieve action
The system SHALL provide a Convex action `retrieveActions.retrieve` in a `"use node"` file that accepts `retrieverId` (Id referencing `retrievers`), `query` (string), and optional `k` (number, overrides retriever's default). The action SHALL: (1) load the retriever record and verify status is `"ready"`, (2) extract the embedding model from the retriever's index config, (3) embed the query using the specified embedding model, (4) perform vector search on `documentChunks` filtered by `kbId`, (5) post-filter results by `indexConfigHash`, (6) take top-k results, (7) hydrate chunks with document metadata via `internal.rag.fetchChunksWithDocs`, and (8) return an array of result objects with `chunkId`, `content`, `docId`, `start`, `end`, `score`, and `metadata`.

#### Scenario: Retrieve from ready retriever
- **WHEN** calling `retrieve` with a ready retriever ID and query "What is RAG?"
- **THEN** the action SHALL return up to k ranked chunks from the retriever's KB, each with content, document reference, character positions, and similarity score

#### Scenario: Retrieve from non-ready retriever fails
- **WHEN** calling `retrieve` with a retriever that has status `"indexing"` or `"error"`
- **THEN** the action SHALL throw an error indicating the retriever is not ready

#### Scenario: k override
- **WHEN** calling `retrieve` with k=3 on a retriever whose default k is 5
- **THEN** the action SHALL return at most 3 results

### Requirement: Retrieve action is a public action
The `retrieve` action SHALL be a public action (not internal) so it can be called from the frontend playground and from external consumers. It SHALL verify org ownership via `getAuthContext`.

#### Scenario: Auth required
- **WHEN** calling `retrieve` without valid authentication
- **THEN** the action SHALL reject the request with an auth error
