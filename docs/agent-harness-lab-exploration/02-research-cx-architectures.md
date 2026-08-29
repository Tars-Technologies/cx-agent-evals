# 02 · Research — CX / Customer-Support Agent Architectures (2025–26)

Synthesized briefing from a deep web-research thread on how modern CX / customer-support AI agent platforms architect their agents.

## Executive summary

The CX-agent industry has converged on one dominant architecture: **a constrained, LLM-driven reasoning layer that operates *on top of* a deterministic execution substrate.** Nobody serious ships a "pure LLM agent" into support. The interesting variation is *where the seam sits* — how much the LLM is allowed to decide vs. how much is locked into authored procedures — and every major vendor has independently arrived at the same answer: **the LLM interprets and routes; deterministic structures execute and enforce.**

The cleanest articulation of this is **Rasa CALM** (LLM does *dialogue understanding → commands*; **Flows** do business logic), and the most explicit philosophical statement is **Decagon's** *"natural language with the precision and rigor of code."* Microsoft, Google, and Salesforce ship literally the same two-layer model under different names.

## (a) The dominant architectural pattern(s) in 2025–26

### 1. Two-layer "generative orchestration over deterministic execution"

A generative planner / router interprets intent and decides *what to do*; authored, deterministic units actually *do it*. Named instances:

- **Microsoft Copilot Studio** states it most bluntly with a named two-tier model: a **"deterministic layer"** (rule-based topics/flows you "still enforce for mission-critical or irreversible actions… without any AI interpretation," e.g. payments, record deletion) and an **"AI orchestrator layer"** that is *"fully generative… within guardrails"* for lower-risk Q&A. This is *"generative orchestration"* vs. legacy *"classic orchestration."* (https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration)
- **Google Dialogflow CX / Conversational Agents**: explicitly frames it as a **spectrum, not a binary** — "always uses language models for understanding intent," but you choose **Flows (deterministic, "complete control over conversation flow and agent responses")** vs. **Playbooks (fully generative, natural-language instructions)**, with a hybrid middle: **Generators** and **generative fallback** dropping LLM into otherwise-scripted flows. (https://docs.cloud.google.com/dialogflow/cx/docs/generative-deterministic · https://docs.cloud.google.com/dialogflow/cx/docs/concept/playbook)
- **Salesforce Agentforce / Atlas**: a **ReAct (reason–act–observe) loop** (*"ReAct yielded much better results than chain-of-thought"*), but the agent is bounded by a **declarative YAML** definition of *Role, Data, Actions, Guardrails, Channel*, with **Topics** = jobs-to-be-done and **Actions** = deterministic capabilities. Architecture is **State / Flow / Side Effects**, event-driven, "System 2" inference-time reasoning. (https://engineering.salesforce.com/inside-the-brain-of-agentforce-revealing-the-atlas-reasoning-engine/)

### 2. The "constellation / supervisor" pattern (multi-model, not just multi-agent)

**Sierra's "Agent OS"** is the flagship: not one LLM but a **"constellation of 15+ frontier, open-weight and proprietary models,"** each picked per task (low-latency for lookups, high-precision classifiers for behavior detection, tone-tuned models for sensitive turns), composed from **modular "skills"** (triage, respond, confirm) with **routing handled automatically under the hood**, and — critically — **"supervisor" models that observe the underlying agent's reasoning and revise it if it violates guardrails/policies.** Sierra's stated math: a 90%-accurate supervisor on top of a base model can push combined accuracy toward 99%. They call the non-model scaffolding *"reasoning scaffolding that lives outside of the models."* (https://sierra.ai/blog/constellation-of-models)

**Cresta** independently describes the same: *"specialized task-specific agents coordinated by a routing agent"* + *"deterministic state management… balancing LLM flexibility with predictable behavior,"* and **layered guardrails** (system-level non-negotiable rules → supervisory real-time monitoring → adversarial testing). (https://cresta.com/ai-agent · https://cresta.com/guides/best-ai-agents)

### 3. Supervisor / router → specialist sub-agents (multi-agent CX)

The OpenAI *"Practical Guide to Building Agents"* supplies the now-standard vocabulary: the **"manager pattern"** (central LLM orchestrates specialist agents via *tool calls* — "workflow-as-tool") vs. the **"decentralized pattern"** (peer agents *hand off* execution; "edges are handoffs"), with handoffs called the optimal pattern for **conversation triage**. (https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)

Concrete CX instances:

- **Parloa AMP**: moved from monolithic to **modular sub-agents** — *"tasks like authentication or booking changes run as separate sub-agents, improving instruction-following."* (https://openai.com/index/parloa/ · https://www.parloa.com/platform/)
- **Kore.ai XO / DialogGPT**: *"agentic orchestration engine"* doing **autonomous orchestration across multiple Dialog Tasks** (sequential/parallel by dependency), plus **multi-agent orchestration with named patterns: supervisor, adaptive agent network, custom**. (https://www.kore.ai/ai-agent-platform/multi-agent-orchestration)
- **Intercom / Fin**: a 5-phase pipeline (query refinement/safety → retrieval → rerank → generation → validation), plus the explicit **"agent that manages another AI agent"** (a supervisory agent for the Fin agent). (https://fin.ai/ai-engine · https://venturebeat.com/technology/intercom-now-called-fin-launches-an-ai-agent-whose-only-job-is-managing-another-ai-agent)

## (b) How the deterministic ↔ autonomous hybrid is done in practice

| System | Deterministic side | LLM / autonomous side | The seam |
|---|---|---|---|
| **Rasa CALM** | **Flows** (`flows.yml`): authored steps, slots, API calls, branching = "business logic"; **FlowPolicy** + **dialogue stack** (LIFO) executes deterministically | **Dialogue Understanding** + **CommandGenerator** (LLMCommandGenerator) interprets the *whole conversation* | LLM emits **commands** (StartFlow, SetSlot, Clarify, etc.); it can route between flows but **cannot author business logic** — execution is owned by Flows. *"Separate from task execution."* |
| **Decagon** | **AOPs**: natural language **"compiled into validated workflows,"** engineer-controlled core code, enterprise guardrails with "strict validation" on refunds/identity | LLM agent dynamically responds to complex multi-step issues | *"Natural language… with the precision and rigor of code"*; business users author logic, engineers gate it |
| **Sierra Agent OS** | Authored **skills**, policies, **supervisor models** enforcing guardrails | Base reasoning models compose/route | Supervisor inspects reasoning, revises on policy violation |
| **Copilot Studio** | *"Deterministic layer"*: authored topics/flows for irreversible actions | Generative orchestrator plans multi-step within guardrails | Risk-tiered: high-risk → deterministic topic; low-risk → planner |
| **Dialogflow CX** | **Flows** (visual builder, full control) | **Playbooks** (NL instructions) + **Generators** | Hybrid agent: deterministic flow backbone, playbooks/generators slotted in; routine ↔ task ↔ flow parameter passing |
| **Agentforce / Atlas** | YAML-declared **Actions**, **Guardrails**; deterministic Flow/Side-Effects | ReAct reason-act-observe loop over **Topics** | Topic instructions + available actions bound the loop |
| **Botpress** | Standard nodes execute actions **sequentially**; sub-workflows | **Autonomous node**: *"LLM decides which actions to take and in what order"* | The autonomous node is a *bounded region* of LLM freedom inside an otherwise scripted graph — i.e., **agent-as-a-node-in-a-workflow** |
| **Voiceflow** | Visual multi-turn conversation design, scripted paths | LLM/KB-grounded responses | Designer-controlled flow with generative steps |
| **Forethought** | Deterministic triage/routing rules | LLM intent/sentiment/urgency classification | LLM classifies; routing/escalation rules act |
| **Ada** | "Reasoning Engine" orchestrates workflows; multi-layer safeguards, brand/business instructions | *"Constellation of language models"* plans & executes | Adaptive reasoning constrained by *"context-driven logic"* + business instructions |

The recurring concrete mechanism across all of them: **the LLM is restricted to *understanding and selecting*, never to *defining or executing* business logic.** As a widely-cited 2025/2026 framing puts it (echoing OWASP LLM Top-10 *"Excessive Agency"*):

> *"Path constraints define every possible action explicitly — if a path doesn't exist in the workflow, the agent cannot take it,"*

which "eliminates the creative problem-solving that causes autonomous agents to access unauthorized systems." (https://www.chat-data.com/blog/agentic-customer-support-guardrails-openclaw)

## (c) Rasa CALM in depth (the closest flow + LLM analog)

**CALM = Conversational AI with Language Models.** Architecture:

1. **Dialogue Understanding (DU)** — replaces classic NLU. NLU classifies *one message in isolation*; **DU interprets the message in the full conversation context *plus the assistant's business logic*** and outputs **a sequence of commands** representing how the user wants to progress the conversation. (https://learning.rasa.com/rasa-pro/dialogue-understanding/ · https://rasa.com/docs/learn/concepts/calm/)

2. **Command Generation** — two interchangeable generators:
   - **LLMCommandGenerator**: prompts an LLM with conversation state + defined flows/slots + active dialogue, gets back commands. Works well with *small fine-tuned models* (e.g. Llama 8B) for latency/cost.
   - **NLUCommandAdapter**: traditional intent/entity classification mapped to commands (migration path, cheaper, no LLM).
   The command set includes **StartFlow, SetSlot, CancelFlow, Clarify, ChitChat, Knowledge/search answer, human handoff, skip-question, correction, repeat** (commands map onto conversation-repair patterns; see below).

3. **Flows** (`flows.yml`) — the deterministic core. A flow is a structured step sequence (collect info, call APIs, branch). **This is where business logic lives, and the LLM cannot invent it.** Files: `flows.yml`, `config.yml`, `domain.yml`, `actions.py`, `endpoints.yml`.

4. **Dialogue stack + FlowPolicy** — a **LIFO stack** ("like stacking plates"). Starting a flow pushes it; the topmost flow is active; on completion/cancel it pops and returns to the flow underneath. The **FlowPolicy** uses this stack plus internal slots to track exact position in every active flow — this is what gives **deterministic, debuggable execution**. (https://rasa.com/docs/rasa-pro/concepts/policies/flow-policy/)

5. **Conversation-repair patterns** — the elegant part. Non-linear user behavior (digression, correction, interruption, cancellation, clarification, chitchat, human handoff, skip-question, internal error, voice repeat/silence) is handled by **pre-written reusable system flows ("patterns")**. When the user goes off-script, DU emits a command that **activates a pattern flow pushed onto the stack**; once handled, the stack pops back to the interrupted flow and **resumes deterministically**. This is why CALM can be *flexible at the language layer and deterministic at the execution layer simultaneously* — flexibility is absorbed by stack manipulation, not by letting the LLM improvise logic. (https://rasa.com/docs/rasa-pro/concepts/conversation-repair/)

**Why this is the reference design:** CALM cleanly separates *understanding* (LLM, generative, context-aware) from *task execution* (Flows, deterministic, stack-tracked), with a *standard library of repair patterns* handling the messy non-linear reality. Every other vendor's hybrid is a variant of this idea; CALM just names the parts most precisely.

## (d) Control-vs-autonomy in CX: why pure-LLM is rejected

Support agents take *irreversible, money-moving, identity-sensitive actions* (refunds, account changes, cancellations) under brand/regulatory liability. The consensus framing: autonomous agents bring *"full LLM intelligence and full LLM unpredictability"*; production CX needs *"the intelligence without the liability."* OWASP's 2025 LLM Top-10 names **"Excessive Agency"** and recommends **constraining what an agent *can* do, not just monitoring what it did.**

**Constraint mechanisms actually used (named):**

- **Authored deterministic paths for high-risk actions** (Copilot Studio "deterministic layer"; Dialogflow Flows; Decagon "strict validation" on refunds/identity; Rasa Flows).
- **Supervisor models** that watch the primary model's reasoning and override on policy violation (Sierra, Cresta "supervisory guardrails," Intercom's agent-managing-agent).
- **Layered guardrails**: system-level non-negotiable rules → supervisory real-time monitoring → adversarial/red-team testing (Cresta's explicit three-layer model; Arthur/Galileo pre-LLM & post-LLM guardrail framing).
- **Input / output safety + relevance filters** before and after generation (Fin's Phase-1 safety/relevance check + Phase-5 validation; Atlas guardrails).
- **Grounding to constrain hallucination**: answers must be grounded in customer knowledge, not model priors (Fin *"grounded in your knowledge base, not general data"*; Ada).
- **Escalation as explicit conditions, not AI judgment**: the strong recommendation industry-wide is that **handoff triggers be deterministic thresholds** — *"sentiment below threshold escalates, confidence below threshold escalates, restricted topics escalate"* — rather than the LLM deciding when to escalate. Forethought is built around exactly this. Rasa exposes this as a **human-handoff command/pattern**; Decagon has a dedicated **Routing module** that *"determines when an inquiry cannot or should not be handled by an AI agent."*

**Conversation state, slot filling, tool/API integration:** state is held in a structured store, not just the prompt. Rasa: dialogue stack + slots (with `pattern_correction` to update previously-filled slots mid-flow, `pattern_continue_interrupted` to resume). Atlas: explicit **State** = short- and long-term memory of past interactions/user data. Botpress: native memory, goal tracking, multi-turn context, built-in tables for structured data. Tool/API integration is universally via **typed actions / function-calling / connectors / webhooks** to CRM, order, billing systems.

## (e) Vocabulary — the industry doesn't use "harness"

**"Harness" is *not* CX-industry vocabulary.** It does not appear in any vendor's CX materials. "Harness" is coding-agent / agent-infra terminology. The CX industry uses different words for the same concept:

- **Scaffolding / reasoning scaffolding** — Sierra (*"reasoning scaffolding that lives outside of the models"*).
- **Orchestration / orchestrator / orchestration layer** — near-universal (Copilot "generative orchestration," Kore.ai "agentic orchestration engine," Parloa "orchestration layer," OpenAI manager pattern).
- **Reasoning engine** — Salesforce **Atlas Reasoning Engine**, Ada **Reasoning Engine**.
- **Agent OS / Agent Engine / Agent Studio / AMP** — the platform-level wrapper (Sierra Agent OS, Decagon "AI Agent Engine," Sierra/Intercom "Agent Studio," Parloa AMP).
- **Guardrails** — universal, and the single most load-bearing word in CX-agent marketing/architecture.
- **Playbooks** — Google (generative building block).
- **Flows / Topics / Skills / Procedures / Tasks / AOPs / Dialog Tasks** — the deterministic units, vendor-specific names: Flows (Rasa, Dialogflow, Copilot), Topics (Salesforce, Copilot), Skills (Sierra), Procedures/Tasks (Intercom Fin), Agent Operating Procedures (Decagon), Dialog Tasks (Kore.ai).
- **Agentic workflow** — the umbrella term for the whole hybrid.
- **Supervisor / supervisor model / supervisory guardrails** — Sierra, Cresta, Intercom.
- **Autonomous node / sub-agent / specialist agent / manager pattern / handoff** — multi-agent vocabulary.
- **Escalation / handoff** — the human-in-the-loop exit, always discussed as triggered by explicit conditions.

**One-line industry mental model:** *"Generative orchestration / reasoning engine, with guardrails and supervisors, routing among deterministic flows/topics/skills, escalating to humans on explicit conditions."* That sentence is, in effect, the 2025–26 CX-agent reference architecture, and every vendor above is a dialect of it.

## Key sources

- Rasa CALM: https://rasa.com/docs/learn/concepts/calm/ · https://learning.rasa.com/rasa-pro/dialogue-understanding/ · https://rasa.com/docs/rasa-pro/concepts/policies/flow-policy/ · https://rasa.com/docs/rasa-pro/concepts/conversation-repair/
- Sierra: https://sierra.ai/blog/constellation-of-models · https://sierra.ai/blog/meet-agent-studio
- Decagon: https://decagon.ai/product/aop · https://decagon.ai/resources/aop-the-future-of-cx · https://decagon.ai/resources/the-ai-agent-engine
- Intercom Fin: https://fin.ai/ai-engine · https://venturebeat.com/technology/intercom-now-called-fin-launches-an-ai-agent-whose-only-job-is-managing-another-ai-agent
- Salesforce Agentforce / Atlas: https://engineering.salesforce.com/inside-the-brain-of-agentforce-revealing-the-atlas-reasoning-engine/ · https://www.salesforce.com/agentforce/what-is-a-reasoning-engine/atlas/
- Parloa: https://www.parloa.com/platform/ · https://openai.com/index/parloa/
- Cresta: https://cresta.com/ai-agent · https://cresta.com/guides/best-ai-agents
- Ada: https://www.ada.cx/platform/
- Kore.ai: https://www.kore.ai/ai-agent-platform/multi-agent-orchestration
- Google Dialogflow CX: https://docs.cloud.google.com/dialogflow/cx/docs/generative-deterministic
- Microsoft Copilot Studio: https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration
- Cross-industry framing: https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/ · https://www.chat-data.com/blog/agentic-customer-support-guardrails-openclaw · https://www.oreilly.com/radar/ai-agents-need-guardrails/
