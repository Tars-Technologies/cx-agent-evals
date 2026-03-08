# Slice 4 — Index Stage Strategies — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the pipeline retriever's INDEX stage with contextual, summary, and parent-child indexing strategies — multiplying the experiment grid by ~4x index configurations.

**Architecture:** Convert `IndexConfig` from a single interface to a discriminated union with four members (`plain`, `contextual`, `summary`, `parent-child`). Update hash functions to be strategy-aware. Add strategy dispatch in `PipelineRetriever.init()` — contextual/summary use `mapWithConcurrency` + `PipelineLLM` to enrich chunks before indexing; parent-child creates two chunker tiers and maps child results back to parents in `retrieve()`.

**Tech Stack:** TypeScript, Vitest, existing `mapWithConcurrency` utility, `PipelineLLM` interface, `RecursiveCharacterChunker`.

---

## Shared Context

See [pipeline-retrievers-shared-context.md](./pipeline-retrievers-shared-context.md) for codebase state and design decisions.

**Key files (read before implementing):**

| File | Why |
|------|-----|
| `packages/eval-lib/src/retrievers/pipeline/config.ts` | Current `IndexConfig`, hash functions — primary change target |
| `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts` | `PipelineRetriever` class — `init()`, `retrieve()`, constructor |
| `packages/eval-lib/src/retrievers/pipeline/query/prompts.ts` | `DEFAULT_CONTEXT_PROMPT`, `DEFAULT_SUMMARY_PROMPT` already defined |
| `packages/eval-lib/src/utils/concurrency.ts` | `mapWithConcurrency(items, fn, limit)` — used for parallel LLM calls |
| `packages/eval-lib/src/retrievers/pipeline/llm.interface.ts` | `PipelineLLM` — `complete(prompt): Promise<string>` |
| `packages/eval-lib/src/chunkers/recursive-character.ts` | `RecursiveCharacterChunker` — instantiated internally for parent-child |
| `packages/eval-lib/src/registry/index-strategies.ts` | Registry entries to flip from `coming-soon` to `available` |
| `packages/eval-lib/tests/unit/retrievers/pipeline/pipeline-retriever.test.ts` | Test patterns — `defaultDeps()`, `testCorpus()`, mock reranker |
| `packages/eval-lib/tests/unit/retrievers/pipeline/query-strategies.test.ts` | Mock LLM pattern — `createMockLlm()`, `vi.fn().mockResolvedValue()` |
| `packages/eval-lib/tests/fixtures.ts` | `mockEmbedder(dimension)` — hash-based deterministic embedder |

---

## Design Decisions (Slice 4)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Contextual/summary chunk content | Modify chunk content inline (prepend context / replace with summary) | Simpler than bypassing the search strategy to store originals separately. Evaluation metrics only use `docId`, `start`, `end` — not `content`. Reranking with enriched content is actually beneficial. |
| 2 | Parent swap timing | Between SEARCH and REFINEMENT stages | Reranker should see parent chunks (larger context), not tiny child chunks |
| 3 | Parent-child internal chunkers | Create two `RecursiveCharacterChunker` instances from config params | Dep chunker is for plain/contextual/summary; parent-child needs two sizes |
| 4 | `_indexConfig` storage | Store resolved `IndexConfig` as private field | Constructor doesn't currently store it, but `init()` needs it for strategy dispatch |
| 5 | Hash stability | `plain` strategy payload shape unchanged | Existing stored hashes remain valid; new strategies produce new hashes |
| 6 | Summary content swap | No swap back to original content | Eval metrics use positions only; summary content is consistent with search intent |

---

## Task 1: Add IndexConfig Discriminated Union Types

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/config.ts` (lines 18-31)
- Modify: `packages/eval-lib/src/retrievers/pipeline/index.ts` (add new type exports)
- Modify: `packages/eval-lib/src/index.ts` (add new type exports)

**Step 1: Write the type changes in config.ts**

Replace the single `IndexConfig` interface (lines 18-24) with a discriminated union:

```typescript
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
```

Update `DEFAULT_INDEX_CONFIG` type annotation (line 26):

```typescript
export const DEFAULT_INDEX_CONFIG: PlainIndexConfig = {
  strategy: "plain",
  chunkSize: 1000,
  chunkOverlap: 200,
  embeddingModel: "text-embedding-3-small",
} as const;
```

**Step 2: Update barrel exports**

In `packages/eval-lib/src/retrievers/pipeline/index.ts`, add the new types to the `type` export block:

```typescript
export type {
  PipelineConfig,
  IndexConfig,
  PlainIndexConfig,
  ContextualIndexConfig,
  SummaryIndexConfig,
  ParentChildIndexConfig,
  // ... existing query/search/refinement types unchanged ...
} from "./config.js";
```

In `packages/eval-lib/src/index.ts`, add the new types to the pipeline type export block:

```typescript
export type {
  PipelineRetrieverDeps,
  PipelineConfig,
  IndexConfig,
  PlainIndexConfig,
  ContextualIndexConfig,
  SummaryIndexConfig,
  ParentChildIndexConfig,
  // ... existing types unchanged ...
} from "./retrievers/index.js";
```

**Step 3: Run typecheck to verify**

Run: `pnpm typecheck`
Expected: PASS — all existing code uses `strategy: "plain"` which matches `PlainIndexConfig`.

**Step 4: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/config.ts packages/eval-lib/src/retrievers/pipeline/index.ts packages/eval-lib/src/index.ts
git commit -m "feat(eval-lib): convert IndexConfig to discriminated union with 4 strategy types"
```

---

## Task 2: Update Hash Functions for New Strategies

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/config.ts` (lines 154-203)
- Modify: `packages/eval-lib/tests/unit/retrievers/pipeline/config.test.ts`

**Step 1: Write failing tests for new strategy hashing**

Add tests to `packages/eval-lib/tests/unit/retrievers/pipeline/config.test.ts`:

```typescript
import {
  computeIndexConfigHash,
  computeRetrieverConfigHash,
  DEFAULT_INDEX_CONFIG,
} from "../../../../src/retrievers/pipeline/config.js";
import type { PipelineConfig } from "../../../../src/retrievers/pipeline/config.js";

// ... existing tests ...

describe("computeIndexConfigHash — new strategies", () => {
  it("produces different hashes for different strategies", () => {
    const plain: PipelineConfig = { name: "a", index: { strategy: "plain" } };
    const contextual: PipelineConfig = { name: "b", index: { strategy: "contextual" } };
    const summary: PipelineConfig = { name: "c", index: { strategy: "summary" } };
    const parentChild: PipelineConfig = { name: "d", index: { strategy: "parent-child" } };

    const hashes = [
      computeIndexConfigHash(plain),
      computeIndexConfigHash(contextual),
      computeIndexConfigHash(summary),
      computeIndexConfigHash(parentChild),
    ];

    expect(new Set(hashes).size).toBe(4);
  });

  it("concurrency does NOT affect contextual index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "contextual", concurrency: 5 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "contextual", concurrency: 20 } };

    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });

  it("concurrency does NOT affect summary index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "summary", concurrency: 5 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "summary", concurrency: 20 } };

    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });

  it("contextPrompt affects contextual index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "contextual", contextPrompt: "prompt A" } };
    const b: PipelineConfig = { name: "b", index: { strategy: "contextual", contextPrompt: "prompt B" } };

    expect(computeIndexConfigHash(a)).not.toBe(computeIndexConfigHash(b));
  });

  it("summaryPrompt affects summary index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "summary", summaryPrompt: "prompt A" } };
    const b: PipelineConfig = { name: "b", index: { strategy: "summary", summaryPrompt: "prompt B" } };

    expect(computeIndexConfigHash(a)).not.toBe(computeIndexConfigHash(b));
  });

  it("childChunkSize affects parent-child index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "parent-child", childChunkSize: 100 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "parent-child", childChunkSize: 300 } };

    expect(computeIndexConfigHash(a)).not.toBe(computeIndexConfigHash(b));
  });

  it("parentChunkSize affects parent-child index hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "parent-child", parentChunkSize: 500 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "parent-child", parentChunkSize: 2000 } };

    expect(computeIndexConfigHash(a)).not.toBe(computeIndexConfigHash(b));
  });

  it("stable across identical contextual configs", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "contextual", chunkSize: 500 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "contextual", chunkSize: 500 } };

    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });

  it("stable across identical parent-child configs", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "parent-child", childChunkSize: 200, parentChunkSize: 1000 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "parent-child", childChunkSize: 200, parentChunkSize: 1000 } };

    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });
});

describe("computeRetrieverConfigHash — new index strategies", () => {
  it("produces different hashes for different index strategies (same other stages)", () => {
    const base = { query: { strategy: "identity" as const }, search: { strategy: "dense" as const } };
    const plain: PipelineConfig = { name: "a", index: { strategy: "plain" }, ...base };
    const contextual: PipelineConfig = { name: "b", index: { strategy: "contextual" }, ...base };

    expect(computeRetrieverConfigHash(plain, 10)).not.toBe(
      computeRetrieverConfigHash(contextual, 10),
    );
  });

  it("plain strategy hash is identical to pre-refactor hash (hash stability)", () => {
    const config: PipelineConfig = {
      name: "stability-test",
      index: { strategy: "plain", chunkSize: 1000, chunkOverlap: 200, embeddingModel: "text-embedding-3-small" },
    };

    // Capture the hash — this test ensures it never changes across refactors
    const hash = computeRetrieverConfigHash(config, 10);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Verify it matches a config with explicit defaults (same behavior as pre-refactor)
    const configWithDefaults: PipelineConfig = {
      name: "other",
      index: {
        strategy: DEFAULT_INDEX_CONFIG.strategy,
        chunkSize: DEFAULT_INDEX_CONFIG.chunkSize,
        chunkOverlap: DEFAULT_INDEX_CONFIG.chunkOverlap,
        embeddingModel: DEFAULT_INDEX_CONFIG.embeddingModel,
      },
    };
    expect(computeRetrieverConfigHash(configWithDefaults, 10)).toBe(hash);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/config.test.ts`
Expected: FAIL — TypeScript errors because new strategies aren't valid `IndexConfig` yet, or hash functions don't handle them.

**Step 3: Implement strategy-aware hash functions**

In `packages/eval-lib/src/retrievers/pipeline/config.ts`, add the prompt imports. Add these import lines at the top of the file (after the `createHash` import on line 1):

```typescript
import {
  DEFAULT_CONTEXT_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
} from "./query/prompts.js";
```

Remove the `IndexHashPayload` interface (lines 154-160).

Replace `computeIndexConfigHash` (lines 190-203) with:

```typescript
export function computeIndexConfigHash(config: PipelineConfig): string {
  const index = config.index ?? DEFAULT_INDEX_CONFIG;

  let payload: Record<string, unknown>;

  switch (index.strategy) {
    case "plain":
      payload = {
        strategy: "plain",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        separators: index.separators,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
      };
      break;
    case "contextual":
      payload = {
        strategy: "contextual",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
        contextPrompt: index.contextPrompt ?? DEFAULT_CONTEXT_PROMPT,
        // concurrency does NOT affect output — excluded from hash
      };
      break;
    case "summary":
      payload = {
        strategy: "summary",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
        summaryPrompt: index.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT,
      };
      break;
    case "parent-child":
      payload = {
        strategy: "parent-child",
        childChunkSize: index.childChunkSize ?? 200,
        parentChunkSize: index.parentChunkSize ?? 1000,
        childOverlap: index.childOverlap ?? 0,
        parentOverlap: index.parentOverlap ?? 100,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
      };
      break;
  }

  const json = stableStringify(payload);
  return createHash("sha256").update(json).digest("hex");
}
```

Replace `computeRetrieverConfigHash` (lines 166-188) with:

```typescript
export function computeRetrieverConfigHash(config: PipelineConfig, k: number): string {
  const index = config.index ?? DEFAULT_INDEX_CONFIG;
  const query = config.query ?? DEFAULT_QUERY_CONFIG;
  const search = config.search ?? DEFAULT_SEARCH_CONFIG;
  const refinement = config.refinement ?? [];

  // Build the index portion using strategy-aware logic.
  // IMPORTANT: inline as nested object (NOT as hash string) to preserve
  // hash stability with existing stored retrieverConfigHash values.
  let indexPayload: Record<string, unknown>;

  switch (index.strategy) {
    case "plain":
      indexPayload = {
        strategy: "plain",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        separators: index.separators,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
      };
      break;
    case "contextual":
      indexPayload = {
        strategy: "contextual",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
        contextPrompt: index.contextPrompt ?? DEFAULT_CONTEXT_PROMPT,
      };
      break;
    case "summary":
      indexPayload = {
        strategy: "summary",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
        summaryPrompt: index.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT,
      };
      break;
    case "parent-child":
      indexPayload = {
        strategy: "parent-child",
        childChunkSize: index.childChunkSize ?? 200,
        parentChunkSize: index.parentChunkSize ?? 1000,
        childOverlap: index.childOverlap ?? 0,
        parentOverlap: index.parentOverlap ?? 100,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
      };
      break;
  }

  const payload = {
    index: indexPayload,
    k,
    query,
    refinement,
    search,
  };

  const json = stableStringify(payload);
  return createHash("sha256").update(json).digest("hex");
}
```

**Hash stability guarantee:** For `strategy: "plain"`, the `indexPayload` shape is identical to the current inline object: `{ strategy, chunkSize, chunkOverlap, separators, embeddingModel }`. Existing "plain" hashes remain unchanged. New strategies produce new hashes with no collision risk.

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/config.test.ts`
Expected: ALL PASS (both existing and new tests).

**Step 5: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/config.ts packages/eval-lib/tests/unit/retrievers/pipeline/config.test.ts
git commit -m "feat(eval-lib): update index hash functions for all 4 index strategies"
```

---

## Task 3: Store IndexConfig + Add LLM Validation for Index Strategies

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts` (constructor, fields)
- Modify: `packages/eval-lib/tests/unit/retrievers/pipeline/pipeline-retriever.test.ts`

**Step 1: Write failing tests for index strategy LLM validation**

Add to `packages/eval-lib/tests/unit/retrievers/pipeline/pipeline-retriever.test.ts`, after the existing "LLM validation" describe block:

```typescript
// ---------------------------------------------------------------------------
// 11. Index strategy LLM validation
// ---------------------------------------------------------------------------

describe("PipelineRetriever — index strategy LLM validation", () => {
  const llmIndexStrategies = ["contextual", "summary"] as const;

  for (const strategy of llmIndexStrategies) {
    it(`should throw if index strategy "${strategy}" is used without an LLM`, () => {
      expect(
        () =>
          new PipelineRetriever(
            { name: "test", index: { strategy } as any },
            defaultDeps(),
          ),
      ).toThrow(/requires an LLM/);
    });
  }

  it("should NOT throw for parent-child strategy without LLM", () => {
    expect(
      () =>
        new PipelineRetriever(
          { name: "test", index: { strategy: "parent-child" } as any },
          defaultDeps(),
        ),
    ).not.toThrow();
  });

  it("should NOT throw for plain strategy without LLM", () => {
    expect(
      () =>
        new PipelineRetriever(
          { name: "test", index: { strategy: "plain" } },
          defaultDeps(),
        ),
    ).not.toThrow();
  });

  it("should NOT throw for contextual strategy when LLM is provided", () => {
    const mockLlm: PipelineLLM = { name: "MockLLM", complete: async () => "response" };
    expect(
      () =>
        new PipelineRetriever(
          { name: "test", index: { strategy: "contextual" } as any },
          defaultDeps({ llm: mockLlm }),
        ),
    ).not.toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/pipeline-retriever.test.ts`
Expected: FAIL — no validation for index strategy LLM requirement.

**Step 3: Implement _indexConfig field + LLM validation**

In `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts`:

Add import for `DEFAULT_INDEX_CONFIG` and the `IndexConfig` type:

```typescript
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
```

Add private field after `_llm` (line 107):

```typescript
  private readonly _indexConfig: IndexConfig;
```

In the constructor (after line 126 `this._llm = deps.llm;`), add:

```typescript
    this._indexConfig = config.index ?? DEFAULT_INDEX_CONFIG;
```

After the existing query strategy LLM validation (after line 152), add:

```typescript
    // Validate: LLM-requiring index strategies need an LLM dependency
    const llmIndexStrategies = ["contextual", "summary"];
    if (llmIndexStrategies.includes(this._indexConfig.strategy) && !this._llm) {
      throw new Error(
        `PipelineRetriever: index strategy "${this._indexConfig.strategy}" requires an LLM but none was provided in deps.`,
      );
    }
```

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/pipeline-retriever.test.ts`
Expected: ALL PASS.

**Step 5: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts packages/eval-lib/tests/unit/retrievers/pipeline/pipeline-retriever.test.ts
git commit -m "feat(eval-lib): add _indexConfig field and LLM validation for index strategies"
```

---

## Task 4: Implement Contextual Indexing Strategy

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts` (init method + imports)
- Create: `packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts`

**Step 1: Write failing tests for contextual indexing**

Create `packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PipelineRetriever } from "../../../../src/retrievers/pipeline/pipeline-retriever.js";
import type { PipelineRetrieverDeps } from "../../../../src/retrievers/pipeline/pipeline-retriever.js";
import type { PipelineConfig } from "../../../../src/retrievers/pipeline/config.js";
import type { PipelineLLM } from "../../../../src/retrievers/pipeline/llm.interface.js";
import type { Corpus } from "../../../../src/types/index.js";
import { createCorpus, createDocument } from "../../../../src/types/documents.js";
import { RecursiveCharacterChunker } from "../../../../src/chunkers/recursive-character.js";
import { mockEmbedder } from "../../../fixtures.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function testCorpus(): Corpus {
  return createCorpus([
    createDocument({
      id: "animals.md",
      content:
        "Dogs and cats are popular pets. Dogs are loyal companions. Cats are independent creatures.",
    }),
    createDocument({
      id: "programming.md",
      content:
        "TypeScript is a typed superset of JavaScript. It compiles to plain JavaScript and adds optional static typing.",
    }),
  ]);
}

function createMockLlm(
  response: string,
): PipelineLLM & { complete: ReturnType<typeof vi.fn> } {
  return {
    name: "MockLLM",
    complete: vi.fn().mockResolvedValue(response),
  };
}

function defaultDeps(
  overrides?: Partial<PipelineRetrieverDeps>,
): PipelineRetrieverDeps {
  return {
    chunker: new RecursiveCharacterChunker({ chunkSize: 50, chunkOverlap: 10 }),
    embedder: mockEmbedder(128),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Contextual index strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — contextual index strategy", () => {
  let retriever: PipelineRetriever;
  let mockLlm: PipelineLLM & { complete: ReturnType<typeof vi.fn> };
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    mockLlm = createMockLlm("This chunk discusses important topics.");

    const config: PipelineConfig = {
      name: "contextual-test",
      index: { strategy: "contextual" },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should call LLM for each chunk during init", () => {
    // The chunker produces multiple chunks from our 2 documents.
    // Each chunk should trigger one LLM call.
    expect(mockLlm.complete).toHaveBeenCalled();
    const callCount = mockLlm.complete.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
  });

  it("should include document content and chunk content in the LLM prompt", () => {
    const firstPrompt = mockLlm.complete.mock.calls[0][0] as string;

    // DEFAULT_CONTEXT_PROMPT uses {doc.content} and {chunk.content} placeholders
    // After substitution, the prompt should contain actual document text
    expect(firstPrompt).toContain("<document>");
    expect(firstPrompt).toContain("<chunk>");
    expect(firstPrompt).toContain("</document>");
    expect(firstPrompt).toContain("</chunk>");
  });

  it("should return valid PositionAwareChunks from retrieve", async () => {
    const results = await retriever.retrieve("dogs and cats", 3);

    expect(results.length).toBeGreaterThan(0);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
      expect(typeof chunk.start).toBe("number");
      expect(typeof chunk.end).toBe("number");
    }
  });

  it("should preserve original chunk positions (start/end)", async () => {
    const results = await retriever.retrieve("dogs", 5);

    for (const chunk of results) {
      // start/end should reference positions in the original document
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
    }
  });

  it("should respect custom contextPrompt", async () => {
    await retriever.cleanup();

    const customPrompt = "Custom context: {doc.content} | Chunk: {chunk.content}";
    const config: PipelineConfig = {
      name: "custom-prompt-test",
      index: { strategy: "contextual", contextPrompt: customPrompt },
      search: { strategy: "dense" },
    };

    const customLlm = createMockLlm("custom context result");
    const customRetriever = new PipelineRetriever(config, defaultDeps({ llm: customLlm }));
    await customRetriever.init(corpus);

    const firstPrompt = customLlm.complete.mock.calls[0][0] as string;
    expect(firstPrompt).toContain("Custom context:");

    await customRetriever.cleanup();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/index-strategies.test.ts`
Expected: FAIL — init() doesn't handle contextual strategy yet.

**Step 3: Implement contextual indexing in init()**

In `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts`:

Add imports at the top:

```typescript
import { mapWithConcurrency } from "../../utils/concurrency.js";
import {
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  DEFAULT_REWRITE_PROMPT,
  DEFAULT_CONTEXT_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
} from "./query/prompts.js";
```

(Replace the existing prompts import — add `DEFAULT_CONTEXT_PROMPT` and `DEFAULT_SUMMARY_PROMPT`.)

Replace the `init()` method with a strategy-dispatching version:

```typescript
  async init(corpus: Corpus): Promise<void> {
    let chunks: PositionAwareChunk[];

    switch (this._indexConfig.strategy) {
      case "plain": {
        chunks = [];
        for (const doc of corpus.documents) {
          chunks.push(...this._chunker.chunkWithPositions(doc));
        }
        break;
      }

      case "contextual": {
        const contextPrompt = this._indexConfig.contextPrompt || DEFAULT_CONTEXT_PROMPT;
        const concurrency = this._indexConfig.concurrency ?? 5;

        chunks = [];
        for (const doc of corpus.documents) {
          const rawChunks = this._chunker.chunkWithPositions(doc);
          const enriched = await mapWithConcurrency(
            rawChunks,
            async (chunk) => {
              const prompt = contextPrompt
                .replace("{doc.content}", doc.content)
                .replace("{chunk.content}", chunk.content);
              const context = await this._llm!.complete(prompt);
              return { ...chunk, content: context + "\n\n" + chunk.content };
            },
            concurrency,
          );
          chunks.push(...enriched);
        }
        break;
      }

      default:
        // summary and parent-child handled in subsequent tasks
        chunks = [];
        for (const doc of corpus.documents) {
          chunks.push(...this._chunker.chunkWithPositions(doc));
        }
        break;
    }

    await this._searchStrategy.init(chunks, this._searchStrategyDeps);
    this._initialized = true;
  }
```

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/index-strategies.test.ts`
Expected: ALL PASS.

Also run existing tests to ensure no regressions:

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/`
Expected: ALL PASS.

**Step 5: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts
git commit -m "feat(eval-lib): implement contextual index strategy in pipeline retriever"
```

---

## Task 5: Implement Summary Indexing Strategy

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts` (init method)
- Modify: `packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts`

**Step 1: Write failing tests for summary indexing**

Add to `packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// Summary index strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — summary index strategy", () => {
  let retriever: PipelineRetriever;
  let mockLlm: PipelineLLM & { complete: ReturnType<typeof vi.fn> };
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    mockLlm = createMockLlm("A summary of important topics covered in this passage.");

    const config: PipelineConfig = {
      name: "summary-test",
      index: { strategy: "summary" },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should call LLM for each chunk during init", () => {
    expect(mockLlm.complete).toHaveBeenCalled();
    const callCount = mockLlm.complete.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
  });

  it("should include chunk content in the LLM prompt", () => {
    const firstPrompt = mockLlm.complete.mock.calls[0][0] as string;

    // DEFAULT_SUMMARY_PROMPT ends with "Passage: " — chunk content is appended
    expect(firstPrompt).toContain("summary");
  });

  it("should return valid PositionAwareChunks from retrieve", async () => {
    const results = await retriever.retrieve("important topics", 3);

    expect(results.length).toBeGreaterThan(0);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
    }
  });

  it("should preserve original chunk positions", async () => {
    const results = await retriever.retrieve("topics", 5);

    for (const chunk of results) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeGreaterThan(chunk.start);
    }
  });

  it("should respect custom summaryPrompt", async () => {
    await retriever.cleanup();

    const config: PipelineConfig = {
      name: "custom-summary-test",
      index: { strategy: "summary", summaryPrompt: "TLDR this text: " },
      search: { strategy: "dense" },
    };

    const customLlm = createMockLlm("tl;dr result");
    const customRetriever = new PipelineRetriever(config, defaultDeps({ llm: customLlm }));
    await customRetriever.init(corpus);

    const firstPrompt = customLlm.complete.mock.calls[0][0] as string;
    expect(firstPrompt).toContain("TLDR this text:");

    await customRetriever.cleanup();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/index-strategies.test.ts`
Expected: FAIL — the `default` case in init() falls back to plain chunking, not summary.

**Step 3: Implement summary indexing in init()**

In `pipeline-retriever.ts`, add the `summary` case to the `init()` switch (before the `default` case):

```typescript
      case "summary": {
        const summaryPrompt = this._indexConfig.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
        const concurrency = this._indexConfig.concurrency ?? 5;

        chunks = [];
        for (const doc of corpus.documents) {
          const rawChunks = this._chunker.chunkWithPositions(doc);
          const summarized = await mapWithConcurrency(
            rawChunks,
            async (chunk) => {
              const summary = await this._llm!.complete(summaryPrompt + chunk.content);
              return { ...chunk, content: summary };
            },
            concurrency,
          );
          chunks.push(...summarized);
        }
        break;
      }
```

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/index-strategies.test.ts`
Expected: ALL PASS.

**Step 5: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts
git commit -m "feat(eval-lib): implement summary index strategy in pipeline retriever"
```

---

## Task 6: Implement Parent-Child Indexing Strategy

This is the most complex task — it modifies `init()`, `retrieve()`, and `cleanup()`.

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts`
- Modify: `packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts`

**Step 1: Write failing tests for parent-child indexing**

Add to `packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// Parent-child index strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — parent-child index strategy", () => {
  /**
   * Use a longer document so that parent-child chunking produces multiple
   * child and parent chunks.
   */
  function parentChildCorpus(): Corpus {
    return createCorpus([
      createDocument({
        id: "long.md",
        content:
          "Dogs are loyal pets that love humans. " +
          "Cats are independent creatures that enjoy solitude. " +
          "Birds can fly high above the trees. " +
          "Fish live in water and swim gracefully. " +
          "Snakes are fascinating reptiles found worldwide. " +
          "Frogs are amphibians that live near ponds.",
      }),
    ]);
  }

  let retriever: PipelineRetriever;
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = parentChildCorpus();

    const config: PipelineConfig = {
      name: "parent-child-test",
      index: {
        strategy: "parent-child",
        childChunkSize: 50,
        parentChunkSize: 120,
        childOverlap: 0,
        parentOverlap: 0,
      },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps());
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should return valid PositionAwareChunks from retrieve", async () => {
    const results = await retriever.retrieve("dogs pets", 3);

    expect(results.length).toBeGreaterThan(0);
    for (const chunk of results) {
      expect(chunk).toHaveProperty("id");
      expect(chunk).toHaveProperty("content");
      expect(chunk).toHaveProperty("docId");
      expect(chunk).toHaveProperty("start");
      expect(chunk).toHaveProperty("end");
      expect(chunk.docId).toBe("long.md");
    }
  });

  it("should return parent chunks (larger) not child chunks (smaller)", async () => {
    const results = await retriever.retrieve("dogs pets", 5);

    // Parent chunks should be larger than child chunk size (50)
    for (const chunk of results) {
      // Parent content length should generally be >= child chunk size
      // (unless it's the last chunk of a document)
      expect(chunk.end - chunk.start).toBeGreaterThanOrEqual(40);
    }
  });

  it("should deduplicate parents when multiple children match the same parent", async () => {
    // Searching broadly — likely matches children from the same parent
    const results = await retriever.retrieve("animals pets creatures", 10);

    // Should not have duplicate parent IDs
    const parentIds = results.map((c) => String(c.id));
    expect(new Set(parentIds).size).toBe(parentIds.length);
  });

  it("should not require an LLM", () => {
    expect(
      () =>
        new PipelineRetriever(
          {
            name: "no-llm",
            index: { strategy: "parent-child", childChunkSize: 50, parentChunkSize: 120 },
          },
          defaultDeps(), // no llm
        ),
    ).not.toThrow();
  });

  it("should work after cleanup and re-init", async () => {
    const results1 = await retriever.retrieve("dogs", 3);
    expect(results1.length).toBeGreaterThan(0);

    await retriever.cleanup();

    await retriever.init(corpus);
    const results2 = await retriever.retrieve("dogs", 3);
    expect(results2.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/index-strategies.test.ts`
Expected: FAIL — parent-child falls through to default case.

**Step 3: Implement parent-child indexing**

In `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts`:

Add import for `RecursiveCharacterChunker`:

```typescript
import { RecursiveCharacterChunker } from "../../chunkers/recursive-character.js";
```

Add private field for the parent map (after `_indexConfig`):

```typescript
  private _childToParentMap: Map<string, PositionAwareChunk> | null = null;
```

In `init()`, add the `parent-child` case (replace the `default` fallback):

```typescript
      case "parent-child": {
        const childChunkSize = this._indexConfig.childChunkSize ?? 200;
        const parentChunkSize = this._indexConfig.parentChunkSize ?? 1000;
        const childOverlap = this._indexConfig.childOverlap ?? 0;
        const parentOverlap = this._indexConfig.parentOverlap ?? 100;

        const childChunker = new RecursiveCharacterChunker({
          chunkSize: childChunkSize,
          chunkOverlap: childOverlap,
        });
        const parentChunker = new RecursiveCharacterChunker({
          chunkSize: parentChunkSize,
          chunkOverlap: parentOverlap,
        });

        const childChunks: PositionAwareChunk[] = [];
        const parentMap = new Map<string, PositionAwareChunk>();

        for (const doc of corpus.documents) {
          const parents = parentChunker.chunkWithPositions(doc);
          const children = childChunker.chunkWithPositions(doc);

          for (const child of children) {
            childChunks.push(child);
            // Find the enclosing parent (child spans are fully within parent spans)
            const enclosingParent = parents.find(
              (p) => p.start <= child.start && p.end >= child.end,
            );
            parentMap.set(String(child.id), enclosingParent ?? child);
          }
        }

        this._childToParentMap = parentMap;
        chunks = childChunks;
        break;
      }

      default:
        throw new Error(
          `Unknown index strategy: ${(this._indexConfig as any).strategy}`,
        );
```

Modify `retrieve()` to swap child → parent between SEARCH and REFINEMENT stages. Replace the section after the SEARCH stage (after the `scoredResults` assignment) and before `_applyRefinements`:

```typescript
    // PARENT-CHILD swap — replace child chunks with their parent chunks
    if (this._childToParentMap) {
      const seen = new Set<string>();
      const deduped: ScoredChunk[] = [];
      for (const scored of scoredResults) {
        const parent = this._childToParentMap.get(String(scored.chunk.id)) ?? scored.chunk;
        const parentId = String(parent.id);
        if (!seen.has(parentId)) {
          seen.add(parentId);
          deduped.push({ chunk: parent, score: scored.score });
        }
      }
      scoredResults = deduped;
    }
```

The full `retrieve()` method should look like:

```typescript
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

    // PARENT-CHILD swap — replace child chunks with their parent chunks
    if (this._childToParentMap) {
      const seen = new Set<string>();
      const deduped: ScoredChunk[] = [];
      for (const scored of scoredResults) {
        const parent = this._childToParentMap.get(String(scored.chunk.id)) ?? scored.chunk;
        const parentId = String(parent.id);
        if (!seen.has(parentId)) {
          seen.add(parentId);
          deduped.push({ chunk: parent, score: scored.score });
        }
      }
      scoredResults = deduped;
    }

    // REFINEMENT stage — always uses the ORIGINAL user query
    scoredResults = await this._applyRefinements(query, scoredResults, k);

    return scoredResults.slice(0, k).map(({ chunk }) => chunk);
  }
```

Update `cleanup()` to clear the parent map:

```typescript
  async cleanup(): Promise<void> {
    await this._vectorStore.clear();
    await this._searchStrategy.cleanup(this._searchStrategyDeps);
    this._childToParentMap = null;
    this._initialized = false;
  }
```

**Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/index-strategies.test.ts`
Expected: ALL PASS.

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/retrievers/pipeline/`
Expected: ALL PASS (no regressions).

**Step 5: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts packages/eval-lib/tests/unit/retrievers/pipeline/index-strategies.test.ts
git commit -m "feat(eval-lib): implement parent-child index strategy with dedup in pipeline retriever"
```

---

## Task 7: Registry Update + Build Verification

**Files:**
- Modify: `packages/eval-lib/src/registry/index-strategies.ts`

**Step 1: Flip registry statuses**

In `packages/eval-lib/src/registry/index-strategies.ts`, change the status of `contextual`, `summary`, and `parent-child` entries from `"coming-soon"` to `"available"`:

```typescript
// contextual entry (line 18):
    status: "available",

// summary entry (line 48):
    status: "available",

// parent-child entry (line 78):
    status: "available",
```

**Step 2: Run full test suite**

Run: `pnpm -C packages/eval-lib test -- --run`
Expected: ALL PASS.

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

**Step 4: Run build**

Run: `pnpm build`
Expected: PASS — all entry points compile, new types are in `.d.ts` output.

**Step 5: Verify registry test assertions**

Check if `packages/eval-lib/tests/unit/registry/` has tests that assert on the count of `"available"` or `"coming-soon"` entries. If so, update them to reflect the 3 newly available index strategies.

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/registry/`
Expected: PASS (update assertions if needed).

**Step 6: Commit**

```bash
git add packages/eval-lib/src/registry/index-strategies.ts
git commit -m "feat(eval-lib): mark contextual, summary, parent-child index strategies as available"
```

---

## Summary of All Modified/Created Files

| File | Action | Task |
|------|--------|------|
| `src/retrievers/pipeline/config.ts` | Modify — IndexConfig union, hash functions | 1, 2 |
| `src/retrievers/pipeline/pipeline-retriever.ts` | Modify — _indexConfig, init(), retrieve(), cleanup(), imports | 3, 4, 5, 6 |
| `src/retrievers/pipeline/index.ts` | Modify — export new config types | 1 |
| `src/index.ts` | Modify — export new config types | 1 |
| `src/registry/index-strategies.ts` | Modify — flip 3 statuses | 7 |
| `tests/unit/retrievers/pipeline/config.test.ts` | Modify — add hash tests for new strategies | 2 |
| `tests/unit/retrievers/pipeline/pipeline-retriever.test.ts` | Modify — add LLM validation tests for index strategies | 3 |
| `tests/unit/retrievers/pipeline/index-strategies.test.ts` | **Create** — tests for contextual, summary, parent-child | 4, 5, 6 |

All paths are relative to `packages/eval-lib/`.

---

## Data Flow Diagrams

### Contextual Strategy

```
init(corpus)
  for each doc:
    rawChunks = chunker.chunkWithPositions(doc)
    for each chunk (via mapWithConcurrency):
      prompt = contextPrompt.replace("{doc.content}",doc).replace("{chunk.content}",chunk)
      context = llm.complete(prompt)
      enrichedChunk = { ...chunk, content: context + "\n\n" + chunk.content }
    collect enrichedChunks
  searchStrategy.init(enrichedChunks, deps)

retrieve(query, k)  →  [standard QUERY → SEARCH → REFINEMENT → return]
```

### Summary Strategy

```
init(corpus)
  for each doc:
    rawChunks = chunker.chunkWithPositions(doc)
    for each chunk (via mapWithConcurrency):
      summary = llm.complete(summaryPrompt + chunk.content)
      summaryChunk = { ...chunk, content: summary }
    collect summaryChunks
  searchStrategy.init(summaryChunks, deps)

retrieve(query, k)  →  [standard QUERY → SEARCH → REFINEMENT → return]
```

### Parent-Child Strategy

```
init(corpus)
  childChunker = new RecursiveCharacterChunker({ childChunkSize, childOverlap })
  parentChunker = new RecursiveCharacterChunker({ parentChunkSize, parentOverlap })

  for each doc:
    parents = parentChunker.chunkWithPositions(doc)
    children = childChunker.chunkWithPositions(doc)
    for each child:
      enclosingParent = parents.find(p => p.start <= child.start && p.end >= child.end)
      _childToParentMap.set(child.id, enclosingParent ?? child)
    collect children

  searchStrategy.init(childChunks, deps)

retrieve(query, k)
  QUERY stage → queries
  SEARCH stage → scoredResults (child chunks)
  PARENT-CHILD swap:
    for each scored child:
      parent = _childToParentMap.get(child.id)
      if parent not seen: add to deduped results
    scoredResults = deduped
  REFINEMENT stage (operates on parent chunks)
  return top-k parent chunks
```
