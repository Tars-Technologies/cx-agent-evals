# Transcript Visibility for Scenarios and Simulated Runs

**Status:** Design approved — ready for implementation plan
**Date:** 2026-04-28
**Scope:** Frontend-only (`packages/frontend`)

## Problem

When working with transcript-grounded scenarios and simulated conversations, the user has no way to see the connecting context:

1. **On the dataset page** — clicking a scenario shows persona / source / info boundaries / instructions / reference messages, but not the live-chat transcript that produced the scenario. There's no way to verify the scenario faithfully captured the user's intent.
2. **On the agents page (experiments mode)** — clicking a simulated run shows the back-and-forth between simulated user and agent, but not the scenario it was run against, and not the source transcript that scenario was generated from. Comparing simulated vs. real conversations requires switching pages and losing context.
3. **Tool calls in the simulated conversation are aggregated at the bottom** of the conversation rather than rendered inline above the assistant message that called them, even though the data already supports per-turn rendering.

Without these views the user cannot diagnose where the simulator drifts from the source — which is the primary reason simulations fail to mirror real conversations.

## Out of scope

Bundled into separate follow-up changes:

- **Tracing / observability infrastructure** (Phoenix / Arize / Langfuse / OTEL). Capturing per-step LLM and tool events to an external sink is its own design problem.
- **Simulation-quality improvements**: the simulator's user-message generation and the agent harness behavior. Both benefit from the visibility introduced here, but should be tuned in their own iterations once diagnostics exist.
- **Translation toggle** in the source transcript view.
- **Virtualization** for very long transcripts (current data is bounded enough that native scroll suffices).
- **Backend schema changes.** All required linkages already exist on the records. (One narrow exception: a new non-throwing `scenarios.getMaybe` query is added because the existing `scenarios.get` throws on missing/cross-org scenarios, and we need null-safe behavior for the agents-page run detail view in the rare case where a linked scenario is deleted.)

## Existing data model (no changes)

```
livechatConversations             conversationScenarios          conversationSimRuns
─────────────────────             ─────────────────────          ─────────────────────
_id                          ←── sourceTranscriptId? ──→ _id ←── scenarioId
conversationId                    persona, intent, etc.          conversationId  ──→ messages[*]
messages[] {role, text, …}        referenceMessages[]            score, status, …
```

- `conversationScenarios.sourceTranscriptId` already references the source live-chat conversation when the scenario was generated from one (synthetic scenarios leave it null).
- `conversationSimRuns.scenarioId` already references the scenario.
- Tool-call events are already persisted per-turn as separate `tool_call` / `tool_result` rows in the `messages` table, ordered by the `order` field. The simulator's display layer just doesn't render them inline.

The only gaps are in the frontend.

## Design decisions

### A. Side-by-side compare on both pages

Both pages use the same toggle pattern: clicking "View source" / "Compare to source" splits the rightmost detail area into two columns. No new drawer/modal infrastructure.

**Agents page** — `SimRunDetail` body splits into:
- **Left column:** simulated conversation (existing renderer, with inline tool-call pills — see C).
- **Right column:** source live-chat transcript.
- **Above both:** a `ScenarioSummaryBand` showing the connecting scenario (collapsible).

**Dataset page** — `ScenarioDetail` body splits into:
- **Left column:** existing scenario fields (persona, info boundaries, instructions, reference messages, etc.).
- **Right column:** source live-chat transcript.

Rationale: the primary comparison is *simulated vs. real* (agents page) and *scenario vs. source* (dataset page). Putting them side-by-side makes the comparison physical — the user's eye scans across instead of switching tabs or pulling up an overlay. Using the same toggle pattern on both pages is a symmetry win.

Rejected alternatives:
- *Right-side drawer overlay.* Inconsistent with the existing app's modal style and obscures the scenario context behind it.
- *Full-screen overlay.* Interrupts flow; loses surrounding navigation.

### B. Source transcript view — plain, reuse `ChatBubble`

The source transcript renders as a small header (conv id, agent name, message count) plus a flat list of messages. Each message uses the existing `ChatBubble.tsx` (`packages/frontend/src/components/livechat/ChatBubble.tsx`), which already handles role styling for `user` / `human_agent` (rendered as agent) / `workflow_input` (centered system pill). Reusing this avoids re-implementing role styling and stays visually consistent with the live-chat view.

Same `SourceTranscriptPanel` is used on both pages.

Rationale: the original consideration was to highlight the messages that were extracted as scenario "seeds". In practice the seed is the first user message, so per-message highlighting was visual noise. The plain transcript suffices.

### C. Tool calls — reuse the playground pattern

`AgentPlayground.tsx` already groups consecutive `tool_call` / `tool_result` messages between user→assistant turns and renders them as a "**N tools called**" expandable pill above the assistant message. The simulated-conversation view in `SimRunDetail.tsx` will use the same pattern — no new design.

The grouping logic and pill component are extracted into shared modules so both consumers (Playground, SimRunDetail) call the same code.

### D. Triggers and synthetic scenarios

- **Dataset page:** "View source transcript" toggle in the `ScenarioDetail` header. Visible only when `scenario.sourceTranscriptId` is present. The existing read-only `Source transcript: <id>` line at lines 84-88 of `ScenarioDetail.tsx` is replaced by this toggle.
- **Agents page:** "Compare to source" toggle in the `SimRunDetail` header. Visible only when the run's scenario has `sourceTranscriptId`.
- Synthetic scenarios show no trigger and no placeholder — the controls are simply absent.

When a toggle is on the rightmost detail area splits 50/50; toggling off restores single-column. State is local component state (`useState<boolean>`).

## Component architecture

All paths are under `packages/frontend/src/`.

### New components

- **`components/livechat/SourceTranscriptPanel.tsx`** — Pure presentational. Takes a `sourceTranscriptId: Id<"livechatConversations">`. Fetches via the existing `api.livechat.orchestration.getConversation` query. Renders a small header (`conversationId`, `agentName`, message count) and a list of `ChatBubble` components for each message. Loading / null / empty states handled inline. Co-located with `ChatBubble` because it's a livechat-domain view component, not sim-specific. Reused on both pages.
- **`components/conversation-sim/ScenarioSummaryBand.tsx`** — Used on the agents page above the comparison columns. Takes a scenario object (already fetched by parent). Default collapsed: a single row showing `topic · persona.type · complexity-chip` with `intent` on a truncated second line (e.g. `"Refund request · frustrated_user · high · Customer wants refund for a damaged…"`). Expanded: renders the shared `ScenarioFields` sub-component **inline** (pushes the comparison columns down — does not overlay). Returns `null` if scenario is null (deleted record). Returns a thin skeleton row if scenario is `undefined` (loading).
- **`components/conversation-sim/ToolCallGroup.tsx`** — Extracted from `AgentPlayground.tsx` (the inline `GroupedToolCallsPill` component at the top of the file). Pure presentational; takes pre-grouped tool calls and renders the "**N tools called**" expandable pill.

### Shared extraction

- **`components/ScenarioFields.tsx`** — The scenario field rendering currently in `ScenarioDetail.tsx` (sections from line ~54 onward: persona, source, scenario, info boundaries, instruction, reference messages) is lifted here. The local `Chip` helper (`ScenarioDetail.tsx` line 158) is hoisted with it. Both `ScenarioDetail` (full view, dataset page) and the expanded state of `ScenarioSummaryBand` render this component.
- **`lib/messageDisplay.ts`** — `groupMessagesWithToolCalls(messages)` returns `Array<{ type: "message" | "tool_group", ... }>`. Pure function lifted near-verbatim from `AgentPlayground.tsx` lines ~152-210.

### Modified components

- **`components/ScenarioDetail.tsx`** — Three changes:
  1. Replace the read-only "Source transcript: \<id\>" line (lines 84-88) with a "View source transcript" toggle button.
  2. Add local `useState<boolean>` for the toggle; when on, render the body in a 2-column flex split with `ScenarioFields` on the left and `SourceTranscriptPanel` on the right.
  3. Move the inline scenario-field JSX into `ScenarioFields` and consume it.
- **`components/conversation-sim/SimRunDetail.tsx`** — Four changes:
  1. Fetch the scenario via `useQuery(api.conversationSim.scenarios.getMaybe, { id: run.scenarioId })`.
  2. Render `ScenarioSummaryBand` above the transcript section.
  3. Add a "Compare to source" toggle in the header (conditional on `scenario.sourceTranscriptId`); split the run-detail body into two columns when on.
  4. Replace the bottom tool-calls section (current `SimRunDetail.tsx` lines 91-102) by interleaving `ToolCallGroup` pills above each assistant message using `groupMessagesWithToolCalls`. The bottom section is deleted. Behavior improvement: the existing bottom section shows only `tool_call` rows; the new inline grouping pairs each `tool_call` with its `tool_result` (matching the playground), so users finally see what the tool returned.
- **`components/AgentPlayground.tsx`** — Refactor to consume the extracted `ToolCallGroup` component and `groupMessagesWithToolCalls` utility. Visible behavior unchanged.

## Data flow

### Dataset page

```
ScenarioDetail (scenario already loaded by parent via scenarios.byDataset)
  ├─ "View source transcript" toggle  →  local boolean state
  └─ Body
       ├─ Left:   ScenarioFields(scenario)   // existing fields, extracted
       └─ Right (when toggle on AND scenario.sourceTranscriptId):
              SourceTranscriptPanel({ sourceTranscriptId })
                └─ useQuery(api.livechat.orchestration.getConversation, { id })
                   (skip-gated until toggle is on)
```

### Agents page

```
SimRunDetail (run already loaded via api.conversationSim.runs.get)
  ├─ useQuery(api.conversationSim.scenarios.getMaybe, { id: run.scenarioId })
  ├─ useQuery(api.crud.conversations.listMessages, { conversationId: run.conversationId })  // existing call at SimRunDetail.tsx:15-18
  ├─ ScenarioSummaryBand({ scenario })
  ├─ "Compare to source" toggle  →  local boolean state
  └─ Run detail body
       ├─ Left:  groupMessagesWithToolCalls(messages) → render messages + inline ToolCallGroup pills
       └─ Right (when toggle on AND scenario.sourceTranscriptId):
              SourceTranscriptPanel({ sourceTranscriptId: scenario.sourceTranscriptId })
                └─ useQuery(api.livechat.orchestration.getConversation, { id })
                   (skip-gated until toggle is on)
```

One new Convex query (`scenarios.getMaybe`) — see "Out of scope" exception. No mutations or actions. No prefetching: source transcripts fetch only when the user explicitly toggles compare on. Existing Convex hooks are cache-friendly and request-deduplicated, so toggling rapidly is cheap.

## Edge cases

| Case | Behavior |
|---|---|
| Scenario has no `sourceTranscriptId` (synthetic) | Both triggers hidden. No placeholders. |
| Run has no `conversationId` yet (pending/failed sim) | Existing pending/error states unchanged. `ScenarioSummaryBand` still renders. Right column still works if compare toggled. |
| `sourceTranscriptId` references a deleted record | `getConversation` returns null → `SourceTranscriptPanel` shows "Source transcript no longer available." No retry, no scary error. |
| Source transcript fetch in flight (`useQuery` returns `undefined`) | Skeleton (3-4 placeholder rows). |
| Scenario fetch in flight on agents page | `ScenarioSummaryBand` shows a thin skeleton row. Compare toggle hidden until scenario resolves. Run-detail body still renders. |
| Sim has many fewer/more turns than source | Each column scrolls independently. No turn-by-turn alignment attempted — both are time-ordered streams. |
| Source `workflow_input` role messages | Rendered as a neutral-styled row distinct from user/agent. Always visible. |
| Source `messages` array empty | Header + "No messages in this conversation." |
| Toggling compare rapidly | Local state only; query `skip`-gated when off. No cancellations needed. |
| User selects a different scenario / run while compare toggle is on | Toggle resets to off (`useEffect` keyed on the parent id). The new selection might not have a source transcript at all, so default-off is the safe behavior. |
| Run's `scenarioId` references a deleted scenario record | `useQuery` returns null. `ScenarioSummaryBand` renders nothing. Compare toggle is hidden. Run-detail body still renders. |
| Long transcripts | Native scroll inside each column. No virtualization in this change. |
| Cross-org `sourceTranscriptId` | Existing org-scoped query returns null; treated as "no longer available." |

## Testing & verification

The frontend package has no test runner today (no vitest / jest / RTL in `package.json`). Adding a frontend test harness is **not in scope**. Verification is type-check + production build + manual browser walkthrough.

### Build / type verification

- `pnpm -C packages/frontend build` — Next.js production build is the strictest type check we have for the frontend.
- `pnpm -C packages/frontend lint` — ESLint pass.
- New component props are typed against existing Convex `Doc<...>` / `Id<...>` types — no `any`.

### Manual verification checklist (must pass before claiming done)

**Dataset page**
- [ ] Transcript-grounded scenario → "View source transcript" toggle visible in `ScenarioDetail` header.
- [ ] Toggle on → detail area splits 50/50, transcript loads on the right with role-styled `ChatBubble`s.
- [ ] Toggle off → returns to single-column scenario view.
- [ ] Synthetic scenario → toggle absent. Old "Source transcript: \<id\>" line is gone.
- [ ] Switching to a different scenario resets the toggle off.
- [ ] Scenario whose `sourceTranscriptId` points to a deleted record → right column shows "Source transcript no longer available."

**Agents page**
- [ ] Sim run for transcript-grounded scenario → `ScenarioSummaryBand` renders collapsed at top.
- [ ] Clicking the band expands to full scenario fields.
- [ ] "Compare to source" toggle splits the run-detail area; source transcript loads in the right column.
- [ ] Both columns scroll independently.
- [ ] Toggling off restores single-column view.
- [ ] Sim run for synthetic scenario → no compare toggle; band still works.
- [ ] Tool calls render as inline grouped pills above each assistant message; no longer at the bottom.
- [ ] Pills expand to show args + result, matching playground UX.

**Playground regression**
- [ ] Agent Playground tool-call rendering is unchanged after the `ToolCallGroup` extraction.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `ToolCallGroup` extraction subtly changes playground behavior | Keep the lift mechanical (same JSX, same logic); manual-verify the playground after refactor. |
| Long source transcripts cause UI jank | Out of scope for this change; if it surfaces in real usage, add virtualization in a follow-up. |
| Two `getConversation` queries firing on rapid toggle | Convex `useQuery` is cache-friendly and request-deduplicated; not a concern in practice. |
