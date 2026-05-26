# Frontend Re-haul — Agents Section

**Date:** 2026-05-26
**Status:** Draft (rev 3 — supersedes 2026-05-21)
**Parent:** `2026-05-21-frontend-rehaul-umbrella-design.md`

## Goal

Move agent-related pages (`agents`, `evaluators`, scenarios, experiments, open-coding, axial-coding) under a single `/agents` section organised as: list landing → per-agent detail with **Configure** + **Evaluate** (Scenarios, Experiments, Evaluators).

Rev 3 differs from rev 2 by treating the underlying data model as **greenfield**: rather than additively patching schemas, we collapse two evaluator tables into one, decouple annotation from experiments via a polymorphic conversation source, drop legacy run tables that have been superseded by simulations, and surface the playground as a first-class conversation source so the entire eval loop runs without requiring a simulation to exist.

## Workflow this enables

The agent eval loop is bootstrappable from minute one — no simulation or transcript upload required:

1. Configure the agent (`/configure`). Play with it in the playground.
2. Playground conversations persist as `conversations` rows with `source: "playground"`.
3. Annotate playground conversations directly (open coding).
4. Run axial coding over those annotations → discover failure modes.
5. Spawn a judge from a failure mode (or write one manually). The judge inherits "fail" labels from failure-mode members and "pass" labels from annotated-but-not-mapped conversations.
6. Validate the judge against its label set (TPR/TNR over train/dev/test split). Status flips to `ready`.
7. Subsequent playground / simulation conversations are auto-scored by all `ready` evaluators for the agent.

Later, when simulations and transcript uploads are also present, the exact same loop runs over those sources — the source picker chooses where labels and applications come from. The architecture is conversation-source-agnostic throughout.

## Routes (new)

```
/agents                                                              list landing
/agents/[id]/layout.tsx                                              EntityDetailLayout + agentSidebar
/agents/[id]/configure                                               agent config + playground
/agents/[id]/evaluate/scenarios                                      scenario list + generation wizard
/agents/[id]/evaluate/experiments                                    simulation run list
/agents/[id]/evaluate/experiments/[runId]/layout.tsx                 EntityDetailLayout + agentRunSidebar
/agents/[id]/evaluate/experiments/[runId]                            run detail (metadata + transcripts)
/agents/[id]/evaluate/experiments/[runId]/open-coding                annotate conversations from this run
/agents/[id]/evaluate/experiments/[runId]/axial-coding               failure modes for this run
/agents/[id]/evaluate/evaluators                                     list (create entry) + standalone creation
/agents/[id]/evaluate/evaluators/[evalId]                            detail — tabs: Configure | Labels | Validate
/agents/[id]/evaluate/evaluators/[evalId]/validate                   validation page (TPR/TNR, train/dev/test)
```

Reserved nowhere. The previously-reserved `/apply` route is **not** included — ad-hoc apply is deferred; inline auto-apply at sim time covers all current cases.

## Routes (deleted in this PR)

- `app/agents/page.tsx` — legacy single-page Create/Experiment UI.
- `app/evaluators/` — entire dir; legacy KB-scoped evaluator UI.
- `app/experiments/[id]/annotate/` — agent-flavoured open-coding; replaced by per-run open-coding.
- `app/experiments/[id]/failure-modes/` — agent-flavoured axial-coding; replaced by per-run axial-coding.
- `app/experiments/[id]/_components/ExperimentNavSidebar.tsx`
- `app/experiments/[id]/layout.tsx`

**Intentionally not touched (other section PRs):**
- `app/experiments/page.tsx` (retriever-experiment mode toggle — KB worktree).
- `Header.tsx`, `ModeSelector.tsx`, `KBDropdown.tsx`, `useKbFromUrl.ts` — referenced by un-migrated pages owned by KB / Conversations worktrees. Each section cleans up what it owns when the last reference disappears.

## Schema — greenfield reshape

This re-haul deliberately breaks schemas where doing so produces a cleaner data model. Existing rows in dropped tables are not migrated. The org has not deployed to production, so this is acceptable.

### KEEP & RESHAPE

#### `evaluators` (consolidated)

The legacy `evaluatorConfigs` table is merged into `evaluators`. The result carries the full lifecycle: draft → calibrating → validated → ready.

```ts
evaluators: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),                    // required — agent-scoped
  name: v.string(),
  description: v.string(),
  type: v.union(v.literal("code"), v.literal("llm_judge")),
  // (removed: scope — always session)

  codeJudgeConfig: v.optional(v.object({
    checkType: v.union(
      v.literal("tool_call_match"),
      v.literal("string_contains"),
      v.literal("regex_match"),
      v.literal("response_format"),
    ),
    params: v.any(),
  })),

  llmJudgeConfig: v.optional(v.object({
    // Multi-dim knob — N=1 by default, >1 for bundled judges
    dimensions: v.array(v.object({
      failureModeId: v.optional(v.id("failureModes")),  // null for manual/template
      name: v.string(),
      rubric: v.string(),
      passExamples: v.array(v.string()),
      failExamples: v.array(v.string()),
    })),
    outputFormat: v.union(v.literal("per_dimension"), v.literal("aggregate")),
    model: v.string(),
    inputContext: v.array(v.union(
      v.literal("transcript"),
      v.literal("tool_calls"),
      v.literal("kb_documents"),
    )),
  })),

  // Discriminated source — replaces bare `createdFrom` + nullable foreign keys
  source: v.union(
    v.object({ kind: v.literal("manual") }),
    v.object({ kind: v.literal("template"),       templateId:    v.id("evaluatorTemplates") }),
    v.object({ kind: v.literal("error_analysis"), failureModeId: v.id("failureModes") }),
  ),

  // Lifecycle (lifted from legacy evaluatorConfigs)
  status: v.union(
    v.literal("draft"),
    v.literal("calibrating"),
    v.literal("validated"),
    v.literal("ready"),
  ),
  splitConfig: v.optional(v.object({
    trainPct: v.number(),
    devPct: v.number(),
    testPct: v.number(),
  })),
  splitSeed: v.optional(v.number()),
  devMetrics: v.optional(v.object({
    tpr: v.number(),
    tnr: v.number(),
    agreement: v.number(),
  })),

  tags: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_org", ["orgId"])
  .index("by_agent", ["agentId"])
  .index("by_agent_status", ["agentId", "status"])
```

Why `dimensions: v.array(...)` rather than a single rubric:

- `dimensions.length === 1` is the default — one judge ↔ one failure mode, matching the recommended high-accuracy pattern from the LLM-as-judge literature.
- `dimensions.length > 1` is the cost/latency knob — bundle 3–5 related dimensions into a single LLM call when monitoring at scale.

The same evaluator row supports both; only the configuration differs.

#### `conversationScenarios`

Scenarios are agent-scoped, with a discriminated `source` that captures the KB or transcript dependency depending on origin.

```ts
conversationScenarios: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),                            // required
  source: v.union(
    v.object({ kind: v.literal("synthetic"),  kbId: v.id("knowledgeBases") }),
    v.object({ kind: v.literal("grounded"),   transcriptUploadId: v.id("livechatUploads") }),
    v.object({ kind: v.literal("manual") }),
  ),
  // ...existing scenario fields (prompt, persona, expected behaviour, etc.)
  createdAt: v.number(),
})
  .index("by_agent", ["agentId"])
  .index("by_kb", ["source.kbId"])                    // "what scenarios depend on this KB?"
  .index("by_transcript_upload", ["source.transcriptUploadId"])
```

Primary surface is "all scenarios for this agent." Secondary surface (impact analysis when a KB changes) is "all scenarios using this KB."

#### `annotations`

Polymorphic source. Decoupled from `experimentId` entirely.

```ts
annotations: defineTable({
  orgId: v.string(),
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
  .index("by_conversation", ["source.conversationId"])
  .index("by_transcript",   ["source.transcriptId"])
```

Two polymorphic kinds cover everything:
- `conversation` — any row in the `conversations` table. The `conversations.source` field (`"playground" | "simulation"`) is the secondary discriminator surfaced in the UI source picker.
- `transcript` — uploaded historical conversations from `livechatConversations`.

#### `failureModes`

Decoupled from `experimentId`. A failure mode is the *category* discovered by axial coding. It can be derived from any annotation set, regardless of source.

```ts
failureModes: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),                  // failure modes are agent-scoped
  name: v.string(),
  description: v.string(),
  order: v.number(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_agent", ["agentId"])
```

#### `failureModeMemberships` (renamed from `failureModeQuestionMappings`)

The "this conversation exhibits that failure mode" tag. Polymorphic source matches annotations.

```ts
failureModeMemberships: defineTable({
  orgId: v.string(),
  failureModeId: v.id("failureModes"),
  source: v.union(
    v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
    v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
  ),
  createdAt: v.number(),
})
  .index("by_failure_mode", ["failureModeId"])
  .index("by_conversation", ["source.conversationId"])
```

#### `conversationSimulations` and `conversationSimRuns`

Kept as the unified "agent run" tables. Two surgical changes:

- Drop `conversationSimulations.evaluatorSetId`. Replace with "all `ready` evaluators for this agent run inline."
- Drop `conversationSimRuns.annotations: v.optional(v.string())` free-form string field. All annotations now live in the `annotations` table with polymorphic source.
- Make `conversationSimRuns.conversationId` **required** (every sim run produces a `conversations` row with `source: "simulation"` — simulation and playground share the same conversation/messages storage).

### DROP

- **`evaluatorConfigs`** — legacy. Merged into `evaluators`.
- **`evaluatorSets`** — replaced by "all ready evaluators for this agent." Per-evaluator scenario targeting can be added later via tags if needed.
- **`agentExperimentResults`** — sim runs are the only "agent run result" concept now.
- **`experiments` rows where `experimentType: "agent"`** — agent-side eval lives entirely in `conversationSimulations` now. The `experiments` table may still hold retriever-eval rows owned by the KB section; that is not touched by this PR.
- **`conversations.source = "experiment"`** enum value (legacy; referenced the dropped agent-side experiments). The enum becomes `"playground" | "simulation"`.

### NEW

#### `evaluatorTemplates`

Built-in library of pre-configured evaluators users can start from.

```ts
evaluatorTemplates: defineTable({
  name: v.string(),
  description: v.string(),
  category: v.string(),                      // "safety" | "tone" | "tool_use" | "policy" | ...
  type: v.union(v.literal("code"), v.literal("llm_judge")),
  prefilledConfig: v.any(),                  // copied into evaluator on use
})
  .index("by_category", ["category"])
```

Seeded with ~10 common templates (PII leakage, refusal correctness, tool-call shape, professional tone, etc.) at deploy time. No org scoping — all templates are global. If org-custom templates become a need, add an optional `orgId` field later (additive).

#### `evaluatorLabels`

Per-judge pass/fail verdicts for validation. Polymorphic source matches annotations.

```ts
evaluatorLabels: defineTable({
  orgId: v.string(),
  evaluatorId: v.id("evaluators"),
  failureModeId: v.optional(v.id("failureModes")),  // dimension within the judge (for multi-dim)
  source: v.union(
    v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
    v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
  ),
  humanLabel: v.union(v.literal("pass"), v.literal("fail")),
  splitAssignment: v.optional(v.union(
    v.literal("train"), v.literal("dev"), v.literal("test"),
  )),
  origin: v.union(
    v.object({ kind: v.literal("axial_coding"),         failureModeId: v.id("failureModes") }),
    v.object({ kind: v.literal("inferred_negative") }),
    v.object({ kind: v.literal("calibration_pass") }),
    v.object({ kind: v.literal("imported_annotation"),  annotationId:  v.id("annotations") }),
  ),
  ratedBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_evaluator", ["evaluatorId"])
  .index("by_evaluator_split", ["evaluatorId", "splitAssignment"])
```

The `origin` discriminator makes provenance traceable: every label can be traced to whether it was auto-inherited from axial coding, inferred as a negative, added via calibration, or imported from open-coding tags.

## Polymorphic conversation source — just two kinds

Across annotations, failure mode memberships, and evaluator labels:

```ts
source: v.union(
  v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
  v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
)
```

The `conversations` table's own `source` field distinguishes playground from simulation. The UI source picker presents three options:

```
▢ Real conversations          → conversations where source = "playground"
▢ Simulation conversations    → conversations where source = "simulation"
▢ Uploaded transcripts        → livechatConversations
```

"Real conversations" is the UI label for playground-origin conversations (the schema enum stays `"playground"`).

## Component contract changes

### `AnnotationEditor` — generic, conversation-source agnostic

Replaces today's tightly-wired `ExperimentAnnotationPane`. Owns nothing experiment-specific.

```ts
interface AnnotationEditorProps {
  conversation: { turns: Turn[] };
  existingAnnotation: Annotation | null;
  allTags: string[];
  onUpsert(input: {
    targetId: string;                        // opaque; page wires source.conversationId or source.transcriptId
    rating: "great" | "good_enough" | "bad" | "pass" | "fail";
    comment?: string;
    tags?: string[];
  }): Promise<void>;
}
```

The component never imports `experimentId`, `resultId`, `agentId`, or any Convex API path. One annotation per conversation. Pages do all data wiring.

### `SourcePicker` — new shared component

Renders the three source options with counts, multi-select. Used in:

1. Calibration kickoff on `/evaluators/[evalId]/validate`
2. "Add labels" menu on the Labels tab
3. "Import from annotations" flow

```ts
interface SourcePickerProps {
  agentId: Id<"agents">;
  selected: SourceSelection;
  onChange(s: SourceSelection): void;
}
type SourceSelection = {
  kinds: Array<"real" | "simulation" | "transcript">;
  // optional filters: simulationId, transcriptUploadId, date range
};
```

### Agent selection comes from the URL

All agent-scoped components take `agentId` as a prop. No `<select>` dropdown anywhere inside the section. `ExperimentModeLayout`'s `useUrlState` agent-tracking is removed (the URL itself is the picker). `ExperimentModeLayout` is **deleted entirely**.

## Shell reuse (no fork)

The KB section PR (#77) upgrades the shared shell. To avoid divergence, this PR cherry-picks those upgraded files file-by-file (no merge, no PR coupling) and only edits the agent-specific pieces. When PRs land in either order, the overlapping shell files have identical content → no merge conflict.

Files brought in from `origin/worktree-frontend-rehaul-kb-branch`:

| File | What it adds |
|---|---|
| `components/shell/EntityDetailLayout.tsx` | Collapsible sidebar (icon-only collapsed mode, `localStorage` key `shell:sidebar-collapsed`); `fullWidth` prop; `h-screen` flex shell; `SidebarItem.icon`. |
| `components/shell/sidebars.tsx` (replaces `.ts`) | Shared icon set; `kbSidebar` + `agentSidebar` exports. |
| `components/shell/Spinner.tsx` | Standard dot-spinner. |
| `components/shell/ErrorToast.tsx` | Standard bottom-right error toast. |

Agent-only changes layered on top:

- `sidebars.tsx::agentSidebar` — Configure + Evaluate accordion (Scenarios, Experiments, Evaluators).
- `sidebars.tsx::agentRunSidebar(agentId, runId)` — new export for the run sub-section (Run detail, Open coding, Axial coding).
- `lib/useAgentBreadcrumb.ts` — mirrors `useKbBreadcrumb`; subscribes to `api.crud.agents.get`.

## Sidebar structure

```
agentSidebar(agentId):                 agentRunSidebar(agentId, runId):
  Configure                              Run detail
  Evaluate                               Open coding
    ├─ Scenarios                         Axial coding
    ├─ Experiments
    └─ Evaluators
```

`/agents/[id]/evaluate/experiments/[runId]/layout.tsx` swaps the sidebar to `agentRunSidebar(agentId, runId)`. The per-run Evaluators sub-page from rev 2 is **removed** — evaluators are owned at the agent level; the run-level sidebar surfaces only run-scoped activities (annotate, derive failure modes). Spawning a judge from a failure mode happens inside axial-coding; the resulting evaluator appears at the agent level.

## Page wiring (selected)

### `/agents` (landing)
- `EntityListLayout` with agent cards.
- Data: `crud.agents.byOrg`.
- `+ New agent` → `crud.agents.create` → navigate to `/agents/<newId>/configure`.

### `/agents/[id]/configure`
- Two-pane: `AgentConfigPanel` (left, 380px) | `AgentPlayground` (right).
- Playground persists conversations to `conversations` table with `source: "playground"`.

### `/agents/[id]/evaluate/scenarios`
- Data: `crud.scenarios.byAgent({ agentId })`.
- Generation wizard reused; on submit, writes scenarios with `agentId` and the appropriate `source` discriminator.

### `/agents/[id]/evaluate/experiments` (run list)
- Data: `conversationSim.orchestration.byAgent({ agentId })`.
- Sticky "Running simulation" banner when any sim is `running` or `pending`.
- `+ New Simulation` opens `CreateSimulationModal` (scenario picker scoped to this agent; no evaluator-set picker — all ready evaluators auto-apply).

### `/agents/[id]/evaluate/experiments/[runId]`
- Layout swaps to `agentRunSidebar`.
- Reuses `ExperimentMetadataPane`, `SimRunDetail`, `ScenarioSummaryBand`, `ToolCallGroup`.

### `/agents/[id]/evaluate/experiments/[runId]/open-coding`
- Data: `conversationSimRuns.bySimulation`, `annotations.bySource`, `annotations.allTags`, `crud.questions.byDataset`.
- Three-pane: conversation list (left) | transcript (centre) | `AnnotationEditor` (right).
- Selected conversation in URL as `?conversation=<simRunId>`.

### `/agents/[id]/evaluate/experiments/[runId]/axial-coding`
- Reuses the failure-mode UI lifted from `app/experiments/[id]/failure-modes/_components/` (moved to `components/failure-modes/`).
- Spawn-judge action creates an `evaluators` row with `source: { kind: "error_analysis", failureModeId }`, auto-inherits `evaluatorLabels` from failure mode members (fail) and non-members in the annotation set (pass), assigns a default 60/20/20 split.

### `/agents/[id]/evaluate/evaluators` (agent-level list)
- Data: `evaluators.byAgent({ agentId })`.
- Read-write. `+ New Evaluator` menu offers: Start blank / From template.
- Status badges per row (draft / calibrating / validated / ready) with provenance ("From failure mode X", "From template Y", "Manual").

### `/agents/[id]/evaluate/evaluators/[evalId]`
- Tabs: Configure | Labels | Validate.
- **Configure**: edit name, type, rubric / code config, dimensions, model, input context.
- **Labels**: table of all evaluator labels with origin column; "Add labels" menu (Calibrate fresh sample / Import from annotations / Manually paste); train/dev/test counts and re-split control.
- **Validate**: subroute `/validate`. Source picker (gates calibration if no labels). Runs judge on dev set, computes TPR/TNR/agreement, flips status to `ready` if thresholds met.

## The bootstrap path

A new user with a fresh agent can run the full eval loop without ever creating a simulation or uploading a transcript:

```
Configure agent → play in playground (creates conversations, source=playground)
    → open-coding on playground convs (writes annotations)
    → axial-coding (writes failureModes + failureModeMemberships)
    → spawn judge (creates evaluator + auto-inherits evaluatorLabels)
    → calibrate (more playground conversations, more labels)
    → validate (TPR/TNR, status → ready)
    → subsequent playground / simulation conversations auto-scored
```

This is why decoupling annotation from `experimentId` and surfacing playground as a first-class source matter — they enable evaluation to begin the moment the developer plays with the agent, instead of requiring the user to set up scenarios → simulations → annotations → judges as a strict sequence.

## Open coding / axial coding / spawn judge

### Open coding
- Same UX as today's experiment annotation, but the page wires sources via the polymorphic `source` field.
- The conversation list and `AnnotationEditor` are unaware of source kind. Filter chips at the top let users restrict to one source at a time.

### Axial coding
- LLM clusters annotations into candidate failure modes. User edits/merges/renames.
- For each failure mode, conversations are added or removed via checkbox / drag. This is the `failureModeMemberships` table.

### Spawn judge (one-click)
- On a failure mode: "Create judge". Modal pre-fills:
  - Name, rubric (seeded from failure mode description), dimensions = `[{ failureModeId: X, ... }]`.
  - "We'll inherit N fail labels from this failure mode + M pass labels from annotated-but-not-mapped conversations in this run. Train/dev/test split: 60/20/20."
- On submit: writes `evaluators` row + N+M `evaluatorLabels` rows. Navigates to the evaluator's Labels tab.

## Calibration UX

For manual / template judges (no inherited labels):

1. Labels tab shows "0 labels — pick a source pool to calibrate from." Source picker lists all available sources with counts.
2. User selects sources, sample size, split ratios. Clicks "Start calibration."
3. Calibration loop presents one conversation at a time with the question "Does this pass [judge name]?" — answers go directly into `evaluatorLabels` with auto-assigned split.
4. Once enough labels exist, "Validate" is enabled.

For failure-mode-derived judges that need *more* labels later, the same picker is reachable from the "Add labels" menu.

## Multi-dimensional judge bundling

Optional. When a user wants to consolidate cost/latency:

- On evaluator create or edit, allow `dimensions.length > 1`.
- UI lists existing failure modes for this agent with checkboxes. Selected modes become dimensions of one judge.
- Labels are scoped per dimension via the optional `evaluatorLabels.failureModeId` field.
- Validation computes TPR/TNR per dimension.

Default remains 1-judge-per-failure-mode. Bundling is an explicit choice when the user judges the cost saves the accuracy hit.

## Risks

- **Schema break across multiple hot tables.** This PR drops `evaluatorConfigs`, `evaluatorSets`, `agentExperimentResults`, and the agent-side rows of `experiments`. It reshapes `annotations`, `failureModes`, `failureModeMemberships`, `evaluators`, and `conversationScenarios`. No migration of legacy rows is provided. Reviewer should confirm the org has not deployed to production and that data loss in dev/staging is acceptable.
- **`evaluatorLabels.origin.kind === "inferred_negative"` is heuristic.** The "annotated but not in failure mode = pass label" inference is not always correct (an annotator may have missed the mode). Users can flip individual labels in the Labels tab. We accept this as a noisy starting point — better than zero labels.
- **`conversations.source` enum churn.** Removing `"experiment"` from the union means any code path that reads or writes that value needs to be updated. Search before deletion.
- **Cherry-pick race with PR #77.** Shell files are byte-identical to KB branch at write-time; if #77 changes them again before either lands, the second-to-land PR accepts the upstream version. Mitigation: keep agent-only diffs (`agentSidebar`, run sidebar, breadcrumb hook) in *separate* files so shell files stay byte-identical across branches.
- **AnnotationEditor decoupling drift.** Today's annotation pane reaches into experiment-specific state (selected `questionId`, pending-comment debouncing keyed by `resultId`). Reviewer should confirm no such reference survives inside the new component.

## Testing (manual click-through, recorded in PR description)

- `/agents` lists all org agents; `+ New agent` creates and navigates to `/agents/<newId>/configure`.
- Agent sidebar Configure / Scenarios / Experiments / Evaluators preserves `agentId` across clicks. Sidebar collapse persists across navigation, cross-section.
- Deep-link to every new route on a fresh browser tab renders correctly. Refresh + browser back/forward preserve all selection state, including per-run sub-nav.
- **Bootstrap path**: from a freshly created agent, play in playground → open-code one or two playground conversations → run axial coding → spawn a judge → see it appear at `/agents/<id>/evaluate/evaluators` with status `draft`, source `error_analysis`, inherited labels visible in Labels tab.
- **Manual judge calibration**: create a blank judge → Labels tab shows source picker → calibrate against playground sample → labels populate → Validate enables → TPR/TNR computed.
- **Template judge**: "From template" menu lists ~10 categories → pick "PII leakage" → form pre-filled → save → calibrate as above.
- **Bundled multi-dim judge**: select 3 failure modes → create one judge → Labels tab grouped by dimension → validation shows per-dimension TPR/TNR.
- **Source picker**: lists Real conversations (playground), Simulation conversations, Uploaded transcripts; counts reflect actual data; selecting a transcript upload narrows to its conversations.
- **Open coding on transcripts**: from `/agents/<id>/evaluate/evaluators/<evalId>/validate` (or analogous entry), pick a transcript upload, label conversations through judge lens, labels appear with origin `calibration_pass` and transcript source.
- **Auto-apply at sim time**: run a simulation → each sim run row shows scores from every `ready` evaluator for the agent (no evaluator-set selection step).
- **Scenarios scoping**: generate synthetic scenarios under one agent → only appear in that agent's `byAgent` list; querying `byKb` for the source KB lists them alongside any other scenarios using that KB.
- Old URLs (`/agents` legacy single-page, `/evaluators`, `/experiments/<id>/annotate`, `/experiments/<id>/failure-modes`) 404.

## Out of scope (deferred)

- Ad-hoc evaluator application (`/apply` route). Inline auto-apply at sim time covers current cases.
- Org-custom evaluator templates (`evaluatorTemplates.orgId`). Add as additive field when needed.
- Production-traffic conversation source. When that infrastructure exists, surface as another option in the source picker; no schema change required (it would write to `conversations` with a new source value).
- Pagination on the agent-level evaluators list.
- Cross-run aggregate failure-mode view.
- Evaluator tags + scenario-tag-based per-evaluator targeting (the replacement for `evaluatorSets`). Defer until needed.
- Automatic backfill of `evaluatorLabels` when an evaluator's rubric changes (today, user manually re-calibrates).
