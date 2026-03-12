import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import {
  setupTest,
  seedUser,
  seedKB,
  seedDocument,
  testIdentity,
  TEST_ORG_ID,
} from "./helpers";

// ─── Domain-Specific Seeders ───

async function seedChunks(
  t: ReturnType<typeof setupTest>,
  kbId: Id<"knowledgeBases">,
  docId: Id<"documents">,
  indexConfigHash: string,
  count: number,
) {
  return await t.run(async (ctx) => {
    const ids: Id<"documentChunks">[] = [];
    for (let i = 0; i < count; i++) {
      const id = await ctx.db.insert("documentChunks", {
        documentId: docId,
        kbId,
        indexConfigHash,
        chunkId: `chunk-${i}`,
        content: `Content of chunk ${i}`,
        start: i * 100,
        end: (i + 1) * 100,
        metadata: {},
      });
      ids.push(id);
    }
    return ids;
  });
}

// ─── Tests: getChunksByRetrieverPage ───

describe("chunks: getChunksByRetrieverPage", () => {
  let t: ReturnType<typeof setupTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("returns chunks matching the kbId and indexConfigHash", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);

    await seedChunks(t, kbId, docId, "hash-abc", 3);

    const result = await t.withIdentity(testIdentity).query(
      api.retrieval.chunks.getChunksByRetrieverPage,
      { kbId, indexConfigHash: "hash-abc", cursor: null },
    );

    expect(result.chunks).toHaveLength(3);
    expect(result.isDone).toBe(true);

    // Verify chunk content shape
    const chunk = result.chunks[0];
    expect(chunk.chunkId).toBe("chunk-0");
    expect(chunk.content).toBe("Content of chunk 0");
    expect(chunk.start).toBe(0);
    expect(chunk.end).toBe(100);
    expect(chunk.documentId).toBeDefined();
    expect(chunk.metadata).toEqual({});
  });

  it("returns empty result for a non-matching indexConfigHash", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);

    await seedChunks(t, kbId, docId, "hash-abc", 3);

    const result = await t.withIdentity(testIdentity).query(
      api.retrieval.chunks.getChunksByRetrieverPage,
      { kbId, indexConfigHash: "hash-wrong", cursor: null },
    );

    expect(result.chunks).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });

  it("filters by documentId when provided", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const doc1Id = await seedDocument(t, kbId, { title: "Doc 1", content: "First document content" });
    const doc2Id = await seedDocument(t, kbId, { title: "Doc 2", content: "Second document content" });

    await seedChunks(t, kbId, doc1Id, "hash-abc", 2);
    await seedChunks(t, kbId, doc2Id, "hash-abc", 3);

    // Filter to doc1 only
    const result = await t.withIdentity(testIdentity).query(
      api.retrieval.chunks.getChunksByRetrieverPage,
      { kbId, indexConfigHash: "hash-abc", documentId: doc1Id, cursor: null },
    );

    expect(result.chunks).toHaveLength(2);
    for (const chunk of result.chunks) {
      expect(chunk.documentId).toBe(doc1Id);
    }
  });

  it("paginates correctly with multiple pages", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);

    // Insert 60 chunks — with pageSize=25, should need 3 pages
    await seedChunks(t, kbId, docId, "hash-abc", 60);

    const authedT = t.withIdentity(testIdentity);

    // First page
    const page1 = await authedT.query(
      api.retrieval.chunks.getChunksByRetrieverPage,
      { kbId, indexConfigHash: "hash-abc", cursor: null, pageSize: 25 },
    );

    expect(page1.chunks).toHaveLength(25);
    expect(page1.isDone).toBe(false);
    expect(page1.continueCursor).toBeDefined();

    // Second page
    const page2 = await authedT.query(
      api.retrieval.chunks.getChunksByRetrieverPage,
      { kbId, indexConfigHash: "hash-abc", cursor: page1.continueCursor, pageSize: 25 },
    );

    expect(page2.chunks).toHaveLength(25);
    expect(page2.isDone).toBe(false);

    // Third page
    const page3 = await authedT.query(
      api.retrieval.chunks.getChunksByRetrieverPage,
      { kbId, indexConfigHash: "hash-abc", cursor: page2.continueCursor, pageSize: 25 },
    );

    expect(page3.chunks).toHaveLength(10);
    expect(page3.isDone).toBe(true);

    // Verify no duplicates across pages
    const allChunkIds = [
      ...page1.chunks.map((c) => c.chunkId),
      ...page2.chunks.map((c) => c.chunkId),
      ...page3.chunks.map((c) => c.chunkId),
    ];
    const uniqueIds = new Set(allChunkIds);
    expect(uniqueIds.size).toBe(60);
  });

  it("throws when KB belongs to a different org", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);

    await seedChunks(t, kbId, docId, "hash-abc", 1);

    const otherOrgIdentity = { ...testIdentity, org_id: "org_other999" };

    await expect(
      t.withIdentity(otherOrgIdentity).query(
        api.retrieval.chunks.getChunksByRetrieverPage,
        { kbId, indexConfigHash: "hash-abc", cursor: null },
      ),
    ).rejects.toThrow("KB not found");
  });

  it("strips embedding from chunk output", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);

    // Insert a chunk WITH an embedding
    await t.run(async (ctx) => {
      await ctx.db.insert("documentChunks", {
        documentId: docId,
        kbId,
        indexConfigHash: "hash-abc",
        chunkId: "chunk-embedded",
        content: "Embedded chunk content",
        start: 0,
        end: 22,
        embedding: new Array(1536).fill(0.1),
        metadata: {},
      });
    });

    const result = await t.withIdentity(testIdentity).query(
      api.retrieval.chunks.getChunksByRetrieverPage,
      { kbId, indexConfigHash: "hash-abc", cursor: null },
    );

    expect(result.chunks).toHaveLength(1);
    // The query explicitly maps to a subset of fields — no embedding
    const chunk = result.chunks[0];
    expect(chunk).not.toHaveProperty("embedding");
    expect(chunk.content).toBe("Embedded chunk content");
  });
});

// ─── Tests: getContent ───

describe("documents: getContent", () => {
  let t: ReturnType<typeof setupTest>;

  beforeEach(() => {
    t = setupTest();
  });

  it("returns document content for a valid document", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId, {
      title: "My Doc",
      content: "# Heading\n\nParagraph text here.",
    });

    const result = await t.withIdentity(testIdentity).query(
      api.crud.documents.getContent,
      { id: docId },
    );

    expect(result.docId).toBe("My Doc");
    expect(result.content).toBe("# Heading\n\nParagraph text here.");
    expect(result.kbId).toBe(kbId);
  });

  it("throws for a document belonging to a different org", async () => {
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);

    const otherOrgIdentity = { ...testIdentity, org_id: "org_other999" };

    await expect(
      t.withIdentity(otherOrgIdentity).query(
        api.crud.documents.getContent,
        { id: docId },
      ),
    ).rejects.toThrow("Access denied");
  });

  it("throws for a non-existent document ID", async () => {
    await seedUser(t);

    // Fabricate a fake document ID by inserting + deleting
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const docId = await seedDocument(t, kbId);
    await t.run(async (ctx) => {
      await ctx.db.delete(docId);
    });

    await expect(
      t.withIdentity(testIdentity).query(
        api.crud.documents.getContent,
        { id: docId },
      ),
    ).rejects.toThrow("Document not found");
  });
});
