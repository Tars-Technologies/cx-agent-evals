## MODIFIED Requirements

### Requirement: LangSmithExperimentConfig type
The system SHALL define a `LangSmithExperimentConfig` interface with `corpus: Corpus`, `retriever: Retriever`, `k: number`, `datasetName: string`, optional `metrics: Metric[]`, optional `experimentPrefix: string`, optional `metadata: Record<string, unknown>`, and optional `onResult: (result: ExperimentResult) => Promise<void>`. The `ExperimentResult` type SHALL contain `query: string`, `retrievedSpans: Array<{ docId: string; start: number; end: number; text: string }>`, and `scores: Record<string, number>`.

#### Scenario: Minimal config
- **WHEN** creating a config with only required fields
- **THEN** TypeScript SHALL accept `{ corpus, retriever, k: 5, datasetName: "my-dataset" }`

#### Scenario: Full config with all options
- **WHEN** creating a config with all fields
- **THEN** TypeScript SHALL accept metrics, experimentPrefix, metadata, and onResult alongside required fields

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
