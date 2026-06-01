import { describe, it, expect, vi } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

vi.mock("openai", () => {
  return {
    default: class {
      chat = {
        completions: {
          create: async (args: any) => {
            // The transcript under test lives in the user message; the system
            // message carries the rubric + few-shot examples. Judge on the
            // transcript only so few-shot pass examples don't leak the marker.
            const transcript = args.messages
              .filter((m: any) => m.role === "user")
              .map((m: any) => m.content)
              .join("\n");
            const answer = transcript.includes("GOOD") ? "pass" : "fail";
            return {
              choices: [
                { message: { content: JSON.stringify({ answer, reasoning: "mock" }) } },
              ],
            };
          },
        },
      };
    },
  };
});

type Split = "train" | "dev" | "test";
type ClassCounts = { pass: number; fail: number };

interface SeedOpts {
  dev: ClassCounts;
  test: ClassCounts;
  train: ClassCounts;
  perfect?: boolean;
  sourceKind?: "conversation" | "transcript";
}

async function seedAgent(
  t: ReturnType<typeof setupTest>,
): Promise<Id<"agents">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("agents", {
      orgId: TEST_ORG_ID,
      name: "Test Agent",
      identity: {
        agentName: "Bot",
        companyName: "Corp",
        roleDescription: "Helper",
      },
      guardrails: {},
      responseStyle: {},
      model: "gpt-4o-mini",
      enableReflection: false,
      retrieverIds: [],
      status: "ready",
      createdAt: Date.now(),
    }),
  );
}

async function seedJudgeWithLabels(
  t: ReturnType<typeof setupTest>,
  opts: SeedOpts,
): Promise<{ agentId: Id<"agents">; evaluatorId: Id<"evaluators"> }> {
  const userId = await seedUser(t);
  const agentId = await seedAgent(t);
  const sourceKind = opts.sourceKind ?? "conversation";
  const perfect = opts.perfect ?? false;

  const evaluatorId = await t.run(async (ctx) =>
    ctx.db.insert("evaluators", {
      orgId: TEST_ORG_ID,
      agentId,
      name: "honest judge",
      description: "",
      type: "llm_judge" as const,
      llmJudgeConfig: {
        dimensions: [
          {
            name: "quality",
            rubric: "respond well",
            passExamples: [],
            failExamples: [],
          },
        ],
        outputFormat: "per_dimension" as const,
        model: "gpt-4o-mini",
        inputContext: ["transcript" as const],
      },
      source: { kind: "manual" as const },
      status: "draft" as const,
      tags: [],
      createdAt: Date.now(),
      splitSeed: 42,
    }),
  );

  // For transcript sources we need a parent upload.
  let uploadId: Id<"livechatUploads"> | undefined;
  if (sourceKind === "transcript") {
    uploadId = await t.run(async (ctx) => {
      const csvStorageId = await ctx.storage.store(
        new Blob(["csv"], { type: "text/csv" }),
      );
      return ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "t.csv",
        csvStorageId,
        status: "ready" as const,
        createdAt: Date.now(),
      });
    });
  }

  let counter = 0;
  const makeLabel = async (split: Split, humanLabel: "pass" | "fail") => {
    // Perfect judge: pass-labels contain GOOD, fail-labels do not.
    const hasGood = perfect && humanLabel === "pass";
    const text = hasGood ? "this is GOOD work" : "this is bad work";
    const idx = counter++;

    let source:
      | { kind: "conversation"; conversationId: Id<"conversations"> }
      | { kind: "transcript"; transcriptId: Id<"livechatConversations"> };

    if (sourceKind === "conversation") {
      const conversationId = await t.run(async (ctx) => {
        const convId = await ctx.db.insert("conversations", {
          orgId: TEST_ORG_ID,
          agentIds: [agentId],
          status: "active" as const,
          source: "playground" as const,
          createdAt: Date.now(),
        });
        await ctx.db.insert("messages", {
          conversationId: convId,
          order: 0,
          role: "assistant" as const,
          content: text,
          status: "complete" as const,
          createdAt: Date.now(),
        });
        return convId;
      });
      source = { kind: "conversation", conversationId };
    } else {
      const transcriptId = await t.run(async (ctx) =>
        ctx.db.insert("livechatConversations", {
          uploadId: uploadId!,
          orgId: TEST_ORG_ID,
          conversationId: `c${idx}`,
          visitorId: "v1",
          visitorName: "",
          visitorPhone: "",
          visitorEmail: "",
          agentId: "",
          agentName: "",
          agentEmail: "",
          inbox: "",
          labels: [],
          status: "",
          messages: [{ id: 0, role: "human_agent" as const, text }],
          metadata: {},
          classificationStatus: "none" as const,
          translationStatus: "none" as const,
        }),
      );
      source = { kind: "transcript", transcriptId };
    }

    await t.run(async (ctx) =>
      ctx.db.insert("evaluatorLabels", {
        orgId: TEST_ORG_ID,
        evaluatorId,
        source,
        humanLabel,
        splitAssignment: split,
        origin:
          humanLabel === "pass"
            ? { kind: "calibration_pass" as const }
            : { kind: "inferred_negative" as const },
        ratedBy: userId,
        createdAt: Date.now(),
      }),
    );
  };

  const splits: Split[] = ["train", "dev", "test"];
  for (const split of splits) {
    const counts = opts[split];
    for (let i = 0; i < counts.pass; i++) await makeLabel(split, "pass");
    for (let i = 0; i < counts.fail; i++) await makeLabel(split, "fail");
  }

  return { agentId, evaluatorId };
}

describe("validate.run (honest)", () => {
  it("reports calibrating + insufficient_labels when below MIN_PER_CLASS", async () => {
    const t = setupTest();
    const { evaluatorId } = await seedJudgeWithLabels(t, {
      dev: { pass: 2, fail: 2 },
      test: { pass: 0, fail: 0 },
      train: { pass: 1, fail: 1 },
      perfect: true,
    });
    const res = await t
      .withIdentity(testIdentity)
      .action(api.evaluator.validate.run, { evaluatorId });
    expect(res.status).toBe("calibrating");
    expect(res.reason).toBe("insufficient_labels");
  });

  it("confirms on the test split and marks ready when test metrics clear thresholds", async () => {
    const t = setupTest();
    const { evaluatorId } = await seedJudgeWithLabels(t, {
      dev: { pass: 5, fail: 5 },
      test: { pass: 5, fail: 5 },
      train: { pass: 2, fail: 2 },
      perfect: true,
    });
    const res = await t
      .withIdentity(testIdentity)
      .action(api.evaluator.validate.run, { evaluatorId });
    expect(res.status).toBe("ready");
    expect(res.testMetrics).not.toBeNull();
    const ev = await t.run(async (ctx) => ctx.db.get(evaluatorId));
    expect(ev!.testMetrics!.n).toBe(10);
    expect(ev!.validatedAt).toBeGreaterThan(0);
  });

  it("scores transcript-sourced labels instead of skipping them", async () => {
    const t = setupTest();
    const { evaluatorId } = await seedJudgeWithLabels(t, {
      dev: { pass: 5, fail: 5 },
      test: { pass: 5, fail: 5 },
      train: { pass: 2, fail: 2 },
      perfect: true,
      sourceKind: "transcript",
    });
    const res = await t
      .withIdentity(testIdentity)
      .action(api.evaluator.validate.run, { evaluatorId });
    expect(res.devMetrics.agreement).toBeGreaterThan(0);
  });

  it("rejects validate for evaluator in a different org", async () => {
    const t = setupTest();
    await seedUser(t);
    const agentId = await seedAgent(t);
    const foreignId = await t.run(async (ctx) =>
      ctx.db.insert("evaluators", {
        orgId: "org_other",
        agentId,
        name: "f",
        description: "",
        type: "code",
        codeJudgeConfig: {
          checkType: "string_contains",
          params: { needle: "x" },
        },
        source: { kind: "manual" },
        status: "draft",
        tags: [],
        createdAt: Date.now(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    );
    await expect(
      t
        .withIdentity(testIdentity)
        .action(api.evaluator.validate.run, { evaluatorId: foreignId }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects validate without auth", async () => {
    const t = setupTest();
    const { evaluatorId } = await seedJudgeWithLabels(t, {
      dev: { pass: 1, fail: 1 },
      test: { pass: 0, fail: 0 },
      train: { pass: 1, fail: 1 },
      perfect: true,
    });
    await expect(
      t.action(api.evaluator.validate.run, { evaluatorId }),
    ).rejects.toThrow();
  });
});
