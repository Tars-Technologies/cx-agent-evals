// ---------------------------------------------------------------------------
// Frontend-side pipeline config types (mirrors eval-lib types without Node.js deps)
// ---------------------------------------------------------------------------

// Stage 1 — Index
export interface IndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;
}

export const DEFAULT_INDEX_CONFIG: IndexConfig = {
  strategy: "plain",
  chunkSize: 1000,
  chunkOverlap: 200,
  embeddingModel: "text-embedding-3-small",
};

// Stage 2 — Query
export interface IdentityQueryConfig {
  readonly strategy: "identity";
}

export type QueryConfig = IdentityQueryConfig;

export const DEFAULT_QUERY_CONFIG: QueryConfig = {
  strategy: "identity",
};

// Stage 3 — Search
export interface DenseSearchConfig {
  readonly strategy: "dense";
}

export interface BM25SearchConfig {
  readonly strategy: "bm25";
  readonly k1?: number;
  readonly b?: number;
}

export interface HybridSearchConfig {
  readonly strategy: "hybrid";
  readonly denseWeight?: number;
  readonly sparseWeight?: number;
  readonly fusionMethod?: "weighted" | "rrf";
  readonly candidateMultiplier?: number;
  readonly rrfK?: number;
  readonly k1?: number;
  readonly b?: number;
}

export type SearchConfig =
  | DenseSearchConfig
  | BM25SearchConfig
  | HybridSearchConfig;

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  strategy: "dense",
};

// Stage 4 — Refinement
export interface RerankRefinementStep {
  readonly type: "rerank";
}

export interface ThresholdRefinementStep {
  readonly type: "threshold";
  readonly minScore: number;
}

export type RefinementStepConfig =
  | RerankRefinementStep
  | ThresholdRefinementStep;

// Pipeline config (composes all four stages)
export interface PipelineConfig {
  readonly name: string;
  readonly index?: IndexConfig;
  readonly query?: QueryConfig;
  readonly search?: SearchConfig;
  readonly refinement?: readonly RefinementStepConfig[];
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export const PRESET_CONFIGS: Record<string, PipelineConfig> = {
  "baseline-vector-rag": {
    name: "baseline-vector-rag",
    index: { strategy: "plain" },
    search: { strategy: "dense" },
  },
  bm25: {
    name: "bm25",
    index: { strategy: "plain" },
    search: { strategy: "bm25" },
  },
  hybrid: {
    name: "hybrid",
    index: { strategy: "plain" },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      fusionMethod: "weighted",
      candidateMultiplier: 4,
    },
  },
  "hybrid-reranked": {
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
  },
};

export const PRESET_NAMES = Object.keys(PRESET_CONFIGS);

export const PRESET_DESCRIPTIONS: Record<string, string> = {
  "baseline-vector-rag": "Dense vector search",
  bm25: "BM25 keyword search",
  hybrid: "Dense + BM25 weighted fusion",
  "hybrid-reranked": "Hybrid search + reranking",
};

// ---------------------------------------------------------------------------
// Saved config wrapper
// ---------------------------------------------------------------------------

export interface SavedPipelineConfig {
  readonly name: string;
  readonly basePreset: string;
  readonly config: PipelineConfig;
  readonly k: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a PipelineConfig's fields to their effective values (with defaults). */
export function resolveConfig(config: PipelineConfig): {
  index: Required<Omit<IndexConfig, "separators">> & { separators?: readonly string[] };
  query: QueryConfig;
  search: SearchConfig;
  refinement: readonly RefinementStepConfig[];
  name: string;
} {
  const index = config.index ?? DEFAULT_INDEX_CONFIG;
  return {
    name: config.name,
    index: {
      strategy: index.strategy,
      chunkSize: index.chunkSize ?? DEFAULT_INDEX_CONFIG.chunkSize!,
      chunkOverlap: index.chunkOverlap ?? DEFAULT_INDEX_CONFIG.chunkOverlap!,
      embeddingModel: index.embeddingModel ?? DEFAULT_INDEX_CONFIG.embeddingModel!,
      ...(index.separators ? { separators: index.separators } : {}),
    },
    query: config.query ?? DEFAULT_QUERY_CONFIG,
    search: config.search ?? DEFAULT_SEARCH_CONFIG,
    refinement: config.refinement ?? [],
  };
}

/** Check if a config matches a preset exactly. */
export function isPresetUnmodified(
  config: PipelineConfig,
  k: number,
  presetName: string,
): boolean {
  const preset = PRESET_CONFIGS[presetName];
  if (!preset) return false;
  // Compare serialized resolved configs (ignoring name)
  const a = resolveConfig({ ...config, name: "cmp" });
  const b = resolveConfig({ ...preset, name: "cmp" });
  return JSON.stringify(a) === JSON.stringify(b) && k === 5;
}
