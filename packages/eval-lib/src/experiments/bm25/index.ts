import type { PositionAwareChunker } from "../../chunkers/chunker.interface.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { VectorStore } from "../../vector-stores/vector-store.interface.js";
import type { Reranker } from "../../rerankers/reranker.interface.js";
import type { PipelineConfig } from "../../retrievers/pipeline/config.js";
import { PipelineRetriever } from "../../retrievers/pipeline/pipeline-retriever.js";
import { BM25_CONFIG } from "./config.js";

export interface BM25PresetDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
}

export function createBM25Retriever(
  deps: BM25PresetDeps,
  configOverrides?: Partial<PipelineConfig>,
): PipelineRetriever {
  const config: PipelineConfig = {
    ...BM25_CONFIG,
    ...configOverrides,
    name: configOverrides?.name ?? BM25_CONFIG.name,
  };
  return new PipelineRetriever(config, deps);
}

export { BM25_CONFIG } from "./config.js";
