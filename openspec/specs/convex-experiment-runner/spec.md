## Requirements

### Requirement: Start experiment mutation
The system SHALL provide a Convex mutation `experiments.start` that accepts `retrieverId` (Id referencing `retrievers`), `datasetId` (Id referencing `datasets`), `name` (string), and `metricNames` (array of strings). It SHALL load the retriever record, verify the retriever status is `"ready"`, verify the dataset belongs to the same KB as the retriever, verify the dataset belongs to the user's org, create an `experiments` record with `status: "pending"` and `retrieverId` set, create a `jobs` record with `type: "experiment"`, and schedule `internal.experimentActions.runExperiment`. It SHALL return `{ jobId, experimentId }`. For backward compatibility, it SHALL also accept the legacy form with `retrieverConfig` (v.any()) and `k` (number) instead of `retrieverId`.

Note: Experiment functions are split across two files due to Convex's `"use node"` constraint — `experiments.ts` contains mutations and queries, `experimentActions.ts` (a `"use node"` file) contains the pipeline actions.

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

#### Scenario: Results saved to Convex during experiment
- **WHEN** `runLangSmithExperiment()` evaluates each question
- **THEN** the `onResult` callback SHALL write each result to the `experimentResults` table with retrieved spans and per-question scores, enabling real-time UI updates

#### Scenario: Dataset synced before experiment if needed
- **WHEN** the parent dataset has no `langsmithDatasetId`
- **THEN** the action SHALL call `syncDataset` to upload the dataset to LangSmith before running the experiment

### Requirement: Aggregate metric computation
After `runLangSmithExperiment()` completes, the action SHALL compute the average score for each metric across all per-question results saved to `experimentResults` and update the `experiments` record's `scores` field.

#### Scenario: Aggregate scores computed
- **WHEN** an experiment completes evaluation of 100 questions with metrics `["recall", "precision"]`
- **THEN** the experiment's `scores` SHALL contain `{ recall: <avg>, precision: <avg> }` averaged across all 100 questions

### Requirement: CallbackRetriever uses Convex vector search
The `CallbackRetriever`'s `retrieveFn` SHALL embed the query using the embedding model from the retriever config, call `ctx.vectorSearch("documentChunks", "by_embedding", { vector, limit, filter: (q) => q.eq("kbId", kbId) })`, hydrate results via `ctx.runQuery(internal.rag.fetchChunksWithDocs, { ids })`, post-filter by `indexConfigHash`, take top-k, and convert each chunk to a `PositionAwareChunk`.

#### Scenario: Retrieval uses indexConfigHash post-filtering
- **WHEN** `retrieveFn` is called for a retriever with indexConfigHash "abc123"
- **THEN** it SHALL vector-search by kbId, then post-filter to only chunks matching indexConfigHash "abc123", and return up to k results

### Requirement: List experiments query
The system SHALL provide a Convex query `experiments.byDataset` that accepts a `datasetId` and returns all experiments for that dataset, including their `name`, `status`, `scores`, `retrieverConfig`, `k`, `langsmithUrl`, and `createdAt`.

#### Scenario: List experiments for dataset
- **WHEN** calling `experiments.byDataset` with a valid dataset ID
- **THEN** the query SHALL return all experiments for that dataset, ordered by creation date descending

### Requirement: Get experiment results query
The system SHALL provide a Convex query `experimentResults.byExperiment` that accepts an `experimentId` and returns all per-question results, including retrieved spans and scores.

#### Scenario: View per-question results
- **WHEN** calling `experimentResults.byExperiment` for a completed experiment
- **THEN** the query SHALL return all per-question results with retrieved spans and individual metric scores

### Requirement: Reuse existing document chunks
When starting an experiment, the `runExperiment` action SHALL check if the knowledge base already has any chunks via `ctx.runQuery(internal.rag.isIndexed, { kbId })`. If chunks exist, the indexing step SHALL be skipped entirely. The check is presence-based (any chunks exist for that kbId), not config-based — re-indexing with different chunk sizes requires explicitly deleting existing chunks first via `rag.deleteKbChunks`.

#### Scenario: Skip indexing for previously chunked knowledge base
- **WHEN** starting an experiment on a knowledge base that already has chunks
- **THEN** the indexing step SHALL be skipped, and `runLangSmithExperiment()` SHALL start immediately using existing chunks
