# 08 · Dimension B — Control Locus (deep-dive)

The hardest and most important dimension. "Who picks the next step, and how do you make that reliable when the LLM is fallible?" Rasa CALM is the canonical worked example.

## The 5-rung ladder of control locus

"What happens next" hides four sub-decisions: (1) which step/gambit do we go to next; (2) what action within a step; (3) when is a step done; (4) the user just went off-script — now what. Control Locus is mostly about **(1) and (4)** — the *flow-level* decisions. (2) and (3) are inherently inside an AI-gambit.

It can't be pure code (can't read intent / ambiguity) and it can't be pure LLM (hallucinates, picks illegal jumps, no policy floor). It's a **5-rung ladder**:

| Rung | Who decides | CX example | Failure mode |
|---|---|---|---|
| **1 · Static edge** | Code, no decision. Hard-wired next. | "Greeting → Ask account #" | Zero flexibility. |
| **2 · Code function** | Code, computed from state. | "if order.shipped → Track else Refund" | Can't read intent/language. |
| **3 · LLM constrained-choice** | LLM picks 1 from a fixed menu. | Intent router → billing \| tech \| account | Misclassify → confidently wrong branch. |
| **4 · LLM proposes / code validates** ◀ **THE PRODUCTION ANSWER** | LLM proposes; code checks legal & safe; rejects/clarifies. | **This is Rasa CALM.** LLM emits a *command*; FlowPolicy + stack execute. | Needs grammar + stack + confidence handling. |
| **5 · LLM free choice** | LLM decides anything, no check. | ★2 supervisor; agent picks next agent freely | Hallucinated/illegal jumps. **The user's AI-gambit jump sits near here today.** |

Today an AI-agent gambit's "jump call," if it's an LLM freely picking the next gambit, sits near **rung 5**. The upgrade target is **rung 4**.

## How rung 4 works — the 5-stage mechanism

The trick is to **split the decision into a part only the LLM can do and a part only code should do**:

1. **① Propose — constrain the LLM at generation time.** Don't ask open-ended *"what next?"*. Give the LLM the *enumerated legal moves from the current node* and make it pick from that menu via structured output / a tool-call enum / a command grammar. This alone kills ~most invalid outputs — it physically can't name a gambit that isn't an allowed edge.

2. **② Validate — the deterministic gate.** Even a menu pick can be legal-looking but wrong (preconditions unmet, required slot empty). Code checks the proposal against the graph + state. Illegal → reject. This is the *"path constraints"* principle: **if a path doesn't exist in the authored workflow, the agent cannot take it** — which eliminates dangerous "creative" behavior.

3. **③ Confidence → Clarify.** Get a confidence signal (explicit *"how sure, 0–1"*, a dedicated `Clarify` option in the grammar, or logprobs). Below threshold → **don't guess**: ask the user a clarifying question, fall to a safe default, or hand to a human.

4. **④ Reversibility tiering.** Scrutiny scales with consequence. Jump to an FAQ gambit → trust the proposal. Jump to "issue refund / change account" → require deterministic preconditions and/or human approval. Same harness, different trust per edge.

5. **⑤ Execute / Repair.** Legal + confident → run the gambit. If the user *digressed*, push the digression onto a **stack** (see file 09 — Dimension E), handle it, pop back, resume the interrupted gambit where it left off.

**Mental model:** the LLM contributes **linguistic intelligence** (what does the user want, are they sure, did they digress); deterministic code owns the **business logic + the legal move-set**; a **command grammar + a stack** is the contract between them.

## Rasa CALM — rung 4, made concrete

CALM is the cleanest existing implementation of this exact idea:

- The LLM (Dialogue Understanding / `CommandGenerator`) reads the **whole conversation + defined flows + current slots** and outputs a **sequence of commands** from a *fixed grammar*: `StartFlow(x)`, `SetSlot(k,v)`, `CancelFlow`, `Clarify`, `ChitChat`, `SkipQuestion`, `Correction`, `HumanHandoff`, `KnowledgeAnswer`. **It never executes business logic — it only proposes commands.**
- The **FlowPolicy + a LIFO dialogue stack** deterministically *execute* those commands. `StartFlow` pushes a flow; the flow's authored steps run deterministically; completion pops the stack.

### Worked scenario — the hard case deterministic gambits can't handle today

> Inside the **"collect shipping address"** gambit. User suddenly: *"wait — what's your return policy?"*
> - **Pure code:** stuck (no edge for this).
> - **Pure LLM:** answers, then forgets to finish collecting the address.
> - **CALM / rung-4:** LLM emits `StartFlow(return_policy)` → runtime **pushes** it on the stack → answers from KB → flow completes → stack **pops** → the address gambit **resumes exactly where it paused**, asking the next unfilled field. Seamless, deterministic resume.

Off-script behaviors (digression, correction, cancel, chitchat, "actually change my earlier answer") are handled by **pre-written reusable "repair pattern" flows** triggered by commands. Author once; every flow inherits them.

## How "LLM proposes" is actually implemented

| Technique | Description | Verdict |
|---|---|---|
| **(a) Structured JSON output** | Model returns `{cmd, args, confidence}` validated against a schema. Simplest. | Fine for a prototype; weakest because the legal-move set isn't enforced *at generation*, only after. |
| **(b) Tool-call with a dynamic enum** | At each turn, the `GoToGambit` tool is constructed so its target argument is an **enum containing only the legal next gambits from the current node**. The model literally cannot emit an illegal jump. | **The default.** Highest reliability-per-effort. |
| **(c) Fine-tuned small model** | CALM's path: small (~8B) model fine-tuned to output the grammar. Cheaper, faster, more consistent. | Optimization of (b). Do only when volume justifies. |

## A starter command grammar for the gambit system

The LLM may **only** emit:

- `GoToGambit(id)` — propose a jump; rejected if not a legal edge from the current node.
- `Stay()` — keep talking in the current gambit.
- `SetVar(k, v)` — record extracted / typed input.
- `Clarify(q)` — "I'm not sure" → ask the user `q` (first-class uncertainty).
- `Digress(id)` — push a side gambit; return after.
- `Resume()` — pop back to interrupted gambit.
- `Cancel()` — abandon current flow.
- `Escalate(reason)` — human handoff.
- `CannotHandle()` — escape hatch for grammar gaps → safe fallback.

The deliberate trio that solves the rung-4 reliability problem:

- `Clarify` — uncertainty as a first-class move (not a guessed number)
- `Digress` / `Resume` — the stack made usable from the model
- `CannotHandle` / `Escalate` — escape hatch so the model is never *forced* to pick a wrong command

## Confidence — make "I'm not sure" a *move*, not a number

The naive approach (ask the model for a `confidence: 0.0–1.0` field) **fails** because LLMs are systematically over-confident; they'll say 0.95 while being wrong.

**The strong approach (CALM's):** put `Clarify` in the grammar itself. Now *"I'm unsure which way to go"* is a legal, trained, first-class action the model can *choose* — instead of being forced to pick a transition and guess. The model is far better at *"should I ask a clarifying question here?"* than at honestly numbering its own confidence.

Layer logprobs or double-sampling on top only for high-stakes edges.

**Combined rule:** self-reported confidence may *raise* caution but is never the safety floor — deterministic preconditions are.

## Where rung 4 still fails — and the defenses

| Failure | Defense |
|---|---|
| **Legal-but-wrong jump** (passes validation — it IS a legal edge, but wrong for this context) | Richer edge preconditions · reversibility tiering · supervisor model · post-hoc verification before side-effects |
| **Confidently wrong** (high self-confidence, wrong cmd) | Never trust self-confidence as the floor; deterministic preconditions are the floor; consequential edges always gated regardless of confidence |
| **Grammar gap** (user wants what no command expresses) | Always include `CannotHandle` / `Escalate` escape hatch; review logs to grow the grammar |
| **Stack pathologies** (infinite digression, user never returns) | Stack depth limit · TTL on suspended gambits · "you had an unfinished X — continue?" resume prompt |
| **Multi-command sequence ordering / atomicity** | Validate the whole sequence transactionally; all-or-nothing |

## Mapping to the user's system

| | User's system today | CALM / rung-4 |
|---|---|---|
| Deterministic steps | ✅ gambits (pre/post/jump) | Flows |
| LLM step | ✅ AI-agent gambit | CommandGenerator |
| Jump decision | ⚠️ LLM picks next gambit freely (≈ rung 5) | LLM emits a *validated command* (rung 4) |
| Constrained proposal | ❌ no command grammar | fixed command set |
| Digression / resume | ❌ no stack — off-script breaks the flow | dialogue stack push/pop (see file 09) |
| Repair patterns | ❌ none | reusable system flows |

## Bottom line — 4 concrete things to steal

1. Replace the AI-gambit's free *"next gambit"* with a **tool-call command grammar** where the jump target is a **dynamic enum of legal edges** (rung 4, technique b).
2. Put `Clarify` and `CannotHandle` / `Escalate` in the grammar so uncertainty and grammar-gaps are *moves*, not forced wrong guesses.
3. Add a **stack** (Dimension E) so `Digress` / `Resume` are real — with depth and TTL guards.
4. Gate **consequential edges** with deterministic preconditions + optional supervisor + pre-execution verification, *independent of model confidence*.

## Source

Corresponds to **Atlas tabs 3 · Control Locus** and **4 · Rung 4 Deep-Dive** in `harness-atlas.html`.
