# Conversation Simulation System Design

**Date:** 2026-04-21
**Branch:** `va_enduser_convo_simulation`
**Status:** Draft

## Overview

A system for generating, editing, and running realistic end-user conversation simulations against AI agents configured in our platform. Simulations evaluate agent quality by replaying diverse user scenarios with an LLM-powered user simulator, then scoring results with customizable evaluators.

This is an evolution of the dataset module. Where question datasets evaluate retriever quality (single question → character span ground truth), conversation simulation datasets evaluate agent quality (multi-turn scenario → evaluator-based scoring).

## Goals

- Simulate realistic multi-turn conversations between end-users and AI agents
- Support diverse user personas, topics, intents, and complexity levels
- Ground simulations in real conversation data when available (live chat transcripts)
- Provide customizable, reliable evaluation through first-class evaluator entities
- Enable iterative improvement: generate → run → review → refine → re-run

## Non-Goals (this branch)

- Error analysis UI and evaluator builder from coded patterns (next branch)
- Collaborative annotation / inter-annotator agreement
- External API agent support (Option C black-box agents)
- Cohort-level distribution controls
- Mock environment / mock tools (Tau2-style)

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Ground truth format | Layered evaluators (code + LLM judge), binary pass/fail | Aligns with Hamel/Shreya methodology; reliable and composable |
| Simulation config format | Structured metadata + instruction string | Editable fields for UI, prose instruction for LLM simulator |
| Agent environment | Real internal Convex agents | Realistic; reuses existing agent infra (tools, retrievers, streaming) |
| Transcript input | Optional (dimension-driven always works) | Don't block on transcript analysis branch |
| Dataset typing | Strict: one dataset = one type (questions OR conversation sim) | Clean separation; different schemas, different evaluation approaches |
| Editing granularity | Scenario-level | Simpler than cohort-level; sufficient for v1 |
| Scenario/Run relationship | Template + instances | Reusable scenarios across agents; enables comparison |
| Pass@k | k configurable, strict (all k must pass) + per-run detail | Measures reliability, exposes variance |
| Pass threshold | Global per simulation, default 0.8 | Simple; per-evaluator thresholds can come later |
| Evaluator architecture | First-class entities, two types (code + LLM judge), binary | Aligns with course methodology; reusable across simulations |
| Frontend location | Agents page → Experiment mode (not Experiments page) | Matches existing pattern; agent experiments live on agents page |
| Naming | ConversationSimulation + ConversationSimRun | "Simulation" is the core concept |

## Technical Constraints & Decisions

### Convex Action Timeout & Single-Action Approach

Convex actions have a 10-minute timeout (15 min on pro plans). **For v1, each ConversationSimRun executes as a single action** that loops through all turns. Typical conversations (5-15 turns at ~5-8s per turn pair) complete in 1-3 minutes, well within timeout. The action monitors elapsed time and terminates with `"timeout"` if approaching the limit.

Why not per-turn chaining? Per-turn chaining (scheduling a new action for each turn) creates complexity with WorkPool interaction — WorkPool's `onComplete` fires when the initial action returns, not when the chain finishes. A single action per run keeps things simple and works naturally with WorkPool concurrency control.

**Safeguards:** `maxTurns` default of 20, elapsed time check before each turn pair, and `timeoutMs` config (default 5 min). If a conversation is genuinely long-running, the timeout terminates it gracefully.

### Agent Turn Execution

The existing `runAgent` action cannot be called from another action in Convex. **Solution: extract the core agent loop** (model resolution, tool construction, agentic loop) into a shared Node.js function. Key differences from the playground flow:

- Uses `generateText` (not `streamText`) — no frontend streaming needed
- Returns final response + all tool calls + usage stats
- Same model resolution logic (anthropic/openai), same tool construction
- Both `agents/actions.ts` and `conversationSim/actions.ts` call this shared function

**File:** `convex/lib/agentLoop.ts` — plain async function, NOT a Convex action.

### User Simulator Model

The user-simulator LLM model is configured at the simulation level. Default: `claude-sonnet-4-20250514` (fast, cheap, good at role-playing). The model is specified in the `ConversationSimulation` config, NOT hardcoded, so users can experiment with different simulator models.

### Conversations Table Differentiation

Simulation conversations reuse the existing `conversations` table. **A `source` field is added** as `v.optional(v.union(v.literal("playground"), v.literal("simulation"), v.literal("experiment")))`. Missing/undefined treated as `"playground"` — no migration needed. The playground query (`getOrCreatePlayground`) adds a filter for `source !== "simulation"` to avoid pollution.

### Indices for New Tables

```
conversationScenarios:
  .index("by_dataset", ["datasetId"])
  .index("by_org", ["orgId"])

conversationSimulations:
  .index("by_org", ["orgId"])
  .index("by_agent", ["agentId"])
  .index("by_dataset", ["datasetId"])

conversationSimRuns:
  .index("by_simulation", ["simulationId"])
  .index("by_scenario", ["scenarioId"])
  .index("by_simulation_scenario", ["simulationId", "scenarioId"])

evaluators:
  .index("by_org", ["orgId"])

evaluatorSets:
  .index("by_org", ["orgId"])
```

## Data Model

### Scenario Schema (ConversationScenario)

Stored in `conversationScenarios` table, linked to a dataset of type `"conversation_sim"`.

```
ConversationScenario {
  id
  datasetId: reference → datasets
  orgId

  // Structured Metadata (for UI filtering/editing)
  persona: {
    type: string                      // e.g., "Impatient professional"
    traits: string[]                  // e.g., ["terse", "direct"]
    communicationStyle: string        // e.g., "formal", "casual"
    patienceLevel: "low" | "medium" | "high"
  }
  topic: string                       // e.g., "Refund"
  intent: string                      // e.g., "Get refund for order #W2378"
  complexity: "low" | "medium" | "high"
  reasonForContact: string

  // Information boundaries
  knownInfo: string                   // what simulated user knows
  unknownInfo: string                 // what simulated user doesn't know

  // Instruction String (used by user-simulator LLM at runtime)
  instruction: string

  // Reference Messages (optional, from transcripts, ordered)
  // First message used verbatim as conversation opener when available
  // Remaining messages used as style/content examples for the LLM simulator
  referenceMessages: [
    { role: "user", content: string, turnIndex: number }
  ] | null
}
```

**Instruction string generation:** Auto-generated from structured metadata. Includes persona type, traits, communication style, patience level, topic, intent, reason for contact, known/unknown info. User can directly edit the instruction (detaches from auto-generation). Explicit "Regenerate" action re-synthesizes from current metadata.

### Dataset Model Changes

```
datasets table:
  + type: v.optional(v.union(v.literal("questions"), v.literal("conversation_sim")))
    // optional for backwards compat — missing/undefined treated as "questions"
    // no migration needed; code defaults to "questions" when absent
  + scenarioCount: number                      // 0 for question datasets
```

### Evaluator Schema

First-class entities in `evaluators` table.

```
Evaluator {
  id
  orgId
  name: string
  description: string
  type: "code" | "llm_judge"
  scope: "session" | "turn"           // session = whole conversation, turn = per-message

  // For type: "code"
  codeConfig: {
    checkType: "tool_call_match" | "string_contains" | "regex_match" | "response_format"
    // No "custom" type in v1 — sandboxing concerns; defer to future branch
    params: Record<string, any>       // type-specific parameters (see below)
  } | null

  // Code evaluator params by checkType:
  //   tool_call_match: { toolName: string, expectedArgs?: Record<string, any>,
  //                      matchMode: "exact" | "subset" }
  //   string_contains: { target: string, caseSensitive?: boolean,
  //                      searchIn: "agent_messages" | "all_messages" }
  //   regex_match:     { pattern: string, flags?: string,
  //                      searchIn: "agent_messages" | "all_messages",
  //                      shouldMatch: boolean }
  //   response_format: { requireJson?: boolean, requiredFields?: string[] }
  //
  // All code evaluators receive: { messages: Message[], toolCalls: ToolCall[] }
  // extracted from the conversation record.

  // For type: "llm_judge"
  judgeConfig: {
    rubric: string                    // clear pass/fail criteria
    passExamples: string[]            // few-shot PASS examples
    failExamples: string[]            // few-shot FAIL examples
    model: string                     // judge model
    inputContext: ("transcript" | "tool_calls" | "kb_documents")[]
  } | null

  // Metadata
  createdFrom: "template" | "error_analysis" | "manual"
  tags: string[]
}
```

**Output is always binary: pass/fail + justification string.**

### Evaluator Set Schema

```
EvaluatorSet {
  id
  orgId
  name: string
  description: string
  evaluatorIds: reference[]           // evaluators in this set
  requiredEvaluatorIds: reference[]   // hard gates — must pass
  passThreshold: number               // default 0.8
}
```

**Score calculation:**
- Score = (# passed evaluators) / (# total evaluators)
  - Required evaluators ARE included in both the denominator and the pass/fail gate
- Overall PASS = all required evaluators pass AND score >= passThreshold
  - If any required evaluator fails → FAIL regardless of score

### ConversationSimulation (top-level experiment)

```
ConversationSimulation {
  id
  orgId, userId
  datasetId: reference → datasets
  agentId: reference → agents
  evaluatorSetId: reference → evaluatorSets

  // Config
  k: number                          // passes per scenario, default 1
  passThreshold: number              // default 0.8 (can override evaluator set)
  concurrency: number                // WorkPool parallelism, default 3
  maxTurns: number                   // per conversation, default 30
  timeoutMs: number                  // per run timeout, default 300000 (5 minutes)
  userSimModel: string               // LLM model for user-simulator, default "claude-sonnet-4-20250514"
  seed: number | null                // variation inducer for user-simulator
                                     // (appended to user-sim system prompt to encourage
                                     // different conversation paths; NOT deterministic
                                     // reproducibility — LLM outputs are non-deterministic)

  // Status
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  totalRuns: number                  // scenarios × k
  completedRuns: number

  // Aggregate results
  overallPassRate: number | null     // % of scenarios where ALL k runs pass
  avgScore: number | null

  startedAt, completedAt
}
```

### ConversationSimRun (one conversation)

```
ConversationSimRun {
  id
  simulationId: reference → conversationSimulations
  scenarioId: reference → conversationScenarios
  agentId: reference → agents
  kIndex: number                     // which pass (0 to k-1)
  seed: number                       // specific seed

  // Links to existing infrastructure
  conversationId: reference → conversations

  // Status
  status: "pending" | "running" | "completed" | "failed"
  terminationReason: "user_stop" | "agent_stop" | "max_turns" | "timeout" | "error"
  turnCount: number

  // Evaluation results (binary per evaluator)
  // Stored inline for v1. Known constraint: Convex 1MB doc limit.
  // With typical evaluator sets (5-10 evaluators), justification strings
  // stay well under limit. If evaluator sets grow large, migrate to a
  // separate conversationSimEvalResults table (one row per evaluator per run).
  evaluatorResults: [
    {
      evaluatorId: reference
      evaluatorName: string
      passed: boolean
      justification: string          // why it passed/failed (keep concise)
      required: boolean              // from evaluator set
    }
  ]
  score: number                      // passed count / total count
  passed: boolean                    // all required pass AND score >= threshold

  // Observability
  toolCallCount: number
  totalTokens: number
  latencyMs: number

  annotations: string | null         // human notes post-run
}
```

## Simulation Orchestrator

Each ConversationSimRun executes as a single Convex action containing the full conversation loop + evaluation.

### Flow (single action per run)

```
runConversationSimAction (action: "use node")
  Input: simulationId, scenarioId, runId, kIndex, seed

  1. SETUP
     Load: scenario, agent config, evaluator set, simulation config
     Create Conversation record via mutation (source: "simulation")
     Update run: conversationId, status: "running"
     Build user-simulator system prompt:
       [global simulation guidelines]
       + [scenario.instruction]
       + [if referenceMessages[1:]: "Reference style examples: ..."]
       + [if seed: "Variation seed: {seed} — vary your approach slightly"]
     Build agent: extract shared agentLoop config (model, tools, system prompt)
     startTime = Date.now()

  2. CONVERSATION LOOP
     turn = 0
     consecutiveErrors = 0

     while true:
       // Timeout check
       if Date.now() - startTime > timeoutMs:
         terminationReason = "timeout"; break

       // Turn limit check
       if turn >= maxTurns * 2:  // maxTurns = turn pairs
         terminationReason = "max_turns"; break

       // === USER TURN ===
       if turn == 0 && referenceMessages[0]:
         userMessage = referenceMessages[0].content  // verbatim
       else:
         userMessage = await generateText({
           model: resolveModel(userSimModel),
           system: userSimSystemPrompt,
           messages: conversationHistory  // role-flipped for user-sim
         })

       if userMessage contains "###STOP###":
         terminationReason = "user_stop"; break

       Save user message via mutation (order, role: "user", content)
       turn++

       // === AGENT TURN ===
       agentResult = await runAgentLoop(agentConfig, conversationHistory)
       // Returns: { text, toolCalls[], usage, error? }

       if agentResult.error:
         consecutiveErrors++
         if consecutiveErrors >= 3:
           terminationReason = "error"; break
       else:
         consecutiveErrors = 0

       Save agent message + tool_call/tool_result messages via mutation
       Accumulate: totalTokens, toolCallCount
       turn++

       // Agent done check (e.g., empty response or explicit signal)
       if agentResult.done:
         terminationReason = "agent_stop"; break

  3. EVALUATE
     Load full conversation from DB
     evaluatorResults = []
     for each evaluator in evaluatorSet.evaluatorIds:
       load evaluator config
       if type == "code":
         result = runCodeEvaluator(evaluator.codeConfig, { messages, toolCalls })
       if type == "llm_judge":
         result = await runLLMJudge(evaluator.judgeConfig, {
           transcript, toolCalls, kbDocuments (if requested)
         })
       evaluatorResults.push({ evaluatorId, name, passed, justification, required })

     score = evaluatorResults.filter(r => r.passed).length / evaluatorResults.length
     passed = requiredAll pass AND score >= passThreshold

  4. SAVE
     Update ConversationSimRun via mutation:
       evaluatorResults, score, passed, terminationReason, turnCount,
       toolCallCount, totalTokens, latencyMs
     Mutation also:
       Increments simulation.completedRuns
       If completedRuns == totalRuns → compute aggregates, set status "completed"
```

### WorkPool Integration

- `ConversationSimulation.start` mutation → enqueues (scenarios × k) work items via WorkPool
- A dedicated `conversationSimPool` registered in `convex.config.ts`
- WorkPool config: `maxParallelism` = simulation's `concurrency` setting (default 3)
- Each work item = one `runConversationSimAction` (single action, full conversation)
- `onComplete` callback: handles "failed"/"canceled" statuses, updates simulation counters
- Cancellation: stores `workIds[]` on simulation, uses WorkPool cancel API

### Shared Agent Loop

Extracted from `agents/actions.ts` lines 88-316 into a reusable function:

```typescript
// convex/lib/agentLoop.ts

interface AgentLoopConfig {
  agent: AgentDoc                     // from agents table
  retrieverInfos: RetrieverInfo[]     // pre-loaded retriever configs
  systemPrompt: string                // pre-composed
}

interface AgentLoopResult {
  text: string
  toolCalls: { toolName: string, args: any, result: any, retrieverId?: string }[]
  usage: { promptTokens: number, completionTokens: number }
  done: boolean                       // agent signaled completion
  error?: string
}

export async function runAgentLoop(
  ctx: ActionCtx,                     // for vectorSearch in tool execution
  config: AgentLoopConfig,
  messages: AIMessage[],              // conversation history in AI SDK format
): Promise<AgentLoopResult>

// Uses generateText (not streamText) — no streaming needed for simulation
// maxSteps: 5 (same as existing runAgent)
// Returns collected tool calls + final text + usage
```

### Convex File Organization

```
convex/conversationSim/
  scenarios.ts            — scenario CRUD (mutations/queries)
  evaluators.ts           — evaluator CRUD (mutations/queries)
  evaluatorSets.ts        — evaluator set CRUD (mutations/queries)
  orchestration.ts        — simulation CRUD, start/cancel/status
  actions.ts              — "use node" — runConversationSimAction, generation actions
  runs.ts                 — run CRUD (mutations/queries)
  evaluation.ts           — code evaluator runners (pure functions, no Convex deps)

convex/lib/
  agentLoop.ts            — shared agent execution function (plain async, NOT a Convex action)
```

### User Simulator System Prompt

Global guidelines template (configured once, shared across all simulations):

```
You are simulating an end-user in a customer support conversation.
You are playing the role described in the scenario below.

RULES:
- Stay in character. Do not break the fourth wall.
- Only use information from your "known info." Do not invent details.
- Ask about things in your "unknown info" — you need to learn these.
- When your issue is resolved to your satisfaction, say "###STOP###" on its own line.
- If you feel the conversation is going nowhere after several attempts, say "###STOP###".
- Keep messages concise and natural — 1-3 sentences typical.
- Do not be overly cooperative. A real user might be confused, impatient, or unclear.

<scenario>
{scenario.instruction}
</scenario>
```

Reference messages (if available) are appended as:
```
<reference_style>
These are examples of how this type of user typically writes:
{referenceMessages[1:].map(m => `- "${m.content}"`).join('\n')}
Match this communication style and level of detail.
</reference_style>
```

## Scenario Generation Pipeline

### Path A: From KB Documents (always available)

1. **Dimension discovery** — analyze KB docs to find: persona types, topics, intents, complexity levels, emotional states
2. **Combination sampling** — generate valid, realistic dimension combinations
3. **Scenario generation** — LLM generates per combination: persona details, knownInfo/unknownInfo, reasonForContact, instruction string
4. **Review** — user reviews/edits in UI

### Path B: From Live Chat Transcripts (when available)

1. **Transcript analysis** — input analyzed transcripts (message classification, topics, intents from other branch)
2. **Scenario extraction** — LLM extracts: persona, topic, intent, complexity, knownInfo/unknownInfo, reference messages (user messages in order)
3. **Instruction generation** — grounded in real conversation
4. **Review** — same edit UI, but with referenceMessages populated

Generation runs as a Convex WorkPool job with progress tracking.

## Template Evaluators (5-6 common CX patterns)

Shipped as pre-built evaluator configs that users can add to their evaluator sets:

| Template | Type | Scope | What it checks |
|----------|------|-------|---------------|
| Tool Call Correctness | code | session | Agent called expected tools with correct arguments |
| Required Info Communicated | code | session | Agent conveyed specific required information |
| Prohibited Info Check | code | session | Agent did NOT reveal prohibited information |
| Resolution Achieved | llm_judge | session | User's goal was achieved by end of conversation |
| Empathy & Tone | llm_judge | session | Agent showed appropriate empathy and professional tone |
| No Hallucinations | llm_judge | session | Agent did not make claims unsupported by KB |

Each template includes a pre-written rubric (for LLM judges) or pre-configured params (for code checks). User can customize after adding.

## Frontend Design

### Dataset Page Changes

- **Type toggle** added as first control in the controls bar (before KB/dataset dropdowns)
  - Two buttons: "Questions & GT" | "Conversation Sim" (no counts on toggle)
  - Styled like the Experiment Type toggle on experiments page
  - Filters dataset dropdown to show only matching type
- **Questions & GT selected** → current behavior (question list + document viewer)
- **Conversation Sim selected** → scenario list (left) + scenario detail (right)
  - Scenario list: title, persona/topic/complexity tags, validator count
  - Scenario detail: persona chips, scenario chips, known/unknown info, instruction, reference messages, evaluation criteria
  - Edit button opens scenario editor
- **+ New Generation** button changes to **+ Generate Scenarios** in conversation sim mode
- Empty state when no sim datasets exist

### Agents Page — Experiment Mode Changes

- **3-pane layout** matching existing agent experiment pattern:
  - Left: Simulations sidebar (past simulations with pass rate, date, k value)
  - Middle: Scenario list (for selected simulation) with pass@k badges and per-run score dots
  - Right: Conversation transcript + per-evaluator pass/fail breakdown, with run tabs to switch between k passes
- **+ New Simulation** button opens config modal:
  - Agent (pre-selected from page)
  - Scenario dataset (conversation sim datasets only)
  - Evaluator set
  - k (passes per scenario)
  - Pass threshold
  - Concurrency (WorkPool)
  - Max turns
  - Timeout per run (default 5 min)
  - Shows total runs calculation
- **Running state**: progress banner, scenarios stream results as runs complete
- **Completed state**: full results with drill-down into any run's transcript + evaluation

### Clean Separation

- **Retrievers page → Experiment mode** → Questions & GT datasets only
- **Agents page → Experiment mode** → Conversation Sim datasets only
- **Experiments page** → leave as-is (legacy, to be removed later)

## Pass@k

For a scenario within a simulation with k passes:
- Run the scenario k times with different seeds
- Each run gets its own score (% of evaluators that pass)
- Each run is marked pass/fail against the threshold
- **Pass@k = ALL k runs passed** (strict reliability measure)
- Also track: average score and variance across k runs for deeper analysis

Simulation-level: `overallPassRate` = % of scenarios that pass@k.

## Future Work (next branches)

- **Error analysis UI**: open coding → axial coding on conversation transcripts → evaluator builder
- **Evaluator validation**: check evaluator agreement with manual labels
- **Collaborative annotation**: multi-annotator, Cohen's Kappa
- **Cohort-level distribution controls**: define topic/persona distributions
- **External agent support**: black-box API endpoint evaluation
- **Pairwise comparison**: compare two agents on same scenarios (LLM judge picks winner)
