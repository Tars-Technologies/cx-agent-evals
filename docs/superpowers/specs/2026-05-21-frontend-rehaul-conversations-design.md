# Frontend Re-haul — Conversations Section

**Date:** 2026-05-21
**Status:** Draft
**Parent:** `2026-05-21-frontend-rehaul-umbrella-design.md`

## Goal

Create a `/conversations` section with two tabs: live agent chat sessions and uploaded transcripts. Pull together what's currently scattered across `livechat` components.

## Routes (new)

```
/conversations                          → tabs (real | transcripts), defaults to real
/conversations?tab=transcripts          → transcripts tab
/conversations/transcripts/<id>         → transcript detail / analysis
/conversations/real/<conversationId>    → live conversation detail
```

Tab state lives in the URL via `?tab=` so deep-linking to a specific tab works.

## Routes (deleted in this PR)

Any legacy livechat route mountings. Components themselves are kept and re-mounted.

## Pages

### `/conversations` (tab = real) — Real conversations
- List/feed of live agent chat sessions for the org.
- Reuse existing `livechat/` list components.
- Click a row → `/conversations/real/<conversationId>` detail view.

### `/conversations` (tab = transcripts) — Transcripts
- Upload zone + list of uploaded transcripts.
- Reuse existing transcript components.
- Click → `/conversations/transcripts/<id>` analysis view.

### `/conversations/real/<conversationId>`
- Transcript view, side panel with conversation metadata (agent, timestamps, etc.). Reuse existing livechat detail components.

### `/conversations/transcripts/<id>`
- Transcript analysis view. Reuse existing transcript detail / analysis components.

## Component contract changes

- Routes use URL-driven IDs; no global selection state.
- No new annotation surface in this PR. Open/axial coding remain under Agents. The architectural note for the future: the annotation editor lifted in the Agents PR already accepts a generic conversation source, so plugging it in here later is mechanical.

## Backend

Verify an org-scoped conversations list query exists (spanning live sessions + uploaded transcripts). Likely components exist already inside `livechat` Convex code. If a single combined query doesn't exist, either:

1. Use two separate queries and combine in the frontend, OR
2. Add a thin `conversations.listForOrg` query.

Decide during implementation. Additive only; no schema change.

## Testing

Manual click-through:

- `/conversations` renders the real conversations list by default.
- Switching to Transcripts tab updates the URL to `?tab=transcripts`.
- Deep-linking with `?tab=transcripts` lands on the transcripts tab.
- Upload, list, and detail views all function as before.
- Refresh and back/forward preserve the active tab and any selected detail.

## Risks

- This is the lightest of the three section PRs; main risk is mis-locating which livechat components belong where. Resolve by reading current livechat page structure first, then re-mounting under new routes without changing internals.
