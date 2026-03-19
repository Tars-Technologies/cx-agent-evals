# Slice 4 — Index Stage Strategies

> Expands the INDEX stage of the pipeline retriever with 3 new strategies (contextual, summary, parent-child), multiplying the experiment grid by ~4x index configurations. Converts `IndexConfig` from a flat interface to a discriminated union.

---

## Architecture Overview

The INDEX stage runs during `init()` — it determines how documents are chunked, enriched, and stored before any queries arrive.

```
                     PipelineRetriever.init(corpus)
                                |
                    switch (_indexConfig.strategy)
                                |
         +----------+-----------+-----------+----------+
         |          |           |                      |
      "plain"   "contextual" "summary"           "parent-child"
         |          |           |                      |
         v          v           v                      v
   chunk docs   chunk docs   chunk docs          chunk docs at
   as-is        + LLM ctx    + LLM summary       TWO granularities
         |          |           |                      |
         v          v           v                      v
   [chunks]    [enriched    [summary            [child chunks] + parentMap
                chunks]      chunks]
         |          |           |                      |
         +----------+-----------+----------+-----------+
                                |
                    searchStrategy.init(chunks)
                     (embed + store in vector DB)
```

---

## The Four Strategies

### 1. Plain (pre-existing)

```
Config: { strategy: "plain", chunkSize?, chunkOverlap?, separators?, embeddingModel? }

  Document --> chunker.chunkWithPositions(doc) --> chunks --> embed & store

  No enrichment. Fast baseline. No LLM required.
```

### 2. Contextual (new)

```
Config: { strategy: "contextual", chunkSize?, chunkOverlap?, embeddingModel?,
          contextPrompt?, concurrency? }

  Document --> chunker.chunkWithPositions(doc) --> raw chunks
                                                      |
                                                      v
            +-------- for each chunk (parallel, concurrency=5): --------+
            |                                                           |
            |  prompt = contextPrompt                                   |
            |    .replace("{doc.content}", fullDocText)                  |
            |    .replace("{chunk.content}", chunkText)                  |
            |                                                           |
            |  context = LLM.complete(prompt)                           |
            |                                                           |
            |  enrichedChunk = { ...chunk, content: context + "\n\n" + chunk.content }
            |                                                           |
            +-----------------------------------------------------------+
                                      |
                                      v
                               enriched chunks --> embed & store

  Positions (start, end) preserved from original chunks.
  Content is modified (prepended with context) for better embedding.
  Requires LLM.
```

### 3. Summary (new)

```
Config: { strategy: "summary", chunkSize?, chunkOverlap?, embeddingModel?,
          summaryPrompt?, concurrency? }

  Document --> chunker.chunkWithPositions(doc) --> raw chunks
                                                      |
                                                      v
            +-------- for each chunk (parallel, concurrency=5): --------+
            |                                                           |
            |  summary = LLM.complete(summaryPrompt + chunk.content)    |
            |                                                           |
            |  summaryChunk = { ...chunk, content: summary }            |
            |                                                           |
            +-----------------------------------------------------------+
                                      |
                                      v
                               summary chunks --> embed & store

  Positions (start, end) preserved from original chunks.
  Content replaced with LLM summary (for embedding/search).
  Eval metrics use positions only -- not content -- so this is safe.
  Requires LLM.
```

### 4. Parent-Child (new)

```
Config: { strategy: "parent-child", embeddingModel?,
          childChunkSize?(200), parentChunkSize?(1000),
          childOverlap?(0), parentOverlap?(100) }

  Document --> childChunker.chunkWithPositions(doc)  --> small children
           --> parentChunker.chunkWithPositions(doc)  --> large parents

  Mapping:
  +-----------+     +-----------+     +-----------+
  | Parent A  |     | Parent B  |     | Parent C  |
  | (1000 ch) |     | (1000 ch) |     | (1000 ch) |
  +-----+-----+     +-----+-----+     +-----+-----+
        |                 |                 |
   +----+----+       +----+----+       +----+----+
   |    |    |       |    |    |       |    |    |
  c1   c2   c3     c4   c5   c6     c7   c8   c9
  (200)(200)(200)  (200)(200)(200)  (200)(200)(200)

  childToParentMap: { c1->A, c2->A, c3->A, c4->B, ... }

  Index: embed CHILDREN (small, focused)
  Return: swap to PARENTS (large, contextual)
  No LLM required.
```

---

## Parent-Child Retrieve Flow

The parent-child strategy modifies both `init()` and `retrieve()`:

```
retrieve(query, k):
  |
  +--> QUERY stage: _processQuery(query) --> queries[]
  |
  +--> SEARCH stage: search with child chunks
  |      (children are what's in the vector store)
  |
  |    Results: [child_c2 (score 0.9), child_c5 (score 0.8), child_c3 (score 0.7)]
  |
  +--> PARENT-CHILD SWAP:
  |      c2 -> Parent A (score 0.9)    <-- first seen
  |      c5 -> Parent B (score 0.8)    <-- first seen
  |      c3 -> Parent A (score 0.7)    <-- DUPLICATE, skip!
  |
  |    Deduped: [Parent A (0.9), Parent B (0.8)]
  |
  +--> REFINEMENT stage: rerank/threshold using PARENT chunks
  |      (reranker sees full parent context, not tiny children)
  |
  +--> Return top-k parent chunks
```

---

## IndexConfig Discriminated Union

```
File: src/retrievers/pipeline/config.ts

  Before (single interface):        After (discriminated union):
  +-------------------+             +--------------------+
  | IndexConfig       |             | PlainIndexConfig   | strategy: "plain"
  |   strategy: plain |             +--------------------+
  |   chunkSize?      |             | ContextualIndex... | strategy: "contextual"
  |   chunkOverlap?   |             +--------------------+
  |   separators?     |             | SummaryIndex...    | strategy: "summary"
  |   embeddingModel? |             +--------------------+
  +-------------------+             | ParentChildIndex...| strategy: "parent-child"
                                    +--------------------+
                                            |
                                    IndexConfig = union of all four
```

---

## Hash Functions

Hashes are strategy-aware and ensure cache stability:

```
computeIndexConfigHash(config):

  +-------------------+-------------------------------------------------+
  | Strategy          | Fields in Hash Payload                          |
  +-------------------+-------------------------------------------------+
  | plain             | strategy, chunkSize, chunkOverlap, separators,  |
  |                   | embeddingModel                                  |
  +-------------------+-------------------------------------------------+
  | contextual        | strategy, chunkSize, chunkOverlap, embedding,   |
  |                   | contextPrompt                                   |
  |                   | (excludes concurrency -- runtime only)          |
  +-------------------+-------------------------------------------------+
  | summary           | strategy, chunkSize, chunkOverlap, embedding,   |
  |                   | summaryPrompt                                   |
  |                   | (excludes concurrency -- runtime only)          |
  +-------------------+-------------------------------------------------+
  | parent-child      | strategy, childChunkSize, parentChunkSize,      |
  |                   | childOverlap, parentOverlap, embeddingModel     |
  +-------------------+-------------------------------------------------+

  Key: "plain" payload shape is IDENTICAL to pre-refactor format.
       Existing stored hashes remain valid (hash stability).

  stableStringify() ensures deterministic JSON key ordering.
  SHA-256 --> 64 hex chars.
```

---

## LLM Validation

```
Constructor:
  +-------------------+------------------+
  | Strategy          | Requires LLM?   |
  +-------------------+------------------+
  | plain             | No               |
  | contextual        | Yes  <-- throws  |
  | summary           | Yes  <-- throws  |
  | parent-child      | No               |
  +-------------------+------------------+

  if (["contextual","summary"].includes(strategy) && !deps.llm)
    throw Error("... requires an LLM ...")
```

---

## Concurrency Control

Contextual and summary strategies use `mapWithConcurrency()` for parallel LLM calls:

```
mapWithConcurrency(chunks, enrichFn, concurrency=5)

  Chunks:  [c1, c2, c3, c4, c5, c6, c7, c8]
            |   |   |   |   |
            v   v   v   v   v   <-- batch 1 (concurrency=5)
           LLM LLM LLM LLM LLM
            |   |   |
            v   v   v           <-- batch 2 (remaining 3)
           LLM LLM LLM

  Prevents overwhelming the LLM API with too many parallel calls.
  Concurrency is configurable per-config but excluded from hash.
```

---

## File Layout

```
packages/eval-lib/
  src/
    retrievers/pipeline/
      config.ts                    # IndexConfig union + hash functions (MODIFIED)
      pipeline-retriever.ts        # init(), retrieve(), cleanup() (MODIFIED)
                                   #   +_indexConfig, +_childToParentMap fields
      index.ts                     # +new IndexConfig type exports (MODIFIED)
    index.ts                       # +new IndexConfig type exports (MODIFIED)
    registry/
      index-strategies.ts          # 3 strategies -> "available" (MODIFIED)
  tests/unit/retrievers/pipeline/
    config.test.ts                 # +hash tests for new strategies (MODIFIED)
    pipeline-retriever.test.ts     # +LLM validation tests (MODIFIED)
    index-strategies.test.ts       # contextual, summary, parent-child (NEW)
```

---

## Exported Types

```
// From root barrel:
import type {
  IndexConfig,
  PlainIndexConfig,
  ContextualIndexConfig,
  SummaryIndexConfig,
  ParentChildIndexConfig,
} from "rag-evaluation-system";
```

---

## Registry Status

```
Index strategies:
  [x] plain         (was available)
  [x] contextual    (was coming-soon -> available)
  [x] summary       (was coming-soon -> available)
  [x] parent-child  (was coming-soon -> available)
```

---

## Design Decisions

```
+---+------------------------------+------------------------------------------+
| # | Decision                     | Rationale                                |
+---+------------------------------+------------------------------------------+
| 1 | Modify chunk content inline  | Eval metrics use start/end only, not     |
|   | (prepend ctx / replace w/    | content. Enriched content helps search   |
|   | summary)                     | and reranking.                           |
+---+------------------------------+------------------------------------------+
| 2 | Parent swap between SEARCH   | Reranker should see parent context (more |
|   | and REFINEMENT stages        | text) for better relevance judgment.     |
+---+------------------------------+------------------------------------------+
| 3 | Internal chunkers for        | deps.chunker is for plain/ctx/summary.   |
|   | parent-child                 | Parent-child creates its own two         |
|   |                              | RecursiveCharacterChunker instances.     |
+---+------------------------------+------------------------------------------+
| 4 | Concurrency excluded from    | Concurrency affects speed, not output.   |
|   | hash                         | Same results regardless of parallelism.  |
+---+------------------------------+------------------------------------------+
| 5 | Plain hash shape preserved   | Existing stored hashes remain valid.     |
|   |                              | No migration needed.                     |
+---+------------------------------+------------------------------------------+
```

---

## Test Summary

```
+-----------------------------------+-------+-----------------------------------+
| Test File                         | Tests | Key Assertions                    |
+-----------------------------------+-------+-----------------------------------+
| index-strategies.test.ts          |  ~18  | Contextual: LLM calls per chunk,  |
|                                   |       |   prompt template substitution,   |
|                                   |       |   position preservation, custom   |
|                                   |       |   prompt.                         |
|                                   |       | Summary: LLM calls, prompt,       |
|                                   |       |   positions, custom prompt.       |
|                                   |       | Parent-child: valid chunks,       |
|                                   |       |   returns parents not children,   |
|                                   |       |   dedup, no LLM needed,           |
|                                   |       |   cleanup + re-init.              |
+-----------------------------------+-------+-----------------------------------+
| config.test.ts (additions)        |  ~12  | Different strategies -> different  |
|                                   |       |   hashes, concurrency excluded,   |
|                                   |       |   prompts affect hash, chunk size |
|                                   |       |   affects hash, stability.        |
+-----------------------------------+-------+-----------------------------------+
| pipeline-retriever.test.ts (add)  |   5   | LLM validation for contextual/    |
|                                   |       |   summary, no throw for plain/    |
|                                   |       |   parent-child.                   |
+-----------------------------------+-------+-----------------------------------+
  Total: ~35 new tests
```
