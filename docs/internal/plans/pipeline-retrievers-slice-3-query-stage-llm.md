# Slice 3 — Query Stage + LLM Interface — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 4 LLM-powered query strategies (HyDE, multi-query, step-back, rewrite) and the `PipelineLLM` interface that powers them, expanding the experiment grid from 144 → ~720 configs.

**Architecture:** Extend the QUERY stage of the existing 4-stage `PipelineRetriever` (INDEX → QUERY → SEARCH → REFINEMENT). Add a provider-agnostic `PipelineLLM` interface + OpenAI implementation. Extend the `QueryConfig` discriminated union with 4 new variants. Add a generalized multi-list RRF fusion function for cross-query result merging. All changes are in `packages/eval-lib/`.

**Tech Stack:** TypeScript, Vitest, tsup, pnpm workspace. `openai` SDK (optional dep, structural typing).

---

## Ground Truth — Current State (verified against source)

These are the exact current signatures and file contents that this plan modifies. Each task references specific lines.

**`PipelineRetrieverDeps`** (`src/retrievers/pipeline/pipeline-retriever.ts:26-38`):
```typescript
export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  readonly embeddingBatchSize?: number;
}
```

**`QueryConfig`** (`src/retrievers/pipeline/config.ts:37-45`):
```typescript
export interface IdentityQueryConfig {
  readonly strategy: "identity";
}
export type QueryConfig = IdentityQueryConfig;
export const DEFAULT_QUERY_CONFIG: QueryConfig = { strategy: "identity" } as const;
```

**`PipelineRetriever.retrieve()`** (`src/retrievers/pipeline/pipeline-retriever.ts:151-170`):
```typescript
async retrieve(query: string, k: number): Promise<PositionAwareChunk[]> {
  if (!this._initialized) throw ...;
  const processedQuery = query;                    // ← identity passthrough
  let scoredResults = await this._searchStrategy.search(processedQuery, k, this._searchStrategyDeps);
  scoredResults = await this._applyRefinements(processedQuery, scoredResults, k);
  return scoredResults.slice(0, k).map(({ chunk }) => chunk);
}
```

**`reciprocalRankFusion`** (`src/retrievers/pipeline/search/fusion.ts:104-136`):
Hardcoded for exactly 2 lists (`denseResults`, `sparseResults`). Cannot accept N lists. A new `rrfFuseMultiple` function is needed for cross-query fusion.

**Registry**: `src/registry/query-strategies.ts` has 4 coming-soon entries: `hyde`, `multi-query`, `step-back`, `rewrite`. `src/registry/presets.ts` has 8 coming-soon presets that only need query strategies (use plain index + available search/refinement).

**Test patterns** (`tests/unit/retrievers/pipeline/pipeline-retriever.test.ts`):
- `mockEmbedder(128)` from `tests/fixtures.ts` — hash-based deterministic embeddings
- `RecursiveCharacterChunker({ chunkSize: 50, chunkOverlap: 10 })` — real chunker
- `testCorpus()` — 3 docs (animals, programming, cooking)
- `defaultDeps(overrides?)` — factory with `Partial<PipelineRetrieverDeps>` spread

---

## File Overview

### New Files
| # | File | Purpose |
|---|------|---------|
| 1 | `src/retrievers/pipeline/llm.interface.ts` | `PipelineLLM` interface |
| 2 | `src/retrievers/pipeline/llm-openai.ts` | `OpenAIPipelineLLM` class |
| 3 | `src/retrievers/pipeline/query/prompts.ts` | Default prompt constants |
| 4 | `src/retrievers/pipeline/query/utils.ts` | `parseVariants()` helper |
| 5 | `src/retrievers/pipeline/query/index.ts` | Query barrel exports |
| 6 | `src/pipeline/llm-openai.ts` | Entry point wrapper for tsup |
| 7 | `tests/unit/retrievers/pipeline/llm-openai.test.ts` | OpenAIPipelineLLM tests |
| 8 | `tests/unit/retrievers/pipeline/query-strategies.test.ts` | Query strategy integration tests |

### Modified Files
| # | File | Changes |
|---|------|---------|
| 1 | `src/retrievers/pipeline/config.ts` | Add 4 query config interfaces, extend `QueryConfig` union |
| 2 | `src/retrievers/pipeline/pipeline-retriever.ts` | Add `_queryConfig`, `_llm` fields; LLM validation; `_processQuery()`; update `retrieve()` |
| 3 | `src/retrievers/pipeline/search/fusion.ts` | Add `rrfFuseMultiple()` function |
| 4 | `src/retrievers/pipeline/search/index.ts` | Re-export `rrfFuseMultiple` |
| 5 | `src/retrievers/pipeline/index.ts` | Re-export new types + `rrfFuseMultiple` |
| 6 | `src/retrievers/index.ts` | Re-export `PipelineLLM` type + new query config types |
| 7 | `src/index.ts` | Re-export `PipelineLLM` type + new query config types |
| 8 | `src/experiments/presets.ts` | Add `llm?` to `PipelinePresetDeps` |
| 9 | `src/registry/query-strategies.ts` | Flip 4 statuses to `"available"` |
| 10 | `src/registry/presets.ts` | Flip 8 preset statuses, remove `comingSoonConfig()` casts |
| 11 | `tsup.config.ts` | Add `src/pipeline/llm-openai.ts` entry point |
| 12 | `package.json` | Add `./pipeline/llm-openai` export |
| 13 | `tests/unit/retrievers/pipeline/search/fusion.test.ts` | Add `rrfFuseMultiple` tests |

---

## Task 1: PipelineLLM Interface

**Files:**
- Create: `packages/eval-lib/src/retrievers/pipeline/llm.interface.ts`

**Step 1: Create the interface file**

```typescript
// packages/eval-lib/src/retrievers/pipeline/llm.interface.ts

/**
 * Minimal LLM interface for pipeline stages.
 * Provider-agnostic — callers provide their own implementation.
 */
export interface PipelineLLM {
  readonly name: string;
  complete(prompt: string): Promise<string>;
}
```

**Step 2: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/llm.interface.ts
git commit -m "feat(eval-lib): add PipelineLLM interface for query stage"
```

---

## Task 2: Extend QueryConfig Union

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/config.ts:37-45`

**Step 1: Add the 4 new query config interfaces and extend the union**

In `config.ts`, replace the QueryConfig section (lines 37-45) with:

```typescript
// --- Stage 2: QUERY ---------------------------------------------------------

export interface IdentityQueryConfig {
  readonly strategy: "identity";
}

export interface HydeQueryConfig {
  readonly strategy: "hyde";
  /** Custom prompt for generating hypothetical documents. */
  readonly hydePrompt?: string;
  /**
   * Number of hypothetical documents to generate.
   * Each produces a separate search query whose results are fused via RRF.
   * @default 1
   */
  readonly numHypotheticalDocs?: number;
}

export interface MultiQueryConfig {
  readonly strategy: "multi-query";
  /**
   * Number of query variants to generate.
   * @default 3
   */
  readonly numQueries?: number;
  /** Custom prompt for generating query variants. Use `{n}` as placeholder for count. */
  readonly generationPrompt?: string;
}

export interface StepBackQueryConfig {
  readonly strategy: "step-back";
  /** Custom prompt for generating the abstract step-back question. */
  readonly stepBackPrompt?: string;
  /**
   * Whether to also search with the original query.
   * @default true
   */
  readonly includeOriginal?: boolean;
}

export interface RewriteQueryConfig {
  readonly strategy: "rewrite";
  /** Custom prompt for rewriting the query. */
  readonly rewritePrompt?: string;
}

export type QueryConfig =
  | IdentityQueryConfig
  | HydeQueryConfig
  | MultiQueryConfig
  | StepBackQueryConfig
  | RewriteQueryConfig;

export const DEFAULT_QUERY_CONFIG: QueryConfig = {
  strategy: "identity",
} as const;
```

**Step 2: Run typecheck to verify no regressions**

Run: `pnpm -C packages/eval-lib exec tsc --noEmit`
Expected: PASS (existing code only uses `IdentityQueryConfig`, new types are additive)

**Step 3: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/config.ts
git commit -m "feat(eval-lib): extend QueryConfig union with hyde, multi-query, step-back, rewrite"
```

---

## Task 3: Default Prompts + parseVariants Utility

**Files:**
- Create: `packages/eval-lib/src/retrievers/pipeline/query/prompts.ts`
- Create: `packages/eval-lib/src/retrievers/pipeline/query/utils.ts`
- Create: `packages/eval-lib/src/retrievers/pipeline/query/index.ts`
- Create: `packages/eval-lib/tests/unit/retrievers/pipeline/query/parse-variants.test.ts`

**Step 1: Create the prompts file**

```typescript
// packages/eval-lib/src/retrievers/pipeline/query/prompts.ts

export const DEFAULT_HYDE_PROMPT =
  `Write a short passage (100-200 words) that would answer the following question. Do not include the question itself, just the answer passage.\n\nQuestion: `;

export const DEFAULT_MULTI_QUERY_PROMPT =
  `Generate {n} different search queries that would help find information to answer the following question. Return one query per line, no numbering.\n\nQuestion: `;

export const DEFAULT_STEP_BACK_PROMPT =
  `Given the following question, generate a more general, abstract version that would retrieve broader background knowledge. Return only the abstract question.\n\nOriginal question: `;

export const DEFAULT_REWRITE_PROMPT =
  `Rewrite the following question to be more precise and optimized for document retrieval. Return only the rewritten question.\n\nOriginal question: `;

// Used by Summary index strategy (Slice 4)
export const DEFAULT_SUMMARY_PROMPT =
  `Write a concise summary (2-3 sentences) of the following text passage. Focus on the key information that would help someone decide if this passage is relevant to their question.\n\nPassage: `;

// Used by Contextual index strategy (Slice 4)
export const DEFAULT_CONTEXT_PROMPT =
  `<document>\n{doc.content}\n</document>\n\nHere is the chunk we want to situate within the whole document:\n<chunk>\n{chunk.content}\n</chunk>\n\nPlease give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;
```

**Step 2: Write the failing test for parseVariants**

```typescript
// packages/eval-lib/tests/unit/retrievers/pipeline/query/parse-variants.test.ts
import { describe, it, expect } from "vitest";
import { parseVariants } from "../../../../../src/retrievers/pipeline/query/utils.js";

describe("parseVariants", () => {
  it("should split newline-separated queries", () => {
    const text = "query about dogs\nquery about cats\nquery about birds";
    expect(parseVariants(text, 3)).toEqual([
      "query about dogs",
      "query about cats",
      "query about birds",
    ]);
  });

  it("should strip numbering prefixes (dot and paren styles)", () => {
    const text = "1. first query\n2. second query\n3. third query";
    expect(parseVariants(text, 3)).toEqual([
      "first query",
      "second query",
      "third query",
    ]);

    const parenStyle = "1) first query\n2) second query\n3) third query";
    expect(parseVariants(parenStyle, 3)).toEqual([
      "first query",
      "second query",
      "third query",
    ]);
  });

  it("should filter empty lines", () => {
    const text = "query one\n\n\nquery two\n\nquery three";
    expect(parseVariants(text, 3)).toEqual([
      "query one",
      "query two",
      "query three",
    ]);
  });

  it("should limit to expectedCount", () => {
    const text = "q1\nq2\nq3\nq4\nq5";
    expect(parseVariants(text, 3)).toEqual(["q1", "q2", "q3"]);
  });

  it("should handle fewer results than expected", () => {
    const text = "only one";
    expect(parseVariants(text, 3)).toEqual(["only one"]);
  });

  it("should trim whitespace from each line", () => {
    const text = "  query one  \n  query two  ";
    expect(parseVariants(text, 2)).toEqual(["query one", "query two"]);
  });

  it("should handle dash-prefixed lines", () => {
    const text = "- first query\n- second query";
    expect(parseVariants(text, 2)).toEqual(["first query", "second query"]);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/query/parse-variants.test.ts`
Expected: FAIL — module `query/utils.js` does not exist

**Step 4: Implement parseVariants**

```typescript
// packages/eval-lib/src/retrievers/pipeline/query/utils.ts

/**
 * Parse newline-separated query variants from LLM output.
 * Strips numbering prefixes (e.g. "1.", "1)", "- ") and empty lines.
 */
export function parseVariants(text: string, expectedCount: number): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|-\s*)/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, expectedCount);
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/query/parse-variants.test.ts`
Expected: PASS (all 7 tests)

**Step 6: Create the query barrel**

```typescript
// packages/eval-lib/src/retrievers/pipeline/query/index.ts
export {
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  DEFAULT_REWRITE_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_CONTEXT_PROMPT,
} from "./prompts.js";
export { parseVariants } from "./utils.js";
```

**Step 7: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/query/ packages/eval-lib/tests/unit/retrievers/pipeline/query/
git commit -m "feat(eval-lib): add query stage prompts and parseVariants utility"
```

---

## Task 4: Generalized Cross-Query RRF Fusion

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/search/fusion.ts` (append after line 136)
- Modify: `packages/eval-lib/src/retrievers/pipeline/search/index.ts` (add re-export)
- Modify: `packages/eval-lib/tests/unit/retrievers/pipeline/search/fusion.test.ts` (add tests)

**Step 1: Write the failing tests**

Append to the existing `fusion.test.ts` file, after the `reciprocalRankFusion` describe block:

```typescript
// --- Add these imports at the top of the file ---
// import { rrfFuseMultiple } from ".../fusion.js";

// --- Add this describe block at the end ---

describe("rrfFuseMultiple", () => {
  it("should fuse results from multiple ranked lists", () => {
    const list1: ScoredChunk[] = [scored("A", 1.0), scored("B", 0.8)];
    const list2: ScoredChunk[] = [scored("B", 1.0), scored("C", 0.7)];
    const list3: ScoredChunk[] = [scored("C", 1.0), scored("A", 0.5)];

    const result = rrfFuseMultiple([list1, list2, list3]);

    // B appears in list1 (rank 2) and list2 (rank 1) → highest combined RRF
    // A appears in list1 (rank 1) and list3 (rank 2)
    // C appears in list2 (rank 2) and list3 (rank 1)
    expect(result.length).toBe(3);
    // All three should have similar scores since each appears in exactly 2 lists
    // but at different ranks
    const ids = result.map((r) => String(r.chunk.id));
    expect(ids).toContain("A");
    expect(ids).toContain("B");
    expect(ids).toContain("C");
  });

  it("should handle a single list (identity)", () => {
    const list: ScoredChunk[] = [scored("X", 1.0), scored("Y", 0.5)];
    const result = rrfFuseMultiple([list]);

    expect(result.length).toBe(2);
    expect(String(result[0].chunk.id)).toBe("X");
    expect(String(result[1].chunk.id)).toBe("Y");
  });

  it("should handle empty input", () => {
    expect(rrfFuseMultiple([])).toEqual([]);
  });

  it("should handle lists with no overlap", () => {
    const list1: ScoredChunk[] = [scored("A", 1.0)];
    const list2: ScoredChunk[] = [scored("B", 1.0)];
    const result = rrfFuseMultiple([list1, list2]);

    expect(result.length).toBe(2);
    // Both at rank 1 → same RRF score → stable sort order
    expect(result[0].score).toBeCloseTo(result[1].score);
  });

  it("should rank chunks appearing in more lists higher", () => {
    const list1: ScoredChunk[] = [scored("A", 1.0), scored("B", 0.5)];
    const list2: ScoredChunk[] = [scored("A", 1.0), scored("C", 0.5)];
    const list3: ScoredChunk[] = [scored("A", 1.0), scored("D", 0.5)];
    const result = rrfFuseMultiple([list1, list2, list3]);

    // A appears in all 3 lists at rank 1 → highest score
    expect(String(result[0].chunk.id)).toBe("A");
  });

  it("should accept custom k parameter", () => {
    const list1: ScoredChunk[] = [scored("A", 1.0)];
    const list2: ScoredChunk[] = [scored("A", 1.0)];
    const resultK1 = rrfFuseMultiple([list1, list2], 1);
    const resultK60 = rrfFuseMultiple([list1, list2], 60);

    // k=1: score = 2 * 1/(1+1) = 1.0
    // k=60: score = 2 * 1/(60+1) ≈ 0.0328
    expect(resultK1[0].score).toBeGreaterThan(resultK60[0].score);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/search/fusion.test.ts`
Expected: FAIL — `rrfFuseMultiple` is not exported

**Step 3: Implement rrfFuseMultiple**

Append to `search/fusion.ts` after line 136:

```typescript
// ---------------------------------------------------------------------------
// Generalized Multi-List RRF (for cross-query fusion)
// ---------------------------------------------------------------------------

/**
 * Fuses results from N ranked lists using Reciprocal Rank Fusion.
 *
 * For each unique chunk, the score is:
 *   `sum(1 / (k + rank))` across every list in which the chunk appears.
 *
 * Used by multi-query, HyDE (multi-doc), and step-back strategies to merge
 * results from multiple search queries.
 */
export function rrfFuseMultiple(
  resultLists: readonly (readonly ScoredChunk[])[],
  k: number = 60,
): ScoredChunk[] {
  if (resultLists.length === 0) return [];

  const scores = new Map<string, { chunk: PositionAwareChunk; score: number }>();

  for (const results of resultLists) {
    for (let i = 0; i < results.length; i++) {
      const { chunk } = results[i];
      const key = chunkKey(chunk);
      const rank = i + 1; // 1-based
      const rrfContribution = 1 / (k + rank);

      const existing = scores.get(key);
      if (existing) {
        existing.score += rrfContribution;
      } else {
        scores.set(key, { chunk, score: rrfContribution });
      }
    }
  }

  const fused: ScoredChunk[] = [];
  for (const { chunk, score } of scores.values()) {
    fused.push({ chunk, score });
  }

  return sortDescending(fused);
}
```

**Step 4: Add re-export to `search/index.ts`**

Add to the exports from `./fusion.js`:

```typescript
export { rrfFuseMultiple } from "./fusion.js";
```

**Step 5: Add import in the test file**

At the top of `fusion.test.ts`, add `rrfFuseMultiple` to the imports from the fusion module.

**Step 6: Run test to verify it passes**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/search/fusion.test.ts`
Expected: PASS (all existing + 6 new tests)

**Step 7: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/search/fusion.ts packages/eval-lib/src/retrievers/pipeline/search/index.ts packages/eval-lib/tests/unit/retrievers/pipeline/search/fusion.test.ts
git commit -m "feat(eval-lib): add rrfFuseMultiple for cross-query result fusion"
```

---

## Task 5: OpenAIPipelineLLM Implementation

**Files:**
- Create: `packages/eval-lib/src/retrievers/pipeline/llm-openai.ts`
- Create: `packages/eval-lib/tests/unit/retrievers/pipeline/llm-openai.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/eval-lib/tests/unit/retrievers/pipeline/llm-openai.test.ts
import { describe, it, expect, vi } from "vitest";
import { OpenAIPipelineLLM } from "../../../../src/retrievers/pipeline/llm-openai.js";

// Structural mock — matches the duck-typed OpenAIChatClient interface
function mockOpenAIClient(response: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: response } }],
        }),
      },
    },
  };
}

describe("OpenAIPipelineLLM", () => {
  it("should set name from model", () => {
    const client = mockOpenAIClient("test");
    const llm = new OpenAIPipelineLLM(client);
    expect(llm.name).toBe("OpenAI(gpt-4o-mini)");
  });

  it("should use custom model name", () => {
    const client = mockOpenAIClient("test");
    const llm = new OpenAIPipelineLLM(client, { model: "gpt-4o" });
    expect(llm.name).toBe("OpenAI(gpt-4o)");
  });

  it("should call chat.completions.create with correct params", async () => {
    const client = mockOpenAIClient("the answer");
    const llm = new OpenAIPipelineLLM(client, {
      model: "gpt-4o-mini",
      temperature: 0.3,
    });

    const result = await llm.complete("What is 2+2?");

    expect(result).toBe("the answer");
    expect(client.chat.completions.create).toHaveBeenCalledWith({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is 2+2?" }],
      temperature: 0.3,
    });
  });

  it("should use default temperature 0.2", async () => {
    const client = mockOpenAIClient("response");
    const llm = new OpenAIPipelineLLM(client);

    await llm.complete("test");

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.2 }),
    );
  });

  it("should return empty string when content is null", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: null } }],
          }),
        },
      },
    };
    const llm = new OpenAIPipelineLLM(client);

    const result = await llm.complete("test");
    expect(result).toBe("");
  });

  it("should implement PipelineLLM interface", () => {
    const client = mockOpenAIClient("test");
    const llm = new OpenAIPipelineLLM(client);

    expect(llm.name).toBeDefined();
    expect(typeof llm.complete).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/llm-openai.test.ts`
Expected: FAIL — module not found

**Step 3: Implement OpenAIPipelineLLM**

```typescript
// packages/eval-lib/src/retrievers/pipeline/llm-openai.ts
import type { PipelineLLM } from "./llm.interface.js";

/**
 * Structural typing — duck-typed against exactly the OpenAI surface area we use.
 * Follows the same pattern as OpenAIEmbedder and CohereReranker.
 */
interface OpenAIChatClient {
  chat: {
    completions: {
      create(opts: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}

export class OpenAIPipelineLLM implements PipelineLLM {
  readonly name: string;

  private readonly _client: OpenAIChatClient;
  private readonly _model: string;
  private readonly _temperature: number;

  constructor(
    client: OpenAIChatClient,
    options?: { model?: string; temperature?: number },
  ) {
    this._client = client;
    this._model = options?.model ?? "gpt-4o-mini";
    this._temperature = options?.temperature ?? 0.2;
    this.name = `OpenAI(${this._model})`;
  }

  /**
   * Convenience factory that creates an OpenAI client from an API key.
   * Dynamically imports the `openai` package to keep it optional.
   */
  static async create(options?: {
    model?: string;
    temperature?: number;
    apiKey?: string;
  }): Promise<OpenAIPipelineLLM> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: options?.apiKey });
    return new OpenAIPipelineLLM(client, options);
  }

  async complete(prompt: string): Promise<string> {
    const response = await this._client.chat.completions.create({
      model: this._model,
      messages: [{ role: "user", content: prompt }],
      temperature: this._temperature,
    });
    return response.choices[0]?.message.content ?? "";
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/llm-openai.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/llm-openai.ts packages/eval-lib/tests/unit/retrievers/pipeline/llm-openai.test.ts
git commit -m "feat(eval-lib): add OpenAIPipelineLLM implementation"
```

---

## Task 6: Update PipelineRetriever — Deps, Constructor, Validation

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts`
- Modify: `packages/eval-lib/tests/unit/retrievers/pipeline/pipeline-retriever.test.ts` (add validation tests)

**Step 1: Write the failing validation tests**

Add a new describe block to the existing `pipeline-retriever.test.ts`:

```typescript
// Add import at top:
// import type { PipelineLLM } from "../../../../src/retrievers/pipeline/llm.interface.js";

// ---------------------------------------------------------------------------
// LLM validation
// ---------------------------------------------------------------------------

describe("PipelineRetriever — LLM validation", () => {
  const llmStrategies = ["hyde", "multi-query", "step-back", "rewrite"] as const;

  for (const strategy of llmStrategies) {
    it(`should throw if "${strategy}" strategy is used without an LLM`, () => {
      expect(
        () =>
          new PipelineRetriever(
            { name: "test", query: { strategy } as any, search: { strategy: "dense" } },
            defaultDeps(),
          ),
      ).toThrow(/requires an LLM/);
    });
  }

  it("should NOT throw for identity strategy without LLM", () => {
    expect(
      () =>
        new PipelineRetriever(
          { name: "test", query: { strategy: "identity" }, search: { strategy: "dense" } },
          defaultDeps(),
        ),
    ).not.toThrow();
  });

  it("should NOT throw for LLM strategy when LLM is provided", () => {
    const mockLlm: PipelineLLM = {
      name: "MockLLM",
      complete: async () => "response",
    };
    expect(
      () =>
        new PipelineRetriever(
          { name: "test", query: { strategy: "hyde" }, search: { strategy: "dense" } },
          defaultDeps({ llm: mockLlm }),
        ),
    ).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/pipeline-retriever.test.ts`
Expected: FAIL — `llm` is not a valid property on `PipelineRetrieverDeps`; constructor doesn't validate LLM

**Step 3: Update PipelineRetrieverDeps**

In `pipeline-retriever.ts`, add the `llm` import and field to `PipelineRetrieverDeps` (after line 5, add import; in interface, add field after `reranker?`):

Add import:
```typescript
import type { PipelineLLM } from "./llm.interface.js";
```

Add to `PipelineRetrieverDeps` (after `readonly reranker?: Reranker;`):
```typescript
  readonly llm?: PipelineLLM;
```

**Step 4: Add private fields and constructor changes**

Add imports at top of file:
```typescript
import type { QueryConfig } from "./config.js";
// (QueryConfig is already transitively available through PipelineConfig, but add explicit import)
```

Update the imports from `./config.js` to also import `DEFAULT_QUERY_CONFIG`:
```typescript
import {
  type PipelineConfig,
  type SearchConfig,
  type RefinementStepConfig,
  type QueryConfig,
  DEFAULT_SEARCH_CONFIG,
  DEFAULT_QUERY_CONFIG,
  computeIndexConfigHash,
} from "./config.js";
```

Add new private fields (after `_reranker` on line 93):
```typescript
  private readonly _queryConfig: QueryConfig;
  private readonly _llm: PipelineLLM | undefined;
```

Add to constructor body (after line 110 `this._reranker = deps.reranker;`):
```typescript
    this._queryConfig = config.query ?? DEFAULT_QUERY_CONFIG;
    this._llm = deps.llm;
```

Add LLM validation (after the existing reranker validation block, before the closing `}` of the constructor):
```typescript
    // Validate: LLM-requiring query strategies need an LLM dependency
    const llmStrategies = ["hyde", "multi-query", "step-back", "rewrite"];
    if (llmStrategies.includes(this._queryConfig.strategy) && !this._llm) {
      throw new Error(
        `PipelineRetriever: query strategy "${this._queryConfig.strategy}" requires an LLM but none was provided in deps.`,
      );
    }
```

**Step 5: Run test to verify it passes**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/pipeline-retriever.test.ts`
Expected: PASS (all existing + 6 new validation tests)

**Step 6: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts packages/eval-lib/tests/unit/retrievers/pipeline/pipeline-retriever.test.ts
git commit -m "feat(eval-lib): add LLM dep to PipelineRetriever with validation"
```

---

## Task 7: Implement _processQuery + Update retrieve()

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts`
- Create: `packages/eval-lib/tests/unit/retrievers/pipeline/query-strategies.test.ts`

**Step 1: Write the query strategy integration tests**

```typescript
// packages/eval-lib/tests/unit/retrievers/pipeline/query-strategies.test.ts
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
// Shared test helpers
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
    createDocument({
      id: "cooking.md",
      content:
        "Pasta is a staple food in Italian cuisine. Spaghetti and penne are popular pasta shapes.",
    }),
  ]);
}

function createMockLlm(response: string | ((...args: any[]) => string)): PipelineLLM & { complete: ReturnType<typeof vi.fn> } {
  return {
    name: "MockLLM",
    complete: typeof response === "function"
      ? vi.fn().mockImplementation(response)
      : vi.fn().mockResolvedValue(response),
  };
}

function defaultDeps(overrides?: Partial<PipelineRetrieverDeps>): PipelineRetrieverDeps {
  return {
    chunker: new RecursiveCharacterChunker({ chunkSize: 50, chunkOverlap: 10 }),
    embedder: mockEmbedder(128),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// HyDE strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — HyDE query strategy", () => {
  let retriever: PipelineRetriever;
  let mockLlm: PipelineLLM & { complete: ReturnType<typeof vi.fn> };
  let corpus: Corpus;

  beforeEach(async () => {
    corpus = testCorpus();
    mockLlm = createMockLlm("Dogs are wonderful pets that have been companions to humans for thousands of years.");

    const config: PipelineConfig = {
      name: "hyde-test",
      query: { strategy: "hyde" },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(corpus);
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should call LLM once with the HyDE prompt + query", async () => {
    await retriever.retrieve("What are popular pets?", 3);

    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
    const prompt = mockLlm.complete.mock.calls[0][0] as string;
    expect(prompt).toContain("What are popular pets?");
    expect(prompt).toContain("passage");
  });

  it("should return valid PositionAwareChunks", async () => {
    const results = await retriever.retrieve("What are popular pets?", 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const chunk of results) {
      expect(chunk.id).toBeDefined();
      expect(chunk.content).toBeDefined();
      expect(chunk.spans).toBeDefined();
    }
  });
});

describe("PipelineRetriever — HyDE with multiple hypothetical docs", () => {
  it("should call LLM n times and fuse results", async () => {
    const mockLlm = createMockLlm("Hypothetical doc about pets.");

    const config: PipelineConfig = {
      name: "hyde-multi-test",
      query: { strategy: "hyde", numHypotheticalDocs: 3 },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(testCorpus());

    await retriever.retrieve("What are popular pets?", 3);

    expect(mockLlm.complete).toHaveBeenCalledTimes(3);
    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Multi-query strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — multi-query strategy", () => {
  let retriever: PipelineRetriever;
  let mockLlm: PipelineLLM & { complete: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockLlm = createMockLlm("What pets are common\nWhich animals do people keep\nPopular household animals");

    const config: PipelineConfig = {
      name: "multi-query-test",
      query: { strategy: "multi-query", numQueries: 3 },
      search: { strategy: "dense" },
    };

    retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(testCorpus());
  });

  afterEach(async () => {
    await retriever.cleanup();
  });

  it("should call LLM once to generate query variants", async () => {
    await retriever.retrieve("What are popular pets?", 3);
    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
  });

  it("should return valid fused results", async () => {
    const results = await retriever.retrieve("What are popular pets?", 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("should include the query count in the prompt", async () => {
    await retriever.retrieve("What are popular pets?", 3);

    const prompt = mockLlm.complete.mock.calls[0][0] as string;
    expect(prompt).toContain("3");
    expect(prompt).toContain("What are popular pets?");
  });
});

// ---------------------------------------------------------------------------
// Step-back strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — step-back strategy", () => {
  it("should search with both original and abstract query when includeOriginal=true", async () => {
    const mockLlm = createMockLlm("What is the relationship between humans and domesticated animals?");
    const embedder = mockEmbedder(128);
    const embedQuerySpy = vi.spyOn(embedder, "embedQuery");

    const config: PipelineConfig = {
      name: "step-back-test",
      query: { strategy: "step-back", includeOriginal: true },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm, embedder }));
    await retriever.init(testCorpus());

    await retriever.retrieve("What are popular pets?", 3);

    // Should embed both the original query and the step-back query
    expect(embedQuerySpy).toHaveBeenCalledTimes(2);
    expect(mockLlm.complete).toHaveBeenCalledTimes(1);

    await retriever.cleanup();
  });

  it("should only search with abstract query when includeOriginal=false", async () => {
    const mockLlm = createMockLlm("What is the relationship between humans and domesticated animals?");
    const embedder = mockEmbedder(128);
    const embedQuerySpy = vi.spyOn(embedder, "embedQuery");

    const config: PipelineConfig = {
      name: "step-back-no-orig",
      query: { strategy: "step-back", includeOriginal: false },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm, embedder }));
    await retriever.init(testCorpus());

    await retriever.retrieve("What are popular pets?", 3);

    // Only the abstract query is searched
    expect(embedQuerySpy).toHaveBeenCalledTimes(1);

    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Rewrite strategy
// ---------------------------------------------------------------------------

describe("PipelineRetriever — rewrite strategy", () => {
  it("should call LLM once and search with rewritten query", async () => {
    const mockLlm = createMockLlm("common household pets dogs cats");
    const embedder = mockEmbedder(128);
    const embedQuerySpy = vi.spyOn(embedder, "embedQuery");

    const config: PipelineConfig = {
      name: "rewrite-test",
      query: { strategy: "rewrite" },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm, embedder }));
    await retriever.init(testCorpus());

    await retriever.retrieve("whats popular pets??", 3);

    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
    // Search should use the rewritten query, not the original
    expect(embedQuerySpy).toHaveBeenCalledTimes(1);
    expect(embedQuerySpy).toHaveBeenCalledWith("common household pets dogs cats");

    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Identity strategy (regression)
// ---------------------------------------------------------------------------

describe("PipelineRetriever — identity query (regression)", () => {
  it("should NOT call LLM for identity strategy", async () => {
    const mockLlm = createMockLlm("should not be called");

    const config: PipelineConfig = {
      name: "identity-test",
      query: { strategy: "identity" },
      search: { strategy: "dense" },
    };

    const retriever = new PipelineRetriever(config, defaultDeps({ llm: mockLlm }));
    await retriever.init(testCorpus());

    await retriever.retrieve("What are popular pets?", 3);

    expect(mockLlm.complete).not.toHaveBeenCalled();

    await retriever.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Refinement uses original query, not processed query
// ---------------------------------------------------------------------------

describe("PipelineRetriever — refinement with query strategies", () => {
  it("should pass original query to reranker, not the rewritten query", async () => {
    const mockLlm = createMockLlm("rewritten query text");
    const mockReranker = {
      name: "MockReranker",
      rerank: vi.fn().mockImplementation(async (_q: string, chunks: any[]) => chunks),
    };

    const config: PipelineConfig = {
      name: "rewrite-rerank-test",
      query: { strategy: "rewrite" },
      search: { strategy: "dense" },
      refinement: [{ type: "rerank" }],
    };

    const retriever = new PipelineRetriever(
      config,
      defaultDeps({ llm: mockLlm, reranker: mockReranker }),
    );
    await retriever.init(testCorpus());

    await retriever.retrieve("original user question", 3);

    // Reranker should receive the ORIGINAL query, not the rewritten one
    expect(mockReranker.rerank.mock.calls[0][0]).toBe("original user question");

    await retriever.cleanup();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/query-strategies.test.ts`
Expected: FAIL — `_processQuery` not implemented, `retrieve()` still uses identity passthrough

**Step 3: Implement _processQuery and update retrieve()**

In `pipeline-retriever.ts`, add imports at top:

```typescript
import {
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  DEFAULT_REWRITE_PROMPT,
} from "./query/prompts.js";
import { parseVariants } from "./query/utils.js";
import { rrfFuseMultiple } from "./search/fusion.js";
```

Replace the `retrieve()` method (lines 151-170) with:

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

    // REFINEMENT stage — always uses the ORIGINAL user query
    scoredResults = await this._applyRefinements(query, scoredResults, k);

    return scoredResults.slice(0, k).map(({ chunk }) => chunk);
  }
```

Add the `_processQuery` private method (before `_applyRefinements`):

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/query-strategies.test.ts`
Expected: PASS (all 11 tests)

**Step 5: Run all pipeline tests for regression check**

Run: `pnpm -C packages/eval-lib test -- tests/unit/retrievers/pipeline/`
Expected: PASS (all existing tests + new tests)

**Step 6: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts packages/eval-lib/tests/unit/retrievers/pipeline/query-strategies.test.ts
git commit -m "feat(eval-lib): implement query stage strategies (hyde, multi-query, step-back, rewrite)"
```

---

## Task 8: Barrel Exports + Entry Points

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/index.ts`
- Modify: `packages/eval-lib/src/retrievers/index.ts`
- Modify: `packages/eval-lib/src/index.ts`
- Create: `packages/eval-lib/src/pipeline/llm-openai.ts`
- Modify: `packages/eval-lib/tsup.config.ts`
- Modify: `packages/eval-lib/package.json`
- Modify: `packages/eval-lib/src/experiments/presets.ts`

**Step 1: Update pipeline/index.ts**

Add after the existing exports:

```typescript
// LLM interface
export type { PipelineLLM } from "./llm.interface.js";

// Query stage
export type {
  HydeQueryConfig,
  MultiQueryConfig,
  StepBackQueryConfig,
  RewriteQueryConfig,
} from "./config.js";
export {
  DEFAULT_HYDE_PROMPT,
  DEFAULT_MULTI_QUERY_PROMPT,
  DEFAULT_STEP_BACK_PROMPT,
  DEFAULT_REWRITE_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_CONTEXT_PROMPT,
} from "./query/index.js";
export { rrfFuseMultiple } from "./search/index.js";
```

Also add `IdentityQueryConfig` to the existing `QueryConfig` type export if not already exported individually. Check: it's currently exported only as part of `QueryConfig`. Add it explicitly:

```typescript
export type {
  // ... existing ...
  IdentityQueryConfig,
} from "./config.js";
```

**Step 2: Update retrievers/index.ts**

Add to the type re-exports from `./pipeline/index.js`:

```typescript
export type {
  // ... existing ...
  PipelineLLM,
  IdentityQueryConfig,
  HydeQueryConfig,
  MultiQueryConfig,
  StepBackQueryConfig,
  RewriteQueryConfig,
} from "./pipeline/index.js";
```

Add to the value re-exports from `./pipeline/index.js`:

```typescript
export {
  // ... existing ...
  rrfFuseMultiple,
} from "./pipeline/index.js";
```

**Step 3: Update src/index.ts**

Add to the Pipeline Retriever type exports (after `ScoredChunk`):

```typescript
export type {
  // ... existing ...
  PipelineLLM,
  IdentityQueryConfig,
  HydeQueryConfig,
  MultiQueryConfig,
  StepBackQueryConfig,
  RewriteQueryConfig,
} from "./retrievers/index.js";
```

Note: `OpenAIPipelineLLM` is NOT exported from the main barrel (it has an optional `openai` dependency). It gets its own entry point.

**Step 4: Create the OpenAIPipelineLLM entry point wrapper**

```typescript
// packages/eval-lib/src/pipeline/llm-openai.ts
export { OpenAIPipelineLLM } from "../retrievers/pipeline/llm-openai.js";
```

**Step 5: Add tsup entry point**

In `tsup.config.ts`, add to the `entry` array:

```typescript
"src/pipeline/llm-openai.ts",
```

**Step 6: Add package.json export**

In `package.json`, add to the `"exports"` map:

```json
"./pipeline/llm-openai": {
  "import": "./dist/pipeline/llm-openai.mjs",
  "require": "./dist/pipeline/llm-openai.js",
  "types": "./dist/pipeline/llm-openai.d.mts"
},
```

**Step 7: Update PipelinePresetDeps**

In `src/experiments/presets.ts`, add the LLM import and field:

```typescript
import type { PipelineLLM } from "../retrievers/pipeline/llm.interface.js";
```

Add to `PipelinePresetDeps` interface (after `reranker?`):

```typescript
  readonly llm?: PipelineLLM;
```

**Step 8: Run typecheck**

Run: `pnpm -C packages/eval-lib exec tsc --noEmit`
Expected: PASS

**Step 9: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/index.ts packages/eval-lib/src/retrievers/index.ts packages/eval-lib/src/index.ts packages/eval-lib/src/pipeline/llm-openai.ts packages/eval-lib/tsup.config.ts packages/eval-lib/package.json packages/eval-lib/src/experiments/presets.ts
git commit -m "feat(eval-lib): add barrel exports and entry point for pipeline LLM"
```

---

## Task 9: Registry Status Updates

**Files:**
- Modify: `packages/eval-lib/src/registry/query-strategies.ts`
- Modify: `packages/eval-lib/src/registry/presets.ts`

**Step 1: Flip query strategy statuses**

In `src/registry/query-strategies.ts`, change `status: "coming-soon"` to `status: "available"` for all four entries: `hyde`, `multi-query`, `step-back`, `rewrite`.

**Step 2: Update preset registry**

In `src/registry/presets.ts`, for the 8 presets that ONLY need query strategies (not coming-soon index/refinement strategies):

1. `hyde-dense` — flip to `"available"`, remove `comingSoonConfig()` cast
2. `hyde-hybrid` — flip to `"available"`, remove `comingSoonConfig()` cast
3. `hyde-hybrid-reranked` — flip to `"available"`, remove `comingSoonConfig()` cast
4. `multi-query-dense` — **keep `"coming-soon"`** because it uses `{ type: "dedup" }` refinement which is still coming-soon
5. `multi-query-hybrid` — **keep `"coming-soon"`** because it uses `{ type: "dedup" }` refinement which is still coming-soon
6. `step-back-hybrid` — **keep `"coming-soon"`** because it uses `{ type: "dedup" }` refinement which is still coming-soon
7. `rewrite-hybrid` — flip to `"available"`, remove `comingSoonConfig()` cast
8. `rewrite-hybrid-reranked` — flip to `"available"`, remove `comingSoonConfig()` cast

Wait — checking the preset configs more carefully:
- `multi-query-dense` uses `refinement: [{ type: "dedup" }]` → "dedup" is coming-soon → keep `"coming-soon"` + keep cast
- `multi-query-hybrid` uses `refinement: [{ type: "dedup" }, { type: "rerank" }]` → "dedup" is coming-soon → keep `"coming-soon"` + keep cast
- `step-back-hybrid` uses `refinement: [{ type: "dedup" }, { type: "rerank" }]` → "dedup" is coming-soon → keep `"coming-soon"` + keep cast

So only **5 presets** can be flipped:
- `hyde-dense`, `hyde-hybrid`, `hyde-hybrid-reranked`, `rewrite-hybrid`, `rewrite-hybrid-reranked`

For each, replace `comingSoonConfig({...})` with the raw config object (it will now type-check since `QueryConfig` includes the new variants). Change `status` from `"coming-soon"` to `"available"`.

Example for `hyde-dense`:

```typescript
const hydeDense: PresetEntry = {
  id: "hyde-dense",
  // ...
  status: "available",          // ← was "coming-soon"
  // ...
  config: {                     // ← was comingSoonConfig({...})
    name: "hyde-dense",
    index: { strategy: "plain" },
    query: { strategy: "hyde" },
    search: { strategy: "dense" },
  },
  // ...
};
```

**Step 3: Reorganize the PRESET_REGISTRY array**

Move newly-available presets from the coming-soon section into the available section, maintaining the complexity ordering (basic → intermediate → advanced).

**Step 4: Check if `comingSoonConfig` helper can be removed**

No — it's still needed for presets that reference coming-soon index strategies (contextual, summary, parent-child) and coming-soon refinement steps (dedup, mmr). Keep it.

**Step 5: Run typecheck**

Run: `pnpm -C packages/eval-lib exec tsc --noEmit`
Expected: PASS (the preset configs now type-check without casts)

**Step 6: Commit**

```bash
git add packages/eval-lib/src/registry/query-strategies.ts packages/eval-lib/src/registry/presets.ts
git commit -m "feat(eval-lib): mark query strategies and 5 presets as available"
```

---

## Task 10: Build Verification + Full Test Run

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Run full build**

Run: `pnpm build`
Expected: PASS — all entry points compile, including new `pipeline/llm-openai`

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: PASS — all existing tests + new tests (~240+ tests total)

**Step 4: Verify the new entry point is in the build output**

Run: `ls packages/eval-lib/dist/pipeline/llm-openai.*`
Expected: `.mjs`, `.js`, `.d.mts`, `.d.ts` files present

**Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore(eval-lib): slice 3 build verification"
```

---

## Design Decisions Made During Planning

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Cross-query fusion function | New `rrfFuseMultiple` alongside existing `reciprocalRankFusion` | Existing function is hardcoded for 2 lists (dense + sparse). Changing its signature would break callers. |
| 2 | OpenAIPipelineLLM constructor | Public constructor + static `create()` factory | Public constructor enables testing with mock clients. Factory handles optional `openai` import. |
| 3 | OpenAIPipelineLLM entry point | Separate `./pipeline/llm-openai` sub-path | `openai` is an optional dep. Main barrel must not transitively import it. |
| 4 | Refinement query | Original query passed to refinements | Reranking should use the user's original question, not HyDE hypothetical docs or rewritten queries. |
| 5 | `_processQuery` location | Private method on `PipelineRetriever` | Query strategies are simple LLM calls + parsing, not stateful like search strategies. No separate class hierarchy needed. |
| 6 | `MultiQueryConfig.fusionMethod` | Kept in type, only RRF implemented | Weighted cross-query fusion has no natural weight assignment. RRF is the standard approach. |
| 7 | Preset flipping | Only 5 of 8 eligible presets flipped | 3 presets (multi-query-dense, multi-query-hybrid, step-back-hybrid) use `dedup` refinement which is still coming-soon. |
| 8 | `PipelinePresetDeps` | Added `llm?` field | Backwards-compatible addition. Enables preset factory to pass LLM through to `PipelineRetriever`. |
