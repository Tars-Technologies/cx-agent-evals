# 09 · Dimension E — State & the Stack (deep-dive)

The state model that lets a harness handle non-linear conversation (digression + resume), and the durable cross-turn execution it depends on.

## Two stores, two questions

"State" is two different questions, and they need two different stores:

| State shape | Answers | Can represent | Cannot represent | Who has it |
|---|---|---|---|---|
| History-only | "what was said" | raw transcript | structured facts; position in a flow | pure chatbots |
| **Typed session state** | **"what do we *know*?"** | named typed slots (account_id, intent…) + history | where am I / how do I get back (no nesting, no return point) | **★1 user's gambits, ADK** |
| **Dialogue stack** | **"where are we & how to return?"** | nested frames, resume point, digression/return | (pairs with typed slots — not a replacement) | **◆ Rasa CALM** |
| Isolated + trace-share | "each agent's own context" | parallel agents, explicit trace passing | shared single source of truth (must re-share) | ★2 supervisor |

**Typed slots answer "what do we know?". The stack answers "where are we and how do we get back?". You need both.** The user's system has the first; the stack is the missing piece that makes digression + resume possible.

## Anatomy of a stack frame

A **frame** = `{ gambitId, localVars, stepCursor, returnTo }`.

- `gambitId` — which gambit this frame represents.
- `localVars` — frame-scoped scratch variables.
- `stepCursor` — which step within the gambit we paused at.
- `returnTo` — where to pop back to (implicit if using LIFO).

The stack is a LIFO list of frames; the **top** frame is active. It is **persisted per conversation**, not in memory.

## The push / pop / resume lifecycle — worked trace

Starting state: `[CollectAddress @ step=street]`

1. **In flow.** Stack: `[CollectAddress @ step=street]`.
2. **User digresses:** *"wait, what's your return policy?"* → LLM emits `Digress` command → runtime **pushes** `ReturnPolicy` on top.
   Stack: `[CollectAddress @ step=street, ReturnPolicy @ step=0]`.
3. **FAQ answered.** `ReturnPolicy` runs to completion → **pop**. Stack: `[CollectAddress @ step=street]`.
4. **Resume.** Top frame's `stepCursor` says exactly where to continue → re-asks *"what's your street?"*. Seamless.

The `stepCursor` is the magic: it's what makes resume *exact*. Without a stack, leaving `CollectAddress` loses the cursor — either re-run from the top (losing already-collected fields) or just break.

## The E × F link — the stack must be durable across turns

A customer answers, closes the browser, comes back tomorrow. So the stack **cannot be in memory**. It's durable persisted state, loaded on every inbound message:

- **Suspend** (a gambit's `collect-input`) = persist stack + slots, return.
- **Resume** (next inbound message) = load stack; the top frame's `stepCursor` says precisely where to continue.

**Mental model:** Temporal *Signal* / Restate *awakeable* / LangGraph *interrupt + checkpoint*. The durable stack snapshot **is** the suspension checkpoint.

**The good news:** **Convex is already the project's durability substrate** — the stack is just a persisted document per conversation. No Temporal / no separate workflow engine needed.

**The pitfall (LangGraph's hard lesson):** if resume re-runs a frame's body, side-effects must sit *after* the suspend point or be idempotent. The `stepCursor` is what lets you skip already-completed steps.

## B × E wiring — each rung-4 command is a stack operation

The Dimension B command grammar (file 08) maps cleanly onto stack operations:

| Command | Stack op |
|---|---|
| `GoToGambit(id)` | **Replace** top frame (normal transition, no return expected) |
| `Digress(id)` | **Push** a frame (return expected) |
| flow-complete / `Resume()` | **Pop**; continue parent at its `stepCursor` |
| `Cancel()` | **Pop + discard** frame and its locals |
| `Escalate(reason)` | Snapshot the whole stack as the human-handoff payload |

**Key:** the "transition (replace) vs digression (push)" split is a real semantic decision. Because the grammar separates `GoToGambit` from `Digress`, the stack just honors what the LLM already declared. B and E are designed to fit.

## Stack pathologies & guards

Six failure modes and their guards:

| Pathology | Guard |
|---|---|
| Unbounded depth (digression in digression in digression) | Max stack depth (e.g. 5) → beyond it, flatten or escalate |
| Orphaned / stale frame (digressed, never returned) | Per-frame TTL → on resume if stale: *"you had an unfinished change-of-address — resume or discard?"* |
| Resume ambiguity (>1 suspended user-facing frame) | LIFO default, but prompt the user when more than one is pending |
| Pop into a changed world (order shipped while suspended) | Re-validate frame preconditions *on resume*, not only on entry |
| State bloat over a long conversation | Compact *history* (summarize old turns); **never** compact stack or typed slots — they're source of truth |
| Cross-frame variable leakage | Two tiers: session-global typed slots + frame-local scratch vars |

The **compaction rule** is especially important: when a long conversation bloats, you may summarize the *transcript*, but you must **never** compact the stack or typed slots — those are the exact source of truth. (Cognition's *"compress context, preserve decisions"*, made literal.)

## What to build on the user's stack

1. **Keep** the typed pre/post vars — that's the ✅ "what we know" tier.
2. **Add** a persisted dialogue-stack doc per conversation in Convex (array of frames).
3. **Wire** the rung-4 grammar commands to the stack ops above.
4. **On `collect-input`**: persist stack + slots; resume from the top frame's `stepCursor`.
5. **Add** the six guards above.
6. **Compact** transcript only, never stack / slots.

## Source

Corresponds to **Atlas tab 5 · State & the Stack** in `harness-atlas.html`.
