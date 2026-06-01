# Agents Re-haul — Phase 2: Shell + Sidebar + Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the agent-section shell layer — landing page at `/agents`, per-agent layout wrapper, per-run nested layout, and the rev-3 sidebar correction (drop the per-run Evaluators sub-page). Keeps frontend buildable so Phase 3 can layer routes on top.

**Architecture:** Most shell pieces were already cherry-picked from PR #77 in commit `31fe681` (`EntityDetailLayout`, `Spinner`, `ErrorToast`, `sidebars.tsx`, `useAgentBreadcrumb`). This phase only adds the routes that consume them + corrects one rev-2 → rev-3 sidebar drift. No new components beyond layout files.

**Tech Stack:** Next.js 16 app router, Tailwind v4, Convex React hooks, Clerk auth.

---

## Pre-flight

- [ ] **Step 1: Verify Phase 1 is on HEAD**

```bash
git log -1 --oneline
git rev-parse HEAD
```
Expected: HEAD should be `e128d43` (Phase 1 final review fixes) or a descendant. If you see a different commit, escalate — Phase 2 assumes Phase 1 schema + CRUD has shipped.

- [ ] **Step 2: Snapshot frontend typecheck baseline**

```bash
pnpm typecheck 2>&1 | grep -c "error TS"
```

This will be a large number — Phase 1 broke frontend intentionally. Note the count. Phase 2 tasks should keep it stable or reduce it; significant growth means a Phase 2 task introduced new breakage rather than removing it.

- [ ] **Step 3: Verify shell pieces from PR #77 are present**

```bash
ls packages/frontend/src/components/shell/{EntityDetailLayout,Spinner,ErrorToast,sidebars}.tsx
ls packages/frontend/src/lib/useAgentBreadcrumb.ts
```
All five should exist. If any are missing, escalate — they were cherry-picked in commit `31fe681` and should still be there.

- [ ] **Step 4: Verify the EntityListLayout shell helper exists**

```bash
ls packages/frontend/src/components/shell/EntityListLayout.tsx
```
This is the grid/list container used for landings. Phase 2's `/agents/page.tsx` uses it.

---

## Task 1: Rev-3 sidebar correction — drop per-run Evaluators

**Files:**
- Modify: `packages/frontend/src/components/shell/sidebars.tsx:62-70`

Rev 2 of the spec had a per-run Evaluators sub-page. Rev 3 removed it — evaluators are agent-owned, not run-scoped. The `agentRunSidebar` still has the dropped entry; fix it.

- [ ] **Step 1.1: Remove the Evaluators entry from `agentRunSidebar`**

Current (line 62-70):
```ts
export function agentRunSidebar(agentId: string, runId: string): SidebarItem[] {
  const base = `/agents/${agentId}/evaluate/experiments/${runId}`;
  return [
    { label: "Run detail", href: base, icon: ICONS.experiments, match: (p) => p === base },
    { label: "Open coding", href: `${base}/open-coding`, icon: ICONS["open-coding"] },
    { label: "Axial coding", href: `${base}/axial-coding`, icon: ICONS["axial-coding"] },
    { label: "Evaluators", href: `${base}/evaluators`, icon: ICONS.evaluators },   // ← DELETE this line
  ];
}
```

Delete the last entry only. Result is three entries: Run detail, Open coding, Axial coding.

- [ ] **Step 1.2: Verify typecheck still passes for this file**

```bash
pnpm typecheck 2>&1 | grep "sidebars\.tsx" | head -5
```
Expected: empty.

- [ ] **Step 1.3: Commit**

```bash
git add packages/frontend/src/components/shell/sidebars.tsx
git commit -m "fix(frontend): drop per-run Evaluators sub-page from agentRunSidebar (rev 3)

Rev 3 of the spec moved evaluators to be agent-owned, not run-scoped.
The per-run sidebar should expose only run-level activities: Run detail,
Open coding, Axial coding."
```

---

## Task 2: Agent landing page `/agents`

**Files:**
- Create: `packages/frontend/src/app/agents/page.tsx` (replaces the existing legacy single-page if any)

Pattern this after the new `/kb/page.tsx` landing in PR #77 — a list of agent cards with a "+ New agent" affordance that calls `crud.agents.create` then navigates to `/agents/<id>/configure`.

- [ ] **Step 2.1: Inspect the existing `/agents/page.tsx` (legacy)**

```bash
cat packages/frontend/src/app/agents/page.tsx
```

If it's the legacy "Create / Experiment" UI per the spec, replace it wholesale. Otherwise read it and preserve anything still useful.

- [ ] **Step 2.2: Inspect the KB landing for the pattern to mirror**

```bash
cat packages/frontend/src/app/kb/page.tsx | head -80
```

Note: the KB landing uses `EntityListLayout`, breadcrumb is "Knowledge Bases" (no entity selected), and has a `+ New KB` modal. Mirror this shape.

- [ ] **Step 2.3: Write the new landing**

Required surfaces:
- Header text: "Agents"
- Data: `useQuery(api.crud.agents.byOrg, ...)` — find the actual API surface for listing agents (look in `packages/backend/convex/crud/agents.ts`).
- "+ New agent" button → opens a small modal asking for agent name → calls `useMutation(api.crud.agents.create, ...)` with sensible defaults (look at the existing agent create flow for the defaults shape).
- On create success: `router.push(\`/agents/${newId}/configure\`)`.
- Each card shows: agent name, brief description (if available), creation date. Click → `/agents/<id>/configure`.
- Empty state: a placeholder card prompting "Create your first agent".

Reference shape (adapt to actual `agents` schema + create surface):

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { EntityListLayout } from "@/components/shell/EntityListLayout";

export default function AgentsLandingPage() {
  const agents = useQuery(api.crud.agents.byOrg, {});
  const createAgent = useMutation(api.crud.agents.create);
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  async function handleCreate(name: string) {
    const id = await createAgent({ name, /* ...defaults */ });
    router.push(`/agents/${id}/configure`);
  }

  return (
    <EntityListLayout
      title="Agents"
      headerActions={<button onClick={() => setShowModal(true)}>+ New agent</button>}
      breadcrumbs={[{ label: "Agents", href: "/agents" }]}
    >
      {agents === undefined && <div>Loading…</div>}
      {agents && agents.length === 0 && (
        <EmptyState onCreate={() => setShowModal(true)} />
      )}
      {agents && agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((a) => (
            <AgentCard key={a._id} agent={a} onClick={() => router.push(`/agents/${a._id}/configure`)} />
          ))}
        </div>
      )}
      {showModal && <CreateAgentModal onCreate={handleCreate} onClose={() => setShowModal(false)} />}
    </EntityListLayout>
  );
}
```

The exact `crud.agents.byOrg` / `crud.agents.create` signatures are owned by the existing backend — DO NOT change them in this task. If they don't exist or have a different name, fix the import to match what's actually exported.

- [ ] **Step 2.4: Verify build**

```bash
pnpm -C packages/frontend build 2>&1 | tail -20
```
Expected: build succeeds OR fails only on routes other than `/agents` (those are Phase 3 work). The landing route itself must build.

- [ ] **Step 2.5: Commit**

```bash
git add packages/frontend/src/app/agents/page.tsx
git commit -m "feat(frontend): /agents landing — grid of agent cards + create modal"
```

---

## Task 3: Per-agent layout `/agents/[id]/layout.tsx`

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/layout.tsx`

This layout wraps everything under a specific agent and supplies `agentSidebar` + breadcrumb. Pattern after `app/kb/[id]/layout.tsx` from PR #77.

- [ ] **Step 3.1: Inspect the KB layout for the pattern**

```bash
cat packages/frontend/src/app/kb/[id]/layout.tsx
```

Note how it uses `EntityDetailLayout`, `kbSidebar(kbId)`, and `useKbBreadcrumb`. Mirror for agents.

- [ ] **Step 3.2: Implement the agent layout**

```tsx
"use client";
import { useParams } from "next/navigation";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { agentSidebar } from "@/components/shell/sidebars";
import { useAgentBreadcrumb } from "@/lib/useAgentBreadcrumb";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const { agent, labelOverrides } = useAgentBreadcrumb(agentId);

  return (
    <EntityDetailLayout
      sidebar={agentSidebar(agentId)}
      breadcrumbs={[
        { label: "Agents", href: "/agents" },
        { label: agent?.name ?? agentId, href: `/agents/${agentId}/configure` },
      ]}
      labelOverrides={labelOverrides}
    >
      {children}
    </EntityDetailLayout>
  );
}
```

Verify the `useAgentBreadcrumb` shape — it should already return `{ agent, labelOverrides }`. If it doesn't, escalate; that hook should have been written in commit `31fe681`.

- [ ] **Step 3.3: Verify build**

```bash
pnpm -C packages/frontend build 2>&1 | grep -E "agents/\[id\]/layout|error" | head -10
```

- [ ] **Step 3.4: Commit**

```bash
git add packages/frontend/src/app/agents/[id]/layout.tsx
git commit -m "feat(frontend): /agents/[id]/layout — EntityDetailLayout + agentSidebar"
```

---

## Task 4: Per-run nested layout

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/layout.tsx`

Inside a sim run, the sidebar swaps from `agentSidebar` to `agentRunSidebar`. Same EntityDetailLayout, different sidebar function. Breadcrumb extends with the run's identifier.

- [ ] **Step 4.1: Implement**

```tsx
"use client";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { EntityDetailLayout } from "@/components/shell/EntityDetailLayout";
import { agentRunSidebar } from "@/components/shell/sidebars";
import { useAgentBreadcrumb } from "@/lib/useAgentBreadcrumb";

export default function AgentRunLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string; runId: string }>();
  const agentId = params.id;
  const runId = params.runId;
  const { agent } = useAgentBreadcrumb(agentId);
  // Optional: fetch the simulation row for a friendlier breadcrumb label
  // const sim = useQuery(api.conversationSim.orchestration.get, { id: runId as any });

  return (
    <EntityDetailLayout
      sidebar={agentRunSidebar(agentId, runId)}
      breadcrumbs={[
        { label: "Agents", href: "/agents" },
        { label: agent?.name ?? agentId, href: `/agents/${agentId}/configure` },
        { label: "Experiments", href: `/agents/${agentId}/evaluate/experiments` },
        { label: `Run ${runId.slice(-6)}`, href: `/agents/${agentId}/evaluate/experiments/${runId}` },
      ]}
    >
      {children}
    </EntityDetailLayout>
  );
}
```

The fourth breadcrumb shows the last 6 chars of `runId` as a placeholder. Phase 3 can swap in the simulation's actual name once that's wired.

- [ ] **Step 4.2: Build check**

```bash
pnpm -C packages/frontend build 2>&1 | grep -E "experiments/\[runId\]/layout|error" | head -10
```

- [ ] **Step 4.3: Commit**

```bash
git add packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/layout.tsx
git commit -m "feat(frontend): nested per-run layout swaps to agentRunSidebar"
```

---

## Task 5: `/agents/[id]/evaluate` redirect

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/page.tsx`

`/agents/[id]/evaluate` itself is just an accordion parent — visiting it should redirect to a sensible child (Scenarios by default).

- [ ] **Step 5.1: Implement redirect**

```tsx
import { redirect } from "next/navigation";

export default async function EvaluateIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/agents/${id}/evaluate/scenarios`);
}
```

Use the Next.js 16 `params: Promise<...>` shape (matches the KB section's analogous `app/kb/[id]/evaluate/page.tsx`).

- [ ] **Step 5.2: Commit**

```bash
git add packages/frontend/src/app/agents/[id]/evaluate/page.tsx
git commit -m "feat(frontend): /agents/[id]/evaluate redirects to /scenarios"
```

---

## Task 6: TabsLayout upgrade check (optional, time-permitting)

**Files:**
- Possibly modify: `packages/frontend/src/components/shell/TabsLayout.tsx`

PR #77 upgraded `TabsLayout.tsx`. The evaluator-detail page in Phase 3 uses it heavily (Configure / Labels / Validate tabs). Verify the worktree version matches PR #77's:

- [ ] **Step 6.1: Diff against PR #77's version**

```bash
git diff origin/worktree-frontend-rehaul-kb-branch -- packages/frontend/src/components/shell/TabsLayout.tsx
```

If the diff is empty or only whitespace, skip the rest of this task. If there's a real diff, cherry-pick PR #77's version:

```bash
git checkout origin/worktree-frontend-rehaul-kb-branch -- packages/frontend/src/components/shell/TabsLayout.tsx
```

- [ ] **Step 6.2: Build check**

```bash
pnpm -C packages/frontend build 2>&1 | tail -20
```

- [ ] **Step 6.3: Commit (only if a change was made)**

```bash
git add packages/frontend/src/components/shell/TabsLayout.tsx
git commit -m "chore(frontend): cherry-pick TabsLayout upgrade from PR #77 (KB branch)"
```

---

## Final verification

- [ ] **Step F.1: Confirm Phase 2 commit graph**

```bash
git log --oneline e128d43..HEAD
```
Expected: 4-6 commits (Task 1, 2, 3, 4, 5, optionally 6).

- [ ] **Step F.2: Frontend typecheck count**

```bash
pnpm typecheck 2>&1 | grep -c "error TS"
```
Expected: same as Phase 2 baseline (from pre-flight) OR less. If it grew, a task introduced new breakage — investigate.

- [ ] **Step F.3: Manual click-through**

Start the dev server (`pnpm dev`) and verify:
- `/agents` loads, shows agent cards
- Clicking + New agent opens a modal; submit navigates to `/agents/<id>/configure` (the page itself may 404 — that's Phase 3, but the navigation should work)
- Direct navigation to `/agents/<id>/evaluate/experiments/<some-run-id>` shows the per-run nested sidebar (the page content will 404, that's Phase 3)
- `/agents/<id>/evaluate` redirects to `/scenarios`

Record any issues in the PR description.

- [ ] **Step F.4: Hand off to Phase 3**

Phase 3 plan: `docs/superpowers/plans/2026-05-26-agents-rehaul-phase3-routes.md`. It depends on the shell from this phase plus the backend from Phase 1.

---

## Out of scope (Phase 3 owns)

- Any page content under `/agents/[id]/...` other than landing + layouts
- AnnotationEditor, SourcePicker, evaluator detail tabs
- Real-conversation source picker UI
- All routes for scenarios / experiments / evaluators / open-coding / axial-coding
