## 1. Pipeline Config Types & Presets

- [x] 1.1 Create `packages/frontend/src/lib/pipeline-types.ts` with frontend-side TypeScript types mirroring PipelineConfig, IndexConfig, QueryConfig, SearchConfig, RefinementStepConfig — plus SavedPipelineConfig wrapper (name, basePreset, config, k) and preset constant definitions (BASELINE_VECTOR_RAG, BM25, HYBRID, HYBRID_RERANKED)
- [x] 1.2 Create `packages/frontend/src/lib/pipeline-storage.ts` with localStorage helpers: loadSavedConfigs, saveConfig, loadLastConfig, deleteConfig, and config hash utility (4-char SHA-256 truncation for naming)

## 2. PipelineConfigSummary Component

- [x] 2.1 Create `packages/frontend/src/components/PipelineConfigSummary.tsx` — compact inline display with one line per stage (Index/Query/Search/Refinement), custom config name display, and "Edit" link (matching DimensionSummary styling)
- [x] 2.2 Add "Configure Pipeline" dashed-border button state for when no config is set (matching "Set Up Dimensions" pattern)

## 3. PipelineConfigModal Component

- [x] 3.1 Create `packages/frontend/src/components/PipelineConfigModal.tsx` — modal shell with overlay, header (title + close button), scrollable content area, footer with "Save & Close" button (matching DimensionWizard layout)
- [x] 3.2 Add base preset label and config name field with read-only/editable state, auto-hash naming on modification, and validation blocking preset names for modified configs
- [x] 3.3 Implement ① INDEX stage section: chunker type label + size/overlap inputs, embedder model dropdown, vector store dropdown with disabled "coming soon" options (chroma, in-memory, qdrant)
- [x] 3.4 Implement ② QUERY stage section: strategy dropdown with identity enabled, hyde/multi-query disabled with "coming soon" labels
- [x] 3.5 Implement ③ SEARCH stage section: strategy dropdown (dense/bm25/hybrid), k input, conditional parameter groups — BM25 tuning (k1, b) shown for bm25/hybrid, hybrid params (denseWeight, sparseWeight, fusionMethod, candidateMultiplier) shown for hybrid only
- [x] 3.6 Implement ④ REFINEMENT stage section: ordered step list with type dropdown (rerank/threshold) and remove button per step, minScore input for threshold type, "+ Add refinement step" button
- [x] 3.7 Wire Save & Close to call onSave callback with config + name, persist to localStorage, and close modal

## 4. Experiments Page Rewrite

- [x] 4.1 Replace `RetrieverConfig` interface and flat form controls with pipeline config state (pipelineConfig, configName, basePreset, k, isModified) and preset dropdown with optgroup (Presets / Saved Configurations)
- [x] 4.2 Integrate PipelineConfigSummary and PipelineConfigModal into the left panel — dropdown selection loads preset/saved config, Edit link opens modal, modal save updates state
- [x] 4.3 Update experiment name auto-generation to use pipeline config name + k (e.g., "hybrid-reranked-k5") instead of flat config parts
- [x] 4.4 Restore last config from localStorage on page load, with fallback to baseline-vector-rag preset

## 5. Execution Panel Redesign

- [x] 5.1 Replace single status panel with two-phase vertical layout — Phase 1 (Indexing) and Phase 2 (Evaluation) cards with visual connector between them
- [x] 5.2 Implement per-phase status indicators: ○ pending, ● running (with progress bar + message), ✓ complete, ✗ error — driven by job record's phase and progress fields
- [x] 5.3 Add "View in Convex Dashboard →" link in Phase 1 complete state, linking to document chunks table
- [x] 5.4 Add "Auto-start experiment after indexing" checkbox (default checked) — when unchecked, Phase 2 shows "Run Experiment" button after indexing completes instead of auto-starting
- [x] 5.5 Update handleRunExperiment to pass full PipelineConfig as retrieverConfig to the experiments.start mutation, and wire autoStart toggle to control post-indexing behavior
- [x] 5.6 Add 2×2 metric score grid and "View in LangSmith →" link to Phase 2 complete state

## 6. Cleanup & Verification

- [x] 6.1 Remove legacy RetrieverConfig interface and all flat config form controls from page.tsx
- [x] 6.2 Verify frontend build succeeds (`pnpm -C packages/frontend build`) with no TypeScript errors
- [x] 6.3 Visual review: confirmed modal uses same overlay/sizing/header/footer pattern as DimensionWizard, summary uses same compact layout + Edit link as DimensionSummary, all "coming soon" items render as disabled options

## 7. Bug Fix: Auto-name circular dependency

- [x] 7.1 Fix infinite re-render loop in PipelineConfigModal caused by circular dependency: `name` state → `buildConfig` useCallback (depended on `name`) → auto-name useEffect (depended on `buildConfig`) → `setName()` → loop. Fix: remove `name` from `buildConfig` return value and dependency array, use placeholder `name: ""` in buildConfig, apply real name only at save time in `handleSave`.
- [x] 7.2 Fix `buildAutoName` hashing the config name into itself (name fed into hash, hash changed name, which changed hash → unstable). Fix: strip `name` field from resolved config before hashing so the hash is deterministic based only on config parameters (index/query/search/refinement + k).
- [x] 7.3 Verify frontend build succeeds after fix
