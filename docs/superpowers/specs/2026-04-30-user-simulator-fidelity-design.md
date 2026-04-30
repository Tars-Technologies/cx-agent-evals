# User Simulator Fidelity Design

**Date:** 2026-04-30
**Branch:** `va_improve_convo_sim`
**Status:** Draft

## Problem

The conversation simulation feature on the Agents page (Experiment mode) renders simulated user messages that diverge sharply from how real users behave. With the recently shipped side-by-side view comparing simulated conversations to their source live-chat transcripts, the gap is visible:

- Real users (right side): 1–5 word fragments — `"Hi"` / `"Syed"` / `"New Postpaid Plan"` / `"Hi, I want to switch my number to Vodafone"`.
- Simulated users (left side): 6+ line paragraphs that explain context, ask multi-part questions, and read like polished business prose.

The first simulated message is fine because it's taken verbatim from the source transcript. Every subsequent message is LLM-generated and verbose.

## Scope

**In scope:** the user-simulator side of the conversation loop only — message length, response style, brevity, persona authenticity. Schema and generation-pipeline updates needed to support that.

**Out of scope (separate future change):** ground truth for scenarios (expected agent behavior, expected tool calls, expected end state). The user raised this as a related improvement; we're deferring because it's a substantially larger design (evaluator semantics, scoring, what counts as "expected") and bundling slows the visible improvement here. The current change leaves the door open — adding ground-truth fields later is a non-breaking schema extension.

**Also out of scope:** AI agent harness improvements. Quality of agent responses is a separate evaluation concern.

## Goals

- Simulated users imitate the response style of real users in source transcripts: short, fragmented, direct.
- Length signal made explicit — derived from real data, surfaced as a soft anchor in the simulator prompt.
- Generation pipeline produces structured, terse data instead of LLM-authored prose narratives.
- Backfill path for existing scenarios so the improvement applies across the whole dataset.

## Non-Goals

- A "user-realism" evaluator. Verifying realism is a manual visual review for this change.
- Editable reference exemplars in the UI. Read-only for v1.
- Length-stat override in the UI. Express overrides as behavior anchors instead.
- Full removal of legacy fields (`instruction`, `referenceMessages`). Kept on schema, no longer read by the simulator. Removable later in a separate cleanup deploy.

## Why the current simulator produces verbose output

The prompt assembled in `packages/backend/convex/conversationSim/actions.ts:246-307` contains an LLM-authored 2-3 paragraph `instruction` field (e.g., *"You are Syed, a busy professional contacting Vodafone Qatar to inquire about switching to a postpaid plan. You should approach the conversation with directness…"*). This is the **largest, most natural-English section of the prompt**, and LLMs imitate the style of their input — when the strongest section is polished prose, output drifts toward polished prose.

The brevity rule is a single bullet at position 9: *"Keep messages concise and realistic — real users don't write essays."* Models attend more to the form of the prompt's strongest section than to single-sentence rules tucked at the end.

The `referenceMessages` field is limited to ≤3 user messages, only used as "Reference Style Examples" if there are at least 2 of them, and the first is consumed verbatim as the turn-0 opener — so most scenarios have zero or one example feeding the few-shot block.

Two reinforcing failures: prose dominance + few-shot starvation.

## Approach

Replace the prose `instruction` with structured **behavior anchors** (terse bullets), feed the simulator a real **few-shot bank** of `{agent → user}` exchanges drawn from source transcripts, and surface a soft **length anchor** computed from the same source data. Heterogeneous schema by scenario type — grounded scenarios snapshot the full source transcript; synthetic scenarios store sampled corpus exemplars with provenance. The runtime branches once to convert either into the same prompt-time shape (a list of `{agent, user}` example pairs).

The fix is therefore three changes working together:

1. **Style transfer by example, not description.** Concrete `{agent, user}` pairs in the prompt teach the simulator the response pattern — "when asked X, this user replies Y as a fragment".
2. **Replace prose with bullets.** Behavior anchors carry scenario-specific quirks ("Splits questions across multiple short messages", "Switches to Arabic when frustrated") in a form the simulator doesn't imitate stylistically.
3. **Soft length hint.** Median + p90 word counts from the source transcript surface as a non-binding anchor in the prompt, with explicit guidance to split long thoughts across messages.

## Data Model

### `conversationScenarios` table changes (`packages/backend/convex/schema.ts:783`)

Atomic message shape — same for both new fields:

```ts
const messageValidator = v.object({
  id: v.number(),
  role: v.union(
    v.literal("user"),
    v.literal("human_agent"),       // mirrors source role; not renamed
    v.literal("workflow_input"),    // system events preserved as-is
  ),
  text: v.string(),
});
```

**New fields (additive):**

```ts
// Grounded only — full source transcript snapshot, no filtering
referenceTranscript: v.optional(v.array(messageValidator)),

// Synthetic only — sampled corpus exemplars with provenance
referenceExemplars: v.optional(v.array(v.object({
  sourceTranscriptId: v.id("livechatConversations"),
  messages: v.array(messageValidator),
}))),

// Both — non-binding length anchor for the simulator prompt
userMessageLengthStats: v.optional(v.object({
  median: v.number(),
  p90: v.number(),
})),

// Both — replaces the prose `instruction` field (functionally)
behaviorAnchors: v.optional(v.array(v.string())),    // 0–6 short bullet phrases
```

**Existing fields kept (not removed in this change):**

- `instruction: v.string()` — kept on schema. Backfill can leave it populated for human readability in the UI; the simulator stops reading it. Removable in a future cleanup deploy.
- `referenceMessages: v.optional(...)` — same. Backfill ignores it; simulator stops reading it.
- `sourceType` (`"transcript_grounded" | "synthetic"`) — already exists; reused as the scenario-type discriminator. No new flag needed.
- `sourceTranscriptId` — already exists for grounded; kept as escape-hatch for fetching the original `livechatConversations` row if needed for future signal extraction.

### Why heterogeneous shapes (grounded vs synthetic)

- The two scenario types are genuinely different — one *is* a real conversation transformed into a roleplay setup; the other was fabricated. Their data should reflect that.
- The recently shipped side-by-side simulated-vs-original view depends on having a real transcript for grounded scenarios. Reducing grounded to context pairs alone would break that view.
- Synthetic scenarios storing a "borrowed" full transcript is dishonest provenance — the transcript wasn't this scenario's origin. Sampled exemplars say what they are: corpus exemplars.
- The runtime fork is one helper function (`extractExamples(scenario)`) that returns the same `{agent, user}[]` shape from either input. The prompt-builder sees uniform input.

### Why preserve all events (no filtering)

`referenceTranscript` snapshots the full event log — including `workflow_input` rows (system events) and preserving message `id`. Reasoning:

- Richer reference data for future signal extraction without a re-snapshot (multi-message bursts, info-disclosure timing, language switching, termination cues, patience arcs).
- Cross-reference back to `livechatConversations` (`messageTypes`, `classifiedMessages`, `translatedMessages`) via `id` if joined later.
- The cost of preserving system events is small; the cost of having to re-derive them later is high.

`workflow_input` events are stored but **not surfaced** in the simulator's few-shot block — they're not what the simulator should imitate. They're available for the side-by-side UI view and any later signal-extraction work.

## Generation Pipeline Changes

Files: `packages/backend/convex/conversationSim/generationActions.ts`, `scenarios.ts` (validators).

### Grounded track (`generateGroundedScenarios`)

Two cheap deterministic passes per transcript before the LLM call:

1. **Snapshot full transcript** (no filtering):
   ```ts
   const referenceTranscript = transcript.messages;  // stored as-is
   ```

2. **Compute length stats** from user-side messages only:
   ```ts
   const wc = transcript.messages
     .filter(m => m.role === "user")
     .map(m => m.text.split(/\s+/).filter(Boolean).length);
   const userMessageLengthStats = { median: median(wc), p90: p90(wc) };
   ```

The LLM call's response shape changes:

- **Drop**: `instruction` (2-3 paragraph prose), `referenceMessages` (≤3 user messages).
- **Add**: `behaviorAnchors: string[]` — *"3-6 short bullet phrases capturing how this specific user spoke. Each ≤12 words. Examples: 'Answers questions with a single word', 'Switches to Arabic when frustrated', 'Splits questions across multiple short messages'. Extract observable patterns from the transcript, not generic persona traits."*

`referenceTranscript` and `userMessageLengthStats` are computed deterministically — no LLM cost.

### Synthetic track (`generateSyntheticScenarios`)

Two new pre-LLM passes (one-time per generation job, reused across the synthetic batch):

1. **Sample corpus exemplars** — `sampleCorpusExemplars(transcripts, count = 8)`:
   - Pick `count` user messages from across the loaded transcript pool, preferring shorter ones (≤30 words; filters out monologues).
   - For each, snapshot a short window around it (preceding `human_agent` message + the user message; include intervening `workflow_input` events for completeness).
   - Tag each exemplar with `sourceTranscriptId` for provenance.

2. **Compute corpus-level length stats** — pool all user messages in the corpus, compute median/p90.

The LLM call's response shape changes the same way as grounded: drop `instruction`, add `behaviorAnchors`. The generator gets KB context + corpus profile + the sampled exemplars as input so it can write anchors that match corpus style.

For v1, every synthetic scenario in a batch reuses the same sampled exemplars and length stats. (Per-scenario sampling is a possible later refinement for variety; YAGNI for v1.)

### Persistence

`createInternal` validators in `conversationSim/scenarios.ts` extended to accept the new optional args. Existing call sites still work; `instruction` becomes optional at the persistence layer (generation no longer populates it).

## Simulator Prompt Redesign

File: `packages/backend/convex/conversationSim/actions.ts:246-307` (`buildUserSimPrompt`).

### New prompt structure

```
# You
You are roleplaying an end-user contacting customer support. Stay in character.
Never reveal you are an AI.

# Persona
- Type: {persona.type}
- Traits: {persona.traits.join(", ")}
- Communication style: {persona.communicationStyle}
- Patience level: {persona.patienceLevel}

# Your goal
{intent}

Why you're contacting: {reasonForContact}
Topic: {topic}

# What you know
{knownInfo}

# What you don't know (and want to find out)
{unknownInfo}

# How this user speaks       ← bullets, not prose
- {behaviorAnchors[0]}
- {behaviorAnchors[1]}
…

# Message length
Users in this conversation typically write {median} words per message
(90th percentile: {p90}). Match that. If a thought is longer, split it
into several short messages instead of one long one.

# Style examples — real exchanges to imitate
Imitate the terseness and response pattern of these examples. Answer the
specific question. Do NOT volunteer unrelated info or context.

<example>
  agent: {precedingHumanAgentText}
  user:  {userReplyText}
</example>
… (5–8 examples)

# Rules
- Stay in character throughout.
- Don't reveal you're a simulator or mention evaluators/scoring.
- When your goal is met (or you have no more questions), respond with exactly: ###STOP###
- If asked to do something you can't simulate (open a URL, check email), make up a brief plausible response.

# Variation: seed {seed}
Subtly vary phrasing across re-runs. Don't break character or change goals.
```

### Changes vs. current

| Section | Before | After |
|---|---|---|
| `# Instructions` (prose, 2-3 paragraphs) | LLM-authored narrative | **removed** |
| `# Reference Style Examples` (only if ≥2 ref msgs) | usually empty | **always populated, 5–8 examples** |
| `# Message length` | absent (one bullet at the end) | **structured numeric soft hint** |
| `# How this user speaks` | absent | **3-6 behavior-anchor bullets** |
| Section ordering | rules buried at end | examples sit just before rules → highest attention |

### `extractExamples(scenario): {agent: string|null, user: string}[]`

New helper that branches on schema shape and returns a uniform list:

- **Grounded** (`referenceTranscript` present):
  - Walk the transcript looking for `role === "user"` messages.
  - For each, scan backward for the immediately-preceding `role === "human_agent"` message — **skip over `workflow_input` rows**.
  - Emit `{agent: precedingHumanAgentText, user: userText}`. If no preceding `human_agent` exists (user spoke first), `agent: null`.
  - Skip the very first user message (used verbatim as turn-0 opener — see below).
  - Sort by user-message word count ascending; take the top 5–8 to bias examples toward brevity.

- **Synthetic** (`referenceExemplars` present):
  - Each exemplar is a short `messages[]` snippet. Walk it; for each `user` message, find the preceding `human_agent` (skip `workflow_input`).
  - Emit pairs in the same shape. Take all (sample size already capped at generation time).

The prompt-builder renders both branches identically.

### Turn-0 verbatim opener

- **Grounded**: turn 0 = first `role === "user"` message in `referenceTranscript`. The real user's actual opener.
- **Synthetic**: no transcript → turn 0 is LLM-generated like any other turn. Persona + behavior anchors + length hint + exemplar examples should produce a realistic opener.
- **Backward compat fallback**: if neither new field exists (un-backfilled scenario), fall back to `referenceMessages[0]?.content` if present. Removed in a future cleanup deploy.

### Why few-shot in system prompt rather than message-history prefix

Two options were considered:

- **A) Inside the system prompt** as `<example>` blocks (chosen for v1). Anthropic's tag-based example pattern is reliable. Keeps the message-history channel uncontaminated by synthetic prior turns.
- **B) Prepended to the `messages` array** as fake prior turns. More effective for style transfer in some research, but mixes synthetic and real history in the same channel and risks the model treating examples as actual conversation.

A for v1. If post-launch verbosity persists, B is layerable as a later tweak — `extractExamples()` already returns the right shape.

## Backfill Migration

File: `packages/backend/convex/conversationSim/migrations.ts` (new). Mirrors the pattern in `convex/annotations/migrations.ts`.

### Three migration functions

**`backfillGrounded`** — `internalMutation`, no LLM cost. For each grounded scenario without `referenceTranscript`: load `sourceTranscriptId`, snapshot full transcript (no filtering), compute length stats, patch.

```ts
export const backfillGrounded = internalMutation({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, batchSize }) => {
    const result = await ctx.db.query("conversationScenarios")
      .paginate({ numItems: batchSize ?? 50, cursor: cursor ?? null });

    let migrated = 0;
    for (const s of result.page) {
      if (s.referenceTranscript) continue;        // idempotent
      if (!s.sourceTranscriptId) continue;        // synthetic; skip
      const t = await ctx.db.get(s.sourceTranscriptId);
      if (!t) continue;                            // transcript deleted

      const wc = t.messages
        .filter(m => m.role === "user")
        .map(m => m.text.split(/\s+/).filter(Boolean).length);

      await ctx.db.patch(s._id, {
        referenceTranscript: t.messages,
        userMessageLengthStats: { median: median(wc), p90: p90(wc) },
      });
      migrated++;
    }
    return { migrated, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
```

**`backfillBehaviorAnchors`** — `internalAction` (`"use node"`), grounded only, batches LLM calls. For each grounded scenario that has `referenceTranscript` but no `behaviorAnchors`: one `generateText` call asking for 3-6 short bullet phrases, patch. Batch size 10–20 keeps under the 10-min action timeout.

**`backfillSynthetic`** — `internalAction` (`"use node"`). For each synthetic scenario without `referenceExemplars`: load the dataset's transcript pool (cached per batch), sample 5–8 exemplars, compute corpus-level length stats (cached per batch), one LLM call for behavior anchors, patch. Batch size 10–20.

### Run order (per environment, dev → prod)

1. `pnpm deploy:backend` — pushes migration code with widened schema.
2. Convex dashboard → Functions → run `internal.conversationSim.migrations.backfillGrounded` with `{}`. Loop on returned cursor until `isDone: true`.
3. Run `backfillBehaviorAnchors` with `{}`. Loop on cursor.
4. Run `backfillSynthetic` with `{}`. Loop on cursor.
5. Spot-check: query a few scenarios in the dashboard's Data tab, confirm new fields populated.

The simulator code can roll out before or after backfill — it has fallback paths for un-migrated scenarios. Recommended: deploy simulator with fallback first → run backfill → confirm → cleanup deploy removes fallback.

### Idempotency

Every handler short-circuits on the new field's presence (`if (s.referenceTranscript) continue`). Re-running is safe.

### Hand-edited scenarios

If a user has manually edited `instruction` in the UI, backfill does **not** detect that — the new fields populate alongside the (now-unread) edit. Acceptable risk for v1; if it becomes a real workflow, add `lastEditedBy: "user" | "generator"` in a follow-up. Worst case is re-generating affected scenarios from source data.

### Optional cleanup deploy (later, separate PR)

Once all scenarios have new fields and the simulator no longer reads `instruction` / `referenceMessages`:
- Schema: remove `referenceMessages`; drop `instruction` from required-on-create.
- Simulator code: drop the fallback branch.

Run weeks after the main change once we trust the new shape.

## UI Implications

Three frontend components touched. No new components.

### `packages/frontend/src/components/ScenarioFields.tsx` (display)

- Replace "**Instructions**" prose block with "**How this user speaks**" — render `behaviorAnchors[]` as a bullet list. Fallback: show `instruction` if `behaviorAnchors` is empty (un-backfilled scenario).
- Add inline badge near scenario summary: "**Typical length:** median {N}w / p90 {M}w" (read-only).
- Replace "**Reference Messages**" panel with context-aware section:
  - **Grounded**: small "View source transcript →" link (the side-by-side view in `SimRunDetail` already covers full transcript display).
  - **Synthetic**: collapsible "**Style exemplars** ({count})" with agent → user pairs and a small provenance link to source transcript per exemplar.

### `packages/frontend/src/components/EditScenarioModal.tsx` (edit)

- Replace `instruction` textarea with a `behaviorAnchors` bullet editor — add/remove/edit individual bullets, max ~6, soft cap ≤120 chars per bullet.
- `userMessageLengthStats`: read-only display.
- `referenceTranscript`: read-only snapshot (editing evidence is conceptually wrong).
- `referenceExemplars`: read-only for v1.

### `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx` (side-by-side view)

- **Grounded**: prefer `referenceTranscript` (denormalized snapshot — survives source-transcript deletion). Fall back to fetching via `sourceTranscriptId` for un-backfilled grounded scenarios.
- **Synthetic**: no "original" to show. Right pane renders empty-state — *"Synthetic scenario — no source conversation. View style exemplars →"* with a disclosure that expands the exemplar list.

This is a deliberate UX call: synthetic scenarios will no longer fake a side-by-side comparison. Honest; the side-by-side view becomes one-sided for synthetic. Pretending otherwise (with a borrowed transcript) was the dishonest path explicitly rejected during design.

### `packages/frontend/src/components/ScenarioGenerationWizard.tsx`

No required v1 change — generation populates new fields automatically. Optional polish: tooltip in the wizard explaining that anchors and exemplars are extracted automatically.

## Testing & Verification

### Automated tests

**Extend `packages/backend/tests/scenarioGeneration.test.ts`** (uses `convex-test`):

- `referenceTranscript` snapshotting: assert backfill copies the full transcript including `workflow_input` rows, preserves `id` and `human_agent` role, and patches the scenario.
- `userMessageLengthStats`: assert median/p90 calculated only from `role === "user"` rows.
- Idempotency: run `backfillGrounded` twice, assert second pass changes nothing.
- Synthetic exemplar sampling: assert `backfillSynthetic` produces up to 8 exemplars (capped by available short user messages in the corpus), each with valid `sourceTranscriptId` provenance.
- Fallthrough: a scenario with neither new nor old fields doesn't crash backfill — just skips.

**New file `packages/backend/tests/conversationSimPrompt.test.ts`:**

`extractExamples()` is a pure function and load-bearing:

- Grounded transcript with mixed roles → returns `{agent, user}` pairs, skips `workflow_input` when scanning backward.
- User speaks first (no preceding `human_agent`) → emitted with `agent: null`.
- Multiple consecutive `workflow_input` events between `human_agent` and `user` → still finds the `human_agent`.
- `referenceExemplars` input → flattened to the same shape.
- Brevity sort: with more than 8 candidates, emits the shortest user replies first; cap at 8.

**`buildUserSimPrompt` snapshot test:**

Given a fixed scenario fixture (deterministic input — full transcript + behavior anchors + length stats + persona + seed), assert the prompt string matches a saved snapshot. Catches accidental prompt-structure regressions during iteration on wording.

### Manual verification (cannot be automated)

The change is qualitative. Required before merging:

1. Run backfill on dev. Run an existing simulation against an existing agent. Open the side-by-side view. Visually confirm the simulated user's later messages have collapsed in length and stopped writing paragraphs.
2. Pick 3–5 grounded scenarios across different transcript styles (intents, languages, verbosity). Verify simulator output tracks each transcript's style.
3. Pick 2–3 synthetic scenarios. Verify corpus-sampled exemplars produce convincingly short, fragment-style replies.
4. Spot-check turn-0 verbatim: confirm grounded openers still match the expected real first user message; synthetic uses LLM-generated opener.
5. Spot-check `###STOP###` behavior: simulator still terminates when goal is met.

### Out-of-scope verification (worth flagging, not blocking)

- A/B compare verbosity numbers (avg words/message before vs. after). Eyeballing the side-by-side view is sufficient for v1.
- Evaluator pass-rate impact. The change is to user-sim, not agent or evaluators — pass-rate movement isn't a meaningful signal.

### Definition of done

- All new automated tests passing.
- Backfill run on dev, all scenarios show new fields populated.
- Manual visual verification on 5+ grounded + 2+ synthetic scenarios.
- Prod backfill run after dev sign-off.
- Cleanup deploy (drop fallback, drop `referenceMessages`) is **not** a v1 requirement.

## Open Questions / Future Work

- **Per-scenario exemplar sampling for synthetic.** v1 reuses one exemplar set across a synthetic batch. Per-scenario sampling could improve diversity. Defer.
- **Editable exemplars / regenerable behavior anchors.** Users may want to curate or refresh. Defer.
- **Hand-edit detection.** Add `lastEditedBy` flag if hand-editing turns out to be common. Defer.
- **Few-shot as message-history prefix (Option B).** Layerable later if v1 prompt structure underdelivers on terseness.
- **Ground truth for scenarios.** Expected agent behavior, expected tools, expected end state. Separate change with its own design.
