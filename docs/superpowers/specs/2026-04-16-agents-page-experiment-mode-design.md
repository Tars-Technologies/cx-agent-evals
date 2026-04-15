# Agents Page Redesign: Experiment Mode

## Summary

Add an Experiment mode to the existing Agents page, giving it the same two-mode (Create/Experiment) pattern as the Retrievers page. Experiment mode provides a 4-pane layout for running agent experiments against datasets and annotating results inline — no navigation to a separate page required. The existing Experiments page remains untouched.

## Goals

- Consolidate agent creation and agent experimentation onto one page
- Enable inline annotation (rating, tags, comments) without leaving the agents page
- Support live annotation while experiments are still running
- Resizable panes with persisted widths for flexible workspace customization
- No backend changes — reuse all existing mutations, queries, and schema

## Non-Goals

- Multi-agent experiments (one agent per experiment; run separate experiments to compare)
- Removing or modifying the existing Experiments page
- KB selection in experiment mode (agent config already includes retriever tools)
- Shared layout abstraction between Retrievers and Agents pages

## Design

### Page Structure & Mode Toggle

The agents page gains a mode toggle in the top bar, matching the retrievers page pattern.

**Top bar** (shared across both modes):
- Page title "Agents"
- Mode toggle: **Create** | **Experiment** (local React state, defaults to Create)
- Right side: mode-specific controls

**Create mode** — unchanged from current implementation:
- Three-column layout: AgentSidebar | AgentConfigPanel (380px) | AgentPlayground (flex-1)
- All existing components (AgentSidebar, AgentConfigPanel, AgentPlayground) remain as-is

**Experiment mode** — new 4-pane resizable layout:

```
┌──────────┬────────────┬─────────────────────┬──────────────┐
│  Runs    │ Questions  │  Answer + Rating    │  Metadata    │
│  ~180px  │  ~220px    │  flex-1             │  ~300px      │
│          │            │                     │              │
│ « collapse│ search    │  Question text      │ ▸ Tool Calls │
│          │ filters    │  Agent answer       │ ▸ Chunks     │
│ run 1 ✓  │ progress   │  [Great][OK][Bad]   │ ▸ Scores     │
│ run 2 ✓  │ q1 ● ...  │  tags               │ ▸ Ground     │
│ run 3 ✗  │ q2 ○ ...  │  comment            │   Truth      │
│          │ q3 ● ...  │                     │              │
└──────────┴────────────┴─────────────────────┴──────────────┘
```

- No KB selector — agent config already includes retriever tools
- All pane borders are draggable for resizing
- Pane widths saved to localStorage (key: `agents-experiment-pane-widths`)

### Runs Pane (Experiment Runs Sidebar)

- Lists agent experiment runs for the org (uses existing `experiments.orchestration` queries filtered by `experimentType: "agent"`)
- Each run shows: experiment name, dataset name, question count, status badge (completed/running/failed)
- Collapsible via « button — collapses to a thin strip (~28px) with a » expand button
- When collapsed, selected run name appears in the top bar for context
- Clicking a run loads its questions and results into the adjacent panes

### Questions Pane

- Header: "Questions" label + annotation count (e.g., "4/12 annotated")
- Search input for filtering question text
- Quick filters: All, Unrated
- Rating dropdown filter: Great, Good Enough, Bad
- Annotation progress bar: colored segments (green/yellow/red) showing rating distribution
- Question list items show:
  - Index number
  - Colored status dot: green (great), yellow (good enough), red (bad), hollow (unrated)
  - Question text (2-line clamp)
  - Yellow dot overlay if comment exists
- Selected question highlighted with left accent border
- Keyboard navigation: arrow keys to move between questions

### Answer Pane (Agent Response + Rating)

- **Question display**: read-only, full question text
- **Agent answer**: rendered in a scrollable box with raw/rendered toggle
  - Shows token count and latency metadata
- **Rating buttons**: Great [1], Good Enough [2], Bad [3]
  - Keyboard shortcuts: 1/2/3
  - Selected rating highlighted with color (green/yellow/red)
  - Immediately persisted via `annotations.crud.upsert`
- **Tags**: inline tag chips with autocomplete
  - "+ add tag" button with autocomplete from existing tags (`annotations.crud.allTags`)
  - Only editable after a rating is set
  - Persisted via `annotations.crud.updateTags`
- **Comment**: textarea, optional
  - Saved alongside annotation via `upsert`

### Metadata Pane

All sections collapsible (toggle open/closed):

- **Tool Calls**: list of tool invocations with name, query/args, result count
- **Retrieved Chunks**: chunk cards with source document name, similarity score, content snippet
- **Scores**: key-value pairs (relevance, faithfulness, completeness, etc.)
- **Ground Truth**: expected answer spans with document references

Data sourced from `agentExperimentResults` record for the selected question (fields: `toolCalls`, `retrievedChunks`, `scores`).

### New Experiment Modal

Triggered by "+ New Experiment" button in the top bar (experiment mode only).

**Fields:**
- **Experiment name**: text input with auto-generated default ("Agent Name — Dataset Name — YYYY-MM-DD")
- **Agent selector**: dropdown of org agents, shows status badge, only "ready" agents selectable
- **Dataset selector**: dropdown of org datasets, shows question count

**Actions:**
- **Run**: calls existing `experiments.orchestration.startAgentExperiment(datasetId, agentId, name)` mutation
- Creates experiment record, schedules `runAgentExperiment` action
- New run immediately appears in the Runs pane
- Auto-selects the new run

### Live Experiment Support

When a running experiment is selected:

- **Live banner**: yellow bar below top bar with pulsing dot, "Experiment running", progress text ("5/12 questions processed"), progress bar, Cancel button
- **Question list**: completed questions appear as they stream in, with "N more pending..." indicator at bottom
- **Annotation**: completed questions are fully annotatable while experiment continues
- **Pending questions**: if selected, show skeleton loading state in answer pane
- Cancel button calls existing cancellation mutation

### Keyboard Shortcuts

- `1` / `2` / `3`: rate current question (Great / Good Enough / Bad)
- `↑` / `↓`: navigate to previous/next question
- All shortcuts match existing annotation page behavior

## Component Architecture

### New Components

All new components located in `src/components/agent-experiments/`:

| Component | Purpose |
|-----------|---------|
| `ExperimentModeLayout` | Orchestrates 4-pane layout, manages selectedRunId/selectedQuestionIdx state |
| `ExperimentRunsSidebar` | Collapsible runs list with status badges |
| `ExperimentQuestionList` | Question list with filters, search, progress, keyboard nav |
| `ExperimentAnnotationPane` | Answer display + rating + tags + comment |
| `ExperimentMetadataPane` | Collapsible tool calls, chunks, scores, ground truth sections |
| `CreateExperimentModal` | Modal with name/agent/dataset fields + run button |
| `ResizablePanes` | Generic resizable pane container with localStorage persistence |

### Modified Files

| File | Change |
|------|--------|
| `agents/page.tsx` | Add mode toggle, conditionally render Create layout or ExperimentModeLayout |

### Unchanged Files

- `AgentSidebar.tsx` — no changes
- `AgentConfigPanel.tsx` — no changes
- `AgentPlayground.tsx` — no changes
- All files under `src/app/experiments/` — no changes
- All backend files — no changes

### State Management

| State | Scope | Persistence |
|-------|-------|-------------|
| `pageMode` | local React state | none (defaults to Create) |
| `selectedRunId` | local React state | none |
| `selectedQuestionIdx` | local React state | none (resets on run change) |
| `runsCollapsed` | local React state | localStorage |
| pane widths | ResizablePanes internal | localStorage (`agents-experiment-pane-widths`) |
| experiment data | Convex `useQuery` | real-time from backend |
| annotation data | Convex `useQuery`/`useMutation` | real-time from backend |

### Backend Integration (No Changes)

All existing backend functions reused as-is:

**Experiments:**
- `experiments.orchestration.startAgentExperiment` — create + run
- `experiments.orchestration.get` — single experiment
- `experiments.orchestration.byDataset` — list experiments (filter client-side by `experimentType: "agent"`)

**Results:**
- `experiments.agentResults.byExperiment` — all results for a run

**Annotations:**
- `annotations.crud.upsert` — create/update rating + comment
- `annotations.crud.byExperiment` — all annotations for a run
- `annotations.crud.stats` — annotation counts
- `annotations.crud.allTags` — unique tags for autocomplete
- `annotations.crud.updateTags` — update tags on annotation

## Testing Strategy

- Manual testing of all 4 states (annotating, collapsed sidebar, live experiment, empty/no selection)
- Verify keyboard shortcuts (1/2/3 rating, arrow navigation)
- Verify pane resizing + localStorage persistence across page reloads
- Verify sidebar collapse/expand + run name in top bar
- Verify live experiment: progress banner, streaming results, annotation during run
- Verify annotation persistence: rate, tag, comment, then reload — all preserved
- Verify Create mode is completely unaffected by changes
- Verify Experiments page is completely unaffected
