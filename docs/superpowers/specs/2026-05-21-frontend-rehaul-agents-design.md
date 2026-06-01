# Frontend Re-haul — Agents Section

**Date:** 2026-05-21
**Status:** Draft (rev 2)
**Parent:** `2026-05-21-frontend-rehaul-umbrella-design.md`

## Goal

Move agent-related pages (`agents`, `evaluators`, scenario / experiment / open-coding / axial-coding components) under a single `/agents` section organised as: list landing → per-agent detail with Configure + Evaluate (Scenarios, Experiments, Evaluators). Open coding, Axial coding, and per-run Evaluators live **under a single experiment run** rather than at the agent level, because the underlying workflow is per-run (run a simulation → annotate its conversations → derive failure modes for that run → spawn LLM-judges from those modes).

## Workflow this enables

1. Create / configure an agent (`/configure`).
2. Generate scenarios for the agent (`/evaluate/scenarios`).
3. Run a simulation against those scenarios (`/evaluate/experiments` → `+ New Simulation`).
4. Open the run (`/evaluate/experiments/<runId>`).
5. Annotate each simulated conversation in the run (`.../open-coding`). One annotation per conversation.
6. Once enough are annotated, generate failure modes for **that run** (`.../axial-coding`).
7. Spawn an LLM-judge evaluator per failure mode (`.../evaluators`); evaluators created this way are stored with `agentId` set, and surface on the agent-level `/evaluate/evaluators` list view.

## Routes (new)

```
/agents                                                                  list landing
/agents/[id]/layout.tsx                                                  EntityDetailLayout + agentSidebar
/agents/[id]/configure                                                   agent config + playground (2-pane)
/agents/[id]/evaluate/scenarios                                          scenario list + generation wizard
/agents/[id]/evaluate/experiments                                        simulation run list
/agents/[id]/evaluate/experiments/[runId]/layout.tsx                     EntityDetailLayout + agentRunSidebar (nested)
/agents/[id]/evaluate/experiments/[runId]                                run detail (metadata + transcripts)
/agents/[id]/evaluate/experiments/[runId]/open-coding                    annotate conversations from this run
/agents/[id]/evaluate/experiments/[runId]/axial-coding                   failure modes for this run
/agents/[id]/evaluate/experiments/[runId]/evaluators                     spawn LLM-judges from this run's failure modes
/agents/[id]/evaluate/evaluators                                         agent-level list of evaluators with agentId == this
```

## Routes (deleted in this PR)

- `packages/frontend/src/app/agents/page.tsx` — the legacy single-page "Create / Experiment" agent UI; replaced by `/agents` landing + per-agent routes.
- `packages/frontend/src/app/evaluators/` — entire dir; the legacy KB-scoped evaluator UI.
- `packages/frontend/src/app/experiments/[id]/annotate/` — agent-flavoured open-coding page, replaced by per-run open-coding.
- `packages/frontend/src/app/experiments/[id]/failure-modes/` — agent-flavoured axial-coding page, replaced by per-run axial-coding.
- `packages/frontend/src/app/experiments/[id]/_components/ExperimentNavSidebar.tsx`
- `packages/frontend/src/app/experiments/[id]/layout.tsx`

**Intentionally not touched (handled by other section PRs):**
- `app/experiments/page.tsx` (retriever-experiment mode toggle — KB worktree).
- `Header.tsx`, `ModeSelector.tsx`, `KBDropdown.tsx`, `useKbFromUrl.ts` — still referenced by un-migrated pages owned by KB / Conversations worktrees. Each section cleans up what it owns when the last reference disappears.

## Component contract changes

### Annotation editor — generic, conversation-source agnostic

A new `components/annotation/AnnotationEditor.tsx` replaces today's tightly-wired `ExperimentAnnotationPane`. It owns nothing experiment-specific.

```ts
interface AnnotationEditorProps {
  conversation: { turns: Turn[] };          // read-only display
  existingAnnotation: Annotation | null;
  allTags: string[];
  onUpsert(input: {
    targetId: string;                        // opaque; page wires `resultId`
    rating: "great" | "good_enough" | "bad" | "pass" | "fail";
    comment?: string;
    tags?: string[];
  }): Promise<void>;
}
```

- The component never imports `experimentId`, `resultId`, `datasetId`, `agentId`, or any Convex API path.
- One annotation per conversation (per simulation run instance), not per turn.
- Pages wire the data: `/open-coding` queries `experiments.agentResults.byExperiment` + `annotations.byExperiment` + `annotations.allTags` for *one* run, joins per-row, and feeds `AnnotationEditor` for the currently-selected conversation.
- Future re-use for live conversations / uploaded transcripts becomes a pure wiring change at the page level.

### Agent selection comes from the URL

All agent-scoped components take `agentId` as a prop. No `<select>` dropdown anywhere inside the section. `ExperimentModeLayout`'s `useUrlState` agent-tracking is removed (the dropdown becomes the URL itself).

## Backend changes (additive)

Two schema additions and the queries / mutation tweaks that go with them. No data backfill. No breaking change to existing fields.

### 1. `evaluators.agentId`

```ts
// packages/backend/convex/schema.ts
evaluators: defineTable({
  // ...existing fields...
  agentId: v.optional(v.id("agents")),
})
  .index("by_org", ["orgId"])
  .index("by_agent", ["agentId"]),
```

- Existing rows: `agentId === undefined` → invisible to the new agent-scoped UI.
- `conversationSim.evaluators.create` mutation: accepts optional `agentId` and writes it; the per-run "spawn from failure mode" flow always sets it to the current URL agent.
- New query `conversationSim.evaluators.byAgent({ agentId })`: indexed lookup powering `/agents/<id>/evaluate/evaluators`.

### 2. `conversationScenarios.agentId`

```ts
conversationScenarios: defineTable({
  // ...existing fields...
  agentId: v.optional(v.id("agents")),
})
  .index("by_dataset", ["datasetId"])
  .index("by_agent", ["agentId"]),
```

- Existing rows: `agentId === undefined` → invisible to the new UI.
- `conversationSim.scenarios.create` (and the generation-wizard write path) accept optional `agentId` and write it from the URL.
- New query `conversationSim.scenarios.byAgent({ agentId })` powers `/agents/<id>/evaluate/scenarios`.
- The generation wizard keeps its internal KB + dataset picker. New scenarios are written with **both** `agentId` and `datasetId` populated; `datasetId` stays required so dataset-scoped consumers continue to work unchanged.
- `CreateSimulationModal` scenario picker filters via `scenarios.byAgent({ agentId })`.

### Annotations & failure modes — no backend changes

Both stay FK'd to `experimentId` exactly as today. The agent-level Open coding / Axial coding routes were dropped in favour of per-run sub-routes, which use the existing `annotations.byExperiment`, `annotations.stats`, `failureModes.byExperiment`, and `failureModes.mappingsByExperiment` queries without modification.

## Shell reuse (no fork)

The KB section PR (#77) upgrades the shared shell. To avoid divergence, this PR **cherry-picks** those upgraded files file-by-file (no merge, no PR coupling) and only edits the agent-specific pieces. When PRs land in either order, the overlapping shell files have identical content → no merge conflict.

Files brought in from `origin/worktree-frontend-rehaul-kb-branch`:

| File | What it adds |
|---|---|
| `components/shell/EntityDetailLayout.tsx` | Collapsible sidebar (icon-only collapsed mode, `localStorage` key `shell:sidebar-collapsed`); `fullWidth` prop; `h-screen` flex shell; `SidebarItem.icon`. |
| `components/shell/sidebars.tsx` (replaces `.ts`) | Shared icon set; `kbSidebar` + `agentSidebar` exports. |
| `components/shell/Spinner.tsx` | Standard dot-spinner; replaces ~10 inline copies across the codebase. |
| `components/shell/ErrorToast.tsx` | Standard bottom-right error toast. |

Agent-only changes layered on top:
- `sidebars.tsx::agentSidebar` — Open coding and Axial coding removed (they live per-run); Evaluators stays.
- `sidebars.tsx::agentRunSidebar(agentId, runId)` — new export for the run sub-section.
- `lib/useAgentBreadcrumb.ts` — mirrors `useKbBreadcrumb`; subscribes to `api.crud.agents.get` and returns `{ agent, labelOverrides }`.

## Sidebar structure

```
agentSidebar(agentId):                 agentRunSidebar(agentId, runId):
  Configure                              Run detail
  Evaluate                               Open coding
    ├─ Scenarios                         Axial coding
    ├─ Experiments                       Evaluators
    └─ Evaluators
```

`/agents/[id]/evaluate/experiments/[runId]/layout.tsx` swaps the sidebar to `agentRunSidebar(agentId, runId)` so the user navigates the run sub-section in the same left-rail pattern instead of nested tabs.

## Page wiring (selected, non-obvious)

### `/agents` (landing)
- `EntityListLayout` with grid of agent cards.
- Data: `crud.agents.byOrg`.
- `+ New agent` calls `crud.agents.create` with sensible defaults (lifted from today's inline create) then navigates to `/agents/<newId>/configure`.

### `/agents/[id]/configure`
- Two-pane: `AgentConfigPanel` (left, 380px) | `AgentPlayground` (right, fills remainder).
- `agentId` is parsed from `params`.

### `/agents/[id]/evaluate/scenarios`
- Data: `conversationSim.scenarios.byAgent({ agentId })`.
- Generation wizard reused as-is; on submit, server-side action writes scenarios with both `agentId` and `datasetId`.
- Detail / edit stay as modals.

### `/agents/[id]/evaluate/experiments` (run list)
- Data: `conversationSim.orchestration.byAgent({ agentId })`.
- Sticky "Running simulation" banner appears under the TopBar when any sim has status `running` or `pending`. Component reads from the same query.
- `+ New Simulation` opens `CreateSimulationModal` (scenario picker scoped to this agent).

### `/agents/[id]/evaluate/experiments/[runId]` (run detail)
- Layout swaps to `agentRunSidebar`.
- Data: `conversationSim.orchestration.get`, `conversationSim.runs.bySimulation`, `experiments.agentResults.byExperiment` (or the conversationSim equivalent — to be confirmed at implementation time).
- Reused components: `ExperimentMetadataPane`, `ExperimentQuestionList`, `SimRunDetail`, `ScenarioSummaryBand`, `ToolCallGroup`.

### `/agents/[id]/evaluate/experiments/[runId]/open-coding`
- Data: `experiments.agentResults.byExperiment`, `annotations.byExperiment`, `annotations.stats`, `annotations.allTags`, `crud.questions.byDataset` (joined on `resultId` / `questionId`).
- Three-pane: conversation list (left) | transcript (centre) | `AnnotationEditor` (right).
- Selected conversation in URL as `?conversation=<resultId>`.

### `/agents/[id]/evaluate/experiments/[runId]/axial-coding`
- Reuses the failure-mode UI lifted from `app/experiments/[id]/failure-modes/_components/` (moved to `components/failure-modes/` so it survives the legacy deletion).
- Data unchanged: `failureModes.crud.byExperiment`, `failureModes.crud.mappingsByExperiment`, `annotations.byExperiment`.

### `/agents/[id]/evaluate/experiments/[runId]/evaluators`
- Lists this run's failure modes; each row has a "Create LLM-judge" affordance.
- On create: calls `conversationSim.evaluators.create` with `agentId` set; new evaluator is linked to the failure mode via existing `failureModeEvaluators` (or equivalent) join — exact link path is implementation-time decision (no schema change).

### `/agents/[id]/evaluate/evaluators` (agent-level list)
- Data: `conversationSim.evaluators.byAgent({ agentId })`.
- Read-mostly list (view, edit metadata, delete). Creation pathway is per-run.

## Component reuse map

| Reused as-is | Refactored | Newly created |
|---|---|---|
| `AgentConfigPanel`, `AgentPlayground`, `ScenarioList`, `ScenarioGenerationWizard`, `ScenarioDetail`, `EditScenarioModal`, `ScenarioFields`, `CreateSimulationModal`, `SimulationsSidebar`, `SimRunDetail`, `SimScenarioList`, `ScenarioSummaryBand`, `ToolCallGroup`, `ExperimentMetadataPane`, `ExperimentQuestionList`, `ExperimentRunsSidebar`, `failure-modes/_components/*`, `EvaluatorManager` | `ExperimentAnnotationPane` → renamed `AnnotationEditor`, decoupled from `experimentId` / `resultId` / Convex API paths; only takes `conversation`, `existingAnnotation`, `allTags`, `onUpsert`. | `AgentCard` (landing), `useAgentBreadcrumb`, run-list table component (extracted from `ExperimentRunsSidebar`), running-simulation banner. |

`ExperimentModeLayout.tsx` is dissolved entirely — its responsibilities split across the new page files. Imports from it must be retired.

## Implementation-time investigation required

Two tables today represent "a run for this agent": `experiments` (with `experimentType: "agent"`) and `conversationSimulations`. Annotations / failure modes are foreign-keyed to `experiments` + `agentExperimentResults`; `conversationSimRuns` stores its own annotation as a free-form string on the row. The user-facing workflow in this spec ("run a simulation → annotate the conversations → derive failure modes for that run") maps naturally to `conversationSimulations`, but the structured annotation pipeline lives on `experiments`. Before writing the per-run pages the implementer must answer:

1. Does today's `+ New Simulation` flow (`CreateSimulationModal` → `conversationSim`) **also** create an `experiments` row, or do simulations and agent-experiments produce disjoint sets of "runs"?
2. If disjoint: which one is the runId in `/agents/[id]/evaluate/experiments/[runId]`? Pick one and update the run-list query accordingly. The other becomes legacy / read-only / deferred.
3. If joined: the run detail page should resolve both ids and the annotation pipeline keeps targeting `agentExperimentResults` unchanged.

This is the single largest unknown in the spec. Resolve it before splitting the implementation plan; do not paper over it with an `experimentId | simulationId` union prop.

## Risks

- **Schema additions on hot tables.** Both `evaluators` and `conversationScenarios` get a new optional `agentId` + `by_agent` index. Backfill is intentionally skipped, so existing rows are invisible to the new UI. Reviewer should confirm this is acceptable and that no consumer assumes "all evaluators / all scenarios visible" semantics.
- **Decoupling drift inside `AnnotationEditor`.** Today's annotation pane reaches into experiment-specific state in places (selected `questionId`, pending-comment debouncing keyed by `resultId`). Reviewer should confirm no such reference survives inside the component — pages own all that state.
- **Failure-mode component move.** The lifted `failure-modes/_components/*` will still query Convex by `experimentId`; that's fine, the per-run page passes `experimentId` (the runId is the experiment in this model). Anything inside that component that reads `kbId` / `datasetId` directly is a smell to clean up while moving.
- **Cherry-pick race with PR #77.** Shell files are identical to the KB branch at the time of writing; if PR #77 changes them again before either lands, the second-to-land PR rebases by accepting the upstream version. Mitigation: keep agent-only diffs (Run sidebar, breadcrumb hook) in *separate* files so the shell files stay byte-identical across branches.

## Testing (manual click-through, recorded in PR description)

- `/agents` lists all org agents.
- `+ New agent` creates and navigates to `/agents/<newId>/configure`.
- Agent sidebar Configure / Scenarios / Experiments / Evaluators preserves `agentId` across clicks.
- Sidebar collapse persists across navigation (cross-section, even when bouncing through `/kb`).
- Deep-link to every new route on a fresh browser tab renders correctly.
- Refresh + browser back/forward preserve all selection state, including the per-run sub-nav.
- New scenarios generated under `/agents/<id>/evaluate/scenarios` appear in the agent's `byAgent` list (and do **not** appear under any other agent).
- `+ New Simulation` from `/agents/<id>/evaluate/experiments` shows only the current agent's scenarios.
- Inside a run: `Run detail → Open coding → Axial coding → Evaluators` sidebar nav preserves `agentId` and `runId`.
- Saving an annotation in `.../open-coding` is reflected in `.../axial-coding` (mode counts, unmapped bucket) without manual refresh.
- Creating an LLM-judge in `.../evaluators` shows up under `/agents/<id>/evaluate/evaluators` (agent-level list).
- Old URLs (`/agents` legacy single-page, `/evaluators`, `/experiments/<id>/annotate`, `/experiments/<id>/failure-modes`) 404.

## Out of scope (deferred)

- Pagination on the agent-level evaluators list.
- Polymorphic annotation targets (annotations attaching to live conversations / uploaded transcripts) — explicitly deferred per the umbrella spec.
- Scenarios backfill for existing rows (visible only on the dataset-scoped surfaces until they're re-generated under an agent).
- A cross-run aggregate view of annotations or failure modes (deliberately replaced by the per-run model).
