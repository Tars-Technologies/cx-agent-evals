import type { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"
import { api, internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"
import {
  seedKB,
  seedUser,
  setupTest,
  TEST_ORG_ID,
  testIdentity
} from "./helpers"

// ─── Domain-Specific Seeders ───

async function seedRetriever(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
  overrides: Partial<{
    status: string
    indexConfigHash: string
    indexingJobId: Id<"indexingJobs">
    chunkCount: number
    error: string
    vectorBackend: string
    qdrantCollection: string
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("retrievers", {
      orgId: TEST_ORG_ID,
      kbId,
      name: "Test Retriever",
      retrieverConfig: { chunking: {}, embedding: {} },
      indexConfigHash: overrides.indexConfigHash ?? "idx-hash-123",
      retrieverConfigHash: "ret-hash-123",
      defaultK: 5,
      vectorBackend: overrides.vectorBackend,
      qdrantCollection: overrides.qdrantCollection,
      indexingJobId: overrides.indexingJobId,
      status: (overrides.status ?? "configuring") as any,
      chunkCount: overrides.chunkCount,
      error: overrides.error,
      createdBy: userId,
      createdAt: Date.now()
    })
  })
}

async function seedIndexingJob(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
  overrides: Partial<{
    status: string
    indexConfigHash: string
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("indexingJobs", {
      orgId: TEST_ORG_ID,
      kbId,
      indexConfigHash: overrides.indexConfigHash ?? "idx-hash-123",
      indexConfig: {
        chunkSize: 500,
        chunkOverlap: 50,
        embeddingModel: "text-embedding-3-small"
      },
      status: (overrides.status ?? "completed") as any,
      totalDocs: 1,
      processedDocs: 1,
      failedDocs: 0,
      skippedDocs: 0,
      totalChunks: 10,
      createdBy: userId,
      createdAt: Date.now()
    })
  })
}

/** Args of cleanupAction calls enqueued on the scheduler during the test. */
async function scheduledCleanupArgs(t: ReturnType<typeof setupTest>) {
  const scheduled = await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect()
  )
  return scheduled
    .filter((s) => s.name.includes("cleanupAction"))
    .map((s) => s.args[0] as Record<string, unknown>)
}

// ─── Tests ───

describe("retrievers: deleteIndex", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("auto-resets other retrievers sharing the same indexConfigHash", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedIndexingJob(t, userId, kbId)

    // Create two retrievers sharing the same indexConfigHash
    const retriever1Id = await seedRetriever(t, userId, kbId, {
      status: "ready",
      indexingJobId: jobId,
      chunkCount: 10
    })
    const retriever2Id = await seedRetriever(t, userId, kbId, {
      status: "ready",
      indexingJobId: jobId,
      chunkCount: 10
    })

    const authedT = t.withIdentity(testIdentity)
    const result = await authedT.mutation(api.kb.retrievers.deleteIndex, {
      id: retriever1Id
    })
    expect(result).toEqual({ deleted: true })

    // The requesting retriever should be reset to "configuring"
    const retriever1 = await t.run(async (ctx) => ctx.db.get(retriever1Id))
    expect(retriever1!.status).toBe("configuring")
    expect(retriever1!.chunkCount).toBeUndefined()
    expect(retriever1!.indexingJobId).toBeUndefined()

    // The sharing retriever should also be reset to "configuring"
    const retriever2 = await t.run(async (ctx) => ctx.db.get(retriever2Id))
    expect(retriever2!.status).toBe("configuring")
    expect(retriever2!.chunkCount).toBeUndefined()
    expect(retriever2!.indexingJobId).toBeUndefined()
    expect(retriever2!.error).toBeUndefined()
  })

  it("succeeds when no shared index", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedIndexingJob(t, userId, kbId)

    const retrieverId = await seedRetriever(t, userId, kbId, {
      status: "ready",
      indexingJobId: jobId,
      chunkCount: 10
    })

    const authedT = t.withIdentity(testIdentity)
    const result = await authedT.mutation(api.kb.retrievers.deleteIndex, {
      id: retrieverId
    })
    expect(result).toEqual({ deleted: true })

    // Should be reset to "configuring"
    const retriever = await t.run(async (ctx) => ctx.db.get(retrieverId))
    expect(retriever!.status).toBe("configuring")
    expect(retriever!.chunkCount).toBeUndefined()
    expect(retriever!.indexingJobId).toBeUndefined()
  })

  it("forwards vectorBackend and qdrantCollection to cleanupAction", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedIndexingJob(t, userId, kbId)

    const retrieverId = await seedRetriever(t, userId, kbId, {
      status: "ready",
      indexingJobId: jobId,
      chunkCount: 10,
      vectorBackend: "qdrant",
      qdrantCollection: "kb_test_col"
    })

    const authedT = t.withIdentity(testIdentity)
    await authedT.mutation(api.kb.retrievers.deleteIndex, { id: retrieverId })

    const cleanupCalls = await scheduledCleanupArgs(t)
    expect(cleanupCalls).toHaveLength(1)
    expect(cleanupCalls[0]).toMatchObject({
      vectorBackend: "qdrant",
      qdrantCollection: "kb_test_col"
    })
  })
})

describe("retrievers: resetAfterCancel", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("resets to configuring and clears indexingJobId, chunkCount, error", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedIndexingJob(t, userId, kbId, { status: "canceled" })

    const retrieverId = await seedRetriever(t, userId, kbId, {
      status: "indexing",
      indexingJobId: jobId,
      chunkCount: 5,
      error: "Canceled by user"
    })

    const authedT = t.withIdentity(testIdentity)
    const result = await authedT.mutation(api.kb.retrievers.resetAfterCancel, {
      id: retrieverId
    })
    expect(result).toEqual({ reset: true })

    const retriever = await t.run(async (ctx) => ctx.db.get(retrieverId))
    expect(retriever!.status).toBe("configuring")
    expect(retriever!.indexingJobId).toBeUndefined()
    expect(retriever!.chunkCount).toBeUndefined()
    expect(retriever!.error).toBeUndefined()
  })
})

describe("retrievers: remove", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("deletes retriever", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    const retrieverId = await seedRetriever(t, userId, kbId)

    const authedT = t.withIdentity(testIdentity)
    const result = await authedT.mutation(api.kb.retrievers.remove, {
      id: retrieverId
    })
    expect(result).toEqual({ deleted: true })

    const retriever = await t.run(async (ctx) => ctx.db.get(retrieverId))
    expect(retriever).toBeNull()
  })

  it("forwards vectorBackend and qdrantCollection to cleanupAction", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedIndexingJob(t, userId, kbId)

    const retrieverId = await seedRetriever(t, userId, kbId, {
      status: "ready",
      indexingJobId: jobId,
      chunkCount: 10,
      vectorBackend: "qdrant",
      qdrantCollection: "kb_test_col"
    })

    const authedT = t.withIdentity(testIdentity)
    await authedT.mutation(api.kb.retrievers.remove, { id: retrieverId })

    const cleanupCalls = await scheduledCleanupArgs(t)
    expect(cleanupCalls).toHaveLength(1)
    expect(cleanupCalls[0]).toMatchObject({
      vectorBackend: "qdrant",
      qdrantCollection: "kb_test_col"
    })
  })
})

describe("retrievers: insertRetriever", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("creates retriever record", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    const retrieverId = await t.mutation(
      internal.kb.retrievers.insertRetriever,
      {
        orgId: TEST_ORG_ID,
        kbId,
        name: "New Retriever",
        retrieverConfig: {
          chunking: { size: 500 },
          embedding: { model: "text-embedding-3-small" }
        },
        indexConfigHash: "new-idx-hash",
        retrieverConfigHash: "new-ret-hash",
        defaultK: 10,
        status: "configuring",
        createdBy: userId
      }
    )

    const retriever = await t.run(async (ctx) => ctx.db.get(retrieverId))
    expect(retriever).not.toBeNull()
    expect(retriever!.name).toBe("New Retriever")
    expect(retriever!.orgId).toBe(TEST_ORG_ID)
    expect(retriever!.indexConfigHash).toBe("new-idx-hash")
    expect(retriever!.defaultK).toBe(10)
    expect(retriever!.status).toBe("configuring")
    expect(retriever!.createdAt).toBeDefined()
  })

  it("rejects a KB owned by another organization", async () => {
    const userId = await seedUser(t)
    const foreignKbId = await t.run(async (ctx) => {
      return await ctx.db.insert("knowledgeBases", {
        orgId: "org_other",
        name: "Foreign KB",
        metadata: {},
        createdBy: userId,
        createdAt: Date.now()
      })
    })

    await expect(
      t.mutation(internal.kb.retrievers.insertRetriever, {
        orgId: TEST_ORG_ID,
        kbId: foreignKbId,
        name: "Cross-tenant Retriever",
        retrieverConfig: {},
        indexConfigHash: "foreign-index",
        retrieverConfigHash: "foreign-retriever",
        defaultK: 5,
        status: "configuring",
        createdBy: userId
      })
    ).rejects.toThrow("Knowledge base not found")
  })
})

describe("retrievers: create", () => {
  it("rejects a KB owned by another organization", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const foreignKbId = await t.run(async (ctx) => {
      return await ctx.db.insert("knowledgeBases", {
        orgId: "org_other",
        name: "Foreign KB",
        metadata: {},
        createdBy: userId,
        createdAt: Date.now()
      })
    })

    await expect(
      t.withIdentity(testIdentity).action(api.kb.retrieve_actions.create, {
        kbId: foreignKbId,
        retrieverConfig: {
          name: "Cross-tenant Retriever",
          index: {
            strategy: "plain",
            vectorBackend: "native",
            embeddingProvider: "openai"
          }
        }
      })
    ).rejects.toThrow("Knowledge base not found")
  })
})

describe("indexing: startIndexing", () => {
  it("rejects an organization that does not own the KB", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const foreignKbId = await t.run(async (ctx) => {
      return await ctx.db.insert("knowledgeBases", {
        orgId: "org_other",
        name: "Foreign KB",
        metadata: {},
        documentCount: 1,
        createdBy: userId,
        createdAt: Date.now()
      })
    })

    await expect(
      t.mutation(internal.kb.indexing.startIndexing, {
        orgId: TEST_ORG_ID,
        kbId: foreignKbId,
        indexConfigHash: "foreign-index",
        indexConfig: {
          strategy: "plain",
          chunkSize: 500,
          chunkOverlap: 50,
          embeddingModel: "text-embedding-3-small"
        },
        createdBy: userId
      })
    ).rejects.toThrow("Knowledge base not found")
  })
})

describe("retrievers: syncStatusFromIndexingJob", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("sets retriever to ready when indexing job completed", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      status: "completed"
    })

    const retrieverId = await seedRetriever(t, userId, kbId, {
      status: "indexing",
      indexingJobId: jobId
    })

    await t.mutation(internal.kb.retrievers.syncStatusFromIndexingJob, {
      retrieverId
    })

    const retriever = await t.run(async (ctx) => ctx.db.get(retrieverId))
    expect(retriever!.status).toBe("ready")
    expect(retriever!.chunkCount).toBe(10) // totalChunks from the job
  })

  it("sets retriever to error when indexing job failed", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)

    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert("indexingJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        indexConfigHash: "idx-hash-123",
        indexConfig: {
          chunkSize: 500,
          chunkOverlap: 50,
          embeddingModel: "text-embedding-3-small"
        },
        status: "failed" as any,
        totalDocs: 1,
        processedDocs: 0,
        failedDocs: 1,
        skippedDocs: 0,
        totalChunks: 0,
        error: "All documents failed",
        createdBy: userId,
        createdAt: Date.now()
      })
    })

    const retrieverId = await seedRetriever(t, userId, kbId, {
      status: "indexing",
      indexingJobId: jobId
    })

    await t.mutation(internal.kb.retrievers.syncStatusFromIndexingJob, {
      retrieverId
    })

    const retriever = await t.run(async (ctx) => ctx.db.get(retrieverId))
    expect(retriever!.status).toBe("error")
    expect(retriever!.error).toBe("All documents failed")
  })

  it("does nothing if retriever is not in indexing status", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      status: "completed"
    })

    const retrieverId = await seedRetriever(t, userId, kbId, {
      status: "ready",
      indexingJobId: jobId,
      chunkCount: 5
    })

    await t.mutation(internal.kb.retrievers.syncStatusFromIndexingJob, {
      retrieverId
    })

    // Should remain unchanged
    const retriever = await t.run(async (ctx) => ctx.db.get(retrieverId))
    expect(retriever!.status).toBe("ready")
    expect(retriever!.chunkCount).toBe(5)
  })
})
