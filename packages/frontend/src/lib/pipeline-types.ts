// ---------------------------------------------------------------------------
// Frontend-side pipeline config types (mirrors eval-lib types without Node.js deps)
// ---------------------------------------------------------------------------

import { PRESET_REGISTRY } from "rag-evaluation-system/registry";

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

// Pipeline config (composes all four stages + k)
export interface PipelineConfig {
  readonly name: string;
  readonly index?: IndexConfig;
  readonly query?: QueryConfig;
  readonly search?: SearchConfig;
  readonly refinement?: readonly RefinementStepConfig[];
  readonly k?: number;
}

export const DEFAULT_K = 5;

// ---------------------------------------------------------------------------
// Preset definitions — derived from the eval-lib registry
// ---------------------------------------------------------------------------

// Derive available preset configs from registry
const registryPresets = Object.fromEntries(
  PRESET_REGISTRY
    .filter(p => p.status === "available")
    .map(p => [p.id, p.config as PipelineConfig]),
);

export const PRESET_CONFIGS: Record<string, PipelineConfig> = {
  ...registryPresets,
};

export const PRESET_NAMES = PRESET_REGISTRY
  .filter(p => p.status === "available")
  .map(p => p.id);

export const PRESET_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  PRESET_REGISTRY
    .filter(p => p.status === "available")
    .map(p => [p.id, p.description]),
);

// ---------------------------------------------------------------------------
// Saved config wrapper
// ---------------------------------------------------------------------------

export interface SavedPipelineConfig {
  readonly name: string;
  readonly basePreset: string;
  readonly config: PipelineConfig;
  /** @deprecated k is now part of PipelineConfig. Kept for backward compat with localStorage. */
  readonly k?: number;
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
  k: number;
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
    k: config.k ?? DEFAULT_K,
  };
}

/** Check if a config matches a preset exactly (k is now part of config). */
export function isPresetUnmodified(
  config: PipelineConfig,
  presetName: string,
): boolean {
  const preset = PRESET_CONFIGS[presetName];
  if (!preset) return false;
  // Compare serialized resolved configs (ignoring name)
  const a = resolveConfig({ ...config, name: "cmp" });
  const b = resolveConfig({ ...preset, name: "cmp" });
  return JSON.stringify(a) === JSON.stringify(b);
}
