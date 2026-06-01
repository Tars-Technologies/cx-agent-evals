# Annotate tab — minimal right-column annotation panel

**Date:** 2026-05-29
**Scope:** `packages/frontend/src/app/agents/[id]/evaluate/error-analysis/[analysisId]/annotate/page.tsx` (single file)

## Problem

The Annotate tab of the Error Analysis page lays out three columns: member
list (left), conversation transcript (center), and an annotation panel (right).

The right column renders `InlineAnnotationPanel`, which reuses
`AnnotationSidePanel`. But `AnnotationSidePanel` is a `fixed right-0 top-0
h-screen w-[360px] z-[60]` **overlay drawer** that *also* renders the full
conversation transcript inside it (`AnnotationEditor` defaults
`showConversation={true}`). The result:

- The conversation is shown twice (center panel + inside the drawer).
- The panel is a full-height fixed overlay with drawer chrome (title bar, ✕
  close button) rather than a normal in-flow column matching the other panels.

## Goal

The right column should be a **minimal annotation editor** — just the Pass/Fail
rating, tags (after a rating is chosen), comment, and the existing
"Saving…/Saved ✓" auto-save indicator. No duplicate transcript, no overlay
chrome. It should sit in-flow at the same height as the left and center panels
(bounded by the content row, not the viewport), scrolling internally if needed.

This mirrors the compact "pencil" popover (`AnnotateButton`), which already
renders `AnnotationEditor` with `showConversation={false}`.

## Change

Replace `InlineAnnotationPanel` (and its `AnnotationSidePanel` import/usage)
with a new in-file `MinimalAnnotationPanel` component:

- **Convex wiring (unchanged from `AnnotationSidePanel`):**
  - `useQuery(api.annotations.crud.bySource, { source: conversationRef })` to
    load the current user's existing annotation (first row = "mine").
  - `useQuery(api.annotations.crud.allTagsForOrg, {})` for tag suggestions.
  - `useMutation(api.annotations.crud.upsertWithAutoContainer)` to save, called
    with `originHint: { kind: "analysis", errorAnalysisId }`.
- **Presentation:**
  - Renders a slim `Annotate` header label + `AnnotationEditor` with
    `showConversation={false}` and `conversation={{ turns: [] }}`.
  - No `fixed`, no `z-[60]`, no `h-screen`, no ✕ close button.
  - Lives in the existing `w-1/4 min-w-[280px] border-l border-border` slot;
    the slot already sits inside `flex-1 min-h-0 flex`, so the column inherits
    the row height. Make the panel `h-full` with internal `overflow-y-auto`.
- The `turns`/`useTurnsForSelected` plumbing feeding the old panel is no longer
  needed and is removed (the center panel renders the transcript on its own).

`AnnotationSidePanel`, `AnnotateButton`, and `AnnotationEditor` are **not**
modified — `AnnotationSidePanel` remains in use as a real overlay in
`AgentPlayground.tsx`.

## Out of scope

- No changes to annotation data model, save/debounce behavior, ratings, or tags.
- No changes to the left member list or center transcript panels.
- No changes to other consumers of the annotation components.

## Verification

- Annotate tab: right column shows only Pass/Fail + tags + comment + save
  indicator; conversation appears once (center). Column height matches the
  other panels (not full viewport); no fixed overlay.
- Selecting a rating saves; reload reflects the saved rating/tags/comment.
- `pnpm -C packages/frontend build` typechecks clean.
