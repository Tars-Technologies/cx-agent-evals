# 11 · The other five dimensions — brief

B, C, E are the hard core. These five are mostly *determined* by those choices. ★1 = where the user's single-workflow harness should sit.

## Quick reference

| Dim | Spectrum (★1 = the target) | The one thing that matters |
|---|---|---|
| **A · Backbone structure** | Linear · **★1 Graph / state-machine** · Stack · Free-form | You already have the graph (gambit connections). The graph is the *static program*; the stack (E) is the *dynamic execution*. Don't conflate them — you need both. |
| **D · Agent multiplicity** | **★1 Single** · Router → spec · Supervisor + workers (★2) · Swarm · Mesh | Keep the **live turn loop single** (Cognition: single-threaded for coupled work). Multiplicity only for read-heavy fan-out & offline. Covered on the Universe Map. |
| **F · Cross-turn suspension** ★ | Synchronous-only · **★1 Durable signal / awaitable** · Re-entrant replay | **F is not separate from E — it's HOW E's stack persists.** See deep-dive below. |
| **G · Guardrail enforcement** ★ | Prompt-only · **★1 Deterministic gates** · Supervisor model · Layered (★2) | Probabilistic vs deterministic. See deep-dive below. |
| **H · Verification before acting** | None · **★1 Rules-based** · LLM-judge · Human-approval (high-stakes) | The pre-side-effect gate referenced in B-stage④. Anthropic ranking: rules-based > LLM-judge (*"not robust"*). **Your span-grounding eval IS a rules-based verifier — move it into the live harness, not just offline.** |

## F deep-dive — cross-turn suspension

The `collect-input` is inherently a suspension point. Three models:

- **(a) Durable signal / awaitable** ★1 — suspend, persist state, an inbound message resumes. Survives the user closing the browser for a day. (Temporal Signal / Restate awakeable / **Convex — you have this free**.)
- **(b) Re-entrant replay** — resume re-runs the node from the top → side-effects must be after the suspend point or idempotent (the LangGraph pitfall, restated).
- **(c) Synchronous-only** — no real cross-turn; breaks for CX the moment the user pauses.

**Takeaway:** F and E are **one mechanism** — the durable stack snapshot IS the suspension checkpoint.

## G deep-dive — guardrail enforcement

Core principle: **probabilistic compliance vs deterministic constraint.** *"Follow policy"* in a prompt is probabilistic; a code gate that blocks is deterministic.

Two kinds (Fowler's *guides vs sensors*):

- **Feedforward** — constrain what the agent CAN do: allowed-tools, enum jumps, path constraints. **The rung-4 *validate* stage IS a feedforward guardrail.**
- **Feedback** — check what it DID: output validators, grounding checks. (Overlaps with H.)

**Layered** (★2 / high-stakes): code rules → supervisor model → adversarial tests.

**G scales with C:** the more generative the gambit, the heavier G.

## The synthesis that simplifies everything

The 8 dimensions are not 8 independent decisions. **Three are the design (B control-locus · C granularity · E state/stack); five mostly follow:**

- **A** = the graph you already have (needs E's stack)
- **D** = single for the live loop
- **F** = how E persists
- **G** = the rung-4 validate gate (B) scaled by C
- **H** = the pre-side-effect gate from B-stage④

**Get B, C, E right and the rest fall into place.** That is the whole framework in one sentence.

After the pruning (file 12) and the collapse (file 13), even *that* simplifies further: the actual experiment knobs collapse to **3** (Routing control · Generation control · Multiplicity), with E/F/G/H becoming **shared infrastructure** built once.

## Source

Corresponds to **Atlas tab 7 · A·D·F·G·H** in `harness-atlas.html`.
