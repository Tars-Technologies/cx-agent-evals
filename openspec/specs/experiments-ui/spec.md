## Purpose

Frontend page and components for configuring and running pipeline-based retrieval experiments with two-phase execution (indexing + evaluation) and real-time progress streaming.

## Requirements

### Requirement: Experiments page layout
The system SHALL provide an experiments page at `/experiments` with a two-column layout: a fixed-width configuration panel (left) and a flexible execution panel (right). The page SHALL use the existing dark theme with JetBrains Mono font and emerald accent color.

#### Scenario: Page renders with two columns
- **WHEN** user navigates to `/experiments`
- **THEN** the page SHALL display a configuration panel on the left and an execution panel on the right

### Requirement: Retriever configuration UI
The system SHALL provide a retriever selector dropdown in the left panel that lists all retrievers with status `"ready"` for the current org, fetched via `useQuery(api.retrievers.byOrg, { status: "ready" })`. Each option SHALL display the retriever name, KB name, and search strategy. Selecting a retriever SHALL auto-filter the dataset picker to datasets belonging to the same KB. The preset dropdown, PipelineConfigSummary, PipelineConfigModal, and localStorage-based config management SHALL be removed from this page.

#### Scenario: Retriever dropdown shows ready retrievers
- **WHEN** the experiments page loads
- **THEN** the retriever dropdown SHALL list all "ready" retrievers grouped by KB

#### Scenario: Selecting retriever filters datasets
- **WHEN** user selects a retriever belonging to "KB Alpha"
- **THEN** the dataset picker SHALL show only datasets belonging to "KB Alpha"

### Requirement: Dataset picker
The system SHALL provide a dataset picker dropdown that fetches datasets from Convex via reactive queries, filtered by the selected retriever's KB. The picker SHALL display dataset names with question counts and show a loading state while fetching.

#### Scenario: Datasets filtered by retriever's KB
- **WHEN** user selects a retriever for "KB Alpha"
- **THEN** the dataset picker SHALL show only datasets belonging to "KB Alpha"

#### Scenario: Dataset selection shows info
- **WHEN** user selects a dataset
- **THEN** the UI SHALL display the dataset strategy, question count, and LangSmith sync status

### Requirement: Metrics selection
The system SHALL provide checkboxes for selecting evaluation metrics: recall, precision, IoU, and F1. All metrics SHALL be selected by default.

#### Scenario: Toggle metrics
- **WHEN** user unchecks a metric
- **THEN** that metric SHALL be excluded from the experiment configuration

### Requirement: Experiment name input
The system SHALL provide an experiment name input that auto-generates from the retriever name and dataset name (e.g., `hybrid-reranked-dim-driven-50q`). The user SHALL be able to edit the name manually.

#### Scenario: Name auto-generates from retriever and dataset
- **WHEN** user selects retriever "hybrid-reranked" and dataset "dim-driven (50 questions)"
- **THEN** the experiment name SHALL auto-generate as "hybrid-reranked-dim-driven-50q"

#### Scenario: User can edit name
- **WHEN** user edits the experiment name
- **THEN** the custom name SHALL be used and auto-generation SHALL stop

### Requirement: Run experiment button
The system SHALL provide a "Run Experiment" button that triggers the experiment workflow. The button SHALL call `experiments.start` with `retrieverId` and `datasetId` (not inline `retrieverConfig`). The button SHALL be disabled when no retriever is selected, no dataset is selected, or an experiment is already running.

#### Scenario: Button sends retrieverId to backend
- **WHEN** user clicks "Run Experiment"
- **THEN** the mutation SHALL be called with `retrieverId` and `datasetId`

#### Scenario: Button disabled during run
- **WHEN** an experiment is running
- **THEN** the Run Experiment button SHALL be disabled and show a spinner with "Running..." text

#### Scenario: Button disabled without retriever
- **WHEN** no retriever is selected
- **THEN** the Run Experiment button SHALL be disabled

### Requirement: Experiment progress display
The system SHALL display real-time experiment progress using a single-phase evaluation card (no indexing phase). Progress SHALL be driven by reactive Convex queries on the job record's status and progress fields.

#### Scenario: Progress updates reactively
- **WHEN** the backend job record updates
- **THEN** the evaluation progress card SHALL update reactively via Convex useQuery hooks

#### Scenario: No indexing phase displayed
- **WHEN** an experiment is running
- **THEN** the UI SHALL show only the evaluation phase progress, not an indexing phase

### Requirement: Experiment completion display
The system SHALL display experiment results upon completion, showing: aggregate metric scores in a 2x2 grid (formatted to 3 decimal places), a "View in LangSmith" link, and add the experiment to the recent experiments list.

#### Scenario: Scores displayed on completion
- **WHEN** an experiment completes successfully
- **THEN** the UI SHALL display the aggregate scores for each selected metric in a 2x2 grid

#### Scenario: LangSmith link provided
- **WHEN** an experiment completes
- **THEN** the UI SHALL show a "View in LangSmith ->" link that opens the experiment in a new tab

### Requirement: Recent experiments list
The system SHALL display a list of recent experiments for the selected dataset, fetched from Convex via reactive queries. Each experiment card SHALL show the experiment name, status badge, key metric scores, and a "View in LangSmith" link.

#### Scenario: Experiments list loads on dataset selection
- **WHEN** user selects a dataset
- **THEN** the recent experiments list SHALL fetch and display experiments for that dataset

### Requirement: Error handling
The system SHALL display error states for: failed experiment runs and backend errors. Errors SHALL be shown in the relevant phase card with a descriptive message.

#### Scenario: Experiment run fails
- **WHEN** an experiment fails during execution
- **THEN** the relevant phase card SHALL display the error message in red
