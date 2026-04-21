# Unified Question Generation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three separate question generation strategies with a single unified pipeline that generates exact question counts with inline citations via one LLM call per document.

**Architecture:** Two-phase WorkPool pipeline. Phase 1 action handles preparation (quota allocation, real-world question matching, dimension combo filtering). Phase 2 dispatches one WorkPool action per document for generation + citation extraction. Fuzzy matching validates citations and computes character offsets.

**Tech Stack:** TypeScript, Vitest, Convex (backend), Next.js 16 (frontend), OpenAI embeddings, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-03-24-unified-question-generation-design.md`

---

## File Map

### eval-lib (new files)

| File | Responsibility |
|------|---------------|
| `packages/eval-lib/src/synthetic-datagen/unified/types.ts` | `UnifiedGenerationConfig`, `UnifiedQuestion`, `GenerationPlan`, `DocGenerationResult` types |
| `packages/eval-lib/src/synthetic-datagen/unified/quota.ts` | `calculateQuotas()` — priority-based + override allocation |
| `packages/eval-lib/src/synthetic-datagen/unified/matching.ts` | `matchRealWorldQuestions()` — embed + cosine match to docs |
| `packages/eval-lib/src/synthetic-datagen/unified/filtering.ts` | Re-export of existing `filterCombinations` from dimension-driven |
| `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts` | `generateForDocument()` — prompt builder + JSON parser for all 4 scenarios |
| `packages/eval-lib/src/synthetic-datagen/unified/citation-validator.ts` | `validateCitations()` — fuzzy match pipeline + offset extraction |
| `packages/eval-lib/src/synthetic-datagen/unified/generator.ts` | `UnifiedQuestionGenerator` orchestrator (used by eval-lib consumers) |
| `packages/eval-lib/src/synthetic-datagen/unified/index.ts` | Barrel exports |

### eval-lib (test files)

| File | Responsibility |
|------|---------------|
| `packages/eval-lib/tests/unit/synthetic-datagen/unified/quota.test.ts` | Quota allocation tests |
| `packages/eval-lib/tests/unit/synthetic-datagen/unified/citation-validator.test.ts` | Citation fuzzy matching tests |
| `packages/eval-lib/tests/unit/synthetic-datagen/unified/per-doc-generation.test.ts` | Prompt builder + JSON parser tests |
| `packages/eval-lib/tests/unit/synthetic-datagen/unified/generator.test.ts` | End-to-end orchestrator tests |

### Backend (modified files)

| File | Change |
|------|--------|
| `packages/backend/convex/schema.ts` | Add `priority` to documents, add `totalDocs`/`docsProcessed`/`currentDocName` to generationJobs |
| `packages/backend/convex/generation/actions.ts` | Add `prepareGeneration` + `generateForDocument` actions |
| `packages/backend/convex/generation/orchestration.ts` | Add `savePlanAndEnqueueDocs`, `onDocGenerated`, `updateDocProgress` mutations; modify `startGeneration` |
| `packages/backend/convex/crud/documents.ts` | Add `updatePriority` mutation |

### Frontend (new + modified files)

| File | Change |
|------|--------|
| `packages/frontend/src/components/GenerationWizard.tsx` | New: 4-step wizard component (replaces GenerateConfig + StrategySelector) |
| `packages/frontend/src/components/WizardStepRealWorld.tsx` | New: Step 1 — real-world questions input |
| `packages/frontend/src/components/WizardStepDimensions.tsx` | New: Step 2 — dimension config with auto-discover |
| `packages/frontend/src/components/WizardStepPreferences.tsx` | New: Step 3 — question types, tone, focus areas |
| `packages/frontend/src/components/WizardStepReview.tsx` | New: Step 4 — review summary + doc priority table + generate |
| `packages/frontend/src/components/PriorityDots.tsx` | New: 5-dot priority selector component |
| `packages/frontend/src/app/generate/page.tsx` | Modify: replace GenerateConfig/StrategySelector with GenerationWizard |
| `packages/frontend/src/lib/types.ts` | Add unified config types |

---

## Task 1: Unified Types

**Files:**
- Create: `packages/eval-lib/src/synthetic-datagen/unified/types.ts`
- Create: `packages/eval-lib/src/synthetic-datagen/unified/index.ts`

- [ ] **Step 1: Create types file**

```typescript
// packages/eval-lib/src/synthetic-datagen/unified/types.ts
import type { Dimension } from "../strategies/types.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { LLMClient } from "../base.js";
import type { Corpus } from "../../types/index.js";

export interface UnifiedGenerationConfig {
  readonly totalQuestions: number;
  readonly model?: string;
  readonly promptPreferences: PromptPreferences;
  readonly realWorldQuestions?: readonly string[];
  readonly dimensions?: readonly Dimension[];
  readonly allocationOverrides?: Record<string, number>;
}

export interface PromptPreferences {
  readonly questionTypes: readonly string[];
  readonly tone: string;
  readonly focusAreas: string;
}

export interface DocQuota {
  readonly docId: string;
  readonly quota: number;
  readonly priority: number;
}

export interface MatchedRealWorldQuestion {
  readonly question: string;
  readonly score: number;
  readonly passageText: string;
}

export interface GenerationPlan {
  readonly quotas: Record<string, number>;
  readonly matchedByDoc: Record<string, MatchedRealWorldQuestion[]>;
  readonly unmatchedQuestions: string[];
  readonly validCombos: ReadonlyArray<Record<string, string>>;
}

export interface UnifiedQuestion {
  readonly question: string;
  readonly citation: string;
  readonly source: "generated" | "direct-reuse";
  readonly profile: string | null;
  readonly docId: string;
}

export interface ValidatedQuestion extends UnifiedQuestion {
  readonly span: {
    readonly docId: string;
    readonly start: number;
    readonly end: number;
    readonly text: string;
  };
}

export interface DocGenerationResult {
  readonly docId: string;
  readonly questions: ValidatedQuestion[];
  readonly failedCitations: number;
}

export type GenerationScenario = 1 | 2 | 3 | 4;

export interface UnifiedGeneratorContext {
  readonly corpus: Corpus;
  readonly llmClient: LLMClient;
  readonly model: string;
  readonly embedder?: Embedder;
}
```

- [ ] **Step 2: Create filtering re-export**

```typescript
// packages/eval-lib/src/synthetic-datagen/unified/filtering.ts
export { filterCombinations } from "../strategies/dimension-driven/filtering.js";
```

- [ ] **Step 3: Create barrel export**

```typescript
// packages/eval-lib/src/synthetic-datagen/unified/index.ts
export type {
  UnifiedGenerationConfig,
  PromptPreferences,
  DocQuota,
  MatchedRealWorldQuestion,
  GenerationPlan,
  UnifiedQuestion,
  ValidatedQuestion,
  DocGenerationResult,
  GenerationScenario,
  UnifiedGeneratorContext,
} from "./types.js";
```

- [ ] **Step 4: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/unified/
git commit -m "feat(eval-lib): add unified question generation types and filtering re-export"
```

---

## Task 2: Quota Allocation

**Files:**
- Create: `packages/eval-lib/tests/unit/synthetic-datagen/unified/quota.test.ts`
- Create: `packages/eval-lib/src/synthetic-datagen/unified/quota.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/eval-lib/tests/unit/synthetic-datagen/unified/quota.test.ts
import { describe, it, expect } from "vitest";
import { calculateQuotas } from "../../../../src/synthetic-datagen/unified/quota.js";

describe("calculateQuotas", () => {
  it("distributes proportionally by priority", () => {
    const docs = [
      { id: "a", priority: 5 },
      { id: "b", priority: 3 },
      { id: "c", priority: 2 },
    ];
    const result = calculateQuotas(docs, 20);
    // total weight = 10, a=50%, b=30%, c=20%
    expect(result.get("a")).toBe(10);
    expect(result.get("b")).toBe(6);
    expect(result.get("c")).toBe(4);
    // Sum must equal totalQuestions
    const sum = [...result.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(20);
  });

  it("gives remainder to highest-priority doc", () => {
    const docs = [
      { id: "a", priority: 3 },
      { id: "b", priority: 3 },
      { id: "c", priority: 3 },
    ];
    // 10 / 3 = 3.33 each. Can't divide evenly.
    const result = calculateQuotas(docs, 10);
    const sum = [...result.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(10);
  });

  it("skips low-priority docs when totalQuestions < numDocs", () => {
    const docs = [
      { id: "a", priority: 5 },
      { id: "b", priority: 3 },
      { id: "c", priority: 1 },
    ];
    const result = calculateQuotas(docs, 2);
    expect(result.get("a")).toBeGreaterThan(0);
    expect(result.get("b")).toBeGreaterThan(0);
    expect(result.get("c")).toBe(0);
    const sum = [...result.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(2);
  });

  it("uses allocation overrides when provided", () => {
    const docs = [
      { id: "a", priority: 5 },
      { id: "b", priority: 1 },
    ];
    const result = calculateQuotas(docs, 20, { a: 75, b: 25 });
    expect(result.get("a")).toBe(15);
    expect(result.get("b")).toBe(5);
  });

  it("handles single document", () => {
    const result = calculateQuotas([{ id: "a", priority: 3 }], 20);
    expect(result.get("a")).toBe(20);
  });

  it("defaults priority to 3 when not set", () => {
    const docs = [
      { id: "a", priority: 3 },
      { id: "b", priority: 3 },
    ];
    const result = calculateQuotas(docs, 10);
    expect(result.get("a")).toBe(5);
    expect(result.get("b")).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/unified/quota.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement quota.ts**

```typescript
// packages/eval-lib/src/synthetic-datagen/unified/quota.ts

export function calculateQuotas(
  docs: ReadonlyArray<{ id: string; priority: number }>,
  totalQuestions: number,
  overrides?: Record<string, number>,
): Map<string, number> {
  if (overrides && Object.keys(overrides).length > 0) {
    return applyOverrides(docs, overrides, totalQuestions);
  }

  const quotas = new Map<string, number>();

  // When totalQuestions < numDocs, skip low-priority docs
  if (totalQuestions < docs.length) {
    const sorted = [...docs].sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < sorted.length; i++) {
      quotas.set(sorted[i].id, i < totalQuestions ? 1 : 0);
    }
    return quotas;
  }

  // Priority-based proportional allocation
  const totalWeight = docs.reduce((s, d) => s + d.priority, 0);
  let allocated = 0;

  // Sort ascending — lowest priority first, highest last gets remainder
  const sorted = [...docs].sort((a, b) => a.priority - b.priority);

  for (let i = 0; i < sorted.length; i++) {
    const doc = sorted[i];
    if (i === sorted.length - 1) {
      quotas.set(doc.id, totalQuestions - allocated);
    } else {
      const quota = Math.round((doc.priority / totalWeight) * totalQuestions);
      quotas.set(doc.id, quota);
      allocated += quota;
    }
  }

  return quotas;
}

function applyOverrides(
  docs: ReadonlyArray<{ id: string; priority: number }>,
  overrides: Record<string, number>,
  totalQuestions: number,
): Map<string, number> {
  const quotas = new Map<string, number>();
  let allocated = 0;

  // Sort by percentage descending — highest gets remainder
  const entries = Object.entries(overrides).sort(([, a], [, b]) => b - a);

  for (let i = 0; i < entries.length; i++) {
    const [docId, pct] = entries[i];
    if (i === entries.length - 1) {
      quotas.set(docId, totalQuestions - allocated);
    } else {
      const quota = Math.round((pct / 100) * totalQuestions);
      quotas.set(docId, quota);
      allocated += quota;
    }
  }

  // Docs without overrides get 0
  for (const doc of docs) {
    if (!quotas.has(doc.id)) quotas.set(doc.id, 0);
  }

  return quotas;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/unified/quota.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/unified/quota.ts packages/eval-lib/tests/unit/synthetic-datagen/unified/quota.test.ts
git commit -m "feat(eval-lib): add priority-based quota allocation for unified pipeline"
```

---

## Task 3: Citation Validator with Fuzzy Matching

**Files:**
- Create: `packages/eval-lib/tests/unit/synthetic-datagen/unified/citation-validator.test.ts`
- Create: `packages/eval-lib/src/synthetic-datagen/unified/citation-validator.ts`

- [ ] **Step 1: Research fuzzy matching library**

Run: `cd packages/eval-lib && pnpm info fuzzball description` and `pnpm info fastest-levenshtein description`

Evaluate candidates against requirements: substring matching within a larger text, returns match position, handles whitespace/punctuation differences. The custom approach (extend `normalizedFind` with sliding-window Levenshtein) is likely the best fit since we need substring-in-text matching, not string-to-string comparison. Most libraries (fuse.js, fuzzball) do the latter.

Decision: build a custom fuzzy substring matcher using `fastest-levenshtein` for the distance function + a sliding window approach. Install: `pnpm -C packages/eval-lib add fastest-levenshtein`

- [ ] **Step 2: Write failing tests**

```typescript
// packages/eval-lib/tests/unit/synthetic-datagen/unified/citation-validator.test.ts
import { describe, it, expect } from "vitest";
import { findCitationSpan } from "../../../../src/synthetic-datagen/unified/citation-validator.js";

const DOC = "Kubernetes pods are the smallest deployable units. Each pod runs one or more containers. Pods share network and storage resources.";

describe("findCitationSpan", () => {
  it("finds exact match", () => {
    const result = findCitationSpan(DOC, "Each pod runs one or more containers.");
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Each pod runs one or more containers.");
    expect(DOC.substring(result!.start, result!.end)).toBe(result!.text);
  });

  it("finds whitespace-normalized match", () => {
    // Extra spaces
    const result = findCitationSpan(DOC, "Each  pod  runs  one or more containers.");
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Each pod runs one or more containers.");
  });

  it("finds fuzzy match with minor word differences", () => {
    // LLM changed "smallest deployable" to "smallest"
    const result = findCitationSpan(DOC, "Kubernetes pods are the smallest units.");
    expect(result).not.toBeNull();
    expect(result!.start).toBeLessThanOrEqual(5); // Should anchor near beginning
    expect(DOC.includes(result!.text)).toBe(true); // Returned text is from the document
  });

  it("returns null for completely unrelated text", () => {
    const result = findCitationSpan(DOC, "The weather today is sunny and warm.");
    expect(result).toBeNull();
  });

  it("replaces excerpt with actual document text", () => {
    const result = findCitationSpan(DOC, "Each  pod  runs  one or more containers.");
    expect(result).not.toBeNull();
    // The returned text must be from the document, not the input
    expect(DOC.includes(result!.text)).toBe(true);
  });

  it("handles case differences", () => {
    const result = findCitationSpan(DOC, "kubernetes pods are the smallest deployable units.");
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/unified/citation-validator.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement citation-validator.ts**

Implement a 3-tier matching pipeline: exact → normalized → fuzzy sliding window. The fuzzy matcher uses a sliding window over the document text, comparing each window to the excerpt using Levenshtein distance (via `fastest-levenshtein`). Returns the best-scoring window if above a similarity threshold.

```typescript
// packages/eval-lib/src/synthetic-datagen/unified/citation-validator.ts
import { distance } from "fastest-levenshtein";

export interface CitationSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function findCitationSpan(
  docContent: string,
  excerpt: string,
): CitationSpan | null {
  // Tier 1: Exact match
  const exactIdx = docContent.indexOf(excerpt);
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + excerpt.length, text: excerpt };
  }

  // Tier 2: Whitespace + case normalized match
  const normResult = normalizedFind(docContent, excerpt);
  if (normResult !== null) {
    return normResult;
  }

  // Tier 3: Fuzzy sliding window
  return fuzzySubstringMatch(docContent, excerpt);
}

function normalizedFind(docContent: string, excerpt: string): CitationSpan | null {
  const normalize = (s: string) => s.replace(/\s+/g, " ").toLowerCase().trim();
  const normDoc = normalize(docContent);
  const normExcerpt = normalize(excerpt);
  const idx = normDoc.indexOf(normExcerpt);
  if (idx === -1) return null;

  // Map normalized index back to original
  let origStart = mapNormToOrig(docContent, idx);
  let origEnd = mapNormToOrig(docContent, idx + normExcerpt.length);
  const text = docContent.substring(origStart, origEnd);
  return { start: origStart, end: origEnd, text };
}

function mapNormToOrig(original: string, normIdx: number): number {
  let origPos = 0;
  let normPos = 0;
  // Skip leading whitespace
  while (origPos < original.length && /\s/.test(original[origPos])) origPos++;

  while (normPos < normIdx && origPos < original.length) {
    if (/\s/.test(original[origPos])) {
      while (origPos < original.length - 1 && /\s/.test(original[origPos + 1])) origPos++;
    }
    origPos++;
    normPos++;
  }
  return origPos;
}

function fuzzySubstringMatch(
  docContent: string,
  excerpt: string,
  threshold = 0.7,
): CitationSpan | null {
  const excerptLen = excerpt.length;
  const windowSize = Math.ceil(excerptLen * 1.3); // slightly larger window
  const minWindowSize = Math.floor(excerptLen * 0.7);
  const normExcerpt = excerpt.toLowerCase().replace(/\s+/g, " ").trim();

  let bestScore = 0;
  let bestStart = -1;
  let bestEnd = -1;

  // Slide window over document
  for (let size = minWindowSize; size <= windowSize; size += Math.max(1, Math.floor(excerptLen * 0.1))) {
    for (let i = 0; i <= docContent.length - size; i += Math.max(1, Math.floor(size * 0.2))) {
      const window = docContent.substring(i, i + size);
      const normWindow = window.toLowerCase().replace(/\s+/g, " ").trim();
      const maxLen = Math.max(normExcerpt.length, normWindow.length);
      if (maxLen === 0) continue;
      const dist = distance(normExcerpt, normWindow);
      const similarity = 1 - dist / maxLen;

      if (similarity > bestScore) {
        bestScore = similarity;
        bestStart = i;
        bestEnd = i + size;
      }
    }
  }

  if (bestScore >= threshold && bestStart !== -1) {
    return {
      start: bestStart,
      end: bestEnd,
      text: docContent.substring(bestStart, bestEnd),
    };
  }

  return null;
}
```

- [ ] **Step 5: Install dependency**

Run: `pnpm -C packages/eval-lib add fastest-levenshtein`

- [ ] **Step 6: Run tests — verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/unified/citation-validator.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/unified/citation-validator.ts packages/eval-lib/tests/unit/synthetic-datagen/unified/citation-validator.test.ts packages/eval-lib/package.json pnpm-lock.yaml
git commit -m "feat(eval-lib): add fuzzy citation validator with 3-tier matching pipeline"
```

---

## Task 4: Per-Document Prompt Builder & Generator

**Files:**
- Create: `packages/eval-lib/tests/unit/synthetic-datagen/unified/per-doc-generation.test.ts`
- Create: `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts`

- [ ] **Step 1: Write failing tests**

Test the prompt builder for all 4 scenarios and the JSON response parser. Use a mock LLM client that returns canned responses.

Key test cases:
- Scenario 4 (no matches, no combos): prompt contains DOCUMENT + PREFERENCES only
- Scenario 3 (no matches, combos): prompt contains DOCUMENT + DIVERSITY GUIDANCE + PREFERENCES
- Scenario 2 (some matches, some combos): prompt contains DOCUMENT + STYLE EXAMPLES + DIVERSITY GUIDANCE + TASK with mixed generate/direct-reuse
- Scenario 1 (enough matches): prompt contains DOCUMENT + direct-reuse citation extraction only
- JSON parsing: valid response parsed correctly, malformed response returns empty array
- Large doc splitting: doc > 20K chars split into chunks with overlap

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/unified/per-doc-generation.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement per-doc-generation.ts**

Build the prompt dynamically based on scenario. Key functions:
- `determineScenario(matched, quota, hasValidCombos)` → `GenerationScenario`
- `buildPrompt(doc, scenario, matchedQuestions, validCombos, preferences, quota, globalStyleExamples)` → system + user messages
- `generateForDocument(doc, quota, matchedQuestions, validCombos, config, globalStyleExamples, llmClient, model)` → `UnifiedQuestion[]`
- `parseGenerationResponse(response)` → parsed questions array with fallback for malformed JSON
- `splitLargeDocument(content, maxChars, overlap)` → chunks

- [ ] **Step 4: Run tests — verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/unified/per-doc-generation.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts packages/eval-lib/tests/unit/synthetic-datagen/unified/per-doc-generation.test.ts
git commit -m "feat(eval-lib): add per-document prompt builder for all 4 generation scenarios"
```

---

## Task 5: Real-World Question Matching (Refactor)

**Files:**
- Create: `packages/eval-lib/src/synthetic-datagen/unified/matching.ts`
- Existing tests: `packages/eval-lib/tests/unit/synthetic-datagen/strategies/real-world-grounded-matching.test.ts` (verify still pass)

- [ ] **Step 1: Create matching.ts**

Refactor the existing `matchQuestionsToDocuments` from `real-world-grounded/matching.ts` into the unified module. Key change: output uses plain objects (`Record<string, MatchedRealWorldQuestion[]>`) instead of `Map`, and returns `unmatchedQuestions` separately.

```typescript
// packages/eval-lib/src/synthetic-datagen/unified/matching.ts
import type { Corpus } from "../../types/index.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { MatchedRealWorldQuestion } from "./types.js";
import {
  splitIntoPassages,
  embedInBatches,
  cosineSimilarity,
  type PassageInfo,
} from "../strategies/real-world-grounded/matching.js";

export interface MatchingResult {
  readonly matchedByDoc: Record<string, MatchedRealWorldQuestion[]>;
  readonly unmatchedQuestions: string[];
}

export async function matchRealWorldQuestions(
  corpus: Corpus,
  questions: readonly string[],
  embedder: Embedder,
  options?: { threshold?: number },
): Promise<MatchingResult> {
  const threshold = options?.threshold ?? 0.35;

  // Build passage index (reuse existing splitIntoPassages)
  const allPassages: PassageInfo[] = [];
  for (const doc of corpus.documents) {
    const passages = splitIntoPassages(doc.content);
    for (const text of passages) {
      allPassages.push({ docId: String(doc.id), text });
    }
  }

  // Embed all passages + questions (reuse existing embedInBatches)
  const passageTexts = allPassages.map((p) => p.text);
  const passageEmbeddings = await embedInBatches(passageTexts, embedder);
  const questionEmbeddings = await embedInBatches(questions, embedder);

  // Match each question to best passage
  const matchedByDoc: Record<string, MatchedRealWorldQuestion[]> = {};
  const unmatchedQuestions: string[] = [];

  for (let qi = 0; qi < questions.length; qi++) {
    let bestScore = -1;
    let bestPassage: PassageInfo | null = null;

    for (let pi = 0; pi < allPassages.length; pi++) {
      const score = cosineSimilarity(questionEmbeddings[qi], passageEmbeddings[pi]);
      if (score > bestScore) {
        bestScore = score;
        bestPassage = allPassages[pi];
      }
    }

    if (bestPassage && bestScore >= threshold) {
      if (!matchedByDoc[bestPassage.docId]) matchedByDoc[bestPassage.docId] = [];
      matchedByDoc[bestPassage.docId].push({
        question: questions[qi],
        score: bestScore,
        passageText: bestPassage.text,
      });
    } else {
      unmatchedQuestions.push(questions[qi]);
    }
  }

  // Sort each doc's matches by score descending
  for (const docId of Object.keys(matchedByDoc)) {
    matchedByDoc[docId].sort((a, b) => b.score - a.score);
  }

  return { matchedByDoc, unmatchedQuestions };
}
```

- [ ] **Step 2: Verify existing matching tests still pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/strategies/real-world-grounded-matching.test.ts`
Expected: All existing tests PASS (we didn't change the original file, just wrapped it)

- [ ] **Step 3: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/unified/matching.ts
git commit -m "feat(eval-lib): add unified matching wrapper for real-world questions"
```

---

## Task 6: Unified Generator Orchestrator

**Files:**
- Create: `packages/eval-lib/tests/unit/synthetic-datagen/unified/generator.test.ts`
- Create: `packages/eval-lib/src/synthetic-datagen/unified/generator.ts`
- Modify: `packages/eval-lib/src/synthetic-datagen/unified/index.ts` (add exports)
- Modify: `packages/eval-lib/src/synthetic-datagen/index.ts` (add unified re-exports)

- [ ] **Step 1: Write failing tests**

End-to-end tests with mock LLM client. Test all config combinations:
- Nothing provided (all defaults) → Scenario 4 for all docs
- Only dimensions → Scenario 3
- Only real-world questions → Scenarios 1/2
- Both dimensions + real-world → mixed scenarios
- Verify exact question count matches `totalQuestions`
- Verify all questions have valid citation spans

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/unified/generator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement generator.ts**

The orchestrator calls: quota allocation → matching → filtering → per-doc generation → citation validation → deficit reconciliation. This is the eval-lib-level orchestrator (not the Convex action — that comes in Task 8).

- [ ] **Step 4: Update barrel exports**

Add `UnifiedQuestionGenerator` and all types to `unified/index.ts` and re-export from `synthetic-datagen/index.ts`.

- [ ] **Step 5: Run tests — verify they pass**

Run: `pnpm -C packages/eval-lib test -- --run tests/unit/synthetic-datagen/unified/generator.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full eval-lib test suite**

Run: `pnpm -C packages/eval-lib test -- --run`
Expected: All 225+ tests PASS (no regressions in existing strategies)

- [ ] **Step 7: Build eval-lib**

Run: `pnpm build`
Expected: Clean build, no TypeScript errors

- [ ] **Step 8: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/unified/ packages/eval-lib/src/synthetic-datagen/index.ts packages/eval-lib/tests/unit/synthetic-datagen/unified/
git commit -m "feat(eval-lib): add UnifiedQuestionGenerator orchestrator"
```

---

## Task 7: Backend Schema Changes

**Files:**
- Modify: `packages/backend/convex/schema.ts`
- Modify: `packages/backend/convex/crud/documents.ts`

- [ ] **Step 1: Add priority field to documents table**

In `packages/backend/convex/schema.ts`, add to the `documents` table definition:

```typescript
priority: v.optional(v.number()),  // 1-5, default 3
```

- [ ] **Step 2: Add progress fields to generationJobs table**

In `packages/backend/convex/schema.ts`, add to the `generationJobs` table definition:

```typescript
totalDocs: v.optional(v.number()),
docsProcessed: v.optional(v.number()),
currentDocName: v.optional(v.string()),
```

- [ ] **Step 3: Add updatePriority mutation to documents CRUD**

In `packages/backend/convex/crud/documents.ts`, add:

```typescript
export const updatePriority = mutation({
  args: {
    documentId: v.id("documents"),
    priority: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.orgId !== orgId) throw new Error("Document not found");
    if (args.priority < 1 || args.priority > 5) throw new Error("Priority must be 1-5");
    await ctx.db.patch(args.documentId, { priority: args.priority });
  },
});
```

- [ ] **Step 4: Deploy schema and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Schema deployed successfully, no errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/crud/documents.ts
git commit -m "feat(backend): add document priority field and generation progress tracking"
```

---

## Task 8: Backend Actions (prepareGeneration + generateForDocument)

**Files:**
- Modify: `packages/backend/convex/generation/actions.ts`

- [ ] **Step 1: Add prepareGeneration action**

Add to `packages/backend/convex/generation/actions.ts` (which already has `"use node"`):

The action:
1. Loads corpus via `loadCorpusFromKb`
2. Reads document priorities from Convex
3. Calls `calculateQuotas` from eval-lib
4. If real-world questions provided: creates OpenAI embedder, calls `matchRealWorldQuestions`
5. If dimensions provided: calls `filterCombinations` via eval-lib
6. Calls `ctx.runMutation(internal.generation.orchestration.savePlanAndEnqueueDocs, ...)` with the serialized plan

**Important serialization note:** When `prepareGeneration` passes data to `savePlanAndEnqueueDocs` (a Convex mutation), all `Map` objects must be converted to plain objects via `Object.fromEntries()`. Convex mutations only accept JSON-serializable values.

- [ ] **Step 2: Add generateForDocument action**

The action:
1. Loads the specific document content
2. Calls `generateForDocument` from eval-lib (per-doc-generation.ts)
3. Calls `findCitationSpan` for each question's citation
4. For failed citations: retries with a stricter LLM prompt, calls `findCitationSpan` again
5. Inserts validated questions via `ctx.runMutation(internal.crud.questions.insertBatch, ...)`
6. Reports progress via `ctx.runMutation(internal.generation.orchestration.updateDocProgress, ...)`

- [ ] **Step 3: Build eval-lib and deploy**

Run: `pnpm build && cd packages/backend && npx convex dev --once`
Expected: Clean build and deploy

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/generation/actions.ts
git commit -m "feat(backend): add prepareGeneration and generateForDocument unified actions"
```

---

## Task 9: Backend Orchestration (Two-Phase WorkPool)

**Files:**
- Modify: `packages/backend/convex/generation/orchestration.ts`

- [ ] **Step 1: Add savePlanAndEnqueueDocs mutation**

This mutation:
1. Receives the generation plan from `prepareGeneration`
2. Updates the job with `totalDocs`, `docsProcessed: 0`
3. Stores `unmatchedQuestions` on the dataset record: `ctx.db.patch(datasetId, { metadata: { ...existing.metadata, knowledgeGaps: plan.unmatchedQuestions } })`
4. Enqueues one `generateForDocument` action per document via WorkPool
5. Stores workIds for selective cancellation

- [ ] **Step 2: Add onDocGenerated callback**

This callback:
1. Increments `docsProcessed` on the job
2. When all docs complete: counts total questions, updates dataset `questionCount`, finalizes job status, fires LangSmith sync

- [ ] **Step 3: Add updateDocProgress mutation**

Updates `docsProcessed` and `currentDocName` on the job record for real-time UI display.

- [ ] **Step 4: Modify startGeneration to use unified pipeline**

Change `startGeneration` to always enqueue `prepareGeneration` (keep old strategy branches for backwards compat but mark deprecated with comments).

- [ ] **Step 5: Run backend tests**

Run: `pnpm -C packages/backend test -- --run`
Expected: All existing tests PASS. **Check `packages/backend/tests/generation.test.ts` first** — it uses `seedGenerationJob` which sets `phase: "generating"` and asserts on phase transitions. The unified pipeline changes the phase flow (no separate "ground-truth" phase), so tests that assert `phase === "ground-truth"` need updating. The old phase flow is: generating → ground-truth → complete. The new flow is: preparing → generating → complete.

- [ ] **Step 6: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Clean deploy

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/generation/orchestration.ts
git commit -m "feat(backend): two-phase WorkPool orchestration for unified generation"
```

---

## Task 10: Frontend — PriorityDots Component

**Files:**
- Create: `packages/frontend/src/components/PriorityDots.tsx`

- [ ] **Step 1: Create PriorityDots component**

A row of 5 clickable dots. Filled dots = priority level. Clicking a dot sets priority to that level.

Props: `value: number` (1-5), `onChange: (priority: number) => void`

Style: use existing color tokens (`--color-accent` for filled, `--color-border` for empty). 8px dots with 3px gap. Hover effect on unfilled dots.

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/PriorityDots.tsx
git commit -m "feat(frontend): add PriorityDots component for document priority selection"
```

---

## Task 11: Frontend — Wizard Step Components

**Files:**
- Create: `packages/frontend/src/components/WizardStepRealWorld.tsx`
- Create: `packages/frontend/src/components/WizardStepDimensions.tsx`
- Create: `packages/frontend/src/components/WizardStepPreferences.tsx`
- Create: `packages/frontend/src/components/WizardStepReview.tsx`
- Modify: `packages/frontend/src/lib/types.ts`

- [ ] **Step 1: Add unified config types to frontend types**

Add `UnifiedWizardConfig`, `PromptPreferences` types to `packages/frontend/src/lib/types.ts`.

- [ ] **Step 2: Create WizardStepRealWorld**

Upload area (CSV/text) + textarea for paste/type. Parses input into `string[]`. Shows count badge. Skip button.

- [ ] **Step 3: Create WizardStepDimensions**

URL input + auto-discover button (calls existing `/api/discover-dimensions`). Editable dimension chips. Manual add. Skip button. Reuse dimension editing logic from existing `DimensionWizard.tsx`.

- [ ] **Step 4: Create WizardStepPreferences**

Question type toggleable chips, tone dropdown, focus areas text input. Defaults pre-filled. Read KB metadata for auto-fill (industry, sourceUrl).

- [ ] **Step 5: Create WizardStepReview**

Summary cards for steps 1-3 with edit links. Total questions slider (reuse `TotalQuestionsSlider`). Document priority table with `PriorityDots` and calculated allocation. Generate button.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/WizardStep*.tsx packages/frontend/src/lib/types.ts
git commit -m "feat(frontend): add 4 wizard step components for unified generation"
```

---

## Task 12: Frontend — GenerationWizard & Page Integration

**Files:**
- Create: `packages/frontend/src/components/GenerationWizard.tsx`
- Modify: `packages/frontend/src/app/generate/page.tsx`

- [ ] **Step 1: Create GenerationWizard**

Combines the 4 steps with a stepper navigation. Manages wizard state. Persists all config to localStorage under key `rag-eval:unified-wizard-config`. Handles step navigation (back, next, skip, jump to any step).

On "Generate": calls `startGeneration` mutation with `strategy: "unified"` and the full config as `strategyConfig`.

- [ ] **Step 2: Integrate into generate page**

Replace `GenerateConfig`, `StrategySelector`, `DimensionWizard` modal, and `RealWorldQuestionsModal` usage with `GenerationWizard` in `generate/page.tsx`. The wizard renders in the left panel where the config currently lives.

Keep `QuestionList`, `DocumentViewer`, and `GenerationBanner` as-is — they work with the reactive Convex queries and don't depend on strategy type.

- [ ] **Step 3: Verify page renders**

Run: `pnpm dev` (frontend) + `pnpm dev:backend` (backend)
Navigate to `/generate`, verify wizard renders with all 4 steps.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/GenerationWizard.tsx packages/frontend/src/app/generate/page.tsx
git commit -m "feat(frontend): integrate GenerationWizard into generate page"
```

---

## Task 13: End-to-End Verification

**Files:** No new files — testing existing code together.

- [ ] **Step 1: Run full eval-lib test suite**

Run: `pnpm -C packages/eval-lib test -- --run`
Expected: All tests PASS (existing + new unified tests)

- [ ] **Step 2: Run full backend test suite**

Run: `pnpm -C packages/backend test -- --run`
Expected: All tests PASS

- [ ] **Step 3: Build everything**

Run: `pnpm build && pnpm -C packages/frontend build`
Expected: Clean builds with no TypeScript errors

- [ ] **Step 4: Manual smoke test**

1. Start backend: `pnpm dev:backend`
2. Start frontend: `pnpm dev`
3. Navigate to `/generate`
4. Select a KB with documents
5. Walk through wizard: skip real-world → skip dimensions → keep default preferences → review
6. Set 5 total questions, verify document allocation table
7. Click Generate
8. Verify questions appear with citation spans
9. Verify job progress shows "Generating questions... (N/M documents)"

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification for unified question generation"
```
