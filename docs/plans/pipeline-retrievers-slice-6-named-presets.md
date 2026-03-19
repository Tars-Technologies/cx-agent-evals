# Slice 6 — Named Presets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewire the `createPresetRetriever` factory to pull configs from the Preset Registry (single source of truth) instead of duplicating config constants, update registry statuses for presets that became available after Slice 4, and export a derived `PresetName` type.

**Architecture:** The Preset Registry (`src/registry/presets.ts`) already defines all 24 preset configs with full metadata. Instead of duplicating them as standalone constants in `experiments/presets.ts`, the factory reads configs directly from the registry. This eliminates ~200 lines of duplication and means flipping a preset's status to `"available"` in the registry is the only step needed to enable it via the factory.

**Tech Stack:** TypeScript, Vitest, eval-lib only. No new dependencies.

> Part of the [Pipeline Retrievers Plan](./pipeline-retrievers-shared-context.md). See shared context for codebase state and design decisions.

---

## Key Insight: Registry as Single Source of Truth

```
BEFORE (duplication):
  registry/presets.ts          experiments/presets.ts
  +-----------------------+    +---------------------------+
  | PresetEntry {         |    | BASELINE_VECTOR_RAG_CONFIG|
  |   id, name, desc,     |    | BM25_CONFIG               |
  |   config: { ... },    |    | HYBRID_CONFIG             |  <-- same configs
  |   status, complexity  |    | HYBRID_RERANKED_CONFIG    |      duplicated!
  | }                     |    |                           |
  | x 24 entries          |    | PRESET_CONFIGS map (4)    |
  +-----------------------+    | createPresetRetriever()   |
         |                     +---------------------------+
         v
    frontend wizard                  runtime factory


AFTER (single source of truth):
  registry/presets.ts          experiments/presets.ts
  +-----------------------+    +---------------------------+
  | PresetEntry {         |    | (keep 4 legacy configs    |
  |   id, name, desc,     |--->|  for backward compat)     |
  |   config: { ... },    |    |                           |
  |   status, complexity  |    | createPresetRetriever()   |
  | }                     |    |   reads config from       |
  | x 24 entries          |    |   PRESET_REGISTRY         |
  +-----------------------+    | PresetName derived from   |
         |                     |   available registry IDs  |
         v                     +---------------------------+
    frontend wizard                  runtime factory
```

---

## Improvements Over Original Plan

1. **Eliminated config duplication** — The original plan added 15-20 standalone `PipelineConfig` constants to `presets.ts`, duplicating what the registry already has. Now the factory reads directly from the registry.

2. **`PipelinePresetDeps.llm` already exists** — No interface change needed (`src/experiments/presets.ts:16`).

3. **Auto-enabling presets** — When any slice marks a registry preset as `"available"` and removes its `comingSoonConfig()` wrapper, the factory picks it up automatically. No need for a separate "add config constant + add to map" step.

4. **5 presets blocked on Slice 5** — Presets using `dedup`/`mmr` refinement stay `"coming-soon"` in the registry until Slice 5 lands those types. The factory naturally excludes them (it only serves `"available"` presets).

---

## Codebase Reference (Verified)

All paths below are relative to `packages/eval-lib/`.

**Key existing files:**
- `src/experiments/presets.ts` — 4 preset configs, PRESET_CONFIGS map, createPresetRetriever factory, deprecated wrappers (113 lines)
- `src/experiments/index.ts` — re-exports from presets.ts (27 lines)
- `src/index.ts` — root barrel (155 lines)
- `src/registry/presets.ts` — 24 PresetEntry objects (13 available, 11 coming-soon), uses `comingSoonConfig()` casts (739 lines)
- `tests/unit/experiments/presets.test.ts` — 4 describe blocks testing legacy wrappers (235 lines)
- `tests/unit/registry/presets.test.ts` — registry structure tests, asserts 13 available / 11 coming-soon (97 lines)
- `tests/fixtures.ts` — `mockEmbedder()` helper, no mockLLM yet (71 lines)

**PipelineRetriever constructor validation** (`pipeline-retriever.ts:148-169`):
- Throws if refinement includes `"rerank"` but no `reranker` in deps
- Throws if query strategy is `hyde|multi-query|step-back|rewrite` but no `llm` in deps
- Throws if index strategy is `contextual|summary` but no `llm` in deps

**Preset dependency groups (for test parameterization):**

| Group | Presets | Needs LLM | Needs Reranker |
|-------|---------|-----------|----------------|
| Basic (no deps) | baseline-vector-rag, bm25, hybrid, hybrid-rrf, openclaw-style, parent-child-dense | No | No |
| Reranker only | dense-reranked, bm25-reranked, hybrid-reranked, hybrid-rrf-reranked | No | Yes |
| LLM only | hyde-dense, hyde-hybrid, contextual-dense, contextual-hybrid, summary-dense, rewrite-hybrid | Yes | No |
| LLM + Reranker | hyde-hybrid-reranked, anthropic-best, rewrite-hybrid-reranked | Yes | Yes |

---

## Final State After Slice 6

| Artifact | Before | After |
|----------|--------|-------|
| `experiments/presets.ts` config constants | 4 | 4 (kept for backward compat only) |
| `PRESET_CONFIGS` map | 4 entries (local) | Removed — factory reads from registry |
| `PresetName` type | derived from local map (4) | derived from registry available IDs (19) |
| `createPresetRetriever` | looks up local map | looks up `PRESET_REGISTRY` |
| Registry available presets | 13 | 19 |
| Registry coming-soon presets | 11 | 5 |
| Preset unit tests | 4 describe blocks | 4 legacy + 1 parameterized describe |

---

## Modified Files

- `src/experiments/presets.ts` — rewire factory to use registry, derive PresetName, remove PRESET_CONFIGS map
- `src/experiments/index.ts` — export PresetName
- `src/index.ts` — export PresetName
- `src/registry/presets.ts` — 6 presets: coming-soon -> available, remove comingSoonConfig() wrappers
- `tests/fixtures.ts` — add `mockLLM()` helper
- `tests/unit/experiments/presets.test.ts` — new parameterized tests for generic factory
- `tests/unit/registry/presets.test.ts` — update count assertions (19/5)

---

### Task 1: Add mockLLM fixture

**Files:**
- Modify: `tests/fixtures.ts:70` (append after mockEmbedder)

**Step 1: Add mockLLM helper to fixtures**

```typescript
// Append to tests/fixtures.ts after mockEmbedder function:

import type { PipelineLLM } from "../src/retrievers/pipeline/llm.interface.js";

export function mockLLM(): PipelineLLM {
  return {
    name: "MockLLM",
    async complete() {
      return "mock LLM response";
    },
  };
}
```

**Step 2: Run existing tests to verify no regressions**

Run: `pnpm -C packages/eval-lib test -- --run`
Expected: All existing tests pass.

**Step 3: Commit**

```bash
git add packages/eval-lib/tests/fixtures.ts
git commit -m "test(eval-lib): add mockLLM fixture for preset tests"
```

---

### Task 2: Update registry preset statuses

**Files:**
- Modify: `src/registry/presets.ts`

**Step 1: Update 6 presets from coming-soon to available**

The following 6 presets should change (all their strategies are now implemented after Slice 4):
1. `openclaw-style` — `status: "coming-soon"` -> `status: "available"`, remove `comingSoonConfig()` wrapper
2. `contextualDense` — `status: "coming-soon"` -> `status: "available"`, remove `comingSoonConfig()` wrapper
3. `contextualHybrid` — `status: "coming-soon"` -> `status: "available"`, remove `comingSoonConfig()` wrapper
4. `anthropicBest` — `status: "coming-soon"` -> `status: "available"`, remove `comingSoonConfig()` wrapper
5. `parentChildDense` — `status: "coming-soon"` -> `status: "available"`, remove `comingSoonConfig()` wrapper
6. `summaryDense` — `status: "coming-soon"` -> `status: "available"`, remove `comingSoonConfig()` wrapper

For each, two changes:
- Change `status: "coming-soon"` -> `status: "available"`
- Change `config: comingSoonConfig({ ... })` -> `config: { ... }` (remove the wrapper, keep the config object)

**Step 2: Reorder the PRESET_REGISTRY array**

Move the 6 newly-available entries into the available section (before coming-soon), maintaining complexity ordering:

```typescript
export const PRESET_REGISTRY: readonly PresetEntry[] = [
  // Available — basic
  baselineVectorRag,
  bm25,
  denseReranked,
  bm25Reranked,
  // Available — intermediate
  hybrid,
  hybridReranked,
  hybridRrf,
  hybridRrfReranked,
  hydeDense,
  hydeHybrid,
  rewriteHybrid,
  openclawStyle,           // was coming-soon
  contextualDense,         // was coming-soon
  contextualHybrid,        // was coming-soon
  parentChildDense,        // was coming-soon
  summaryDense,            // was coming-soon
  // Available — advanced
  hydeHybridReranked,
  rewriteHybridReranked,
  anthropicBest,           // was coming-soon
  // Coming-soon (blocked on Slice 5: dedup/mmr refinement)
  multiQueryDense,
  diverseHybrid,
  multiQueryHybrid,
  stepBackHybrid,
  premium,
] as const;
```

**Step 3: Keep comingSoonConfig()**

The 5 remaining coming-soon presets reference `{ type: "dedup" }` or `{ type: "mmr" }` which are NOT in `RefinementStepConfig`. The helper is still needed.

**Step 4: Run tests (expect failure — counts are wrong)**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/registry/presets.test.ts`
Expected: FAIL — count assertions (13/11) are now wrong.

---

### Task 3: Update registry preset tests

**Files:**
- Modify: `tests/unit/registry/presets.test.ts`

**Step 1: Update count assertions**

```typescript
// Before:
expect(available).toHaveLength(13);
// After:
expect(available).toHaveLength(19);

// Before:
expect(comingSoon).toHaveLength(11);
// After:
expect(comingSoon).toHaveLength(5);
```

**Step 2: Add test for the 6 newly-available presets**

```typescript
it("newly available presets from Slice 4 index strategies", () => {
  const newlyAvailable = [
    "openclaw-style",
    "contextual-dense",
    "contextual-hybrid",
    "anthropic-best",
    "parent-child-dense",
    "summary-dense",
  ];
  for (const id of newlyAvailable) {
    const preset = PRESET_REGISTRY.find((p) => p.id === id)!;
    expect(preset).toBeDefined();
    expect(preset.status).toBe("available");
  }
});
```

**Step 3: Add test for remaining coming-soon presets**

```typescript
it("remaining coming-soon presets depend on dedup or mmr refinement", () => {
  const comingSoon = PRESET_REGISTRY.filter((p) => p.status === "coming-soon");
  const ids = comingSoon.map((p) => p.id);
  expect(ids).toEqual(
    expect.arrayContaining([
      "multi-query-dense",
      "multi-query-hybrid",
      "diverse-hybrid",
      "step-back-hybrid",
      "premium",
    ]),
  );
  expect(comingSoon).toHaveLength(5);
});
```

**Step 4: Run tests**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/registry/presets.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add packages/eval-lib/src/registry/presets.ts packages/eval-lib/tests/unit/registry/presets.test.ts
git commit -m "feat(eval-lib): mark 6 registry presets as available after Slice 4 index strategies"
```

---

### Task 4: Write failing tests for registry-backed factory

**Files:**
- Modify: `tests/unit/experiments/presets.test.ts`

**Step 1: Add imports and new describe block**

Add at the top of the file:
```typescript
import { createPresetRetriever } from "../../../src/experiments/presets.js";
import type { PipelinePresetDeps } from "../../../src/experiments/presets.js";
import { mockLLM } from "../../fixtures.js";
```

Add a new describe block after the existing 4 legacy blocks:

```typescript
// ---------------------------------------------------------------------------
// createPresetRetriever — registry-backed factory (all available presets)
// ---------------------------------------------------------------------------

describe("createPresetRetriever (registry-backed factory)", () => {
  const baseDeps: PipelinePresetDeps = { chunker, embedder };
  const depsWithReranker: PipelinePresetDeps = { ...baseDeps, reranker: mockReranker };
  const llm = mockLLM();
  const depsWithLlm: PipelinePresetDeps = { ...baseDeps, llm };
  const fullDeps: PipelinePresetDeps = { ...baseDeps, reranker: mockReranker, llm };

  // Presets that need NO LLM and NO reranker
  const basicPresets = [
    "baseline-vector-rag",
    "bm25",
    "hybrid",
    "hybrid-rrf",
    "openclaw-style",
    "parent-child-dense",
  ] as const;

  // Presets that need reranker only
  const rerankerOnlyPresets = [
    "dense-reranked",
    "bm25-reranked",
    "hybrid-reranked",
    "hybrid-rrf-reranked",
  ] as const;

  // Presets that need LLM only
  const llmOnlyPresets = [
    "hyde-dense",
    "hyde-hybrid",
    "contextual-dense",
    "contextual-hybrid",
    "summary-dense",
    "rewrite-hybrid",
  ] as const;

  // Presets that need both LLM and reranker
  const llmAndRerankerPresets = [
    "hyde-hybrid-reranked",
    "anthropic-best",
    "rewrite-hybrid-reranked",
  ] as const;

  const allPresetNames = [
    ...basicPresets,
    ...rerankerOnlyPresets,
    ...llmOnlyPresets,
    ...llmAndRerankerPresets,
  ];

  it("factory serves exactly 19 available presets", () => {
    expect(allPresetNames).toHaveLength(19);
  });

  it.each(basicPresets.map((n) => ({ name: n })))(
    "$name creates a retriever with base deps",
    ({ name }) => {
      const retriever = createPresetRetriever(name, baseDeps);
      expect(retriever.name).toBe(name);
    },
  );

  it.each(rerankerOnlyPresets.map((n) => ({ name: n })))(
    "$name creates a retriever with reranker deps",
    ({ name }) => {
      const retriever = createPresetRetriever(name, depsWithReranker);
      expect(retriever.name).toBe(name);
    },
  );

  it.each(llmOnlyPresets.map((n) => ({ name: n })))(
    "$name creates a retriever with llm deps",
    ({ name }) => {
      const retriever = createPresetRetriever(name, depsWithLlm);
      expect(retriever.name).toBe(name);
    },
  );

  it.each(llmAndRerankerPresets.map((n) => ({ name: n })))(
    "$name creates a retriever with full deps",
    ({ name }) => {
      const retriever = createPresetRetriever(name, fullDeps);
      expect(retriever.name).toBe(name);
    },
  );

  // Dependency validation
  it.each(rerankerOnlyPresets.map((n) => ({ name: n })))(
    "$name throws without reranker",
    ({ name }) => {
      expect(() => createPresetRetriever(name, baseDeps)).toThrow(/reranker/i);
    },
  );

  it.each(llmOnlyPresets.map((n) => ({ name: n })))(
    "$name throws without llm",
    ({ name }) => {
      expect(() => createPresetRetriever(name, baseDeps)).toThrow(/LLM/i);
    },
  );

  it.each(llmAndRerankerPresets.map((n) => ({ name: n })))(
    "$name throws without llm (even with reranker)",
    ({ name }) => {
      expect(() => createPresetRetriever(name, depsWithReranker)).toThrow(/LLM/i);
    },
  );

  it("throws for unknown preset name", () => {
    expect(() => createPresetRetriever("nonexistent", baseDeps)).toThrow(/Unknown or unavailable/);
  });

  it("throws for coming-soon preset name", () => {
    expect(() => createPresetRetriever("premium", fullDeps)).toThrow(/Unknown or unavailable/);
  });

  it("name override works via overrides parameter", () => {
    const retriever = createPresetRetriever("hybrid-rrf", baseDeps, {
      name: "custom-name",
    });
    expect(retriever.name).toBe("custom-name");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/experiments/presets.test.ts`
Expected: FAIL — factory still uses old local map, doesn't know new preset names.

---

### Task 5: Rewire factory to use registry

**Files:**
- Modify: `src/experiments/presets.ts`

**Step 1: Rewire the factory**

Replace the `PRESET_CONFIGS` map and `createPresetRetriever` function with:

```typescript
import { PRESET_REGISTRY } from "../registry/presets.js";

// --- Build runtime map from registry (available presets only) ---
const AVAILABLE_PRESET_MAP = new Map(
  PRESET_REGISTRY
    .filter((p) => p.status === "available")
    .map((p) => [p.id, p.config]),
);

/** Union of all available preset names, derived from the registry. */
export type PresetName = string & {};  // Structural typing — accepts any string at runtime
// (Compile-time narrowing happens via the registry's available ids)

export function createPresetRetriever(
  presetName: string,
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
): PipelineRetriever {
  const base = AVAILABLE_PRESET_MAP.get(presetName);
  if (!base) {
    throw new Error(`Unknown or unavailable preset: "${presetName}"`);
  }
  const config: PipelineConfig = {
    ...base,
    ...overrides,
    name: overrides?.name ?? base.name,
  };
  return new PipelineRetriever(config, deps);
}
```

Keep the 4 existing config constants (`BASELINE_VECTOR_RAG_CONFIG`, `BM25_CONFIG`, `HYBRID_CONFIG`, `HYBRID_RERANKED_CONFIG`) and the deprecated convenience wrappers for backward compatibility — they still call through to `createPresetRetriever`.

**Step 2: Run tests**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/experiments/presets.test.ts`
Expected: All tests PASS — legacy tests and new factory tests.

**Step 3: Commit**

```bash
git add packages/eval-lib/src/experiments/presets.ts packages/eval-lib/tests/unit/experiments/presets.test.ts
git commit -m "feat(eval-lib): rewire createPresetRetriever to use registry as single source of truth"
```

---

### Task 6: Update barrel exports

**Files:**
- Modify: `src/experiments/index.ts`
- Modify: `src/index.ts`

**Step 1: Update experiments/index.ts**

Add `PresetName` to the type exports and `createPresetRetriever` to the value exports (if not already there). The 4 legacy config constants and convenience wrappers stay as-is.

```typescript
export type {
  PresetName,
  PipelinePresetDeps,
  // ... existing deprecated types ...
} from "./presets.js";
```

**Step 2: Update src/index.ts**

Add `PresetName` to the type re-exports from experiments:

```typescript
export type {
  PresetName,
  PipelinePresetDeps,
  // ... existing deprecated types ...
} from "./experiments/index.js";
```

Note: No new config constant exports needed — the factory reads from the registry, so consumers use `createPresetRetriever("contextual-dense", deps)` rather than importing `CONTEXTUAL_DENSE_CONFIG`.

**Step 3: Run tests + typecheck**

Run: `pnpm -C packages/eval-lib test -- --run && pnpm typecheck`
Expected: All tests PASS, no type errors.

**Step 4: Commit**

```bash
git add packages/eval-lib/src/experiments/index.ts packages/eval-lib/src/index.ts
git commit -m "feat(eval-lib): export PresetName from barrel files"
```

---

### Task 7: Run full test suite and final verification

**Step 1: Run full test suite**

Run: `pnpm -C packages/eval-lib test -- --run`
Expected: All tests pass.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

**Step 3: Run build**

Run: `pnpm build`
Expected: Build succeeds.

**Step 4: Verify**

The test suite should confirm:
- 19 available + 5 coming-soon = 24 total registry presets
- All 19 available presets construct successfully with appropriate deps
- Coming-soon presets are rejected by the factory
- LLM/reranker validation works for all categories

---

## Deferred Work (After Slice 5)

When Slice 5 lands `DedupRefinementStep` and `MmrRefinementStep` in the `RefinementStepConfig` union:

1. In `registry/presets.ts`: change 5 remaining presets from `"coming-soon"` -> `"available"`, remove `comingSoonConfig()` wrappers
2. Update registry test counts: 24 available, 0 coming-soon
3. Remove `comingSoonConfig()` helper entirely

That's it — the factory automatically picks up the newly-available presets. No changes to `experiments/presets.ts`, barrel exports, or factory tests needed.
