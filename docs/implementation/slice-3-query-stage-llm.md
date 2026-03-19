# Slice 3 — Query Stage + LLM Interface

> Implements the QUERY stage of the 4-stage pipeline retriever with 4 LLM-powered query strategies (HyDE, multi-query, step-back, rewrite) and a provider-agnostic `PipelineLLM` interface, expanding the experiment grid to ~720 configs.

---

## Architecture Overview

```
                        PipelineRetriever.retrieve(query, k)
                                      |
         +----------------------------+----------------------------+
         |                            |                            |
    1. QUERY Stage             2. SEARCH Stage             3. REFINEMENT
    (this slice)               (existing)                  (existing)
         |                            |                            |
         v                            v                            v
  _processQuery(query)         _searchStrategy.search()    _applyRefinements()
         |                            |                            |
         v                            v                            v
  string[] (1 or N queries)    ScoredChunk[]               ScoredChunk[]
         |                            |
         |    if N > 1                |
         +---> rrfFuseMultiple() -----+
```

---

## The PipelineLLM Interface

A minimal, provider-agnostic contract for LLM completion:

```
+---------------------+
|    PipelineLLM      |
+---------------------+
| name: string        |
| complete(prompt)    |
|  -> Promise<string> |
+----------+----------+
           |
           |  implements
           |
+----------+----------+
|  OpenAIPipelineLLM  |
+---------------------+
| model: gpt-4o-mini  |
| temp: 0.2           |
+---------------------+
  constructor(client, opts?)
  static create(opts?)
  (duck-typed OpenAI client)


File: src/retrievers/pipeline/llm.interface.ts
File: src/retrievers/pipeline/llm-openai.ts
Entry: src/pipeline/llm-openai.ts  -->  "rag-evaluation-system/pipeline/llm-openai"
```

`OpenAIPipelineLLM` uses structural typing (not importing SDK types), enabling mock injection in tests. The static `create()` factory dynamically imports the `openai` package.

---

## Query Strategies

```
  User Query: "What are popular pets?"
       |
       v
  _processQuery(query) -- switch on config.strategy:
       |
       +---> "identity"    -->  ["What are popular pets?"]
       |                          (passthrough, no LLM)
       |
       +---> "hyde"        -->  LLM generates hypothetical answer doc(s)
       |                        ["Dogs and cats are beloved companions..."]
       |                         (search with the answer, not the question)
       |
       +---> "multi-query" -->  LLM generates N query variants
       |                        ["common household pets",
       |                         "popular pet animals",
       |                         "most kept domestic animals"]
       |                         (search each, fuse results via RRF)
       |
       +---> "step-back"   -->  LLM generates abstract question
       |                        ["What are popular pets?",          <-- original
       |                         "Human-animal domestication?"]     <-- abstract
       |                         (search both, fuse via RRF)
       |
       +---> "rewrite"     -->  LLM rewrites for precision
                                ["most popular domestic pet species"]
                                 (single improved query)
```

---

## Strategy Details

### HyDE (Hypothetical Document Embeddings)

```
Config: { strategy: "hyde", numHypotheticalDocs?: 1, hydePrompt?: string }

  query -----> LLM.complete(hydePrompt + query) -----> hypothetical doc
                                                          |
                                                   embed & search
                                                   (not the original query!)

  With numHypotheticalDocs > 1:
  query --+--> LLM call 1 --> doc1 --+--> search(doc1) --> results1 --+
          |                          |                                 |
          +--> LLM call 2 --> doc2 --+--> search(doc2) --> results2 --+--> rrfFuseMultiple
          |                          |                                 |
          +--> LLM call 3 --> doc3 --+--> search(doc3) --> results3 --+
          (parallel via Promise.all)
```

### Multi-Query

```
Config: { strategy: "multi-query", numQueries?: 3, generationPrompt?: string }

  query -----> LLM.complete(prompt with {n}=3 + query)
                      |
                      v
               "query variant 1\nquery variant 2\nquery variant 3"
                      |
               parseVariants(text, n)
                      |
                      v
               ["variant 1", "variant 2", "variant 3"]
                      |
            +---------+---------+
            |         |         |
       search(v1) search(v2) search(v3)
            |         |         |
            +---------+---------+
                      |
               rrfFuseMultiple()
```

### Step-Back

```
Config: { strategy: "step-back", includeOriginal?: true, stepBackPrompt?: string }

  query -----> LLM.complete(stepBackPrompt + query) -----> abstract question
                                                              |
  includeOriginal=true:                                       |
    search(original) --+                                      |
                       +--> rrfFuseMultiple()  <--- search(abstract)
                       |
  includeOriginal=false:
    search(abstract) only (single query, no fusion)
```

### Rewrite

```
Config: { strategy: "rewrite", rewritePrompt?: string }

  query -----> LLM.complete(rewritePrompt + query) -----> rewritten query
                                                              |
                                                     search(rewritten)
                                                     (single query)
```

---

## Original Query Preservation

A critical design decision — refinement stages always use the **original** user query:

```
  User Query: "whats popular pets??"
       |
  QUERY stage:    rewrite --> "most popular domestic pet species"
       |                                    |
  SEARCH stage:                    search("most popular domestic pet species")
       |                                    |
  REFINEMENT:     rerank("whats popular pets??", results)
                         ^^^^^^^^^^^^^^^^^^^^^^^^^
                         ORIGINAL query, not rewritten!

  Rationale: Rerankers should judge relevance to what the user asked,
             not to an LLM-rewritten version.
```

---

## Cross-Query Fusion: rrfFuseMultiple

```
File: src/retrievers/pipeline/search/fusion.ts

  Reciprocal Rank Fusion across N ranked lists:

  score(chunk) = SUM over all lists where chunk appears:
                   1 / (k + rank)      k=60 by default

  Example with 3 lists:
  +--------+----------+----------+----------+---------+
  |  Chunk | List 1   | List 2   | List 3   | RRF     |
  +--------+----------+----------+----------+---------+
  |    A   | rank 1   |    -     | rank 2   | 1/61 +  |
  |        |          |          |          | 1/62    |
  |        |          |          |          | = 0.033 |
  +--------+----------+----------+----------+---------+
  |    B   | rank 2   | rank 1   |    -     | 1/62 +  |
  |        |          |          |          | 1/61    |
  |        |          |          |          | = 0.033 |
  +--------+----------+----------+----------+---------+
  |    C   |    -     | rank 2   | rank 1   | 1/62 +  |
  |        |          |          |          | 1/61    |
  |        |          |          |          | = 0.033 |
  +--------+----------+----------+----------+---------+

  Chunks appearing in MORE lists get higher scores.
  Existing reciprocalRankFusion (2-list) is unchanged.
  rrfFuseMultiple handles N lists generically.
```

---

## parseVariants Utility

```
File: src/retrievers/pipeline/query/utils.ts

  LLM output:                    Parsed result:
  "1. query about dogs\n"   -->  ["query about dogs",
  "2. query about cats\n"        "query about cats",
  "3. query about birds"         "query about birds"]

  Handles: numbered (1. / 1)), dashed (- ), empty lines, whitespace
  Limits to expectedCount
```

---

## File Layout

```
packages/eval-lib/
  src/
    retrievers/pipeline/
      llm.interface.ts             # PipelineLLM interface (NEW)
      llm-openai.ts                # OpenAIPipelineLLM class (NEW)
      config.ts                    # +4 QueryConfig variants (MODIFIED)
      pipeline-retriever.ts        # +_processQuery, _queryConfig, _llm (MODIFIED)
      query/
        prompts.ts                 # 6 default prompts (NEW)
        utils.ts                   # parseVariants() (NEW)
        index.ts                   # Query barrel (NEW)
      search/
        fusion.ts                  # +rrfFuseMultiple() (MODIFIED)
        index.ts                   # +rrfFuseMultiple re-export (MODIFIED)
      index.ts                     # +new type exports (MODIFIED)
    pipeline/
      llm-openai.ts                # Entry point wrapper (NEW)
    experiments/
      presets.ts                   # +llm? in PipelinePresetDeps (MODIFIED)
    registry/
      query-strategies.ts          # 4 strategies -> "available" (MODIFIED)
      presets.ts                   # 5 presets -> "available" (MODIFIED)
  tests/unit/retrievers/pipeline/
    llm-openai.test.ts             # 6 tests (NEW)
    query-strategies.test.ts       # 11 tests (NEW)
    query/
      parse-variants.test.ts       # 7 tests (NEW)
    search/
      fusion.test.ts               # +6 rrfFuseMultiple tests (MODIFIED)
  tsup.config.ts                   # +1 entry point (MODIFIED)
  package.json                     # +1 sub-path export (MODIFIED)
```

---

## Configuration Types

```
QueryConfig = IdentityQueryConfig      (existing)
            | HydeQueryConfig          (new)
            | MultiQueryConfig         (new)
            | StepBackQueryConfig      (new)
            | RewriteQueryConfig       (new)

+--------------------+-------------------------------+
| Config             | Fields                        |
+--------------------+-------------------------------+
| identity           | (none)                        |
| hyde               | hydePrompt?, numHypoDoc?(1)   |
| multi-query        | numQueries?(3), genPrompt?    |
| step-back          | stepBackPrompt?, inclOrig?(T) |
| rewrite            | rewritePrompt?                |
+--------------------+-------------------------------+
  All custom prompts override the DEFAULT_*_PROMPT constants.
```

---

## LLM Validation

```
Constructor validation:

  Query strategies needing LLM:   [hyde, multi-query, step-back, rewrite]
  Index strategies needing LLM:   [contextual, summary]  (Slice 4)

  if (strategy requires LLM && deps.llm === undefined)
    throw Error("... requires an LLM ...")

  identity + plain index --> LLM optional (not used)
```

---

## Import Patterns

```
// PipelineLLM type from root barrel:
import type { PipelineLLM, HydeQueryConfig, ... } from "rag-evaluation-system";

// OpenAIPipelineLLM from sub-path (optional openai dep):
import { OpenAIPipelineLLM } from "rag-evaluation-system/pipeline/llm-openai";
```

---

## Registry & Presets

```
Query strategies now available:
  [x] identity    (was available)
  [x] hyde        (was coming-soon -> available)
  [x] multi-query (was coming-soon -> available)
  [x] step-back   (was coming-soon -> available)
  [x] rewrite     (was coming-soon -> available)

Presets flipped to available:
  [x] hyde-dense
  [x] hyde-hybrid
  [x] hyde-hybrid-reranked
  [x] rewrite-hybrid
  [x] rewrite-hybrid-reranked

Still coming-soon (need "dedup" refinement step):
  [ ] multi-query-dense
  [ ] multi-query-hybrid
  [ ] step-back-hybrid
```

---

## Test Summary

```
+-------------------------------+-------+--------------------------------------+
| Test File                     | Tests | Key Assertions                       |
+-------------------------------+-------+--------------------------------------+
| llm-openai.test.ts            |   6   | Name, model, temp, null content,     |
|                               |       | API params, interface compliance     |
+-------------------------------+-------+--------------------------------------+
| query-strategies.test.ts      |  11   | HyDE (1+N docs), multi-query parse,  |
|                               |       | step-back +/- original, rewrite,     |
|                               |       | identity regression, refinement      |
|                               |       | uses original query                  |
+-------------------------------+-------+--------------------------------------+
| query/parse-variants.test.ts  |   7   | Numbering strip, empty lines,        |
|                               |       | limit, trim, dash prefix             |
+-------------------------------+-------+--------------------------------------+
| search/fusion.test.ts         |  +6   | Multi-list RRF, single list, empty,  |
|                               |       | no overlap, frequency ranking,       |
|                               |       | custom k parameter                   |
+-------------------------------+-------+--------------------------------------+
  Total: ~30 new tests
```
