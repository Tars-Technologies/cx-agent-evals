# Error Analysis Restructure

**Date:** 2026-05-28
**Status:** Draft
**Supersedes (partial):** Parts of `2026-05-26-frontend-rehaul-agents-design.md` — specifically the per-run open-coding/axial-coding sub-pages and the agent-flat failure-mode model.

## Goal

Replace the run-tied open-coding / axial-coding UI with a top-level **Error analysis** section. Annotation becomes a per-conversation inline action (pencil → side panel) usable from sim runs, playground, transcript viewers, and inside the section itself. Annotations and failure modes live inside **containers** (one per sim run / upload / playground, plus user-created custom cohorts).

## Why

The May-26 agents-rehaul already decoupled annotation from `experimentId` at the data layer (polymorphic `annotations.source`), but the UI kept open-coding and axial-coding as sub-tabs under a specific run. Two problems with that:

- Failure-mode discovery feels confined to "this run," even though useful clusters often span playground / uploads.
- Bulk annotation work is awkward when scoped to a single run's sub-sidebar.

A container-based model expresses the way qualitative coding actually works: pick a bounded set of conversations, label them, cluster, derive judges.

## The bootstrap workflow this enables

```
1. Play in playground          → conversations created (source=playground)
2. Pencil-annotate any conv    → auto-creates "Playground" container
                                   → annotation lands in it
3. Repeat for sim runs / uploads → each gets its own container on first pencil
4. Open container → Failure modes tab → cluster
5. Spawn judge from a failure mode → evaluator created
6. Validate → ready → auto-applied on subsequent simulations
```

The user never has to "go to" open coding or axial coding as a destination. They just annotate where they are; the container appears in Error analysis when they want the failure-mode workspace.

## Routes

```
/agents/[id]/evaluate/error-analysis                          landing — grid of container cards
/agents/[id]/evaluate/error-analysis/[analysisId]             container detail (default → Annotate tab)
/agents/[id]/evaluate/error-analysis/[analysisId]/annotate    Annotate tab
/agents/[id]/evaluate/error-analysis/[analysisId]/failure-modes  Failure modes tab
```

### Routes deleted vs. the May-26 spec

- `/agents/[id]/evaluate/experiments/[runId]/open-coding`
- `/agents/[id]/evaluate/experiments/[runId]/axial-coding`
- The `agentRunSidebar` export and the per-run `layout.tsx` that swaps it in.

The run detail page becomes a flat conversation viewer with no sub-sidebar. Pencil is the only entry into annotation from a run.

### Sidebar

```
agentSidebar(agentId):
  Configure
  Evaluate
    ├─ Scenarios
    ├─ Experiments
    ├─ Error analysis        ← NEW
    └─ Evaluators
```

## Schema

### New: `errorAnalyses`

The container.

```ts
errorAnalyses: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),
  name: v.string(),                                    // editable
  origin: v.union(
    v.object({ kind: v.literal("simulation"), simulationId: v.id("conversationSimulations") }),
    v.object({ kind: v.literal("upload"),     uploadId:     v.id("livechatUploads") }),
    v.object({ kind: v.literal("playground") }),       // one per agent
    v.object({ kind: v.literal("custom") }),
  ),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_agent", ["agentId"])
  .index("by_agent_origin_kind", ["agentId", "origin.kind"])
  .index("by_simulation", ["origin.simulationId"])
  .index("by_upload",     ["origin.uploadId"])
```

Uniqueness invariant (enforced in the mutation that creates rows): at most one row per `(agentId, origin)` for the three auto-kinds. Multiple `custom` rows allowed.

### New: `errorAnalysisMembers`

Explicit conversation membership. A conversation is "in" an analysis only via a row here.

```ts
errorAnalysisMembers: defineTable({
  orgId: v.string(),
  errorAnalysisId: v.id("errorAnalyses"),
  source: v.union(
    v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
    v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
  ),
  addedVia: v.union(v.literal("annotation"), v.literal("import")),
  addedAt: v.number(),
})
  .index("by_analysis", ["errorAnalysisId"])
  .index("by_analysis_conversation", ["errorAnalysisId", "source.conversationId"])
  .index("by_analysis_transcript",   ["errorAnalysisId", "source.transcriptId"])
```

The `addedVia` column lets the UI distinguish "annotated by user" vs. "imported but not yet annotated" without joining to `annotations`.

### Modified: `annotations`

Add `errorAnalysisId` (required). Polymorphic `source` stays as in the May-26 spec.

```ts
annotations: defineTable({
  orgId: v.string(),
  errorAnalysisId: v.id("errorAnalyses"),              // NEW — every annotation lives in exactly one container
  source: v.union(
    v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
    v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
  ),
  rating: v.union(
    v.literal("great"), v.literal("good_enough"),
    v.literal("bad"),   v.literal("pass"), v.literal("fail"),
  ),
  comment: v.optional(v.string()),
  tags: v.array(v.string()),
  ratedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_org", ["orgId"])
  .index("by_analysis", ["errorAnalysisId"])
  .index("by_conversation", ["source.conversationId"])
  .index("by_transcript",   ["source.transcriptId"])
```

Invariant: an annotation's `errorAnalysisId` must point to a row whose `agentId` matches and whose origin context contains the annotation's source conversation.

### Modified: `failureModes`

Re-scope from agent-level (May-26) back to analysis-level. Failure modes are derived from a defined annotation pool — that pool is the analysis.

```ts
failureModes: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),                             // kept for fast agent-level queries
  errorAnalysisId: v.id("errorAnalyses"),              // NEW — the analysis it was derived from
  name: v.string(),
  description: v.string(),
  order: v.number(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_agent", ["agentId"])
  .index("by_analysis", ["errorAnalysisId"])
```

### Modified: `failureModeMemberships`

Stays polymorphic-source as in May-26; no change.

### Modified: `evaluators.source`

Already discriminated in May-26. The `error_analysis` kind now records the analysis too:

```ts
source: v.union(
  v.object({ kind: v.literal("manual") }),
  v.object({ kind: v.literal("template"),       templateId:    v.id("evaluatorTemplates") }),
  v.object({
    kind: v.literal("error_analysis"),
    failureModeId:    v.id("failureModes"),
    errorAnalysisId:  v.id("errorAnalyses"),         // NEW
  }),
),
```

## Pencil → side panel pattern

A single `AnnotationSidePanel` component is mounted in three viewers:

- Sim run conversation viewer (`/agents/[id]/evaluate/experiments/[runId]`).
- Playground conversation viewer (inside `/agents/[id]/configure`).
- Transcript viewer (inside the Conversations / livechat section).
- Plus the Annotate tab inside `error-analysis/[analysisId]`.

```ts
interface AnnotationSidePanelProps {
  agentId: Id<"agents">;
  conversationRef:
    | { kind: "conversation"; conversationId: Id<"conversations">; originHint: PencilOriginHint }
    | { kind: "transcript";   transcriptId: Id<"livechatConversations">; originHint: PencilOriginHint };
  onClose(): void;
}

type PencilOriginHint =
  | { kind: "simulation"; simulationId: Id<"conversationSimulations"> }
  | { kind: "upload";     uploadId:     Id<"livechatUploads"> }
  | { kind: "playground" }
  | { kind: "analysis";   errorAnalysisId: Id<"errorAnalyses"> };  // when already inside a container
```

On save, the side panel calls one mutation: `annotations.upsertWithAutoContainer`. That mutation:

1. Resolves the target container:
   - If `originHint.kind === "analysis"` → use `originHint.errorAnalysisId`.
   - Else look up the existing `errorAnalyses` row for `(agentId, origin matching the hint)`; create it if missing (lazy creation).
2. Inserts/updates the annotation with the resolved `errorAnalysisId`.
3. Inserts an `errorAnalysisMembers` row with `addedVia: "annotation"` if one doesn't already exist for this conversation.

The panel has the same surface as the existing `AnnotationEditor` from the May-26 spec — the only change is it owns its open/close state and the container-resolution happens server-side.

## Routes & pages

### `/agents/[id]/evaluate/error-analysis` (landing)

- Grid of cards, one per `errorAnalyses` row for the agent.
- Each card shows: origin-kind badge (Simulation / Upload / Playground / Custom), name, member count, annotated count, failure-mode count, judges-spawned count.
- Filter chips: origin kind, has-failure-modes.
- `+ New analysis` opens **CreateCustomCohortModal**.

### `CreateCustomCohortModal`

Step 1 — pick a source pool:
- Real conversations (all playground convs on the agent)
- Simulation run (lists the agent's sim runs)
- Transcript upload (lists the agent's uploads)

Step 2 — pick a size: 10 / 20 / 50 / 100 / 200.

Step 3 — name (pre-filled, e.g., "Last 100 real conversations").

On submit: creates `errorAnalyses` row with `origin: { kind: "custom" }` + N `errorAnalysisMembers` rows with `addedVia: "import"` (sampled from the chosen pool, newest first). Navigates to the analysis's Annotate tab.

### `/agents/[id]/evaluate/error-analysis/[analysisId]` (detail)

Header: name (editable), origin badge, member counts. Two tabs: **Annotate** | **Failure modes**.

Right-side **Import more** button (visible on both tabs):

- Source pool depends on origin:
  - `simulation` → conversations from this sim run, excluding already-imported.
  - `upload` → conversations from this upload, excluding already-imported.
  - `playground` → playground conversations from this agent, excluding already-imported.
  - `custom` → the user picks a source kind again, same as the create modal.
- Sizes: 10 / 20 / 50 / 100 / 200. Capped to "remaining count if smaller."
- On submit: inserts `errorAnalysisMembers` rows with `addedVia: "import"`. No automatic annotation.

#### Annotate tab

Three-column layout:
- Left: list of member conversations. Visual states: ◐ annotated, ○ imported-not-yet-annotated.
- Center: transcript of selected conversation.
- Right: `AnnotationSidePanel` (always open in this view — clicking a different conversation reuses the same panel).

#### Failure modes tab

- Header: "N failure modes · derived from M annotations" and a `⟲ Re-cluster` button.
- Cards: name (editable), description (editable), member count (conversations exhibiting this mode).
- Each card: `+ Spawn judge` button. If judges already exist for this mode, show "K judges spawned →" linking to evaluator detail.

Click `⟲ Re-cluster` → action runs LLM clustering over current annotations → returns proposed failure modes → user merges/edits/saves. (Existing axial-coding UI from `app/experiments/[id]/failure-modes/_components/` is lifted here.)

### Evaluator creation — third option

`/agents/[id]/evaluate/evaluators` page's `+ New Evaluator` menu adds **From failure mode**:

1. Modal lists the agent's analyses → pick one.
2. Lists that analysis's failure modes → pick one.
3. Pre-fills evaluator form (name, rubric from description, dimensions = `[{ failureModeId }]`).
4. Auto-inherits `evaluatorLabels`:
   - Fail labels: all `failureModeMemberships` rows for the chosen failureModeId.
   - Pass labels: all annotated conversations in the analysis that are *not* members of the failureMode.
5. Default 60/20/20 split. Lands on the new evaluator's Labels tab.

### Inside-run viewer (run detail)

`/agents/[id]/evaluate/experiments/[runId]` becomes a single-pane conversation viewer:
- Conversation list (left) + transcript (right).
- Top-right of transcript: ✏ **Annotate** button → opens `AnnotationSidePanel`.
- Top-right of header: secondary link **View as error analysis →** that navigates to the auto-created container (creates it if it doesn't exist, with `addedVia: "import"` for nothing — empty container is fine, user goes there to do bulk work).

No sub-sidebar. No open-coding tab. No axial-coding tab.

## Component contract changes

### `AnnotationSidePanel` (new — supersedes AnnotationEditor + ExperimentAnnotationPane)

See props above. Owns its own open/close state. Knows nothing about experiments.

### `ErrorAnalysisCard` (new)

Display card on the landing grid.

### `CreateCustomCohortModal` (new)

Three-step modal as described.

### `ImportMoreModal` (new)

Used from inside an analysis detail page.

### `AnnotationEditor` (May-26 spec)

Becomes the *internal* of `AnnotationSidePanel`. Stays generic — `targetId` opaque, no experiment refs.

## Backend changes

### New convex files

- `convex/errorAnalysis/orchestration.ts` — mutations/queries: `byAgent`, `get`, `createCustom`, `rename`, `importMore`, `deleteAnalysis`.
- `convex/errorAnalysis/members.ts` — internal helpers for member upsert.
- `convex/errorAnalysis/clustering.ts` — `"use node"` action for failure-mode clustering (lifted from existing failure-modes action).

### Modified

- `convex/crud/annotations.ts` — `upsertWithAutoContainer` mutation (does container resolution + member insert).
- `convex/experiments/results.ts` — drop any reference to `experimentId` on annotations / failure modes.

### Dropped

- `convex/experiments/openCoding.ts` if it exists separately (the per-run open-coding logic gets folded into the generic annotations path).

## Migration

Greenfield reshape, like the May-26 PR. No data migration. Reviewer confirms the org is pre-production and the dev/staging dataset can be wiped.

## Component / page contract: what the run viewer must NOT do

- Must not import any error-analysis page or query directly.
- Must not pass `errorAnalysisId` props.
- Only touches the polymorphic side panel via origin hint `{ kind: "simulation", simulationId }`.

This keeps the run viewer agnostic so future viewers (playground, transcript) reuse it without conditional logic.

## Risks

- **Auto-container creation is racy.** Two concurrent first-annotations on the same `(agent, sim run)` could each try to create the container. Mitigation: unique invariant enforced at the mutation level via a `by_agent_origin_kind` index check; on conflict, reuse the existing row.
- **Custom cohort sampling is non-trivial.** "Last N real conversations" requires deterministic ordering. We use `conversations.createdAt` desc. If the underlying conversations list changes during sampling, the snapshot may include duplicates — mitigation: sample inside one mutation reading from the indexed query, no async gaps.
- **Failure mode re-scoping vs. May-26.** May-26 made `failureModes` agent-flat. This spec re-scopes them under an analysis. Anyone implementing in parallel must rebase to this.
- **Run viewer simplification could lose UX users expect.** Today's run viewer has the open-coding tab; users used to that workflow lose the direct path. Mitigation: the "View as error analysis →" link is prominent in the run header; the auto-container is preserved.
- **Empty containers from "View as error analysis" click.** If a user clicks the link on a run with zero annotations, an empty container appears in the grid. Acceptable — it's a real intent signal ("I want to work on this run"); also rename / delete are available.

## Testing (manual)

- Pencil inside a fresh sim run on the first conversation → annotation saves; new container appears in Error analysis grid with `origin.kind = "simulation"` and member count 1.
- Pencil on a second conv in the same run → same container; member count 2.
- Pencil in playground → creates a "Playground" container scoped to that agent; same on a second playground conv joins it.
- Pencil on a transcript conversation → creates an "Upload: <filename>" container for that upload.
- `+ New analysis` modal → pick "real conversations" + 50 → container created with 50 members, all `addedVia: "import"`, none annotated.
- Open analysis → Annotate tab → label imported convs → annotated count goes up; member count unchanged.
- Failure modes tab → Re-cluster runs over current annotations → cards appear → spawn judge → evaluator appears at `/evaluators/[id]` with provenance "From failure mode … (analysis: …)".
- `+ New Evaluator → From failure mode` → analysis + mode picker → submit → labels inherited (fail from memberships, pass from annotated-non-members).
- Run detail page has no sub-sidebar; pencil is the only annotation entry; "View as error analysis →" link navigates to the auto-container (creating it empty if missing).
- Deep-link refresh on every new route preserves selection.
- Deleting an analysis deletes its members, its annotations, its failure modes, its memberships. Evaluators spawned from those failure modes survive (their inherited labels are now their own ground truth) but lose the back-link.

## Out of scope (deferred)

- Cross-analysis aggregate failure-mode view ("which modes recur across analyses?").
- Smart auto-membership for playground container (e.g., "every playground conv on this agent is implicit member"). Today the rule is "annotated or imported only," uniform across all kinds.
- Bulk re-import (sync container with latest run additions).
- Renaming auto-container names automatically when the sim run / upload is renamed (today they're snapshotted at create time).
- Per-evaluator targeting via tags (still deferred from May-26).
