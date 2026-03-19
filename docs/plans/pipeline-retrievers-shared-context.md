# Pipeline Retrievers — Shared Context

> This file contains the shared preamble from the original monolithic plan. Each slice doc references this for context.

**Goal:** Expand the pipeline retriever system with new embedders, rerankers, chunkers, pipeline stage strategies, and named presets — enabling hundreds of experiment configurations from composable building blocks.

**Architecture:** Build on the existing 4-stage `PipelineRetriever` (INDEX → QUERY → SEARCH → REFINEMENT) by extending the discriminated unions in `config.ts`, adding new provider implementations that plug into existing interfaces, and implementing new pipeline strategies. Everything stays within eval-lib — no backend/frontend changes.

**Tech Stack:** TypeScript, Vitest, tsup, pnpm workspace. Provider SDKs: `cohere-ai`, `voyageai`, plain `fetch` for Jina/Voyage REST APIs. `js-tiktoken` for token chunking.

Organized into **6 vertical slices** — each slice unlocks a new set of runnable experiments. Scope: **eval-lib only** (no backend/frontend changes).

---

## Current Codebase State (Ground Truth)

All references below should be verified against the actual source files.

**Interfaces (unchanged — our targets to implement against):**

```typescript
// packages/eval-lib/src/embedders/embedder.interface.ts
interface Embedder {
  readonly name: string;
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}

// packages/eval-lib/src/rerankers/reranker.interface.ts
interface Reranker {
  readonly name: string;
  rerank(query: string, chunks: readonly PositionAwareChunk[], topK?: number): Promise<PositionAwareChunk[]>;
}

// packages/eval-lib/src/chunkers/chunker.interface.ts
interface PositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): PositionAwareChunk[];
}

// packages/eval-lib/src/retrievers/retriever.interface.ts
interface Retriever {
  readonly name: string;
  init(corpus: Corpus): Promise<void>;
  retrieve(query: string, k: number): Promise<PositionAwareChunk[]>;
  cleanup(): Promise<void>;
}
```

**Current Config Types (`config.ts`):**

```typescript
// IndexConfig — currently a SINGLE interface, NOT a discriminated union
export interface IndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;       // default 1000
  readonly chunkOverlap?: number;    // default 200
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;  // default "text-embedding-3-small"
}

export type QueryConfig = IdentityQueryConfig;
export type SearchConfig = DenseSearchConfig | BM25SearchConfig | HybridSearchConfig;
export type RefinementStepConfig = RerankRefinementStep | ThresholdRefinementStep;

export interface PipelineConfig {
  readonly name: string;
  readonly index?: IndexConfig;
  readonly query?: QueryConfig;
  readonly search?: SearchConfig;
  readonly refinement?: readonly RefinementStepConfig[];
}
```

**Current PipelineRetrieverDeps:**

```typescript
export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  readonly embeddingBatchSize?: number;
}
```

**Current Presets (`experiments/presets.ts`):**

4 presets: baseline-vector-rag, bm25, hybrid, hybrid-reranked. Factory: `createPresetRetriever(presetName, deps, overrides?)`.

**Current Hash Functions (`config.ts`):**

```typescript
interface IndexHashPayload {
  readonly strategy: string;
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly separators: readonly string[] | undefined;
  readonly embeddingModel: string;
}

export function computeIndexConfigHash(config: PipelineConfig): string;
export function computeRetrieverConfigHash(config: PipelineConfig, k: number): string;
```

**Current Package Dependencies (`package.json`):**

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

**Current Export Entry Points (`tsup.config.ts`):**

8 entry points: src/index.ts, src/embedders/openai.ts, src/rerankers/cohere.ts, src/pipeline/internals.ts, src/utils/index.ts, src/langsmith/index.ts, src/llm/index.ts, src/shared/index.ts

**Current Test Suite:** 27 test files / 225 tests

---

## Impacts on This Plan (from Backend Refactor PR #27)

| # | Impact | Affected Slices | Action Required |
|---|--------|-----------------|-----------------|
| 1 | **Experiment presets are now in a single `presets.ts` file** | 6 | Extend existing `PRESET_CONFIGS` map and `createPresetRetriever` factory |
| 2 | **ChromaVectorStore removed** | — | Remove all references to Chroma from the plan |
| 3 | **`chromadb` not in optionalDependencies** | 1 | Don't add it back |
| 4 | **LangSmith code now lives in eval-lib sub-path** | — | No impact on this plan (eval-lib-only changes) |
| 5 | **8 tsup entry points already exist** | 1 | New providers need their own entry points |
| 6 | **`IndexConfig` is a single interface, not a discriminated union yet** | 4 | Converting it to a discriminated union is a breaking change |
| 7 | **`computeRetrieverConfigHash` serializes the full config** | 3, 4, 5 | Must preserve inline `index: { ... }` payload structure for hash stability |
| 8 | **Backend `startIndexing` hardcodes `strategy: "plain"`** | 4 | Backend lines 104-112 hardcode plain. Backend follow-up needed for new strategies |
| 9 | **Backend `retrieve` action only does dense vector search** | — | Backend uses `lib/vectorSearch.ts`, not PipelineRetriever |
| 10 | **Backend imports `createEmbedder` from eval-lib — OpenAI only** | 1 | Backend follow-up for provider-aware factory |
| 11 | **Frontend `pipeline-types.ts` must mirror new config types** | 3, 4, 5 | Frontend follow-up |
| 12 | **eval-lib now has `langsmith/`, `llm/`, `shared/` sub-paths** | 1, 3 | New modules go in main barrel or `pipeline/`, not these sub-paths |
| 13 | **Backend uses `lib/vectorSearch.ts` shared helper** | — | May be replaced when backend supports full PipelineRetriever |

---

## Backend Files Referenced by This Plan

These backend files are referenced in impact items and follow-up work. Review agents should verify claims about them:

- `packages/backend/convex/retrieval/retrieverActions.ts` — create, startIndexing, retrieve actions
- `packages/backend/convex/retrieval/indexingActions.ts` — two-phase document indexing
- `packages/backend/convex/retrieval/indexing.ts` — indexing orchestration
- `packages/backend/convex/experiments/actions.ts` — experiment runner
- `packages/backend/convex/lib/vectorSearch.ts` — shared vector search helper
- `packages/backend/convex/crud/retrievers.ts` — retriever CRUD
- `packages/frontend/src/lib/pipeline-types.ts` — frontend type mirror

## Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Goal | Full matrix sweep | Build breadth across all stages to maximize experiment grid |
| 2 | Embedding providers | All 4 (OpenAI, Cohere, Voyage, Jina) | Maximum coverage, each has unique features |
| 3 | LLM interface | Generic `PipelineLLM` + OpenAI default | Provider-agnostic, eval-lib stays clean |
| 4 | Async chunkers | New `AsyncPositionAwareChunker` interface | Clean separation, no breaking change to sync chunkers |
| 5 | Preset organization | Extend existing `PRESET_CONFIGS` map in `presets.ts` | Consistent with current pattern, avoids duplication |
| 6 | Scope | eval-lib only | Backend integration is a separate follow-up |
| 7 | Phasing | Vertical slices | Each slice unlocks runnable experiments |
| 8 | Provider SDKs | Official SDKs where available, plain `fetch` otherwise | Type-safe, auto-retry, vendor-maintained |
| 9 | Chunker embedder | Same as pipeline's search embedder | Simpler |
| 10 | Multi-query fusion | Fusion-of-fusions OK | Standard in multi-query retrieval literature |
| 11 | Testing | Unit tests with mocks only | No real API calls in CI |
| 12 | New provider entry points | One tsup entry point per provider with optional deps | Tree-shakeable |
| 13 | `k` in PipelineConfig | Keep `k` out of `PipelineConfig` | Runtime parameter, not config property |
| 14 | MMR diversity metric | Content overlap ratio (character spans) | Avoids recomputing embeddings at refinement time |
| 15 | Config registry | `eval-lib/src/registry/` sub-path | Single source of truth for all provider/model/strategy metadata. Frontend reads at build time. |
| 16 | Registry status field | `"available" \| "coming-soon"` per entry | Allows populating the full registry upfront; unimplemented features show as disabled in the frontend wizard |
| 17 | Frontend type consolidation | Import from eval-lib, no more duplication | `pipeline-types.ts` no longer duplicates `PipelineConfig` and related types |
| 18 | Frontend wizard | Guided 6-step wizard replaces `PipelineConfigModal` | Driven by registry data — adding a provider/strategy to the registry auto-surfaces it in the UI |

---

## Config Registry

> Added during the registry + wizard implementation. See design doc: `docs/plans/2026-03-07-pipeline-config-registry-design.md`

**Location:** `packages/eval-lib/src/registry/` — sub-path export: `rag-evaluation-system/registry`

**What it provides:**
- `EMBEDDER_REGISTRY` — 4 providers with models, descriptions, defaults
- `RERANKER_REGISTRY` — 3 providers with models
- `CHUNKER_REGISTRY` — 7 chunker types (4 available, 3 coming-soon)
- `INDEX_STRATEGY_REGISTRY` — 4 strategies (1 available, 3 coming-soon)
- `QUERY_STRATEGY_REGISTRY` — 5 strategies (1 available, 4 coming-soon)
- `SEARCH_STRATEGY_REGISTRY` — 3 strategies (all available)
- `REFINEMENT_STEP_REGISTRY` — 5 step types (2 available, 3 coming-soon)
- `PRESET_REGISTRY` — 24 presets as `PresetEntry[]` (8 available, 16 coming-soon)

**When implementing slices 3-6:** After implementing a new strategy/provider, update its `status` from `"coming-soon"` to `"available"` in the corresponding registry file (`src/registry/*.ts`). The frontend wizard will automatically enable it — no frontend code changes needed.

**Registry types:**
```typescript
interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  status: "available" | "coming-soon";
  tags?: string[];
  options: OptionDef[];      // configurable fields with labels, descriptions, types, defaults
  defaults: Record<string, unknown>;
}

interface PresetEntry extends RegistryEntry {
  config: PipelineConfig;
  complexity: "basic" | "intermediate" | "advanced";
  requiresLLM: boolean;
  requiresReranker: boolean;
  stages: { index: string; query: string; search: string; refinement: string };
}
```

**Frontend imports:**
```typescript
// Types from main package
import type { PipelineConfig } from "rag-evaluation-system";
// Registry data from sub-path
import { PRESET_REGISTRY, EMBEDDER_REGISTRY, ... } from "rag-evaluation-system/registry";
import type { RegistryEntry, PresetEntry } from "rag-evaluation-system/registry";
```

**Frontend wizard:** `packages/frontend/src/components/wizard/RetrieverWizard.tsx` — 6-step guided wizard. Reads registry data to render option cards, dropdowns, and form fields dynamically. Replaces the old `PipelineConfigModal`.
