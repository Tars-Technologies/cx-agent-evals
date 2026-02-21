## ADDED Requirements

### Requirement: Modal overlay and layout
The system SHALL provide a `PipelineConfigModal` component rendered as a fixed overlay (z-60) with backdrop blur, matching the DimensionWizard modal pattern. The modal SHALL have max-w-2xl, max-h-[80vh] with a scrollable content area, a header with title and close button, and a footer with "Save & Close" button.

#### Scenario: Modal opens from Edit link
- **WHEN** user clicks the "Edit" link in the PipelineConfigSummary
- **THEN** the PipelineConfigModal SHALL open with the current pipeline configuration pre-filled

#### Scenario: Modal opens from Configure Pipeline button
- **WHEN** no pipeline config is set and user clicks "Configure Pipeline"
- **THEN** the PipelineConfigModal SHALL open with default preset (baseline-vector-rag) pre-filled

#### Scenario: Modal closes on backdrop click
- **WHEN** user clicks the backdrop overlay
- **THEN** the modal SHALL close without saving changes

#### Scenario: Modal closes on X button
- **WHEN** user clicks the close (×) button
- **THEN** the modal SHALL close without saving changes

### Requirement: Base preset display
The modal SHALL display the base preset name as a read-only label at the top of the content area (e.g., "Base preset: hybrid-reranked") so the user always knows which preset the configuration derives from.

#### Scenario: Preset label shown
- **WHEN** the modal opens for a config based on "hybrid-reranked"
- **THEN** the modal SHALL display "Base preset: hybrid-reranked" at the top

### Requirement: Config name field
The modal SHALL provide a name text input below the preset label. The name SHALL be pre-populated with the preset name and SHALL be read-only while the configuration matches the preset defaults. When any parameter is modified from preset defaults, the name field SHALL become editable and auto-update to `{presetName}-{4charHash}` where the hash is derived from the config diff.

#### Scenario: Name is read-only for unmodified preset
- **WHEN** config matches preset defaults exactly
- **THEN** the name field SHALL be read-only and display the preset name

#### Scenario: Name auto-updates on modification
- **WHEN** user changes chunk size from 1000 to 500
- **THEN** the name field SHALL become editable and auto-update to a name like "baseline-vector-rag-a3f2"

#### Scenario: User can edit custom name
- **WHEN** config is modified and name field is editable
- **THEN** user SHALL be able to type a custom name

#### Scenario: Preset name blocked for modified config
- **WHEN** user manually types a standard preset name (e.g., "baseline-vector-rag") but config differs from that preset
- **THEN** the Save button SHALL be disabled and an inline validation error SHALL display: "Name matches a preset but config has been modified"

#### Scenario: Name reverts when config reverts to preset defaults
- **WHEN** user modifies config then reverts all parameters back to preset defaults
- **THEN** the name SHALL revert to the preset name and become read-only again

### Requirement: Index stage configuration
The modal SHALL display an "① INDEX" stage section with configuration for: Chunker (type label "recursive", number inputs for chunkSize default 1000 and chunkOverlap default 200), Embedder (dropdown with text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002), and Vector Store (dropdown with "convex" enabled and "chroma", "in-memory", "qdrant" disabled with "coming soon" labels).

#### Scenario: Default index config from baseline preset
- **WHEN** modal opens with baseline-vector-rag preset
- **THEN** chunker SHALL show size=1000 overlap=200, embedder SHALL show text-embedding-3-small, vector store SHALL show convex

#### Scenario: Coming soon vector stores are disabled
- **WHEN** user opens the vector store dropdown
- **THEN** "chroma", "in-memory", and "qdrant" options SHALL be visible but disabled with "(coming soon)" text

#### Scenario: Changing chunk size updates config
- **WHEN** user changes chunk size to 500
- **THEN** the pipeline config's index.chunkSize SHALL update to 500

### Requirement: Query stage configuration
The modal SHALL display a "② QUERY" stage section with a strategy dropdown. "identity" SHALL be the only enabled option. "hyde" and "multi-query" SHALL appear as disabled options with "coming soon" labels.

#### Scenario: Default query strategy
- **WHEN** modal opens with any preset
- **THEN** query strategy SHALL show "identity"

#### Scenario: Coming soon query strategies are disabled
- **WHEN** user opens the query strategy dropdown
- **THEN** "hyde" and "multi-query" options SHALL be visible but disabled with "(coming soon)" text

### Requirement: Search stage configuration
The modal SHALL display a "③ SEARCH" stage section with: a strategy dropdown (dense, bm25, hybrid — all enabled), a k input (default 5, range 1-100), and conditional parameter groups that appear based on selected strategy.

#### Scenario: Dense search shows only k
- **WHEN** search strategy is "dense"
- **THEN** the section SHALL show only the k input

#### Scenario: BM25 search shows BM25 tuning
- **WHEN** search strategy is "bm25"
- **THEN** the section SHALL show k input plus BM25 tuning parameters: k1 (default 1.2) and b (default 0.75)

#### Scenario: Hybrid search shows all parameters
- **WHEN** search strategy is "hybrid"
- **THEN** the section SHALL show k input, hybrid parameters (denseWeight default 0.7, sparseWeight default 0.3, fusionMethod dropdown with "weighted" and "rrf", candidateMultiplier default 4), and BM25 tuning parameters (k1, b)

#### Scenario: Switching strategy resets conditional params to defaults
- **WHEN** user switches from hybrid to dense
- **THEN** hybrid-specific parameters SHALL be removed from config and reset to defaults if user switches back

### Requirement: Refinement stage configuration
The modal SHALL display a "④ REFINEMENT" stage section with an ordered list of refinement steps. Each step SHALL have a type dropdown ("rerank" or "threshold") and a remove button. A "+ Add refinement step" button SHALL append a new step. Steps SHALL execute in display order.

#### Scenario: No refinement steps
- **WHEN** modal opens with a preset that has no refinement (e.g., baseline-vector-rag)
- **THEN** the refinement section SHALL show only the "+ Add refinement step" button

#### Scenario: Rerank step configuration
- **WHEN** a refinement step has type "rerank"
- **THEN** the step SHALL display "Model: cohere-rerank-v3" as informational text

#### Scenario: Threshold step configuration
- **WHEN** a refinement step has type "threshold"
- **THEN** the step SHALL display a minScore number input (default 0.5, range 0-1)

#### Scenario: Add refinement step
- **WHEN** user clicks "+ Add refinement step"
- **THEN** a new step SHALL be appended with type "rerank" as default

#### Scenario: Remove refinement step
- **WHEN** user clicks the remove button on a refinement step
- **THEN** that step SHALL be removed from the list

### Requirement: Save and persist to localStorage
When user clicks "Save & Close", the modal SHALL save the config to localStorage under `rag-eval:pipeline-configs` keyed by config name, set `rag-eval:last-pipeline-config` to the config name, close the modal, and update the parent component's state.

#### Scenario: Save custom config
- **WHEN** user modifies the hybrid preset and clicks "Save & Close"
- **THEN** the config SHALL be persisted to localStorage with the custom name and the modal SHALL close

#### Scenario: Config survives page reload
- **WHEN** user reloads the experiments page after saving a custom config
- **THEN** the last used config SHALL be restored from localStorage

#### Scenario: Saved configs appear in dropdown
- **WHEN** user has saved custom configs to localStorage
- **THEN** those configs SHALL appear in the preset dropdown under a "Saved Configurations" optgroup
