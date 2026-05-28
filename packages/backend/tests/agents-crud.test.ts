import { describe, expect, it } from "vitest"
import { api } from "../convex/_generated/api"
import { seedUser, setupTest, testIdentity } from "./helpers"

const DEFAULT_AGENT_ARGS = {
  name: "Test Agent",
  identity: {
    agentName: "Test Bot",
    companyName: "Test Corp",
    roleDescription: "You are a helpful agent."
  },
  guardrails: {},
  responseStyle: {},
  model: "claude-sonnet-4-20250514",
  enableReflection: false,
  retrieverIds: []
}

describe("agents CRUD", () => {
  it("creates an agent and lists it", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)

    const agentId = await authedT.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS
    )
    expect(agentId).toBeTruthy()

    const agents = await authedT.query(api.crud.agents.byOrg, {})
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe("Test Agent")
    expect(agents[0].status).toBe("draft")
  })

  it("gets a single agent by id", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)

    const agentId = await authedT.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS
    )
    const agent = await authedT.query(api.crud.agents.get, { id: agentId })
    expect(agent).not.toBeNull()
    expect(agent!.name).toBe("Test Agent")
  })

  it("updates agent config", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)

    const agentId = await authedT.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS
    )
    await authedT.mutation(api.crud.agents.update, {
      id: agentId,
      name: "Updated Agent",
      model: "claude-haiku-4-20250514"
    })
    const agent = await authedT.query(api.crud.agents.get, { id: agentId })
    expect(agent!.name).toBe("Updated Agent")
    expect(agent!.model).toBe("claude-haiku-4-20250514")
  })

  it("removes an agent", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)

    const agentId = await authedT.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS
    )
    await authedT.mutation(api.crud.agents.remove, { id: agentId })
    const agents = await authedT.query(api.crud.agents.byOrg, {})
    expect(agents).toHaveLength(0)
  })

  it("rejects access from different org", async () => {
    const t = setupTest()
    await seedUser(t)
    const authedT = t.withIdentity(testIdentity)

    const agentId = await authedT.mutation(
      api.crud.agents.create,
      DEFAULT_AGENT_ARGS
    )

    const otherIdentity = {
      ...testIdentity,
      subject: "other-user",
      org_id: "org_other"
    }
    const otherT = t.withIdentity(otherIdentity)

    await expect(
      otherT.query(api.crud.agents.get, { id: agentId })
    ).rejects.toThrow()
  })
})
