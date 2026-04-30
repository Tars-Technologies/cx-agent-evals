import { describe, it, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import { setupTest, seedUser, seedKB, TEST_ORG_ID } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

async function seedDataset(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("datasets", {
      orgId: TEST_ORG_ID,
      kbId,
      name: "Test Sim Dataset",
      strategy: "conversation_sim",
      strategyConfig: {},
      type: "conversation_sim",
      questionCount: 0,
      scenarioCount: 0,
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    }),
  );
}

async function seedTranscript(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  messages: Array<{ id: number; role: "user" | "human_agent" | "workflow_input"; text: string }>,
) {
  // livechatUploads requires a real csvStorageId — store a small blob to get one
  const csvStorageId = await t.run(async (ctx: any) =>
    ctx.storage.store(new Blob(["a,b\n1,2\n"])),
  );
  return await t.run(async (ctx: any) => {
    const uploadId = await ctx.db.insert("livechatUploads", {
      orgId: TEST_ORG_ID,
      createdBy: userId,
      filename: "test.csv",
      csvStorageId,
      status: "ready",
      createdAt: Date.now(),
    });
    return ctx.db.insert("livechatConversations", {
      uploadId,
      orgId: TEST_ORG_ID,
      conversationId: "conv1",
      visitorId: "v1",
      visitorName: "Test User",
      visitorPhone: "",
      visitorEmail: "",
      agentId: "a1",
      agentName: "Test Agent",
      agentEmail: "",
      inbox: "",
      labels: [],
      status: "completed",
      messages,
      metadata: {},
      classificationStatus: "none",
      translationStatus: "none",
    });
  });
}

describe("backfillGrounded", () => {
  it("snapshots transcript and computes length stats", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "Hello?" },
      { id: 2, role: "user", text: "Hi" },
      { id: 3, role: "workflow_input", text: "[event]" },
      { id: 4, role: "user", text: "I want help" },
    ]);

    const scenarioId = await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId,
        orgId: TEST_ORG_ID,
        persona: { type: "User", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "test", intent: "test", complexity: "medium",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "old prose",
        sourceType: "transcript_grounded",
        sourceTranscriptId: transcriptId,
      }),
    );

    const result = await t.mutation(internal.conversationSim.migrations.backfillGrounded, {});
    expect(result.isDone).toBe(true);

    const after = await t.run(async (ctx: any) => ctx.db.get(scenarioId));
    expect(after?.referenceTranscript).toHaveLength(4);
    expect(after?.referenceTranscript?.[2].role).toBe("workflow_input"); // not filtered
    expect(after?.userMessageLengthStats).toBeDefined();
    expect(after?.userMessageLengthStats?.median).toBeGreaterThan(0);
  });

  it("is idempotent: running twice changes nothing on the second pass", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "Hi?" },
      { id: 2, role: "user", text: "ok" },
    ]);
    await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "transcript_grounded", sourceTranscriptId: transcriptId,
      }),
    );

    const r1 = await t.mutation(internal.conversationSim.migrations.backfillGrounded, {});
    const r2 = await t.mutation(internal.conversationSim.migrations.backfillGrounded, {});
    expect(r1.migrated).toBe(1);
    expect(r2.migrated).toBe(0);
  });

  it("skips synthetic scenarios (no sourceTranscriptId)", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "synthetic",
      }),
    );
    const result = await t.mutation(internal.conversationSim.migrations.backfillGrounded, {});
    expect(result.migrated).toBe(0);
  });

  it("leaves length stats unset when transcript has no user messages", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);
    const transcriptId = await seedTranscript(t, userId, [
      { id: 1, role: "human_agent", text: "anyone?" },
    ]);
    const scenarioId = await t.run(async (ctx: any) =>
      ctx.db.insert("conversationScenarios", {
        datasetId, orgId: TEST_ORG_ID,
        persona: { type: "x", traits: [], communicationStyle: "casual", patienceLevel: "medium" },
        topic: "t", intent: "i", complexity: "low",
        reasonForContact: "x", knownInfo: "y", unknownInfo: "z",
        instruction: "", sourceType: "transcript_grounded", sourceTranscriptId: transcriptId,
      }),
    );
    await t.mutation(internal.conversationSim.migrations.backfillGrounded, {});
    const after = await t.run(async (ctx: any) => ctx.db.get(scenarioId));
    expect(after?.referenceTranscript).toHaveLength(1);
    expect(after?.userMessageLengthStats).toBeUndefined();
  });
});
