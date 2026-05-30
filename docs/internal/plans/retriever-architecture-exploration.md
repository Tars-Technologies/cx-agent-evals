# Retriever Architecture Exploration

A comprehensive exploration of RAG retriever strategies, their taxonomy, composability patterns, and the architectural thinking that led to a three-layer retriever system: composable pipelines, orchestrated retrievers, and custom retrievers.

---

## Table of Contents

1. [Starting Point: The Problem](#starting-point-the-problem)
2. [Research Landscape](#research-landscape)
3. [The Complete Retriever Catalog](#the-complete-retriever-catalog)
4. [The Key Insight: Retrieval as a Pipeline of Stages](#the-key-insight-retrieval-as-a-pipeline-of-stages)
5. [Stage 1: INDEX — How Chunks Are Prepared](#stage-1-index--how-chunks-are-prepared)
6. [Stage 2: QUERY — How the Query Is Shaped](#stage-2-query--how-the-query-is-shaped)
7. [Stage 3: SEARCH — How Candidates Are Scored](#stage-3-search--how-candidates-are-scored)
8. [Stage 4: REFINEMENT — How Results Are Refined](#stage-4-refinement--how-results-are-refined)
9. [Named Retrievers as Pipeline Configurations](#named-retrievers-as-pipeline-configurations)
10. [Where the Pipeline Breaks: The Control Flow Problem](#where-the-pipeline-breaks-the-control-flow-problem)
11. [Layer 2: Orchestrated Retrievers](#layer-2-orchestrated-retrievers)
12. [Layer 3: Custom Retrievers](#layer-3-custom-retrievers)
13. [The Three-Layer Architecture](#the-three-layer-architecture)
14. [The Position-Awareness Constraint](#the-position-awareness-constraint)
15. [Lessons from Real-World Systems](#lessons-from-real-world-systems)
16. [Experiment Combinatorics](#experiment-combinatorics)
17. [Open Questions and Future Directions](#open-questions-and-future-directions)

---

## Starting Point: The Problem

Our evaluation system has a single retriever implementation: a baseline vector RAG retriever that chunks documents, embeds them, stores them in a vector store, and retrieves by embedding similarity with optional reranking. This gives us one retrieval strategy with a handful of tunable knobs (chunk size, overlap, embedding model, reranker, k).

The goal is to support a wide variety of retrieval strategies — BM25, hybrid search, CRAG, RAPTOR, agentic search, and many others — each with their own configurable parameters, so we can run experiments comparing them head-to-head using our span-based evaluation metrics.

The challenge: how do you organize dozens of retriever strategies without massive code duplication, while still allowing novel strategies that we can't predict today?

```
  CURRENT STATE: One retriever, ~5 knobs

  ┌─────────────────────────────────────────────────┐
  │            VectorRAGRetriever                    │
  │                                                  │
  │   Corpus ──▶ Chunk ──▶ Embed ──▶ Vector Store   │
  │                                                  │
  │   Query ──▶ Embed ──▶ Search ──▶ [Rerank] ──▶   │
  │                                                  │
  │   Knobs: chunkSize, embedder, vectorStore,       │
  │          reranker, k                             │
  └─────────────────────────────────────────────────┘

  DESIRED STATE: Dozens of strategies, hundreds of configs

  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
  │ BM25      │ │ Hybrid    │ │ HyDE      │ │ CRAG      │
  ├───────────┤ ├───────────┤ ├───────────┤ ├───────────┤
  │ Contextual│ │ MultiQuery│ │ Parent-   │ │ Agentic   │
  │ Retrieval │ │ Fusion    │ │ Document  │ │ Search    │
  ├───────────┤ ├───────────┤ ├───────────┤ ├───────────┤
  │ Sentence  │ │ RAPTOR    │ │ GraphRAG  │ │  ???      │
  │ Window    │ │           │ │           │ │ (future)  │
  └───────────┘ └───────────┘ └───────────┘ └───────────┘
```

---

## Research Landscape

### ChromaDB's Approach

ChromaDB focuses on embedding model comparison rather than retriever architecture comparison. Their generative benchmarking framework (documented in their research at research.trychroma.com) generates domain-specific benchmarks tailored to actual data rather than using generic datasets.

Their pipeline: load and embed a corpus, filter documents for quality using an LLM, generate synthetic queries per document, assign ground truth via LLM-judged relevance (producing qrels), then evaluate using standard IR metrics (NDCG, MAP, Recall, Precision at k) via the pytrec_eval library.

ChromaDB now natively supports dense vector search (HNSW), full-text search (FTS), hybrid search, and sparse vectors. This confirms that hybrid (dense + sparse) is considered table stakes.

Their most interesting experimental contribution is density-based relevance scoring: instead of a hard distance threshold, they compute the distribution of distances between embeddings in the dataset and use it to determine what percentile a query-result distance falls in. A result in the 5th percentile of distances is far more likely to be relevant than one in the 80th percentile. This eliminates threshold tuning and adapts automatically as data changes.

### Anthropic's Contextual Retrieval

Anthropic's contextual retrieval approach (documented in their cookbook and blog) is perhaps the highest-impact single technique. The idea: before embedding a chunk, use an LLM (Claude) to generate a brief "situating context" that explains what the chunk contains and where it fits in the overall document. This context is prepended to the chunk before embedding.

Results from their evaluation: contextual embeddings alone reduce retrieval failures by 30-40% across all k values compared to basic RAG. Combined with BM25 (hybrid), the improvement is even larger. Combined with hybrid + reranking, it produced their best results — approximately 67% fewer retrieval failures than naive RAG.

The cost efficiency comes from prompt caching: since you process chunks document-by-document, the full document text is cached and reused across all chunks from that document. Anthropic measured 61.83% of input tokens being read from cache (90% discount), bringing the cost down dramatically.

This technique is notable because it modifies the indexing step, not the query or search step. The chunks still have their original positions; only the embeddings are richer.

```
  Anthropic's Contextual Retrieval Results

  Retrieval Failure Rate (lower is better):

  Naive RAG          ████████████████████████████████  100%
  + Contextual Emb   ████████████████████             ~60-70%
  + Hybrid (BM25)    ██████████████████                ~55%
  + Reranking         ███████████                       ~33%

  Each layer addresses a different failure mode:
    Dense    → semantic understanding
    BM25     → exact keyword matching
    Context  → chunk-level meaning
    Rerank   → precision in final results
```

### LlamaIndex's Retriever Taxonomy

LlamaIndex has the most comprehensive retriever implementation catalog in code:

- **AutoMergingRetriever**: If enough children of a parent node are retrieved (above a configurable ratio threshold), merge and return the parent instead. This is the "small-to-big" pattern.
- **QueryFusionRetriever**: Generate multiple query variants and fuse results using configurable fusion modes (reciprocal rank fusion, relative score, distance-based score, simple).
- **RecursiveRetriever**: Follow links from retrieved nodes to other retrievers or query engines recursively. For multi-hop reasoning.
- **RouterRetriever**: Use an LLM or selector to route queries to the most appropriate retriever from a set of candidates.
- **TransformRetriever**: Apply query transforms before retrieval (HyDE, step-back, etc.).
- Plus specialized retrievers for knowledge graphs, SQL, property graphs, tree structures, and summary indices.

### OpenClaw's Memory System

OpenClaw (the open-source Claude Code alternative) implements a practical, production-tested retrieval system for agent memory. The architecture is instructive:

**Storage**: SQLite database with three key components:
- A chunks table storing ~400-token chunks with 80-token overlap, each with its text, embedding vector, and the line range it came from in the original file
- A ChunksFTS virtual table (FTS5) enabling BM25 keyword ranking
- A ChunksVec virtual table (SQLite Vec) storing embeddings for cosine similarity search

**Search pipeline**:
1. The query text gets embedded using the same provider that indexed the files
2. Two searches run in parallel:
   - Keyword search: tokenizes query, runs against FTS5 table, BM25 ranks results, converts to 0-1 score using `1 / (1 + rank)`
   - Vector search: takes query embedding, uses cosine distance to find nearest chunks, converts to similarity score `1 - distance`
3. Both searches use a candidate multiplier: if you ask for 6 results, each search returns up to 24 candidates (4x multiplier gives fusion more to work with)
4. Weighted score fusion combines them: `0.7 * vectorScore + 0.3 * textScore`
5. Results appearing in both searches get both scores combined; results from only one search get zero for the other
6. Final filtering: minimum threshold of 0.35, capped at requested result count

**The two-step retrieval pattern (memory_search + memory_get)**:
- `memory_search`: Returns lightweight snippets — file path, line numbers, relevance score, and a 700-character text preview
- `memory_get`: Fetches a specific section of a memory file by path, start line, and line count

This two-step pattern is deliberate: search returns just enough context for the agent to decide what's relevant, then the agent fetches only the specific content it needs. This keeps the context window lean and efficient.

**Incremental sync**: File watcher monitors changes, compares content hashes, only re-chunks and re-embeds files that actually changed. An embedding cache avoids re-embedding unchanged text chunks even after re-chunking.

```
  OpenClaw's Memory Retrieval Pipeline

  Query
    │
    ├───────────────────────┬────────────────────────┐
    ▼                       ▼                        │
  ┌──────────────┐   ┌───────────────┐              │
  │   FTS5/BM25  │   │  SQLite Vec   │              │
  │   keyword    │   │  cosine sim   │              │
  │  (24 cands)  │   │  (24 cands)   │              │
  └──────┬───────┘   └───────┬───────┘              │
         │                    │                      │
         └────────┬───────────┘                      │
                  ▼                                  │
    ┌─────────────────────────┐                      │
    │   Weighted Fusion       │                      │
    │   0.7*vec + 0.3*kw     │                      │
    │   threshold >= 0.35    │                      │
    └────────────┬────────────┘                      │
                 ▼                                   │
    ┌─────────────────────────┐     Step 1: SEARCH   │
    │   memory_search         │◄─────────────────────┘
    │   returns: snippets     │
    │   (path, lines, score,  │
    │    700-char preview)    │
    └────────────┬────────────┘
                 │
                 ▼  agent decides what's relevant
    ┌─────────────────────────┐
    │   memory_get            │     Step 2: GET
    │   fetches specific      │
    │   file section by       │
    │   path + line range     │
    └─────────────────────────┘
```

### RAGAS Evaluation Framework

RAGAS (now maintained by VibrantLabs) provides the most comprehensive metric library for RAG evaluation. Their retrieval-specific metrics include context precision (with and without reference, LLM-based and non-LLM), context recall (ID-based, LLM-based, non-LLM), and context entity recall. They also provide end-to-end metrics like faithfulness, answer relevancy, factual correctness, and noise sensitivity.

Their approach uses LLM-as-judge for most metrics, with non-LLM alternatives available. This is complementary to our span-based evaluation, which is more granular (character-level overlap) but doesn't require an LLM for metric computation.

---

## The Complete Retriever Catalog

Through research and analysis, we identified the following distinct retrieval techniques:

### Sparse / Keyword-Based Retrieval

**BM25 (Best Matching 25)**: The gold standard for keyword-based retrieval. Ranks documents based on term frequency, inverse document frequency, and document length normalization. No neural model involved. Key parameters: k1 (term saturation, typically 1.2-2.0), b (document length normalization, typically 0.75), tokenizer/stemmer choice, and stop word list.

Strengths: Fast, interpretable, excellent for exact keyword matching (error codes, function names, identifiers), no training required, zero cost per query. Weaknesses: Cannot handle semantic similarity (synonyms, paraphrases), vocabulary mismatch problem.

The CloudCode team notably started with a vector database but found that grep and agentic search (essentially keyword-based) actually performed better for their use case and was easier to maintain. This underscores that keyword search is not obsolete — it excels where dense retrieval fails.

### Dense Vector Retrieval

**Bi-encoder dense retrieval**: The standard RAG approach. Embed both documents and queries into a shared dense vector space using a neural embedding model. Retrieve by nearest-neighbor search (cosine similarity, dot product, or L2 distance). Key parameters: embedding model, dimension, distance metric, chunk size, overlap, top-k, index type (HNSW, IVF, flat).

**ColBERT (late interaction)**: Unlike bi-encoder models that produce a single vector per text, ColBERT produces per-token embeddings for both queries and documents. At search time, it computes a MaxSim operation: for each query token, find the maximum similarity to any document token, then sum across all query tokens. This captures fine-grained token-level interactions while still allowing pre-computation of document representations.

ColBERT sits between bi-encoder (fast, less accurate) and cross-encoder (slow, more accurate). It's more expensive to store (one vector per token vs. one per chunk) but significantly more accurate than bi-encoder for many tasks.

### Hybrid Search

Combine keyword (sparse) and semantic (dense) search results using fusion. Two primary fusion approaches:

**Weighted Score Fusion**: Take scores from both searches and combine with weights. OpenClaw uses 70% vector / 30% keyword. Gives you explicit control and preserves signal strength. A near-perfect dense match contributes more than a decent one.

**Reciprocal Rank Fusion (RRF)**: Instead of raw scores, RRF uses position rankings. A result ranked #2 in semantic and #3 in keyword gets a combined score based on both positions. Results appearing near the top of both lists naturally bubble up. Simpler than weighted fusion but treats a near-perfect match the same as a decent one — it only cares about position, not strength.

```
  Weighted Score Fusion              Reciprocal Rank Fusion (RRF)

  Dense results:                     Dense results:
    A: 0.95                            A: rank 1
    B: 0.82                            B: rank 2
    C: 0.71                            C: rank 3

  Keyword results:                   Keyword results:
    B: 0.88                            B: rank 1
    D: 0.76                            D: rank 2
    A: 0.65                            A: rank 3

  Fusion (0.7d + 0.3k):             RRF (k=60):
    A: 0.7*0.95 + 0.3*0.65 = 0.86     B: 1/(60+2) + 1/(60+1) = 0.033
    B: 0.7*0.82 + 0.3*0.88 = 0.84     A: 1/(60+1) + 1/(60+3) = 0.032
    C: 0.7*0.71 + 0.3*0.00 = 0.50     D: 0/(---) + 1/(60+2) = 0.016
    D: 0.7*0.00 + 0.3*0.76 = 0.23     C: 1/(60+3) + 0/(---) = 0.016

  Preserves score magnitude          Only cares about rank position
```

The candidate multiplier concept (from OpenClaw): if you want N final results, each search returns candidateMultiplier * N candidates. A 4x multiplier gives the fusion step more to work with and generally improves result quality at minimal additional cost.

### HyDE (Hypothetical Document Embeddings)

Instead of embedding the query directly, use an LLM to generate a hypothetical answer document, then embed that hypothetical document and use it for retrieval. The intuition: a hypothetical answer is closer in embedding space to the actual answer document than the raw query.

```
  Standard Retrieval:
    "How does React handle state?"  ──embed──▶  [0.12, -0.34, ...]
                                                       │
                                                    search
                                                       ▼
                                               nearest neighbors

  HyDE Retrieval:
    "How does React handle state?"  ──LLM──▶  "React manages state
                                                using the useState hook
                                                which returns a state
                                                variable and setter..."
                                                       │
                                                     embed
                                                       ▼
                                                [0.45, -0.12, ...]
                                                       │
                                                    search
                                                       ▼
                                               nearest neighbors
                                               (closer to actual
                                                answer documents)
```

Example: Query "How does React handle state?" → LLM generates a paragraph explaining React state management → that paragraph gets embedded → nearest neighbors to that embedding are found.

Can also generate multiple hypothetical documents and average their embeddings for more robust retrieval. Key parameters: LLM model, generation prompt, number of hypothetical documents.

Especially effective for short or abstract queries where query-document embedding mismatch is large. Less effective when the query is already well-aligned with document language.

### Multi-Query Retrieval

Generate multiple reformulations or perspectives of the original query using an LLM, retrieve for each variant, then fuse/deduplicate results. Example: "How do I speed up my app?" might generate "application performance optimization techniques", "reducing latency in web applications", "profiling slow applications".

Key parameters: number of query variants (typically 3-5), generation prompt, fusion method, per-query top-k vs. final top-k. Captures different aspects and interpretations of a query, reducing sensitivity to query wording.

### Step-Back Prompting

Use an LLM to generate a more abstract version of the query. Instead of "Why does my React useEffect cleanup not run?", the step-back query might be "How does the React useEffect lifecycle work?". Retrieve for the abstract query to get broader context, optionally also retrieve for the original query and combine.

### Query Decomposition

Break a complex query into multiple simpler sub-queries, retrieve for each, combine results. Example: "Compare the authentication approaches in Express vs. FastAPI" → decompose into "Express authentication approaches" and "FastAPI authentication approaches", retrieve for each, merge results.

### Contextual Retrieval (Anthropic)

Before embedding, use an LLM to generate a brief "situating context" for each chunk that explains what the chunk contains and where it fits in the overall document. This context is prepended to the chunk text before embedding.

Example: A chunk containing code might get context like: "This chunk is from the authentication middleware file and contains the JWT validation function that checks token expiry and signature."

The chunk's original character positions are preserved — it's the embedding that gets richer, not the chunk boundaries. This is purely an indexing-time enrichment. Key parameters: LLM model, context prompt, concurrency for parallel processing.

### Proposition-Based Indexing

Decompose documents into atomic factual propositions before indexing. Instead of chunking by character count, an LLM extracts individual facts. Example: "The Eiffel Tower, built in 1889, is located in Paris, France" becomes three propositions: "The Eiffel Tower was built in 1889", "The Eiffel Tower is located in Paris", "Paris is in France".

Each proposition is a self-contained unit of information, making retrieval more precise for factual queries. Requires careful position tracking — each proposition maps back to a span in the original document.

### Summary-Indexed Retrieval

Each chunk gets an LLM-generated summary. The summaries are embedded and indexed. Search runs against the summary embeddings, but returns the original chunks (with their original positions). The idea: summaries capture the essential meaning in fewer tokens, producing better embeddings for matching.

### Parent-Child / Small-to-Big Retrieval

Index small chunks (children) for precise matching, but maintain links to larger parent chunks. When a child chunk is retrieved, the system can return the parent chunk instead, providing richer context. LlamaIndex's AutoMergingRetriever adds a twist: if enough children of the same parent are retrieved (above a configurable ratio threshold, default 0.5), merge and return the parent.

Position tracking works naturally: the parent's span is the union of its children's spans (min start, max end for the same docId).

```
  Parent-Child / Small-to-Big Retrieval

  Document: "The quick brown fox jumps over the lazy dog. It was a sunny day."
             |--- child 1 ---|--- child 2 ---|--- child 3 ---|
             |------------- parent chunk -------------------|

  Index:   child 1, child 2, child 3  (small, precise embeddings)
  Search:  query matches child 2
  Return:  parent chunk  (start=0, end=62, richer context)

  Auto-Merge variant:
    If child 1 AND child 2 are both retrieved (2/3 > threshold 0.5),
    merge into parent and return that instead.
```

### Sentence Window Retrieval

A variant of parent-child where the "children" are individual sentences and the "parent" is a window of surrounding sentences. Index at the sentence level for precision, but when retrieved, expand to include N sentences before and after for context. The window size is configurable.

### Late Chunking (Jina AI)

The traditional approach: chunk first, then embed each chunk independently. Late chunking inverts this: embed the full document using a long-context embedding model (the full document goes through the transformer, so each token has full-document context), THEN split into chunks. Each chunk's embedding already captures the full document context, similar to contextual retrieval but without the LLM call.

Requires a long-context embedding model that can handle full documents. The resulting embeddings are more context-aware than those produced by independent chunk embedding.

### RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval)

Builds a tree of document summaries at multiple levels of abstraction:
1. Chunk documents into leaf nodes
2. Embed and cluster leaf nodes (using Gaussian Mixture Models or similar)
3. Summarize each cluster using an LLM
4. Recursively cluster and summarize until reaching a root level
5. At query time, retrieve from multiple tree levels

```
  RAPTOR Tree Structure

              ┌──────────────────────┐
              │    Root Summary      │  Level 2
              │  (global overview)   │  (no positions)
              └──────────┬───────────┘
                    ┌────┴────┐
           ┌───────┴──┐  ┌───┴────────┐
           │ Cluster  │  │  Cluster   │  Level 1
           │ Summary  │  │  Summary   │  (no positions)
           │   A      │  │    B       │
           └────┬─────┘  └─────┬──────┘
            ┌───┼───┐      ┌───┼───┐
           ┌┴┐ ┌┴┐ ┌┴┐   ┌┴┐ ┌┴┐ ┌┴┐
           │1│ │2│ │3│   │4│ │5│ │6│    Level 0
           └─┘ └─┘ └─┘   └─┘ └─┘ └─┘   LEAF NODES
                                         (have positions!)

  Tree traversal: start at root, descend into relevant branches
  Collapsed: search all levels simultaneously
```

Two retrieval strategies: tree traversal (start at root, descend into relevant branches) or collapsed (search all levels simultaneously, as if the tree were flattened into a single collection).

Handles questions requiring multi-document synthesis and captures both fine-grained and high-level information. Expensive to build (many LLM calls for summarization), and summaries don't map directly to character positions in source documents — only the leaf nodes do.

### CRAG (Corrective RAG)

Adds a self-correction layer after initial retrieval. An LLM evaluates whether retrieved documents are actually relevant to the query and grades them as Correct, Incorrect, or Ambiguous. Based on the grade:
- Correct: proceed with retrieved documents
- Ambiguous: apply knowledge refinement (strip irrelevant sentences from retrieved chunks)
- Incorrect: rewrite the query and re-retrieve, or fall back to web search

Key parameters: relevance threshold, maximum iterations, fallback strategy, knowledge refinement method. Reduces hallucination from irrelevant context, but adds latency and cost from the grading LLM call.

### Self-RAG (Self-Reflective RAG)

A more sophisticated version of corrective retrieval where the LLM generates special "reflection tokens" at multiple decision points:
1. **Retrieve token**: Should I retrieve at all for this query? (Some queries don't need retrieval)
2. **IsRelevant token**: For each retrieved document, is it relevant to the query?
3. **IsSupportive token**: Does the retrieved evidence actually support the generated response?
4. **IsUseful token**: Is the overall response useful to the user?

Self-RAG is deeply interleaved with the generation process — it's not just a retrieval strategy but a generation strategy that conditionally triggers retrieval. This makes it fundamentally different from pure retrieval techniques.

### FLARE (Forward-Looking Active REtrieval)

Generates text sentence by sentence. After generating each sentence, FLARE checks the LLM's confidence (measured by token probabilities). If confidence drops below a threshold on the next sentence, it triggers retrieval using the low-confidence sentence as the query. The retrieved context is then used to regenerate that sentence.

Like Self-RAG, FLARE interleaves retrieval with generation. The retrieval is reactive — triggered only when the model is uncertain, not preemptively for every query.

### Iterative / Multi-Hop Retrieval

For complex queries that require connecting information from multiple documents:
1. Retrieve initial results for the query
2. Use an LLM to reason about the results and derive a follow-up query
3. Retrieve again with the new query
4. Repeat for N hops
5. Combine all retrieved results

IRCoT (Interleaving Retrieval with Chain-of-Thought) is a prominent example: the chain-of-thought reasoning produces new queries at each step. ReAct+Retrieval is another pattern where the LLM decides at each reasoning step whether to retrieve.

### Query Routing

An LLM or classifier examines the query and routes it to the most appropriate retrieval pipeline. For example, a factual question might route to a dense vector pipeline, while a query containing code identifiers might route to a BM25 pipeline, and a complex analytical question might route to a multi-hop pipeline.

This isn't a stage within a pipeline — it decides which pipeline to run.

### Agentic Search

An LLM agent orchestrates the retrieval process dynamically. The agent has access to multiple retrieval tools (different pipelines, web search, database queries) and decides at runtime which to use, whether to iterate, how to combine results, and when to stop. Uses tool-calling/function-calling patterns.

The most flexible approach but also the most unpredictable — behavior varies per query based on the LLM's reasoning. Hardest to evaluate systematically because the retrieval strategy is not predetermined.

### GraphRAG (Microsoft)

Builds a knowledge graph from documents using entity extraction and relationship identification. Community detection algorithms identify clusters of related entities. Each community gets an LLM-generated summary. Retrieval can then operate at the entity level, community level, or global level.

Fundamentally uses a different data structure (graph) rather than a flat chunk index. Best for queries that require understanding relationships between entities, but the graph construction is expensive and the retrieved results (entity descriptions, community summaries) don't map to character positions in source documents.

### Metadata Filtering

Pre-filter the search space by metadata (document type, date, author, source, tags) before running vector or keyword search. Most vector databases support this natively (Chroma's `where` clause, Pinecone's metadata filters, Convex's vector search `filter` parameter).

This is not a retrieval strategy per se, but a scoping mechanism that can dramatically improve precision when the relevant metadata is available. It's a parameter on the search step rather than a separate strategy.

### Maximal Marginal Relevance (MMR)

A post-retrieval technique that balances relevance with diversity. Standard retrieval maximizes relevance, which can return many near-duplicate chunks that all say roughly the same thing. MMR iteratively selects results that are both relevant to the query and dissimilar to already-selected results.

Key parameter: lambda (balance between relevance and diversity, 0 = max diversity, 1 = max relevance). Particularly useful when the top-k results tend to cluster around a single aspect of the query.

### Reranking

Not a retrieval strategy but a critical post-retrieval step. Cross-encoder models (Cohere Rerank, various cross-encoder models from sentence-transformers) re-score the initial retrieval results by jointly encoding the query and each candidate document. This is more accurate than bi-encoder similarity but much slower — which is why it's applied only to the already-narrowed candidate set.

The cost vs. accuracy tradeoff: reranking adds latency and potentially API cost, but significantly improves precision in the final results. OpenClaw's video makes this point clearly: "Why not just start with an LLM for search? Speed and context window limits. The initial search needs to scan thousands of embeddings quickly. Reranking is slower but more accurate. That's fine — you've already offloaded the bulk of the search and you're providing it with a refined set of results to rerank."

---

## The Key Insight: Retrieval as a Pipeline of Stages

After cataloging all these techniques, a pattern emerges: **most retrieval strategies are not fundamentally different systems. They are different combinations of the same building blocks.**

Every retrieval pipeline, regardless of what it's called, performs some subset of the following operations:

1. **Prepare chunks for search** (indexing)
2. **Prepare the query for search** (query transformation)
3. **Score candidates** (the actual search/matching)
4. **Refine the results** (post-search processing)

A "Hybrid Retriever" is not a monolithic thing — it's plain chunking + identity query + (dense scoring + BM25 scoring + score fusion). A "Contextual Hybrid Reranked Retriever" is contextual chunking + identity query + (dense + BM25 + fusion) + reranking. An "HyDE Retriever" is plain chunking + hypothetical document generation + dense scoring.

This decomposition means we don't need to build N separate retriever classes. We need a pipeline with pluggable stages, and the different "named" retrievers are just different configurations of that pipeline.

```
  THE 4-STAGE RETRIEVAL PIPELINE

  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │    INDEX     │   │    QUERY     │   │    SEARCH    │   │  REFINEMENT  │
  │              │   │              │   │              │   │              │
  │  How are     │ → │  How is the  │ → │  How are     │ → │  How are     │
  │  chunks      │   │  query       │   │  candidates  │   │  results     │
  │  prepared    │   │  shaped?     │   │  scored?     │   │  refined?    │
  │  & stored?   │   │              │   │              │   │              │
  ├──────────────┤   ├──────────────┤   ├──────────────┤   ├──────────────┤
  │              │   │              │   │              │   │              │
  │ - plain      │   │ - identity   │   │ - dense vec  │   │ - rerank     │
  │ - contextual │   │ - HyDE       │   │ - BM25       │   │ - threshold  │
  │ - proposition│   │ - multi-query│   │ - hybrid     │   │ - expand ctx │
  │ - summary    │   │ - step-back  │   │   (+ fusion) │   │ - auto-merge │
  │ - parent/    │   │ - decompose  │   │              │   │ - dedup      │
  │   child      │   │              │   │              │   │ - MMR        │
  │ - sentence   │   │              │   │              │   │              │
  │   window     │   │              │   │              │   │              │
  │ - late chunk │   │              │   │              │   │              │
  │ - RAPTOR     │   │              │   │              │   │              │
  │              │   │              │   │              │   │              │
  └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
       runs at             runs at            runs at            runs at
      init() time      retrieve() time    retrieve() time    retrieve() time
```

A "named" retriever is just a path through these four stages:

```
  "Baseline"     =  Plain ──── Identity ──── Dense ──── (none)
  "BM25"         =  Plain ──── Identity ──── BM25  ──── (none)
  "Hybrid"       =  Plain ──── Identity ──── Hybrid ─── (none)
  "OpenClaw"     =  Plain ──── Identity ──── Hybrid ─── Threshold
  "Anthropic"    =  Context ── Identity ──── Hybrid ─── Rerank
  "HyDE"         =  Plain ──── HyDE ──────── Dense ──── (none)
  "Multi-Query"  =  Plain ──── MultiQ ────── Dense ──── Dedup
```

---

## Stage 1: INDEX — How Chunks Are Prepared

The index stage runs during `init(corpus)`. It determines how documents are split, enriched, and made searchable. This is the most diverse stage, with the most distinct strategies:

**Plain Chunking**: The baseline. Split documents by character count with configurable separators, chunk size, and overlap. Each chunk tracks its character position in the source document.
- Parameters: chunkSize, chunkOverlap, separators

**Contextual Chunking**: Plain chunking followed by LLM enrichment. For each chunk, the LLM generates a situating context that is prepended to the chunk text before embedding. The chunk's stored text and positions remain unchanged; only the embedding input is modified.
- Parameters: chunkSize, chunkOverlap, llm, contextPrompt, concurrency

**Proposition-Based Indexing**: Instead of splitting by character count, an LLM decomposes each document into atomic factual propositions. Each proposition is indexed independently. Requires mapping each proposition back to its source span in the original document.
- Parameters: llm, extractionPrompt, batchSize

**Summary Indexing**: Each chunk gets an LLM-generated summary. Both the summary embedding and the original chunk are stored. Search runs against summary embeddings; the original chunk (with positions) is returned.
- Parameters: chunkSize, chunkOverlap, llm, summaryPrompt

**Parent-Child Chunking**: Documents are chunked at two granularities — small "child" chunks for precise matching and larger "parent" chunks for context. Children store a reference to their parent. At search time, children are matched; at return time, parents can be returned instead.
- Parameters: childChunkSize, parentChunkSize, childOverlap, parentOverlap

**Sentence Window Chunking**: Individual sentences are the indexing unit. Each sentence stores metadata about its surrounding window (N sentences before and after). At search time, sentences are matched; at return time, the full window is returned.
- Parameters: windowSize (number of surrounding sentences)

**Late Chunking**: The full document is embedded using a long-context model, then split into chunks. Each chunk's embedding already contains full-document context. Requires a model that can handle long documents.
- Parameters: chunkSize, chunkOverlap, longContextEmbedder

**RAPTOR Tree Construction**: Build a hierarchical tree through recursive clustering and summarization. Leaf nodes are original chunks. Higher levels are summaries of clusters. The tree can be searched at any level.
- Parameters: chunkSize, clusteringAlgorithm, clusteringParams, llm, summaryPrompt, maxTreeDepth

```
  INDEX STRATEGIES COMPARISON

  Document: "The Eiffel Tower, built in 1889, is in Paris, France..."

  Plain Chunking:
    ┌─────────────────────┐ ┌─────────────────────┐
    │ "The Eiffel Tower,  │ │ "France. It stands  │
    │  built in 1889, is  │ │  at 330 meters..."  │
    │  in Paris,..."      │ │                     │
    └─────────────────────┘ └─────────────────────┘

  Contextual Chunking:
    ┌─────────────────────┐ ┌─────────────────────┐
    │ [Context: This is   │ │ [Context: This      │
    │  from a travel guide│ │  continues the      │
    │  about landmarks]   │ │  Eiffel Tower       │
    │ "The Eiffel Tower,  │ │  description]       │
    │  built in 1889..."  │ │ "France. It stands  │
    └─────────────────────┘ │  at 330 meters..."  │
    (context added before   └─────────────────────┘
     embedding, not stored)

  Proposition Indexing:
    ┌─────────────────────┐ ┌─────────────────────┐
    │ "The Eiffel Tower   │ │ "The Eiffel Tower   │
    │  was built in 1889" │ │  is located in      │
    └─────────────────────┘ │  Paris, France"     │
    ┌─────────────────────┐ └─────────────────────┘
    │ "The Eiffel Tower   │
    │  stands at 330m"    │  (atomic facts, each
    └─────────────────────┘   maps to source span)

  Parent-Child Chunking:
    ┌─────────────────────────────────────────────┐
    │ Parent: "The Eiffel Tower, built in 1889,   │
    │  is in Paris, France. It stands at 330m..." │
    │  ┌──────────────┐ ┌──────────────┐          │
    │  │ Child: "The  │ │ Child: "It   │          │
    │  │ Eiffel Tower │ │ stands at    │          │
    │  │ built..."    │ │ 330 meters"  │          │
    │  └──────────────┘ └──────────────┘          │
    └─────────────────────────────────────────────┘
    (search children, return parent)
```

---

## Stage 2: QUERY — How the Query Is Shaped

The query stage runs at the start of each `retrieve(query, k)` call. It transforms the raw query into one or more search inputs:

**Identity**: Pass the query through unchanged. The simplest and most common approach. No parameters.

**HyDE (Hypothetical Document Embeddings)**: Generate a hypothetical answer document using an LLM, then use that as the search input instead of the original query.
- Parameters: llm, hydePrompt, numHypotheticalDocs

**Multi-Query**: Generate N query variants using an LLM. Each variant is used for a separate search, and results are fused.
- Parameters: llm, numQueries, generationPrompt

**Step-Back Prompting**: Generate a more abstract version of the query using an LLM. Optionally search for both the abstract and original query.
- Parameters: llm, stepBackPrompt, includeOriginal

**Query Decomposition**: Break a complex query into simpler sub-queries using an LLM. Retrieve for each sub-query and combine results.
- Parameters: llm, decompositionPrompt, maxSubQueries

Note: Multi-query, step-back, and query decomposition all produce multiple search inputs, which means the search stage must handle multiple queries and fuse results. This is a natural extension — the search stage already handles fusion for hybrid (dense + sparse), so fusing across multiple queries uses the same machinery.

```
  QUERY STRATEGIES: Single vs. Multiple Search Inputs

  Identity:
    "How does React handle state?"  ──────────────────▶  1 search input

  HyDE:
    "How does React handle state?"  ──LLM──▶  hypothetical answer  ──▶  1 search input

  Multi-Query:
    "How does React handle state?"  ──LLM──▶  "React state management"     ──┐
                                              "useState hook tutorial"       ├▶ N inputs
                                              "React component state"       ──┘
                                                                               │
                                                                          each searched
                                                                          separately,
                                                                          results fused

  Query Decomposition:
    "Compare auth in Express        ──LLM──▶  "Express authentication"     ──┐
     vs. FastAPI"                              "FastAPI authentication"      ──┘
                                                                               │
                                                                          results combined
```

---

## Stage 3: SEARCH — How Candidates Are Scored

The search stage performs the actual matching between query and indexed content:

**Dense Vector Search**: Embed the query, find nearest neighbors by vector similarity (cosine, dot product, L2). The standard approach.
- Parameters: embedder, vectorStore, distanceMetric

**BM25 (Sparse Search)**: Score documents by keyword overlap using the BM25 algorithm. Term frequency, inverse document frequency, and length normalization.
- Parameters: k1, b, tokenizer, stopWords

**Hybrid Search**: Run both dense and sparse searches in parallel, then fuse results. Two fusion approaches: weighted score fusion (explicitly control dense vs. sparse weight) or reciprocal rank fusion (position-based, simpler).
- Parameters: denseConfig, sparseConfig, fusionMethod (weighted | rrf), weights (for weighted), rrfK (for RRF)

**Metadata-Filtered Search**: Apply metadata filters before or alongside the scoring step. Filter by document type, date range, source, tags, or any other metadata field. This is a parameter on any of the above search strategies rather than a standalone strategy.
- Parameters: metadataFilters (on any search strategy)

All search strategies share a common parameter: **candidateMultiplier** — how many raw candidates to fetch relative to the desired k. A multiplier of 4 (as used by OpenClaw) means fetching 4x candidates before fusion and refinement, giving downstream stages more to work with.

```
  SEARCH STRATEGIES

  Dense Vector:
    query ──embed──▶ [0.12, -0.34, ...] ──cosine sim──▶ ranked chunks

  BM25:
    query ──tokenize──▶ ["react", "state"] ──term freq──▶ ranked chunks

  Hybrid (Dense + Sparse + Fusion):

    query ──┬── embed ──▶ Dense Search ──▶ 24 candidates ──┐
            │                                                │
            └── tokenize ──▶ BM25 Search ──▶ 24 candidates ─┤
                                                             │
                                                        ┌────▼─────┐
                                                        │  FUSION  │
                                                        │          │
                                                        │ weighted │
                                                        │   or     │
                                                        │  RRF     │
                                                        └────┬─────┘
                                                             │
                                                        6 final results
                                                       (candidateMultiplier
                                                        = 4x = 24 cands
                                                        for 6 results)
```

---

## Stage 4: REFINEMENT — How Results Are Refined

The refinement stage is an ordered array of post-search processing steps. Multiple refinement steps can be chained:

**Reranking**: Re-score results using a cross-encoder model or dedicated reranking API (Cohere, cross-encoder from sentence-transformers). More accurate than bi-encoder similarity but slower.
- Parameters: reranker (model/API), topK

**Threshold Filtering**: Drop results below a minimum relevance score. OpenClaw uses 0.35 as a threshold after fusion.
- Parameters: minScore

**Context Expansion**: For retrievers using small indexing units (sentences, propositions), expand the returned context to include surrounding text. This is the "get" step in OpenClaw's two-step memory_search/memory_get pattern.
- Parameters: expansionWindow (characters or sentences)

**Auto-Merge**: If enough chunks from the same parent document region are retrieved, merge them into a single larger chunk. LlamaIndex's auto-merging uses a ratio threshold (e.g., if 3 of 5 children are retrieved, return the parent).
- Parameters: mergeThreshold (ratio of children that must be retrieved)

**Deduplication**: Remove near-duplicate chunks from results. Can be exact (content hash) or fuzzy (embedding similarity above a threshold).
- Parameters: similarityThreshold, method (exact | fuzzy)

**Maximal Marginal Relevance (MMR)**: Iteratively select results that balance relevance with diversity. Reduces redundancy in the result set.
- Parameters: lambda (relevance vs. diversity balance), topK

```
  REFINEMENT: An Ordered Chain of Steps

  Raw search results (e.g., 24 candidates)
       │
       ▼
  ┌──────────────────┐
  │ 1. Rerank        │  Cross-encoder re-scores each result
  │    (Cohere API)  │  against the query for higher precision
  └────────┬─────────┘
           ▼
  ┌──────────────────┐
  │ 2. Threshold     │  Drop anything below 0.35 relevance
  │    (min: 0.35)   │
  └────────┬─────────┘
           ▼
  ┌──────────────────┐
  │ 3. Dedup         │  Remove near-duplicate chunks
  │    (fuzzy match) │
  └────────┬─────────┘
           ▼
  ┌──────────────────┐
  │ 4. MMR           │  Balance relevance with diversity
  │    (lambda: 0.7) │  among final results
  └────────┬─────────┘
           ▼
  Final results (top k)

  Not all steps are needed — pick and chain
  only the refinements that make sense.
```

---

## Named Retrievers as Pipeline Configurations

The power of the pipeline model is that well-known retriever strategies become named configurations:

| Name | Index | Query | Search | Refinement |
|------|-------|-------|--------|------------|
| Baseline Vector RAG | Plain chunking | Identity | Dense vector | (none) |
| BM25 | Plain chunking | Identity | BM25 | (none) |
| Hybrid | Plain chunking | Identity | Hybrid (dense + BM25 + weighted fusion) | (none) |
| Hybrid + Reranked | Plain chunking | Identity | Hybrid | Reranker |
| OpenClaw-style | Plain (400 tok, 80 overlap) | Identity | Hybrid (0.7/0.3, 4x candidates) | Threshold (0.35) |
| Anthropic Best | Contextual chunking | Identity | Hybrid | Reranker |
| HyDE | Plain chunking | HyDE | Dense vector | (none) |
| HyDE + Hybrid | Plain chunking | HyDE | Hybrid | Reranker |
| Multi-Query | Plain chunking | Multi-query (5 variants) | Dense vector | Dedup |
| Multi-Query Hybrid | Plain chunking | Multi-query | Hybrid | Dedup, Reranker |
| Proposition-Based | Proposition indexing | Identity | Dense vector | Reranker |
| Parent Document | Parent-child chunking | Identity | Dense vector (children) | Auto-merge, Context expansion |
| Sentence Window | Sentence window | Identity | Dense vector | Context expansion |
| Contextual + Multi-Query | Contextual chunking | Multi-query | Hybrid | Dedup, Reranker |
| Diverse Hybrid | Plain chunking | Identity | Hybrid | MMR (lambda=0.5) |

Each row is a configuration, not a separate implementation. The pipeline machinery is shared. This means hundreds of valid experiment configurations from a small number of building blocks.

---

## Where the Pipeline Breaks: The Control Flow Problem

The 4-stage pipeline is linear and predetermined: stages execute once, in order, with config fixed before execution. This model cannot express retrieval strategies that involve:

**Loops / Iteration**: CRAG retrieves, then an LLM grades the results, and if they're poor, rewrites the query and retrieves again. The number of iterations is determined at runtime. The pipeline model has no concept of "go back to stage 3".

**Conditional Retrieval**: Self-RAG decides whether to retrieve at all based on the query. If retrieval is unnecessary, it skips entirely. The pipeline always runs all stages.

**Interleaved Retrieval + Generation**: FLARE generates text sentence-by-sentence and triggers retrieval only when the LLM's confidence drops. Retrieval is interspersed with generation, not a separate phase.

**Dynamic Strategy Selection**: Agentic search doesn't commit to a strategy upfront. An LLM agent decides at runtime which retrieval tool to use, potentially trying multiple approaches and combining their results.

**Multi-Hop Reasoning**: Iterative retrieval derives new queries from the results of previous retrievals. The query for retrieval round 2 depends on what was found in round 1.

**Alternative Data Structures**: GraphRAG operates on a knowledge graph, not a flat chunk index. The entire search paradigm is different.

These are not exotic edge cases — they represent some of the most important and effective retrieval strategies. We cannot force them into the linear pipeline model without losing what makes them valuable.

The insight: these strategies don't need more pipeline stages. They need a **different kind of control flow**. They are orchestrators that coordinate one or more pipeline retrievals with decision-making logic between them.

```
  LINEAR PIPELINE (predetermined, runs once):

    INDEX ──▶ QUERY ──▶ SEARCH ──▶ REFINEMENT ──▶ Results

    Config is fixed. Each stage runs once, in order.


  LOOPING / CORRECTIVE (CRAG):

    ┌───────────────────────────────────────────────┐
    │                                               │
    │  QUERY ──▶ SEARCH ──▶ LLM grades ──┬── good ──▶ Results
    │                          │          │
    │                          │       bad / ambiguous
    │                          │          │
    │                          └── rewrite query
    │                                     │
    └─────────────────────────────────────┘

    Number of loops determined at runtime.


  DYNAMIC ROUTING (Agentic):

                    ┌── Pipeline A (BM25)
    Query ──▶ LLM ─┼── Pipeline B (Hybrid)     ──▶ Results
              decides ├── Pipeline C (Multi-Query)
                    └── combine & retry?

    The LLM decides which pipeline(s) to run.


  INTERLEAVED (Self-RAG, FLARE):

    Generate ──▶ confidence check ──┬── high ──▶ continue generating
                                    │
                                    └── low ──▶ retrieve ──▶ regenerate
                                                    │
                                                    └──▶ continue

    Retrieval is woven into generation, not a separate phase.
```

---

## Layer 2: Orchestrated Retrievers

Orchestrated retrievers wrap one or more pipeline retrievers with control logic. They implement the same Retriever interface but internally use pipelines as building blocks:

### Corrective Retriever (CRAG)

Wraps a pipeline retriever with a grading loop:
1. Call `pipeline.retrieve(query, k)` to get initial results
2. Pass results to an LLM for relevance grading
3. If grade is "correct": return results
4. If grade is "incorrect": use LLM to rewrite the query, call `pipeline.retrieve(newQuery, k)`, go to step 2
5. Repeat up to maxIterations

Parameters: pipeline (a PipelineRetriever config), llm, maxIterations, relevanceThreshold, rewritePrompt

The pipeline handles the mechanics of retrieval. The corrective retriever handles the decision logic. This is a clean separation of concerns.

```
  CORRECTIVE RETRIEVER (CRAG)

  query ──▶ pipeline.retrieve(query, k)
                 │
                 ▼
            ┌─────────────────┐
            │   LLM grades    │
            │   relevance     │
            └────┬────┬───────┘
                 │    │
           correct  incorrect
                 │    │
                 │    ▼
                 │  LLM rewrites query
                 │    │
                 │    ▼
                 │  pipeline.retrieve(newQuery, k)
                 │    │
                 │    ▼
                 │  LLM grades again...
                 │    │
                 │  (repeat up to maxIterations)
                 │    │
                 ▼    ▼
              Return results
```

### Router Retriever

Routes queries to different pipelines based on query classification:
1. Classify the query (using an LLM, keyword rules, or a trained classifier)
2. Based on the classification, route to one of N configured pipelines
3. Return that pipeline's results

Parameters: routes (array of { classifier, pipeline } pairs), defaultPipeline, llm (if using LLM-based routing)

Example routes: "contains code identifiers" → BM25 pipeline, "factual question" → dense vector pipeline, "complex analytical" → multi-query hybrid pipeline.

```
  ROUTER RETRIEVER

                          ┌────────────────────────┐
                          │   Pipeline A: BM25      │
  query ──▶ classify ──┬──▶  (for code/identifiers) │──▶ results
                       │  └────────────────────────┘
                       │  ┌────────────────────────┐
                       ├──▶  Pipeline B: Hybrid     │──▶ results
                       │  │  (for factual queries)  │
                       │  └────────────────────────┘
                       │  ┌────────────────────────┐
                       └──▶  Pipeline C: Multi-Q    │──▶ results
                          │  (for complex queries)  │
                          └────────────────────────┘
```

### Iterative Retriever (Multi-Hop)

Performs multiple rounds of retrieval with reasoning between rounds:
1. Call `pipeline.retrieve(query, k)` for initial results
2. Pass results + query to LLM for reasoning
3. LLM derives a follow-up query based on what's been found so far
4. Call `pipeline.retrieve(followUpQuery, k)` for additional results
5. Repeat for N hops
6. Combine all retrieved results (dedup, re-rank)

Parameters: pipeline, llm, maxHops, reasoningPrompt, combinationStrategy

```
  ITERATIVE RETRIEVER (Multi-Hop)

  query: "What year was the founder of OpenAI born?"

  Hop 1: retrieve("founder of OpenAI")
         ──▶ results: "OpenAI was founded by Sam Altman..."
                │
                ▼
         LLM reasons: "Sam Altman is the founder. Now I need his birth year."

  Hop 2: retrieve("Sam Altman birth year")
         ──▶ results: "Sam Altman was born in 1985..."
                │
                ▼
         Combine all results from both hops
         ──▶ return merged results
```

### Agentic Retriever

An LLM agent with tool access to multiple pipeline retrievers. The agent decides at runtime which tools to use, how to combine results, and when to stop:

Parameters: llm, availableTools (array of pipeline retrievers), maxSteps, systemPrompt

This is the most flexible but least predictable retriever. The agent's behavior varies per query based on the LLM's reasoning. Useful as an upper-bound experiment ("how well can retrieval do with unlimited LLM reasoning?") but hard to reproduce exactly.

---

## Layer 3: Custom Retrievers

For retrieval strategies that don't fit either the pipeline model or the orchestrator pattern, the escape hatch is direct implementation of the Retriever interface. Any class that implements `init(corpus)`, `retrieve(query, k)`, and `cleanup()` and returns `PositionAwareChunk[]` can participate in the evaluation system.

Candidates for custom implementation:

**GraphRAGRetriever**: Builds a knowledge graph during `init()`, performs graph traversal during `retrieve()`. The graph structure, community detection, entity extraction, and traversal algorithm are all specific to this approach and don't map to pipeline stages.

**Self-RAGRetriever**: Deeply interleaves retrieval with generation using reflection tokens. The retrieval decisions (should I retrieve? is this relevant? does this support my output?) are part of the generation loop, not a standalone retrieval pipeline.

**FLARERetriever**: Triggers retrieval based on generation confidence. Like Self-RAG, the retrieval is reactive and interleaved with generation. The "when to retrieve" decision depends on token-level probabilities during generation.

**RAPTORRetriever**: While RAPTOR's tree construction could fit in the INDEX stage, its tree-traversal retrieval strategy (descend from root through relevant branches) doesn't fit the SEARCH stage model, which assumes flat collection search. A custom implementation would build the tree in `init()` and traverse it in `retrieve()`.

**Any future novel approach**: The custom retriever path ensures the system is extensible without architectural changes. If someone invents a new retrieval paradigm tomorrow, it just needs to satisfy the Retriever interface.

---

## The Three-Layer Architecture

The complete architecture has three layers, all sharing the same Retriever interface and evaluation pipeline:

**Layer 1: Pipeline Retrievers** — Linear, composable, 4-stage pipelines. Cover approximately 80% of known retrieval techniques. Stages: INDEX, QUERY, SEARCH, REFINEMENT. Each stage has multiple strategy implementations. Named presets provide shorthand for common configurations.

**Layer 2: Orchestrated Retrievers** — Wrap pipeline retrievers with control logic (loops, routing, multi-hop). Cover techniques that require dynamic decision-making: CRAG (corrective loops), query routing, iterative/multi-hop retrieval, and agentic search. Use pipeline retrievers as building blocks.

**Layer 3: Custom Retrievers** — Direct implementation of the Retriever interface. Cover techniques that don't fit either model: GraphRAG, Self-RAG, FLARE, RAPTOR, and anything we can't predict today. Full freedom, no constraints beyond the interface.

```
  THE THREE-LAYER ARCHITECTURE

  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  LAYER 1: PIPELINE RETRIEVERS            ~80% of techniques        │
  │  ══════════════════════════════                                     │
  │  Linear, composable, 4-stage pipelines                             │
  │                                                                     │
  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌──────────┐          │
  │  │  INDEX  │ → │  QUERY  │ → │ SEARCH  │ → │ REFINE   │ → chunks │
  │  └─────────┘   └─────────┘   └─────────┘   └──────────┘          │
  │                                                                     │
  │  Covers: baseline, BM25, hybrid, HyDE, multi-query, contextual,   │
  │          parent-child, sentence window, proposition-based, ...      │
  │                                                                     │
  ├─────────────────────────────────────────────────────────────────────┤
  │                                                                     │
  │  LAYER 2: ORCHESTRATED RETRIEVERS        ~15% of techniques        │
  │  ════════════════════════════════                                   │
  │  Wrap pipeline(s) with control logic                               │
  │                                                                     │
  │  ┌──────────────────────┐  ┌──────────────┐  ┌──────────────────┐ │
  │  │ Corrective (CRAG)   │  │    Router    │  │   Iterative     │ │
  │  │  pipeline ──▶ grade  │  │ classify ──▶ │  │ retrieve ──▶    │ │
  │  │  ──▶ rewrite? loop  │  │ pick pipeline│  │ reason ──▶      │ │
  │  └──────────────────────┘  └──────────────┘  │ retrieve again  │ │
  │  ┌──────────────────────┐                    └──────────────────┘ │
  │  │ Agentic              │                                         │
  │  │ LLM agent ──▶ tools  │  Uses Layer 1 pipelines as building    │
  │  │ ──▶ decide ──▶ act   │  blocks internally.                    │
  │  └──────────────────────┘                                         │
  │                                                                     │
  ├─────────────────────────────────────────────────────────────────────┤
  │                                                                     │
  │  LAYER 3: CUSTOM RETRIEVERS              ~5% of techniques         │
  │  ══════════════════════════                                        │
  │  Direct Retriever interface implementation                         │
  │                                                                     │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
  │  │  GraphRAG    │  │  Self-RAG    │  │   FLARE      │            │
  │  └──────────────┘  └──────────────┘  └──────────────┘            │
  │  ┌──────────────┐  ┌──────────────┐                               │
  │  │   RAPTOR     │  │  ??? future  │  Full freedom. Any approach  │
  │  └──────────────┘  └──────────────┘  that satisfies the interface.│
  │                                                                     │
  ├═════════════════════════════════════════════════════════════════════┤
  │                                                                     │
  │  ALL THREE LAYERS:                                                 │
  │    - Implement the same Retriever interface                        │
  │    - Return PositionAwareChunk[]                                   │
  │    - Evaluated by the same metrics (recall, precision, IoU, F1)    │
  │    - Tracked in the same LangSmith experiments                     │
  │    - Directly comparable against each other                        │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

The beauty of this layered approach:
- Layer 2 orchestrators consume Layer 1 pipelines, so you get the composability benefit of pipelines plus the flexibility of dynamic control
- All three layers produce the same output type (PositionAwareChunk[]), so all three are evaluated by the same metrics (recall, precision, IoU, F1)
- All three are tracked in the same LangSmith experiments, so results are directly comparable
- The evaluation system doesn't need to know which layer a retriever came from

---

## The Position-Awareness Constraint

Every retriever in this system must return `PositionAwareChunk[]` — chunks with `docId`, `start`, and `end` character positions in the source document. This is a fundamental requirement of the span-based evaluation system, which computes character-level overlap between retrieved spans and ground truth spans.

This constraint acts as a natural filter on which techniques are fully compatible:

```
  POSITION-AWARENESS COMPATIBILITY TIERS

  ┌──────────────────────────────────────────────────────────────┐
  │  FULLY COMPATIBLE  (positions preserved naturally)           │
  │  ═══════════════                                             │
  │  Plain chunking, BM25, Dense, Hybrid, HyDE, Multi-Query,    │
  │  Contextual retrieval, Reranking, Threshold, MMR,            │
  │  Parent-child, Sentence window                               │
  │                                                              │
  │  Chunk in ──▶ same PositionAwareChunk out                    │
  │  (docId, start, end unchanged through pipeline)              │
  ├──────────────────────────────────────────────────────────────┤
  │  COMPATIBLE WITH MAPPING  (positions recoverable)            │
  │  ═════════════════════                                       │
  │  Proposition indexing, Summary indexing, Auto-merge,          │
  │  Context expansion                                           │
  │                                                              │
  │  source text ──LLM──▶ proposition ──map back──▶ source span  │
  │  search summaries ──▶ return original chunks (with positions)│
  ├──────────────────────────────────────────────────────────────┤
  │  PARTIALLY COMPATIBLE  (only leaf nodes have positions)      │
  │  ══════════════════                                          │
  │  RAPTOR, GraphRAG                                            │
  │                                                              │
  │       [Summary]  ← no position                               │
  │        /     \                                               │
  │   [Leaf A] [Leaf B]  ← have positions ✓                     │
  │                                                              │
  │  Evaluate only the leaf-level retrieval component            │
  ├──────────────────────────────────────────────────────────────┤
  │  INCOMPATIBLE  (content outside corpus)                      │
  │  ════════════                                                │
  │  Web search fallback, external source retrieval              │
  │                                                              │
  │  External content has no docId/start/end in our corpus.      │
  │  Must be excluded from span-based metrics.                   │
  └──────────────────────────────────────────────────────────────┘
```

**Fully compatible (positions preserved naturally)**:
- All plain chunking variants (positions are inherent)
- BM25, dense vector, hybrid (different scoring, same chunks)
- HyDE, multi-query, step-back (different queries, same chunks)
- Contextual retrieval (enriches embeddings, positions unchanged)
- Reranking, threshold filtering, MMR (reorder/filter, positions unchanged)
- Parent-child and sentence window (parent span = union of child spans)

**Compatible with position mapping**:
- Proposition-based indexing (each proposition maps back to a source span)
- Summary-indexed (search against summaries, return original chunks with positions)
- Auto-merge (merged chunk span = min(start) to max(end) of merged children)
- Context expansion (expanded chunk has wider span)

**Partially compatible (only leaf nodes have positions)**:
- RAPTOR (summary nodes don't have source positions, but leaf nodes do)
- GraphRAG (entity summaries don't have positions, but can link back to source chunks)

**Incompatible (external content has no positions)**:
- Web search fallback (part of CRAG's incorrect-grade path)
- Any retrieval from sources outside the evaluation corpus

For partially compatible techniques, the evaluation can focus on the leaf-level or source-linked retrieval component and measure how well it surfaces the right content.

---

## Lessons from Real-World Systems

```
  KEY LESSONS FROM PRODUCTION SYSTEMS

  ┌─────────────────┬────────────────────────────┬──────────────────────┐
  │     Source       │     Key Insight            │  Actionable Takeaway │
  ├─────────────────┼────────────────────────────┼──────────────────────┤
  │  OpenClaw       │  2-step search + get       │  Keep context lean   │
  │                 │  4x candidate multiplier   │  Over-fetch, then    │
  │                 │  0.7/0.3 weighted fusion   │  fuse & filter       │
  │                 │  0.35 score threshold      │                      │
  ├─────────────────┼────────────────────────────┼──────────────────────┤
  │  Anthropic      │  Contextual enrichment at  │  Modify INDEX, not   │
  │                 │  index time = 30-40% gain  │  QUERY or SEARCH     │
  │                 │  Hybrid + rerank = best    │  Layer defenses       │
  │                 │  Prompt caching for cost   │  against failure modes│
  ├─────────────────┼────────────────────────────┼──────────────────────┤
  │  ChromaDB       │  Domain-specific bench-    │  Don't trust generic │
  │                 │  marks > generic ones       │  leaderboards. Test  │
  │                 │  Distance distributions    │  on YOUR data.       │
  │                 │  beat fixed thresholds     │                      │
  ├─────────────────┼────────────────────────────┼──────────────────────┤
  │  Claude Code    │  Keyword search can beat   │  Don't assume dense  │
  │  (CloudCode)    │  vector for some domains   │  is always better.   │
  │                 │  Simplicity has value      │  Measure everything. │
  └─────────────────┴────────────────────────────┴──────────────────────┘
```

### From OpenClaw
- **The two-step pattern (search then get)** keeps context windows lean. Search returns just enough to judge relevance, then you fetch full content only for what's needed.
- **Weighted fusion (0.7 dense / 0.3 keyword)** is a practical default that many systems converge on.
- **The candidate multiplier (4x)** is an underappreciated parameter. Fetching more candidates before fusion significantly improves final result quality at minimal cost.
- **Incremental sync with content hashing** and **embedding caching** are critical cost optimizations for real deployments. Embedding API calls add up quickly.
- **Score thresholds (0.35)** prevent low-quality results from polluting the output. Better to return fewer, more relevant results than to pad with noise.

### From Anthropic's Contextual Retrieval
- **Indexing-time enrichment** (adding context before embedding) is one of the highest-impact, lowest-friction improvements available. 30-40% fewer retrieval failures with a conceptually simple change.
- **Prompt caching** makes the LLM cost of contextual enrichment manageable. Processing chunks document-by-document maximizes cache hits.
- **Hybrid (dense + BM25) + reranking** is the strongest general-purpose combination. Each component addresses a different failure mode: dense handles semantics, BM25 handles exact matches, reranking handles precision.

### From ChromaDB
- **Domain-specific benchmarks** matter more than generic benchmarks. Embedding models that score well on MTEB may not score well on your actual data.
- **Distance-distribution-based relevance** eliminates the threshold tuning problem. Instead of picking a magic number, use the statistical distribution of distances in your dataset.
- **The embedding model choice** is one of the most impactful variables. Different models have very different strengths, and the only way to know which is best for your data is to test.

### From the Claude Code Team
- **Sometimes keyword search wins**. The CloudCode team started with vectors and found grep + agentic search worked better for their specific use case (code files, technical identifiers). Don't assume dense retrieval is always superior.
- **Simplicity has value**. A system you can understand and debug beats a complex system that sometimes works better on benchmarks.

---

## Experiment Combinatorics

The pipeline model enables a combinatorial explosion of experiments from a small number of building blocks:

With the strategies described above:
- 8 index strategies
- 5 query strategies
- 3 search strategies (with variants)
- 6 refinement stages (combinable)

```
  COMBINATORIAL EXPLOSION FROM BUILDING BLOCKS

  INDEX (8)        QUERY (5)       SEARCH (3)      REFINEMENT (6)
  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ plain    │    │ identity │    │ dense    │    │ rerank   │
  │ context  │    │ HyDE     │    │ BM25     │    │ threshold│
  │ proposit.│ ×  │ multi-q  │ ×  │ hybrid   │ ×  │ expand   │
  │ summary  │    │ step-back│    │ (+ fusion│    │ merge    │
  │ parent/  │    │ decompose│    │  config) │    │ dedup    │
  │   child  │    └──────────┘    └──────────┘    │ MMR      │
  │ sentence │                                     └──────────┘
  │ late     │         5               3+           chain of
  │ RAPTOR   │                                     0-6 steps
  └──────────┘
       8

  Naive: 8 × 5 × 3 = 120 base configs (before refinement chains)
  Real:  ~200-300 interesting, valid combinations

  + Layer 2: Each orchestrator wraps ANY pipeline config
    CRAG(hybrid), CRAG(contextual+hybrid), Router(BM25|hybrid), ...

  + Layer 3: Custom retrievers (GraphRAG, Self-RAG, FLARE, RAPTOR)

  = Thousands of possible experiments, managed through named presets
```

Not all combinations are valid or interesting, but the valid combinations easily number in the hundreds. Add the orchestrated retrievers (each wrapping any pipeline configuration) and custom retrievers, and the space is enormous.

The key to managing this space is the named preset system. Rather than requiring users to specify every stage configuration, presets capture well-known combinations:
- "baseline" — the simplest dense vector pipeline
- "hybrid" — the most common improvement over baseline
- "anthropic-best" — Anthropic's top-performing configuration
- "openclaw" — OpenClaw's production-tested configuration

Users can start with presets and customize individual stages as needed. The experiment system tracks the full configuration for each experiment, enabling precise comparison and reproduction.

---

## Open Questions and Future Directions

```
  OPEN QUESTIONS: IMPACT vs. COMPLEXITY

                        High Impact
                            │
    Cost & Latency          │         Embedding Model
    Tracking                │         as a Variable
            ●               │               ●
                            │
                            │
    Chunk Size              │         Generation-Retrieval
    Sweeps        ●         │         Boundary
                            │                    ●
  Low ──────────────────────┼──────────────────────── High
  Complexity                │                     Complexity
                            │
    BM25 in Convex          │         DSPy-Style
              ●             │         Optimization
                            │                  ●
                            │
    Named Presets           │         Retriever Composition
    Library        ●        │         Depth
                            │                ●
                            │
                        Low Impact

  ● = open question / future direction
  Top-left quadrant = quick wins (do first)
  Top-right quadrant = high-value investments
  Bottom = explore later
```

### BM25 in Different Environments
BM25 needs a tokenizer and an inverted index. In a Node.js environment, libraries like minisearch provide this. In SQLite-based systems, FTS5 provides it natively. In Convex (our backend), we'd need either a JavaScript BM25 implementation running in Node actions or a different approach. The choice of BM25 implementation affects portability and performance.

### Cost Tracking
Many advanced retrieval strategies involve LLM calls (contextual enrichment, HyDE, multi-query, CRAG grading, reranking). The experiment system should track token usage and cost alongside retrieval metrics. This enables cost-effectiveness comparisons: "Contextual hybrid costs $X per 1000 queries and achieves Y recall, while plain hybrid costs $Z per 1000 queries and achieves W recall."

### Latency Tracking
Similarly, different strategies have dramatically different latency profiles. BM25 is near-instant. Dense vector search depends on index size. HyDE adds an LLM call. CRAG might add multiple LLM calls. Agentic search might take seconds. Tracking retrieval latency alongside quality metrics gives a fuller picture.

### The Generation-Retrieval Boundary
Self-RAG, FLARE, and agentic approaches blur the line between retrieval and generation. Our current evaluation focuses purely on retrieval quality (what chunks were returned?), not on end-to-end answer quality. Adding generation-aware metrics (faithfulness, answer relevance) would enable evaluating techniques where retrieval and generation are interleaved.

### Embedding Model as a Variable
Most of the above discussion assumes a fixed embedding model. But the embedding model choice is one of the most impactful variables (as ChromaDB's generative benchmarking work demonstrates). The pipeline architecture naturally supports this — the embedding model is a parameter on the SEARCH stage — but the experiment runner should make it easy to sweep across embedding models, not just retrieval strategies.

### Chunk Size as a Variable
Similarly, chunk size is often treated as fixed, but it's one of the most impactful parameters. The INDEX stage makes this explicit and tunable. Experiments should sweep across chunk sizes in combination with other parameters.

### Retriever Composition Depth
The current architecture supports one level of composition: orchestrators wrap pipelines. But you could imagine deeper nesting: an agentic retriever whose tools include a corrective retriever that wraps a contextual hybrid pipeline. Whether this depth is useful in practice or just adds complexity remains to be seen. The architecture supports it (orchestrators consume any Retriever), but it should be approached with caution.

### DSPy-Style Optimization
DSPy is not a retriever but a framework that optimizes retriever parameters (prompts, few-shot examples, hyperparameters) via automated search. Integrating DSPy-style optimization with our pipeline architecture could enable automatic discovery of the best pipeline configuration for a given dataset. This is a meta-level concern — it operates on the experiment system rather than within it — but it's a natural extension of the composable pipeline approach.
