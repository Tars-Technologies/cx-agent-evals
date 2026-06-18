import type { convexTest } from "convex-test"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"
import { qdrantCollectionName } from "../convex/kb/vector_backend"
import { seedKB, seedUser, setupTest, TEST_ORG_ID } from "./helpers"

// ─── Domain-Specific Seeders ───

async function seedIndexingJob(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
  overrides: Partial<{
    status: string
    totalDocs: number
    processedDocs: number
    failedDocs: number
    skippedDocs: number
    totalChunks: number
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("indexingJobs", {
      orgId: TEST_ORG_ID,
      kbId,
      indexConfigHash: "test-hash-123",
      indexConfig: {
        chunkSize: 500,
        chunkOverlap: 50,
        embeddingModel: "text-embedding-3-small"
      },
      status: (overrides.status ?? "running") as any,
      totalDocs: overrides.totalDocs ?? 3,
      processedDocs: overrides.processedDocs ?? 0,
      failedDocs: overrides.failedDocs ?? 0,
      skippedDocs: overrides.skippedDocs ?? 0,
      totalChunks: overrides.totalChunks ?? 0,
      createdBy: userId,
      createdAt: Date.now()
    })
  })
}

async function seedDocument(
  t: ReturnType<typeof setupTest>,
  kbId: Id<"knowledgeBases">,
  index: number
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["test content"]))
    return await ctx.db.insert("documents", {
      orgId: TEST_ORG_ID,
      kbId,
      docId: `doc_${index}`,
      title: `Test Document ${index}`,
      content: "This is test content for the document.",
      fileId: storageId,
      contentLength: 40,
      metadata: {},
      createdAt: Date.now()
    })
  })
}

// ─── Tests ───

describe("indexing: startIndexing vector backend", () => {
  it("stamps vectorBackend and qdrantCollection on the job for qdrant configs", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      await seedDocument(t, kbId, 1)
      // startIndexing reads the denormalized documentCount
      await t.run(async (ctx) => {
        await ctx.db.patch(kbId, { documentCount: 1 })
      })

      const hash = "qdrant-hash-0123456789abcdef"
      const result = await t.mutation(internal.kb.indexing.startIndexing, {
        orgId: TEST_ORG_ID,
        kbId,
        indexConfigHash: hash,
        indexConfig: { strategy: "plain", vectorBackend: "qdrant" },
        createdBy: userId
      })

      const job = await t.run(async (ctx) => ctx.db.get(result.jobId))
      expect(job!.vectorBackend).toBe("qdrant")
      // The config carries no embeddingProvider/embeddingModel, so the
      // collection name is keyed on the (openai, text-embedding-3-small)
      // defaults, not on this KB's id or index-config hash.
      expect(job!.qdrantCollection).toBe(
        qdrantCollectionName("openai", "text-embedding-3-small")
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("enqueues only parsed docs and derives totalDocs from enqueued work", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      // One parsed (done) doc plus two empty placeholders that the parse path
      // creates. Only the done doc has real content and should be indexed.
      await t.run(async (ctx) => {
        await ctx.db.insert("documents", {
          orgId: TEST_ORG_ID,
          kbId,
          docId: "done",
          title: "Done",
          content: "real content",
          contentLength: 12,
          metadata: {},
          parseStatus: "done",
          createdAt: Date.now()
        })
        await ctx.db.insert("documents", {
          orgId: TEST_ORG_ID,
          kbId,
          docId: "parsing",
          title: "Parsing",
          content: "",
          contentLength: 0,
          metadata: {},
          parseStatus: "parsing",
          createdAt: Date.now()
        })
        await ctx.db.insert("documents", {
          orgId: TEST_ORG_ID,
          kbId,
          docId: "failed",
          title: "Failed",
          content: "",
          contentLength: 0,
          metadata: {},
          parseStatus: "failed",
          createdAt: Date.now()
        })
        // Denormalized count drifts above the true done-doc count to prove
        // totalDocs is derived from enqueued work, not documentCount.
        await ctx.db.patch(kbId, { documentCount: 5 })
      })

      const result = await t.mutation(internal.kb.indexing.startIndexing, {
        orgId: TEST_ORG_ID,
        kbId,
        indexConfigHash: "placeholder-hash-1",
        indexConfig: { strategy: "plain" },
        createdBy: userId
      })

      const job = await t.run(async (ctx) => ctx.db.get(result.jobId))
      // Only the parsed doc is enqueued and counted, not the placeholders.
      expect(job!.totalDocs).toBe(1)
      expect(job!.workIds).toHaveLength(1)
      expect(result.totalDocs).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("throws when every document is an unparsed placeholder", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      await t.run(async (ctx) => {
        await ctx.db.insert("documents", {
          orgId: TEST_ORG_ID,
          kbId,
          docId: "parsing",
          title: "Parsing",
          content: "",
          contentLength: 0,
          metadata: {},
          parseStatus: "parsing",
          createdAt: Date.now()
        })
        // documentCount drifted to 1, but the only row is an empty placeholder,
        // so enumeration must find nothing indexable and refuse to start.
        await ctx.db.patch(kbId, { documentCount: 1 })
      })

      await expect(
        t.mutation(internal.kb.indexing.startIndexing, {
          orgId: TEST_ORG_ID,
          kbId,
          indexConfigHash: "placeholder-hash-2",
          indexConfig: { strategy: "plain" },
          createdBy: userId
        })
      ).rejects.toThrow(/no .*document/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects the native backend paired with a non-OpenAI embedding provider", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      await seedDocument(t, kbId, 1)
      await t.run(async (ctx) => {
        await ctx.db.patch(kbId, { documentCount: 1 })
      })

      await expect(
        t.mutation(internal.kb.indexing.startIndexing, {
          orgId: TEST_ORG_ID,
          kbId,
          indexConfigHash: "native-cohere-hash",
          indexConfig: {
            strategy: "plain",
            vectorBackend: "native",
            embeddingProvider: "cohere"
          },
          createdBy: userId
        })
      ).rejects.toThrow(/native vector backend supports only.*openai/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it("stamps native backend with no qdrantCollection by default", async () => {
    vi.useFakeTimers()
    try {
      const t = setupTest()
      const userId = await seedUser(t)
      const kbId = await seedKB(t, userId)
      await seedDocument(t, kbId, 1)
      await t.run(async (ctx) => {
        await ctx.db.patch(kbId, { documentCount: 1 })
      })

      const result = await t.mutation(internal.kb.indexing.startIndexing, {
        orgId: TEST_ORG_ID,
        kbId,
        indexConfigHash: "native-hash-1",
        indexConfig: { strategy: "plain" },
        createdBy: userId
      })

      const job = await t.run(async (ctx) => ctx.db.get(result.jobId))
      expect(job!.vectorBackend).toBe("native")
      expect(job!.qdrantCollection).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("chunks: markChunksVectorized", () => {
  it("stamps vectorIndexId on every chunk in the batch", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)

    const chunkIds = await t.run(async (ctx) => {
      const ids: Id<"documentChunks">[] = []
      for (let i = 0; i < 2; i++) {
        ids.push(
          await ctx.db.insert("documentChunks", {
            documentId,
            kbId,
            indexConfigHash: "hash-1",
            chunkId: `chunk-${i}`,
            content: `chunk content ${i}`,
            start: i * 10,
            end: i * 10 + 10,
            metadata: {}
          })
        )
      }
      return ids
    })

    const result = await t.mutation(internal.kb.chunks.markChunksVectorized, {
      ids: chunkIds,
      vectorIndexId: "kb_test_collection"
    })
    expect(result.patched).toBe(2)

    const chunks = await t.run(async (ctx) =>
      Promise.all(chunkIds.map((id) => ctx.db.get(id)))
    )
    for (const chunk of chunks) {
      expect(chunk!.vectorIndexId).toBe("kb_test_collection")
      expect(chunk!.embedding).toBeUndefined()
    }
  })
})

describe("indexing: onDocumentIndexed", () => {
  let t: ReturnType<typeof convexTest>

  beforeEach(() => {
    t = setupTest()
  })

  it("increments processedDocs on success", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 3,
      processedDocs: 1
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 5, chunksEmbedded: 5 }
      }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.processedDocs).toBe(2)
    expect(job!.failedDocs).toBe(0)
    expect(job!.status).toBe("running")
  })

  it("tracks totalChunks from success result", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 3,
      totalChunks: 10
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 5, chunksEmbedded: 5 }
      }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.totalChunks).toBe(15) // 10 + 5
  })

  it("handles skipped docs", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 3
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: true, chunksInserted: 0, chunksEmbedded: 0 }
      }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.skippedDocs).toBe(1)
    expect(job!.processedDocs).toBe(0)
  })

  it("increments failedDocs and records details on failure", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 2
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: { kind: "failed", error: "Embedding API error" }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.failedDocs).toBe(1)
    expect(job!.failedDocDetails).toEqual([
      { documentId, error: "Embedding API error" }
    ])
  })

  it("increments skippedDocs on canceled result", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 2
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: { kind: "canceled" }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.skippedDocs).toBe(1)
    expect(job!.failedDocs).toBe(0)
  })

  it("transitions to completed when all docs succeed", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 1,
      processedDocs: 0
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 3, chunksEmbedded: 3 }
      }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.status).toBe("completed")
    expect(job!.completedAt).toBeDefined()
  })

  it("transitions to failed when all docs fail", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 1
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: { kind: "failed", error: "Fatal error" }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.status).toBe("failed")
    expect(job!.completedAt).toBeDefined()
  })

  it("transitions to completed_with_errors on mixed results", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const doc1Id = await seedDocument(t, kbId, 1)
    const doc2Id = await seedDocument(t, kbId, 2)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 2
    })

    // First doc succeeds
    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake1",
      context: { jobId, documentId: doc1Id },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 3, chunksEmbedded: 3 }
      }
    })

    // Second doc fails
    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake2",
      context: { jobId, documentId: doc2Id },
      result: { kind: "failed", error: "Timeout" }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.status).toBe("completed_with_errors")
    expect(job!.completedAt).toBeDefined()
  })

  it("transitions to canceled when canceling and all handled", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      status: "canceling",
      totalDocs: 1
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: { kind: "canceled" }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    expect(job!.status).toBe("canceled")
    expect(job!.completedAt).toBeDefined()
  })

  it("ignores callback if job already canceled", async () => {
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const documentId = await seedDocument(t, kbId, 1)
    const jobId = await seedIndexingJob(t, userId, kbId, {
      status: "canceled",
      totalDocs: 2
    })

    await t.mutation(internal.kb.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 5, chunksEmbedded: 5 }
      }
    })

    const job = await t.run(async (ctx) => ctx.db.get(jobId))
    // Counters should not have changed
    expect(job!.processedDocs).toBe(0)
  })
})
