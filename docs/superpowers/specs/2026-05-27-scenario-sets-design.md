# Scenario Sets — Design

**Status:** Draft
**Date:** 2026-05-27
**Author:** Ankit (with Claude)
**Scope:** `packages/backend/convex/conversationSim/*`, `packages/backend/convex/schema.ts`, `packages/frontend/src/app/agents/[id]/evaluate/scenarios/**`, `packages/frontend/src/app/agents/[id]/evaluate/experiments/page.tsx`, `packages/frontend/src/components/ScenarioGenerationWizard.tsx`.

## Problem

After the Phase 1 orchestration refactor, `conversationSim.orchestration.start` was simplified to take only `{ agentId, k, … }` and load **all** scenarios for that agent. The old "New Simulation" modal — which passed a `datasetId` — became incompatible and was replaced with a "Coming soon" placeholder.

The deeper issue exposed by this gap: scenarios today are loose objects scoped only to an agent. There is no way to:

- run a simulation against a specific curated batch of scenarios,
- compare two agent prompt versions against the same scenario list reproducibly,
- give a simulation a stable, named target ("ran against set X") that won't drift as more scenarios are added or deleted.

This mirrors a pattern that already works on the RAG side: questions are grouped into datasets under a knowledge base. We want the analogous concept for scenarios.

## Goals

1. Every scenario belongs to exactly one **scenario set**.
2. Sets are produced by a single generation run and are **immutable** afterwards (no per-scenario add/remove/move).
3. A simulation is fully described by `(agent, scenarioSet, k, knobs)` — reproducible and comparable.
4. The "+ New Simulation" modal works end-to-end against this model, replacing the "Coming soon" placeholder.

## Non-goals

- Cross-agent sharing of sets (sets are agent-scoped).
- Multi-set simulations (a simulation runs against exactly one set).
- Manual scenario creation (the "+ Add scenario" button is removed).
- Migration of existing scenario/simulation data — current rows are wiped on deploy.
- Renaming sets, duplicating sets, or "regenerate with same config." These are future enhancements; the snapshotted `generationConfig` is included now so they're cheap to add later.

## Decisions (from brainstorm)

| # | Decision |
|---|----------|
| 1 | Sets are **agent-scoped**, hard membership (one scenario → one set). |
| 2 | Each generation run **auto-creates a new set** with an auto-generated name. |
| 3 | Sets are **immutable** after creation; no add/remove of scenarios. Manual scenario creation is removed entirely. |
| 4 | A simulation references **exactly one** scenario set. |
| 5 | Scenarios page is **two-level**: list of sets → drill into a set. |
| 6 | Existing scenarios/simulations/runs/jobs are **wiped** on deploy. No migration code. |
| 7 | Set table is **thin + snapshots `generationConfig`** (the wizard inputs). Job lifecycle stays on `scenarioGenJobs`. |

## Data model

### New table: `scenarioSets`

```ts
scenarioSets: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),
  name: v.string(),                    // auto-generated: "{Source} – {Mon DD, HH:MM}"
  source: v.union(
    v.literal("synthetic"),
    v.literal("grounded"),
  ),
  generationConfig: v.object({
    kbId: v.optional(v.id("knowledgeBases")),
    transcriptUploadId: v.optional(v.id("livechatUploads")),
    targetCount: v.number(),
    // Plus whatever the wizard currently passes, snapshotted at gen time.
    // Exact field list TBD against current ScenarioGenerationWizard inputs;
    // implementation plan will pin it down.
  }),
  scenarioCount: v.number(),           // denormalized; patched on job completion
  generationJobId: v.id("scenarioGenJobs"),
  createdAt: v.number(),
})
  .index("by_agent", ["agentId"])
  .index("by_org", ["orgId"]);
```

### Modified table: `conversationScenarios`

- Add **required** field `scenarioSetId: v.id("scenarioSets")`.
- `source` union narrows to `synthetic | grounded` (drop `manual`).
- Add index `by_set` on `["scenarioSetId"]`.
- Keep existing `by_agent`, `by_kb`, `by_transcript_upload` indexes (impact analysis still works).

### Modified table: `conversationSimulations`

- Add **required** field `scenarioSetId: v.id("scenarioSets")`.
- `start` loads scenarios via `by_set` index, not `by_agent`.

### Modified table: `scenarioGenJobs`

- Add **required** field `scenarioSetId: v.id("scenarioSets")`.
- Generation flow: insert the `scenarioSets` row first, then the job row pointing at it, then enqueue.

### Wipe on deploy

The deploy script (or a one-shot migration mutation invoked manually) clears:

- `conversationScenarios`
- `conversationSimulations`
- `conversationSimRuns`
- `scenarioGenJobs`

This avoids dangling foreign-key references (existing sim rows would point at scenarios with no set). The wipe scope and mechanism is finalized in the implementation plan.

## Flows

### Generation

1. User clicks "✨ Generate" on `/agents/[id]/evaluate/scenarios`.
2. `ScenarioGenerationWizard` opens unchanged (source picker, KB/transcript picker, target count, etc.).
3. Submit calls `conversationSim.generation.startJob` (existing entry point). The mutation now:
   - inserts a `scenarioSets` row (`scenarioCount: 0`, snapshotted `generationConfig`, auto-generated `name`),
   - inserts a `scenarioGenJobs` row referencing that set,
   - enqueues the existing generation action with both ids.
4. The generation action writes each produced scenario with `scenarioSetId` set.
5. On job completion, the orchestration callback patches `scenarioCount` onto the set.
6. UI reactively shows the new set card with live count during generation.

### Simulation

1. User clicks "+ New Simulation" on `/agents/[id]/evaluate/experiments`.
2. **`CreateSimulationModal`** (rebuilt) shows:
   - **Scenario set** dropdown (lists sets for this agent; disabled with helper text "Generate a scenario set first" if none exist),
   - `k`, `maxTurns`, `concurrency`, `timeoutMs`, optional `userSimModel`/`seed`,
   - "Total runs: `setScenarioCount × k`" live preview.
3. Submit calls `conversationSim.orchestration.start({ agentId, scenarioSetId, k, maxTurns, concurrency, timeoutMs, userSimModel?, seed? })`.
4. `start` mutation:
   - validates agent + set ownership and that set has ≥1 scenario,
   - loads scenarios via the `by_set` index,
   - persists `scenarioSetId` on the new `conversationSimulations` row,
   - enqueues runs as today (unchanged loop body).
5. Per-run completion callback (`onRunComplete`) and evaluator auto-apply are unchanged.

### Deletion & integrity

- **Delete set:** allowed only if no `conversationSimulations` reference the set. Mutation enforces; UI shows a disabled kebab item with tooltip when blocked. Deletion cascades to the set's scenarios (since scenarios cannot exist outside a set).
- **Delete individual scenario:** not exposed in UI (immutability). The `scenarios.remove` mutation is removed.
- **Cancel generation:** cancelling a `scenarioGenJobs` while in-flight also deletes the partially-populated set (since its scenarios were never frozen — count would be wrong and meaningless). Behavior pinned down in implementation plan.

## UX

### `/agents/[id]/evaluate/scenarios` — sets list (top-level)

- Header: "Scenario sets" + right-aligned `✨ Generate` button (opens wizard).
- Empty state: "No scenario sets yet. Generate one to start running simulations."
- Card grid: each card shows
  - name,
  - source badge (synthetic / grounded),
  - scenario count,
  - KB or transcript-upload reference (resolved from `generationConfig`),
  - created date,
  - kebab menu with "Delete set" (disabled with tooltip if any simulation references it).
- Click a card → navigate to `/agents/[id]/evaluate/scenarios/[setId]`.

### `/agents/[id]/evaluate/scenarios/[setId]` — set detail (new)

- Header: set name, breadcrumb back to sets list.
- Metadata row: source, scenario count, created date, KB/transcript reference, expandable "Generation config" panel.
- Body: existing `ScenarioCard` grid (reused), scoped to this set.
- No "+ Add scenario" button. No per-scenario delete action. Read-only beyond the set itself.

### `/agents/[id]/evaluate/experiments` — modal rebuild

- Remove `ComingSoonModal` (`packages/frontend/src/app/agents/[id]/evaluate/experiments/page.tsx:87-111`).
- Add real `CreateSimulationModal` component (lives alongside the experiments page or in `components/`, TBD by implementation plan).
- "+ New Simulation" button: disabled when zero sets exist, helper text in tooltip.
- Simulation rows display the set name (with link to set detail page) alongside existing fields.

### Simulation detail page (existing)

- Add "Scenario set: [name]" row near the top with a link to the set detail page. Single small addition; no structural change.

## Boundaries & responsibilities

- **`conversationSim/scenarios.ts`** — narrows to queries over the new `scenarioSetId` index and an internal mutation for set-scoped insertion. Drop public `create`, `remove`, `update`.
- **`conversationSim/scenarioSets.ts`** (new) — CRUD-ish surface for sets: `byAgent`, `get`, `remove`. Insertion is internal-only (created by the generation flow).
- **`conversationSim/generation.ts` + `generationActions.ts`** — wired to create the set row up front and tag scenarios with `scenarioSetId`. No change to prompt construction or strategy logic.
- **`conversationSim/orchestration.ts`** — `start` mutation gains `scenarioSetId` arg, swaps the `by_agent` scenarios query for `by_set`. Stores `scenarioSetId` on the simulation row.
- **Frontend:** new sets list page, new set detail page, rebuilt simulation modal, small simulation-detail addition. `ScenarioGenerationWizard` itself is largely unchanged — its submit handler still calls the same mutation, which now creates a set under the hood.

## Risks & open questions

- **Generation config schema:** the exact shape of `generationConfig` depends on the current wizard inputs and may differ slightly between synthetic and grounded sources. The implementation plan will read the current wizard and pin the schema.
- **Wipe mechanism:** invoked as a one-shot mutation manually post-deploy vs. an automatic migration script. Low-stakes since this is dev data; implementation plan will pick the simplest approach.
- **Set naming collisions:** auto-names use `Mon DD, HH:MM` which can collide on rapid regeneration. Acceptable for v1; user can mentally disambiguate by scenario count + KB reference. Renaming is a future enhancement.

## Out of scope (future work)

- Renaming sets.
- Duplicating a set as a starting point for edits.
- "Regenerate with same config" action that reads `generationConfig` and re-runs the wizard preloaded.
- Cross-agent set reuse (e.g., for comparing two agent prompt versions on a shared scenario list).
- Multi-set or subset simulations.
