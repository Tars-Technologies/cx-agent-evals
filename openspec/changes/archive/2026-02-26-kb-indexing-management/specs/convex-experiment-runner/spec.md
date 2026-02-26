## MODIFIED Requirements

### Requirement: Start experiment mutation
The system SHALL provide a Convex mutation `experiments.start` that accepts `retrieverId` (Id referencing `retrievers`), `datasetId` (Id referencing `datasets`), `name` (string), and `metricNames` (array of strings). It SHALL load the retriever record, verify the retriever status is `"ready"`, verify the dataset belongs to the same KB as the retriever, verify the dataset belongs to the user's org, create an `experiments` record with `status: "pending"` and `retrieverId` set, create a `jobs` record with `type: "experiment"`, and schedule `internal.experimentActions.runExperiment`. It SHALL return `{ jobId, experimentId }`. For backward compatibility, it SHALL also accept the legacy form with `retrieverConfig` (v.any()) and `k` (number) instead of `retrieverId`.

#### Scenario: Start experiment with retriever reference
- **WHEN** calling `experiments.start` with a ready retriever ID, dataset, and metrics
- **THEN** an experiment record SHALL be created with `retrieverId` set, and the `runExperiment` action SHALL be scheduled

#### Scenario: Start experiment with non-ready retriever fails
- **WHEN** calling `experiments.start` with a retriever that has status `"indexing"`
- **THEN** the mutation SHALL throw an error indicating the retriever is not ready

#### Scenario: Legacy start with inline config still works
- **WHEN** calling `experiments.start` with `retrieverConfig` and `k` instead of `retrieverId`
- **THEN** the experiment SHALL be created and run using the legacy flow (compute indexConfigHash, trigger indexing, evaluate)

### Requirement: Experiment execution as single action with LangSmith evaluate()
The system SHALL implement experiment execution in `convex/experimentActions.ts` (a `"use node"` file) as a single action `runExperiment` that: (1) loads the experiment record and determines if it uses `retrieverId` or legacy `retrieverConfig`, (2) if `retrieverId`: loads the retriever config from the `retrievers` table, extracts `indexConfigHash` and `k` from the retriever, skips indexing (already done), (3) if legacy `retrieverConfig`: computes `indexConfigHash`, triggers and polls indexing as before, (4) ensures the parent dataset is synced to LangSmith, (5) creates a `CallbackRetriever` that delegates to Convex vector search with `kbId` and `indexConfigHash` post-filtering, (6) calls `runLangSmithExperiment()` with an `onResult` callback that writes each result to the `experimentResults` table, (7) aggregates scores and updates the experiment status.

#### Scenario: Experiment with retrieverId skips indexing
- **WHEN** `runExperiment` executes for an experiment with `retrieverId`
- **THEN** it SHALL load the retriever's config and indexConfigHash directly, skip indexing, and proceed to evaluation

#### Scenario: Legacy experiment with retrieverConfig triggers indexing
- **WHEN** `runExperiment` executes for an experiment with inline `retrieverConfig` (no `retrieverId`)
- **THEN** it SHALL compute indexConfigHash, call `startIndexing`, poll until complete, and then evaluate

### Requirement: CallbackRetriever uses Convex vector search
The `CallbackRetriever`'s `retrieveFn` SHALL embed the query using the embedding model from the retriever config, call `ctx.vectorSearch("documentChunks", "by_embedding", { vector, limit, filter: (q) => q.eq("kbId", kbId) })`, hydrate results via `ctx.runQuery(internal.rag.fetchChunksWithDocs, { ids })`, post-filter by `indexConfigHash`, take top-k, and convert each chunk to a `PositionAwareChunk`.

#### Scenario: Retrieval uses indexConfigHash post-filtering
- **WHEN** `retrieveFn` is called for a retriever with indexConfigHash "abc123"
- **THEN** it SHALL vector-search by kbId, then post-filter to only chunks matching indexConfigHash "abc123", and return up to k results
