# Telesales Agent Playbook — Design

## Context

Vodafone Qatar (VFQ) is a customer who needs a telesales AI agent to answer
prospective-customer questions about Home Wi-Fi, Mobile Postpaid, Mobile
Prepaid, and related smaller products, and guide users toward sign-up. We
will build that agent end-to-end using the existing cx-agent-evals platform.

Beyond shipping the VFQ agent, we want a reusable **playbook** that
documents *how* to build and evaluate a sales-style agent for any new
customer using cx-agent-evals. VFQ is the first worked example; the playbook
should generalize to future customers and use cases.

## Goals

1. Produce a reusable playbook for building & evaluating a sales agent on
   cx-agent-evals — written for Tars engineers and future-Vinit.
2. Ship a working VFQ telesales agent (KB + retriever + dataset + agent
   config + eval results) that meets a defined evaluation bar.
3. Capture platform gaps surfaced during the VFQ build so they feed back
   into the cx-agent-evals roadmap.

## Non-goals

- Building new platform features in the playbook itself. Platform feature
  work is a separate detour with its own design/implementation, triggered
  by gap classification (see "Gap-handling protocol").
- Documenting upstream/downstream concerns outside the cx-agent-evals app
  (e.g., production rollout, monitoring, ops). Phase 6 will reference these
  but only as a stub until platform support exists.
- Producing a customer-facing or TAM-facing version of the playbook in v1.
  Audience may broaden later.

## Scope

**Narrow scope, hybrid gap handling.** The playbook covers using
cx-agent-evals end-to-end. When platform gaps surface during the VFQ build,
we classify them and either detour, work around, or defer (see protocol
below). We do not pre-emptively expand scope to cover topics outside the
app.

## Phases

The playbook is structured as six phases. Phases 1–5 are in v1; Phase 6 is
stubbed until platform capability exists.

1. **KB / Content** — scrape source content (e.g., vodafone.qa), clean,
   review what's in scope.
2. **Evaluation dataset** — generate synthetic questions and/or ground in
   real-world transcripts. Comes before retriever tuning so we have
   something to tune against.
3. **Retriever** — pick chunker, chunk size/overlap, embedder, vector
   store, optional reranker. Run retriever experiments. Land on a winner.
4. **Agent config** — system prompt (role description), tools (e.g.,
   address availability lookup), bind the winning retriever.
5. **Agent evaluation** — conversation simulation with scenarios and
   evaluators. Iterate on prompt/tools/retriever based on findings.
   *Platform capability still being built; v1 of the playbook uses what's
   available and notes gaps.*
6. **Ship & monitor** — production rollout, observability, post-launch
   quality watch. *Platform capability does not exist yet. v1 stubs this
   section as "TBD — pending platform support."*

Phases 5 and 6 are blockers for declaring the full playbook complete, but
not for starting work on phases 1–4.

## Per-phase section template

Every phase section in the playbook uses the same structure for navigability:

- **Goal** — what this phase produces.
- **Inputs** — prerequisites from earlier phases or external sources.
- **Decisions** — the small number of high-leverage choices in this phase.
  Each decision lists:
  - **Options** considered.
  - **How to choose** — heuristics, trade-offs, what to test.
  - **Signals of "this is working"** — quantitative where possible.
- **VFQ callout** — what we actually chose for VFQ and why (the worked
  example, written as an inline callout block).
- **Gaps & workarounds** — platform limitations hit during this phase,
  each tagged `blocker` / `workaround` / `wishlist`.

## Gap-handling protocol

Every platform gap surfaced during the VFQ build is classified before any
action is taken:

- **Blocker** — cannot ship a usable VFQ agent without this capability.
  - Pause playbook work.
  - Write a short feature request (what / why / minimal bar to unblock).
  - Detour to build the capability via the standard
    brainstorming → plan → implement flow.
  - Resume the playbook from where we paused.
- **Workaround-with-cost** — doable without the feature, but the workaround
  meaningfully hurts quality or repeatability.
  - Document the workaround in the playbook section.
  - Add a "platform improvement X would remove this workaround" note.
  - Keep moving.
- **Wishlist** — nice-to-have, no material cost to skip.
  - Log in the playbook's "Platform wishlist" appendix.
  - Keep moving.

**No detours without a classification.** This gate is what prevents the
playbook work from quietly turning into open-ended platform work.

## Per-phase workflow

For each of phases 1–5:

1. **Draft** the playbook section for this phase from principles
   (Goal, Inputs, Decisions with options/how-to-choose/signals).
2. **Apply** the draft to VFQ end-to-end for this phase — actually
   configure cx-agent-evals, run experiments, produce output.
3. **Refine** the playbook section based on friction, surprises, and gaps
   discovered during application.
4. **Commit** the playbook section and pointers to the VFQ artifacts in
   the app.
5. **Checkpoint** with the user before moving to the next phase.

## Deliverables

**Primary:** A playbook document at `docs/playbooks/sales-agent-playbook.md`.
- Generic, reusable body.
- VFQ shown as inline callouts.
- Audience: Tars engineers and future-Vinit.
- Filename uses "sales-agent" (not "telesales") so it generalizes to other
  sales-style agents without renaming.

**Secondary (artifacts of the VFQ build, living in cx-agent-evals):**
- VFQ knowledge base populated from vodafone.qa.
- One or more retriever configurations with experiment results.
- One or more evaluation datasets (synthetic + grounded as applicable).
- VFQ telesales agent configuration (prompt, tools, retriever binding).
- Agent evaluation runs with results.

The playbook links to these artifacts where relevant.

## v1 exit criteria

The playbook v1 is considered complete when all of the following hold:

1. Sections for phases 1–5 are written and validated against the VFQ run.
2. Phase 6 is stubbed with a "platform capability TBD" note and a
   reference to whatever platform tracking exists.
3. The VFQ telesales agent meets a defined evaluation bar. The concrete
   threshold is set during phase 2 (when we know what the dataset
   measures) and phase 5 (when we know what evaluators report). The bar
   itself is documented in the playbook as part of the "Signals of 'this
   is working'" content for those phases.
4. All gaps surfaced during the VFQ build are classified and recorded.

## Open questions deferred to phase work

- The concrete eval bar (numerical thresholds for retriever metrics and
  agent evaluators) is deferred until we know what the platform actually
  reports — set during phases 2 and 5.
- The exact location/format of the "Platform wishlist" appendix can stay
  inline in the playbook for now; if it grows large enough to warrant its
  own file, we move it during refinement.

## Format

- Markdown.
- Reusable principles in the main body. VFQ-specific examples in inline
  callout blocks (using a consistent visual marker so they're easy to find
  and swap when the playbook is reused for a new customer).
- Each phase is its own top-level section, structured per the per-phase
  section template above.
