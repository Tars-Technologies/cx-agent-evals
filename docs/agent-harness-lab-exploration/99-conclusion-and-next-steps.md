# 99 · Conclusion & Next Steps

The conclusion of the agent-harness-lab exploration. **Read this first** — it's the artifact to act on. The other files are reference depth.

## Where we landed

We set out to (a) understand what *"agent harness"* means in 2025–26 (especially in CX), (b) map the universe of relevant harness designs, (c) build a generative framework for enumerating harnesses, and (d) start designing a **harness-experimentation lab** that lets us instantiate and compare different harness types for CX use cases.

After deep research (files 01–04), a 12-topology universe map (file 06), an 8-dimension morphological rack (file 07), three deep-dives (files 08–10), brief passes on the remaining five dimensions (file 11), and a pruning pass (file 12), we collapsed the design space to:

> ### **3 experiment knobs + shared infrastructure**
>
> **Knob ① — Routing control** (who picks the next step?)
>   • code &nbsp; · &nbsp; LLM-propose / code-validate &nbsp; · &nbsp; LLM-free
>
> **Knob ② — Generation control** (who writes the words?)
>   • templated &nbsp; · &nbsp; LLM-generated
>
> **Knob ③ — Multiplicity** (one mind or many?)
>   • single &nbsp; · &nbsp; supervisor + workers
>
> **Shared infrastructure** (built once, identical under every harness)
>   • durable state + dialogue stack (E + F)
>   • guardrails (G, + parked supervisor sub-knob)
>   • verification (H)

The full **lab board** is `knob ① × knob ② = 2×2`, with each cell **× single/multi (knob ③)** = **8 candidate harness archetypes**:

| | ② templated | ② LLM-generated |
|---|---|---|
| **① code-route** | Deterministic | RAG-answer |
| **① LLM-route** | CALM-style | Agentic |

× **single** (★1) or **supervisor+workers** (★2).

## Key principles that survived

These are the load-bearing ideas from the exploration that the lab should preserve:

1. **Agent = Model + Harness.** The harness (routing, state, guardrails, verification, context) drives more capability than the model itself. Hold the model constant when evaluating harnesses; hold the harness constant when evaluating models.
2. **The gambit framing survives.** Deterministic gambits + agent gambits remain the node types. The knobs decide how they're wired and who chooses / speaks.
3. **Workflow with embedded agent nodes is the 2025–26 production default** for CX. The user's single-workflow gambit harness is exactly this pattern.
4. **Rasa CALM-style rung-4 control** (LLM proposes a constrained command; code validates against the graph) is the production-quality answer to *"who picks the next step?"* Make the AI-gambit's jump a tool-call enum, not a free choice. (File 08.)
5. **Two stores, not one.** Typed session state answers *"what do we know?"*; a dialogue stack answers *"where are we and how do we get back?"*. The stack is the missing piece that makes digression + resume work. (File 09.)
6. **"Understand" and "generate" are two separable knobs** — the violet "CALM sweet spot" (LLM-route, templated words) is a lighter, safer intelligence injection than going generative. **Tier B (turn-understanding overlay) is under-used in CX.** (File 10.)
7. **Convex is the durability substrate.** No Temporal / no external workflow engine needed. The dialogue-stack snapshot IS the suspension checkpoint.
8. **Multi-agent (★2) is for read-heavy fan-out and offline — NOT for the live CX turn loop.** Cognition's single-threaded rule. Keep it as an experiment, not the default.
9. **Guardrails: probabilistic vs deterministic.** Convert soft policy to hard gates. *Path constraints define every possible action explicitly.*
10. **Verification: rules-based > LLM-judge.** The repo's span-grounding eval IS a rules-based verifier — move it into the live runtime, not just offline.

## Open / parked decisions

- **Terminology** — the system is most precisely called an *"agentic workflow runtime"* with a *"harness"* inside each AI-agent gambit (file 05). The user parked this; continue using *"harness"* as colloquial shorthand.
- **Supervisor model sub-knob** — kept inside the (folded) guardrail infrastructure as an optional experiment arm for later (Sierra's 90%-accurate-supervisor-on-base claim).

## Next steps (in order)

### Step 1 — Deepen each of the 3 knobs in the context of the gambit structure

For each of **Routing control**, **Generation control**, **Multiplicity**, produce a concrete picture of:

- What **values** each knob actually takes when realized with deterministic gambits + agent gambits.
- **How it would be built** (concrete contracts: data shape, API surface, the per-gambit configuration).
- **What cases each setting handles**, with what **capacity**, **accuracy**, and **conversation flexibility**.
- **The unhappy paths** for each setting (digression, low confidence, escalation, error).

Output: a short *Knob Spec* per knob (Routing-Spec, Generation-Spec, Multiplicity-Spec). 3 short documents.

### Step 2 — Pressure-test the lab board with named archetypes against real CX use cases

Take the 8 candidate archetypes from the lab board (file 13) — possibly 4–6 of them after culling the degenerate ones — and run a **pressure test** against real CX use cases across the priority industries:

> finance · banking · insurance · telecom · healthcare · government · higher education

For each (archetype × use-case-class) cell, predict:

- **Will it handle the scenario?** Yes / partially / no, and why.
- **With what flexibility** (rigid, fluent, fully open)?
- **With what reliability** (deterministic guarantee vs probabilistic)?
- **At what cost** (tokens, latency, engineering)?
- **What's the failure mode** if it doesn't?

Output: a comparison matrix (archetypes × use-case-classes) with the predicted winner(s) per cell, plus the rationale. This is the "guess which one will work" step before building.

### Step 3 — Define the 3 knobs precisely

Lock the concrete config surface of the lab:

- The exact value sets for each knob.
- The default per knob.
- The per-gambit override surface (granularity is per-gambit, not global — file 10).
- The exact JSON / TypeScript shape a "harness config" takes.

Output: a *Lab Config Schema* document.

### Step 4 — Design the lab itself around the 3 knobs + shared-infra runtime

Now design the system that instantiates and runs harnesses from configs:

- The runtime architecture (Convex-native, gambit framing preserved).
- The shared infrastructure (durable state + stack, guardrail engine, verification engine).
- The experiment-runner (how a harness is loaded from config, how runs are recorded, how comparisons happen — borrowing from the existing LangSmith / experiment infrastructure in this repo).
- The evaluation hooks (per-cell pressure-test cases become live regression scenarios).

Output: a design document for the lab system. Eventually, an implementation plan.

## How to resume after a context clear

1. Open this file (`99-conclusion-and-next-steps.md`) first.
2. Skim `README.md` for the file index.
3. The Atlas visual at `harness-atlas.html` summarizes the same material across 9 tabs.
4. Pick up at **Step 1** above.

## Companion visual

`harness-atlas.html` — open directly in a browser. 9 tabs:
0. Index
1. Universe Map
2. 8 Dimensions
3. Control Locus (5-rung ladder)
4. Rung-4 Deep-Dive (grammar, propose, confidence, failures)
5. State & the Stack
6. LLM Granularity (4 levels + understand×generate 2×2)
7. A·D·F·G·H
8. **The Lab Board** ⭐ — the collapse to 3 knobs

## One-paragraph recap (the elevator)

We're designing a CX harness-experimentation lab from scratch. The 2025–26 field has converged on `Agent = Model + Harness`, and on the workflow-with-embedded-agent-node pattern. The CX-industry analog of this is Rasa CALM (LLM proposes constrained commands; deterministic flows execute; a dialogue stack handles digressions). Generalizing across 12 orchestration topologies and 8 candidate design dimensions, the lab's actual experiment surface collapses to **3 knobs — Routing control, Generation control, Multiplicity — plus shared infrastructure (durable state + stack, guardrails, verification) built once in Convex.** The gambit framing (deterministic gambits + agent gambits) is preserved. **Next:** deepen each knob in the gambit context (Step 1), then pressure-test 4–6 archetypes against CX use cases across our priority industries (Step 2), then define the precise config surface (Step 3), then design the lab system (Step 4).
