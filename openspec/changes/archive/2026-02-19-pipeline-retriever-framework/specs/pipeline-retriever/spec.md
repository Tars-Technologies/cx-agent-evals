## ADDED Requirements

### Requirement: PipelineRetriever class
The system SHALL provide a `PipelineRetriever` class implementing the `Retriever` interface. It SHALL accept a `PipelineConfig` specifying strategies and parameters for four stages: INDEX, QUERY, SEARCH, and REFINEMENT. The `init()` method SHALL execute the INDEX stage (chunk corpus, embed, store in vector store). The `retrieve()` method SHALL execute QUERY → SEARCH → REFINEMENT stages in sequence and return `PositionAwareChunk[]`.

#### Scenario: PipelineRetriever with default config
- **WHEN** creating a PipelineRetriever with default config (plain chunking, identity query, dense search, no refinement)
- **THEN** it SHALL behave identically to VectorRAGRetriever with the same chunker, embedder, and vector store

#### Scenario: PipelineRetriever init indexes corpus
- **WHEN** calling `pipeline.init(corpus)` with plain chunking config
- **THEN** the pipeline SHALL chunk all documents using the configured PositionAwareChunker, embed chunks using the configured Embedder, and add chunks + embeddings to the configured VectorStore

#### Scenario: PipelineRetriever retrieve executes stages in order
- **WHEN** calling `pipeline.retrieve(query, k)`
- **THEN** the pipeline SHALL first apply the QUERY stage to transform the query, then execute the SEARCH stage to find candidates, then apply the REFINEMENT chain to produce final results

#### Scenario: PipelineRetriever cleanup
- **WHEN** calling `pipeline.cleanup()`
- **THEN** the pipeline SHALL clear the vector store and any internal search indices

### Requirement: PipelineConfig types
The system SHALL define a `PipelineConfig` type with the following fields: `name` (string), `index` (IndexConfig), `query` (QueryConfig), `search` (SearchConfig), `refinement` (RefinementConfig array), and optional `vectorStore` (VectorStore instance, default InMemoryVectorStore), optional `embedder` (Embedder instance), optional `reranker` (Reranker instance).

#### Scenario: PipelineConfig with all stages specified
- **WHEN** creating a PipelineConfig with index strategy "plain", query strategy "identity", search strategy "hybrid", and refinement ["rerank", "threshold"]
- **THEN** the config SHALL be accepted without errors

#### Scenario: PipelineConfig defaults
- **WHEN** creating a PipelineConfig with minimal fields (only name and embedder)
- **THEN** the config SHALL default to: index strategy "plain" with chunkSize 1000 and overlap 200, query strategy "identity", search strategy "dense", refinement empty array, vectorStore InMemoryVectorStore

### Requirement: INDEX stage — plain chunking
The system SHALL implement a "plain" INDEX strategy that uses a `PositionAwareChunker` to split documents and an `Embedder` to create vector embeddings. The chunker and embedder SHALL be configurable via the IndexConfig. Chunk positions (docId, start, end) SHALL be preserved.

#### Scenario: Plain indexing preserves positions
- **WHEN** indexing a document with plain chunking
- **THEN** every stored chunk SHALL have correct `docId`, `start`, and `end` values matching the original document positions

#### Scenario: Plain indexing with custom chunk size
- **WHEN** indexing with `{ strategy: "plain", chunkSize: 500, chunkOverlap: 100 }`
- **THEN** the chunker SHALL use the specified size and overlap values

### Requirement: QUERY stage — identity
The system SHALL implement an "identity" QUERY strategy that passes the query through unchanged. It SHALL return the original query string as a single search input.

#### Scenario: Identity query passthrough
- **WHEN** the QUERY stage is "identity" and the input query is "How does React work?"
- **THEN** the search stage SHALL receive exactly one search input: "How does React work?"

### Requirement: SEARCH stage — dense vector
The system SHALL implement a "dense" SEARCH strategy that embeds the query using the configured Embedder, searches the VectorStore for nearest neighbors, and returns ranked `PositionAwareChunk[]`.

#### Scenario: Dense search returns k results
- **WHEN** searching with strategy "dense" and k=5 with at least 5 indexed chunks
- **THEN** the search SHALL return exactly 5 chunks ordered by vector similarity

### Requirement: REFINEMENT stage — rerank
The system SHALL implement a "rerank" REFINEMENT step that uses the configured `Reranker` to re-score and reorder search results.

#### Scenario: Rerank refinement reorders results
- **WHEN** the refinement chain includes "rerank" with a configured Reranker
- **THEN** the search results SHALL be re-scored by the Reranker and returned in the reranker's order

### Requirement: PipelineRetriever name generation
The PipelineRetriever SHALL generate a descriptive `name` property from its config. The name SHALL include the pipeline config name and key strategy identifiers.

#### Scenario: Pipeline name reflects config
- **WHEN** creating a PipelineRetriever with name "hybrid" and search strategy "hybrid"
- **THEN** the `retriever.name` SHALL include "hybrid"
