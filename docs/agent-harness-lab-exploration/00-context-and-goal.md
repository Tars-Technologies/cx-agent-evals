# 00 · Context & Goal

## What we're exploring

The user is building CX (customer-experience) conversational agents. Today they have a deterministic workflow system called **gambits** — small authored steps (each with optional pre/post/jump function calls, a templated user message, and a typed user-input collector). A workflow is a graph of connected gambits (5 → 1,000+ gambits in complex workflows).

A new node type is being added: the **AI-agent gambit** — an LLM-in-a-loop with tools (including send-message and collect-input), running until it reaches a goal and emits a jump decision to the next gambit. This makes the workflow a hybrid: mostly deterministic, with bounded pockets of open-ended LLM intelligence.

The user wants to understand:

1. **What "agent harness" actually means** — the term is being borrowed from coding-agent vocabulary; is it the right word for a CX runtime?
2. **The universe of relevant harness designs** — beyond their single-workflow gambit model. They have intuition about a multi-workflow "supervisor" pattern as a second harness type, and want to explore more.
3. **How to systematically reason about and enumerate harnesses** — a generative framework, not just a catalog.
4. **Latest 2025–26 thinking** specifically — both in coding-agent and CX domains.

## The eventual goal

> Build a **harness-experimentation lab** — a system that can instantiate and compare multiple harness topologies for CX, so different approaches can be A/B'd against real use cases.

## The reframe (important — happened mid-exploration)

Initially the framing was "evolve the current gambit system." Mid-exploration the user clarified the real intent:

> "I want to think of the new system completely from scratch, independent of the current system. We can definitely keep the gambit framing components (deterministic gambits and agent gambits), but that is it. The rest should stay open."

This shifted the goal from "incremental gap analysis of the existing gambit runtime" to "**design a from-scratch harness lab where the gambit framing is preserved as the node types, but everything else (control flow, state, multiplicity, etc.) is open and varied per experiment.**"

That reframe changes the keep/fold criterion for design dimensions:

> A dimension earns its place as a **knob** if it's something you'd actually *vary across experiments* to create a genuinely different harness. Otherwise it's **infrastructure** (build once, shared by every harness).

## Approach used in this exploration

1. **Four parallel deep-research threads** were launched (see files 01–04): coding-agent harnesses, CX architectures, orchestration topologies, harness terminology + bridging frameworks.
2. **A unified universe map** was built (file 06) placing 12 topologies on a 2-axis grid.
3. **An 8-dimension morphological rack** was proposed (file 07) as a generative model: a harness = one path through the rack.
4. **Three dimensions were deep-dived** (B Control Locus, E State, C Granularity — files 08, 09, 10) and the other five briefly covered (file 11).
5. **Pruning decisions** (file 12) collapsed the 8 dimensions to **3 experiment knobs + shared infrastructure** (file 13).

## Constraints kept throughout

- The gambit framing survives: **deterministic gambits + agent gambits** remain the node types.
- The lab targets **CX-domain conversational use cases**, with priority industries: finance, banking, insurance, telecom, healthcare, government, higher education.
- The runtime stack assumes Convex (already in use), which provides durable storage and scheduling for free.
- "Latest thinking" is prioritized (2025–26) — Anthropic, OpenAI, Cognition, LangChain, Sierra, Decagon, Rasa CALM are recurring reference points.
