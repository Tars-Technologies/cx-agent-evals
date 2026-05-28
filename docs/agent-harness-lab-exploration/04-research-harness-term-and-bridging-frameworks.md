# 04 · Research — "Harness" Terminology & Bridging Frameworks

Synthesized briefing from a deep web-research thread on (A) where the term *"harness"* comes from and what it precisely means, and (B) frameworks that bridge deterministic workflow + LLM agent.

## Part A — The term "harness"

### Where it comes from

"Harness" did not originate in agents — it's borrowed from software testing (*"test harness"*: the scaffolding that runs code under test and feeds it inputs). The agent usage entered mainstream vocabulary through three converging communities in 2024–25:

1. **Evaluation / benchmarking** (earliest, most precise). EleutherAI's `lm-evaluation-harness` (2021+) and SWE-bench's `swebench.harness` module fixed the meaning: the *test runner* that loads tasks, drives the model, executes/scores outputs in reproducible (Docker) environments. *"Think of benchmarks as individual tests and the harness as the test runner."* SWE-bench: the harness is *"responsible for setting up Docker environments, applying patches, running tests, and determining if the patches resolve issues."*
2. **RL / agent training** (precise, formal). In the RL-environments taxonomy, the harness is *one named sub-component* of an environment: `E = {Tasks, Harness, Verifier, State, Config}` where `Harness H = {rollout_protocol, tools, system_prompt, context_manager, turn_limit, sandbox, state}`. Key definition: *"the harness is the scaffolding that enables the model to interact with the environment. This controls *how* the model interacts, but it does not improve *what* it knows."* Crucially, here the harness explicitly *excludes* the reward/verifier.
3. **Coding agents / general LLM-agent engineering** (broadest, loosest — 2025–26). This is where the term ballooned. The dominant framing, popularized by LangChain, OpenAI (*"Harness Engineering: leveraging Codex in an agent-first world"*), Martin Fowler, and Addy Osmani, is the equation: **Agent = Model + Harness.**

### Direct definitions & quotes

1. **LangChain (*Anatomy of an Agent Harness*)**: *"A harness is every piece of code, configuration, and execution logic that isn't the model itself."* / *"a raw model is not an agent. But it becomes one when a harness gives it things like state, tool execution, feedback loops, and enforceable constraints."* / *"The model contains the intelligence and the harness is the system that makes that intelligence useful."* Components listed: system prompts, tools/skills/MCPs, bundled infrastructure (filesystem, sandbox, browser), orchestration logic (subagent spawning, handoffs, model routing), hooks/middleware. — https://www.langchain.com/blog/the-anatomy-of-an-agent-harness
2. **Martin Fowler (*Harness Engineering*)**: *"The term harness has emerged as a shorthand to mean everything in an AI agent except the model itself — Agent = Model + Harness."* Splits it into *"Guides (feedforward)"* and *"Sensors (feedback)."* — https://martinfowler.com/articles/harness-engineering.html
3. **RL taxonomy (Lee Han-Chung, Mar 2026)**: *"the harness is the scaffolding that enables the model to interact with the environment. This controls how the model interacts, but it does not improve what it knows."* — https://leehanchung.github.io/blogs/2026/03/21/rl-environments-for-llm-agents/
4. **SWE-bench docs (*The Harness*)**: the `swebench.harness` module *"is responsible for setting up Docker environments, applying patches, running tests, and determining if the patches resolve issues."* — https://www.swebench.com/SWE-bench/reference/harness/
5. **Firecrawl (*What Is an Agent Harness*)**: *"An agent harness wraps around a model to manage long-running tasks reliably — the model generates responses, the harness handles everything else."* — https://www.firecrawl.dev/blog/what-is-an-agent-harness
6. **OpenAI** titled their post *"Harness engineering: leveraging Codex in an agent-first world,"* cementing *"harness engineering"* as the discipline of building everything around the model. — https://openai.com/index/harness-engineering/
7. **Business Engineer (*The Harness as the Agentic Moat*)**: *"Models have crossed a capability threshold where the binding constraint is no longer what the model can do in a single turn — it is what a system built around the model can do over time."* / *"A frontier lab has acknowledged, in concrete architectural detail, that the system produced the decisive result — not the model."* — https://businessengineer.ai/p/the-harness-as-the-agentic-moat
8. **Aakash Gupta / Atlan / dev.to**: *"If 2025 was the year of the agent, 2026 is the year of the harness... The model is a commodity. The harness is the moat."* — https://aakashgupta.medium.com/2025-was-agents-2026-is-agent-harnesses-heres-why-that-changes-everything-073e9877655e

### What "the model is commoditized, the harness is the moat" means

It's a competitive-strategy claim, not a technical definition. The argument: frontier models (Claude, GPT, Gemini) have converged on quality for most tasks, so per-turn model capability no longer differentiates. Durable advantage now comes from the *system around the model* — context management, tool orchestration, feedback/eval loops, state, guardrails, domain priors, human-approval flows, lifecycle — which takes thousands of engineering-hours to get right (cited examples: Manus's 5 rewrites over 6 months, LangChain's 4 architectures over a year). The RL angle adds a flywheel: if others train models on *your* harness (ARES-style), models get better specifically at your harness, deepening the moat.

### Is "harness" precise or loose?

**Precise** in eval and RL contexts (it's a named, scoped component — and notably *excludes* the reward/scorer in RL). **Loose** in the general agent-engineering discourse, where it has become a catch-all for "everything that isn't the model weights." The looseness is the point of the slogan but a liability for engineering specs.

### Verdict & recommendation on terminology (for the lab)

The lab is: *a bounded, conversational workflow runtime — typed state + tools + LLM + deterministic steps — that wraps an LLM for a CX use case, and suspends across user turns.* Assessment of candidates:

| Term | Fit | Trade-off |
|---|---|---|
| **Harness** | Mediocre | Trendy, but loose; in eval/RL it specifically *excludes* the orchestration/decision logic that is the heart of the gambit graph; connotes a *single agent loop*, not a multi-node workflow. Borrow the *vocabulary* (Agent = Model + Harness; "guides vs sensors") but it's not the ideal product noun. |
| **Agent runtime** | Good | Accurate that it's the execution layer. Slightly under-sells the *authored workflow* aspect — sounds like infra, not the product. |
| **Scaffold / scaffolding** | Weak | Synonym of harness in agent-eval literature; connotes temporary/throwaway. Avoid as the product noun. |
| **Orchestrator** | Partial | Right that it sequences steps; wrong in that it implies it merely *coordinates* services rather than *being* the conversational engine. |
| **Agent framework** | Wrong scope | Frameworks (LangGraph, ADK) are the toolkit you build *with*; the runtime is the thing built. |
| **Conversational engine** | Good for CX | Captures the multi-turn, message-send/collect-input nature and the CX framing. |
| **Agentic workflow runtime** | **Best technical fit** | Matches the industry's own 2025 distinction: *"workflows orchestrate LLMs+tools through predefined code paths"* vs *"agents run autonomously."* The lab is explicitly the *hybrid*: a workflow runtime where some nodes are deterministic and one node type is an agent. Precisely names structure (workflow), execution (runtime), and the LLM-in-loop nodes (agentic). |

**Recommendation (parked, not locked):** internally / architecturally call it an **agentic workflow runtime** (or *"conversational workflow engine"* for CX/product audiences). Reserve **"harness"** for the narrower sub-concept that wraps the LLM *inside* the AI-agent gambit (system prompt + tool schemas + loop/turn-limit + context manager) — that node-local wrapper is exactly what eval/RL communities call a harness, so the term is *correct there*. Net: *"an agentic workflow runtime whose AI-agent gambit contains an LLM harness."*

The user chose to **park this terminology decision** for now and continue using "harness" as colloquial shorthand for the whole thing.

## Part B — Bridging frameworks (deterministic workflow + LLM agent)

The lab = a graph of **gambits** (deterministic: send templated message, collect typed input, run pre/post/jump fn or API) + a new **AI-agent gambit** (LLM-in-loop with `send_message` / `collect_input` tools, ending in a jump decision). Below, ranked by analogy to "gambit-graph-with-agent-nodes."

### Tier 1 — Closest structural analogues

#### 1. Google ADK — Workflow Agents + LLM Agents
The single closest conceptual match. ADK has `SequentialAgent` / `ParallelAgent` / `LoopAgent` (deterministic flow control, *no LLM in the routing*) that compose `LlmAgent` nodes (LLM reasons, picks tools, decides next). State is shared via `session.state` and `output_key` (one node writes, next reads) — directly analogous to pre/post functions writing typed state for the next gambit. The deterministic-vs-LLM node distinction is a first-class API concept.

**Steal:** the explicit `WorkflowAgent` (deterministic) vs `LlmAgent` (agentic) taxonomy as the *"gambit"* vs *"AI-agent gambit"* naming; `output_key → session.state` as the typed-state contract between gambits.
— https://google.github.io/adk-docs/agents/workflow-agents/sequential-agents/ · https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/

#### 2. Rasa CALM (Flows + CommandGenerator)
The closest *CX/conversational* analogue. Business logic = **flows** (gambits exactly: *"information you need from the user, data you retrieve from an API, branching logic"*). An LLM (`CommandGenerator`) does *dialogue understanding* and proposes next steps but does **not** execute business logic — *"LLMs keep the conversation fluent but don't guess your business logic."* This is the deterministic-spine + bounded-LLM pattern, productized for support/CX. Handles cross-turn corrections/topic-switches natively (digressions).

**Steal:** the *"separation of concerns — LLM proposes, flow executes"* principle; how digressions/corrections are modeled when a user goes off-script mid-gambit; the `collect` step (typed slot collection = the "collect typed input").
— https://rasa.com/docs/learn/concepts/calm/ · https://rasa.com/docs/reference/primitives/flows/

#### 3. LangGraph (graph + `interrupt()` + checkpointer)
Closest on the *cross-turn suspension + state persistence* mechanics. Nodes can be plain functions (deterministic) or call an LLM/ReAct agent (agentic) — uniform node interface. `interrupt()` inside a node pauses the graph, persists the full state snapshot via a checkpointer, returns control; `Command(resume=...)` continues. This is precisely *"send message → suspend → wait for user turn → resume."*

**Critical lesson to steal:** on resume, **the entire node re-executes from the top** (the code before `interrupt()` runs twice) — so side effects (API calls, DB writes) must go *after* the interrupt, or be idempotent. Design the *"collect_input"* suspension so the gambit body is re-entrant.
— https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt · https://docs.langchain.com/oss/python/langgraph/durable-execution

### Tier 2 — Strong on specific patterns

#### 4. Burr (DAGWorks)
App = explicit state machine of **actions**; each action declares what it reads/writes from state *and* *"inputs from the user"* — a built-in human-in-the-loop primitive where an action asks for input and the state machine pauses. Actions can be deterministic functions or LLM calls. Conceptually the cleanest *"typed-state + actions + user-input-as-first-class"* model.
— https://burr.dagworks.io/concepts/state-machine/ · https://blog.dagworks.io/p/building-interactive-agents-with

#### 5. LlamaIndex Workflows
`@step` functions exchange typed **Events**. Built-in `InputRequiredEvent` / `HumanResponseEvent` to pause for async human input and resume. `WorkflowCheckpointer` snapshots after each step. Event-driven model maps well to *"gambit emits → next gambit consumes"*; an agentic step is just a step that runs an LLM loop.
— https://developers.llamaindex.ai/python/llamaagents/workflows/human_in_the_loop/

#### 6. Inngest AgentKit
Network of agents with shared **typed State** + a **router** that is the explicit decision point: code-based router (deterministic), routing *agent* (LLM decides next), or **hybrid router** (mix). The *"jump decision at end of AI-agent gambit"* = AgentKit's router; the deterministic gambit transitions = code router. Best mental model for *"agent ends in a jump decision."*
— https://agentkit.inngest.com/concepts/routers · https://agentkit.inngest.com/advanced-patterns/routing

#### 7. Mastra (workflows + agents)
TS-native. `suspend()` pauses a step (for human-in-the-loop or API callback); snapshot saved to configured storage, survives restarts/deploys; `resume(stepId, resumeData)` continues; `resumeStream` re-attaches the stream. Workflows and agents interoperate (agent-as-step, workflow-as-tool). Known rough edge: suspend/resume *inside* agent-invoked workflows.
— https://mastra.ai/docs/workflows/suspend-and-resume · https://mastra.ai/blog/resumeworkflows

#### 8. Pydantic AI Graph (`pydantic-graph`) + Durable Execution
Typed FSM: `BaseNode` subclasses; outgoing edges declared via the `run` method's *return type annotations* (very close to a *"jump function"* returning the next gambit). State snapshotted before/after each node → resumable. Durable execution delegated to Temporal/DBOS/Prefect.
— https://ai.pydantic.dev/graph/ · https://ai.pydantic.dev/durable_execution/overview/

### Tier 3 — Durability substrate (the persistence pattern to steal)

#### 9. Temporal + LLM
Gold standard for cross-turn durable suspension: human input via **Signals**, state read via **Queries/Updates**, durable timers for approval timeouts. *"The user can close the browser, go to lunch, and the Workflow continues... the decision is durably stored."*
— https://docs.temporal.io/ai-cookbook/human-in-the-loop-python · https://temporal.io/blog/build-resilient-agentic-ai-with-temporal

#### 10. Restate
Lighter durable-execution engine; **`awakeable()`** = a durable promise an agent creates, persists, then waits on for human/external input — survives crashes; durable timeouts preserve correct remaining time across restarts. Cleanest primitive name for *"suspend this gambit until the user replies."*
— https://docs.restate.dev/develop/go/external-events · https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs

#### 11. DBOS
Postgres-backed durable workflows; steps checkpointed, auto-resume from last completed step after crash; native integrations with Pydantic AI / LlamaIndex / OpenAI Agents SDK. Lightest-weight durability if you already have Postgres.
**Note:** the project's stack is Convex, which provides similar durable mutations/scheduling — so DBOS-style thinking maps onto Convex.
— https://www.dbos.dev/dbos-transact · https://docs.dbos.dev/python/examples/hacker-news-agent

#### 12. Microsoft Agent Framework / SK Process Framework
Workflow = collaboration graph of agents + functional modules; **Process Framework** (GA Q2 2026) is the deterministic-business-workflow side, event-driven, each step invokes a user-defined Kernel Function.
— https://learn.microsoft.com/en-us/agent-framework/overview/

#### 13. AWS Bedrock Flows
Visual flow of typed **nodes**; an **Agent node** can pause flow execution mid-run to request specific user input, then continue (multi-turn). Direct managed-service analogue of *"deterministic nodes + one agent node that can collect input mid-flow."* n8n/Flowise are the same idea at the low-code tier.
— https://docs.aws.amazon.com/bedrock/latest/userguide/flows-nodes.html

### Comparison summary

| Framework | "Step" model | Det. OR agent node? | Cross-turn user input | State persistence |
|---|---|---|---|---|
| **Google ADK** | Workflow agent / Llm agent | First-class split (closest naming) | Via session + tool loop | `session.state`, `output_key` |
| **Rasa CALM** | Flow step (`collect`, `action`) | Flow = det, CommandGenerator = LLM-propose | Native (slots, digressions) | Tracker store |
| **LangGraph** | Graph node (fn or agent) | Uniform node, either | `interrupt()` / `Command(resume)` | Checkpointer (full snapshot) |
| **Burr** | Action (reads/writes state) | Either; user-input first-class | Action requests input → pause | State machine snapshots/replay |
| **LlamaIndex WF** | `@step` + Events | Either | InputRequired/HumanResponse events | WorkflowCheckpointer per step |
| **Inngest AgentKit** | Agent + Router | Code/agent/**hybrid router** | Inngest durable steps | Typed Network State |
| **Mastra** | Workflow step / agent | Either; agent-as-step | `suspend()` / `resume()` | Snapshot to storage, survives deploys |
| **Pydantic Graph** | `BaseNode`, edges via return type | Either | Via Temporal/DBOS | State snapshot per node |
| **Temporal** | Workflow / Activity | Either | **Signals** + durable timers | Event-sourced, fully durable |
| **Restate** | Handler / step | Either | **`awakeable()`** durable promise | Journaled, durable |

### Specific patterns worth stealing

**Cross-turn state**
- ADK's `output_key → session.state` contract: each gambit declares the typed keys it writes; next gambit reads by key. Use a single shared, versioned session state, not ad-hoc.
- Inngest AgentKit's *"State = conversation history + typed state machine"* — keep message history and structured slots in *one* state object so both deterministic jumps and the agent's jump decision read the same source of truth.

**Human-in-the-loop suspension**
- Restate `awakeable()` / Temporal Signal naming: model *"collect_input"* as *creating a durable promise the gambit awaits*, resolved by the next inbound user message. Cleanest mental model and matches Convex's durable scheduling.
- LangGraph's hard lesson: **resume re-executes the whole node from the top.** Make every gambit body idempotent/re-entrant, or place all side-effecting calls (post-fn, API) *after* the input-collection suspend point.
- Mastra's `closeOnSuspend` / `resumeStream`: if streaming agent output to the CX UI, plan stream lifecycle across the suspend boundary explicitly.

**Agent-as-node**
- Inngest AgentKit's **router** abstraction is the precise analogue of *"AI-agent gambit ends in a jump decision"*: treat the agent's terminal output as a *routing decision over the gambit graph*, and support a hybrid router (LLM proposes a jump, deterministic code validates it against allowed transitions — exactly Rasa CALM's *"LLM proposes, flow executes"* guardrail). Bound the agent: turn-limit, allowed-tools, allowed-jumps.
- ADK `LoopAgent` with termination condition: a good model for the agent gambit's internal LLM-in-loop (iterate tools until the agent emits a jump/exit signal or hits max turns).

### Terminology to borrow

- **"Agent = Model + Harness"** (LangChain/Fowler) — use to scope the LLM wrapper *inside* the AI-agent gambit.
- **"Guides (feedforward) vs Sensors (feedback)"** (Fowler) — useful split for pre-functions (guides) vs post/validation-functions (sensors).
- **"Workflow vs Agent"** spectrum / *"guided determinism"* (Salesforce Agentforce, deepset) — frame gambits as the deterministic spine, AI-agent gambit as bounded autonomy.
- **"Router / hybrid router"** (Inngest) — for the jump-decision step.
- **"Awakeable" / "Signal"** (Restate/Temporal) — for the suspend-until-user-reply primitive.
- **"Digression / correction handling"** (Rasa CALM) — for when a user goes off-script mid-gambit.

## Bottom line

Call the overall system an **agentic workflow runtime** (product-facing: *"conversational workflow engine"*); reserve **"harness"** for the per-AI-gambit LLM wrapper. The three frameworks to study hardest are **Rasa CALM** (CX semantics + LLM-proposes-flow-executes), **Google ADK** (deterministic-vs-LLM node taxonomy), and **LangGraph** (interrupt/resume + the re-execution pitfall). For the durable-suspension primitive, borrow **Restate's `awakeable`** / **Temporal Signal** mental model. **Convex provides this durability for free in the project's stack.**
