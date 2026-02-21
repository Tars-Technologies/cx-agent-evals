## Purpose

Frontend page and components for configuring and running pipeline-based retrieval experiments with two-phase execution (indexing + evaluation) and real-time progress streaming.

## ADDED Requirements

### Requirement: Experiments page layout
The system SHALL provide an experiments page at `/experiments` with a two-column layout: a fixed-width configuration panel (left) and a flexible execution panel (right). The page SHALL use the existing dark theme with JetBrains Mono font and emerald accent color.

#### Scenario: Page renders with two columns
- **WHEN** user navigates to `/experiments`
- **THEN** the page SHALL display a configuration panel on the left and an execution panel on the right

### Requirement: Dataset picker
The system SHALL provide a dataset picker dropdown that fetches datasets from Convex via reactive queries, ordered by creation date (most recent first). The picker SHALL display dataset names with question counts and show a loading state while fetching.

#### Scenario: Datasets load on page mount
- **WHEN** the experiments page loads
- **THEN** the dataset picker SHALL fetch and display available datasets

#### Scenario: Dataset selection shows info
- **WHEN** user selects a dataset
- **THEN** the UI SHALL display the dataset strategy, question count, and LangSmith sync status

### Requirement: Retriever configuration UI
The system SHALL provide a retriever configuration section in the left panel consisting of: a preset dropdown with optgroup for "Presets" (baseline-vector-rag, bm25, hybrid, hybrid-reranked) and "Saved Configurations" (from localStorage), an inline PipelineConfigSummary showing the active pipeline configuration, and a PipelineConfigModal for full pipeline editing.

#### Scenario: Preset dropdown selection
- **WHEN** user selects "hybrid" from the preset dropdown
- **THEN** the pipeline config SHALL be set to the hybrid preset defaults and the PipelineConfigSummary SHALL update to reflect the hybrid configuration

#### Scenario: Saved configs in dropdown
- **WHEN** user has custom configs saved in localStorage
- **THEN** the dropdown SHALL show them under a "Saved Configurations" optgroup below the "Presets" optgroup

#### Scenario: Selecting saved config restores it
- **WHEN** user selects a saved custom config from the dropdown
- **THEN** the pipeline config SHALL be restored from localStorage with all custom parameters

#### Scenario: Modified preset shows badge
- **WHEN** the active config is a modified version of a preset
- **THEN** a "(modified)" badge SHALL appear next to the dropdown in dim text

### Requirement: Metrics selection
The system SHALL provide checkboxes for selecting evaluation metrics: recall, precision, IoU, and F1. All metrics SHALL be selected by default.

#### Scenario: Toggle metrics
- **WHEN** user unchecks a metric
- **THEN** that metric SHALL be excluded from the experiment configuration

### Requirement: Experiment name input
The system SHALL provide an experiment name input that auto-generates from the pipeline config name and k value (e.g., `hybrid-reranked-k5`). The experiment name SHALL be separate from the pipeline config name — the config name identifies the retriever setup, while the experiment name identifies the specific run.

#### Scenario: Name auto-generates from config
- **WHEN** user selects the hybrid-reranked preset with k=5
- **THEN** the experiment name SHALL auto-generate as "hybrid-reranked-k5"

#### Scenario: Name updates when config changes
- **WHEN** user changes from hybrid-reranked to bm25 preset
- **THEN** the experiment name SHALL auto-update to "bm25-k5" (if not manually edited)

#### Scenario: User can edit name
- **WHEN** user edits the experiment name
- **THEN** the custom name SHALL be used and auto-generation SHALL stop

### Requirement: Run experiment button
The system SHALL provide a "Start Pipeline" button that triggers the experiment workflow. The button SHALL call the existing `experiments.start` mutation with the full PipelineConfig as the retrieverConfig parameter. The button SHALL be disabled when no dataset is selected, no pipeline config is set, or an experiment is already running.

#### Scenario: Button sends pipeline config to backend
- **WHEN** user clicks "Start Pipeline"
- **THEN** the mutation SHALL be called with `retrieverConfig` set to the full PipelineConfig object including index, query, search, and refinement stage configs

#### Scenario: Button disabled during run
- **WHEN** an experiment is running
- **THEN** the Start Pipeline button SHALL be disabled and show a spinner with "Running..." text

#### Scenario: Button disabled without dataset
- **WHEN** no dataset is selected
- **THEN** the Start Pipeline button SHALL be disabled

### Requirement: Experiment progress display
The system SHALL display real-time experiment progress using the two-phase execution layout (defined in experiment-execution-phases spec) instead of a single-status panel. Progress SHALL be driven by reactive Convex queries on the job record's status, phase, and progress fields.

#### Scenario: Progress updates reactively
- **WHEN** the backend job record updates
- **THEN** the phase cards SHALL update reactively via Convex useQuery hooks

#### Scenario: Phase-specific progress
- **WHEN** the job phase is "indexing"
- **THEN** Phase 1 SHALL show running status; Phase 2 SHALL show pending/waiting status

### Requirement: Experiment completion display
The system SHALL display experiment results upon completion, showing: aggregate metric scores in a 2×2 grid (formatted to 3 decimal places), a "View in LangSmith" link, and add the experiment to the recent experiments list.

#### Scenario: Scores displayed on completion
- **WHEN** an experiment completes successfully
- **THEN** the UI SHALL display the aggregate scores for each selected metric in a 2×2 grid

#### Scenario: LangSmith link provided
- **WHEN** an experiment completes
- **THEN** the UI SHALL show a "View in LangSmith →" link that opens the experiment in a new tab

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
