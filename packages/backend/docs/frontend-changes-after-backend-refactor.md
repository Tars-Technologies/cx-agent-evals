# Frontend Changes After Backend Refactor

> Complete list of frontend code changes required after the backend directory reorganization described in [Refactoring Suggestions](./refactoring-suggestions.md#3-convex-directory-reorganization).

[Back to Architecture Overview](./architecture.md) | [Refactoring Suggestions](./refactoring-suggestions.md)

---

## Overview

The backend refactor moves Convex files from a flat `convex/` directory into nested domain folders. Convex uses file-based routing, so `convex/foo/bar.ts` becomes `api.foo.bar.functionName`. This means **every `api.*` import path in the frontend must be updated**.

The auto-generated `_generated/api.ts` regenerates automatically after the backend restructure. The frontend changes are purely mechanical find-and-replace updates to match the new paths.

**Total**: 26 references across 7 files.

---

## How to Apply

1. Complete the backend directory reorganization
2. Run `npx convex dev --once` to regenerate `_generated/api.ts`
3. Update all frontend references per the tables below
4. Run `pnpm -C packages/frontend build` to verify no TypeScript errors

All changes are type-safe — if you miss one, TypeScript will catch it because the old `api.*` paths won't exist in the regenerated types.

---

## Changes by File

### `src/components/AuthGate.tsx`

| Line | Before | After | Hook |
|------|--------|-------|------|
| 96 | `api.users.getOrCreate` | `api.crud.users.getOrCreate` | `useMutation` |

### `src/components/FileUploader.tsx`

| Line | Before | After | Hook |
|------|--------|-------|------|
| 13 | `api.documents.generateUploadUrl` | `api.crud.documents.generateUploadUrl` | `useMutation` |
| 14 | `api.documents.create` | `api.crud.documents.create` | `useMutation` |

### `src/components/KBSelector.tsx`

| Line | Before | After | Hook |
|------|--------|-------|------|
| 15 | `api.knowledgeBases.list` | `api.crud.knowledgeBases.list` | `useQuery` |
| 17 | `api.documents.listByKb` | `api.crud.documents.listByKb` | `useQuery` |
| 20 | `api.knowledgeBases.create` | `api.crud.knowledgeBases.create` | `useMutation` |

### `src/components/RetrieverPlayground.tsx`

| Line | Before | After | Hook |
|------|--------|-------|------|
| 46 | `api.retrieverActions.retrieve` | `api.retrieval.retrieverActions.retrieve` | `useAction` |

### `src/app/generate/page.tsx`

| Line | Before | After | Hook |
|------|--------|-------|------|
| 26 | `api.questions.byDataset` | `api.crud.questions.byDataset` | `useQuery` |
| 32 | `api.documents.listByKb` | `api.crud.documents.listByKb` | `useQuery` |
| 37 | `api.generation.getJob` | `api.generation.orchestration.getJob` | `useQuery` |
| 40 | `api.datasets.get` | `api.crud.datasets.get` | `useQuery` |
| 42 | `api.generation.startGeneration` | `api.generation.orchestration.startGeneration` | `useMutation` |
| 64 | `api.documents.get` | `api.crud.documents.get` | `useQuery` |

### `src/app/experiments/page.tsx`

| Line | Before | After | Hook |
|------|--------|-------|------|
| 15 | `api.retrievers.byOrg` | `api.crud.retrievers.byOrg` | `useQuery` |
| 21 | `api.datasets.list` | `api.crud.datasets.list` | `useQuery` |
| 40 | `api.experiments.byDataset` | `api.experiments.orchestration.byDataset` | `useQuery` |
| 45 | `api.datasets.get` | `api.crud.datasets.get` | `useQuery` |
| 53 | `api.experiments.get` | `api.experiments.orchestration.get` | `useQuery` |
| 57 | `api.experiments.start` | `api.experiments.orchestration.start` | `useMutation` |

### `src/app/retrievers/page.tsx`

| Line | Before | After | Hook |
|------|--------|-------|------|
| 54 | `api.indexing.getJob` | `api.retrieval.indexing.getJob` | `useQuery` |
| 97 | `api.retrievers.byKb` | `api.crud.retrievers.byKb` | `useQuery` |
| 102 | `api.retrieverActions.create` | `api.retrieval.retrieverActions.create` | `useAction` |
| 103 | `api.retrieverActions.startIndexing` | `api.retrieval.retrieverActions.startIndexing` | `useAction` |
| 104 | `api.retrievers.remove` | `api.crud.retrievers.remove` | `useMutation` |
| 105 | `api.retrievers.deleteIndex` | `api.crud.retrievers.deleteIndex` | `useMutation` |
| 106 | `api.retrievers.resetAfterCancel` | `api.crud.retrievers.resetAfterCancel` | `useMutation` |
| 107 | `api.indexing.cancelIndexing` | `api.retrieval.indexing.cancelIndexing` | `useMutation` |

---

## Changes by API Module

Quick-reference for batch find-and-replace. Each row is a unique API path.

### CRUD (flat → `crud/`)

| Before | After |
|--------|-------|
| `api.users.getOrCreate` | `api.crud.users.getOrCreate` |
| `api.knowledgeBases.list` | `api.crud.knowledgeBases.list` |
| `api.knowledgeBases.create` | `api.crud.knowledgeBases.create` |
| `api.documents.generateUploadUrl` | `api.crud.documents.generateUploadUrl` |
| `api.documents.create` | `api.crud.documents.create` |
| `api.documents.listByKb` | `api.crud.documents.listByKb` |
| `api.documents.get` | `api.crud.documents.get` |
| `api.datasets.list` | `api.crud.datasets.list` |
| `api.datasets.get` | `api.crud.datasets.get` |
| `api.questions.byDataset` | `api.crud.questions.byDataset` |
| `api.retrievers.byOrg` | `api.crud.retrievers.byOrg` |
| `api.retrievers.byKb` | `api.crud.retrievers.byKb` |
| `api.retrievers.remove` | `api.crud.retrievers.remove` |
| `api.retrievers.deleteIndex` | `api.crud.retrievers.deleteIndex` |
| `api.retrievers.resetAfterCancel` | `api.crud.retrievers.resetAfterCancel` |

### Generation (flat → `generation/`)

| Before | After |
|--------|-------|
| `api.generation.startGeneration` | `api.generation.orchestration.startGeneration` |
| `api.generation.getJob` | `api.generation.orchestration.getJob` |

### Retrieval (flat → `retrieval/`)

| Before | After |
|--------|-------|
| `api.indexing.getJob` | `api.retrieval.indexing.getJob` |
| `api.indexing.cancelIndexing` | `api.retrieval.indexing.cancelIndexing` |
| `api.retrieverActions.create` | `api.retrieval.retrieverActions.create` |
| `api.retrieverActions.startIndexing` | `api.retrieval.retrieverActions.startIndexing` |
| `api.retrieverActions.retrieve` | `api.retrieval.retrieverActions.retrieve` |

### Experiments (flat → `experiments/`)

| Before | After |
|--------|-------|
| `api.experiments.start` | `api.experiments.orchestration.start` |
| `api.experiments.byDataset` | `api.experiments.orchestration.byDataset` |
| `api.experiments.get` | `api.experiments.orchestration.get` |

---

## Import Statement

Every frontend file that uses Convex APIs imports from the generated API file:

```typescript
import { api } from "../../lib/convex";
```

This import does **not** change. Only the property paths after `api.` change.

---

## eval-lib

The `packages/eval-lib/` package has **zero Convex references** (no `api.*`, no `internal.*`, no Convex imports). It is not affected by the backend directory restructure.

Note: As part of the broader refactor, eval-lib will **gain** new modules (`langsmith/`, `llm/`, `shared/`) extracted from backend action files. These are pure TypeScript with no Convex dependency and do not affect frontend API paths. See [Refactoring Suggestions §2](./refactoring-suggestions.md#2-extracting-non-convex-code-to-eval-lib) for details.
