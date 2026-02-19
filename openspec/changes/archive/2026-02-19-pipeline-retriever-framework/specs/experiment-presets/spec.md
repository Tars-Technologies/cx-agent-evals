## ADDED Requirements

### Requirement: Experiment preset structure
Each named experiment preset SHALL be a folder under `experiments/` containing a `config.ts` (TypeScript config type with tunable parameters and defaults) and an `index.ts` (factory function that creates a configured `Retriever`). Each factory function SHALL accept an optional partial config to override defaults.

#### Scenario: Preset factory with defaults
- **WHEN** calling a preset factory with no arguments (e.g., `createHybridRetriever()`)
- **THEN** it SHALL return a Retriever with all default parameters applied

#### Scenario: Preset factory with overrides
- **WHEN** calling a preset factory with partial config (e.g., `createHybridRetriever({ chunkSize: 500 })`)
- **THEN** it SHALL return a Retriever with the specified override and defaults for all other parameters

### Requirement: baseline-vector-rag preset
The system SHALL provide a `baseline-vector-rag` experiment preset that creates a PipelineRetriever equivalent to the existing VectorRAGRetriever. Config SHALL include: `chunkSize` (default 1000), `chunkOverlap` (default 200), `embedder` (Embedder instance), optional `vectorStore`, optional `reranker`, optional `batchSize`.

#### Scenario: Baseline preset matches VectorRAGRetriever
- **WHEN** creating a retriever via `createBaselineRetriever({ embedder })` and via `new VectorRAGRetriever({ chunker, embedder })` with equivalent settings
- **THEN** both SHALL produce identical retrieval results for the same query and corpus

### Requirement: bm25 preset
The system SHALL provide a `bm25` experiment preset that creates a PipelineRetriever with search strategy "bm25". Config SHALL include: `chunkSize` (default 1000), `chunkOverlap` (default 200), optional `k1` (default 1.2), optional `b` (default 0.75).

#### Scenario: BM25 preset creates keyword-only retriever
- **WHEN** creating a retriever via `createBm25Retriever()`
- **THEN** it SHALL use BM25 search with no vector search component

### Requirement: hybrid preset
The system SHALL provide a `hybrid` experiment preset that creates a PipelineRetriever with search strategy "hybrid". Config SHALL include: `chunkSize` (default 1000), `chunkOverlap` (default 200), `embedder` (Embedder instance), optional `denseWeight` (default 0.7), optional `sparseWeight` (default 0.3), optional `fusionMethod` (default "weighted"), optional `candidateMultiplier` (default 4), optional `vectorStore`.

#### Scenario: Hybrid preset creates dense + BM25 retriever
- **WHEN** creating a retriever via `createHybridRetriever({ embedder })`
- **THEN** it SHALL search using both dense vector and BM25, fused with 0.7/0.3 weighted fusion

### Requirement: hybrid-reranked preset
The system SHALL provide a `hybrid-reranked` experiment preset that creates a PipelineRetriever with search strategy "hybrid" and refinement chain including "rerank". Config SHALL include all hybrid config fields plus `reranker` (Reranker instance).

#### Scenario: Hybrid-reranked preset includes reranking
- **WHEN** creating a retriever via `createHybridRerankedRetriever({ embedder, reranker })`
- **THEN** it SHALL perform hybrid search followed by reranking of the fused results
