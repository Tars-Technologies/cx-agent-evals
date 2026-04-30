# User Simulator Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make simulated end-user messages in conversation simulations imitate the brevity, fragmentation, and response style of real users from live-chat transcripts, by replacing the prose `instruction` with structured behavior anchors, feeding the simulator a real few-shot bank of context pairs, and surfacing a soft length anchor derived from real data.

**Architecture:** Heterogeneous schema by scenario type — grounded scenarios snapshot the full source transcript; synthetic scenarios store sampled corpus exemplars with provenance. A new pure helper `extractExamples()` converts either shape into a uniform `{agent, user}[]` few-shot bank. Generation pipeline drops prose `instruction` for structured `behaviorAnchors`. Three backfill migrations (mutation + 2 actions) upgrade existing scenarios. Three frontend components updated for new fields with legacy fallback.

**Tech Stack:** TypeScript, Convex (backend), Vitest + convex-test, React + Next.js (frontend), AI SDK (`ai` package, `generateText`), Anthropic Claude.

**Spec:** `docs/superpowers/specs/2026-04-30-user-simulator-fidelity-design.md`

---

## File Structure

**Files to CREATE:**

- `packages/backend/convex/conversationSim/lengthStats.ts` — pure utilities `median()`, `p90()`, `wordCount()`.
- `packages/backend/convex/conversationSim/prompt.ts` — pure module exporting `extractExamples()` and `buildUserSimPrompt()` (moved from `actions.ts`).
- `packages/backend/convex/conversationSim/sampleCorpusExemplars.ts` — pure-ish sampler (uses `Math.random` directly; OK for v1).
- `packages/backend/convex/conversationSim/anchorPrompt.ts` — shared constant for behavior-anchor LLM prompt instruction.
- `packages/backend/convex/conversationSim/migrations.ts` — `backfillGrounded` (mutation) + `backfillBehaviorAnchors` and `backfillSynthetic` (`"use node"` actions).
- `packages/backend/tests/conversationSimPrompt.test.ts` — pure unit tests for the four helper modules above.
- `packages/backend/tests/conversationSimMigrations.test.ts` — convex-test integration tests for the three backfill functions.

**Files to MODIFY:**

- `packages/backend/convex/schema.ts` — add new optional fields to `conversationScenarios` table (additive only).
- `packages/backend/convex/conversationSim/scenarios.ts` — extend validators on `createInternal` and `update` mutations.
- `packages/backend/convex/conversationSim/generationActions.ts` — drop `instruction` / `referenceMessages` from LLM response shape, add `behaviorAnchors`, compute `referenceTranscript` + length stats deterministically (grounded), sample exemplars + corpus stats (synthetic).
- `packages/backend/convex/conversationSim/actions.ts` — import `buildUserSimPrompt` from new `prompt.ts`, update turn-0 verbatim resolution.
- `packages/frontend/src/components/ScenarioFields.tsx` — new section ordering with behavior anchors, length badge, context-aware source/exemplars panel.
- `packages/frontend/src/components/EditScenarioModal.tsx` — replace `instruction` textarea with `behaviorAnchors` bullet editor.
- `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx` — prefer `referenceTranscript`, render synthetic empty state.

---

## Task 1: Pure utilities — `lengthStats.ts`

**Files:**
- Create: `packages/backend/convex/conversationSim/lengthStats.ts`
- Test: `packages/backend/tests/conversationSimPrompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Create the new test file with the following content:

```ts
// packages/backend/tests/conversationSimPrompt.test.ts
import { describe, it, expect } from "vitest";
import { median, p90, wordCount } from "../convex/conversationSim/lengthStats";

describe("lengthStats", () => {
  describe("wordCount", () => {
    it("counts words in a normal string", () => {
      expect(wordCount("Hi I want to switch")).toBe(5);
    });
    it("treats multiple whitespace as one separator", () => {
      expect(wordCount("Hi   I  want")).toBe(3);
    });
    it("returns 0 for empty string", () => {
      expect(wordCount("")).toBe(0);
    });
    it("returns 0 for whitespace-only string", () => {
      expect(wordCount("   \n\t  ")).toBe(0);
    });
  });

  describe("median", () => {
    it("computes median for odd-length sorted array", () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3);
    });
    it("computes median for even-length sorted array", () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });
    it("works on unsorted input", () => {
      expect(median([5, 1, 3, 2, 4])).toBe(3);
    });
    it("throws on empty array", () => {
      expect(() => median([])).toThrow();
    });
  });

  describe("p90", () => {
    it("computes p90 for a 10-element array", () => {
      // Sorted: [1..10]; ceil(10*0.9)=9; index 8 (0-based) = 9
      expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    });
    it("returns the max for very small arrays", () => {
      expect(p90([5, 10])).toBe(10);
    });
    it("throws on empty array", () => {
      expect(() => p90([])).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/backend test conversationSimPrompt`
Expected: All tests FAIL with "Cannot find module ... lengthStats" or similar resolution errors.

- [ ] **Step 3: Implement the module**

Create `packages/backend/convex/conversationSim/lengthStats.ts`:

```ts
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error("median: cannot compute on empty array");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function p90(values: number[]): number {
  if (values.length === 0) {
    throw new Error("p90: cannot compute on empty array");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(values.length * 0.9) - 1);
  return sorted[idx];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/backend test conversationSimPrompt`
Expected: All `lengthStats` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/lengthStats.ts packages/backend/tests/conversationSimPrompt.test.ts
git commit -m "feat(backend): add lengthStats utilities for user-message statistics"
```

---

## Task 2: Pure helper — `extractExamples()`

**Files:**
- Create: `packages/backend/convex/conversationSim/prompt.ts` (export `extractExamples` only for now; `buildUserSimPrompt` comes in Task 5)
- Test: `packages/backend/tests/conversationSimPrompt.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/tests/conversationSimPrompt.test.ts`:

```ts
import { extractExamples } from "../convex/conversationSim/prompt";
import type { Id } from "../convex/_generated/dataModel";

const TID = "j1234567890abcdef" as Id<"livechatConversations">;

describe("extractExamples", () => {
  it("returns empty array when neither field is present", () => {
    expect(extractExamples({})).toEqual([]);
  });

  it("grounded: pairs each user message with preceding human_agent (skipping workflow_input)", () => {
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "human_agent", text: "Welcome! Could I get your name?" },
        { id: 2, role: "user", text: "Syed" },                     // first user msg → skipped (turn-0 opener)
        { id: 3, role: "human_agent", text: "Which plan are you on now?" },
        { id: 4, role: "workflow_input", text: "[event: agent typing]" },
        { id: 5, role: "user", text: "prepaid" },
        { id: 6, role: "human_agent", text: "How can I help?" },
        { id: 7, role: "user", text: "switch number to Vodafone" },
      ],
    });
    expect(out).toEqual([
      { agent: "Which plan are you on now?", user: "prepaid" },
      { agent: "How can I help?", user: "switch number to Vodafone" },
    ]);
  });

  it("grounded: emits agent: null when user spoke first AND there are no other user messages", () => {
    // Skip-first rule still applies; one-user-message transcript yields zero examples.
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "user", text: "hi" },
      ],
    });
    expect(out).toEqual([]);
  });

  it("grounded: emits agent: null for user messages that have no preceding human_agent", () => {
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "human_agent", text: "Hello!" },
        { id: 2, role: "user", text: "Hi" },                       // skipped (first)
        { id: 3, role: "user", text: "I have a question" },        // no preceding human_agent in between
      ],
    });
    expect(out).toEqual([
      { agent: null, user: "I have a question" },
    ]);
  });

  it("grounded: caps at 8 examples sorted by user-message brevity ascending", () => {
    const messages = [
      { id: 1, role: "human_agent" as const, text: "Q0" },
      { id: 2, role: "user" as const, text: "first message" },     // skipped (first user msg)
      // Now 9 more agent/user pairs with varying user lengths
      ...Array.from({ length: 9 }, (_, i) => [
        { id: 100 + 2 * i, role: "human_agent" as const, text: `Q${i + 1}` },
        // Word counts: 10, 9, 8, 7, 6, 5, 4, 3, 2
        { id: 101 + 2 * i, role: "user" as const, text: Array(10 - i).fill("w").join(" ") },
      ]).flat(),
    ];
    const out = extractExamples({ referenceTranscript: messages });
    expect(out).toHaveLength(8);
    // Shortest first: 2-word reply should be first
    expect(out[0].user.split(/\s+/).length).toBe(2);
    expect(out[7].user.split(/\s+/).length).toBe(9);
  });

  it("synthetic: flattens exemplars into the same shape", () => {
    const out = extractExamples({
      referenceExemplars: [
        {
          sourceTranscriptId: TID,
          messages: [
            { id: 5, role: "human_agent", text: "What's your name?" },
            { id: 6, role: "user", text: "Ahmed" },
          ],
        },
        {
          sourceTranscriptId: TID,
          messages: [
            { id: 8, role: "human_agent", text: "Which plan?" },
            { id: 9, role: "workflow_input", text: "[typing]" },
            { id: 10, role: "user", text: "prepaid" },
          ],
        },
      ],
    });
    expect(out).toEqual([
      { agent: "What's your name?", user: "Ahmed" },
      { agent: "Which plan?", user: "prepaid" },
    ]);
  });

  it("synthetic: emits agent: null for exemplar with no preceding human_agent", () => {
    const out = extractExamples({
      referenceExemplars: [
        {
          sourceTranscriptId: TID,
          messages: [{ id: 1, role: "user", text: "hello" }],
        },
      ],
    });
    expect(out).toEqual([{ agent: null, user: "hello" }]);
  });

  it("prefers referenceTranscript when both fields are present (defensive)", () => {
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "human_agent", text: "Q1" },
        { id: 2, role: "user", text: "u1" },                       // skipped
        { id: 3, role: "human_agent", text: "Q2" },
        { id: 4, role: "user", text: "u2" },
      ],
      referenceExemplars: [
        { sourceTranscriptId: TID, messages: [{ id: 1, role: "user", text: "ignored" }] },
      ],
    });
    expect(out).toEqual([{ agent: "Q1" /* nope, Q2 */, user: "u2" }]);
    // Correct expected:
  });
});
```

Wait — fix the last test. The grounded transcript pairs `u2` with the *immediately preceding human_agent* `Q2` (not `Q1`). Replace the last `it()` with:

```ts
  it("prefers referenceTranscript when both fields are present (defensive)", () => {
    const out = extractExamples({
      referenceTranscript: [
        { id: 1, role: "human_agent", text: "Q1" },
        { id: 2, role: "user", text: "u1" },                       // skipped (first user)
        { id: 3, role: "human_agent", text: "Q2" },
        { id: 4, role: "user", text: "u2" },
      ],
      referenceExemplars: [
        { sourceTranscriptId: TID, messages: [{ id: 1, role: "user", text: "ignored" }] },
      ],
    });
    expect(out).toEqual([{ agent: "Q2", user: "u2" }]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/backend test conversationSimPrompt`
Expected: New `extractExamples` tests FAIL with "Cannot find module ... prompt".

- [ ] **Step 3: Implement the module**

Create `packages/backend/convex/conversationSim/prompt.ts`:

```ts
import type { Id } from "../_generated/dataModel";
import { wordCount } from "./lengthStats";

export type Message = {
  id: number;
  role: "user" | "human_agent" | "workflow_input";
  text: string;
};

export type Exemplar = {
  sourceTranscriptId: Id<"livechatConversations">;
  messages: Message[];
};

export type ScenarioForExtraction = {
  referenceTranscript?: Message[];
  referenceExemplars?: Exemplar[];
};

export type Example = { agent: string | null; user: string };

const MAX_EXAMPLES = 8;

/**
 * Find the immediately-preceding human_agent message before index `i`,
 * skipping over workflow_input rows. Returns null if none.
 */
function findPrecedingAgent(messages: Message[], i: number): string | null {
  for (let j = i - 1; j >= 0; j--) {
    const m = messages[j];
    if (m.role === "human_agent") return m.text;
    if (m.role === "workflow_input") continue;
    // Hit a `user` message before any human_agent → no agent context for this user reply
    return null;
  }
  return null;
}

function pairsFromTranscript(messages: Message[]): Example[] {
  const userIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") userIndices.push(i);
  }
  // Skip the very first user message (used verbatim as turn-0 opener)
  const eligible = userIndices.slice(1);
  return eligible.map((i) => ({
    agent: findPrecedingAgent(messages, i),
    user: messages[i].text,
  }));
}

export function extractExamples(scenario: ScenarioForExtraction): Example[] {
  if (scenario.referenceTranscript && scenario.referenceTranscript.length > 0) {
    const pairs = pairsFromTranscript(scenario.referenceTranscript);
    // Sort by user-message brevity ascending; cap at MAX_EXAMPLES
    pairs.sort((a, b) => wordCount(a.user) - wordCount(b.user));
    return pairs.slice(0, MAX_EXAMPLES);
  }
  if (scenario.referenceExemplars && scenario.referenceExemplars.length > 0) {
    const out: Example[] = [];
    for (const ex of scenario.referenceExemplars) {
      for (let i = 0; i < ex.messages.length; i++) {
        if (ex.messages[i].role !== "user") continue;
        out.push({
          agent: findPrecedingAgent(ex.messages, i),
          user: ex.messages[i].text,
        });
      }
    }
    return out;
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/backend test conversationSimPrompt`
Expected: All tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/prompt.ts packages/backend/tests/conversationSimPrompt.test.ts
git commit -m "feat(backend): add extractExamples helper for simulator few-shot bank"
```

---

## Task 3: Widen schema — additive optional fields

**Files:**
- Modify: `packages/backend/convex/schema.ts:783-809` (the `conversationScenarios` table definition)
- Modify: `packages/backend/convex/conversationSim/scenarios.ts:12-36` (validators)

- [ ] **Step 1: Read the current schema for conversationScenarios**

Run: `sed -n '783,809p' packages/backend/convex/schema.ts`
Confirm the existing table shape matches the spec's "Existing fields kept" list.

- [ ] **Step 2: Modify the schema**

Edit `packages/backend/convex/schema.ts`. Replace the `conversationScenarios` definition with:

```ts
  conversationScenarios: defineTable({
    datasetId: v.id("datasets"),
    orgId: v.string(),
    persona: v.object({
      type: v.string(),
      traits: v.array(v.string()),
      communicationStyle: v.string(),
      patienceLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    }),
    topic: v.string(),
    intent: v.string(),
    complexity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    reasonForContact: v.string(),
    knownInfo: v.string(),
    unknownInfo: v.string(),
    instruction: v.string(),
    referenceMessages: v.optional(v.array(v.object({
      role: v.literal("user"),
      content: v.string(),
      turnIndex: v.number(),
    }))),
    sourceType: v.optional(v.union(v.literal("transcript_grounded"), v.literal("synthetic"))),
    sourceTranscriptId: v.optional(v.id("livechatConversations")),
    languages: v.optional(v.array(v.string())),

    // ── New: user-simulator fidelity (additive) ──
    referenceTranscript: v.optional(v.array(v.object({
      id: v.number(),
      role: v.union(v.literal("user"), v.literal("human_agent"), v.literal("workflow_input")),
      text: v.string(),
    }))),
    referenceExemplars: v.optional(v.array(v.object({
      sourceTranscriptId: v.id("livechatConversations"),
      messages: v.array(v.object({
        id: v.number(),
        role: v.union(v.literal("user"), v.literal("human_agent"), v.literal("workflow_input")),
        text: v.string(),
      })),
    }))),
    userMessageLengthStats: v.optional(v.object({
      median: v.number(),
      p90: v.number(),
    })),
    behaviorAnchors: v.optional(v.array(v.string())),
  })
    .index("by_dataset", ["datasetId"])
    .index("by_org", ["orgId"]),
```

- [ ] **Step 3: Update scenarios.ts validators**

In `packages/backend/convex/conversationSim/scenarios.ts`, after the existing `referenceMessagesValidator` constants (~line 36), add:

```ts
const messageValidator = v.object({
  id: v.number(),
  role: v.union(
    v.literal("user"),
    v.literal("human_agent"),
    v.literal("workflow_input"),
  ),
  text: v.string(),
});

const referenceTranscriptValidator = v.optional(v.array(messageValidator));
const referenceExemplarsValidator = v.optional(v.array(v.object({
  sourceTranscriptId: v.id("livechatConversations"),
  messages: v.array(messageValidator),
})));
const userMessageLengthStatsValidator = v.optional(v.object({
  median: v.number(),
  p90: v.number(),
}));
const behaviorAnchorsValidator = v.optional(v.array(v.string()));
```

Then in the `createInternal` mutation's args, add:

```ts
    referenceTranscript: referenceTranscriptValidator,
    referenceExemplars: referenceExemplarsValidator,
    userMessageLengthStats: userMessageLengthStatsValidator,
    behaviorAnchors: behaviorAnchorsValidator,
```

And in the `update` mutation's args, add the same four fields (all optional).

Make `instruction` optional in `createInternal`'s `scenarioFields` by changing the field definition. Since `scenarioFields` is shared between `create` and `createInternal`, and `instruction` should still be allowed but no longer mandatory at creation, change line 47 from `instruction: v.string(),` to `instruction: v.optional(v.string()),`. The schema still requires `instruction` as `v.string()` (non-optional) — backfill leaves it populated; new generations will populate a placeholder string `""` for now and a future cleanup deploy will widen the schema. **Defer making the schema field optional** to the cleanup deploy to avoid breaking existing required-field assumptions.

Actually to keep this safe: leave `instruction: v.string()` required in BOTH the schema and the validators. Generation in Task 7 will populate `instruction: ""` (empty string) when it has no prose to write. Update the validator change above accordingly — DO NOT make `instruction` optional in `scenarios.ts`. (Removing this requirement is a cleanup-deploy concern.)

- [ ] **Step 4: Type-check**

Run: `pnpm -C packages/backend typecheck`
Expected: PASS. If it complains about un-handled paths, fix at the source.

- [ ] **Step 5: Deploy schema (dev only) to verify validation**

Run: `cd packages/backend && npx convex dev --once`
Expected: Schema validation succeeds; Convex confirms deployment with no errors. If validation fails, the new optional fields are likely written wrong — re-check the union literals.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/conversationSim/scenarios.ts
git commit -m "feat(backend): widen conversationScenarios schema for simulator fidelity fields"
```

---

## Task 4: Pure sampler — `sampleCorpusExemplars()`

**Files:**
- Create: `packages/backend/convex/conversationSim/sampleCorpusExemplars.ts`
- Test: `packages/backend/tests/conversationSimPrompt.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/tests/conversationSimPrompt.test.ts`:

```ts
import { sampleCorpusExemplars } from "../convex/conversationSim/sampleCorpusExemplars";

describe("sampleCorpusExemplars", () => {
  type LCMessage = { id: number; role: "user" | "human_agent" | "workflow_input"; text: string };
  type LCTranscript = { _id: Id<"livechatConversations">; messages: LCMessage[] };

  const tid = (n: number) => `j${n.toString().padStart(16, "0")}` as Id<"livechatConversations">;

  function transcriptWith(id: number, msgs: LCMessage[]): LCTranscript {
    return { _id: tid(id), messages: msgs };
  }

  it("returns up to count exemplars when corpus is large enough", () => {
    const corpus: LCTranscript[] = Array.from({ length: 10 }, (_, i) =>
      transcriptWith(i, [
        { id: 1, role: "human_agent", text: "Hello?" },
        { id: 2, role: "user", text: `short ${i}` },
        { id: 3, role: "human_agent", text: "Another?" },
        { id: 4, role: "user", text: "yep" },
      ]),
    );
    const out = sampleCorpusExemplars(corpus, 8);
    expect(out).toHaveLength(8);
    for (const ex of out) {
      expect(ex.sourceTranscriptId).toMatch(/^j/);
      expect(ex.messages.length).toBeGreaterThanOrEqual(1);
      // Every exemplar ends with a user message
      expect(ex.messages[ex.messages.length - 1].role).toBe("user");
    }
  });

  it("returns fewer than count when corpus is too small", () => {
    const corpus: LCTranscript[] = [
      transcriptWith(1, [
        { id: 1, role: "human_agent", text: "Hi" },
        { id: 2, role: "user", text: "ok" },
      ]),
    ];
    const out = sampleCorpusExemplars(corpus, 8);
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array when corpus has no user messages", () => {
    const corpus: LCTranscript[] = [
      transcriptWith(1, [
        { id: 1, role: "human_agent", text: "Hi" },
        { id: 2, role: "human_agent", text: "anyone?" },
      ]),
    ];
    expect(sampleCorpusExemplars(corpus, 8)).toEqual([]);
  });

  it("includes intervening workflow_input rows in the exemplar window", () => {
    const corpus: LCTranscript[] = [
      transcriptWith(1, [
        { id: 1, role: "human_agent", text: "What's your name?" },
        { id: 2, role: "workflow_input", text: "[event: user typing]" },
        { id: 3, role: "user", text: "Ahmed" },
      ]),
    ];
    const out = sampleCorpusExemplars(corpus, 8);
    expect(out).toHaveLength(1);
    expect(out[0].messages.map((m) => m.role)).toEqual(["human_agent", "workflow_input", "user"]);
  });

  it("relaxes the 30-word filter if too few short messages", () => {
    // All user messages are >30 words
    const longText = Array(40).fill("word").join(" ");
    const corpus: LCTranscript[] = Array.from({ length: 5 }, (_, i) =>
      transcriptWith(i, [
        { id: 1, role: "human_agent", text: "Hi?" },
        { id: 2, role: "user", text: longText },
      ]),
    );
    const out = sampleCorpusExemplars(corpus, 3);
    // Must still return up to 3 exemplars even though all are >30 words
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/backend test conversationSimPrompt`
Expected: New tests FAIL with "Cannot find module ... sampleCorpusExemplars".

- [ ] **Step 3: Implement the module**

Create `packages/backend/convex/conversationSim/sampleCorpusExemplars.ts`:

```ts
import type { Id } from "../_generated/dataModel";
import type { Message, Exemplar } from "./prompt";
import { wordCount } from "./lengthStats";

type CorpusTranscript = {
  _id: Id<"livechatConversations">;
  messages: Message[];
};

type Candidate = {
  transcriptId: Id<"livechatConversations">;
  userIndex: number;
  transcript: CorpusTranscript;
  userText: string;
};

const SHORT_WORD_LIMIT = 30;

function collectCandidates(transcripts: CorpusTranscript[]): Candidate[] {
  const out: Candidate[] = [];
  for (const t of transcripts) {
    for (let i = 0; i < t.messages.length; i++) {
      const m = t.messages[i];
      if (m.role !== "user") continue;
      out.push({ transcriptId: t._id, userIndex: i, transcript: t, userText: m.text });
    }
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildExemplarMessages(transcript: CorpusTranscript, userIndex: number): Message[] {
  // Walk backward from userIndex to find the most recent human_agent message,
  // then include everything from that human_agent through the user message.
  let agentIdx = -1;
  for (let j = userIndex - 1; j >= 0; j--) {
    if (transcript.messages[j].role === "human_agent") {
      agentIdx = j;
      break;
    }
  }
  const start = agentIdx >= 0 ? agentIdx : userIndex;
  return transcript.messages.slice(start, userIndex + 1);
}

export function sampleCorpusExemplars(
  transcripts: CorpusTranscript[],
  count: number,
): Exemplar[] {
  const all = collectCandidates(transcripts);
  if (all.length === 0) return [];

  const short = all.filter((c) => wordCount(c.userText) <= SHORT_WORD_LIMIT);
  const pool = short.length >= count ? short : (short.length > 0 ? short : all);
  const picked = shuffle(pool).slice(0, count);

  return picked.map((c) => ({
    sourceTranscriptId: c.transcriptId,
    messages: buildExemplarMessages(c.transcript, c.userIndex),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/backend test conversationSimPrompt`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/sampleCorpusExemplars.ts packages/backend/tests/conversationSimPrompt.test.ts
git commit -m "feat(backend): add sampleCorpusExemplars for synthetic-scenario style anchor"
```

---

## Task 5: New simulator prompt — `buildUserSimPrompt()` and integration

**Files:**
- Modify: `packages/backend/convex/conversationSim/prompt.ts` (add `buildUserSimPrompt`)
- Modify: `packages/backend/convex/conversationSim/actions.ts` (import + use new helpers, update turn-0 logic)
- Test: `packages/backend/tests/conversationSimPrompt.test.ts` (extend with snapshot test)

- [ ] **Step 1: Write the failing snapshot test**

Append to `packages/backend/tests/conversationSimPrompt.test.ts`:

```ts
import { buildUserSimPrompt } from "../convex/conversationSim/prompt";

describe("buildUserSimPrompt", () => {
  const baseScenario = {
    persona: {
      type: "Busy professional",
      traits: ["terse", "direct"],
      communicationStyle: "casual",
      patienceLevel: "low" as const,
    },
    topic: "Mobile postpaid plans",
    intent: "Switch number to Vodafone",
    complexity: "medium" as const,
    reasonForContact: "Considering a switch from a competitor",
    knownInfo: "On a competitor's prepaid plan",
    unknownInfo: "Vodafone postpaid pricing and porting process",
    instruction: "(legacy prose, ignored when new fields are present)",
    behaviorAnchors: [
      "Sends fragments, not full sentences",
      "Answers direct questions with one or two words",
    ],
    userMessageLengthStats: { median: 4, p90: 8 },
    referenceTranscript: [
      { id: 1, role: "human_agent" as const, text: "Could I get your name?" },
      { id: 2, role: "user" as const, text: "Hi I want to switch to Vodafone" },
      { id: 3, role: "human_agent" as const, text: "What's your name?" },
      { id: 4, role: "user" as const, text: "Syed" },
      { id: 5, role: "human_agent" as const, text: "Which plan?" },
      { id: 6, role: "user" as const, text: "postpaid" },
    ],
  };

  it("renders all sections when all data is present", () => {
    const prompt = buildUserSimPrompt(baseScenario, 4271);
    expect(prompt).toMatchSnapshot();
  });

  it("omits # How this user speaks when behaviorAnchors empty", () => {
    const prompt = buildUserSimPrompt({ ...baseScenario, behaviorAnchors: [] }, 4271);
    expect(prompt).not.toContain("# How this user speaks");
  });

  it("omits # Message length when userMessageLengthStats missing", () => {
    const prompt = buildUserSimPrompt({ ...baseScenario, userMessageLengthStats: undefined }, 4271);
    expect(prompt).not.toContain("# Message length");
  });

  it("omits # Style examples when extractExamples returns empty", () => {
    const prompt = buildUserSimPrompt(
      { ...baseScenario, referenceTranscript: [] },
      4271,
    );
    expect(prompt).not.toContain("# Style examples");
  });

  it("falls back to # Instructions when only legacy instruction is present", () => {
    const prompt = buildUserSimPrompt(
      {
        ...baseScenario,
        behaviorAnchors: undefined,
        userMessageLengthStats: undefined,
        referenceTranscript: undefined,
        instruction: "Legacy prose narrative.",
      },
      4271,
    );
    expect(prompt).toContain("# Instructions");
    expect(prompt).toContain("Legacy prose narrative.");
  });

  it("seed appears in the prompt", () => {
    const prompt = buildUserSimPrompt(baseScenario, 9999);
    expect(prompt).toContain("9999");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/backend test conversationSimPrompt`
Expected: All `buildUserSimPrompt` tests FAIL with "buildUserSimPrompt is not a function" or similar.

- [ ] **Step 3: Add `buildUserSimPrompt` to `prompt.ts`**

Append to `packages/backend/convex/conversationSim/prompt.ts`:

```ts
export type ScenarioForPrompt = ScenarioForExtraction & {
  persona: {
    type: string;
    traits: string[];
    communicationStyle: string;
    patienceLevel: "low" | "medium" | "high";
  };
  topic: string;
  intent: string;
  complexity: string;
  reasonForContact: string;
  knownInfo: string;
  unknownInfo: string;
  instruction?: string;          // legacy prose; used only when no new fields exist
  behaviorAnchors?: string[];
  userMessageLengthStats?: { median: number; p90: number };
};

function legacyOnly(s: ScenarioForPrompt): boolean {
  const noAnchors = !s.behaviorAnchors || s.behaviorAnchors.length === 0;
  const noLengthStats = !s.userMessageLengthStats;
  const noTranscript = !s.referenceTranscript || s.referenceTranscript.length === 0;
  const noExemplars = !s.referenceExemplars || s.referenceExemplars.length === 0;
  return noAnchors && noLengthStats && noTranscript && noExemplars;
}

export function buildUserSimPrompt(scenario: ScenarioForPrompt, seed: number): string {
  const sections: string[] = [];

  sections.push(`# You
You are roleplaying an end-user contacting customer support. Stay in character.
Never reveal you are an AI.`);

  sections.push(`# Persona
- Type: ${scenario.persona.type}
- Traits: ${scenario.persona.traits.join(", ")}
- Communication style: ${scenario.persona.communicationStyle}
- Patience level: ${scenario.persona.patienceLevel}`);

  sections.push(`# Your goal
${scenario.intent}

Why you're contacting: ${scenario.reasonForContact}
Topic: ${scenario.topic}`);

  sections.push(`# What you know
${scenario.knownInfo}`);

  sections.push(`# What you don't know (and want to find out)
${scenario.unknownInfo}`);

  if (scenario.behaviorAnchors && scenario.behaviorAnchors.length > 0) {
    sections.push(
      `# How this user speaks\n` +
        scenario.behaviorAnchors.map((a) => `- ${a}`).join("\n"),
    );
  }

  if (scenario.userMessageLengthStats) {
    const { median: med, p90: p } = scenario.userMessageLengthStats;
    sections.push(`# Message length
Users in this conversation typically write ${med} words per message
(90th percentile: ${p}). Match that. If a thought is longer, split it
into several short messages instead of one long one.`);
  }

  const examples = extractExamples(scenario);
  if (examples.length > 0) {
    const rendered = examples.map((e) => {
      const agentLine = e.agent !== null ? `  agent: ${e.agent}` : `  (user spoke first)`;
      return `<example>\n${agentLine}\n  user:  ${e.user}\n</example>`;
    }).join("\n");
    sections.push(`# Style examples — real exchanges to imitate
Imitate the terseness and response pattern of these examples. Answer the
specific question. Do NOT volunteer unrelated info or context.

${rendered}`);
  }

  if (legacyOnly(scenario) && scenario.instruction) {
    sections.push(`# Instructions
${scenario.instruction}`);
  }

  sections.push(`# Rules
- Stay in character throughout.
- Don't reveal you're a simulator or mention evaluators/scoring.
- When your goal is met (or you have no more questions), respond with exactly: ###STOP###
- If asked to do something you can't simulate (open a URL, check email), make up a brief plausible response.`);

  sections.push(`# Variation: seed ${seed}
Subtly vary phrasing across re-runs. Don't break character or change goals.`);

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass (and accept snapshot)**

Run: `pnpm -C packages/backend test conversationSimPrompt -u`
Expected: All tests PASS; `__snapshots__/conversationSimPrompt.test.ts.snap` is created.

Inspect the snapshot file by hand. Confirm the output reads naturally — examples in `<example>` blocks, sections in expected order, soft length hint present, legacy `# Instructions` absent.

- [ ] **Step 5: Re-run tests without `-u` to verify the snapshot is honored**

Run: `pnpm -C packages/backend test conversationSimPrompt`
Expected: All tests PASS (no snapshot updates needed).

- [ ] **Step 6: Wire `buildUserSimPrompt` into `actions.ts` and update turn-0 logic**

Edit `packages/backend/convex/conversationSim/actions.ts`:

At the imports near the top, add:

```ts
import { buildUserSimPrompt } from "./prompt";
```

Find the existing `function buildUserSimPrompt(...)` block (lines 246-307 per spec). Delete it entirely.

Find the turn-0 logic (around lines 107-111):

```ts
      if (turnPair === 0 && scenario.referenceMessages?.[0]) {
        userMessage = scenario.referenceMessages[0].content;
      } else {
```

Replace with:

```ts
      const verbatimOpener = (() => {
        if (turnPair !== 0) return undefined;
        // Resolution order:
        // 1. Grounded: first `user` message in referenceTranscript.
        // 2. Legacy: referenceMessages[0].content (un-backfilled scenarios).
        // 3. None: simulator generates turn 0.
        if (scenario.referenceTranscript) {
          const firstUser = scenario.referenceTranscript.find((m) => m.role === "user");
          if (firstUser) return firstUser.text;
        }
        if (scenario.referenceMessages?.[0]) {
          return scenario.referenceMessages[0].content;
        }
        return undefined;
      })();

      let userMessage: string;
      if (verbatimOpener !== undefined) {
        userMessage = verbatimOpener;
      } else {
```

(Remove the existing `let userMessage: string;` line just above the deleted `if` so it isn't redeclared. The closing `}` for the new outer `else` branch matches the existing one.)

- [ ] **Step 7: Type-check**

Run: `pnpm -C packages/backend typecheck`
Expected: PASS. If `prompt.ts`'s `ScenarioForPrompt` doesn't quite match the runtime shape, refine the types.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/conversationSim/prompt.ts packages/backend/convex/conversationSim/actions.ts packages/backend/tests/conversationSimPrompt.test.ts packages/backend/tests/__snapshots__/
git commit -m "feat(backend): rewrite buildUserSimPrompt with anchors, length hint, examples"
```

---

## Task 6: Shared anchor-prompt constant — `anchorPrompt.ts`

**Files:**
- Create: `packages/backend/convex/conversationSim/anchorPrompt.ts`

- [ ] **Step 1: Implement the module**

Create `packages/backend/convex/conversationSim/anchorPrompt.ts`:

```ts
/**
 * Shared instruction text for the LLM that generates `behaviorAnchors`
 * during scenario generation AND during the migration backfill.
 *
 * Keeping this in one place ensures that both code paths produce
 * comparable anchors.
 */
export const BEHAVIOR_ANCHORS_INSTRUCTION = `Produce 3-6 short bullet phrases capturing how this specific user spoke. Each bullet must be ≤12 words. Examples:
  - "Answers questions with a single word"
  - "Switches to Arabic when frustrated"
  - "Splits questions across multiple short messages"
  - "Doesn't volunteer information until asked"

Extract observable patterns from the transcript or exemplars provided, not generic persona traits. Output only a JSON array of strings: ["bullet 1", "bullet 2", ...]. No prose, no markdown.`;
```

- [ ] **Step 2: Type-check**

Run: `pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/conversationSim/anchorPrompt.ts
git commit -m "feat(backend): add shared behavior-anchor LLM instruction constant"
```

---

## Task 7: Update `generateGroundedScenarios` — drop prose, add anchors

**Files:**
- Modify: `packages/backend/convex/conversationSim/generationActions.ts:147-219` (the function `generateGroundedScenarios`)

- [ ] **Step 1: Read the current grounded generation code**

Run: `sed -n '147,219p' packages/backend/convex/conversationSim/generationActions.ts`
Confirm the JSON shape requested from the LLM matches the spec's "before" description.

- [ ] **Step 2: Add deterministic pre-LLM passes per transcript**

Edit `packages/backend/convex/conversationSim/generationActions.ts`. At the top of the file, add imports:

```ts
import { wordCount, median, p90 } from "./lengthStats";
import { BEHAVIOR_ANCHORS_INSTRUCTION } from "./anchorPrompt";
```

Replace the body of `generateGroundedScenarios` with:

```ts
async function generateGroundedScenarios(
  transcriptBatch: Array<{ _id: Id<"livechatConversations">; messages: Array<{ id: number; role: string; text: string }>; botFlowInput?: { intent: string; language: string } | null; labels?: string[]; visitorName?: string }>,
  complexities: Array<"low" | "medium" | "high">,
  fidelity: number,
  model: string,
): Promise<Array<Record<string, unknown>>> {
  let fidelityInstruction: string;
  if (fidelity >= 80) {
    fidelityInstruction =
      "Stay very close to the original transcript. Preserve the language, intent, and style.";
  } else if (fidelity >= 50) {
    fidelityInstruction =
      "Capture the essence of the original transcript but allow moderate variation in wording and detail.";
  } else {
    fidelityInstruction =
      "Use the transcript as loose inspiration only. Keep the general topic and intent but create a distinct variation with different wording and angle.";
  }

  const transcriptContexts = transcriptBatch.map((t, i) => {
    const userMsgs = t.messages.filter((m) => m.role === "user");
    const agentMsgs = t.messages.filter((m) => m.role === "human_agent");
    const intent = t.botFlowInput?.intent ?? "unknown";
    const language = t.botFlowInput?.language ?? "unknown";
    return `--- Transcript ${i + 1} (ID: ${t._id}) ---
Intent: ${intent}, Language: ${language}, Labels: ${(t.labels ?? []).join(", ")}
Visitor: ${t.visitorName ?? "unknown"}
Complexity target: ${complexities[i] ?? "medium"}
User messages:
${userMsgs.map((m) => `  [user] ${m.text}`).join("\n")}
Agent messages:
${agentMsgs.slice(0, 5).map((m) => `  [agent] ${m.text}`).join("\n")}`;
  });

  const result = await generateText({
    model: resolveModel(model),
    system:
      "You generate conversation scenarios grounded in real customer support transcripts. Always respond with valid JSON only.",
    prompt: `Convert each transcript below into a conversation scenario configuration.

${fidelityInstruction}

${transcriptContexts.join("\n\n")}

For each transcript, generate a scenario object. Return a JSON array:
[
  {
    "persona": {
      "type": "string - persona type derived from the visitor",
      "traits": ["trait1", "trait2"],
      "communicationStyle": "formal/casual/etc based on transcript",
      "patienceLevel": "low/medium/high"
    },
    "topic": "string - the topic from the transcript",
    "intent": "string - what the user wants to achieve",
    "complexity": "low/medium/high - must match the complexity target",
    "reasonForContact": "string - why they're reaching out",
    "knownInfo": "string - what the user already knows",
    "unknownInfo": "string - what the user doesn't know and wants to find out",
    "behaviorAnchors": ["bullet phrase", ...],
    "_sourceTranscriptId": "string - the transcript ID",
    "_languages": ["string - detected languages"]
  }
]

For behaviorAnchors: ${BEHAVIOR_ANCHORS_INSTRUCTION}

Respond ONLY with the JSON array.`,
    temperature: 0.6,
  });

  return extractJson(result.text) as Array<Record<string, unknown>>;
}
```

- [ ] **Step 3: Update the grounded persistence loop to compute and pass new fields**

In `generateScenarios.handler`, find the grounded-track persistence loop (around line 399-445 — the `for (let j = 0; j < scenarios.length...; j++)` block).

Replace the section that builds `referenceMessages` and the `runMutation` call with:

```ts
              // Snapshot full transcript (no filtering) and length stats
              const sourceTranscript = batchTranscripts[j];
              const referenceTranscript = sourceTranscript?.messages.map((m) => ({
                id: m.id,
                role: m.role as "user" | "human_agent" | "workflow_input",
                text: m.text,
              })) ?? [];

              const userWordCounts = referenceTranscript
                .filter((m) => m.role === "user")
                .map((m) => wordCount(m.text));

              const userMessageLengthStats = userWordCounts.length > 0
                ? { median: median(userWordCounts), p90: p90(userWordCounts) }
                : undefined;

              const behaviorAnchors = Array.isArray(s.behaviorAnchors)
                ? (s.behaviorAnchors as unknown[]).map(String).slice(0, 6)
                : [];

              // Always use the actual transcript ID, not LLM output
              const sourceTranscriptId = batchTranscripts[j]?._id;

              const languages = Array.isArray(s._languages)
                ? (s._languages as string[]).map(String)
                : [];

              await ctx.runMutation(
                internal.conversationSim.scenarios.createInternal,
                {
                  datasetId,
                  orgId,
                  persona,
                  topic: String(s.topic ?? "General"),
                  intent: String(s.intent ?? "Get help"),
                  complexity: validateLevel(s.complexity),
                  reasonForContact: String(s.reasonForContact ?? "Needs assistance"),
                  knownInfo: String(s.knownInfo ?? "Basic information about the service"),
                  unknownInfo: String(s.unknownInfo ?? "Specific details about their issue"),
                  instruction: "",   // legacy field; new generation no longer authors prose
                  referenceTranscript,
                  userMessageLengthStats,
                  behaviorAnchors,
                  sourceType: "transcript_grounded",
                  sourceTranscriptId,
                  languages,
                },
              );
              generatedCount++;
```

(Delete the prior `rawRefMsgs`, `referenceMessages.length > 0 ? ...` lines and any old `instruction: String(s.instruction ?? ...)` assignment.)

- [ ] **Step 4: Type-check**

Run: `pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 5: Verify existing tests still pass**

Run: `pnpm -C packages/backend test scenarioGeneration`
Expected: PASS (existing tests don't test LLM output, so they should be tolerant to the prompt change).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/conversationSim/generationActions.ts
git commit -m "feat(backend): grounded scenarios produce behavior anchors and full transcript snapshot"
```

---

## Task 8: Update `generateSyntheticScenarios` — sample exemplars and corpus stats

**Files:**
- Modify: `packages/backend/convex/conversationSim/generationActions.ts:221-283` (synthetic generator) plus the synthetic persistence block in `generateScenarios.handler`.

- [ ] **Step 1: Update the synthetic LLM prompt shape**

In `generationActions.ts`, replace `generateSyntheticScenarios` body so the JSON request asks for `behaviorAnchors` instead of `instruction`:

```ts
async function generateSyntheticScenarios(
  transcriptProfile: TranscriptProfile | null,
  kbContent: Array<{ title: string; content: string }>,
  exemplars: Array<{ messages: Array<{ role: string; text: string }> }>,
  complexities: Array<"low" | "medium" | "high">,
  model: string,
): Promise<Array<Record<string, unknown>>> {
  const kbContext = kbContent
    .map((d) => `### ${d.title}\n${d.content}`)
    .join("\n\n---\n\n");

  let profileContext = "";
  if (transcriptProfile) {
    profileContext = `
You also have insight from real customer transcripts. Generate scenarios that COMPLEMENT (not duplicate) these patterns:
- Persona clusters seen: ${transcriptProfile.personaClusters.join(", ")}
- Common intents seen: ${transcriptProfile.commonIntents.join(", ")}
- Topics seen: ${transcriptProfile.topicDistribution.join(", ")}
- Patterns seen: ${transcriptProfile.conversationPatterns.join(", ")}
- Languages used: ${transcriptProfile.languagesUsed.join(", ")}

Try to cover gaps — generate personas, intents, and topics NOT already well-represented in the transcript data.
`;
  }

  let exemplarContext = "";
  if (exemplars.length > 0) {
    exemplarContext = `
Real exchanges sampled from the corpus (use these to ground your behavior anchors in observable patterns):
${exemplars.slice(0, 8).map((ex, i) =>
  `Exemplar ${i + 1}:\n${ex.messages.map((m) => `  [${m.role}] ${m.text}`).join("\n")}`,
).join("\n\n")}
`;
  }

  const result = await generateText({
    model: resolveModel(model),
    system:
      "You generate realistic customer support conversation scenarios based on knowledge base content. Each scenario describes a simulated end-user who will contact support. Always respond with valid JSON only.",
    prompt: `Based on this knowledge base content:
${kbContext.slice(0, 12000)}
${profileContext}
${exemplarContext}

Generate exactly ${complexities.length} conversation scenarios.

Complexity levels for this batch: ${JSON.stringify(complexities)}

Return a JSON array of scenarios:
[
  {
    "persona": {
      "type": "string - the persona type",
      "traits": ["trait1", "trait2"],
      "communicationStyle": "formal/casual/etc",
      "patienceLevel": "low/medium/high"
    },
    "topic": "string - the topic",
    "intent": "string - what the user wants to achieve",
    "complexity": "low/medium/high",
    "reasonForContact": "string - why they're reaching out",
    "knownInfo": "string - what the user already knows",
    "unknownInfo": "string - what the user doesn't know and wants to find out",
    "behaviorAnchors": ["bullet phrase", ...]
  }
]

For behaviorAnchors: ${BEHAVIOR_ANCHORS_INSTRUCTION}

Make each scenario unique and realistic.

Respond ONLY with the JSON array.`,
    temperature: 0.7,
  });

  return extractJson(result.text) as Array<Record<string, unknown>>;
}
```

- [ ] **Step 2: Pre-sample exemplars and corpus stats once per job**

At the top of `generationActions.ts`, add the import (alongside the imports added in Task 7):

```ts
import { sampleCorpusExemplars } from "./sampleCorpusExemplars";
```

In `generateScenarios.handler`, after the `if (transcripts.length > 0)` block that does corpus analysis, add:

```ts
    // ── Phase 1.5: Pre-sample exemplars & corpus length stats (synthetic only) ──
    let synthExemplars: Array<{ sourceTranscriptId: Id<"livechatConversations">; messages: Array<{ id: number; role: "user" | "human_agent" | "workflow_input"; text: string }> }> = [];
    let synthLengthStats: { median: number; p90: number } | undefined;

    if (syntheticCount > 0 && transcripts.length > 0) {
      synthExemplars = sampleCorpusExemplars(
        transcripts as Parameters<typeof sampleCorpusExemplars>[0],
        8,
      );

      const allUserWords = transcripts.flatMap((t) =>
        t.messages.filter((m) => m.role === "user").map((m) => wordCount(m.text)),
      );
      if (allUserWords.length > 0) {
        synthLengthStats = { median: median(allUserWords), p90: p90(allUserWords) };
      }
    }
```

- [ ] **Step 3: Pass exemplars to synthetic generator and persist new fields**

In the synthetic-track loop (around lines 459-518), update the call to `generateSyntheticScenarios`:

```ts
          const scenarios = await generateSyntheticScenarios(
            transcriptProfile,
            kbContent,
            synthExemplars.map((ex) => ({
              messages: ex.messages.map((m) => ({ role: m.role, text: m.text })),
            })),
            batchComplexities,
            model,
          );
```

And update the persistence call inside the loop:

```ts
            try {
              const persona = extractPersona(s);
              const behaviorAnchors = Array.isArray(s.behaviorAnchors)
                ? (s.behaviorAnchors as unknown[]).map(String).slice(0, 6)
                : [];

              await ctx.runMutation(
                internal.conversationSim.scenarios.createInternal,
                {
                  datasetId,
                  orgId,
                  persona,
                  topic: String(s.topic ?? "General"),
                  intent: String(s.intent ?? "Get help"),
                  complexity: validateLevel(s.complexity),
                  reasonForContact: String(s.reasonForContact ?? "Needs assistance"),
                  knownInfo: String(s.knownInfo ?? "Basic information about the service"),
                  unknownInfo: String(s.unknownInfo ?? "Specific details about their issue"),
                  instruction: "",   // legacy field; no longer authored
                  referenceExemplars: synthExemplars,
                  userMessageLengthStats: synthLengthStats,
                  behaviorAnchors,
                  sourceType: "synthetic",
                  languages: [],
                },
              );
              generatedCount++;
            } catch (e) {
              console.error("Failed to save synthetic scenario:", e);
            }
```

- [ ] **Step 4: Type-check and verify existing tests pass**

Run:
```bash
pnpm -C packages/backend typecheck
pnpm -C packages/backend test scenarioGeneration
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/generationActions.ts
git commit -m "feat(backend): synthetic scenarios sample exemplars and produce behavior anchors"
```

---

## Task 9: Backfill — `backfillGrounded`

**Files:**
- Create: `packages/backend/convex/conversationSim/migrations.ts`
- Test: `packages/backend/tests/conversationSimMigrations.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/tests/conversationSimMigrations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import { setupTest, seedUser, seedKB, TEST_ORG_ID } from "./helpers";
import workpoolTest from "@convex-dev/workpool/test";
import type { Id } from "../convex/_generated/dataModel";

function setup() {
  const t = setupTest();
  workpoolTest.register(t, "conversationSimPool");
  return t;
}

async function seedDataset(
  t: ReturnType<typeof setup>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("datasets", {
      orgId: TEST_ORG_ID,
      kbId,
      name: "Test Sim Dataset",
      strategy: "conversation_sim",
      strategyConfig: {},
      type: "conversation_sim",
      questionCount: 0,
      scenarioCount: 0,
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    }),
  );
}

async function seedTranscript(
  t: ReturnType<typeof setup>,
  userId: Id<"users">,
  messages: Array<{ id: number; role: "user" | "human_agent" | "workflow_input"; text: string }>,
) {
  // livechatUploads requires a real csvStorageId — store an empty blob to get one
  const csvStorageId = await t.run(async (ctx: any) =>
    ctx.storage.store(new Blob(["a,b\n1,2\n"])),
  );
  return await t.run(async (ctx: any) => {
    const uploadId = await ctx.db.insert("livechatUploads", {
      orgId: TEST_ORG_ID,
      createdBy: userId,
      filename: "test.csv",
      csvStorageId,
      status: "ready",
      createdAt: Date.now(),
    });
    return ctx.db.insert("livechatConversations", {
      uploadId,
      orgId: TEST_ORG_ID,
      conversationId: "conv1",
      visitorId: "v1",
      visitorName: "Test User",
      visitorPhone: "",
      visitorEmail: "",
      agentId: "a1",
      agentName: "Test Agent",
      agentEmail: "",
      inbox: "",
      labels: [],
      status: "completed",
      messages,
      metadata: {},
      classificationStatus: "none",
      translationStatus: "none",
    });
  });
}

describe("backfillGrounded", () => {
  it("snapshots transcript and computes length stats", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "Hello?" },
      { id: 2, role: "user", text: "Hi" },
      { id: 3, role: "workflow_input", text: "[event]" },
      { id: 4, role: "user", text: "I want help" },
    ]);

    const scenarioId = await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId,
        orgId: TEST_ORG_ID,
        persona: { type: "User", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "test", intent: "test", complexity: "medium",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "old prose",
        sourceType: "transcript_grounded",
        sourceTranscriptId: transcriptId,
      }),
    );

    const result = await t.action(internal.conversationSim.migrations.backfillGrounded, {});
    expect(result.isDone).toBe(true);

    const after = await t.run(async (ctx: any) => ctx.db.get(scenarioId));
    expect(after?.referenceTranscript).toHaveLength(4);
    expect(after?.referenceTranscript?.[2].role).toBe("workflow_input"); // not filtered
    expect(after?.userMessageLengthStats).toBeDefined();
    expect(after?.userMessageLengthStats?.median).toBeGreaterThan(0);
  });

  it("is idempotent: running twice changes nothing on the second pass", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "Hi?" },
      { id: 2, role: "user", text: "ok" },
    ]);
    await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "transcript_grounded", sourceTranscriptId: transcriptId,
      }),
    );

    const r1 = await t.action(internal.conversationSim.migrations.backfillGrounded, {});
    const r2 = await t.action(internal.conversationSim.migrations.backfillGrounded, {});
    expect(r1.migrated).toBe(1);
    expect(r2.migrated).toBe(0);
  });

  it("skips synthetic scenarios (no sourceTranscriptId)", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "synthetic",
      }),
    );
    const result = await t.action(internal.conversationSim.migrations.backfillGrounded, {});
    expect(result.migrated).toBe(0);
  });

  it("leaves length stats unset when transcript has no user messages", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "anyone?" },
    ]);
    const scenarioId = await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "transcript_grounded", sourceTranscriptId: transcriptId,
      }),
    );
    await t.action(internal.conversationSim.migrations.backfillGrounded, {});
    const after = await t.run(async (ctx: any) => ctx.db.get(scenarioId));
    expect(after?.referenceTranscript).toHaveLength(1);
    expect(after?.userMessageLengthStats).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/backend test conversationSimMigrations`
Expected: FAIL with "Cannot find module ... migrations" or "internal.conversationSim.migrations is not a function".

- [ ] **Step 3: Implement `backfillGrounded`**

Create `packages/backend/convex/conversationSim/migrations.ts`:

```ts
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { wordCount, median, p90 } from "./lengthStats";

export const backfillGrounded = internalMutation({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, batchSize }) => {
    const result = await ctx.db
      .query("conversationScenarios")
      .paginate({ numItems: batchSize ?? 50, cursor: cursor ?? null });

    let migrated = 0;
    for (const s of result.page) {
      if (s.referenceTranscript) continue;        // idempotent
      if (!s.sourceTranscriptId) continue;        // synthetic; skip
      const t = await ctx.db.get(s.sourceTranscriptId);
      if (!t) continue;                            // transcript deleted

      const wc = t.messages
        .filter((m) => m.role === "user")
        .map((m) => wordCount(m.text));

      const patch: Record<string, unknown> = {
        referenceTranscript: t.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "human_agent" | "workflow_input",
          text: m.text,
        })),
      };
      if (wc.length > 0) {
        patch.userMessageLengthStats = { median: median(wc), p90: p90(wc) };
      }

      await ctx.db.patch(s._id, patch);
      migrated++;
    }
    return {
      migrated,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});
```

Note: the test uses `t.action(internal.conversationSim.migrations.backfillGrounded, {})` but `backfillGrounded` is a `mutation`. Update the test to call `t.mutation` instead. Edit the test file: change `await t.action(internal.conversationSim.migrations.backfillGrounded, {})` to `await t.mutation(internal.conversationSim.migrations.backfillGrounded, {})` in all four occurrences.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/backend test conversationSimMigrations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/migrations.ts packages/backend/tests/conversationSimMigrations.test.ts
git commit -m "feat(backend): backfillGrounded migration for transcript snapshot + length stats"
```

---

## Task 10: Backfill — `backfillBehaviorAnchors`

**Files:**
- Modify: `packages/backend/convex/conversationSim/migrations.ts`
- Modify: `packages/backend/tests/conversationSimMigrations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/tests/conversationSimMigrations.test.ts`:

```ts
describe("backfillBehaviorAnchors", () => {
  it("skips scenarios that already have behaviorAnchors", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "Hi" },
      { id: 2, role: "user", text: "ok" },
    ]);
    await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "transcript_grounded",
        sourceTranscriptId: transcriptId,
        referenceTranscript: [
          { id: 1, role: "human_agent", text: "Hi" },
          { id: 2, role: "user", text: "ok" },
        ],
        behaviorAnchors: ["already populated"],
      }),
    );

    const result = await t.action(internal.conversationSim.migrations.backfillBehaviorAnchors, {});
    expect(result.migrated).toBe(0);
  });

  it("skips synthetic scenarios", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "synthetic",
        // no sourceTranscriptId, no referenceTranscript
      }),
    );
    const result = await t.action(internal.conversationSim.migrations.backfillBehaviorAnchors, {});
    expect(result.migrated).toBe(0);
  });
});
```

(Idempotent + skip-synthetic are the easy assertions. We don't unit-test the LLM call itself — that's covered manually.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/backend test conversationSimMigrations`
Expected: FAIL on the new tests with "is not a function".

- [ ] **Step 3: Implement `backfillBehaviorAnchors`**

In `packages/backend/convex/conversationSim/migrations.ts`, append (before any non-action code, but as a separate file to satisfy `"use node"` constraint, this needs to live in a separate file — see Step 3a).

**Step 3a:** Create `packages/backend/convex/conversationSim/migrationsActions.ts` (note: separate file because the LLM call needs `"use node"`):

```ts
"use node";

import { internalAction, internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { resolveModel } from "../lib/agentLoop";
import { BEHAVIOR_ANCHORS_INSTRUCTION } from "./anchorPrompt";
import type { Id } from "../_generated/dataModel";

function extractJson(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
  }
  throw new Error(`Failed to parse JSON: ${stripped.slice(0, 200)}`);
}

export const backfillBehaviorAnchors = internalAction({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.runQuery(internal.conversationSim.migrations.pageScenariosForAnchors, {
      cursor: cursor ?? null,
      batchSize: batchSize ?? 15,
    });

    let migrated = 0;
    for (const s of page.page) {
      // Filter: grounded scenarios with referenceTranscript but no behaviorAnchors
      if (s.behaviorAnchors && s.behaviorAnchors.length > 0) continue;
      if (!s.referenceTranscript || s.referenceTranscript.length === 0) continue;

      const transcriptText = s.referenceTranscript
        .filter((m: any) => m.role === "human_agent" || m.role === "user")
        .map((m: any) => `${m.role === "user" ? "user" : "agent"}: ${m.text}`)
        .join("\n");

      const prompt = `Persona: ${s.persona.type} (${s.persona.traits.join(", ")}, ${s.persona.communicationStyle}, ${s.persona.patienceLevel} patience)
Intent: ${s.intent}
Topic: ${s.topic}

Transcript:
${transcriptText}

${BEHAVIOR_ANCHORS_INSTRUCTION}`;

      try {
        const result = await generateText({
          model: resolveModel("claude-sonnet-4-20250514"),
          system: "Output only a JSON array of strings. No prose.",
          prompt,
          temperature: 0.3,
        });
        const anchors = extractJson(result.text);
        if (Array.isArray(anchors)) {
          await ctx.runMutation(internal.conversationSim.migrations.patchBehaviorAnchors, {
            id: s._id,
            behaviorAnchors: anchors.map(String).slice(0, 6),
          });
          migrated++;
        }
      } catch (e) {
        console.error(`backfillBehaviorAnchors failed for ${s._id}:`, e);
        // continue; don't poison the batch
      }
    }

    return {
      migrated,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
```

**Step 3b:** Add the supporting query/mutation to `packages/backend/convex/conversationSim/migrations.ts` (NOT `"use node"`).

First, **update the imports** at the top of the file to add `internalQuery` (alongside the existing `internalMutation`):

```ts
import { internalMutation, internalQuery } from "../_generated/server";
```

Then **append** these new functions at the bottom of the file:

```ts
export const pageScenariosForAnchors = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.number() },
  handler: async (ctx, { cursor, batchSize }) => {
    const result = await ctx.db
      .query("conversationScenarios")
      .paginate({ numItems: batchSize, cursor });
    return result;
  },
});

export const patchBehaviorAnchors = internalMutation({
  args: { id: v.id("conversationScenarios"), behaviorAnchors: v.array(v.string()) },
  handler: async (ctx, { id, behaviorAnchors }) => {
    await ctx.db.patch(id, { behaviorAnchors });
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/backend test conversationSimMigrations`
Expected: PASS. The "skip" tests don't make LLM calls (early-return), so no network mocks are needed.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/migrations.ts packages/backend/convex/conversationSim/migrationsActions.ts packages/backend/tests/conversationSimMigrations.test.ts
git commit -m "feat(backend): backfillBehaviorAnchors migration for grounded scenarios"
```

---

## Task 11: Backfill — `backfillSynthetic`

**Files:**
- Modify: `packages/backend/convex/conversationSim/migrationsActions.ts`
- Modify: `packages/backend/convex/conversationSim/migrations.ts` (add a query for synthetic-scenarios + dataset transcript pool)
- Modify: `packages/backend/tests/conversationSimMigrations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/tests/conversationSimMigrations.test.ts`:

```ts
describe("backfillSynthetic", () => {
  it("skips grounded scenarios", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "Hi" },
      { id: 2, role: "user", text: "ok" },
    ]);
    await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "",
        sourceType: "transcript_grounded",
        sourceTranscriptId: transcriptId,
      }),
    );
    const result = await t.action(internal.conversationSim.migrationsActions.backfillSynthetic, {});
    expect(result.migrated).toBe(0);
  });

  it("skips synthetic scenarios that already have referenceExemplars", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "Hi" },
      { id: 2, role: "user", text: "ok" },
    ]);
    await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "synthetic",
        referenceExemplars: [
          { sourceTranscriptId: transcriptId, messages: [{ id: 1, role: "user", text: "x" }] },
        ],
      }),
    );
    const result = await t.action(internal.conversationSim.migrationsActions.backfillSynthetic, {});
    expect(result.migrated).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/backend test conversationSimMigrations`
Expected: FAIL with "is not a function".

- [ ] **Step 3: Add supporting queries to `migrations.ts`**

Append to `packages/backend/convex/conversationSim/migrations.ts`:

```ts
export const pageSyntheticScenarios = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.number() },
  handler: async (ctx, { cursor, batchSize }) => {
    const result = await ctx.db
      .query("conversationScenarios")
      .paginate({ numItems: batchSize, cursor });
    return result;
  },
});

export const listOrgTranscripts = internalQuery({
  args: { orgId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, limit }) => {
    return await ctx.db
      .query("livechatConversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .take(limit ?? 50);
  },
});

export const patchSyntheticBackfill = internalMutation({
  args: {
    id: v.id("conversationScenarios"),
    referenceExemplars: v.array(v.object({
      sourceTranscriptId: v.id("livechatConversations"),
      messages: v.array(v.object({
        id: v.number(),
        role: v.union(v.literal("user"), v.literal("human_agent"), v.literal("workflow_input")),
        text: v.string(),
      })),
    })),
    userMessageLengthStats: v.optional(v.object({ median: v.number(), p90: v.number() })),
    behaviorAnchors: v.array(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
  },
});
```

- [ ] **Step 4: Implement `backfillSynthetic` in `migrationsActions.ts`**

Append to `packages/backend/convex/conversationSim/migrationsActions.ts`:

```ts
import { sampleCorpusExemplars } from "./sampleCorpusExemplars";
import { wordCount, median, p90 } from "./lengthStats";

export const backfillSynthetic = internalAction({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.runQuery(internal.conversationSim.migrations.pageSyntheticScenarios, {
      cursor: cursor ?? null,
      batchSize: batchSize ?? 15,
    });

    // Cache transcript pool per batch by orgId
    const orgPools = new Map<string, { transcripts: any[]; exemplars: any[]; stats?: { median: number; p90: number } }>();

    let migrated = 0;
    for (const s of page.page) {
      if (s.sourceType !== "synthetic") continue;
      if (s.referenceExemplars && s.referenceExemplars.length > 0) continue;

      // Load corpus pool once per orgId
      let pool = orgPools.get(s.orgId);
      if (!pool) {
        const transcripts = await ctx.runQuery(internal.conversationSim.migrations.listOrgTranscripts, {
          orgId: s.orgId,
          limit: 50,
        });
        const exemplars = sampleCorpusExemplars(transcripts as any, 8);
        const allUserWords = (transcripts as any[]).flatMap((t) =>
          t.messages.filter((m: any) => m.role === "user").map((m: any) => wordCount(m.text)),
        );
        const stats = allUserWords.length > 0
          ? { median: median(allUserWords), p90: p90(allUserWords) }
          : undefined;
        pool = { transcripts, exemplars, stats };
        orgPools.set(s.orgId, pool);
      }

      if (pool.exemplars.length === 0) {
        // No transcripts in this org → can't backfill exemplars; skip with a warning
        console.warn(`backfillSynthetic: no transcripts available for org ${s.orgId}; skipping ${s._id}`);
        continue;
      }

      // Generate behavior anchors
      let anchors: string[] = [];
      try {
        const transcriptText = pool.exemplars
          .flatMap((ex: any) =>
            ex.messages
              .filter((m: any) => m.role === "human_agent" || m.role === "user")
              .map((m: any) => `${m.role === "user" ? "user" : "agent"}: ${m.text}`),
          )
          .join("\n");
        const prompt = `Persona: ${s.persona.type} (${s.persona.traits.join(", ")}, ${s.persona.communicationStyle}, ${s.persona.patienceLevel} patience)
Intent: ${s.intent}
Topic: ${s.topic}

Sampled real exchanges (use these to ground anchor patterns):
${transcriptText}

${BEHAVIOR_ANCHORS_INSTRUCTION}`;
        const result = await generateText({
          model: resolveModel("claude-sonnet-4-20250514"),
          system: "Output only a JSON array of strings. No prose.",
          prompt,
          temperature: 0.3,
        });
        const parsed = extractJson(result.text);
        if (Array.isArray(parsed)) anchors = parsed.map(String).slice(0, 6);
      } catch (e) {
        console.error(`backfillSynthetic anchor generation failed for ${s._id}:`, e);
        // proceed with empty anchors; exemplars+stats still backfill
      }

      await ctx.runMutation(internal.conversationSim.migrations.patchSyntheticBackfill, {
        id: s._id,
        referenceExemplars: pool.exemplars,
        userMessageLengthStats: pool.stats,
        behaviorAnchors: anchors,
      });
      migrated++;
    }

    return {
      migrated,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C packages/backend test conversationSimMigrations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/conversationSim/migrations.ts packages/backend/convex/conversationSim/migrationsActions.ts packages/backend/tests/conversationSimMigrations.test.ts
git commit -m "feat(backend): backfillSynthetic migration for synthetic scenario exemplars + anchors"
```

---

## Task 12: Frontend — `SimRunDetail.tsx` updates

**Files:**
- Modify: `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`

- [ ] **Step 1: Read the current implementation**

Run: `grep -n "sourceTranscriptId\|referenceTranscript\|referenceMessages" packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`
Note the lines to modify.

- [ ] **Step 2: Update the source-transcript fetch logic**

Find the section that fetches the source transcript (uses `useQuery` against `livechat`/orchestration with `sourceTranscriptId`). Change it to:

1. **First** check `scenario.referenceTranscript` — if present, use it as-is (it already has `{id, role, text}` shape and is the snapshot).
2. **Else if** `scenario.sourceTranscriptId` present, fetch via the existing query and use its `messages`.
3. **Else** (synthetic, no source) render an empty-state right pane.

Pseudocode:

```tsx
const transcriptToShow: { id: number; role: string; text: string }[] | null = (() => {
  if (scenario?.referenceTranscript && scenario.referenceTranscript.length > 0) {
    return scenario.referenceTranscript;
  }
  if (sourceTranscriptQuery.data?.messages) {
    return sourceTranscriptQuery.data.messages;
  }
  return null;
})();

// Right pane render (no extra state; uses HTML <details> for the disclosure):
{transcriptToShow ? (
  // existing transcript renderer
) : (
  <div className="empty-state">
    <p>Synthetic scenario — no source conversation.</p>
    {scenario?.referenceExemplars && scenario.referenceExemplars.length > 0 && (
      <details>
        <summary>View style exemplars ({scenario.referenceExemplars.length})</summary>
        <ul>
          {scenario.referenceExemplars.map((ex, i) => (
            <li key={i}>
              {ex.messages.map((m, j) => (
                <div key={j}><strong>{m.role}:</strong> {m.text}</div>
              ))}
            </li>
          ))}
        </ul>
      </details>
    )}
  </div>
)}
```

Adjust the actual component code to match the existing patterns — preserve loading/error states for the legacy fetch path. Match `className` conventions used elsewhere in the same component (do not invent new ones).

- [ ] **Step 3: Type-check**

Run: `pnpm -C packages/frontend build` (or `pnpm typecheck:frontend` if that script exists; if not, `pnpm -C packages/frontend tsc --noEmit`)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/SimRunDetail.tsx
git commit -m "feat(frontend): SimRunDetail prefers referenceTranscript snapshot, handles synthetic empty state"
```

---

## Task 13: Frontend — `ScenarioFields.tsx` updates

**Files:**
- Modify: `packages/frontend/src/components/ScenarioFields.tsx`

- [ ] **Step 1: Read the current component**

Run: `cat packages/frontend/src/components/ScenarioFields.tsx`
Note the existing `instruction` and `referenceMessages` rendering blocks (around lines 19-20 and 98-110).

- [ ] **Step 2: Extend the type and add new sections**

In `packages/frontend/src/components/ScenarioFields.tsx`, extend the prop type to include the new optional fields:

```tsx
type Scenario = {
  // existing fields ...
  instruction: string;
  referenceMessages?: Array<{ role: "user"; content: string; turnIndex: number }>;
  // new fields:
  behaviorAnchors?: string[];
  userMessageLengthStats?: { median: number; p90: number };
  referenceTranscript?: Array<{ id: number; role: string; text: string }>;
  referenceExemplars?: Array<{
    sourceTranscriptId: string;
    messages: Array<{ id: number; role: string; text: string }>;
  }>;
};
```

Replace the existing "Instructions" rendering block with:

```tsx
{(scenario.behaviorAnchors && scenario.behaviorAnchors.length > 0) ? (
  <section>
    <h3>How this user speaks</h3>
    <ul className="anchor-list">
      {scenario.behaviorAnchors.map((a, i) => <li key={i}>{a}</li>)}
    </ul>
  </section>
) : scenario.instruction ? (
  <section>
    <h3>Instructions</h3>
    <p className="prose">{scenario.instruction}</p>
  </section>
) : null}

{scenario.userMessageLengthStats && (
  <span className="length-badge">
    Typical length: median {scenario.userMessageLengthStats.median}w / p90 {scenario.userMessageLengthStats.p90}w
  </span>
)}
```

Replace the existing "Reference Messages" rendering block with:

```tsx
{scenario.referenceTranscript && scenario.referenceTranscript.length > 0 ? (
  <section>
    <a href="#source-transcript" className="link">View source transcript →</a>
  </section>
) : scenario.referenceExemplars && scenario.referenceExemplars.length > 0 ? (
  <section>
    <details>
      <summary>Style exemplars ({scenario.referenceExemplars.length})</summary>
      <ul>
        {scenario.referenceExemplars.map((ex, i) => (
          <li key={i}>
            {ex.messages.map((m, j) => (
              <div key={j}><strong>{m.role}:</strong> {m.text}</div>
            ))}
            <small>(from transcript {ex.sourceTranscriptId.slice(-6)})</small>
          </li>
        ))}
      </ul>
    </details>
  </section>
) : scenario.referenceMessages && scenario.referenceMessages.length > 0 ? (
  // legacy fallback — existing rendering
  <section>
    <h4>Reference Messages ({scenario.referenceMessages.length})</h4>
    {scenario.referenceMessages.map((msg, i) => (
      <div key={i}>{msg.content}</div>
    ))}
  </section>
) : null}
```

Match the styling classes and JSX patterns to whatever the existing component already uses — copy from the original block. Do not invent new className conventions.

- [ ] **Step 3: Type-check / build**

Run: `pnpm -C packages/frontend build`
Expected: PASS.

- [ ] **Step 4: Smoke-test in the browser**

Run: `pnpm dev` (in another terminal: `pnpm dev:backend`)
Open the dataset page and a scenario detail view. Confirm new sections render for backfilled scenarios; legacy scenarios (no new fields) still show the old rendering.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/ScenarioFields.tsx
git commit -m "feat(frontend): ScenarioFields shows behavior anchors, length badge, exemplars panel"
```

---

## Task 14: Frontend — `EditScenarioModal.tsx` updates

**Files:**
- Modify: `packages/frontend/src/components/EditScenarioModal.tsx`

- [ ] **Step 1: Read the current modal**

Run: `cat packages/frontend/src/components/EditScenarioModal.tsx`
Locate the `instruction` textarea (line ~292) and the `instruction` state hook (line ~53).

- [ ] **Step 2: Replace the `instruction` textarea with a `behaviorAnchors` editor**

In `EditScenarioModal.tsx`:

Add state hook:

```tsx
const [behaviorAnchors, setBehaviorAnchors] = useState<string[]>(
  scenario.behaviorAnchors ?? [],
);
```

Add to the dirty-check (existing block near line 65 that compares form state to scenario):

```tsx
JSON.stringify(behaviorAnchors) !== JSON.stringify(scenario.behaviorAnchors ?? []) ||
```

Add to the save handler (existing block near line 90 that builds the patch):

```tsx
behaviorAnchors,
```

Replace the `instruction` textarea (around line 290-294) with a bullet editor:

```tsx
<label>How this user speaks (behavior anchors)</label>
<div className="anchor-editor">
  {behaviorAnchors.map((a, i) => (
    <div key={i} className="anchor-row">
      <input
        type="text"
        maxLength={120}
        value={a}
        onChange={(e) => {
          const next = [...behaviorAnchors];
          next[i] = e.target.value;
          setBehaviorAnchors(next);
        }}
      />
      <button
        type="button"
        onClick={() => setBehaviorAnchors(behaviorAnchors.filter((_, j) => j !== i))}
      >
        Remove
      </button>
    </div>
  ))}
  {behaviorAnchors.length < 6 && (
    <button
      type="button"
      onClick={() => setBehaviorAnchors([...behaviorAnchors, ""])}
    >
      + Add anchor
    </button>
  )}
</div>
```

Keep the existing read-only `instruction` text **only** if `behaviorAnchors` is empty AND `instruction` is non-empty (legacy display). Otherwise omit.

- [ ] **Step 3: Type-check / build**

Run: `pnpm -C packages/frontend build`
Expected: PASS.

- [ ] **Step 4: Smoke-test**

Open a scenario in the edit modal. Confirm:
- Add/remove anchor works.
- Save persists anchors.
- Re-opening shows the saved anchors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/EditScenarioModal.tsx
git commit -m "feat(frontend): EditScenarioModal swaps instruction textarea for behavior-anchor editor"
```

---

## Task 15: End-to-end verification & deploy

**Files:**
- No code changes — this task is operational verification.

- [ ] **Step 1: Run all backend tests**

Run: `pnpm -C packages/backend test`
Expected: ALL PASS.

- [ ] **Step 2: Type-check entire project**

Run:
```bash
pnpm -C packages/backend typecheck
pnpm -C packages/frontend build
```
Expected: PASS.

- [ ] **Step 3: Deploy schema and code to dev Convex**

Run: `cd packages/backend && npx convex dev --once`
Expected: Successful deploy with no schema validation errors.

- [ ] **Step 4: Run backfill on dev**

In the Convex dev dashboard → Functions panel:

1. Run `internal.conversationSim.migrations.backfillGrounded` with `{}`. Loop on `continueCursor` until `isDone: true`. Note total `migrated` count.
2. Run `internal.conversationSim.migrationsActions.backfillBehaviorAnchors` with `{}`. Loop until done.
3. Run `internal.conversationSim.migrationsActions.backfillSynthetic` with `{}`. Loop until done.

- [ ] **Step 5: Spot-check backfilled data**

In the Convex dev dashboard → Data → `conversationScenarios`:

- Pick 2 grounded scenarios. Confirm `referenceTranscript` populated, `userMessageLengthStats` set, `behaviorAnchors` array of 3-6 strings.
- Pick 2 synthetic scenarios. Confirm `referenceExemplars` populated with up to 8 entries each having `sourceTranscriptId` + `messages`, `behaviorAnchors` populated, `userMessageLengthStats` set.

- [ ] **Step 6: Run a simulation and visually verify**

In the frontend (`pnpm dev`):

1. Open Agents page → Experiment mode → pick an existing simulation or create a new one for an existing scenario.
2. Open the side-by-side view (the one in the screenshot).
3. Visually confirm:
   - Simulated user's later messages are short (~ matching `userMessageLengthStats.median`).
   - The simulator answers questions with fragments, not paragraphs.
   - Turn 0 still uses the verbatim grounded opener.
   - The simulator emits `###STOP###` when its goal is met.
4. Repeat for 3-5 grounded scenarios with different transcript styles (intents, languages, verbosity).
5. Repeat for 2-3 synthetic scenarios.

If verbosity has not collapsed:
- Check the snapshot test passed and the prompt structure matches what the design specified.
- Check the few-shot block contains 5+ example pairs.
- Check `userMessageLengthStats` is present in the prompt.
- If all of the above are correct and verbosity remains, escalate to layering in Option B (few-shot as message-history prefix) — but do not do that in this PR.

- [ ] **Step 7: Confirm `ScenarioFields` displays correctly**

Open a backfilled grounded scenario in the dataset page. Confirm:
- "How this user speaks" shows behavior-anchor bullets.
- "Typical length" badge shows median/p90 numbers.
- "View source transcript →" link visible.

Open a backfilled synthetic scenario. Confirm:
- Behavior anchors visible.
- "Style exemplars (N)" collapsible visible with provenance links.

- [ ] **Step 8: Confirm `EditScenarioModal` works**

Open a scenario for edit. Add a behavior anchor. Save. Re-open. Confirm persistence.

- [ ] **Step 9: Final commit (if any frontend tweaks were needed)**

```bash
git status
# if any uncommitted changes:
git add .
git commit -m "fix(frontend): resolve smoke-test issue from manual verification"
```

- [ ] **Step 10: Deploy to production (when dev verification is clean)**

Run: `pnpm -C packages/backend deploy` (or your standard prod deploy command).

Then in the Convex prod dashboard:
1. Run `backfillGrounded` with `{}` → loop until done.
2. Run `backfillBehaviorAnchors` with `{}` → loop until done.
3. Run `backfillSynthetic` with `{}` → loop until done.
4. Spot-check 2-3 prod scenarios in Data tab — confirm fields populated.

Definition of done is met when:
- All automated tests pass.
- Dev backfill complete + visual verification on 5+ grounded + 2+ synthetic.
- Prod deploy + prod backfill complete + spot-check passes.

---

## Self-Review Notes

**Spec coverage check:** Each spec section maps to plan tasks:
- Schema → Task 3
- Generation pipeline (grounded) → Task 7
- Generation pipeline (synthetic) → Task 8
- Simulator prompt redesign → Tasks 1, 2, 5, 6
- Backfill (3 functions) → Tasks 9, 10, 11
- UI implications → Tasks 12, 13, 14
- Tests → covered inline within each task; integration tests in Tasks 9-11

**Type consistency check:** `Message` type matches `messageValidator` in schema. `Exemplar` matches `referenceExemplars` element shape. `extractExamples` signature consistent across Tasks 2 and 5.

**No placeholders:** Each step has full code or full command. No "implement later", "TBD", or unspecified error handling.
