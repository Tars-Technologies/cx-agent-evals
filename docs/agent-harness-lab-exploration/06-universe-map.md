# 06 · The Universe Map — 12 topologies on 2 axes

A synthesis map of the agent-harness universe, placing the 12 orchestration topologies (from file 03) on two axes that the whole field has converged on, and marking where the user's two candidate harnesses sit.

## The two axes

- **Y · Autonomy** — does the LLM drive control flow (high), or does authored code drive control flow (low)?
- **X · Agent multiplicity** — single mind ↔ many minds.

These two axes are the field's de-facto framing: "how much LLM autonomy" × "how many reasoning loci."

## The map

```
                 SINGLE-AGENT  ───────────────────────────────►  MULTI-AGENT

 HIGH         │  Single ReAct loop          Handoff/Swarm
 AUTONOMY     │  Plan-and-execute           Supervisor / orch-workers
 (LLM drives  │  Reflection / eval-opt      Hierarchical / recursive
  control)    │                             Network / group-chat
              │                             Mixture / debate
              │
              │            ★1 user's single-workflow      ★2 user's multi-workflow
              │            gambit harness                 supervisor harness
              │
 LOW          │  ◆ Workflow with embedded
 AUTONOMY     │    agent node ◄── de-facto production default
 (code drives │  Router / dispatcher        Blackboard / shared memory
  control)    │  Graph / state-machine
              │
```

## The "production consensus zone"

The bottom-left quadrant (single-agent, low-autonomy) — specifically **Workflow with embedded agent nodes** (topology #11) — has emerged as the 2025–26 production default for reliability-critical apps. Anthropic ("simplest thing that works"), Cognition (single-threaded for tightly-coupled work), LangChain (workflows vs agents), Temporal (durable workflow + agent activity), and the entire CX vendor space (Rasa, Sierra, Decagon, Copilot Studio, Agentforce) all converge here.

## Where the user's two models sit

- **★1 Single-workflow gambit harness** = a graph of deterministic gambits with one or more AI-agent gambits embedded. This is **exactly** topology #11 ("workflow with embedded agent node"), sitting in the green consensus zone. The research strongly endorses this as the right default for CX.
- **★2 Multi-workflow supervisor harness** = multiple gambit workflows coordinated by a supervisor agent. This is the multi-agent supervisor/orchestrator-workers pattern. The research is more cautious:
  - It's a real, named pattern and works for read-heavy fan-out (parallel KB/order/policy lookup) and offline triage.
  - But it's **discouraged for the *live* CX turn loop** — no global view, hard to enforce policy, ~15× token cost, Cognition's "conflicting implicit decisions" problem.
  - Worth keeping as an experiment; not the default.

## What the map confirms

1. The user's intuition (single-workflow with embedded agents) is the **consensus**, not a guess.
2. The supervisor variant is also a real named pattern, but second-tier for CX — keep as a comparison, not the default.
3. The map's two axes are very close to the **3 knobs** the rack later collapsed to (Routing + Generation control roughly = Autonomy; Multiplicity stays as itself). See file 13.

## Source

This map is a synthesis of file 03 (orchestration-topologies research) + file 02 (CX-architectures research). It corresponds to **Atlas tab 1 · Universe Map** in `harness-atlas.html`.
