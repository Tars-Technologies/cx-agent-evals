---
"@tars-inc/eval-lib": minor
---

Add multi-provider embedder and reranker factories, and migrate Cohere to HTTP.

New `makeEmbedder` / `makeReranker` factories select a provider behind the
existing `Embedder` / `Reranker` interfaces:

```ts
import { makeEmbedder } from "@tars-inc/eval-lib/embedders/make-embedder"
import { makeReranker } from "@tars-inc/eval-lib/rerankers/make-reranker"

const embedder = await makeEmbedder() // openai (default), openrouter, cohere
const reranker = await makeReranker({ provider: "jina" }) // cohere (default), jina, voyage
```

The Cohere embedder and reranker now call the Cohere v2 HTTP API directly, so
the `cohere-ai` SDK is no longer required. Embedding batches are reordered by
the provider-returned index and checked for input/output alignment, and all
rerankers drop out-of-range result indices and cap their output to the
requested topK. The rerank refinement step can now carry a `provider` and
`model`.
