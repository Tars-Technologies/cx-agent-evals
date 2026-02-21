## Why

The experiments page currently exposes a flat retriever configuration (chunker size/overlap, embedder model, k) that maps to the legacy `VectorRAGRetriever`. The eval-lib now has a `PipelineRetriever` with a four-stage architecture (Index → Query → Search → Refinement) and four named presets. The frontend needs to surface this pipeline model so users can select presets, customize stage-level parameters, and run experiments with any supported retriever configuration.

## What Changes

- **Replace flat retriever config** with a preset dropdown + inline pipeline summary in the left panel
- **New PipelineConfigModal component** (follows DimensionWizard pattern): single scrollable view exposing all 4 pipeline stages with conditional parameters, refinement chain editing, and config naming with localStorage persistence
- **New PipelineConfigSummary component** (follows DimensionSummary pattern): compact inline summary of the active pipeline config with "Edit" link
- **Redesign right panel execution flow** with two-phase vertical pipeline (Indexing → Evaluation), progress indicators per phase, "Auto-start experiment after indexing" checkbox, and "View in Convex Dashboard" link after indexing completes
- **BREAKING**: Remove legacy flat `RetrieverConfig` interface and its inline form controls from the experiments page
- **Add disabled "coming soon" entries** for future options: vector stores (chroma, in-memory, qdrant), query strategies (hyde, multi-query), and additional search/refinement methods
- **Persist pipeline configs to localStorage** with preset/saved grouping in the dropdown

## Capabilities

### New Capabilities
- `pipeline-config-modal`: Modal component for configuring all 4 pipeline stages with preset-aware naming, parameter validation, and localStorage persistence
- `pipeline-config-summary`: Inline summary component displaying active pipeline configuration with "Edit" link to open modal
- `experiment-execution-phases`: Two-phase execution UI (Indexing → Evaluation) with per-phase status, progress bars, auto-start toggle, and Convex Dashboard inspection link

### Modified Capabilities
- `experiments-ui`: Replace flat retriever config with pipeline preset dropdown + modal-based configuration; redesign execution panel to show two-phase pipeline flow

## Impact

- **Frontend code**: Rewrite `packages/frontend/src/app/experiments/page.tsx`, add 2 new components under `packages/frontend/src/components/`
- **No backend changes**: All pipeline config types already exist in eval-lib; backend experiment runner already accepts flexible `retrieverConfig`
- **No eval-lib changes**: Using existing `PipelineConfig`, preset configs, and type exports as-is
- **Browser storage**: New `rag-eval:pipeline-configs` and `rag-eval:last-pipeline-config` localStorage keys
