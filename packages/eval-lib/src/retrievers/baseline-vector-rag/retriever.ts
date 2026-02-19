import type { Corpus, PositionAwareChunk } from "../../types/index.js";
import type { PositionAwareChunker } from "../../chunkers/chunker.interface.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { VectorStore } from "../../vector-stores/vector-store.interface.js";
import type { Reranker } from "../../rerankers/reranker.interface.js";
import type { Retriever } from "../retriever.interface.js";
import { InMemoryVectorStore } from "../../vector-stores/in-memory.js";

export interface VectorRAGRetrieverConfig {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  readonly batchSize?: number;
}

export class VectorRAGRetriever implements Retriever {
  readonly name = "baseline-vector-rag";

  private _config: VectorRAGRetrieverConfig;
  private _vectorStore: VectorStore;
  private _embedder: Embedder;
  private _reranker: Reranker | undefined;
  private _initialized = false;

  constructor(config: VectorRAGRetrieverConfig) {
    this._config = config;
    this._vectorStore = config.vectorStore ?? new InMemoryVectorStore();
    this._embedder = config.embedder;
    this._reranker = config.reranker;
  }

  async init(corpus: Corpus): Promise<void> {
    const { chunker, batchSize = 100 } = this._config;

    // Chunk corpus with document tracking using position-aware chunker
    const paChunks: PositionAwareChunk[] = [];

    for (const doc of corpus.documents) {
      const chunks = chunker.chunkWithPositions(doc);
      paChunks.push(...chunks);
    }

    // Embed and index in batches
    for (let i = 0; i < paChunks.length; i += batchSize) {
      const batch = paChunks.slice(i, i + batchSize);
      const embeddings = await this._embedder.embed(batch.map((c) => c.content));
      await this._vectorStore.add(batch, embeddings);
    }

    this._initialized = true;
  }

  async retrieve(query: string, k: number): Promise<PositionAwareChunk[]> {
    if (!this._initialized) {
      throw new Error("Retriever not initialized. Call init() first.");
    }

    const queryEmbedding = await this._embedder.embedQuery(query);
    let retrievedChunks = await this._vectorStore.search(queryEmbedding, k);

    if (this._reranker) {
      retrievedChunks = await this._reranker.rerank(query, retrievedChunks, k);
    }

    return retrievedChunks;
  }

  async cleanup(): Promise<void> {
    await this._vectorStore.clear();
    this._initialized = false;
  }
}
