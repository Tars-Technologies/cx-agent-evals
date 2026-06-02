import { describe, expect, it } from "vitest"
import { api, internal } from "../convex/_generated/api"
import { seedUser, setupTest, TEST_ORG_ID, testIdentity } from "./helpers"

const DEFAULT_AGENT_ARGS = {
  name: "Test Agent",
  identity: {
    agentName: "Bot",
    companyName: "Corp",
    roleDescription: "Helper"
  },
  guardrails: {},
  responseStyle: {},
  model: "claude-sonnet-4-20250514",
  enableReflection: false,
  retrieverIds: []
}

describe("conversations CRUD", () => {
  it("creates a conversation for an agent", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)

    const agentId = await authedT.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS
    )
    const convId = await authedT.mutation(api.crud.conversations.create, {
      agentIds: [agentId]
    })
    expect(convId).toBeTruthy()

    const conv = await authedT.query(api.crud.conversations.get, { id: convId })
    expect(conv).not.toBeNull()
    expect(conv!.status).toBe("active")
    expect(conv!.agentIds).toEqual([agentId])
  })

  it("inserts messages with sequential ordering", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)

    const agentId = await authedT.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS
    )
    const convId = await authedT.mutation(api.crud.conversations.create, {
      agentIds: [agentId]
    })

    // Insert two messages directly
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", {
        conversationId: convId,
        order: 0,
        role: "user",
        content: "Hello",
        status: "complete",
        createdAt: Date.now()
      })
      await ctx.db.insert("messages", {
        conversationId: convId,
        order: 1,
        role: "assistant",
        content: "Hi there!",
        agentId,
        status: "complete",
        createdAt: Date.now()
      })
    })

    const messages = await authedT.query(api.crud.conversations.listMessages, {
      conversationId: convId
    })
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe("user")
    expect(messages[1].role).toBe("assistant")
    expect(messages[0].order).toBe(0)
    expect(messages[1].order).toBe(1)
  })

  it("returns stream deltas ordered by start", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)

    const agentId = await authedT.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS
    )
    const convId = await authedT.mutation(api.crud.conversations.create, {
      agentIds: [agentId]
    })

    let messageId: any
    await t.run(async (ctx) => {
      messageId = await ctx.db.insert("messages", {
        conversationId: convId,
        order: 0,
        role: "assistant",
        content: "",
        agentId,
        status: "streaming",
        createdAt: Date.now()
      })
      await ctx.db.insert("streamDeltas", {
        messageId,
        start: 0,
        end: 5,
        text: "Hello"
      })
      await ctx.db.insert("streamDeltas", {
        messageId,
        start: 5,
        end: 11,
        text: " world"
      })
    })

    const deltas = await authedT.query(api.crud.conversations.getStreamDeltas, {
      messageId
    })
    expect(deltas).toHaveLength(2)
    expect(deltas[0].text).toBe("Hello")
    expect(deltas[1].text).toBe(" world")
  })

  it("listForOrg never returns more than the sidebar cap", async () => {
    const t = setupTest()
    await seedUser(t)
    const authed = t.withIdentity(testIdentity)
    const agentId = await authed.mutation(api.crud.agents.create, DEFAULT_AGENT_ARGS)
    for (let i = 0; i < 105; i++) {
      await t.mutation(internal.crud.conversations.createInternal, {
        orgId: TEST_ORG_ID,
        agentIds: [agentId],
        title: `c${i}`,
        source: "playground",
      })
    }
    const rows = await authed.query(api.crud.conversations.listForOrg, {})
    expect(rows.length).toBeLessThanOrEqual(100)
  })
})
