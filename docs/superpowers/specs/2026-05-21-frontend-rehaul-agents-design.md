# Frontend Re-haul — Agents Section

**Date:** 2026-05-21
**Status:** Draft
**Parent:** `2026-05-21-frontend-rehaul-umbrella-design.md`

## Goal

Move agent-related pages (`agents`, `evaluators`, scenario/experiment/coding components) under a single `/agents` section organized as: list landing → per-agent detail with Configure + Evaluate (Scenarios, Experiments, Open coding, Axial coding, Evaluators).

## Routes (new)

```
/agents                                       → list landing
/agents/<id>/configure                        → agent config + playground
/agents/<id>/evaluate/scenarios               → scenario list + generation wizard
/agents/<id>/evaluate/experiments             → simulation runs
/agents/<id>/evaluate/experiments/<runId>     → run detail (transcripts, results)
/agents/<id>/evaluate/open-coding             → annotate this agent's run results
/agents/<id>/evaluate/axial-coding            → failure modes from annotations
/agents/<id>/evaluate/evaluators              → evaluator config for this agent
```

## Routes (deleted in this PR)

- `/agents` (legacy single-agent page)
- `/evaluators`

## Pages

### `/agents` — landing
- `EntityListLayout` with grid of agent cards (name, description, last-modified, "Open" CTA).
- `+ New agent` opens an agent creation flow (lift from current agents page).
- Backed by `crud/agents.byOrg`.

### `/agents/<id>/configure` — Configure
- Two-pane: agent configuration form on the left (system prompt, tools, model), `AgentPlayground` docked on the right.
- Reuse: `AgentConfigPanel`, `AgentPlayground`, `AgentSidebar` content (reorganized — sidebar is for navigation, configuration sits in the main pane).

### `/agents/<id>/evaluate/scenarios`
- Scenario list + generation wizard. Reuse: `ScenarioList`, `ScenarioGenerationWizard`, `ScenarioFields`, `ScenarioDetail`, `EditScenarioModal`.

### `/agents/<id>/evaluate/experiments`
- List of scenario simulation runs for this agent. Reuse `agent-experiments/` components.

### `/agents/<id>/evaluate/experiments/<runId>`
- Run detail: transcripts, per-question results, scores.

### `/agents/<id>/evaluate/open-coding`
- Annotate this agent's run results across all experiments (not scoped to a single experiment).
- Reuse existing annotation UI but refactor its data binding: today it queries `annotations.byExperiment(experimentId)`; the new page queries by agent.
- The annotation editor component itself takes a generic `conversation` + `onAnnotate` interface — no dataset / retriever-experiment knowledge.

### `/agents/<id>/evaluate/axial-coding`
- Failure-mode grouping over this agent's annotations. Reuse existing failure-mode CRUD/UI.

### `/agents/<id>/evaluate/evaluators`
- Reuse current `/evaluators` page content, scoped to the URL's agent ID.

## Component contract changes

- **Agent selection comes from the URL.** Components currently reading agent via local state / dropdown take an `agentId` prop instead.
- **Open coding / axial coding decouple from dataset & retriever-experiment context.** The annotation editor accepts:
  - `conversation: { turns: Turn[] }`
  - `existingAnnotations: Annotation[]`
  - `onUpsert(annotation): Promise<void>`
  Any leaked references to dataset IDs, retriever results, or experiment-scoped IDs inside the component itself must be removed in this PR. Wiring to today's `agentExperimentResults` data happens at the page level, not inside the component.

## Backend

One new query required:

- **`annotations.byAgent(agentId)`** — lists annotations across all this agent's experiment runs. Join through `agentExperimentResults`. Additive only.

No schema changes. Today's `annotations.resultId → agentExperimentResults` foreign key stays as-is. Polymorphic annotation targets (so annotations can attach to live conversations or transcripts) are deferred.

## Testing

Manual click-through:

- Agents landing renders all agents for the org.
- Click an agent → Configure with breadcrumb.
- Sidebar navigation between Configure / Scenarios / Experiments / Open coding / Axial coding / Evaluators preserves agent ID.
- Open coding lists annotations across all of this agent's experiments, not just one.
- Saving an annotation in open coding updates axial coding's failure-mode view.
- Deep-link, refresh, back/forward preserve everything.

## Risks

- **Decoupling drift.** The annotation editor today may reach into experiment/dataset context. Reviewer should confirm no such references remain inside the component (only at page wiring). Failing this means future Conversations-section annotation reuse will be blocked again.
- **Cross-experiment open-coding performance.** `annotations.byAgent` returns more rows than `byExperiment`. If the list grows large, add pagination at the page level — but only when measured, not preemptively.
