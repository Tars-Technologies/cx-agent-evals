import type { PositionAwareChunker } from "../chunkers/chunker.interface.js";
import type { Embedder } from "../embedders/embedder.interface.js";
import type { VectorStore } from "../vector-stores/vector-store.interface.js";
import type { Reranker } from "../rerankers/reranker.interface.js";
import type { PipelineLLM } from "../retrievers/pipeline/llm.interface.js";
import type { PipelineConfig } from "../retrievers/pipeline/config.js";
import { PipelineRetriever } from "../retrievers/pipeline/pipeline-retriever.js";

// --- Shared deps interface ---

export interface PipelinePresetDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  readonly llm?: PipelineLLM;
}

// --- Preset configs ---

export const BASELINE_VECTOR_RAG_CONFIG: PipelineConfig = {
  name: "baseline-vector-rag",
  index: { strategy: "plain" },
  search: { strategy: "dense" },
};

export const BM25_CONFIG: PipelineConfig = {
  name: "bm25",
  index: { strategy: "plain" },
  search: { strategy: "bm25" },
};

export const HYBRID_CONFIG: PipelineConfig = {
  name: "hybrid",
  index: { strategy: "plain" },
  search: {
    strategy: "hybrid",
    denseWeight: 0.7,
    sparseWeight: 0.3,
    fusionMethod: "weighted",
    candidateMultiplier: 4,
  },
};

export const HYBRID_RERANKED_CONFIG: PipelineConfig = {
  name: "hybrid-reranked",
  index: { strategy: "plain" },
  search: {
    strategy: "hybrid",
    denseWeight: 0.7,
    sparseWeight: 0.3,
    fusionMethod: "weighted",
    candidateMultiplier: 4,
  },
  refinement: [{ type: "rerank" }],
};

// --- Generic factory ---

const PRESET_CONFIGS = {
  "baseline-vector-rag": BASELINE_VECTOR_RAG_CONFIG,
  "bm25": BM25_CONFIG,
  "hybrid": HYBRID_CONFIG,
  "hybrid-reranked": HYBRID_RERANKED_CONFIG,
} as const;

export function createPresetRetriever(
  presetName: keyof typeof PRESET_CONFIGS,
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
): PipelineRetriever {
  const base = PRESET_CONFIGS[presetName];
  const config: PipelineConfig = {
    ...base,
    ...overrides,
    name: overrides?.name ?? base.name,
  };
  return new PipelineRetriever(config, deps);
}

// --- Named convenience wrappers (backward compat) ---

/** @deprecated Use `PipelinePresetDeps` instead */
export type BaselineVectorRagPresetDeps = PipelinePresetDeps;
/** @deprecated Use `PipelinePresetDeps` instead */
export type BM25PresetDeps = PipelinePresetDeps;
/** @deprecated Use `PipelinePresetDeps` instead */
export type HybridPresetDeps = PipelinePresetDeps;
/** @deprecated Use `PipelinePresetDeps` with required `reranker` instead */
export interface HybridRerankedPresetDeps extends PipelinePresetDeps {
  readonly reranker: Reranker;
}

export const createBaselineVectorRagRetriever = (
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
) => createPresetRetriever("baseline-vector-rag", deps, overrides);

export const createBM25Retriever = (
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
) => createPresetRetriever("bm25", deps, overrides);

export const createHybridRetriever = (
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
) => createPresetRetriever("hybrid", deps, overrides);

export const createHybridRerankedRetriever = (
  deps: HybridRerankedPresetDeps,
  overrides?: Partial<PipelineConfig>,
) => createPresetRetriever("hybrid-reranked", deps, overrides);
