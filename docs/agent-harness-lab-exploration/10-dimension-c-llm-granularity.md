# 10 · Dimension C — LLM Granularity (deep-dive)

*"Where does the model touch the flow?"* The architectural fork that distinguishes a CALM-style harness (LLM understands only) from an agentic harness (LLM understands and generates). The key insight: granularity is **not one dial** — it's two separable knobs that form a 2×2.

## The 4-level ladder

| Level | LLM's job | Bot's words are… | Capability | Control / risk |
|---|---|---|---|---|
| **0 · None** | nothing — pure code | authored templates | scripted only | total control |
| **1 · Turn-understanding only** *(◆ CALM)* | interpret each turn → emit *commands*. Never writes the reply. | **authored templates** | robust to off-script; safe | high control — you know exactly what it will say |
| **2 · Per-node agent** *(★1 user's AI-gambit)* | at one node: reason + tools + **generate reply** + jump | LLM-generated (at that node) | open conversation in a bounded region | that node needs heavier G + H |
| **3 · Whole-flow agent** *(★2)* | owns the entire conversation; gambits are just tools | LLM-generated throughout | maximal flexibility | hardest to keep safe / on-policy |

## The real insight — *"understand"* and *"generate"* are TWO separable knobs

"LLM granularity" feels like one dial, but it's actually two independent decisions:

- **Routing / understanding**: code vs LLM — *who figures out what the user wants and where to go?*
- **Reply generation**: templated vs LLM — *who produces the actual words?*

Four quadrants:

| | Reply = TEMPLATED (authored) | Reply = LLM-GENERATED |
|---|---|---|
| **Routing = CODE** | **Classic deterministic gambit** — your normal gambit today. Total control, zero flexibility. | **Templated route, generated phrasing** — rare: fixed retrieval, LLM phrases the answer (a RAG answer node). |
| **Routing = LLM** | **◆ CALM sweet spot** — LLM understands & routes; words stay authored. Robust to off-script AND you know exactly what it says. **Underused in CX.** | **★1 user's AI-agent gambit** — LLM understands AND writes the reply. Most capable, biggest G/H burden. |

Your current mental model treats *"add intelligence"* = jump to the **gold cell**. But the **violet cell** (CALM) is a **lighter, safer intelligence injection** — and it's exactly what fixes the digression problem from Dimension E without going generative.

## The recommendation — three tiers inside ONE workflow (granularity is per-gambit, not global)

| Tier | What it is | Use for |
|---|---|---|
| **Tier A · Pure deterministic gambit** | Templated message, code routing. The existing 500-gambit flows, unchanged. | The scripted backbone. |
| **Tier B · Deterministic + understanding overlay** | The **same** templated gambit, but a CALM-style turn-understanding watcher runs every turn → detects digression / correction / cancel / escalate → manipulates the stack. **Makes the whole backbone off-script-robust without making any of it generative.** | Most of the workflow. The big unlock. |
| **Tier C · AI-agent gambit** | Full per-node generative agent. Heavier G + H. | The few segments where open-ended conversation is genuinely the goal. |

**Whole-flow agent** (Level 3 / ★2) isn't a separate architecture — it's the degenerate case: a workflow that is one Tier-C gambit with everything as tools.

## Why C drives G & H burden (dimensions interact)

The more the LLM **generates user-facing words**, the less you know what the bot will say → the heavier your guardrails (G) and verification (H) must be.

| Tier | Guardrail burden |
|---|---|
| **A · Deterministic** | ~none — words are pre-vetted |
| **B · Understanding overlay** | **light** — LLM only picks authored content, can't invent words → *"authored words" is itself a guardrail* |
| **C · Generative** | **heavy** — output validation, grounding checks, policy gates, supervisor |

**Tier B gets robustness that Tier C has to pay for.** This is the single biggest reason to think of Tier B as a first-class option, not just *"a less capable version of Tier C."*

## For the user's system

Don't treat the AI-agent gambit as the only way to add intelligence. Add **Tier B** (turn-understanding overlay + the stack from E) to the existing deterministic gambits → the 500-gambit workflows become digression-robust *and* stay fully controllable. Reserve **Tier C** for the genuinely open-ended segments, and accept it needs the heavier G/H.

## Source

Corresponds to **Atlas tab 6 · LLM Granularity** in `harness-atlas.html`.
