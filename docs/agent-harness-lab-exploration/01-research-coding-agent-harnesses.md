# 01 · Research — Coding-Agent Harnesses (2025–26)

Synthesized briefing from a deep web-research thread on the concept of an "agent harness" as understood in the coding-agent world.

## (a) Crisp consensus definition

**An agent harness is everything between the language model and the real world: the runtime software that turns a stateless token-predictor into a goal-pursuing actor.** The industry has converged on a one-line formula popularized by OpenAI in February 2026:

> **Agent = Model + Harness.** *"If the reasoning model is the brain, the harness is the hands and feet — reading files, fixing code, running tests, deploying to production — and the quality of that shell determines what the agent can actually accomplish."*

Concretely, the harness comprises:
- the system prompt construction,
- the tool registry and tool-dispatch loop,
- permission / guardrail enforcement,
- context / memory management (compaction, sub-agent isolation, memory files like `CLAUDE.md` / `AGENTS.md`),
- the verification / feedback loops (linters, tests, CI gates, LLM-as-judge).

Martin Fowler's site frames it cleanly: *"Prompt engineering is what to ask. Context engineering is what to send the model. Harness engineering is how the whole thing operates."* The harness is a **specific application of context engineering focused on governing agent behavior via feedforward controls (guides) and feedback controls (sensors).**

There are two distinct senses of the word, and both are in active use:

1. **Runtime / product harness** — the agent loop wrapping the model (Claude Code, Codex CLI, Cursor, Devin, OpenHands, Aider, Amp, Gemini CLI).
2. **Evaluation harness** — the benchmark infrastructure that runs an agent against tasks and grades it (SWE-bench's `swebench.harness` module, Terminal-Bench's `Harness` class). Same word, evaluation context: the scaffolding that provisions a sandbox, applies the agent's output, and runs pass/fail tests.

## (b) The most important latest ideas & quotes

### 1. The harness can outweigh the model — "the harness effect"

Endor Labs benchmarking (April 2026): GPT-5.5 scored **61.5%** in OpenAI's native Codex harness vs **87.2%** in Cursor's harness — a **25.7-point swing on an identical model, same week**. Claude Opus on Terminal-Bench 2.0: **77% in Claude Code vs 93% in Cursor** (16-point harness differential). CORE-Bench: Claude Opus **42% with a minimal scaffold → 78% inside Claude Code's full harness**.

Sam Altman: *"Hard to overstate how critical it is. I no longer think of the harness and the model as these entirely separable things."*

Sources:
- https://www.mindstudio.ai/blog/agent-harnesses-beat-model-upgrades-5-benchmarks
- https://codex.danielvaughan.com/2026/04/19/the-harness-effect-same-model-different-tool-different-score/

### 2. OpenAI's "Humans steer. Agents execute." (Harness Engineering, Feb 2026)

OpenAI shipped a ~1M-line beta product with **zero manually written source code**, declaring that engineers' job shifts from writing code to *"designing environments, specifying intent, and building feedback loops."* Their concrete harness principles: structured repo docs as source of truth, `AGENTS.md` as a map, layered architecture **enforced by linters and tests** (not prompts), and agent-to-agent review loops before merge.

Source: https://openai.com/index/harness-engineering/ · https://www.infoq.com/news/2026/02/openai-harness-engineering-codex/

### 3. Anthropic's Claude Code is a deliberately thin harness: "give your agents a computer"

The Claude Agent SDK is built on the loop **gather context → take action → verify work → repeat**. The philosophy is minimal scaffolding plus general primitives (filesystem, bash, code execution) rather than heavy orchestration: *"give your agents a computer, allowing them to work like humans do."*

Context tooling: agentic search (grep/tail) preferred over semantic search; sub-agents for isolated context windows; automatic **compaction** near the context limit. Verification ranked: rules-based > visual > LLM-as-judge ("generally not very robust").

Source: https://claude.com/blog/building-agents-with-the-claude-agent-sdk

### 4. "Probabilistic compliance vs deterministic constraints" — the core harness-engineering insight

*"Telling an agent 'follow our coding standards' in a prompt is fundamentally different from wiring a linter that blocks the PR when standards are violated."* LLM instruction-following is probabilistic; the harness's job is to convert soft instructions into hard, enforced gates. The most powerful feedback signals are *optimized for LLM consumption* (e.g., custom linter messages containing self-correction instructions).

Sources:
- https://www.augmentcode.com/guides/harness-engineering-ai-coding-agents
- https://martinfowler.com/articles/harness-engineering.html

### 5. The multi-agent debate: Cognition (Devin) "Don't Build Multi-Agents" vs Anthropic's research system

Cognition's two principles:
1. *"Share context, and share full agent traces, not just individual messages"*
2. *"Actions carry implicit decisions, and conflicting decisions carry bad results."*

The Flappy Bird example: parallel sub-agents produced a Super Mario background and an incompatible bird because neither shared context. Their recommendation: **single-threaded, linear agents**; context compression by a dedicated LLM only when the window overflows; *context engineering is "the #1 job of engineers building AI agents."*

Days later Anthropic published the opposite for research workloads: an orchestrator-worker multi-agent system (Opus lead + Sonnet sub-agents) **outperformed single-agent Opus by 90.2%**, with token usage, tool-call count, and model choice explaining 95% of variance — multi-agent "works mainly because it spends enough tokens" via parallel context windows.

**Reconciliation:** linear for tightly-coupled write tasks (coding); parallel sub-agents for read-heavy, parallelizable exploration (research).

Sources:
- https://cognition.ai/blog/dont-build-multi-agents
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://news.smol.ai/issues/25-06-13-cognition-vs-anthropic

### 6. Anthropic's "Building Effective Agents" taxonomy — workflows vs agents

The foundational distinction:
- **Workflows** = *"systems where LLMs and tools are orchestrated through predefined code paths."*
- **Agents** = *"systems where LLMs dynamically direct their own processes and tool usage."*

Core philosophy: *find the simplest solution possible; only increase complexity when it demonstrably improves outcomes.*

The five workflow patterns + autonomous agent:

- **Prompt chaining** — decompose into a fixed sequence; each LLM call processes the prior output (optionally with programmatic gates between steps).
- **Routing** — classify the input, dispatch to a specialized follow-up handler.
- **Parallelization** — run simultaneously then aggregate; two modes: *sectioning* (split independent subtasks) and *voting* (multiple attempts at the same task).
- **Orchestrator-workers** — a central LLM dynamically decomposes tasks, delegates to worker LLMs, synthesizes results (subtasks not known in advance).
- **Evaluator-optimizer** — one LLM generates, a second evaluates and gives feedback, loop until criteria met.
- **Autonomous agent** — *"LLMs using tools based on environmental feedback in a loop"*; use when steps are unpredictable and flexibility/scale is needed.

Source: https://www.anthropic.com/research/building-effective-agents

### 7. Harnesses are converging; open source has caught up

Top agents "look more like each other than their underlying models do." On a fixed base model (Claude Opus 4.6), the funded proprietary scaffold (Augment, **72.0%**) is nearly tied by open-source **OpenHands + CodeAct v3 (68.4%)** — evidence the harness patterns are commoditizing once the model is held constant.

Source: https://www.mindstudio.ai/blog/agent-harnesses-beat-model-upgrades-5-benchmarks

### 8. "Harness" in the evaluation sense is precise and load-bearing

SWE-bench: *"The `swebench.harness` module provides the main evaluation infrastructure"* — Docker base/environment/instance image layers, apply model patch, run the repo's **Fail-to-Pass** tests, grade resolution.

Terminal-Bench: *"two parts: a dataset of tasks, and an execution harness that connects a language model to a terminal sandbox"*; its **Terminus** agent is deliberately a *"simple scaffold... a neutral testbed"* with a single tool (a headless terminal) so the benchmark measures the model, not the harness — the explicit mirror image of product harnesses.

Sources:
- https://www.swebench.com/SWE-bench/reference/harness/
- https://github.com/laude-institute/terminal-bench

## Common anatomy across these harnesses

- System-prompt construction (often layered: identity + tools + memory files)
- Tool definitions / registry
- An agent loop (model emits tool-use blocks → harness parses, permission-checks, dispatches, returns results → repeat)
- Context management (compaction, sub-agent context isolation, memory files)
- Optional plan mode (read-only planning before write actions — e.g., Claude Code)
- Permission / guardrail layer (deny-first defaults, allowlists, human approval)
- Verification / feedback loop (tests, linters, CI gates, LLM-as-judge)

Claude Code's distinctive combination: *minimal decision scaffolding + layered policy enforcement + deny-first defaults + progressive context management + composable extensibility (hooks, MCP, sub-agents).*

## (c) Transferable lessons for CX conversational-agent platforms

1. **Separate "model" from "harness" explicitly in the architecture.** CX agent quality will come more from harness design (retrieval strategy, tool surface, escalation rules, verification) than from swapping models. Budget engineering accordingly — and design so you can A/B the same model across harness variants.

2. **Convert soft policy into hard gates.** Don't put *"never promise a refund over $X"* or *"always cite the KB"* only in the system prompt — that's probabilistic. Wrap it in deterministic guardrails: tool-level checks, output validators that block/regenerate, and deny-first defaults for sensitive actions (refunds, account changes). This is the single biggest transferable insight.

3. **Adopt Anthropic's "simplest thing first" ladder.** Most CX intents are *routing* (classify → specialized handler) or *prompt chaining* (lookup → answer → verify), not autonomous agents. Reserve the full tool-loop agent for genuinely open-ended cases. Start as a workflow; promote to an agent only when it demonstrably improves resolution rate.

4. **Single-threaded for one conversation; parallel only for read-only fan-out** (Cognition vs Anthropic, applied). A customer conversation is a tightly-coupled write task — keep it linear with continuous context; do not split a live conversation across sub-agents. But for read-heavy retrieval (search KB + order system + policy docs simultaneously), the orchestrator-worker pattern is the right fit. Match topology to coupling.

5. **Build the verification loop as a first-class component.** Mirror Claude Code's verification ranking: prefer rules-based checks (did the answer cite a real KB span? is the order ID valid?) over LLM-as-judge. The span-based grounding eval already in this repo can be part of the *live* harness, not just offline eval.

6. **"Context engineering is the #1 job."** For long conversations, plan compaction/summarization deliberately (a dedicated summarizer LLM preserving decisions and entities), and pass full traces — not stripped messages — to any escalation/handoff agent so it inherits implicit decisions.

7. **Keep an evaluation harness distinct from the runtime harness.** Like SWE-bench/Terminal-Bench: a sandboxed, reproducible task suite with pass/fail grading (resolution, grounding, policy compliance). Hold the model constant to measure harness changes; hold the harness constant to qualify model upgrades. This is exactly the discipline behind the "harness effect" findings.

8. **Memory files as steering surface.** The `CLAUDE.md` / `AGENTS.md` pattern transfers: a structured, version-controlled "operating doc" (tone, escalation policy, do/don't, account-action limits) injected into context is more maintainable than scattered prompt edits — and is the natural place to iterate the harness when failures recur (the "steering loop": when the agent makes a mistake, build a control so it can't repeat it — Hashimoto's principle).

## Key URLs

- OpenAI Harness Engineering: https://openai.com/index/harness-engineering/ · https://www.infoq.com/news/2026/02/openai-harness-engineering-codex/
- Anthropic Building Effective Agents: https://www.anthropic.com/research/building-effective-agents
- Anthropic Claude Agent SDK: https://claude.com/blog/building-agents-with-the-claude-agent-sdk
- Anthropic Multi-Agent Research System: https://www.anthropic.com/engineering/multi-agent-research-system
- Cognition "Don't Build Multi-Agents": https://cognition.ai/blog/dont-build-multi-agents
- Martin Fowler, Harness Engineering: https://martinfowler.com/articles/harness-engineering.html
- Augment Code, Harness Engineering: https://www.augmentcode.com/guides/harness-engineering-ai-coding-agents
- The Harness Effect (benchmarks): https://codex.danielvaughan.com/2026/04/19/the-harness-effect-same-model-different-tool-different-score/ · https://www.mindstudio.ai/blog/agent-harnesses-beat-model-upgrades-5-benchmarks
- SWE-bench harness: https://www.swebench.com/SWE-bench/reference/harness/
- Terminal-Bench / Terminus: https://github.com/laude-institute/terminal-bench
- Cognition vs Anthropic debate recap: https://news.smol.ai/issues/25-06-13-cognition-vs-anthropic

**Caveat:** The most striking harness-vs-model swing numbers (25.7-point GPT-5.5 gap, etc.) come from secondary aggregators citing Endor Labs; the qualitative direction is corroborated across OpenAI, Anthropic, Cursor, and Martin Fowler primary sources, but treat the exact percentages as indicative rather than definitive.
