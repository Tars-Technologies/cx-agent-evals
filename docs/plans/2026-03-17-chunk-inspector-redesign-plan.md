# Chunk Inspector Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the Chunk Inspector for clarity (clean doc view, stats banner, click-to-highlight, parent-child support), fix two bugs (MarkdownViewer `<last>` tag, RecursiveCharacterChunker overlap duplication), and add index→search interaction notes.

**Architecture:** The IndexTab.tsx (~1100 lines) gets a major rewrite: `IndexConfigBanner` → `StatsBanner` with metric cards, `buildSegments`/`renderAnnotatedContent`/`ChunkPill` → click-to-highlight with margin hairlines, `ChunkInspectorPanel` → searchable chunk list + revised detail panel. Backend gets parent-child indexing (metadata-based) and retrieval (child→parent swap in the shared `vectorSearchWithFilter` helper). Two independent bug fixes in MarkdownViewer and RecursiveCharacterChunker.

**Tech Stack:** React, TypeScript, Tailwind CSS, Convex (existing); `rehype-sanitize` (new)

**Design doc:** `docs/plans/2026-03-17-chunk-inspector-redesign-design.md`

---

### Task 1: Fix MarkdownViewer `<last>` tag error

**Files:**
- Modify: `packages/frontend/src/components/MarkdownViewer.tsx:294-297`

**Context:** Document content (legal docs) contains non-standard HTML tags like `<last>`, `<first>`. `rehypeRaw` parses them as valid HTML, React creates native DOM elements, browser logs warnings. Fix: add `rehype-sanitize` to strip unknown tags.

**Step 1: Install rehype-sanitize**

Run: `pnpm -C packages/frontend add rehype-sanitize`

**Step 2: Add the import and plugin**

In `packages/frontend/src/components/MarkdownViewer.tsx`, add import after the existing rehype-raw import (line 6):

```tsx
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
```

Then create a permissive schema that allows standard HTML but strips unknown tags. Add after the imports (before `interface MarkdownViewerProps`):

```tsx
/** Allow all standard HTML + GFM elements but strip unknown tags like <last>, <party> */
const sanitizeSchema = {
  ...defaultSchema,
  // Keep rehype-raw's permissiveness for standard elements
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "details", "summary", "mark", "abbr", "sub", "sup",
  ],
};
```

Then update the `rehypePlugins` array on line 296:

Replace:
```tsx
rehypePlugins={[rehypeRaw]}
```

With:
```tsx
rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
```

**Step 3: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add packages/frontend/src/components/MarkdownViewer.tsx packages/frontend/package.json pnpm-lock.yaml
git commit -m "fix(frontend): add rehype-sanitize to strip unknown HTML tags in MarkdownViewer"
```

---

### Task 2: Fix RecursiveCharacterChunker overlap duplication bug

**Files:**
- Modify: `packages/eval-lib/src/chunkers/recursive-character.ts:128-139`
- Modify: `packages/eval-lib/tests/unit/chunkers/chunkers.test.ts`

**Context:** When paragraph sizes are near `chunkSize` (e.g., 400/80 config), the overlap retention keeps entire paragraphs, causing merged content to exceed `chunkSize`, triggering recursive re-splitting of already-emitted content — producing duplicate chunks. With 400/80 on 10 docs, this causes 14,109 chunks instead of ~4,500.

**Step 1: Add a failing test**

In `packages/eval-lib/tests/unit/chunkers/chunkers.test.ts`, add after the existing `RecursiveCharacterChunker` describe block:

```typescript
describe("overlap duplication bug", () => {
  it("should not produce duplicate chunks with paragraph sizes near chunkSize", () => {
    const chunker = new RecursiveCharacterChunker({
      chunkSize: 400,
      chunkOverlap: 80,
    });

    // Two paragraphs of ~300 chars each, separated by \n\n
    const paraA = "A".repeat(298);
    const paraB = "B".repeat(298);
    const text = paraA + "\n\n" + paraB;

    const chunks = chunker.chunk(text);

    // Should be 2-3 chunks (one per paragraph, maybe one overlap), NOT 4+
    expect(chunks.length).toBeLessThanOrEqual(3);

    // No exact duplicates
    const unique = new Set(chunks);
    expect(unique.size).toBe(chunks.length);
  });

  it("should produce roughly proportional chunk counts for smaller chunkSize", () => {
    const large = new RecursiveCharacterChunker({ chunkSize: 1000, chunkOverlap: 200 });
    const small = new RecursiveCharacterChunker({ chunkSize: 400, chunkOverlap: 80 });

    // Generate a document with many paragraphs of varied sizes
    const paragraphs = Array.from({ length: 50 }, (_, i) =>
      String.fromCharCode(65 + (i % 26)).repeat(150 + (i * 7) % 200)
    );
    const text = paragraphs.join("\n\n");

    const largeChunks = large.chunk(text);
    const smallChunks = small.chunk(text);

    // With 2.5x smaller chunks, expect roughly 2-4x more chunks, not 8x
    const ratio = smallChunks.length / largeChunks.length;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(5);
  });

  it("should produce valid positions with no content loss after overlap fix", () => {
    const chunker = new RecursiveCharacterChunker({
      chunkSize: 400,
      chunkOverlap: 80,
    });
    const content = Array.from({ length: 20 }, (_, i) =>
      String.fromCharCode(65 + (i % 26)).repeat(200 + (i * 13) % 300)
    ).join("\n\n");

    const doc = createDocument({ id: "test-overlap.md", content });
    const chunks = chunker.chunkWithPositions(doc);

    // Every chunk's content must match its span in the source
    for (const chunk of chunks) {
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeLessThanOrEqual(content.length);
      expect(content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }

    // All source content is covered (union of all chunk spans covers full text)
    const covered = new Set<number>();
    for (const chunk of chunks) {
      for (let i = chunk.start; i < chunk.end; i++) covered.add(i);
    }
    // Non-whitespace chars should all be covered
    for (let i = 0; i < content.length; i++) {
      if (content[i].trim()) {
        expect(covered.has(i)).toBe(true);
      }
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- --grep "overlap duplication"`
Expected: FAIL — duplicate chunks or count > 3.

**Step 3: Fix the overlap retention logic**

In `packages/eval-lib/src/chunkers/recursive-character.ts`, find lines 128-139 (the overlap retention block inside `_splitTextWithPositions`):

```typescript
        // Keep overlap: drop from front until under overlap threshold
        if (this._chunkOverlap > 0) {
          while (currentParts.length > 0) {
            const dropLen = currentParts[0].text.length + separator.length;
            if (currentLen - dropLen <= this._chunkOverlap) break;
            currentLen -= dropLen;
            currentParts.shift();
          }
        } else {
          currentParts = [];
          currentLen = 0;
        }
```

Replace with:

```typescript
        // Keep overlap: retain at most chunkOverlap characters from the tail
        if (this._chunkOverlap > 0) {
          // Drop parts from the front until the remaining fits within chunkOverlap
          while (currentParts.length > 0) {
            const dropLen = currentParts[0].text.length + separator.length;
            if (currentLen - dropLen <= this._chunkOverlap) break;
            currentLen -= dropLen;
            currentParts.shift();
          }
          // Safety: if the remaining content still exceeds chunkOverlap
          // (single large paragraph), clear it to prevent re-splitting
          if (currentLen > this._chunkOverlap) {
            currentParts = [];
            currentLen = 0;
          }
        } else {
          currentParts = [];
          currentLen = 0;
        }
```

The key addition is the safety guard: if after dropping parts from the front, the remaining content still exceeds `chunkOverlap` (a single part is larger than the overlap threshold), clear everything. This prevents the retained content + next part from exceeding `chunkSize` and triggering recursive re-splitting.

**Step 4: Run tests to verify the fix**

Run: `pnpm -C packages/eval-lib test`
Expected: All tests pass, including the new overlap duplication tests.

**Step 5: Commit**

```bash
git add packages/eval-lib/src/chunkers/recursive-character.ts packages/eval-lib/tests/unit/chunkers/chunkers.test.ts
git commit -m "fix(eval-lib): prevent RecursiveCharacterChunker overlap from producing duplicate chunks"
```

---

### Task 3: Parent-child backend indexing

**Files:**
- Modify: `packages/backend/convex/retrieval/retrieverActions.ts:103-112`
- Modify: `packages/backend/convex/retrieval/indexing.ts:127-156` (WorkPool orchestration)
- Modify: `packages/backend/convex/retrieval/indexingActions.ts:42-99` (per-document action)
- Modify: `packages/backend/convex/retrieval/chunks.ts` (verify insertChunkBatch returns ids)

**Context:** Backend always uses `strategy: "plain"` for indexing. Three files are involved in the indexing pipeline:
1. `retrieverActions.ts:startIndexing` — resolves config, calls `indexing.startIndexing`
2. `indexing.ts:startIndexing` — creates job, fans out WorkPool actions per document
3. `indexingActions.ts:indexDocument` — per-document chunking + embedding

All three must be updated for parent-child support.

**Step 1: Update retrieverActions.ts to detect parent-child strategy**

In `packages/backend/convex/retrieval/retrieverActions.ts`, replace lines 103-112:

```typescript
    // Resolve index config for the indexing service
    const indexSettings = (config.index ?? {}) as Record<string, unknown>;
    const indexConfig = {
      strategy: "plain" as const,
      chunkSize: (indexSettings.chunkSize as number) ?? 1000,
      chunkOverlap: (indexSettings.chunkOverlap as number) ?? 200,
      separators: indexSettings.separators as string[] | undefined,
      embeddingModel:
        (indexSettings.embeddingModel as string) ?? "text-embedding-3-small",
    };
```

With:

```typescript
    // Resolve index config for the indexing service
    const indexSettings = (config.index ?? {}) as Record<string, unknown>;
    const strategy = (indexSettings.strategy as string) ?? "plain";
    const embeddingModel =
      (indexSettings.embeddingModel as string) ?? "text-embedding-3-small";

    const indexConfig = strategy === "parent-child"
      ? {
          strategy: "parent-child" as const,
          childChunkSize: (indexSettings.childChunkSize as number) ?? 200,
          parentChunkSize: (indexSettings.parentChunkSize as number) ?? 1000,
          childOverlap: (indexSettings.childOverlap as number) ?? 0,
          parentOverlap: (indexSettings.parentOverlap as number) ?? 100,
          embeddingModel,
        }
      : {
          strategy: "plain" as const,
          chunkSize: (indexSettings.chunkSize as number) ?? 1000,
          chunkOverlap: (indexSettings.chunkOverlap as number) ?? 200,
          separators: indexSettings.separators as string[] | undefined,
          embeddingModel,
        };
```

**Step 2: Update indexing.ts WorkPool orchestration to pass parent-child args**

In `packages/backend/convex/retrieval/indexing.ts`, find the WorkPool enqueue loop (lines 132-148). Currently it passes only `chunkSize`, `chunkOverlap`, `embeddingModel`. Update to pass all strategy-specific fields:

```typescript
    // Enqueue one action per document and collect workIds for selective cancellation
    const workIds: WorkId[] = [];
    for (const doc of docs) {
      const wId = await pool.enqueueAction(
        ctx,
        internal.retrieval.indexingActions.indexDocument,
        {
          documentId: doc._id,
          kbId: args.kbId,
          indexConfigHash: args.indexConfigHash,
          // Pass all strategy-specific fields
          strategy: indexConfig.strategy,
          chunkSize: indexConfig.chunkSize,
          chunkOverlap: indexConfig.chunkOverlap,
          embeddingModel: indexConfig.embeddingModel,
          childChunkSize: indexConfig.childChunkSize,
          parentChunkSize: indexConfig.parentChunkSize,
          childOverlap: indexConfig.childOverlap,
          parentOverlap: indexConfig.parentOverlap,
        },
        {
          context: { jobId, documentId: doc._id },
          onComplete: internal.retrieval.indexing.onDocumentIndexed,
        },
      );
      workIds.push(wId);
    }
```

Note: The `indexConfig` is typed as `v.any()` in `startIndexing` args, so all fields pass through. The WorkPool action args need updating (next step).

**Step 3: Update indexingActions.ts args validator and Phase A**

In `packages/backend/convex/retrieval/indexingActions.ts`, update the `indexDocument` args validator to include parent-child fields:

```typescript
export const indexDocument = internalAction({
  args: {
    documentId: v.id("documents"),
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    strategy: v.optional(v.string()),
    chunkSize: v.optional(v.number()),
    chunkOverlap: v.optional(v.number()),
    embeddingModel: v.optional(v.string()),
    childChunkSize: v.optional(v.number()),
    parentChunkSize: v.optional(v.number()),
    childOverlap: v.optional(v.number()),
    parentOverlap: v.optional(v.number()),
  },
```

Then update Phase A (lines 68-98) to handle both strategies:

```typescript
    } else {
      // ── PHASE A: Chunk & Store (pure compute, atomic) ──
      const doc = await ctx.runQuery(internal.crud.documents.getInternal, {
        id: args.documentId,
      });

      const evalDoc = createDocument({ id: doc.docId, content: doc.content });

      if (args.strategy === "parent-child") {
        // Parent-child: two-level chunking
        const parentChunker = new RecursiveCharacterChunker({
          chunkSize: args.parentChunkSize ?? 1000,
          chunkOverlap: args.parentOverlap ?? 100,
        });
        const childChunker = new RecursiveCharacterChunker({
          chunkSize: args.childChunkSize ?? 200,
          chunkOverlap: args.childOverlap ?? 0,
        });

        const parentChunks = parentChunker.chunkWithPositions(evalDoc);
        const childChunks = childChunker.chunkWithPositions(evalDoc);

        if (parentChunks.length === 0 && childChunks.length === 0) {
          return { skipped: false, chunksInserted: 0, chunksEmbedded: 0 };
        }

        // Insert parent chunks (no embedding — level: "parent")
        const parentResult = await ctx.runMutation(
          internal.retrieval.chunks.insertChunkBatch,
          {
            chunks: parentChunks.map((c) => ({
              documentId: args.documentId,
              kbId: args.kbId,
              indexConfigHash: args.indexConfigHash,
              chunkId: c.id,
              content: c.content,
              start: c.start,
              end: c.end,
              metadata: { level: "parent" },
            })),
          },
        );

        // Map each child to its enclosing parent
        const childChunksMapped = childChunks.map((child) => {
          // Primary: find parent that fully contains this child
          let parentIndex = parentChunks.findIndex(
            (p) => p.start <= child.start && p.end >= child.end,
          );

          // Fallback for boundary children: find parent with max overlap
          if (parentIndex < 0) {
            let maxOverlap = 0;
            for (let pi = 0; pi < parentChunks.length; pi++) {
              const overlapStart = Math.max(parentChunks[pi].start, child.start);
              const overlapEnd = Math.min(parentChunks[pi].end, child.end);
              const overlap = Math.max(0, overlapEnd - overlapStart);
              if (overlap > maxOverlap) {
                maxOverlap = overlap;
                parentIndex = pi;
              }
            }
          }

          return {
            documentId: args.documentId,
            kbId: args.kbId,
            indexConfigHash: args.indexConfigHash,
            chunkId: child.id,
            content: child.content,
            start: child.start,
            end: child.end,
            metadata: {
              level: "child" as const,
              parentChunkId:
                parentIndex >= 0 ? parentResult.ids[parentIndex] : undefined,
            },
          };
        });

        // Insert child chunks (will be embedded in Phase B)
        await ctx.runMutation(internal.retrieval.chunks.insertChunkBatch, {
          chunks: childChunksMapped,
        });
      } else {
        // Plain: standard single-level chunking (existing code, unchanged)
        const chunker = new RecursiveCharacterChunker({
          chunkSize: args.chunkSize ?? 1000,
          chunkOverlap: args.chunkOverlap ?? 200,
        });

        const chunks = chunker.chunkWithPositions(evalDoc);

        if (chunks.length === 0) {
          return { skipped: false, chunksInserted: 0, chunksEmbedded: 0 };
        }

        await ctx.runMutation(internal.retrieval.chunks.insertChunkBatch, {
          chunks: chunks.map((c) => ({
            documentId: args.documentId,
            kbId: args.kbId,
            indexConfigHash: args.indexConfigHash,
            chunkId: c.id,
            content: c.content,
            start: c.start,
            end: c.end,
            metadata: c.metadata ?? {},
          })),
        });
      }
    }
```

**Step 4: Update Phase B to skip embedding parent chunks**

In Phase B (lines 101-159), after collecting unembedded chunks in the paginated loop, filter out parent chunks before embedding:

```typescript
    // Filter out parent chunks — they don't get embedded
    const toEmbed = unembedded.filter(
      (c: any) => !(c.metadata?.level === "parent"),
    );

    if (toEmbed.length === 0) {
      return { skipped: true, chunksInserted: 0, chunksEmbedded: 0 };
    }

    const embedder = createEmbedder(args.embeddingModel);
    let totalEmbedded = 0;

    for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
      // ... existing embedding loop, using toEmbed instead of unembedded
```

**Step 5: Verify insertChunkBatch returns IDs**

Check `packages/backend/convex/retrieval/chunks.ts:11-34`. The `insertChunkBatch` mutation already returns `{ inserted: ids.length, ids }` where `ids` is the array of Convex `_id`s. No change needed — just verify it's there.

**Step 6: Typecheck and test**

Run: `pnpm typecheck:backend && pnpm -C packages/backend test`
Expected: All pass.

**Step 7: Commit**

```bash
git add packages/backend/convex/retrieval/retrieverActions.ts packages/backend/convex/retrieval/indexing.ts packages/backend/convex/retrieval/indexingActions.ts
git commit -m "feat(backend): implement parent-child indexing with two-level chunking"
```

---

### Task 4: Parent-child backend retrieval

**Files:**
- Modify: `packages/backend/convex/lib/vectorSearch.ts`
- Modify: `packages/backend/convex/retrieval/chunks.ts`

**Context:** After vector search returns scored child chunks, look up their parents and deduplicate. The swap is implemented in the shared `vectorSearchWithFilter` helper so both `retrieverActions.ts:retrieve` (playground) and `experiments/actions.ts:runEvaluation` (experiment runner) get parent-child support automatically.

**Step 1: Add getChunkById query to chunks.ts**

In `packages/backend/convex/retrieval/chunks.ts`, add a new internal query:

```typescript
/** Fetch a single chunk by ID. Used for parent-child retrieval swap. */
export const getChunkById = internalQuery({
  args: { chunkId: v.id("documentChunks") },
  handler: async (ctx, args) => {
    const chunk = await ctx.db.get(args.chunkId);
    if (!chunk) return null;
    const doc = await ctx.db.get(chunk.documentId);
    return { ...chunk, docId: doc?.docId ?? "" };
  },
});
```

**Step 2: Update vectorSearchWithFilter to accept and handle index strategy**

In `packages/backend/convex/lib/vectorSearch.ts`, add an optional `indexStrategy` parameter and implement the parent-child swap after post-filtering:

```typescript
export async function vectorSearchWithFilter(
  ctx: ActionCtx,
  opts: {
    queryEmbedding: number[];
    kbId: Id<"knowledgeBases">;
    indexConfigHash: string;
    topK: number;
    indexStrategy?: string; // NEW: "plain" | "parent-child"
  },
) {
  const overFetch = Math.min(opts.topK * 4, 256);

  const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: opts.queryEmbedding,
    limit: overFetch,
    filter: (q: any) => q.eq("kbId", opts.kbId),
  });

  const chunks: any[] = await ctx.runQuery(
    internal.retrieval.chunks.fetchChunksWithDocs,
    { ids: results.map((r: any) => r._id) },
  );

  // Build score map
  const scoreMap = new Map<string, number>();
  for (const r of results) {
    scoreMap.set(r._id.toString(), r._score);
  }

  // Post-filter by indexConfigHash and take topK
  let filtered = chunks
    .filter((c: any) => c.indexConfigHash === opts.indexConfigHash)
    .slice(0, opts.topK);

  // Parent-child swap: replace child chunks with their parent chunks
  if (opts.indexStrategy === "parent-child") {
    const parentIdsSeen = new Set<string>();
    const swapped: any[] = [];

    for (const child of filtered) {
      const parentId = child.metadata?.parentChunkId;
      if (parentId && !parentIdsSeen.has(parentId)) {
        parentIdsSeen.add(parentId);
        const parent = await ctx.runQuery(
          internal.retrieval.chunks.getChunkById,
          { chunkId: parentId },
        );
        if (parent) {
          const childScore = scoreMap.get(child._id.toString()) ?? 0;
          // Update scoreMap so callers can look up score by parent ID
          scoreMap.set(parent._id.toString(), childScore);
          swapped.push({
            ...parent,
            _score: childScore,
          });
        } else {
          swapped.push(child); // Fallback if parent not found
        }
      } else if (!parentId) {
        swapped.push(child); // Not a child chunk, keep as-is
      }
      // Skip if parent already added (deduplication)
    }
    filtered = swapped;
  }

  return { chunks: filtered, scoreMap };
}
```

**Step 3: Update callers to pass indexStrategy**

In `retrieverActions.ts:retrieve` (line 209), update the `vectorSearchWithFilter` call:

```typescript
    const indexStrategy = (indexSettings.strategy as string) ?? "plain";

    const { chunks: filtered, scoreMap } = await vectorSearchWithFilter(ctx, {
      queryEmbedding,
      kbId: retriever.kbId,
      indexConfigHash: retriever.indexConfigHash,
      topK,
      indexStrategy,
    });
```

In `experiments/actions.ts:runEvaluation`, inside the `CallbackRetriever.retrieveFn` closure (line 248), pass the strategy:

```typescript
        const retConfig = (experiment.retrieverConfig ?? {}) as Record<string, any>;
        const idxSettings = (retConfig.index ?? {}) as Record<string, any>;
        const indexStrategy = (idxSettings.strategy as string) ?? "plain";

        // Inside retrieveFn:
        const { chunks: filtered } = await vectorSearchWithFilter(ctx, {
          queryEmbedding,
          kbId: args.kbId,
          indexConfigHash: args.indexConfigHash,
          topK,
          indexStrategy,
        });
```

**Step 4: Typecheck and test**

Run: `pnpm typecheck:backend && pnpm -C packages/backend test`
Expected: All pass.

**Step 5: Commit**

```bash
git add packages/backend/convex/lib/vectorSearch.ts packages/backend/convex/retrieval/chunks.ts packages/backend/convex/retrieval/retrieverActions.ts packages/backend/convex/experiments/actions.ts
git commit -m "feat(backend): add parent-child retrieval swap in shared vectorSearch helper"
```

---

### Task 5: Frontend type updates for parent-child support

**Files:**
- Modify: `packages/frontend/src/lib/pipeline-types.ts`

**Context:** The `IndexConfig` type only allows `strategy: "plain"`. The `resolveConfig()` function only returns plain fields. For the StatsBanner, ChunkDetailPanel, and SearchStep notes to work with parent-child, the frontend types must support it. This is a prerequisite for Tasks 6-9.

**Step 1: Add ParentChildIndexConfig type**

In `packages/frontend/src/lib/pipeline-types.ts`, update the index config types:

Replace:

```typescript
export interface IndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;
}

export const DEFAULT_INDEX_CONFIG: IndexConfig = {
  strategy: "plain",
  chunkSize: 1000,
  chunkOverlap: 200,
  embeddingModel: "text-embedding-3-small",
};
```

With:

```typescript
export interface PlainIndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;
}

export interface ParentChildIndexConfig {
  readonly strategy: "parent-child";
  readonly childChunkSize?: number;
  readonly parentChunkSize?: number;
  readonly childOverlap?: number;
  readonly parentOverlap?: number;
  readonly embeddingModel?: string;
}

export type IndexConfig = PlainIndexConfig | ParentChildIndexConfig;

export const DEFAULT_INDEX_CONFIG: PlainIndexConfig = {
  strategy: "plain",
  chunkSize: 1000,
  chunkOverlap: 200,
  embeddingModel: "text-embedding-3-small",
};
```

**Step 2: Update resolveConfig**

Update `resolveConfig()` to handle both strategies. The returned type should expose all fields so consumers can check strategy and access the right fields:

```typescript
export function resolveConfig(config: PipelineConfig): {
  index: {
    strategy: string;
    chunkSize: number;
    chunkOverlap: number;
    embeddingModel: string;
    separators?: readonly string[];
    childChunkSize?: number;
    parentChunkSize?: number;
    childOverlap?: number;
    parentOverlap?: number;
  };
  query: QueryConfig;
  search: SearchConfig;
  refinement: readonly RefinementStepConfig[];
  k: number;
  name: string;
} {
  const index = config.index ?? DEFAULT_INDEX_CONFIG;
  const strategy = index.strategy ?? "plain";

  return {
    name: config.name,
    index: strategy === "parent-child"
      ? {
          strategy,
          chunkSize: 0, // Not used for parent-child, but keeps type consistent
          chunkOverlap: 0,
          embeddingModel: index.embeddingModel ?? DEFAULT_INDEX_CONFIG.embeddingModel!,
          childChunkSize: (index as ParentChildIndexConfig).childChunkSize ?? 200,
          parentChunkSize: (index as ParentChildIndexConfig).parentChunkSize ?? 1000,
          childOverlap: (index as ParentChildIndexConfig).childOverlap ?? 0,
          parentOverlap: (index as ParentChildIndexConfig).parentOverlap ?? 100,
        }
      : {
          strategy,
          chunkSize: (index as PlainIndexConfig).chunkSize ?? DEFAULT_INDEX_CONFIG.chunkSize!,
          chunkOverlap: (index as PlainIndexConfig).chunkOverlap ?? DEFAULT_INDEX_CONFIG.chunkOverlap!,
          embeddingModel: index.embeddingModel ?? DEFAULT_INDEX_CONFIG.embeddingModel!,
          ...((index as PlainIndexConfig).separators ? { separators: (index as PlainIndexConfig).separators } : {}),
        },
    query: config.query ?? DEFAULT_QUERY_CONFIG,
    search: config.search ?? DEFAULT_SEARCH_CONFIG,
    refinement: config.refinement ?? [],
    k: config.k ?? DEFAULT_K,
  };
}
```

**Step 3: Fix any type errors in consumers**

Consumers like `RetrieverDetailModal.tsx:IndexSection` already handle parent-child via `ParsedConfig` (a loose type with optional fields), so they shouldn't break. Verify:

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add packages/frontend/src/lib/pipeline-types.ts
git commit -m "feat(frontend): add parent-child IndexConfig variant and update resolveConfig"
```

---

### Task 6: Stats Banner component

**Files:**
- Modify: `packages/frontend/src/components/tabs/IndexTab.tsx:798-821`

**Context:** Replace the `IndexConfigBanner` (which hardcodes "recursive") with a `StatsBanner` that shows actual chunker info, metric cards (total chunks, avg size, min/max, overlap %), and a collapsible histogram. Depends on Task 5 for parent-child type support in `resolveConfig`.

**Step 1: Replace IndexConfigBanner with StatsBanner**

Replace the `IndexConfigBanner` component (lines 798-821) with a new `StatsBanner` component. It takes `retrieverConfig`, `chunks` (the loaded chunks array), and `chunkCount` (from retriever). Stats are computed client-side from the chunks array.

```tsx
function StatsBanner({
  retrieverConfig,
  chunks,
  chunkCount,
}: {
  retrieverConfig: unknown;
  chunks: Chunk[];
  chunkCount?: number;
}) {
  const [showHistogram, setShowHistogram] = useState(false);
  const config = resolveConfig(retrieverConfig as PipelineConfig);
  const { embeddingModel } = config.index;
  const embedShort = embeddingModel.replace("text-embedding-", "");

  const strategy = config.index.strategy;
  const isParentChild = strategy === "parent-child";
  const chunkerLabel = isParentChild
    ? `Parent-child (${config.index.childChunkSize ?? 200}/${config.index.parentChunkSize ?? 1000})`
    : `Recursive (${config.index.chunkSize}/${config.index.chunkOverlap})`;

  // Compute stats from loaded chunks
  const stats = useMemo(() => {
    if (chunks.length === 0) return null;
    const sizes = chunks.map((c) => c.end - c.start);
    const total = chunkCount ?? chunks.length;
    const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);

    // Compute overlap %
    let overlapChars = 0;
    const sorted = [...chunks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const overlap = sorted[i - 1].end - sorted[i].start;
      if (overlap > 0) overlapChars += overlap;
    }
    const overlapPct = avg > 0 ? Math.round((overlapChars / sorted.length / avg) * 100) : 0;

    // Histogram buckets (100-char width)
    const bucketWidth = 100;
    const buckets = new Map<number, number>();
    for (const s of sizes) {
      const bucket = Math.floor(s / bucketWidth) * bucketWidth;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
    const maxCount = Math.max(...sortedBuckets.map(([, c]) => c));

    return { total, avg, min, max, overlapPct, sortedBuckets, maxCount };
  }, [chunks, chunkCount]);

  return (
    <div className="px-3 py-2 border-b border-border flex-shrink-0">
      <div className="bg-bg-surface border border-border rounded-lg p-2 space-y-2">
        {/* Config row */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
          <span className="text-text-muted font-medium">Index</span>
          <span>Chunking: <span className="text-text-muted">{chunkerLabel}</span></span>
          <span>Embedding: <span className="text-text-muted">{embedShort}</span></span>
          {isParentChild && (
            <span className="text-blue-400">
              Searched: child → Returns: parent
            </span>
          )}
        </div>

        {/* Metric cards */}
        {stats && (
          <div className="flex gap-3">
            {[
              { label: "chunks", value: stats.total.toLocaleString() },
              { label: "avg size", value: `${stats.avg}` },
              { label: "min/max", value: `${stats.min}–${stats.max}` },
              { label: "overlap", value: `${stats.overlapPct}%` },
            ].map((card) => (
              <div key={card.label} className="flex-1 bg-bg-elevated/50 rounded px-2 py-1 text-center">
                <div className="text-sm text-text font-medium">{card.value}</div>
                <div className="text-[10px] text-text-dim">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Histogram toggle */}
        {stats && (
          <button
            onClick={() => setShowHistogram(!showHistogram)}
            className="text-[10px] text-accent hover:text-accent-bright transition-colors cursor-pointer"
          >
            {showHistogram ? "▲ Hide" : "▼ Show"} distribution
          </button>
        )}

        {/* Histogram */}
        {showHistogram && stats && (
          <div className="space-y-0.5 pt-1">
            {stats.sortedBuckets.map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-2 text-[10px]">
                <span className="w-16 text-right text-text-dim">{bucket}–{bucket + 100}</span>
                <div className="flex-1 h-3 bg-bg-elevated rounded overflow-hidden">
                  <div
                    className="h-full bg-accent/40 rounded"
                    style={{ width: `${(count / stats.maxCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-text-dim">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Wire StatsBanner into IndexTab**

In the main `IndexTab` component, replace `<IndexConfigBanner>` usage (line 845) with `<StatsBanner>`. Initially pass `chunks={[]}` — full stats will work after Task 8 lifts chunk loading.

```tsx
<StatsBanner
  retrieverConfig={retriever.retrieverConfig}
  chunks={[]}
  chunkCount={retriever.chunkCount}
/>
```

**Step 3: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add packages/frontend/src/components/tabs/IndexTab.tsx
git commit -m "feat(frontend): replace IndexConfigBanner with StatsBanner showing metrics and histogram"
```

---

### Task 7: Click-to-highlight document view

**Files:**
- Modify: `packages/frontend/src/components/tabs/IndexTab.tsx`

**Context:** Replace the current annotated document view (numbered pills + zebra stripes) with a clean document that highlights chunks on click. This is the largest single change — it replaces `buildSegments`, `renderAnnotatedContent`, `ChunkPill`, and parts of `DocumentViewerPanel`. Click-to-highlight works in Raw mode only; Rendered mode shows a note to switch.

**Step 1: Remove old components**

Delete these components/functions from `IndexTab.tsx`:
- `Segment` interface (lines 38-43)
- `buildSegments()` (lines 56-136)
- `detectDiff()` (lines 147-164) — moved to ChunkDetailPanel in Task 8
- `ChunkPill` (lines 179-211)
- `renderAnnotatedContent()` (lines 490-539)

**Step 2: Add click-to-highlight helpers**

Add these new functions/components:

```tsx
/** Find chunk(s) that contain the given character position. */
function findChunksAtPosition(
  chunks: Chunk[],
  position: number,
): { primary: number | null; overlap: number | null } {
  let primary: number | null = null;
  let overlap: number | null = null;

  for (let i = 0; i < chunks.length; i++) {
    if (position >= chunks[i].start && position < chunks[i].end) {
      if (primary === null) {
        primary = i;
      } else {
        overlap = i;
        break;
      }
    }
  }

  return { primary, overlap };
}

/**
 * Render document content split into per-line spans with data-offset
 * for character-position detection on click.
 * When a chunk is selected, its character range is highlighted.
 */
function ClickableDocumentContent({
  content,
  chunks,
  selectedChunkIndex,
  overlapChunkIndex,
  onSelectChunk,
}: {
  content: string;
  chunks: Chunk[];
  selectedChunkIndex: number | null;
  overlapChunkIndex: number | null;
  onSelectChunk: (index: number | null) => void;
}) {
  // Split content into lines, each in a span with data-offset
  const lines = useMemo(() => {
    const result: Array<{ text: string; offset: number }> = [];
    let pos = 0;
    const parts = content.split("\n");
    for (let i = 0; i < parts.length; i++) {
      result.push({ text: parts[i], offset: pos });
      pos += parts[i].length + 1; // +1 for \n
    }
    return result;
  }, [content]);

  // Click handler: map click to character position, find chunk
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Walk up from target to find span with data-offset
      let el = e.target as HTMLElement | null;
      while (el && !el.dataset.offset) {
        el = el.parentElement;
      }
      if (!el?.dataset.offset) return;

      const lineOffset = parseInt(el.dataset.offset, 10);

      // Use Selection API to get offset within the text node
      const selection = window.getSelection();
      let charOffset = 0;
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        charOffset = range.startOffset;
      }

      const position = lineOffset + charOffset;
      const hit = findChunksAtPosition(chunks, position);

      if (hit.primary !== null) {
        onSelectChunk(hit.primary);
      } else {
        onSelectChunk(null);
      }
    },
    [chunks, onSelectChunk],
  );

  // Escape to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelectChunk(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onSelectChunk]);

  // Build highlight ranges
  const selectedChunk = selectedChunkIndex !== null ? chunks[selectedChunkIndex] : null;
  const overlapChunk = overlapChunkIndex !== null ? chunks[overlapChunkIndex] : null;

  // Render a line, applying highlights if the line intersects a selected chunk
  const renderLine = useCallback(
    (line: { text: string; offset: number }, idx: number) => {
      const lineEnd = line.offset + line.text.length;

      // Check if this line intersects any highlighted chunk
      const intersectsSelected =
        selectedChunk && line.offset < selectedChunk.end && lineEnd > selectedChunk.start;
      const intersectsOverlap =
        overlapChunk && line.offset < overlapChunk.end && lineEnd > overlapChunk.start;

      if (!intersectsSelected && !intersectsOverlap) {
        return (
          <span key={idx} data-offset={line.offset}>
            {line.text}
            {"\n"}
          </span>
        );
      }

      // Build sub-segments within this line for highlighting
      const segments: React.ReactNode[] = [];
      let cursor = 0;
      const text = line.text;

      // Collect highlight ranges within this line
      type Range = { start: number; end: number; cls: string };
      const ranges: Range[] = [];
      if (selectedChunk) {
        const s = Math.max(0, selectedChunk.start - line.offset);
        const e = Math.min(text.length, selectedChunk.end - line.offset);
        if (s < e) ranges.push({ start: s, end: e, cls: "bg-accent/10" });
      }
      if (overlapChunk) {
        const s = Math.max(0, overlapChunk.start - line.offset);
        const e = Math.min(text.length, overlapChunk.end - line.offset);
        if (s < e) ranges.push({ start: s, end: e, cls: "bg-blue-400/10" });
      }

      // Sort ranges by start
      ranges.sort((a, b) => a.start - b.start);

      for (const range of ranges) {
        if (range.start > cursor) {
          segments.push(text.slice(cursor, range.start));
        }
        segments.push(
          <span key={`hl-${range.start}`} className={range.cls}>
            {text.slice(range.start, range.end)}
          </span>,
        );
        cursor = range.end;
      }
      if (cursor < text.length) {
        segments.push(text.slice(cursor));
      }

      return (
        <span key={idx} data-offset={line.offset}>
          {segments}
          {"\n"}
        </span>
      );
    },
    [selectedChunk, overlapChunk],
  );

  return (
    <div className="relative">
      {/* Chunk boundary hairlines (left margin) */}
      {chunks.length > 0 && (
        <div className="absolute left-0 top-0 w-1 h-full pointer-events-none">
          {chunks.map((chunk, i) => {
            // Approximate position (line-based; exact calc needs layout measurement)
            const totalLines = lines.length;
            const chunkLine = lines.findIndex(
              (l) => l.offset + l.text.length >= chunk.start,
            );
            if (chunkLine < 0) return null;
            const pct = (chunkLine / Math.max(totalLines, 1)) * 100;
            return (
              <div
                key={i}
                className="absolute w-full bg-accent/20"
                style={{ top: `${pct}%`, height: "1px" }}
              />
            );
          })}
        </div>
      )}

      {/* Document text */}
      <pre
        className="text-xs text-text-muted leading-[1.8] whitespace-pre-wrap break-words font-mono max-w-full pl-3 cursor-text"
        onClick={handleClick}
      >
        {lines.map(renderLine)}
      </pre>
    </div>
  );
}
```

**Step 3: Update DocumentViewerPanel to use ClickableDocumentContent**

Replace the `<pre>` block in raw mode (lines 436-445) with `<ClickableDocumentContent>`. The rendered mode shows a note instead:

```tsx
{viewMode === "raw" ? (
  <>
    <ClickableDocumentContent
      content={docContent.content}
      chunks={sortedChunks}
      selectedChunkIndex={selectedChunkIndex}
      overlapChunkIndex={null} // Set when overlap detection logic exists
      onSelectChunk={onSelectChunk}
    />
    {/* Load More */}
    {hasMore && (
      /* ... existing Load More button ... */
    )}
  </>
) : (
  <>
    <MarkdownViewer
      content={docContent.content}
      showToggle={false}
      defaultMode="rendered"
    />
    {hasChunks && (
      <p className="mt-2 text-[10px] text-text-dim italic">
        Switch to raw mode to highlight and inspect chunks.
      </p>
    )}
  </>
)}
```

Also remove the now-unused `segments` computation (lines 362-366).

**Step 4: Add scroll-to-chunk support**

Add a ref to the `<pre>` element and implement scroll-to-chunk when a chunk is selected from the right panel. Use `useEffect` that watches `selectedChunkIndex` and scrolls to the corresponding line:

```tsx
const contentRef = useRef<HTMLPreElement>(null);

useEffect(() => {
  if (selectedChunkIndex === null || !contentRef.current) return;
  const chunk = sortedChunks[selectedChunkIndex];
  if (!chunk) return;
  // Find the span with the matching data-offset
  const spans = contentRef.current.querySelectorAll("[data-offset]");
  for (const span of spans) {
    const offset = parseInt((span as HTMLElement).dataset.offset ?? "0", 10);
    if (offset >= chunk.start) {
      span.scrollIntoView({ behavior: "smooth", block: "center" });
      break;
    }
  }
}, [selectedChunkIndex, sortedChunks]);
```

**Step 5: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 6: Commit**

```bash
git add packages/frontend/src/components/tabs/IndexTab.tsx
git commit -m "feat(frontend): replace annotated document view with click-to-highlight interaction"
```

---

### Task 8: Revised chunk list & details panel + chunk loading lift

**Files:**
- Modify: `packages/frontend/src/components/tabs/IndexTab.tsx`

**Context:** Replace `ChunkInspectorPanel` (lines 545-792) and `ChunkInspectorWrapper` (lines 1011-1112) with: searchable chunk list (top) + chunk detail (bottom). Also lift chunk loading from `DocumentViewerPanel` and `ChunkInspectorWrapper` to `IndexTab` level so chunks are shared by StatsBanner, document view, and chunk panel.

**Step 1: Lift chunk loading to IndexTab**

Move the chunk pagination state (`allChunks`, `cursor`, `loadingMore`, `pagesLoaded`, first/next page queries) from `DocumentViewerPanel` to `IndexTab`. Pass `sortedChunks` and `documentContent` down as props to all child panels.

The key change: `IndexTab` owns the chunk state and passes it to:
- `StatsBanner` — for metric cards and histogram
- `DocumentViewerPanel` (simplified) — no longer loads its own chunks
- `ChunkListPanel` — for the searchable list
- `ChunkDetailPanel` — for detail view

```tsx
export function IndexTab({ retriever, onStartIndexing }: IndexTabProps) {
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(null);
  const [selectedChunkIndex, setSelectedChunkIndex] = useState<number | null>(null);

  const isReady = retriever.status === "ready";
  const isIndexing = retriever.status === "indexing";

  // ── Chunk loading (lifted from DocumentViewerPanel + ChunkInspectorWrapper) ──
  const [allChunks, setAllChunks] = useState<Chunk[]>([]);
  const [chunkCursor, setChunkCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pagesLoaded, setPagesLoaded] = useState(0);

  const firstPage = useQuery(
    api.retrieval.chunks.getChunksByRetrieverPage,
    isReady && selectedDocId
      ? { kbId: retriever.kbId, indexConfigHash: retriever.indexConfigHash, documentId: selectedDocId, cursor: null, pageSize: 100 }
      : "skip",
  );

  // Reset when document changes
  useEffect(() => {
    setAllChunks([]);
    setChunkCursor(null);
    setPagesLoaded(0);
    setLoadingMore(false);
    setSelectedChunkIndex(null);
  }, [selectedDocId, retriever.indexConfigHash]);

  // Ingest first page
  useEffect(() => {
    if (firstPage && pagesLoaded === 0) {
      setAllChunks(firstPage.chunks as Chunk[]);
      setChunkCursor(firstPage.isDone ? null : firstPage.continueCursor);
      setPagesLoaded(1);
      // Auto-load remaining pages for the chunk list
      if (!firstPage.isDone) setLoadingMore(true);
    }
  }, [firstPage, pagesLoaded]);

  // Auto-load subsequent pages
  const nextPage = useQuery(
    api.retrieval.chunks.getChunksByRetrieverPage,
    loadingMore && chunkCursor
      ? { kbId: retriever.kbId, indexConfigHash: retriever.indexConfigHash, documentId: selectedDocId!, cursor: chunkCursor, pageSize: 100 }
      : "skip",
  );

  useEffect(() => {
    if (nextPage && loadingMore) {
      setAllChunks((prev) => [...prev, ...(nextPage.chunks as Chunk[])]);
      const nextCur = nextPage.isDone ? null : nextPage.continueCursor;
      setChunkCursor(nextCur);
      setPagesLoaded((p) => p + 1);
      setLoadingMore(false);
      if (!nextPage.isDone) setLoadingMore(true);
    }
  }, [nextPage, loadingMore]);

  const sortedChunks = useMemo(
    () => [...allChunks].sort((a, b) => a.start - b.start),
    [allChunks],
  );

  // ── Document content ──
  const docContent = useQuery(
    api.crud.documents.getContent,
    selectedDocId ? { id: selectedDocId } : "skip",
  );

  // ... render with StatsBanner, DocumentViewerPanel, right panel ...
}
```

This removes the need for `ChunkInspectorWrapper` entirely. Delete it.

Update `StatsBanner` to receive the actual `chunks={sortedChunks}` instead of `chunks={[]}`.

**Step 2: Create ChunkListPanel component**

Compact scrollable chunk list. For large chunk counts (1000+), limit the rendered list to a window of ~200 items around the current scroll position using a simple approach:

```tsx
function ChunkListPanel({
  chunks,
  selectedIndex,
  onSelect,
}: {
  chunks: Chunk[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [jumpTo, setJumpTo] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const maxSize = useMemo(
    () => Math.max(...chunks.map((c) => c.end - c.start), 1),
    [chunks],
  );

  const filtered = useMemo(() => {
    if (!search) return chunks.map((c, i) => ({ chunk: c, index: i }));
    const lower = search.toLowerCase();
    return chunks
      .map((c, i) => ({ chunk: c, index: i }))
      .filter(({ chunk }) => chunk.content.toLowerCase().includes(lower));
  }, [chunks, search]);

  // Simple windowed rendering: only render items near viewport
  // For < 500 chunks, render all; for more, use IntersectionObserver or slice
  const WINDOW_SIZE = 500;
  const [visibleStart, setVisibleStart] = useState(0);
  const displayItems = filtered.length <= WINDOW_SIZE
    ? filtered
    : filtered.slice(visibleStart, visibleStart + WINDOW_SIZE);

  const handleJump = () => {
    const n = parseInt(jumpTo, 10);
    if (n >= 1 && n <= chunks.length) {
      onSelect(n - 1);
      setJumpTo("");
      // Scroll the selected item into view
      if (filtered.length > WINDOW_SIZE) {
        const targetIdx = filtered.findIndex(f => f.index === n - 1);
        if (targetIdx >= 0) {
          setVisibleStart(Math.max(0, targetIdx - WINDOW_SIZE / 2));
        }
      }
    }
  };

  // When selected changes from outside, adjust window
  useEffect(() => {
    if (selectedIndex !== null && filtered.length > WINDOW_SIZE) {
      const targetIdx = filtered.findIndex(f => f.index === selectedIndex);
      if (targetIdx >= 0 && (targetIdx < visibleStart || targetIdx >= visibleStart + WINDOW_SIZE)) {
        setVisibleStart(Math.max(0, targetIdx - WINDOW_SIZE / 2));
      }
    }
  }, [selectedIndex, filtered, visibleStart]);

  return (
    <div className="flex flex-col h-1/2 border-b border-border">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-bg-elevated/50 flex items-center gap-2">
        <span className="text-[11px] text-text-muted font-medium flex-shrink-0">
          Chunks ({chunks.length})
        </span>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0 bg-bg-surface border border-border text-text text-[11px] rounded px-1.5 py-0.5 placeholder:text-text-dim focus:outline-none focus:border-accent/50"
        />
        <input
          type="text"
          placeholder="#"
          value={jumpTo}
          onChange={(e) => setJumpTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleJump()}
          className="w-10 bg-bg-surface border border-border text-text text-[11px] rounded px-1.5 py-0.5 placeholder:text-text-dim focus:outline-none focus:border-accent/50 text-center"
        />
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {/* Spacer for items above window */}
        {visibleStart > 0 && (
          <div style={{ height: visibleStart * 28 }} />
        )}
        {displayItems.map(({ chunk, index }) => {
          const size = chunk.end - chunk.start;
          const isSelected = selectedIndex === index;
          return (
            <button
              key={chunk._id}
              onClick={() => onSelect(index)}
              className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors cursor-pointer ${
                isSelected
                  ? "bg-accent/10 border-l-2 border-accent"
                  : "hover:bg-bg-hover border-l-2 border-transparent"
              }`}
              style={{ height: 28 }}
            >
              <span className="text-[10px] text-text-dim w-8 text-right flex-shrink-0">
                #{index + 1}
              </span>
              <span className="text-[10px] text-text-muted w-12 flex-shrink-0">
                {size}ch
              </span>
              <div className="flex-1 h-2 bg-bg-surface rounded overflow-hidden">
                <div
                  className="h-full bg-accent/30 rounded"
                  style={{ width: `${(size / maxSize) * 100}%` }}
                />
              </div>
            </button>
          );
        })}
        {/* Spacer for items below window */}
        {filtered.length > WINDOW_SIZE && visibleStart + WINDOW_SIZE < filtered.length && (
          <div style={{ height: (filtered.length - visibleStart - WINDOW_SIZE) * 28 }} />
        )}
      </div>
    </div>
  );
}
```

**Step 3: Create ChunkDetailPanel component**

Simplified chunk detail view focused on extra content (contextual prefix / summary replacement). Uses the `detectDiff` logic from the old `ChunkInspectorPanel`:

```tsx
function ChunkDetailPanel({
  chunk,
  index,
  total,
  documentContent,
  onPrev,
  onNext,
}: {
  chunk: Chunk;
  index: number;
  total: number;
  documentContent: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [showContent, setShowContent] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  const size = chunk.end - chunk.start;
  const originalText = documentContent.slice(chunk.start, chunk.end);

  // Detect extra content (contextual prefix or summary replacement)
  const hasPrefix =
    chunk.content.length > originalText.length &&
    chunk.content.endsWith(originalText);
  const prefix = hasPrefix
    ? chunk.content.slice(0, chunk.content.length - originalText.length)
    : null;

  const isSummary =
    !hasPrefix && chunk.content !== originalText && chunk.content.length > 0;

  // Parent-child info
  const isChild = chunk.metadata?.level === "child";
  const isParent = chunk.metadata?.level === "parent";

  const metadataEntries = Object.entries(chunk.metadata ?? {}).filter(
    ([k]) => !["level", "parentChunkId"].includes(k),
  );

  return (
    <div className="flex flex-col h-1/2">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Header */}
        <div>
          <div className="text-xs text-text font-medium">Chunk #{index + 1}</div>
          <div className="text-[10px] text-text-dim">
            chars {chunk.start.toLocaleString()}→{chunk.end.toLocaleString()} · {size} chars
          </div>
        </div>

        {/* Parent-child info */}
        {isChild && chunk.metadata?.parentChunkId && (
          <div className="text-[10px] text-accent/80 bg-accent/5 border border-accent/20 rounded px-2 py-1">
            Part of a parent chunk
          </div>
        )}
        {isParent && (
          <div className="text-[10px] text-accent/80 bg-accent/5 border border-accent/20 rounded px-2 py-1">
            Parent chunk (not embedded — children are searched)
          </div>
        )}

        {/* Contextual prefix */}
        {prefix && (
          <div>
            <div className="text-[10px] text-blue-400 font-medium uppercase tracking-wider mb-1">
              Contextual Prefix
            </div>
            <div className="bg-blue-500/5 border border-blue-500/20 rounded p-2">
              <pre className="text-[11px] text-blue-300 whitespace-pre-wrap font-mono">
                {prefix.trim()}
              </pre>
            </div>
          </div>
        )}

        {/* Summary replacement */}
        {isSummary && (
          <div>
            <div className="text-[10px] text-yellow-400 font-medium uppercase tracking-wider mb-1">
              Embedded Summary
            </div>
            <p className="text-[10px] text-text-dim mb-1">
              This summary was embedded instead of the original text.
            </p>
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded p-2">
              <pre className="text-[11px] text-yellow-300 whitespace-pre-wrap font-mono">
                {chunk.content}
              </pre>
            </div>
          </div>
        )}

        {/* Chunk content divider */}
        {(prefix || isSummary) && (
          <div className="flex items-center gap-2 text-[10px] text-text-dim">
            <div className="flex-1 h-px bg-border" />
            chunk content follows
            <div className="flex-1 h-px bg-border" />
          </div>
        )}

        {/* Collapsible chunk text */}
        <button
          onClick={() => setShowContent(!showContent)}
          className="text-[10px] text-accent hover:text-accent-bright transition-colors cursor-pointer"
        >
          {showContent ? "▲ Hide" : "▶ Show"} chunk text ({size} chars)
        </button>
        {showContent && (
          <pre className="text-[11px] text-text-muted whitespace-pre-wrap font-mono bg-bg-surface rounded p-2 max-h-48 overflow-auto">
            {originalText}
          </pre>
        )}

        {/* Collapsible metadata */}
        {metadataEntries.length > 0 && (
          <>
            <button
              onClick={() => setShowMetadata(!showMetadata)}
              className="text-[10px] text-text-dim hover:text-text transition-colors cursor-pointer"
            >
              {showMetadata ? "▲" : "▶"} Metadata ({metadataEntries.length} keys)
            </button>
            {showMetadata && (
              <div className="bg-bg-surface rounded p-2 space-y-1">
                {metadataEntries.map(([key, value]) => (
                  <div key={key} className="flex gap-2 text-[10px]">
                    <span className="text-text-dim font-mono flex-shrink-0">{key}:</span>
                    <span className="text-text-muted truncate">
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
        <button
          onClick={onPrev}
          disabled={index === 0}
          className="text-[10px] text-text-dim hover:text-text disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        <span className="text-[10px] text-text-dim">
          {index + 1}/{total}
        </span>
        <button
          onClick={onNext}
          disabled={index === total - 1}
          className="text-[10px] text-text-dim hover:text-text disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
```

**Step 4: Wire up the right panel in IndexTab**

Replace the right panel section in `IndexTab` (lines 879-901). The right panel now shows:
- If not ready: `IndexingActionPanel` (unchanged)
- If ready with doc selected: `ChunkListPanel` (top half) + `ChunkDetailPanel` (bottom half, when chunk selected)
- If no doc selected: placeholder text

Delete `ChunkInspectorWrapper` and `ChunkInspectorPanel` (they are fully replaced).

**Step 5: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 6: Commit**

```bash
git add packages/frontend/src/components/tabs/IndexTab.tsx
git commit -m "feat(frontend): add searchable chunk list, revised detail panel, and lift chunk loading to IndexTab"
```

---

### Task 9: Index→search interaction notes

**Files:**
- Modify: `packages/frontend/src/components/tabs/QuerySearchTab.tsx`
- Modify: `packages/frontend/src/components/wizard/steps/SearchStep.tsx`
- Modify: `packages/frontend/src/components/wizard/RetrieverWizard.tsx` (thread indexStrategy prop)

**Context:** The search config UI (dense/BM25/hybrid) should communicate what's actually being searched, which varies by index strategy. `SearchStep` currently doesn't receive the index strategy — the wizard must thread it.

**Step 1: Add IndexSearchNote helper component**

Create a small reusable component. Can be placed in `QuerySearchTab.tsx` or a shared file:

```tsx
function IndexSearchNote({ indexStrategy, indexConfig }: {
  indexStrategy: string;
  indexConfig?: Record<string, unknown>;
}) {
  if (indexStrategy === "parent-child") {
    const childSize = (indexConfig?.childChunkSize as number) ?? 200;
    const parentSize = (indexConfig?.parentChunkSize as number) ?? 1000;
    return (
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2 text-[11px] text-blue-400">
        Search runs on child chunks ({childSize} chars). Matching children are
        automatically mapped to parent chunks ({parentSize} chars).
      </div>
    );
  }
  if (indexStrategy === "contextual") {
    return (
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2 text-[11px] text-blue-400">
        Search runs on chunks with a contextual prefix — a few sentences
        situating the chunk in its document.
      </div>
    );
  }
  if (indexStrategy === "summary") {
    return (
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2 text-[11px] text-blue-400">
        Search runs on LLM-generated summaries. Matching summaries return the
        original chunk content.
      </div>
    );
  }
  return null;
}
```

**Step 2: Insert into QuerySearchTab**

In `QuerySearchTab.tsx`, add the `IndexSearchNote` below the search strategy selector. Extract the index strategy from `retriever.retrieverConfig`:

```tsx
const indexConfig = (retriever.retrieverConfig?.index ?? {}) as Record<string, unknown>;
const indexStrategy = (indexConfig.strategy as string) ?? "plain";

// ... then in JSX, after search strategy UI:
<IndexSearchNote indexStrategy={indexStrategy} indexConfig={indexConfig} />
```

**Step 3: Thread indexStrategy to SearchStep in wizard**

In `packages/frontend/src/components/wizard/RetrieverWizard.tsx`, pass the currently selected index strategy to `SearchStep`:

```tsx
// In the wizard, the index strategy is part of the wizard state
// Thread it as a new prop to SearchStep:
<SearchStep
  searchStrategy={searchStrategy}
  searchOptions={searchOptions}
  k={k}
  onSearchChange={handleSearchChange}
  onKChange={handleKChange}
  indexStrategy={indexStrategy}  // NEW
  indexConfig={indexConfig}       // NEW
/>
```

Update `SearchStep` props:

```typescript
interface SearchStepProps {
  searchStrategy: string;
  searchOptions: Record<string, unknown>;
  k: number;
  onSearchChange: (strategy: string, options: Record<string, unknown>) => void;
  onKChange: (k: number) => void;
  indexStrategy?: string;    // NEW
  indexConfig?: Record<string, unknown>;  // NEW
}
```

Then add `<IndexSearchNote>` in the SearchStep JSX, after the strategy cards:

```tsx
{indexStrategy && (
  <IndexSearchNote indexStrategy={indexStrategy} indexConfig={indexConfig ?? {}} />
)}
```

**Step 4: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 5: Commit**

```bash
git add packages/frontend/src/components/tabs/QuerySearchTab.tsx packages/frontend/src/components/wizard/steps/SearchStep.tsx packages/frontend/src/components/wizard/RetrieverWizard.tsx
git commit -m "feat(frontend): add index→search interaction notes to search config UI"
```

---

### Task 10: End-to-end verification

**Step 1: Full build**

Run: `pnpm build && pnpm typecheck && pnpm typecheck:backend && pnpm -C packages/frontend build`
Expected: All pass.

**Step 2: Run tests**

Run: `pnpm test && pnpm -C packages/backend test`
Expected: All tests pass.

**Step 3: Manual E2E checklist**

- [ ] Open a retriever → Index tab shows StatsBanner with metric cards
- [ ] Metric cards show total chunks, avg size, min/max, overlap %
- [ ] Click "Show distribution" → histogram appears
- [ ] Select a document → clean text renders without pills or stripes
- [ ] Click anywhere in the document text (raw mode) → chunk highlights with accent background
- [ ] Click on overlap region → both chunks highlight in different colors
- [ ] Click Escape or on non-chunk area → highlight clears
- [ ] In rendered mode, clicking shows "switch to raw mode" note
- [ ] Right panel shows searchable chunk list with size bars
- [ ] Type in search box → chunks filter by content
- [ ] Type a number in jump-to → selects that chunk and scrolls doc
- [ ] Click a chunk in list → document scrolls to and highlights that chunk
- [ ] Chunk detail shows contextual prefix (if contextual indexing)
- [ ] Chunk detail shows summary (if summary indexing)
- [ ] Chunk text is collapsible (collapsed by default)
- [ ] Metadata is collapsible
- [ ] MarkdownViewer no longer shows `<last>` tag error in browser console
- [ ] OpenClaw chunking (400/80) produces reasonable chunk counts (~4,500 not 14,000)
- [ ] Parent-child retriever shows "Searched: child → Returns: parent" in stats banner
- [ ] Search config shows interaction note for parent-child/contextual/summary strategies
- [ ] Prev/Next navigation works in chunk detail
- [ ] With 1000+ chunks, the chunk list doesn't freeze the browser

**Step 4: Commit**

Only if fixes were needed during E2E testing.
