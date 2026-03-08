import type { PipelineConfig } from "../retrievers/pipeline/config.js";
import type { PresetEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Helper — cast coming-soon configs that reference not-yet-typed strategies
// ---------------------------------------------------------------------------

/**
 * Coming-soon presets use index/query/refinement strategies that are not yet
 * in the PipelineConfig discriminated unions (e.g. "contextual", "dedup",
 * "mmr", "parent-child", "summary"). This helper performs the cast so the
 * preset array remains fully typed for available presets while allowing
 * forward-declared configs.
 */
function comingSoonConfig(config: Record<string, unknown>): PipelineConfig {
  return config as unknown as PipelineConfig;
}

// ---------------------------------------------------------------------------
// Available presets (13)
// ---------------------------------------------------------------------------

const baselineVectorRag: PresetEntry = {
  id: "baseline-vector-rag",
  name: "Baseline Vector RAG",
  description:
    "Simple dense vector search with default chunking. The standard starting point for RAG evaluation -- fast, no external dependencies beyond an embedding model.",
  status: "available",
  complexity: "basic",
  requiresLLM: false,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: {
    name: "baseline-vector-rag",
    index: { strategy: "plain" },
    search: { strategy: "dense" },
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "Dense vector search",
    refinement: "None",
  },
};

const bm25: PresetEntry = {
  id: "bm25",
  name: "BM25",
  description:
    "Classic keyword-based retrieval using BM25 scoring. Excels at exact-match and terminology-heavy queries where semantic search may miss literal terms.",
  status: "available",
  complexity: "basic",
  requiresLLM: false,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: {
    name: "bm25",
    index: { strategy: "plain" },
    search: { strategy: "bm25" },
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "BM25 keyword search",
    refinement: "None",
  },
};

const denseReranked: PresetEntry = {
  id: "dense-reranked",
  name: "Dense + Rerank",
  description:
    "Dense vector search followed by cross-encoder reranking. Improves precision by rescoring the top candidates with a more accurate but slower model.",
  status: "available",
  complexity: "basic",
  requiresLLM: false,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: {
    name: "dense-reranked",
    index: { strategy: "plain" },
    search: { strategy: "dense" },
    refinement: [{ type: "rerank" }],
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "Dense vector search",
    refinement: "Rerank",
  },
};

const bm25Reranked: PresetEntry = {
  id: "bm25-reranked",
  name: "BM25 + Rerank",
  description:
    "BM25 keyword search followed by cross-encoder reranking. Combines fast keyword retrieval with accurate relevance rescoring.",
  status: "available",
  complexity: "basic",
  requiresLLM: false,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: {
    name: "bm25-reranked",
    index: { strategy: "plain" },
    search: { strategy: "bm25" },
    refinement: [{ type: "rerank" }],
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "BM25 keyword search",
    refinement: "Rerank",
  },
};

const hybrid: PresetEntry = {
  id: "hybrid",
  name: "Hybrid",
  description:
    "Combines dense vector and BM25 keyword search with weighted fusion. Captures both semantic similarity and exact keyword matches for more robust retrieval.",
  status: "available",
  complexity: "intermediate",
  requiresLLM: false,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: {
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
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "None",
  },
};

const hybridReranked: PresetEntry = {
  id: "hybrid-reranked",
  name: "Hybrid + Rerank",
  description:
    "Hybrid dense+BM25 retrieval with cross-encoder reranking. A strong general-purpose pipeline that balances recall and precision.",
  status: "available",
  complexity: "intermediate",
  requiresLLM: false,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: {
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
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "Rerank",
  },
};

const hybridRrf: PresetEntry = {
  id: "hybrid-rrf",
  name: "Hybrid (RRF)",
  description:
    "Hybrid search using Reciprocal Rank Fusion instead of weighted scoring. RRF is more robust to score distribution differences between dense and sparse retrievers.",
  status: "available",
  complexity: "intermediate",
  requiresLLM: false,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: {
    name: "hybrid-rrf",
    index: { strategy: "plain" },
    search: {
      strategy: "hybrid",
      fusionMethod: "rrf",
      candidateMultiplier: 4,
    },
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "Hybrid (RRF fusion)",
    refinement: "None",
  },
};

const hybridRrfReranked: PresetEntry = {
  id: "hybrid-rrf-reranked",
  name: "Hybrid (RRF) + Rerank",
  description:
    "Hybrid RRF fusion followed by cross-encoder reranking. Combines the robustness of rank-based fusion with accurate relevance rescoring.",
  status: "available",
  complexity: "intermediate",
  requiresLLM: false,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: {
    name: "hybrid-rrf-reranked",
    index: { strategy: "plain" },
    search: {
      strategy: "hybrid",
      fusionMethod: "rrf",
      candidateMultiplier: 4,
    },
    refinement: [{ type: "rerank" }],
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "Hybrid (RRF fusion)",
    refinement: "Rerank",
  },
};

// ---------------------------------------------------------------------------
// Coming-soon presets (11)
// ---------------------------------------------------------------------------

const openclawStyle: PresetEntry = {
  id: "openclaw-style",
  name: "OpenClaw Style",
  description:
    "Hybrid weighted retrieval with small chunks and a score threshold filter. Inspired by the OpenClaw legal retrieval pipeline -- good for precision-focused use cases.",
  status: "coming-soon",
  complexity: "intermediate",
  requiresLLM: false,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "openclaw-style",
    index: { strategy: "plain", chunkSize: 400, chunkOverlap: 80 },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      fusionMethod: "weighted",
      candidateMultiplier: 4,
    },
    refinement: [{ type: "threshold", minScore: 0.35 }],
  }),
  stages: {
    index: "Plain (400 chars, 80 overlap)",
    query: "Identity (passthrough)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "Threshold (0.35)",
  },
};

const hydeDense: PresetEntry = {
  id: "hyde-dense",
  name: "HyDE + Dense",
  description:
    "Generates a hypothetical answer to the query and uses its embedding for dense retrieval. Bridges the vocabulary gap between questions and documents.",
  status: "available",
  complexity: "intermediate",
  requiresLLM: true,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: {
    name: "hyde-dense",
    index: { strategy: "plain" },
    query: { strategy: "hyde" },
    search: { strategy: "dense" },
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "HyDE (hypothetical document)",
    search: "Dense vector search",
    refinement: "None",
  },
};

const hydeHybrid: PresetEntry = {
  id: "hyde-hybrid",
  name: "HyDE + Hybrid",
  description:
    "Combines HyDE query transformation with hybrid dense+sparse search. Uses the hypothetical answer embedding alongside keyword matching for broader coverage.",
  status: "available",
  complexity: "intermediate",
  requiresLLM: true,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: {
    name: "hyde-hybrid",
    index: { strategy: "plain" },
    query: { strategy: "hyde" },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "HyDE (hypothetical document)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "None",
  },
};

const hydeHybridReranked: PresetEntry = {
  id: "hyde-hybrid-reranked",
  name: "HyDE + Hybrid + Rerank",
  description:
    "Full HyDE pipeline: hypothetical document embedding, hybrid search, and cross-encoder reranking. High quality but higher latency and cost due to multiple LLM calls.",
  status: "available",
  complexity: "advanced",
  requiresLLM: true,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: {
    name: "hyde-hybrid-reranked",
    index: { strategy: "plain" },
    query: { strategy: "hyde" },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
    refinement: [{ type: "rerank" }],
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "HyDE (hypothetical document)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "Rerank",
  },
};

const multiQueryDense: PresetEntry = {
  id: "multi-query-dense",
  name: "Multi-Query + Dense",
  description:
    "Generates multiple query reformulations and retrieves for each, then deduplicates. Improves recall by covering different phrasings of the same question.",
  status: "coming-soon",
  complexity: "intermediate",
  requiresLLM: true,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "multi-query-dense",
    index: { strategy: "plain" },
    query: { strategy: "multi-query", numQueries: 3 },
    search: { strategy: "dense" },
    refinement: [{ type: "dedup" }],
  }),
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Multi-query (3 queries)",
    search: "Dense vector search",
    refinement: "Dedup",
  },
};

const multiQueryHybrid: PresetEntry = {
  id: "multi-query-hybrid",
  name: "Multi-Query + Hybrid + Rerank",
  description:
    "Multi-query expansion with hybrid search, deduplication, and reranking. A comprehensive pipeline for maximum recall with precision refinement.",
  status: "coming-soon",
  complexity: "advanced",
  requiresLLM: true,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "multi-query-hybrid",
    index: { strategy: "plain" },
    query: { strategy: "multi-query", numQueries: 3 },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
    refinement: [{ type: "dedup" }, { type: "rerank" }],
  }),
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Multi-query (3 queries)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "Dedup \u2192 Rerank",
  },
};

const contextualDense: PresetEntry = {
  id: "contextual-dense",
  name: "Contextual + Dense",
  description:
    "Prepends LLM-generated context to each chunk before embedding, improving retrieval by capturing broader document context. Higher indexing cost but better semantic matching.",
  status: "coming-soon",
  complexity: "intermediate",
  requiresLLM: true,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "contextual-dense",
    index: { strategy: "contextual" },
    search: { strategy: "dense" },
  }),
  stages: {
    index: "Contextual (LLM-enhanced chunks)",
    query: "Identity (passthrough)",
    search: "Dense vector search",
    refinement: "None",
  },
};

const contextualHybrid: PresetEntry = {
  id: "contextual-hybrid",
  name: "Contextual + Hybrid",
  description:
    "Contextual chunking with hybrid dense+sparse search. LLM-enhanced chunks improve both semantic and keyword matching for well-rounded retrieval.",
  status: "coming-soon",
  complexity: "intermediate",
  requiresLLM: true,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "contextual-hybrid",
    index: { strategy: "contextual" },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
  }),
  stages: {
    index: "Contextual (LLM-enhanced chunks)",
    query: "Identity (passthrough)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "None",
  },
};

const anthropicBest: PresetEntry = {
  id: "anthropic-best",
  name: "Anthropic Best",
  description:
    "Anthropic's recommended RAG pipeline: contextual chunking, hybrid search, and reranking. Based on their published best practices for production RAG systems.",
  status: "coming-soon",
  complexity: "advanced",
  requiresLLM: true,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "anthropic-best",
    index: { strategy: "contextual" },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
    refinement: [{ type: "rerank" }],
  }),
  stages: {
    index: "Contextual (LLM-enhanced chunks)",
    query: "Identity (passthrough)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "Rerank",
  },
};

const parentChildDense: PresetEntry = {
  id: "parent-child-dense",
  name: "Parent-Child + Dense",
  description:
    "Two-level chunking: small child chunks for precise matching, larger parent chunks for context. Returns parent chunks when child chunks match, providing broader context.",
  status: "coming-soon",
  complexity: "intermediate",
  requiresLLM: false,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "parent-child-dense",
    index: {
      strategy: "parent-child",
      childChunkSize: 200,
      parentChunkSize: 1000,
    },
    search: { strategy: "dense" },
  }),
  stages: {
    index: "Parent-child (200/1000 chunks)",
    query: "Identity (passthrough)",
    search: "Dense vector search",
    refinement: "None",
  },
};

const diverseHybrid: PresetEntry = {
  id: "diverse-hybrid",
  name: "Diverse Hybrid",
  description:
    "Hybrid search with Maximal Marginal Relevance for result diversity. Reduces redundancy by penalizing chunks similar to already-selected ones.",
  status: "coming-soon",
  complexity: "intermediate",
  requiresLLM: false,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "diverse-hybrid",
    index: { strategy: "plain" },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
    refinement: [{ type: "mmr", lambda: 0.5 }],
  }),
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Identity (passthrough)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "MMR (lambda=0.5)",
  },
};

const stepBackHybrid: PresetEntry = {
  id: "step-back-hybrid",
  name: "Step-Back + Hybrid + Rerank",
  description:
    "Generates a more abstract step-back question, retrieves for both original and abstract queries, deduplicates, and reranks. Helps when specific queries miss broader context.",
  status: "coming-soon",
  complexity: "advanced",
  requiresLLM: true,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "step-back-hybrid",
    index: { strategy: "plain" },
    query: { strategy: "step-back", includeOriginal: true },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
    refinement: [{ type: "dedup" }, { type: "rerank" }],
  }),
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Step-back (with original)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "Dedup \u2192 Rerank",
  },
};

const rewriteHybrid: PresetEntry = {
  id: "rewrite-hybrid",
  name: "Rewrite + Hybrid",
  description:
    "LLM-based query rewriting followed by hybrid search. Fixes typos, expands abbreviations, and improves query specificity before retrieval.",
  status: "available",
  complexity: "intermediate",
  requiresLLM: true,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: {
    name: "rewrite-hybrid",
    index: { strategy: "plain" },
    query: { strategy: "rewrite" },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Rewrite (LLM-refined query)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "None",
  },
};

const rewriteHybridReranked: PresetEntry = {
  id: "rewrite-hybrid-reranked",
  name: "Rewrite + Hybrid + Rerank",
  description:
    "Query rewriting with hybrid search and reranking. Improves both the query and the result ordering for high-quality retrieval at the cost of additional LLM calls.",
  status: "available",
  complexity: "advanced",
  requiresLLM: true,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: {
    name: "rewrite-hybrid-reranked",
    index: { strategy: "plain" },
    query: { strategy: "rewrite" },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      candidateMultiplier: 4,
    },
    refinement: [{ type: "rerank" }],
  },
  stages: {
    index: "Plain (1000 chars, 200 overlap)",
    query: "Rewrite (LLM-refined query)",
    search: "Hybrid (weighted, 0.7/0.3)",
    refinement: "Rerank",
  },
};

const summaryDense: PresetEntry = {
  id: "summary-dense",
  name: "Summary + Dense",
  description:
    "Generates LLM summaries for each chunk and indexes both summary and original text embeddings. Helps match high-level queries to specific content.",
  status: "coming-soon",
  complexity: "intermediate",
  requiresLLM: true,
  requiresReranker: false,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "summary-dense",
    index: { strategy: "summary" },
    search: { strategy: "dense" },
  }),
  stages: {
    index: "Summary (LLM-generated summaries)",
    query: "Identity (passthrough)",
    search: "Dense vector search",
    refinement: "None",
  },
};

const premium: PresetEntry = {
  id: "premium",
  name: "Premium",
  description:
    "The most comprehensive pipeline: contextual chunking, multi-query expansion, hybrid search, deduplication, reranking, and threshold filtering. Maximum quality at maximum cost.",
  status: "coming-soon",
  complexity: "advanced",
  requiresLLM: true,
  requiresReranker: true,
  options: [],
  defaults: {},
  config: comingSoonConfig({
    name: "premium",
    index: { strategy: "contextual" },
    query: { strategy: "multi-query", numQueries: 3 },
    search: { strategy: "hybrid", candidateMultiplier: 5 },
    refinement: [
      { type: "dedup" },
      { type: "rerank" },
      { type: "threshold", minScore: 0.3 },
    ],
  }),
  stages: {
    index: "Contextual (LLM-enhanced chunks)",
    query: "Multi-query (3 queries)",
    search: "Hybrid (candidate 5x)",
    refinement: "Dedup \u2192 Rerank \u2192 Threshold (0.3)",
  },
};

// ---------------------------------------------------------------------------
// Registry — available first, then coming-soon
// ---------------------------------------------------------------------------

export const PRESET_REGISTRY: readonly PresetEntry[] = [
  // Available — basic
  baselineVectorRag,
  bm25,
  denseReranked,
  bm25Reranked,
  // Available — intermediate
  hybrid,
  hybridReranked,
  hybridRrf,
  hybridRrfReranked,
  hydeDense,
  hydeHybrid,
  rewriteHybrid,
  // Available — advanced
  hydeHybridReranked,
  rewriteHybridReranked,
  // Coming-soon — intermediate
  openclawStyle,
  multiQueryDense,
  contextualDense,
  contextualHybrid,
  parentChildDense,
  diverseHybrid,
  summaryDense,
  // Coming-soon — advanced
  multiQueryHybrid,
  anthropicBest,
  stepBackHybrid,
  premium,
] as const;
