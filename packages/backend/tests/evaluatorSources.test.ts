import { describe, it, expect } from "vitest";
import { normalizeTranscriptMessages } from "../convex/evaluator/sources";
import { internal } from "../convex/_generated/api";
import { setupTest, TEST_ORG_ID, seedUser } from "./helpers";

describe("normalizeTranscriptMessages", () => {
  const base = {
    messages: [
      { id: 1, role: "user" as const, text: "hi" },
      { id: 2, role: "human_agent" as const, text: "hello, how can I help?" },
      { id: 3, role: "workflow_input" as const, text: "intent=greet" },
    ],
  };

  it("maps livechat roles to judge roles and drops workflow_input", () => {
    const out = normalizeTranscriptMessages(base as any);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello, how can I help?" },
    ]);
  });

  it("prefers translatedMessages text when present (matched by id)", () => {
    const withTranslation = {
      ...base,
      translatedMessages: [
        { id: 1, text: "hi (translated)" },
        { id: 2, text: "hello (translated)" },
      ],
    };
    const out = normalizeTranscriptMessages(withTranslation as any);
    expect(out).toEqual([
      { role: "user", content: "hi (translated)" },
      { role: "assistant", content: "hello (translated)" },
    ]);
  });
});

describe("getMessagesForSource (transcript)", () => {
  it("returns normalized messages for a transcript source", async () => {
    const t = setupTest();
    const userId = await seedUser(t);

    const transcriptId = await t.run(async (ctx) => {
      const uploadId = await ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId: await ctx.storage.store(new Blob(["a,b\n1,2"])),
        status: "ready",
        createdAt: Date.now(),
      });

      return await ctx.db.insert("livechatConversations", {
        uploadId,
        orgId: TEST_ORG_ID,
        conversationId: "conv-1",
        visitorId: "vis-1",
        visitorName: "Visitor",
        visitorPhone: "",
        visitorEmail: "",
        agentId: "agent-1",
        agentName: "Agent",
        agentEmail: "",
        inbox: "default",
        labels: [],
        status: "closed",
        messages: [
          { id: 1, role: "user", text: "hi" },
          { id: 2, role: "human_agent", text: "hello" },
        ],
        metadata: {},
        classificationStatus: "none",
        translationStatus: "none",
      });
    });

    const out = await t.query(internal.evaluator.sources.getMessagesForSource, {
      source: { kind: "transcript", transcriptId },
    });

    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});
