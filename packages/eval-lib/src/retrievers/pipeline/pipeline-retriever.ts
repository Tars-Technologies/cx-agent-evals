import type { Corpus, PositionAwareChunk } from "../../types/index.js";
import type { PositionAwareChunker } from "../../chunkers/chunker.interface.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { VectorStore } from "../../vector-stores/vector-store.interface.js";
import type { Reranker } from "../../rerankers/reranker.interface.js";
import type { PipelineLLM } from "./llm.interface.js";
import { InMemoryVectorStore } from "../../vector-stores/in-memory.js";
import type { Retriever } from "../retriever.interface.js";
import {
  type PipelineConfig,
  type IndexConfig,
  type SearchConfig,
  type QueryConfig,
  type RefinementStepConfig,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  DEFAULT_QUERY_CONFIG,
  computeIndexConfigHash,
} from "./config.js";
import type { ScoredChunk } from "./types.js";
import type { SearchStrategy, SearchStrategyDeps } from "./search/strategy.interface.js";
import { DenseSearchStrategy, assignRankScores } from "./search/dense.js";
import { BM25SearchStrategy } from "./search/bm25.js";
import { HybridSearchStrategy } from "./search/hybrid.js";
import { applyThresholdFilter } from "./refinement/threshold.js";
import {
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  DEFAULT_REWRITE_PROMPT,
} from "./query/prompts.js";
import { parseVariants } from "./query/utils.js";
import { rrfFuseMultiple } from "./search/fusion.js";

// ---------------------------------------------------------------------------
// Dependencies — runtime instances that can't be serialized in config
// ---------------------------------------------------------------------------

export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  readonly llm?: PipelineLLM;
  /**
   * Number of chunks to embed per API call during the INDEX stage.
   * Increase for throughput when your embedding provider allows large
   * batches; decrease to stay within request-size or rate limits.
   * @default 100
   */
  readonly embeddingBatchSize?: number;
}

// ---------------------------------------------------------------------------
// Search strategy factory
// ---------------------------------------------------------------------------

/**
 * Creates the appropriate {@link SearchStrategy} instance based on the
 * declarative search configuration.
 */
function createSearchStrategy(config: SearchConfig, batchSize: number): SearchStrategy {
  switch (config.strategy) {
    case "dense":
      return new DenseSearchStrategy({ batchSize });

    case "bm25":
      return new BM25SearchStrategy({ k1: config.k1, b: config.b });

    case "hybrid":
      return new HybridSearchStrategy({
        batchSize,
        k1: config.k1,
        b: config.b,
        fusionMethod: config.fusionMethod,
        denseWeight: config.denseWeight,
        sparseWeight: config.sparseWeight,
        candidateMultiplier: config.candidateMultiplier,
        rrfK: config.rrfK,
      });

    default:
      throw new Error(`Unknown search strategy: ${(config as any).strategy}`);
  }
}

// ---------------------------------------------------------------------------
// PipelineRetriever
// ---------------------------------------------------------------------------

/**
 * A composable, config-driven retriever that executes a four-stage pipeline:
 *
 *   INDEX → QUERY → SEARCH → REFINEMENT
 *
 * The declarative {@link PipelineConfig} controls strategy selection and
 * parameters, while {@link PipelineRetrieverDeps} provides the runtime
 * instances (chunker, embedder, vector store, reranker).
 */
export class PipelineRetriever implements Retriever {
  readonly name: string;
  readonly indexConfigHash: string;

  private readonly _refinementSteps: readonly RefinementStepConfig[];
  private readonly _chunker: PositionAwareChunker;
  private readonly _vectorStore: VectorStore;
  private readonly _reranker: Reranker | undefined;
  private readonly _queryConfig: QueryConfig;
  private readonly _llm: PipelineLLM | undefined;
  private readonly _indexConfig: IndexConfig;

  private readonly _searchStrategy: SearchStrategy;
  private readonly _searchStrategyDeps: SearchStrategyDeps;

  private _initialized = false;

  constructor(config: PipelineConfig, deps: PipelineRetrieverDeps) {
    this.name = config.name;
    this.indexConfigHash = computeIndexConfigHash(config);

    const searchConfig = config.search ?? DEFAULT_SEARCH_CONFIG;
    this._refinementSteps = config.refinement ?? [];

    this._chunker = deps.chunker;
    const embedder = deps.embedder;
    this._vectorStore = deps.vectorStore ?? new InMemoryVectorStore();
    this._reranker = deps.reranker;
    this._queryConfig = config.query ?? DEFAULT_QUERY_CONFIG;
    this._llm = deps.llm;
    this._indexConfig = config.index ?? DEFAULT_INDEX_CONFIG;
    const batchSize = deps.embeddingBatchSize ?? 100;

    // Build the strategy object from declarative config
    this._searchStrategy = createSearchStrategy(searchConfig, batchSize);

    // Shared deps passed to strategy methods
    this._searchStrategyDeps = {
      embedder,
      vectorStore: this._vectorStore,
    };

    // Validate: rerank step requires a reranker dependency
    const hasRerankStep = this._refinementSteps.some((s) => s.type === "rerank");
    if (hasRerankStep && !this._reranker) {
      throw new Error(
        'PipelineRetriever: refinement includes "rerank" step but no reranker was provided in deps.',
      );
    }

    // Validate: LLM-requiring query strategies need an LLM dependency
    const llmStrategies = ["hyde", "multi-query", "step-back", "rewrite"];
    if (llmStrategies.includes(this._queryConfig.strategy) && !this._llm) {
      throw new Error(
        `PipelineRetriever: query strategy "${this._queryConfig.strategy}" requires an LLM but none was provided in deps.`,
      );
    }

    // Validate: LLM-requiring index strategies need an LLM dependency
    const llmIndexStrategies = ["contextual", "summary"];
    if (llmIndexStrategies.includes(this._indexConfig.strategy) && !this._llm) {
      throw new Error(
        `PipelineRetriever: index strategy "${this._indexConfig.strategy}" requires an LLM but none was provided in deps.`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // INDEX stage
  // -------------------------------------------------------------------------

  async init(corpus: Corpus): Promise<void> {
    const chunks: PositionAwareChunk[] = [];

    for (const doc of corpus.documents) {
      chunks.push(...this._chunker.chunkWithPositions(doc));
    }

    await this._searchStrategy.init(chunks, this._searchStrategyDeps);

    this._initialized = true;
  }

  // -------------------------------------------------------------------------
  // QUERY + SEARCH + REFINEMENT stages
  // -------------------------------------------------------------------------

  async retrieve(query: string, k: number): Promise<PositionAwareChunk[]> {
    if (!this._initialized) {
      throw new Error("PipelineRetriever not initialized. Call init() first.");
    }

    // QUERY stage — transform/expand the query
    const queries = await this._processQuery(query);

    // SEARCH stage — search per query, fuse if multiple
    let scoredResults: ScoredChunk[];
    if (queries.length === 1) {
      scoredResults = await this._searchStrategy.search(
        queries[0],
        k,
        this._searchStrategyDeps,
      );
    } else {
      const perQueryResults = await Promise.all(
        queries.map((q) =>
          this._searchStrategy.search(q, k * 2, this._searchStrategyDeps),
        ),
      );
      scoredResults = rrfFuseMultiple(perQueryResults);
    }

    // REFINEMENT stage — always uses the ORIGINAL user query
    scoredResults = await this._applyRefinements(query, scoredResults, k);

    return scoredResults.slice(0, k).map(({ chunk }) => chunk);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    // Always clear the vector store (owned by PipelineRetriever)
    await this._vectorStore.clear();
    // Let the strategy clean up its own internal state (e.g. BM25 index)
    await this._searchStrategy.cleanup(this._searchStrategyDeps);
    this._initialized = false;
  }

  // -------------------------------------------------------------------------
  // Query processing
  // -------------------------------------------------------------------------

  private async _processQuery(query: string): Promise<string[]> {
    const config = this._queryConfig;

    switch (config.strategy) {
      case "identity":
        return [query];

      case "hyde": {
        const prompt = config.hydePrompt ?? DEFAULT_HYDE_PROMPT;
        const n = config.numHypotheticalDocs ?? 1;
        if (n === 1) {
          const hypothetical = await this._llm!.complete(prompt + query);
          return [hypothetical];
        }
        const hypotheticals = await Promise.all(
          Array.from({ length: n }, () => this._llm!.complete(prompt + query)),
        );
        return hypotheticals;
      }

      case "multi-query": {
        const n = config.numQueries ?? 3;
        const prompt = (config.generationPrompt ?? DEFAULT_MULTI_QUERY_PROMPT).replace(
          "{n}",
          String(n),
        );
        const variants = await this._llm!.complete(prompt + query);
        return parseVariants(variants, n);
      }

      case "step-back": {
        const prompt = config.stepBackPrompt ?? DEFAULT_STEP_BACK_PROMPT;
        const abstract = await this._llm!.complete(prompt + query);
        return config.includeOriginal !== false ? [query, abstract] : [abstract];
      }

      case "rewrite": {
        const prompt = config.rewritePrompt ?? DEFAULT_REWRITE_PROMPT;
        const rewritten = await this._llm!.complete(prompt + query);
        return [rewritten];
      }
    }
  }

  // -------------------------------------------------------------------------
  // Refinement chain
  // -------------------------------------------------------------------------

  private async _applyRefinements(
    query: string,
    results: ScoredChunk[],
    k: number,
  ): Promise<ScoredChunk[]> {
    let current = results;

    for (const step of this._refinementSteps) {
      switch (step.type) {
        case "rerank": {
          const chunks = current.map(({ chunk }) => chunk);
          const reranked = await this._reranker!.rerank(query, chunks, k);
          current = assignRankScores(reranked);
          break;
        }

        case "threshold": {
          current = applyThresholdFilter(current, step.minScore);
          break;
        }

        default:
          throw new Error(`Unknown refinement step type: ${(step as any).type}`);
      }
    }

    return current;
  }
}
