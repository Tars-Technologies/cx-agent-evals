## Requirements

### Requirement: Retrievers page layout
The system SHALL provide a Retrievers page at `/retrievers` with a two-column layout: a fixed-width configuration panel (left, ~420px) and a flexible content panel (right). The page SHALL use the existing dark theme styling consistent with the Generate Questions and Experiments pages.

#### Scenario: Page renders with two columns
- **WHEN** user navigates to `/retrievers`
- **THEN** the page SHALL display a configuration panel on the left and a content panel on the right

### Requirement: KB selector in configuration panel
The configuration panel SHALL include a KB selector dropdown (reusing the existing `KBSelector` component pattern) that lists all knowledge bases for the current org. Selecting a KB SHALL filter the retriever list and playground to that KB.

#### Scenario: KB selection filters retrievers
- **WHEN** user selects "KB Alpha" from the dropdown
- **THEN** the retriever list and playground SHALL show only retrievers belonging to "KB Alpha"

### Requirement: Pipeline config in configuration panel
The configuration panel SHALL include a retriever configuration section with: a preset dropdown (baseline-vector-rag, bm25, hybrid, hybrid-reranked) with saved configs, an inline `PipelineConfigSummary` showing the active config, and a button to open the `PipelineConfigModal` for full editing. The `k` value SHALL be part of the config and displayed in the summary.

#### Scenario: Preset selection sets config
- **WHEN** user selects "hybrid-reranked" preset
- **THEN** the config summary SHALL update to show hybrid search with reranking, and the default k value

#### Scenario: Custom config via modal
- **WHEN** user opens the PipelineConfigModal and adjusts chunk size to 500 and k to 10
- **THEN** the config summary SHALL reflect the custom settings

### Requirement: Create retriever button
The configuration panel SHALL include a "Create Retriever" button that calls the `retrieverActions.create` action with the selected KB and current pipeline config. The button SHALL be disabled when no KB is selected or no config is set. After creation, the new retriever SHALL appear in the retriever list with status `"configuring"` (indexing is NOT automatically triggered).

#### Scenario: Create retriever sets configuring status
- **WHEN** user clicks "Create Retriever" with KB and config selected
- **THEN** a retriever SHALL be created and appear in the list with status `"configuring"`, ready for the user to start indexing

#### Scenario: Duplicate config shows feedback and highlights existing
- **WHEN** user clicks "Create Retriever" with a config that matches an existing retriever
- **THEN** an informational message SHALL appear ("A retriever with this configuration already exists") and the existing retriever card SHALL be highlighted with a pulsing accent ring for ~3 seconds

### Requirement: Retriever list
The content panel SHALL display a list of retrievers for the selected KB, fetched via `useQuery(api.retrievers.byKb)`. Each retriever card SHALL display: name, status badge (indexing/ready/error with appropriate colors), config summary (index strategy, search strategy, k value), chunk count (when ready), and action buttons.

#### Scenario: Retriever list updates reactively
- **WHEN** a retriever's indexing job completes
- **THEN** the retriever card SHALL reactively update from "indexing" to "ready" status

#### Scenario: Indexing progress shown
- **WHEN** a retriever has status "indexing"
- **THEN** the card SHALL display indexing progress (processed/total docs) by querying the linked indexing job

### Requirement: Retriever card lifecycle actions
Each retriever card SHALL display lifecycle-aware action buttons based on the retriever's current status:

- **configuring**: "Start Indexing" (accent-styled, triggers `retrieverActions.startIndexing`) + "Delete" (removes retriever)
- **indexing**: Spinning progress indicator with "Indexing..." label + "Cancel" button (calls `indexing.cancelIndexing` then `retrievers.resetAfterCancel`)
- **ready**: "Delete Index" (calls `retrievers.deleteIndex`, resets to configuring) + "Delete Retriever" (calls `retrievers.remove`, cascades to delete index)
- **error**: "Retry Indexing" (accent-styled, triggers `retrieverActions.startIndexing`) + "Delete" (removes retriever)

#### Scenario: Start indexing from configuring state
- **WHEN** user clicks "Start Indexing" on a retriever with status "configuring"
- **THEN** the indexing service SHALL be triggered and the retriever status SHALL change to "indexing"

#### Scenario: Cancel indexing
- **WHEN** user clicks "Cancel" on a retriever with status "indexing"
- **THEN** the indexing job SHALL be canceled and the retriever status SHALL reset to "configuring"

#### Scenario: Delete index preserves retriever
- **WHEN** user clicks "Delete Index" on a ready retriever
- **THEN** the indexed chunks SHALL be deleted but the retriever record SHALL remain with status "configuring"

#### Scenario: Delete retriever cascades
- **WHEN** user clicks "Delete Retriever" on a ready retriever
- **THEN** the retriever record SHALL be removed AND the index chunks SHALL be cleaned up (if not shared)

### Requirement: Playground section below retriever list
The content panel SHALL include a Retriever Playground section below the retriever list (as specified in the `retriever-playground` capability spec). The playground operates on retrievers for the currently selected KB.

#### Scenario: Playground visible when KB selected
- **WHEN** user has selected a KB
- **THEN** the playground section SHALL be visible below the retriever list
