import { describe, expect, test } from "vitest"
import { api } from "../convex/_generated/api"
import {
  seedDataset,
  seedKB,
  seedUser,
  setupTest,
  TEST_ORG_ID,
  testIdentity
} from "./helpers"

describe("updateQuestion", () => {
  test("updates queryText", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)

    const questionId = await t.run(async (ctx) => {
      return await ctx.db.insert("questions", {
        datasetId,
        queryId: "q1",
        queryText: "Original question?",
        sourceDocId: "doc1",
        relevantSpans: [
          { docId: "doc1", start: 0, end: 10, text: "some text." }
        ],
        metadata: {}
      })
    })

    // Update question text
    const authedT = t.withIdentity(testIdentity)
    await authedT.mutation(api.kb.questions.updateQuestion, {
      questionId,
      queryText: "Updated question?"
    })

    // Verify
    const updated = await t.run(async (ctx) => ctx.db.get(questionId))
    expect(updated!.queryText).toBe("Updated question?")
    // Spans unchanged
    expect(updated!.relevantSpans).toHaveLength(1)
  })

  test("updates relevantSpans with multi-doc spans", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)

    const questionId = await t.run(async (ctx) => {
      return await ctx.db.insert("questions", {
        datasetId,
        queryId: "q2",
        queryText: "Some question?",
        sourceDocId: "doc1",
        relevantSpans: [{ docId: "doc1", start: 0, end: 5, text: "hello" }],
        metadata: {}
      })
    })

    const newSpans = [
      { docId: "doc1", start: 0, end: 5, text: "hello" },
      { docId: "doc2", start: 10, end: 20, text: "world text" }
    ]

    const authedT = t.withIdentity(testIdentity)
    await authedT.mutation(api.kb.questions.updateQuestion, {
      questionId,
      relevantSpans: newSpans
    })

    const updated = await t.run(async (ctx) => ctx.db.get(questionId))
    expect(updated!.relevantSpans).toHaveLength(2)
    expect(updated!.relevantSpans[1].docId).toBe("doc2")
  })

  test("rejects update for question in different org", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const datasetId = await seedDataset(t, userId, kbId)

    const questionId = await t.run(async (ctx) => {
      return await ctx.db.insert("questions", {
        datasetId,
        queryId: "q3",
        queryText: "Question?",
        sourceDocId: "doc1",
        relevantSpans: [],
        metadata: {}
      })
    })

    const wrongOrgIdentity = {
      ...testIdentity,
      org_id: "org_other999"
    }

    const wrongAuthedT = t.withIdentity(wrongOrgIdentity)
    await expect(
      wrongAuthedT.mutation(api.kb.questions.updateQuestion, {
        questionId,
        queryText: "Hacked!"
      })
    ).rejects.toThrow()
  })
})
