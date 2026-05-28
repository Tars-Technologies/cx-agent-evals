# 12 · Pruning Decisions

The reframe that drove the pruning, the keep/fold criterion, and the decisions taken on each of the five candidate dimensions (A, D, F, G, H).

## The reframe (mid-exploration)

> *"I want to think of the new system completely from scratch, independent of the current system. We can definitely keep the gambit framing components (deterministic gambits and agent gambits), but that is it. The rest should stay open."* — the user

This shifted the purpose of "dimensions" from *taxonomy of harnesses* to **knobs of an experimentation lab**. A dimension only earns a slot if it's something you'd actually *turn* to create a genuinely different harness to compare.

## The keep/fold criterion

> **KEEP** a dimension as a knob if it's **independent** AND something you'd **vary across experiments** to get a genuinely different approach.
>
> **FOLD** it (into shared infrastructure, or into another knob) if it's either (a) **determined by other knobs**, or (b) something you'd **always build the same way** regardless — table-stakes, not a variable.

This criterion drives the keep/fold decisions below.

## Decisions

### F · Cross-turn suspension — **FOLD into shared infrastructure**

**What it is:** how the harness waits for the user across turns — survives them closing the browser. Values: synchronous-only / durable-awaitable / re-entrant-replay.

**Rationale:**
1. **Never an off-arm.** Every harness needs durable suspension; no experiment turns it off.
2. **Already decided by the substrate.** Convex provides it for free; there's nothing to compare.
3. **It's really part of E.** F is *how* E's stack persists, not an independent axis.

**Verdict:** **FOLD.** Build once in the shared runtime; drop it as a dimension.

### G · Guardrail enforcement — **FOLD into shared infrastructure (with one parked sub-knob)**

**What it is:** how policy / safety is *enforced* — prompt-only / deterministic gates / supervisor model / layered.

**Rationale:**
1. **Never shipped off.** Production CX always needs guardrails on.
2. **Intensity derived from C, not independent.** Tier-C generative gambits need heavy guardrails; Tier-A deterministic ones need almost none.
3. **Part of it is already B.** The rung-4 *validate* stage IS a feedforward guardrail.

**The one honest exception — a real sub-experiment:** *"do you add a supervisor model on top?"* Sierra claims a 90%-accurate supervisor on top of base model pushes combined accuracy toward 99%. That **is** a legitimate A/B (supervisor on vs off).

**Verdict:** **FOLD G into shared infra** (deterministic gates always on, intensity derived from C), and **park "supervisor model: yes/no"** as one specific optional experiment arm for later.

### H · Verification before acting — **FOLD into shared infrastructure**

**What it is:** the gate that checks an output *before* it acts — none / rules-based / LLM-judge reflection / human-approval. The pre-side-effect checkpoint referenced in B-stage④.

**Rationale:**
1. **Always-on, never an off-arm.** You'd never ship a CX harness that fires refunds with zero verification.
2. **Method is derived, not free.** Whether you use rules-based vs human-approval is a function of the action's stakes/reversibility (B-stage④), not an independent dial.
3. **The default is already settled.** Anthropic: rules-based > LLM-judge (*"not robust"*).
4. **The verifier already exists.** The span-based grounding eval in this repo IS a rules-based verifier — reuse it in the live runtime.

**Verdict:** **FOLD.** Verification method derived from action stakes; reuse the repo's grounding verifier.

### A · Backbone structure — **KEEP (as a graph-vs-free-form binary; expect A+B+C merge)**

**What it is:** the shape of the authored flow — Linear / Graph / Stack / Free-form.

**First, prune the values themselves.** Two of the four aren't real backbone choices:

- **Stack isn't a backbone** — it's the *runtime execution* of a graph (belongs to E). Remove from A.
- **Linear is a degenerate graph.** Fold it in.

So A collapses to a clean binary: **is there an authored control-flow graph, or is it free-form (LLM owns the flow)?**

**Rationale (keep):** that binary genuinely produces *different harness archetypes* — a graph-backbone harness (the gambit graph) vs a free-form harness (one agent, everything is a tool). Real comparison.

**The honest catch — A, B, C are three views of the same theme.**

- If **A = free-form**, then necessarily **B = LLM-decides** and **C = whole-flow agent**. Free-form *forces* the other two.
- If **A = graph**, then B and C are free to vary *within* the graph.

So A, B, C aren't three independent knobs — they're **three facets of one underlying axis** (how much authored structure drives the conversation vs the LLM). The autonomy axis from the universe map.

**Verdict:** **KEEP A** (as graph-vs-free-form), with the expectation it **merges with B and C** in the final collapse.

### D · Agent multiplicity — **KEEP (standalone, the second real shape axis)**

**What it is:** how many reasoning loci, and how they're connected — Single / Router→specialist / Supervisor+workers / Peer-swarm / Mesh.

**Rationale (keep, standalone):** this is the one remaining knob that is *genuinely orthogonal* to everything else. *"How many minds"* is independent of *"how much authored structure"* — you can have a single-agent free-form harness, a single-agent graph harness, a multi-agent graph harness, or a multi-agent free-form swarm.

Critically, **this knob IS the ★1-vs-★2 question** — the user's entire *"single workflow vs multi-workflow supervisor"* experiment lives on this axis. The lab can't compare those two without it.

**Verdict:** **KEEP D standalone.**

## Decision summary

| Dim | Verdict | Status |
|---|---|---|
| A · Backbone | KEEP (graph-vs-free-form, merge with B+C) | shape knob |
| B · Control locus | KEEP (core) | merges with A+C into Routing-control knob |
| C · LLM granularity | KEEP (core) | merges with A+B into Generation-control knob (and routing) |
| D · Multiplicity | KEEP (standalone) | shape knob |
| E · State & stack | KEEP (core) → folds to infra in the final collapse | shared infra |
| F · Suspension | FOLD | shared infra |
| G · Guardrails | FOLD (+ parked supervisor sub-knob) | shared infra |
| H · Verification | FOLD | shared infra |

## What this sets up

After the pruning, the natural collapse is: A + B + C → autonomy/structure axis (two sub-knobs: Routing control + Generation control); D → Multiplicity; E + F + G + H → shared infrastructure. See file 13 for the final lab board.
