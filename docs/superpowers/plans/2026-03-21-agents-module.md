# Agents Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Agents module that lets users create CX agents with structured prompt configs, connect retriever tools from any KB, and test them in a side-by-side playground with streaming responses.

**Architecture:** Convex-native agent system. Vercel AI SDK (`@ai-sdk/anthropic`) for LLM calls inside `"use node"` actions. New tables: `agents`, `conversations`, `messages`, `streamDeltas`. Frontend: sidebar + config panel + playground chat in a two-column layout.

**Tech Stack:** Convex, Vercel AI SDK, @ai-sdk/anthropic, Next.js App Router, Tailwind CSS, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-21-agents-module-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/backend/convex/agents/promptTemplate.ts` | Pure function `composeSystemPrompt()` — no `"use node"` deps |
| `packages/backend/convex/crud/agents.ts` | Agent CRUD: byOrg, get, create, update, remove |
| `packages/backend/convex/crud/conversations.ts` | Conversation + message CRUD: create, get, listMessages, getStreamDeltas, insertMessage, updateMessage, insertStreamDelta, cleanupStreamDeltas |
| `packages/backend/convex/agents/orchestration.ts` | `sendMessage` mutation, `getPlayground` query, playground management |
| `packages/backend/convex/agents/actions.ts` | `"use node"` — `runAgent` action, `extractUrlContext` action |
| `packages/frontend/src/app/agents/page.tsx` | Agents module page (sidebar + two-column main area) |
| `packages/frontend/src/components/AgentSidebar.tsx` | Agent list sidebar |
| `packages/frontend/src/components/AgentConfigPanel.tsx` | Agent configuration form |
| `packages/frontend/src/components/AgentPlayground.tsx` | Chat playground with streaming |
| `packages/frontend/src/components/ToolCallChip.tsx` | Expandable tool call display |

### Modified Files

| File | What Changes |
|------|-------------|
| `packages/backend/convex/schema.ts` | Add 4 new tables: agents, conversations, messages, streamDeltas |
| `packages/backend/convex.json` | Add `ai`, `@ai-sdk/anthropic`, `zod` to externalPackages |
| `packages/backend/package.json` | Add `ai`, `@ai-sdk/anthropic` dependencies |
| `packages/backend/convex/crud/knowledgeBases.ts` | Add `getInternal` internalQuery |
| `packages/frontend/src/components/Header.tsx` | Add `"agents"` to mode type union, add nav link |
| `packages/frontend/src/components/ModeSelector.tsx` | Add Agents module card |

---

## Task 1: Dependencies and Schema

**Files:**
- Modify: `packages/backend/package.json` (dependencies section, ~line 12)
- Modify: `packages/backend/convex.json` (externalPackages array, ~line 4)
- Modify: `packages/backend/convex/schema.ts` (add tables before closing export, ~line 334)

- [ ] **Step 1: Add AI SDK dependencies**

In `packages/backend/package.json`, add to the `dependencies` object:

```json
"ai": "^4.3.0",
"@ai-sdk/anthropic": "^1.2.0"
```

- [ ] **Step 2: Add external packages for Convex bundler**

In `packages/backend/convex.json`, add `"ai"` and `"@ai-sdk/anthropic"` to the `externalPackages` array:

```json
"externalPackages": [
  "langsmith", "@langchain/core", "openai", "minisearch",
  "@mozilla/readability", "linkedom", "turndown", "unpdf",
  "ai", "@ai-sdk/anthropic", "zod"
]
```

- [ ] **Step 3: Add schema tables**

In `packages/backend/convex/schema.ts`, add 4 new tables before the closing of `defineSchema({})`. Add after the `crawlUrls` table (~line 333):

```typescript
// ── Agents ──────────────────────────────────────────────
agents: defineTable({
  orgId: v.string(),
  name: v.string(),

  // Structured prompt sections
  identity: v.object({
    agentName: v.string(),
    companyName: v.string(),
    companyUrl: v.optional(v.string()),
    companyContext: v.optional(v.string()),
    roleDescription: v.string(),
    brandVoice: v.optional(v.string()),
  }),
  guardrails: v.object({
    outOfScope: v.optional(v.string()),
    escalationRules: v.optional(v.string()),
    compliance: v.optional(v.string()),
  }),
  responseStyle: v.object({
    formatting: v.optional(v.string()),
    length: v.optional(v.string()),
    formality: v.optional(v.string()),
    language: v.optional(v.string()),
  }),
  additionalInstructions: v.optional(v.string()),

  model: v.string(),
  enableReflection: v.boolean(),
  retrieverIds: v.array(v.id("retrievers")),

  status: v.union(
    v.literal("draft"),
    v.literal("ready"),
    v.literal("error"),
  ),
  createdAt: v.number(),
})
  .index("by_org", ["orgId"]),

conversations: defineTable({
  orgId: v.string(),
  title: v.optional(v.string()),
  agentIds: v.array(v.id("agents")),
  status: v.union(v.literal("active"), v.literal("archived")),
  createdAt: v.number(),
})
  .index("by_org", ["orgId"]),

messages: defineTable({
  conversationId: v.id("conversations"),
  order: v.number(),
  role: v.union(
    v.literal("system"),
    v.literal("user"),
    v.literal("assistant"),
    v.literal("tool_call"),
    v.literal("tool_result"),
  ),
  content: v.string(),
  agentId: v.optional(v.id("agents")),
  toolCall: v.optional(
    v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      toolArgs: v.string(),
      retrieverId: v.optional(v.id("retrievers")),
    }),
  ),
  toolResult: v.optional(
    v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      result: v.string(),
      retrieverId: v.optional(v.id("retrievers")),
    }),
  ),
  status: v.union(
    v.literal("pending"),
    v.literal("streaming"),
    v.literal("complete"),
    v.literal("error"),
  ),
  usage: v.optional(
    v.object({
      promptTokens: v.number(),
      completionTokens: v.number(),
    }),
  ),
  createdAt: v.number(),
})
  .index("by_conversation", ["conversationId", "order"]),

streamDeltas: defineTable({
  messageId: v.id("messages"),
  start: v.number(),
  end: v.number(),
  text: v.string(),
})
  .index("by_message", ["messageId", "start"]),
```

- [ ] **Step 4: Install dependencies and verify**

Run from repo root:

```bash
pnpm install
```

Then verify schema deploys:

```bash
cd packages/backend && npx convex dev --once
```

Expected: successful deployment with new tables created.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/package.json packages/backend/convex.json packages/backend/convex/schema.ts pnpm-lock.yaml
git commit -m "feat(agents): add schema tables and AI SDK dependencies"
```

---

## Task 2: Prompt Template System

**Files:**
- Create: `packages/backend/convex/agents/promptTemplate.ts`
- Test: `packages/backend/tests/promptTemplate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/tests/promptTemplate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "../convex/agents/promptTemplate";

const baseAgent = {
  identity: {
    agentName: "Test Bot",
    companyName: "Test Corp",
    roleDescription: "You are a helpful support agent.",
  },
  guardrails: {},
  responseStyle: {},
  enableReflection: false,
  additionalInstructions: undefined,
};

const mockRetrievers = [
  { name: "Product Docs", kbName: "Acme KB", description: undefined },
  { name: "FAQ Search", kbName: "Acme KB", description: "Searches FAQ articles" },
];

describe("composeSystemPrompt", () => {
  it("includes identity section with agent and company name", () => {
    const prompt = composeSystemPrompt(baseAgent, []);
    expect(prompt).toContain("Test Bot");
    expect(prompt).toContain("Test Corp");
    expect(prompt).toContain("You are a helpful support agent.");
  });

  it("omits empty sections", () => {
    const prompt = composeSystemPrompt(baseAgent, []);
    expect(prompt).not.toContain("Guardrails");
    expect(prompt).not.toContain("Response Style");
    expect(prompt).not.toContain("Additional Instructions");
  });

  it("includes guardrails when provided", () => {
    const agent = {
      ...baseAgent,
      guardrails: {
        outOfScope: "competitor pricing",
        escalationRules: "escalate when frustrated",
      },
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("competitor pricing");
    expect(prompt).toContain("escalate when frustrated");
  });

  it("includes response style when provided", () => {
    const agent = {
      ...baseAgent,
      responseStyle: { formality: "professional", length: "concise" },
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("professional");
    expect(prompt).toContain("concise");
  });

  it("lists retriever tools with KB name", () => {
    const prompt = composeSystemPrompt(baseAgent, mockRetrievers);
    expect(prompt).toContain("Product Docs");
    expect(prompt).toContain("Acme KB");
    expect(prompt).toContain("FAQ Search");
    expect(prompt).toContain("Searches FAQ articles");
  });

  it("includes reflection instructions when enabled", () => {
    const agent = { ...baseAgent, enableReflection: true };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("Self-Evaluation");
    expect(prompt).toContain("factual");
  });

  it("excludes reflection instructions when disabled", () => {
    const prompt = composeSystemPrompt(baseAgent, []);
    expect(prompt).not.toContain("Self-Evaluation");
  });

  it("includes additional instructions when provided", () => {
    const agent = {
      ...baseAgent,
      additionalInstructions: "Always greet the user by name.",
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("Always greet the user by name.");
  });

  it("includes company context when provided", () => {
    const agent = {
      ...baseAgent,
      identity: {
        ...baseAgent.identity,
        companyContext: "Acme Corp sells widgets worldwide.",
      },
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("Acme Corp sells widgets worldwide.");
  });

  it("includes brand voice when provided", () => {
    const agent = {
      ...baseAgent,
      identity: {
        ...baseAgent.identity,
        brandVoice: "friendly, professional, concise",
      },
    };
    const prompt = composeSystemPrompt(agent, []);
    expect(prompt).toContain("friendly, professional, concise");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run tests/promptTemplate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement composeSystemPrompt**

Create `packages/backend/convex/agents/promptTemplate.ts`:

```typescript
/**
 * Pure function that composes a system prompt from structured agent config.
 * No "use node" dependencies — importable from actions, mutations, and tests.
 */

interface AgentPromptConfig {
  identity: {
    agentName: string;
    companyName: string;
    companyUrl?: string;
    companyContext?: string;
    roleDescription: string;
    brandVoice?: string;
  };
  guardrails: {
    outOfScope?: string;
    escalationRules?: string;
    compliance?: string;
  };
  responseStyle: {
    formatting?: string;
    length?: string;
    formality?: string;
    language?: string;
  };
  enableReflection: boolean;
  additionalInstructions?: string;
}

interface RetrieverInfo {
  name: string;
  kbName: string;
  description?: string;
}

export function composeSystemPrompt(
  agent: AgentPromptConfig,
  retrievers: RetrieverInfo[],
): string {
  const sections: string[] = [];

  // Identity
  const identityLines = [
    `# Identity`,
    `You are ${agent.identity.agentName}, a customer support agent for ${agent.identity.companyName}.`,
    agent.identity.roleDescription,
  ];
  if (agent.identity.companyContext) {
    identityLines.push("", `## About ${agent.identity.companyName}`, agent.identity.companyContext);
  }
  if (agent.identity.brandVoice) {
    identityLines.push("", `## Voice & Tone`, agent.identity.brandVoice);
  }
  sections.push(identityLines.join("\n"));

  // Response Style
  const styleLines: string[] = [];
  if (agent.responseStyle.formality) styleLines.push(`Formality: ${agent.responseStyle.formality}`);
  if (agent.responseStyle.length) styleLines.push(`Response length: ${agent.responseStyle.length}`);
  if (agent.responseStyle.formatting) styleLines.push(`Formatting: ${agent.responseStyle.formatting}`);
  if (agent.responseStyle.language) styleLines.push(`Always respond in: ${agent.responseStyle.language}`);
  if (styleLines.length > 0) {
    sections.push(`# Response Style\n${styleLines.join("\n")}`);
  }

  // Guardrails
  const guardrailParts: string[] = [];
  if (agent.guardrails.outOfScope) {
    guardrailParts.push(
      `## Out of Scope\nThe following topics are outside your scope. Politely decline and explain you cannot help with these:\n${agent.guardrails.outOfScope}`,
    );
  }
  if (agent.guardrails.escalationRules) {
    guardrailParts.push(`## Escalation\n${agent.guardrails.escalationRules}`);
  }
  if (agent.guardrails.compliance) {
    guardrailParts.push(`## Compliance\n${agent.guardrails.compliance}`);
  }
  if (guardrailParts.length > 0) {
    sections.push(`# Guardrails\n${guardrailParts.join("\n\n")}`);
  }

  // Tools
  if (retrievers.length > 0) {
    const toolLines = retrievers.map((r) => {
      const desc = r.description ?? `Searches ${r.kbName}`;
      return `- **${r.name}** (${r.kbName}): ${desc}`;
    });
    sections.push(
      `# Tools\nYou have access to the following retrieval tools to search the knowledge base:\n${toolLines.join("\n")}\n\nUse these tools when you need factual information to answer the user's question. You may call one, multiple, or no tools depending on the query. Do not fabricate information — if you cannot find a relevant answer in the retrieved content, say so honestly.`,
    );
  }

  // Self-Evaluation
  if (agent.enableReflection) {
    sections.push(
      `# Self-Evaluation\nBefore delivering your final answer, briefly assess:\n1. Is the answer grounded in retrieved content (factual accuracy)?\n2. Does it comply with the guardrails above?\n3. Is it helpful and complete?\nIf not, revise before responding.`,
    );
  }

  // Additional Instructions
  if (agent.additionalInstructions) {
    sections.push(`# Additional Instructions\n${agent.additionalInstructions}`);
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/backend && npx vitest run tests/promptTemplate.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/agents/promptTemplate.ts packages/backend/tests/promptTemplate.test.ts
git commit -m "feat(agents): add composeSystemPrompt with tests"
```

---

## Task 3: Agent CRUD Backend

**Files:**
- Create: `packages/backend/convex/crud/agents.ts`
- Test: `packages/backend/tests/agents-crud.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/tests/agents-crud.test.ts`. Follow the existing test pattern from `packages/backend/tests/helpers.ts` — use `convexTest`, `setupTest`, `testIdentity`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { setupTest, testIdentity } from "./helpers";

const DEFAULT_AGENT_ARGS = {
  name: "Test Agent",
  identity: {
    agentName: "Test Bot",
    companyName: "Test Corp",
    roleDescription: "You are a helpful agent.",
  },
  guardrails: {},
  responseStyle: {},
  model: "claude-sonnet-4-20250514",
  enableReflection: false,
  retrieverIds: [],
};

describe("agents CRUD", () => {
  it("creates an agent and lists it", async () => {
    const t = convexTest(schema);
    await setupTest(t);

    const agentId = await t.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS,
      { identity: testIdentity },
    );
    expect(agentId).toBeTruthy();

    const agents = await t.query(api.crud.agents.byOrg, {}, { identity: testIdentity });
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("Test Agent");
    expect(agents[0].status).toBe("draft");
  });

  it("gets a single agent by id", async () => {
    const t = convexTest(schema);
    await setupTest(t);

    const agentId = await t.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS,
      { identity: testIdentity },
    );
    const agent = await t.query(api.crud.agents.get, { id: agentId }, { identity: testIdentity });
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe("Test Agent");
  });

  it("updates agent config", async () => {
    const t = convexTest(schema);
    await setupTest(t);

    const agentId = await t.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS,
      { identity: testIdentity },
    );
    await t.mutation(
      api.crud.agents.update,
      { id: agentId, name: "Updated Agent", model: "claude-haiku-4-20250514" },
      { identity: testIdentity },
    );
    const agent = await t.query(api.crud.agents.get, { id: agentId }, { identity: testIdentity });
    expect(agent!.name).toBe("Updated Agent");
    expect(agent!.model).toBe("claude-haiku-4-20250514");
  });

  it("removes an agent", async () => {
    const t = convexTest(schema);
    await setupTest(t);

    const agentId = await t.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS,
      { identity: testIdentity },
    );
    await t.mutation(api.crud.agents.remove, { id: agentId }, { identity: testIdentity });
    const agents = await t.query(api.crud.agents.byOrg, {}, { identity: testIdentity });
    expect(agents).toHaveLength(0);
  });

  it("rejects access from different org", async () => {
    const t = convexTest(schema);
    await setupTest(t);

    const agentId = await t.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS,
      { identity: testIdentity },
    );

    const otherIdentity = {
      ...testIdentity,
      tokenIdentifier: "other-user",
      subject: "other-user",
      org_id: "org_other",
    };

    await expect(
      t.query(api.crud.agents.get, { id: agentId }, { identity: otherIdentity }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run tests/agents-crud.test.ts
```

Expected: FAIL — module `api.crud.agents` not found.

- [ ] **Step 3: Implement agent CRUD**

Create `packages/backend/convex/crud/agents.ts`:

```typescript
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const byOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(id);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    return agent;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    identity: v.object({
      agentName: v.string(),
      companyName: v.string(),
      companyUrl: v.optional(v.string()),
      companyContext: v.optional(v.string()),
      roleDescription: v.string(),
      brandVoice: v.optional(v.string()),
    }),
    guardrails: v.object({
      outOfScope: v.optional(v.string()),
      escalationRules: v.optional(v.string()),
      compliance: v.optional(v.string()),
    }),
    responseStyle: v.object({
      formatting: v.optional(v.string()),
      length: v.optional(v.string()),
      formality: v.optional(v.string()),
      language: v.optional(v.string()),
    }),
    additionalInstructions: v.optional(v.string()),
    model: v.string(),
    enableReflection: v.boolean(),
    retrieverIds: v.array(v.id("retrievers")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db.insert("agents", {
      ...args,
      orgId,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("agents"),
    name: v.optional(v.string()),
    identity: v.optional(
      v.object({
        agentName: v.string(),
        companyName: v.string(),
        companyUrl: v.optional(v.string()),
        companyContext: v.optional(v.string()),
        roleDescription: v.string(),
        brandVoice: v.optional(v.string()),
      }),
    ),
    guardrails: v.optional(
      v.object({
        outOfScope: v.optional(v.string()),
        escalationRules: v.optional(v.string()),
        compliance: v.optional(v.string()),
      }),
    ),
    responseStyle: v.optional(
      v.object({
        formatting: v.optional(v.string()),
        length: v.optional(v.string()),
        formality: v.optional(v.string()),
        language: v.optional(v.string()),
      }),
    ),
    additionalInstructions: v.optional(v.string()),
    model: v.optional(v.string()),
    enableReflection: v.optional(v.boolean()),
    retrieverIds: v.optional(v.array(v.id("retrievers"))),
    status: v.optional(v.union(v.literal("draft"), v.literal("ready"), v.literal("error"))),
  },
  handler: async (ctx, { id, ...updates }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(id);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    // Filter out undefined values
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(id);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 4: Deploy and run tests**

```bash
cd packages/backend && npx convex dev --once && npx vitest run tests/agents-crud.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/crud/agents.ts packages/backend/tests/agents-crud.test.ts
git commit -m "feat(agents): add agent CRUD with tests"
```

---

## Task 4: Conversation and Message Backend

**Files:**
- Create: `packages/backend/convex/crud/conversations.ts`
- Test: `packages/backend/tests/conversations-crud.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/tests/conversations-crud.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { setupTest, testIdentity } from "./helpers";

describe("conversations CRUD", () => {
  async function seedAgent(t: any) {
    return t.mutation(
      api.crud.agents.create,
      {
        name: "Test Agent",
        identity: {
          agentName: "Bot",
          companyName: "Corp",
          roleDescription: "Helper",
        },
        guardrails: {},
        responseStyle: {},
        model: "claude-sonnet-4-20250514",
        enableReflection: false,
        retrieverIds: [],
      },
      { identity: testIdentity },
    );
  }

  it("creates a conversation for an agent", async () => {
    const t = convexTest(schema);
    await setupTest(t);
    const agentId = await seedAgent(t);

    const convId = await t.mutation(
      api.crud.conversations.create,
      { agentIds: [agentId] },
      { identity: testIdentity },
    );
    expect(convId).toBeTruthy();

    const conv = await t.query(
      api.crud.conversations.get,
      { id: convId },
      { identity: testIdentity },
    );
    expect(conv).not.toBeNull();
    expect(conv!.status).toBe("active");
    expect(conv!.agentIds).toEqual([agentId]);
  });

  it("inserts messages with sequential ordering", async () => {
    const t = convexTest(schema);
    await setupTest(t);
    const agentId = await seedAgent(t);

    const convId = await t.mutation(
      api.crud.conversations.create,
      { agentIds: [agentId] },
      { identity: testIdentity },
    );

    // Insert two messages
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        conversationId: convId,
        order: 0,
        role: "user",
        content: "Hello",
        status: "complete",
        createdAt: Date.now(),
      });
      await ctx.db.insert("messages", {
        conversationId: convId,
        order: 1,
        role: "assistant",
        content: "Hi there!",
        agentId,
        status: "complete",
        createdAt: Date.now(),
      });
    });

    const messages = await t.query(
      api.crud.conversations.listMessages,
      { conversationId: convId },
      { identity: testIdentity },
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[0].order).toBe(0);
    expect(messages[1].order).toBe(1);
  });

  it("returns stream deltas ordered by start", async () => {
    const t = convexTest(schema);
    await setupTest(t);
    const agentId = await seedAgent(t);

    const convId = await t.mutation(
      api.crud.conversations.create,
      { agentIds: [agentId] },
      { identity: testIdentity },
    );

    // Insert a streaming message and its deltas
    let messageId: any;
    await t.run(async (ctx) => {
      messageId = await ctx.db.insert("messages", {
        conversationId: convId,
        order: 0,
        role: "assistant",
        content: "",
        agentId,
        status: "streaming",
        createdAt: Date.now(),
      });
      await ctx.db.insert("streamDeltas", { messageId, start: 0, end: 5, text: "Hello" });
      await ctx.db.insert("streamDeltas", { messageId, start: 5, end: 11, text: " world" });
    });

    const deltas = await t.query(
      api.crud.conversations.getStreamDeltas,
      { messageId },
      { identity: testIdentity },
    );
    expect(deltas).toHaveLength(2);
    expect(deltas[0].text).toBe("Hello");
    expect(deltas[1].text).toBe(" world");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/backend && npx vitest run tests/conversations-crud.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement conversations CRUD**

Create `packages/backend/convex/crud/conversations.ts`:

```typescript
import { mutation, query, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const create = mutation({
  args: {
    agentIds: v.array(v.id("agents")),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { agentIds, title }) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db.insert("conversations", {
      orgId,
      agentIds,
      title,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(id);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    return conv;
  },
});

export const listMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    return ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();
  },
});

export const getStreamDeltas = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    // Auth: verify message belongs to a conversation the user can access
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found");
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(message.conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    return ctx.db
      .query("streamDeltas")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .order("asc")
      .collect();
  },
});

// Internal mutations used by the agent action
export const insertMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    order: v.number(),
    role: v.union(
      v.literal("system"),
      v.literal("user"),
      v.literal("assistant"),
      v.literal("tool_call"),
      v.literal("tool_result"),
    ),
    content: v.string(),
    agentId: v.optional(v.id("agents")),
    toolCall: v.optional(
      v.object({
        toolCallId: v.string(),
        toolName: v.string(),
        toolArgs: v.string(),
        retrieverId: v.optional(v.id("retrievers")),
      }),
    ),
    toolResult: v.optional(
      v.object({
        toolCallId: v.string(),
        toolName: v.string(),
        result: v.string(),
        retrieverId: v.optional(v.id("retrievers")),
      }),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("streaming"),
      v.literal("complete"),
      v.literal("error"),
    ),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("messages", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const updateMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
    content: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("streaming"),
        v.literal("complete"),
        v.literal("error"),
      ),
    ),
    usage: v.optional(
      v.object({
        promptTokens: v.number(),
        completionTokens: v.number(),
      }),
    ),
  },
  handler: async (ctx, { messageId, ...patch }) => {
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) updates[key] = value;
    }
    await ctx.db.patch(messageId, updates);
  },
});

export const insertStreamDelta = internalMutation({
  args: {
    messageId: v.id("messages"),
    start: v.number(),
    end: v.number(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("streamDeltas", args);
  },
});

export const cleanupStreamDeltas = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const deltas = await ctx.db
      .query("streamDeltas")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .collect();
    for (const delta of deltas) {
      await ctx.db.delete(delta._id);
    }
  },
});

```

- [ ] **Step 4: Deploy and run tests**

```bash
cd packages/backend && npx convex dev --once && npx vitest run tests/conversations-crud.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/crud/conversations.ts packages/backend/tests/conversations-crud.test.ts
git commit -m "feat(agents): add conversation and message CRUD with tests"
```

---

## Task 5: Agent Orchestration (sendMessage mutation)

**Files:**
- Create: `packages/backend/convex/agents/orchestration.ts`

- [ ] **Step 1: Implement orchestration**

Create `packages/backend/convex/agents/orchestration.ts`:

```typescript
import { mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

/**
 * Sends a user message and triggers agent execution.
 * Returns the pending assistant message ID for stream subscription.
 */
export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    agentId: v.id("agents"),
    content: v.string(),
  },
  handler: async (ctx, { conversationId, agentId, content }) => {
    const { orgId } = await getAuthContext(ctx);

    // Verify conversation belongs to org
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }

    // Verify agent belongs to org
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }

    // Get next order number
    const lastMessage = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .first();
    const nextOrder = lastMessage ? lastMessage.order + 1 : 0;

    // Insert user message
    await ctx.db.insert("messages", {
      conversationId,
      order: nextOrder,
      role: "user",
      content,
      status: "complete",
      createdAt: Date.now(),
    });

    // Create pending assistant message
    const assistantMessageId = await ctx.db.insert("messages", {
      conversationId,
      order: nextOrder + 1,
      role: "assistant",
      content: "",
      agentId,
      status: "streaming",
      createdAt: Date.now(),
    });

    // Schedule agent action
    await ctx.scheduler.runAfter(0, internal.agents.actions.runAgent, {
      conversationId,
      agentId,
      assistantMessageId,
    });

    return assistantMessageId;
  },
});

/**
 * Gets or creates a playground conversation for an agent.
 * The playground is a single active conversation per agent.
 */
export const getOrCreatePlayground = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }

    // Look for existing active playground conversation for this agent.
    // Convex can't filter on array contents, so we filter by status
    // and check agentIds in code.
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const playground = existing.find(
      (c) => c.agentIds.length === 1 && c.agentIds[0] === agentId,
    );

    if (playground) return playground._id;

    // Create new playground conversation
    return ctx.db.insert("conversations", {
      orgId,
      agentIds: [agentId],
      title: `${agent.name} Playground`,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

/**
 * Triggers URL context extraction for an agent.
 * Public mutation that schedules the internal action.
 */
export const triggerUrlExtraction = mutation({
  args: {
    agentId: v.id("agents"),
    url: v.string(),
  },
  handler: async (ctx, { agentId, url }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    await ctx.scheduler.runAfter(0, internal.agents.actions.extractUrlContext, {
      agentId,
      url,
    });
  },
});

/**
 * Clears a playground conversation by archiving it.
 * Next getOrCreatePlayground call will create a fresh one.
 */
export const clearPlayground = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    await ctx.db.patch(conversationId, { status: "archived" });
  },
});
```

- [ ] **Step 2: Verify no syntax errors**

Note: This file references `internal.agents.actions.runAgent` and `internal.agents.actions.extractUrlContext` which don't exist yet. The Convex deploy will fail until Task 6 is complete. That's expected — Tasks 5 and 6 should be deployed together. After completing Task 6, run `npx convex dev --once` to deploy both.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/agents/orchestration.ts
git commit -m "feat(agents): add sendMessage orchestration and playground management"
```

---

## Task 6: Agent Execution Action

**Files:**
- Create: `packages/backend/convex/agents/actions.ts`

This is the core agent loop. It's a `"use node"` action that:
1. Builds the system prompt
2. Constructs retriever tools from AI SDK
3. Calls `streamText()` with tool use
4. Writes tool call/result messages and stream deltas to Convex

- [ ] **Step 1: Implement the runAgent action**

Create `packages/backend/convex/agents/actions.ts`:

```typescript
"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool } from "ai";
import { z } from "zod";
import { composeSystemPrompt } from "./promptTemplate";
import { vectorSearchWithFilter } from "../lib/vectorSearch";

// Helper: slugify a retriever name for use as a tool name
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

// Helper: convert stored messages to AI SDK format
function toAIMessages(
  messages: Array<{
    role: string;
    content: string;
    toolCall?: { toolCallId: string; toolName: string; toolArgs: string } | null;
    toolResult?: { toolCallId: string; toolName: string; result: string } | null;
  }>,
): Array<any> {
  const aiMessages: any[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === "user") {
      aiMessages.push({ role: "user", content: msg.content });
      i++;
    } else if (msg.role === "assistant") {
      // Look ahead for tool_call messages that follow
      const toolCalls: any[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool_call") {
        const tc = messages[j].toolCall!;
        toolCalls.push({
          type: "tool-call",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: JSON.parse(tc.toolArgs),
        });
        j++;
      }

      if (toolCalls.length > 0) {
        // Assistant message with tool invocations
        const parts: any[] = [];
        if (msg.content) parts.push({ type: "text", text: msg.content });
        parts.push(...toolCalls);
        aiMessages.push({ role: "assistant", content: parts });

        // Collect corresponding tool results
        while (j < messages.length && messages[j].role === "tool_result") {
          const tr = messages[j].toolResult!;
          aiMessages.push({
            role: "tool",
            content: [
              { type: "tool-result", toolCallId: tr.toolCallId, result: tr.result },
            ],
          });
          j++;
        }
        i = j;
      } else {
        aiMessages.push({ role: "assistant", content: msg.content });
        i++;
      }
    } else {
      // Skip system, tool_call, tool_result that are handled above
      i++;
    }
  }
  return aiMessages;
}

export const runAgent = internalAction({
  args: {
    conversationId: v.id("conversations"),
    agentId: v.id("agents"),
    assistantMessageId: v.id("messages"),
  },
  handler: async (ctx, { conversationId, agentId, assistantMessageId }) => {
    try {
      // 1. Load agent config
      const agent = await ctx.runQuery(internal.crud.agents.getInternal, { id: agentId });
      if (!agent) throw new Error("Agent not found");

      // 2. Load linked retrievers with KB info
      const retrieverInfos: Array<{
        id: string;
        name: string;
        kbName: string;
        kbId: string;
        indexConfigHash: string;
        indexStrategy: string;
        embeddingModel: string;
        defaultK: number;
        description?: string;
      }> = [];

      for (const retrieverId of agent.retrieverIds) {
        const retriever = await ctx.runQuery(internal.crud.retrievers.getInternal, {
          id: retrieverId,
        });
        if (!retriever || retriever.status !== "ready") continue;
        const kb = await ctx.runQuery(internal.crud.knowledgeBases.getInternal, {
          id: retriever.kbId,
        });
        retrieverInfos.push({
          id: retriever._id,
          name: retriever.name,
          kbName: kb?.name ?? "Unknown KB",
          kbId: retriever.kbId,
          indexConfigHash: retriever.indexConfigHash,
          indexStrategy: retriever.retrieverConfig.index.strategy,
          embeddingModel:
            retriever.retrieverConfig.index.embeddingModel ?? "text-embedding-3-small",
          defaultK: retriever.defaultK ?? 5,
        });
      }

      // 3. Build system prompt
      const systemPrompt = composeSystemPrompt(
        agent,
        retrieverInfos.map((r) => ({
          name: r.name,
          kbName: r.kbName,
        })),
      );

      // 4. Build AI SDK tools — one per retriever
      const tools: Record<string, any> = {};
      const retrieverMap = new Map(retrieverInfos.map((r) => [slugify(r.name), r]));

      for (const info of retrieverInfos) {
        const toolName = slugify(info.name);
        tools[toolName] = tool({
          description: `Search ${info.kbName} using ${info.name}`,
          parameters: z.object({
            query: z.string().describe("The search query"),
            k: z.number().optional().describe("Number of results to return"),
          }),
          execute: async ({ query, k }) => {
            const topK = k ?? info.defaultK;

            // Embed the query
            const { createEmbedder } = await import("rag-evaluation-system/llm");
            const embedder = createEmbedder(info.embeddingModel);
            const queryEmbedding = await embedder.embedQuery(query);

            // Vector search
            const { chunks } = await vectorSearchWithFilter(ctx, {
              queryEmbedding,
              kbId: info.kbId as any,
              indexConfigHash: info.indexConfigHash,
              topK,
              indexStrategy: info.indexStrategy,
            });

            return chunks.map((c: any) => ({
              content: c.content,
              documentId: c.documentId,
              start: c.start,
              end: c.end,
            }));
          },
        });
      }

      // 5. Load conversation history
      const allMessages = await ctx.runQuery(
        internal.crud.conversations.listMessagesInternal,
        { conversationId },
      );
      // Exclude the pending assistant message we just created
      const historyMessages = allMessages.filter(
        (m: any) => m._id !== assistantMessageId,
      );
      const aiMessages = toAIMessages(historyMessages);

      // 6. Track order for new messages
      // ORDERING INVARIANT: The assistant message is at order N. Tool call/result
      // messages are inserted at N+1, N+2, etc. When reconstructing history for
      // subsequent turns, toAIMessages() looks ahead from each assistant message
      // to fold in the following tool_call/tool_result messages. This works
      // correctly for single-step tool use. For multi-step (multiple tool rounds),
      // all tool messages are folded into one assistant turn — acceptable for MVP.
      const lastOrder = allMessages.length > 0
        ? Math.max(...allMessages.map((m: any) => m.order))
        : -1;
      let nextOrder = lastOrder + 1;

      // 7. Stream the response
      let streamCursor = 0;
      let buffer = "";
      const FLUSH_INTERVAL_MS = 200;
      const FLUSH_CHAR_THRESHOLD = 50;
      let lastFlushTime = Date.now();

      const flushBuffer = async () => {
        if (buffer.length === 0) return;
        const text = buffer;
        const start = streamCursor;
        const end = streamCursor + text.length;
        streamCursor = end;
        buffer = "";
        lastFlushTime = Date.now();
        await ctx.runMutation(internal.crud.conversations.insertStreamDelta, {
          messageId: assistantMessageId,
          start,
          end,
          text,
        });
      };

      // streamText() returns a StreamTextResult directly (not a Promise)
      const result = streamText({
        model: anthropic(agent.model),
        system: systemPrompt,
        messages: aiMessages,
        tools,
        maxSteps: 5,
        onStepFinish: async (step) => {
          // Save tool calls and results as separate messages
          if (step.toolCalls && step.toolCalls.length > 0) {
            for (const tc of step.toolCalls) {
              const retrieverInfo = retrieverMap.get(tc.toolName);
              await ctx.runMutation(internal.crud.conversations.insertMessage, {
                conversationId,
                order: nextOrder++,
                role: "tool_call",
                content: "",
                agentId,
                toolCall: {
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  toolArgs: JSON.stringify(tc.args),
                  retrieverId: retrieverInfo?.id as any,
                },
                status: "complete",
              });
            }
          }
          if (step.toolResults && step.toolResults.length > 0) {
            for (const tr of step.toolResults) {
              const retrieverInfo = retrieverMap.get(tr.toolName);
              await ctx.runMutation(internal.crud.conversations.insertMessage, {
                conversationId,
                order: nextOrder++,
                role: "tool_result",
                content: "",
                agentId,
                toolResult: {
                  toolCallId: tr.toolCallId,
                  toolName: tr.toolName,
                  result: JSON.stringify(tr.result),
                  retrieverId: retrieverInfo?.id as any,
                },
                status: "complete",
              });
            }
          }
        },
      });

      // result.textStream is a ReadableStream (not a Promise) — consume directly
      for await (const chunk of result.textStream) {
        buffer += chunk;
        const now = Date.now();
        if (
          buffer.length >= FLUSH_CHAR_THRESHOLD ||
          now - lastFlushTime >= FLUSH_INTERVAL_MS
        ) {
          await flushBuffer();
        }
      }
      // Final flush
      await flushBuffer();

      // 8. Finalize the assistant message
      // result.text and result.usage are Promise properties — await them
      const [finalText, usage] = await Promise.all([result.text, result.usage]);
      await ctx.runMutation(internal.crud.conversations.updateMessage, {
        messageId: assistantMessageId,
        content: finalText,
        status: "complete",
        usage: usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
            }
          : undefined,
      });

      // Schedule delta cleanup
      await ctx.scheduler.runAfter(
        5000,
        internal.crud.conversations.cleanupStreamDeltas,
        { messageId: assistantMessageId },
      );
    } catch (error: any) {
      // Error handling: mark the assistant message as error
      await ctx.runMutation(internal.crud.conversations.updateMessage, {
        messageId: assistantMessageId,
        content: `Something went wrong: ${error.message ?? "Unknown error"}. Please try again.`,
        status: "error",
      });
    }
  },
});

export const extractUrlContext = internalAction({
  args: {
    agentId: v.id("agents"),
    url: v.string(),
  },
  handler: async (ctx, { agentId, url }) => {
    try {
      // Fetch the homepage
      const response = await fetch(url, {
        headers: { "User-Agent": "CXAgentEvals/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();

      // Extract text content using readability (already a dependency)
      const { Readability } = await import("@mozilla/readability");
      const { parseHTML } = await import("linkedom");
      const { document } = parseHTML(html);
      const reader = new Readability(document as any);
      const article = reader.parse();

      const textContent = article?.textContent?.slice(0, 5000) ?? "";
      const title = article?.title ?? document.title ?? "";

      // Use LLM to summarize
      const { generateText } = await import("ai");
      const result = await generateText({
        model: anthropic("claude-haiku-4-20250514"),
        system:
          "You are a research assistant. Summarize the following company information in 2-3 concise paragraphs. Focus on: what the company does, their industry, key products/services, and target audience.",
        prompt: `Company website: ${url}\nTitle: ${title}\n\nContent:\n${textContent}`,
      });

      // Update agent with extracted context
      const agent = await ctx.runQuery(internal.crud.agents.getInternal, { id: agentId });
      if (agent) {
        await ctx.runMutation(internal.crud.agents.updateInternal, {
          id: agentId,
          identity: {
            ...agent.identity,
            companyContext: result.text,
          },
        });
      }
    } catch (error: any) {
      console.error("URL context extraction failed:", error.message);
    }
  },
});
```

- [ ] **Step 2: Add internal queries/mutations needed by actions**

The action references `internal.crud.agents.getInternal`, `internal.crud.agents.updateInternal`, `internal.crud.conversations.listMessagesInternal`, and `internal.crud.knowledgeBases.getInternal`. Add these to the respective CRUD files.

In `packages/backend/convex/crud/agents.ts`, add:

```typescript
import { internalQuery, internalMutation } from "../_generated/server";

export const getInternal = internalQuery({
  args: { id: v.id("agents") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

export const updateInternal = internalMutation({
  args: {
    id: v.id("agents"),
    identity: v.optional(v.object({
      agentName: v.string(),
      companyName: v.string(),
      companyUrl: v.optional(v.string()),
      companyContext: v.optional(v.string()),
      roleDescription: v.string(),
      brandVoice: v.optional(v.string()),
    })),
  },
  handler: async (ctx, { id, ...patch }) => {
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) updates[key] = value;
    }
    await ctx.db.patch(id, updates);
  },
});
```

In `packages/backend/convex/crud/conversations.ts`, add `internalQuery` to the existing import line (`import { mutation, query, internalMutation, internalQuery } from "../_generated/server";`) and add:

```typescript

export const listMessagesInternal = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    return ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();
  },
});
```

In `packages/backend/convex/crud/knowledgeBases.ts`, add a `getInternal` internalQuery (it does not exist yet):

```typescript
import { internalQuery } from "../_generated/server";

export const getInternal = internalQuery({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});
```

Make sure `v` is imported from `"convex/values"` (it should already be).

- [ ] **Step 3: Deploy and verify**

```bash
cd packages/backend && npx convex dev --once
```

Expected: successful deployment. The action won't run yet (needs ANTHROPIC_API_KEY in Convex dashboard), but it should deploy without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/agents/actions.ts packages/backend/convex/crud/agents.ts packages/backend/convex/crud/conversations.ts packages/backend/convex/crud/knowledgeBases.ts
git commit -m "feat(agents): add runAgent action and extractUrlContext with streaming"
```

---

## Task 7: Frontend — Header and ModeSelector Updates

**Files:**
- Modify: `packages/frontend/src/components/Header.tsx` (~lines 8-68)
- Modify: `packages/frontend/src/components/ModeSelector.tsx` (~lines 26-175)

- [ ] **Step 1: Update Header mode type and add Agents nav link**

In `packages/frontend/src/components/Header.tsx`:

Update the `HeaderProps` interface to add `"agents"` to the mode union:

```typescript
interface HeaderProps {
  mode?: "kb" | "generate" | "retrievers" | "agents" | "experiments";
  kbId?: Id<"knowledgeBases"> | null;
  onReset?: () => void;
}
```

Add a new navigation link for Agents between "Retrievers" and "Generate" in the tab bar (after the Retrievers link, before the Generate link). Follow the exact same pattern as the other links:

```tsx
<Link
  href="/agents"
  className={`... ${mode === "agents" ? "text-accent border-b-2 border-accent" : "text-text-muted ..."}`}
>
  Agents
</Link>
```

Note: The Agents link does NOT use `buildKbLink` since agents are independent of KB. Use a plain `/agents` href.

- [ ] **Step 2: Add Agents card to ModeSelector**

In `packages/frontend/src/components/ModeSelector.tsx`, add a new card between "Retrievers" and "Generate Questions" cards. Follow the existing card pattern:

```tsx
<Link
  href="/agents"
  className="group block border border-border rounded-lg bg-bg-elevated p-8 hover:border-accent/50 transition-all duration-200"
>
  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
    <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
    </svg>
  </div>
  <h3 className="text-lg font-medium text-text mb-2">Agents</h3>
  <p className="text-sm text-text-muted leading-relaxed">
    Create CX agents with custom prompts and retriever tools. Test them in a live playground.
  </p>
</Link>
```

- [ ] **Step 3: Verify the frontend builds**

```bash
cd packages/frontend && npx next build
```

Expected: build succeeds (the `/agents` page doesn't exist yet, but that's fine — the link just won't resolve to a page).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/Header.tsx packages/frontend/src/components/ModeSelector.tsx
git commit -m "feat(agents): add Agents to navigation and home screen"
```

---

## Task 8: Frontend — Agent Sidebar

**Files:**
- Create: `packages/frontend/src/components/AgentSidebar.tsx`

- [ ] **Step 1: Implement the sidebar component**

Create `packages/frontend/src/components/AgentSidebar.tsx`:

```tsx
"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface AgentSidebarProps {
  selectedAgentId: Id<"agents"> | null;
  onSelectAgent: (id: Id<"agents"> | null) => void;
}

export default function AgentSidebar({ selectedAgentId, onSelectAgent }: AgentSidebarProps) {
  const agents = useQuery(api.crud.agents.byOrg) ?? [];
  const createAgent = useMutation(api.crud.agents.create);

  const handleCreate = async () => {
    const id = await createAgent({
      name: "New Agent",
      identity: {
        agentName: "New Agent",
        companyName: "",
        roleDescription: "You are a helpful customer support agent.",
      },
      guardrails: {},
      responseStyle: {
        formality: "professional",
        length: "concise",
      },
      model: "claude-sonnet-4-20250514",
      enableReflection: false,
      retrieverIds: [],
    });
    onSelectAgent(id);
  };

  return (
    <div className="w-[220px] bg-bg-elevated border-r border-border flex flex-col flex-shrink-0">
      <div className="p-3 border-b border-border flex justify-between items-center">
        <span className="text-text-muted text-xs uppercase tracking-wider">Agents</span>
        <button
          onClick={handleCreate}
          className="bg-accent text-bg text-xs px-2 py-0.5 rounded font-medium hover:bg-accent/90 transition-colors"
        >
          + New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {agents.length === 0 && (
          <p className="text-text-dim text-xs p-2">No agents yet. Create one to get started.</p>
        )}
        {agents.map((agent) => (
          <button
            key={agent._id}
            onClick={() => onSelectAgent(agent._id)}
            className={`w-full text-left rounded-md p-2.5 mb-1 transition-colors ${
              selectedAgentId === agent._id
                ? "bg-bg-surface border-l-[3px] border-l-accent"
                : "border-l-[3px] border-l-transparent hover:bg-bg-surface/50"
            }`}
          >
            <div className={`text-[11px] font-medium ${selectedAgentId === agent._id ? "text-text" : "text-text-muted"}`}>
              {agent.name}
            </div>
            <div className="text-text-dim text-[9px] mt-0.5">
              {agent.model.replace("claude-", "").replace(/-\d+$/, "")}
            </div>
            <div className="flex gap-1 mt-1 flex-wrap">
              <span className="text-[8px] px-1.5 py-px rounded bg-bg-elevated text-text-muted">
                {agent.retrieverIds.length} retriever{agent.retrieverIds.length !== 1 ? "s" : ""}
              </span>
              <span
                className={`text-[8px] px-1.5 py-px rounded-full ${
                  agent.status === "ready"
                    ? "bg-accent/10 text-accent"
                    : agent.status === "error"
                      ? "bg-red-500/10 text-red-400"
                      : "bg-yellow-500/10 text-yellow-400"
                }`}
              >
                {agent.status}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/AgentSidebar.tsx
git commit -m "feat(agents): add AgentSidebar component"
```

---

## Task 9: Frontend — Agent Config Panel

**Files:**
- Create: `packages/frontend/src/components/AgentConfigPanel.tsx`

- [ ] **Step 1: Implement the config panel**

Create `packages/frontend/src/components/AgentConfigPanel.tsx`. Component skeleton:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface AgentConfigPanelProps {
  agentId: Id<"agents">;
}

export default function AgentConfigPanel({ agentId }: AgentConfigPanelProps) {
  const agent = useQuery(api.crud.agents.get, { id: agentId });
  const updateAgent = useMutation(api.crud.agents.update);
  const triggerExtract = useMutation(api.agents.orchestration.triggerUrlExtraction);
  const allRetrievers = useQuery(api.crud.retrievers.byOrg, {}) ?? [];
  const allKbs = useQuery(api.crud.knowledgeBases.list, {}) ?? [];

  // Form state — initialized from agent query
  const [name, setName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [formality, setFormality] = useState("professional");
  const [length, setLength] = useState("concise");
  const [formatting, setFormatting] = useState("");
  const [language, setLanguage] = useState("English");
  const [outOfScope, setOutOfScope] = useState("");
  const [escalationRules, setEscalationRules] = useState("");
  const [compliance, setCompliance] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [enableReflection, setEnableReflection] = useState(false);
  const [retrieverIds, setRetrieverIds] = useState<Id<"retrievers">[]>([]);
  const [additionalInstructions, setAdditionalInstructions] = useState("");

  // Collapsible sections
  const [guardrailsOpen, setGuardrailsOpen] = useState(false);
  const [additionalOpen, setAdditionalOpen] = useState(false);

  // Retriever picker dropdown
  const [showRetrieverPicker, setShowRetrieverPicker] = useState(false);

  // Sync form state from query data
  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setAgentName(agent.identity.agentName);
    setCompanyName(agent.identity.companyName);
    setCompanyUrl(agent.identity.companyUrl ?? "");
    setRoleDescription(agent.identity.roleDescription);
    setBrandVoice(agent.identity.brandVoice ?? "");
    setFormality(agent.responseStyle.formality ?? "professional");
    setLength(agent.responseStyle.length ?? "concise");
    setFormatting(agent.responseStyle.formatting ?? "");
    setLanguage(agent.responseStyle.language ?? "English");
    setOutOfScope(agent.guardrails.outOfScope ?? "");
    setEscalationRules(agent.guardrails.escalationRules ?? "");
    setCompliance(agent.guardrails.compliance ?? "");
    setModel(agent.model);
    setEnableReflection(agent.enableReflection);
    setRetrieverIds(agent.retrieverIds);
    setAdditionalInstructions(agent.additionalInstructions ?? "");
  }, [agent]);

  const handleSave = async () => {
    await updateAgent({
      id: agentId,
      name,
      identity: {
        agentName, companyName, companyUrl: companyUrl || undefined,
        companyContext: agent?.identity.companyContext,
        roleDescription, brandVoice: brandVoice || undefined,
      },
      responseStyle: {
        formality: formality || undefined, length: length || undefined,
        formatting: formatting || undefined, language: language || undefined,
      },
      guardrails: {
        outOfScope: outOfScope || undefined,
        escalationRules: escalationRules || undefined,
        compliance: compliance || undefined,
      },
      model, enableReflection, retrieverIds,
      additionalInstructions: additionalInstructions || undefined,
    });
  };

  const handleExtract = async () => {
    if (!companyUrl) return;
    await triggerExtract({ agentId, url: companyUrl });
  };

  // Group retrievers by KB for the picker dropdown
  const kbMap = new Map(allKbs.map((kb) => [kb._id, kb.name]));
  const retrieversByKb = new Map<string, typeof allRetrievers>();
  for (const r of allRetrievers) {
    const kbName = kbMap.get(r.kbId) ?? "Unknown";
    if (!retrieversByKb.has(kbName)) retrieversByKb.set(kbName, []);
    retrieversByKb.get(kbName)!.push(r);
  }

  if (!agent) return <div className="p-4 text-text-dim text-sm">Loading...</div>;

  return (
    <div className="p-3.5 space-y-3.5">
      {/* Identity & Company section */}
      {/* Response Style section */}
      {/* Guardrails section (collapsible via guardrailsOpen) */}
      {/* Agent Behavior section (model dropdown, reflection toggle) */}
      {/* Retriever Tools section with picker */}
      {/* Additional Instructions (collapsible via additionalOpen) */}
      {/* Save button */}
    </div>
  );
}
```

Each section follows the same pattern: a section header with `text-text-muted text-[9px] uppercase tracking-wider`, a container with `bg-bg-elevated border border-border rounded-lg p-3`, and form fields with `bg-bg-surface border border-border rounded-md px-2 py-1.5 text-[10px]`.

The **retriever picker** works as follows:
- Current retrievers are listed with checkboxes (checked). Clicking unchecks = removes from `retrieverIds`.
- "+ Add retriever" button toggles `showRetrieverPicker`. When open, shows a dropdown with all org retrievers grouped by KB name. Only "ready" retrievers are clickable. Clicking adds to `retrieverIds`.
- Each retriever row shows: name, KB name, strategy, status badge.

The **Extract button** calls `triggerExtract({ agentId, url: companyUrl })` — this is the public mutation `triggerUrlExtraction` added in Task 5 which schedules the internal `extractUrlContext` action. Show a spinner while the agent's `companyContext` is being populated (subscribe to the agent query and check if `companyContext` appeared).

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/AgentConfigPanel.tsx
git commit -m "feat(agents): add AgentConfigPanel component"
```

---

## Task 10: Frontend — Tool Call Chip

**Files:**
- Create: `packages/frontend/src/components/ToolCallChip.tsx`

- [ ] **Step 1: Implement the tool call chip**

Create `packages/frontend/src/components/ToolCallChip.tsx`:

```tsx
"use client";

import { useState } from "react";

interface ToolCallChipProps {
  toolName: string;
  toolArgs?: string;   // JSON string
  toolResult?: string; // JSON string
}

export default function ToolCallChip({ toolName, toolArgs, toolResult }: ToolCallChipProps) {
  const [expanded, setExpanded] = useState(false);

  const displayName = toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  let parsedArgs: any = {};
  let parsedResult: any[] = [];
  try { parsedArgs = JSON.parse(toolArgs ?? "{}"); } catch {}
  try { parsedResult = JSON.parse(toolResult ?? "[]"); } catch {}

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-bg-elevated border border-border rounded-md text-[9px] hover:border-accent/30 transition-colors"
      >
        <span className="text-accent">&#9889;</span>
        <span className="text-text-muted">
          Searched <strong className="text-text font-medium">{displayName}</strong>
        </span>
        <span className="text-text-dim">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="mt-1 ml-2 p-2.5 bg-bg-elevated border border-border rounded-md text-[9px] animate-fade-in">
          {parsedArgs.query && (
            <div className="mb-2">
              <span className="text-text-dim">Query: </span>
              <span className="text-text">&ldquo;{parsedArgs.query}&rdquo;</span>
            </div>
          )}
          {parsedResult.length > 0 && (
            <div>
              <span className="text-text-dim">{parsedResult.length} chunk{parsedResult.length !== 1 ? "s" : ""} returned</span>
              <div className="mt-1.5 space-y-1">
                {parsedResult.slice(0, 3).map((chunk: any, i: number) => (
                  <div key={i} className="p-1.5 bg-bg rounded border border-border/50 text-text-muted">
                    <div className="line-clamp-2">{chunk.content?.slice(0, 150)}...</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/ToolCallChip.tsx
git commit -m "feat(agents): add ToolCallChip component"
```

---

## Task 11: Frontend — Agent Playground

**Files:**
- Create: `packages/frontend/src/components/AgentPlayground.tsx`

- [ ] **Step 1: Implement the playground component**

Create `packages/frontend/src/components/AgentPlayground.tsx`. This component:
- Accepts `agentId: Id<"agents">` as prop
- Calls `getOrCreatePlayground` mutation on mount to get/create a conversation
- Subscribes to `listMessages` for the conversation
- For messages with `status === "streaming"`, subscribes to `getStreamDeltas` and reconstructs partial text
- Has an input bar with Send button that calls `sendMessage` mutation
- Renders messages: user (right-aligned), assistant (left-aligned), tool calls as `ToolCallChip`
- Has a "Clear chat" button that calls `clearPlayground` mutation
- Auto-scrolls to bottom on new messages

Key implementation details:
- **State reset on agent change**: Use a `useEffect` that watches `agentId` — when it changes, reset `conversationId` to null and re-call `getOrCreatePlayground`. Use a guard ref to prevent double-fire in React strict mode:
  ```tsx
  const [conversationId, setConversationId] = useState<Id<"conversations"> | null>(null);
  const getOrCreate = useMutation(api.agents.orchestration.getOrCreatePlayground);
  const initRef = useRef<string | null>(null);

  useEffect(() => {
    if (initRef.current === agentId) return;
    initRef.current = agentId;
    setConversationId(null);
    getOrCreate({ agentId }).then(setConversationId);
  }, [agentId, getOrCreate]);
  ```
- Use `useQuery(api.crud.conversations.listMessages, conversationId ? { conversationId } : "skip")` for messages
- For streaming: find the message with `status === "streaming"` and subscribe to its deltas via `useQuery(api.crud.conversations.getStreamDeltas, streamingMessage ? { messageId: streamingMessage._id } : "skip")`
- Reconstruct text: sort deltas by `start`, concatenate `text` fields
- Send: call `useMutation(api.agents.orchestration.sendMessage)` with `{ conversationId, agentId, content }`
- Group tool_call and tool_result messages with the following assistant message for display
- Use `useRef` for the scroll container and `useEffect` to scroll on message changes
- **Clear chat**: call `clearPlayground` mutation, then reset `conversationId` to null and `initRef.current` to null so the `useEffect` re-fires and creates a fresh conversation

This is a ~200-250 line component. Follow the project's chat styling:
- User messages: `bg-accent/10 border border-accent/20 rounded-xl` right-aligned
- Assistant messages: `bg-bg-elevated border border-border rounded-xl` left-aligned
- Agent name label above assistant messages in `text-text-dim text-[8px]`
- Streaming cursor: `<span className="inline-block w-1.5 h-3 bg-accent animate-pulse rounded-sm" />`

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/AgentPlayground.tsx
git commit -m "feat(agents): add AgentPlayground component with streaming"
```

---

## Task 12: Frontend — Agents Page (Putting It Together)

**Files:**
- Create: `packages/frontend/src/app/agents/page.tsx`

- [ ] **Step 1: Implement the agents page**

Create `packages/frontend/src/app/agents/page.tsx`:

```tsx
"use client";

import { Suspense, useState } from "react";
import { Id } from "@convex/_generated/dataModel";
import Header from "@/components/Header";
import AgentSidebar from "@/components/AgentSidebar";
import AgentConfigPanel from "@/components/AgentConfigPanel";
import AgentPlayground from "@/components/AgentPlayground";

function AgentsContent() {
  const [selectedAgentId, setSelectedAgentId] = useState<Id<"agents"> | null>(null);

  return (
    <div className="h-screen flex flex-col bg-bg">
      <Header mode="agents" />
      <div className="flex flex-1 min-h-0">
        <AgentSidebar
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {selectedAgentId ? (
            <>
              {/* Context bar */}
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2.5">
                <span className="text-text text-sm font-semibold">Agent Config & Playground</span>
              </div>
              {/* Two-column: Config + Playground */}
              <div className="flex-1 grid grid-cols-[380px_1fr] min-h-0">
                <div className="border-r border-border overflow-y-auto">
                  <AgentConfigPanel agentId={selectedAgentId} />
                </div>
                <AgentPlayground agentId={selectedAgentId} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-text-muted text-sm">Select an agent or create a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify the frontend builds and the page loads**

```bash
cd packages/frontend && npx next build
```

Expected: build succeeds. Then run `pnpm dev` and navigate to `/agents` to verify the layout renders.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/agents/page.tsx
git commit -m "feat(agents): add agents page with side-by-side layout"
```

---

## Task 13: Integration Testing and Verification

- [ ] **Step 1: Run all backend tests**

```bash
cd packages/backend && npx vitest run
```

Expected: all existing tests still pass + new agent/conversation tests pass.

- [ ] **Step 2: Run frontend build**

```bash
cd packages/frontend && npx next build
```

Expected: clean build with no TypeScript errors.

- [ ] **Step 3: Deploy backend**

```bash
cd packages/backend && npx convex dev --once
```

Expected: successful deployment.

- [ ] **Step 4: Manual end-to-end test**

1. Start both servers: `pnpm dev` and `pnpm dev:backend`
2. Navigate to `/agents`
3. Create a new agent via "+ New" button
4. Fill in agent name, company name
5. Link a ready retriever (if one exists)
6. Save the agent
7. Type a message in the playground
8. Verify: streaming text appears, tool calls show as chips
9. Verify: expanding a tool call chip shows query and chunks

Note: Requires `ANTHROPIC_API_KEY` set in Convex dashboard env vars.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(agents): complete agents module integration"
```
