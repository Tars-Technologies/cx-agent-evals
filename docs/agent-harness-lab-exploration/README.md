# Agent Harness Lab — Exploration Folder

This folder captures an open-ended exploration of the **agent-harness** design space for a CX (customer-experience) agent, with the goal of designing a **harness-experimentation lab** from scratch.

Read this folder if you want to: understand what an "agent harness" is in 2025–26, see the universe of harness topologies relevant to CX, see how 8 candidate design dimensions collapse down to **3 experiment knobs + shared infrastructure**, and pick up where we left off.

## How to read this folder

The files are numbered in the order they were produced. The most important file to read first is the **conclusion**, then loop back for depth as needed.

| # | File | What's in it |
|---|---|---|
| 00 | `00-context-and-goal.md` | The framing: what we're exploring and why; the reframe (from-scratch lab, not delta from current). |
| 01 | `01-research-coding-agent-harnesses.md` | Deep web research: what "harness" means in coding agents (Claude Code, Codex, Cursor, Devin, OpenHands, SWE-bench…) and the latest 2025-26 thinking. |
| 02 | `02-research-cx-architectures.md` | Deep web research: how Sierra, Decagon, Intercom Fin, Salesforce Agentforce, Parloa, Cresta, Ada, Rasa CALM, Dialogflow CX, Copilot Studio architect their agents. |
| 03 | `03-research-orchestration-topologies.md` | Deep web research: the 12 agent-orchestration topologies, with frameworks, strengths, failure modes, and a 2-axis map. |
| 04 | `04-research-harness-term-and-bridging-frameworks.md` | Deep web research: where "harness" comes from, what it precisely means, terminology recommendation, and the workflow-vs-agent bridging frameworks (LangGraph, Temporal, ADK, AutoGen, Pydantic AI, Mastra, Burr, Inngest, Restate, DBOS…). |
| 05 | `05-terminology-and-definition.md` | The "Agent = Model + Harness" framing; the terminology verdict (parked); the words CX uses instead ("reasoning engine," "orchestration layer," "agentic workflow"). |
| 06 | `06-universe-map.md` | The 2-axis universe map of 12 orchestration topologies (autonomy × multiplicity), and where the user's two candidate harnesses (★1 single-workflow gambit, ★2 supervisor multi-workflow) sit. |
| 07 | `07-design-dimensions-rack.md` | The original 8-dimension morphological rack used to generate harness designs. |
| 08 | `08-dimension-b-control-locus.md` | Deep-dive: **Dimension B — Control Locus.** The 5-rung ladder, the rung-4 mechanism, the command grammar, three ways to implement "Propose," confidence, where rung-4 still fails. **Rasa CALM as the worked example.** |
| 09 | `09-dimension-e-state-and-stack.md` | Deep-dive: **Dimension E — State & the Stack.** Flat vs typed vs stack vs isolated; the frame anatomy; the push/pop/resume lifecycle; the E×F durable-suspension link; stack pathologies and guards. |
| 10 | `10-dimension-c-llm-granularity.md` | Deep-dive: **Dimension C — LLM Granularity.** The 4-level ladder; the understand × generate 2×2 (the real insight); the three-tier-in-one-workflow recommendation. |
| 11 | `11-dimensions-a-d-f-g-h-brief.md` | Brief passes on the other five dimensions (Backbone, Multiplicity, Suspension, Guardrails, Verification), plus the synthesis "get B/C/E right and the rest follow." |
| 12 | `12-pruning-decisions.md` | The reframe and the one-at-a-time pruning decisions: F fold, G fold (with parked supervisor sub-knob), H fold, A keep, D keep. |
| 13 | `13-the-lab-board-3-knobs.md` | The collapse: 8 dimensions → **3 experiment knobs (Routing control · Generation control · Multiplicity) + shared infrastructure.** The lab board (2×2 × single/multi) with named archetypes per cell. |
| 14 | `14-knobs-deepened-and-cx-pressure-test.md` | **Pressure test.** Gambit primer (multi-bubble gambits, rich `JumpFn`, Conversation Variables, new dialogue stack) · each knob deepened in gambit terms — Knob ① now has 4 values (`code` · `llm-classify` rung-3 · `llm-validate` rung-4 · `llm-free`) with rung-3 vs rung-4 as the flagship A/B · 8 cross-industry CX shape archetypes (S1–S8) · industry use case catalog × 7 industries · pressure-test matrix (8 shapes × 7 harness archetypes) · findings + candidate sub-knobs. |
| 99 | `99-conclusion-and-next-steps.md` | **READ FIRST.** The conclusion of the exploration: where we landed, what's open, the next concrete steps to take. |

## Companion visual

A standalone HTML atlas with the same diagrams is at:
`harness-atlas.html` (open directly in a browser; no server needed).

It has 9 tabs covering the same material visually (Universe Map → 8 Dimensions → Control Locus → Rung-4 Deep-Dive → State & Stack → LLM Granularity → The Other 5 → The Lab Board).

## Next steps (from the conclusion file)

1. **Deepen each of the 3 knobs** (Routing · Generation · Multiplicity) in the context of the **gambit structure** — how each would actually be built, what cases it handles, with what capacity/accuracy/flexibility.
2. **Pressure-test the lab board** with 4–6 named harness archetypes against real CX use cases across the target industries (finance, banking, insurance, telecom, healthcare, government, higher education).
3. **Define the 3 knobs precisely** (concrete config surface, value sets, defaults).
4. **Design the lab itself** around those 3 knobs + the shared-infra runtime.
