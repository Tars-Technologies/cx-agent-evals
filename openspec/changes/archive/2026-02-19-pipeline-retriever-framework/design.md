## Context

The eval-lib currently has a single `VectorRAGRetriever` that hardwires: chunk → embed → vector store → optional rerank. The existing building blocks (`chunkers/`, `embedders/`, `vector-stores/`, `rerankers/`) are well-abstracted with clean interfaces. The `Retriever` interface (`init`, `retrieve`, `cleanup` → `PositionAwareChunk[]`) is the contract all retrievers must satisfy.

The exploration document (`packages/eval-lib/docs/retriever-architecture-exploration.md`) established a three-layer architecture: pipeline retrievers (~80%), orchestrated retrievers (~15%), custom retrievers (~5%). This change implements the pipeline layer with minimal stage strategies plus BM25 and hybrid search.

The Convex backend currently indexes per-KB with hardcoded chunker settings. All experiments share one chunk set. The `CallbackRetriever` bridges Convex's `ctx`-dependent vector search with eval-lib's `Retriever` interface.

## Goals / Non-Goals

**Goals:**
- Establish PipelineRetriever as a composable, config-driven retriever
- Add BM25 and hybrid search as first new retrieval strategies
- Create named experiment presets (baseline, bm25, hybrid, hybrid-reranked)
- Compute indexConfigHash for future per-config chunk deduplication in Convex
- Reuse existing building blocks — no code duplication
- Keep backward compatibility for VectorRAGRetriever and CallbackRetriever

**Non-Goals:**
- Query strategies (HyDE, multi-query) — Change 2
- Advanced INDEX strategies (contextual enrichment, parent-child) — Change 3+
- Orchestrated retrievers (CRAG, Router) — later
- Custom retrievers (GraphRAG, RAPTOR) — later
- Convex schema changes (indexConfigHash field in documentChunks) — separate backend change
- Moving chunkers/embedders/vector-stores/rerankers under a core/ folder — later
- eval-tools/ reorganization — later

## Decisions

### Decision 1: PipelineRetriever accepts a declarative config, not stage objects

The PipelineRetriever constructor takes a `PipelineConfig` object specifying strategy names and parameters for each stage. The pipeline internally creates the appropriate stage implementations.

**Rationale**: A declarative config is serializable (can be stored in Convex, logged to LangSmith), hashable (for indexConfigHash), and easy to define named presets for. Passing pre-built strategy objects would be more flexible but harder to serialize and compare.

**Alternative considered**: Strategy pattern where each stage is an injected object. Rejected because it complicates serialization and preset definitions. The PipelineRetriever can still accept pre-built objects (like a specific VectorStore instance) alongside the declarative config for things that can't be serialized.

### Decision 2: Pipeline imports from existing top-level folders

The pipeline stages use existing interfaces and implementations: `PositionAwareChunker` from `chunkers/`, `Embedder` from `embedders/`, `VectorStore` from `vector-stores/`, `Reranker` from `rerankers/`. Only genuinely new concepts (BM25 index, fusion algorithms, threshold filter) live under `retrievers/pipeline/`.

**Rationale**: Avoids code duplication. The existing abstractions are well-designed. Adding new chunker types later (e.g., sentence chunker) goes in `chunkers/`, not under the pipeline.

**Alternative considered**: Self-contained pipeline folder with its own copies of all interfaces. Rejected — duplication with no benefit.

### Decision 3: BM25 via minisearch library

Use the `minisearch` npm package for BM25 text search. MiniSearch provides a lightweight, zero-dependency full-text search engine that runs in Node.js and supports BM25 scoring.

**Rationale**: minisearch is small (~15KB), has no native dependencies (important for Convex Node actions), supports BM25 scoring with configurable parameters, and works purely in-memory. Alternatives like lunr.js are older and less maintained. A custom BM25 implementation would be more work for no benefit.

### Decision 4: Hybrid search as a SEARCH strategy, not a separate retriever

Hybrid search is implemented as a search strategy within the pipeline's SEARCH stage. It internally runs both dense vector search and BM25 search, then fuses results. The candidate multiplier (e.g., 4x) is a parameter on the hybrid search config.

**Rationale**: Hybrid is a composition of two search methods, not a fundamentally different retrieval pattern. Keeping it as a search strategy means it composes naturally with any INDEX and QUERY strategy.

### Decision 5: VectorStore instance passed via config, not created internally

The PipelineConfig includes an optional `vectorStore` field. If not provided, it defaults to `InMemoryVectorStore`. For Convex integration, the backend creates an inline VectorStore adapter that wraps `ctx.vectorSearch()` and passes it via config.

**Rationale**: The pipeline cannot create a Convex-backed VectorStore (needs `ctx`). By accepting VectorStore as a config parameter, the same pipeline code works with InMemory (tests), Chroma (standalone), or Convex (backend). This is the Option C approach from our exploration.

### Decision 6: indexConfigHash covers only INDEX stage config

The hash is computed from: chunker type + settings, embedding model name, and any enrichment strategy. It does NOT include QUERY/SEARCH/REFINEMENT config because those don't affect what chunks are stored.

**Rationale**: Multiple experiments with different search strategies but the same indexing config should share chunks. Only re-index when the chunks themselves would be different.

### Decision 7: Experiment presets are factory functions

Each experiment preset folder exports a config type and a `createXxxRetriever(config?)` factory function that returns a `Retriever`. The factory wires up the PipelineRetriever with the right stage config and applies defaults.

**Rationale**: Factory functions are simple, testable, and composable. The config type documents what's tunable for each preset. The factory handles the wiring so consumers don't need to understand pipeline internals.

### Decision 8: Directory structure

```
eval-lib/src/
  retrievers/
    retriever.interface.ts        (moved from experiments/)
    callback-retriever.ts         (moved from experiments/)
    pipeline/
      pipeline-retriever.ts       (PipelineRetriever class)
      config.ts                   (PipelineConfig types, indexConfigHash)
      search/
        bm25.ts                   (BM25 search using minisearch)
        fusion.ts                 (weighted + RRF fusion)
      refinement/
        threshold.ts              (threshold filter)
      index.ts
    index.ts
  experiments/
    baseline-vector-rag/
      config.ts + index.ts        (factory wrapping pipeline)
    bm25/
      config.ts + index.ts
    hybrid/
      config.ts + index.ts
    hybrid-reranked/
      config.ts + index.ts
    index.ts
```

The `query/` subfolder is not created yet (empty in this change — identity is the default, no file needed). The `orchestrator/` and `custom/` subfolders are not created yet.

## Risks / Trade-offs

**[Risk] minisearch may not work in Convex Node actions** → Mitigation: minisearch is pure JavaScript with no native dependencies. It should work in any Node.js environment. Spike test before deep integration if concerned.

**[Risk] BM25 index is ephemeral (in-memory only)** → The BM25 index is rebuilt during `init()` from the chunked corpus. Unlike vector embeddings which are expensive to compute, BM25 indexing is fast (pure text processing). For Convex integration, the BM25 index would need to be rebuilt per action invocation or use Convex's built-in search index. This is acceptable for eval-lib standalone use; Convex integration patterns are a future concern.

**[Risk] Breaking existing imports** → Mitigation: The root `index.ts` re-exports `Retriever`, `VectorRAGRetriever`, and `CallbackRetriever` from their new locations. External consumers importing from `rag-evaluation-system` see no change. Internal imports within eval-lib will be updated.

**[Trade-off] PipelineConfig is declarative but some fields need instances** → The config is mostly serializable (strategy names, numeric params) but `vectorStore`, `reranker`, and `embedder` fields need actual object instances. This means the full config isn't serializable. The indexConfigHash only covers the serializable parts. Named presets handle the wiring of instances.

## Open Questions

- Should experiment presets export the raw PipelineConfig in addition to the factory function? This would allow advanced users to inspect/modify the config before creating the retriever.
- When Convex integration is added, should the backend use PipelineRetriever directly (with a Convex VectorStore adapter) or continue using CallbackRetriever? PipelineRetriever is cleaner but adds eval-lib as a deeper dependency in the action.
