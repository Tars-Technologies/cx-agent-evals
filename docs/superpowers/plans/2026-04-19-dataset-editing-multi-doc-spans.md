# Dataset Editing & Multi-Document Spans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the Generate module to Dataset, add manual question/span editing via a split-panel modal, support multi-document ground truth spans, and redesign the question list as a flat list with filters.

**Architecture:** One new backend mutation (`updateQuestion`) with auth-gated access. One new frontend component (`EditQuestionModal`) — a split-panel modal with question editing on the left and document viewer with text selection on the right. The existing `QuestionList` is restructured from document-grouped to flat with filters. Routing changes from `/generate` to `/dataset`.

**Tech Stack:** Convex (backend mutations/queries), Next.js 16 App Router, React, Tailwind CSS v4, TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-04-19-dataset-editing-multi-doc-spans-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/backend/convex/crud/questions.ts` | Modify | Add `updateQuestion` public mutation |
| `packages/backend/tests/questions.test.ts` | Create | Tests for `updateQuestion` mutation |
| `packages/frontend/src/components/Header.tsx` | Modify | Rename mode type + nav label |
| `packages/frontend/src/components/ModeSelector.tsx` | Modify | Update link + card text |
| `packages/frontend/src/app/generate/` | Rename → `src/app/dataset/` | Route directory rename |
| `packages/frontend/src/app/dataset/page.tsx` | Modify | Update Header mode prop, add edit modal wiring |
| `packages/frontend/src/components/QuestionList.tsx` | Modify | Flat list, filters, edit button |
| `packages/frontend/src/components/EditQuestionModal.tsx` | Create | Split-panel edit modal |
| `packages/frontend/src/lib/fuzzySearch.ts` | Create | Client-side fuzzy text search utility |

---

### Task 1: Backend — `updateQuestion` Mutation

**Files:**
- Modify: `packages/backend/convex/crud/questions.ts`
- Create: `packages/backend/tests/questions.test.ts`
- Reference: `packages/backend/convex/lib/validators.ts` (spanValidator)
- Reference: `packages/backend/convex/lib/auth.ts` (getAuthContext)
- Reference: `packages/backend/tests/helpers.ts` (setupTest, seeders, testIdentity)

- [ ] **Step 1: Write failing tests for `updateQuestion`**

Create `packages/backend/tests/questions.test.ts`:

```typescript
import { expect, test, describe } from "vitest";
import { api } from "../convex/_generated/api";
import {
  setupTest,
  seedUser,
  seedKB,
  seedDataset,
  testIdentity,
  TEST_ORG_ID,
} from "./helpers";

describe("updateQuestion", () => {
  test("updates queryText and clears langsmithExampleId", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);

    // Seed a question with a langsmithExampleId
    const questionId = await t.run(async (ctx) => {
      return await ctx.db.insert("questions", {
        datasetId,
        queryId: "q1",
        queryText: "Original question?",
        sourceDocId: "doc1",
        relevantSpans: [{ docId: "doc1", start: 0, end: 10, text: "some text." }],
        langsmithExampleId: "ls-123",
        metadata: {},
      });
    });

    // Update question text
    await t.mutation(
      api.crud.questions.updateQuestion,
      { questionId, queryText: "Updated question?" },
      { identity: testIdentity },
    );

    // Verify
    const updated = await t.run(async (ctx) => ctx.db.get(questionId));
    expect(updated!.queryText).toBe("Updated question?");
    expect(updated!.langsmithExampleId).toBeUndefined();
    // Spans unchanged
    expect(updated!.relevantSpans).toHaveLength(1);
  });

  test("updates relevantSpans with multi-doc spans", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);

    const questionId = await t.run(async (ctx) => {
      return await ctx.db.insert("questions", {
        datasetId,
        queryId: "q2",
        queryText: "Some question?",
        sourceDocId: "doc1",
        relevantSpans: [{ docId: "doc1", start: 0, end: 5, text: "hello" }],
        metadata: {},
      });
    });

    const newSpans = [
      { docId: "doc1", start: 0, end: 5, text: "hello" },
      { docId: "doc2", start: 10, end: 20, text: "world text" },
    ];

    await t.mutation(
      api.crud.questions.updateQuestion,
      { questionId, relevantSpans: newSpans },
      { identity: testIdentity },
    );

    const updated = await t.run(async (ctx) => ctx.db.get(questionId));
    expect(updated!.relevantSpans).toHaveLength(2);
    expect(updated!.relevantSpans[1].docId).toBe("doc2");
    expect(updated!.langsmithExampleId).toBeUndefined();
  });

  test("rejects update for question in different org", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);

    const questionId = await t.run(async (ctx) => {
      return await ctx.db.insert("questions", {
        datasetId,
        queryId: "q3",
        queryText: "Question?",
        sourceDocId: "doc1",
        relevantSpans: [],
        metadata: {},
      });
    });

    const wrongOrgIdentity = {
      ...testIdentity,
      org_id: "org_other999",
    };

    await expect(
      t.mutation(
        api.crud.questions.updateQuestion,
        { questionId, queryText: "Hacked!" },
        { identity: wrongOrgIdentity },
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx vitest run tests/questions.test.ts`
Expected: FAIL — `api.crud.questions.updateQuestion` does not exist.

- [ ] **Step 3: Implement `updateQuestion` mutation**

Add to `packages/backend/convex/crud/questions.ts`, after the existing imports at line 1, add `mutation` to the import:

```typescript
import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
```

Then add the mutation after the `byDataset` query (after line 22):

```typescript
/**
 * Public mutation: update a question's text and/or spans.
 * Clears langsmithExampleId to force re-sync on next experiment.
 */
export const updateQuestion = mutation({
  args: {
    questionId: v.id("questions"),
    queryText: v.optional(v.string()),
    relevantSpans: v.optional(v.array(spanValidator)),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const question = await ctx.db.get(args.questionId);
    if (!question) throw new Error("Question not found");

    // Verify org access via dataset
    const dataset = await ctx.db.get(question.datasetId);
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Question not found");
    }

    await ctx.db.patch(args.questionId, {
      langsmithExampleId: undefined,
      ...(args.queryText !== undefined && { queryText: args.queryText }),
      ...(args.relevantSpans !== undefined && { relevantSpans: args.relevantSpans }),
    });
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run tests/questions.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/crud/questions.ts packages/backend/tests/questions.test.ts
git commit -m "feat(backend): add updateQuestion public mutation with auth and LangSmith re-sync"
```

---

### Task 2: Rename Generate → Dataset (Routing & Nav)

**Files:**
- Modify: `packages/frontend/src/components/Header.tsx:9,40-48`
- Modify: `packages/frontend/src/components/ModeSelector.tsx:63-98`
- Rename: `packages/frontend/src/app/generate/` → `packages/frontend/src/app/dataset/`
- Modify: `packages/frontend/src/app/dataset/page.tsx:20,234`

- [ ] **Step 1: Rename the route directory**

```bash
cd packages/frontend && mv src/app/generate src/app/dataset
```

- [ ] **Step 2: Update Header.tsx mode type and nav link**

In `packages/frontend/src/components/Header.tsx`:

Line 9 — change the mode type union:
```typescript
mode?: "kb" | "dataset" | "retrievers" | "agents" | "experiments";
```

Lines 39-48 — change the link href and mode check:
```typescript
<Link
  href={buildKbLink("/dataset", kbId ?? null)}
  className={`px-3 py-1 text-xs rounded transition-colors ${
    mode === "dataset"
      ? "bg-bg-elevated text-accent"
      : "text-text-muted hover:text-text"
  }`}
>
  Dataset
</Link>
```

- [ ] **Step 3: Update ModeSelector.tsx link and card text**

In `packages/frontend/src/components/ModeSelector.tsx`:

Line 64-65 — change the link:
```typescript
<Link
  href="/dataset"
```

Lines 84-85 — change the title:
```typescript
<h2 className="text-lg font-medium text-text group-hover:text-accent transition-colors">
  Dataset
</h2>
```

Lines 88-90 — update the description:
```typescript
<p className="text-text-muted text-sm leading-relaxed">
  Create and curate evaluation datasets with ground truth spans for
  RAG retrieval testing
</p>
```

Lines 92-98 — update the flow steps:
```typescript
<div className="mt-6 text-xs text-text-dim flex items-center gap-2 flex-wrap">
  <span>Generate questions</span>
  <span className="text-border">→</span>
  <span>Edit & curate</span>
  <span className="text-border">→</span>
  <span>Ground truth spans</span>
</div>
```

- [ ] **Step 4: Update page.tsx Header mode props**

In `packages/frontend/src/app/dataset/page.tsx`:

Line 20 — change mode prop:
```typescript
<Suspense fallback={<div className="flex flex-col h-screen"><Header mode="dataset" /></div>}>
```

Line 234 — change mode prop:
```typescript
<Header mode="dataset" kbId={selectedKbId} />
```

- [ ] **Step 5: Verify build compiles**

Run: `cd packages/frontend && npx next build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(frontend): rename Generate module to Dataset — nav, URL, route"
```

---

### Task 3: Fuzzy Search Utility

**Files:**
- Create: `packages/frontend/src/lib/fuzzySearch.ts`

- [ ] **Step 1: Create the fuzzy search utility**

Create `packages/frontend/src/lib/fuzzySearch.ts`:

```typescript
export interface SearchResult {
  docId: string;
  docTitle: string;
  /** Character offset in document where match starts */
  matchStart: number;
  /** Character offset where match ends */
  matchEnd: number;
  /** Snippet of text around the match */
  snippet: string;
  /** Relevance score (higher = better) */
  score: number;
}

/**
 * Simple client-side fuzzy search across multiple documents.
 * Splits query into tokens, finds substring matches, ranks by token coverage.
 */
export function searchDocuments(
  query: string,
  documents: { docId: string; title: string; content: string }[],
  maxResults = 20,
): SearchResult[] {
  if (!query.trim()) return [];

  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (tokens.length === 0) return [];

  const results: SearchResult[] = [];

  for (const doc of documents) {
    const contentLower = doc.content.toLowerCase();

    // Find all positions where any token matches
    for (const token of tokens) {
      let searchFrom = 0;
      while (searchFrom < contentLower.length) {
        const idx = contentLower.indexOf(token, searchFrom);
        if (idx === -1) break;

        // Score: longer matches score higher, earlier matches score slightly higher
        const score = token.length * 10 - idx * 0.001;

        // Build snippet: 60 chars before, match, 60 chars after
        const snippetStart = Math.max(0, idx - 60);
        const snippetEnd = Math.min(doc.content.length, idx + token.length + 60);
        const snippet = doc.content.slice(snippetStart, snippetEnd);

        results.push({
          docId: doc.docId,
          docTitle: doc.title,
          matchStart: idx,
          matchEnd: idx + token.length,
          snippet,
          score,
        });

        searchFrom = idx + 1;
      }
    }
  }

  // Sort by score descending, deduplicate overlapping matches in same doc
  results.sort((a, b) => b.score - a.score);

  // Deduplicate: skip results that overlap with a higher-scored result in the same doc
  const deduped: SearchResult[] = [];
  for (const r of results) {
    const overlaps = deduped.some(
      (d) =>
        d.docId === r.docId &&
        d.matchStart < r.matchEnd &&
        r.matchStart < d.matchEnd,
    );
    if (!overlaps) {
      deduped.push(r);
    }
    if (deduped.length >= maxResults) break;
  }

  return deduped;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/lib/fuzzySearch.ts
git commit -m "feat(frontend): add client-side fuzzy search utility for cross-doc search"
```

---

### Task 4: Redesign QuestionList — Flat List with Filters

**Files:**
- Modify: `packages/frontend/src/components/QuestionList.tsx`
- Modify: `packages/frontend/src/app/dataset/page.tsx` (wire new props)

- [ ] **Step 1: Update QuestionList props and remove grouping**

Rewrite `packages/frontend/src/components/QuestionList.tsx`:

```typescript
"use client";

import { useState } from "react";
import { GeneratedQuestion } from "@/lib/types";

type SourceFilter = "all" | "generated" | "real-world";

export function QuestionList({
  questions,
  selectedIndex,
  onSelect,
  onEdit,
  generating,
  totalDone,
  phaseStatus,
  onUpload,
  realWorldCount,
}: {
  questions: GeneratedQuestion[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onEdit?: (index: number) => void;
  generating: boolean;
  totalDone: number | null;
  phaseStatus?: string | null;
  onUpload?: () => void;
  realWorldCount?: number;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  // Filter questions by search query and source type
  const filteredQuestions = questions
    .map((q, index) => ({ question: q, originalIndex: index }))
    .filter(({ question }) => {
      if (searchQuery && !question.query.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (sourceFilter === "real-world" && question.source !== "real-world") return false;
      if (sourceFilter === "generated" && question.source === "real-world") return false;
      return true;
    });

  // Count unique docIds across spans for a question
  function spanDocCount(q: GeneratedQuestion): number {
    if (!q.relevantSpans || q.relevantSpans.length === 0) return 0;
    return new Set(q.relevantSpans.map((s) => s.docId)).size;
  }

  if (questions.length === 0 && !generating) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Questions will appear here
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated/50">
        <span className="text-[11px] text-text-dim uppercase tracking-wider">
          Questions
        </span>
        <span className="text-[11px] text-text-muted">
          {generating ? (
            <span className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-accent animate-pulse-dot" />
              {questions.length} generated
            </span>
          ) : totalDone !== null ? (
            <>
              {totalDone} total
              {realWorldCount != null && realWorldCount > 0 && (
                <span className="text-accent"> · {realWorldCount} real-world</span>
              )}
            </>
          ) : (
            `${questions.length}`
          )}
        </span>
      </div>

      {/* Search + Filters */}
      {questions.length > 0 && (
        <div className="px-3 py-2 border-b border-border space-y-2">
          <input
            type="text"
            placeholder="Search questions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
          />
          <div className="flex gap-1">
            {(["all", "generated", "real-world"] as SourceFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors cursor-pointer ${
                  sourceFilter === f
                    ? "bg-accent/15 text-accent"
                    : "text-text-dim hover:text-text-muted"
                }`}
              >
                {f === "all" ? "All" : f === "generated" ? "Generated" : "Real-world"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Phase status banner */}
      {generating && phaseStatus && questions.length === 0 && (
        <div className="px-3 py-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span className="text-[11px] text-accent font-medium uppercase tracking-wider">
              Pipeline
            </span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            {phaseStatus}
          </p>
        </div>
      )}

      {/* Inline phase status when questions are already showing */}
      {generating && phaseStatus && questions.length > 0 && (
        <div className="px-3 py-2 border-b border-accent/20 bg-accent/5">
          <div className="flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-accent animate-pulse-dot" />
            <span className="text-[10px] text-accent/80">
              {phaseStatus}
            </span>
          </div>
        </div>
      )}

      {/* Empty generating state (no phase info) */}
      {generating && !phaseStatus && questions.length === 0 && (
        <div className="flex items-center justify-center h-32">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span className="text-xs text-text-muted">Starting generation...</span>
          </div>
        </div>
      )}

      {/* Flat question list */}
      <div className="flex-1 overflow-y-auto">
        {filteredQuestions.map(({ question, originalIndex }) => {
          const docCount = spanDocCount(question);
          return (
            <button
              key={originalIndex}
              onClick={() => onSelect(originalIndex)}
              className={`group w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors
                         cursor-pointer animate-slide-in
                         ${
                           selectedIndex === originalIndex
                             ? "bg-accent/8 border-l-2 border-l-accent"
                             : "hover:bg-bg-hover border-l-2 border-l-transparent"
                         }`}
              style={{ animationDelay: `${(originalIndex % 10) * 30}ms` }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-text leading-relaxed flex-1">
                  {question.query}
                </p>
                {onEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(originalIndex);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-text-dim hover:text-accent transition-all cursor-pointer flex-shrink-0"
                    title="Edit question"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {question.source === "real-world" && (
                  <span className="text-[9px] text-accent bg-accent-dim px-1.5 py-0.5 rounded">
                    real-world
                  </span>
                )}
                {question.relevantSpans && question.relevantSpans.length > 0 && (
                  <span className="text-[10px] text-text-dim">
                    {question.relevantSpans.length} span{question.relevantSpans.length !== 1 ? "s" : ""}
                  </span>
                )}
                {docCount > 1 && (
                  <span className="text-[9px] text-text-dim bg-bg-surface px-1.5 py-0.5 rounded">
                    {docCount} docs
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Upload footer */}
      {questions.length > 0 && !generating && onUpload && (
        <div className="flex-shrink-0 px-3 py-2.5 border-t border-border bg-bg-elevated/50">
          <button
            onClick={onUpload}
            className="w-full px-3 py-1.5 text-xs font-medium text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors cursor-pointer"
          >
            Upload to LangSmith
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `onEdit` prop in page.tsx**

In `packages/frontend/src/app/dataset/page.tsx`, add state for the edit modal (after the `selectedDocId` state declaration):

```typescript
const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
```

Then update the `<QuestionList>` usage (in the `ResizablePanel` section) to add the `onEdit` prop:

```typescript
<QuestionList
  questions={displayQuestions}
  selectedIndex={selectedQuestion}
  onSelect={setSelectedQuestion}
  onEdit={(index) => setEditingQuestionIndex(index)}
  generating={displayGenerating}
  totalDone={displayTotalDone}
  phaseStatus={displayPhaseStatus}
  realWorldCount={
    !displayGenerating
      ? displayQuestions.filter((q) => q.source === "real-world").length
      : undefined
  }
/>
```

- [ ] **Step 3: Verify build compiles**

Run: `cd packages/frontend && npx next build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/QuestionList.tsx packages/frontend/src/app/dataset/page.tsx
git commit -m "feat(frontend): redesign QuestionList as flat list with source filters and edit button"
```

---

### Task 5: EditQuestionModal — Full Component

**Files:**
- Create: `packages/frontend/src/components/EditQuestionModal.tsx`

This task creates the complete edit modal: left panel (question text editing + spans list with delete) and right panel (document viewer with text selection + fuzzy search).

- [ ] **Step 1: Create EditQuestionModal with left panel**

Create `packages/frontend/src/components/EditQuestionModal.tsx`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { SpanInfo } from "@/lib/types";
import { searchDocuments } from "@/lib/fuzzySearch";

const SPAN_COLORS = [
  "var(--color-chunk-1)",
  "var(--color-chunk-2)",
  "var(--color-chunk-3)",
  "var(--color-chunk-4)",
  "var(--color-chunk-5)",
];

interface EditQuestionModalProps {
  /** Convex question record */
  question: {
    _id: Id<"questions">;
    queryText: string;
    sourceDocId: string;
    relevantSpans: SpanInfo[];
  };
  /** KB ID for loading documents */
  kbId: Id<"knowledgeBases">;
  onClose: () => void;
  onSaved?: () => void;
}

export function EditQuestionModal({
  question,
  kbId,
  onClose,
  onSaved,
}: EditQuestionModalProps) {
  const updateQuestion = useMutation(api.crud.questions.updateQuestion);

  // Editable state
  const [queryText, setQueryText] = useState(question.queryText);
  const [spans, setSpans] = useState<SpanInfo[]>([...question.relevantSpans]);

  // Track unsaved changes
  const hasChanges =
    queryText !== question.queryText ||
    JSON.stringify(spans) !== JSON.stringify(question.relevantSpans);

  // Delete confirmation
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);

  // Documents list for the KB
  const documents = useQuery(api.crud.documents.listByKb, { kbId });

  // Selected document in right panel
  const [selectedDocId, setSelectedDocId] = useState<Id<"documents"> | null>(null);

  // Saving state
  const [saving, setSaving] = useState(false);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Group spans by docId for display
  const spansByDoc = new Map<string, { span: SpanInfo; globalIndex: number }[]>();
  spans.forEach((span, i) => {
    const list = spansByDoc.get(span.docId) || [];
    list.push({ span, globalIndex: i });
    spansByDoc.set(span.docId, list);
  });

  // Unique doc IDs that already have spans
  const docsWithSpans = new Set(spans.map((s) => s.docId));

  // Documents that don't have spans yet (for "add from another doc" chips)
  const docsWithoutSpans = (documents ?? []).filter(
    (d) => !docsWithSpans.has(d.docId),
  );

  function handleDeleteSpan(index: number) {
    setSpans((prev) => prev.filter((_, i) => i !== index));
    setConfirmDeleteIndex(null);
  }

  function handleAddSpan(span: SpanInfo) {
    setSpans((prev) => [...prev, span]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateQuestion({
        questionId: question._id,
        queryText,
        relevantSpans: spans,
      });
      onSaved?.();
      onClose();
    } catch {
      setSaving(false);
    }
  }

  // Navigate to a document in the right panel
  function navigateToDoc(docId: string) {
    const doc = (documents ?? []).find((d) => d.docId === docId);
    if (doc) setSelectedDocId(doc._id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-2xl flex flex-col animate-fade-in"
        style={{ width: "95vw", maxWidth: 1200, height: "80vh", maxHeight: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">Edit Question</span>
            <span className="text-[9px] text-accent bg-accent-dim px-1.5 py-0.5 rounded font-medium">
              {question._id.slice(-4)}
            </span>
            <span className="text-[10px] text-text-dim">
              — generated from {question.sourceDocId}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="text-[10px] text-text-dim flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Unsaved changes
              </span>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-muted border border-border rounded hover:bg-bg-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-3 py-1.5 text-xs font-semibold bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Body — split panels */}
        <div className="flex flex-1 overflow-hidden">
          {/* LEFT PANEL */}
          <div className="w-[380px] min-w-[320px] border-r border-border flex flex-col overflow-hidden">
            {/* Question text */}
            <div className="p-4 border-b border-border flex-shrink-0">
              <label className="block text-[10px] font-semibold text-text-dim uppercase tracking-wider mb-2">
                Question Text
              </label>
              <textarea
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                className="w-full bg-bg border border-border rounded px-3 py-2.5 text-[13px] text-text leading-relaxed resize-vertical min-h-[60px] focus:border-accent outline-none font-[inherit]"
              />
            </div>

            {/* Spans section header */}
            <div className="px-4 py-2 bg-bg-surface border-b border-border flex items-center justify-between flex-shrink-0">
              <span className="text-[9px] font-semibold text-text-dim uppercase tracking-wider">
                Ground Truth Spans
              </span>
              <span className="text-[10px] text-accent font-medium">
                {spans.length} span{spans.length !== 1 ? "s" : ""}
                {spansByDoc.size > 1 ? ` across ${spansByDoc.size} docs` : spansByDoc.size === 1 ? " · 1 doc" : ""}
              </span>
            </div>

            {/* Spans list */}
            <div className="flex-1 overflow-y-auto p-2">
              {[...spansByDoc.entries()].map(([docId, items]) => (
                <div key={docId} className="mb-3">
                  <button
                    onClick={() => navigateToDoc(docId)}
                    className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-semibold text-text-muted hover:text-accent transition-colors cursor-pointer rounded hover:bg-bg-hover w-full text-left group"
                  >
                    <span className="text-accent text-[9px]">▶</span>
                    <span className="flex-1 truncate">{docId}</span>
                    <span className="text-[8px] text-text-dim opacity-0 group-hover:opacity-100">
                      → view
                    </span>
                  </button>
                  {items.map(({ span, globalIndex }) => (
                    <div
                      key={globalIndex}
                      className={`relative bg-bg border border-border rounded mx-1 my-1 px-2.5 py-2 text-[10px] leading-relaxed transition-colors group/span hover:border-border-bright ${
                        confirmDeleteIndex === globalIndex
                          ? "border-red-500/30 bg-red-500/5"
                          : ""
                      }`}
                    >
                      {/* Color bar */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l"
                        style={{
                          backgroundColor: SPAN_COLORS[globalIndex % SPAN_COLORS.length],
                        }}
                      />

                      {/* Delete button (hover) */}
                      {confirmDeleteIndex !== globalIndex && (
                        <button
                          onClick={() => setConfirmDeleteIndex(globalIndex)}
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover/span:opacity-100 text-[9px] text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1.5 py-0.5 hover:bg-red-400/20 transition-all cursor-pointer flex items-center gap-1"
                        >
                          ✕ delete
                        </button>
                      )}

                      {/* Inline confirmation */}
                      {confirmDeleteIndex === globalIndex && (
                        <div className="absolute -top-1 right-1 bg-bg-elevated border border-red-500 rounded px-2.5 py-1.5 flex items-center gap-2 shadow-lg z-10">
                          <span className="text-[10px] text-text-muted">Remove?</span>
                          <button
                            onClick={() => handleDeleteSpan(globalIndex)}
                            className="text-[9px] font-semibold bg-red-500 text-white px-2 py-0.5 rounded cursor-pointer"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteIndex(null)}
                            className="text-[9px] text-text-muted border border-border px-2 py-0.5 rounded cursor-pointer"
                          >
                            No
                          </button>
                        </div>
                      )}

                      {/* Span text */}
                      <p className="text-text line-clamp-3 pr-12">{span.text}</p>
                      <p className="text-[8px] text-text-dim mt-1">
                        chars {span.start.toLocaleString()} — {span.end.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              ))}

              {/* "Add from another doc" section */}
              {docsWithoutSpans.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border px-2">
                  <p className="text-[9px] text-text-dim mb-2">
                    Add spans from another document:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {docsWithoutSpans.map((doc) => (
                      <button
                        key={doc._id}
                        onClick={() => setSelectedDocId(doc._id)}
                        className="text-[9px] text-text-muted bg-bg border border-border px-2 py-1 rounded hover:border-accent/30 hover:text-accent transition-colors cursor-pointer truncate max-w-[200px]"
                      >
                        {doc.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {spans.length === 0 && (
                <div className="flex items-center justify-center py-8 text-[11px] text-text-dim">
                  Select text in a document to add a span →
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL — placeholder for Task 6 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <RightPanel
              documents={documents ?? []}
              selectedDocId={selectedDocId}
              onSelectDoc={setSelectedDocId}
              existingSpans={spans}
              onAddSpan={handleAddSpan}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border flex-shrink-0">
          <span className="text-[10px] text-text-dim">
            Select text in the document to add a ground truth span · <kbd className="bg-bg-surface border border-border rounded px-1.5 py-0.5 text-[9px] text-text-muted">Esc</kbd> to close
          </span>
          <span className="text-[10px] text-text-dim">
            Saving will clear LangSmith sync for re-upload
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Right Panel ───

function RightPanel({
  documents,
  selectedDocId,
  onSelectDoc,
  existingSpans,
  onAddSpan,
}: {
  documents: { _id: Id<"documents">; docId: string; title: string }[];
  selectedDocId: Id<"documents"> | null;
  onSelectDoc: (id: Id<"documents">) => void;
  existingSpans: SpanInfo[];
  onAddSpan: (span: SpanInfo) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  // Load selected document content
  const docContent = useQuery(
    api.crud.documents.getContent,
    selectedDocId ? { id: selectedDocId } : "skip",
  );

  // Load all doc contents for search (lazy — only when search is active)
  const [loadedDocs, setLoadedDocs] = useState<
    Map<string, { docId: string; title: string; content: string }>
  >(new Map());

  // When docContent loads, cache it
  useEffect(() => {
    if (docContent) {
      setLoadedDocs((prev) => {
        const next = new Map(prev);
        next.set(docContent.docId, {
          docId: docContent.docId,
          title: docContent.docId,
          content: docContent.content,
        });
        return next;
      });
    }
  }, [docContent]);

  // Search results (searchDocuments imported at top of file)
  const searchResults = searchQuery.trim()
    ? searchDocuments(searchQuery, [...loadedDocs.values()], 10)
    : [];

  // Text selection state
  const [selection, setSelection] = useState<{
    text: string;
    start: number;
    end: number;
  } | null>(null);

  // Handle text selection in document
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelection(null);
      return;
    }

    const container = document.getElementById("doc-content-area");
    if (!container) return;

    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }

    // Calculate character offset within the document content
    // Walk text nodes to find the start offset
    const preRange = document.createRange();
    preRange.setStart(container, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + text.length;

    setSelection({ text, start, end });
  }, []);

  function handleAddSelection() {
    if (!selection || !docContent) return;
    onAddSpan({
      docId: docContent.docId,
      start: selection.start,
      end: selection.end,
      text: selection.text,
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  // Highlights for existing spans in the currently viewed doc
  const docSpans = docContent
    ? existingSpans
        .map((s, i) => ({ ...s, colorIndex: i }))
        .filter((s) => s.docId === docContent.docId)
        .sort((a, b) => a.start - b.start)
    : [];

  // Render highlighted document content
  function renderContent(content: string) {
    if (docSpans.length === 0) return content;

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    docSpans.forEach((span, i) => {
      if (span.start > lastEnd) {
        parts.push(content.slice(lastEnd, span.start));
      }
      parts.push(
        <mark
          key={`h-${i}`}
          style={{
            backgroundColor: SPAN_COLORS[span.colorIndex % SPAN_COLORS.length],
            color: "var(--color-text)",
            borderRadius: 2,
            padding: "1px 0",
          }}
        >
          {content.slice(span.start, span.end)}
        </mark>,
      );
      lastEnd = span.end;
    });

    if (lastEnd < content.length) {
      parts.push(content.slice(lastEnd));
    }

    return <>{parts}</>;
  }

  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-2.5 bg-bg-surface border-b border-border flex flex-col gap-2 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search across all documents in KB..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
          />
          <select
            value={selectedDocId ?? ""}
            onChange={(e) => {
              if (e.target.value) onSelectDoc(e.target.value as Id<"documents">);
            }}
            className="bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text min-w-[180px] focus:border-accent outline-none"
          >
            <option value="">Select document...</option>
            {documents.map((d) => (
              <option key={d._id} value={d._id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        {searchQuery && (
          <span className="text-[9px] text-text-dim">
            {searchResults.length} match{searchResults.length !== 1 ? "es" : ""} across {loadedDocs.size} of {documents.length} documents
          </span>
        )}
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="bg-bg-surface border-b border-border px-4 py-2 max-h-[140px] overflow-y-auto flex-shrink-0">
          {searchResults.map((r: { docId: string; docTitle: string; snippet: string; matchStart: number }, i: number) => (
            <button
              key={i}
              onClick={() => {
                const doc = documents.find((d) => d.docId === r.docId);
                if (doc) onSelectDoc(doc._id);
              }}
              className="w-full text-left px-2 py-1.5 rounded text-[10px] hover:bg-bg-hover transition-colors flex items-center gap-2 cursor-pointer"
            >
              <span className="text-accent font-medium min-w-[120px] truncate">
                {r.docTitle}
              </span>
              <span className="text-text-muted truncate">{r.snippet}</span>
            </button>
          ))}
        </div>
      )}

      {/* Document content */}
      <div
        id="doc-content-area"
        className="flex-1 overflow-y-auto p-4 relative"
        onMouseUp={handleMouseUp}
      >
        {docContent ? (
          <pre className="text-xs text-text-muted leading-[1.8] whitespace-pre-wrap break-all font-[inherit]">
            {renderContent(docContent.content)}
          </pre>
        ) : (
          <div className="flex items-center justify-center h-full text-[11px] text-text-dim">
            {selectedDocId ? "Loading document..." : "Select a document to view its content"}
          </div>
        )}

        {/* Floating action bar for text selection */}
        {selection && docContent && (
          <div className="sticky bottom-4 mx-auto w-fit bg-bg-elevated border border-accent rounded-md px-4 py-2 flex items-center gap-3 shadow-xl">
            <span className="text-[10px] text-text-muted">Selected</span>
            <span className="text-[9px] text-accent font-medium">
              {selection.text.length} chars
            </span>
            <button
              onClick={handleAddSelection}
              className="text-[10px] font-semibold bg-accent text-bg-elevated px-3 py-1 rounded cursor-pointer hover:bg-accent/90 transition-colors"
            >
              + Add as Span
            </button>
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/EditQuestionModal.tsx
git commit -m "feat(frontend): create EditQuestionModal with split-panel layout, span management, and document viewer"
```

---

### Task 6: Wire EditQuestionModal into Dataset Page

**Files:**
- Modify: `packages/frontend/src/app/dataset/page.tsx`

- [ ] **Step 1: Add import and modal rendering**

In `packages/frontend/src/app/dataset/page.tsx`, add the import at the top (with the other component imports):

```typescript
import { EditQuestionModal } from "@/components/EditQuestionModal";
```

Then, after the `DeleteDatasetModal` rendering block, add the EditQuestionModal:

```typescript
{/* Edit Question Modal */}
{editingQuestionIndex !== null &&
  browseDatasetId &&
  selectedKbId &&
  browseQuestions?.[editingQuestionIndex] && (
    <EditQuestionModal
      question={{
        _id: browseQuestions[editingQuestionIndex]._id,
        queryText: browseQuestions[editingQuestionIndex].queryText,
        sourceDocId: browseQuestions[editingQuestionIndex].sourceDocId,
        relevantSpans: browseQuestions[editingQuestionIndex].relevantSpans,
      }}
      kbId={selectedKbId}
      onClose={() => setEditingQuestionIndex(null)}
    />
  )}
```

Note: The `browseQuestions` data from `useQuery(api.crud.questions.byDataset)` returns full Convex records with `_id`, `queryText`, etc. — exactly what `EditQuestionModal` needs.

- [ ] **Step 2: Verify build compiles**

Run: `cd packages/frontend && npx next build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/dataset/page.tsx
git commit -m "feat(frontend): wire EditQuestionModal into Dataset page"
```

---

**Known v1 limitation:** Fuzzy search only covers documents the user has viewed during the modal session (cached in `loadedDocs`). The search hint in the toolbar shows how many docs are covered. Users browse docs via the dropdown to add them to the search index. Server-side search can be added later if this becomes a friction point.

---

### Task 7: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Run backend tests**

```bash
cd packages/backend && npx vitest run
```

Expected: All tests pass, including the new `questions.test.ts`.

- [ ] **Step 2: Build frontend**

```bash
cd packages/frontend && npx next build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Manual smoke test**

Start the dev servers and verify:

```bash
# Terminal 1: Backend
cd packages/backend && npx convex dev

# Terminal 2: Frontend  
cd packages/frontend && npx next dev
```

Verify:
1. Nav shows "Dataset" instead of "Generate"
2. URL is `/dataset` (not `/generate`)
3. ModeSelector card says "Dataset"
4. Question list is flat (no doc grouping)
5. Source filter buttons work (All / Generated / Real-world)
6. Edit button appears on hover over a question
7. Clicking edit opens the split-panel modal
8. Can edit question text
9. Can delete a span (hover → delete → confirm)
10. Can select text in a document and add as span
11. Can navigate between documents via left panel or dropdown
12. Save updates the question and closes the modal
13. Unsaved changes indicator works

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
