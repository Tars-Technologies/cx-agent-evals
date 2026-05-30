# Slice 1 — Provider Breadth

> Adds 3 embedders (Cohere, Voyage, Jina) + 2 rerankers (Jina, Voyage) to the pipeline retriever system, expanding experiment coverage to **4 embedders x 3 rerankers x 3 search strategies = 36 configs**.

---

## Architecture Overview

```
                        +-----------------------+
                        |   Embedder Interface  |
                        |  name, dimension,     |
                        |  embed(), embedQuery()|
                        +----------+------------+
                                   |
            +----------+-----------+-----------+----------+
            |          |                       |          |
     +------+------+  +-------+------+  +-----+------+  +------+------+
     |   OpenAI    |  |    Cohere    |  |   Voyage   |  |     Jina    |
     |  Embedder   |  |   Embedder  |  |  Embedder  |  |   Embedder  |
     | (existing)  |  |   (new)     |  |   (new)    |  |    (new)    |
     +-------------+  +-------------+  +------------+  +-------------+
      SDK: openai      SDK: cohere-ai   REST: fetch     REST: fetch
      1536d default    1024d default    1024d default   1024d default
                                                        (Matryoshka)


                        +-----------------------+
                        |   Reranker Interface  |
                        |  name, rerank()       |
                        +----------+------------+
                                   |
                  +----------------+----------------+
                  |                |                |
           +------+------+  +-----+------+  +------+------+
           |   Cohere    |  |    Jina    |  |   Voyage    |
           |  Reranker   |  |  Reranker  |  |  Reranker   |
           | (existing)  |  |   (new)    |  |   (new)     |
           +-------------+  +------------+  +-------------+
            SDK: cohere-ai   REST: fetch     REST: fetch
            topN / results   top_n / results top_k / data
```

---

## Provider Comparison

### Embedders

```
+------------------+----------------------+------+------------+---------------+
| Provider         | Default Model        | Dims | Transport  | Input Type    |
+------------------+----------------------+------+------------+---------------+
| OpenAI (pre)     | text-embedding-3-sm  | 1536 | SDK        | N/A           |
| Cohere (new)     | embed-english-v3.0   | 1024 | SDK        | search_doc/q  |
| Voyage (new)     | voyage-3.5           | 1024 | REST fetch | document/query|
| Jina   (new)     | jina-embeddings-v3   | 1024 | REST fetch | passage/query |
+------------------+----------------------+------+------------+---------------+
                                                    ^
                                                    |
                                    Jina supports Matryoshka dims
                                    (32, 128, 256, 512, 1024)
```

### Rerankers

```
+------------------+---------------------------+-----------+----------+----------+
| Provider         | Default Model             | Transport | TopK Key | Data Key |
+------------------+---------------------------+-----------+----------+----------+
| Cohere (pre)     | rerank-english-v3.0       | SDK       | topN     | results  |
| Jina   (new)     | jina-reranker-v2-base-ml  | REST      | top_n    | results  |
| Voyage (new)     | rerank-2.5                | REST      | top_k    | data     |
+------------------+---------------------------+-----------+----------+----------+
                     Note: each provider uses different param/response field names
```

---

## Design Pattern: Testable Providers

Every new provider follows the same dependency-injection pattern for testability:

```
  +------------------+          +------------------+
  |  Production Use  |          |    Unit Tests    |
  +--------+---------+          +--------+---------+
           |                             |
    static create()               new Constructor()
    (dynamic import SDK            (inject mock client
     or build REST client)          directly)
           |                             |
           v                             v
  +--------+---------+          +--------+---------+
  | Real SDK Client  |          |   Mock Client    |
  | or fetch wrapper |          | { embed: vi.fn() }|
  +--------+---------+          +--------+---------+
           |                             |
           +----------+    +-------------+
                      |    |
                      v    v
               +------+----+------+
               |  Provider Class  |
               |  (public ctor)   |
               |  constructor({   |
               |    client,       |
               |    model?        |
               |  })              |
               +------------------+
```

### Local Client Interfaces

Each provider defines a minimal structural interface for its API surface:

```
CohereEmbedClient           VoyageEmbedClient           JinaEmbedClient
  .embed({                     .embed({                    .embed({
    model,                       model,                      model,
    texts,                       input,                      input,
    inputType,                   input_type                  task,
    embeddingTypes               })                          dimensions?
  })                                                        })

CohereRerankClient           JinaRerankClient            VoyageRerankClient
  .rerank({                    .rerank({                   .rerank({
    model, query,                model, query,               model, query,
    documents,                   documents,                  documents,
    topN          <-- camel      top_n         <-- snake     top_k       <-- snake
  })                           })                          })
```

---

## File Layout

```
packages/eval-lib/
  src/
    embedders/
      embedder.interface.ts      # Embedder interface (unchanged)
      openai.ts                  # OpenAIEmbedder (pre-existing)
      cohere.ts                  # CohereEmbedder (NEW)
      voyage.ts                  # VoyageEmbedder (NEW)
      jina.ts                    # JinaEmbedder (NEW)
      index.ts                   # Barrel: only OpenAI + interface (unchanged)
    rerankers/
      reranker.interface.ts      # Reranker interface (unchanged)
      cohere.ts                  # CohereReranker (JSDoc update only)
      jina.ts                    # JinaReranker (NEW)
      voyage.ts                  # VoyageReranker (NEW)
      index.ts                   # Barrel: interface only (unchanged)
  tests/unit/
    embedders/
      cohere.test.ts             # 7 tests (NEW)
      voyage.test.ts             # 10 tests (NEW)
      jina.test.ts               # 11 tests (NEW)
    rerankers/
      jina.test.ts               # 7 tests (NEW)
      voyage.test.ts             # 7 tests (NEW)
  tsup.config.ts                 # +5 entry points
  package.json                   # +5 sub-path exports
```

---

## Import Pattern

New providers are **sub-path only** — not exported from the root barrel:

```
// Consumers import via sub-paths:
import { CohereEmbedder }  from "rag-evaluation-system/embedders/cohere";
import { VoyageEmbedder }  from "rag-evaluation-system/embedders/voyage";
import { JinaEmbedder }    from "rag-evaluation-system/embedders/jina";
import { JinaReranker }    from "rag-evaluation-system/rerankers/jina";
import { VoyageReranker }  from "rag-evaluation-system/rerankers/voyage";

// NOT available from root:
// import { CohereEmbedder } from "rag-evaluation-system"; // <-- WRONG
```

This keeps optional SDK dependencies (`cohere-ai`) tree-shakeable and avoids bloating the main bundle.

---

## Dependencies

```
package.json
  optionalDependencies:
    cohere-ai: ">=7.0"    # Used by CohereEmbedder + CohereReranker
    openai: ">=4.0"        # Used by OpenAIEmbedder (pre-existing)

  (No new dependencies — Voyage and Jina use built-in fetch)
```

---

## Test Summary

```
+----------------------------+-------+------------------------------------+
| Test File                  | Tests | Key Assertions                     |
+----------------------------+-------+------------------------------------+
| embedders/cohere.test.ts   |   7   | inputType, model, dims, defaults   |
| embedders/voyage.test.ts   |  10   | input_type, dims per model variant |
| embedders/jina.test.ts     |  11   | task field, Matryoshka dimensions  |
| rerankers/jina.test.ts     |   7   | top_n, results[], empty input      |
| rerankers/voyage.test.ts   |   7   | top_k, data[], chunk preservation  |
+----------------------------+-------+------------------------------------+
  Total: 42 new tests, all using mock client injection (no real API calls)
```
