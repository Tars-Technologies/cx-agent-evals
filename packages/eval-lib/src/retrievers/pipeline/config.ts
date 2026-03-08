import { createHash } from "node:crypto";
import {
  DEFAULT_CONTEXT_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
} from "./query/prompts.js";

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
// Stage 1 — Index configuration (discriminated union on strategy)
// ---------------------------------------------------------------------------

export interface PlainIndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;
}

export interface ContextualIndexConfig {
  readonly strategy: "contextual";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly embeddingModel?: string;
  readonly contextPrompt?: string;
  /** Number of parallel LLM calls during indexing. @default 5 */
  readonly concurrency?: number;
}

export interface SummaryIndexConfig {
  readonly strategy: "summary";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly embeddingModel?: string;
  readonly summaryPrompt?: string;
  /** Number of parallel LLM calls during indexing. @default 5 */
  readonly concurrency?: number;
}

export interface ParentChildIndexConfig {
  readonly strategy: "parent-child";
  readonly embeddingModel?: string;
  /** Small chunk size for retrieval matching. @default 200 */
  readonly childChunkSize?: number;
  /** Large chunk size for context return. @default 1000 */
  readonly parentChunkSize?: number;
  /** @default 0 */
  readonly childOverlap?: number;
  /** @default 100 */
  readonly parentOverlap?: number;
}

export type IndexConfig =
  | PlainIndexConfig
  | ContextualIndexConfig
  | SummaryIndexConfig
  | ParentChildIndexConfig;

export const DEFAULT_INDEX_CONFIG: PlainIndexConfig = {
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

export interface HydeQueryConfig {
  readonly strategy: "hyde";
  /** Custom prompt for generating hypothetical documents. */
  readonly hydePrompt?: string;
  /**
   * Number of hypothetical documents to generate.
   * Each produces a separate search query whose results are fused via RRF.
   * @default 1
   */
  readonly numHypotheticalDocs?: number;
}

export interface MultiQueryConfig {
  readonly strategy: "multi-query";
  /**
   * Number of query variants to generate.
   * @default 3
   */
  readonly numQueries?: number;
  /** Custom prompt for generating query variants. Use `{n}` as placeholder for count. */
  readonly generationPrompt?: string;
}

export interface StepBackQueryConfig {
  readonly strategy: "step-back";
  /** Custom prompt for generating the abstract step-back question. */
  readonly stepBackPrompt?: string;
  /**
   * Whether to also search with the original query.
   * @default true
   */
  readonly includeOriginal?: boolean;
}

export interface RewriteQueryConfig {
  readonly strategy: "rewrite";
  /** Custom prompt for rewriting the query. */
  readonly rewritePrompt?: string;
}

export type QueryConfig =
  | IdentityQueryConfig
  | HydeQueryConfig
  | MultiQueryConfig
  | StepBackQueryConfig
  | RewriteQueryConfig;

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

/**
 * Build the strategy-aware index payload for hashing.
 * Excludes runtime-only fields (concurrency) that don't affect output.
 */
function buildIndexPayload(index: IndexConfig): Record<string, unknown> {
  switch (index.strategy) {
    case "plain":
      return {
        strategy: "plain",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        separators: index.separators,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
      };
    case "contextual":
      return {
        strategy: "contextual",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
        contextPrompt: index.contextPrompt ?? DEFAULT_CONTEXT_PROMPT,
      };
    case "summary":
      return {
        strategy: "summary",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
        summaryPrompt: index.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT,
      };
    case "parent-child":
      return {
        strategy: "parent-child",
        childChunkSize: index.childChunkSize ?? 200,
        parentChunkSize: index.parentChunkSize ?? 1000,
        childOverlap: index.childOverlap ?? 0,
        parentOverlap: index.parentOverlap ?? 100,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
      };
  }
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
    index: buildIndexPayload(index),
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
  const payload = buildIndexPayload(index);

  const json = stableStringify(payload);
  return createHash("sha256").update(json).digest("hex");
}
