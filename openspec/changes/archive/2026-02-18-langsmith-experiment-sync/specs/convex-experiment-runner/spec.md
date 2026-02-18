## MODIFIED Requirements

### Requirement: Experiment execution as single action with LangSmith evaluate()
The system SHALL implement experiment execution in `convex/experimentActions.ts` (a `"use node"` file) as a single action `runExperiment` that: (1) ensures the KB is indexed (reusing existing `indexSingleDocument` from `ragActions.ts` if needed), (2) ensures the parent dataset is synced to LangSmith (calling `syncDataset` if `langsmithDatasetId` is missing), (3) creates a `CallbackRetriever` from eval-lib that delegates `retrieveFn` to Convex vector search (`ctx.vectorSearch` + `fetchChunksWithDocs`), (4) loads the corpus from Convex document tables via `createCorpusFromDocuments()`, (5) calls `runLangSmithExperiment()` from eval-lib with the `CallbackRetriever`, corpus, metrics, dataset name, and an `onResult` callback that writes each result to the `experimentResults` table, (6) after `runLangSmithExperiment()` completes, aggregates scores and updates the experiment status to `"completed"`.

Note: The old 3-phase pipeline (indexing → evaluation → aggregation as separate chained actions via `processBatch`) is replaced by this single action. The `processBatch` pattern is no longer used for the evaluation phase.

#### Scenario: Experiment runs with LangSmith integration
- **WHEN** an experiment is started against a dataset with 50 questions
- **THEN** the action SHALL call `runLangSmithExperiment()`, which creates a proper LangSmith experiment linked to the dataset, computes evaluator scores, and the experiment appears in LangSmith's comparison UI

#### Scenario: Results saved to Convex during experiment
- **WHEN** `runLangSmithExperiment()` evaluates each question
- **THEN** the `onResult` callback SHALL write each result to the `experimentResults` table with retrieved spans and per-question scores, enabling real-time UI updates

#### Scenario: Dataset synced before experiment if needed
- **WHEN** the parent dataset has no `langsmithDatasetId`
- **THEN** the action SHALL call `syncDataset` to upload the dataset to LangSmith before running the experiment

### Requirement: Start experiment mutation
The system SHALL provide a Convex mutation `experiments.start` in `convex/experiments.ts` (a regular file, NOT `"use node"`) that accepts `datasetId`, `name`, `retrieverConfig` (v.any() — an opaque config object), `k` (number), and `metricNames` (array of strings). It SHALL verify the dataset belongs to the user's org, create an `experiments` record with `status: "pending"`, create a `jobs` record with `type: "experiment"`, and schedule `internal.experimentActions.runExperiment` as a single action. It SHALL return `{ jobId, experimentId }`.

#### Scenario: Start experiment with standard config
- **WHEN** calling `experiments.start` with a dataset, k=10, and metrics `["recall", "precision", "f1"]`
- **THEN** an experiment and job SHALL be created, and the `runExperiment` action SHALL be scheduled

### Requirement: Reuse existing document chunks
When starting an experiment, the `runExperiment` action SHALL check if the knowledge base already has any chunks via `ctx.runQuery(internal.rag.isIndexed, { kbId })`. If chunks exist, the indexing step SHALL be skipped entirely. The check is presence-based (any chunks exist for that kbId), not config-based — re-indexing with different chunk sizes requires explicitly deleting existing chunks first via `rag.deleteKbChunks`.

#### Scenario: Skip indexing for previously chunked knowledge base
- **WHEN** starting an experiment on a knowledge base that already has chunks
- **THEN** the indexing step SHALL be skipped, and `runLangSmithExperiment()` SHALL start immediately using existing chunks

### Requirement: Aggregate metric computation
After `runLangSmithExperiment()` completes, the action SHALL compute the average score for each metric across all per-question results saved to `experimentResults` and update the `experiments` record's `scores` field.

#### Scenario: Aggregate scores computed
- **WHEN** an experiment completes evaluation of 100 questions with metrics `["recall", "precision"]`
- **THEN** the experiment's `scores` SHALL contain `{ recall: <avg>, precision: <avg> }` averaged across all 100 questions

### Requirement: CallbackRetriever uses Convex vector search
The `CallbackRetriever`'s `retrieveFn` SHALL embed the query using `OpenAIEmbedder`, call `ctx.vectorSearch("documentChunks", "by_embedding", { vector, limit: k, filter: (q) => q.eq("kbId", kbId) })`, hydrate results via `ctx.runQuery(internal.rag.fetchChunksWithDocs, { ids })`, and convert each chunk to a `PositionAwareChunk` with `id`, `content`, `docId`, `start`, `end`, and `metadata`.

#### Scenario: Retrieval uses Convex vector index
- **WHEN** `retrieveFn` is called with query "What is RAG?" and k=5
- **THEN** it SHALL embed the query, vector-search the `documentChunks` table, and return up to 5 `PositionAwareChunk` objects with correct docId, start, end, and content fields
