# Agents Page Experiment Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Experiment mode to the Agents page with a 4-pane resizable layout for running agent experiments and annotating results inline.

**Architecture:** Incremental refactor — add mode toggle to existing agents page, build new experiment-mode components in `src/components/agent-experiments/`, add one backend query (`byOrg`). Reuse all existing annotation mutations/queries. Existing experiments page stays untouched.

**Tech Stack:** Next.js 16 (App Router), React, Convex (reactive queries/mutations), Tailwind CSS v4 (dark theme), TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-04-16-agents-page-experiment-mode-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/frontend/src/components/agent-experiments/ResizablePanes.tsx` | Generic resizable pane container with localStorage persistence |
| `packages/frontend/src/components/agent-experiments/ExperimentModeLayout.tsx` | Orchestrator — 4-pane layout, state management, data queries |
| `packages/frontend/src/components/agent-experiments/ExperimentRunsSidebar.tsx` | Collapsible runs list with status badges |
| `packages/frontend/src/components/agent-experiments/ExperimentQuestionList.tsx` | Question list with filters, search, progress bar, keyboard nav |
| `packages/frontend/src/components/agent-experiments/ExperimentAnnotationPane.tsx` | Answer display + rating buttons + tags + comment |
| `packages/frontend/src/components/agent-experiments/ExperimentMetadataPane.tsx` | Collapsible tool calls, chunks, scores, ground truth |
| `packages/frontend/src/components/agent-experiments/CreateAgentExperimentModal.tsx` | Modal: name + agent + dataset selection → run |

### Modified Files

| File | Change |
|------|--------|
| `packages/backend/convex/experiments/orchestration.ts` | Add `byOrg` public query |
| `packages/frontend/src/app/agents/page.tsx` | Add mode toggle, conditionally render Create layout or ExperimentModeLayout |

### Reference Files (read-only, for patterns)

| File | What to reference |
|------|-------------------|
| `packages/frontend/src/app/retrievers/page.tsx` | Mode toggle pattern, top bar layout, CSS classes |
| `packages/frontend/src/app/experiments/[id]/annotate/page.tsx` | Annotation state management, keyboard shortcuts, filtering logic |
| `packages/frontend/src/app/experiments/[id]/annotate/_components/AnnotationWorkspace.tsx` | Answer display, rating buttons layout |
| `packages/frontend/src/app/experiments/[id]/annotate/_components/QuestionListPane.tsx` | Question list item rendering, filter UI |
| `packages/frontend/src/app/experiments/[id]/annotate/_components/MetadataPane.tsx` | Collapsible sections, chunk/tool rendering |
| `packages/frontend/src/app/experiments/[id]/annotate/_components/TagsSection.tsx` | Tag autocomplete, add/remove pattern |
| `packages/frontend/src/app/experiments/[id]/annotate/_components/RatingButton.tsx` | Rating button component |
| `packages/frontend/src/app/experiments/[id]/annotate/_components/CollapsibleSection.tsx` | Collapsible section component |
| `packages/frontend/src/components/experiments/CreateExperimentModal.tsx` | Modal structure, overlay styling |
| `packages/backend/convex/schema.ts` | Table definitions for experiments, agentExperimentResults, annotations |
| `packages/backend/convex/annotations/crud.ts` | Annotation mutation/query signatures |
| `packages/backend/convex/experiments/agentResults.ts` | Result query signatures |

---

## Tasks

### Task 1: Backend — Add `byOrg` query

**Files:**
- Modify: `packages/backend/convex/experiments/orchestration.ts`

- [ ] **Step 1: Add the `byOrg` public query**

Add after the existing `byDataset` query (around line 553). Follow the same pattern as `byKb` and `byDataset` — use `getAuthContext` for org scoping, query with `by_org` index, order descending:

```typescript
export const byOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db
      .query("experiments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});
```

- [ ] **Step 2: Verify the query compiles**

Run: `cd packages/backend && npx convex dev --once`
Expected: Successful deployment, no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/experiments/orchestration.ts
git commit -m "feat(backend): add byOrg query for experiments"
```

---

### Task 2: ResizablePanes component

**Files:**
- Create: `packages/frontend/src/components/agent-experiments/ResizablePanes.tsx`

- [ ] **Step 1: Create the ResizablePanes component**

This is a generic container that renders children as horizontally resizable panes with draggable dividers. Requirements:
- Accept an array of pane configs: `{ id: string, defaultWidth: number, minWidth: number, content: ReactNode, flex?: boolean }`
- One pane can be `flex: true` (takes remaining space)
- Render vertical drag handles (4px wide) between panes
- On mousedown on a handle, track mousemove to resize adjacent panes
- Persist pane widths to localStorage under a configurable `storageKey`
- Load persisted widths on mount, fall back to defaults
- Support a `collapsedPanes` set — collapsed panes render at 0 width with no handle
- Drag handle: transparent by default, `bg-accent` (`#6ee7b7`) on hover and while dragging

```typescript
"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";

export interface PaneConfig {
  id: string;
  defaultWidth: number;
  minWidth: number;
  content: ReactNode;
  flex?: boolean; // If true, this pane takes remaining space (ignore defaultWidth)
}

interface ResizablePanesProps {
  panes: PaneConfig[];
  storageKey: string;
  collapsedPanes?: Set<string>;
}

export function ResizablePanes({ panes, storageKey, collapsedPanes = new Set() }: ResizablePanesProps) {
  // State: Map<paneId, width> — initialized from localStorage or defaults
  // Ref: container ref for calculating total width
  // Ref: dragging state { handleIndex, startX, startWidths }
  
  // On mount: read localStorage[storageKey], parse JSON, merge with defaults
  // On width change: write to localStorage[storageKey]
  
  // handleMouseDown(handleIndex): set dragging ref, add window mousemove/mouseup listeners
  // handleMouseMove: calculate delta from startX, adjust left/right pane widths (respecting minWidth)
  // handleMouseUp: clear dragging ref, remove listeners, persist to localStorage
  
  // Render: flex container, each pane as a div with style={{ width }} or flex:1,
  //         4px resize handles between visible (non-collapsed) panes
  //         border-right on each pane (except last) via border-border
}
```

Key implementation details:
- Use `useRef` for dragging state (not useState) to avoid re-renders during drag
- Add `cursor: col-resize` to body during drag via `document.body.style.cursor`
- Clean up event listeners in mouseup handler
- Handle collapsed panes: skip rendering them and their adjacent handle
- The flex pane's width is not stored — it fills remaining space via CSS `flex: 1`

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to ResizablePanes.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/agent-experiments/ResizablePanes.tsx
git commit -m "feat(frontend): add ResizablePanes component with localStorage persistence"
```

---

### Task 3: ExperimentRunsSidebar component

**Files:**
- Create: `packages/frontend/src/components/agent-experiments/ExperimentRunsSidebar.tsx`

- [ ] **Step 1: Create the component**

Props:
```typescript
interface ExperimentRunsSidebarProps {
  experiments: Array<{
    _id: Id<"experiments">;
    name: string;
    datasetId: Id<"datasets">;
    agentId?: Id<"agents">;
    status: string;
    totalQuestions?: number;
    processedQuestions?: number;
    createdAt: number;
  }>;
  selectedRunId: Id<"experiments"> | null;
  onSelect: (id: Id<"experiments">) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}
```

Rendering:
- When `collapsed`: render empty div (width handled by ResizablePanes collapsedPanes set)
- When expanded:
  - Header: "Experiment Runs" label (uppercase, 9px, `text-text-dim`)
  - List of runs, each showing:
    - Experiment name (`text-text`, 11px)
    - Question count + status meta line (`text-text-dim`, 9px)
    - Status badge: `completed` (green bg), `running` (yellow bg), `failed` (red bg), etc.
  - Selected run: `bg-bg-elevated`, left border `border-accent`
  - Hover: `bg-bg-elevated`
- Collapse button: `«` positioned absolute top-right, 24px circle, `bg-bg-elevated border-border`

Reference `packages/frontend/src/app/experiments/[id]/annotate/_components/QuestionListPane.tsx` for styling patterns (status dots, font sizes, spacing).

Reference `packages/frontend/src/app/retrievers/page.tsx` for the exact CSS classes used in the retrievers experiment sidebar.

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/agent-experiments/ExperimentRunsSidebar.tsx
git commit -m "feat(frontend): add ExperimentRunsSidebar component"
```

---

### Task 4: ExperimentQuestionList component

**Files:**
- Create: `packages/frontend/src/components/agent-experiments/ExperimentQuestionList.tsx`

- [ ] **Step 1: Create the component**

Props:
```typescript
type Rating = "great" | "good_enough" | "bad";
type FilterType = "all" | "unrated" | Rating;

interface QuestionItem {
  questionId: Id<"questions">;
  queryText: string;
  resultId: Id<"agentExperimentResults"> | null; // null if pending
  rating: Rating | null;
  hasComment: boolean;
}

interface ExperimentQuestionListProps {
  items: QuestionItem[];
  selectedQuestionId: Id<"questions"> | null; // Use question ID instead of index to survive filtering
  onSelectQuestion: (questionId: Id<"questions">) => void;
  stats: { total: number; annotated: number; great: number; good_enough: number; bad: number } | null;
  isLive: boolean;
  pendingCount: number;
}
```

Internal state:
- `filter: FilterType` — defaults to "all"
- `searchQuery: string` — defaults to ""

Rendering — follow `QuestionListPane.tsx` patterns exactly:
- Header row: "Questions" label + "N/M annotated" count
- Search input: `bg-bg-elevated border-border rounded text-text-dim` placeholder "Search questions..."
- Filter buttons: "All" | "Unrated" quick filters, styled with `border-accent text-accent` when active
- Annotation progress bar: colored segments div with `bg-green-500`, `bg-yellow-500`, `bg-red-500`
- Question items:
  - Index number (`text-text-dim`, 9px)
  - Status dot: 8px circle — green (`bg-green-500`) for great, yellow (`bg-yellow-500`) for ok, red (`bg-red-500`) for bad, hollow (`border border-border`) for unrated
  - Question text (10px, 2-line clamp via `-webkit-line-clamp: 2`)
  - Selected: `bg-bg-elevated border-l-2 border-accent`
- If `isLive && pendingCount > 0`: show "N more pending..." italic text at bottom
- Filter logic: use `useMemo` to filter items by rating and search query (match `QuestionListPane.tsx` lines 103-121)

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/agent-experiments/ExperimentQuestionList.tsx
git commit -m "feat(frontend): add ExperimentQuestionList component"
```

---

### Task 5: ExperimentAnnotationPane component

**Files:**
- Create: `packages/frontend/src/components/agent-experiments/ExperimentAnnotationPane.tsx`

- [ ] **Step 1: Create the component**

Props:
```typescript
interface ExperimentAnnotationPaneProps {
  question: { _id: Id<"questions">; queryText: string } | null;
  result: {
    _id: Id<"agentExperimentResults">;
    answerText: string;
    usage?: { promptTokens: number; completionTokens: number };
    latencyMs: number;
    status: "complete" | "error";
    error?: string;
  } | null;
  annotation: {
    rating: "great" | "good_enough" | "bad";
    comment?: string;
    tags?: string[];
  } | null;
  allTags: string[];
  isPending: boolean; // true if question has no result yet
  onRate: (rating: "great" | "good_enough" | "bad") => void;
  onCommentChange: (comment: string) => void;
  onTagsChange: (tags: string[]) => void;
}
```

Rendering — reference `AnnotationWorkspace.tsx` and `RatingButton.tsx`:
- **Empty state** (no question selected): centered message "Select a question to annotate" with summary stats
- **Pending state** (`isPending`): question text shown, answer area shows skeleton shimmer animation
- **Active state**:
  - Section label "Question" (9px uppercase `text-text-dim`)
  - Question text (13px `text-text`)
  - Section label "Agent Answer" with metadata: token count (from `usage.promptTokens + usage.completionTokens`), latency (`latencyMs`ms), Raw/Rendered toggle
  - Answer box: `bg-bg-elevated rounded-md p-3`, scrollable, render markdown or raw text based on toggle
  - If `result.status === "error"`: show error message in red instead of answer
  - Rating row: 3 buttons — "👍 Great [1]", "👌 Good Enough [2]", "👎 Bad [3]"
    - Active button styles: great → `bg-green-900/50 border-green-500 text-green-400`, ok → `bg-yellow-900/50 border-yellow-500 text-yellow-400`, bad → `bg-red-900/50 border-red-500 text-red-400`
    - Inactive: `bg-bg-elevated border-border text-text-dim`
  - Tags row (only visible if rated): tag chips + "+ add tag" dashed button
    - Tag autocomplete: filter `allTags` by input, show dropdown
    - Reference `TagsSection.tsx` for the autocomplete pattern
  - Comment textarea: `bg-bg-elevated border-border rounded text-text-dim`, 2 rows, placeholder "Add a comment (optional)..."

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/agent-experiments/ExperimentAnnotationPane.tsx
git commit -m "feat(frontend): add ExperimentAnnotationPane component"
```

---

### Task 6: ExperimentMetadataPane component

**Files:**
- Create: `packages/frontend/src/components/agent-experiments/ExperimentMetadataPane.tsx`

- [ ] **Step 1: Create the component**

Props:
```typescript
interface ExperimentMetadataPaneProps {
  result: {
    toolCalls: Array<{ toolName: string; query: string; retrieverId?: string; chunks: Array<{ content: string; docId: string; start: number; end: number }> }>;
    retrievedChunks: Array<{ content: string; docId: string; start: number; end: number }>;
    scores?: Record<string, number>;
  } | null;
  question: {
    groundTruth?: Array<{ docId: string; spans: Array<{ start: number; end: number }> }>;
  } | null;
}
```

Rendering — reference `MetadataPane.tsx` and `CollapsibleSection.tsx`:
- Header: "Details" label (9px uppercase `text-text-dim`)
- **Empty state** (no result): centered "Select a question to see details"
- **Active state** — 4 collapsible sections:

  1. **Tool Calls** (default collapsed):
     - Each tool: card with `bg-bg-elevated rounded p-2`
     - Tool name in `text-accent` (10px)
     - Query/args in `text-text-dim` (9px)
     - Result count in `text-text-dim`

  2. **Retrieved Chunks** (default expanded):
     - Each chunk: card with `bg-bg-elevated rounded p-2`
     - Header row: document name + similarity score (if available)
     - Content snippet (9px `text-text-dim`, 3-line clamp)

  3. **Scores** (default collapsed):
     - Key-value rows: label left (`text-text-dim`), value right (`text-text`)
     - If no scores: show "No scores available"

  4. **Ground Truth** (default collapsed):
     - Show spans from question's ground truth data
     - Document ID + character span range
     - If no ground truth: show "No ground truth available"

- Collapsible toggle: `▸` (collapsed) / `▾` (expanded) + section title + item count in parens. Use internal `useState` per section for open/closed state.

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/agent-experiments/ExperimentMetadataPane.tsx
git commit -m "feat(frontend): add ExperimentMetadataPane component"
```

---

### Task 7: CreateAgentExperimentModal component

**Files:**
- Create: `packages/frontend/src/components/agent-experiments/CreateAgentExperimentModal.tsx`

- [ ] **Step 1: Create the component**

Props:
```typescript
interface CreateAgentExperimentModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (experimentId: Id<"experiments">) => void;
}
```

Internal state:
- `name: string` — auto-generated default, updates reactively
- `selectedAgentId: Id<"agents"> | null`
- `selectedDatasetId: Id<"datasets"> | null`
- `creating: boolean`
- `error: string | null`

Queries:
- `useQuery(api.crud.agents.byOrg)` — get agents for the org (no args)
- `useQuery(api.crud.datasets.list)` — get datasets for the org (no args)

Auto-generated name: When agent or dataset selection changes, update `name` to `"${agentName} — ${datasetName} — ${new Date().toISOString().slice(0, 10)}"`. Only auto-update if user hasn't manually edited the name.

On submit:
```typescript
const startExperiment = useMutation(api.experiments.orchestration.startAgentExperiment);
// ...
const experimentId = await startExperiment({
  datasetId: selectedDatasetId,
  agentId: selectedAgentId,
  name,
});
onCreated(experimentId);
onClose();
```

Rendering — reference `CreateExperimentModal.tsx` for modal structure:
- Overlay: `fixed inset-0 bg-black/60 backdrop-blur-sm z-50`
- Modal: `bg-bg-elevated rounded-lg border border-border w-[480px] max-h-[85vh] overflow-y-auto`
- Header: "New Agent Experiment" title + close X button
- Fields: each with label (11px uppercase `text-text-dim`) + input/select
  - Experiment name: text input
  - Agent: dropdown, shows agent name + status badge, only `status === "ready"` selectable (others disabled/grayed)
  - Dataset: dropdown, shows dataset name + question count
- Footer: Cancel + "Run Experiment" primary button
- Validation: all three fields required, agent must be "ready"

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/agent-experiments/CreateAgentExperimentModal.tsx
git commit -m "feat(frontend): add CreateAgentExperimentModal component"
```

---

### Task 8: ExperimentModeLayout orchestrator

**Files:**
- Create: `packages/frontend/src/components/agent-experiments/ExperimentModeLayout.tsx`

- [ ] **Step 1: Create the orchestrator component**

This is the main component that wires everything together.

Props:
```typescript
interface ExperimentModeLayoutProps {
  // No props needed — all data comes from Convex queries
}
```

Internal state:
- `selectedRunId: Id<"experiments"> | null`
- `selectedQuestionId: Id<"questions"> | null` — resets to null on run change. Using ID instead of index so selection survives filtering.
- `runsCollapsed: boolean` — initialized from localStorage (`agents-experiment-runs-collapsed`)
- `showCreateModal: boolean`
- `comment: string` — local comment state, synced from annotation on question change

Queries (all conditional on selectedRunId):
```typescript
const experiments = useQuery(api.experiments.orchestration.byOrg);
const agentExperiments = useMemo(
  () => experiments?.filter(e => e.experimentType === "agent") ?? [],
  [experiments]
);

const selectedExperiment = useQuery(
  api.experiments.orchestration.get,
  selectedRunId ? { id: selectedRunId } : "skip"
);

const results = useQuery(
  api.experiments.agentResults.byExperiment,
  selectedRunId ? { experimentId: selectedRunId } : "skip"
);

const annotations = useQuery(
  api.annotations.crud.byExperiment,
  selectedRunId ? { experimentId: selectedRunId } : "skip"
);

const annotationStats = useQuery(
  api.annotations.crud.stats,
  selectedRunId ? { experimentId: selectedRunId } : "skip"
);

const allTags = useQuery(
  api.annotations.crud.allTags,
  selectedRunId ? { experimentId: selectedRunId } : "skip"
) ?? [];

const questions = useQuery(
  api.crud.questions.byDataset,
  selectedExperiment?.datasetId ? { datasetId: selectedExperiment.datasetId } : "skip"
);
```

Derived state:
```typescript
// Build annotation map: resultId → annotation
const annotationMap = useMemo(() => {
  const map = new Map();
  annotations?.forEach(a => map.set(a.resultId.toString(), a));
  return map;
}, [annotations]);

// Build result map: questionId → result
const resultMap = useMemo(() => {
  const map = new Map();
  results?.forEach(r => map.set(r.questionId.toString(), r));
  return map;
}, [results]);

// Build question items for the list
const questionItems = useMemo(() => {
  if (!questions) return [];
  return questions.map(q => {
    const result = resultMap.get(q._id.toString());
    const annotation = result ? annotationMap.get(result._id.toString()) : null;
    return {
      questionId: q._id,
      queryText: q.queryText,
      resultId: result?._id ?? null,
      rating: annotation?.rating ?? null,
      hasComment: !!annotation?.comment,
    };
  });
}, [questions, resultMap, annotationMap]);

// Current selection — by question ID (survives filtering)
const currentItem = selectedQuestionId
  ? questionItems.find(q => q.questionId === selectedQuestionId) ?? null
  : null;
const currentResult = currentItem?.resultId ? results?.find(r => r._id === currentItem.resultId) : null;
const currentQuestion = currentItem ? questions?.find(q => q._id === currentItem.questionId) : null;
const currentAnnotation = currentItem?.resultId ? annotationMap.get(currentItem.resultId.toString()) : null;
const isPending = currentItem ? currentItem.resultId === null : false;
const isLive = selectedExperiment?.status === "running" || selectedExperiment?.status === "pending";
```

Mutations:
```typescript
const upsertAnnotation = useMutation(api.annotations.crud.upsert);
const updateTags = useMutation(api.annotations.crud.updateTags);

const handleRate = useCallback(async (rating: "great" | "good_enough" | "bad") => {
  if (!currentItem?.resultId) return;
  await upsertAnnotation({ resultId: currentItem.resultId, rating, comment: comment || undefined });
}, [currentItem, comment, upsertAnnotation]);

const handleCommentChange = useCallback((newComment: string) => {
  setComment(newComment);
}, []);

// Debounced comment save: when comment changes and there's an existing annotation, save after 500ms
// Use useEffect + setTimeout pattern

const handleTagsChange = useCallback(async (tags: string[]) => {
  if (!currentItem?.resultId) return;
  await updateTags({ resultId: currentItem.resultId, tags });
}, [currentItem, updateTags]);
```

Keyboard shortcuts (via `useEffect` with `keydown` listener):
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // Skip if focused on input/textarea
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    
    if (e.key === "1") { e.preventDefault(); handleRate("great"); }
    if (e.key === "2") { e.preventDefault(); handleRate("good_enough"); }
    if (e.key === "3") { e.preventDefault(); handleRate("bad"); }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const currentIdx = questionItems.findIndex(q => q.questionId === selectedQuestionId);
      const nextIdx = e.key === "ArrowUp" ? Math.max(0, currentIdx - 1) : Math.min(questionItems.length - 1, currentIdx + 1);
      if (questionItems[nextIdx]) setSelectedQuestionId(questionItems[nextIdx].questionId);
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [handleRate, questionItems, selectedQuestionId]);
```

Sync comment from annotation when question changes:
```typescript
useEffect(() => {
  setComment(currentAnnotation?.comment ?? "");
}, [selectedQuestionId, currentAnnotation?.comment]);
```

Debounced comment save — auto-save comment 500ms after user stops typing, only if annotation exists:
```typescript
useEffect(() => {
  if (!currentItem?.resultId || !currentAnnotation) return;
  const timer = setTimeout(() => {
    if (comment !== (currentAnnotation.comment ?? "")) {
      upsertAnnotation({ resultId: currentItem.resultId!, rating: currentAnnotation.rating, comment: comment || undefined });
    }
  }, 500);
  return () => clearTimeout(timer);
}, [comment, currentItem?.resultId, currentAnnotation]);
```

Rendering — use ResizablePanes:
```tsx
return (
  <div className="flex-1 flex flex-col min-h-0">
    {/* Experiment-mode top bar — annotation stats, keyboard hints, + New Experiment */}
    <div className="flex items-center gap-3 border-b border-border bg-bg px-4 py-1.5">
      {runsCollapsed && selectedExperiment && (
        <>
          <button onClick={() => setRunsCollapsed(false)} className="text-text-dim hover:text-text text-xs">»</button>
          <span className="text-text-dim text-xs bg-bg-elevated px-2 py-0.5 rounded">
            {selectedExperiment.name}
          </span>
          <span className="text-border">|</span>
        </>
      )}
      {annotationStats && (
        <div className="flex gap-3 text-xs text-text-dim">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />{annotationStats.great}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />{annotationStats.good_enough}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />{annotationStats.bad}</span>
        </div>
      )}
      <span className="text-border">|</span>
      <span className="text-xs text-text-dim">⌨ 1/2/3 rate · ↑↓ nav</span>
      <div className="flex-1" />
      <button onClick={() => setShowCreateModal(true)} className="px-3 py-1 bg-accent text-bg-dark rounded text-xs font-semibold hover:bg-accent/90">
        + New Experiment
      </button>
    </div>

    {/* Live banner — only when isLive */}
    {isLive && selectedExperiment && (
      <LiveBanner experiment={selectedExperiment} onCancel={handleCancel} />
    )}
    
    {/* Create modal */}
    <CreateAgentExperimentModal
      open={showCreateModal}
      onClose={() => setShowCreateModal(false)}
      onCreated={(id) => { setSelectedRunId(id); setSelectedQuestionId(null); }}
    />
    
    {/* 4-pane layout */}
    <ResizablePanes
      storageKey="agents-experiment-pane-widths"
      collapsedPanes={runsCollapsed ? new Set(["runs"]) : new Set()}
      panes={[
        { id: "runs", defaultWidth: 180, minWidth: 140, content: <ExperimentRunsSidebar ... /> },
        { id: "questions", defaultWidth: 220, minWidth: 180, content: <ExperimentQuestionList ... /> },
        { id: "answer", defaultWidth: 0, minWidth: 300, flex: true, content: <ExperimentAnnotationPane ... /> },
        { id: "metadata", defaultWidth: 300, minWidth: 200, content: <ExperimentMetadataPane ... /> },
      ]}
    />
  </div>
);
```

The `LiveBanner` is a small inline component within this file:
```tsx
function LiveBanner({ experiment, onCancel }: { experiment: any; onCancel: () => void }) {
  const progress = experiment.totalQuestions 
    ? (experiment.processedQuestions ?? 0) / experiment.totalQuestions * 100 
    : 0;
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-yellow-950/30 border-b border-yellow-800">
      <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
      <span className="text-yellow-400 text-xs">Experiment running</span>
      <span className="text-text-dim text-xs">
        {experiment.processedQuestions ?? 0} / {experiment.totalQuestions ?? "?"} questions
      </span>
      <div className="flex-1 h-1 bg-yellow-950 rounded-full ml-2">
        <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>
      <button onClick={onCancel} className="px-2 py-0.5 bg-red-950 border border-red-500 rounded text-red-400 text-xs hover:bg-red-900">
        Cancel
      </button>
    </div>
  );
}
```

Cancel handler:
```typescript
const cancelExperiment = useMutation(api.experiments.orchestration.cancelAgentExperiment);
const handleCancel = useCallback(async () => {
  if (!selectedRunId) return;
  await cancelExperiment({ experimentId: selectedRunId });
}, [selectedRunId, cancelExperiment]);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/agent-experiments/ExperimentModeLayout.tsx
git commit -m "feat(frontend): add ExperimentModeLayout orchestrator component"
```

---

### Task 9: Wire up agents page with mode toggle

**Files:**
- Modify: `packages/frontend/src/app/agents/page.tsx`

- [ ] **Step 1: Add mode toggle and ExperimentModeLayout to the agents page**

Current structure (reference lines 1-30 of agents/page.tsx):
```tsx
// Current: Header + flex row (sidebar | config | playground)
```

New structure — follow retrievers/page.tsx mode toggle pattern:

```tsx
"use client";

import { Suspense, useState } from "react";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import AgentSidebar from "@/components/AgentSidebar";
import AgentConfigPanel from "@/components/AgentConfigPanel";
import AgentPlayground from "@/components/AgentPlayground";
import { ExperimentModeLayout } from "@/components/agent-experiments/ExperimentModeLayout";

function AgentsPageContent() {
  const [selectedAgentId, setSelectedAgentId] = useState<Id<"agents"> | null>(null);
  const [pageMode, setPageMode] = useState<"create" | "experiment">("create");

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <Header mode="agents" />
      {/* Top bar with mode toggle */}
      <div className="flex items-center gap-3 border-b border-border bg-bg-elevated px-6 py-2.5">
        <span className="text-accent font-semibold text-sm">Agents</span>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              pageMode === "create" ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
            }`}
            onClick={() => setPageMode("create")}
          >
            Create
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              pageMode === "experiment" ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
            }`}
            onClick={() => setPageMode("experiment")}
          >
            Experiment
          </button>
        </div>
        {/* Mode-specific top bar content is handled within each mode's layout */}
      </div>

      {/* Mode content */}
      {pageMode === "create" ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <AgentSidebar selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
          {selectedAgentId ? (
            <div className="flex-1 grid grid-cols-[380px_1fr] min-h-0 min-w-0">
              <div className="border-r border-border flex flex-col min-h-0">
                <AgentConfigPanel agentId={selectedAgentId} />
              </div>
              <AgentPlayground agentId={selectedAgentId} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-text-muted text-sm">Select an agent or create a new one</p>
            </div>
          )}
        </div>
      ) : (
        <ExperimentModeLayout />
      )}
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-bg" />}>
      <AgentsPageContent />
    </Suspense>
  );
}
```

Note: The top bar for experiment mode (annotation stats, keyboard hints, "+ New Experiment" button) is rendered inside `ExperimentModeLayout` as part of a secondary top bar row, OR the `ExperimentModeLayout` renders its own header row below the mode toggle bar. Follow whichever pattern is cleaner — the key is that the mode toggle stays in the page-level top bar, and experiment-specific controls appear below it.

- [ ] **Step 2: Verify everything renders**

Run: `cd packages/frontend && pnpm build 2>&1 | tail -20`
Expected: Successful build.

- [ ] **Step 3: Manual smoke test**

Start the dev server (`pnpm dev` in frontend) and verify:
1. Agents page loads with mode toggle visible
2. "Create" mode shows existing sidebar + config + playground (unchanged)
3. "Experiment" mode shows the 4-pane layout
4. Switching modes preserves page state (selected agent persists in Create mode)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/agents/page.tsx
git commit -m "feat(frontend): add mode toggle and experiment mode to agents page"
```

---

### Task 10: Integration testing and polish

**Files:**
- Possibly modify: any of the components from Tasks 2-8 for fixes

- [ ] **Step 1: Test full annotation flow**

Manual test sequence:
1. Switch to Experiment mode
2. Click "+ New Experiment" — verify modal shows agent and dataset dropdowns
3. Select agent + dataset, run experiment
4. Verify new run appears in sidebar
5. During live run: verify progress banner, questions appearing, annotation on completed questions
6. After completion: select questions, rate with keyboard (1/2/3), verify rating persists
7. Add tags, verify autocomplete works
8. Add comment, verify it saves
9. Navigate with ↑/↓ keys, verify selection moves
10. Verify metadata pane shows tool calls, chunks, scores

- [ ] **Step 2: Test resizable panes**

1. Drag pane borders — verify smooth resizing
2. Reload page — verify widths persist from localStorage
3. Collapse runs sidebar — verify it hides, expand button appears
4. Verify collapsed state persists across reloads

- [ ] **Step 3: Test edge cases**

1. Empty state: no experiments yet — verify CTA shown
2. Failed experiment: verify status badge, error in results
3. Verify Create mode is completely unaffected
4. Navigate to existing Experiments page — verify it still works independently
5. Filter by "Unrated" — verify only unrated questions shown
6. Search for question text — verify filtering works

- [ ] **Step 4: Fix any issues found**

Address bugs discovered during testing. Commit each fix separately.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix(frontend): polish agent experiment mode after integration testing"
```
