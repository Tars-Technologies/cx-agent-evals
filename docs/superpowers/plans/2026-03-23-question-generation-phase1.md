# Phase 1: Question Generation — Bug Fixes + Quick UI Wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 bugs (dimension discovery, tab-switching corruption, too-few-questions), unify the total questions slider across all strategies, and add dataset delete with confirmation modal.

**Architecture:** All strategies now use `totalQuestions` (not per-doc count). SimpleStrategy becomes a single corpus-wide Convex action matching dimension-driven and real-world patterns. Dataset delete has an experiment guard preventing orphaned references.

**Tech Stack:** TypeScript, Convex (backend), Next.js 16 App Router (frontend), eval-lib (rag-evaluation-system), Tailwind CSS v4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-question-generation-phase1-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/frontend/src/app/api/discover-dimensions/route.ts` | Next.js API route for dimension discovery |
| `packages/frontend/src/components/TotalQuestionsSlider.tsx` | Shared slider component (1–100 range) |
| `packages/frontend/src/components/DeleteDatasetModal.tsx` | Dataset delete confirmation modal |

### Modified Files
| File | Changes |
|------|---------|
| `packages/eval-lib/src/synthetic-datagen/strategies/types.ts` | `SimpleStrategyOptions.queriesPerDoc` → `totalQuestions` |
| `packages/eval-lib/src/synthetic-datagen/strategies/simple/generator.ts` | Use `totalQuestions`, trim over-generated results |
| `packages/eval-lib/tests/unit/synthetic-datagen/strategies/simple.test.ts` | Update tests for `totalQuestions` |
| `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/generator.ts` | Deficit fill after stratified sampling |
| `packages/backend/convex/generation/actions.ts` | Replace `generateForDocument` with `generateSimple` corpus-wide action |
| `packages/backend/convex/generation/orchestration.ts` | Remove per-doc branch for simple strategy |
| `packages/backend/convex/crud/datasets.ts` | Add `deleteDataset` mutation with experiment guard |
| `packages/backend/convex/crud/questions.ts` | Add `deleteByDataset` internal mutation |
| `packages/frontend/src/components/GenerateConfig.tsx` | Replace per-strategy inputs with unified slider |
| `packages/frontend/src/app/generate/page.tsx` | Remove `questionsPerDoc` state, add delete modal state, trash icon on dataset items |
| `packages/frontend/src/lib/types.ts` | Remove `questionsPerDoc` from `GenerateConfig` and `UploadMetadata` |

---

## Task 1: Fix Dimension Discovery Bug (Bug #1)

**Files:**
- Create: `packages/frontend/src/app/api/discover-dimensions/route.ts`

- [ ] **Step 1: Create the API route**

Note: This route must use the default Node.js runtime (not Edge). The `rag-evaluation-system/llm` sub-path imports `openai` which requires Node.js.

```typescript
// packages/frontend/src/app/api/discover-dimensions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { discoverDimensions } from "rag-evaluation-system/pipeline/internals";
import { createLLMClient, getModel } from "rag-evaluation-system/llm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = body.url;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'url' field" },
        { status: 400 },
      );
    }

    const llmClient = createLLMClient();
    const model = getModel({});

    const dimensions = await discoverDimensions({
      url,
      llmClient,
      model,
    });

    return NextResponse.json({ dimensions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dimension discovery failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the import resolves**

Run: `cd packages/frontend && npx tsc --noEmit 2>&1 | grep discover-dimensions || echo "No type errors"`

Expected: No type errors for the new file. If the import fails, check `packages/eval-lib/package.json` exports for `./pipeline/internals` and ensure eval-lib is built (`pnpm build` from root).

- [ ] **Step 3: Manual test**

1. Run `pnpm dev` (frontend) and `pnpm dev:backend` (backend)
2. Navigate to Generate page, select a KB, choose Dimension-Driven strategy
3. Click "Set Up Dimensions" → enter a URL → click "Discover"
4. Verify dimensions appear (loading spinner should show for 5-15 seconds)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/api/discover-dimensions/route.ts
git commit -m "fix: add missing /api/discover-dimensions route for dimension wizard"
```

---

## Task 2: Unify SimpleStrategy to Use totalQuestions (eval-lib)

**Files:**
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/types.ts:23-27`
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/simple/generator.ts`
- Modify: `packages/eval-lib/tests/unit/synthetic-datagen/strategies/simple.test.ts`

- [ ] **Step 1: Update the type definition**

In `packages/eval-lib/src/synthetic-datagen/strategies/types.ts`, change:

```typescript
// BEFORE (line 23-27)
export interface SimpleStrategyOptions {
  readonly queriesPerDoc: number;
  /** Maximum characters of document content sent to the LLM. Default: 8000. */
  readonly maxDocumentChars?: number;
}

// AFTER
export interface SimpleStrategyOptions {
  readonly totalQuestions: number;
  /** Maximum characters of document content sent to the LLM. Default: 8000. */
  readonly maxDocumentChars?: number;
}
```

- [ ] **Step 2: Update the tests first (TDD)**

In `packages/eval-lib/tests/unit/synthetic-datagen/strategies/simple.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SimpleStrategy } from "../../../../src/synthetic-datagen/strategies/simple/generator.js";
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js";
import { createDocument, createCorpus } from "../../../../src/types/documents.js";

const doc = createDocument({
  id: "test.md",
  content: "RAG combines retrieval with generation.",
});
const corpus = createCorpus([doc]);

describe("SimpleStrategy", () => {
  it("should generate the requested total number of questions", async () => {
    const llm: LLMClient = {
      name: "MockLLM",
      async complete() {
        return JSON.stringify({
          questions: ["What does RAG combine?", "How does RAG work?"],
        });
      },
    };

    const strategy = new SimpleStrategy({ totalQuestions: 2 });
    const results = await strategy.generate({
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(2);
    expect(results[0].query).toBe("What does RAG combine?");
    expect(results[0].targetDocId).toBe("test.md");
    expect(results[0].metadata.strategy).toBe("simple");
  });

  it("should distribute questions across multiple documents", async () => {
    const doc2 = createDocument({ id: "doc2.md", content: "Embeddings map text to vectors." });
    const multiCorpus = createCorpus([doc, doc2]);

    const llm: LLMClient = {
      name: "MockLLM",
      async complete() {
        return JSON.stringify({ questions: ["Q1", "Q2"] });
      },
    };

    // 3 total across 2 docs = ceil(3/2) = 2 per doc, trimmed to 3
    const strategy = new SimpleStrategy({ totalQuestions: 3 });
    const results = await strategy.generate({
      corpus: multiCorpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(3);
    // Both docs should be represented
    const docIds = new Set(results.map((r) => r.targetDocId));
    expect(docIds.size).toBe(2);
  });

  it("should trim to exactly totalQuestions when over-generated", async () => {
    const doc2 = createDocument({ id: "doc2.md", content: "Embeddings map text to vectors." });
    const multiCorpus = createCorpus([doc, doc2]);

    const llm: LLMClient = {
      name: "MockLLM",
      async complete() {
        // Returns 3 questions per call, but we only want 2 total
        return JSON.stringify({ questions: ["Q1", "Q2", "Q3"] });
      },
    };

    const strategy = new SimpleStrategy({ totalQuestions: 2 });
    const results = await strategy.generate({
      corpus: multiCorpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/eval-lib && pnpm test -- --run tests/unit/synthetic-datagen/strategies/simple.test.ts`

Expected: FAIL — `SimpleStrategy` still expects `queriesPerDoc`

- [ ] **Step 4: Update SimpleStrategy implementation**

In `packages/eval-lib/src/synthetic-datagen/strategies/simple/generator.ts`:

```typescript
import type {
  QuestionStrategy,
  StrategyContext,
  GeneratedQuery,
  SimpleStrategyOptions,
} from "../types.js";
import { safeParseLLMResponse } from "../../../utils/json.js";

const SYSTEM_PROMPT = `You are an expert at generating evaluation questions for RAG (Retrieval-Augmented Generation) systems.

Your task: Given document content, generate diverse, high-quality questions that would require retrieving this document to answer.

QUESTION QUALITY REQUIREMENTS:
- Each question must be answerable from the provided document content
- Questions must require actual retrieval — avoid questions answerable from a title alone
- Do NOT copy-paste or trivially rephrase sentences from the document
- Use natural language a real user would type or say
- Vary question structure across these types:
  • Factoid: "What is the default timeout for X?"
  • Comparison: "How does X differ from Y?"
  • Procedural: "How do I configure X for Y?"
  • Conditional: "Under what conditions does X happen?"
  • Multi-hop: Questions requiring information from multiple parts of the document
  • Yes/No: "Does X support Y?"

DO NOT:
- Ask about the document itself ("What does this document describe?")
- Generate questions that are trivially similar to each other
- Use overly formal or robotic phrasing
- Ask about information not present in the document

EXAMPLES OF GOOD QUESTIONS:
- "What happens if a Kubernetes pod exceeds its memory limit?"
- "How do I migrate from API v1 to v2?"
- "Can I use SSO with the free tier?"

EXAMPLES OF BAD QUESTIONS:
- "What is mentioned in the document about pods?" (meta-question)
- "Describe Kubernetes pods." (not a retrieval question)
- "What are the smallest deployable units?" (trivial rephrasing)

Output JSON format:
{
  "questions": ["question 1", "question 2", ...]
}`;

export class SimpleStrategy implements QuestionStrategy {
  readonly name = "simple";
  private _options: SimpleStrategyOptions;

  constructor(options: SimpleStrategyOptions) {
    this._options = options;
  }

  async generate(context: StrategyContext): Promise<GeneratedQuery[]> {
    const results: GeneratedQuery[] = [];
    const maxChars = this._options.maxDocumentChars ?? 8000;
    const numDocs = context.corpus.documents.length;
    const perDoc = Math.ceil(this._options.totalQuestions / numDocs);

    for (const doc of context.corpus.documents) {
      if (doc.content.length > maxChars) {
        console.warn(`Document "${String(doc.id)}" truncated from ${doc.content.length} to ${maxChars} chars`);
      }
      const docContent = doc.content.substring(0, maxChars);
      const prompt = `Document:\n${docContent}\n\nGenerate ${perDoc} diverse questions following the requirements above.`;

      const response = await context.llmClient.complete({
        model: context.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        responseFormat: "json",
      });

      const data = safeParseLLMResponse(response, { questions: [] as string[] });
      const questions: string[] = data.questions ?? [];

      for (const question of questions) {
        results.push({
          query: question,
          targetDocId: String(doc.id),
          metadata: { strategy: "simple" },
        });
      }
    }

    // Trim to exactly totalQuestions if over-generated due to ceil rounding
    return results.slice(0, this._options.totalQuestions);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/eval-lib && pnpm test -- --run tests/unit/synthetic-datagen/strategies/simple.test.ts`

Expected: All 3 tests PASS

- [ ] **Step 6: Run full eval-lib test suite to check nothing else broke**

Run: `cd packages/eval-lib && pnpm test -- --run`

Expected: All tests pass. If any tests reference `queriesPerDoc`, update them.

- [ ] **Step 7: Rebuild eval-lib**

Run: `pnpm build`

Expected: Clean build, no errors

- [ ] **Step 8: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/strategies/types.ts \
       packages/eval-lib/src/synthetic-datagen/strategies/simple/generator.ts \
       packages/eval-lib/tests/unit/synthetic-datagen/strategies/simple.test.ts
git commit -m "feat(eval-lib): SimpleStrategy uses totalQuestions instead of queriesPerDoc"
```

---

## Task 3: Update Backend — SimpleStrategy Becomes Corpus-Wide Action

**Files:**
- Modify: `packages/backend/convex/generation/actions.ts:35-78`
- Modify: `packages/backend/convex/generation/orchestration.ts:74-112`

- [ ] **Step 1: Replace `generateForDocument` with `generateSimple` in actions.ts**

In `packages/backend/convex/generation/actions.ts`, replace the `generateForDocument` action (lines 35-78) with:

```typescript
// ─── Whole-Corpus Generation (Simple Strategy) ───

export const generateSimple = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    strategyConfig: v.any(),
  },
  handler: async (ctx, args) => {
    const config = args.strategyConfig as Record<string, unknown>;
    const totalQuestions = (config.totalQuestions as number) ?? 30;
    const model = getModel(config);
    const llmClient = createLLMClient();

    const { corpus } = await loadCorpusFromKb(ctx, args.kbId);

    const strategy = new SimpleStrategy({ totalQuestions });
    const queries = await strategy.generate({ corpus, llmClient, model });

    if (queries.length > 0) {
      for (let i = 0; i < queries.length; i += QUESTION_INSERT_BATCH_SIZE) {
        const batch = queries.slice(i, i + QUESTION_INSERT_BATCH_SIZE);
        await ctx.runMutation(internal.crud.questions.insertBatch, {
          datasetId: args.datasetId,
          questions: batch.map((q, idx) => ({
            queryId: `simple_q${i + idx}`,
            queryText: q.query,
            sourceDocId: q.targetDocId,
            relevantSpans: [],
            metadata: q.metadata,
          })),
        });
      }
    }

    return { questionsGenerated: queries.length };
  },
});
```

- [ ] **Step 2: Update orchestration to use corpus-wide action for simple**

In `packages/backend/convex/generation/orchestration.ts`, replace the `isPerDoc` logic (lines 73-112). Change:

```typescript
// BEFORE (lines 73-112)
    const isPerDoc = args.strategy === "simple";
    const totalItems = isPerDoc ? docs.length : 1;
    // ... per-doc loop ...
    if (isPerDoc) {
      for (const doc of docs) {
        // ... generateForDocument per doc ...
      }
    } else if (args.strategy === "dimension-driven") {
```

To:

```typescript
    // All strategies are now corpus-wide (single action)
    const totalItems = 1;

    // ... jobId creation stays the same ...

    const workIds: WorkId[] = [];

    if (args.strategy === "simple") {
      const wId = await pool.enqueueAction(
        ctx,
        internal.generation.actions.generateSimple,
        {
          datasetId,
          kbId: args.kbId,
          strategyConfig: args.strategyConfig,
        },
        {
          context: { jobId, itemKey: "corpus" },
          onComplete: internal.generation.orchestration.onQuestionGenerated,
        },
      );
      workIds.push(wId);
    } else if (args.strategy === "dimension-driven") {
```

Note: The `totalItems` is now always `1` — remove the `isPerDoc` variable entirely.

- [ ] **Step 3: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`

Expected: Deployment succeeds. Verify no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/generation/actions.ts \
       packages/backend/convex/generation/orchestration.ts
git commit -m "feat(backend): simple strategy uses corpus-wide action with totalQuestions"
```

---

## Task 4: Unified Total Questions Slider (Frontend)

**Files:**
- Create: `packages/frontend/src/components/TotalQuestionsSlider.tsx`
- Modify: `packages/frontend/src/components/GenerateConfig.tsx`
- Modify: `packages/frontend/src/app/generate/page.tsx`
- Modify: `packages/frontend/src/lib/types.ts`

- [ ] **Step 1: Create TotalQuestionsSlider component**

```typescript
// packages/frontend/src/components/TotalQuestionsSlider.tsx
"use client";

import type { StrategyType } from "@/lib/types";

const HELPER_TEXT: Record<StrategyType, (numDocs: number, total: number) => string> = {
  simple: (numDocs, total) => {
    const perDoc = Math.ceil(total / numDocs);
    return `Distributed equally across ${numDocs} document${numDocs !== 1 ? "s" : ""} (~${perDoc}/doc)`;
  },
  "dimension-driven": () =>
    "Distributed via stratified sampling across dimension combos",
  "real-world-grounded": () =>
    "Direct matches + synthetic generation to fill remaining",
};

export function TotalQuestionsSlider({
  value,
  onChange,
  strategy,
  numDocs,
}: {
  value: number;
  onChange: (n: number) => void;
  strategy: StrategyType;
  numDocs: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-[11px] text-text-muted uppercase tracking-wider">
          Total questions to generate
        </label>
        <span className="text-lg font-semibold text-accent tabular-nums">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={100}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-1 bg-bg-surface rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                   [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:border-2
                   [&::-webkit-slider-thumb]:border-bg-elevated
                   [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(110,231,183,0.3)]"
      />
      <div className="flex justify-between text-[9px] text-text-dim mt-0.5">
        <span>1</span>
        <span>100</span>
      </div>
      <p className="text-[10px] text-text-dim mt-1.5">
        {HELPER_TEXT[strategy](numDocs, value)}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Update GenerateConfig to use the slider**

Replace the entire content of `packages/frontend/src/components/GenerateConfig.tsx`:

```typescript
"use client";

import { StrategyType, Dimension } from "@/lib/types";
import { StrategySelector } from "./StrategySelector";
import { DimensionSummary } from "./DimensionSummary";
import { TotalQuestionsSlider } from "./TotalQuestionsSlider";

export function GenerateConfig({
  onGenerate,
  disabled,
  generating,
  strategy,
  onStrategyChange,
  dimensions,
  totalQuestions,
  onTotalQuestionsChange,
  onOpenWizard,
  realWorldQuestions,
  onOpenRealWorldModal,
  numDocs,
}: {
  onGenerate: () => void;
  disabled: boolean;
  generating: boolean;
  strategy: StrategyType;
  onStrategyChange: (strategy: StrategyType) => void;
  dimensions: Dimension[];
  totalQuestions: number;
  onTotalQuestionsChange: (n: number) => void;
  onOpenWizard: () => void;
  realWorldQuestions: string[];
  onOpenRealWorldModal: () => void;
  numDocs: number;
}) {
  const dimensionsConfigured = dimensions.length > 0;
  const realWorldConfigured = realWorldQuestions.length > 0;
  const canGenerate =
    strategy === "simple" ||
    (strategy === "dimension-driven" && dimensionsConfigured) ||
    (strategy === "real-world-grounded" && realWorldConfigured);

  return (
    <div className="animate-fade-in">
      <div className="space-y-4">
        <StrategySelector value={strategy} onChange={onStrategyChange} />

        <div className="border-t border-border pt-3 space-y-3">
          {/* Unified slider for all strategies */}
          <TotalQuestionsSlider
            value={totalQuestions}
            onChange={onTotalQuestionsChange}
            strategy={strategy}
            numDocs={numDocs}
          />

          {/* Strategy-specific config (dimensions setup, real-world questions) */}
          {strategy === "dimension-driven" && (
            <div>
              {dimensionsConfigured ? (
                <DimensionSummary
                  dimensions={dimensions}
                  totalQuestions={totalQuestions}
                  onEdit={onOpenWizard}
                />
              ) : (
                <button
                  onClick={onOpenWizard}
                  className="w-full py-2.5 rounded border border-dashed border-accent/30 text-xs text-accent
                             hover:bg-accent/5 hover:border-accent/50 transition-all cursor-pointer"
                >
                  Set Up Dimensions
                </button>
              )}
            </div>
          )}

          {strategy === "real-world-grounded" && (
            <div>
              {realWorldConfigured ? (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-text">
                    {realWorldQuestions.length} question{realWorldQuestions.length !== 1 ? "s" : ""} loaded
                  </span>
                  <button
                    onClick={onOpenRealWorldModal}
                    className="text-[10px] text-accent hover:text-accent/80 transition-colors cursor-pointer"
                  >
                    Edit
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenRealWorldModal}
                  className="w-full py-2.5 rounded border border-dashed border-accent/30 text-xs text-accent
                             hover:bg-accent/5 hover:border-accent/50 transition-all cursor-pointer"
                >
                  Set Up Questions
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onGenerate}
        disabled={disabled || generating || !canGenerate}
        className={`mt-5 w-full py-3 rounded-lg font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
          !(disabled || generating || !canGenerate)
            ? "bg-accent hover:bg-accent/90 text-bg-elevated cursor-pointer"
            : "bg-border text-text-dim cursor-not-allowed"
        }`}
      >
        {generating ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
            Generating...
          </span>
        ) : (
          "Generate Questions"
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Update page.tsx — remove questionsPerDoc, unify state**

In `packages/frontend/src/app/generate/page.tsx`, apply these changes:

1. Remove `settings` state and `GenerateSettings` import (lines 10, 88-90)
2. The `totalQuestions` state (line 95) becomes the unified value — change default from `50` to `30`
3. Remove `totalSyntheticQuestions` state (line 99) — real-world now shares `totalQuestions`
4. Update `handleGenerate` (lines 199-231):
   - Simple config becomes `{ totalQuestions }`
   - Dimension-driven stays `{ dimensions, totalQuestions }`
   - Real-world: change `totalSyntheticQuestions` to `totalQuestions`
5. Update `GenerateConfig` JSX call — remove these props: `settings`, `onChange`, `totalSyntheticQuestions`, `onTotalSyntheticChange`. Add these props: `onTotalQuestionsChange={setTotalQuestions}`, `numDocs={documentsData?.length ?? 0}`. The `totalQuestions` prop is already passed.

Key changes in `handleGenerate`:

```typescript
    if (strategy === "simple") {
      strategyConfig.totalQuestions = totalQuestions;
    } else if (strategy === "dimension-driven") {
      strategyConfig.dimensions = dimensions;
      strategyConfig.totalQuestions = totalQuestions;
    } else if (strategy === "real-world-grounded") {
      strategyConfig.questions = realWorldQuestions;
      strategyConfig.totalSyntheticQuestions = totalQuestions;
    }
```

- [ ] **Step 4: Update types.ts — remove questionsPerDoc**

In `packages/frontend/src/lib/types.ts`:

- Remove `questionsPerDoc` from `GenerateConfig` interface (line 31)
- Remove `questionsPerDoc` from `UploadMetadata` interface (line 44)

- [ ] **Step 5: Verify frontend compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/TotalQuestionsSlider.tsx \
       packages/frontend/src/components/GenerateConfig.tsx \
       packages/frontend/src/app/generate/page.tsx \
       packages/frontend/src/lib/types.ts
git commit -m "feat(frontend): unified total questions slider for all strategies"
```

---

## Task 5: Fix Dimension-Driven Too Few Questions (Bug #10)

**Files:**
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/generator.ts:73-84`

- [ ] **Step 1: Add deficit fill after stratified sampling**

In `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/generator.ts`, after the `stratifiedSample` call and the `byDoc` grouping (around line 84), add deficit fill logic:

```typescript
    const sampled = stratifiedSample(
      matrix.assignments,
      this._options.totalQuestions,
    );

    // ── Deficit fill: if sampling produced fewer than requested, fill with unscoped questions ──
    const deficit = this._options.totalQuestions - sampled.length;
    if (deficit > 0) {
      console.warn(
        `Dimension-driven pipeline: stratified sample produced ${sampled.length}/${this._options.totalQuestions}. ` +
        `Filling ${deficit} with unscoped questions.`
      );
    }

    // Group sampled assignments by document
    const byDoc = new Map<string, DocComboAssignment[]>();
    for (const assignment of sampled) {
      const list = byDoc.get(assignment.docId) || [];
      list.push(assignment);
      byDoc.set(assignment.docId, list);
    }

    const results: GeneratedQuery[] = [];
    const docEntries = [...byDoc.entries()];
    const docIndex = new Map(context.corpus.documents.map(d => [String(d.id), d]));

    // ... existing per-doc generation loop stays the same ...
```

Then, after the existing generation loop ends (after the closing `}` of the `for` loop), add the deficit fill:

```typescript
    // ── Generate deficit fill questions (no specific profiles) ──
    if (deficit > 0) {
      // Distribute deficit across all documents proportionally
      const allDocIds = context.corpus.documents.map(d => String(d.id));
      const deficitPerDoc = Math.ceil(deficit / allDocIds.length);

      for (let dIdx = 0; dIdx < allDocIds.length && results.length < this._options.totalQuestions; dIdx++) {
        const docId = allDocIds[dIdx];
        const doc = docIndex.get(docId);
        if (!doc) continue;

        const needed = Math.min(deficitPerDoc, this._options.totalQuestions - results.length);
        if (needed <= 0) break;

        this._onProgress({
          phase: "generating",
          docId,
          docIndex: dIdx,
          totalDocs: allDocIds.length,
          questionsForDoc: needed,
        });

        const maxChars = this._options.maxDocumentChars ?? 6000;
        const docContent = doc.content.substring(0, maxChars);

        const fillPrompt = `Document:\n${docContent}\n\nGenerate ${needed} diverse evaluation questions for a RAG system. Questions should be answerable from this document and sound natural.\n\nOutput JSON: { "questions": ["q1", "q2", ...] }`;

        const fillResponse = await context.llmClient.complete({
          model: context.model,
          messages: [
            { role: "system", content: BATCH_GENERATION_PROMPT },
            { role: "user", content: fillPrompt },
          ],
          responseFormat: "json",
        });

        const fillData = safeParseLLMResponse(fillResponse, { questions: [] as string[] });
        for (const q of (fillData.questions ?? [])) {
          if (results.length >= this._options.totalQuestions) break;
          results.push({
            query: q,
            targetDocId: docId,
            metadata: { strategy: "dimension-driven", mode: "deficit-fill" },
          });
        }
      }
    }

    // Final safety trim
    return results.slice(0, this._options.totalQuestions);
```

- [ ] **Step 2: Add funnel logging**

At the beginning of `generate()`, after each pipeline phase, add console.log for funnel metrics. Add after the `filterCombinations` call (note: `filterCombinations` doesn't expose the pre-filter count, so log post-filter only):

```typescript
    console.log(`[DimensionDriven] Funnel: ${validCombos.length} combos after filtering`);
```

After `buildRelevanceMatrix`:

```typescript
    console.log(`[DimensionDriven] Funnel: ${matrix.assignments.length} assignments from relevance matrix`);
```

After `stratifiedSample`:

```typescript
    console.log(`[DimensionDriven] Funnel: ${sampled.length} sampled (target: ${this._options.totalQuestions}), deficit: ${deficit}`);
```

- [ ] **Step 3: Run eval-lib tests**

Run: `cd packages/eval-lib && pnpm test -- --run`

Expected: All tests pass

- [ ] **Step 4: Rebuild eval-lib**

Run: `pnpm build`

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/generator.ts
git commit -m "fix(eval-lib): dimension-driven deficit fill ensures totalQuestions is always met"
```

---

## Task 6: Dataset Delete — Backend

**Files:**
- Modify: `packages/backend/convex/crud/datasets.ts`
- Modify: `packages/backend/convex/crud/questions.ts`

- [ ] **Step 1: Add deleteByDataset to questions.ts**

Add to the end of `packages/backend/convex/crud/questions.ts`:

```typescript
/**
 * Delete all questions belonging to a dataset.
 */
export const deleteByDataset = internalMutation({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();

    for (const q of questions) {
      await ctx.db.delete(q._id);
    }

    return { deleted: questions.length };
  },
});
```

- [ ] **Step 2: Add deleteDataset mutation to datasets.ts**

Add the necessary imports and mutation to `packages/backend/convex/crud/datasets.ts`:

```typescript
import { query, mutation, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ... existing code stays ...

/**
 * Delete a dataset and all its questions.
 * Guards against deletion if experiments reference this dataset.
 */
export const deleteDataset = mutation({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const dataset = await ctx.db.get(args.id);
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found");
    }

    // Guard: check for experiments referencing this dataset
    const experiments = await ctx.db
      .query("experiments")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.id))
      .collect();

    if (experiments.length > 0) {
      const names = experiments.map((e) => e.name).join(", ");
      throw new Error(
        `Cannot delete dataset — used by ${experiments.length} experiment(s): ${names}. Delete the experiments first.`
      );
    }

    // Cancel any running generation jobs for this dataset
    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.id))
      .collect();

    for (const job of jobs) {
      if (job.status === "running" || job.status === "pending") {
        await ctx.db.patch(job._id, { status: "canceled", completedAt: Date.now() });
      }
    }

    // Delete all questions in the dataset
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.id))
      .collect();

    for (const q of questions) {
      await ctx.db.delete(q._id);
    }

    // Delete the dataset record
    await ctx.db.delete(args.id);

    return { deleted: true, questionsRemoved: questions.length };
  },
});
```

Note: We inline the question deletion instead of calling `internal.crud.questions.deleteByDataset` because mutations cannot call other mutations via `ctx.runMutation`. We keep the `deleteByDataset` internal mutation available for actions that need it.

- [ ] **Step 3: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`

Expected: Deployment succeeds

- [ ] **Step 4: Run backend tests**

Run: `cd packages/backend && pnpm test`

Expected: All existing tests pass (the new mutation doesn't break anything)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/crud/datasets.ts \
       packages/backend/convex/crud/questions.ts
git commit -m "feat(backend): add deleteDataset mutation with experiment guard"
```

---

## Task 7: Dataset Delete — Frontend

**Files:**
- Create: `packages/frontend/src/components/DeleteDatasetModal.tsx`
- Modify: `packages/frontend/src/app/generate/page.tsx`

- [ ] **Step 1: Create DeleteDatasetModal component**

```typescript
// packages/frontend/src/components/DeleteDatasetModal.tsx
"use client";

import { useState } from "react";

interface DeleteDatasetModalProps {
  datasetName: string;
  questionCount: number;
  strategy: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteDatasetModal({
  datasetName,
  questionCount,
  strategy,
  onConfirm,
  onClose,
}: DeleteDatasetModalProps) {
  const [input, setInput] = useState("");
  const isConfirmed = input === "DELETE";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[420px] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-red-400">Delete Dataset</h3>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors cursor-pointer text-lg"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Impact summary */}
          <div className="bg-bg-surface border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Dataset:</span>
              <span className="text-xs text-text font-medium">{datasetName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Questions:</span>
              <span className="text-xs text-text">{questionCount} will be permanently deleted</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Strategy:</span>
              <span className="text-xs text-text">{strategy}</span>
            </div>
          </div>

          {/* Warning */}
          <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
            <p className="text-xs text-red-400">
              This action cannot be undone. All questions and their ground truth
              spans will be permanently removed.
            </p>
          </div>

          {/* Typed confirmation */}
          <div>
            <label className="text-xs text-text-dim block mb-1">
              Type{" "}
              <span className="text-text font-mono font-medium">DELETE</span>{" "}
              to confirm
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="DELETE"
              className="w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5
                         placeholder:text-text-dim focus:outline-none focus:border-red-400/50 transition-colors"
              autoFocus
            />
          </div>

          {/* Confirm button */}
          <button
            onClick={onConfirm}
            disabled={!isConfirmed}
            className="w-full py-2 text-sm rounded-lg font-medium bg-red-500 text-white
                       hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed
                       transition-colors cursor-pointer"
          >
            Delete Dataset
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add trash icon and delete modal to page.tsx**

In `packages/frontend/src/app/generate/page.tsx`:

1. Add imports:
```typescript
import { DeleteDatasetModal } from "@/components/DeleteDatasetModal";
```

2. Add state for delete:
```typescript
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"datasets">;
    name: string;
    questionCount: number;
    strategy: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteDataset = useMutation(api.crud.datasets.deleteDataset);
```

3. Add delete handler:
```typescript
  async function handleDeleteDataset() {
    if (!deleteTarget) return;
    try {
      await deleteDataset({ id: deleteTarget.id });
      setDeleteTarget(null);
      setDeleteError(null);
      // Clear browse selection if deleted dataset was selected
      if (browseDatasetId === deleteTarget.id) {
        setBrowseDatasetId(null);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete dataset");
    }
  }
```

4. In the dataset list (around line 336), wrap each dataset button in a `group` div and add the trash icon:
```typescript
  {kbDatasets.map((ds) => (
    <div key={ds._id} className="relative group">
      <button
        onClick={() => {
          setBrowseDatasetId(ds._id);
          setSelectedQuestion(null);
          setSelectedDocId(null);
        }}
        className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
          browseDatasetId === ds._id
            ? "bg-accent/10 border border-accent/30 text-text"
            : "hover:bg-bg-hover border border-transparent text-text-muted"
        }`}
      >
        <div className="font-medium truncate pr-6">{ds.name}</div>
        <div className="flex gap-2 text-[10px] text-text-dim mt-0.5">
          <span>{ds.questionCount} questions</span>
          <span>{ds.strategy}</span>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDeleteTarget({
            id: ds._id,
            name: ds.name,
            questionCount: ds.questionCount,
            strategy: ds.strategy,
          });
          setDeleteError(null);
        }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 transition-all p-1"
        title="Delete dataset"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
      </button>
    </div>
  ))}
```

5. Add the modal and error display at the end (before the closing `</div>`):
```typescript
      {/* Delete Dataset Modal */}
      {deleteTarget && (
        <DeleteDatasetModal
          datasetName={deleteTarget.name}
          questionCount={deleteTarget.questionCount}
          strategy={deleteTarget.strategy}
          onConfirm={handleDeleteDataset}
          onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
        />
      )}

      {/* Delete error toast */}
      {deleteError && (
        <div className="fixed bottom-4 right-4 z-[70] max-w-md bg-bg-elevated border border-red-500/30 rounded-lg p-3 shadow-2xl animate-fade-in">
          <p className="text-xs text-red-400">{deleteError}</p>
          <button
            onClick={() => setDeleteError(null)}
            className="text-[10px] text-text-dim mt-1 hover:text-text"
          >
            Dismiss
          </button>
        </div>
      )}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/DeleteDatasetModal.tsx \
       packages/frontend/src/app/generate/page.tsx
git commit -m "feat(frontend): dataset delete with trash icon and confirmation modal"
```

---

## Task 8: Investigate and Fix Tab-Switching Bug (Bug #8)

**Files:**
- Modify: `packages/backend/convex/crud/questions.ts` (likely)
- Modify: `packages/backend/convex/generation/actions.ts` (likely)

This task requires investigation before fixing. Follow the investigation plan from the spec.

- [ ] **Step 1: Check if corruption is in the database**

1. Start generation with dimension-driven or real-world strategy
2. While running, switch browser tabs, wait a few seconds, switch back
3. If corruption appears, open Convex dashboard and check the `questions` table
4. Look for records where `queryText` is a single character

- [ ] **Step 2: Check WorkPool retry behavior**

Read the WorkPool configuration in `orchestration.ts` line 17-24:

```typescript
const pool = new Workpool(components.generationPool, {
  maxParallelism: 10,
  retryActionsByDefault: true,    // <-- retries are ON
  defaultRetryBehavior: {
    maxAttempts: 5,               // <-- up to 5 retries
    initialBackoffMs: 2000,
    base: 2,
  },
});
```

Retries are enabled. If an action partially succeeds (inserts some questions) then fails and retries, the retry will insert duplicate questions. The `queryId` format (`dd_q0`, `dd_q1`...) doesn't guard against this — duplicates will be created with the same `queryId` but different `_id`.

- [ ] **Step 3: Add idempotency guard to insertBatch**

In `packages/backend/convex/crud/questions.ts`, modify `insertBatch` to skip duplicates:

```typescript
export const insertBatch = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    questions: v.array(
      v.object({
        queryId: v.string(),
        queryText: v.string(),
        sourceDocId: v.string(),
        relevantSpans: v.array(spanValidator),
        metadata: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Check for existing queryIds to prevent duplicate insertion on retry
    const existing = await ctx.db
      .query("questions")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.datasetId))
      .collect();
    const existingQueryIds = new Set(existing.map((q) => q.queryId));

    const ids = [];
    for (const q of args.questions) {
      if (existingQueryIds.has(q.queryId)) {
        continue; // Skip duplicate
      }
      const id = await ctx.db.insert("questions", {
        datasetId: args.datasetId,
        queryId: q.queryId,
        queryText: q.queryText,
        sourceDocId: q.sourceDocId,
        relevantSpans: q.relevantSpans,
        metadata: q.metadata ?? {},
      });
      ids.push(id);
    }
    return ids;
  },
});
```

- [ ] **Step 4: Deploy and test**

Run: `cd packages/backend && npx convex dev --once`

Then manually test: start generation, switch tabs, return, verify no corruption.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/crud/questions.ts
git commit -m "fix(backend): add idempotency guard to insertBatch preventing duplicate questions on retry"
```

---

## Task 9: Final Integration Test and Cleanup

- [ ] **Step 1: Build everything**

```bash
pnpm build
cd packages/backend && npx convex dev --once
```

- [ ] **Step 2: Run all test suites**

```bash
cd packages/eval-lib && pnpm test -- --run
cd ../backend && pnpm test
```

Expected: All tests pass

- [ ] **Step 3: Manual integration test**

1. Open the app, select a KB with documents
2. **Simple strategy**: Set slider to 15, generate, verify ~15 questions appear
3. **Dimension-driven**: Set up dimensions (via URL discover or manual), set slider to 20, generate, verify ~20 questions appear
4. **Real-world**: Upload questions, set slider to 10, generate, verify ~10 questions appear
5. **Dataset delete**: Click trash icon on a dataset, type DELETE, confirm, verify dataset is removed
6. **Experiment guard**: Try deleting a dataset that has experiments, verify error message appears
7. **Tab switching**: Start a generation, switch tabs, return, verify questions display correctly

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: Phase 1 integration cleanup"
```
