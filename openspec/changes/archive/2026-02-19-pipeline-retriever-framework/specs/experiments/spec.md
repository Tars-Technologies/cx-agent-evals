## MODIFIED Requirements

### Requirement: Retriever interface
The system SHALL define a `Retriever` interface with `readonly name: string`, `init(corpus: Corpus): Promise<void>`, `retrieve(query: string, k: number): Promise<PositionAwareChunk[]>`, and `cleanup(): Promise<void>`. The interface SHALL always return `PositionAwareChunk[]` for span-based evaluation. The Retriever interface SHALL be located at `retrievers/retriever.interface.ts` and re-exported from the root `index.ts`.

#### Scenario: Retriever lifecycle
- **WHEN** using a retriever in an experiment
- **THEN** the system SHALL call `init()` before any `retrieve()` calls, and `cleanup()` after all retrievals complete

#### Scenario: Retriever returns position-aware chunks
- **WHEN** calling `retriever.retrieve(query, k)`
- **THEN** the result SHALL be an array of up to `k` `PositionAwareChunk` objects containing `id`, `content`, `docId`, `start`, `end`, and `metadata`

#### Scenario: Backward-compatible imports
- **WHEN** importing `Retriever`, `VectorRAGRetriever`, or `CallbackRetriever` from `rag-evaluation-system`
- **THEN** the imports SHALL resolve successfully (re-exported from root index.ts)

### Requirement: VectorRAGRetriever baseline implementation
The system SHALL provide a `VectorRAGRetriever` class implementing the `Retriever` interface. It SHALL be located at `retrievers/baseline-vector-rag/` and re-exported from the root `index.ts`. It SHALL accept a config with `chunker: PositionAwareChunker`, `embedder: Embedder`, optional `vectorStore: VectorStore` (default: InMemoryVectorStore), optional `reranker: Reranker`, and optional `batchSize: number` (default: 100). The chunker SHALL be a `PositionAwareChunker` (not a basic `Chunker`). The `init()` method SHALL chunk the corpus with positions, embed in batches, and add to vector store. The `retrieve()` method SHALL embed the query, search the vector store, optionally rerank, and return `PositionAwareChunk[]`. The `cleanup()` method SHALL clear the vector store.

#### Scenario: VectorRAGRetriever init chunks and indexes
- **WHEN** calling `retriever.init(corpus)`
- **THEN** the retriever SHALL chunk all documents with position tracking, embed chunks in batches, and add to the vector store

#### Scenario: VectorRAGRetriever retrieve with reranker
- **WHEN** calling `retriever.retrieve(query, k)` with a reranker configured
- **THEN** the retriever SHALL embed the query, search the vector store, rerank results, and return the top k chunks

#### Scenario: VectorRAGRetriever retrieve without reranker
- **WHEN** calling `retriever.retrieve(query, k)` without a reranker
- **THEN** the retriever SHALL embed the query, search the vector store, and return the top k chunks directly

#### Scenario: VectorRAGRetriever cleanup clears vector store
- **WHEN** calling `retriever.cleanup()`
- **THEN** the vector store SHALL be cleared
