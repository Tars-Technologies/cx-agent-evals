## Context

The system currently has two frontend modules: Generate Questions and Experiments. The Experiments page handles everything — pipeline config selection, KB indexing, evaluation execution, and result display. The backend already has a clean separation: `indexing.ts` + `indexingActions.ts` is a standalone WorkPool-based indexing service that the experiment runner consumes via `startIndexing`. However, the frontend and API surface still couple indexing with experiments.

This change splits the system into three modules: Generate Questions (unchanged), Retrievers (new — config + indexing + playground), and Experiments (simplified — evaluation only). A new `retrievers` table makes retrievers first-class entities that can be managed independently and reused across experiments and production inference.

Current data flow:
```
Frontend experiments page
  → experiments.start(retrieverConfig, datasetId, k)
    → experimentActions.runExperiment
      → indexing.startIndexing (embedded in experiment flow)
      → poll until indexed
      → build CallbackRetriever
      → runLangSmithExperiment
```

New data flow:
```
Frontend retrievers page
  → retrieverActions.create(kbId, retrieverConfig)
    → retriever created with status "configuring"
  → user clicks "Start Indexing"
  → retrieverActions.startIndexing(retrieverId)
    → indexing.startIndexing (standalone)
    → retriever status: "indexing" → "ready"

Frontend experiments page
  → experiments.start(retrieverId, datasetId)
    → experimentActions.runExperiment
      → load retriever config from retrievers table
      → verify status is "ready" (skip indexing)
      → build CallbackRetriever
      → runLangSmithExperiment
```

## Goals / Non-Goals

**Goals:**
- Separate retriever lifecycle (create, index, query, cleanup) from experiment execution
- Enable standalone retrieval via a `retrieve` action usable by playground, experiments, and future production consumers
- Provide a retriever playground for ad-hoc query testing with multi-retriever comparison
- Simplify the experiments page to select an existing retriever rather than configure one inline
- Support chunk reuse across retrievers with different search/refinement configs but same index config via dual hashing (`indexConfigHash` + `retrieverConfigHash`)

**Non-Goals:**
- Multi-KB retrievers (one retriever = one KB for now; multi-KB is a future extension)
- BM25/hybrid search in the `retrieve` action (deferred — requires BM25 index materialization in Convex, which doesn't exist yet; playground initially supports dense search only, same as current experiment runner)
- Production-grade retrieval API (auth, rate limiting, caching) — the `retrieve` action is the building block, not a full API
- Migrating existing experiment records to use `retrieverId` — old experiments keep their inline `retrieverConfig`
- Changes to the Generate Questions module

## Decisions

### 1. New `retrievers` table as first-class entity

**Decision**: Create a dedicated `retrievers` table rather than continuing to store retriever config inline on experiments.

**Rationale**: A retriever has its own lifecycle (configured → indexing → ready → cleanup) that is independent of any experiment. Multiple experiments should reference the same retriever. The retriever is also the entity that will be exposed for production inference.

**Alternatives considered**:
- Keep retriever config inline on experiments, add a "reuse last config" button → Doesn't enable standalone retrieval, doesn't support the playground, configs are duplicated across experiments.
- Store retriever configs in localStorage only → No server-side entity to reference from experiments, can't expose via API.

### 2. `k` is part of retrieverConfig and affects `retrieverConfigHash`

**Decision**: Move `k` (top-k) into the retriever config object. It becomes part of the `retrieverConfigHash` computation.

**Rationale**: The user wants `k` to be a fixed property of the retriever, not an experiment-time override. Different `k` values produce different retrieval results, so they should be different retrievers. This prevents confusion where the same retriever name produces different results with different `k` values.

**Alternatives considered**:
- Keep `k` as experiment-level parameter → Allows same retriever to produce different results, which the user explicitly doesn't want.

### 3. Separate creation from indexing

**Decision**: `retrieverActions.create` only creates the retriever record with status `"configuring"`. A separate `retrieverActions.startIndexing` action triggers the actual indexing. The user explicitly clicks "Start Indexing" on the retriever card.

**Rationale**: Separating creation from indexing gives users explicit control over when expensive indexing operations start. It also enables a clearer lifecycle: configuring → indexing → ready, with "Start Indexing" and "Cancel" actions at each stage. Previously, creation immediately triggered indexing which didn't allow reviewing the config before committing to the indexing cost.

**Lifecycle actions by status**:
- configuring: "Start Indexing" + "Delete"
- indexing: "Cancel" (resets to configuring)
- ready: "Delete Index" (preserves retriever) + "Delete Retriever" (cascades to index)
- error: "Retry Indexing" + "Delete"

### 4. Retriever dedup by `(kbId, retrieverConfigHash)`

**Decision**: Prevent creating duplicate retrievers with identical configs on the same KB. Return existing retriever ID with `existing: true` and show feedback in the UI (message + highlighted card).

**Rationale**: Indexing is expensive. If someone creates a retriever with an identical config, they should get the existing one. The `indexConfigHash` dedup at the chunk level already prevents double-indexing, but this prevents unnecessary retriever records too. The UI feedback (highlighted existing card) makes it clear what happened.

### 5. `retrieve` action for standalone retrieval

**Decision**: New `retrieve` action in `retrieverActions.ts` that accepts `(retrieverId, query, k?)` and returns ranked chunks. This action is used by the playground and can be used by future production consumers.

**Rationale**: Currently retrieval only happens inside `runExperiment`. Extracting it into a standalone action is the key enabler for the playground and production use. The action loads the retriever's config, embeds the query, runs vector search with the appropriate filters, and returns results.

**Note on search strategies**: The initial `retrieve` action will support dense search only (same as the current experiment runner's `CallbackRetriever`). BM25 and hybrid search require a BM25 index built from the full chunk set, which would need to be materialized server-side — this is a future enhancement. The vector search + `indexConfigHash` post-filtering pattern from `experimentActions.ts` lines 195-215 will be reused directly.

### 6. Experiment runner simplified — no indexing orchestration

**Decision**: The `runExperiment` action will load the retriever record, verify its status is "ready", and proceed directly to evaluation. It will NOT trigger or poll indexing.

**Rationale**: Indexing is now the responsibility of the Retrievers module. If the retriever isn't ready, the experiment should fail fast with a clear error, not silently trigger indexing.

**Migration**: `experiments.start` will accept either `retrieverId` (new path) or `retrieverConfig` (legacy path). The action checks which is provided. Old experiments with inline config continue to work — they compute `indexConfigHash` and call `startIndexing` as before.

### 7. Playground with multi-retriever comparison

**Decision**: The playground lives within the Retrievers page (not a separate tab). Users select 1+ "ready" retrievers via checkboxes, type a query, and see results side-by-side. Frontend fires parallel `retrieve` action calls, one per selected retriever.

**Rationale**: Multi-retriever comparison is the primary use case for the playground — users want to see how different configs affect results for the same query. Parallel frontend calls are simpler than a batch backend endpoint and naturally handle different latencies.

### 8. Delete Retriever cascades to index cleanup

**Decision**: `retrievers.remove` automatically deletes the associated indexed chunks (if not shared by another retriever) before deleting the retriever record.

**Rationale**: Leaving orphaned index chunks after deleting a retriever is confusing and wastes storage. The cascade is safe because it checks for shared indexes first — if another retriever uses the same `indexConfigHash`, the chunks are preserved.

### 9. App renamed to "CX Agent Evals"

**Decision**: Renamed from "rag-eval" to "CX Agent Evals" in both the landing page heading and header navigation.

**Rationale**: Better reflects the broader scope of the system beyond just RAG evaluation.

## Risks / Trade-offs

**[Dense-only playground]** → The playground only supports dense vector search initially, not BM25 or hybrid. Mitigation: This matches current experiment behavior. BM25/hybrid support can be added later when server-side BM25 index materialization is implemented.

**[Post-filter inefficiency]** → Vector search filters by `kbId` only; `indexConfigHash` is post-filtered in application code. For KBs with many index configs, this wastes vector search budget. Mitigation: In practice, most KBs have 1-3 index configs. The `candidateMultiplier` pattern (search 4x, post-filter to k) handles this. Long-term fix: Convex vector index improvements.

**[Schema migration]** → Adding `retrievers` table and `retrieverId` to experiments requires a schema push. Mitigation: Both are purely additive (new table + optional field). No data migration needed. Old experiments continue to work with inline `retrieverConfig`.

**[Stale retriever status]** → A retriever's status could become stale if the indexing job is canceled externally or the worker crashes. Mitigation: The `retrievers.get` query can cross-check with `indexingJobs` status. The existing WorkPool watchdog handles stuck jobs.

## Open Questions

None — all key decisions resolved during exploration phase.
