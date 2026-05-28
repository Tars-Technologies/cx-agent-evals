# Agent Runner & Annotation Tool — Implementation Plan

**date:** 2026-03-25
**author:** ankit
**status:** draft
**context:** VFQ telesales AI agent evaluation — meeting decisions from 2026-03-23 and 2026-03-24

---

## Background

The VFQ telesales project needs to prove that an AI agent can match or exceed human sales reps for low-value leads. The agreed 8-step process requires:

1. KB loaded from website (firecrawl) — **exists in repo**
2. Generate 100 questions from real-world transcripts — **exists in repo** (synthetic-datagen strategies)
3. Test 10+ retrievers on KB — **exists in repo** (pipeline retriever with presets)
4. Pick best retriever — **exists in repo** (experiment runner + metrics)
5. Configure agent with best retriever + KB + prompt — **MISSING: agent module**
6. Generate answers for questions using the agent — **MISSING: agent runner in experiments**
7. Build UI to compare AI vs human answers side-by-side — **MISSING: annotation tool**
8. Domain expert tags each answer: great / good enough / bad + comment — **MISSING: annotation workflow**

This plan covers steps 5-8: the **Agent module**, **Agent Runner** (in experiments), and **Annotation/Review Tool**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     cx-agent-evals monorepo                 │
├──────────────┬──────────────────┬───────────────────────────┤
│  eval-lib    │    backend       │         frontend          │
│              │   (convex)       │        (next.js)          │
│              │                  │                           │
│ + agent/     │ + agentActions   │ + /experiments (enhanced) │
│   - Agent    │ + agentRuns      │   - Agent Runner tab      │
│   - Prompt   │ + annotations    │ + /annotations (NEW)      │
│   - Runner   │                  │   - ReviewScreen          │
│              │                  │   - ComparisonView        │
│              │                  │   - AnnotationPanel       │
└──────────────┴──────────────────┴───────────────────────────┘
```

---

## Part 1: Agent Module (eval-lib)

### What it does
A simple RAG agent that takes a question, retrieves relevant chunks using the best retriever, and generates an answer using an LLM. This is NOT a complex multi-turn agent — it's a single-turn Q&A generator.

### New files in `packages/eval-lib/src/agent/`

```
agent/
├── types.ts           # AgentConfig, AgentResponse, AgentPrompt
├── agent.ts           # Agent class — orchestrates retriever + LLM
├── prompt-builder.ts  # Builds system/user prompts from config + retrieved chunks
└── index.ts           # Public exports
```

### Design

```typescript
// types.ts
interface AgentConfig {
  retriever: Retriever;           // from existing retriever system
  llmClient: LLMClient;          // from existing synthetic-datagen/base
  systemPrompt: string;           // agent persona + instructions
  maxChunks: number;              // top-K chunks to include in context
  temperature?: number;
  citeSources?: boolean;          // whether to include chunk references in answer
}

interface AgentResponse {
  answer: string;
  retrievedChunks: PositionAwareChunk[];  // what was retrieved
  citations?: { chunkId: string; text: string }[];  // if citeSources enabled
  tokenUsage?: { prompt: number; completion: number };
  latencyMs: number;
}

// agent.ts
class Agent {
  constructor(config: AgentConfig) {}
  async answer(query: QueryText): Promise<AgentResponse> {
    // 1. Retrieve chunks using configured retriever
    // 2. Build prompt with system prompt + retrieved chunks + query
    // 3. Call LLM
    // 4. Return structured response
  }
}
```

### Why this design
- Reuses existing `Retriever` and `LLMClient` interfaces — no new abstractions
- Composable: swap retriever, prompt, or LLM independently
- Testable: mock LLM client for unit tests (pattern already exists in eval-lib)
- Simple: single-turn only, matching the evaluation use case

---

## Part 2: Agent Runner (Backend + Experiments)

### What it does
Runs an agent against a dataset of questions (with optional human answers for comparison) and stores results. This extends the existing experiment system.

### Schema additions (`packages/backend/convex/schema.ts`)

```typescript
// New table: agentRuns
agentRuns: defineTable({
  organizationId: v.string(),
  knowledgeBaseId: v.id("knowledgeBases"),
  datasetId: v.id("datasets"),
  retrieverId: v.optional(v.string()),       // retriever config identifier
  systemPrompt: v.string(),
  status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
  totalQuestions: v.number(),
  completedQuestions: v.number(),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
}).index("by_org", ["organizationId"])
  .index("by_dataset", ["datasetId"]),

// New table: agentRunResults (one per question per run)
agentRunResults: defineTable({
  agentRunId: v.id("agentRuns"),
  questionId: v.id("questions"),
  query: v.string(),
  agentAnswer: v.string(),
  humanAnswer: v.optional(v.string()),       // from transcript, if available
  retrievedChunks: v.array(v.object({
    chunkId: v.string(),
    text: v.string(),
    score: v.number(),
  })),
  citations: v.optional(v.array(v.object({
    chunkId: v.string(),
    text: v.string(),
  }))),
  latencyMs: v.number(),
  tokenUsage: v.optional(v.object({
    prompt: v.number(),
    completion: v.number(),
  })),
  // Annotation fields (filled later by reviewer)
  annotationStatus: v.optional(v.union(
    v.literal("pending"),
    v.literal("great"),
    v.literal("good_enough"),
    v.literal("bad"),
  )),
  annotationNotes: v.optional(v.string()),
  annotatedBy: v.optional(v.string()),
  annotatedAt: v.optional(v.number()),
}).index("by_run", ["agentRunId"])
  .index("by_annotation_status", ["agentRunId", "annotationStatus"]),
```

### New backend files

```
packages/backend/convex/
├── agentRuns.ts           # CRUD: create, list, get, update status
├── agentRunActions.ts     # Action: execute agent on single question (uses WorkPool)
├── agentRunResults.ts     # CRUD: list results, update annotation fields
```

### Execution flow

1. User configures agent run in UI (pick dataset, retriever, system prompt)
2. `agentRuns.create` mutation creates run + enqueues job items via WorkPool
3. Each job item: `agentRunActions.executeQuestion` action
   - Loads question + KB chunks
   - Runs retriever → gets top chunks
   - Calls OpenAI with system prompt + chunks + question
   - Stores result in `agentRunResults`
4. Progress tracked via `completedQuestions` counter (real-time via Convex)
5. When all done, status → "completed"

### Integration with existing experiments
- Agent runs are a **new tab** in the experiments page, not a replacement
- Existing experiments (retriever evaluation) remain unchanged
- Agent runs reference the same datasets and knowledge bases

---

## Part 3: Annotation Tool (Frontend)

### What it does
A review UI where domain experts compare AI agent answers vs human answers side-by-side and rate each one. Inspired by the Sieve annotation tool's three-panel layout and keyboard-driven workflow.

### New route: `/annotations`

Added as a new section in the frontend (alongside Generate and Experiments).

### UI Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Header: [Generate] [Experiments] [Annotations]     Progress: 23/100 │
├────────────┬─────────────────────────────────────────┬───────────────┤
│            │                                         │               │
│  Item List │     Comparison View                     │   KB Source   │
│            │                                         │   Viewer      │
│  ┌──────┐  │  ┌─────────────┐  ┌──────────────────┐ │               │
│  │ Q1 ● │  │  │ Human Answer│  │  AI Agent Answer  │ │  Document    │
│  │ Q2 ● │  │  │             │  │                   │ │  content     │
│  │ Q3 ○ │  │  │ "The plan   │  │  "Based on the    │ │  with        │
│  │ Q4 ○ │  │  │  costs..."  │  │   pricing page,   │ │  citation    │
│  │ Q5 ○ │  │  │             │  │   the plan..."    │ │  highlights  │
│  │ ...  │  │  └─────────────┘  └──────────────────┘ │               │
│  │      │  │                                         │               │
│  │      │  │  ┌─────────────────────────────────────┐│               │
│  │      │  │  │ Rating: [Great] [Good Enough] [Bad] ││               │
│  │      │  │  │ Notes: [__________________________ ]││               │
│  │      │  │  └─────────────────────────────────────┘│               │
│  │      │  │                                         │               │
└──┴──────┴──┴─────────────────────────────────────────┴───────────────┘
```

### Key features

**1. Three-panel layout** (inspired by Sieve)
- Left: virtualized item list with status dots (green=great, yellow=good enough, red=bad, gray=pending)
- Center: side-by-side comparison of human vs AI answer + annotation controls
- Right: KB document viewer with citation highlighting (reuse from Sieve pattern)

**2. Keyboard shortcuts** (for fast reviewing)
- `j`/`k` or `↓`/`↑` — navigate items
- `1` — rate "great"
- `2` — rate "good enough"
- `3` — rate "bad"
- `n` — focus notes
- Auto-advance to next pending item after rating

**3. Filtering & progress**
- Filter by: all / pending / great / good enough / bad
- Progress bar showing completion (color-coded segments)
- Search by query text

**4. Retrieved chunks display**
- Expandable section showing what chunks the agent retrieved
- Click chunk → highlights in KB source viewer
- Helps reviewer understand WHY the agent gave that answer

**5. Annotation persistence**
- Annotations saved to `agentRunResults` table via Convex mutations
- Real-time — no explicit save button (debounced autosave for notes)
- `annotatedBy` tracks which reviewer made the annotation

### New frontend files

```
packages/frontend/src/
├── app/annotations/
│   └── page.tsx                    # Annotation page (route)
├── components/
│   ├── AnnotationScreen.tsx        # Main three-panel layout
│   ├── AnnotationSidebar.tsx       # Left panel — item list with filters
│   ├── AnnotationItemRow.tsx       # Single item in sidebar
│   ├── ComparisonView.tsx          # Center panel — human vs AI side-by-side
│   ├── AnnotationControls.tsx      # Rating buttons + notes
│   ├── AnnotationToolbar.tsx       # Top bar — progress, filters, export
│   ├── AnnotationSourceViewer.tsx  # Right panel — KB doc with highlights
│   └── AnnotationFilterBar.tsx     # Status filter buttons + search
├── stores/
│   └── annotationStore.ts          # Zustand store for annotation state (optional, could use Convex reactivity directly)
```

### Why a separate /annotations route (not inside experiments)
- Different user persona: domain experts (not engineers)
- Simpler, focused UI — no retriever config, no metrics
- Could be shared with customer later (separate access)
- But accessible from main nav for internal use

---

## Part 4: ModeSelector Update

Update `ModeSelector.tsx` to add "Annotations" as a third tab:

```
[Generate] [Experiments] [Annotations]
```

When an agent run is completed in Experiments, there should be a "Review Answers" button that navigates to `/annotations?runId=<id>`.

---

## Implementation Order

### Phase 1: Agent Module (eval-lib) — ~1 day
1. Create `agent/types.ts` with interfaces
2. Create `agent/prompt-builder.ts`
3. Create `agent/agent.ts` with core logic
4. Add unit tests with mock LLM
5. Export from index

### Phase 2: Agent Run Backend (convex) — ~1-2 days
1. Add schema tables (`agentRuns`, `agentRunResults`)
2. Create `agentRuns.ts` CRUD
3. Create `agentRunActions.ts` with WorkPool execution
4. Create `agentRunResults.ts` with annotation mutations
5. Test with convex-test

### Phase 3: Agent Runner UI (frontend experiments) — ~1 day
1. Add "Agent Run" section/tab in experiments page
2. Agent run configuration form (dataset selector, retriever selector, system prompt editor)
3. Run button + real-time progress
4. Results table showing generated answers

### Phase 4: Annotation Tool (frontend) — ~2-3 days
1. Create annotation route and page
2. Build AnnotationScreen (three-panel layout)
3. Build AnnotationSidebar with virtualized list
4. Build ComparisonView (human vs AI)
5. Build AnnotationControls (rating + notes)
6. Build AnnotationSourceViewer (KB with highlights)
7. Add keyboard shortcuts
8. Add filtering and progress tracking
9. Wire up Convex mutations for annotation persistence

### Phase 5: Integration & Polish — ~1 day
1. Add "Annotations" tab to ModeSelector
2. Add "Review Answers" button in experiment results
3. Export annotations (CSV/JSONL)
4. Progress stats dashboard

---

## Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Agent in eval-lib vs backend | eval-lib (types + logic), backend (execution) | Reusable agent logic, backend handles I/O |
| Annotation as separate route | Yes | Different persona, cleaner UX, shareable |
| State management | Convex reactivity (useQuery) | Already using Convex for real-time, no need for Zustand |
| KB source viewer | Reuse SourceViewer pattern from Sieve | Proven UX for citation highlighting |
| Rating scale | great / good enough / bad | Matches meeting decision (3-point scale) |
| Keyboard shortcuts | Yes | Domain experts will review 100+ items, speed matters |
| Virtualization | @tanstack/react-virtual | Already used in Sieve, scales to thousands |

---

## Data Flow

```
                    ┌─────────────┐
                    │  Questions   │  (from synthetic-datagen or transcript extraction)
                    │  + Human     │
                    │  Answers     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Agent Runner │  (backend action via WorkPool)
                    │  retriever   │
                    │  + LLM call  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ agentRun     │
                    │ Results      │  (AI answer + retrieved chunks + human answer)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Annotation   │  (domain expert reviews)
                    │ Tool UI      │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Annotated    │  (great/good/bad + notes)
                    │ Dataset      │──→ Build automated LLM evaluator
                    └─────────────┘
```

---

## Open Questions

1. **Human answers source**: How do we get human answers into the dataset? Options:
   - Upload CSV with question-answer pairs extracted from transcripts
   - Parse transcripts to extract Q&A pairs (needs a parser)
   - Manual entry in the UI (doesn't scale)
   - **Recommendation**: Add a CSV/JSONL upload for question+human_answer pairs in the dataset UI

2. **Multi-turn conversations**: The current design is single-turn Q&A. Do we need multi-turn?
   - Meeting notes say "break conversations into independent sub-queries"
   - **Recommendation**: Start with single-turn, add multi-turn later if needed

3. **System prompt iteration**: How to manage different prompt versions?
   - **Recommendation**: Store prompt text in agentRuns table, compare runs with different prompts

4. **LangSmith integration**: Should agent run results sync to LangSmith?
   - **Recommendation**: Yes, follow existing langsmithSync pattern — annotated results become evaluation datasets

5. **Customer access**: When do we give VFQ access to the annotation tool?
   - **Recommendation**: After internal testing with 100 questions, share read-only or limited access
