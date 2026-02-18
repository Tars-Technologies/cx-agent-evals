## Purpose

LangSmith-based experiment runner that orchestrates retrieval evaluation through LangSmith's evaluate() function, providing per-query scores, retrieval traces, and experiment comparison.

## Requirements

### Requirement: LangSmith experiment runner function
The system SHALL provide an async `runLangSmithExperiment(config: LangSmithExperimentConfig)` function that orchestrates a full evaluation experiment through LangSmith. The config SHALL include `corpus: Corpus`, `retriever: Retriever`, `k: number`, `datasetName: string`, `metrics: Metric[]` (default: `[recall, precision, iou, f1]`), optional `experimentPrefix: string`, optional `metadata: Record<string, unknown>`, and optional `onResult` callback. When `onResult` is provided, the function SHALL call it for each evaluated question with the query text, retrieved spans, and computed metric scores.

#### Scenario: Full experiment lifecycle
- **WHEN** calling `runLangSmithExperiment(config)`
- **THEN** the function SHALL (1) initialize the retriever with the corpus, (2) create a target function closure over the initialized retriever, (3) wrap metrics as LangSmith evaluators that also invoke `onResult` with scores, (4) call LangSmith's `evaluate()` with the target, dataset, and evaluators, (5) clean up the retriever

#### Scenario: Retriever cleanup on success
- **WHEN** the experiment completes successfully
- **THEN** `retriever.cleanup()` SHALL be called

#### Scenario: Retriever cleanup on error
- **WHEN** an error occurs during evaluation
- **THEN** `retriever.cleanup()` SHALL still be called (via finally block)

#### Scenario: onResult callback fires for each question
- **WHEN** `onResult` is provided and the experiment evaluates 10 questions
- **THEN** `onResult` SHALL be called 10 times, once per question, with query, retrievedSpans, and scores

#### Scenario: onResult receives computed scores
- **WHEN** `onResult` fires for a question evaluated with metrics `["recall", "precision"]`
- **THEN** the `scores` object SHALL contain `{ recall: <number>, precision: <number> }`

#### Scenario: Experiment works without onResult
- **WHEN** `onResult` is not provided
- **THEN** the experiment SHALL run normally, only sending results to LangSmith

### Requirement: Target function shape
The target function passed to LangSmith's `evaluate()` SHALL accept `{ query: string }` as input and return `{ relevantSpans: Array<{ docId: string, start: number, end: number, text: string }> }`. It SHALL call `retriever.retrieve(query, k)` and convert the resulting `PositionAwareChunk[]` to serialized span objects.

#### Scenario: Target function retrieves and serializes
- **WHEN** LangSmith calls the target function with `{ query: "What is X?" }`
- **THEN** it SHALL call `retriever.retrieve("What is X?", k)` and return the chunks converted to span objects in `relevantSpans`

### Requirement: Experiment naming
The experiment SHALL be named using `experimentPrefix` if provided. If not provided, the system SHALL generate a prefix from the retriever's `name` property. Experiment metadata SHALL include the retriever name, k value, corpus size, and any user-provided metadata.

#### Scenario: Custom experiment prefix
- **WHEN** `experimentPrefix: "recursive-512-openai-k5"` is provided
- **THEN** the LangSmith experiment SHALL use that as its prefix

#### Scenario: Auto-generated prefix
- **WHEN** no `experimentPrefix` is provided and the retriever name is `"vector-rag"`
- **THEN** the system SHALL use `"vector-rag"` as the experiment prefix

#### Scenario: Metadata includes config dimensions
- **WHEN** running an experiment with `k: 5` on a corpus of 10 documents
- **THEN** the experiment metadata SHALL include `{ retriever: retriever.name, k: 5, corpusSize: 10 }` merged with any user-provided metadata

### Requirement: LangSmithExperimentConfig type
The system SHALL define a `LangSmithExperimentConfig` interface with `corpus: Corpus`, `retriever: Retriever`, `k: number`, `datasetName: string`, optional `metrics: Metric[]`, optional `experimentPrefix: string`, optional `metadata: Record<string, unknown>`, and optional `onResult: (result: ExperimentResult) => Promise<void>`. The `ExperimentResult` type SHALL contain `query: string`, `retrievedSpans: Array<{ docId: string; start: number; end: number; text: string }>`, and `scores: Record<string, number>`.

#### Scenario: Minimal config
- **WHEN** creating a config with only required fields
- **THEN** TypeScript SHALL accept `{ corpus, retriever, k: 5, datasetName: "my-dataset" }`

#### Scenario: Full config with all options
- **WHEN** creating a config with all fields
- **THEN** TypeScript SHALL accept metrics, experimentPrefix, metadata, and onResult alongside required fields
