## ADDED Requirements

### Requirement: BM25 search index
The system SHALL provide a `BM25SearchIndex` class that builds an in-memory BM25 full-text search index from `PositionAwareChunk[]` using the `minisearch` library. The index SHALL support configurable BM25 parameters `k1` (term frequency saturation, default 1.2) and `b` (document length normalization, default 0.75).

#### Scenario: Build BM25 index from chunks
- **WHEN** calling `bm25Index.build(chunks)` with an array of PositionAwareChunks
- **THEN** the index SHALL index each chunk's content for full-text search

#### Scenario: BM25 search returns ranked results
- **WHEN** calling `bm25Index.search(query, k)` after building the index
- **THEN** it SHALL return up to `k` PositionAwareChunks ranked by BM25 relevance score

#### Scenario: BM25 search with no matches
- **WHEN** calling `bm25Index.search(query, k)` with a query that has no keyword overlap with any chunk
- **THEN** it SHALL return an empty array

#### Scenario: BM25 search with scores
- **WHEN** calling `bm25Index.searchWithScores(query, k)`
- **THEN** it SHALL return results paired with their BM25 relevance scores normalized to 0-1 range

### Requirement: SEARCH stage — BM25 strategy
The system SHALL implement a "bm25" SEARCH strategy in the PipelineRetriever that uses the BM25SearchIndex. During `init()`, the pipeline SHALL build the BM25 index alongside (or instead of) the vector index. During `retrieve()`, the search stage SHALL use BM25 scoring to find candidates.

#### Scenario: BM25 search strategy in pipeline
- **WHEN** a PipelineRetriever is configured with search strategy "bm25"
- **THEN** `init()` SHALL build a BM25 index from the chunked corpus, and `retrieve()` SHALL search using BM25 scoring

#### Scenario: BM25 finds exact keyword matches
- **WHEN** searching for "useEffect cleanup" with BM25
- **THEN** chunks containing the exact terms "useEffect" and "cleanup" SHALL be ranked higher than chunks with only semantic similarity
