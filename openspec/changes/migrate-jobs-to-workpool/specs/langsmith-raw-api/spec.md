## ADDED Requirements

### Requirement: Create LangSmith experiment helper
The eval-lib SHALL export a `createLangSmithExperiment` function that creates a new experiment in LangSmith using the LangSmith client's raw API. It SHALL accept: `datasetName` (string), `experimentName` (string), and optional `metadata` (Record<string, unknown>). It SHALL return `{ experimentId: string, experimentUrl: string }`. The function SHALL use `experimentName` directly as the LangSmith project name (no additional timestamp suffix — the caller is responsible for providing a unique name).

#### Scenario: Create experiment
- **WHEN** called with a dataset name and experiment name
- **THEN** it SHALL create an experiment in LangSmith linked to the specified dataset and return the experiment ID and URL

#### Scenario: Experiment name used as-is
- **WHEN** called with `experimentName: "my-experiment-2024"`
- **THEN** the LangSmith project name SHALL be `"my-experiment-2024"` (not `"my-experiment-2024-1234567890"`)

### Requirement: Log LangSmith result helper
The eval-lib SHALL export a `logLangSmithResult` function that logs a single evaluation result to an existing LangSmith experiment. It SHALL accept: `experimentId` (string), `datasetExampleId` (optional string — links the run to a specific dataset example), `input` (the query), `output` (retrieved spans), `referenceOutput` (ground truth spans), and `scores` (Record<string, number>). It SHALL create a run in LangSmith, mark it as complete with a proper ISO 8601 timestamp, and attach scores as feedback. The run SHALL be associated with the experiment via `session_id` (not `project_name`), with `project_name` set to `undefined` to prevent LangSmith client from using a default project fallback.

#### Scenario: Log single result
- **WHEN** called with experiment ID and evaluation data
- **THEN** it SHALL create a run in the LangSmith experiment with the input, output, reference, and scores

#### Scenario: Log result with all metrics
- **WHEN** called with scores containing recall, precision, IoU, and F1
- **THEN** each metric SHALL appear as a feedback score on the LangSmith run

#### Scenario: Run end time format
- **WHEN** a run is marked as complete
- **THEN** the `end_time` SHALL be a proper ISO 8601 timestamp string (not a raw millisecond epoch)

#### Scenario: Optional dataset example linkage
- **WHEN** called with a `datasetExampleId`
- **THEN** the run SHALL include `reference_example_id` linking it to the LangSmith dataset example
- **WHEN** called without a `datasetExampleId`
- **THEN** the run SHALL still be created successfully without example linkage

### Requirement: Package export for langsmith subpath
The eval-lib `package.json` SHALL include a `./langsmith` export entry with `types`, `import`, and `require` fields. The `require` field SHALL point to the CJS build (`./dist/langsmith/index.cjs`) to ensure the subpath works in both ESM and CJS environments.

### Requirement: Preserve existing evaluate API
The existing `runLangSmithExperiment` function SHALL remain unchanged and continue to work for standalone (non-Convex) usage.

#### Scenario: Existing API still works
- **WHEN** `runLangSmithExperiment` is called directly
- **THEN** it SHALL behave identically to before this change
