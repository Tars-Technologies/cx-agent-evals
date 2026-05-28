# 03 · Research — Agent Orchestration Topologies (2025–26)

Synthesized briefing from a deep web-research thread on agent orchestration topologies / multi-agent architecture patterns.

## The frame: it's a spectrum, not a zoo

The dominant 2025–26 thesis (Anthropic, Cognition, LangChain) is that *"agents"* and *"workflows"* are two ends of one axis.

- **Workflows** = LLMs / tools wired through *predefined code paths*.
- **Agents** = LLMs that *dynamically direct their own process*.

Everything below is a point on the path from "deterministic code with an LLM call inside" to "fully autonomous loop." The strongest practitioner advice of the era: **start at the deterministic end and add autonomy only where it demonstrably pays for itself**, because autonomy trades latency, cost, and error-compounding for flexibility (Anthropic, *Building Effective Agents*).

The second major 2025 theme is **context engineering** — the bottleneck in multi-agent systems is no longer "can the LLM reason" but "does each unit have the right tokens." Cognition's *Don't Build Multi-Agents* and Anthropic's *Effective Context Engineering* both argue topology choice is fundamentally a context-routing decision.

## (a) Taxonomy — one-line essence each

| # | Topology | Essence |
|---|----------|---------|
| 1 | **Single agent loop (ReAct)** | One LLM in a think → act → observe loop with tools until done. |
| 2 | **Plan-and-execute** | Plan the whole task first, then execute steps (replan on failure). |
| 3 | **Reflection / evaluator-optimizer** | A generator produces, a critic scores, iterate until criteria met. |
| 4 | **Router / dispatcher** | Classify the input once, then send it to the right specialist path. |
| 5 | **Supervisor / orchestrator-workers** | A coordinating agent dynamically decomposes and delegates to sub-agents, then synthesizes. |
| 6 | **Hierarchical / recursive teams** | Supervisors of supervisors — nested orchestration trees. |
| 7 | **Handoff / swarm** | Peer agents transfer control to each other; no central brain. |
| 8 | **Graph / state-machine workflow** | Explicit nodes + edges + state, often durable/replayable. |
| 9 | **Blackboard / shared memory** | Agents read/write a shared workspace instead of messaging directly. |
| 10 | **Network / group-chat mesh** | Many agents converse in a shared thread, any-to-any. |
| 11 | **Workflow with embedded agent nodes** | A deterministic pipeline where *one step* is an agent. |
| 12 | **Mixture / ensemble / debate** | Run multiple agents in parallel and aggregate, vote, or debate. |

## The twelve, in detail

### 1. Single agent loop (ReAct)
**Definition.** A single LLM iterates: reason about state, call a tool, observe the result, repeat until it decides it's finished. The canonical "LLM-in-a-loop." Most production "agents" are still this.
**Strength.** Maximum context continuity — one unbroken trace, no information lost in handoff. Simple to build and debug. Cognition explicitly argues this is the *default correct choice* for most work.
**Failure mode.** Context-window overflow and reasoning drift on long-horizon tasks; error compounding.
**Implements it.** ReAct paper (Yao et al., 2022/2023); OpenAI Agents SDK single `Agent`; Pydantic AI; the base agent in essentially every framework.

### 2. Plan-and-execute / planner-executor
**Definition.** A planner LLM produces a full multi-step plan up front; an executor carries out steps; the planner is re-invoked only on deviation/failure.
**Strength.** Fewer expensive planning calls, clearer auditability, better long-horizon coherence than a naive loop.
**Failure mode.** Brittle plans — the world changes mid-execution and a stale plan executes confidently. Replanning logic is where most bugs live.
**Implements it.** LangGraph "plan-and-execute" reference; LlamaIndex Workflows; Microsoft's **Magentic** orchestrator (task ledger of facts/guesses/plan in an outer loop; progress ledger in an inner loop).

### 3. Reflection / self-critique / evaluator-optimizer
**Definition.** One LLM call generates a candidate; a second (the evaluator) critiques against criteria; the generator revises. Loop until the evaluator passes it or a budget is hit.
**Strength.** Large quality gains on tasks with clear, articulable success criteria. Cheap to bolt onto any other topology.
**Failure mode.** Infinite/oscillating critique loops; the evaluator and generator sharing the same blind spots; latency multiplication.
**Implements it.** Anthropic's named **evaluator-optimizer** workflow; Reflexion / Self-Refine papers; CrewAI task-level validation; Microsoft Agent Framework "reflection."

### 4. Router / dispatcher
**Definition.** A lightweight classifier (LLM or model) inspects the input once and routes it to one of N specialized downstream handlers, each with its own tuned prompt/tools.
**Strength.** Separation of concerns — each branch can be small, well-tested, and individually optimized. Cheapest reliable way to handle heterogeneous input. Easy to add deterministic guardrails per branch.
**Failure mode.** Misclassification cascades (wrong route = confidently wrong answer with no recovery); ambiguous inputs.
**Implements it.** Anthropic's named **routing** workflow; LangGraph conditional edges; OpenAI Agents SDK (a triage agent that hands off); Semantic Kernel.

### 5. Supervisor / orchestrator-workers
**Definition.** A central orchestrator agent dynamically breaks the task into subtasks *it cannot predict in advance*, delegates each to a worker agent, and synthesizes results. Workers do not talk to each other.
**Strength.** Handles open-ended tasks where subtasks emerge from the input; centralized conflict resolution and a single point of control/observability.
**Failure mode.** The orchestrator is a context bottleneck and a single point of failure; token blow-up (Anthropic reports up to ~15× chat token use); workers acting on under-specified delegations (Cognition's core critique).
**Implements it.** Anthropic's named **orchestrator-workers** + their multi-agent research system; LangGraph `supervisor` / `langgraph-supervisor`; OpenAI Agents SDK "agents-as-tools"; CrewAI hierarchical process; Google ADK.

### 6. Hierarchical / recursive teams
**Definition.** Orchestrator-workers applied recursively: a top supervisor coordinates mid-level supervisors, each owning a sub-team. A directed tree; communication flows strictly parent ↔ child.
**Strength.** Scales past the ~3–8 agent limit where flat coordination collapses; modular.
**Failure mode.** Latency and cost stack multiplicatively per layer; context degradation across depth (telephone game); hard to debug.
**Implements it.** LangGraph hierarchical teams; CrewAI nested crews; Microsoft Agent Framework graph workflows; *"Devin manages Devins"* (Cognition, 2026).

### 7. Handoff / swarm
**Definition.** Peer agents, each with its own instructions and tools, decide *themselves* when to transfer control to another agent. No agent has a global view; routing logic lives distributed inside each agent.
**Strength.** Extremely lightweight to set up; natural when each specialist already knows who should take over next (e.g., support tiers). No orchestrator overhead.
**Failure mode.** No global view → debugging unexpected routing is painful; control can ping-pong; no central place to enforce policy. Anthropic and Cognition are both skeptical for reliability-critical work.
**Implements it.** **OpenAI Swarm** (educational, deprecated March 2025) → **OpenAI Agents SDK handoffs** (production successor); `langgraph-swarm`; Microsoft Agent Framework "handoff orchestration."

### 8. Graph / state-machine workflow (durable execution)
**Definition.** The application is an explicit graph: typed nodes (some LLM, some deterministic), edges, and shared state. Often paired with **durable execution** so the workflow can crash and replay deterministically from an event journal.
**Strength.** Maximum control, testability, observability; deterministic replay/fault-tolerance for long-running or human-in-the-loop flows; agents become non-deterministic *activities* inside a deterministic backbone.
**Failure mode.** Up-front rigidity — you must enumerate the graph; less adaptive to truly novel inputs; engineering overhead.
**Implements it.** **LangGraph** (graph + checkpointing/time-travel); **Temporal** (durable workflows; OpenAI integration public preview, Sept 2025); **Inngest** (step-based, `step.ai.infer`); LlamaIndex Workflows; Microsoft Agent Framework's typed graph Workflow.

### 9. Blackboard / shared memory
**Definition.** Agents don't message each other; they read from and write to a shared structured workspace ("blackboard").
**Strength.** Decouples agents (add/remove without rewiring); natural for opportunistic, incremental problem-solving; one place to inspect global state.
**Failure mode.** Write contention and stale reads; no built-in turn discipline → races; can become an unstructured dumping ground.
**Implements it.** Classic AI blackboard architecture (Hearsay-II lineage), revived in 2025 as the conceptual model behind shared scratchpads/Magentic ledgers; LangGraph shared state channels approximate it.

### 10. Network / fully-connected mesh & group-chat
**Definition.** Many agents share a conversation; any agent can address any other. A manager/speaker-selection policy decides who talks next (or it's free-for-all).
**Strength.** Rich emergent collaboration; good for brainstorming, simulated meetings.
**Failure mode.** Quadratic chatter and token cost; degenerate loops and consensus collapse; works only with ~3–8 tightly-coupled agents. Hard to make reliable.
**Implements it.** **AutoGen `GroupChat`**; Microsoft Agent Framework "group chat orchestration"; LangGraph "network" architecture.

### 11. Workflow with embedded agent nodes — *the pragmatic center of gravity*
**Definition.** A mostly-deterministic pipeline where the overall flow, state, and transitions are fixed code, but **one (or a few) steps are an LLM agent** with bounded autonomy. The agent doesn't own control flow — the workflow does.
**Strength.** This is the 2025–26 consensus *"safe default"* for production: you get deterministic guarantees, testability, guardrails, retries, and observability *everywhere*, and pay for autonomy *only* in the one step that needs reasoning. Satisfies Anthropic's *"simplest thing that works"* and Cognition's *"keep writes single-threaded, let agents contribute intelligence."*
**Failure mode.** Under-scoping the agent node (it needs context the rigid workflow withheld → Cognition's exact critique), or over-trusting its output without a validation gate.
**Implements it.** **Temporal** (deterministic workflow, agent = non-deterministic activity); **Inngest** steps; **LlamaIndex Workflows**; **LangGraph** (agent node inside a fixed graph); Microsoft Agent Framework executors. This is the topology Temporal/Inngest/LangGraph are all converging on for reliability-critical apps.

### 12. Mixture / ensemble & debate
**Definition.** Run multiple agents on the same problem in parallel and aggregate: voting (Anthropic's *"voting"* parallelization), best-of-N selection, or structured **debate** where agents argue and a judge/moderator decides.
**Strength.** Higher accuracy and calibration on hard reasoning via diversity; debate surfaces hidden errors.
**Failure mode.** N× cost/latency; ensembles can amplify a shared bias; debate can converge on a confident-but-wrong consensus or fail to terminate.
**Implements it.** Anthropic's **parallelization (sectioning/voting)** workflow; multi-agent debate literature (Du et al., Society of Minds); AutoGen / Microsoft Agent Framework "debate" pattern; CrewAI parallel tasks.

## (b) The 2-axis map

Place every topology on **Autonomy (who controls flow?) × Agent multiplicity (how many minds?)**:

```
                 SINGLE-AGENT  ───────────────────────────────►  MULTI-AGENT

 HIGH         │  ReAct loop (1)            Handoff/Swarm (7)
 AUTONOMY     │  Plan-execute (2)          Supervisor (5)
 (LLM drives  │  Reflection (3)            Hierarchical teams (6)
  control)    │                            Network/group-chat (10)
              │                            Mixture/debate (12)
              │ ─────────────────────────────────────────────────
 LOW          │  Router/dispatcher (4)     Blackboard (9, structured)
 AUTONOMY     │  Workflow + embedded
 (code drives │   agent node (11) ◄── pragmatic sweet spot
  control)    │  Graph/state-machine (8)
```

- **Bottom-left = most reliable, least flexible.** Top-right = most flexible, least reliable. The 2025–26 industry argument is a **deliberate pull toward the bottom-left**, climbing toward the top-right *only* per-step and only when justified.
- A useful third lens is **context coherence**: single-threaded topologies (1, 2, 11) preserve one continuous trace; multi-agent topologies (5–7, 9, 10) fracture context and must spend tokens/engineering to re-share it.

## (c) Recommendation for a turn-based CX support agent

A CX support agent is **reliability-critical, turn-based, policy-bound, and mixes scripted flows (auth, refunds, KYC) with open-ended help**. The topologies that matter, in priority order:

1. **#11 Workflow with embedded agent nodes — your backbone.** Model each conversation as a deterministic state machine. Make the *resolution* step an LLM agent with bounded tools; keep auth, eligibility checks, refund execution, and policy enforcement as deterministic nodes. Use **Temporal/Inngest** or **LangGraph** as the runtime, or — in this project — Convex which already provides durable storage/scheduling.

2. **#4 Router / dispatcher — your front door.** A cheap, well-tested intent classifier routes each turn to the right branch (billing / technical / account / escalate-to-human). Per-branch prompts and guardrails. The single highest-ROI topology for CX and the easiest to monitor.

3. **#1 Single agent loop — inside a branch.** Within a routed branch, a constrained ReAct loop is enough. Preserve one continuous trace per conversation. Do **not** split a live customer conversation across parallel agents.

4. **#3 Reflection — as a quality/safety gate.** Before any customer-facing message or refund, run a cheap evaluator pass: policy-compliant? hallucination-free? tone correct? This is where evaluator-optimizer earns its keep in CX.

5. **#2 Plan-and-execute — only for multi-step resolutions** (e.g., "cancel subscription, refund last charge, send confirmation") so steps are auditable and individually retriable.

**Use sparingly / avoid for live turn-based CX:** #7 swarm and #10 group-chat (no global view, hard to enforce policy, hard to debug); #5/#6 supervisor/hierarchical (overkill and token-expensive for a single conversation — reserve for *offline* ticket triage/batch analytics); #9 blackboard and #12 debate (latency/cost incompatible with turn-based UX).

**Net architecture:** a durable **state-machine workflow (8/11)** with a **router (4)** at the entry of each turn, a **single bounded agent loop (1)** doing the reasoning inside each branch, and a **reflection gate (3)** before any side-effecting or customer-visible action. Deterministic where correctness/policy matters; autonomous only in the narrow reasoning slice.

## Key sources

**Foundational / discourse:**
- Anthropic, *Building Effective Agents* — https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, *Effective Context Engineering for AI Agents* — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Cognition, *Don't Build Multi-Agents* — https://cognition.ai/blog/dont-build-multi-agents
- Cognition, *Devin's 2025 Performance Review* — https://cognition.ai/blog/devin-annual-performance-review-2025
- Jason Liu, *Why Cognition does not use multi-agent systems* — https://jxnl.co/writing/2025/09/11/why-cognition-does-not-use-multi-agent-systems/
- LangChain, *Context Engineering for Agents* — https://www.langchain.com/blog/context-engineering-for-agents

**Frameworks / topologies:**
- LangGraph multi-agent concepts — https://langchain-ai.github.io/langgraph/concepts/multi_agent/
- `langgraph-swarm` — https://github.com/langchain-ai/langgraph-swarm-py
- OpenAI Swarm — https://github.com/openai/swarm
- Microsoft Agent Framework — https://learn.microsoft.com/en-us/agent-framework/overview/
- Microsoft Magentic orchestration — https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic
- Magentic-One paper — https://arxiv.org/html/2411.04468v1
- Azure Architecture Center, AI Agent Orchestration Patterns — https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns

**Durable execution / workflow-with-agent:**
- Temporal, *Of course you can build dynamic AI agents with Temporal* — https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal
- Temporal + OpenAI durable agents — https://www.infoq.com/news/2025/09/temporal-aiagent/
- Inngest vs Temporal — https://akka.io/blog/inngest-vs-temporal

**Surveys / taxonomy:**
- *The Orchestration of Multi-Agent Systems* (arXiv 2026) — https://arxiv.org/html/2601.13671v1
- Augment Code, *Swarm vs Supervisor* — https://www.augmentcode.com/guides/swarm-vs-supervisor
- DigitalApplied, *Agent Architecture Patterns: 2026 Taxonomy* — https://www.digitalapplied.com/blog/agent-architecture-patterns-taxonomy-2026
- Kore.ai, *Choosing the right orchestration pattern* — https://www.kore.ai/blog/choosing-the-right-orchestration-pattern-for-multi-agent-systems
