# 13 · The Lab Board — 3 Knobs + Shared Infrastructure

The collapse: **8 dimensions → 3 experiment knobs + shared infrastructure.** This is the actual experiment board the harness lab varies. Each cell of the board is a **named, runnable harness archetype**.

## The collapse

```
8 dimensions                       3 experiment knobs + infra
─────────────────                  ──────────────────────────────────────────────────────────

A backbone                         ① ROUTING CONTROL — who picks the next step?
B control-locus      ──merge──►    (B, absorbs A: free-form = no-graph extreme of routing)
C granularity        ──merge──►    ② GENERATION CONTROL — who writes the words? (C)

D multiplicity       ───────►      ③ MULTIPLICITY — one mind or many? (D)

E state              ───────►      SHARED INFRASTRUCTURE (build once, identical everywhere)
F suspension         ───────►      · durable state + stack (E + F)
G guardrails         ───────►      · guardrails (G, + parked supervisor sub-knob)
H verification       ───────►      · verification (H)
```

## The 3 knobs

### ① Routing control — *who picks the next step?*

The Dimension B ladder, now the experiment knob. Absorbs Dimension A: *free-form* is just the no-graph extreme of routing.

Values:
- **Code** — authored static edges or code-computed jumps.
- **LLM-propose / code-validate** — rung-4 mechanism (file 08). The LLM emits a constrained command; code validates against the graph.
- **LLM-free** — the LLM picks next step with no validation. Free-form harnesses use this with no graph.

### ② Generation control — *who writes the words?*

The Dimension C "generate" axis.

Values:
- **Templated** — authored messages per gambit.
- **LLM-generated** — the AI-gambit composes the reply.

### ③ Multiplicity — *one mind or many?*

The Dimension D knob.

Values:
- **Single** — one reasoning locus.
- **Supervisor + workers** — a coordinating agent calling sub-agents.

## The lab board — knobs ① × ② form the tab-6 2×2

| | ② words = TEMPLATED | ② words = LLM-GENERATED |
|---|---|---|
| **① route = CODE** | **Deterministic harness** — scripted gambit graph (today) | **RAG-answer harness** — fixed route, generated phrasing (rare) |
| **① route = LLM** | **CALM-style harness** — LLM routes, words authored | **Agentic harness** — AI-agent gambit / free-form |

…and knob ③ **Multiplicity** takes any cell from **single** (★1) to **supervisor + workers** (★2). So the full board = **this 2×2 × a single/multi toggle = 8 named archetypes**.

## Shared infrastructure (built once, used by every harness)

| Component | Description |
|---|---|
| **Durable state + stack** (E + F) | Convex-persisted per-conversation state: typed slots + dialogue stack of frames. Survives the user closing the browser. Suspend = persist; resume = load top frame's `stepCursor`. |
| **Guardrails** (G) | Deterministic gates: path constraints (rung-4 validate), allowed-tools per gambit, reversibility tiers. Intensity derived from the harness's position on knobs ① and ②. **Parked sub-knob:** supervisor model on/off. |
| **Verification** (H) | Pre-side-effect rules-based checks (grounding, ID validity, policy compliance). The repo's span-grounding eval lifted into the live runtime. Method derived from action stakes (B-stage④). |

## What this means for the lab

The lab **varies exactly 3 things** — routing control, generation control, multiplicity — and **builds everything else once** (durable state + stack, guardrails, verification). Each cell of the 2×2 (× single/multi) is a named, runnable harness archetype you can A/B.

The **gambit framing survives** intact: deterministic gambits + agent gambits are still the node types; the board just decides *how they're wired* and *who chooses/speaks*.

And ① × ③ is literally the original Universe Map (file 06): **autonomy × multiplicity**. The long exploration confirmed the two axes that started it; the value was learning *why* and *what's underneath* each.

## The 8 candidate archetypes

Combining the 4 board cells × {single, supervisor+workers}:

| # | Archetype | ① Routing | ② Generation | ③ Multiplicity |
|---|---|---|---|---|
| 1 | Single deterministic | code | templated | single |
| 2 | Single CALM-style | LLM-propose/validate | templated | single |
| 3 | Single RAG-answer | code | LLM | single |
| 4 | Single agentic (★1) | LLM-propose/validate or LLM-free | LLM | single |
| 5 | Supervisor of deterministic | code | templated | supervisor + workers |
| 6 | Supervisor of CALM | LLM-propose/validate | templated | supervisor + workers |
| 7 | Supervisor of RAG | code | LLM | supervisor + workers |
| 8 | Supervisor of agentic (★2) | LLM | LLM | supervisor + workers |

These 8 are the candidate harness archetypes the lab can instantiate and compare. Some are degenerate (5–6 may look forced); the pressure-test step (in the conclusion) is to see which actually make sense across real CX use cases.

## Source

Corresponds to **Atlas tab 8 · The Lab Board** in `harness-atlas.html`.
