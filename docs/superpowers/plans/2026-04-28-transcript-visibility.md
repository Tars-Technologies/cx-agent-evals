# Transcript Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add side-by-side scenario↔source-transcript and simulated-run↔source-transcript comparison views, plus inline tool-call rendering in simulated conversations.

**Architecture:** Frontend-only feature in `packages/frontend` plus one tiny null-safe backend query addition. Two existing detail components (`ScenarioDetail`, `SimRunDetail`) gain a "Compare" toggle that splits their body into two columns. The right column hosts a new shared `SourceTranscriptPanel`. Tool-call rendering is unified by extracting the playground's grouped-pill component and grouping utility into shared modules.

**Tech Stack:** React 19, Next.js 16, TypeScript, Tailwind v4, Convex.

**Spec:** `docs/superpowers/specs/2026-04-28-transcript-visibility-design.md`

**Verification approach:** Frontend has no test runner (no vitest/jest/RTL). Each task ends with `pnpm -C packages/frontend build` + `pnpm -C packages/frontend lint` + a manual browser check. Convex backend changes use `cd packages/backend && npx convex dev --once` to typecheck/deploy.

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `packages/frontend/src/lib/messageDisplay.ts` | Pure utility: `groupMessagesWithToolCalls(messages)` returns a `DisplayItem[]` (discriminated union of user / assistant / tool_group entries). Also exports `ToolCallEntry` and `DisplayItem` types. |
| `packages/frontend/src/components/conversation-sim/ToolCallGroup.tsx` | Pure presentational. Expandable "N tools called" pill rendered above an assistant message. Lifted from `AgentPlayground.tsx`. |
| `packages/frontend/src/components/ScenarioFields.tsx` | Pure presentational. Renders all scenario fields (persona / source / scenario / info boundaries / instruction / reference messages). Exports `Scenario` type and `Chip` helper for reuse. |
| `packages/frontend/src/components/livechat/SourceTranscriptPanel.tsx` | Fetches a livechat conversation by id and renders header + `ChatBubble` list. Handles loading / null / empty states. |
| `packages/frontend/src/components/conversation-sim/ScenarioSummaryBand.tsx` | Collapsible scenario summary band shown above the comparison columns on the agents page. |

**Modified files:**

| Path | Change |
|---|---|
| `packages/backend/convex/conversationSim/scenarios.ts` | Add new `getMaybe` query that returns null instead of throwing on missing/cross-org scenarios. |
| `packages/frontend/src/components/AgentPlayground.tsx` | Remove inline `ToolCallGroup` component (lines 11-57) and inline grouping logic (lines 152-207). Import the extracted versions instead. Behavior unchanged. |
| `packages/frontend/src/components/ScenarioDetail.tsx` | Replace inline scenario field JSX with `<ScenarioFields>`. Replace the read-only "Source transcript: \<id\>" line with a "View source transcript" toggle. Add split-pane body when toggle is on. |
| `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx` | Add `useQuery` for scenario via `scenarios.getMaybe`. Render `ScenarioSummaryBand` above transcript. Add "Compare to source" toggle in header. Replace user/assistant rendering with `groupMessagesWithToolCalls` + `ToolCallGroup`. Delete bottom tool-calls section. Split body into two columns when toggle is on. |

---

## Task 1: Extract `ToolCallGroup` and grouping utility from `AgentPlayground.tsx`

This is a pure refactor. The playground's behavior must be unchanged after this task.

**Files:**
- Create: `packages/frontend/src/lib/messageDisplay.ts`
- Create: `packages/frontend/src/components/conversation-sim/ToolCallGroup.tsx`
- Modify: `packages/frontend/src/components/AgentPlayground.tsx`

- [ ] **Step 1: Create `lib/messageDisplay.ts`**

Write the file:

```typescript
import type { Doc } from "@convex/_generated/dataModel";

export type ToolCallEntry = {
  toolName: string;
  toolArgs?: string;
  toolResult?: string;
};

export type DisplayItem =
  | { type: "user"; msg: Doc<"messages"> }
  | { type: "assistant"; msg: Doc<"messages"> }
  | { type: "tool_group"; calls: ToolCallEntry[]; key: string };

/**
 * Groups consecutive tool_call/tool_result messages between user→assistant turns
 * into a single tool_group display item rendered above the owning assistant message.
 *
 * DB row order:      user(N), assistant(N+1), tool_call(N+2), tool_result(N+3), ...
 * Display order:     user → tool_group → assistant
 */
export function groupMessagesWithToolCalls(messages: Doc<"messages">[]): DisplayItem[] {
  const toolResultMap = new Map<string, Doc<"messages">>();
  for (const m of messages) {
    if (m.role === "tool_result" && m.toolResult?.toolCallId) {
      toolResultMap.set(m.toolResult.toolCallId, m);
    }
  }

  const toolCallsByAssistant = new Map<string, ToolCallEntry[]>();
  let currentAssistantId: string | null = null;
  for (const m of messages) {
    if (m.role === "assistant") {
      currentAssistantId = m._id;
    } else if (m.role === "tool_call" && currentAssistantId) {
      if (!toolCallsByAssistant.has(currentAssistantId)) {
        toolCallsByAssistant.set(currentAssistantId, []);
      }
      const result = m.toolCall?.toolCallId ? toolResultMap.get(m.toolCall.toolCallId) : undefined;
      toolCallsByAssistant.get(currentAssistantId)!.push({
        toolName: m.toolCall?.toolName ?? "tool",
        toolArgs: m.toolCall?.toolArgs,
        toolResult: result?.toolResult?.result,
      });
    } else if (m.role === "user") {
      currentAssistantId = null;
    }
  }

  const displayItems: DisplayItem[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      displayItems.push({ type: "user", msg: m });
    } else if (m.role === "assistant") {
      const calls = toolCallsByAssistant.get(m._id);
      if (calls && calls.length > 0) {
        displayItems.push({ type: "tool_group", calls, key: `tg-${m._id}` });
      }
      displayItems.push({ type: "assistant", msg: m });
    }
    // tool_call and tool_result are rendered via the grouped pill, skip individually
  }
  return displayItems;
}
```

- [ ] **Step 2: Create `components/conversation-sim/ToolCallGroup.tsx`**

Write the file:

```typescript
"use client";

import { useState } from "react";
import ToolCallChip from "@/components/ToolCallChip";
import type { ToolCallEntry } from "@/lib/messageDisplay";

export function ToolCallGroup({ calls, isLive }: {
  calls: ToolCallEntry[];
  isLive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const allDone = calls.every((c) => c.toolResult !== undefined);
  const lastCall = calls[calls.length - 1];
  const displayName = (name: string) =>
    name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-elevated border border-border rounded-lg text-[10px] hover:border-accent/30 transition-colors"
        >
          <span className="text-accent">⚡</span>
          {isLive && !allDone ? (
            <span className="text-text-muted">
              Calling <strong className="text-text font-medium">{displayName(lastCall.toolName)}</strong>
              <span className="inline-block w-1 h-1 bg-accent rounded-full ml-1 animate-pulse align-middle" />
            </span>
          ) : (
            <span className="text-text-muted">
              <strong className="text-text font-medium">{calls.length}</strong> tool{calls.length !== 1 ? "s" : ""} called
            </span>
          )}
          <span className="text-text-dim ml-0.5">{expanded ? "▾" : "▸"}</span>
        </button>

        {expanded && (
          <div className="mt-1 ml-2 space-y-1">
            {calls.map((call, i) => (
              <ToolCallChip
                key={i}
                toolName={call.toolName}
                toolArgs={call.toolArgs}
                toolResult={call.toolResult}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Refactor `AgentPlayground.tsx` to use the extracted modules**

In `packages/frontend/src/components/AgentPlayground.tsx`:

1. Add imports near the top, after the existing imports:

```typescript
import { groupMessagesWithToolCalls } from "@/lib/messageDisplay";
import { ToolCallGroup } from "@/components/conversation-sim/ToolCallGroup";
```

2. Delete the inline `ToolCallGroup` function (lines 11-57).

3. Delete the inline grouping block (lines 152-207, from `// Build display items: group consecutive...` up to and including the closing of the second `for` loop) and replace with:

```typescript
const displayItems = groupMessagesWithToolCalls(messages);
```

The render block (`displayItems.map(...)` further down) is unchanged — it already handles the three discriminator cases (`user`, `tool_group`, `assistant`) and the imported `ToolCallGroup` has the same prop signature.

- [ ] **Step 4: Build and lint**

Run:

```bash
pnpm -C packages/frontend build
pnpm -C packages/frontend lint
```

Expected: clean build, no new lint errors.

- [ ] **Step 5: Manual playground regression check**

```bash
pnpm dev:backend  # in one terminal (if not already running)
pnpm dev          # in another terminal
```

Open the agents page, navigate to the playground tab for any agent. Send a message that triggers tool calls (e.g., a retrieval-style question). Verify:

- [ ] Tool calls render as a "**N tools called**" expandable pill above the assistant response.
- [ ] Clicking the pill expands to show each call's args and result via `ToolCallChip`.
- [ ] During streaming, the pill says "Calling \<ToolName\>" with a pulsing dot, just as before.

If anything visibly differs from before, the lift was not mechanical — re-check the diff.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/lib/messageDisplay.ts \
        packages/frontend/src/components/conversation-sim/ToolCallGroup.tsx \
        packages/frontend/src/components/AgentPlayground.tsx
git commit -m "refactor(frontend): extract ToolCallGroup and grouping utility from AgentPlayground

Lift the inline tool-call grouping logic and pill component out of
AgentPlayground.tsx into reusable modules so the simulated-conversation
view can render tool calls inline using the same pattern.

No behavior change in the playground."
```

---

## Task 2: Extract `ScenarioFields` shared component from `ScenarioDetail.tsx`

Pure refactor. The dataset page must render scenarios identically after this task.

**Files:**
- Create: `packages/frontend/src/components/ScenarioFields.tsx`
- Modify: `packages/frontend/src/components/ScenarioDetail.tsx`

- [ ] **Step 1: Create `components/ScenarioFields.tsx`**

Write the file. Note: the original ScenarioDetail's Source section had a read-only line `Source transcript: <id>` (lines 84-88). That line is OMITTED here because it gets replaced by the toggle button in Task 3.

```typescript
"use client";

import type { ReactNode } from "react";

export interface Scenario {
  _id: string;
  persona: {
    type: string;
    traits: string[];
    communicationStyle: string;
    patienceLevel: "low" | "medium" | "high";
  };
  topic: string;
  intent: string;
  complexity: "low" | "medium" | "high";
  reasonForContact: string;
  knownInfo: string;
  unknownInfo: string;
  instruction: string;
  referenceMessages?: Array<{
    role: "user";
    content: string;
    turnIndex: number;
  }>;
  sourceType?: "transcript_grounded" | "synthetic";
  sourceTranscriptId?: string;
  languages?: string[];
}

export function ScenarioFields({ scenario }: { scenario: Scenario }) {
  return (
    <div className="px-6 py-4 space-y-5">
      {/* Persona Section */}
      <section>
        <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Persona</h3>
        <div className="flex flex-wrap gap-1.5">
          <Chip color="blue">{scenario.persona.type}</Chip>
          <Chip color="purple">{scenario.persona.communicationStyle}</Chip>
          <Chip color={scenario.persona.patienceLevel === "low" ? "red" : scenario.persona.patienceLevel === "high" ? "green" : "yellow"}>
            {scenario.persona.patienceLevel} patience
          </Chip>
          {scenario.persona.traits.map((trait, i) => (
            <Chip key={i} color="gray">{trait}</Chip>
          ))}
        </div>
      </section>

      {/* Source section */}
      {(scenario.sourceType || (scenario.languages && scenario.languages.length > 0)) && (
        <section>
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Source</h3>
          <div className="flex flex-wrap gap-1.5">
            {scenario.sourceType && (
              <Chip color={scenario.sourceType === "transcript_grounded" ? "green" : "purple"}>
                {scenario.sourceType === "transcript_grounded" ? "Transcript-grounded" : "Synthetic"}
              </Chip>
            )}
            {scenario.languages?.map((lang, i) => (
              <Chip key={i} color="blue">{lang}</Chip>
            ))}
          </div>
        </section>
      )}

      {/* Scenario Section */}
      <section>
        <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Scenario</h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Chip color={scenario.complexity === "high" ? "red" : scenario.complexity === "medium" ? "yellow" : "green"}>
            {scenario.complexity} complexity
          </Chip>
        </div>
        <div className="text-xs text-text-dim leading-relaxed">
          <strong className="text-text">Reason for contact:</strong> {scenario.reasonForContact}
        </div>
      </section>

      {/* Known / Unknown Info (side by side) */}
      <section>
        <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Information Boundaries</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bg-elevated/50 border border-border rounded-md p-3">
            <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1.5">Known Info</div>
            <p className="text-xs text-text-dim leading-relaxed">{scenario.knownInfo}</p>
          </div>
          <div className="bg-bg-elevated/50 border border-border rounded-md p-3">
            <div className="text-[10px] text-red-400 uppercase tracking-wider mb-1.5">Unknown Info</div>
            <p className="text-xs text-text-dim leading-relaxed">{scenario.unknownInfo}</p>
          </div>
        </div>
      </section>

      {/* Instruction */}
      <section>
        <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">Instruction</h3>
        <div className="bg-bg border border-border rounded-md p-3">
          <pre className="text-xs text-text leading-relaxed whitespace-pre-wrap font-mono">
            {scenario.instruction}
          </pre>
        </div>
      </section>

      {/* Reference Messages */}
      {scenario.referenceMessages && scenario.referenceMessages.length > 0 && (
        <section>
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">
            Reference Messages ({scenario.referenceMessages.length})
          </h3>
          <div className="space-y-2">
            {scenario.referenceMessages.map((msg, i) => (
              <div
                key={i}
                className="bg-bg-elevated/50 border border-border rounded-md p-3 pl-4 border-l-2 border-l-blue-500/40"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-blue-400 uppercase">Turn {msg.turnIndex}</span>
                  <span className="text-[10px] text-text-dim">{msg.role}</span>
                </div>
                <p className="text-xs text-text-dim leading-relaxed">{msg.content}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function Chip({
  children,
  color,
}: {
  children: ReactNode;
  color: "blue" | "purple" | "red" | "yellow" | "green" | "gray";
}) {
  const colorMap = {
    blue: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    purple: "bg-purple-500/15 text-purple-400 border-purple-500/20",
    red: "bg-red-500/15 text-red-400 border-red-500/20",
    yellow: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    green: "bg-green-500/15 text-green-400 border-green-500/20",
    gray: "bg-white/5 text-text-dim border-border",
  };

  return (
    <span className={`px-1.5 py-0.5 text-[9px] rounded border ${colorMap[color]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Refactor `ScenarioDetail.tsx` to consume `ScenarioFields`**

Replace the entire contents of `packages/frontend/src/components/ScenarioDetail.tsx` with:

```typescript
"use client";

import { ScenarioFields, type Scenario } from "@/components/ScenarioFields";

export function ScenarioDetail({
  scenario,
  onEdit,
}: {
  scenario: Scenario;
  onEdit?: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-elevated/50 sticky top-0 z-10">
        <div>
          <h2 className="text-sm font-medium text-text">{scenario.topic}</h2>
          <p className="text-xs text-text-dim mt-0.5">{scenario.intent}</p>
        </div>
        {onEdit && (
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      <ScenarioFields scenario={scenario} />
    </div>
  );
}
```

Note: this temporarily removes the read-only "Source transcript: \<id\>" line. Task 3 adds a proper toggle in its place. This intermediate state is acceptable for one commit.

- [ ] **Step 3: Build and lint**

```bash
pnpm -C packages/frontend build
pnpm -C packages/frontend lint
```

Expected: clean build, no new lint errors.

- [ ] **Step 4: Manual dataset-page check**

Open the dataset page → pick a knowledge base → pick a dataset → switch to scenarios view → click any scenario.

Verify:

- [ ] Scenario detail renders identically to before for all sections (persona / source chips / scenario / info boundaries / instruction / reference messages).
- [ ] The only visible difference: the read-only "Source transcript: \<id\>" line is gone (will be replaced in Task 3).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/ScenarioFields.tsx \
        packages/frontend/src/components/ScenarioDetail.tsx
git commit -m "refactor(frontend): extract ScenarioFields shared component

Lift the scenario field rendering (persona, source chips, info boundaries,
instruction, reference messages) and the local Chip helper out of
ScenarioDetail into a reusable ScenarioFields component so it can be
reused by the upcoming ScenarioSummaryBand on the agents page.

Removes the read-only 'Source transcript: <id>' line; a proper 'View
source transcript' toggle replaces it in the next commit."
```

---

## Task 3: `SourceTranscriptPanel` component + dataset-page split-pane toggle

Adds the new shared transcript panel and wires it into the dataset page.

**Files:**
- Create: `packages/frontend/src/components/livechat/SourceTranscriptPanel.tsx`
- Modify: `packages/frontend/src/components/ScenarioDetail.tsx`

- [ ] **Step 1: Create `components/livechat/SourceTranscriptPanel.tsx`**

Write the file:

```typescript
"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { ChatBubble } from "@/components/livechat/ChatBubble";
import type { Id } from "@convex/_generated/dataModel";

export function SourceTranscriptPanel({
  sourceTranscriptId,
}: {
  sourceTranscriptId: Id<"livechatConversations">;
}) {
  const conversation = useQuery(api.livechat.orchestration.getConversation, {
    id: sourceTranscriptId,
  });

  // Loading
  if (conversation === undefined) {
    return (
      <div className="p-4 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-bg-elevated/50 rounded-md h-12 animate-pulse" />
        ))}
      </div>
    );
  }

  // Not found / cross-org / deleted
  if (conversation === null) {
    return (
      <div className="p-6 text-center text-text-dim text-xs">
        Source transcript no longer available.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <div className="text-xs text-text font-medium truncate">
          {conversation.conversationId}
        </div>
        <div className="text-[10px] text-text-dim mt-0.5">
          {conversation.agentName ? `Agent: ${conversation.agentName}` : "No agent"}
          {" · "}
          {conversation.messages.length} message
          {conversation.messages.length !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {conversation.messages.length === 0 ? (
          <div className="text-center text-text-dim text-xs py-6">
            No messages in this conversation.
          </div>
        ) : (
          conversation.messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              id={msg.id}
              role={msg.role}
              text={msg.text}
              agentName={conversation.agentName}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add toggle and split-pane body to `ScenarioDetail.tsx`**

Replace the entire contents of `packages/frontend/src/components/ScenarioDetail.tsx` with:

```typescript
"use client";

import { useState, useEffect } from "react";
import { ScenarioFields, type Scenario } from "@/components/ScenarioFields";
import { SourceTranscriptPanel } from "@/components/livechat/SourceTranscriptPanel";
import type { Id } from "@convex/_generated/dataModel";

export function ScenarioDetail({
  scenario,
  onEdit,
}: {
  scenario: Scenario;
  onEdit?: () => void;
}) {
  const [showSource, setShowSource] = useState(false);

  // Reset toggle when the displayed scenario changes
  useEffect(() => {
    setShowSource(false);
  }, [scenario._id]);

  const hasSource = !!scenario.sourceTranscriptId;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-elevated/50 flex-shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text truncate">{scenario.topic}</h2>
          <p className="text-xs text-text-dim mt-0.5 truncate">{scenario.intent}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasSource && (
            <button
              onClick={() => setShowSource((v) => !v)}
              className="px-3 py-1.5 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
            >
              {showSource ? "Hide source" : "View source transcript"}
            </button>
          )}
          {onEdit && (
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Body — split when showSource is on */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto">
          <ScenarioFields scenario={scenario} />
        </div>
        {showSource && hasSource && (
          <div className="w-1/2 min-w-0 border-l border-border overflow-hidden">
            <SourceTranscriptPanel
              sourceTranscriptId={scenario.sourceTranscriptId as Id<"livechatConversations">}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build and lint**

```bash
pnpm -C packages/frontend build
pnpm -C packages/frontend lint
```

Expected: clean build, no new lint errors.

- [ ] **Step 4: Manual dataset-page checklist**

Open the dataset page, switch to scenarios view, and verify each:

- [ ] Pick a transcript-grounded scenario → "View source transcript" button visible in header.
- [ ] Click it → detail area splits 50/50, transcript loads in the right column with role-styled `ChatBubble`s, header shows conversation ID + agent name + message count.
- [ ] Click "Hide source" → returns to single-column scenario view.
- [ ] Pick a synthetic scenario → button absent.
- [ ] Toggle on, then switch to a different scenario → toggle resets to off.
- [ ] If you have a scenario whose `sourceTranscriptId` was tampered to point to a deleted/missing record, the right column shows "Source transcript no longer available." (Acceptable to skip this if no such test data exists.)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/livechat/SourceTranscriptPanel.tsx \
        packages/frontend/src/components/ScenarioDetail.tsx
git commit -m "feat(frontend): add source-transcript split-pane to ScenarioDetail

Replaces the read-only sourceTranscriptId label with a 'View source
transcript' toggle. When enabled, the scenario detail area splits 50/50
with the existing scenario fields on the left and a new
SourceTranscriptPanel (reusing ChatBubble) on the right. Handles
loading, deleted-record, and empty-conversation states.

Toggle resets when the user selects a different scenario."
```

---

## Task 4: Inline tool calls in `SimRunDetail`

Replace the bottom-of-conversation tool-calls section with inline grouped pills. Behavior improvement: tool *results* now show alongside calls (the old section only showed calls).

**Files:**
- Modify: `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`

- [ ] **Step 1: Replace the transcript rendering in `SimRunDetail.tsx`**

Find the existing transcript-rendering block (lines 70-103) which contains the user/assistant `messages.filter(...)` map and the bottom "Tool calls section." Replace that entire block with the new interleaved rendering.

Specifically, in `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`:

1. Add new imports near the top:

```typescript
import { groupMessagesWithToolCalls } from "@/lib/messageDisplay";
import { ToolCallGroup } from "@/components/conversation-sim/ToolCallGroup";
```

2. Replace lines 70-103 (the `<div className="px-4 py-3 space-y-3">...</div>` block containing both the user/assistant map AND the tool calls section) with:

```tsx
        {/* Conversation transcript */}
        <div className="px-4 py-3 space-y-3">
          <h3 className="text-[11px] text-text-dim uppercase tracking-wider">Transcript</h3>
          {groupMessagesWithToolCalls(messages).map((item) => {
            if (item.type === "tool_group") {
              return <ToolCallGroup key={item.key} calls={item.calls} isLive={false} />;
            }
            const msg = item.msg;
            return (
              <div
                key={msg._id}
                className={`rounded-md p-3 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-500/10 border border-blue-500/20 text-text"
                    : "bg-bg-elevated border border-border text-text-dim"
                }`}
              >
                <div className={`text-[10px] font-medium mb-1 uppercase ${
                  msg.role === "user" ? "text-blue-400" : "text-accent"
                }`}>
                  {msg.role === "user" ? "User" : "Agent"}
                </div>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            );
          })}
        </div>
```

The Evaluation Results block immediately after (existing lines 105-135) is unchanged.

- [ ] **Step 2: Build and lint**

```bash
pnpm -C packages/frontend build
pnpm -C packages/frontend lint
```

Expected: clean build, no new lint errors.

- [ ] **Step 3: Manual sim-run check**

Open the agents page → switch to experiments mode → pick a simulation that has at least one completed run with tool calls. Click that run.

Verify:

- [ ] Tool-call pills appear *inline* above each assistant message that triggered tools, not at the bottom of the transcript.
- [ ] Clicking a pill expands to show args and result for each call.
- [ ] No standalone "Tool Calls (N)" section at the bottom of the transcript.
- [ ] Evaluation Results section below still renders normally.
- [ ] User and Agent messages appear in the same order and styling as before.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/SimRunDetail.tsx
git commit -m "feat(frontend): inline tool-call pills in simulated conversations

Replace the bottom-of-conversation tool-calls list in SimRunDetail with
inline grouped pills above each assistant message, matching the
playground's UX. Reuses groupMessagesWithToolCalls and ToolCallGroup
extracted in the previous refactor.

Behavior improvement: tool results now show alongside calls (the old
section only displayed call args)."
```

---

## Task 5: Add `scenarios.getMaybe` backend query

Adds a non-throwing variant of `scenarios.get` so the agents-page run-detail view can render gracefully when a scenario was deleted (rare).

**Must run before Task 6**, which consumes the new query.

**Files:**
- Modify: `packages/backend/convex/conversationSim/scenarios.ts`

- [ ] **Step 1: Add the `getMaybe` query**

In `packages/backend/convex/conversationSim/scenarios.ts`, immediately after the existing `get` query (which ends at the line with `},` followed by `});`), insert:

```typescript
// Like `get`, but returns null instead of throwing when the scenario is missing
// or belongs to a different org. Used by views that link to scenarios which may
// be deleted independently.
export const getMaybe = query({
  args: { id: v.id("conversationScenarios") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const scenario = await ctx.db.get(id);
    if (!scenario || scenario.orgId !== orgId) return null;
    return scenario;
  },
});
```

(The `query` and `v` imports already exist at the top of the file; no new imports needed.)

- [ ] **Step 2: Deploy and typecheck the backend**

Run from `packages/backend/`:

```bash
cd packages/backend && npx convex dev --once
```

(This is one-shot deploy + typecheck. Don't use `pnpm dev:backend` here — that runs in watch mode and won't return.)

Expected: deploy completes without errors. Convex regenerates `_generated/api.d.ts` to include `api.conversationSim.scenarios.getMaybe`.

- [ ] **Step 3: Frontend typecheck (picks up regenerated API types)**

```bash
pnpm -C packages/frontend build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/conversationSim/scenarios.ts \
        packages/backend/convex/_generated/
git commit -m "feat(backend): add scenarios.getMaybe non-throwing query

Returns null instead of throwing when a scenario is missing or
cross-org. Needed by the agents-page run-detail view to render
gracefully when a linked scenario has been deleted (rare)."
```

---

## Task 6: `ScenarioSummaryBand` component + use in `SimRunDetail`

Adds a collapsible scenario-summary band above the simulated conversation transcript.

**Files:**
- Create: `packages/frontend/src/components/conversation-sim/ScenarioSummaryBand.tsx`
- Modify: `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`

- [ ] **Step 1: Create `components/conversation-sim/ScenarioSummaryBand.tsx`**

Write the file:

```typescript
"use client";

import { useState, useEffect } from "react";
import { ScenarioFields, Chip, type Scenario } from "@/components/ScenarioFields";

export function ScenarioSummaryBand({
  scenario,
}: {
  scenario: Scenario | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  // Collapse when the linked scenario changes
  useEffect(() => {
    setExpanded(false);
  }, [scenario?._id]);

  // Loading
  if (scenario === undefined) {
    return (
      <div className="px-4 py-2 border-b border-border bg-bg-elevated/30">
        <div className="h-4 bg-bg-elevated/60 rounded animate-pulse w-1/3" />
      </div>
    );
  }

  // Deleted / not found
  if (scenario === null) {
    return null;
  }

  return (
    <div className="border-b border-border bg-bg-elevated/30">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2 flex items-start justify-between gap-3 hover:bg-bg-elevated/50 transition-colors text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text font-medium truncate">{scenario.topic}</span>
            <Chip color="gray">{scenario.persona.type}</Chip>
            <Chip color={scenario.complexity === "high" ? "red" : scenario.complexity === "medium" ? "yellow" : "green"}>
              {scenario.complexity}
            </Chip>
          </div>
          <p className="text-[11px] text-text-dim mt-0.5 truncate">{scenario.intent}</p>
        </div>
        <span className="text-text-dim text-xs flex-shrink-0 mt-0.5">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          <ScenarioFields scenario={scenario} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the band in `SimRunDetail.tsx`**

In `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`:

1. Add imports near the top:

```typescript
import { ScenarioSummaryBand } from "@/components/conversation-sim/ScenarioSummaryBand";
import type { Scenario } from "@/components/ScenarioFields";
```

2. After the existing `messages` query (around line 18), add a scenario fetch:

```typescript
  const scenario = useQuery(
    api.conversationSim.scenarios.getMaybe,
    run?.scenarioId ? { id: run.scenarioId } : "skip",
  );
```

3. In the JSX, between the `{/* Header */}` block and the `{/* Content: transcript + evaluation */}` block, insert:

```tsx
      <ScenarioSummaryBand scenario={scenario} />
```

Convex returns `Doc<"conversationScenarios"> | null | undefined`, which is structurally compatible with the `Scenario` interface (the schema's literal unions match). If TypeScript complains about a structural mismatch, narrow with `as Scenario | null | undefined`; otherwise leave as-is.

- [ ] **Step 3: Build and lint**

```bash
pnpm -C packages/frontend build
pnpm -C packages/frontend lint
```

Expected: clean build, no new lint errors.

- [ ] **Step 4: Manual band check**

Open the agents page → experiments mode → pick a simulation → click any run.

Verify:

- [ ] A collapsed band appears at the top of the run-detail area showing `topic · persona-type-chip · complexity-chip`, with truncated `intent` on a second line.
- [ ] Clicking the band expands inline to show the full `ScenarioFields` (persona, source chips, info boundaries, instruction, reference messages). The transcript section pushes down.
- [ ] Clicking again collapses the band.
- [ ] Switching to a different run (different scenario) collapses the band automatically.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/ScenarioSummaryBand.tsx \
        packages/frontend/src/components/conversation-sim/SimRunDetail.tsx
git commit -m "feat(frontend): scenario summary band in SimRunDetail

Adds a collapsible ScenarioSummaryBand at the top of the simulated-run
detail view. Collapsed state shows topic + persona type + complexity +
truncated intent; expanded state renders the full ScenarioFields.

Uses the new scenarios.getMaybe query so deleted scenarios degrade to
hidden rather than crashing the run view."
```

---

## Task 7: "Compare to source" toggle + side-by-side on `SimRunDetail`

Final piece: lets the user split the run-detail body into simulated-vs-source columns.

**Files:**
- Modify: `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`

- [ ] **Step 1: Add toggle state and split-pane layout**

In `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`:

1. Add new imports near the top:

```typescript
import { useState, useEffect } from "react";
import { SourceTranscriptPanel } from "@/components/livechat/SourceTranscriptPanel";
import type { Id } from "@convex/_generated/dataModel";
```

2. Inside the component body, after the existing `scenario` query, add:

```typescript
  const [showSource, setShowSource] = useState(false);

  // Reset compare toggle when the run changes
  useEffect(() => {
    setShowSource(false);
  }, [runId]);

  const hasSource = !!scenario?.sourceTranscriptId;
```

3. In the header JSX (the `<div className="px-4 py-2.5 border-b border-border bg-bg-elevated/50 flex items-center justify-between">` block), add a "Compare to source" button. Modify the right side of the header — replace the `{run.terminationReason && (...)}` line with:

```tsx
        <div className="flex items-center gap-3 flex-shrink-0">
          {run.terminationReason && (
            <span className="text-[10px] text-text-dim">
              Ended: {run.terminationReason.replace("_", " ")}
            </span>
          )}
          {hasSource && (
            <button
              onClick={() => setShowSource((v) => !v)}
              className="px-2.5 py-1 text-[10px] text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors"
            >
              {showSource ? "Hide source" : "Compare to source"}
            </button>
          )}
        </div>
```

4. Wrap the existing scrollable content area (`<div className="flex-1 overflow-y-auto">...</div>`) so it splits when `showSource` is true.

The current structure ends with this content area containing:
- ScenarioSummaryBand
- transcript + evaluation div

Restructure to: ScenarioSummaryBand stays at top, then a split row below. Replace the entire `<ScenarioSummaryBand .../>` + `<div className="flex-1 overflow-y-auto">...</div>` chunk with:

```tsx
      <ScenarioSummaryBand scenario={scenario} />

      {/* Body — split when showSource */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto">
          {/* Conversation transcript */}
          <div className="px-4 py-3 space-y-3">
            <h3 className="text-[11px] text-text-dim uppercase tracking-wider">Transcript</h3>
            {groupMessagesWithToolCalls(messages).map((item) => {
              if (item.type === "tool_group") {
                return <ToolCallGroup key={item.key} calls={item.calls} isLive={false} />;
              }
              const msg = item.msg;
              return (
                <div
                  key={msg._id}
                  className={`rounded-md p-3 text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-500/10 border border-blue-500/20 text-text"
                      : "bg-bg-elevated border border-border text-text-dim"
                  }`}
                >
                  <div className={`text-[10px] font-medium mb-1 uppercase ${
                    msg.role === "user" ? "text-blue-400" : "text-accent"
                  }`}>
                    {msg.role === "user" ? "User" : "Agent"}
                  </div>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              );
            })}
          </div>

          {/* Evaluation Results */}
          {run.evaluatorResults && run.evaluatorResults.length > 0 && (
            <div className="px-4 py-3 border-t border-border">
              <h3 className="text-[11px] text-text-dim uppercase tracking-wider mb-2">
                Evaluation ({run.evaluatorResults.filter(r => r.passed).length}/{run.evaluatorResults.length} passed)
              </h3>
              <div className="space-y-2">
                {run.evaluatorResults.map((result, i) => (
                  <div
                    key={i}
                    className={`rounded-md p-2.5 border text-xs ${
                      result.passed
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-red-500/5 border-red-500/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-text">
                        {result.evaluatorName}
                        {result.required && <span className="text-accent ml-1">*</span>}
                      </span>
                      <span className={`text-[10px] font-medium ${result.passed ? "text-green-400" : "text-red-400"}`}>
                        {result.passed ? "PASS" : "FAIL"}
                      </span>
                    </div>
                    <p className="text-text-dim mt-1">{result.justification}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {showSource && hasSource && scenario?.sourceTranscriptId && (
          <div className="w-1/2 min-w-0 border-l border-border overflow-hidden">
            <SourceTranscriptPanel
              sourceTranscriptId={scenario.sourceTranscriptId as Id<"livechatConversations">}
            />
          </div>
        )}
      </div>
```

- [ ] **Step 2: Build and lint**

```bash
pnpm -C packages/frontend build
pnpm -C packages/frontend lint
```

Expected: clean build, no new lint errors.

- [ ] **Step 3: Manual full agents-page checklist**

Open the agents page → experiments mode → pick a simulation → click runs.

Verify:

- [ ] Run for transcript-grounded scenario → "Compare to source" button visible in header.
- [ ] Click it → run-detail body splits 50/50: simulated transcript on left, source live-chat on right with role-styled `ChatBubble`s.
- [ ] Both columns scroll independently.
- [ ] Click "Hide source" → returns to single-column view.
- [ ] Run for synthetic scenario → no "Compare to source" button.
- [ ] Toggle on, then click a different run → toggle resets to off.
- [ ] Tool-call pills still render inline as in Task 4.
- [ ] `ScenarioSummaryBand` still renders/expands as in Task 6.
- [ ] Evaluation Results section still appears below the transcript in the left column.

- [ ] **Step 4: Final regression sweep**

Quickly re-verify earlier tasks didn't regress:

- [ ] Open the agent playground for any agent. Send a message that triggers tool calls. Pills render exactly as before Task 1.
- [ ] On the dataset page, open a transcript-grounded scenario. Toggle "View source transcript" — works as added in Task 3.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/SimRunDetail.tsx
git commit -m "feat(frontend): compare-to-source split-pane in SimRunDetail

Adds a 'Compare to source' toggle in the run-detail header that splits
the body 50/50 with the simulated transcript on the left and the source
live-chat transcript on the right. Toggle is hidden for synthetic
scenarios (no source) and resets when the user selects a different run.

Completes the transcript-visibility feature: scenarios are now linked
to their source transcripts on the dataset page, simulated runs are
linked to both their scenario and source transcript on the agents
page, and tool calls render inline with their results."
```

---

## Done

After Task 7, the feature is complete. Run a final full-feature browser walkthrough using the spec's manual verification checklist (`docs/superpowers/specs/2026-04-28-transcript-visibility-design.md`) and confirm every checkbox.

If anything fails the checklist, fix it as a follow-up commit before merging.
