## MODIFIED Requirements

### Requirement: Retriever configuration UI
The system SHALL provide a retriever configuration section in the left panel consisting of: a preset dropdown with optgroup for "Presets" (baseline-vector-rag, bm25, hybrid, hybrid-reranked) and "Saved Configurations" (from localStorage), an inline PipelineConfigSummary showing the active pipeline configuration, and a PipelineConfigModal for full pipeline editing. The previous flat controls for chunker, embedder, vector store, reranker, and k SHALL be removed.

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

### Requirement: Experiment progress display
The system SHALL display real-time experiment progress using the two-phase execution layout (defined in experiment-execution-phases spec) instead of the previous single-status panel. Progress SHALL be driven by reactive Convex queries on the job record's status, phase, and progress fields.

#### Scenario: Progress updates reactively
- **WHEN** the backend job record updates
- **THEN** the phase cards SHALL update reactively via Convex useQuery hooks

#### Scenario: Phase-specific progress
- **WHEN** the job phase is "indexing"
- **THEN** Phase 1 SHALL show running status; Phase 2 SHALL show pending/waiting status

### Requirement: Run experiment button
The system SHALL provide a "Start Pipeline" button (replacing the previous "Run Experiment" button) that triggers the experiment workflow. The button SHALL call the existing `experiments.start` mutation with the full PipelineConfig as the retrieverConfig parameter.

#### Scenario: Button sends pipeline config to backend
- **WHEN** user clicks "Start Pipeline"
- **THEN** the mutation SHALL be called with `retrieverConfig` set to the full PipelineConfig object including index, query, search, and refinement stage configs

#### Scenario: Button disabled without dataset
- **WHEN** no dataset is selected
- **THEN** the Start Pipeline button SHALL be disabled

## REMOVED Requirements

### Requirement: Retriever configuration UI
**Reason**: Replaced by pipeline preset dropdown + PipelineConfigModal + PipelineConfigSummary. The flat inline controls for chunker type/size/overlap, embedder dropdown, vector store dropdown, reranker dropdown, and k input are replaced by the modal-based pipeline configuration system.
**Migration**: All retriever configuration now happens through the PipelineConfigModal. The k parameter is part of the Search stage configuration within the modal.
