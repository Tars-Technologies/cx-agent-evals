## 1. Directory Structure & File Moves

- [x] 1.1 Create `retrievers/` directory under `packages/eval-lib/src/`
- [x] 1.2 Move `retriever.interface.ts` from `experiments/` to `retrievers/`
- [x] 1.3 Move `callback-retriever.ts` from `experiments/` to `retrievers/`
- [x] 1.4 Move `baseline-vector-rag/` from `experiments/` to `retrievers/`
- [x] 1.5 Create `retrievers/pipeline/` directory with `search/` and `refinement/` subfolders
- [x] 1.6 Create `retrievers/index.ts` barrel export
- [x] 1.7 Restructure `experiments/` directory for named presets (remove old files, create preset folders)
- [x] 1.8 Update root `src/index.ts` to re-export from new locations (backward-compatible)
- [x] 1.9 Update all internal imports within eval-lib that reference old `experiments/` paths
- [x] 1.10 Verify `pnpm build` and `pnpm typecheck` pass with new structure

## 2. Pipeline Config Types

- [x] 2.1 Create `retrievers/pipeline/config.ts` with PipelineConfig, IndexConfig, QueryConfig, SearchConfig, RefinementConfig types
- [x] 2.2 Define IndexConfig: strategy "plain" with chunkSize, chunkOverlap, separators
- [x] 2.3 Define QueryConfig: strategy "identity" (extensible for future HyDE, multi-query)
- [x] 2.4 Define SearchConfig: strategy "dense" | "bm25" | "hybrid" with strategy-specific params (denseWeight, sparseWeight, fusionMethod, candidateMultiplier, rrfK, k1, b)
- [x] 2.5 Define RefinementConfig: array of steps, each typed as "rerank" | "threshold" with step-specific params (minScore for threshold)

## 3. Index Config Hash

- [x] 3.1 Implement `computeIndexConfigHash()` function in `retrievers/pipeline/config.ts` using SHA-256
- [x] 3.2 Write tests: same config → same hash, different configs → different hashes, non-INDEX config excluded

## 4. BM25 Search

- [x] 4.1 Add `minisearch` as a dependency in `packages/eval-lib/package.json`
- [x] 4.2 Implement `BM25SearchIndex` class in `retrievers/pipeline/search/bm25.ts`
- [x] 4.3 Implement `build(chunks)` method to index PositionAwareChunk content
- [x] 4.4 Implement `search(query, k)` returning ranked PositionAwareChunk[]
- [x] 4.5 Implement `searchWithScores(query, k)` returning results with normalized 0-1 scores
- [x] 4.6 Write tests: build + search, no matches returns empty, score normalization, custom k1/b params

## 5. Hybrid Search & Fusion

- [x] 5.1 Implement `weightedScoreFusion()` in `retrievers/pipeline/search/fusion.ts`
- [x] 5.2 Implement `reciprocalRankFusion()` in `retrievers/pipeline/search/fusion.ts`
- [x] 5.3 Write tests for weighted fusion: overlapping results, single-list-only results, custom weights
- [x] 5.4 Write tests for RRF: rank-based combination, configurable k parameter
- [x] 5.5 Create `retrievers/pipeline/search/index.ts` barrel export

## 6. Threshold Refinement

- [x] 6.1 Implement `ThresholdFilter` in `retrievers/pipeline/refinement/threshold.ts`
- [x] 6.2 Write tests: filters below threshold, passes above threshold, edge cases (empty input, all filtered)
- [x] 6.3 Create `retrievers/pipeline/refinement/index.ts` barrel export

## 7. PipelineRetriever Class

- [x] 7.1 Implement `PipelineRetriever` class in `retrievers/pipeline/pipeline-retriever.ts`
- [x] 7.2 Implement constructor: parse config, set defaults, compute indexConfigHash
- [x] 7.3 Implement `init()`: INDEX stage — chunk corpus, embed, store in vector store; build BM25 index if search is "bm25" or "hybrid"
- [x] 7.4 Implement `retrieve()`: QUERY stage (identity passthrough), SEARCH stage (dense/bm25/hybrid), REFINEMENT chain
- [x] 7.5 Implement `cleanup()`: clear vector store, clear BM25 index
- [x] 7.6 Expose `indexConfigHash` readonly property
- [x] 7.7 Create `retrievers/pipeline/index.ts` barrel export
- [x] 7.8 Write tests: pipeline with dense search matches VectorRAGRetriever, pipeline with BM25, pipeline with hybrid, pipeline with refinement chain, cleanup clears state

## 8. Experiment Presets

- [x] 8.1 Create `experiments/baseline-vector-rag/` preset (config.ts + index.ts)
- [x] 8.2 Create `experiments/bm25/` preset (config.ts + index.ts)
- [x] 8.3 Create `experiments/hybrid/` preset (config.ts + index.ts)
- [x] 8.4 Create `experiments/hybrid-reranked/` preset (config.ts + index.ts)
- [x] 8.5 Create `experiments/index.ts` barrel export
- [x] 8.6 Write tests: each preset factory creates a working retriever, overrides apply correctly

## 9. Integration & Verification

- [x] 9.1 Update root `src/index.ts` to export new PipelineRetriever, experiment presets, BM25SearchIndex, fusion functions
- [x] 9.2 Run full test suite: `pnpm test`
- [x] 9.3 Run typecheck: `pnpm typecheck`
- [x] 9.4 Run build: `pnpm build`
- [x] 9.5 Verify backend still compiles (imports from `rag-evaluation-system` still resolve)
