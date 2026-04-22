import { describe, it, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import workpoolTest from "@convex-dev/workpool/test";
import {
  setupTest,
  seedUser,
  seedKB,
  TEST_ORG_ID,
} from "./helpers";
import { Id } from "../convex/_generated/dataModel";

// ─── Helpers ───

function setup() {
  const t = setupTest();
  workpoolTest.register(t, "conversationSimPool");
  return t;
}

async function seedConversationSimDataset(
  t: ReturnType<typeof setup>,
  userId: Id<"users">,
  kbId: Id<"knowledgeBases">,
) {
  return await t.run(async (ctx) => {
    return ctx.db.insert("datasets", {
      orgId: TEST_ORG_ID,
      kbId,
      name: "Test Sim Dataset",
      strategy: "conversation_sim",
      type: "conversation_sim",
      strategyConfig: {},
      questionCount: 0,
      metadata: {},
      createdBy: userId,
      createdAt: Date.now(),
    });
  });
}

const basePersona = {
  type: "test",
  traits: [] as string[],
  communicationStyle: "casual",
  patienceLevel: "medium" as const,
};

const baseScenario = {
  orgId: TEST_ORG_ID,
  persona: basePersona,
  topic: "test topic",
  intent: "test intent",
  complexity: "low" as const,
  reasonForContact: "testing",
  knownInfo: "some info",
  unknownInfo: "some unknown",
  instruction: "test instruction",
};

// ─── Tests ───

describe("scenario generation schema", () => {
  it("existing scenarios without new fields still work", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedConversationSimDataset(t, userId, kbId);

    const scenarioId = await t.run(async (ctx) => {
      return ctx.db.insert("conversationScenarios", {
        datasetId,
        ...baseScenario,
      });
    });

    const scenario = await t.run(async (ctx) => ctx.db.get(scenarioId));
    expect(scenario).toBeDefined();
    expect(scenario!.sourceType).toBeUndefined();
    expect(scenario!.sourceTranscriptId).toBeUndefined();
    expect(scenario!.languages).toBeUndefined();
  });

  it("scenarios with sourceType and languages are persisted", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedConversationSimDataset(t, userId, kbId);

    const scenarioId = await t.run(async (ctx) => {
      return ctx.db.insert("conversationScenarios", {
        datasetId,
        ...baseScenario,
        persona: {
          type: "test",
          traits: ["friendly"],
          communicationStyle: "formal",
          patienceLevel: "high",
        },
        topic: "billing",
        intent: "refund request",
        complexity: "medium",
        reasonForContact: "overcharged",
        knownInfo: "account number",
        unknownInfo: "refund policy",
        sourceType: "transcript_grounded",
        languages: ["english", "spanish"],
      });
    });

    const scenario = await t.run(async (ctx) => ctx.db.get(scenarioId));
    expect(scenario!.sourceType).toBe("transcript_grounded");
    expect(scenario!.languages).toEqual(["english", "spanish"]);
  });

  it("scenarioGenJobs stores expanded config", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedConversationSimDataset(t, userId, kbId);

    const jobId = await t.run(async (ctx) => {
      return ctx.db.insert("scenarioGenJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        status: "pending",
        targetCount: 20,
        generatedCount: 0,
        createdAt: Date.now(),
        distribution: 80,
        fidelity: 90,
      });
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.distribution).toBe(80);
    expect(job!.fidelity).toBe(90);
  });

  it("scenarioGenJobs without new fields still work", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedConversationSimDataset(t, userId, kbId);

    const jobId = await t.run(async (ctx) => {
      return ctx.db.insert("scenarioGenJobs", {
        orgId: TEST_ORG_ID,
        kbId,
        datasetId,
        status: "running",
        targetCount: 10,
        generatedCount: 0,
        createdAt: Date.now(),
      });
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job).toBeDefined();
    expect(job!.distribution).toBeUndefined();
    expect(job!.fidelity).toBeUndefined();
    expect(job!.transcriptUploadIds).toBeUndefined();
  });

  it("createInternal persists sourceType and languages", async () => {
    const t = setup();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedConversationSimDataset(t, userId, kbId);

    const scenarioId = await t.mutation(
      internal.conversationSim.scenarios.createInternal,
      {
        datasetId,
        orgId: TEST_ORG_ID,
        persona: {
          type: "frustrated_customer",
          traits: ["impatient"],
          communicationStyle: "direct",
          patienceLevel: "low",
        },
        topic: "shipping delay",
        intent: "track package",
        complexity: "high",
        reasonForContact: "package not delivered",
        knownInfo: "order number",
        unknownInfo: "delivery date",
        instruction: "Play a frustrated customer...",
        sourceType: "transcript_grounded",
        languages: ["english"],
      },
    );

    const scenario = await t.run(async (ctx) => ctx.db.get(scenarioId));
    expect(scenario).toBeDefined();
    expect(scenario!.sourceType).toBe("transcript_grounded");
    expect(scenario!.languages).toEqual(["english"]);
    expect(scenario!.orgId).toBe(TEST_ORG_ID);
  });
});
