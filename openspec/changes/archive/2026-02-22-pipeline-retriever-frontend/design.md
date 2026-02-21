## Context

The experiments page (`packages/frontend/src/app/experiments/page.tsx`) currently has a flat `RetrieverConfig` interface with inline form controls for chunker size/overlap, embedder model, and k value. This maps to the legacy `VectorRAGRetriever`.

The eval-lib now provides `PipelineRetriever` with a 4-stage architecture and 4 named presets (`baseline-vector-rag`, `bm25`, `hybrid`, `hybrid-reranked`). The frontend needs to expose this pipeline model while keeping the UI clean — all pipeline detail lives in a modal, not inline.

Existing modal patterns to follow: `DimensionWizard.tsx` (overlay, header/footer, scrollable content) and `DimensionSummary.tsx` (compact inline summary with "Edit" link).

## Goals / Non-Goals

**Goals:**
- Replace flat retriever config with pipeline-aware preset dropdown + modal configuration
- Expose all 4 pipeline stages with conditional parameter rendering
- Support preset selection, customization, and localStorage persistence of custom configs
- Redesign execution panel with explicit Indexing → Evaluation phase progression
- Add auto-start toggle and index inspection link

**Non-Goals:**
- No backend changes — existing `retrieverConfig` in experiment mutations already accepts arbitrary config
- No eval-lib changes — using existing types and preset configs as-is
- No implementation of "coming soon" features (chroma, qdrant, hyde, multi-query) — only UI placeholders
- No changes to the question generation page or any non-experiment UI

## Decisions

### 1. Dropdown for preset selection (not grid cards)
**Choice**: `<select>` dropdown with optgroup for "Presets" and "Saved Configurations".
**Why over 2×2 grid**: Presets will grow beyond 4 as more retriever strategies are added. A dropdown scales linearly; a card grid becomes unwieldy at 6+ options. Dropdown also takes less vertical space in the already-constrained 420px sidebar.

### 2. Single-view modal (not multi-step wizard)
**Choice**: One scrollable modal showing all 4 stages simultaneously.
**Why over wizard**: The 4 pipeline stages are independent — there's no logical ordering dependency between configuring Search vs Refinement. A wizard implies sequential steps; a single view lets users scan and edit any stage in any order. The DimensionWizard is a wizard because its steps _are_ sequential (discover → edit → configure). Pipeline config is not.

### 3. Config name = preset name until modified, then auto-hash
**Choice**: Name field is read-only showing preset name. On any parameter change: unlock field, auto-set to `{presetName}-{4charHash}`. Block saving with a preset name when config differs.
**Why**: Prevents users from accidentally creating a "baseline-vector-rag" config that isn't actually baseline. The hash is deterministic (djb2 hash of JSON-serialized config, truncated to 4 hex chars), so the same modifications always produce the same suffix.
**Alternative considered**: Just append "(custom)" — rejected because it's not unique across different customizations.

### 4. localStorage for config persistence (not Convex)
**Choice**: Store saved pipeline configs in browser localStorage under `rag-eval:pipeline-configs` (object keyed by config name) and `rag-eval:last-pipeline-config` (string name).
**Why over Convex**: Pipeline configs are a UI convenience feature, not shared data. They're per-user, per-browser preferences — exactly what localStorage is for. Avoids schema changes and additional Convex queries. Consistent with how dimension-driven config is persisted.

### 5. Two-phase execution panel with vertical pipeline layout
**Choice**: Right panel shows Phase 1 (Indexing) and Phase 2 (Evaluation) as vertically stacked cards connected by a visual flow indicator.
**Why**: The previous single status panel conflated indexing and evaluation into one "running" state. Separating them makes the long indexing step visible and inspectable, and enables the auto-start toggle which controls the transition between phases.

### 6. "Coming soon" items as disabled dropdown options
**Choice**: Show future options (chroma, qdrant, hyde, multi-query) as disabled `<option>` elements with "(coming soon)" suffix, styled with `text-text-dim`.
**Why**: Establishes the 4-stage pipeline mental model even when not all methods are available yet. Users can see what's possible without being able to select unsupported options.

### Component structure

```
packages/frontend/src/
  app/experiments/page.tsx          ← rewrite: orchestrates state, layout
  components/
    PipelineConfigModal.tsx         ← new: full pipeline configuration modal
    PipelineConfigSummary.tsx       ← new: inline summary with Edit link
```

### State flow

```
page.tsx state:
  pipelineConfig: PipelineConfig    ← current active config (from preset or custom)
  configName: string                ← display name (preset name or custom name)
  basePreset: string | null         ← which preset this was based on
  k: number                         ← top-k, part of search stage
  isModified: boolean               ← whether config differs from base preset
  autoStartExperiment: boolean      ← checkbox state (default: true)

localStorage:
  rag-eval:pipeline-configs → Record<string, SavedPipelineConfig>
  rag-eval:last-pipeline-config → string (config name)
```

### Config → Backend mapping

The `experiments.start` mutation already accepts `retrieverConfig: any`. The frontend will pass the full `PipelineConfig` object (with `k` included at the search level). The backend `experimentActions.runExperiment` will need to interpret this — but that's out of scope for this change (backend already has the necessary flexibility).

### Auto-name hashing constraint

The `buildConfig` useCallback must NOT depend on the `name` state, and the `buildAutoName` hash must NOT include the config name. Otherwise a circular dependency forms: name → buildConfig → auto-name effect → setName → name (infinite loop). The config name is a derived/display value, not a config parameter — it is applied to the config only at save time in `handleSave`.

## Risks / Trade-offs

**[Risk] localStorage configs lost on browser clear** → Acceptable for convenience data. Configs are quick to recreate from presets. Could add export/import later if needed.

**[Risk] Config hash collisions in 4 chars** → 65,536 possible values. Collision is unlikely for a single user's saved configs (typically <20). If it happens, user can rename manually.

**[Risk] Modal may be tall with all 4 stages expanded** → Scrollable content area with max-h-[80vh] (matching DimensionWizard). Stages start collapsed by default except the one relevant to the selected preset's primary differentiator.

**[Trade-off] No backend validation of pipeline config** → Frontend sends config as-is. If a user sends an invalid combination, the experiment action will fail at runtime. Acceptable because: (1) presets are always valid, (2) the modal UI constrains inputs to valid ranges, (3) adding backend validation is a separate concern.
