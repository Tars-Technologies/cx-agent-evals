## ADDED Requirements

### Requirement: Inline pipeline summary display
The system SHALL provide a `PipelineConfigSummary` component that displays a compact summary of the active pipeline configuration within the left sidebar. The summary SHALL show one line per pipeline stage: Index (chunker params + embedder + vector store), Query (strategy), Search (strategy + k), and Refinement (step types or "none").

#### Scenario: Summary for baseline-vector-rag
- **WHEN** baseline-vector-rag preset is active
- **THEN** the summary SHALL display: Index: "recursive(1000/200) · 3-small · convex", Query: "identity", Search: "dense · k=5", Refinement: "none"

#### Scenario: Summary for hybrid-reranked
- **WHEN** hybrid-reranked preset is active
- **THEN** the summary SHALL display: Index: "recursive(1000/200) · 3-small · convex", Query: "identity", Search: "hybrid(0.7/0.3) · k=5", Refinement: "rerank"

### Requirement: Edit link opens modal
The summary SHALL include an "Edit" link (styled as `text-[10px] text-accent uppercase tracking-wider font-semibold`, matching DimensionSummary) that opens the PipelineConfigModal with the current configuration.

#### Scenario: Clicking Edit opens modal
- **WHEN** user clicks the "Edit" link in the summary
- **THEN** the PipelineConfigModal SHALL open pre-filled with the current configuration

### Requirement: Custom config name display
When the active config is a modified version of a preset (not matching preset defaults), the summary SHALL display the custom config name at the top of the summary area.

#### Scenario: Custom name shown for modified config
- **WHEN** active config is "hybrid-reranked-a3f2" (modified from hybrid-reranked)
- **THEN** the summary SHALL show "hybrid-reranked-a3f2" as the config name above the stage lines

#### Scenario: No custom name for unmodified preset
- **WHEN** active config matches a preset exactly
- **THEN** the summary SHALL NOT display a separate config name (the preset name is shown in the dropdown above)

### Requirement: Configure Pipeline button when unconfigured
When no pipeline config is set, the summary area SHALL display a dashed-border "Configure Pipeline" button (matching the "Set Up Dimensions" button pattern) instead of the summary.

#### Scenario: Initial state shows setup button
- **WHEN** experiments page loads with no prior config in localStorage
- **THEN** a "Configure Pipeline" button with dashed border SHALL be displayed instead of the summary
