# Agent Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a conversational Q&A agent that uses the existing retriever system to answer questions from selected knowledge bases, with a chat UI at `/agent`.

**Architecture:** Convex Agent component (`@convex-dev/agent`) manages threads, messages, and streaming. Each thread has a set of KB retriever tools created dynamically via `CallbackRetriever` from eval-lib. Frontend is a new `/agent` page with thread sidebar, chat, and source citations.

**Tech Stack:** `@convex-dev/agent`, `@ai-sdk/openai`, `ai` (Vercel AI SDK), existing `rag-evaluation-system` (CallbackRetriever), Convex, Next.js, React, Tailwind CSS v4

---

### Task 1: Install dependencies

**Files:**
- Modify: `packages/backend/package.json:12-20` (add dependencies)
- Modify: `packages/frontend/package.json:11-19` (add dependency)

**Step 1: Install backend dependencies**

```bash
cd packages/backend && pnpm add @convex-dev/agent @ai-sdk/openai ai zod
```

This adds:
- `@convex-dev/agent` — Agent component (threads, messages, tool calling)
- `@ai-sdk/openai` — AI SDK OpenAI model provider
- `ai` — Vercel AI SDK core
- `zod` — Schema validation for tool args (required by AI SDK tools)

**Step 2: Install frontend dependency**

```bash
cd packages/frontend && pnpm add @convex-dev/agent
```

This adds the `useUIMessages` React hook and related types.

**Step 3: Verify installation**

```bash
cd /path/to/repo && pnpm install
```

Expected: Clean install, no peer dependency errors.

**Step 4: Commit**

```bash
git add packages/backend/package.json packages/frontend/package.json pnpm-lock.yaml
git commit -m "feat(agent): add convex-agent and AI SDK dependencies"
```

---

### Task 2: Register agent component in Convex

**Files:**
- Modify: `packages/backend/convex/convex.config.ts`

**Step 1: Add agent component to app config**

Current file:
```ts
import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();
app.use(workpool, { name: "indexingPool" });
app.use(workpool, { name: "generationPool" });
app.use(workpool, { name: "experimentPool" });

export default app;
```

Update to:
```ts
import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp();
app.use(workpool, { name: "indexingPool" });
app.use(workpool, { name: "generationPool" });
app.use(workpool, { name: "experimentPool" });
app.use(agent);

export default app;
```

**Step 2: Add agentThreadConfigs table to schema**

Modify `packages/backend/convex/schema.ts`. Add after the `indexingJobs` table definition (line 202), before the closing `});`:

```ts
  // ─── Agent Thread Configs (KB + retriever config per chat thread) ───
  agentThreadConfigs: defineTable({
    threadId: v.string(),
    orgId: v.string(),
    userId: v.string(),
    title: v.optional(v.string()),
    kbConfigs: v.array(
      v.object({
        kbId: v.id("knowledgeBases"),
        retrieverConfig: v.optional(v.any()),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_user_org", ["userId", "orgId"]),
```

**Step 3: Verify Convex can deploy the schema**

```bash
cd packages/backend && npx convex dev --once
```

Expected: Schema deployed successfully, agent component tables created.

**Step 4: Commit**

```bash
git add packages/backend/convex/convex.config.ts packages/backend/convex/schema.ts
git commit -m "feat(agent): register agent component and add agentThreadConfigs table"
```

---

### Task 3: Create retriever tool factory

**Files:**
- Create: `packages/backend/convex/agent/retrieverTool.ts`

This is a `"use node"` file. It exports a factory function that creates a `createTool` instance for a given KB. Uses `createEmbedder` from `rag-evaluation-system/llm` (the single shared copy) for embeddings, and calls `internal.retrieval.chunks.fetchChunksWithDocs` for chunk hydration.

**Step 1: Create the retriever tool factory**

Create `packages/backend/convex/agent/retrieverTool.ts`:

```ts
"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import {
  CallbackRetriever,
  DocumentId,
  PositionAwareChunkId,
  type PositionAwareChunk,
} from "rag-evaluation-system";
import { createEmbedder } from "rag-evaluation-system/llm";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

interface KBToolConfig {
  kbId: Id<"knowledgeBases">;
  kbName: string;
  indexConfigHash?: string;
  embeddingModel?: string;
}

export function createKBRetrieverTool(config: KBToolConfig) {
  const { kbId, kbName, indexConfigHash, embeddingModel } = config;

  return createTool({
    description: `Search the "${kbName}" knowledge base for relevant information. Use this tool when the user asks questions that might be answered by documents in ${kbName}.`,
    args: z.object({
      query: z.string().describe("The search query to find relevant information"),
      topK: z.number().default(10).describe("Number of top results to return"),
    }),
    handler: async (ctx, { query, topK }): Promise<string> => {
      const embedder = createEmbedder(embeddingModel);

      const retriever = new CallbackRetriever({
        name: `kb-${kbName}`,
        retrieveFn: async (q: string, k: number) => {
          const queryEmbedding = await embedder.embedQuery(q);
          const vectorLimit = Math.min(k * 4, 256);

          const searchResults = await ctx.vectorSearch(
            "documentChunks",
            "by_embedding",
            {
              vector: queryEmbedding,
              limit: vectorLimit,
              filter: (f: any) => f.eq("kbId", kbId),
            },
          );

          const chunks = await ctx.runQuery(
            internal.retrieval.chunks.fetchChunksWithDocs,
            { ids: searchResults.map((r: any) => r._id) },
          );

          // Post-filter by indexConfigHash if provided, take top-K
          const filtered = indexConfigHash
            ? chunks.filter((c: any) => c.indexConfigHash === indexConfigHash)
            : chunks;

          return filtered.slice(0, k).map(
            (c: any): PositionAwareChunk => ({
              id: PositionAwareChunkId(c.chunkId),
              content: c.content,
              metadata: c.metadata ?? {},
              docId: DocumentId(c.docId),
              start: c.start,
              end: c.end,
            }),
          );
        },
      });

      const results = await retriever.retrieve(query, topK);

      // Format results for the LLM with source attribution
      if (results.length === 0) {
        return `No relevant results found in "${kbName}" for this query.`;
      }

      const formatted = results.map((chunk, i) => {
        return [
          `[Source ${i + 1}] Document: ${chunk.docId}, chars ${chunk.start}-${chunk.end}`,
          chunk.content,
        ].join("\n");
      });

      return `Found ${results.length} relevant chunks from "${kbName}":\n\n${formatted.join("\n\n---\n\n")}`;
    },
  });
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd packages/backend && pnpm typecheck
```

Expected: No type errors in the new file.

**Step 3: Commit**

```bash
git add packages/backend/convex/agent/retrieverTool.ts
git commit -m "feat(agent): add KB retriever tool factory using CallbackRetriever"
```

---

### Task 4: Create agent definition and thread management

**Files:**
- Create: `packages/backend/convex/agent/agentActions.ts` — `"use node"` action for streaming
- Create: `packages/backend/convex/agent/threads.ts` — mutations/queries for thread CRUD and message listing

**Step 1: Create the agent actions file**

Create `packages/backend/convex/agent/agentActions.ts`:

```ts
"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Agent, createThread as agentCreateThread } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "../_generated/api";
import { createKBRetrieverTool } from "./retrieverTool";
import type { Id } from "../_generated/dataModel";
import { stepCountIs } from "ai";

const SYSTEM_INSTRUCTIONS = `You are a knowledgeable Q&A assistant with access to one or more knowledge base search tools.

When a user asks a question:
1. Use the appropriate search tool(s) to find relevant information
2. Synthesize a clear, accurate answer based on the retrieved content
3. Cite your sources by referencing the document names and relevant sections
4. If the search returns no relevant results, say so honestly

Always ground your answers in the retrieved content. Do not make up information.`;

export const streamResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    // Load thread config to get KB tools
    const threadConfig = await ctx.runQuery(
      internal.agent.threads.getConfigByThread,
      { threadId: args.threadId },
    );

    if (!threadConfig) {
      throw new Error("Thread config not found");
    }

    // Build tools dynamically based on configured KBs
    const tools: Record<string, ReturnType<typeof createKBRetrieverTool>> = {};

    for (const kbConfig of threadConfig.kbConfigs) {
      const kb = await ctx.runQuery(internal.agent.threads.getKBInternal, {
        kbId: kbConfig.kbId,
      });
      if (!kb) continue;

      // Create a tool name from KB name (sanitize for use as identifier)
      const toolName = `search_${kb.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

      tools[toolName] = createKBRetrieverTool({
        kbId: kbConfig.kbId,
        kbName: kb.name,
        indexConfigHash: undefined, // Use default/any available index
        embeddingModel: "text-embedding-3-small",
      });
    }

    // Create agent dynamically with the thread's tools
    const agent = new Agent(components.agent, {
      name: "QA Agent",
      languageModel: openai.chat("gpt-4o-mini"),
      instructions: SYSTEM_INSTRUCTIONS,
      tools,
      stopWhen: stepCountIs(5),
    });

    // Stream the response
    const result = await agent.streamText(
      ctx,
      { threadId: args.threadId },
      { promptMessageId: args.promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );

    await result.consumeStream();
  },
});
```

**Step 2: Create the thread management file**

Create `packages/backend/convex/agent/threads.ts`:

```ts
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "../_generated/server";
import { internal, components } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
import {
  createThread as agentCreateThread,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";

// ─── Public mutations/queries ───

export const createThread = mutation({
  args: {
    title: v.optional(v.string()),
    kbConfigs: v.array(
      v.object({
        kbId: v.id("knowledgeBases"),
        retrieverConfig: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await getAuthContext(ctx);

    // Create thread in agent component
    const threadId = await agentCreateThread(ctx, components.agent, {
      userId,
      title: args.title ?? "New conversation",
    });

    // Store our custom config
    await ctx.db.insert("agentThreadConfigs", {
      threadId,
      orgId,
      userId,
      title: args.title ?? "New conversation",
      kbConfigs: args.kbConfigs,
      createdAt: Date.now(),
    });

    return { threadId };
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await getAuthContext(ctx); // Verify auth

    // Import Agent inline to avoid "use node" constraint
    // We use the low-level API to save a message and schedule the action
    const { saveMessage } = await import("@convex-dev/agent");
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: args.content,
      skipEmbeddings: true,
    });

    // Schedule the streaming action
    await ctx.scheduler.runAfter(
      0,
      internal.agent.agentActions.streamResponse,
      {
        threadId: args.threadId,
        promptMessageId: messageId,
      },
    );

    return { messageId };
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await getAuthContext(ctx); // Verify auth
    const streams = await syncStreams(ctx, components.agent, args);
    const paginated = await listUIMessages(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId } = await getAuthContext(ctx);

    return await ctx.db
      .query("agentThreadConfigs")
      .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

export const getThreadConfig = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    await getAuthContext(ctx);

    return await ctx.db
      .query("agentThreadConfigs")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique();
  },
});

// ─── Internal queries (used by agentActions) ───

export const getConfigByThread = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentThreadConfigs")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique();
  },
});

export const getKBInternal = internalQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.kbId);
  },
});
```

**Step 3: Verify TypeScript compiles**

```bash
cd packages/backend && pnpm typecheck
```

Expected: No type errors.

**Step 4: Deploy to Convex dev and verify**

```bash
cd packages/backend && npx convex dev --once
```

Expected: Successful deployment with new agent functions registered.

**Step 5: Commit**

```bash
git add packages/backend/convex/agent/
git commit -m "feat(agent): add QA agent definition, streaming action, and thread management"
```

---

### Task 5: Update Header with agent navigation link

**Files:**
- Modify: `packages/frontend/src/components/Header.tsx:6-48`

**Step 1: Add "agent" to the mode type and add the link**

In `packages/frontend/src/components/Header.tsx`, update the `HeaderProps` interface and add the Agent link:

Change the interface (line 8):
```ts
  mode?: "generate" | "retrievers" | "experiments" | "agent";
```

Add the Agent link after the Experiments link (after line 45), inside the same `<div className="flex gap-1 ...">`:
```tsx
                <Link
                  href="/agent"
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === "agent"
                      ? "bg-bg-elevated text-accent"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Agent
                </Link>
```

**Step 2: Verify it renders**

```bash
cd packages/frontend && pnpm build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/Header.tsx
git commit -m "feat(agent): add Agent nav link to header"
```

---

### Task 6: Create agent chat page — basic layout

**Files:**
- Create: `packages/frontend/src/app/agent/page.tsx`

**Step 1: Create the agent page with thread sidebar and chat view**

Create `packages/frontend/src/app/agent/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Header } from "@/components/Header";
import type { Id } from "@convex/_generated/dataModel";

export default function AgentPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex flex-col">
      <Header mode="agent" />
      <div className="flex flex-1 overflow-hidden">
        {/* Thread sidebar */}
        <ThreadSidebar
          selectedThreadId={selectedThreadId}
          onSelectThread={setSelectedThreadId}
        />
        {/* Main chat area */}
        <div className="flex-1 flex flex-col">
          {selectedThreadId ? (
            <ChatView threadId={selectedThreadId} />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Thread Sidebar ───

function ThreadSidebar({
  selectedThreadId,
  onSelectThread,
}: {
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
}) {
  const threads = useQuery(api.agent.threads.listThreads);
  const [showNewThread, setShowNewThread] = useState(false);

  return (
    <aside className="w-64 border-r border-border bg-bg-elevated/50 flex flex-col">
      <div className="p-3 border-b border-border">
        <button
          onClick={() => setShowNewThread(true)}
          className="w-full px-3 py-2 text-xs font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors"
        >
          + New Chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads?.map((thread) => (
          <button
            key={thread.threadId}
            onClick={() => onSelectThread(thread.threadId)}
            className={`w-full text-left px-3 py-2.5 text-xs border-b border-border/50 transition-colors ${
              selectedThreadId === thread.threadId
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:bg-bg-elevated hover:text-text"
            }`}
          >
            <div className="truncate font-medium">
              {thread.title ?? "Untitled"}
            </div>
            <div className="text-text-dim text-[10px] mt-0.5">
              {thread.kbConfigs.length} KB{thread.kbConfigs.length !== 1 ? "s" : ""}
            </div>
          </button>
        ))}
      </div>
      {showNewThread && (
        <NewThreadDialog
          onClose={() => setShowNewThread(false)}
          onCreated={(threadId) => {
            setShowNewThread(false);
            onSelectThread(threadId);
          }}
        />
      )}
    </aside>
  );
}

// ─── New Thread Dialog ───

function NewThreadDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (threadId: string) => void;
}) {
  const knowledgeBases = useQuery(api.crud.knowledgeBases.list);
  const createThread = useMutation(api.agent.threads.createThread);
  const [selectedKBs, setSelectedKBs] = useState<Set<Id<"knowledgeBases">>>(
    new Set(),
  );
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const toggleKB = (kbId: Id<"knowledgeBases">) => {
    setSelectedKBs((prev) => {
      const next = new Set(prev);
      if (next.has(kbId)) next.delete(kbId);
      else next.add(kbId);
      return next;
    });
  };

  const handleCreate = async () => {
    if (selectedKBs.size === 0) return;
    setCreating(true);
    try {
      const { threadId } = await createThread({
        title: title || undefined,
        kbConfigs: Array.from(selectedKBs).map((kbId) => ({
          kbId,
          retrieverConfig: undefined,
        })),
      });
      onCreated(threadId);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-bg-elevated border border-border rounded-lg p-5 w-96 max-h-[80vh] flex flex-col">
        <h2 className="text-sm font-semibold text-text mb-3">New Chat</h2>

        <input
          type="text"
          placeholder="Chat title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 text-xs bg-bg border border-border rounded mb-3 text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />

        <div className="text-xs text-text-muted mb-2">
          Select knowledge bases:
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 mb-3">
          {knowledgeBases?.map((kb) => (
            <label
              key={kb._id}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedKBs.has(kb._id)}
                onChange={() => toggleKB(kb._id)}
                className="accent-accent"
              />
              <span className="text-xs text-text">{kb.name}</span>
              {kb.description && (
                <span className="text-[10px] text-text-dim truncate">
                  — {kb.description}
                </span>
              )}
            </label>
          ))}
          {knowledgeBases?.length === 0 && (
            <div className="text-xs text-text-dim px-2">
              No knowledge bases found. Create one first.
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-muted hover:text-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={selectedKBs.size === 0 || creating}
            className="px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {creating ? "Creating..." : "Start Chat"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chat View ───

function ChatView({ threadId }: { threadId: string }) {
  const threadConfig = useQuery(api.agent.threads.getThreadConfig, {
    threadId,
  });

  return (
    <div className="flex-1 flex flex-col">
      {/* KB badges bar */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <span className="text-[10px] text-text-dim">KBs:</span>
        {threadConfig?.kbConfigs.map((kc) => (
          <KBBadge key={String(kc.kbId)} kbId={kc.kbId} />
        ))}
      </div>

      {/* Messages */}
      <MessageList threadId={threadId} />

      {/* Input */}
      <MessageInput threadId={threadId} />
    </div>
  );
}

function KBBadge({ kbId }: { kbId: Id<"knowledgeBases"> }) {
  const kb = useQuery(api.crud.knowledgeBases.get, { id: kbId });
  return (
    <span className="px-2 py-0.5 text-[10px] font-medium bg-accent/10 text-accent rounded">
      {kb?.name ?? "..."}
    </span>
  );
}

// ─── Message List (placeholder — will use useUIMessages in Task 7) ───

function MessageList({ threadId }: { threadId: string }) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="text-xs text-text-dim text-center py-8">
        Messages will appear here. Send a message to start.
      </div>
    </div>
  );
}

// ─── Message Input ───

function MessageInput({ threadId }: { threadId: string }) {
  const sendMessage = useMutation(api.agent.threads.sendMessage);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      await sendMessage({ threadId, content: text });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-border p-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Ask a question..."
          className="flex-1 px-3 py-2 text-xs bg-bg border border-border rounded text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="px-4 py-2 text-xs font-medium bg-accent text-bg rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

// ─── Empty State ───

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="text-sm text-text-muted mb-1">No chat selected</div>
        <div className="text-xs text-text-dim">
          Create a new chat or select an existing one
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

```bash
cd packages/frontend && pnpm build
```

Expected: Build succeeds. Page at `/agent` renders with sidebar and empty state.

**Step 3: Commit**

```bash
git add packages/frontend/src/app/agent/page.tsx
git commit -m "feat(agent): add agent chat page with thread sidebar and basic layout"
```

---

### Task 7: Wire up message streaming with useUIMessages

**Files:**
- Modify: `packages/frontend/src/app/agent/page.tsx` — replace `MessageList` placeholder with real streaming messages

**Step 1: Replace the MessageList component**

Replace the placeholder `MessageList` component in `packages/frontend/src/app/agent/page.tsx` with:

```tsx
import { useUIMessages } from "@convex-dev/agent/react";

function MessageList({ threadId }: { threadId: string }) {
  const { results, status, loadMore } = useUIMessages(
    api.agent.threads.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true },
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {status === "LoadingFirstPage" && (
        <div className="text-xs text-text-dim text-center py-8">
          Loading messages...
        </div>
      )}

      {results.length === 0 && status !== "LoadingFirstPage" && (
        <div className="text-xs text-text-dim text-center py-8">
          Send a message to start the conversation.
        </div>
      )}

      {results.map((message) => (
        <MessageBubble key={message.key} message={message} />
      ))}
    </div>
  );
}
```

**Step 2: Add the MessageBubble component**

Add to the same file:

```tsx
function MessageBubble({ message }: { message: any }) {
  const isUser = message.role === "user";
  const isToolCall = message.role === "tool";

  // Skip rendering raw tool call messages — they'll be shown as sources
  if (message.role === "assistant" && message.toolCalls?.length > 0 && !message.text) {
    return null;
  }

  // Render tool results as source cards
  if (isToolCall) {
    return <SourceSection content={message.text ?? ""} />;
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] px-3 py-2 rounded-lg text-xs leading-relaxed ${
          isUser
            ? "bg-accent/15 text-accent"
            : "bg-bg-elevated text-text border border-border/50"
        }`}
      >
        {message.text || (
          <span className="text-text-dim italic">Thinking...</span>
        )}
      </div>
    </div>
  );
}

function SourceSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  // Only show if there are actual results
  if (!content || content.includes("No relevant results")) return null;

  return (
    <div className="ml-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-text-dim hover:text-text-muted transition-colors flex items-center gap-1"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>Sources</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {content.split("---").map((chunk, i) => (
            <div
              key={i}
              className="px-2 py-1.5 text-[10px] bg-bg border border-border/50 rounded text-text-muted leading-relaxed"
            >
              {chunk.trim().slice(0, 300)}
              {chunk.trim().length > 300 && "..."}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Add the import for useState at the top of the file**

Ensure `useState` is imported (it should already be from the existing code).

**Step 4: Verify build**

```bash
cd packages/frontend && pnpm build
```

Expected: Build succeeds.

**Step 5: Commit**

```bash
git add packages/frontend/src/app/agent/page.tsx
git commit -m "feat(agent): wire up message streaming with useUIMessages and source display"
```

---

### Task 8: End-to-end manual test

**Files:** None (testing only)

**Step 1: Start the backend**

```bash
cd packages/backend && npx convex dev
```

Expected: Deploys successfully with agent component and new functions.

**Step 2: Start the frontend**

```bash
cd packages/frontend && pnpm dev
```

**Step 3: Manual test flow**

1. Navigate to `/agent`
2. Click "New Chat"
3. Select a knowledge base that has been indexed (has documents with chunks)
4. Type a question and send
5. Verify:
   - Message appears in the chat
   - Agent streams a response
   - Sources section is collapsible and shows retrieved chunks
   - Thread appears in the sidebar
   - Selecting a different thread loads its messages

**Step 4: Fix any issues discovered during testing**

Address any runtime errors, type mismatches, or UI issues.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(agent): address issues from end-to-end testing"
```

---

### Task 9: Final cleanup and commit

**Files:**
- Review all new/modified files

**Step 1: Run typecheck across packages**

```bash
pnpm typecheck && pnpm typecheck:backend
```

Expected: No type errors.

**Step 2: Run existing tests to ensure no regressions**

```bash
pnpm test
```

Expected: All existing tests pass (133 eval-lib tests, with the 3 pre-existing dimension test failures).

**Step 3: Verify Convex deploy works**

```bash
cd packages/backend && npx convex dev --once
```

Expected: Clean deployment.

**Step 4: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore(agent): final cleanup for agent module"
```

---

## File Summary

### New files:
- `packages/backend/convex/agent/retrieverTool.ts` — KB retriever tool factory
- `packages/backend/convex/agent/agentActions.ts` — Streaming action (use node)
- `packages/backend/convex/agent/threads.ts` — Thread CRUD mutations/queries
- `packages/frontend/src/app/agent/page.tsx` — Agent chat page

### Modified files:
- `packages/backend/package.json` — New dependencies
- `packages/frontend/package.json` — New dependency
- `packages/backend/convex/convex.config.ts` — Register agent component
- `packages/backend/convex/schema.ts` — Add agentThreadConfigs table
- `packages/frontend/src/components/Header.tsx` — Add Agent nav link

### Unchanged:
- All eval-lib code (sub-path modules: `/langsmith`, `/llm`, `/shared` consumed as dependencies)
- All existing backend functions (in `crud/`, `generation/`, `retrieval/`, `experiments/`, `langsmith/` directories)
- All existing frontend pages
- All existing schema tables
