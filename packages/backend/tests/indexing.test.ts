import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import {
  TEST_ORG_ID,
  setupTest,
  seedUser,
  seedKB,
} from "./helpers";

// ─── Domain-Specific Seeders ───

async function seedIndexingJob(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
  overrides: Partial<{
    status: string;
    totalDocs: number;
    processedDocs: number;
    failedDocs: number;
    skippedDocs: number;
    totalChunks: number;
  }> = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("indexingJobs", {
      orgId: TEST_ORG_ID,
      kbId,
      indexConfigHash: "test-hash-123",
      indexConfig: { chunkSize: 500, chunkOverlap: 50, embeddingModel: "text-embedding-3-small" },
      status: (overrides.status ?? "running") as any,
      totalDocs: overrides.totalDocs ?? 3,
      processedDocs: overrides.processedDocs ?? 0,
      failedDocs: overrides.failedDocs ?? 0,
      skippedDocs: overrides.skippedDocs ?? 0,
      totalChunks: overrides.totalChunks ?? 0,
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

async function seedDocument(
  t: ReturnType<typeof setupTest>,
  kbId: Id<"knowledgeBases">,
  index: number,
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["test content"]));
    return await ctx.db.insert("documents", {
      orgId: TEST_ORG_ID,
      kbId,
      docId: `doc_${index}`,
      title: `Test Document ${index}`,
      content: "This is test content for the document.",
      fileId: storageId,
      contentLength: 40,
      metadata: {},
      createdAt: Date.now(),
    });
  });
}

// ─── Tests ───

describe("indexing: onDocumentIndexed", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("increments processedDocs on success", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 3,
      processedDocs: 1,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 5, chunksEmbedded: 5 },
      },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.processedDocs).toBe(2);
    expect(job!.failedDocs).toBe(0);
    expect(job!.status).toBe("running");
  });

  it("tracks totalChunks from success result", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 3,
      totalChunks: 10,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 5, chunksEmbedded: 5 },
      },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.totalChunks).toBe(15); // 10 + 5
  });

  it("handles skipped docs", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 3,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: true, chunksInserted: 0, chunksEmbedded: 0 },
      },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.skippedDocs).toBe(1);
    expect(job!.processedDocs).toBe(0);
  });

  it("increments failedDocs and records details on failure", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 2,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: { kind: "failed", error: "Embedding API error" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.failedDocs).toBe(1);
    expect(job!.failedDocDetails).toEqual([
      { documentId, error: "Embedding API error" },
    ]);
  });

  it("increments skippedDocs on canceled result", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 2,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: { kind: "canceled" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.skippedDocs).toBe(1);
    expect(job!.failedDocs).toBe(0);
  });

  it("transitions to completed when all docs succeed", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 1,
      processedDocs: 0,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 3, chunksEmbedded: 3 },
      },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("completed");
    expect(job!.completedAt).toBeDefined();
  });

  it("transitions to failed when all docs fail", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 1,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: { kind: "failed", error: "Fatal error" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("failed");
    expect(job!.completedAt).toBeDefined();
  });

  it("transitions to completed_with_errors on mixed results", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const doc1Id = await seedDocument(t, kbId, 1);
    const doc2Id = await seedDocument(t, kbId, 2);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      totalDocs: 2,
    });

    // First doc succeeds
    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake1",
      context: { jobId, documentId: doc1Id },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 3, chunksEmbedded: 3 },
      },
    });

    // Second doc fails
    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake2",
      context: { jobId, documentId: doc2Id },
      result: { kind: "failed", error: "Timeout" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("completed_with_errors");
    expect(job!.completedAt).toBeDefined();
  });

  it("transitions to canceled when canceling and all handled", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      status: "canceling",
      totalDocs: 1,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: { kind: "canceled" },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("canceled");
    expect(job!.completedAt).toBeDefined();
  });

  it("ignores callback if job already canceled", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const documentId = await seedDocument(t, kbId, 1);
    const jobId = await seedIndexingJob(t, userId, kbId, {
      status: "canceled",
      totalDocs: 2,
    });

    await t.mutation(internal.retrieval.indexing.onDocumentIndexed, {
      workId: "w_fake",
      context: { jobId, documentId },
      result: {
        kind: "success",
        returnValue: { skipped: false, chunksInserted: 5, chunksEmbedded: 5 },
      },
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    // Counters should not have changed
    expect(job!.processedDocs).toBe(0);
  });
});
