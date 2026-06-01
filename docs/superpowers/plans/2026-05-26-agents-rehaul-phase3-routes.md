# Agents Re-haul — Phase 3: Routes + Pages + Components — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full UX of the agents section against the Phase 1 backend + Phase 2 shell. Includes the `AnnotationEditor` refactor, the new `SourcePicker` component, every route under `/agents/[id]/`, and the evaluator detail page with Configure / Labels / Validate tabs.

**Architecture:** Each route is a Next.js page that pulls data via Convex hooks and delegates rendering to focused components (mostly under `components/`). Components are conversation-source-agnostic; pages own the wiring of polymorphic `source` discriminators. Old routes (`app/agents/page.tsx` legacy, `app/evaluators/`, `app/experiments/[id]/annotate`, `app/experiments/[id]/failure-modes`) get deleted as their replacements land.

**Tech Stack:** Next.js 16, Convex React hooks (`useQuery`/`useMutation`/`useAction`), Tailwind v4, Clerk.

---

## Pre-flight

- [ ] **Step 1: Confirm Phase 2 is on HEAD**

```bash
git log --oneline -5
```
Expected: top 4-6 commits are the Phase 2 tasks (sidebar fix, landing, layouts, evaluate redirect).

- [ ] **Step 2: Frontend typecheck baseline**

```bash
pnpm typecheck 2>&1 | grep -c "error TS" | tee /tmp/phase3-baseline-errors.txt
```

Phase 3 work should monotonically reduce this number; each task fixes one part of the surface.

- [ ] **Step 3: Identify legacy pages to delete**

```bash
ls packages/frontend/src/app/evaluators/ packages/frontend/src/app/experiments/[id]/annotate/ packages/frontend/src/app/experiments/[id]/failure-modes/ 2>/dev/null
```

Note their existence. The cleanup task at the end deletes them.

- [ ] **Step 4: Inventory the components we need to relocate / refactor**

```bash
ls packages/frontend/src/app/experiments/[id]/failure-modes/_components/ 2>/dev/null
ls packages/frontend/src/components/
```

The failure-mode UI we need to preserve currently lives under `app/experiments/[id]/failure-modes/_components/`. It will be moved to `components/failure-modes/` in Task 6.

---

## Task 1: New shared component `AnnotationEditor`

**Files:**
- Create: `packages/frontend/src/components/annotation/AnnotationEditor.tsx`

The new editor is conversation-source-agnostic — it takes a conversation, an existing annotation, the org's tag list, and an `onUpsert` callback. It owns no Convex paths, no `experimentId`, no `resultId`.

- [ ] **Step 1.1: Read the legacy `ExperimentAnnotationPane` for reference**

```bash
find packages/frontend/src/components -name "ExperimentAnnotationPane*"
find packages/frontend/src/app -name "*AnnotationPane*"
```

Read whichever file holds the legacy implementation. Identify which behaviour belongs in the new generic editor vs which is page-level wiring.

- [ ] **Step 1.2: Define the contract**

```tsx
// packages/frontend/src/components/annotation/AnnotationEditor.tsx
"use client";

export type Turn = { role: "user" | "assistant" | "tool_call" | "tool_result" | "system"; content: string };

export type Annotation = {
  rating: "great" | "good_enough" | "bad" | "pass" | "fail";
  comment?: string;
  tags: string[];
};

export interface AnnotationEditorProps {
  conversation: { turns: Turn[] };
  existingAnnotation: Annotation | null;
  allTags: string[];
  onUpsert(input: {
    rating: Annotation["rating"];
    comment?: string;
    tags: string[];
  }): Promise<void>;
  disabled?: boolean;
}

export function AnnotationEditor(props: AnnotationEditorProps) {
  // Local form state initialized from existingAnnotation
  // Rating: 5-button group (great / good_enough / bad / pass / fail)
  // Comment: textarea, debounced save
  // Tags: combobox over allTags + freeform add
  // Save button: calls props.onUpsert
  // No useQuery / useMutation inside this component — pages own all data.
}
```

Implement the full component. Critical constraints:
- NO imports from `@/lib/convex` — the editor is data-layer-agnostic.
- NO references to `experimentId`, `resultId`, `agentId`, `conversationId`.
- Debounce comment changes (500ms) before invoking `onUpsert` to avoid mutation thrash.

- [ ] **Step 1.3: Build check**

```bash
pnpm -C packages/frontend build 2>&1 | grep -E "AnnotationEditor|error" | head -10
```

- [ ] **Step 1.4: Commit**

```bash
git add packages/frontend/src/components/annotation/AnnotationEditor.tsx
git commit -m "feat(frontend): AnnotationEditor — source-agnostic annotation editor

Owns no Convex paths or experimentId/resultId references. Pages do
the data wiring; this component just renders the conversation +
form and calls onUpsert."
```

---

## Task 2: New shared component `SourcePicker`

**Files:**
- Create: `packages/frontend/src/components/calibration/SourcePicker.tsx`

Used at three different points: calibration kickoff on Validate, "Add labels" menu on the Labels tab, and "Import from annotations" flow. Surfaces the three available sources with counts.

- [ ] **Step 2.1: Define the contract**

```tsx
"use client";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "convex/_generated/dataModel";

export type SourceKind = "real" | "simulation" | "transcript";

export type SourceSelection = {
  kinds: Set<SourceKind>;                       // which top-level pools selected
  simulationIds?: Id<"conversationSimulations">[];   // optional filter within simulation
  transcriptUploadIds?: Id<"livechatUploads">[];     // optional filter within transcripts
};

export interface SourcePickerProps {
  agentId: Id<"agents">;
  value: SourceSelection;
  onChange(s: SourceSelection): void;
}

export function SourcePicker(props: SourcePickerProps) {
  const realCount = useQuery(api.crud.conversations.countByAgentAndSource,
    { agentId: props.agentId, source: "playground" });
  const simCount = useQuery(api.crud.conversations.countByAgentAndSource,
    { agentId: props.agentId, source: "simulation" });
  const transcriptUploads = useQuery(api.crud.livechatUploads.byOrg, {});
  // ...checkbox UI with counts:
  // ▢ Real conversations          (N available)
  // ▢ Simulation conversations    (N available)
  // ▢ Uploaded transcripts        (M uploads — expandable)
}
```

You may need to add `crud.conversations.countByAgentAndSource` to the backend if it doesn't exist (single-task scope-creep is OK here — flag it in the commit message). Look at `packages/backend/convex/crud/conversations.ts` and see if a query like that already exists.

- [ ] **Step 2.2: Build the UI**

- Three top-level checkboxes (Real, Simulation, Transcripts) with counts.
- When "Transcripts" is checked, expand a sub-list of uploads with per-upload checkboxes.
- Selection state owned by parent via `value` + `onChange`.
- Empty state ("No conversations of this kind yet") when count is zero.

- [ ] **Step 2.3: Backend support (if needed)**

If `countByAgentAndSource` doesn't exist on the backend, add it in this task:

```ts
// packages/backend/convex/crud/conversations.ts
export const countByAgentAndSource = query({
  args: { agentId: v.id("agents"), source: v.union(v.literal("playground"), v.literal("simulation")) },
  handler: async (ctx, { agentId, source }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db.query("conversations")
      .withIndex("by_org", q => q.eq("orgId", orgId))
      .filter(q => q.eq(q.field("source"), source))
      .collect();
    return rows.filter(c => c.agentIds.includes(agentId)).length;
  },
});
```

If you add this, also add a test in `packages/backend/tests/conversationsCrud.test.ts` (create if it doesn't exist).

- [ ] **Step 2.4: Commit**

```bash
git add packages/frontend/src/components/calibration/SourcePicker.tsx
git add -u packages/backend/  # if you touched it
git commit -m "feat(frontend): SourcePicker — shared component for picking conversation sources"
```

---

## Task 3: `/agents/[id]/configure` page

**Files:**
- Modify or Create: `packages/frontend/src/app/agents/[id]/configure/page.tsx`

Two-pane: AgentConfigPanel (left, 380px) | AgentPlayground (right). Both components likely already exist (legacy `app/agents/page.tsx` had them inline). Find and reuse.

- [ ] **Step 3.1: Locate existing AgentConfigPanel / AgentPlayground**

```bash
grep -rn "AgentConfigPanel\|AgentPlayground" packages/frontend/src/components/ packages/frontend/src/app/ | head -10
```

- [ ] **Step 3.2: Build the page**

```tsx
"use client";
import { useParams } from "next/navigation";
import { AgentConfigPanel } from "@/components/agent/AgentConfigPanel";
import { AgentPlayground } from "@/components/agent/AgentPlayground";

export default function ConfigurePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="flex h-full">
      <div className="w-[380px] border-r border-white/10">
        <AgentConfigPanel agentId={id} />
      </div>
      <div className="flex-1">
        <AgentPlayground agentId={id} />
      </div>
    </div>
  );
}
```

Verify the playground persists conversations with `source: "playground"` (the spec requires it). If it doesn't, fix the playground's `createConversation` call.

- [ ] **Step 3.3: Commit**

```bash
git add packages/frontend/src/app/agents/[id]/configure/
git add -u packages/frontend/  # if you touched component files
git commit -m "feat(frontend): /agents/[id]/configure — two-pane config + playground"
```

---

## Task 4: `/agents/[id]/evaluate/scenarios` page

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/scenarios/page.tsx`

Lists scenarios for the agent + generation wizard entry.

- [ ] **Step 4.1: Locate `ScenarioList`, `ScenarioGenerationWizard`, `EditScenarioModal`**

```bash
grep -rn "ScenarioList\|ScenarioGenerationWizard\|EditScenarioModal" packages/frontend/src/components/ packages/frontend/src/app/ | head -10
```

These components exist in the legacy code; reuse them.

- [ ] **Step 4.2: Wire data + page**

```tsx
"use client";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { ScenarioList } from "@/components/scenarios/ScenarioList";

export default function ScenariosPage() {
  const { id } = useParams<{ id: string }>();
  const scenarios = useQuery(api.conversationSim.scenarios.byAgent, { agentId: id as any });
  // Render the list + generation wizard modal trigger
}
```

The generation wizard's submit-path will need updating — the old `scenarioGen` pipeline was deleted in Phase 1 (it was dataset-scoped). For now, the wizard can be wired to a "coming soon" placeholder OR to a synchronous `scenarios.create` mutation that lets the user write a single scenario at a time. The dimension-driven wizard rebuild is a future task.

Document which option you picked in the commit message.

- [ ] **Step 4.3: Commit**

---

## Task 5: `/agents/[id]/evaluate/experiments` (run list)

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/experiments/page.tsx`

Lists `conversationSimulations` for this agent, with a running-sim banner and `+ New Simulation` button.

- [ ] **Step 5.1: Find / add `conversationSim.orchestration.byAgent` query**

```bash
grep -n "byAgent\|byOrg" packages/backend/convex/conversationSim/orchestration.ts
```

If `byAgent` doesn't exist, add it in `orchestration.ts`:

```ts
export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    return await ctx.db.query("conversationSimulations")
      .withIndex("by_agent", q => q.eq("agentId", agentId))
      .order("desc").collect();
  },
});
```

- [ ] **Step 5.2: Page implementation**

- List of simulation rows showing: name (or last-6 of `_id`), status, scenario count, started/completed timestamps.
- Sticky "Running simulation" banner at the top when any sim has status `running` or `pending`.
- "+ New Simulation" → opens `CreateSimulationModal` (preserve / reuse the existing one, but the modal must NOT include an evaluator-set picker — that's gone in Phase 1).
- Click a row → `/agents/<id>/evaluate/experiments/<simulationId>`.

- [ ] **Step 5.3: Commit**

---

## Task 6: Lift failure-mode component to `components/failure-modes/`

**Files:**
- Move: `packages/frontend/src/app/experiments/[id]/failure-modes/_components/*` → `packages/frontend/src/components/failure-modes/`

The axial-coding UI for the per-run page in Task 8 reuses these components. Lifting them to a shared location lets the legacy `app/experiments/...` route be deleted in Task 12.

- [ ] **Step 6.1: List the components**

```bash
ls packages/frontend/src/app/experiments/[id]/failure-modes/_components/
```

- [ ] **Step 6.2: Move + fix imports**

```bash
mkdir -p packages/frontend/src/components/failure-modes
git mv packages/frontend/src/app/experiments/[id]/failure-modes/_components/*.tsx packages/frontend/src/components/failure-modes/
# Update import paths in every moved file + every caller
```

Each moved file probably has relative imports like `../../../components/...`. Rewrite them as absolute (`@/components/...`) and fix any `experimentId` references — those will be parameterized differently in Task 8 (per-run axial coding uses a `simulationId` for the data scope; failure modes themselves are now keyed by `agentId` + the discovered membership set).

If a moved component has hard `experimentId` references that don't make sense in the new world, mark them as a TODO and let Task 8 wire them properly. Don't try to fix everything in this move task — it's a relocation, not a rewrite.

- [ ] **Step 6.3: Commit**

```bash
git commit -m "refactor(frontend): lift failure-mode components to shared module"
```

---

## Task 7: `/agents/[id]/evaluate/experiments/[runId]` (run detail)

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/page.tsx`

Run detail page. Layout swap to `agentRunSidebar` is already done by the per-run layout (Phase 2).

- [ ] **Step 7.1: Page implementation**

- Metadata pane: simulation name, status, scenario count, k, model, started/completed timestamps.
- Per-scenario list with status icons and links to individual sim run rows.
- Reuse existing `ExperimentMetadataPane`, `SimRunDetail`, `ScenarioSummaryBand`, `ToolCallGroup` components (search the codebase for them; preserve as-is, only update Convex API paths).
- Data: `useQuery(api.conversationSim.orchestration.get, { id: runId })`, `useQuery(api.conversationSim.runs.bySimulation, { simulationId: runId })`.

- [ ] **Step 7.2: Commit**

---

## Task 8: `/agents/[id]/evaluate/experiments/[runId]/open-coding` page

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/open-coding/page.tsx`

Three-pane open coding: conversation list (left) | transcript (centre) | `AnnotationEditor` (right). Filter chips for source type at the top.

- [ ] **Step 8.1: Data wiring**

The sim runs each have a `conversationId`. The page renders the LIST of conversations belonging to this run, plus their annotations.

```tsx
const runs = useQuery(api.conversationSim.runs.bySimulation, { simulationId: runId });
const annotationsByConversation = /* fetch annotations per conversation via bySource */;
```

Selected conversation in URL: `?conversation=<conversationId>`. URL-driven.

- [ ] **Step 8.2: Wire AnnotationEditor**

The page imports the new `AnnotationEditor` (Task 1) and provides:
- `conversation: { turns }` — fetched via `crud.conversations.listMessages` for the selected conversation
- `existingAnnotation` — pulled from `annotations.bySource` with this conversation as the source
- `allTags` — from `annotations.allTagsForOrg`
- `onUpsert` callback — calls `annotations.upsert` with `source: { kind: "conversation", conversationId }`

- [ ] **Step 8.3: Commit**

---

## Task 9: `/agents/[id]/evaluate/experiments/[runId]/axial-coding` page

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/axial-coding/page.tsx`

Reuses the lifted failure-mode components from Task 6. Shows clusters, lets users add/remove conversations as `failureModeMemberships`, and exposes a "Create judge" button that calls `evaluator.spawnJudge.fromFailureMode`.

- [ ] **Step 9.1: Page implementation**

```tsx
const fms = useQuery(api.failureModes.crud.byAgent, { agentId });
const annotations = /* aggregate from runs */;
// Render each failure mode with member count + drag-to-assign UI
// "Create judge" button per failure mode → calls spawnJudge.fromFailureMode → navigate to /agents/[id]/evaluate/evaluators/<newId>
```

The LLM-driven generation of new failure modes (the old `startGeneration`) was deleted in Phase 1. For now the user creates failure modes manually via `failureModes.crud.create`. The auto-generate flow is a future task.

- [ ] **Step 9.2: Commit**

---

## Task 10: `/agents/[id]/evaluate/evaluators` (list) + standalone create

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/evaluators/page.tsx`
- Create: `packages/frontend/src/components/evaluators/CreateEvaluatorModal.tsx`

List of all evaluators for the agent with status badges and `+ New Evaluator` menu (Start blank / From template).

- [ ] **Step 10.1: List view**

- Data: `useQuery(api.evaluator.crud.byAgent, { agentId })`
- Columns: name, type (code/llm_judge), status (with badge color), source/provenance (Manual / From template X / Spawned from failure mode Y), label counts (queried per-evaluator via `evaluator.labels.counts`)
- Click → `/agents/<id>/evaluate/evaluators/<evalId>`

- [ ] **Step 10.2: Create modal**

Two paths:
- **Start blank**: pick type (code / llm_judge) → form for the appropriate config → calls `evaluator.crud.create` with `source: { kind: "manual" }`.
- **From template**: shows `evaluator.templates.listAll`, grouped by category. Click a template → calls `evaluator.crud.createFromTemplate` with `templateId`. Then redirects to the evaluator detail page.

- [ ] **Step 10.3: Commit**

---

## Task 11: `/agents/[id]/evaluate/evaluators/[evalId]` (detail with tabs)

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/evaluators/[evalId]/page.tsx`
- Create: `packages/frontend/src/app/agents/[id]/evaluate/evaluators/[evalId]/layout.tsx`
- Create: `packages/frontend/src/app/agents/[id]/evaluate/evaluators/[evalId]/validate/page.tsx`
- Create: tab content modules under `components/evaluators/`

Three tabs: **Configure** (default), **Labels**, **Validate**. The validate page is a separate route so it can have its own layout if needed.

- [ ] **Step 11.1: Layout with tabs**

Use `TabsLayout` (Phase 2 cherry-picked it from PR #77). Three tabs:
```tsx
const tabs = [
  { label: "Configure", href: `/agents/${id}/evaluate/evaluators/${evalId}` },
  { label: "Labels", href: `/agents/${id}/evaluate/evaluators/${evalId}?tab=labels` },
  { label: "Validate", href: `/agents/${id}/evaluate/evaluators/${evalId}/validate` },
];
```

Configure + Labels can share the same `page.tsx` and switch on `?tab=...`. Validate is its own route.

- [ ] **Step 11.2: Configure tab**

- Form to edit name, description, type, codeJudgeConfig/llmJudgeConfig, dimensions array (for multi-dim), tags.
- Save calls `evaluator.crud.update`.
- Lifecycle status displayed as a read-only badge (status transitions only via Validate or manual override).

- [ ] **Step 11.3: Labels tab**

- Table of labels with columns: source (link to conversation/transcript), label (pass/fail), split (train/dev/test), origin (axial / inferred_negative / calibration_pass / imported_annotation).
- Counts header: `{total} labels · {pass} pass · {fail} fail · train {n} / dev {n} / test {n}`.
- Add labels menu:
  - **Calibrate fresh sample** → opens calibration UI (Task 12)
  - **Import from open-coding tags** → opens tag-matching flow (defer / "coming soon" stub OK for now)
  - **Manually paste conversations** → simple list-paste form
- Delete individual label: row action → `evaluator.labels.remove`.

- [ ] **Step 11.4: Validate page**

- Empty state if no dev labels: "No dev labels yet — calibrate this evaluator first." Link to Labels tab.
- "Run validation" button → calls `useAction(api.evaluator.validate.run)`.
- Result panel: TPR, TNR, agreement, status outcome ("ready" or "validated"), with explanation.
- Show `evaluator.devMetrics` if previously computed.

- [ ] **Step 11.5: Commit**

---

## Task 12: Calibration sub-flow

**Files:**
- Create: `packages/frontend/src/components/calibration/CalibrationFlow.tsx`

Triggered from the Labels tab (Task 11) "Calibrate fresh sample". Modal or dedicated route — your choice (modal is simpler).

- [ ] **Step 12.1: Flow design**

1. **Pick source pool** — uses `SourcePicker` (Task 2).
2. **Pick sample size + split ratios** — defaults: 30 conversations, 60/20/20 split.
3. **Calibration loop** — one conversation at a time:
   - Show transcript
   - Show judge name + rubric
   - Buttons: [Pass] [Fail] [Skip]
   - On Pass/Fail: calls `evaluator.labels.upsert` with the appropriate `humanLabel`, `splitAssignment: <deterministic per index>`, `origin: { kind: "calibration_pass" }`.
4. **Progress bar** + final summary at the end.

- [ ] **Step 12.2: Wiring**

The calibration component is invoked with `(evaluatorId, agentId)`. It internally manages source selection state, the sample list, and per-conversation form state. On exit, returns to the Labels tab which auto-refreshes via Convex reactivity.

- [ ] **Step 12.3: Commit**

---

## Task 13: Delete legacy routes

**Files (deletions):**
- `packages/frontend/src/app/evaluators/` (entire directory)
- `packages/frontend/src/app/experiments/[id]/annotate/`
- `packages/frontend/src/app/experiments/[id]/failure-modes/`
- `packages/frontend/src/app/experiments/[id]/_components/ExperimentNavSidebar.tsx`
- `packages/frontend/src/app/experiments/[id]/layout.tsx`

The legacy `app/agents/page.tsx` was already replaced in Phase 2 Task 2.

- [ ] **Step 13.1: Confirm no imports remain into these dirs from live code**

```bash
grep -rn "from.*app/evaluators\|from.*experiments/\[id\]/annotate\|from.*experiments/\[id\]/failure-modes\|ExperimentNavSidebar" packages/frontend/src/ | grep -v "^packages/frontend/src/app/evaluators\|^packages/frontend/src/app/experiments/\[id\]/"
```
Expected: empty. Any live import means a Phase 3 page still depends on legacy code — fix that first.

- [ ] **Step 13.2: Delete**

```bash
git rm -r packages/frontend/src/app/evaluators
git rm -r packages/frontend/src/app/experiments/[id]/annotate
git rm -r packages/frontend/src/app/experiments/[id]/failure-modes
git rm packages/frontend/src/app/experiments/[id]/_components/ExperimentNavSidebar.tsx
git rm packages/frontend/src/app/experiments/[id]/layout.tsx
```

If `app/experiments/[id]/_components/` becomes empty after deleting `ExperimentNavSidebar`, remove the directory too.

- [ ] **Step 13.3: Final typecheck**

```bash
pnpm typecheck 2>&1 | grep -c "error TS"
```
Target: 0. If there are still errors, they're either real bugs or another legacy reference that needs cleanup.

- [ ] **Step 13.4: Build**

```bash
pnpm -C packages/frontend build 2>&1 | tail -20
```
Target: build succeeds.

- [ ] **Step 13.5: Commit**

```bash
git commit -m "chore(frontend): delete legacy agent-side routes (replaced by re-haul)"
```

---

## Task 14: Cleanup of unused lib files

- [ ] **Step 14.1: Check for now-unused lib files**

```bash
grep -rn "useKbFromUrl\|KBDropdown\|ModeSelector" packages/frontend/src/ | grep -v node_modules
```

If `useKbFromUrl`, `KBDropdown`, or `ModeSelector` are no longer referenced after the legacy deletion, the **KB section's PR #77** owns the cleanup of those (per the spec — "still referenced by un-migrated pages owned by KB / Conversations worktrees. Each section cleans up what it owns when the last reference disappears"). Verify; if YOU were the last reference and now they're orphans, you may delete them as a courtesy. Otherwise leave them.

- [ ] **Step 14.2: Commit if anything removed**

---

## Final verification — full re-haul

- [ ] **Step F.1: Backend + frontend both green**

```bash
pnpm typecheck:backend
pnpm typecheck
pnpm -C packages/backend test 2>&1 | grep -E "Test Files|Tests "
pnpm -C packages/frontend build 2>&1 | tail -5
```
All four: clean / passing.

- [ ] **Step F.2: Manual click-through per spec testing section**

Run through every checkbox in the spec's "Testing (manual click-through)" section. Record outcomes in the PR description.

- [ ] **Step F.3: Commit graph review**

```bash
git log --oneline e128d43..HEAD
```
Expected: ~14-16 commits, one per task, no fixup/wip noise.

- [ ] **Step F.4: Open PR**

```bash
git push -u origin worktree-frontend-rehaul-agent-branch
gh pr create --base main --title "feat: Agents section re-haul (Phase 1+2+3)" --body "$(cat <<'EOF'
## Summary
Full re-haul of the Agents section per `docs/superpowers/specs/2026-05-26-frontend-rehaul-agents-design.md` (rev 3).

- Phase 1: backend schema reshape + CRUD (greenfield, no migrations)
- Phase 2: shell + sidebars + landing
- Phase 3: routes + pages + AnnotationEditor / SourcePicker / calibration

## Test plan
[Copy from the spec's Testing section + mark each checkbox]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope (deferred to future tasks)

- LLM-judge real scoring (stubbed in Phase 1, surfaced honestly in the UI as `[stub]` status)
- Scenario generation pipeline rebuild (the old dataset-scoped generator was deleted; agent-scoped rebuild is a separate task)
- Automatic axial-coding LLM generation (`startGeneration` was deleted; manual failure-mode create + drag-to-assign is the Phase 3 path)
- Ad-hoc `/apply` page (route reservation also dropped; inline auto-apply at sim time covers current cases)
- Org-custom evaluator templates (additive when needed)
- Real production conversation source (slot is in the polymorphic union; UI doesn't surface it yet)
- Agent-delete cascade (known gap; add when "Delete agent" UI is exercised heavily)
