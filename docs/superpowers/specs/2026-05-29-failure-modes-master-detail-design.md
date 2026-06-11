# Failure modes — master-detail with editable membership

**Date:** 2026-05-29
**Scope:** frontend. Rewrites
`packages/frontend/src/app/agents/[id]/evaluate/error-analysis/[analysisId]/failure-modes/page.tsx`
and adds two components. No backend changes.

## Problem

The Failure modes tab is a read-only grid of `FailureModeCard`s (name,
description, "N convs in this mode", Spawn judge). You cannot see which
conversations belong to a mode, nor add/remove them, nor edit the mode's
name/description. An earlier version had a master-detail review layout with
this functionality.

## Goal

Replace the grid with a two-pane master-detail layout that lets you inspect a
failure mode's member conversations (including their transcripts), add/remove
members, and edit the mode's name/description.

## Data (no new backend)

All queries/mutations already exist:

- `failureModes.crud.byAnalysisWithCounts(errorAnalysisId)` — left list + counts.
- `errorAnalysis.orchestration.membersByAnalysis(errorAnalysisId)` — candidate
  conversations with labels + `annotationRating`.
- `failureModes.memberships.byFailureMode(failureModeId)` — the selected mode's
  membership rows (each has a polymorphic `source`).
- `failureModes.memberships.add({ failureModeId, source })` / `.remove(...)`.
- `failureModes.crud.update({ id, name?, description? })`.
- `failureModes.crud.remove({ id })`.
- `evaluator.spawnJudge.fromFailureMode({ failureModeId })`.
- Transcript hydration: `crud.conversations.listMessages` (conversation),
  `livechat.orchestration.getConversation` (transcript).

A mode's labeled member rows come from intersecting `byFailureMode` sources
with `membersByAnalysis` (memberships are a subset of analysis members). A
membership whose source is not found among analysis members falls back to a
short id label rather than being dropped.

## Components

### `FailureModesPage` (rewritten)

- Keeps the existing header (name/origin/Import) and the count + Generate /
  Regenerate / `+ New` bar from the previous change.
- Below the bar, a two-pane row inside the existing `flex-1 min-h-0` area:
  - **Left** (`w-1/4 min-w-[220px]`, scroll): selectable list of modes showing
    name + member count. Selection persisted via `?fm=<id>`; auto-selects the
    first mode, mirroring the Annotate tab's `?conv=` pattern.
  - **Right**: `<FailureModeDetail>` for the selected mode, or a "Select a
    failure mode" placeholder.
- Empty state (no modes) keeps the centered **Generate failure modes** CTA and
  its failing-annotation gate.

### `FailureModeDetail` (new — `components/errorAnalysis/FailureModeDetail.tsx`)

Props: the selected mode (`byAnalysisWithCounts` row), `agentId`,
`errorAnalysisId`, the analysis members list, and `onSpawnJudge`.

- **Inline-editable name + description**: text input / textarea seeded from the
  mode; saves on blur via `crud.update` (skips save when unchanged). Shows a
  small saving/saved hint.
- **Conversations (N)** section:
  - `+ Add` opens a picker listing analysis members not already in this mode;
    selecting one calls `memberships.add`.
  - Each member row: label + rating dot (reusing the rating-dot styling), a
    **▸/▾** toggle that expands the transcript inline via `<SourceTranscript>`,
    and **✕** to remove (`memberships.remove`).
- **Spawn judge** button (moved from the card) + judge-count text.
- **Delete failure mode** action (`crud.remove`) with confirm.
- Per-action inline error text.

### `SourceTranscript` (new — `components/errorAnalysis/SourceTranscript.tsx`)

Given a source ref:
- `{ kind: "conversation", conversationId }` → `listMessages` →
  shared `MessageTranscript` (tool calls included).
- `{ kind: "transcript", transcriptId }` → `getConversation` → message bubbles
  (same styling as the Annotate tab's transcript view).

Handles its own loading state.

## Cleanup

`FailureModeCard` is only used on this page; the detail pane replaces it, so
its import/usage is removed. (The component file may be left in place but
unused, or deleted — implementation will remove the usage.)

## Out of scope

- No backend changes (schema, queries, mutations, clustering action).
- No change to the Generate/Regenerate gating logic from the prior change.
- The Annotate tab is not refactored to use `SourceTranscript` in this change
  (kept focused), though it duplicates similar rendering.

## Verification

- Selecting a mode shows its conversations; expanding a row shows the
  transcript with tool calls.
- `+ Add` adds a conversation (count updates live); `✕` removes it.
- Editing name/description persists (reload reflects it).
- Spawn judge still works and navigates to the evaluator.
- Empty state still offers gated Generate.
- `tsc -p tsconfig.json` (frontend) typechecks clean.
