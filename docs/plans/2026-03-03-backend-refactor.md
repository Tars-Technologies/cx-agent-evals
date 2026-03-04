# Backend Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the Convex backend to separate concerns, eliminate duplication, reorganize into domain folders, and improve type safety — following the design in `packages/backend/docs/refactoring-suggestions.md`.

**Architecture:** Six-phase refactor. Phase 1 removes dead code. Phase 2 extracts non-Convex code into eval-lib sub-path modules. Phase 3 reorganizes `convex/` into domain folders (changes all API paths). Phase 4 tightens type safety. Phase 5 adds test coverage. Phase 6 applies architectural polish. Each phase is independently deployable.

**Tech Stack:** TypeScript, Convex, pnpm workspaces, tsup, vitest, convex-test

---

## Reference Documents

- Design doc: `packages/backend/docs/refactoring-suggestions.md`
- Frontend impact: `packages/backend/docs/frontend-changes-after-backend-refactor.md`
- Architecture: `packages/backend/docs/architecture.md`
- Module docs: `packages/backend/docs/generation-module.md`, `retrieval-module.md`, `experiments-module.md`

## Verification Commands (used throughout)

```bash
# Build eval-lib (from repo root)
pnpm build

# TypeScript check backend
pnpm typecheck:backend

# Deploy Convex functions (from packages/backend/)
cd packages/backend && npx convex dev --once

# Run backend tests
pnpm -C packages/backend test

# Run eval-lib tests
pnpm -C packages/eval-lib test

# Build frontend (verifies api.* paths)
pnpm -C packages/frontend build
```

---

# Phase 1: Dead Code Cleanup (Low Risk)

> Remove deprecated files, functions, and unused constants. This reduces noise before structural changes.

---

### Task 1: Remove deprecated files

**Files:**
- Delete: `packages/backend/convex/ragActions.ts` (74 lines, entire file deprecated)
- Delete: `packages/backend/convex/testing.ts` (7 lines, empty docstring only)
- Delete: `packages/backend/convex/README.md` (91 lines, default Convex boilerplate)

**Step 1: Verify no callers exist**

```bash
cd packages/backend
grep -r "ragActions" convex/ --include="*.ts" | grep -v "_generated" | grep -v "ragActions.ts"
grep -r "testing" convex/ --include="*.ts" | grep -v "_generated" | grep -v "testing.ts" | grep -v "test.setup"
```

Expected: No results (no code imports from these files).

**Step 2: Delete the files**

```bash
rm packages/backend/convex/ragActions.ts
rm packages/backend/convex/testing.ts
rm packages/backend/convex/README.md
```

**Step 3: Verify backend still deploys**

```bash
cd packages/backend && npx convex dev --once
```

Expected: Successful deployment with no errors.

**Step 4: Commit**

```bash
git add -u packages/backend/convex/ragActions.ts packages/backend/convex/testing.ts packages/backend/convex/README.md
git commit -m "chore: remove deprecated ragActions.ts, empty testing.ts, and boilerplate README"
```

---

### Task 2: Remove deprecated functions and unused constants

**Files:**
- Modify: `packages/backend/convex/rag.ts` (remove lines 141-202: `insertChunk` and `deleteKbChunks`)
- Modify: `packages/backend/convex/langsmithSyncRetry.ts` (remove line 4: `MAX_AUTO_RETRIES`)

**Step 1: Verify no callers for deprecated rag functions**

```bash
cd packages/backend
grep -r "insertChunk\b" convex/ --include="*.ts" | grep -v "_generated" | grep -v "insertChunkBatch" | grep -v "rag.ts"
grep -r "deleteKbChunks\b" convex/ --include="*.ts" | grep -v "_generated" | grep -v "rag.ts"
grep -r "MAX_AUTO_RETRIES" convex/ --include="*.ts" | grep -v "_generated"
```

Expected: No external callers for any of these.

**Step 2: Remove deprecated functions from rag.ts**

Delete the entire block from the `// ─── Legacy Mutations` comment through `deleteKbChunks` (lines 141-202 in current file). Keep `deleteDocumentChunks` (lines 170-183 — this one is active, not deprecated).

After removal, the file should go from `insertChunkBatch` → `deleteDocumentChunks` → queries section, with no legacy section.

Exact removal: Remove these two exported functions and their comments:
- `insertChunk` (lines 143-165, including the `@deprecated` comment on line 144)
- `deleteKbChunks` (lines 185-202, including the `@deprecated` comment on line 186)
- The section header comment `// ─── Legacy Mutations (kept for backward compatibility) ───` (line 141)

Keep `deleteDocumentChunks` (lines 170-183) — it is NOT deprecated and is actively used by cleanup.

**Step 3: Remove `MAX_AUTO_RETRIES` from langsmithSyncRetry.ts**

Delete line 4: `const MAX_AUTO_RETRIES = 3;`

**Step 4: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

Expected: Deployment succeeds, all tests pass.

**Step 5: Commit**

```bash
git add packages/backend/convex/rag.ts packages/backend/convex/langsmithSyncRetry.ts
git commit -m "chore: remove deprecated insertChunk, deleteKbChunks, and unused MAX_AUTO_RETRIES"
```

---

### Task 3: Fix dangling docstrings and clean up package.json

**Files:**
- Modify: `packages/backend/convex/datasets.ts` (lines 72-74: remove dangling docstring)
- Modify: `packages/backend/convex/questions.ts` (lines 64-66: remove dangling docstring)
- Modify: `packages/backend/package.json` (remove `minisearch` from dependencies)

**Step 1: Fix datasets.ts dangling docstring**

At line 72-74 there are two stacked docstrings. Remove the first one (`/** Update dataset question count. */`) — it's a leftover from a removed function. Keep the second docstring (`/** Internal query: get a dataset by ID (no auth check). */`) which correctly documents `getInternal`.

Before:
```typescript
/**
 * Update dataset question count.
 */
/**
 * Internal query: get a dataset by ID (no auth check).
 */
export const getInternal = internalQuery({
```

After:
```typescript
/**
 * Internal query: get a dataset by ID (no auth check).
 */
export const getInternal = internalQuery({
```

**Step 2: Fix questions.ts dangling docstring**

At line 64-66, same pattern. Remove the first docstring (`/** Update a question's relevant spans (used by ground truth assignment). */`), keep the second one.

Before:
```typescript
/**
 * Update a question's relevant spans (used by ground truth assignment).
 */
/**
 * Internal query: list all questions in a dataset (no auth check).
 */
export const byDatasetInternal = internalQuery({
```

After:
```typescript
/**
 * Internal query: list all questions in a dataset (no auth check).
 */
export const byDatasetInternal = internalQuery({
```

**Step 3: Remove `minisearch` from backend package.json**

`minisearch` is a transitive dependency via eval-lib (used by `src/retrievers/pipeline/search/bm25.ts`). It must stay in `convex.json` `externalPackages` but the redundant entry in backend's `package.json` `dependencies` can be removed.

**Important**: Do NOT remove `minisearch` from `convex.json`. Only remove from `package.json`.

**Step 4: Verify**

```bash
pnpm install
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 5: Commit**

```bash
git add packages/backend/convex/datasets.ts packages/backend/convex/questions.ts packages/backend/package.json pnpm-lock.yaml
git commit -m "chore: fix dangling docstrings and remove redundant minisearch dependency"
```

---

# Phase 2: Extract Non-Convex Code to eval-lib (Medium Risk)

> Move pure TypeScript code (LangSmith wrappers, OpenAI helpers, shared types) from backend into eval-lib sub-path modules.

**Critical constraint**: The root barrel (`src/index.ts`) must NOT re-export from `./langsmith/` or `./llm/`. Only `"use node"` action files may import these sub-paths. The `./shared` sub-path is safe for any file.

---

### Task 4: Create `eval-lib/src/shared/` module

**Files:**
- Create: `packages/eval-lib/src/shared/types.ts`
- Create: `packages/eval-lib/src/shared/constants.ts`
- Create: `packages/eval-lib/src/shared/index.ts`

**Step 1: Create types.ts**

Extract `JobStatus` from `generation.ts:27` and `indexing.ts:215`, plus `SerializedSpan` and `ExperimentResult` from `experimentActions.ts:30-41`.

```typescript
// packages/eval-lib/src/shared/types.ts

/**
 * Job lifecycle status used by generation, indexing, and experiment pipelines.
 */
export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "canceling"
  | "canceled";

/**
 * Serialized character span (plain object, no branded types).
 * Used for LangSmith evaluate() I/O where branded types can't cross boundaries.
 */
export interface SerializedSpan {
  docId: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Result of evaluating a single query in an experiment.
 */
export interface ExperimentResult {
  query: string;
  retrievedSpans: SerializedSpan[];
  scores: Record<string, number>;
}
```

**Step 2: Create constants.ts**

Extract magic numbers from action files into named constants.

```typescript
// packages/eval-lib/src/shared/constants.ts

/** Number of chunks to embed in one API call / checkpoint batch (indexingActions.ts) */
export const EMBED_BATCH_SIZE = 200;

/** Deletion batch size for cleanup (indexingActions.ts) */
export const CLEANUP_BATCH_SIZE = 500;

/** Batch size for question inserts (generationActions.ts) */
export const QUESTION_INSERT_BATCH_SIZE = 100;

/** Parallelism tiers for indexing WorkPool */
export const TIER_PARALLELISM = {
  free: 3,
  pro: 10,
  enterprise: 20,
} as const;
```

**Step 3: Create barrel export**

```typescript
// packages/eval-lib/src/shared/index.ts
export type { JobStatus, SerializedSpan, ExperimentResult } from "./types.js";
export {
  EMBED_BATCH_SIZE,
  CLEANUP_BATCH_SIZE,
  QUESTION_INSERT_BATCH_SIZE,
  TIER_PARALLELISM,
} from "./constants.js";
```

**Step 4: Verify the module compiles**

Don't add to tsup or package.json yet — that happens in Task 7. Just verify no syntax errors:

```bash
cd packages/eval-lib && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add packages/eval-lib/src/shared/
git commit -m "feat(eval-lib): add shared/ module with JobStatus, SerializedSpan, ExperimentResult, and constants"
```

---

### Task 5: Create `eval-lib/src/llm/` module

**Files:**
- Create: `packages/eval-lib/src/llm/client.ts`
- Create: `packages/eval-lib/src/llm/embedder-factory.ts`
- Create: `packages/eval-lib/src/llm/config.ts`
- Create: `packages/eval-lib/src/llm/index.ts`

**Step 1: Create client.ts**

Move `createLLMClient()` from `convex/lib/llm.ts` (20 lines). This is the OpenAI adapter for eval-lib's `LLMClient` interface.

```typescript
// packages/eval-lib/src/llm/client.ts
import OpenAI from "openai";
import { openAIClientAdapter, type LLMClient } from "../synthetic-datagen/base.js";

/**
 * Create an LLMClient backed by OpenAI.
 * Requires OPENAI_API_KEY in the environment.
 */
export function createLLMClient(apiKey?: string): LLMClient {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
        "Configure it in your Convex dashboard under Settings → Environment Variables.",
    );
  }
  const openai = new OpenAI({ apiKey: key });
  return openAIClientAdapter(openai as any);
}
```

**Step 2: Create embedder-factory.ts**

Single copy of `createEmbedder()` — replaces 4 duplicates in `indexingActions.ts`, `retrieverActions.ts`, `experimentActions.ts`, and `ragActions.ts` (deleted).

```typescript
// packages/eval-lib/src/llm/embedder-factory.ts
import OpenAI from "openai";
import { OpenAIEmbedder } from "../embedders/openai.js";

/**
 * Create an OpenAIEmbedder instance.
 * Default model: text-embedding-3-small (1536 dimensions).
 */
export function createEmbedder(model?: string, apiKey?: string) {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const openai = new OpenAI({ apiKey: key });
  return new OpenAIEmbedder({
    model: model ?? "text-embedding-3-small",
    client: openai,
  });
}
```

**Step 3: Create config.ts**

Extract `getModel()` from `generationActions.ts`.

```typescript
// packages/eval-lib/src/llm/config.ts

/** Default LLM model for generation strategies */
export const DEFAULT_MODEL = "gpt-4o";

/**
 * Extract model name from strategy config, with default fallback.
 */
export function getModel(strategyConfig: Record<string, unknown>): string {
  return (strategyConfig.model as string) ?? DEFAULT_MODEL;
}
```

**Step 4: Create barrel export**

```typescript
// packages/eval-lib/src/llm/index.ts
export { createLLMClient } from "./client.js";
export { createEmbedder } from "./embedder-factory.js";
export { getModel, DEFAULT_MODEL } from "./config.js";
```

**Step 5: Verify**

```bash
cd packages/eval-lib && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add packages/eval-lib/src/llm/
git commit -m "feat(eval-lib): add llm/ module with createLLMClient, createEmbedder, and getModel"
```

---

### Task 6: Create `eval-lib/src/langsmith/` module

**Files:**
- Create: `packages/eval-lib/src/langsmith/client.ts`
- Create: `packages/eval-lib/src/langsmith/upload.ts`
- Create: `packages/eval-lib/src/langsmith/experiment.ts`
- Create: `packages/eval-lib/src/langsmith/index.ts`

**Step 1: Create client.ts**

Move from `convex/lib/langsmith.ts` (4 lines).

```typescript
// packages/eval-lib/src/langsmith/client.ts
import { Client } from "langsmith";

/**
 * Create a LangSmith client.
 * Uses LANGSMITH_API_KEY from environment (standard LangSmith SDK behavior).
 */
export function getLangSmithClient(): Client {
  return new Client();
}
```

Note: Changed from `async function` with dynamic import to a synchronous function with static import. The dynamic import was a workaround for Convex bundling — now that this lives in eval-lib (which is bundled by Convex with `langsmith` marked as external), a static import is cleaner.

**Step 2: Create upload.ts**

Move `uploadDataset()` from `langsmithSync.ts` (lines 15-102). Keep the interfaces (`UploadProgress`, `UploadOptions`, `UploadResult`).

```typescript
// packages/eval-lib/src/langsmith/upload.ts
import type { GroundTruth } from "../types/index.js";
import { getLangSmithClient } from "./client.js";

export interface UploadProgress {
  uploaded: number;
  total: number;
  failed: number;
}

export interface UploadOptions {
  datasetName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  batchSize?: number;
  maxRetries?: number;
  onProgress?: (progress: UploadProgress) => void;
}

export interface UploadResult {
  datasetName: string;
  datasetUrl: string;
  uploaded: number;
  failed: number;
}

/**
 * Upload ground truth data to LangSmith as a dataset.
 * Creates a new dataset and uploads examples in batches with retry.
 */
export async function uploadDataset(
  groundTruth: readonly GroundTruth[],
  options?: UploadOptions,
): Promise<UploadResult> {
  const client = getLangSmithClient();
  const name = options?.datasetName ?? "rag-eval-dataset";
  const batchSize = options?.batchSize ?? 20;
  const maxRetries = options?.maxRetries ?? 3;
  const onProgress = options?.onProgress;

  const dataset = await client.createDataset(name, {
    description:
      options?.description ?? "RAG evaluation ground truth (character spans)",
    metadata: options?.metadata,
  });

  const datasetUrl = `${client.getHostUrl()}/datasets/${dataset.id}`;

  const examples = groundTruth.map((gt) => ({
    inputs: { query: String(gt.query.text) },
    outputs: {
      relevantSpans: gt.relevantSpans.map((span) => ({
        docId: String(span.docId),
        start: span.start,
        end: span.end,
        text: span.text,
      })),
    },
    metadata: gt.query.metadata as Record<string, unknown>,
    dataset_id: dataset.id,
  }));

  let uploaded = 0;
  let failed = 0;
  const total = examples.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = examples.slice(i, i + batchSize);
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries) {
      try {
        await client.createExamples(batch);
        uploaded += batch.length;
        success = true;
        break;
      } catch {
        attempt++;
        if (attempt >= maxRetries) {
          failed += batch.length;
        }
      }
    }

    if (success || attempt >= maxRetries) {
      onProgress?.({ uploaded, total, failed });
    }
  }

  return { datasetName: name, datasetUrl, uploaded, failed };
}
```

**Step 3: Create experiment.ts**

Move from `experimentActions.ts` (lines 28-154). Bring the types, helper functions, and `runLangSmithExperiment()`.

```typescript
// packages/eval-lib/src/langsmith/experiment.ts
import type { CharacterSpan, Corpus } from "../types/index.js";
import type { Metric } from "../evaluation/metrics/base.js";
import type { Retriever } from "../retrievers/retriever.interface.js";
import { DocumentId } from "../types/primitives.js";
import { positionAwareChunkToSpan } from "../utils/span.js";
import { recall, precision, iou, f1 } from "../evaluation/index.js";
import type { SerializedSpan, ExperimentResult } from "../shared/types.js";

/** Default metrics used for LangSmith experiments */
export const DEFAULT_METRICS: readonly Metric[] = [recall, precision, iou, f1];

/**
 * Config for running an experiment via LangSmith evaluate().
 */
export interface LangSmithExperimentConfig {
  readonly corpus: Corpus;
  readonly retriever: Retriever;
  readonly k: number;
  readonly datasetName: string;
  readonly metrics?: readonly Metric[];
  readonly experimentPrefix?: string;
  readonly metadata?: Record<string, unknown>;
  readonly onResult?: (result: ExperimentResult) => Promise<void>;
}

/**
 * Deserialize raw span objects (from LangSmith I/O) into typed CharacterSpan[].
 */
export function deserializeSpans(raw: unknown): CharacterSpan[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: SerializedSpan) => ({
    docId: DocumentId(s.docId),
    start: s.start,
    end: s.end,
    text: s.text,
  }));
}

/**
 * Create a LangSmith evaluator function from an eval-lib Metric.
 */
export function createLangSmithEvaluator(metric: Metric) {
  return (args: {
    outputs?: Record<string, unknown>;
    referenceOutputs?: Record<string, unknown>;
  }) => {
    const retrieved = deserializeSpans(args.outputs?.relevantSpans);
    const groundTruth = deserializeSpans(args.referenceOutputs?.relevantSpans);
    const score = metric.calculate(retrieved, groundTruth);
    return { key: metric.name, score };
  };
}

/**
 * Create LangSmith evaluators for multiple metrics.
 */
export function createLangSmithEvaluators(metrics: readonly Metric[]) {
  return metrics.map(createLangSmithEvaluator);
}

/**
 * Run a retrieval experiment using LangSmith's evaluate() API.
 *
 * This function:
 * 1. Initializes the retriever with the corpus
 * 2. Creates a target function that retrieves + serializes spans
 * 3. Runs LangSmith evaluate() with metric evaluators
 * 4. Optionally calls onResult for each evaluated query
 * 5. Cleans up the retriever
 */
export async function runLangSmithExperiment(config: LangSmithExperimentConfig): Promise<void> {
  const {
    corpus,
    retriever,
    k,
    datasetName,
    experimentPrefix,
    metadata,
    onResult,
  } = config;
  const metrics = config.metrics ?? DEFAULT_METRICS;

  await retriever.init(corpus);

  try {
    const target = async (inputs: { query: string }) => {
      const chunks = await retriever.retrieve(inputs.query, k);
      return {
        relevantSpans: chunks.map((chunk) => {
          const span = positionAwareChunkToSpan(chunk);
          return {
            docId: String(span.docId),
            start: span.start,
            end: span.end,
            text: span.text,
          };
        }),
      };
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evaluators: Array<(...args: any[]) => any> = [...createLangSmithEvaluators(metrics)];

    if (onResult) {
      evaluators.push(async (args: {
        inputs?: Record<string, unknown>;
        outputs?: Record<string, unknown>;
        referenceOutputs?: Record<string, unknown>;
      }) => {
        const query = String(args.inputs?.query ?? "");
        const retrievedSpans = (args.outputs?.relevantSpans ?? []) as ExperimentResult["retrievedSpans"];
        const retrieved = deserializeSpans(args.outputs?.relevantSpans);
        const groundTruth = deserializeSpans(args.referenceOutputs?.relevantSpans);

        const scores: Record<string, number> = {};
        for (const metric of metrics) {
          scores[metric.name] = metric.calculate(retrieved, groundTruth);
        }

        await onResult({ query, retrievedSpans, scores });
        return { key: "_onResultSync", score: 1 };
      });
    }

    const { evaluate } = await import("langsmith/evaluation");

    await evaluate(target, {
      data: datasetName,
      evaluators,
      experimentPrefix: experimentPrefix ?? retriever.name,
      metadata: {
        retriever: retriever.name,
        k,
        corpusSize: corpus.documents.length,
        ...metadata,
      },
    });
  } finally {
    await retriever.cleanup();
  }
}
```

**Step 4: Create barrel export**

```typescript
// packages/eval-lib/src/langsmith/index.ts
export { getLangSmithClient } from "./client.js";
export {
  uploadDataset,
  type UploadProgress,
  type UploadOptions,
  type UploadResult,
} from "./upload.js";
export {
  runLangSmithExperiment,
  createLangSmithEvaluator,
  createLangSmithEvaluators,
  deserializeSpans,
  DEFAULT_METRICS,
  type LangSmithExperimentConfig,
} from "./experiment.js";
```

**Step 5: Verify**

```bash
cd packages/eval-lib && npx tsc --noEmit
```

Note: This will fail until `langsmith` and `@langchain/core` are added as dependencies (Task 7). If it fails on missing `langsmith` module, that's expected — proceed to Task 7.

**Step 6: Commit**

```bash
git add packages/eval-lib/src/langsmith/
git commit -m "feat(eval-lib): add langsmith/ module with client, uploadDataset, and runLangSmithExperiment"
```

---

### Task 7: Update eval-lib build config and dependencies

**Files:**
- Modify: `packages/eval-lib/package.json` (add dependencies + exports)
- Modify: `packages/eval-lib/tsup.config.ts` (add entry points)

**Step 1: Add dependencies to package.json**

Add `langsmith` and `@langchain/core` as dependencies. They are needed by the new `langsmith/` module:

```json
"dependencies": {
  "langsmith": "^0.3.0",
  "@langchain/core": "^0.3.0",
  "minisearch": "^7.2.0",
  "zod": "^3.23"
}
```

Check the exact versions currently used in backend's `package.json` and match them.

**Step 2: Add sub-path exports to package.json**

Add three new export entries alongside the existing ones. Follow the existing conditional exports pattern:

```json
"./langsmith": {
  "types": "./dist/langsmith/index.d.ts",
  "import": "./dist/langsmith/index.js"
},
"./llm": {
  "types": "./dist/llm/index.d.ts",
  "import": "./dist/llm/index.js"
},
"./shared": {
  "types": "./dist/shared/index.d.ts",
  "import": "./dist/shared/index.js"
}
```

**Step 3: Add entry points to tsup.config.ts**

Add the new sub-path entry points to the `entry` array:

```typescript
entry: [
  "src/index.ts",
  "src/embedders/openai.ts",
  "src/rerankers/cohere.ts",
  "src/pipeline/internals.ts",
  "src/utils/index.ts",
  // New sub-paths
  "src/langsmith/index.ts",
  "src/llm/index.ts",
  "src/shared/index.ts",
],
```

**Step 4: Mark langsmith and openai as external in tsup**

Since `langsmith` and `openai` are runtime dependencies that shouldn't be bundled into eval-lib's dist, add them to tsup's `external` list if not already there. Check the current tsup config — if it doesn't have an `external` field, add one:

```typescript
external: ["openai", "langsmith", "langsmith/evaluation", "@langchain/core", "cohere-ai"],
```

**Step 5: Install and build**

```bash
pnpm install
pnpm build
```

Expected: Build succeeds, new `dist/langsmith/`, `dist/llm/`, `dist/shared/` directories are created.

**Step 6: Verify exports resolve**

```bash
node -e "require('rag-evaluation-system/shared')" 2>&1 || echo "CJS failed (ok if ESM-only)"
node --input-type=module -e "import { JobStatus } from 'rag-evaluation-system/shared'" 2>&1 && echo "ESM OK"
```

**Step 7: Commit**

```bash
git add packages/eval-lib/package.json packages/eval-lib/tsup.config.ts pnpm-lock.yaml
git commit -m "build(eval-lib): add langsmith, llm, shared sub-path exports and dependencies"
```

---

### Task 8: Write tests for extracted eval-lib modules

**Files:**
- Create: `packages/eval-lib/tests/shared/types.test.ts`
- Create: `packages/eval-lib/tests/llm/config.test.ts`
- Create: `packages/eval-lib/tests/langsmith/experiment.test.ts`

**Step 1: Test shared types**

```typescript
// packages/eval-lib/tests/shared/types.test.ts
import { describe, it, expect } from "vitest";
import type { JobStatus, SerializedSpan, ExperimentResult } from "rag-evaluation-system/shared";

describe("shared/types", () => {
  it("JobStatus accepts valid statuses", () => {
    const statuses: JobStatus[] = [
      "pending", "running", "completed", "completed_with_errors",
      "failed", "canceling", "canceled",
    ];
    expect(statuses).toHaveLength(7);
  });

  it("ExperimentResult has correct shape", () => {
    const result: ExperimentResult = {
      query: "test query",
      retrievedSpans: [{ docId: "doc1", start: 0, end: 10, text: "hello" }],
      scores: { recall: 0.5, precision: 0.8 },
    };
    expect(result.query).toBe("test query");
    expect(result.retrievedSpans).toHaveLength(1);
  });
});
```

**Step 2: Test llm/config**

```typescript
// packages/eval-lib/tests/llm/config.test.ts
import { describe, it, expect } from "vitest";
import { getModel, DEFAULT_MODEL } from "rag-evaluation-system/llm";

describe("llm/config", () => {
  it("getModel returns model from config", () => {
    expect(getModel({ model: "gpt-4o-mini" })).toBe("gpt-4o-mini");
  });

  it("getModel falls back to default", () => {
    expect(getModel({})).toBe(DEFAULT_MODEL);
  });

  it("DEFAULT_MODEL is gpt-4o", () => {
    expect(DEFAULT_MODEL).toBe("gpt-4o");
  });
});
```

**Step 3: Test langsmith/experiment helpers**

```typescript
// packages/eval-lib/tests/langsmith/experiment.test.ts
import { describe, it, expect } from "vitest";
import { deserializeSpans, createLangSmithEvaluator, DEFAULT_METRICS } from "rag-evaluation-system/langsmith";
import { recall } from "rag-evaluation-system";

describe("langsmith/experiment", () => {
  describe("deserializeSpans", () => {
    it("converts raw span objects to CharacterSpan[]", () => {
      const raw = [
        { docId: "doc1", start: 0, end: 10, text: "hello" },
        { docId: "doc2", start: 5, end: 15, text: "world" },
      ];
      const spans = deserializeSpans(raw);
      expect(spans).toHaveLength(2);
      expect(String(spans[0].docId)).toBe("doc1");
      expect(spans[0].start).toBe(0);
      expect(spans[0].end).toBe(10);
    });

    it("returns empty array for non-array input", () => {
      expect(deserializeSpans(null)).toEqual([]);
      expect(deserializeSpans(undefined)).toEqual([]);
      expect(deserializeSpans("string")).toEqual([]);
    });
  });

  describe("createLangSmithEvaluator", () => {
    it("creates an evaluator that computes metric score", () => {
      const evaluator = createLangSmithEvaluator(recall);
      const result = evaluator({
        outputs: {
          relevantSpans: [{ docId: "doc1", start: 0, end: 10, text: "hello" }],
        },
        referenceOutputs: {
          relevantSpans: [{ docId: "doc1", start: 0, end: 10, text: "hello" }],
        },
      });
      expect(result.key).toBe("recall");
      expect(result.score).toBe(1);
    });
  });

  describe("DEFAULT_METRICS", () => {
    it("includes recall, precision, iou, f1", () => {
      expect(DEFAULT_METRICS).toHaveLength(4);
      const names = DEFAULT_METRICS.map((m) => m.name);
      expect(names).toContain("recall");
      expect(names).toContain("precision");
      expect(names).toContain("iou");
      expect(names).toContain("f1");
    });
  });
});
```

**Step 4: Run tests**

```bash
pnpm -C packages/eval-lib test
```

Expected: All new tests pass alongside existing 133 tests.

**Step 5: Commit**

```bash
git add packages/eval-lib/tests/shared/ packages/eval-lib/tests/llm/ packages/eval-lib/tests/langsmith/
git commit -m "test(eval-lib): add tests for shared, llm, and langsmith modules"
```

---

### Task 9: Update backend imports — shared module

**Files:**
- Modify: `packages/backend/convex/generation.ts` (replace local `JobStatus` with import)
- Modify: `packages/backend/convex/indexing.ts` (replace local `JobStatus` with import)
- Modify: `packages/backend/convex/indexingActions.ts` (replace magic numbers with constants)
- Modify: `packages/backend/convex/generationActions.ts` (replace `BATCH_SIZE` with constant)

**Step 1: Update generation.ts**

Replace line 27 `type JobStatus = ...` with:
```typescript
import type { JobStatus } from "rag-evaluation-system/shared";
```

Remove the local `type JobStatus = ...` definition.

**Step 2: Update indexing.ts**

Replace line 215 `type JobStatus = ...` (inside `onDocumentIndexed` handler) with an import at the top of the file:
```typescript
import type { JobStatus } from "rag-evaluation-system/shared";
```

Remove the local `type JobStatus = ...` definition inside the handler.

**Step 3: Update indexingActions.ts**

Replace the magic numbers at lines 14-17:
```typescript
const EMBED_BATCH_SIZE = 200;
const CLEANUP_BATCH_SIZE = 500;
```

With an import:
```typescript
import { EMBED_BATCH_SIZE, CLEANUP_BATCH_SIZE } from "rag-evaluation-system/shared";
```

**Step 4: Update generationActions.ts**

If there's a local `BATCH_SIZE = 100` constant used for question insert batching, replace with:
```typescript
import { QUESTION_INSERT_BATCH_SIZE } from "rag-evaluation-system/shared";
```

And update usages from `BATCH_SIZE` to `QUESTION_INSERT_BATCH_SIZE`. Search for all `BATCH_SIZE` or `100` references used in batch insert loops.

**Step 5: Rebuild and verify**

```bash
pnpm build
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 6: Commit**

```bash
git add packages/backend/convex/generation.ts packages/backend/convex/indexing.ts packages/backend/convex/indexingActions.ts packages/backend/convex/generationActions.ts
git commit -m "refactor(backend): use eval-lib shared/ imports for JobStatus and constants"
```

---

### Task 10: Update backend imports — llm module

**Files:**
- Modify: `packages/backend/convex/indexingActions.ts` (remove `createEmbedder`, import from eval-lib)
- Modify: `packages/backend/convex/retrieverActions.ts` (remove `createEmbedder`, import from eval-lib)
- Modify: `packages/backend/convex/experimentActions.ts` (remove `createEmbedder`, import from eval-lib)
- Modify: `packages/backend/convex/generationActions.ts` (update `createLLMClient` import, replace `getModel`)

**Step 1: Update indexingActions.ts**

Remove the local `createEmbedder` function (around lines 22-30). Add import:
```typescript
import { createEmbedder } from "rag-evaluation-system/llm";
```

Also remove the `import OpenAI from "openai";` line since it's no longer needed (createEmbedder handles it internally).

Remove `import { OpenAIEmbedder } from "rag-evaluation-system";` if it's only used by the local createEmbedder — check if OpenAIEmbedder is used elsewhere in the file. If not, remove.

**Step 2: Update retrieverActions.ts**

Same pattern. Remove local `createEmbedder` function (around lines 18-25). Add import:
```typescript
import { createEmbedder } from "rag-evaluation-system/llm";
```

Remove `import OpenAI from "openai";` if no longer needed directly. Check if `OpenAIEmbedder` import from `rag-evaluation-system` can be removed.

**Step 3: Update experimentActions.ts**

Remove local `createEmbedder` function (around lines 158-166). Add import:
```typescript
import { createEmbedder } from "rag-evaluation-system/llm";
```

Remove `import OpenAI from "openai";` if no longer needed. The `OpenAIEmbedder` import may still be needed if used elsewhere in the file.

**Step 4: Update generationActions.ts**

Replace `import { createLLMClient } from "./lib/llm";` with:
```typescript
import { createLLMClient, getModel } from "rag-evaluation-system/llm";
```

Remove the local `getModel` function (around lines 21-23).

Remove `import OpenAI from "openai";` if it's only used for `createEmbedder` (which was in ragActions.ts, now deleted). Check if `OpenAI` is used for anything else in this file.

**Step 5: Rebuild and verify**

```bash
pnpm build
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 6: Commit**

```bash
git add packages/backend/convex/indexingActions.ts packages/backend/convex/retrieverActions.ts packages/backend/convex/experimentActions.ts packages/backend/convex/generationActions.ts
git commit -m "refactor(backend): use eval-lib llm/ for createEmbedder, createLLMClient, and getModel"
```

---

### Task 11: Update backend imports — langsmith module

**Files:**
- Modify: `packages/backend/convex/langsmithSync.ts` (replace inlined `uploadDataset` with import)
- Modify: `packages/backend/convex/experimentActions.ts` (replace inlined LangSmith code with imports)

**Step 1: Update langsmithSync.ts**

This file has `uploadDataset()` inlined (lines 15-102). Replace with an import:

```typescript
import { uploadDataset } from "rag-evaluation-system/langsmith";
```

Remove the entire inlined block: `UploadProgress`, `UploadOptions`, `UploadResult` interfaces and the `uploadDataset` function. Also remove `import { getLangSmithClient } from "./lib/langsmith.js";` since it's no longer needed (uploadDataset handles the client internally).

Keep the Convex action `syncDataset` and everything after line 102.

**Step 2: Update experimentActions.ts**

Replace the inlined LangSmith code (lines 28-154) with imports:

```typescript
import {
  runLangSmithExperiment,
  deserializeSpans,
  type LangSmithExperimentConfig,
  type ExperimentResult,
} from "rag-evaluation-system/langsmith";
```

Remove:
- `interface ExperimentResult` (lines 30-34)
- `interface SerializedSpan` (lines 36-41)
- `function deserializeSpans()` (lines 43-51)
- `function createLangSmithEvaluator()` (lines 53-63)
- `function createLangSmithEvaluators()` (lines 65-67)
- `interface LangSmithExperimentConfig` (lines 69-78)
- `const DEFAULT_METRICS` (line 80)
- `async function runLangSmithExperiment()` (lines 82-154)
- The `// ─── Inlined from eval-lib/src/langsmith/ ───` comment (line 28)

Update the remaining code in `runEvaluation` action to use the imported `runLangSmithExperiment` instead of the local copy. The function signature and usage should be identical.

Also update imports from `rag-evaluation-system` — remove individual metric imports (`recall`, `precision`, `iou`, `f1`) and `positionAwareChunkToSpan` if they're only used by the removed LangSmith code. Check carefully which imports are still needed by the remaining code.

**Step 3: Rebuild and verify**

```bash
pnpm build
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 4: Commit**

```bash
git add packages/backend/convex/langsmithSync.ts packages/backend/convex/experimentActions.ts
git commit -m "refactor(backend): use eval-lib langsmith/ for uploadDataset and runLangSmithExperiment"
```

---

### Task 12: Delete old lib files and final Phase 2 verification

**Files:**
- Delete: `packages/backend/convex/lib/llm.ts`
- Delete: `packages/backend/convex/lib/langsmith.ts`

**Step 1: Verify no remaining imports**

```bash
cd packages/backend
grep -r "from.*./lib/llm" convex/ --include="*.ts" | grep -v "_generated"
grep -r "from.*./lib/langsmith" convex/ --include="*.ts" | grep -v "_generated"
```

Expected: No results (all imports updated in Tasks 10-11).

**Step 2: Delete the files**

```bash
rm packages/backend/convex/lib/llm.ts
rm packages/backend/convex/lib/langsmith.ts
```

**Step 3: Full verification**

```bash
pnpm build
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
pnpm -C packages/eval-lib test
pnpm -C packages/frontend build
```

Expected: Everything builds, deploys, and tests pass. The backend should be ~200 lines lighter.

**Step 4: Commit**

```bash
git add -u packages/backend/convex/lib/
git commit -m "refactor(backend): delete lib/llm.ts and lib/langsmith.ts (moved to eval-lib)"
```

---

# Phase 3: Convex Directory Reorganization (Higher Risk)

> Move flat `convex/` files into domain subfolders. This changes ALL `api.*` and `internal.*` paths.

**Strategy**: Move one domain at a time. After each domain move, update all `internal.*` references across the entire backend, then verify deployment. Do frontend `api.*` updates last (one batch).

**Important**: When files move into subdirectories, relative imports to `./lib/auth` become `../lib/auth`. Update these in every moved file.

---

### Task 13: Extract shared helpers

**Files:**
- Create: `packages/backend/convex/lib/validators.ts`
- Create: `packages/backend/convex/lib/workpool.ts`
- Modify: `packages/backend/convex/lib/auth.ts` (add `lookupUser`)
- Modify: `packages/backend/convex/schema.ts` (import spanValidator)
- Modify: `packages/backend/convex/questions.ts` (import spanValidator)
- Modify: `packages/backend/convex/experimentResults.ts` (import spanValidator)
- Modify: `packages/backend/convex/generation.ts` (import applyResult/counterPatch)

**Step 1: Create lib/validators.ts**

Extract the triplicated `spanValidator`:

```typescript
// packages/backend/convex/lib/validators.ts
import { v } from "convex/values";

export const spanValidator = v.object({
  docId: v.string(),
  start: v.number(),
  end: v.number(),
  text: v.string(),
});
```

**Step 2: Update schema.ts, questions.ts, experimentResults.ts**

In each file, replace the local `spanValidator` definition (lines 5-10 in each) with:
```typescript
import { spanValidator } from "./lib/validators";
```

For `schema.ts`, the import path is `./lib/validators`.
For `questions.ts` and `experimentResults.ts`, also `./lib/validators`.

Note: After Phase 3 directory moves, these paths will change. For now, keep them as `./lib/validators` since all files are still flat.

**Step 3: Create lib/workpool.ts**

Extract `applyResult` and `counterPatch` from `generation.ts` (lines 31-55):

```typescript
// packages/backend/convex/lib/workpool.ts
import type { RunResult } from "@convex-dev/workpool";

/**
 * Apply a WorkPool RunResult to job counters.
 * Shared by generation, indexing, and experiment callbacks.
 */
export function applyResult(
  job: {
    processedItems: number;
    failedItems: number;
    skippedItems: number;
    failedItemDetails?: Array<{ itemKey: string; error: string }>;
  },
  result: RunResult,
  itemKey: string,
) {
  const processedItems = job.processedItems + (result.kind === "success" ? 1 : 0);
  const failedItems = job.failedItems + (result.kind === "failed" ? 1 : 0);
  const skippedItems = job.skippedItems + (result.kind === "canceled" ? 1 : 0);
  const failedItemDetails = [...(job.failedItemDetails ?? [])];

  if (result.kind === "failed") {
    failedItemDetails.push({ itemKey, error: result.error });
  }

  return { processedItems, failedItems, skippedItems, failedItemDetails };
}

/**
 * Format counter values for a Convex db.patch() call.
 * Converts empty failedItemDetails arrays to undefined (removes field from document).
 */
export function counterPatch(counters: {
  processedItems: number;
  failedItems: number;
  skippedItems: number;
  failedItemDetails: Array<{ itemKey: string; error: string }>;
}) {
  return {
    processedItems: counters.processedItems,
    failedItems: counters.failedItems,
    skippedItems: counters.skippedItems,
    failedItemDetails: counters.failedItemDetails.length > 0 ? counters.failedItemDetails : undefined,
  };
}
```

**Step 4: Update generation.ts**

Replace the local `applyResult` and `counterPatch` functions with:
```typescript
import { applyResult, counterPatch } from "./lib/workpool";
```

Remove lines 29-55 (the section comment `// ─── Shared onComplete Counter Logic (S3) ───` and both functions).

**Step 5: Add lookupUser to lib/auth.ts**

Add this helper function to the end of `lib/auth.ts`:

```typescript
/**
 * Look up a user record by their Clerk ID.
 * Used by mutations that need the internal user _id.
 */
export async function lookupUser(
  ctx: QueryCtx | MutationCtx,
  clerkId: string,
) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
  if (!user) {
    throw new Error("User not found. Please sign in again.");
  }
  return user;
}
```

Add `QueryCtx` and `MutationCtx` to the import if not already there (they're already imported from `../_generated/server`).

**Step 6: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 7: Commit**

```bash
git add packages/backend/convex/lib/ packages/backend/convex/schema.ts packages/backend/convex/questions.ts packages/backend/convex/experimentResults.ts packages/backend/convex/generation.ts
git commit -m "refactor(backend): extract shared validators, workpool helpers, and lookupUser"
```

---

### Task 14: Create `generation/` directory

**Files:**
- Move: `packages/backend/convex/generation.ts` → `packages/backend/convex/generation/orchestration.ts`
- Move: `packages/backend/convex/generationActions.ts` → `packages/backend/convex/generation/actions.ts`
- Update: ALL files referencing `internal.generation.*` or `internal.generationActions.*`

**Step 1: Create directory and move files**

```bash
mkdir -p packages/backend/convex/generation
mv packages/backend/convex/generation.ts packages/backend/convex/generation/orchestration.ts
mv packages/backend/convex/generationActions.ts packages/backend/convex/generation/actions.ts
```

**Step 2: Fix relative imports in moved files**

In `generation/orchestration.ts`:
- `"./_generated/server"` → `"../_generated/server"`
- `"./_generated/api"` → `"../_generated/api"`
- `"./lib/auth"` → `"../lib/auth"`
- `"./_generated/dataModel"` → `"../_generated/dataModel"` (if present)

In `generation/actions.ts`:
- `"./_generated/server"` → `"../_generated/server"`
- `"./_generated/api"` → `"../_generated/api"`
- `"./_generated/dataModel"` → `"../_generated/dataModel"`
- `"./lib/llm"` → `"../lib/llm"` (if it still exists — should be gone after Phase 2)

**Step 3: Update internal references**

Search all `.ts` files in `convex/` for references to the old paths and update them:

| Old | New |
|-----|-----|
| `internal.generation.onQuestionGenerated` | `internal.generation.orchestration.onQuestionGenerated` |
| `internal.generation.onGroundTruthAssigned` | `internal.generation.orchestration.onGroundTruthAssigned` |
| `internal.generationActions.generateForDocument` | `internal.generation.actions.generateForDocument` |
| `internal.generationActions.generateDimensionDriven` | `internal.generation.actions.generateDimensionDriven` |
| `internal.generationActions.generateRealWorldGrounded` | `internal.generation.actions.generateRealWorldGrounded` |
| `internal.generationActions.assignGroundTruthForQuestion` | `internal.generation.actions.assignGroundTruthForQuestion` |

Files to check (use grep):
```bash
grep -rn "internal\.generation\." packages/backend/convex/ --include="*.ts" | grep -v "_generated" | grep -v "generation/"
grep -rn "internal\.generationActions\." packages/backend/convex/ --include="*.ts" | grep -v "_generated"
```

The references are mostly within `generation/orchestration.ts` itself (callbacks referencing actions), but also in test files. Update test files too:
- `packages/backend/tests/generation.test.ts` — update all `internal.generation.*` and `internal.generationActions.*` references.

**Step 4: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 5: Commit**

```bash
git add packages/backend/convex/generation/ packages/backend/tests/
git add -u packages/backend/convex/generation.ts packages/backend/convex/generationActions.ts
git commit -m "refactor(backend): move generation files to generation/ directory"
```

---

### Task 15: Create `retrieval/` directory

**Files:**
- Move: `packages/backend/convex/indexing.ts` → `packages/backend/convex/retrieval/indexing.ts`
- Move: `packages/backend/convex/indexingActions.ts` → `packages/backend/convex/retrieval/indexingActions.ts`
- Move: `packages/backend/convex/retrieverActions.ts` → `packages/backend/convex/retrieval/retrieverActions.ts`
- Move: `packages/backend/convex/rag.ts` → `packages/backend/convex/retrieval/chunks.ts`
- Update: ALL files referencing `internal.indexing.*`, `internal.indexingActions.*`, `internal.rag.*`

**Step 1: Create directory and move files**

```bash
mkdir -p packages/backend/convex/retrieval
mv packages/backend/convex/indexing.ts packages/backend/convex/retrieval/indexing.ts
mv packages/backend/convex/indexingActions.ts packages/backend/convex/retrieval/indexingActions.ts
mv packages/backend/convex/retrieverActions.ts packages/backend/convex/retrieval/retrieverActions.ts
mv packages/backend/convex/rag.ts packages/backend/convex/retrieval/chunks.ts
```

**Step 2: Fix relative imports in all moved files**

All four files need `./` → `../` prefix changes for `_generated/` and `lib/` imports. Same pattern as Task 14.

**Step 3: Update internal references**

Major reference changes (see refactoring-suggestions.md §3 for full table):

| Old | New |
|-----|-----|
| `internal.indexing.*` | `internal.retrieval.indexing.*` |
| `internal.indexingActions.*` | `internal.retrieval.indexingActions.*` |
| `internal.rag.*` | `internal.retrieval.chunks.*` |
| `internal.retrievers.findByConfigHash` | `internal.crud.retrievers.findByConfigHash` (wait — retrievers.ts hasn't moved yet) |

**Important**: `retrievers.ts` (CRUD) moves to `crud/` in Task 17, not `retrieval/`. Only `retrieverActions.ts` moves to `retrieval/`. So references to `internal.retrievers.*` stay unchanged for now.

Files to update: use grep to find all `internal.indexing\.`, `internal.indexingActions\.`, and `internal.rag\.` references across the codebase.

```bash
grep -rn "internal\.indexing\." packages/backend/convex/ --include="*.ts" | grep -v "_generated"
grep -rn "internal\.indexingActions\." packages/backend/convex/ --include="*.ts" | grep -v "_generated"
grep -rn "internal\.rag\." packages/backend/convex/ --include="*.ts" | grep -v "_generated"
```

**Step 4: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 5: Commit**

```bash
git add packages/backend/convex/retrieval/
git add -u packages/backend/convex/indexing.ts packages/backend/convex/indexingActions.ts packages/backend/convex/retrieverActions.ts packages/backend/convex/rag.ts
git commit -m "refactor(backend): move indexing, retrieverActions, and rag to retrieval/ directory"
```

---

### Task 16: Create `experiments/` directory

**Files:**
- Move: `packages/backend/convex/experiments.ts` → `packages/backend/convex/experiments/orchestration.ts`
- Move: `packages/backend/convex/experimentActions.ts` → `packages/backend/convex/experiments/actions.ts`
- Move: `packages/backend/convex/experimentResults.ts` → `packages/backend/convex/experiments/results.ts`
- Update: ALL files referencing `internal.experiments.*`, `internal.experimentActions.*`, `internal.experimentResults.*`

**Step 1: Create directory and move files**

```bash
mkdir -p packages/backend/convex/experiments
mv packages/backend/convex/experiments.ts packages/backend/convex/experiments/orchestration.ts
mv packages/backend/convex/experimentActions.ts packages/backend/convex/experiments/actions.ts
mv packages/backend/convex/experimentResults.ts packages/backend/convex/experiments/results.ts
```

**Step 2: Fix relative imports in moved files**

Same `./` → `../` pattern for `_generated/` and `lib/` imports.

**Step 3: Update internal references**

| Old | New |
|-----|-----|
| `internal.experiments.getInternal` | `internal.experiments.orchestration.getInternal` |
| `internal.experiments.updateStatus` | `internal.experiments.orchestration.updateStatus` |
| `internal.experiments.enqueueExperiment` | `internal.experiments.orchestration.enqueueExperiment` |
| `internal.experiments.onExperimentComplete` | `internal.experiments.orchestration.onExperimentComplete` |
| `internal.experimentActions.runExperiment` | `internal.experiments.actions.runExperiment` |
| `internal.experimentActions.runEvaluation` | `internal.experiments.actions.runEvaluation` |
| `internal.experimentResults.insert` | `internal.experiments.results.insert` |
| `internal.experimentResults.byExperimentInternal` | `internal.experiments.results.byExperimentInternal` |

```bash
grep -rn "internal\.experiments\.\|internal\.experimentActions\.\|internal\.experimentResults\." packages/backend/convex/ --include="*.ts" | grep -v "_generated"
```

Also update test file: `packages/backend/tests/experiments.test.ts`

**Step 4: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 5: Commit**

```bash
git add packages/backend/convex/experiments/ packages/backend/tests/
git add -u packages/backend/convex/experiments.ts packages/backend/convex/experimentActions.ts packages/backend/convex/experimentResults.ts
git commit -m "refactor(backend): move experiments files to experiments/ directory"
```

---

### Task 17: Create `crud/` directory

**Files:**
- Move: `packages/backend/convex/knowledgeBases.ts` → `packages/backend/convex/crud/knowledgeBases.ts`
- Move: `packages/backend/convex/documents.ts` → `packages/backend/convex/crud/documents.ts`
- Move: `packages/backend/convex/datasets.ts` → `packages/backend/convex/crud/datasets.ts`
- Move: `packages/backend/convex/questions.ts` → `packages/backend/convex/crud/questions.ts`
- Move: `packages/backend/convex/users.ts` → `packages/backend/convex/crud/users.ts`
- Move: `packages/backend/convex/retrievers.ts` → `packages/backend/convex/crud/retrievers.ts`
- Update: ALL `internal.*` references for these modules

**Step 1: Create directory and move files**

```bash
mkdir -p packages/backend/convex/crud
mv packages/backend/convex/knowledgeBases.ts packages/backend/convex/crud/knowledgeBases.ts
mv packages/backend/convex/documents.ts packages/backend/convex/crud/documents.ts
mv packages/backend/convex/datasets.ts packages/backend/convex/crud/datasets.ts
mv packages/backend/convex/questions.ts packages/backend/convex/crud/questions.ts
mv packages/backend/convex/users.ts packages/backend/convex/crud/users.ts
mv packages/backend/convex/retrievers.ts packages/backend/convex/crud/retrievers.ts
```

**Step 2: Fix relative imports in all moved files**

Update `./` → `../` for `_generated/` and `lib/` imports in all 6 files.

**Step 3: Update internal references**

This is the largest reference update. All `internal.documents.*`, `internal.datasets.*`, `internal.questions.*`, `internal.users.*`, `internal.retrievers.*` references across the entire codebase must be prefixed with `crud.`.

| Old Pattern | New Pattern |
|-------------|-------------|
| `internal.documents.*` | `internal.crud.documents.*` |
| `internal.datasets.*` | `internal.crud.datasets.*` |
| `internal.questions.*` | `internal.crud.questions.*` |
| `internal.users.*` | `internal.crud.users.*` |
| `internal.retrievers.*` | `internal.crud.retrievers.*` |

```bash
grep -rn "internal\.documents\.\|internal\.datasets\.\|internal\.questions\.\|internal\.users\.\|internal\.retrievers\." packages/backend/convex/ --include="*.ts" | grep -v "_generated" | grep -v "crud/"
```

There are ~25 call sites across multiple files (generation, experiments, langsmith, retrieval modules).

**Step 4: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 5: Commit**

```bash
git add packages/backend/convex/crud/
git add -u packages/backend/convex/knowledgeBases.ts packages/backend/convex/documents.ts packages/backend/convex/datasets.ts packages/backend/convex/questions.ts packages/backend/convex/users.ts packages/backend/convex/retrievers.ts
git commit -m "refactor(backend): move CRUD files to crud/ directory"
```

---

### Task 18: Create `langsmith/` directory

**Files:**
- Move: `packages/backend/convex/langsmithSync.ts` → `packages/backend/convex/langsmith/sync.ts`
- Move: `packages/backend/convex/langsmithRetry.ts` → `packages/backend/convex/langsmith/retry.ts`
- Move: `packages/backend/convex/langsmithSyncRetry.ts` → `packages/backend/convex/langsmith/syncRetry.ts`
- Modify: `packages/backend/convex/crons.ts` (update internal reference)

**Step 1: Create directory and move files**

```bash
mkdir -p packages/backend/convex/langsmith
mv packages/backend/convex/langsmithSync.ts packages/backend/convex/langsmith/sync.ts
mv packages/backend/convex/langsmithRetry.ts packages/backend/convex/langsmith/retry.ts
mv packages/backend/convex/langsmithSyncRetry.ts packages/backend/convex/langsmith/syncRetry.ts
```

**Step 2: Fix relative imports**

Same `./` → `../` pattern.

**Step 3: Update internal references**

| Old | New |
|-----|-----|
| `internal.langsmithSync.syncDataset` | `internal.langsmith.sync.syncDataset` |
| `internal.langsmithSyncRetry.retryFailed` | `internal.langsmith.syncRetry.retryFailed` |
| `internal.langsmithSyncRetry.getFailedDatasets` | `internal.langsmith.syncRetry.getFailedDatasets` |

**Step 4: Update crons.ts**

```typescript
// Before:
crons.interval(
  "retry failed langsmith syncs",
  { hours: 1 },
  internal.langsmithSyncRetry.retryFailed,
);

// After:
crons.interval(
  "retry failed langsmith syncs",
  { hours: 1 },
  internal.langsmith.syncRetry.retryFailed,
);
```

**Step 5: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 6: Commit**

```bash
git add packages/backend/convex/langsmith/ packages/backend/convex/crons.ts
git add -u packages/backend/convex/langsmithSync.ts packages/backend/convex/langsmithRetry.ts packages/backend/convex/langsmithSyncRetry.ts
git commit -m "refactor(backend): move langsmith files to langsmith/ directory and update crons"
```

---

### Task 19: Update frontend `api.*` references

**Files:**
- Modify: `packages/frontend/src/components/AuthGate.tsx`
- Modify: `packages/frontend/src/components/FileUploader.tsx`
- Modify: `packages/frontend/src/components/KBSelector.tsx`
- Modify: `packages/frontend/src/components/RetrieverPlayground.tsx`
- Modify: `packages/frontend/src/app/generate/page.tsx`
- Modify: `packages/frontend/src/app/experiments/page.tsx`
- Modify: `packages/frontend/src/app/retrievers/page.tsx`

**Step 1: Apply changes per file**

Follow the complete change list in `packages/backend/docs/frontend-changes-after-backend-refactor.md`.

Summary of changes by pattern (batch find-and-replace):

**CRUD (flat → `crud.`):**
```
api.users.getOrCreate → api.crud.users.getOrCreate
api.knowledgeBases.list → api.crud.knowledgeBases.list
api.knowledgeBases.create → api.crud.knowledgeBases.create
api.documents.generateUploadUrl → api.crud.documents.generateUploadUrl
api.documents.create → api.crud.documents.create
api.documents.listByKb → api.crud.documents.listByKb
api.documents.get → api.crud.documents.get
api.datasets.list → api.crud.datasets.list
api.datasets.get → api.crud.datasets.get
api.questions.byDataset → api.crud.questions.byDataset
api.retrievers.byOrg → api.crud.retrievers.byOrg
api.retrievers.byKb → api.crud.retrievers.byKb
api.retrievers.remove → api.crud.retrievers.remove
api.retrievers.deleteIndex → api.crud.retrievers.deleteIndex
api.retrievers.resetAfterCancel → api.crud.retrievers.resetAfterCancel
```

**Generation (flat → `generation.orchestration.`):**
```
api.generation.startGeneration → api.generation.orchestration.startGeneration
api.generation.getJob → api.generation.orchestration.getJob
```

**Retrieval (flat → `retrieval.`):**
```
api.indexing.getJob → api.retrieval.indexing.getJob
api.indexing.cancelIndexing → api.retrieval.indexing.cancelIndexing
api.retrieverActions.create → api.retrieval.retrieverActions.create
api.retrieverActions.startIndexing → api.retrieval.retrieverActions.startIndexing
api.retrieverActions.retrieve → api.retrieval.retrieverActions.retrieve
```

**Experiments (flat → `experiments.orchestration.`):**
```
api.experiments.start → api.experiments.orchestration.start
api.experiments.byDataset → api.experiments.orchestration.byDataset
api.experiments.get → api.experiments.orchestration.get
```

**Step 2: Verify frontend builds**

```bash
pnpm -C packages/frontend build
```

Expected: Build succeeds with zero TypeScript errors. TypeScript will catch any missed references because the old `api.*` paths won't exist in the regenerated types.

**Step 3: Commit**

```bash
git add packages/frontend/src/
git commit -m "refactor(frontend): update all api.* paths to match backend directory reorganization"
```

---

### Task 20: Full Phase 3 verification

**Step 1: Run all verification commands**

```bash
pnpm build
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
pnpm -C packages/eval-lib test
pnpm -C packages/frontend build
```

**Step 2: Verify file structure**

```bash
ls packages/backend/convex/
# Should show: schema.ts, auth.config.ts, convex.config.ts, crons.ts, test.setup.ts
# Plus directories: lib/, generation/, retrieval/, experiments/, crud/, langsmith/
# No loose domain files should remain at the top level
```

**Step 3: Verify no stale references**

```bash
# Check for any references to old flat paths (should return nothing)
grep -rn "internal\.generation\.\(start\|cancel\|getJob\|listJobs\|onQuestion\|onGround\)" packages/backend/convex/ --include="*.ts" | grep -v "_generated" | grep -v "generation/"
grep -rn "internal\.indexing\.\(start\|onDoc\|getJob\|delete\)" packages/backend/convex/ --include="*.ts" | grep -v "_generated" | grep -v "retrieval/"
```

**Step 4: Commit (if any fixes needed)**

```bash
git add -A packages/backend/ packages/frontend/
git commit -m "refactor: final Phase 3 cleanup and verification"
```

---

# Phase 4: Type Safety & Schema (Medium Risk)

> Replace `v.any()` and `v.string()` with proper validators.

---

### Task 21: Add `spanValidator` export and fix `status` types in internal mutations

**Files:**
- Modify: `packages/backend/convex/experiments/orchestration.ts` (fix `updateStatus` validator)
- Modify: `packages/backend/convex/crud/retrievers.ts` (fix `insertRetriever` and `updateIndexingStatus` validators)

**Step 1: Define status validators**

In `experiments/orchestration.ts`, change `updateStatus` args:

```typescript
// Before:
status: v.string(),

// After:
status: v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("completed_with_errors"),
  v.literal("failed"),
  v.literal("canceling"),
  v.literal("canceled"),
),
```

Apply the same pattern to `crud/retrievers.ts` for `insertRetriever` and `updateIndexingStatus`.

**Step 2: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 3: Commit**

```bash
git add packages/backend/convex/experiments/orchestration.ts packages/backend/convex/crud/retrievers.ts
git commit -m "refactor(backend): replace v.string() with v.union() for status fields in internal mutations"
```

---

### Task 22: Replace `v.any()` for `scores` fields

**Files:**
- Modify: `packages/backend/convex/schema.ts` (update `scores` fields)

**Step 1: Update schema**

Replace `v.any()` for the `scores` field on `experiments` and `experimentResults` tables:

```typescript
// Before:
scores: v.optional(v.any()),

// After:
scores: v.optional(v.record(v.string(), v.number())),
```

**Step 2: Verify**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
```

**Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "refactor(backend): replace v.any() with v.record() for scores fields"
```

---

### Task 23: Clean up unused experiment schema fields

**Files:**
- Modify: `packages/backend/convex/schema.ts`

**Step 1: Audit unused fields**

Check whether these fields are ever written to:

```bash
grep -rn "failedQuestions\|skippedQuestions\|indexConfigHash\|langsmithExperimentId\|langsmithUrl\|langsmithSyncStatus" packages/backend/convex/ --include="*.ts" | grep -v "_generated" | grep -v "schema.ts" | grep -v "docs/"
```

For any fields that are never written to, either:
- Remove them from the schema (if they have no data in production), or
- Add a comment explaining they're reserved for future use

**Step 2: Verify and commit**

```bash
cd packages/backend && npx convex dev --once
git add packages/backend/convex/schema.ts
git commit -m "refactor(backend): clean up unused experiment schema fields"
```

---

# Phase 5: Testing (No Risk to Production)

> Add test coverage for critical paths. See refactoring-suggestions.md §11.

---

### Task 24: Extract shared test helpers

**Files:**
- Create: `packages/backend/tests/helpers.ts`
- Modify: `packages/backend/tests/generation.test.ts` (use shared helpers)
- Modify: `packages/backend/tests/experiments.test.ts` (use shared helpers)

**Step 1: Create helpers.ts**

Extract the duplicated test setup from both test files:

```typescript
// packages/backend/tests/helpers.ts
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { modules } from "../convex/test.setup";

export const TEST_ORG_ID = "org_test123";
export const TEST_CLERK_ID = "clerk_test123";

export const testIdentity = {
  subject: TEST_CLERK_ID,
  issuer: "https://test.clerk.accounts.dev",
  org_id: TEST_ORG_ID,
  org_role: "org:admin",
};

export function createTestContext() {
  return convexTest(schema, modules);
}

export async function seedUser(t: any) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      clerkId: TEST_CLERK_ID,
      name: "Test User",
      email: "test@test.com",
    });
  });
}

export async function seedKB(t: any, orgId = TEST_ORG_ID) {
  const userId = await seedUser(t);
  const kbId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("knowledgeBases", {
      orgId,
      name: "Test KB",
      description: "Test",
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
  return { userId, kbId };
}

export async function seedDataset(t: any, kbId: any, orgId = TEST_ORG_ID) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("datasets", {
      orgId,
      kbId,
      name: "Test Dataset",
      strategy: "simple",
      strategyConfig: {},
      questionCount: 0,
    });
  });
}
```

Adjust the exact shape to match what's currently duplicated in both test files. Read both test files first to extract the correct patterns.

**Step 2: Update existing test files to use shared helpers**

Replace duplicated seeders in `generation.test.ts` and `experiments.test.ts` with imports from `./helpers`.

**Step 3: Verify**

```bash
pnpm -C packages/backend test
```

**Step 4: Commit**

```bash
git add packages/backend/tests/
git commit -m "test(backend): extract shared test helpers to tests/helpers.ts"
```

---

### Task 25: Add indexing callback tests

**Files:**
- Create: `packages/backend/tests/indexing.test.ts`

**Step 1: Write tests for `onDocumentIndexed`**

Test the same patterns as `generation.test.ts` tests for `onQuestionGenerated`:
- Success counter increment
- Failure counter increment with error details
- Skipped (canceled) counter increment
- Completion detection and status transitions
- Retriever status sync on completion

Use the shared helpers from Task 24.

**Step 2: Run tests**

```bash
pnpm -C packages/backend test
```

**Step 3: Commit**

```bash
git add packages/backend/tests/indexing.test.ts
git commit -m "test(backend): add indexing callback tests (onDocumentIndexed)"
```

---

### Task 26: Add retriever CRUD tests

**Files:**
- Create: `packages/backend/tests/retrievers.test.ts`

**Step 1: Write tests**

Cover:
- Shared index protection (`deleteIndex` when another retriever shares the same `indexConfigHash`)
- Status transitions (configuring → indexing → ready)
- Remove with cascade cleanup
- `resetAfterCancel` behavior

**Step 2: Run and commit**

```bash
pnpm -C packages/backend test
git add packages/backend/tests/retrievers.test.ts
git commit -m "test(backend): add retriever CRUD and shared index protection tests"
```

---

### Task 27: Add workpool helper unit tests

**Files:**
- Create: `packages/backend/tests/workpool-helpers.test.ts`

**Step 1: Write tests for `applyResult` and `counterPatch`**

Test the pure functions extracted to `lib/workpool.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applyResult, counterPatch } from "../convex/lib/workpool";

describe("applyResult", () => {
  const baseJob = { processedItems: 0, failedItems: 0, skippedItems: 0, failedItemDetails: [] };

  it("increments processedItems on success", () => {
    const result = applyResult(baseJob, { kind: "success", id: "w1" } as any, "item1");
    expect(result.processedItems).toBe(1);
    expect(result.failedItems).toBe(0);
  });

  it("increments failedItems on failure and records details", () => {
    const result = applyResult(baseJob, { kind: "failed", id: "w1", error: "boom" } as any, "item1");
    expect(result.failedItems).toBe(1);
    expect(result.failedItemDetails).toEqual([{ itemKey: "item1", error: "boom" }]);
  });

  it("increments skippedItems on cancel", () => {
    const result = applyResult(baseJob, { kind: "canceled", id: "w1" } as any, "item1");
    expect(result.skippedItems).toBe(1);
  });
});

describe("counterPatch", () => {
  it("returns undefined for empty failedItemDetails", () => {
    const patch = counterPatch({ processedItems: 1, failedItems: 0, skippedItems: 0, failedItemDetails: [] });
    expect(patch.failedItemDetails).toBeUndefined();
  });

  it("preserves non-empty failedItemDetails", () => {
    const patch = counterPatch({
      processedItems: 0, failedItems: 1, skippedItems: 0,
      failedItemDetails: [{ itemKey: "x", error: "err" }],
    });
    expect(patch.failedItemDetails).toHaveLength(1);
  });
});
```

**Step 2: Run and commit**

```bash
pnpm -C packages/backend test
git add packages/backend/tests/workpool-helpers.test.ts
git commit -m "test(backend): add unit tests for workpool applyResult and counterPatch helpers"
```

---

# Phase 6: Architectural Polish (Long-Term)

> Non-urgent improvements that can be done incrementally.

---

### Task 28: Fix `cancelIndexing` to use selective cancel

**Files:**
- Modify: `packages/backend/convex/retrieval/indexing.ts`

**Step 1: Understand the problem**

Currently `cancelIndexing` calls `pool.cancelAll()` which cancels ALL items in the indexing pool — not just this job's work. This is broken if multiple indexing jobs run concurrently.

**Step 2: Add `workIds` to indexingJobs**

First check if the schema already has a `workIds` field on `indexingJobs`. If not, add it:

```typescript
// In schema.ts, indexingJobs table:
workIds: v.optional(v.array(v.string())),
```

**Step 3: Store workIds during startIndexing**

In `indexing.ts`, update `startIndexing` to store the WorkPool work IDs on the job record after enqueueing.

**Step 4: Update cancelIndexing to use selective cancel**

Replace `pool.cancelAll()` with canceling only the job's `workIds`:

```typescript
// Cancel only this job's work items
for (const workId of job.workIds ?? []) {
  await pool.cancel(ctx, workId as WorkId);
}
```

**Step 5: Verify and commit**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
git add packages/backend/convex/retrieval/indexing.ts packages/backend/convex/schema.ts
git commit -m "fix(backend): use selective cancel in cancelIndexing instead of cancelAll"
```

---

### Task 29: Add dataset sync status index

**Files:**
- Modify: `packages/backend/convex/schema.ts`
- Modify: `packages/backend/convex/langsmith/syncRetry.ts`

**Step 1: Add index to schema**

```typescript
// In schema.ts, datasets table indexes:
.index("by_sync_status", ["langsmithSyncStatus"])
```

**Step 2: Update getFailedDatasets query**

Replace the full table scan with an indexed query. Note: Convex doesn't support prefix queries, so you may need to query for specific status values or keep the filter approach but with a more targeted query.

```typescript
// If Convex supports a range query on the index:
const failedDatasets = await ctx.db
  .query("datasets")
  .withIndex("by_sync_status")
  .collect()
  .then(ds => ds.filter(d => d.langsmithSyncStatus?.startsWith("failed:")));
```

**Step 3: Verify and commit**

```bash
cd packages/backend && npx convex dev --once
git add packages/backend/convex/schema.ts packages/backend/convex/langsmith/syncRetry.ts
git commit -m "perf(backend): add sync status index for LangSmith retry query"
```

---

### Task 30: Extract vector search helper

**Files:**
- Create: `packages/backend/convex/lib/vectorSearch.ts`
- Modify: `packages/backend/convex/retrieval/retrieverActions.ts`
- Modify: `packages/backend/convex/experiments/actions.ts`

**Step 1: Extract common pattern**

The "embed query → vectorSearch → fetchChunksWithDocs → post-filter → take topK" pipeline is duplicated. Extract to `lib/vectorSearch.ts`:

```typescript
// packages/backend/convex/lib/vectorSearch.ts
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Execute vector search with post-filtering by indexConfigHash.
 * Shared by retrieverActions.retrieve and experimentActions.runEvaluation.
 */
export async function vectorSearchWithFilter(
  ctx: ActionCtx,
  opts: {
    queryEmbedding: number[];
    kbId: Id<"knowledgeBases">;
    indexConfigHash: string;
    topK: number;
  },
) {
  const overFetch = Math.min(opts.topK * 4, 256);

  const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: opts.queryEmbedding,
    limit: overFetch,
    filter: (q: any) => q.eq("kbId", opts.kbId),
  });

  const chunkIds = results.map((r: any) => r._id);
  const chunks = await ctx.runQuery(internal.retrieval.chunks.fetchChunksWithDocs, {
    chunkIds,
  });

  // Post-filter by indexConfigHash and take topK
  const filtered = chunks
    .filter((c: any) => c.indexConfigHash === opts.indexConfigHash)
    .slice(0, opts.topK);

  return { chunks: filtered, scores: results };
}
```

**Step 2: Update both call sites**

Replace the duplicated logic in `retrieval/retrieverActions.ts` and `experiments/actions.ts` with calls to `vectorSearchWithFilter`.

**Step 3: Verify and commit**

```bash
cd packages/backend && npx convex dev --once
pnpm -C packages/backend test
git add packages/backend/convex/lib/vectorSearch.ts packages/backend/convex/retrieval/retrieverActions.ts packages/backend/convex/experiments/actions.ts
git commit -m "refactor(backend): extract shared vector search helper to lib/vectorSearch.ts"
```

---

### Task 31: Clean up comments and naming

**Files:**
- Modify: Various files with `I1`, `I3`, `I9`, `C1`, `S3` comments

**Step 1: Find cryptic comments**

```bash
grep -rn "\b[ICS][0-9]\b" packages/backend/convex/ --include="*.ts" | grep -v "_generated"
```

**Step 2: Expand each to self-documenting form**

Examples:
```typescript
// Before: // I9: Guard against stale Phase 1 callbacks
// After:  // Guard: if Phase 2 has already started, ignore late Phase 1 callbacks to prevent counter corruption

// Before: // C1: selective cancel
// After:  // Cancel only this job's work items, not the entire pool

// Before: // S3: shared counter logic
// After:  // (remove — code now lives in lib/workpool.ts, self-documenting)
```

**Step 3: Commit**

```bash
git add packages/backend/convex/
git commit -m "docs(backend): expand cryptic change ID comments into self-documenting form"
```

---

## Final Checklist

After all phases are complete, run the full verification suite:

```bash
# 1. Build eval-lib
pnpm build

# 2. Run eval-lib tests
pnpm -C packages/eval-lib test

# 3. TypeScript check backend
pnpm typecheck:backend

# 4. Deploy Convex
cd packages/backend && npx convex dev --once

# 5. Run backend tests
pnpm -C packages/backend test

# 6. Build frontend
pnpm -C packages/frontend build

# 7. Verify git status is clean
git status
```

Verify the directory structure matches the target:

```
packages/backend/convex/
├── schema.ts
├── auth.config.ts
├── convex.config.ts
├── crons.ts
├── test.setup.ts
├── lib/
│   ├── auth.ts
│   ├── validators.ts
│   ├── workpool.ts
│   └── vectorSearch.ts
├── generation/
│   ├── orchestration.ts
│   └── actions.ts
├── retrieval/
│   ├── indexing.ts
│   ├── indexingActions.ts
│   ├── retrieverActions.ts
│   └── chunks.ts
├── experiments/
│   ├── orchestration.ts
│   ├── actions.ts
│   └── results.ts
├── crud/
│   ├── knowledgeBases.ts
│   ├── documents.ts
│   ├── datasets.ts
│   ├── questions.ts
│   ├── users.ts
│   └── retrievers.ts
└── langsmith/
    ├── sync.ts
    ├── retry.ts
    └── syncRetry.ts
```
