# Question Generation Improvements Plan

Multi-phase improvement plan for the question generation module. Covers bug fixes, strategy redesign, and manual editing capabilities.

**Branch**: `va_generate_questions_improvements`
**Date**: 2026-03-23
**Phases**: 3 (each phase = separate PR with its own design doc + implementation plan)

---

## Current State

### Three Existing Strategies

1. **SimpleStrategy** (`packages/eval-lib/src/synthetic-datagen/strategies/simple/`)
   - Generates N questions per document via single LLM call per doc
   - Config: `queriesPerDoc` (1-50)
   - Prompt asks for diverse question types (factoid, comparison, procedural, conditional, multi-hop, yes/no)

2. **DimensionDrivenStrategy** (`packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/`)
   - 4-phase pipeline: filter dimension combos → summarize docs → assign combos to docs → stratified sample + generate
   - Config: `dimensions[]` (name + values) + `totalQuestions`
   - Dimension discovery via URL scraping + LLM analysis (`discovery.ts`)
   - Diversity comes from user profile combinations (persona x intent x complexity etc.)

3. **RealWorldGroundedStrategy** (`packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/`)
   - Two modes: direct reuse (embed + cosine match questions to docs) + few-shot synthetic generation
   - Config: `realWorldQuestions[]` + `totalSyntheticQuestions` + `matchThreshold`
   - Diversity comes from mimicking real user question patterns

### Key Architecture Points

- **Backend**: Convex WorkPool-based job pipeline. Simple strategy = 1 action per doc. Dimension/real-world = 1 corpus-wide action.
- **Frontend**: Strategy config persisted to localStorage. Generation page has browse/generate modes. Questions displayed in QuestionList grouped by document.
- **Ground truth**: Post-generation LLM step extracts verbatim excerpts → finds character spans in source docs.
- **No dataset delete** mutation exists. **No question add/edit** capability exists.
- **Prompts** are hardcoded in eval-lib strategy files, not visible in frontend.

---

## Item Inventory

| # | Item | Category | Phase |
|---|------|----------|-------|
| 1 | Dimension discovery URL not working ("connection failed") | Bug | 1 |
| 2 | Simple strategy: change "questions per doc" → "total questions" slider | UI Change | 1 |
| 3 | Unified "total questions" slider across all 3 strategies | UI Change | 1 |
| 4 | Show/expose prompts for each strategy (at least readable) | Feature | 2 |
| 5 | Dimension-driven algorithm recap + brainstorm quality improvements | Brainstorm | 2 |
| 6 | New 4th "Combined" strategy as default — multi-step wizard with dimension discovery + real-world questions, all steps skippable. Other 3 strategies behind menu | Strategy Redesign | 2 |
| 7 | Dataset delete with "DELETE" confirmation modal | Feature | 1 |
| 8 | Tab-switching bug (single-char questions, corrupted display on tab switch) | Bug | 1 |
| 9 | Auto-regeneration when ground truth yields no spans (hit exact question count) | Feature | 2 |
| 10 | Dimension-driven generates too few questions | Bug | 1 |
| 11 | Create empty dataset + generate into it later | Feature | 2 |
| 12 | Manual question add/edit on any dataset | Feature | 3 |
| 13 | Span editing (same/different/multiple documents) | Feature | 3 |
| 14 | UI for span editing with document viewer + highlighting | Design | 3 |

---

## Phase 1: Bug Fixes + Quick UI Wins

**Goal**: Fix broken functionality and standardize the question count UX across strategies.

### Items

#### Bug: Dimension discovery not working (#1)
- **Symptom**: User enters URL, clicks "Discover", gets "connection failed check server". No error in Convex shell.
- **Root cause investigation needed**: The DimensionWizard calls `POST /api/discover-dimensions`. Need to verify this Next.js API route exists and is correctly wired to eval-lib's `discoverDimensions()` function. The function itself scrapes the URL + linked pages and calls LLM — could be a missing API route, CORS issue, or missing API key.

#### Bug: Tab-switching corrupts question display (#8)
- **Symptom**: During generation, switching browser tabs and coming back shows many questions with single characters each. Combining them forms the actual question text.
- **Root cause investigation needed**: Likely a Convex reactive query issue — questions may be getting split at character boundaries during insertion, or the `QuestionList` component's grouping/rendering logic has a race condition with WorkPool callbacks writing individual characters vs full questions. Could also be related to batch insertion (`insertBatch`) timing with reactive queries.

#### Bug: Dimension-driven generates too few questions (#10)
- **Root cause investigation needed**: The stratified sampling in `stratifiedSample()` may be over-filtering. The pipeline loses questions at multiple stages: unrealistic combos filtered out → not enough combos assigned to docs → sampling budget underallocated. Need to trace the pipeline with real data to find the bottleneck.

#### UI: Total questions slider for Simple strategy (#2)
- Change `queriesPerDoc` (1-50) input to `totalQuestions` slider
- On generation, distribute equally: `Math.ceil(totalQuestions / numDocs)` per doc
- May need to adjust the backend `startGeneration` to accept `totalQuestions` and compute per-doc count

#### UI: Unified slider across all strategies (#3)
- All 3 strategies should use the same "Total questions to generate" slider component
- Simple: distributes equally across docs
- Dimension-driven: already uses `totalQuestions`
- Real-world: change label from "Synthetic questions to generate" to "Total questions to generate"
- Persist the total questions value

#### Feature: Dataset delete (#7)
- Add `deleteDataset` mutation to `packages/backend/convex/crud/datasets.ts`
- Cascade delete: remove all questions in the dataset, cancel any running generation jobs
- Frontend: confirmation modal requiring user to type "DELETE" in all caps
- Add delete button/option to dataset list UI

### Estimated Scope
- 3 bug investigations + fixes
- 2 UI changes (slider unification)
- 1 new backend mutation + frontend modal
- Touches: eval-lib strategies, backend CRUD + generation, frontend components

---

## Phase 2: New Combined Strategy + Generation Improvements

**Goal**: Create the definitive question generation strategy that combines the best of dimensions + real-world grounding, plus support empty datasets and exact question counts.

### Items

#### New 4th Combined Strategy (#6)
- **Default strategy** shown in the frontend
- Multi-step wizard with ALL steps skippable:
  1. **Dimension discovery** (optional): URL input → auto-discover, or manual entry, or skip
  2. **Real-world questions** (optional): Upload CSV / paste / write manually, or skip
  3. **Configuration**: Total questions slider, any other settings
  4. **Review & Generate**
- If user provides both dimensions + real-world questions: combine diversity mechanisms
- If only dimensions: behaves like dimension-driven
- If only real-world questions: behaves like real-world-grounded
- If neither (all skipped): falls back to simple-style generation
- Other 3 strategies accessible via a "More strategies" menu/dropdown, not prominently displayed

#### Algorithm Improvements (#5)
- Brainstorm ways to improve dimension-driven pipeline quality
- Key areas: better dimension value discovery, smarter combo filtering, improved stratified sampling to actually hit target count
- Consider how to blend dimension-based diversity with real-world style grounding

#### Prompt Visibility (#4)
- Show the prompts used by each strategy somewhere accessible
- Decision needed: read-only display vs editable. At minimum, user should be able to read them.
- Could be a collapsible section in the strategy config, or a separate "Advanced" panel

#### Empty Dataset Creation (#11)
- Allow creating a named dataset without running generation
- Can later generate into it with any strategy, or manually add questions
- Backend: new mutation to create dataset with `status: "empty"` or similar

#### Auto-regeneration for Exact Count (#9)
- After ground truth assignment, if a question has zero spans → remove it
- Automatically regenerate replacement questions to hit the exact target count
- Requires: detecting zero-span questions, computing deficit, re-running generation for deficit count, re-running ground truth assignment on new questions
- Could be a post-generation "refinement" step

### Estimated Scope
- 1 new eval-lib strategy (combined) + integration
- Backend changes for new strategy type + empty datasets
- Major frontend wizard redesign
- Ground truth refinement loop

---

## Phase 3: Manual Question & Span Editing

**Goal**: Full manual control over dataset content — add, edit, delete individual questions and their ground truth spans.

### Items

#### Manual Question Add/Edit (#12)
- Add new questions to any dataset (auto-generated or empty)
- Edit existing question text
- Delete individual questions
- Backend: new mutations `addQuestion`, `updateQuestion`, `deleteQuestion` in questions CRUD
- Frontend: inline editing in QuestionList, "Add Question" button

#### Span Editing (#13)
- Edit ground truth spans for any question
- Add spans from the same document, a different document, or multiple documents
- Remove existing spans
- Backend: mutations to update `relevantSpans` on questions
- Data model consideration: spans reference specific documents via `docId` + character offsets

#### Span Editing UI (#14)
- Document viewer with text highlighting for span selection
- Document picker to select which document(s) to cite
- Click/drag to highlight text → creates span with character offsets
- Visual display of existing spans (highlighted regions)
- Save workflow: update question with new/edited spans
- **Requires frontend-design skill** for the UI design — this is the most complex UI piece

### Estimated Scope
- Backend CRUD additions for questions
- Complex frontend UI: inline editing + document viewer with span selection
- Multi-document span assignment UX
- This phase benefits from Phases 1 & 2 being stable first

---

## Key File Locations

### eval-lib (strategies + prompts)
- `packages/eval-lib/src/synthetic-datagen/strategies/simple/generator.ts` — SimpleStrategy + prompts
- `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/` — DimensionDrivenStrategy
  - `discovery.ts` — dimension auto-discovery from URL
  - `filtering.ts` — pairwise combo filtering
  - `relevance.ts` — doc summarization + combo-to-doc assignment
  - `generator.ts` — stratified sampling + batch generation
- `packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/` — RealWorldGroundedStrategy
- `packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts` — ground truth span assignment

### Backend (Convex)
- `packages/backend/convex/generation/orchestration.ts` — job creation, WorkPool setup
- `packages/backend/convex/generation/actions.ts` — strategy execution actions ("use node")
- `packages/backend/convex/crud/datasets.ts` — dataset CRUD (no delete)
- `packages/backend/convex/crud/questions.ts` — question CRUD (no add/edit/delete)

### Frontend
- `packages/frontend/src/app/generate/page.tsx` — main generation page
- `packages/frontend/src/components/StrategySelector.tsx` — strategy card selector
- `packages/frontend/src/components/GenerateConfig.tsx` — per-strategy config panel
- `packages/frontend/src/components/DimensionWizard.tsx` — 3-step dimension wizard modal
- `packages/frontend/src/components/RealWorldQuestionsModal.tsx` — real-world question upload
- `packages/frontend/src/components/QuestionList.tsx` — question display list
- `packages/frontend/src/components/DocumentViewer.tsx` — document content viewer

---

## Workflow

Each phase follows the superpowers workflow:
1. Design doc (brainstorming skill → spec)
2. Implementation plan (writing-plans skill)
3. Implementation (executing-plans skill)
4. Verification + PR

This document serves as the cross-phase context reference. After completing Phase 1 and clearing context, load this document to pick up Phase 2 with full context of what was done and what remains.
