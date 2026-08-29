# 14 · The 3 Knobs Deepened — Mechanism & CX Pressure-Test

A deeper, more concrete pass on the **3 experiment knobs** (Routing · Generation · Multiplicity) from file 13, grounded in the **gambit framing** and pressure-tested against real CX use cases across the priority industries.

This file is intentionally *before* any further design or lab-build. The point is to validate that the 3-knob framework actually carries weight across the surface area we care about, and to surface anything that needs refinement before we lock the lab's config schema (file 99 · Step 3).

> §1 is the corrected gambit model after the user clarifications. The rest of the file leans on it — read §1 carefully.

---

## §1 · Gambit primer

A **gambit** is the unit of conversation in this system. A **workflow** is a graph of connected gambits (5 → 1,000+). Two kinds exist.

### 1.1 · Deterministic gambit (the static node)

A small authored step that does exactly what it's told. Anatomy:

```
DeterministicGambit {
  id:                  GambitId
  messages:            Template[]          // 0..N message bubbles, ALL templated
                                           // each supports {variable} interpolation
                                           // AND full inline conditionals: {if expr}…{/if}, {else}, loops
                                           // a no-bubble gambit is valid (pure side-effect)
  collector?:          { name, type, validation }   // optional — see §1.4 ("no-input gambit")
                                                    // type ∈ text | number | email | phone | choice | date | file | …
  pre_functions:       Fn[]                // run before bubbles emit; can call APIs, mutate variables
  post_functions:      Fn[]                // run after collector resolves; validate, transform, side-effect
  jump:                JumpFn              // conditional code: logical (&&, ||, !) + comparison (>, <, ==, !=, …)
                                           // over Conversation Variables → returns GambitId
                                           // StaticEdge is just the degenerate JumpFn (always GambitId X)
}
```

Two things to highlight versus how I originally drew it:

- **Multi-bubble.** A gambit can emit 0, 1, or many message bubbles. All templated. Authoring is per-bubble.
- **Rich `JumpFn`.** Not just static edges — full conditional code routing using comparison + logical operators over Conversation Variables (§1.3). This is *already* a powerful form of "code routing" — Knob ① value `code` covers all of it.

### 1.2 · Agent gambit (the LLM node)

A bounded pocket of LLM autonomy. The LLM runs in a loop with tools until it reaches its goal and emits a jump. Anatomy:

```
AgentGambit {
  id:                  GambitId
  goal:                string                 // "qualify the lead", "explain coverage gap", "triage symptom"
  instructions:        string                 // system-prompt-style guidance
  tools:               Tool[]                 // configured PER GAMBIT (not global), includes:
                                              //   built-ins:  send_message, collect_input, set_variable, update_variables
                                              //   customs:    call_api, lookup_account, file_dispute, …
  allowed_jumps:       GambitId[]             // the typed enum of legal next-gambits
                                              // used by jump.mode = "llm-validate" or "hybrid"
  max_turns:           int                    // budget
  jump: {
    mode: "code" | "llm-classify" | "llm-validate" | "hybrid",
    // mode = "code"          : code-only conditional JumpFn over Conversation Variables (same as deterministic)
    // mode = "llm-classify"  : LLM picks GambitId from a list. NO validation. (RUNG 3 — today's state.)
    // mode = "llm-validate"  : LLM emits a typed command from a grammar (GoToGambit | Stay | Clarify | …),
    //                          code validates against allowed_jumps. (RUNG 4 — target.)
    // mode = "hybrid"        : conditional code chooses a branch; within branch, LLM proposes + code validates.
    proposer?:        LlmProposer,            // for llm-classify | llm-validate | hybrid
    fallback?:        Recovery                // what to do on invalid command, low confidence, or repeated failures
  }
}
```

Key properties of the agent gambit (per your clarifications):

- **Multi-bubble too.** The agent can call `send_message` 0, 1, or many times during its loop. Each invocation is a separate user-facing bubble.
- **The jump function is THE only return path** to deterministic code. Inside the loop the agent stays within the same gambit; the only way to leave is via `jump`.
- **Slot mutation is hybrid** (per your Q2 answer): the agent can call `set_variable` / `update_variables` tools mid-loop AND code validates the final variable state at exit. See §1.3 + §4.5 for full mechanics.
- **Rung-3 is today; rung-4 is target.** The lab will want to A/B these (see §2 + §7).

### 1.3 · Workflow + Conversation Variables + Dialogue Stack

A workflow is a directed graph: nodes are gambits; edges are jumps. Both static and agent gambits sit anywhere in the graph.

Two stores live alongside the graph:

#### Conversation Variables (the "what we know" store) — EXISTS today

A typed, conversation-scoped store of named values. Defined at the workflow level; populated at the conversation level. Two kinds:

- **Standard variables** — system-prefilled, immutable from gambit code. Examples: `conversation_id`, `user_id`, `channel`, `current_time`, `locale`, `last_user_message`. Every conversation has these.
- **Custom variables** — workflow-author-defined. Typed (string/number/bool/date/enum/struct). Examples: `applicant_age: number`, `intent: enum`, `loan_amount: number`, `is_returning_customer: bool`. Populated during the conversation by collectors, pre/post functions, or (in agent gambits) by `set_variable` tool calls.

Read/write paths:

| Actor | How they read | How they write |
|---|---|---|
| Static gambit's pre/post functions | direct: `vars.applicant_age` | direct mutation: `vars.applicant_age = 35` |
| Static gambit's `JumpFn` | direct: `if (vars.score > 700)` | read-only |
| Static gambit's message templates | `{applicant_age}` interpolation, `{if vars.score > 700}…{/if}` conditionals | n/a |
| **Agent gambit (mid-loop)** | LLM sees variables in context (curated) | `set_variable(name, value)` / `update_variables({…})` **tool calls** — schema-validated by code |
| **Agent gambit (exit)** | n/a | optional structured `slot_updates` in exit payload; code validates against schema and reconciles |

The hybrid path (Q2) gives the agent both real-time updates (so it can react to its own writes mid-loop) AND a final reconciliation gate so an end-of-loop snapshot is always schema-clean.

#### Dialogue Stack (the "where are we / how to return" store) — NEW infrastructure

Does **not exist** in the current gambit system. It's a piece of shared infrastructure the lab will add once (file 12 folded it into shared infra; file 09 has the full mechanics).

In one paragraph: a **dialogue stack** is a LIFO list of **frames** persisted per-conversation in Convex. A frame = `{ gambitId, localVars, stepCursor, returnTo }`. The stack answers *"where are we, and how do we get back?"* — which the Variables store can't answer. It exists so digression + resume work: user is mid-quote, asks a side question, returns to exactly where they were. Stack ops are driven by the routing knob's commands (`GoToGambit` = replace top; `Digress` = push; complete/`Resume` = pop; `Cancel` = pop+discard; `Escalate` = snapshot whole stack). See file 09 for frame anatomy, lifecycle trace, pathologies, and guards.

Both stores are **persisted in Convex** — survive the user closing the browser. Suspend = persist; resume = load.

### 1.4 · Confirmed facts about the gambit model (and decisions)

Re-stated after your clarifications. These are the facts the rest of this file rests on.

1. **Multi-bubble gambits.** Both deterministic and agent gambits can emit 0, 1, or many user-facing messages per activation. Deterministic gambits emit them from an ordered array of templates (all templated, with full inline conditionals). Agent gambits emit them via repeated `send_message` tool calls during their loop.
2. **No-input gambits.** A gambit's collector is optional. A gambit with no collector is a **no-input gambit** — it runs (sends bubbles and/or executes side effects) and the workflow advances on the jump without waiting for user input. Valid for both kinds.
3. **Per-gambit tools.** The agent gambit's tools are configured per gambit (not globally). Authority is scoped to the gambit's local concerns.
4. **Conversation Variables + Dialogue Stack.** Variables are conversation-scoped (defined at workflow level, populated at conversation level), comprising standard (system-prefilled) and custom (workflow-author-defined) typed values. The stack is **net-new infrastructure** to add — does not exist today.
5. **Routing.** Deterministic gambit's `JumpFn` supports rich conditional code (logical + comparison operators over Conversation Variables). Agent gambit's `jump` has four modes — `code`, `llm-classify` (rung 3, today's default), `llm-validate` (rung 4, the target), `hybrid` (code branch + LLM-validate within branch). The lab's Knob ① is exactly this choice (§2).
6. **Agent → deterministic handoff.** The agent gambit's `jump` is the only way out of an agent gambit back to deterministic flow. Within the loop the agent can `send_message`, `collect_input`, call custom tools, and call `set_variable` / `update_variables`. Variable mutation is hybrid: mid-loop tool calls (schema-validated) + final exit-payload reconciliation.
7. **Template expressiveness.** Templates support full inline conditionals (`{if expr}…{/if}`, `{else}`, possibly loops). This is more expressive than flat `{variable}` interpolation and significantly raises the bar for switching to LLM-generated mode for conditional messaging (§3).

These are no longer "assumptions" — they are the gambit-model contract the lab will design against.

---

## §2 · Knob ① — Routing control (deepened)

**The question:** for each gambit, *who decides what gambit runs next?*

### 2.1 · Four values (updated from three)

| Value | What it means at gambit level | Where it lives today |
|---|---|---|
| **`code`** | Conditional `JumpFn` over Conversation Variables (logical + comparison ops). Static edge is the degenerate case. | Deterministic gambits today. Agent gambits *can* use it. |
| **`llm-classify` (rung 3)** | LLM picks a `GambitId` from a list. **No validation.** No structured recovery commands. | Agent gambits' current default. |
| **`llm-validate` (rung 4)** | LLM emits a typed command from a grammar (`GoToGambit \| Stay \| Clarify \| Digress \| Resume \| Cancel \| Escalate \| CannotHandle`). Code validates against `allowed_jumps` and grammar. | The target. New for agent gambits. |
| **`llm-free`** | LLM picks any next action including off-graph; only via tools. No graph constraint. | Rare in CX; included for completeness. |

The **rung-3 → rung-4 upgrade is the centerpiece A/B** for the lab. Today's agent gambits are rung 3 (you've called it "categorization done by the LLM itself"); rung 4 is the planned upgrade. They produce qualitatively different conversations.

### 2.2 · Per-gambit configuration surface

```ts
routing: {
  mode: "code" | "llm-classify" | "llm-validate" | "hybrid" | "llm-free",
  // mode = "code"          : provide jump_fn: (vars) => GambitId
  // mode = "llm-classify"  : provide candidates: GambitId[], proposer: LlmProposer
  // mode = "llm-validate"  : provide allowed_jumps: GambitId[], grammar: CommandGrammar,
  //                                  proposer: LlmProposer, validator: GrammarValidator
  // mode = "hybrid"        : provide jump_fn (which can return GambitId OR "delegate-to-llm"),
  //                                  + the llm-validate config for the delegated branch
  // mode = "llm-free"      : no allowed_jumps; agent picks via tool calls
  fallback?: Recovery,  // for llm-* modes: what to do on invalid command, low confidence, repeated failures
                        // options: clarify (ask user), escalate (handoff to human),
                        //          fallback_gambit (jump to a safety gambit)
}
```

The mode is per-gambit, not per-workflow. A workflow can mix all five: deterministic gambits with `code`, agent gambits with `llm-validate`, a top-level intent router on `hybrid`, and one "wildcard" gambit on `llm-free` for genuine discovery.

### 2.3 · The rung-3 vs rung-4 mechanism contrast

Side-by-side, the difference is sharper than it sounds.

```
RUNG 3 (today)                                 RUNG 4 (target)
────────────────────────                       ───────────────────────────────
1. Agent loop completes goal                   1. Agent loop completes goal
2. Code asks LLM: "given conversation,         2. Code asks LLM with TYPED GRAMMAR:
   pick one of [next_gambit, …]"                  "emit one of these commands":
                                                    GoToGambit("dispute_charge") |
                                                    Stay |
                                                    Clarify("which transaction?") |
                                                    Digress("policy_lookup") |
                                                    Cancel |
                                                    Escalate("reason")
3. LLM returns a GambitId string                3. LLM returns structured command
4. Code: jump.                                  4. Code: validate command against grammar
   (no validation — if LLM hallucinates a          + allowed_jumps. If invalid → fallback.
   non-existent gambit, runtime crashes              If valid → execute via stack op.
   or silently picks something wrong)            (rich recovery: Clarify asks user,
                                                  Digress pushes frame, Cancel pops, etc.)
```

The rung-4 grammar's value is twofold: **(a)** the LLM cannot emit a non-existent gambit (typed enum); **(b)** the LLM can express things rung-3 can't (clarify, digress, escalate are first-class). This is what makes digression + resume + recovery actually work.

### 2.4 · Concrete example — banking "card lost"

User: *"I lost my card and I think someone used it for $400 at a gas station yesterday."*

A static gambit `card_lost_intake` is asking for the card number. The user has thrown in a second intent (dispute the charge).

- **`code`** routing: gambit's `JumpFn` waits for a valid card number. The second sentence is just noise. The next gambit's collector chokes on `"I think someone used it for $400…"`. Recovery: send the user back to the menu. **Result:** user repeats themselves; second intent lost.
- **`llm-classify` (rung 3)** on an agent gambit: LLM sees the message and picks one of `[confirm_card_block, dispute_charge, escalate]`. Picks `dispute_charge`. But the runtime has no notion of the unfinished `card_lost` flow — `card_lost_intake` is just replaced. **Result:** dispute handled; user has to re-initiate card-lost later from scratch. Better than `code` but not great.
- **`llm-validate` (rung 4)** on an agent gambit: LLM emits `Digress("dispute_charge")`. Runtime pushes `card_lost_intake @ stepCursor=awaiting_card_number` onto the stack, runs the dispute flow, pops back to *exactly* where `card_lost_intake` was. **Result:** both intents handled, no repetition. The actual customer-quality outcome.
- **`llm-free`** routing: LLM directly calls `lookup_recent_transactions`, then `freeze_card`, then `file_dispute`. **Result:** powerful but unauditable; hard to certify for compliance.

The cost of rung-4 over rung-3 is real (grammar authoring, the validator, frame management) but the conversational difference is the difference between *"user has to repeat themselves"* and *"user can be a human."*

### 2.5 · What each setting handles

| Mode | Best for | Capacity | Accuracy | Flexibility |
|---|---|---|---|---|
| `code` | Scripted compliance flows, well-defined branches, hot paths | Author-bounded | 100% on authored paths; 0% off-path | None (by design) |
| `llm-classify` (rung 3) | Quick LLM routing without grammar overhead; legacy compat | Bounded by candidate list | Classifier accuracy; degrades silently on hallucination | Single-intent only — no digression |
| `llm-validate` (rung 4) | Multi-intent CX turns, digression, fuzzy users, branchy decision trees | Grows with `allowed_jumps` × grammar | High when LLM has context; correctness ≈ command-fidelity | Medium-high — bounded by graph + grammar |
| `hybrid` | Code does what code is good at (hard rules, eligibility gates); LLM does the rest | Author-bounded for code branches; grammar-bounded for LLM branches | Highest practical | Highest practical |
| `llm-free` | True discovery, brainstorming, exploratory tasks | Bounded only by tools | Probabilistic; hard to certify | Maximal |

### 2.6 · Unhappy paths

- **`code` → user goes off-script.** Conditional fails to match user input → wrong branch → user stuck. Mitigation: a global "didn't understand" jump-back gambit per workflow.
- **`llm-classify` → hallucinated GambitId.** Runtime can crash or silently mis-route. Mitigation: at minimum, post-LLM string-check against candidates; if invalid, escalate. (This is essentially partial rung-4.)
- **`llm-validate` → invalid command.** Fallback to `Clarify` (ask user to rephrase) or `Escalate` after N tries. Log the proposed command for review.
- **`llm-validate` → valid command but wrong intent.** Hardest failure mode — code is happy, user isn't. Mitigation: ground proposal in conversation context; add a confirm-step for high-stakes jumps ("are you sure you want to dispute $400?").
- **`hybrid` → branch mismatch.** Code branch routes to LLM-validated branch but the grammar there doesn't cover the case. Mitigation: branch-specific grammars + a uniform `CannotHandle` escape.
- **`llm-free` → hallucinated tool call.** Guardrail + verification (file 12) catch pre-side-effect. Escalate on repeated failure.

---

## §3 · Knob ② — Generation control (deepened)

**The question:** for each gambit, *who composes the user-facing message bubbles?*

### 3.1 · Two values, recast for multi-bubble + full inline conditionals

| Value | What it means at gambit level | Today's reality |
|---|---|---|
| **`templated`** | Ordered list of 0..N message bubbles, each a template. Full inline conditionals supported: `{if expr}…{/if}`, `{else}`, loops, expressions over Conversation Variables. | Deterministic gambits today. |
| **`llm`** | The agent calls `send_message` 0..N times during its loop. Each call composes a bubble grounded in context, brief, persona, sources. | Agent gambits when they send. |

**Important correction from your Q3 answer:** because templates support full inline conditionals, *"templated"* generation is significantly more expressive than I'd given it credit for. Many use cases I would've pushed to `llm` mode can stay templated:

```
"Hi {first_name},

{if vars.account_balance < 0}
Your account is overdrawn by ${abs(vars.account_balance)}.
You'll need to add funds to avoid the overdraft fee of ${vars.overdraft_fee}.
{else if vars.account_balance < 50}
Your account is low (${vars.account_balance}).
{else}
Your account is in good standing (${vars.account_balance}).
{/if}

{if vars.is_premium}
As a premium member, your overdraft fee is waived once per year.
{/if}"
```

That's all one templated gambit, one bubble. The bar to leave `templated` for `llm` is therefore **expressiveness of natural language** (paraphrase, summarize, condole, compare in prose) — not branching.

### 3.2 · Per-gambit configuration surface

```ts
generation: {
  mode: "templated" | "llm",
  // mode = "templated":  provide bubbles: Template[]            // 0..N templates, each with full conditionals
  //                              fallbacks: { [error]: Template }
  // mode = "llm":        provide brief: string,
  //                              persona: string,
  //                              grounding_sources: SourceRef[],
  //                              required_disclosures: string[],     // auto-injected if missing
  //                              verifier: VerifierFn,               // pre-send check
  //                              max_bubbles: int                    // upper bound on send_message calls
}
```

### 3.3 · The mechanism — what `llm` generation actually looks like

```
Inside the agent loop, when the agent decides to call send_message:

1. Build the generation context:                                       (code)
   - brief + persona
   - relevant conversation history
   - Conversation Variables in scope (curated)
   - grounding sources (retrieved chunks, account data, …)
   - mandatory disclosures (compliance, legal)
2. Call LLM with structured prompt.                                    (LLM)
3. Pre-send verification (H, file 12):                                 (code)
   - grounding check (the repo's span-grounding eval, lifted live)
   - disclosure presence check (auto-inject if missing)
   - PII / regulatory filter
   - tone classifier (optional)
4. If verification passes → emit bubble. If fails →
   either retry (with critique) or fallback template.                  (code)
5. Loop continues; agent may call send_message again.
```

### 3.4 · Concrete example — insurance "explain premium"

User: *"Why is my premium higher than last year?"*

- **`templated`**: the gambit has one or more bubbles like:
  ```
  Your premium changed by ${vars.premium_delta} ({if vars.premium_delta > 0}increase{else}decrease{/if})
  from last year.
  {if vars.top_factors.length > 0}
  The main {if vars.top_factors.length == 1}factor was{else}factors were{/if}:
  {for factor in vars.top_factors}
  - {factor.name}: {factor.direction} {factor.impact_pct}%
  {/for}
  {/if}
  ```
  Works **only if** `vars.premium_delta` and `vars.top_factors` are pre-computed by a pre-function. Misses nuance ("why specifically did my driving record affect it") unless every nuance is pre-computed.
- **`llm`**: agent gambit with `brief = "Explain the premium change in plain language, grounded ONLY on the rate-factors structured data passed in context. Address: top 2 factors by impact, comparison to prior year, plain-language reason for each. Required disclosure: rate-change-disclaimer-2024."` Verifier checks: (a) every claim is supported by a rate-factor row; (b) disclaimer present.

Note that with full inline conditionals, the templated version handles a lot more variation than the previous draft of this file credited.

### 3.5 · Cases handled

| Mode | Best for | Risks |
|---|---|---|
| `templated` | Compliance disclosures, KYC questions, scripted CTAs, brand-voice exact match, transactional confirmations, critical legal/medical wording, multi-bubble flows where each bubble is well-defined | Combinatorial explosion if you try to template open-ended explanation; rigid against unanticipated user phrasing |
| `llm` | Open-ended explanations, summaries, condolences, dynamic comparisons, multilingual on the fly, prose recaps, paraphrase / clarify in the user's words | Hallucination, off-brand voice, missing disclosure, regulatory violation, prompt injection, cost/latency |

### 3.6 · Unhappy paths

- **`templated` → user asks something the templates don't cover.** Mitigation: small library of conditional template fragments + a fallback gambit ("I can answer that — let me connect you with…").
- **`llm` → hallucination.** Mitigation: rules-based grounding verifier; refuse-if-ungrounded.
- **`llm` → missing disclosure.** Mitigation: auto-injection of disclosure strings post-generation (templated tail) rather than relying on the LLM.
- **`llm` → off-brand tone.** Mitigation: persona examples in brief; optional tone-classifier verifier.
- **`llm` → cost/latency blown.** Mitigation: `max_bubbles` cap; templated fallback when budget exceeded.

---

## §4 · Knob ③ — Multiplicity (deepened)

**The question:** *for a given conversation, how many reasoning loci are active?*

### 4.1 · Two values (with possible third — see §8 finding)

| Value | What it means at workflow level | Today's reality |
|---|---|---|
| **`single`** | One workflow per conversation. All gambits in one graph. One LLM call per turn (if any). | Your ★1 today. |
| **`supervisor`** | A root **supervisor** (typically an agent gambit) routes the conversation to one of N **worker workflows**, each a full mini-harness with its own gambits, Variables, and Stack. Returns to supervisor on worker exit. | Your ★2 candidate. |

A possible third value (`delegated-single`) is discussed in §8.

### 4.2 · Per-workflow configuration surface

```ts
workflow: {
  topology: "single" | "supervisor",
  // topology = "single":     provide root_gambit: GambitId, gambits: Gambit[]
  // topology = "supervisor": provide supervisor: AgentGambit,                       // root of conversation
  //                                  workers: { id, workflow_ref, knob_config }[],  // each is a full workflow
  //                                  handoff_contract: HandoffSchema                // typed payload supervisor↔worker
}
```

Critically, **each worker can have its own Knob ① and Knob ② settings.** That's a powerful property of supervisor topology: a mortgage worker might use templated + `code` routing for compliance; an investment-advisor worker might use `llm` + `llm-validate`.

### 4.3 · The supervisor + worker mechanism

```
1. User message arrives at supervisor.                          (code)
2. Supervisor's routing fires (typically llm-validate):         (LLM)
   → emits HandoffTo(worker_id, context_payload)
3. Code validates worker_id is in workers.                      (code)
4. Push frame for supervisor onto the dialogue stack;           (code)
   instantiate worker with context_payload as seed Variables;
   run worker's root gambit.
5. Worker runs to completion or hands back                      (worker harness)
   (via WorkerExit(result_payload, suggest_next)).
6. Code pops worker frame; supervisor sees result;              (code)
   continues routing or hands off to another worker.
```

The supervisor does **not** participate in worker turn-loops — it sees only the worker's exit payload. This is Cognition's single-threaded rule applied at the supervisor layer.

### 4.4 · Concrete example — multi-product bank

User: *"I want to open a savings account and also need help with my mortgage statement."*

- **`single`**: one giant workflow. Top-level menu gambit (deterministic or `llm-validate`) detects intent and jumps into the relevant sub-tree. Both intents handled in the same graph; digression managed by the dialogue stack. Works fine up to ~100s of gambits.
- **`supervisor`**: supervisor agent gambit classifies intent. Hands off to `savings_account_open` worker first; returns; then hands off to `mortgage_statement` worker. Each worker is independently deployable, independently versioned, owned by different teams. Each worker has its own knob settings.

### 4.5 · Cases handled

| Topology | Best for | Risks |
|---|---|---|
| `single` | Focused single-product flows, narrow domains, simple multi-intent (handled by stack), tight latency requirements | Unwieldy past ~hundreds of gambits in one graph; intent-classification at top-level becomes the bottleneck; can't deploy parts independently |
| `supervisor` | Multi-product / multi-domain CX, team boundaries match worker boundaries, independent deployment lifecycles, A/B-able workers, escalation chains | Handoff context loss; supervisor picks wrong worker; worker exit payload doesn't map cleanly; +1 LLM call per turn |

### 4.6 · Unhappy paths

- **Supervisor misroutes.** Confidence threshold; supervisor asks a `Clarify` if low confidence (rung-4 command).
- **Context loss across handoff.** Structured `handoff_contract` (typed payload, not raw history); shared Conversation Variables with "carry-over" designation.
- **Worker exits with wrong `suggest_next`.** Supervisor re-evaluates with full context post-worker; worker's `suggest_next` is advisory.
- **Latency budget blown.** Cache supervisor's routing for follow-ups inside same worker; only re-invoke on genuine new-intent signals.

---

## §5 · Eight CX shape archetypes (cross-industry)

Before pressure-testing, abstract from industries to **conversational shapes** — what determines the right harness is the shape of the conversation, not the industry vertical. The same shape recurs across banking/healthcare/gov/etc.

| # | Shape | What it looks like | Examples across industries |
|---|---|---|---|
| **S1** | **Guided form-fill with validation** | Long structured intake; every field validated; some conditional branching; compliance-critical | Insurance quote-and-bind · Bank account opening · Gov benefits eligibility · College application · Healthcare patient intake |
| **S2** | **Decision-tree triage** | Diagnostic / classification path → bounded action set; mostly deterministic outcomes | Telecom troubleshoot · Healthcare symptom triage · IT helpdesk · Insurance claim-type routing · Bank dispute-type classifier |
| **S3** | **Authoritative explanation / disclosure** | Ground-truth-only Q&A on regulated content; explain *correctly*, no hedging, no advice | Tax rules · Insurance coverage explanation · Lab result read-back · Financial aid eligibility · Drug interaction warnings |
| **S4** | **Multi-intent service desk** | Multi-product/multi-domain; intent routing then narrow execution | Telecom omnibus · Bank omnibus · Gov 311 · Healthcare front-door (appointments+billing+results) · Higher-ed student services |
| **S5** | **High-empathy intake** | Emotional context + structured information gathering; tone matters as much as content | FNOL (insurance) · Bereavement (any) · Mental health intake · Disability benefits application · Complaint intake |
| **S6** | **Status check** | Narrow lookup; ID + answer; nothing else | Claim status · Application status · Refund status · Lab result available? · Appointment confirmation · Document received? |
| **S7** | **Open-ended consultative / advisory** | Exploratory; "tell me about X"; comparison; "should I"; brainstorm | College program selection · Insurance product comparison · Investment "should I" (heavily regulated) · Telecom plan-fit advisory |
| **S8** | **Retention / save-the-customer** | Emotional + negotiation + offer surface; gather reason → offer → handle objection → close or escalate | Cancel flows (telecom/insurance/bank/streaming) · Renewal-at-risk · Churn rescue · Tuition payment-plan negotiation |

These 8 cover the vast majority of CX conversations in the 7 priority industries.

---

## §6 · Industry use case catalog (condensed)

Each cell tags the use case with its **dominant shape** (S1–S8). Some flows mix shapes; the dominant one is listed.

| Industry | Use case | Shape | Notes |
|---|---|---|---|
| **Banking** | New account opening | S1 | Heavy KYC; document upload; conditional on residency |
|  | Card lost/stolen | S2 → S6 | Triage path then status |
|  | Dispute a transaction | S5 + S1 | Empathy intake then structured form |
|  | Loan pre-qualification | S1 | Income, debt, collateral; conditional |
|  | International transfer Q&A | S3 | Regulated; correct fees/rates required |
|  | Multi-product front door | S4 | Routes into the others |
|  | Account closure | S8 | Retention play |
| **Finance / Wealth** | Investor onboarding | S1 | Risk profile + KYC |
|  | "Should I invest in X?" | S3 | **Must NOT give advice** — explain only |
|  | Tax doc retrieval | S6 | ID + send |
|  | Death-of-account-holder | S5 | High empathy + structured |
|  | Portfolio rebalance Q&A | S3 / S7 | Explanation borderline advisory |
| **Insurance** | Quote-and-bind | S1 | The canonical S1; long, conditional |
|  | FNOL | S5 | The canonical S5 |
|  | Claim status | S6 | |
|  | Renewal upsell | S8 → S7 | |
|  | Coverage question ("am I covered for X?") | S3 | |
|  | Add a vehicle/dependent | S1 (short form) | |
|  | Cancel policy | S8 | |
| **Healthcare** | Appointment booking | S1 / S2 | Triage then book |
|  | Refill prescription | S6 | Often pure status/action |
|  | Symptom triage | S2 + S3 | Bounded outcomes ("see a doctor / 911") |
|  | Insurance/billing question | S3 / S6 | |
|  | Lab results explanation | S3 | Regulated; correct only |
|  | Prior-auth status | S6 | |
|  | Enrollment in care program | S1 + S5 | |
| **Government** | Benefits eligibility check | S1 + S3 | Long form + correct rule application |
|  | License/permit renewal | S6 / S1 | Mostly status, sometimes form |
|  | Tax filing question | S3 | Rules but no advice |
|  | Service status / wait time | S6 | |
|  | Document upload + status | S1 + S6 | |
|  | Complaint / grievance intake | S5 | |
| **Telecom** | New service activation | S1 | |
|  | Troubleshoot | S2 | The canonical S2 |
|  | Plan change / upsell | S7 + S8 | |
|  | Bill explanation / dispute | S3 + S5 | |
|  | Roaming / international add-on | S3 / S1 | |
|  | Cancel service | S8 | The canonical S8 |
| **Higher Education** | Admissions Q&A | S3 / S7 | |
|  | Application status | S6 | |
|  | Financial aid Q&A | S3 | Lots of "it depends" |
|  | Course registration | S1 + S2 | |
|  | Campus services | S4 | Multi-domain front door |
|  | Tuition payment plan | S8 | Retention-flavored |

**Observation:** S1, S3, and S6 dominate. S5 appears in insurance/healthcare/gov but rarely elsewhere. S7 is the most LLM-hungry shape and the rarest in regulated industries — and the most native to higher ed and product comparison.

---

## §7 · Pressure-test matrix — 8 shapes × 7 harness archetypes

Seven viable harness archetypes (one more than the previous draft, to make the rung-3 vs rung-4 A/B explicit):

- **H1** — Single Deterministic (`code` route, `templated` gen, single)
- **H2a** — Single agent gambit at routing with **rung-3** (`llm-classify`, `templated` gen, single)
- **H2b** — Single CALM-style **rung-4** (`llm-validate`, `templated` gen, single)
- **H3** — Single RAG-answer (`code` route, `llm` gen, single)
- **H4** — Single Agentic (`llm-validate` or `llm-free`, `llm` gen, single)
- **H5** — Supervisor of Deterministic (`code` workers, `templated`, supervisor)
- **H6** — Supervisor of Agentic (LLM-throughout workers, supervisor)

Cell legend: ✅ strong fit · 🟡 workable with caveats · ❌ poor fit · 💀 anti-pattern.

| Shape | H1 Det | H2a rung-3 | H2b rung-4 (CALM) | H3 RAG-ans | H4 Agentic | H5 Sup-Det | H6 Sup-Agt |
|---|---|---|---|---|---|---|---|
| **S1 Form-fill** | ✅ Canonical | 🟡 LLM-routing the intake = risky; classifier may mis-jump | ✅ + handles digression cleanly | 🟡 LLM phrasing of field prompts adds little; risk of off-script | 🟡 Over-engineered for pure intake | ✅ Per-form workers | 💀 Agentic workers free-forming intake = compliance risk |
| **S2 Triage** | ✅ If outcomes finite | 🟡 Routing accuracy ≈ classifier; no recovery commands | ✅ Better — handles fuzzy descriptions + clarify | 🟡 Helpful for explaining diagnosis, not routing | ❌ Loss of guarantee on routing | ✅ Per-domain triage workers | 🟡 Only if outcomes still gated by code |
| **S3 Authoritative explanation** | ❌ Templates can't cover every Q (even with conditionals) | ❌ Routing isn't the bottleneck | ❌ Same — routing isn't bottleneck; generation is | ✅ Canonical — code-route + grounded LLM-gen | 🟡 More flexible, harder to certify | ❌ | ✅ Per-domain (source-partitioned) workers |
| **S4 Multi-intent service desk** | 🟡 Menus break past ~10 intents | 🟡 Works for narrow intent set; no clarify/digress | ✅ LLM-routes intents with grammar; clarify if ambiguous | ❌ Generation isn't bottleneck | 🟡 Powerful but unaudited | ✅ Workers per domain | ✅ Canonical — multi-team multi-product |
| **S5 Empathy intake** | ❌ Scripted empathy reads as cold | ❌ Routing's fine; words still scripted | 🟡 Routing handled; generation still scripted = limited warmth | ✅ Code-routes through intake; LLM warms phrasing | ✅ Agent adapts tone in real time | ❌ | 🟡 Supervisor warms → structured worker |
| **S6 Status check** | ✅ Canonical — ID + lookup + reply | ❌ Over-engineered | 🟡 LLM helps with messy user input ("when's my thing coming?") | ❌ Over-engineered | ❌ Over-engineered | 🟡 Only if status sources span domains | 💀 Over-engineered |
| **S7 Advisory** | ❌ Impossible to script | ❌ Routing isn't bottleneck | ❌ Same — generation is | 🟡 Code-route too narrow | ✅ Canonical — agent + grounded tools | ❌ | ✅ Per-domain advisory workers |
| **S8 Retention** | ❌ Scripted offers feel transactional | 🟡 LLM picks branches but words feel cold | 🟡 LLM detects pain, scripted offers | 🟡 LLM phrases offers | ✅ Agent reads cues, picks offers | ❌ | ✅ If retention strategies vary per product line |

### 7.1 · The "money cells"

Five cells where the harness choice matters most:

1. **S1 × H1 vs H2b (rung-4 CALM).** Today's H1 works but breaks on digression and multi-intent. H2b keeps structured intake AND handles side-questions. **The most important upgrade for existing static workflows.** Cost: LLM call per transition; latency ~300–800ms; needs `allowed_jumps` authoring + grammar.
2. **S1/S2/S4 × H2a (rung-3) vs H2b (rung-4).** ⭐ **The flagship A/B for the lab.** Today's agent gambit is rung 3. The whole question of "is the grammar overhead worth it?" lives here. Hypothesis: yes for anything with digression or genuine fuzziness; no for narrow finite-choice routing.
3. **S3 × H3.** RAG-answer archetype. Highest leverage in finance/insurance/gov/healthcare where regulated explanations dominate. Code-route to the right doc, LLM phrases grounded answer with rules-based verifier. Cost: grounding eval at runtime; refusal-when-ungrounded UX.
4. **S4 × H2b vs H6.** Single CALM at top (H2b) vs Supervisor of Agentic (H6). H2b scales well to ~50 intents in one graph; H6 wins past that or when teams own domains. Trade: H6 has team-boundary scalability; H2b has lower latency and simpler debugging.
5. **S5 × H4.** Single agentic with tone-adaptive generation. The case where ditching templates actually pays off. Risk: tone misfires; mitigation: persona examples + tone classifier.

### 7.2 · The "anti-pattern cells"

- **S1 × H6** — agentic workers free-forming a regulated intake is how you get compliance incidents.
- **S6 × H6** — two LLM calls per turn for "what's my claim status?" is a latency/cost own-goal.
- **S2 × H4** — letting agent freely decide medical/financial triage erodes the deterministic guarantee that makes triage work.

### 7.3 · The "always-on cells"

- **S6 × H1** — status checks should always be deterministic for the lookup itself; the framing conversation around it may use LLM, but the lookup is code.
- **S1 × deterministic-core** — even when H2b is the harness, intake field validation is code, not LLM.

---

## §8 · What we learned about the 3 knobs

Pressure-testing surfaced findings. Some confirm the 3-knob model; some are refinements; some are candidate sub-knobs that may need to come back in before we lock the lab.

### Confirmations

1. **The 3 knobs are real and orthogonal.** No two cells in the matrix produce identical predictions. Each knob meaningfully shifts the outcome.
2. **Per-gambit knob settings are the right granularity.** S3 lives next to S1 inside the same workflow — global per-workflow settings would be wrong. Knob settings are per-gambit.
3. **The rung-3 → rung-4 upgrade is the highest-impact intervention.** It uplifts S1, S2, S4 — three of the most common CX shapes — without sacrificing determinism. This validates file 08's bet on rung-4 as the production answer.

### Refinements

4. **Knob ① has 4 values, not 3.** Adding `llm-classify` (rung 3) as a distinct value from `llm-validate` (rung 4) is essential — they're qualitatively different conversations and the lab needs to A/B them directly. Adding `hybrid` as a fifth value also makes sense for production realism. *Update to file 13.*
5. **"Templated" generation is more expressive than originally drawn.** Full inline conditionals (`{if}/{else}/{/if}`, loops, expressions over Variables) handle a lot of cases that would otherwise push to `llm` mode. The bar to switch to `llm` is therefore **natural-language expressiveness** (paraphrase, summarize, condole) — not branching.
6. **"LLM-free" routing is rarely the right answer in CX.** Only S7 genuinely wants it, and even there it's bounded by tool surface. Keep it in the knob for completeness but expect it to be the rarest pick.
7. **Multi-bubble per gambit changes mental model.** The clean model: a normal gambit always emits templated bubbles (0..N), an agent gambit always emits LLM bubbles (0..N). To mix templated + LLM in the same logical interaction, chain a deterministic gambit → agent gambit → deterministic gambit (the natural way to inject pre-disclosures, agent body, post-disclosures).
8. **Multiplicity may need a third value: `delegated-single`.** A workflow that *uses* RAG or external services as **tools** (delegated to a stateless service) without instantiating a separate worker harness is neither pure `single` nor `supervisor`. Most S3 (explanation) flows are this. Worth marking explicitly so the lab can A/B it against true `single` and true `supervisor`.

### Net-new infrastructure decisions

9. **The dialogue stack is net-new.** Today's gambit system has Conversation Variables but no stack. The lab must add it (per file 09). Without it, rung-4's `Digress`/`Resume` commands have nothing to operate on, and one of the rung-4 upgrade's biggest wins (digression + resume) doesn't land.
10. **Agent slot-mutation path is "hybrid."** Per Q2: tool calls mid-loop (`set_variable`, schema-validated) + structured exit-payload reconciliation. Folds into shared infrastructure (not a knob).

### Candidate sub-knobs to consider (later)

11. **Verification stringency** — for S3, S5, S7, the verifier's pass-bar (refusal-if-ungrounded) materially changes UX. Folded into shared infra today; may deserve a `none / soft / hard / human-approval` sub-knob.
12. **Disclosure-injection mode** — for regulated industries, "auto-template tail" vs "LLM-instructed" vs "verified-presence" is a real variable. Currently absorbed into Knob ②; revisit if pressure-test cases keep splitting on it.

### Open questions for the user (do not need answers now)

- Are there CX use cases in your customer base that don't fit any of S1–S8? If so, which?
- Rough distribution of S1 vs S3 vs S4 vs others in your current product traffic? That determines which lab cells deserve the most engineering effort.
- For S4, do customers actually want team-owned separate worker workflows, or is the demand for a single unified graph?
- For S7 (advisory), is "the right answer is always to escalate to human" acceptable for the lab's first cut, or is fully-LLM-driven advisory in scope?

---

## §9 · What this leaves us with for Step 3 (define knobs precisely)

After this pressure-test, the lab config schema can confidently include:

```ts
type GambitKnobs = {
  routing: {
    mode: "code" | "llm-classify" | "llm-validate" | "hybrid" | "llm-free"
    // + per-mode config (allowed_jumps, grammar, proposer, fallback, …)
  }
  generation: {
    mode: "templated" | "llm"
    // + per-mode config (bubbles, brief, persona, sources, verifier, max_bubbles, …)
  }
}

type WorkflowKnobs = {
  topology: "single" | "supervisor" | "delegated-single"   // ← finding #8
  // + per-topology config (root_gambit, workers, handoff_contract, …)
}

// Conversation-scoped infrastructure (shared, built once)
type ConversationVariables = {
  standard: { conversation_id, user_id, channel, current_time, locale, last_user_message, … }
  custom:   Record<string, TypedValue>   // workflow-author-defined
}
type DialogueStack = Frame[]   // LIFO, persisted in Convex
type Frame = { gambitId, localVars, stepCursor, returnTo }
```

Open items to resolve before locking (Step 3):
- Keep `llm-free` as a value? (finding #6)
- Keep `hybrid` and `llm-classify` both, or fold one in? (finding #4)
- Add `delegated-single` to topology? (finding #8)
- Add a verification-stringency sub-knob? (finding #11)
- Add a disclosure-injection sub-knob? (finding #12)
- Per-gambit knob inheritance from workflow-level defaults?

These can be decided when you actually start Step 3 (file 99). For now, the pressure-test gives confidence that **the 3-knob model carries**, with the refinements above.

## Source / context

- Continues from file 13 · `13-the-lab-board-3-knobs.md`
- Stack mechanics: file 09 · `09-dimension-e-state-and-stack.md`
- Rung-4 mechanics: file 08 · `08-dimension-b-control-locus.md`
- Will feed into file 99 · Step 1 (knob specs) and Step 2 (pressure-test of named archetypes)
