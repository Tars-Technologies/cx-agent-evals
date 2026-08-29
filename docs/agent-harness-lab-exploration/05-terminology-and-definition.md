# 05 · Terminology & Definition

A condensed synthesis of how "agent harness" is defined in 2025–26 and what to call the system being designed.

## The consensus definition

> **Agent = Model + Harness.**
>
> *"If the reasoning model is the brain, the harness is the hands and feet — reading files, fixing code, running tests, deploying to production — and the quality of that shell determines what the agent can actually accomplish."*
> — OpenAI, *Harness Engineering*, Feb 2026

> *"A harness is every piece of code, configuration, and execution logic that isn't the model itself."*
> — LangChain, *The Anatomy of an Agent Harness*

Concretely the harness includes: system prompt construction, tool registry + dispatch loop, permission / guardrail enforcement, context / memory management, verification / feedback loops. Martin Fowler: *"Prompt engineering is what to ask. Context engineering is what to send the model. Harness engineering is how the whole thing operates."*

## Two distinct senses of the word

1. **Runtime / product harness** — the agent loop wrapping the model in coding agents (Claude Code, Codex, Cursor, Devin, OpenHands).
2. **Evaluation harness** — the benchmark infrastructure that runs an agent against tasks and grades it (SWE-bench `swebench.harness`, Terminal-Bench `Harness` class, EleutherAI `lm-evaluation-harness`).

Both are valid; both are in active use.

## Where the term came from

Borrowed from software testing (*"test harness"*). Spread to LLM-agent vocabulary through three communities:

- **Eval/benchmarking** (precise, earliest)
- **RL / agent training** (precise; in `E = {Tasks, Harness, Verifier, State, Config}`, the harness *excludes* the reward/verifier)
- **Coding agents / general LLM-agent engineering** (loosest, broadest — the catch-all meaning is from here)

## The strategic claim — "the harness is the moat"

Frontier models (Claude, GPT, Gemini) have converged on quality; per-turn model capability no longer differentiates. Durable advantage now comes from the *system around the model* — context management, tool orchestration, feedback/eval loops, state, guardrails, domain priors, human-approval flows, lifecycle. This takes thousands of engineering-hours to get right. See Sam Altman: *"Hard to overstate how critical it is. I no longer think of the harness and the model as these entirely separable things."*

## "Harness" in CX vocabulary — it isn't used

The CX industry (Sierra, Decagon, Intercom, Salesforce, Rasa, Cresta, Ada, Kore.ai, Microsoft, Google) does **not** use "harness." They use:

- **Scaffolding / reasoning scaffolding** (Sierra)
- **Orchestration / orchestration layer / orchestrator** (Copilot Studio, Kore.ai, Parloa, OpenAI manager pattern)
- **Reasoning engine** (Salesforce Atlas, Ada)
- **Agent OS / Agent Engine / Agent Studio / AMP** (Sierra, Decagon, Intercom, Parloa)
- **Guardrails** (universal, most load-bearing CX-architecture word)
- **Agentic workflow** (umbrella for the deterministic + LLM hybrid)
- **Flows / Topics / Skills / Procedures / Tasks / AOPs / Dialog Tasks** for the deterministic units (vendor-specific names)
- **Supervisor model** (Sierra, Cresta, Intercom)

The CX one-line reference architecture (paraphrase): *"generative orchestration / reasoning engine, with guardrails and supervisors, routing among deterministic flows/topics/skills, escalating to humans on explicit conditions."*

## Recommendation on what to call the lab (parked decision)

| Term | Fit | Trade-off |
|---|---|---|
| **Harness** | Mediocre | Trendy, but loose; in eval/RL it specifically excludes the orchestration/decision logic that is the heart of the gambit graph; connotes single-loop, not multi-node workflow. Borrow vocabulary but not ideal product noun. |
| **Agent runtime** | Good | Accurate; under-sells the authored workflow aspect. |
| **Scaffold / scaffolding** | Weak | Synonym in eval literature; connotes throwaway. |
| **Orchestrator** | Partial | Implies coordinating services rather than being the conversational engine. |
| **Agent framework** | Wrong scope | Frameworks are what you build *with*, not the thing built. |
| **Conversational engine** | Good for CX | Captures multi-turn nature and CX framing. |
| **Agentic workflow runtime** | **Best technical fit** | Matches Anthropic's workflow-vs-agent distinction; precisely names structure (workflow), execution (runtime), and the LLM-in-loop nodes (agentic). |

**Most technically defensible phrasing:** *"an **agentic workflow runtime** whose AI-agent gambit contains an **LLM harness**."* The outer system is an agentic workflow runtime; inside each AI-agent gambit there is a "harness" in the precise eval/RL sense (system prompt + tool schemas + turn-limit + context manager).

## Current status

**The user chose to park this terminology decision and continue using "harness" as colloquial shorthand for the whole thing.** Revisit when productizing.
