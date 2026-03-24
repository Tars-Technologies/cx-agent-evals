# Unified Question Generation Pipeline — Design Spec

**Date**: 2026-03-24
**Branch**: `va_generate_questions_improvements`
**Phase**: 2 (from question-generation-improvements.md)
**Status**: Draft

---

## Problem Statement

The current question generation system has three separate strategies (Simple, DimensionDriven, RealWorldGrounded) that:

1. **Produce inconsistent question counts** — dimension-driven regularly returns fewer questions than requested due to funnel losses at filtering, relevance assignment, and sampling stages
2. **Use multi-phase pipelines with information loss** — documents are summarized to one line for combo assignment, losing context; ground truth is extracted in a separate phase that can fail silently
3. **Force users to choose between strategies** — new users don't know which to pick, and there's no way to combine the strengths of all three
4. **Lack document-level control** — no priority system, no per-document allocation, equal distribution regardless of document importance
5. **Have fragile citation extraction** — exact string matching fails when the LLM paraphrases slightly; no fuzzy matching fallback

## Goals

- **Exact question count**: Generate precisely `totalQuestions` questions, no more, no less
- **Unified pipeline**: One system that combines prompt preferences, dimension-driven diversity, and real-world question grounding
- **Single LLM call per document**: Collapse summarization, assignment, generation, and citation extraction into one call
- **Document priority & allocation**: Users control how many questions each document gets
- **Reliable citations**: Fuzzy matching to find verbatim excerpts, with retry on failure
- **Wizard-based configuration**: 4-step wizard replacing the 3-strategy selector

## Non-Goals

- Live chat transcript analysis/parsing (separate future system)
- Multi-document questions (answer spans multiple docs) — future enhancement
- Prompt editing/customization beyond structured preferences
- Auto-priority assignment via LLM (future enhancement)

---

## Architecture Overview

### Current vs. New

**Current**: 3 separate strategies → multi-phase pipelines → separate ground truth phase

```
Simple:           1 LLM call/doc → questions → 1 GT call/question → spans
DimensionDriven:  filter combos → summarize docs → assign combos → sample → generate → 1 GT call/question
RealWorldGrounded: embed → match → direct reuse + few-shot generate → 1 GT call/question
```

**New**: 1 unified pipeline → single LLM call per document (questions + citations together)

```
Unified: filter combos → match real-world Qs → calculate quota/doc → 1 LLM call/doc (generate + cite) → validate citations
```

### Component Structure

```
eval-lib/src/synthetic-datagen/
  unified/
    generator.ts            — UnifiedQuestionGenerator orchestrator
    quota.ts                — Per-document quota allocation (priority/weightage)
    matching.ts             — Real-world question → document matching (embedding-based)
    filtering.ts            — Dimension combo pairwise filtering (reuse existing logic)
    per-doc-generation.ts   — Single LLM call per document (prompt builder + response parser)
    citation-validator.ts   — Fuzzy match + offset extraction + retry
    types.ts                — Unified config & output types
  strategies/               — Existing strategies kept for backwards compat (deprecated)
  ground-truth/             — Existing GT assigner kept for backwards compat (deprecated)
```

### Backend Changes

```
backend/convex/generation/
  actions.ts         — New generateUnified action (single action, per-doc calls inside)
  orchestration.ts   — Simplified: one WorkPool action, no separate ground-truth phase
```

### Data Model Changes

```
documents table:       + priority (number, 1-5, default 3)
datasets table:        strategyConfig stores unified config shape
generationJobs table:  phase field simplified (no "ground-truth" phase — citations come inline)
```

---

## Unified Algorithm (7 Steps)

### Inputs

```typescript
interface UnifiedGenerationConfig {
  // Always present
  totalQuestions: number;
  promptPreferences: {
    questionTypes: string[];     // e.g., ["factoid", "comparison", "procedural"]
    tone: string;                // e.g., "professional but accessible"
    focusAreas: string;          // e.g., "API usage, security"
  };

  // Optional — real-world questions
  realWorldQuestions?: string[];

  // Optional — dimensions
  dimensions?: Dimension[];

  // Optional — per-document allocation overrides
  allocationOverrides?: Record<string, number>;  // docId → percentage (0-100), plain object for JSON serialization
}
```

### Step 1: Per-Document Quota Allocation

Calculate how many questions each document gets based on priority and optional allocation overrides.

**Default (priority-based)**:
```
weight(doc) = doc.priority  (1-5, default 3)
quota(doc) = round(weight(doc) / totalWeight * totalQuestions)
```

Rounding remainder goes to highest-priority documents first. Sum always equals `totalQuestions`.

**Manual override**: If the user sets allocation percentages, those are used directly instead of priority-based calculation. The UI enforces they sum to 100%.

**Implementation**: `quota.ts`

### Step 2: Match Real-World Questions to Documents

If `realWorldQuestions` is non-empty:

1. Split each document into ~500-char passages (by paragraph boundaries)
2. Embed all passages + all real-world questions (using OpenAI `text-embedding-3-small`)
3. For each real-world question, find the best-matching passage (cosine similarity)
4. If score >= threshold (0.35), it's a match → assign question to that document
5. Output: `matchedByDoc: Map<docId, {question, score}[]>` and `unmatchedQuestions: string[]` (knowledge gaps, stored as metadata)

If empty: skip, `matchedByDoc` is empty.

**Implementation**: `matching.ts` (reuse/refactor existing `real-world-grounded/matching.ts`)

### Step 3: Filter Dimension Combos

If `dimensions` is non-empty:

1. Generate all combinations (Cartesian product)
2. For each pair of dimensions, ask LLM which value-pairs are unrealistic (pairwise filtering, concurrency 5)
3. Remove any combo containing an unrealistic pair → `validCombos[]`

If empty: skip, `validCombos = []`.

**Implementation**: `filtering.ts` (reuse existing `dimension-driven/filtering.ts`)

### Step 4: Per-Document Generation Plan

For each document, determine the generation scenario based on available inputs:

| Scenario | Condition | Behavior |
|----------|-----------|----------|
| **1** | `matched >= quota` | Top `quota` real-world questions by score become direct-reuse. LLM call extracts citations only. |
| **2** | `0 < matched < quota` | All matched → direct-reuse. LLM generates `quota - matched` new questions with: matched as few-shot examples + dimension combos (if any) + preferences. Citations for all. |
| **3** | `matched == 0`, combos available | LLM generates all `quota` questions with: dimension combos + real-world examples from other docs (if any) + preferences. |
| **4** | `matched == 0`, no combos | LLM generates all `quota` questions with: preferences only + real-world examples from other docs (if any). Equivalent to current simple strategy. |

### Step 5: Per-Document LLM Call

One call per document. The prompt adapts based on the scenario.

**Prompt structure**:

```
System prompt: Expert question generator for RAG evaluation systems.

[DOCUMENT]
Full document content (split if > 20-30K chars, run multiple calls for chunks)

[STYLE EXAMPLES] (if any real-world questions available — from this doc or globally)
Real questions from actual users:
1. "How do I reset my API key?"
2. "What's the rate limit on the free plan?"
Match this natural style in your generated questions.

[DIVERSITY GUIDANCE] (if dimension combos available)
User profiles for question diversity — pick the most relevant for this document:
- persona=developer, intent=troubleshooting
- persona=manager, intent=evaluating
- ...

[PREFERENCES]
Question types to include (suggested, not enforced): factoid, comparison, procedural, conditional, yes/no
Tone: professional but accessible
Focus areas: API integration, authentication, billing

[TASK]
Generate exactly {N} questions about this document.
For each question, provide a verbatim citation excerpt from the document — the exact text that answers the question.
{If direct-reuse questions}: Also extract citations for these existing questions: [list]

Output JSON:
{
  "questions": [
    {
      "question": "...",
      "citation": "exact verbatim excerpt from the document",
      "source": "generated" | "direct-reuse",
      "profile": "persona=developer, intent=troubleshooting" | null
    }
  ]
}
```

**Concurrency**: Per-document calls run with `mapWithConcurrency(docs, fn, 5)` inside the single Convex action.

**Large documents**: If a document exceeds 20K characters, split into chunks with ~2K overlap. Run separate calls per chunk, then merge and deduplicate questions.

**Implementation**: `per-doc-generation.ts`

### Step 6: Citation Validation

For each question's citation excerpt:

1. **Fuzzy match** against actual document text using a fuzzy string matching library (e.g., `fuzzball` or similar — research best option for JS/TS)
2. If match found with sufficient confidence:
   - **Replace** the LLM's excerpt with the exact text from the document at the matched position
   - Record character offsets (start, end)
3. If no match found: mark question for retry

**Retry for failed citations** (Step 7):
1. Re-send the question + full document to LLM with a stricter prompt: "You MUST quote exact text that appears verbatim in the document. Copy-paste the relevant passage."
2. Fuzzy-match again
3. If still fails after 1 retry: discard the question, note deficit

**Implementation**: `citation-validator.ts`

### Step 7: Deficit Reconciliation

If any questions were discarded in Step 6:

1. Calculate deficit per document
2. Run another per-document LLM call for just the deficit count
3. Re-validate citations
4. After one retry round, accept what we have (do not loop indefinitely)

Final output always has `<= totalQuestions` questions. In practice, with good prompts and fuzzy matching, deficit should be rare (< 5%).

---

## Document Priority System

### Data Model

```typescript
// documents table addition
priority: v.optional(v.number()),  // 1-5, default 3
```

| Priority | Label | Description |
|----------|-------|-------------|
| 1 | Low | Supplementary, edge-case docs (changelog, release notes) |
| 2 | Below Normal | Secondary reference material |
| 3 | Normal | Default for all documents |
| 4 | Above Normal | Important reference docs |
| 5 | Critical | Core docs, most frequently cited |

### Allocation Calculation

```typescript
function calculateQuotas(
  docs: Array<{ id: string; priority: number }>,
  totalQuestions: number,
  overrides?: Map<string, number>,  // docId → percentage
): Map<string, number> {
  if (overrides && overrides.size > 0) {
    // Manual override mode: percentages → absolute counts
    // Rounding remainder to highest-percentage doc
    return applyOverrides(overrides, totalQuestions);
  }

  // Priority-based mode
  const totalWeight = docs.reduce((s, d) => s + d.priority, 0);
  const quotas = new Map<string, number>();
  let allocated = 0;

  // Sort by priority descending for remainder allocation
  const sorted = [...docs].sort((a, b) => b.priority - a.priority);

  for (let i = 0; i < sorted.length; i++) {
    const doc = sorted[i];
    if (i === sorted.length - 1) {
      // Last doc gets remainder
      quotas.set(doc.id, totalQuestions - allocated);
    } else {
      const quota = Math.round((doc.priority / totalWeight) * totalQuestions);
      quotas.set(doc.id, quota);
      allocated += quota;
    }
  }

  return quotas;
}
```

### UI

- Priority displayed as 5 clickable dots in the Review step's document table
- Allocation percentage + absolute count shown per document
- Recalculates live as user adjusts priority dots or total questions slider
- Optional: manual percentage override (advanced, collapsible)

---

## Frontend: 4-Step Wizard

### Step 1: Real-World Questions (First, Recommended)

- Upload area for CSV / text file (one question per line, or CSV with "question" column)
- Text area for typing / pasting questions directly
- "Skip this step" button prominently placed
- Badge: "Recommended" to signal importance
- Counts loaded questions after input

### Step 2: Dimensions (Optional)

- Auto-discover from URL (pre-populated from KB's company URL)
- Clicking "Auto-Discover" opens inline or triggers LLM-based dimension discovery
- Discovered dimensions shown as editable chips (name + values)
- "+ Add dimension" button for manual entry
- "Skip this step" button available

### Step 3: Preferences

- **Question types**: Toggleable chips (Factoid, Comparison, Procedural, Conditional, Multi-hop, Yes/No). Defaults: all selected except Multi-hop.
- **Tone**: Dropdown (Professional but accessible, Casual/conversational, Formal/technical, Support ticket style). Auto-selected based on KB industry.
- **Focus areas**: Text input, auto-filled from KB metadata (industry, topics).

### Step 4: Review & Generate

- Summary cards for each previous step (with "edit" links back to that step)
- Total questions slider (5-200, default based on number of docs × 5)
- Document priority table: doc name, 5-dot priority selector, calculated allocation
- "Generate N Questions" button

### Navigation

- Clickable stepper at top (can jump to any step)
- Back / Next / Skip buttons per step
- All configuration persisted to localStorage (survives page refresh)

### Replaces

- `StrategySelector` component (removed — no more strategy cards)
- `DimensionWizard` modal (folded into Step 2 inline)
- `RealWorldQuestionsModal` (folded into Step 1 inline)
- `GenerateConfig` (replaced by the wizard)

---

## Backend Changes

### New Action: `generateUnified`

Single Convex action that runs the full pipeline:

```typescript
export const generateUnified = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    strategyConfig: v.any(),  // UnifiedGenerationConfig
  },
  handler: async (ctx, args) => {
    const config = args.strategyConfig as UnifiedGenerationConfig;
    const { corpus, docs } = await loadCorpusFromKb(ctx, args.kbId);

    // Step 1: Quota allocation
    const quotas = calculateQuotas(docs, config.totalQuestions);

    // Step 2: Match real-world questions (if provided)
    const matchedByDoc = config.realWorldQuestions?.length
      ? await matchQuestionsToDocuments(corpus, config.realWorldQuestions, embedder)
      : new Map();

    // Step 3: Filter combos (if dimensions provided)
    const validCombos = config.dimensions?.length
      ? await filterCombinations(config.dimensions, llmClient, model)
      : [];

    // Step 4-5: Per-document generation (concurrent)
    const allQuestions = await mapWithConcurrency(
      docs,
      async (doc) => generateForDocument(doc, quotas, matchedByDoc, validCombos, config),
      5,
    );

    // Step 6: Citation validation
    const validated = await validateCitations(allQuestions.flat(), corpus);

    // Step 7: Deficit reconciliation (if needed)
    const final = await reconcileDeficit(validated, docs, quotas, config);

    // Insert questions in batches
    for (const batch of chunk(final, QUESTION_INSERT_BATCH_SIZE)) {
      await ctx.runMutation(internal.crud.questions.insertBatch, { ... });
    }

    return { questionsGenerated: final.length };
  },
});
```

### Orchestration Simplification

- `startGeneration` mutation: always enqueues `generateUnified` (no strategy branching)
- `onQuestionGenerated` callback: marks job complete (no Phase 2 ground-truth transition)
- Remove `onGroundTruthAssigned` callback entirely
- Remove `assignGroundTruthForQuestion` action

### LangSmith Sync

After the unified action completes successfully, fire-and-forget LangSmith dataset sync (same as current: `ctx.scheduler.runAfter(0, internal.langsmith.sync.syncDataset, { datasetId })`). This happens in the `onQuestionGenerated` callback after job completion.

### Progress Reporting

The single-action approach means WorkPool counters show 0/1 → 1/1. For finer-grained progress, the action calls `ctx.runMutation(internal.generation.orchestration.updateProgress, { jobId, phase, detail })` after each per-document call completes. The job record stores `currentDoc` and `docsProcessed` fields for real-time UI updates. This way, the frontend can show "Generating questions... (3/5 documents)" instead of just a spinner.

### Strategy Field

The `strategy` field on datasets and jobs becomes `"unified"` for new generations. Old datasets retain their original strategy value for display purposes.

---

## Fuzzy Citation Matching

### Library Selection

Research spike needed during implementation to select the best fuzzy string matching library. Candidates:

- `fuzzball` — JS port of Python's fuzzywuzzy, token-based matching
- `fuse.js` — fuzzy search library, widely used
- `fast-fuzzy` — optimized for speed
- Custom: normalized substring search (extend existing `normalizedFind`)

**Requirements**:
- Must find a substring within a larger text (not just compare two strings)
- Must handle whitespace normalization, minor word changes, punctuation differences
- Must return the match position (start index) for offset calculation
- Performance: typically matching a 50-200 char excerpt against a 5-20K char document

### Matching Pipeline

```
1. Exact match (indexOf) → if found, done
2. Whitespace-normalized match (current normalizedFind) → if found, done
3. Fuzzy substring match → if confidence > threshold, use match position
4. Fail → mark for retry
```

After match, **replace** LLM excerpt with actual document text at matched position. This ensures:
- `span.text` is always exactly from the document
- `span.start` and `span.end` are always correct
- Character-level evaluation metrics remain accurate

---

## Migration & Backwards Compatibility

- Existing strategies (`SimpleStrategy`, `DimensionDrivenStrategy`, `RealWorldGroundedStrategy`) remain in codebase but are deprecated
- Existing datasets keep their `strategy` field and render correctly
- New datasets use `strategy: "unified"`
- Frontend wizard replaces strategy selector — old strategies not accessible from UI
- Backend actions for old strategies remain callable (for any in-flight jobs) but no new jobs use them

---

## Testing Strategy

### eval-lib Unit Tests

- `quota.ts`: Priority-based allocation, manual overrides, rounding, edge cases (1 doc, equal priority, 0 questions)
- `matching.ts`: Embedding matching (mock embedder), threshold filtering, empty inputs
- `filtering.ts`: Existing tests still pass (reused logic)
- `per-doc-generation.ts`: Prompt construction for all 4 scenarios, JSON parsing, large doc splitting
- `citation-validator.ts`: Exact match, normalized match, fuzzy match, no-match retry, offset correctness
- `generator.ts`: End-to-end with mock LLM, all config combinations (nothing/only-dims/only-rw/both)

### Backend Integration Tests

- `generateUnified` action: mock LLM, verify correct question count, verify citations have offsets
- Orchestration: verify no ground-truth phase, job completes in one phase
- Priority field on documents: CRUD operations

### Frontend

- Wizard step navigation (click through, back, skip)
- Configuration persistence to localStorage
- Priority dot interaction
- Generate button disabled states

---

## Key Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Single call per document vs. multi-phase | Single call | Better quality (LLM sees full doc for both questions + citations), faster, easier debugging |
| Separate combo filtering vs. fold into per-doc call | Keep separate | Filtering is abstract (no doc needed), reduces per-doc prompt size |
| Verbatim excerpts vs. char offsets from LLM | Verbatim excerpts + programmatic offset finding | LLMs are unreliable with char offsets; fuzzy matching is more accurate |
| Exact match vs. fuzzy match for citations | Fuzzy match with fallback chain | LLMs often make minor modifications to excerpts |
| 3 strategies vs. unified | Unified | Simpler UX, combines best of all three, one codebase to maintain |
| Priority scale | 1-5 tiers | More granular than 1-3, multiple docs can share a tier |
| Document priority storage | On documents table (persistent) | KB-level property, not per-generation |
| Allocation override storage | In strategyConfig (per-generation) | Different datasets can have different allocations |
| Wizard step order | Real-world Qs → Dimensions → Preferences → Review | Most impactful input first, progressive refinement |
| Failed citation handling | Retry once, then discard + regenerate | Balance between quality and completion time |
| Real-world question integration | Direct reuse + style guidance for generated questions | Maximizes value from user-provided data |
