# Generate failure modes button

**Date:** 2026-05-29
**Scope:** `packages/frontend/src/app/agents/[id]/evaluate/error-analysis/[analysisId]/failure-modes/page.tsx` (frontend only)

## Problem

The Failure modes tab can only be populated two ways today:

- **"⟲ Re-cluster"** — a quiet, secondary-styled button that actually performs
  the LLM clustering, but reads as a destructive afterthought and is not the
  obvious entry point.
- **"+ New failure mode"** — a manual create modal that, in practice, nobody
  uses.

The empty state tells the user to "Click + New failure mode", so the primary,
high-value action — LLM clustering of annotated failures into buckets — is
effectively hidden. An earlier version had a prominent "Generate failure modes"
button; this brings it back.

The backend already does the work: `api.errorAnalysis.clustering.recluster`
loads the analysis's annotations, filters to **failing** ones (`fail`/`bad`),
sends transcripts + tags + comments to GPT-4o, and writes 3–8 failure-mode
buckets with memberships. It wipes existing modes first (destructive replace).
No backend change is needed.

## Goal

Make **Generate failure modes** the primary action, gated on having at least
one failing annotation, while keeping manual creation available but secondary.

## Design

Frontend-only. Reuses `api.errorAnalysis.clustering.recluster` (action) and
`api.errorAnalysis.orchestration.membersByAnalysis` (query, which already
returns `annotationRating` per member).

### Data

- Query `membersByAnalysis({ errorAnalysisId })`.
- `failingCount = members.filter(m => m.annotationRating === "fail" || m.annotationRating === "bad").length`.
- `canGenerate = failingCount > 0`.

### Header buttons (right side of the count bar)

- **Primary — Generate / Regenerate:**
  - Label `✨ Generate failure modes` when `list.length === 0`, else `⟲ Regenerate`.
  - `onClick` calls `recluster({ errorAnalysisId })`.
  - Disabled when `!canGenerate` (tooltip: "Annotate at least one conversation
    as Fail first.") or while running.
  - Shows `Generating…` while in flight.
  - **Confirm dialog only when `list.length > 0`** (regenerate replaces existing
    modes). First-time generate runs with no confirm.
- **Secondary — `+ New`:** the existing manual create modal, styled as a quiet
  secondary button beside the primary.

### Empty state (no modes)

Replace the "Click + New failure mode" copy with a centered **Generate failure
modes** CTA:
- `canGenerate` → enabled button that runs generation.
- `!canGenerate` → disabled button + hint: "Annotate at least one conversation
  as **Fail**, then generate."

### Error handling

Keep the existing inline `clusterError` text near the primary button.

## Out of scope

- No change to the `recluster` action, its prompt, or its replace semantics.
- No change to the manual create modal, `FailureModeCard`, or the spawn-judge
  flow.
- No new backend query — the failing count comes from `membersByAnalysis`.

## Verification

- With ≥1 Fail annotation and no modes: empty state shows an enabled "Generate
  failure modes" CTA; clicking it produces buckets without a confirm prompt.
- With 0 Fail annotations: Generate is disabled with the hint; manual "+ New"
  still works.
- With existing modes: primary reads "Regenerate" and prompts for confirmation
  before replacing.
- `pnpm -C packages/frontend build` (or tsc) typechecks clean.
