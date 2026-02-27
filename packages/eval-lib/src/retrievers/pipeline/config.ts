import { createHash } from "node:crypto";

/** Deterministic JSON serialization — recursively sorts object keys at every level. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val).sort(([a], [b]) => a.localeCompare(b)),
        )
      : val,
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — Index configuration
// ---------------------------------------------------------------------------

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
} as const;

// ---------------------------------------------------------------------------
// Stage 2 — Query configuration (extensible discriminated union)
// ---------------------------------------------------------------------------

export interface IdentityQueryConfig {
  readonly strategy: "identity";
}

export type QueryConfig = IdentityQueryConfig;

export const DEFAULT_QUERY_CONFIG: QueryConfig = {
  strategy: "identity",
} as const;

// ---------------------------------------------------------------------------
// Stage 3 — Search configuration (discriminated union on strategy)
// ---------------------------------------------------------------------------

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

export type SearchConfig = DenseSearchConfig | BM25SearchConfig | HybridSearchConfig;

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  strategy: "dense",
} as const;

// ---------------------------------------------------------------------------
// Stage 4 — Refinement steps (discriminated union on type)
// ---------------------------------------------------------------------------

export interface RerankRefinementStep {
  readonly type: "rerank";
}

export interface ThresholdRefinementStep {
  readonly type: "threshold";
  readonly minScore: number;
}

export type RefinementStepConfig = RerankRefinementStep | ThresholdRefinementStep;

// ---------------------------------------------------------------------------
// Pipeline configuration (composes all four stages)
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  readonly name: string;
  readonly index?: IndexConfig;
  readonly query?: QueryConfig;
  readonly search?: SearchConfig;
  readonly refinement?: readonly RefinementStepConfig[];
}

// ---------------------------------------------------------------------------
// Index config hashing — deterministic SHA-256 of index-relevant fields
// ---------------------------------------------------------------------------

interface IndexHashPayload {
  readonly strategy: string;
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly separators: readonly string[] | undefined;
  readonly embeddingModel: string;
}

/**
 * Compute a deterministic SHA-256 hash of the full retriever config (all four stages + k).
 * Two configs with identical stages and k produce the same hash regardless of name.
 */
export function computeRetrieverConfigHash(config: PipelineConfig, k: number): string {
  const index = config.index ?? DEFAULT_INDEX_CONFIG;
  const query = config.query ?? DEFAULT_QUERY_CONFIG;
  const search = config.search ?? DEFAULT_SEARCH_CONFIG;
  const refinement = config.refinement ?? [];

  const payload = {
    index: {
      strategy: index.strategy,
      chunkSize: index.chunkSize ?? DEFAULT_INDEX_CONFIG.chunkSize!,
      chunkOverlap: index.chunkOverlap ?? DEFAULT_INDEX_CONFIG.chunkOverlap!,
      separators: index.separators,
      embeddingModel: index.embeddingModel ?? DEFAULT_INDEX_CONFIG.embeddingModel!,
    },
    k,
    query,
    refinement,
    search,
  };

  const json = stableStringify(payload);
  return createHash("sha256").update(json).digest("hex");
}

export function computeIndexConfigHash(config: PipelineConfig): string {
  const index = config.index ?? DEFAULT_INDEX_CONFIG;

  const payload: IndexHashPayload = {
    strategy: index.strategy,
    chunkSize: index.chunkSize ?? DEFAULT_INDEX_CONFIG.chunkSize!,
    chunkOverlap: index.chunkOverlap ?? DEFAULT_INDEX_CONFIG.chunkOverlap!,
    separators: index.separators,
    embeddingModel: index.embeddingModel ?? DEFAULT_INDEX_CONFIG.embeddingModel!,
  };

  const json = stableStringify(payload);
  return createHash("sha256").update(json).digest("hex");
}
