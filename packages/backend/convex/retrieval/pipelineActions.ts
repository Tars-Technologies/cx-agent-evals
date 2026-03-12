"use node";

import { action, ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import type {
  PipelineConfig,
  QueryConfig,
  SearchConfig,
  HydeQueryConfig,
  MultiQueryConfig,
  StepBackQueryConfig,
  RewriteQueryConfig,
} from "rag-evaluation-system";
import { createLLMClient, createEmbedder } from "rag-evaluation-system/llm";
import { getAuthContext } from "../lib/auth";
import { vectorSearchWithFilter } from "../lib/vectorSearch";
import type { Id } from "../_generated/dataModel";
import MiniSearch from "minisearch";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface ChunkResult {
  readonly chunkId: string;
  readonly content: string;
  readonly docId: string;
  readonly start: number;
  readonly end: number;
  readonly score: number;
  readonly metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LLM helper
// ---------------------------------------------------------------------------

const QUERY_MODEL = "gpt-4o-mini";

async function llmComplete(prompt: string, temperature = 0.7): Promise<string> {
  const client = createLLMClient();
  const result = await client.complete({
    model: QUERY_MODEL,
    messages: [{ role: "user", content: prompt }],
  });
  return result;
}

// ---------------------------------------------------------------------------
// Default prompts (mirrored from eval-lib — not exported via sub-path)
// ---------------------------------------------------------------------------

const DEFAULT_HYDE_PROMPT =
  "Write a short passage (100-200 words) that would answer the following question. Do not include the question itself, just the answer passage.\n\nQuestion: ";

const DEFAULT_MULTI_QUERY_PROMPT =
  "Generate {n} different search queries that would help find information to answer the following question. Return one query per line, no numbering.\n\nQuestion: ";

const DEFAULT_STEP_BACK_PROMPT =
  "Given the following question, generate a more general, abstract version that would retrieve broader background knowledge. Return only the abstract question.\n\nOriginal question: ";

const DEFAULT_REWRITE_PROMPT =
  "Rewrite the following question to be more precise and optimized for document retrieval. Return only the rewritten question.\n\nOriginal question: ";

// ---------------------------------------------------------------------------
// Strategy executors
// ---------------------------------------------------------------------------

interface RewriteResult {
  readonly strategy: string;
  readonly original: string;
  readonly rewrittenQueries: string[];
  readonly hypotheticalAnswer?: string;
  readonly latencyMs: number;
}

async function executeIdentity(query: string): Promise<RewriteResult> {
  return {
    strategy: "identity",
    original: query,
    rewrittenQueries: [query],
    latencyMs: 0,
  };
}

async function executeMultiQuery(
  query: string,
  config: MultiQueryConfig,
): Promise<RewriteResult> {
  const n = config.numQueries ?? 3;
  const prompt = (config.generationPrompt ?? DEFAULT_MULTI_QUERY_PROMPT)
    .replace("{n}", String(n));

  const start = performance.now();
  const raw = await llmComplete(prompt + query);
  const latencyMs = Math.round(performance.now() - start);

  const queries = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    strategy: "multi-query",
    original: query,
    rewrittenQueries: queries,
    latencyMs,
  };
}

async function executeHyde(
  query: string,
  config: HydeQueryConfig,
): Promise<RewriteResult> {
  const prompt = config.hydePrompt ?? DEFAULT_HYDE_PROMPT;

  const start = performance.now();
  const hypotheticalAnswer = await llmComplete(prompt + query);
  const latencyMs = Math.round(performance.now() - start);

  return {
    strategy: "hyde",
    original: query,
    rewrittenQueries: [hypotheticalAnswer],
    hypotheticalAnswer,
    latencyMs,
  };
}

async function executeStepBack(
  query: string,
  config: StepBackQueryConfig,
): Promise<RewriteResult> {
  const prompt = config.stepBackPrompt ?? DEFAULT_STEP_BACK_PROMPT;
  const includeOriginal = config.includeOriginal ?? true;

  const start = performance.now();
  const stepBackQuery = (await llmComplete(prompt + query)).trim();
  const latencyMs = Math.round(performance.now() - start);

  const rewrittenQueries = includeOriginal
    ? [query, stepBackQuery]
    : [stepBackQuery];

  return {
    strategy: "step-back",
    original: query,
    rewrittenQueries,
    latencyMs,
  };
}

async function executeRewrite(
  query: string,
  config: RewriteQueryConfig,
): Promise<RewriteResult> {
  const prompt = config.rewritePrompt ?? DEFAULT_REWRITE_PROMPT;

  const start = performance.now();
  const rewritten = (await llmComplete(prompt + query)).trim();
  const latencyMs = Math.round(performance.now() - start);

  return {
    strategy: "rewrite",
    original: query,
    rewrittenQueries: [rewritten],
    latencyMs,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function dispatchQueryStrategy(
  query: string,
  queryConfig: QueryConfig | undefined,
): Promise<RewriteResult> {
  if (!queryConfig || queryConfig.strategy === "identity") {
    return executeIdentity(query);
  }

  switch (queryConfig.strategy) {
    case "multi-query":
      return executeMultiQuery(query, queryConfig);
    case "hyde":
      return executeHyde(query, queryConfig);
    case "step-back":
      return executeStepBack(query, queryConfig);
    case "rewrite":
      return executeRewrite(query, queryConfig);
    default: {
      // Exhaustive check — TypeScript will error if a strategy is unhandled
      const _exhaustive: never = queryConfig;
      return executeIdentity(query);
    }
  }
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

/**
 * Rewrite a query according to a retriever's query strategy configuration.
 *
 * Takes a retriever ID and raw query string, loads the retriever's pipeline
 * config, and executes the configured query rewriting strategy (identity,
 * multi-query, HyDE, step-back, or rewrite).
 *
 * Returns the strategy name, original query, rewritten queries, and latency.
 */
export const rewriteQuery = action({
  args: {
    retrieverId: v.id("retrievers"),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const retriever = await ctx.runQuery(
      internal.crud.retrievers.getInternal,
      { id: args.retrieverId },
    );

    if (retriever.orgId !== orgId) {
      throw new Error("Retriever not found");
    }

    if (retriever.status !== "ready") {
      throw new Error(
        `Retriever is not ready (status: ${retriever.status}). Index the KB first.`,
      );
    }

    const config = retriever.retrieverConfig as PipelineConfig;
    const queryConfig = config.query as QueryConfig | undefined;

    const result = await dispatchQueryStrategy(args.query, queryConfig);

    return result;
  },
});

// ===========================================================================
// Search With Queries
// ===========================================================================

// ---------------------------------------------------------------------------
// Chunk loading helpers
// ---------------------------------------------------------------------------

/**
 * Load all chunks for a (kbId, indexConfigHash) via paginated public query.
 * Each page gets its own 16MB read budget.
 */
async function loadAllChunks(
  ctx: ActionCtx,
  kbId: Id<"knowledgeBases">,
  indexConfigHash: string,
): Promise<
  Array<{
    _id: string;
    chunkId: string;
    documentId: string;
    content: string;
    start: number;
    end: number;
    metadata: Record<string, unknown>;
  }>
> {
  const allChunks: Array<{
    _id: string;
    chunkId: string;
    documentId: string;
    content: string;
    start: number;
    end: number;
    metadata: Record<string, unknown>;
  }> = [];
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const page: {
      chunks: Array<{
        _id: string;
        chunkId: string;
        documentId: string;
        content: string;
        start: number;
        end: number;
        metadata: Record<string, unknown>;
      }>;
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(
      api.retrieval.chunks.getChunksByRetrieverPage,
      { kbId, indexConfigHash, cursor, pageSize: 100 },
    );
    allChunks.push(...page.chunks);
    isDone = page.isDone;
    cursor = page.continueCursor;
  }

  return allChunks;
}

// ---------------------------------------------------------------------------
// Dense search (single query)
// ---------------------------------------------------------------------------

async function denseSearch(
  ctx: ActionCtx,
  queryText: string,
  kbId: Id<"knowledgeBases">,
  indexConfigHash: string,
  embeddingModel: string,
  topK: number,
): Promise<ChunkResult[]> {
  const embedder = createEmbedder(embeddingModel);
  const queryEmbedding = await embedder.embedQuery(queryText);

  const { chunks, scoreMap } = await vectorSearchWithFilter(ctx, {
    queryEmbedding,
    kbId,
    indexConfigHash,
    topK,
  });

  return chunks.map((c: any) => ({
    chunkId: c.chunkId as string,
    content: c.content as string,
    docId: (c.docId ?? "") as string,
    start: c.start as number,
    end: c.end as number,
    score: scoreMap.get(c._id.toString()) ?? 0,
    metadata: (c.metadata ?? {}) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// BM25 search (single query)
// ---------------------------------------------------------------------------

interface BM25Index {
  miniSearch: MiniSearch;
  chunkMap: Map<
    string,
    {
      chunkId: string;
      content: string;
      docId: string;
      start: number;
      end: number;
      metadata: Record<string, unknown>;
    }
  >;
}

/**
 * Build a MiniSearch index from all chunks. The index is returned so it can
 * be reused across multiple queries in the same invocation.
 */
async function buildBM25Index(
  ctx: ActionCtx,
  kbId: Id<"knowledgeBases">,
  indexConfigHash: string,
): Promise<BM25Index> {
  const allChunks = await loadAllChunks(ctx, kbId, indexConfigHash);

  const chunkMap = new Map<
    string,
    {
      chunkId: string;
      content: string;
      docId: string;
      start: number;
      end: number;
      metadata: Record<string, unknown>;
    }
  >();

  const docs: Array<{ id: string; content: string }> = [];

  for (const c of allChunks) {
    const id = c._id;
    chunkMap.set(id, {
      chunkId: c.chunkId,
      content: c.content,
      docId: c.documentId,
      start: c.start,
      end: c.end,
      metadata: c.metadata,
    });
    docs.push({ id, content: c.content });
  }

  const miniSearch = new MiniSearch({
    fields: ["content"],
    storeFields: ["content"],
    idField: "id",
  });
  miniSearch.addAll(docs);

  return { miniSearch, chunkMap };
}

function bm25Search(
  index: BM25Index,
  queryText: string,
  topK: number,
  k1 = 1.2,
  b = 0.75,
): ChunkResult[] {
  const results = index.miniSearch.search(queryText, {
    boost: { content: 1 },
    bm25: { k: k1, b, d: 0.5 },
  });

  return results.slice(0, topK).map((r) => {
    const chunk = index.chunkMap.get(r.id)!;
    return {
      chunkId: chunk.chunkId,
      content: chunk.content,
      docId: chunk.docId,
      start: chunk.start,
      end: chunk.end,
      score: r.score,
      metadata: chunk.metadata,
    };
  });
}

// ---------------------------------------------------------------------------
// Fusion helpers
// ---------------------------------------------------------------------------

/**
 * Reciprocal Rank Fusion: merge multiple result lists into one.
 * `score = sum(1 / (k + rank + 1))` across all lists.
 */
function rrfFuse(resultLists: ChunkResult[][], rrfK = 60): ChunkResult[] {
  const scores = new Map<string, { chunk: ChunkResult; score: number }>();

  for (const results of resultLists) {
    for (let i = 0; i < results.length; i++) {
      const chunk = results[i];
      const key = chunk.chunkId;
      const rrfContribution = 1 / (rrfK + i + 1);
      const existing = scores.get(key);
      if (existing) {
        existing.score += rrfContribution;
      } else {
        scores.set(key, { chunk, score: rrfContribution });
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ chunk, score }) => ({ ...chunk, score }));
}

/**
 * Weighted score fusion: for each chunk, fusedScore = denseWeight * denseScore + sparseWeight * sparseScore.
 * Only chunks appearing in at least one list are included.
 */
function weightedScoreFuse(
  denseResults: ChunkResult[],
  sparseResults: ChunkResult[],
  denseWeight: number,
  sparseWeight: number,
): ChunkResult[] {
  const scores = new Map<
    string,
    { chunk: ChunkResult; denseScore: number; sparseScore: number }
  >();

  for (const chunk of denseResults) {
    scores.set(chunk.chunkId, { chunk, denseScore: chunk.score, sparseScore: 0 });
  }

  for (const chunk of sparseResults) {
    const existing = scores.get(chunk.chunkId);
    if (existing) {
      existing.sparseScore = chunk.score;
    } else {
      scores.set(chunk.chunkId, { chunk, denseScore: 0, sparseScore: chunk.score });
    }
  }

  return [...scores.values()]
    .map(({ chunk, denseScore, sparseScore }) => ({
      ...chunk,
      score: denseWeight * denseScore + sparseWeight * sparseScore,
    }))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Hybrid search (single query)
// ---------------------------------------------------------------------------

async function hybridSearch(
  ctx: ActionCtx,
  queryText: string,
  kbId: Id<"knowledgeBases">,
  indexConfigHash: string,
  embeddingModel: string,
  bm25Index: BM25Index,
  topK: number,
  config: {
    denseWeight: number;
    sparseWeight: number;
    fusionMethod: "weighted" | "rrf";
    candidateMultiplier: number;
    k1: number;
    b: number;
    rrfK: number;
  },
): Promise<ChunkResult[]> {
  const candidateK = topK * config.candidateMultiplier;

  // Run dense and BM25 in parallel
  const [denseResults, sparseResults] = await Promise.all([
    denseSearch(ctx, queryText, kbId, indexConfigHash, embeddingModel, candidateK),
    Promise.resolve(bm25Search(bm25Index, queryText, candidateK, config.k1, config.b)),
  ]);

  let fused: ChunkResult[];
  if (config.fusionMethod === "rrf") {
    fused = rrfFuse([denseResults, sparseResults], config.rrfK);
  } else {
    fused = weightedScoreFuse(
      denseResults,
      sparseResults,
      config.denseWeight,
      config.sparseWeight,
    );
  }

  return fused.slice(0, topK);
}

// ---------------------------------------------------------------------------
// Search dispatcher (single query)
// ---------------------------------------------------------------------------

async function searchSingleQuery(
  ctx: ActionCtx,
  queryText: string,
  kbId: Id<"knowledgeBases">,
  indexConfigHash: string,
  embeddingModel: string,
  searchConfig: SearchConfig,
  topK: number,
  bm25Index: BM25Index | null,
): Promise<ChunkResult[]> {
  switch (searchConfig.strategy) {
    case "dense":
      return denseSearch(ctx, queryText, kbId, indexConfigHash, embeddingModel, topK);

    case "bm25": {
      if (!bm25Index) {
        throw new Error("BM25 index not initialized");
      }
      const k1 = searchConfig.k1 ?? 1.2;
      const b = searchConfig.b ?? 0.75;
      return bm25Search(bm25Index, queryText, topK, k1, b);
    }

    case "hybrid": {
      if (!bm25Index) {
        throw new Error("BM25 index not initialized");
      }
      return hybridSearch(ctx, queryText, kbId, indexConfigHash, embeddingModel, bm25Index, topK, {
        denseWeight: searchConfig.denseWeight ?? 0.7,
        sparseWeight: searchConfig.sparseWeight ?? 0.3,
        fusionMethod: searchConfig.fusionMethod ?? "rrf",
        candidateMultiplier: searchConfig.candidateMultiplier ?? 3,
        k1: searchConfig.k1 ?? 1.2,
        b: searchConfig.b ?? 0.75,
        rrfK: searchConfig.rrfK ?? 60,
      });
    }

    default: {
      const _exhaustive: never = searchConfig;
      return denseSearch(ctx, queryText, kbId, indexConfigHash, embeddingModel, topK);
    }
  }
}

// ---------------------------------------------------------------------------
// Public action — searchWithQueries
// ---------------------------------------------------------------------------

/**
 * Execute search for one or more rewritten queries against a retriever's
 * search configuration.
 *
 * Takes a retriever ID and an array of query strings (typically from the
 * `rewriteQuery` action output). Runs the retriever's configured search
 * strategy (dense, BM25, or hybrid) for each query, then fuses results
 * across queries using Reciprocal Rank Fusion when multiple queries are
 * provided.
 *
 * Returns per-query results plus fused results with search config metadata
 * and latency.
 */
export const searchWithQueries = action({
  args: {
    retrieverId: v.id("retrievers"),
    queries: v.array(v.string()),
    k: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const start = performance.now();
    const { orgId } = await getAuthContext(ctx);

    // Load retriever
    const retriever = await ctx.runQuery(
      internal.crud.retrievers.getInternal,
      { id: args.retrieverId },
    );

    if (retriever.orgId !== orgId) {
      throw new Error("Retriever not found");
    }

    if (retriever.status !== "ready") {
      throw new Error(
        `Retriever is not ready (status: ${retriever.status}). Index the KB first.`,
      );
    }

    if (args.queries.length === 0) {
      throw new Error("At least one query is required");
    }

    const config = retriever.retrieverConfig as PipelineConfig;
    const searchConfig: SearchConfig = (config.search as SearchConfig | undefined) ?? {
      strategy: "dense",
    };
    const topK = args.k ?? retriever.defaultK;

    // Resolve embedding model from index config
    const indexSettings = (config.index ?? {}) as Record<string, unknown>;
    const embeddingModel =
      (indexSettings.embeddingModel as string) ?? "text-embedding-3-small";

    // Pre-build BM25 index if needed (reused across all queries)
    let bm25Index: BM25Index | null = null;
    if (searchConfig.strategy === "bm25" || searchConfig.strategy === "hybrid") {
      bm25Index = await buildBM25Index(
        ctx,
        retriever.kbId,
        retriever.indexConfigHash,
      );
    }

    // Execute search for each query
    const perQueryResults: Array<{ query: string; chunks: ChunkResult[] }> = [];

    for (const queryText of args.queries) {
      const chunks = await searchSingleQuery(
        ctx,
        queryText,
        retriever.kbId,
        retriever.indexConfigHash,
        embeddingModel,
        searchConfig,
        topK,
        bm25Index,
      );
      perQueryResults.push({ query: queryText, chunks });
    }

    // Fuse across queries if multiple
    let fusedResults: ChunkResult[];
    if (perQueryResults.length === 1) {
      fusedResults = perQueryResults[0].chunks;
    } else {
      const allChunkLists = perQueryResults.map((r) => r.chunks);
      fusedResults = rrfFuse(allChunkLists).slice(0, topK);
    }

    const latencyMs = Math.round(performance.now() - start);

    // Build search config metadata for the response
    const searchConfigMeta: Record<string, unknown> = {
      strategy: searchConfig.strategy,
      k: topK,
    };
    if (searchConfig.strategy === "hybrid") {
      searchConfigMeta.denseWeight = searchConfig.denseWeight ?? 0.7;
      searchConfigMeta.sparseWeight = searchConfig.sparseWeight ?? 0.3;
      searchConfigMeta.fusionMethod = searchConfig.fusionMethod ?? "rrf";
      searchConfigMeta.candidateMultiplier = searchConfig.candidateMultiplier ?? 3;
    }

    return {
      searchConfig: searchConfigMeta,
      perQueryResults,
      fusedResults,
      latencyMs,
    };
  },
});
