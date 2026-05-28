# 07 · The 8-Dimension Morphological Rack

The original *generative* model proposed for the harness design space. A harness = **one path through 8 (mostly) orthogonal dimensions**. Each named pattern in the research collapses to a coordinate here. New harnesses = unexplored paths.

> **Status:** This rack was the starting point. After deep-diving B, C, E and brief passes on A, D, F, G, H, it **collapses to 3 experiment knobs + shared infrastructure** (see file 13). Keep this rack as the intermediate artifact and the source of the eventual collapse.

## The dimensions

| Dim | What it varies | Values |
|---|---|---|
| **A** | Backbone structure | Linear chain · **Graph / state-machine** · Stack (push/pop) · Free-form (no spine) |
| **B** | Control locus — who picks next step | Authored code · **LLM-proposes / code-validates** · LLM-decides |
| **C** | LLM granularity — where model touches flow | None · **Turn-understanding only** · Per-node agent · Whole-flow agent |
| **D** | Agent multiplicity | Single · Router → specialist · **Supervisor + workers** · Peer handoff / swarm · Mesh |
| **E** | State & memory | History-only · **Typed shared session state** · Stack-structured · Isolated + trace-sharing |
| **F** | Cross-turn suspension | Synchronous-only · **Durable signal / awaitable** · Re-entrant replay |
| **G** | Guardrail enforcement | Prompt-only · **Deterministic gates** · Supervisor model · Layered |
| **H** | Verification before acting | None · **Rules-based** · LLM-judge reflection · Human-approval |

(Bold = an illustrative value; not the user's choice. See files 08–11 for depth.)

## Three illustrative paths through the rack

| Dim | ★1 Single-workflow gambit harness | ★2 Multi-workflow supervisor harness | ◆ Rasa-CALM-style harness |
|---|---|---|---|
| **A** | Graph / state-machine | Graph (of workflows) | Stack (push/pop) |
| **B** | Authored code (jump is mostly static / coded) | LLM-decides | LLM-proposes / code-validates |
| **C** | Per-node agent | Whole-flow agent | Turn-understanding only |
| **D** | Single | Supervisor + workers | Single |
| **E** | Typed shared session state | Isolated + trace-sharing | Stack-structured |
| **F** | Durable signal | Durable signal | Durable signal |
| **G** | Deterministic gates | Layered | Deterministic gates |
| **H** | Rules-based | LLM-judge reflection | Rules-based |

Three distinct rows show three distinct harnesses. New harnesses = invent a new row.

## Why dimensions-first

- Every named pattern (ReAct, supervisor, CALM, your gambits) collapses to a coordinate here.
- New harnesses = pick an unexplored path → systematic, not ad-hoc.
- A/B experiments become *"change one dimension, hold the rest constant."*

## The synthesis (foreshadowing the collapse)

These 8 are not 8 independent decisions. Most of them depend on each other:

- **A** (backbone) is largely defined by C and B together.
- **F** (suspension) is *how* E persists, not a separate axis.
- **G** (guardrails) is mostly determined by C (the more generative the gambit, the heavier G must be), with the rung-4 *validate* gate (B) being a feedforward instance of G.
- **H** (verification) is the pre-side-effect gate referenced in B-stage④, with method derived from action stakes.
- **D** (multiplicity) is genuinely orthogonal to the others.

So the practical core ends up being **B, C, E** (with the rest mostly following) — and after pruning, even that simplifies to **3 experiment knobs + shared infrastructure** (file 13).

## Source

Corresponds to **Atlas tab 2 · 8 Dimensions** in `harness-atlas.html`.
