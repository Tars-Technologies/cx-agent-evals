# Refactoring Suggestions

> Actionable improvements for backend code health, structure, testability, and maintainability.

[Back to Architecture Overview](./architecture.md) | [Frontend Changes After Refactor](./frontend-changes-after-backend-refactor.md)

---

## Table of Contents

1. [Guiding Principle: Separation of Concerns](#1-guiding-principle-separation-of-concerns)
2. [Extracting Non-Convex Code to eval-lib](#2-extracting-non-convex-code-to-eval-lib)
3. [Convex Directory Reorganization](#3-convex-directory-reorganization)
4. [Dead Code & Deprecation Cleanup](#4-dead-code--deprecation-cleanup)
5. [Code Duplication Elimination](#5-code-duplication-elimination)
6. [Type Safety Improvements](#6-type-safety-improvements)
7. [Naming & Readability](#7-naming--readability)
8. [Unused Dependencies & Import Cleanup](#8-unused-dependencies--import-cleanup)
9. [Schema & Validator Improvements](#9-schema--validator-improvements)
10. [Architectural Refinements](#10-architectural-refinements)
11. [Testing Strategy](#11-testing-strategy)
12. [Priority Roadmap](#12-priority-roadmap)

---

## 1. Guiding Principle: Separation of Concerns

The backend mixes three layers of code in the same files:

1. **Convex orchestration** — mutations, queries, actions, WorkPool callbacks. These use Convex primitives (`ctx`, `v.object`, `internalMutation`, etc.) and **must** live in the `convex/` directory.
2. **External SDK wrappers** — LangSmith experiment runner, dataset uploader, OpenAI embedder factory. Pure Node.js code with zero Convex dependency.
3. **Bridge/adapter code** — converting between Convex DB records and eval-lib types (building `Corpus` from documents, creating `CallbackRetriever` backed by vector search).

The worst example is `experimentActions.ts` (489 lines) which contains 127 lines of inlined LangSmith code, a duplicated `createEmbedder()`, the experiment orchestrator, and the evaluation runner — all in one file.

**The goal**: establish a clear boundary so that:
- Convex files contain **only** Convex-specific orchestration
- Pure TypeScript / external SDK code lives in the eval-lib package (`packages/eval-lib/`)
- Anyone new can immediately tell "this is Convex code" vs "this is just TypeScript"
- The non-Convex code is independently testable with simple mocks
- The codebase is structured to be portable (the non-Convex layer could theoretically run on Express, Fastify, etc.)
- We maintain exactly three packages: `eval-lib`, `backend`, `frontend`

---

## 2. Extracting Non-Convex Code to eval-lib

### Design

Instead of creating a new package, extract non-Convex code from `packages/backend/convex/` into the existing `packages/eval-lib/` package (`rag-evaluation-system`). This keeps the workspace at exactly three packages:

1. **`packages/eval-lib/`** — All pure TypeScript code: evaluation core, strategies, metrics, LangSmith integration, embedder/LLM factories, shared types
2. **`packages/backend/convex/`** — Convex-specific orchestration only. Thin wrappers that import from `rag-evaluation-system`
3. **`packages/frontend/`** — Next.js UI

The boundary rule: **if a function doesn't need `ctx` (Convex context), it belongs in eval-lib.**

The backend already imports from `rag-evaluation-system` — this just expands what lives there. The Convex bundler resolves workspace packages via `node_modules`, so this is a proven, first-class pattern. Internal module structure within eval-lib provides natural extraction boundaries if specific modules need to be published separately later.

### New eval-lib Modules

These modules are **added** to eval-lib's existing `src/` directory alongside the current modules (chunkers, embedders, evaluation, etc.):

```
packages/eval-lib/src/
├── chunkers/                 # (existing) Chunker interface + RecursiveCharacterChunker
├── embedders/                # (existing) Embedder interface + OpenAI implementation
├── evaluation/               # (existing) Evaluation orchestrator and metrics
├── experiments/              # (existing) Experiment runner, CallbackRetriever
├── pipeline/                 # (existing) Pipeline configuration, internals
├── rerankers/                # (existing) Reranker interface + Cohere
├── retrievers/               # (existing) Retriever interfaces
├── synthetic-datagen/        # (existing) Question generation strategies
├── types/                    # (existing) Branded types, primitives
├── utils/                    # (existing) Hashing, span utilities
├── vector-stores/            # (existing) VectorStore interface
│
├── langsmith/                # NEW — extracted from backend
│   ├── client.ts             # getLangSmithClient()
│   ├── experiment.ts         # runLangSmithExperiment(), evaluator helpers, types
│   ├── upload.ts             # uploadDataset(), UploadOptions, UploadResult
│   └── index.ts              # barrel export
├── llm/                      # NEW — extracted from backend
│   ├── client.ts             # createLLMClient() — OpenAI adapter for eval-lib LLMClient
│   ├── embedder-factory.ts   # createEmbedder() — single copy, replaces 4 duplicates
│   ├── config.ts             # getModel(), config resolution helpers
│   └── index.ts              # barrel export
└── shared/                   # NEW — extracted from backend
    ├── corpus.ts             # buildCorpusFromDocs() — raw doc records → eval-lib Corpus
    ├── types.ts              # JobStatus, SerializedSpan, ExperimentResult
    ├── constants.ts          # EMBED_BATCH_SIZE, CLEANUP_BATCH_SIZE, BATCH_SIZE, TIER_PARALLELISM
    └── index.ts              # barrel export
```

New tests alongside existing eval-lib tests:

```
packages/eval-lib/tests/
├── langsmith/
│   ├── experiment.test.ts    # Mock LangSmith evaluate(), test evaluator creation
│   └── upload.test.ts        # Mock LangSmith client, test batch upload
├── llm/
│   ├── embedder-factory.test.ts  # Mock OpenAI, test error handling
│   └── config.test.ts       # Test config resolution
└── shared/
    └── corpus.test.ts        # Test corpus building from raw doc records
```

### What Moves

| Currently In | Moves To | What |
|---|---|---|
| `experimentActions.ts` lines 28-154 | `eval-lib/src/langsmith/experiment.ts` | `runLangSmithExperiment()`, `createLangSmithEvaluator()`, `createLangSmithEvaluators()`, `ExperimentResult`, `SerializedSpan`, `deserializeSpans()`, `LangSmithExperimentConfig`, `DEFAULT_METRICS` |
| `langsmithSync.ts` lines 15-102 | `eval-lib/src/langsmith/upload.ts` | `uploadDataset()`, `UploadProgress`, `UploadOptions`, `UploadResult` |
| `lib/langsmith.ts` (4 lines) | `eval-lib/src/langsmith/client.ts` | `getLangSmithClient()` |
| `lib/llm.ts` (20 lines) | `eval-lib/src/llm/client.ts` | `createLLMClient()` |
| 4 copies of `createEmbedder()` | `eval-lib/src/llm/embedder-factory.ts` | Single `createEmbedder()` |
| `generationActions.ts` `getModel()` | `eval-lib/src/llm/config.ts` | Config resolution helpers |
| `generation.ts` `JobStatus` type | `eval-lib/src/shared/types.ts` | Shared `JobStatus` type |
| Magic numbers across action files | `eval-lib/src/shared/constants.ts` | `EMBED_BATCH_SIZE`, `CLEANUP_BATCH_SIZE`, `BATCH_SIZE`, `TIER_PARALLELISM` |

### What Stays in Convex

- `loadCorpusFromKb()` — needs `ctx.runQuery` to fetch documents from Convex
- `CallbackRetriever` creation — needs `ctx.vectorSearch` for Convex vector search
- All mutations, queries, actions — Convex primitives
- WorkPool callbacks — Convex-specific
- Auth (`getAuthContext`) — uses Convex ctx
- Schema, validators — Convex value system

### Package Wiring

eval-lib already exists as a workspace dependency. The only changes needed:

```json
// packages/eval-lib/package.json (add dependencies for extracted code)
{
  "dependencies": {
    "langsmith": "^0.x",
    "@langchain/core": "^0.x"
    // openai already present
  }
}
```

```json
// packages/eval-lib/tsup.config.ts (add new sub-path exports)
// Add entry points: src/langsmith/index.ts, src/llm/index.ts, src/shared/index.ts
```

```jsonc
// packages/eval-lib/package.json — add new sub-path exports alongside existing ones.
// eval-lib already uses conditional exports (types/import/require). Follow the same pattern.
{
  "exports": {
    // ... existing sub-paths (.  ./embedders/openai  ./rerankers/cohere  ./pipeline/internals  ./utils) stay as-is ...
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
  }
}
```

No changes to `pnpm-workspace.yaml`. No new package to register.

### Critical Constraint: Sub-Path Isolation

The new `langsmith/` and `llm/` modules use Node.js-dependent packages (`langsmith`, `@langchain/core`, `openai`). Convex runs mutations and queries in a V8 isolate (no Node.js), so these modules **must never** be imported from mutation/query files.

**Rules:**
1. The root barrel (`src/index.ts`) must **NOT** re-export from `./langsmith/`, `./llm/`, or any module that transitively imports Node.js packages.
2. Only `"use node"` action files in `convex/` may import from `rag-evaluation-system/langsmith` or `rag-evaluation-system/llm`.
3. The `./shared` sub-path (types, constants, corpus builder) is safe for any file since it has no Node.js dependencies.

**Why this works:** Convex's esbuild bundler marks packages in `convex.json` `externalPackages` as external. When it bundles eval-lib code (which is NOT in `externalPackages`), it inlines it — but any transitive import of `langsmith` or `openai` is correctly left external because those ARE in `externalPackages`. This only applies to `"use node"` action bundles; the `externalPackages` mechanism does not apply to the default V8 runtime.

**Current state is safe:** All 7 backend files that currently import from `rag-evaluation-system` already have `"use node"`. After Phase 2, mutation/query files (e.g., `generation.ts`, `indexing.ts`) will import from `rag-evaluation-system/shared` for `JobStatus` and constants — this is safe because `/shared` has zero Node.js dependencies. The constraint applies specifically to the `/langsmith` and `/llm` sub-paths, which must only be imported from `"use node"` action files.

### Dependency Notes

- `openai` is currently an **optional** dependency in eval-lib. Since the `/llm` sub-path directly creates OpenAI clients, either promote it to a regular dependency or keep it optional and document that consumers of the `/llm` sub-path must have `openai` installed. The Convex backend already has it in `externalPackages`, so this works either way.
- `langsmith` and `@langchain/core` are new dependencies for eval-lib. They must also remain in the backend's `convex.json` `externalPackages` list (they already are).

### Impact on `experimentActions.ts`

Before: **489 lines** (inlined LangSmith code + duplicate embedder + orchestration + evaluation).

After: **~250 lines** (pure Convex orchestration + bridge code):

```typescript
"use node";
import { runLangSmithExperiment } from "rag-evaluation-system/langsmith";
import { createEmbedder, createLLMClient } from "rag-evaluation-system/llm";
import { CallbackRetriever, DocumentId, PositionAwareChunkId, positionAwareChunkToSpan } from "rag-evaluation-system";
// ... Convex imports

// runExperiment — orchestrator (setup, indexing wait, sync, enqueue)
// runEvaluation — builds CallbackRetriever, delegates to runLangSmithExperiment()
```

---

## 3. Convex Directory Reorganization

### Rationale

Convex supports nested directories with file-based routing. A function `h` in `convex/foo/bar.ts` is referenced as `api.foo.bar.h` (public) or `internal.foo.bar.h` (internal). This is first-class and well-documented.

Currently all 26 source files sit flat in `convex/`. Reorganizing into domain folders makes the module boundaries explicit.

### Proposed Layout

```
packages/backend/convex/
├── schema.ts                      # Root (Convex requirement)
├── auth.config.ts                 # Root (Convex requirement)
├── convex.config.ts               # Root (WorkPool registration)
├── crons.ts                       # Root (Convex cron requirement)
├── test.setup.ts                  # Root
│
├── lib/                           # Shared Convex-specific helpers
│   ├── auth.ts                    # getAuthContext(), lookupUser()
│   ├── validators.ts              # shared spanValidator
│   └── workpool.ts                # shared applyResult()/counterPatch() helpers
│
├── generation/                    # Question generation module
│   ├── orchestration.ts           # startGeneration, callbacks, cancel, queries
│   └── actions.ts                 # "use node" strategy actions + GT assignment
│
├── retrieval/                     # Indexing + chunks
│   ├── indexing.ts                # Indexing orchestration + callbacks
│   ├── indexingActions.ts         # "use node" two-phase indexing + cleanup
│   ├── retrieverActions.ts        # "use node" create/startIndexing/retrieve
│   └── chunks.ts                  # Chunk CRUD (currently rag.ts)
│
├── experiments/                   # Experiment module
│   ├── orchestration.ts           # Start, enqueue, cancel, onComplete, queries
│   ├── actions.ts                 # "use node" runExperiment + runEvaluation
│   └── results.ts                 # Per-question result mutations/queries
│
├── crud/                          # Data layer CRUD
│   ├── knowledgeBases.ts
│   ├── documents.ts
│   ├── datasets.ts
│   ├── questions.ts
│   ├── users.ts
│   └── retrievers.ts             # Retriever CRUD + status sync
│
└── langsmith/                     # LangSmith Convex wrappers
    ├── sync.ts                    # Dataset sync action (thin: delegates to eval-lib)
    ├── retry.ts                   # Manual retry mutation
    └── syncRetry.ts               # Cron-driven auto-retry
```

### Relative Import Paths

13 backend files import from `./lib/auth`, `./lib/llm`, or `./lib/langsmith` using relative paths. When these files move into subdirectories (e.g., `generation/orchestration.ts`), these paths must be updated to `../lib/auth`, etc. No backend files import from each other using relative paths — all cross-file calls go through `internal.*`, which is the correct Convex pattern.

### API Path Changes

All `internal.*` and `api.*` references change when files move. The `_generated/api.ts` auto-regenerates, but **all call sites** must be updated.

#### Public API (`api.*`) — 25 paths, all used by frontend

| Before (flat) | After (nested) |
|---|---|
| `api.generation.startGeneration` | `api.generation.orchestration.startGeneration` |
| `api.generation.getJob` | `api.generation.orchestration.getJob` |
| `api.indexing.getJob` | `api.retrieval.indexing.getJob` |
| `api.indexing.cancelIndexing` | `api.retrieval.indexing.cancelIndexing` |
| `api.retrieverActions.create` | `api.retrieval.retrieverActions.create` |
| `api.retrieverActions.startIndexing` | `api.retrieval.retrieverActions.startIndexing` |
| `api.retrieverActions.retrieve` | `api.retrieval.retrieverActions.retrieve` |
| `api.experiments.start` | `api.experiments.orchestration.start` |
| `api.experiments.byDataset` | `api.experiments.orchestration.byDataset` |
| `api.experiments.get` | `api.experiments.orchestration.get` |
| `api.knowledgeBases.list` | `api.crud.knowledgeBases.list` |
| `api.knowledgeBases.create` | `api.crud.knowledgeBases.create` |
| `api.documents.create` | `api.crud.documents.create` |
| `api.documents.listByKb` | `api.crud.documents.listByKb` |
| `api.documents.get` | `api.crud.documents.get` |
| `api.documents.generateUploadUrl` | `api.crud.documents.generateUploadUrl` |
| `api.datasets.list` | `api.crud.datasets.list` |
| `api.datasets.get` | `api.crud.datasets.get` |
| `api.questions.byDataset` | `api.crud.questions.byDataset` |
| `api.users.getOrCreate` | `api.crud.users.getOrCreate` |
| `api.retrievers.byKb` | `api.crud.retrievers.byKb` |
| `api.retrievers.byOrg` | `api.crud.retrievers.byOrg` |
| `api.retrievers.remove` | `api.crud.retrievers.remove` |
| `api.retrievers.deleteIndex` | `api.crud.retrievers.deleteIndex` |
| `api.retrievers.resetAfterCancel` | `api.crud.retrievers.resetAfterCancel` |

#### Internal API (`internal.*`) — ~70 call sites across 12 files

| Before (flat) | After (nested) | Call Sites |
|---|---|---|
| **Generation** | | |
| `internal.generation.onQuestionGenerated` | `internal.generation.orchestration.onQuestionGenerated` | 3 |
| `internal.generation.onGroundTruthAssigned` | `internal.generation.orchestration.onGroundTruthAssigned` | 1 |
| `internal.generationActions.generateForDocument` | `internal.generation.actions.generateForDocument` | 1 |
| `internal.generationActions.generateDimensionDriven` | `internal.generation.actions.generateDimensionDriven` | 1 |
| `internal.generationActions.generateRealWorldGrounded` | `internal.generation.actions.generateRealWorldGrounded` | 1 |
| `internal.generationActions.assignGroundTruthForQuestion` | `internal.generation.actions.assignGroundTruthForQuestion` | 1 |
| **Retrieval** | | |
| `internal.indexing.startIndexing` | `internal.retrieval.indexing.startIndexing` | 1 |
| `internal.indexing.onDocumentIndexed` | `internal.retrieval.indexing.onDocumentIndexed` | 1 |
| `internal.indexing.getJobInternal` | `internal.retrieval.indexing.getJobInternal` | 2 |
| `internal.indexing.deleteJob` | `internal.retrieval.indexing.deleteJob` | 1 |
| `internal.indexingActions.indexDocument` | `internal.retrieval.indexingActions.indexDocument` | 1 |
| `internal.indexingActions.cleanupAction` | `internal.retrieval.indexingActions.cleanupAction` | 3 |
| `internal.rag.insertChunkBatch` | `internal.retrieval.chunks.insertChunkBatch` | 1 |
| `internal.rag.getChunksByDocConfig` | `internal.retrieval.chunks.getChunksByDocConfig` | 2 |
| `internal.rag.getUnembeddedChunks` | `internal.retrieval.chunks.getUnembeddedChunks` | 1 |
| `internal.rag.patchChunkEmbeddings` | `internal.retrieval.chunks.patchChunkEmbeddings` | 1 |
| `internal.rag.deleteKbConfigChunks` | `internal.retrieval.chunks.deleteKbConfigChunks` | 1 |
| `internal.rag.deleteDocumentChunks` | `internal.retrieval.chunks.deleteDocumentChunks` | 1 |
| `internal.rag.fetchChunksWithDocs` | `internal.retrieval.chunks.fetchChunksWithDocs` | 2 |
| `internal.retrievers.findByConfigHash` | `internal.crud.retrievers.findByConfigHash` | 1 |
| `internal.retrievers.insertRetriever` | `internal.crud.retrievers.insertRetriever` | 1 |
| `internal.retrievers.getInternal` | `internal.crud.retrievers.getInternal` | 3 |
| `internal.retrievers.updateIndexingStatus` | `internal.crud.retrievers.updateIndexingStatus` | 1 |
| `internal.retrievers.syncStatusFromIndexingJob` | `internal.crud.retrievers.syncStatusFromIndexingJob` | 1 |
| **Experiments** | | |
| `internal.experimentActions.runExperiment` | `internal.experiments.actions.runExperiment` | 1 |
| `internal.experimentActions.runEvaluation` | `internal.experiments.actions.runEvaluation` | 1 |
| `internal.experiments.getInternal` | `internal.experiments.orchestration.getInternal` | 2 |
| `internal.experiments.updateStatus` | `internal.experiments.orchestration.updateStatus` | 8 |
| `internal.experiments.enqueueExperiment` | `internal.experiments.orchestration.enqueueExperiment` | 1 |
| `internal.experiments.onExperimentComplete` | `internal.experiments.orchestration.onExperimentComplete` | 1 |
| `internal.experimentResults.insert` | `internal.experiments.results.insert` | 1 |
| `internal.experimentResults.byExperimentInternal` | `internal.experiments.results.byExperimentInternal` | 1 |
| **CRUD** | | |
| `internal.documents.getInternal` | `internal.crud.documents.getInternal` | 3 |
| `internal.documents.listByKbInternal` | `internal.crud.documents.listByKbInternal` | 2 |
| `internal.datasets.getInternal` | `internal.crud.datasets.getInternal` | 3 |
| `internal.datasets.updateSyncStatus` | `internal.crud.datasets.updateSyncStatus` | 4 |
| `internal.questions.insertBatch` | `internal.crud.questions.insertBatch` | 3 |
| `internal.questions.getInternal` | `internal.crud.questions.getInternal` | 1 |
| `internal.questions.byDatasetInternal` | `internal.crud.questions.byDatasetInternal` | 2 |
| `internal.questions.updateSpans` | `internal.crud.questions.updateSpans` | 1 |
| `internal.questions.updateLangsmithExampleIds` | `internal.crud.questions.updateLangsmithExampleIds` | 1 |
| `internal.users.getByClerkId` | `internal.crud.users.getByClerkId` | 2 |
| **LangSmith** | | |
| `internal.langsmithSync.syncDataset` | `internal.langsmith.sync.syncDataset` | 3 |
| `internal.langsmithSyncRetry.retryFailed` | `internal.langsmith.syncRetry.retryFailed` | 1 |
| `internal.langsmithSyncRetry.getFailedDatasets` | `internal.langsmith.syncRetry.getFailedDatasets` | 1 |

> **Impact**: This changes ~70 `internal.*` call-site references across 12 backend files and 26 `api.*` references across 7 frontend files. See [Frontend Changes After Backend Refactor](./frontend-changes-after-backend-refactor.md) for the full frontend impact.

### Deleted Files

| File | Reason |
|---|---|
| `ragActions.ts` | Deprecated, no callers. `indexSingleDocument()` replaced by `indexingActions.indexDocument`. |
| `testing.ts` | Empty file. |
| `lib/llm.ts` | Moved to `eval-lib/src/llm/client.ts`. |
| `lib/langsmith.ts` | Moved to `eval-lib/src/langsmith/client.ts`. |
| `README.md` | Default Convex boilerplate. Replace with link to `docs/`. |

---

## 4. Dead Code & Deprecation Cleanup

### Items to Remove

| Item | File | Reason |
|------|------|--------|
| `ragActions.ts` (entire file) | `ragActions.ts` | Deprecated. `indexSingleDocument()` replaced by `indexingActions.indexDocument`. No callers remain. |
| `rag.insertChunk` | `rag.ts:147-165` | Deprecated. `insertChunkBatch` is the replacement. No callers in current code. |
| `rag.deleteKbChunks` | `rag.ts:189-202` | Deprecated (OOM risk). `deleteKbConfigChunks` is the paginated replacement. |
| `testing.ts` | `testing.ts` | Empty file — just a comment saying old tests were removed. |
| `README.md` | `README.md` | Default Convex boilerplate. Not project-specific documentation. |
| `MAX_AUTO_RETRIES` constant | `langsmithSyncRetry.ts:4` | Declared but never used. |
| Legacy experiment path | `experimentActions.ts:83-141` | The `experiment.retrieverConfig` path with polling loop. If no frontend code uses it, remove. |

### Verification Steps

Before removing any of the above:

```bash
# Check for callers of deprecated functions
grep -r "insertChunk\b" packages/backend/convex/ --include="*.ts"
grep -r "deleteKbChunks\b" packages/backend/convex/ --include="*.ts"
grep -r "indexSingleDocument" packages/backend/convex/ --include="*.ts"
grep -r "retrieverConfig" packages/backend/convex/ --include="*.ts"  # Check legacy path usage
```

---

## 5. Code Duplication Elimination

### 5.1 `createEmbedder()` — 4 Copies → 1

The exact same function appears in `indexingActions.ts`, `retrieverActions.ts`, `experimentActions.ts`, and `ragActions.ts` (deprecated).

**Fix**: Single copy in `eval-lib/src/llm/embedder-factory.ts`. All action files import from `rag-evaluation-system/llm`.

### 5.2 `spanValidator` — 3 Copies → 1

Defined identically in `schema.ts`, `questions.ts`, and `experimentResults.ts`.

**Fix**: Export from `convex/lib/validators.ts`, imported by all three.

### 5.3 `JobStatus` Type — 2 Copies → 1

Defined locally in `generation.ts` (line 27) and `indexing.ts` (line 215). `experiments.ts` uses string literals directly without a type alias.

**Fix**: Define once in `eval-lib/src/shared/types.ts`.

### 5.4 `applyResult` / `counterPatch` Logic — Extract to Shared Helper

`generation.ts` has extracted `applyResult()` (lines 31-46) and `counterPatch()` (lines 48-55) helpers. `indexing.ts:onDocumentIndexed` uses the same counter-update pattern but inlines the logic with separate variables. Both should use a single shared helper.

**Fix**: Create a generic helper in `convex/lib/workpool.ts`:
```typescript
export function applyWorkResult<T extends { processed: number; failed: number; skipped: number }>(
  counters: T,
  result: RunResult,
): T { ... }
```

### 5.5 Batch Question Insert — 3 Copies → 1

The `BATCH_SIZE=100` loop for inserting questions is copy-pasted across all three generation actions in `generationActions.ts`.

**Fix**: Extract to a shared helper in `generationActions.ts` or `eval-lib/src/shared/constants.ts` for the constant + inline a single helper function.

### 5.6 Vector Search Pattern — 2 Copies → 1

The "embed query → vectorSearch → fetchChunksWithDocs → post-filter by indexConfigHash → take topK" pipeline appears in both `retrieverActions.ts` and `experimentActions.ts`.

**Fix**: Extract the common logic into `convex/lib/vectorSearch.ts` (a shared internal action helper). This goes in `lib/` rather than `retrieval/` because both `retrieval/retrieverActions.ts` and `experiments/actions.ts` use it — placing it in either domain folder would create a misleading cross-domain dependency.

### 5.7 User Lookup Pattern — 3 Copies → 1

The `ctx.db.query("users").withIndex("by_clerk_id", ...).unique()` pattern appears in `knowledgeBases.ts`, `generation.ts`, and `experiments.ts`.

**Fix**: Extract to `convex/lib/auth.ts` as `lookupUser(ctx, userId)`.

### 5.8 Test Helpers — Duplicated Across Test Files

`seedUser`, `seedKB`, `seedDataset`, `setupTest`, `TEST_ORG_ID`, `TEST_CLERK_ID`, `testIdentity` are copy-pasted between `generation.test.ts` and `experiments.test.ts`.

**Fix**: Extract to `tests/helpers.ts`.

---

## 6. Type Safety Improvements

### 6.1 Excessive Use of `v.any()`

| Field | Table | Better Type |
|-------|-------|-------------|
| `metadata` | knowledgeBases, documents, datasets, questions, experimentResults | `v.record(v.string(), v.any())` or specific shape |
| `strategyConfig` | datasets | `v.union(simpleConfig, dimensionConfig, rwgConfig)` |
| `retrieverConfig` | retrievers, experiments | Define a `PipelineConfig` validator |
| `scores` | experiments, experimentResults | `v.record(v.string(), v.number())` |
| `indexConfig` | indexingJobs | Define an `IndexConfig` validator |

### 6.2 Type Assertions in Actions

Strategy config is cast with `as Record<string, unknown>` throughout `generationActions.ts` and `experimentActions.ts`. Proper validators would replace these casts with typed access.

### 6.3 `status` Uses `v.string()` in Internal Mutations

`experiments.updateStatus` accepts `status: v.string()` — should use `v.union(...)` matching the schema. Same for `retrievers.insertRetriever` and `updateIndexingStatus`.

---

## 7. Naming & Readability

### 7.1 File Renames

| Current | Issue | New Name |
|---------|-------|----------|
| `rag.ts` | Vague. Contains chunk CRUD, not RAG logic. | `retrieval/chunks.ts` |
| `ragActions.ts` | Deprecated and misnamed. | Delete entirely |

### 7.2 Inconsistent Function Naming

| Pattern | Examples | Issue |
|---------|----------|-------|
| Start functions | `startGeneration`, `experiments.start`, `indexing.startIndexing` | Inconsistent: verb+noun vs bare verb |
| Internal variants | `getInternal`, `byDatasetInternal` | Consistent but verbose |

### 7.3 Comments Reference Change IDs

Comments reference cryptic IDs like `I1`, `I3`, `I9`, `C1`, `C3`, `S3`. Expand to self-documenting:

```typescript
// Before:
// I9: Guard against stale Phase 1 callbacks after Phase 2 has started

// After:
// Guard: if Phase 2 has already started, ignore late Phase 1 callbacks
// to prevent counter corruption
```

---

## 8. Unused Dependencies & Import Cleanup

### `minisearch`

Listed in backend's `package.json` dependencies and `convex.json` externalPackages. Not directly imported by any backend file, but **used by eval-lib** (`src/retrievers/pipeline/search/bm25.ts` for BM25 search). Since eval-lib is bundled (not in `externalPackages`), `minisearch` must stay in `convex.json` `externalPackages` so esbuild correctly externalizes it when bundling eval-lib's BM25 code. The redundant entry in backend's `package.json` can be removed (it's a transitive dependency via eval-lib).

### eval-lib Import Surface

After Phase 2, the backend imports from these eval-lib sub-paths:

| Sub-path | Used By | Contains |
|---|---|---|
| `rag-evaluation-system` (root) | All action files | Types, strategies, metrics, chunkers, config hashing, `CallbackRetriever`, `openAIClientAdapter` |
| `rag-evaluation-system/langsmith` | `"use node"` action files only | `runLangSmithExperiment()`, `uploadDataset()`, `getLangSmithClient()` |
| `rag-evaluation-system/llm` | `"use node"` action files only | `createEmbedder()`, `createLLMClient()`, `getModel()` |
| `rag-evaluation-system/shared` | Any file (no Node.js deps) | `JobStatus`, `SerializedSpan`, constants, `buildCorpusFromDocs()` |
| `rag-evaluation-system/embedders/openai` | `"use node"` action files only | `OpenAIEmbedder` |

Other available sub-paths (`./pipeline/internals`, `./utils`, `./rerankers/cohere`) are not currently used by the backend.

---

## 9. Schema & Validator Improvements

### 9.1 Unused Schema Fields

Several fields on `experiments` are declared but never populated:

| Field | Status |
|-------|--------|
| `failedQuestions` | Never written to |
| `skippedQuestions` | Never written to |
| `indexConfigHash` | Never written to from experiments.ts |
| `langsmithExperimentId` | Never written to |
| `langsmithUrl` | Never written to |
| `langsmithSyncStatus` | Never written to |

**Options**: Remove if not planned, or populate them (e.g., capture LangSmith experiment URL from evaluate() results).

### 9.2 Dangling DocStrings

Misplaced docstrings in `datasets.ts:75-76` and `questions.ts:66-67`. Fix by moving/removing.

### 9.3 `indexConfigHash` is Optional on `documentChunks`

The `v.optional()` exists for backward compatibility. If legacy chunks are migrated, make it required.

---

## 10. Architectural Refinements

### 10.1 Polling Loop in Experiment Orchestrator

`experimentActions.runExperiment` (legacy path) polls indexing status with `setTimeout`. Fragile if indexing takes too long. Better approach: scheduler-based phases. Keep as-is unless timeouts occur.

### 10.2 `cancelIndexing` Uses `pool.cancelAll()`

Cancels ALL items in the indexing pool — not just this job's. Fix: store `workIds` on `indexingJobs` and cancel selectively.

### 10.3 LangSmith Sync Retry Full Table Scan

`getFailedDatasets` calls `ctx.db.query("datasets").collect()` without filtering. Add an index on `langsmithSyncStatus`.

### 10.4 `langsmithSyncRetry.ts` Mixes Action and Query Without `"use node"`

This file exports both an `internalAction` (`retryFailed`) and an `internalQuery` (`getFailedDatasets`) without a `"use node"` directive. Adding `"use node"` would break the query (files with `"use node"` can only export actions). The action only uses `ctx.runQuery` and `ctx.scheduler.runAfter` (Convex runtime calls, no Node.js needed), so it works correctly as-is. During the directory reorganization (Phase 3), consider splitting into separate files if this pattern causes confusion.

---

## 11. Testing Strategy

### Two-Layer Testing

The refactor creates two testable layers:

**Layer 1: eval-lib tests for extracted code** — Pure unit tests, no Convex required:

```
packages/eval-lib/tests/
├── langsmith/
│   ├── experiment.test.ts       # Mock LangSmith evaluate(), test evaluator creation, metric wiring
│   └── upload.test.ts           # Mock LangSmith client, test batch upload, retry behavior
├── llm/
│   ├── embedder-factory.test.ts # Mock OpenAI, test embedder creation, error handling
│   └── config.test.ts           # Test config resolution
└── shared/
    └── corpus.test.ts           # Test corpus building from raw doc records
```

These are the **easiest tests to write** because they test pure functions with mockable dependencies. No Convex runtime needed. Standard vitest. They live alongside eval-lib's existing 133 tests.

**Layer 2: Convex tests** — `convex-test` integration tests:

```
packages/backend/tests/
├── helpers.ts                   # Shared seeders, test identity, setupTest
├── generation.test.ts           # WorkPool callbacks (Phase 1 + 2), queries (existing)
├── experiments.test.ts          # onExperimentComplete, queries (existing)
├── indexing.test.ts             # NEW: onDocumentIndexed, dedup, retriever sync
├── retrievers.test.ts           # NEW: CRUD, shared index protection, status transitions
├── crud.test.ts                 # NEW: KB, document, dataset, question CRUD
├── langsmith.test.ts            # NEW: Sync retry logic
└── workpool-helpers.test.ts     # NEW: Unit test shared counter logic
```

### Current State

| File | Tests | Focus |
|------|-------|-------|
| `generation.test.ts` | 13 | WorkPool callbacks (Phase 1 + 2), getJob query |
| `experiments.test.ts` | 6 | onExperimentComplete callback, get query |
| **Total** | **19** | |

### Coverage Gaps (Prioritized)

#### Critical — Test Before Refactoring

| Area | What to Test |
|------|-------------|
| `indexing.onDocumentIndexed` | Counter updates, completion detection, retriever status sync |
| `indexing.startIndexing` | Dedup logic (running/completed), force re-index |
| `retrievers.remove` | Cascade delete, shared index protection |
| `retrievers.deleteIndex` | Shared index guard, status reset |
| `experiments.start` | Validation (retriever ready, KB match), record creation |

#### Important — Improves Confidence

| Area | What to Test |
|------|-------------|
| `generation.startGeneration` | Dataset + job creation, strategy dispatch |
| `generation.cancelGeneration` | Status guard, selective cancel |
| `questions.insertBatch` | Batch creation |
| `questions.updateSpans` | Span patching |
| `rag.insertChunkBatch` | Bulk insert |
| `rag.patchChunkEmbeddings` | Embedding patching |
| `rag.deleteKbConfigChunks` | Paginated deletion, hasMore flag |

#### Nice to Have

| Area | What to Test |
|------|-------------|
| Auth guards | Every public function rejects unauthenticated/wrong-org calls |
| `langsmithSyncRetry.getFailedDatasets` | Correctly filters by prefix |
| `users.getOrCreate` | Create vs return existing |
| `documents.create` | Content storage, org scoping |

### Testing Principles

1. **eval-lib tests for extracted code first** — Easiest to write, highest value. The hardest-to-test code (LangSmith, embedder, upload) moves to eval-lib where it can be tested with simple mocks.
2. **Convex tests for orchestration only** — Test callbacks, status transitions, WorkPool interactions. Don't test LangSmith or OpenAI logic in Convex tests.
3. **Extract shared test helpers** — `tests/helpers.ts` with common seeders, eliminating duplication across test files.
4. **Integration tests later** — Full flow tests (create KB → upload → generate → verify) need action mocking and are lower priority.

---

## 12. Priority Roadmap

### Phase 1: Dead Code Cleanup (Low Risk)

Quick wins that reduce noise before the structural refactor:

- [ ] Remove `ragActions.ts` (deprecated, no callers)
- [ ] Remove `testing.ts` (empty file)
- [ ] Remove `rag.insertChunk` and `rag.deleteKbChunks` (deprecated)
- [ ] Remove `minisearch` from backend `package.json` (keep in `convex.json` — used by eval-lib's BM25 search)
- [ ] Remove `MAX_AUTO_RETRIES` unused constant
- [ ] Verify no remaining imports from `rag-evaluation-system/langsmith/*`
- [ ] Fix dangling docstrings in `datasets.ts` and `questions.ts`
- [ ] Replace boilerplate `README.md` with link to `docs/`

### Phase 2: Extract Non-Convex Code to eval-lib (Medium Risk)

Move non-Convex code into new modules within the existing eval-lib package:

- [ ] Create `eval-lib/src/langsmith/` module (client.ts, experiment.ts, upload.ts, index.ts)
- [ ] Create `eval-lib/src/llm/` module (client.ts, embedder-factory.ts, config.ts, index.ts)
- [ ] Create `eval-lib/src/shared/` module (corpus.ts, types.ts, constants.ts, index.ts)
- [ ] Move `createEmbedder()` → `eval-lib/src/llm/embedder-factory.ts`
- [ ] Move `createLLMClient()` → `eval-lib/src/llm/client.ts`
- [ ] Move `getLangSmithClient()` → `eval-lib/src/langsmith/client.ts`
- [ ] Move inlined `runLangSmithExperiment()` → `eval-lib/src/langsmith/experiment.ts`
- [ ] Move inlined `uploadDataset()` → `eval-lib/src/langsmith/upload.ts`
- [ ] Move `getModel()` → `eval-lib/src/llm/config.ts`
- [ ] Move `buildCorpusFromDocs()` → `eval-lib/src/shared/corpus.ts`
- [ ] Consolidate `JobStatus`, `SerializedSpan`, constants → `eval-lib/src/shared/types.ts`, `eval-lib/src/shared/constants.ts`
- [ ] Add `langsmith` and `@langchain/core` to eval-lib `package.json` dependencies
- [ ] Add sub-path exports to eval-lib `package.json` and tsup.config.ts
- [ ] Update all import sites in `convex/` to use `rag-evaluation-system/langsmith`, `rag-evaluation-system/llm`, etc.
- [ ] Delete `convex/lib/llm.ts` and `convex/lib/langsmith.ts`
- [ ] Verify `pnpm build` and `npx convex dev --once` succeed

### Phase 3: Convex Directory Reorganization (Higher Risk)

Move files into domain subfolders. **This changes all `api.*` and `internal.*` paths.**

- [ ] Extract shared helpers: `lib/validators.ts`, `lib/workpool.ts`, `lib/auth.ts` (add `lookupUser`)
- [ ] Create `generation/` — move `generation.ts` → `generation/orchestration.ts`, `generationActions.ts` → `generation/actions.ts`
- [ ] Create `retrieval/` — move `indexing.ts`, `indexingActions.ts`, `rag.ts` → `chunks.ts`
- [ ] Create `experiments/` — move `experiments.ts` → `orchestration.ts`, `experimentActions.ts` → `actions.ts`, `experimentResults.ts` → `results.ts`
- [ ] Create `crud/` — move `knowledgeBases.ts`, `documents.ts`, `datasets.ts`, `questions.ts`, `users.ts`, `retrievers.ts`
- [ ] Create `langsmith/` — move `langsmithSync.ts` → `sync.ts`, `langsmithRetry.ts` → `retry.ts`, `langsmithSyncRetry.ts` → `syncRetry.ts`
- [ ] Move `retrieverActions.ts` → `retrieval/retrieverActions.ts`
- [ ] Update relative `./lib/auth` imports in all moved files (13 files import from `./lib/`)
- [ ] Update ALL `internal.*` references across all backend files (~70 call sites across 12 files)
- [ ] Update ALL `api.*` references in frontend files (26 references across 7 files) — see [Frontend Changes](./frontend-changes-after-backend-refactor.md)
- [ ] Update `crons.ts` reference (`internal.langsmithSyncRetry.retryFailed`)
- [ ] Verify `pnpm build`, `npx convex dev --once`, and frontend build all succeed

### Phase 4: Type Safety & Schema (Medium Risk)

- [ ] Add proper validators for `strategyConfig`, `retrieverConfig`, `scores`
- [ ] Change `status: v.string()` in internal mutations to use union validators
- [ ] Audit `v.any()` fields — replace with specific validators
- [ ] Make `indexConfigHash` required on `documentChunks` (if legacy data migrated)
- [ ] Clean up unused experiment schema fields or populate them

### Phase 5: Testing (No Risk to Production)

- [ ] Add eval-lib unit tests for extracted code (langsmith, embedder, corpus, config)
- [ ] Extract shared convex test helpers to `tests/helpers.ts`
- [ ] Add `indexing.test.ts` — callbacks, dedup, retriever sync
- [ ] Add `retrievers.test.ts` — CRUD, shared index protection
- [ ] Add `workpool-helpers.test.ts` — shared counter logic
- [ ] Expand existing test files (generation, experiments)
- [ ] Add `crud.test.ts` and `langsmith.test.ts`

### Phase 6: Architectural Polish (Long-Term)

- [ ] Fix `cancelIndexing` to use selective cancel (not `cancelAll`)
- [ ] Add index on `datasets.langsmithSyncStatus` for efficient retry queries
- [ ] Consider replacing experiment orchestrator polling with scheduler-based phases
- [ ] Extract common vector search pattern into `lib/vectorSearch.ts`
- [ ] Expand change ID comments into self-documenting form
- [ ] Remove legacy experiment path (`retrieverConfig` without `retrieverId`)
