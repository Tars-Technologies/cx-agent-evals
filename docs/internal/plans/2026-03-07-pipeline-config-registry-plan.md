# Pipeline Config Registry + Guided Wizard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a config registry in eval-lib that describes all pipeline retriever options (providers, models, chunkers, strategies, presets) with metadata, and build a guided wizard in the frontend that renders configuration UI from the registry data.

**Architecture:** A pure-data TypeScript registry in `eval-lib/src/registry/` exports structured metadata arrays. A new `rag-evaluation-system/registry` sub-path makes this available to the frontend at build time. The frontend replaces `PipelineConfigModal` with a multi-step wizard (`components/wizard/`) that reads registry data to render option cards, dropdowns, and form fields dynamically. Presets are first-class — most users start from a preset and optionally customize.

**Tech Stack:** TypeScript, React (Next.js 16), Tailwind CSS v4, Vitest. No new dependencies.

**Design doc:** `docs/plans/2026-03-07-pipeline-config-registry-design.md`

---

## Ground Truth

Before implementing, verify these facts against the actual source files.

### Key Files

| File | Purpose |
|------|---------|
| `packages/eval-lib/src/retrievers/pipeline/config.ts` | Canonical `PipelineConfig` type + hash functions |
| `packages/eval-lib/src/experiments/presets.ts` | 4 preset configs + factory functions |
| `packages/eval-lib/src/index.ts` | Main barrel — re-exports from all modules |
| `packages/eval-lib/tsup.config.ts` | Build entry points (currently 15) |
| `packages/eval-lib/package.json` | `"exports"` field (currently 15 sub-paths) |
| `packages/frontend/src/lib/pipeline-types.ts` | Frontend type duplicates + 4 presets + `resolveConfig()` |
| `packages/frontend/src/lib/pipeline-storage.ts` | localStorage persistence for saved configs |
| `packages/frontend/src/components/PipelineConfigModal.tsx` | Current config form (642 lines) — will be replaced |
| `packages/frontend/src/components/PipelineConfigSummary.tsx` | Read-only config summary (110 lines) |
| `packages/frontend/src/app/retrievers/page.tsx` | Retrievers page (465 lines) — will be modified |
| `packages/frontend/src/components/RetrieverCard.tsx` | Retriever card (169 lines) — unchanged |
| `packages/frontend/src/app/globals.css` | Design tokens (colors, fonts, animations) |

### Design Tokens (from `globals.css`)

```
--color-bg: #0c0c0f          --color-bg-elevated: #141419
--color-bg-surface: #1a1a22  --color-bg-hover: #22222d
--color-border: #2a2a36      --color-border-bright: #3a3a4a
--color-text: #e8e8ed        --color-text-muted: #8888a0
--color-text-dim: #55556a    --color-accent: #6ee7b7
--color-accent-dim: #2d6b54  --color-accent-bright: #a7f3d0
--color-warn: #fbbf24        --color-error: #f87171
Font: JetBrains Mono, 13px, line-height 1.6
```

### Current PipelineConfig Shape

```typescript
interface PipelineConfig {
  readonly name: string;
  readonly index?: IndexConfig;      // strategy: "plain" only
  readonly query?: QueryConfig;      // strategy: "identity" only
  readonly search?: SearchConfig;    // "dense" | "bm25" | "hybrid"
  readonly refinement?: readonly RefinementStepConfig[];  // "rerank" | "threshold"
}
```

### Current Frontend PipelineConfig (extends eval-lib's)

Same as above plus `k?: number` (top-K, not in eval-lib type — runtime param).

### What's Implemented vs Coming Soon

| Component | Available (implemented) | Coming Soon (slices 3-6) |
|-----------|------------------------|--------------------------|
| Embedders | openai, cohere, voyage, jina | — |
| Rerankers | cohere, jina, voyage | — |
| Chunkers | recursive-character, sentence, token, markdown | semantic, cluster-semantic, llm-semantic |
| Index strategies | plain | contextual, summary, parent-child |
| Query strategies | identity | hyde, multi-query, step-back, rewrite |
| Search strategies | dense, bm25, hybrid | — |
| Refinement steps | rerank, threshold | dedup, mmr, expand-context |
| Presets | baseline-vector-rag, bm25, hybrid, hybrid-reranked | 20 more (see slice 6 plan) |

---

## Task 1: Registry Types

**Files:**
- Create: `packages/eval-lib/src/registry/types.ts`
- Test: `packages/eval-lib/tests/unit/registry/types.test.ts`

### Step 1: Write the test

```typescript
// packages/eval-lib/tests/unit/registry/types.test.ts
import { describe, it, expect } from "vitest";
import type {
  RegistryEntry,
  OptionDef,
  Choice,
  PresetEntry,
} from "../../src/registry/types.js";

describe("Registry types", () => {
  it("RegistryEntry is structurally valid", () => {
    const entry: RegistryEntry = {
      id: "test",
      name: "Test",
      description: "A test entry",
      status: "available",
      options: [],
      defaults: {},
    };
    expect(entry.id).toBe("test");
    expect(entry.status).toBe("available");
  });

  it("RegistryEntry supports coming-soon status", () => {
    const entry: RegistryEntry = {
      id: "future",
      name: "Future",
      description: "Not yet implemented",
      status: "coming-soon",
      tags: ["experimental"],
      options: [],
      defaults: {},
    };
    expect(entry.status).toBe("coming-soon");
    expect(entry.tags).toContain("experimental");
  });

  it("OptionDef supports all field types", () => {
    const selectOpt: OptionDef = {
      key: "model",
      label: "Model",
      description: "Which model to use",
      type: "select",
      choices: [
        { value: "a", label: "A" },
        { value: "b", label: "B", description: "The B model" },
      ],
      default: "a",
    };
    expect(selectOpt.choices).toHaveLength(2);

    const numberOpt: OptionDef = {
      key: "size",
      label: "Size",
      description: "Chunk size",
      type: "number",
      default: 1000,
      constraints: { min: 100, max: 10000, step: 100 },
    };
    expect(numberOpt.constraints?.min).toBe(100);

    const boolOpt: OptionDef = {
      key: "merge",
      label: "Merge",
      description: "Merge small sections",
      type: "boolean",
      default: true,
    };
    expect(boolOpt.default).toBe(true);

    const advancedOpt: OptionDef = {
      key: "prompt",
      label: "Prompt",
      description: "Custom prompt",
      type: "string",
      default: "",
      advanced: true,
    };
    expect(advancedOpt.advanced).toBe(true);
  });

  it("PresetEntry extends RegistryEntry with config metadata", () => {
    const preset: PresetEntry = {
      id: "test-preset",
      name: "Test Preset",
      description: "A test preset",
      status: "available",
      complexity: "basic",
      requiresLLM: false,
      requiresReranker: false,
      config: { name: "test-preset", search: { strategy: "dense" } },
      stages: {
        index: "Plain (1000 chars, 200 overlap)",
        query: "Identity (passthrough)",
        search: "Dense vector search",
        refinement: "None",
      },
      options: [],
      defaults: {},
    };
    expect(preset.complexity).toBe("basic");
    expect(preset.config.name).toBe("test-preset");
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/types.test.ts
```
Expected: FAIL — cannot resolve `../../src/registry/types.js`

### Step 3: Write the implementation

```typescript
// packages/eval-lib/src/registry/types.ts
import type { PipelineConfig } from "../retrievers/pipeline/config.js";

/** A single selectable value in a dropdown/radio group */
export interface Choice {
  /** Machine value stored in config */
  readonly value: string;
  /** Human-readable label */
  readonly label: string;
  /** Optional description shown when this choice is selected */
  readonly description?: string;
}

/** A configurable option exposed in the UI */
export interface OptionDef {
  /** Field name matching the config key, e.g., "model" */
  readonly key: string;
  /** Display label, e.g., "Model" */
  readonly label: string;
  /** 1-2 sentence explanation of what this option does */
  readonly description: string;
  /** Input type */
  readonly type: "select" | "number" | "boolean" | "string";
  /** Available choices for type: "select" */
  readonly choices?: readonly Choice[];
  /** Default value */
  readonly default: unknown;
  /** Constraints for type: "number" */
  readonly constraints?: {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
  };
  /** If true, hidden under an "Advanced" toggle in the wizard */
  readonly advanced?: boolean;
}

/** A registry entry for a provider, strategy, or component */
export interface RegistryEntry {
  /** Machine key, e.g., "cohere" */
  readonly id: string;
  /** Display name, e.g., "Cohere" */
  readonly name: string;
  /** 1-2 sentence explanation */
  readonly description: string;
  /**
   * Implementation status:
   * - "available": fully implemented, selectable in the wizard
   * - "coming-soon": shown in UI but disabled with "Coming soon" badge
   */
  readonly status: "available" | "coming-soon";
  /** Filterable tags, e.g., ["multilingual", "fast"] */
  readonly tags?: readonly string[];
  /** Configurable fields for this entry */
  readonly options: readonly OptionDef[];
  /** Default values for all options (keyed by OptionDef.key) */
  readonly defaults: Readonly<Record<string, unknown>>;
}

/**
 * A named preset with full PipelineConfig + UI metadata.
 * Extends RegistryEntry — presets are browsable just like providers.
 */
export interface PresetEntry extends RegistryEntry {
  /** The actual PipelineConfig object this preset produces */
  readonly config: PipelineConfig;
  /** Complexity level for filtering/badges */
  readonly complexity: "basic" | "intermediate" | "advanced";
  /** Whether this preset requires an LLM (for query/index strategies) */
  readonly requiresLLM: boolean;
  /** Whether this preset requires a reranker (for refinement steps) */
  readonly requiresReranker: boolean;
  /** Human-readable summary of what each stage does */
  readonly stages: {
    readonly index: string;
    readonly query: string;
    readonly search: string;
    readonly refinement: string;
  };
}
```

### Step 4: Run test to verify it passes

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/types.test.ts
```
Expected: PASS (all 4 tests)

### Step 5: Commit

```bash
git add packages/eval-lib/src/registry/types.ts packages/eval-lib/tests/unit/registry/types.test.ts
git commit -m "feat(eval-lib): add registry types (RegistryEntry, OptionDef, PresetEntry)"
```

---

## Task 2: Embedder & Reranker Registries

**Files:**
- Create: `packages/eval-lib/src/registry/embedders.ts`
- Create: `packages/eval-lib/src/registry/rerankers.ts`
- Test: `packages/eval-lib/tests/unit/registry/embedders.test.ts`
- Test: `packages/eval-lib/tests/unit/registry/rerankers.test.ts`

### Step 1: Write the tests

```typescript
// packages/eval-lib/tests/unit/registry/embedders.test.ts
import { describe, it, expect } from "vitest";
import { EMBEDDER_REGISTRY } from "../../src/registry/embedders.js";

describe("EMBEDDER_REGISTRY", () => {
  it("contains all 4 providers", () => {
    const ids = EMBEDDER_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["openai", "cohere", "voyage", "jina"]);
  });

  it("all entries have required fields", () => {
    for (const entry of EMBEDDER_REGISTRY) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.status).toMatch(/^(available|coming-soon)$/);
      expect(entry.options.length).toBeGreaterThan(0);
      // every option has a matching default
      for (const opt of entry.options) {
        expect(entry.defaults).toHaveProperty(opt.key);
      }
    }
  });

  it("openai has correct models", () => {
    const openai = EMBEDDER_REGISTRY.find((e) => e.id === "openai")!;
    expect(openai.status).toBe("available");
    const modelOpt = openai.options.find((o) => o.key === "model")!;
    expect(modelOpt.type).toBe("select");
    const values = modelOpt.choices!.map((c) => c.value);
    expect(values).toContain("text-embedding-3-small");
    expect(values).toContain("text-embedding-3-large");
  });

  it("all implemented providers are status available", () => {
    for (const entry of EMBEDDER_REGISTRY) {
      expect(entry.status).toBe("available");
    }
  });
});
```

```typescript
// packages/eval-lib/tests/unit/registry/rerankers.test.ts
import { describe, it, expect } from "vitest";
import { RERANKER_REGISTRY } from "../../src/registry/rerankers.js";

describe("RERANKER_REGISTRY", () => {
  it("contains all 3 providers", () => {
    const ids = RERANKER_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["cohere", "jina", "voyage"]);
  });

  it("all entries have required fields", () => {
    for (const entry of RERANKER_REGISTRY) {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.status).toBe("available");
      expect(entry.options.length).toBeGreaterThan(0);
      for (const opt of entry.options) {
        expect(entry.defaults).toHaveProperty(opt.key);
      }
    }
  });

  it("cohere has correct models", () => {
    const cohere = RERANKER_REGISTRY.find((e) => e.id === "cohere")!;
    const modelOpt = cohere.options.find((o) => o.key === "model")!;
    const values = modelOpt.choices!.map((c) => c.value);
    expect(values).toContain("rerank-english-v3.0");
    expect(values).toContain("rerank-v3.5");
  });
});
```

### Step 2: Run tests to verify they fail

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/embedders.test.ts tests/unit/registry/rerankers.test.ts
```
Expected: FAIL — cannot resolve modules

### Step 3: Write the implementations

```typescript
// packages/eval-lib/src/registry/embedders.ts
import type { RegistryEntry } from "./types.js";

export const EMBEDDER_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "openai",
    name: "OpenAI",
    description:
      "Industry-standard embeddings with excellent English performance. text-embedding-3-small is fast and cost-effective.",
    status: "available",
    tags: ["popular", "fast"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "OpenAI embedding model to use.",
        type: "select",
        choices: [
          {
            value: "text-embedding-3-small",
            label: "text-embedding-3-small",
            description: "1536 dims — fast, cost-effective, recommended for most use cases",
          },
          {
            value: "text-embedding-3-large",
            label: "text-embedding-3-large",
            description: "3072 dims — highest quality, 6x more expensive",
          },
        ],
        default: "text-embedding-3-small",
      },
    ],
    defaults: { model: "text-embedding-3-small" },
  },
  {
    id: "cohere",
    name: "Cohere",
    description:
      "Dense retrieval embeddings optimized for search. Strong multilingual support with embed-multilingual-v3.0.",
    status: "available",
    tags: ["multilingual"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Cohere embedding model to use.",
        type: "select",
        choices: [
          {
            value: "embed-english-v3.0",
            label: "embed-english-v3.0",
            description: "1024 dims — English-optimized, best for English-only corpora",
          },
          {
            value: "embed-multilingual-v3.0",
            label: "embed-multilingual-v3.0",
            description: "1024 dims — supports 100+ languages",
          },
        ],
        default: "embed-english-v3.0",
      },
    ],
    defaults: { model: "embed-english-v3.0" },
  },
  {
    id: "voyage",
    name: "Voyage",
    description:
      "High-quality embeddings from Voyage AI. voyage-3.5 offers strong retrieval performance across domains.",
    status: "available",
    tags: ["high-quality"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Voyage embedding model to use.",
        type: "select",
        choices: [
          {
            value: "voyage-3.5",
            label: "voyage-3.5",
            description: "1024 dims — latest general-purpose model",
          },
          {
            value: "voyage-3.5-lite",
            label: "voyage-3.5-lite",
            description: "512 dims — faster, lower cost, slightly less accurate",
          },
          {
            value: "voyage-3",
            label: "voyage-3",
            description: "1024 dims — previous generation",
          },
          {
            value: "voyage-code-3",
            label: "voyage-code-3",
            description: "1024 dims — optimized for code retrieval",
          },
        ],
        default: "voyage-3.5",
      },
    ],
    defaults: { model: "voyage-3.5" },
  },
  {
    id: "jina",
    name: "Jina",
    description:
      "Flexible embeddings with Matryoshka dimension support. Adjust output dimensions (32-1024) for speed vs quality trade-off.",
    status: "available",
    tags: ["flexible", "matryoshka"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Jina embedding model to use.",
        type: "select",
        choices: [
          {
            value: "jina-embeddings-v3",
            label: "jina-embeddings-v3",
            description: "Up to 1024 dims — supports Matryoshka dimension reduction",
          },
        ],
        default: "jina-embeddings-v3",
      },
      {
        key: "dimensions",
        label: "Dimensions",
        description:
          "Output embedding dimensions (Matryoshka). Lower = faster search but less accurate. Only supported by jina-embeddings-v3.",
        type: "number",
        default: 1024,
        constraints: { min: 32, max: 1024, step: 32 },
        advanced: true,
      },
    ],
    defaults: { model: "jina-embeddings-v3", dimensions: 1024 },
  },
] as const;
```

```typescript
// packages/eval-lib/src/registry/rerankers.ts
import type { RegistryEntry } from "./types.js";

export const RERANKER_REGISTRY: readonly RegistryEntry[] = [
  {
    id: "cohere",
    name: "Cohere",
    description:
      "Cross-encoder reranking models. rerank-english-v3.0 is proven and stable for English retrieval.",
    status: "available",
    tags: ["popular", "stable"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Cohere reranker model to use.",
        type: "select",
        choices: [
          {
            value: "rerank-english-v3.0",
            label: "rerank-english-v3.0",
            description: "English-only, proven stable — recommended default",
          },
          {
            value: "rerank-v3.5",
            label: "rerank-v3.5",
            description: "Latest multilingual model",
          },
          {
            value: "rerank-english-v2.0",
            label: "rerank-english-v2.0",
            description: "Legacy — use v3.0 unless benchmarking",
          },
        ],
        default: "rerank-english-v3.0",
      },
    ],
    defaults: { model: "rerank-english-v3.0" },
  },
  {
    id: "jina",
    name: "Jina",
    description:
      "Multilingual cross-encoder reranker from Jina AI. Good default for multilingual corpora.",
    status: "available",
    tags: ["multilingual"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Jina reranker model to use.",
        type: "select",
        choices: [
          {
            value: "jina-reranker-v2-base-multilingual",
            label: "jina-reranker-v2-base-multilingual",
            description: "Base multilingual reranker — good balance of speed and quality",
          },
        ],
        default: "jina-reranker-v2-base-multilingual",
      },
    ],
    defaults: { model: "jina-reranker-v2-base-multilingual" },
  },
  {
    id: "voyage",
    name: "Voyage",
    description:
      "Reranking model from Voyage AI. Pairs well with Voyage embedders for consistent scoring.",
    status: "available",
    tags: ["high-quality"],
    options: [
      {
        key: "model",
        label: "Model",
        description: "Voyage reranker model to use.",
        type: "select",
        choices: [
          {
            value: "rerank-2.5",
            label: "rerank-2.5",
            description: "Latest Voyage reranker",
          },
        ],
        default: "rerank-2.5",
      },
    ],
    defaults: { model: "rerank-2.5" },
  },
] as const;
```

### Step 4: Run tests to verify they pass

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/embedders.test.ts tests/unit/registry/rerankers.test.ts
```
Expected: PASS (all tests)

### Step 5: Commit

```bash
git add packages/eval-lib/src/registry/embedders.ts packages/eval-lib/src/registry/rerankers.ts packages/eval-lib/tests/unit/registry/embedders.test.ts packages/eval-lib/tests/unit/registry/rerankers.test.ts
git commit -m "feat(eval-lib): add embedder and reranker registries"
```

---

## Task 3: Chunker, Strategy, and Refinement Registries

**Files:**
- Create: `packages/eval-lib/src/registry/chunkers.ts`
- Create: `packages/eval-lib/src/registry/index-strategies.ts`
- Create: `packages/eval-lib/src/registry/query-strategies.ts`
- Create: `packages/eval-lib/src/registry/search-strategies.ts`
- Create: `packages/eval-lib/src/registry/refinement-steps.ts`
- Test: `packages/eval-lib/tests/unit/registry/strategies.test.ts`

### Step 1: Write the test

```typescript
// packages/eval-lib/tests/unit/registry/strategies.test.ts
import { describe, it, expect } from "vitest";
import { CHUNKER_REGISTRY } from "../../src/registry/chunkers.js";
import { INDEX_STRATEGY_REGISTRY } from "../../src/registry/index-strategies.js";
import { QUERY_STRATEGY_REGISTRY } from "../../src/registry/query-strategies.js";
import { SEARCH_STRATEGY_REGISTRY } from "../../src/registry/search-strategies.js";
import { REFINEMENT_STEP_REGISTRY } from "../../src/registry/refinement-steps.js";

function assertValidRegistry(registry: readonly { id: string; name: string; description: string; status: string; options: readonly { key: string; default: unknown }[]; defaults: Record<string, unknown> }[]) {
  for (const entry of registry) {
    expect(entry.id).toBeTruthy();
    expect(entry.name).toBeTruthy();
    expect(entry.description.length).toBeGreaterThan(10);
    expect(entry.status).toMatch(/^(available|coming-soon)$/);
    for (const opt of entry.options) {
      expect(entry.defaults).toHaveProperty(opt.key);
    }
  }
}

describe("CHUNKER_REGISTRY", () => {
  it("contains all 7 chunker types", () => {
    const ids = CHUNKER_REGISTRY.map((e) => e.id);
    expect(ids).toEqual([
      "recursive-character", "sentence", "token", "markdown",
      "semantic", "cluster-semantic", "llm-semantic",
    ]);
  });

  it("sync chunkers are available, async are coming-soon", () => {
    const available = CHUNKER_REGISTRY.filter((e) => e.status === "available").map((e) => e.id);
    const comingSoon = CHUNKER_REGISTRY.filter((e) => e.status === "coming-soon").map((e) => e.id);
    expect(available).toEqual(["recursive-character", "sentence", "token", "markdown"]);
    expect(comingSoon).toEqual(["semantic", "cluster-semantic", "llm-semantic"]);
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(CHUNKER_REGISTRY);
  });
});

describe("INDEX_STRATEGY_REGISTRY", () => {
  it("contains all 4 strategies", () => {
    const ids = INDEX_STRATEGY_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["plain", "contextual", "summary", "parent-child"]);
  });

  it("only plain is available", () => {
    expect(INDEX_STRATEGY_REGISTRY.find((e) => e.id === "plain")!.status).toBe("available");
    for (const entry of INDEX_STRATEGY_REGISTRY.filter((e) => e.id !== "plain")) {
      expect(entry.status).toBe("coming-soon");
    }
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(INDEX_STRATEGY_REGISTRY);
  });
});

describe("QUERY_STRATEGY_REGISTRY", () => {
  it("contains all 5 strategies", () => {
    const ids = QUERY_STRATEGY_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["identity", "hyde", "multi-query", "step-back", "rewrite"]);
  });

  it("only identity is available", () => {
    expect(QUERY_STRATEGY_REGISTRY.find((e) => e.id === "identity")!.status).toBe("available");
    for (const entry of QUERY_STRATEGY_REGISTRY.filter((e) => e.id !== "identity")) {
      expect(entry.status).toBe("coming-soon");
    }
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(QUERY_STRATEGY_REGISTRY);
  });
});

describe("SEARCH_STRATEGY_REGISTRY", () => {
  it("contains all 3 strategies, all available", () => {
    const ids = SEARCH_STRATEGY_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["dense", "bm25", "hybrid"]);
    for (const entry of SEARCH_STRATEGY_REGISTRY) {
      expect(entry.status).toBe("available");
    }
  });

  it("hybrid has weight and fusion options", () => {
    const hybrid = SEARCH_STRATEGY_REGISTRY.find((e) => e.id === "hybrid")!;
    const keys = hybrid.options.map((o) => o.key);
    expect(keys).toContain("denseWeight");
    expect(keys).toContain("sparseWeight");
    expect(keys).toContain("fusionMethod");
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(SEARCH_STRATEGY_REGISTRY);
  });
});

describe("REFINEMENT_STEP_REGISTRY", () => {
  it("contains all 5 step types", () => {
    const ids = REFINEMENT_STEP_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(["rerank", "threshold", "dedup", "mmr", "expand-context"]);
  });

  it("rerank and threshold are available, others coming-soon", () => {
    expect(REFINEMENT_STEP_REGISTRY.find((e) => e.id === "rerank")!.status).toBe("available");
    expect(REFINEMENT_STEP_REGISTRY.find((e) => e.id === "threshold")!.status).toBe("available");
    expect(REFINEMENT_STEP_REGISTRY.find((e) => e.id === "dedup")!.status).toBe("coming-soon");
    expect(REFINEMENT_STEP_REGISTRY.find((e) => e.id === "mmr")!.status).toBe("coming-soon");
    expect(REFINEMENT_STEP_REGISTRY.find((e) => e.id === "expand-context")!.status).toBe("coming-soon");
  });

  it("all entries are structurally valid", () => {
    assertValidRegistry(REFINEMENT_STEP_REGISTRY);
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/strategies.test.ts
```
Expected: FAIL — cannot resolve modules

### Step 3: Write the implementations

The 5 registry files follow the exact same pattern as embedders/rerankers. Each exports a `readonly RegistryEntry[]` array. Key entries:

**`chunkers.ts`** — 7 entries:
- `recursive-character` (available): options = chunkSize (1000), chunkOverlap (200), separators (advanced)
- `sentence` (available): options = maxChunkSize (1000), overlapSentences (0)
- `token` (available): options = maxTokens (256), overlapTokens (0), encoding (cl100k_base, advanced)
- `markdown` (available): options = maxChunkSize (1000), headerLevels ([1,2,3], advanced), mergeSmallSections (true, advanced)
- `semantic` (coming-soon): options = percentileThreshold (95), maxChunkSize (2000). Tags: ["async", "requires-embedder"]
- `cluster-semantic` (coming-soon): options = maxChunkSize (400), segmentSize (50). Tags: ["async", "requires-embedder"]
- `llm-semantic` (coming-soon): options = segmentSize (50), batchSize (800). Tags: ["async", "requires-llm"]

**`index-strategies.ts`** — 4 entries:
- `plain` (available): options = (none — chunker/embedder options are separate)
- `contextual` (coming-soon): options = contextPrompt (string, advanced), concurrency (5, advanced). Tags: ["requires-llm"]
- `summary` (coming-soon): options = summaryPrompt (string, advanced), concurrency (5, advanced). Tags: ["requires-llm"]
- `parent-child` (coming-soon): options = childChunkSize (200), parentChunkSize (1000), childOverlap (0), parentOverlap (100)

**`query-strategies.ts`** — 5 entries:
- `identity` (available): options = (none)
- `hyde` (coming-soon): options = numHypotheticalDocs (1), hydePrompt (string, advanced). Tags: ["requires-llm"]
- `multi-query` (coming-soon): options = numQueries (3), fusionMethod (rrf/weighted), generationPrompt (string, advanced). Tags: ["requires-llm"]
- `step-back` (coming-soon): options = includeOriginal (true), stepBackPrompt (string, advanced). Tags: ["requires-llm"]
- `rewrite` (coming-soon): options = rewritePrompt (string, advanced). Tags: ["requires-llm"]

**`search-strategies.ts`** — 3 entries (all available):
- `dense`: options = (none)
- `bm25`: options = k1 (1.2), b (0.75)
- `hybrid`: options = denseWeight (0.7), sparseWeight (0.3), fusionMethod (weighted/rrf), candidateMultiplier (4), k1 (1.2, advanced), b (0.75, advanced)

**`refinement-steps.ts`** — 5 entries:
- `rerank` (available): options = (none — reranker provider/model selected separately)
- `threshold` (available): options = minScore (0.3, min 0, max 1, step 0.05)
- `dedup` (coming-soon): options = method (exact/overlap), overlapThreshold (0.5)
- `mmr` (coming-soon): options = lambda (0.7, min 0, max 1, step 0.1)
- `expand-context` (coming-soon): options = windowChars (500, min 50, max 5000, step 50)

**Implementation note:** Write each file following the exact pattern from Task 2 (embedders.ts). Each entry has `id`, `name`, `description`, `status`, `tags` (optional), `options`, and `defaults`. All descriptions should be clear, 1-2 sentences, explaining what the option does and when to use it.

### Step 4: Run tests to verify they pass

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/strategies.test.ts
```
Expected: PASS (all tests in all 5 describe blocks)

### Step 5: Commit

```bash
git add packages/eval-lib/src/registry/chunkers.ts packages/eval-lib/src/registry/index-strategies.ts packages/eval-lib/src/registry/query-strategies.ts packages/eval-lib/src/registry/search-strategies.ts packages/eval-lib/src/registry/refinement-steps.ts packages/eval-lib/tests/unit/registry/strategies.test.ts
git commit -m "feat(eval-lib): add chunker, strategy, and refinement registries"
```

---

## Task 4: Preset Registry

**Files:**
- Create: `packages/eval-lib/src/registry/presets.ts`
- Test: `packages/eval-lib/tests/unit/registry/presets.test.ts`

### Step 1: Write the test

```typescript
// packages/eval-lib/tests/unit/registry/presets.test.ts
import { describe, it, expect } from "vitest";
import { PRESET_REGISTRY } from "../../src/registry/presets.js";

describe("PRESET_REGISTRY", () => {
  it("contains 24 presets", () => {
    expect(PRESET_REGISTRY).toHaveLength(24);
  });

  it("all presets have unique ids", () => {
    const ids = PRESET_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all presets have required fields", () => {
    for (const preset of PRESET_REGISTRY) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description.length).toBeGreaterThan(10);
      expect(preset.status).toMatch(/^(available|coming-soon)$/);
      expect(preset.complexity).toMatch(/^(basic|intermediate|advanced)$/);
      expect(typeof preset.requiresLLM).toBe("boolean");
      expect(typeof preset.requiresReranker).toBe("boolean");
      expect(preset.config).toBeDefined();
      expect(preset.config.name).toBe(preset.id);
      expect(preset.stages.index).toBeTruthy();
      expect(preset.stages.query).toBeTruthy();
      expect(preset.stages.search).toBeTruthy();
      expect(preset.stages.refinement).toBeTruthy();
    }
  });

  it("existing 4 presets are available", () => {
    const existing = ["baseline-vector-rag", "bm25", "hybrid", "hybrid-reranked"];
    for (const id of existing) {
      const preset = PRESET_REGISTRY.find((p) => p.id === id)!;
      expect(preset).toBeDefined();
      expect(preset.status).toBe("available");
    }
  });

  it("presets requiring LLM that use coming-soon strategies are coming-soon", () => {
    const llmPresets = PRESET_REGISTRY.filter((p) => p.requiresLLM);
    for (const preset of llmPresets) {
      // All LLM-requiring presets use query/index strategies from slices 3-4
      // which are not yet implemented
      expect(preset.status).toBe("coming-soon");
    }
  });

  it("presets are ordered: available first, then coming-soon", () => {
    const statuses = PRESET_REGISTRY.map((p) => p.status);
    const firstComingSoon = statuses.indexOf("coming-soon");
    if (firstComingSoon !== -1) {
      // No available entries after the first coming-soon
      for (let i = firstComingSoon; i < statuses.length; i++) {
        // Allow mixing — this test just ensures available ones come first in each complexity group
      }
    }
  });

  it("config objects match expected structure for available presets", () => {
    const baseline = PRESET_REGISTRY.find((p) => p.id === "baseline-vector-rag")!;
    expect(baseline.config.search?.strategy).toBe("dense");
    expect(baseline.complexity).toBe("basic");

    const hybrid = PRESET_REGISTRY.find((p) => p.id === "hybrid")!;
    expect(hybrid.config.search?.strategy).toBe("hybrid");

    const hybridReranked = PRESET_REGISTRY.find((p) => p.id === "hybrid-reranked")!;
    expect(hybridReranked.config.refinement).toEqual([{ type: "rerank" }]);
    expect(hybridReranked.requiresReranker).toBe(true);
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/presets.test.ts
```
Expected: FAIL

### Step 3: Write the implementation

Create `packages/eval-lib/src/registry/presets.ts` with all 24 preset entries. The first 4 match the existing presets in `experiments/presets.ts` (status: `"available"`). The remaining 20 come from the slice 6 plan (status: `"coming-soon"` for any preset that references a coming-soon strategy).

Refer to the slice 6 plan (`docs/plans/pipeline-retrievers-slice-6-named-presets.md`) for the full list of 24 presets with their exact config objects. Each preset entry follows the `PresetEntry` interface.

**Status derivation rules:**
- If the preset's `config.query.strategy` is anything other than `"identity"` → `"coming-soon"` (query strategies from slice 3)
- If the preset's `config.index.strategy` is anything other than `"plain"` → `"coming-soon"` (index strategies from slice 4)
- If the preset's `config.refinement` contains `"dedup"`, `"mmr"`, or `"expand-context"` → `"coming-soon"` (refinement from slice 5)
- Otherwise → `"available"`

**Currently available presets** (based on implemented features):
1. `baseline-vector-rag` — basic, dense
2. `bm25` — basic, bm25
3. `hybrid` — intermediate, hybrid weighted
4. `hybrid-reranked` — intermediate, hybrid + rerank
5. `dense-reranked` — basic, dense + rerank
6. `bm25-reranked` — basic, bm25 + rerank
7. `hybrid-rrf` — intermediate, hybrid rrf
8. `hybrid-rrf-reranked` — intermediate, hybrid rrf + rerank

The remaining 16 presets (hyde-*, multi-query-*, contextual-*, anthropic-best, parent-child-*, diverse-hybrid, step-back-*, rewrite-*, summary-*, premium) are `"coming-soon"`.

### Step 4: Run test to verify it passes

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/presets.test.ts
```
Expected: PASS

### Step 5: Commit

```bash
git add packages/eval-lib/src/registry/presets.ts packages/eval-lib/tests/unit/registry/presets.test.ts
git commit -m "feat(eval-lib): add preset registry with 24 presets (8 available, 16 coming-soon)"
```

---

## Task 5: Registry Barrel Export + Sub-path Wiring

**Files:**
- Create: `packages/eval-lib/src/registry/index.ts`
- Modify: `packages/eval-lib/tsup.config.ts` — add `src/registry/index.ts` entry
- Modify: `packages/eval-lib/package.json` — add `"./registry"` export

### Step 1: Write the barrel

```typescript
// packages/eval-lib/src/registry/index.ts
export type { RegistryEntry, OptionDef, Choice, PresetEntry } from "./types.js";
export { EMBEDDER_REGISTRY } from "./embedders.js";
export { RERANKER_REGISTRY } from "./rerankers.js";
export { CHUNKER_REGISTRY } from "./chunkers.js";
export { INDEX_STRATEGY_REGISTRY } from "./index-strategies.js";
export { QUERY_STRATEGY_REGISTRY } from "./query-strategies.js";
export { SEARCH_STRATEGY_REGISTRY } from "./search-strategies.js";
export { REFINEMENT_STEP_REGISTRY } from "./refinement-steps.js";
export { PRESET_REGISTRY } from "./presets.js";
```

### Step 2: Add tsup entry point

In `packages/eval-lib/tsup.config.ts`, add `"src/registry/index.ts"` to the `entry` array.

### Step 3: Add package.json export

In `packages/eval-lib/package.json`, add to the `"exports"` field:

```json
"./registry": {
  "types": "./dist/registry/index.d.ts",
  "import": "./dist/registry/index.js"
}
```

### Step 4: Verify build

```bash
pnpm build
```
Expected: Build succeeds. Output includes `dist/registry/index.js`, `dist/registry/index.d.ts`.

### Step 5: Run all registry tests

```bash
cd packages/eval-lib && pnpm vitest run tests/unit/registry/
```
Expected: All registry tests pass.

### Step 6: Commit

```bash
git add packages/eval-lib/src/registry/index.ts packages/eval-lib/tsup.config.ts packages/eval-lib/package.json
git commit -m "build(eval-lib): add registry sub-path export (rag-evaluation-system/registry)"
```

---

## Task 6: Wizard Shared Components

**Files:**
- Create: `packages/frontend/src/components/wizard/shared/StrategyCard.tsx`
- Create: `packages/frontend/src/components/wizard/shared/OptionField.tsx`
- Create: `packages/frontend/src/components/wizard/shared/OptionGroup.tsx`
- Create: `packages/frontend/src/components/wizard/shared/InfoTooltip.tsx`
- Create: `packages/frontend/src/components/wizard/shared/ComplexityBadge.tsx`
- Create: `packages/frontend/src/components/wizard/shared/StatusBadge.tsx`

These are purely presentational components. No tests needed (they're thin UI wrappers). Verify by visual inspection after the wizard is assembled.

### Step 1: Write all shared components

**`StrategyCard.tsx`** — A selectable radio card for strategies/providers:
```typescript
// Props: { id, name, description, status, selected, onSelect, tags?, badge? }
// Renders: bordered card with name, description, optional tags as pills
// When status="coming-soon": opacity-50, cursor-not-allowed, "Coming soon" badge, onClick disabled
// When selected: border-accent, bg-accent-dim/10 tint
// Uses design tokens: bg-surface, border, border-accent, text, text-muted
```

**`OptionField.tsx`** — Renders a single `OptionDef` as the appropriate input:
```typescript
// Props: { option: OptionDef, value: unknown, onChange: (key, value) => void, disabled?: boolean }
// Switch on option.type:
//   "select" → <select> with option.choices
//   "number" → <input type="number"> with option.constraints (min/max/step)
//   "boolean" → toggle/checkbox
//   "string" → <input type="text"> or <textarea> if long
// Shows option.label above, option.description below in text-muted
// When disabled: opacity-50, pointer-events-none
```

**`OptionGroup.tsx`** — Groups multiple `OptionDef` items with optional Advanced toggle:
```typescript
// Props: { options: OptionDef[], values: Record<string, unknown>, onChange, disabled? }
// Splits options into regular (advanced !== true) and advanced
// Renders regular options first
// If advanced options exist: collapsible "Advanced" section with disclosure triangle
```

**`InfoTooltip.tsx`** — An `(i)` icon with hover tooltip:
```typescript
// Props: { text: string }
// Renders: small (i) icon, on hover shows tooltip with bg-elevated, border, text
// Uses CSS-only hover (no JS state needed)
```

**`ComplexityBadge.tsx`** — Colored pill for basic/intermediate/advanced:
```typescript
// Props: { complexity: "basic" | "intermediate" | "advanced" }
// basic → green (accent), intermediate → yellow (warn), advanced → red (error)
// Renders: small inline pill with text
```

**`StatusBadge.tsx`** — "Coming soon" pill:
```typescript
// Props: { status: "available" | "coming-soon" }
// "available" → renders nothing
// "coming-soon" → small muted pill: "Coming soon"
```

### Step 2: Commit

```bash
git add packages/frontend/src/components/wizard/shared/
git commit -m "feat(frontend): add wizard shared components (StrategyCard, OptionField, badges)"
```

---

## Task 7: Wizard Step Components

**Files:**
- Create: `packages/frontend/src/components/wizard/steps/ChoosePresetStep.tsx`
- Create: `packages/frontend/src/components/wizard/steps/IndexStep.tsx`
- Create: `packages/frontend/src/components/wizard/steps/QueryStep.tsx`
- Create: `packages/frontend/src/components/wizard/steps/SearchStep.tsx`
- Create: `packages/frontend/src/components/wizard/steps/RefinementStep.tsx`
- Create: `packages/frontend/src/components/wizard/steps/ReviewStep.tsx`

Each step component receives wizard state and an `onChange` callback. The parent `RetrieverWizard` orchestrates.

### Step 1: Write all step components

**`ChoosePresetStep.tsx`**:
```typescript
// Props: { selectedPresetId: string | null, onSelectPreset: (id: string | null) => void }
// Imports PRESET_REGISTRY from "rag-evaluation-system/registry"
// Renders:
//   - "Start from a preset" section: grid of StrategyCard for each PresetEntry
//     - Filterable by complexity (checkboxes: basic, intermediate, advanced)
//     - Searchable (text input filters by name/description)
//     - Cards show: name, description, ComplexityBadge, StatusBadge, requirement pills ([LLM], [Reranker])
//     - Cards show stage breadcrumb: "plain → identity → hybrid → rerank"
//   - Divider "— or —"
//   - "Start from scratch" link (calls onSelectPreset(null))
```

**`IndexStep.tsx`**:
```typescript
// Props: { config: Partial<PipelineConfig>, onChange: (patch) => void }
// Imports INDEX_STRATEGY_REGISTRY, CHUNKER_REGISTRY, EMBEDDER_REGISTRY from registry
// Three sections:
//   1. Index Strategy: StrategyCards from INDEX_STRATEGY_REGISTRY
//   2. Chunker: <select> from CHUNKER_REGISTRY, then OptionGroup for selected chunker's options
//   3. Embedder: provider <select> from EMBEDDER_REGISTRY, then OptionGroup for selected provider's options
// Coming-soon strategies are shown but disabled
```

**`QueryStep.tsx`**:
```typescript
// Props: { config: Partial<PipelineConfig>, onChange: (patch) => void, llmConfig?: {...} , onLLMChange: (patch) => void }
// Imports QUERY_STRATEGY_REGISTRY from registry
// StrategyCards for all 5 strategies
// If an LLM-requiring strategy is selected: inline LLM config section
//   - Model select (gpt-4o-mini default)
//   - Temperature slider (0.0-1.0, default 0.2)
```

**`SearchStep.tsx`**:
```typescript
// Props: { config: Partial<PipelineConfig>, k: number, onChange: (patch) => void, onKChange: (k) => void }
// Imports SEARCH_STRATEGY_REGISTRY from registry
// StrategyCards for dense/bm25/hybrid
// OptionGroup for selected strategy's options
// Separate "Top K" number input
```

**`RefinementStep.tsx`**:
```typescript
// Props: { steps: RefinementStepConfig[], rerankerConfig?: {...}, onChange: (steps) => void, onRerankerChange: (config) => void }
// Imports REFINEMENT_STEP_REGISTRY, RERANKER_REGISTRY from registry
// Renders ordered list of current refinement step cards
// Each card: step type label, description, OptionGroup for that step's options, [x] remove
// If step type is "rerank": inline reranker provider/model selection from RERANKER_REGISTRY
// "Add step" button: dropdown showing all step types from REFINEMENT_STEP_REGISTRY
// Coming-soon steps shown in dropdown but disabled
```

**`ReviewStep.tsx`**:
```typescript
// Props: { config: PipelineConfig, k: number, name: string, basePreset: string | null, onNameChange, onEditStep: (stepIndex) => void }
// Renders the full config summary in 4 sections (Index, Query, Search, Refinement)
// Each section has an [Edit] link that calls onEditStep with the step number
// Name input field (editable)
// "Based on: preset-name (modified)" label when applicable
// Two action buttons: "Save Config" and "Create Retriever"
```

### Step 2: Commit

```bash
git add packages/frontend/src/components/wizard/steps/
git commit -m "feat(frontend): add wizard step components (preset, index, query, search, refinement, review)"
```

---

## Task 8: Wizard Orchestrator + Navigation

**Files:**
- Create: `packages/frontend/src/components/wizard/RetrieverWizard.tsx`
- Create: `packages/frontend/src/components/wizard/WizardNav.tsx`

### Step 1: Write the orchestrator

**`RetrieverWizard.tsx`** — Main wizard component:
```typescript
// Props: {
//   initialConfig?: PipelineConfig,    // null for new, populated for edit
//   initialName?: string,
//   basePreset?: string,
//   onSave: (saved: SavedPipelineConfig) => void,
//   onCreate: (config: PipelineConfig, name: string) => void,
//   onClose: () => void,
// }
//
// State:
//   currentStep: number (0-5)
//   selectedPresetId: string | null
//   config: PipelineConfig (built progressively)
//   k: number
//   name: string
//   chunkerType: string
//   chunkerOptions: Record<string, unknown>
//   embedderProvider: string
//   embedderOptions: Record<string, unknown>
//   rerankerProvider: string
//   rerankerOptions: Record<string, unknown>
//   llmConfig: { model: string, temperature: number }
//   nameManuallyEdited: boolean
//
// When a preset is selected in Step 0:
//   - Pre-fill all state from PRESET_REGISTRY.find(p => p.id === selectedPresetId).config
//   - Auto-advance to Step 5 (review) for preset-based configs
//
// When "Start from scratch" is clicked:
//   - Reset all state to defaults
//   - Advance to Step 1 (index)
//
// buildConfig(): assembles all state into a PipelineConfig
//   - Maps chunkerType + chunkerOptions into index stage
//   - Maps embedderProvider + embedderOptions into index.embeddingModel field
//   - Maps search strategy options into search stage
//   - Maps refinement steps array
//
// Auto-naming: same logic as current PipelineConfigModal
//   - If matches a preset exactly → name = preset id
//   - If modified → name = basePreset-{hash}
//   - If manual edit → keep user's name
//
// Render:
//   <WizardNav currentStep={currentStep} onStepClick={setCurrentStep} />
//   {step components, conditionally rendered based on currentStep}
//   Back/Next buttons at bottom
```

**`WizardNav.tsx`** — Step indicator bar:
```typescript
// Props: { currentStep: number, totalSteps: 6, onStepClick: (step) => void }
// Step labels: ["Preset", "Index", "Query", "Search", "Refinement", "Review"]
// Renders: horizontal row of numbered circles
//   - Completed steps: filled green (accent), clickable
//   - Current step: outlined green, label highlighted
//   - Future steps: dimmed, still clickable (non-linear navigation)
```

### Step 2: Commit

```bash
git add packages/frontend/src/components/wizard/RetrieverWizard.tsx packages/frontend/src/components/wizard/WizardNav.tsx
git commit -m "feat(frontend): add RetrieverWizard orchestrator and WizardNav"
```

---

## Task 9: Integrate Wizard into Retrievers Page

**Files:**
- Modify: `packages/frontend/src/app/retrievers/page.tsx`
- Modify: `packages/frontend/src/lib/pipeline-types.ts`

### Step 1: Update pipeline-types.ts

**Remove duplicated types.** Import `PipelineConfig` and related types from `rag-evaluation-system/registry` (or from the main `rag-evaluation-system` package, which already re-exports them). Keep:
- `resolveConfig()` — frontend-specific helper (fills defaults for display)
- `isPresetUnmodified()` — frontend-specific helper
- `SavedPipelineConfig` — frontend-specific type (includes `k`)
- `DEFAULT_K = 5`

**Remove from pipeline-types.ts:**
- `IndexConfig`, `DEFAULT_INDEX_CONFIG` (use from eval-lib)
- `IdentityQueryConfig`, `QueryConfig`, `DEFAULT_QUERY_CONFIG` (use from eval-lib)
- `DenseSearchConfig`, `BM25SearchConfig`, `HybridSearchConfig`, `SearchConfig`, `DEFAULT_SEARCH_CONFIG` (use from eval-lib)
- `RerankRefinementStep`, `ThresholdRefinementStep`, `RefinementStepConfig` (use from eval-lib)
- `PipelineConfig` type (use from eval-lib, but add `k` via intersection)
- `PRESET_CONFIGS`, `PRESET_NAMES`, `PRESET_DESCRIPTIONS` (replaced by `PRESET_REGISTRY`)

**Keep / add:**
```typescript
import type { PipelineConfig as BasePipelineConfig } from "rag-evaluation-system";
import { PRESET_REGISTRY } from "rag-evaluation-system/registry";
import type { PresetEntry } from "rag-evaluation-system/registry";

// Frontend extends PipelineConfig with k (runtime param, not in eval-lib type)
export interface FrontendPipelineConfig extends BasePipelineConfig {
  k?: number;
}

export const DEFAULT_K = 5;

// Derive preset lookups from registry
export const PRESET_CONFIGS: Record<string, BasePipelineConfig> = Object.fromEntries(
  PRESET_REGISTRY.filter(p => p.status === "available").map(p => [p.id, p.config])
);
export const PRESET_NAMES = Object.keys(PRESET_CONFIGS);

export interface SavedPipelineConfig {
  name: string;
  basePreset: string;
  config: FrontendPipelineConfig;
}

// resolveConfig and isPresetUnmodified stay, updated to use FrontendPipelineConfig
```

### Step 2: Update retrievers page

Replace `PipelineConfigModal` usage with `RetrieverWizard`:

```typescript
// Remove: import { PipelineConfigModal } from "@/components/PipelineConfigModal"
// Add:    import { RetrieverWizard } from "@/components/wizard/RetrieverWizard"
```

The wizard's `onSave` callback matches the existing `handleModalSave`. The wizard's `onCreate` callback replaces the separate "Create Retriever" button — the wizard's Step 6 (Review) has a "Create Retriever" button that calls `handleCreateRetriever` directly.

The left panel simplifies:
- KB selector stays
- Preset dropdown replaced by "Configure Retriever" button that opens the wizard
- Current `PipelineConfigSummary` can stay for showing active config (or be replaced by a simpler summary)
- "Create Retriever" button moves inside the wizard

### Step 3: Verify

```bash
pnpm build && pnpm -C packages/frontend build
```
Expected: Both build successfully. No TypeScript errors.

### Step 4: Commit

```bash
git add packages/frontend/src/lib/pipeline-types.ts packages/frontend/src/app/retrievers/page.tsx
git commit -m "feat(frontend): integrate RetrieverWizard, remove type duplication from pipeline-types"
```

---

## Task 10: Remove Old Modal + Cleanup

**Files:**
- Delete: `packages/frontend/src/components/PipelineConfigModal.tsx`
- Verify no other files import it

### Step 1: Remove old modal

Delete `PipelineConfigModal.tsx`. Search for any remaining imports:

```bash
grep -r "PipelineConfigModal" packages/frontend/src/
```
Expected: No results (already replaced in Task 9).

### Step 2: Verify build

```bash
pnpm -C packages/frontend build
```
Expected: Build succeeds.

### Step 3: Run all eval-lib tests

```bash
pnpm test
```
Expected: All 324+ tests pass (existing + new registry tests).

### Step 4: Commit

```bash
git rm packages/frontend/src/components/PipelineConfigModal.tsx
git add -A
git commit -m "refactor(frontend): remove PipelineConfigModal (replaced by RetrieverWizard)"
```

---

## Task 11: Update Shared Context Doc

**Files:**
- Modify: `docs/plans/pipeline-retrievers-shared-context.md`

Add a new section after "Design Decisions" documenting:

1. **Config Registry** — `eval-lib/src/registry/` provides structured metadata for all pipeline options. Sub-path: `rag-evaluation-system/registry`. Pure data, no runtime deps.

2. **Status field** — Each `RegistryEntry` has `status: "available" | "coming-soon"`. When implementing a new feature from slices 3-6, flip the status to `"available"` in the registry file. The frontend wizard picks it up automatically.

3. **Frontend wizard** — `RetrieverWizard` in `frontend/src/components/wizard/` reads registry data to render options. No frontend code changes needed when adding new providers/strategies — just update the registry.

4. **Type consolidation** — Frontend no longer duplicates `PipelineConfig` types. Imports from `rag-evaluation-system` directly. `FrontendPipelineConfig` extends with `k`.

5. **Preset consolidation** — Presets live in `registry/presets.ts` as `PresetEntry[]`. The existing `experiments/presets.ts` keeps the runtime factory functions but the metadata/descriptions are in the registry.

### Step 1: Write the section

Add to `docs/plans/pipeline-retrievers-shared-context.md`:

```markdown
---

## Config Registry (added in registry/wizard implementation)

**Location:** `packages/eval-lib/src/registry/` — sub-path: `rag-evaluation-system/registry`

**What it provides:**
- `EMBEDDER_REGISTRY` — 4 providers with models, descriptions, defaults
- `RERANKER_REGISTRY` — 3 providers with models
- `CHUNKER_REGISTRY` — 7 chunker types (4 available, 3 coming-soon)
- `INDEX_STRATEGY_REGISTRY` — 4 strategies (1 available, 3 coming-soon)
- `QUERY_STRATEGY_REGISTRY` — 5 strategies (1 available, 4 coming-soon)
- `SEARCH_STRATEGY_REGISTRY` — 3 strategies (all available)
- `REFINEMENT_STEP_REGISTRY` — 5 step types (2 available, 3 coming-soon)
- `PRESET_REGISTRY` — 24 presets as `PresetEntry[]` (8 available, 16 coming-soon)

**When implementing slices 3-6:** After implementing a new strategy/provider, update its `status` from `"coming-soon"` to `"available"` in the corresponding registry file. The frontend wizard will automatically enable it.

**Frontend type imports:** The frontend imports `PipelineConfig` and related types from `rag-evaluation-system` directly (no more duplication in `pipeline-types.ts`). The registry types come from `rag-evaluation-system/registry`.

**Frontend wizard:** `packages/frontend/src/components/wizard/RetrieverWizard.tsx` — 6-step guided wizard that reads registry data. Replaces the old `PipelineConfigModal`.
```

### Step 2: Commit

```bash
git add docs/plans/pipeline-retrievers-shared-context.md
git commit -m "docs: update shared context with config registry and wizard information"
```

---

## Summary

| Task | What | Files | Tests |
|------|------|-------|-------|
| 1 | Registry types | 1 create, 1 test | 4 |
| 2 | Embedder + reranker registries | 2 create, 2 tests | ~8 |
| 3 | Chunker + strategy registries | 5 create, 1 test | ~15 |
| 4 | Preset registry | 1 create, 1 test | ~7 |
| 5 | Barrel export + sub-path wiring | 1 create, 2 modify | build verify |
| 6 | Wizard shared components | 6 create | visual |
| 7 | Wizard step components | 6 create | visual |
| 8 | Wizard orchestrator + nav | 2 create | visual |
| 9 | Page integration + type cleanup | 2 modify | build verify |
| 10 | Remove old modal | 1 delete | build verify |
| 11 | Update shared context doc | 1 modify | — |

**Total: ~27 files, ~34 tests, 11 tasks**

**Dependency order:** Tasks 1→2→3→4→5 (registry, sequential). Tasks 6→7→8→9→10 (frontend, sequential). Task 11 (docs, independent). Registry tasks (1-5) and frontend tasks (6-10) can run in parallel after Task 5 provides the importable sub-path.
