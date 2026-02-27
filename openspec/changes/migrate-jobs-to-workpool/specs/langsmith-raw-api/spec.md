## ADDED Requirements

### Requirement: Create LangSmith experiment helper
The eval-lib SHALL export a `createLangSmithExperiment` function that creates a new experiment in LangSmith using the LangSmith client's raw API. It SHALL accept: `datasetName` (string), `experimentName` (string), and optional `metadata` (Record<string, unknown>). It SHALL return `{ experimentId: string, experimentUrl: string }`.

#### Scenario: Create experiment
- **WHEN** called with a dataset name and experiment name
- **THEN** it SHALL create an experiment in LangSmith linked to the specified dataset and return the experiment ID and URL

### Requirement: Log LangSmith result helper
The eval-lib SHALL export a `logLangSmithResult` function that logs a single evaluation result to an existing LangSmith experiment. It SHALL accept: `experimentId` (string), `datasetExampleId` (string), `input` (the query), `output` (retrieved spans), `referenceOutput` (ground truth spans), and `scores` (Record<string, number>). It SHALL create a run in LangSmith with the provided data.

#### Scenario: Log single result
- **WHEN** called with experiment ID and evaluation data
- **THEN** it SHALL create a run in the LangSmith experiment with the input, output, reference, and scores

#### Scenario: Log result with all metrics
- **WHEN** called with scores containing recall, precision, IoU, and F1
- **THEN** each metric SHALL appear as a feedback score on the LangSmith run

### Requirement: Preserve existing evaluate API
The existing `runLangSmithExperiment` function SHALL remain unchanged and continue to work for standalone (non-Convex) usage.

#### Scenario: Existing API still works
- **WHEN** `runLangSmithExperiment` is called directly
- **THEN** it SHALL behave identically to before this change
