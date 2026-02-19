## Why

The evaluation system has a single retriever implementation (VectorRAGRetriever) with ~5 tunable knobs. To meaningfully compare retrieval strategies (BM25, hybrid search, contextual retrieval, CRAG, etc.), we need a composable pipeline architecture where different retrieval strategies are configurations of shared building blocks, plus named experiment presets for running comparisons. This first change establishes the pipeline framework with BM25 and hybrid search as the first new capabilities.

## What Changes

- **New `retrievers/` folder**: Move `retriever.interface.ts`, `callback-retriever.ts`, and `baseline-vector-rag/` from `experiments/` to `retrievers/`. Add `pipeline/` subfolder with PipelineRetriever class, config types, and stage implementations.
- **PipelineRetriever class**: A new `Retriever` implementation that composes 4 stages (INDEX, QUERY, SEARCH, REFINEMENT) based on a declarative config. Reuses existing `chunkers/`, `embedders/`, `vector-stores/`, `rerankers/` as building blocks.
- **BM25 text search** (NEW): Keyword-based retrieval using the `minisearch` library, living under `retrievers/pipeline/search/`.
- **Hybrid search with fusion** (NEW): Combines dense vector + BM25 results using weighted score fusion or reciprocal rank fusion (RRF), with a configurable candidate multiplier.
- **Threshold refinement** (NEW): Post-search filtering that drops results below a minimum relevance score.
- **indexConfigHash**: Deterministic hash computed from INDEX stage config (chunker settings + embedding model) for chunk set deduplication. Enables future Convex integration where different experiment configs produce separate chunk sets.
- **Repurposed `experiments/` folder**: Named experiment presets (baseline-vector-rag, bm25, hybrid, hybrid-reranked), each with a config type and factory function.
- **Backward compatibility**: Old `VectorRAGRetriever` remains accessible. `CallbackRetriever` remains for Convex integration.

## Capabilities

### New Capabilities
- `pipeline-retriever`: PipelineRetriever class, 4-stage config types, stage interfaces, and minimal stage implementations (plain indexing, identity query, dense/BM25/hybrid search, reranker/threshold refinement)
- `bm25-search`: BM25 text search implementation using minisearch library with configurable k1, b parameters
- `hybrid-search`: Hybrid search combining dense + sparse results with weighted score fusion and RRF, candidate multiplier support
- `experiment-presets`: Named experiment preset system with factory functions and config types for baseline-vector-rag, bm25, hybrid, hybrid-reranked
- `index-config-hash`: Deterministic hash computation from INDEX stage config for chunk set deduplication

### Modified Capabilities
- `experiments`: Directory restructure — retriever implementations move to `retrievers/`, experiments folder becomes preset configs. Exports updated but public API preserved.

## Impact

- **eval-lib**: New `retrievers/` directory, restructured `experiments/` directory, new dependency on `minisearch` package
- **Root index.ts**: Export paths updated to reflect new file locations
- **Backend**: No changes in this change (Convex schema changes for indexConfigHash are a separate future change)
- **Frontend**: No changes
- **Tests**: New tests for PipelineRetriever, BM25 search, hybrid fusion, threshold refinement, experiment presets, indexConfigHash
