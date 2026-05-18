# Conversation Simulation — Parked / Future Ideas

> **For future Claude sessions:** When the user discusses improving the conversation
> simulation system (scenarios, user-sim fidelity, transcript grounding, persona
> generation, evaluators, drift, replay) **read this file first** to surface ideas
> that have already been brainstormed and deferred. Treat each numbered section
> as a candidate that the user explicitly liked at the time of writing but chose
> not to implement in the current scope. Re-confirm relevance before proposing.

## Status snapshot (2026-05-03)

- **Actively being designed:** Transcript Replay (validates that the simulated
  user behaves like the real user when the agent side is pinned to a recorded
  human-agent transcript). See the working spec under
  `docs/superpowers/specs/` once it lands.
- **Parked here:** the five extension ideas and the CS-team workflow sketch
  below. Each was generated in the same brainstorming session that produced
  Transcript Replay; the user wants them re-considered in a future change.

---

## Five parked extensions to the simulation system

These ideas are listed roughly in the order the user wanted to revisit them.
Each one is intended to compose with Transcript Replay rather than replace it.

### 1. Outcome-anchored scenarios

Today scenarios capture *style* (persona, anchors, length stats, exemplars).
They don't capture *what happened* in the real conversation. Each
transcript-grounded scenario should additionally tag the real outcome —
something like `resolved`, `escalated`, `churned`, `abandoned`, `info_only` —
plus the turn at which it was reached.

Then add a session-scope evaluator: "did the simulated conversation reach
the same outcome as the real one?" Combined with Transcript Replay's
match-depth score, this gives both stylistic fidelity *and* behavioral
fidelity. Linguistic grounding makes the user *sound* real; outcome grounding
makes the user *behave* real.

Implementation hooks:
- New optional field on `conversationScenarios`: `referenceOutcome`.
- New code/judge evaluator in `evaluator/` that compares run outcome to
  `referenceOutcome`.
- Outcome inference itself can be an LLM-judge pass over each transcript at
  scenario-generation time.

### 2. Empirical persona archetypes via transcript clustering

Today `persona.type` and `persona.traits` are LLM-invented per scenario.
That risks AI-flavored personas that don't match the customer's real
distribution. Instead:

1. Ingest a customer's transcripts.
2. Cluster transcripts by linguistic features — verbosity, formality,
   sentiment trajectory, code-switching, vocabulary complexity, response
   latency patterns.
3. Produce N empirical archetypes per customer/industry.
4. Scenarios *sample* `persona` from this empirical distribution rather
   than asking the LLM to invent one.

Cross-customer aggregation per industry (finance, healthcare, telecom,
insurance, education, higher-ed, government) gives industry priors that
ship in the product as defaults; per-customer extraction overrides them.

### 3. Coverage-driven scenario generation

After a transcript-grounded scenario set is built, run a coverage analyzer
over the cross-product of (intent × persona archetype × complexity ×
language × outcome). Produce a heatmap. Where the customer's transcripts
are thin, gap-fill with synthetic scenarios in those cells. Where they're
dense, downsample. Avoids overfitting the eval set to whatever the
customer happened to upload.

Output: a per-customer coverage report that doubles as a CS-facing artifact
("here is how thoroughly we exercise your bot").

### 4. Live drift monitoring

Once the agent is in production, sample N new live transcripts weekly,
run them through Transcript Replay against the current scenario set and
the current user-sim, and surface scenarios whose match-depth is dropping
over time. Two failure signals to alert on:

- Same scenarios, lower match-depth → user-sim has drifted (or the world
  has). Refresh exemplars/anchors from the new transcripts.
- New transcripts that don't map to any existing scenario → coverage gap.
  Auto-propose new scenarios for CS to review.

The eval system becomes self-correcting and gives CS a tangible
"freshness" metric to share with the customer.

### 5. Bidirectional replay

Mirror image of Transcript Replay: pin the *user* side to the recorded
transcript and let the AI agent respond freely. Compare each AI response
to the corresponding human-agent response with an LLM judge: same intent,
same information surfaced, same compliance posture? This validates the
*agent* against a real human-agent baseline.

Strong CS-facing pitch: "Here is how your bot would have handled the last
500 tickets, compared to how your top human agents actually did."

---

## CS / customer-success team workflow sketch

The user explicitly liked this part and wants to develop it further later.
Captured as a starting point, not a final plan.

**Onboarding pipeline for a new enterprise customer.** Customer ships
50–500 anonymized transcripts. Automated pipeline produces:
- (a) Empirical persona archetypes (idea 2).
- (b) Transcript-grounded scenario set.
- (c) Transcript Replay fidelity report (match-depth distribution, divergence examples).
- (d) Coverage map vs. industry baseline (idea 3).

**Scenario review session.** 30-min call with the customer's CS or ops
lead. They read 10 sampled scenarios and mark each "this looks like our
user / this doesn't / this is wrong about X." Feedback flows back as
anchor reinforcement, persona corrections, and coverage adjustments.

**Pre-deploy gate.** Before going live, the customer signs off on a target
match-depth threshold (e.g. "p50 ≥ 4 turns of fidelity on Replay").
Failing the gate routes back to scenario or anchor refinement.

**Ongoing drift loop (idea 4).** Weekly automated drift report flagged
to the CS owner. Routine triage cadence. New scenarios proposed for
CS-side approval.

**Industry templates.** Each of finance / healthcare / insurance / telecom
/ education / higher-ed / government ships with prior persona archetypes,
prior scenario seeds, and prior coverage targets. Customer-specific
extraction always overrides priors but the priors give a useful Day 0
state when transcripts are thin.

**Open design questions for the next brainstorm:**
- Who runs Replay — CS, the customer, or fully automated?
- What artifact format does the customer actually want (PDF? dashboard? Slack digest?)?
- How does CS escalate a fidelity regression to engineering?
- B2B use cases (~20–30%) — does the workflow change when end-users are
  enterprise buyers rather than retail customers?
