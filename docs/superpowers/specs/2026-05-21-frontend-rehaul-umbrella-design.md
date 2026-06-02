# Frontend Re-haul — Umbrella Design

**Date:** 2026-05-21
**Status:** Draft
**Scope:** Cross-cutting frontend information architecture, shell, and routing changes. Implementation is split across three section-specific specs (Knowledge Base, Agents, Conversations).

## Goal

Restructure the frontend around four top-level sections that match the actual user workflow, replacing today's flat collection of modules (`agents`, `kb`, `dataset`, `retrievers`, `evaluators`, `experiments`, plus livechat). Make entity selection URL-driven so navigation preserves context.

## Non-goals

- No backend schema changes. Backend support is additive only (a handful of new list/scoped queries).
- No visual or UX redesign of individual feature components (playgrounds, wizards, modals). This re-haul is structural; existing components are reused as-is.
- No new test framework. Verification is manual click-through per PR.
- No cross-section command palette, no search, no Analytics implementation.

## Information architecture

Four top-level sections, ordered by the workflow dependency chain:

```text
Top nav:  Knowledge Base | Agents | Conversations | Analytics
Default landing:  /kb
```

Tree:

```text
Knowledge Base           (list-landing → pick KB → sidebar)
  └─ /kb/<id>/
      • Configure                (docs + indexing playground)
      • Evaluate
          ├─ Datasets
          ├─ Retrievers          (list → retriever detail w/ config + playground)
          └─ Experiments         (retriever experiment runs)

Agents                   (list-landing → pick agent → sidebar)
  └─ /agents/<id>/
      • Configure                (agent config + agent playground)
      • Evaluate
          ├─ Scenarios
          ├─ Experiments         (scenario simulations)
          ├─ Open coding         (annotate scenario-run conversations)
          ├─ Axial coding        (failure modes over annotations)
          └─ Evaluators

Conversations            (tabs landing)
  • Real conversations          tab   (live agent chat sessions)
  • Transcripts                 tab   (upload + analyze)

Analytics & Insights     /analytics   (placeholder, "coming soon")
```

## Shell

Persistent components rendered around every page.

- **TopBar** — left: logo + workspace/org switcher (Clerk). Center: four section links. Right: user menu. Replaces today's `Header.tsx` + `ModeSelector` pattern.
- **EntityListLayout** — landing template for sections with multiple entities (Knowledge Base, Agents). Header (`+ New`), filter/search, grid/table of entity cards.
- **EntityDetailLayout** — wraps a picked entity. Renders breadcrumb, left sidebar with the entity's subsections, main content. Sidebar collapses on mobile.
- **TabsLayout** — flat two-tab pattern used inside Conversations.
- **Breadcrumbs** — derived from route (e.g. `Knowledge Base / acme-docs / Evaluate / Datasets`).
- **Reused as-is:** `AuthGate.tsx`, `ConvexClientProvider.tsx`.

## Routing

```text
/kb                                       → list landing
/kb/<id>/configure                        → docs + indexing playground
/kb/<id>/evaluate/datasets
/kb/<id>/evaluate/retrievers              → retriever list
/kb/<id>/evaluate/retrievers/<rid>        → retriever config + playground
/kb/<id>/evaluate/experiments
/agents                                   → list landing
/agents/<id>/configure                    → agent config + playground
/agents/<id>/evaluate/scenarios
/agents/<id>/evaluate/experiments
/agents/<id>/evaluate/experiments/<runId>
/agents/<id>/evaluate/open-coding
/agents/<id>/evaluate/axial-coding
/agents/<id>/evaluate/evaluators
/conversations                            → tabs (real | transcripts)
/conversations/transcripts/<id>           → transcript detail
/analytics                                → "coming soon"
```

## URL-as-state principle

All selection state (current KB, current agent, current retriever, current experiment run, active sub-tab) lives in the URL. No local component state, no global store, no dropdown that remembers selection. Deep-linking, refresh, and back/forward must always restore the exact view.

Today's pain point — coming back from a detail page resets the global KB dropdown and forces re-selection — is eliminated by virtue of this rule.

## Backend support

All changes are additive. Existing endpoints checked:

- `crud/agents.byOrg` — exists, powers `/agents` landing.
- `crud/knowledgeBases.list` and `listWithDocCounts` — exist, power `/kb` landing.
- `annotations.byExperiment` — exists; a new `annotations.byAgent(agentId)` query is needed to power `/agents/<id>/evaluate/open-coding` without requiring an experiment to be picked first.
- Conversations listing (org-scoped, spans live sessions + uploaded transcripts) — to be verified against existing livechat queries during the Conversations section PR. If missing, add additively.

Each section PR is responsible for flagging any additional backend tweaks discovered during implementation. None should be breaking.

## Spec decomposition

This umbrella spec defines the shell, IA, and routing. Three section-specific specs cover the actual page moves:

- `2026-05-21-frontend-rehaul-knowledge-base-design.md`
- `2026-05-21-frontend-rehaul-agents-design.md`
- `2026-05-21-frontend-rehaul-conversations-design.md`

## Sequencing

Five PRs, the section PRs parallelizable across worktrees:

1. **Umbrella PR** — TopBar + four-section nav + routing skeleton + shell layouts (EntityListLayout, EntityDetailLayout, TabsLayout, Breadcrumbs) + stub section landings + Analytics placeholder. Old routes still work; new ones render placeholders pointing to old.
2. **Knowledge Base PR** *(worktree)* — moves `kb`, `dataset`, `retrievers`, `experiments` pages under `/kb/<id>/...`, deletes the legacy routes in the same PR.
3. **Agents PR** *(worktree)* — moves `agents`, `evaluators`, scenario/experiment components under `/agents/<id>/...`, deletes legacy routes. Lifts open/axial coding to `Agents > Evaluate` (component contract: conversation-source-agnostic; today wired to scenario-experiment results).
4. **Conversations PR** *(worktree)* — moves livechat + transcripts under `/conversations`, deletes legacy routes.

PRs 2–4 are independent; whichever lands first deletes its old routes and the others rebase. No feature flag, no parallel-running old UI.

## Open coding / axial coding — data binding

Today, annotations and failure modes are foreign-keyed to `agentExperimentResults`. The data model does **not** change in this re-haul. The new open-coding and axial-coding pages render the same data filtered by agent (across all of that agent's experiment runs) instead of filtered by a single picked experiment.

The React components themselves take a generic "conversation source" prop so they can later be reused for live conversations or uploaded transcripts. Generalizing the *data model* to polymorphic targets is explicitly out of scope and tracked as a future change.

## Testing

Manual click-through per PR:

- Every new route renders.
- Breadcrumbs reflect the route.
- Deep-link, refresh, and back/forward preserve all selection state.
- Reused components (playgrounds, wizards, modals) behave as before.

No new automated tests. No new test framework. Adding tests is justified only when a specific regression risk warrants it.

## Risks

- **Open/axial coding decoupling drift.** The components are currently wired to dataset-scoped retrieval experiment context in places. The Agents section PR must produce a clean conversation-source-agnostic component contract. Mitigation: spec calls this out explicitly; reviewer should reject leaked dataset/retriever assumptions.
- **Scope creep.** Tempting to redesign forms and wizards while moving them. Each section spec states: *move-only, no visual or UX redesign except shell and landings*.
- **Backend gaps discovered late.** Mitigated by the additive-only constraint — section PRs add small queries as needed, never break existing ones.

## Deferred

- Surfacing scenario-run conversations inside the Conversations section.
- Generalizing annotations/failure modes to arbitrary conversation sources at the schema level.
- Analytics content.
- Cross-section search / command palette.
