# Slice 1 — Provider Breadth

> Part of the [Pipeline Retrievers Plan](./pipeline-retrievers-shared-context.md). See shared context for codebase state and design decisions.

**Unlocks**: 4 embedders x 3 rerankers x 3 search strategies = **36 experiment configs**

This slice adds no new pipeline stages — just new providers that plug into the existing interfaces. Highest ROI starting point.

---

## Design decisions (Slice 1–specific)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| S1-1 | Constructor visibility | **Public** (like `OpenAIEmbedder`) | Enables direct mock-client injection in unit tests. Private constructors (like `CohereReranker`) prevent this and the existing `CohereReranker` has zero unit tests as a result. |
| S1-2 | Constructor signature | Options object `{ client, model? }` | Matches `OpenAIEmbedder`. More ergonomic than positional args, self-documenting, forward-compatible with new options. |
| S1-3 | Barrel exports for new providers | **Sub-path only** (like `CohereReranker`) — NOT added to barrel `index.ts` or root `index.ts` | Follows the more recent convention. Keeps the root barrel lean; users opt-in to providers via sub-path imports (`rag-evaluation-system/embedders/cohere`). The existing `OpenAIEmbedder` root-barrel export is a legacy exception. |
| S1-4 | Fetch-based provider testability | Local client interface (same pattern as `OpenAIEmbeddingsClient` / `CohereRerankClient`) | Abstract the HTTP call behind a typed interface. Production `create()` builds a fetch-based implementation; tests inject a mock object. No need for global fetch mocking. |
| S1-5 | Cohere reranker default model | **Keep `"rerank-english-v3.0"`** | This is a library — changing the default is a silent behavior change for all consumers. Document `"rerank-v3.5"` as available; let consumers opt in explicitly. |

---

### 1a. Cohere Embedder

**File**: `packages/eval-lib/src/embedders/cohere.ts`

```typescript
// Implements: Embedder interface (from embedder.interface.ts)
// Package: cohere-ai (already in optionalDependencies)
// Pattern: follows OpenAIEmbedder — public constructor + static async create() factory

// Local client interface for testability (structural typing, not importing SDK types)
interface CohereEmbedClient {
  embed(opts: {
    model: string;
    texts: string[];
    inputType: string;
    embeddingTypes: string[];
  }): Promise<{
    embeddings: { float: number[][] };
  }>;
}

// Dimension lookup (same pattern as OpenAIEmbedder's knownDims)
const knownDims: Record<string, number> = {
  "embed-english-v3.0": 1024,
  "embed-multilingual-v3.0": 1024,
};
// Fallback: 1024

export class CohereEmbedder implements Embedder {
  readonly name: string;     // "Cohere(embed-english-v3.0)"
  readonly dimension: number; // knownDims[model] ?? 1024

  // PUBLIC constructor — enables direct mock injection in tests
  constructor(options: { client: CohereEmbedClient; model?: string });

  // Factory for production use — dynamically imports cohere-ai SDK
  static async create(options?: {
    model?: string;  // default: "embed-english-v3.0"
    apiKey?: string; // read by CohereClient from COHERE_API_KEY if omitted
  }): Promise<CohereEmbedder>;
  // create() does: const { CohereClient } = await import("cohere-ai");
  //                const client = new CohereClient({ token: options?.apiKey });
  //                return new CohereEmbedder({ client, model: options?.model });

  // Implementation details:
  // embed(texts)      → client.embed({ model, texts: [...texts], inputType: "search_document", embeddingTypes: ["float"] })
  //                   → return response.embeddings.float
  // embedQuery(query) → same as embed([query]) but with inputType: "search_query"
  //                   → return result[0]
}
```

**Models**:
| Model | Dims | Max Tokens | Notes |
|-------|------|------------|-------|
| `embed-english-v3.0` (default) | 1024 | 512 | English-only |
| `embed-multilingual-v3.0` | 1024 | 512 | 100+ languages |

### 1b. Voyage Embedder

**File**: `packages/eval-lib/src/embedders/voyage.ts`

```typescript
// Implements: Embedder interface
// Package: plain fetch to https://api.voyageai.com/v1/embeddings
// Pattern: public constructor + static async create() factory

// Local client interface — abstracts fetch for testability
interface VoyageEmbedClient {
  embed(opts: {
    model: string;
    input: string[];
    input_type: string;
  }): Promise<{
    data: Array<{ embedding: number[]; index: number }>;
  }>;
}

const knownDims: Record<string, number> = {
  "voyage-3.5": 1024,
  "voyage-3.5-lite": 512,
  "voyage-3": 1024,
  "voyage-code-3": 1024,
};
// Fallback: 1024

export class VoyageEmbedder implements Embedder {
  readonly name: string;     // "Voyage(voyage-3.5)"
  readonly dimension: number; // knownDims[model] ?? 1024

  constructor(options: { client: VoyageEmbedClient; model?: string });

  static async create(options?: {
    model?: string;  // default: "voyage-3.5"
    apiKey?: string; // defaults to process.env.VOYAGE_API_KEY
  }): Promise<VoyageEmbedder>;
  // create() builds a VoyageEmbedClient that calls fetch("https://api.voyageai.com/v1/embeddings", ...)
  // with Authorization: Bearer ${apiKey} header

  // Implementation details:
  // embed(texts)      → client.embed({ model, input: [...texts], input_type: "document" })
  //                   → return response.data.map(d => d.embedding)
  // embedQuery(query) → client.embed({ model, input: [query], input_type: "query" })
  //                   → return response.data[0].embedding
}
```

**Models**:
| Model | Dims | Max Tokens | Notes |
|-------|------|------------|-------|
| `voyage-3.5` (default) | 1024 | 32,000 | Best quality/$ |
| `voyage-3.5-lite` | 512 | 32,000 | Budget option |
| `voyage-3` | 1024 | 32,000 | General-purpose |
| `voyage-code-3` | 1024 | 32,000 | Code-optimized |

### 1c. Jina Embedder

**File**: `packages/eval-lib/src/embedders/jina.ts`

```typescript
// Implements: Embedder interface
// Package: plain fetch to https://api.jina.ai/v1/embeddings
// Pattern: public constructor + static async create() factory

// Local client interface — abstracts fetch for testability
interface JinaEmbedClient {
  embed(opts: {
    model: string;
    input: string[];
    task: string;
    dimensions?: number;
  }): Promise<{
    data: Array<{ embedding: number[]; index: number }>;
  }>;
}

export class JinaEmbedder implements Embedder {
  readonly name: string;     // "Jina(jina-embeddings-v3)"
  readonly dimension: number; // from options.dimensions ?? 1024

  constructor(options: { client: JinaEmbedClient; model?: string; dimensions?: number });

  static async create(options?: {
    model?: string;     // default: "jina-embeddings-v3"
    apiKey?: string;    // defaults to process.env.JINA_API_KEY
    dimensions?: number; // Matryoshka: 32-1024, default 1024
  }): Promise<JinaEmbedder>;
  // create() builds a JinaEmbedClient that calls fetch("https://api.jina.ai/v1/embeddings", ...)
  // with Authorization: Bearer ${apiKey} header

  // Implementation details:
  // embed(texts)      → client.embed({ model, input: [...texts], task: "retrieval.passage", dimensions })
  //                   → return response.data.map(d => d.embedding)
  // embedQuery(query) → client.embed({ model, input: [query], task: "retrieval.query", dimensions })
  //                   → return response.data[0].embedding
}
```

**Note**: Jina's `dimension` is set at construction time via `options.dimensions` (Matryoshka embedding), not from a lookup table. Default 1024.

### 1d. Update Cohere Reranker — Documentation Only

**File**: `packages/eval-lib/src/rerankers/cohere.ts` (modify existing)

**Keep the default model as `"rerank-english-v3.0"`** (see decision S1-5). Add a JSDoc comment documenting available models:

```typescript
/**
 * @param options.model - Cohere reranker model. Available models:
 *   - "rerank-english-v3.0" (default) — English-only, proven stable
 *   - "rerank-v3.5" — Latest multilingual model
 *   - "rerank-english-v2.0" — Legacy
 */
static async create(options?: {
  model?: string;  // default: "rerank-english-v3.0" (unchanged)
}): Promise<CohereReranker>;
```

This is the only change to this file — a documentation addition, no behavior change.

### 1e. Jina Reranker

**File**: `packages/eval-lib/src/rerankers/jina.ts`

```typescript
// Implements: Reranker interface (from reranker.interface.ts)
// Package: plain fetch to https://api.jina.ai/v1/rerank
// Pattern: public constructor + static async create() factory

// Local client interface — abstracts fetch for testability
interface JinaRerankClient {
  rerank(opts: {
    model: string;
    query: string;
    documents: string[];
    top_n: number;
  }): Promise<{
    results: Array<{ index: number; relevance_score: number }>;
  }>;
}

export class JinaReranker implements Reranker {
  readonly name: string; // "Jina(jina-reranker-v2-base-multilingual)"

  constructor(options: { client: JinaRerankClient; model?: string });

  static async create(options?: {
    model?: string;  // default: "jina-reranker-v2-base-multilingual"
    apiKey?: string; // defaults to process.env.JINA_API_KEY
  }): Promise<JinaReranker>;

  // rerank() implementation — must match CohereReranker pattern:
  // 1. Early return [] when chunks.length === 0
  // 2. client.rerank({ model, query, documents: chunks.map(c => c.content), top_n: topK ?? chunks.length })
  // 3. return response.results.map(r => chunks[r.index])
  //    (maps indices back to original PositionAwareChunk objects — preserves id, docId, start, end, metadata)
}
```

### 1f. Voyage Reranker

**File**: `packages/eval-lib/src/rerankers/voyage.ts`

```typescript
// Implements: Reranker interface
// Package: plain fetch to https://api.voyageai.com/v1/rerank
// Pattern: public constructor + static async create() factory

// Local client interface — abstracts fetch for testability
interface VoyageRerankClient {
  rerank(opts: {
    model: string;
    query: string;
    documents: string[];
    top_k: number;
  }): Promise<{
    data: Array<{ index: number; relevance_score: number }>;
  }>;
}

export class VoyageReranker implements Reranker {
  readonly name: string; // "Voyage(rerank-2.5)"

  constructor(options: { client: VoyageRerankClient; model?: string });

  static async create(options?: {
    model?: string;  // default: "rerank-2.5"
    apiKey?: string; // defaults to process.env.VOYAGE_API_KEY
  }): Promise<VoyageReranker>;

  // rerank() implementation — must match CohereReranker pattern:
  // 1. Early return [] when chunks.length === 0
  // 2. client.rerank({ model, query, documents: chunks.map(c => c.content), top_k: topK ?? chunks.length })
  // 3. return response.data.map(r => chunks[r.index])
  //    NOTE: Voyage uses "data" array (not "results" like Cohere/Jina)
  //    NOTE: Voyage uses "top_k" param (not "topN" like Cohere or "top_n" like Jina)
}
```

**API differences between reranker providers** (critical for correct implementation):

| Provider | topK param name | Response array key | Score field |
|----------|----------------|-------------------|-------------|
| Cohere (SDK) | `topN` (camelCase) | `results` | `relevanceScore` (camelCase) |
| Jina (REST) | `top_n` | `results` | `relevance_score` (snake_case) |
| Voyage (REST) | `top_k` | `data` | `relevance_score` (snake_case) |

### 1g. Package.json Changes

Current actual state of `packages/eval-lib/package.json`:

```json
{
  "dependencies": {
    "@langchain/core": "^1.1.0",
    "langsmith": "^0.5.0",
    "minisearch": "^7.2.0",
    "zod": "^3.23"
  },
  "optionalDependencies": {
    "cohere-ai": ">=7.0",
    "openai": ">=4.0"
  }
}
```

**No new npm dependencies needed for Slice 1.** Voyage and Jina use plain `fetch` (Node 18+ built-in). Cohere embedder reuses the existing `cohere-ai` optional dependency.

### 1h. tsup Entry Points

Add new entry points for each provider, following the existing `embedders/openai` and `rerankers/cohere` pattern:

```typescript
// tsup.config.ts — add to the existing entry array (which already has 8 entry points):
// Existing: src/index.ts, src/embedders/openai.ts, src/rerankers/cohere.ts,
//           src/pipeline/internals.ts, src/utils/index.ts,
//           src/langsmith/index.ts, src/llm/index.ts, src/shared/index.ts
//
// Add (5 new entries):
"src/embedders/cohere.ts",
"src/embedders/voyage.ts",
"src/embedders/jina.ts",
"src/rerankers/jina.ts",
"src/rerankers/voyage.ts",
```

The `external` array needs **no changes** — all 5 existing entries are sufficient. Cohere embedder uses `cohere-ai` (already external). Voyage and Jina use plain `fetch` (no external package).

And corresponding package.json exports (5 new entries):

```json
{
  "exports": {
    "./embedders/cohere": {
      "types": "./dist/embedders/cohere.d.ts",
      "import": "./dist/embedders/cohere.js"
    },
    "./embedders/voyage": {
      "types": "./dist/embedders/voyage.d.ts",
      "import": "./dist/embedders/voyage.js"
    },
    "./embedders/jina": {
      "types": "./dist/embedders/jina.d.ts",
      "import": "./dist/embedders/jina.js"
    },
    "./rerankers/jina": {
      "types": "./dist/rerankers/jina.d.ts",
      "import": "./dist/rerankers/jina.js"
    },
    "./rerankers/voyage": {
      "types": "./dist/rerankers/voyage.d.ts",
      "import": "./dist/rerankers/voyage.js"
    }
  }
}
```

**Note**: `"types"` before `"import"` — matches the convention used by the majority of existing entries (`./pipeline/internals`, `./utils`, `./langsmith`, `./llm`, `./shared`). The older `./embedders/openai` and `./rerankers/cohere` entries have reversed order but that doesn't affect resolution.

### 1i. Index Exports — No Changes

Per decision S1-3, new providers are **sub-path only** — they are NOT added to:
- `src/embedders/index.ts` (stays: `Embedder` type + `OpenAIEmbedder`)
- `src/rerankers/index.ts` (stays: `Reranker` type only)
- `src/index.ts` (no new concrete class exports)

Consumers import new providers via sub-paths:
```typescript
import { CohereEmbedder } from "rag-evaluation-system/embedders/cohere";
import { VoyageEmbedder } from "rag-evaluation-system/embedders/voyage";
import { JinaEmbedder } from "rag-evaluation-system/embedders/jina";
import { JinaReranker } from "rag-evaluation-system/rerankers/jina";
import { VoyageReranker } from "rag-evaluation-system/rerankers/voyage";
```

---

## Testing (Slice 1)

### Test approach

All new providers use **public constructors** that accept a local client interface. Tests inject mock clients directly — no SDK imports, no fetch mocking, no `vi.mock()`.

This matches the existing `OpenAIEmbedder` test pattern (see `tests/fixtures.ts`), where mock embedders/rerankers are plain objects implementing the interface.

### Embedder test pattern

```typescript
// tests/unit/embedders/cohere.test.ts
import { describe, it, expect, vi } from "vitest";
import { CohereEmbedder } from "../../../src/embedders/cohere.js";

describe("CohereEmbedder", () => {
  const mockClient = {
    embed: vi.fn().mockResolvedValue({
      embeddings: { float: [[0.1, 0.2, 0.3]] },
    }),
  };

  it("should use inputType search_document for embed()", async () => {
    const embedder = new CohereEmbedder({ client: mockClient, model: "embed-english-v3.0" });

    await embedder.embed(["test text"]);

    expect(mockClient.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        inputType: "search_document",
        embeddingTypes: ["float"],
        model: "embed-english-v3.0",
      }),
    );
  });

  it("should use inputType search_query for embedQuery()", async () => {
    const embedder = new CohereEmbedder({ client: mockClient });

    await embedder.embedQuery("test query");

    expect(mockClient.embed).toHaveBeenCalledWith(
      expect.objectContaining({ inputType: "search_query" }),
    );
  });

  it("should set name and dimension from model", () => {
    const embedder = new CohereEmbedder({ client: mockClient, model: "embed-multilingual-v3.0" });
    expect(embedder.name).toBe("Cohere(embed-multilingual-v3.0)");
    expect(embedder.dimension).toBe(1024);
  });
});
```

Voyage and Jina embedder tests follow the same pattern — inject mock client, assert correct API parameters (especially `input_type`/`task` for document vs query).

### Reranker test pattern

```typescript
// tests/unit/rerankers/jina.test.ts
import { describe, it, expect, vi } from "vitest";
import { JinaReranker } from "../../../src/rerankers/jina.js";
import type { PositionAwareChunk } from "../../../src/types/index.js";

const makeChunk = (id: string, content: string): PositionAwareChunk => ({
  id: id as any,
  content,
  docId: "doc1" as any,
  start: 0,
  end: content.length,
  metadata: {},
});

describe("JinaReranker", () => {
  it("should return empty array for empty input", async () => {
    const mockClient = { rerank: vi.fn() };
    const reranker = new JinaReranker({ client: mockClient });

    const result = await reranker.rerank("query", []);

    expect(result).toEqual([]);
    expect(mockClient.rerank).not.toHaveBeenCalled();
  });

  it("should map response indices back to original chunks", async () => {
    const chunks = [makeChunk("c1", "first"), makeChunk("c2", "second"), makeChunk("c3", "third")];
    const mockClient = {
      rerank: vi.fn().mockResolvedValue({
        results: [
          { index: 2, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.7 },
        ],
      }),
    };
    const reranker = new JinaReranker({ client: mockClient });

    const result = await reranker.rerank("query", chunks, 2);

    expect(result).toEqual([chunks[2], chunks[0]]);
    expect(mockClient.rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: ["first", "second", "third"],
        top_n: 2,
      }),
    );
  });

  it("should default topK to chunks.length when omitted", async () => {
    const chunks = [makeChunk("c1", "first"), makeChunk("c2", "second")];
    const mockClient = {
      rerank: vi.fn().mockResolvedValue({
        results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.5 }],
      }),
    };
    const reranker = new JinaReranker({ client: mockClient });

    await reranker.rerank("query", chunks);

    expect(mockClient.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ top_n: 2 }),
    );
  });
});
```

Voyage reranker tests follow the same pattern, but assert `top_k` (not `top_n`) and `response.data` (not `response.results`).

---

## File checklist

### New files (5 source + 5 test = 10 files)
- `src/embedders/cohere.ts`
- `src/embedders/voyage.ts`
- `src/embedders/jina.ts`
- `src/rerankers/jina.ts`
- `src/rerankers/voyage.ts`
- `tests/unit/embedders/cohere.test.ts`
- `tests/unit/embedders/voyage.test.ts`
- `tests/unit/embedders/jina.test.ts`
- `tests/unit/rerankers/jina.test.ts`
- `tests/unit/rerankers/voyage.test.ts`

### Modified files (3 files)
- `src/rerankers/cohere.ts` — JSDoc addition only (no behavior change)
- `package.json` — 5 new export entries
- `tsup.config.ts` — 5 new entry points

### NOT modified (per decision S1-3)
- `src/embedders/index.ts` — unchanged
- `src/rerankers/index.ts` — unchanged
- `src/index.ts` — unchanged
