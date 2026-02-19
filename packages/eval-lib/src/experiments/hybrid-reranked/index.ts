import type { PositionAwareChunker } from "../../chunkers/chunker.interface.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { VectorStore } from "../../vector-stores/vector-store.interface.js";
import type { Reranker } from "../../rerankers/reranker.interface.js";
import type { PipelineConfig } from "../../retrievers/pipeline/config.js";
import { PipelineRetriever } from "../../retrievers/pipeline/pipeline-retriever.js";
import { HYBRID_RERANKED_CONFIG } from "./config.js";

export interface HybridRerankedPresetDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker: Reranker;
}

export function createHybridRerankedRetriever(
  deps: HybridRerankedPresetDeps,
  configOverrides?: Partial<PipelineConfig>,
): PipelineRetriever {
  const config: PipelineConfig = {
    ...HYBRID_RERANKED_CONFIG,
    ...configOverrides,
    name: configOverrides?.name ?? HYBRID_RERANKED_CONFIG.name,
  };
  return new PipelineRetriever(config, deps);
}

export { HYBRID_RERANKED_CONFIG } from "./config.js";
