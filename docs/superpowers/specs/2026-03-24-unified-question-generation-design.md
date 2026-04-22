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
  actions.ts         — Two new actions: prepareGeneration (Steps 1-3) + generateForDocument (Steps 4-6, per doc)
  orchestration.ts   — Two-phase WorkPool: prepare → per-doc generation → deficit reconciliation on completion
```

### Data Model Changes

```
documents table:       + priority (number, 1-5, default 3)
datasets table:        strategyConfig stores unified config shape
generationJobs table:  phase field simplified (no "ground-truth" phase — citations come inline)
                       + docsProcessed (number, default 0)
                       + totalDocs (number)
                       + currentDocName (optional string, for UI display)
```

---

## Unified Algorithm (7 Steps)

### Inputs

```typescript
interface UnifiedGenerationConfig {
  // Always present
  totalQuestions: number;
  model?: string;                // e.g., "gpt-4o" — defaults to getModel() fallback
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

**When `totalQuestions < numDocs`**: Lower-priority documents are skipped (quota = 0). The system prioritizes higher-priority documents and logs a note: "Prioritizing higher-priority documents — N lower-priority documents skipped due to limited question budget." Documents are sorted by priority descending; the first `totalQuestions` docs each get 1 question minimum, the rest get 0.

**Manual override**: If the user sets allocation percentages, those are used directly instead of priority-based calculation. The UI enforces they sum to 100%.

**Implementation**: `quota.ts`

### Step 2: Match Real-World Questions to Documents

If `realWorldQuestions` is non-empty:

1. Split each document into ~500-char passages (by paragraph boundaries)
2. Embed all passages + all real-world questions (using OpenAI `text-embedding-3-small`)
3. For each real-world question, find the best-matching passage (cosine similarity)
4. If score >= threshold (0.35), it's a match → assign question to that document
5. Output: `matchedByDoc: Record<docId, {question, score}[]>` and `unmatchedQuestions: string[]`

Unmatched questions (knowledge gaps) are stored on the dataset record's `metadata.knowledgeGaps` field for later review.

**Note**: `matchedByDoc` uses plain objects (not `Map`) for JSON serialization when passing between Convex actions and mutations. The `docId` here refers to the document's `docId` string field (not the Convex `_id`), consistent with how eval-lib references documents.

If empty: skip, `matchedByDoc` is `{}`.

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
| **1** | `matched >= quota` | Top `quota` real-world questions by score are direct-reuse candidates. LLM call extracts citations. If citation extraction fails for a direct-reuse question (not actually answerable from this doc), demote it to a style example and generate a replacement. |
| **2** | `0 < matched < quota` | All matched → direct-reuse candidates (validated via citation extraction, demoted to style examples if citation fails). LLM generates `quota - matched` new questions with: matched as few-shot examples + dimension combos for diversity (if available) + preferences. Citations for all. |
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

**Concurrency**: Per-document calls run as separate WorkPool actions (parallelism controlled by WorkPool's `maxParallelism: 10`).

**Large documents**: If a document exceeds 20K characters, split into chunks at paragraph boundaries with ~2K character overlap. Run separate calls per chunk, distributing the document's quota across chunks proportionally by length. No deduplication needed since each chunk has its own sub-quota. Citations are validated against the full original document (not the chunk) to ensure correct global offsets.

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
  overrides?: Record<string, number>,  // docId → percentage
): Map<string, number> {
  if (overrides && Object.keys(overrides).length > 0) {
    // Manual override mode: percentages → absolute counts
    // Rounding remainder to highest-percentage doc
    return applyOverrides(overrides, totalQuestions);
  }

  // Priority-based mode
  const totalWeight = docs.reduce((s, d) => s + d.priority, 0);
  const quotas = new Map<string, number>();
  let allocated = 0;

  // Sort by priority ascending — process low-priority first, highest-priority last gets remainder
  const sorted = [...docs].sort((a, b) => a.priority - b.priority);

  for (let i = 0; i < sorted.length; i++) {
    const doc = sorted[i];
    if (i === sorted.length - 1) {
      // Highest-priority doc gets remainder (ensures rounding favors important docs)
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

### Action Architecture: Two-Phase WorkPool

To stay within Convex's ~10 minute action timeout, the pipeline splits into two phases:

**Phase 1 action: `prepareGeneration`** (single action)
- Loads corpus, calculates per-document quotas
- Embeds and matches real-world questions to documents (if provided)
- Filters dimension combos (if provided)
- Stores the computed plan (quotas, matches, validCombos) in a temporary record
- Enqueues one Phase 2 action per document via WorkPool

**Phase 2 actions: `generateForDocument`** (one per document, parallel via WorkPool)
- Receives: document content, quota, matched real-world questions, valid combos, preferences
- Runs single LLM call for generation + citations
- Validates citations via fuzzy matching
- Retries failed citations once
- Inserts validated questions into Convex
- Reports progress via mutation

```typescript
// Phase 1: Preparation
export const prepareGeneration = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    jobId: v.id("generationJobs"),
    strategyConfig: v.any(),
  },
  handler: async (ctx, args) => {
    const config = args.strategyConfig as UnifiedGenerationConfig;
    const { corpus, docs } = await loadCorpusFromKb(ctx, args.kbId);

    // Step 1: Quota allocation (skip docs with 0 quota)
    const quotas = calculateQuotas(docs, config.totalQuestions);

    // Step 2: Match real-world questions (if provided)
    const matchedByDoc = config.realWorldQuestions?.length
      ? await matchQuestionsToDocuments(corpus, config.realWorldQuestions, embedder)
      : new Map();

    // Step 3: Filter combos (if dimensions provided)
    const validCombos = config.dimensions?.length
      ? await filterCombinations(config.dimensions, llmClient, model)
      : [];

    // Store plan and enqueue per-doc actions
    // Note: quotas and matchedByDoc are serialized as plain objects (not Maps) for Convex mutations
    const docsWithQuota = docs.filter(d => (quotas.get(d.id) ?? 0) > 0);
    await ctx.runMutation(internal.generation.orchestration.savePlanAndEnqueueDocs, {
      jobId: args.jobId,
      datasetId: args.datasetId,
      plan: {
        quotas: Object.fromEntries(quotas),
        matchedByDoc,  // already a plain object
        validCombos,
        config,
      },
      docIds: docsWithQuota.map(d => d.id),
    });
  },
});

// Phase 2: Per-document generation (one WorkPool action per doc)
export const generateForDocument = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    jobId: v.id("generationJobs"),
    docId: v.string(),
    quota: v.number(),
    matchedQuestions: v.any(),   // real-world questions matched to this doc
    validCombos: v.any(),        // filtered dimension combos
    config: v.any(),             // UnifiedGenerationConfig
  },
  handler: async (ctx, args) => {
    // Build scenario-appropriate prompt
    // Single LLM call: generate questions + citations
    // Fuzzy-match citations, replace with exact text
    // Retry failed citations once
    // Insert validated questions
    // Report progress
  },
});
```

### Orchestration Flow

```
startGeneration mutation
  └→ enqueue prepareGeneration via WorkPool
       └→ onPrepareComplete callback
            └→ enqueue N × generateForDocument via WorkPool
                 └→ onDocGenerated callback (per doc)
                      └→ update progress (docsProcessed++)
                      └→ when all docs done: reconcile deficit, finalize job, trigger LangSmith sync
```

### Orchestration Simplification

- `startGeneration` mutation: enqueues `prepareGeneration` (no strategy branching)
- `onPrepareComplete` callback: receives plan, enqueues per-doc actions
- `onDocGenerated` callback: tracks per-doc completion, handles deficit reconciliation when all docs finish
- Remove `onGroundTruthAssigned` callback entirely
- Remove `assignGroundTruthForQuestion` action

### LangSmith Sync

After the unified action completes successfully, fire-and-forget LangSmith dataset sync (same as current: `ctx.scheduler.runAfter(0, internal.langsmith.sync.syncDataset, { datasetId })`). This happens in the `onQuestionGenerated` callback after job completion.

### Progress Reporting

With the two-phase WorkPool architecture, the existing `totalItems`/`processedItems` counters on `generationJobs` are repurposed:

- **Phase 1 (prepare)**: `totalItems = 1`, `processedItems` increments to 1 when preparation completes
- **Phase 2 (per-doc generation)**: `totalItems` is reset to number of documents, `processedItems` increments per completed doc

The additional `totalDocs` and `docsProcessed` fields provide a stable count that doesn't reset between phases, enabling the frontend to show "Generating questions... (3/5 documents)". `currentDocName` is updated by each per-doc action for display purposes.

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
| Action architecture | Two-phase WorkPool (prepare + per-doc) | Avoids Convex 10-min action timeout, enables per-doc progress reporting |
| Low quota (totalQs < numDocs) | Skip low-priority docs | Respects user's question budget; prioritizes important docs |
| Direct-reuse validation | Always validate via citation extraction | Embedding match ≠ answerable; ensures every output question has valid ground truth |
