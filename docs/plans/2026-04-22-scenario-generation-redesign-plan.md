# Scenario Generation Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the minimal scenario generation wizard with a 4-step transcript-grounded hybrid system that generates realistic conversation scenarios from live chat transcripts + KB documents.

**Architecture:** Two-phase pipeline — Phase 1 analyzes transcript corpus, Phase 2 runs two tracks (grounded from individual transcripts, synthetic from patterns + KB). Frontend is a 4-step wizard reusing existing component patterns. Backend extends the existing WorkPool-based generation system.

**Tech Stack:** Next.js 16 + Tailwind CSS v4 (dark theme), Convex backend (TypeScript), Claude API for LLM calls, existing livechat data model.

**Design doc:** `docs/plans/2026-04-22-scenario-generation-redesign-design.md`

---

## Task 1: Schema — Widen `conversationScenarios` and `scenarioGenJobs`

**Files:**
- Modify: `packages/backend/convex/schema.ts:659-682` (conversationScenarios)
- Modify: `packages/backend/convex/schema.ts:789-807` (scenarioGenJobs)

**Step 1: Add new fields to `conversationScenarios`**

At line 680 (before the closing of the table definition), add:

```typescript
// After the existing `referenceMessages` field:
sourceType: v.union(v.literal("transcript_grounded"), v.literal("synthetic")),
sourceTranscriptId: v.optional(v.id("livechatConversations")),
languages: v.array(v.string()),
```

These are required fields — existing scenarios won't have them. We need to make them optional for backward compatibility, then backfill. Actually, since the generation always creates new scenarios and never reads old ones without a dataset filter, we can make `sourceType` optional for now:

```typescript
sourceType: v.optional(v.union(v.literal("transcript_grounded"), v.literal("synthetic"))),
sourceTranscriptId: v.optional(v.id("livechatConversations")),
languages: v.optional(v.array(v.string())),
```

**Step 2: Expand `scenarioGenJobs` config**

The current `startGeneration` mutation (generation.ts:20-31) accepts `count`, `complexityDistribution`, and optional `model`. We need to expand the stored config. In schema.ts, the scenarioGenJobs table stores `targetCount`, `generatedCount`, `status`, etc. but doesn't store the full config object — the config is passed directly to the action args.

We need to add config storage fields to `scenarioGenJobs` at line 797:

```typescript
// After existing fields, before indexes:
transcriptUploadIds: v.optional(v.array(v.id("livechatUploads"))),
transcriptConversationIds: v.optional(v.array(v.id("livechatConversations"))),
distribution: v.optional(v.number()),  // 0-100, % transcript-grounded
fidelity: v.optional(v.number()),      // 0-100, high = faithful
```

**Step 3: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Schema deploys successfully (all new fields are optional, backward compatible).

**Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(schema): add sourceType, sourceTranscriptId, languages to scenarios; expand scenarioGenJobs config"
```

---

## Task 2: Backend — Livechat query endpoints for the wizard

**Files:**
- Modify: `packages/backend/convex/livechat/orchestration.ts:382-472`

The wizard needs to fetch available transcript sets and their conversations. The existing queries are:
- `list` (line 382) — lists `livechatUploads` for org
- `listConversations` (line 407) — paginated conversations for an upload
- `getClassificationCounts` (line 435) — classification stats

These are already public queries with auth. We need to verify they return enough data for the wizard's filters (labels, classification status, message count). If they do, no backend changes needed — just wire them up in the frontend.

**Step 1: Read and verify existing queries**

Read `packages/backend/convex/livechat/orchestration.ts:382-472` and confirm:
- `list` returns uploads with `filename`, `conversationCount`, `status`, `basicStats`
- `listConversations` returns conversations with `visitorName`, `conversationId`, `labels`, `classificationStatus`, `messageTypes`, `messages` (for count)

**Step 2: Add a lightweight conversation list query (if needed)**

If `listConversations` uses pagination and returns full message arrays (heavy), create a lightweight query for the wizard that returns only the fields needed for selection:

```typescript
// In livechat/orchestration.ts
export const listConversationsSummary = query({
  args: {
    uploadIds: v.array(v.id("livechatUploads")),
  },
  handler: async (ctx, { uploadIds }) => {
    const { orgId } = await getAuthContext(ctx);
    const results = [];
    for (const uploadId of uploadIds) {
      const convos = await ctx.db
        .query("livechatConversations")
        .withIndex("by_upload", (q) => q.eq("uploadId", uploadId))
        .collect();
      for (const c of convos) {
        if (c.orgId !== orgId) continue;
        results.push({
          _id: c._id,
          uploadId: c.uploadId,
          conversationId: c.conversationId,
          visitorName: c.visitorName,
          labels: c.labels,
          classificationStatus: c.classificationStatus,
          messageTypes: c.messageTypes?.map((mt) => mt.type) ?? [],
          messageCount: c.messages.filter((m) => m.role !== "workflow_input").length,
          hasUserMessages: c.messages.some((m) => m.role === "user"),
          hasAgentMessages: c.messages.some((m) => m.role === "human_agent"),
        });
      }
    }
    return results;
  },
});
```

**Note on `.collect()`:** For large uploads (1000+ conversations), `.collect()` could be expensive. The wizard is an infrequent operation (user configuring generation), not a hot path, so this is acceptable. If performance becomes an issue later, add pagination.

**Step 3: Add internal query for fetching full conversation data**

The generation action needs to load full transcript data for each selected conversation. Add:

```typescript
export const getConversationInternal = internalQuery({
  args: { id: v.id("livechatConversations") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});
```

**Step 4: Verify `internal.crud.documents.listByKB` exists**

The generation action uses this to load KB docs. Check `packages/backend/convex/crud/documents.ts` for an internal query that lists documents by kbId. If it doesn't exist, add one.

**Step 5: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`

**Step 6: Commit**

```bash
git add packages/backend/convex/livechat/orchestration.ts
git commit -m "feat(livechat): add listConversationsSummary and getConversationInternal queries for scenario wizard"
```

---

## Task 3: Backend — Expand `startGeneration` mutation

**Files:**
- Modify: `packages/backend/convex/conversationSim/generation.ts:19-90`

**Step 1: Expand args for `startGeneration`**

The current mutation (line 19) accepts `datasetId`, `count`, `complexityDistribution`, and optional `model`. Add the new config fields:

```typescript
export const startGeneration = mutation({
  args: {
    datasetId: v.id("datasets"),
    count: v.number(),
    complexityDistribution: v.object({
      low: v.number(),
      medium: v.number(),
      high: v.number(),
    }),
    model: v.optional(v.string()),
    // New fields
    transcriptUploadIds: v.optional(v.array(v.id("livechatUploads"))),
    transcriptConversationIds: v.optional(v.array(v.id("livechatConversations"))),
    distribution: v.optional(v.number()),
    fidelity: v.optional(v.number()),
    kbId: v.optional(v.id("knowledgeBases")),
  },
  // ...handler passes all args through to the action
});
```

**Step 2: Store new fields in `scenarioGenJobs` record**

In the handler (around line 65 where the job record is created), add the new fields:

```typescript
const jobId = await ctx.db.insert("scenarioGenJobs", {
  orgId,
  kbId: args.kbId ?? kbId, // kbId from dataset or explicit
  datasetId: args.datasetId,
  status: "pending",
  targetCount: args.count,
  generatedCount: 0,
  createdAt: Date.now(),
  // New fields
  transcriptUploadIds: args.transcriptUploadIds,
  transcriptConversationIds: args.transcriptConversationIds,
  distribution: args.distribution,
  fidelity: args.fidelity,
});
```

**Step 3: Pass new config to the WorkPool action**

Update the action enqueue call to pass the expanded config:

```typescript
await pool.enqueueAction(
  ctx,
  internal.conversationSim.generationActions.generateScenarios,
  {
    datasetId: args.datasetId,
    kbId: args.kbId ?? kbId,
    orgId,
    jobId,
    config: {
      count: args.count,
      model: args.model,
      complexityDistribution: args.complexityDistribution,
      transcriptConversationIds: args.transcriptConversationIds,
      distribution: args.distribution ?? 0, // 0 = fully synthetic if no transcripts
      fidelity: args.fidelity ?? 100,
    },
  },
  // ...callbacks unchanged
);
```

**Step 4: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`

**Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/generation.ts
git commit -m "feat(generation): expand startGeneration to accept transcript and distribution config"
```

---

## Task 4: Backend — Rewrite `generateScenarios` action (Two-Phase Pipeline)

**Files:**
- Modify: `packages/backend/convex/conversationSim/generationActions.ts:9-202`
- Modify: `packages/backend/convex/conversationSim/scenarios.ts:136-144` (createInternal)

This is the core algorithm change. The current action does: load KB docs → discover dimensions → batch generate. The new action does: load transcripts → analyze corpus → grounded track + synthetic track.

**Step 1: Update action args to include new config**

At line 10, expand the args:

```typescript
args: {
  datasetId: v.id("datasets"),
  kbId: v.id("knowledgeBases"),
  orgId: v.string(),
  jobId: v.id("scenarioGenJobs"),
  config: v.object({
    count: v.number(),
    model: v.optional(v.string()),
    complexityDistribution: v.object({
      low: v.number(),
      medium: v.number(),
      high: v.number(),
    }),
    transcriptConversationIds: v.optional(v.array(v.id("livechatConversations"))),
    distribution: v.number(),       // 0-100
    fidelity: v.number(),           // 0-100
  }),
},
```

**Step 2: Implement the two-phase pipeline**

Replace the handler body. High-level structure:

```typescript
handler: async (ctx, args) => {
  const { config } = args;
  const model = config.model ?? "claude-sonnet-4-20250514";

  const startTime = Date.now();
  const TIMEOUT_SAFETY_MS = 8 * 60 * 1000; // Stop batching at 8 minutes

  // 1. Calculate split
  const hasTranscripts = (config.transcriptConversationIds?.length ?? 0) > 0;
  const groundedPct = hasTranscripts ? config.distribution : 0;
  const groundedCount = Math.round((config.count * groundedPct) / 100);
  const syntheticCount = config.count - groundedCount;

  // 2. Load transcripts (if any)
  let transcripts = [];
  if (hasTranscripts) {
    transcripts = await Promise.all(
      config.transcriptConversationIds!.map((id) =>
        ctx.runQuery(internal.livechat.orchestration.getConversationInternal, { id })
      )
    );
    transcripts = transcripts.filter(Boolean);
  }

  // 3. Load KB docs (for synthetic track)
  const docs = await ctx.runQuery(internal.crud.documents.listByKB, { kbId: args.kbId });
  const kbContent = docs.slice(0, 20).map((d) => ({
    title: d.title,
    content: (d.content ?? "").slice(0, 2000),
  }));

  // 4. Distribute complexity
  const complexities = distributeComplexity(config.count, config.complexityDistribution);

  let generated = 0;

  // ─── PHASE 1: Transcript Analysis ───
  let transcriptProfile = null;
  if (transcripts.length > 0) {
    try {
      transcriptProfile = await analyzeTranscriptCorpus(transcripts, model);
    } catch (e) {
      console.error("Transcript analysis failed, falling back to synthetic-only:", e);
      // Fall back: treat as no transcripts
    }
  }

  // ─── PHASE 2a: Grounded Track ───
  if (groundedCount > 0 && transcripts.length > 0 && transcriptProfile) {
    // Sample or expand transcripts to match groundedCount
    // If more transcripts than needed: round-robin across persona clusters for diversity
    // If fewer transcripts than needed: generate multiple scenarios per transcript
    const sampled = sampleTranscripts(transcripts, groundedCount, transcriptProfile);
    const groundedComplexities = complexities.splice(0, sampled.length);

    // Process in batches of 5
    for (let i = 0; i < sampled.length; i += 5) {
      if (Date.now() - startTime > TIMEOUT_SAFETY_MS) break; // Safety timeout
      const batch = sampled.slice(i, i + 5);
      const batchComplexities = groundedComplexities.slice(i, i + 5);
      try {
        const scenarios = await generateGroundedScenarios(batch, batchComplexities, config.fidelity, model);

        for (const scenario of scenarios) {
          await ctx.runMutation(internal.conversationSim.scenarios.createInternal, {
            datasetId: args.datasetId,
            orgId: args.orgId,
            ...scenario,
            sourceType: "transcript_grounded",
            sourceTranscriptId: scenario._sourceTranscriptId,
            languages: scenario._languages ?? [],
          });
          generated++;
        }
      } catch (e) {
        console.error(`Grounded batch ${i / 5 + 1} failed, skipping:`, e);
      }
      await ctx.runMutation(internal.conversationSim.generation.updateProgress, {
        jobId: args.jobId, generatedCount: generated,
      });
    }
  }

  // ─── PHASE 2b: Synthetic Track ───
  if (syntheticCount > 0) {
    const syntheticComplexities = complexities; // remaining after grounded
    for (let i = 0; i < syntheticCount; i += 5) {
      if (Date.now() - startTime > TIMEOUT_SAFETY_MS) break; // Safety timeout
      const batchCount = Math.min(5, syntheticCount - i);
      const batchComplexities = syntheticComplexities.slice(i, i + batchCount);
      try {
        const scenarios = await generateSyntheticScenarios(
          transcriptProfile, kbContent, batchComplexities, model
        );

        for (const scenario of scenarios) {
          await ctx.runMutation(internal.conversationSim.scenarios.createInternal, {
            datasetId: args.datasetId,
            orgId: args.orgId,
            ...scenario,
            sourceType: "synthetic",
            languages: scenario._languages ?? [],
          });
          generated++;
        }
      } catch (e) {
        console.error(`Synthetic batch ${i / 5 + 1} failed, skipping:`, e);
      }
      await ctx.runMutation(internal.conversationSim.generation.updateProgress, {
        jobId: args.jobId, generatedCount: generated,
      });
    }
  }

  // 5. Update dataset scenario count
  await ctx.runMutation(internal.crud.datasets.updateScenarioCount, {
    datasetId: args.datasetId,
    scenarioCount: generated,
  });

  return { generated };
},
```

**Step 3: Implement helper functions**

Add these functions in the same file (above the action).

**Important:** The existing `generationActions.ts` imports and uses an Anthropic/OpenAI client for LLM calls. Reuse the same pattern — look at how the current dimension discovery and scenario generation calls are made (lines 47-67 and 94-131). The `callLLM` and `extractJSON` below are pseudocode — replace with the actual client pattern from the existing file. The existing code uses `generateText` from the AI SDK or direct Anthropic client calls.

**Type definition needed:**
```typescript
interface TranscriptProfile {
  personaClusters: string[];
  commonIntents: string[];
  topicDistribution: string[];
  conversationPatterns: string[];
  languagesUsed: string[];
}
```

**Note:** `distributeComplexity` already exists in the current file — reuse it as-is.

```typescript
// Analyze transcript corpus — single LLM call
async function analyzeTranscriptCorpus(
  transcripts: Array<{ messages: Array<{ role: string; text: string }>; labels: string[]; visitorName: string }>,
  model: string,
): Promise<TranscriptProfile> {
  // Build a summary of all transcripts (truncated)
  const summaries = transcripts.slice(0, 30).map((t, i) => {
    const userMsgs = t.messages.filter((m) => m.role === "user").map((m) => m.text).join(" | ");
    const agentMsgs = t.messages.filter((m) => m.role === "human_agent").map((m) => m.text).join(" | ");
    return `Conversation ${i + 1} [labels: ${t.labels.join(", ")}]:\n  User: ${userMsgs.slice(0, 300)}\n  Agent: ${agentMsgs.slice(0, 300)}`;
  }).join("\n\n");

  const response = await callLLM({
    model,
    temperature: 0.3,
    system: "You analyze customer support conversation transcripts to identify patterns and dimensions.",
    prompt: `Analyze these ${transcripts.length} conversation transcripts and identify patterns:\n\n${summaries}\n\nReturn a JSON object:\n{\n  "personaClusters": ["description of each user persona type seen"],\n  "commonIntents": ["what users are trying to accomplish"],\n  "topicDistribution": ["topics that appear and rough frequency"],\n  "conversationPatterns": ["typical conversation arcs/flows"],\n  "languagesUsed": ["languages detected"]\n}\n\nRespond ONLY with JSON.`,
  });

  return JSON.parse(extractJSON(response));
}

// Generate grounded scenarios from individual transcripts
async function generateGroundedScenarios(
  transcripts: Array<any>,
  complexities: string[],
  fidelity: number,
  model: string,
): Promise<Array<any>> {
  const transcriptTexts = transcripts.map((t, i) => {
    const msgs = t.messages
      .filter((m: any) => m.role !== "workflow_input")
      .map((m: any) => `${m.role === "user" ? "User" : "Agent"}: ${m.text}`)
      .join("\n");
    return `--- Transcript ${i + 1} [complexity: ${complexities[i]}] ---\n${msgs}`;
  }).join("\n\n");

  const fidelityInstruction = fidelity >= 80
    ? "Stay very close to the original conversation. Preserve the user's actual language, intent, and communication style. Reference messages should be near-verbatim from the original."
    : fidelity >= 50
      ? "Capture the essence of the conversation but allow moderate variation in phrasing and details. Keep the same intent and persona type."
      : "Use the conversation as loose inspiration. Keep the general topic and intent but create a distinct variation with different details.";

  const response = await callLLM({
    model,
    temperature: 0.5,
    system: "You create conversation simulation scenarios from real customer support transcripts.",
    prompt: `Convert each transcript into a scenario configuration for simulating similar conversations.\n\nFidelity instruction: ${fidelityInstruction}\n\n${transcriptTexts}\n\nFor each transcript, return a JSON array of scenario objects:\n[\n  {\n    "persona": { "type": "string", "traits": ["..."], "communicationStyle": "string", "patienceLevel": "low|medium|high" },\n    "topic": "string",\n    "intent": "string",\n    "complexity": "low|medium|high",\n    "reasonForContact": "string",\n    "knownInfo": "string",\n    "unknownInfo": "string",\n    "instruction": "detailed 2-3 paragraph instruction for LLM user-simulator",\n    "referenceMessages": [{ "role": "user", "content": "actual user message from transcript", "turnIndex": 0 }],\n    "languages": ["detected languages"],\n    "_sourceIndex": 0\n  }\n]\n\nInclude 1-3 reference messages per scenario, selected from the most substantive user messages. Respond ONLY with JSON array.`,
  });

  const parsed = JSON.parse(extractJSON(response));
  // Map _sourceIndex back to sourceTranscriptId
  return parsed.map((s: any) => ({
    ...s,
    _sourceTranscriptId: transcripts[s._sourceIndex]?._id,
    _languages: s.languages,
  }));
}

// Sample or expand transcripts to match target count
// If more transcripts than needed: round-robin across persona clusters for diversity
// If fewer transcripts than needed: duplicate transcripts (each will produce a variation)
function sampleTranscripts(
  transcripts: Array<any>,
  targetCount: number,
  profile: TranscriptProfile,
): Array<any> {
  if (transcripts.length === targetCount) return transcripts;

  if (transcripts.length > targetCount) {
    // Diverse sampling: shuffle and take targetCount
    // TODO: When profile has persona clusters, round-robin across them
    const shuffled = [...transcripts].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, targetCount);
  }

  // Fewer transcripts than needed: repeat transcripts cyclically
  const result = [];
  for (let i = 0; i < targetCount; i++) {
    result.push(transcripts[i % transcripts.length]);
  }
  return result;
}

// Generate synthetic scenarios from transcript profile + KB
async function generateSyntheticScenarios(
  transcriptProfile: TranscriptProfile | null,
  kbContent: Array<{ title: string; content: string }>,
  complexities: string[],
  model: string,
): Promise<Array<any>> {
  const profileSection = transcriptProfile
    ? `Transcript analysis (patterns from real conversations):\n${JSON.stringify(transcriptProfile, null, 2)}`
    : "No transcript data available.";

  const kbSection = kbContent.length > 0
    ? `Knowledge base content:\n${kbContent.map((d) => `[${d.title}]: ${d.content}`).join("\n\n")}`
    : "No knowledge base content available.";

  const response = await callLLM({
    model,
    temperature: 0.7,
    system: "You generate realistic customer support conversation scenarios. Create scenarios that cover gaps and combinations not seen in existing data.",
    prompt: `${profileSection}\n\n${kbSection}\n\nGenerate exactly ${complexities.length} NEW conversation scenarios that complement existing patterns. Cover topics, intents, or persona types that are underrepresented.\n\nComplexity levels: ${JSON.stringify(complexities)}\n\nReturn a JSON array:\n[\n  {\n    "persona": { "type": "string", "traits": ["..."], "communicationStyle": "string", "patienceLevel": "low|medium|high" },\n    "topic": "string",\n    "intent": "string",\n    "complexity": "low|medium|high",\n    "reasonForContact": "string",\n    "knownInfo": "string",\n    "unknownInfo": "string",\n    "instruction": "detailed 2-3 paragraph instruction for LLM user-simulator",\n    "languages": ["english"]\n  }\n]\n\nRespond ONLY with JSON array.`,
  });

  const parsed = JSON.parse(extractJSON(response));
  return parsed.map((s: any) => ({ ...s, _languages: s.languages }));
}
```

**Step 4: Update `createInternal` in scenarios.ts**

At line 136, expand the args to accept the new fields:

```typescript
export const createInternal = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    orgId: v.string(),
    persona: v.object({ /* existing */ }),
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
    // New fields
    sourceType: v.optional(v.union(v.literal("transcript_grounded"), v.literal("synthetic"))),
    sourceTranscriptId: v.optional(v.id("livechatConversations")),
    languages: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversationScenarios", args);
  },
});
```

**Step 5: Deploy and test**

Note: `getConversationInternal` was already added in Task 2.

Run: `cd packages/backend && npx convex dev --once`

**Step 6: Commit**

```bash
git add packages/backend/convex/conversationSim/generationActions.ts packages/backend/convex/conversationSim/scenarios.ts
git commit -m "feat(generation): two-phase pipeline with grounded and synthetic tracks"
```

---

## Task 5: Frontend — Build the 4-step Scenario Generation Wizard

**Files:**
- Replace: `packages/frontend/src/components/ScenarioGenerationWizard.tsx` (218 lines → full rewrite)

This is the largest frontend task. Rewrite the wizard as a 4-step flow matching the approved mockup.

**Prerequisites:** Tasks 1-3 must be deployed so the frontend can call expanded APIs.

**API imports needed:**
```typescript
import { api } from "@/lib/convex";
// Queries:
//   api.livechat.orchestration.list — transcript sets
//   api.livechat.orchestration.listConversationsSummary — conversations for selected sets
// Mutations:
//   api.crud.datasets.createSimDataset — create dataset
//   api.conversationSim.generation.startGeneration — start generation (expanded args)
```

**TypeScript interface updates:** The `Scenario` interface used in `ScenarioList.tsx`, `ScenarioDetail.tsx`, and `EditScenarioModal.tsx` needs the new optional fields:
```typescript
sourceType?: "transcript_grounded" | "synthetic";
sourceTranscriptId?: Id<"livechatConversations">;
languages?: string[];
```
These components get their data from Convex queries which will automatically include the new fields once schema is deployed.

**Step 1: Scaffold the wizard shell with stepper**

Replace `ScenarioGenerationWizard.tsx` with the 4-step structure. Use the same stepper pattern from `GenerationWizard.tsx`:

```typescript
const STEPS = ["Transcripts", "Configure", "Preferences", "Review"] as const;

// State
const [step, setStep] = useState(0);

// Stepper UI (copy pattern from GenerationWizard.tsx)
<div className="flex items-stretch gap-2 mb-6">
  {STEPS.map((label, i) => {
    const state = i === step ? "active" : i < step ? "done" : "pending";
    return (
      <button key={label} onClick={() => i < step && setStep(i)}
        className="flex-1 flex flex-col items-stretch gap-1.5 group">
        <div className={`h-[3px] rounded-sm transition-colors ${
          state === "active" ? "bg-accent"
          : state === "done" ? "bg-accent-dim"
          : "bg-border group-hover:bg-border-bright"
        }`} />
        <span className={`text-[10px] text-center transition-colors ${
          state === "active" || state === "done" ? "text-accent" : "text-text-dim"
        }`}>{label}</span>
      </button>
    );
  })}
</div>
```

**Step 2: Implement Step 1 — Transcript Selection**

Query hooks needed:
- `useQuery(api.livechat.orchestration.list)` — list transcript sets
- `useQuery(api.livechat.orchestration.listConversationsSummary, { uploadIds })` — list conversations for selected transcript sets

State:
```typescript
const [selectedUploadIds, setSelectedUploadIds] = useState<Id<"livechatUploads">[]>([]);
const [selectedConvIds, setSelectedConvIds] = useState<Set<Id<"livechatConversations">>>(new Set());
const [filters, setFilters] = useState({ quality: "has_responses", classification: "all", labels: "all" });
```

UI: Transcript set cards (selected/unselected), filter chips, conversation table with checkboxes. Use the same checkbox pattern from `ConversationList.tsx` (`accent-accent` class). Tags use the chip pattern from `ScenarioList.tsx`.

Navigation: "Skip" link + "Next" button.

Edge cases:
- If no transcript sets exist: show message "No conversation transcripts available. You can upload transcripts in the Knowledge Base section, or skip to generate synthetic scenarios."
- When multiple transcript sets selected: merge all conversations into one list, sorted by conversation ID
- Conversation list should show which transcript set each conversation belongs to (subtle text or grouping)

**Step 3: Implement Step 2 — Configure**

State:
```typescript
const [count, setCount] = useState(10);
const [distribution, setDistribution] = useState(80); // % grounded
const [fidelity, setFidelity] = useState(100); // max faithful
const [lowPct, setLowPct] = useState(30);
const [medPct, setMedPct] = useState(50);
const [highPct, setHighPct] = useState(20);
```

UI: Reuse `TotalQuestionsSlider` pattern for count. Distribution slider with calculated split display. Fidelity slider. Complexity distribution with `adjustDistribution` function (copy from existing `ScenarioGenerationWizard.tsx:63-90`).

If step 1 was skipped: lock distribution to 0% grounded, disable fidelity slider.

**Step 4: Implement Step 3 — Preferences & KB**

State:
```typescript
const [model, setModel] = useState("claude-sonnet-4-20250514");
```

KB is already selected at the page level (passed as prop `kbId`). Show it as read-only display. Model dropdown. Placeholder for future preferences.

Validation: if no transcripts AND no kbId, show inline warning: "Select a knowledge base to generate synthetic scenarios, or go back and select transcripts." Generate button disabled until at least one source is provided.

**Step 5: Implement Step 4 — Review & Generate**

UI: Summary cards in 3x2 grid (reuse `SummaryCard` pattern from `WizardStepReview.tsx`). Each card has "Edit" link that calls `setStep(N)`. Dataset name input. Generate button.

On generate:
```typescript
async function handleGenerate() {
  const datasetId = await createSimDataset({ kbId, name });
  await startGeneration({
    datasetId,
    count,
    complexityDistribution: { low: lowPct / 100, medium: medPct / 100, high: highPct / 100 },
    model,
    transcriptUploadIds: selectedUploadIds.length > 0 ? selectedUploadIds : undefined,
    transcriptConversationIds: selectedConvIds.size > 0 ? [...selectedConvIds] : undefined,
    distribution: selectedConvIds.size > 0 ? distribution : 0,
    fidelity: selectedConvIds.size > 0 ? fidelity : 100,
    kbId,
  });
  onGenerated(datasetId);
}
```

**Step 6: Test manually**

1. Start frontend: `pnpm dev`
2. Start backend: `pnpm dev:backend`
3. Navigate to a conversation_sim dataset page
4. Open the wizard, test all 4 steps
5. Test with transcripts selected and without (skip)
6. Verify generation starts and progress updates

**Step 7: Commit**

```bash
git add packages/frontend/src/components/ScenarioGenerationWizard.tsx
git commit -m "feat(frontend): 4-step scenario generation wizard with transcript selection"
```

---

## Task 6: Frontend — Update ScenarioList, ScenarioDetail, and EditScenarioModal for new fields

**Files:**
- Modify: `packages/frontend/src/components/ScenarioList.tsx`
- Modify: `packages/frontend/src/components/ScenarioDetail.tsx`
- Modify: `packages/frontend/src/components/EditScenarioModal.tsx`

**Step 1: Add source type indicator to ScenarioList**

In the tags section of each scenario row, add a source type badge:

```tsx
{/* Source type badge */}
{scenario.sourceType && (
  <span className={`px-1.5 py-0.5 text-[9px] rounded border ${
    scenario.sourceType === "transcript_grounded"
      ? "bg-green-500/15 text-green-400 border-green-500/20"
      : "bg-purple-500/15 text-purple-400 border-purple-500/20"
  }`}>
    {scenario.sourceType === "transcript_grounded" ? "grounded" : "synthetic"}
  </span>
)}
```

**Step 2: Add source info to ScenarioDetail**

Add a new section after Persona showing source type, linked transcript ID (if grounded), and languages:

```tsx
{/* Source section */}
<section>
  <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Source</h3>
  <div className="flex flex-wrap gap-1.5">
    {scenario.sourceType && (
      <Chip color={scenario.sourceType === "transcript_grounded" ? "green" : "purple"}>
        {scenario.sourceType === "transcript_grounded" ? "Transcript-grounded" : "Synthetic"}
      </Chip>
    )}
    {scenario.languages?.map((lang, i) => (
      <Chip key={i} color="blue">{lang}</Chip>
    ))}
  </div>
  {scenario.sourceTranscriptId && (
    <p className="text-xs text-text-dim mt-2">
      Source transcript: <span className="text-text-muted font-mono">{scenario.sourceTranscriptId}</span>
    </p>
  )}
</section>
```

**Step 3: Add read-only provenance fields to EditScenarioModal**

In `EditScenarioModal.tsx`, add a read-only section in the header area (after the ID badge):

```tsx
{/* Provenance (read-only) */}
{scenario.sourceType && (
  <div className="flex items-center gap-2 ml-2">
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
      scenario.sourceType === "transcript_grounded"
        ? "bg-green-500/15 text-green-400"
        : "bg-purple-500/15 text-purple-400"
    }`}>
      {scenario.sourceType === "transcript_grounded" ? "grounded" : "synthetic"}
    </span>
    {scenario.languages?.map((lang, i) => (
      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
        {lang}
      </span>
    ))}
  </div>
)}
```

These fields are not editable — they are provenance metadata set during generation.

**Step 4: Commit**

```bash
git add packages/frontend/src/components/ScenarioList.tsx packages/frontend/src/components/ScenarioDetail.tsx packages/frontend/src/components/EditScenarioModal.tsx
git commit -m "feat(frontend): display sourceType, languages, and transcript link in scenario views"
```

---

## Task 7: Integration Testing

**Files:**
- Create: `packages/backend/tests/scenarioGeneration.test.ts`
- Reference: `packages/backend/tests/helpers.ts` (shared test helpers)

**Step 1: Test schema backward compatibility**

Verify existing scenarios (without new fields) still load and query correctly:

```typescript
test("existing scenarios without new fields still work", async () => {
  const t = await setupTest();
  // Seed a scenario without sourceType/languages
  const scenarioId = await t.run(async (ctx) => {
    return ctx.db.insert("conversationScenarios", {
      datasetId, orgId,
      persona: { type: "test", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
      topic: "test", intent: "test", complexity: "low",
      reasonForContact: "test", knownInfo: "test", unknownInfo: "test", instruction: "test",
      // No sourceType, sourceTranscriptId, or languages
    });
  });
  const scenario = await t.run(async (ctx) => ctx.db.get(scenarioId));
  expect(scenario).toBeDefined();
  expect(scenario!.sourceType).toBeUndefined();
});
```

**Step 2: Test startGeneration with expanded config**

```typescript
test("startGeneration accepts transcript config", async () => {
  const t = await setupTest();
  // Seed KB, dataset, and a livechat upload + conversation
  // Call startGeneration with transcriptConversationIds, distribution, fidelity
  // Verify job record has the new fields stored
});
```

**Step 3: Test startGeneration without transcripts (backward compat)**

```typescript
test("startGeneration works without transcript fields", async () => {
  const t = await setupTest();
  // Call startGeneration with only the original fields (count, complexityDistribution)
  // Verify job is created and action is enqueued
});
```

**Step 4: Commit**

```bash
git add packages/backend/tests/scenarioGeneration.test.ts
git commit -m "test: scenario generation with expanded config and backward compatibility"
```

---

## Task Order & Dependencies

```
Task 1 (Schema) ───────────────────┐
                                    │
Task 2 (Livechat queries) ─────────┼── Task 5 (Frontend wizard)
                                    │     │
Task 3 (startGeneration expand) ───┘     │
                                          ├── Task 6 (List/Detail/Modal updates)
Task 4 (generateScenarios rewrite) ──────┘
                                    
Task 7 (Integration tests) ── runs after Tasks 1-4
```

**Execution order:**
- Tasks 1 → 2 → 3: Sequential backend, must deploy before frontend can wire up
- Task 4: Can run in parallel with Task 5 (backend action rewrite is independent of frontend)
- Task 5: Largest task. Can be split into sub-commits per wizard step during execution.
- Task 6: Small follow-up after Task 5
- Task 7: Backend tests, can start after Tasks 1-4 (doesn't need frontend)
