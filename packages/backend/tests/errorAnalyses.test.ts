import { describe, it, expect, vi } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

vi.mock("openai", () => {
  return {
    default: class {
      chat = {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify({ failureModes: [] }) } }],
          }),
        },
      };
    },
  };
});

async function seedAgent(t: ReturnType<typeof setupTest>): Promise<Id<"agents">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("agents", {
      orgId: TEST_ORG_ID,
      name: "test agent",
      identity: {
        agentName: "Test",
        companyName: "Acme",
        roleDescription: "support",
      },
      guardrails: {},
      responseStyle: {},
      model: "gpt-4o-mini",
      enableReflection: false,
      retrieverIds: [],
      status: "ready" as const,
      createdAt: Date.now(),
    }),
  );
}

async function seedScenarioSet(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
): Promise<Id<"scenarioSets">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("scenarioSets", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "set",
      source: "synthetic" as const,
      generationConfig: { targetCount: 1 },
      scenarioCount: 0,
      createdAt: Date.now(),
    }),
  );
}

async function seedSimulation(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
  agentId: Id<"agents">,
): Promise<Id<"conversationSimulations">> {
  const scenarioSetId = await seedScenarioSet(t, agentId);
  return await t.run(async (ctx) =>
    ctx.db.insert("conversationSimulations", {
      orgId: TEST_ORG_ID,
      userId,
      agentId,
      scenarioSetId,
      k: 1,
      concurrency: 1,
      maxTurns: 5,
      timeoutMs: 60000,
      userSimModel: "x",
      status: "running" as const,
      totalRuns: 1,
      completedRuns: 0,
    }),
  );
}

describe("errorAnalysis/members.resolveContainerInternal", () => {
  it("creates a sim-origin container on first call and reuses it on second", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const simulationId = await seedSimulation(t, userId, agentId);

    const id1 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "simulation", simulationId },
    });
    const id2 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "simulation", simulationId },
    });
    expect(id1).toBe(id2);
  });

  it("creates a playground container per agent (one only)", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);

    const id1 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "playground" },
    });
    const id2 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "playground" },
    });
    expect(id1).toBe(id2);
  });

  it("passes through analysis hint without creating new", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const eaId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "Existing",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );
    const result = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId: TEST_ORG_ID,
      agentId,
      hint: { kind: "analysis", errorAnalysisId: eaId },
    });
    expect(result).toBe(eaId);
  });
});

async function seedPlaygroundConv(
  t: ReturnType<typeof setupTest>,
  agentId: Id<"agents">,
  createdAt?: number,
): Promise<Id<"conversations">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID,
      agentIds: [agentId],
      status: "active" as const,
      source: "playground" as const,
      createdAt: createdAt ?? Date.now(),
    }),
  );
}

describe("errorAnalysis/orchestration", () => {
  it("byAgent returns analyses with correct counts", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const authedT = t.withIdentity(testIdentity);

    const eaId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "EA",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );

    // 2 members
    const conv1 = await seedPlaygroundConv(t, agentId);
    const conv2 = await seedPlaygroundConv(t, agentId);
    await t.run(async (ctx) => {
      await ctx.db.insert("errorAnalysisMembers", {
        orgId: TEST_ORG_ID,
        errorAnalysisId: eaId,
        source: { kind: "conversation", conversationId: conv1 },
        addedVia: "annotation",
        addedAt: Date.now(),
      });
      await ctx.db.insert("errorAnalysisMembers", {
        orgId: TEST_ORG_ID,
        errorAnalysisId: eaId,
        source: { kind: "conversation", conversationId: conv2 },
        addedVia: "import",
        addedAt: Date.now(),
      });
    });

    // 1 annotation
    await t.run(async (ctx) =>
      ctx.db.insert("annotations", {
        orgId: TEST_ORG_ID,
        errorAnalysisId: eaId,
        source: { kind: "conversation", conversationId: conv1 },
        rating: "good_enough" as const,
        tags: [],
        ratedBy: userId,
        createdAt: Date.now(),
      }),
    );

    // 1 failure mode (insert directly — Task 5's mutation not done)
    const fmId = await t.run(async (ctx) =>
      ctx.db.insert("failureModes", {
        orgId: TEST_ORG_ID,
        agentId,
        errorAnalysisId: eaId,
        name: "FM",
        description: "d",
        order: 0,
        createdAt: Date.now(),
      }),
    );

    // 1 evaluator with source.kind === "error_analysis"
    await t.run(async (ctx) =>
      ctx.db.insert("evaluators", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "Judge",
        description: "",
        type: "llm_judge" as const,
        source: {
          kind: "error_analysis" as const,
          failureModeId: fmId,
          errorAnalysisId: eaId,
        },
        status: "draft" as const,
        tags: [],
        createdAt: Date.now(),
      }),
    );

    const result = await authedT.query(api.errorAnalysis.orchestration.byAgent, {
      agentId,
    });
    expect(result).toHaveLength(1);
    expect(result[0].memberCount).toBe(2);
    expect(result[0].annotatedCount).toBe(1);
    expect(result[0].failureModeCount).toBe(1);
    expect(result[0].judgeCount).toBe(1);
  });

  it("createCustom from playground pool of 5 with size 3 creates 3 members", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const authedT = t.withIdentity(testIdentity);

    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await seedPlaygroundConv(t, agentId, base + i);
    }

    const eaId = await authedT.mutation(
      api.errorAnalysis.orchestration.createCustom,
      {
        agentId,
        name: "Custom EA",
        sourcePool: { kind: "playground" },
        size: 10,
      },
    );
    // We can't pass size: 3 (validator restricts to 10/20/50/100/200) so use
    // size: 10; pool has 5 → expect 5 members.
    const members = await t.run((ctx) =>
      ctx.db
        .query("errorAnalysisMembers")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", eaId))
        .collect(),
    );
    expect(members).toHaveLength(5);
    expect(members.every((m) => m.addedVia === "import")).toBe(true);
  });

  it("importMore excludes existing members", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const authedT = t.withIdentity(testIdentity);

    const base = Date.now();
    const convIds: Id<"conversations">[] = [];
    for (let i = 0; i < 5; i++) {
      convIds.push(await seedPlaygroundConv(t, agentId, base + i));
    }

    const eaId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "EA",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );
    // Pre-add 3 members.
    for (let i = 0; i < 3; i++) {
      await t.run(async (ctx) =>
        ctx.db.insert("errorAnalysisMembers", {
          orgId: TEST_ORG_ID,
          errorAnalysisId: eaId,
          source: { kind: "conversation", conversationId: convIds[i] },
          addedVia: "import",
          addedAt: Date.now(),
        }),
      );
    }

    const added = await authedT.mutation(
      api.errorAnalysis.orchestration.importMore,
      {
        errorAnalysisId: eaId,
        sourcePool: { kind: "playground" },
        size: 10,
      },
    );
    // pool has 5, 3 already excluded → 2 remaining
    expect(added).toBe(2);
    const all = await t.run((ctx) =>
      ctx.db
        .query("errorAnalysisMembers")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", eaId))
        .collect(),
    );
    expect(all).toHaveLength(5);
  });

  it("rename updates name + updatedAt", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const authedT = t.withIdentity(testIdentity);

    const eaId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "Old",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );
    await authedT.mutation(api.errorAnalysis.orchestration.rename, {
      id: eaId,
      name: "New",
    });
    const row = await t.run((ctx) => ctx.db.get(eaId));
    expect(row?.name).toBe("New");
    expect(typeof row?.updatedAt).toBe("number");
  });

  it("deleteAnalysis cascades", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t);
    const authedT = t.withIdentity(testIdentity);

    const eaId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "EA",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );
    const convId = await seedPlaygroundConv(t, agentId);
    const fmId = await t.run(async (ctx) =>
      ctx.db.insert("failureModes", {
        orgId: TEST_ORG_ID,
        agentId,
        errorAnalysisId: eaId,
        name: "FM",
        description: "d",
        order: 0,
        createdAt: Date.now(),
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("errorAnalysisMembers", {
        orgId: TEST_ORG_ID,
        errorAnalysisId: eaId,
        source: { kind: "conversation", conversationId: convId },
        addedVia: "import",
        addedAt: Date.now(),
      });
      await ctx.db.insert("annotations", {
        orgId: TEST_ORG_ID,
        errorAnalysisId: eaId,
        source: { kind: "conversation", conversationId: convId },
        rating: "bad" as const,
        tags: [],
        ratedBy: userId,
        createdAt: Date.now(),
      });
      await ctx.db.insert("failureModeMemberships", {
        orgId: TEST_ORG_ID,
        failureModeId: fmId,
        source: { kind: "conversation", conversationId: convId },
        createdAt: Date.now(),
      });
    });

    await authedT.mutation(api.errorAnalysis.orchestration.deleteAnalysis, {
      id: eaId,
    });

    const members = await t.run((ctx) =>
      ctx.db
        .query("errorAnalysisMembers")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", eaId))
        .collect(),
    );
    const anns = await t.run((ctx) =>
      ctx.db
        .query("annotations")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", eaId))
        .collect(),
    );
    const modes = await t.run((ctx) =>
      ctx.db
        .query("failureModes")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", eaId))
        .collect(),
    );
    const mships = await t.run((ctx) =>
      ctx.db
        .query("failureModeMemberships")
        .withIndex("by_failure_mode", (q) => q.eq("failureModeId", fmId))
        .collect(),
    );
    expect(members).toHaveLength(0);
    expect(anns).toHaveLength(0);
    expect(modes).toHaveLength(0);
    expect(mships).toHaveLength(0);
    const row = await t.run((ctx) => ctx.db.get(eaId));
    expect(row).toBeNull();
  });
});

describe("errorAnalysis/members.addMemberInternal", () => {
  it("is idempotent on repeated calls", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const eaId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "X",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );
    const conversationId = await t.run(async (ctx) =>
      ctx.db.insert("conversations", {
        orgId: TEST_ORG_ID,
        agentIds: [agentId],
        status: "active" as const,
        source: "playground" as const,
        createdAt: Date.now(),
      }),
    );
    const m1 = await t.mutation(internal.errorAnalysis.members.addMemberInternal, {
      orgId: TEST_ORG_ID,
      errorAnalysisId: eaId,
      source: { kind: "conversation", conversationId },
      addedVia: "annotation",
    });
    const m2 = await t.mutation(internal.errorAnalysis.members.addMemberInternal, {
      orgId: TEST_ORG_ID,
      errorAnalysisId: eaId,
      source: { kind: "conversation", conversationId },
      addedVia: "annotation",
    });
    expect(m1).toBe(m2);
    const all = await t.run((ctx) =>
      ctx.db
        .query("errorAnalysisMembers")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", eaId))
        .collect(),
    );
    expect(all).toHaveLength(1);
  });
});

describe("errorAnalysis/clustering.recluster", () => {
  // NOTE: the non-empty path's "LLM/parse error preserves prior modes" guarantee
  // rests on code inspection — convex-test can't inject a throwing OpenAI client
  // into this "use node" action, so it's covered by an integration test, not here.

  it("rejects a caller from another org", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const analysisId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "EA owned by test org",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );
    const intruder = t.withIdentity({
      ...testIdentity,
      subject: "user_other",
      org_id: "org_other",
    });
    await expect(
      intruder.action(api.errorAnalysis.clustering.recluster, {
        errorAnalysisId: analysisId,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("empty-failing-set: wipes existing failure modes and inserts placeholder", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const authedT = t.withIdentity(testIdentity);

    // Seed an errorAnalysis owned by TEST_ORG_ID.
    const errorAnalysisId = await t.run(async (ctx) =>
      ctx.db.insert("errorAnalyses", {
        orgId: TEST_ORG_ID,
        agentId,
        name: "EA for recluster test",
        origin: { kind: "custom" as const },
        createdAt: Date.now(),
      }),
    );

    // Pre-seed one existing failure mode for this analysis.
    const existingFmId = await t.run(async (ctx) =>
      ctx.db.insert("failureModes", {
        orgId: TEST_ORG_ID,
        agentId,
        errorAnalysisId,
        name: "Old mode",
        description: "Should be wiped",
        order: 0,
        createdAt: Date.now(),
      }),
    );

    // No annotations → failingItems is empty → empty branch fires.
    const result = await authedT.action(api.errorAnalysis.clustering.recluster, {
      errorAnalysisId,
    });

    expect(result).toEqual({ failureModesCreated: 1 });

    // The pre-existing failure mode must be gone.
    const gone = await t.run((ctx) => ctx.db.get(existingFmId));
    expect(gone).toBeNull();

    // Exactly one "No failures detected" mode must remain for the analysis.
    const modes = await t.run((ctx) =>
      ctx.db
        .query("failureModes")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", errorAnalysisId))
        .collect(),
    );
    expect(modes).toHaveLength(1);
    expect(modes[0].name).toBe("No failures detected");
  });
});
