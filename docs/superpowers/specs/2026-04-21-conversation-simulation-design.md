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
  + type: "questions" | "conversation_sim"    // new field, defaults to "questions"
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
    checkType: "tool_call_match" | "string_contains" | "regex_match" |
               "response_format" | "custom"
    params: Record<string, any>       // type-specific parameters
  } | null

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
- Overall PASS = all required evaluators pass AND score >= passThreshold

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
  seed: number | null                // base seed for reproducibility

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
  evaluatorResults: [
    {
      evaluatorId: reference
      evaluatorName: string
      passed: boolean
      justification: string          // why it passed/failed
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

Convex action (`"use node"`) that runs a single ConversationSimRun.

### Flow

```
1. SETUP
   Load scenario, agent config, evaluator set
   Create Conversation record (reuses existing table)
   Create ConversationSimRun (status: "running")
   Initialize user-simulator LLM:
     system prompt = [global guidelines] + [scenario.instruction]
     + [referenceMessages[1:] as style examples, if available]

2. CONVERSATION LOOP
   Turn 1 (User):
     if referenceMessages[0] exists → use verbatim
     else → user-simulator LLM generates from instruction
     Save Message { role: "user" }

   Turn 2+ (alternating):
     AGENT turn:
       Send via existing agent agentic loop (streamText + tools)
       Record tool calls, chunks, tokens, latency
       Save Message { role: "assistant" }

     USER turn:
       User-simulator LLM generates next message
       Check for ###STOP### signal
       Save Message { role: "user" }

   TERMINATION:
     User ###STOP### → "user_stop"
     Agent done signal → "agent_stop"
     turnCount >= maxTurns → "max_turns"
     elapsed >= timeout → "timeout"
     consecutive errors >= 3 → "error"

3. EVALUATION
   For each evaluator in the evaluator set:
     if type == "code":
       Run check function against conversation data
       Return { passed: bool, justification: string }
     if type == "llm_judge":
       Build judge prompt: rubric + examples + requested context
       Call judge LLM → binary pass/fail + justification

   score = passedCount / totalCount
   passed = all required pass AND score >= threshold

4. SAVE
   Update ConversationSimRun with results
   Update ConversationSimulation.completedRuns++
   If all runs done → compute aggregate (overallPassRate, avgScore)
```

### WorkPool Integration

- ConversationSimulation.start mutation → enqueues (scenarios × k) work items
- WorkPool concurrency: configurable (default 3, user can increase in UI)
- Each work item = one ConversationSimRun
- Completion callback → update run, check if simulation done
- Supports cancellation via stored workIds

### Convex File Organization

```
convex/conversationSim/
  scenarios.ts            — scenario CRUD (mutations/queries)
  evaluators.ts           — evaluator CRUD (mutations/queries)
  evaluatorSets.ts        — evaluator set CRUD (mutations/queries)
  orchestration.ts        — simulation CRUD, start/cancel/status
  actions.ts              — "use node" — orchestrator, user-sim LLM, evaluation
  runs.ts                 — run CRUD (mutations/queries)
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
