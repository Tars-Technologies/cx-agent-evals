import { describe, it, expect } from "vitest";
import {
  preprocessConversation,
  assembleConversation,
  isSystemMessage,
} from "../../../src/data-analysis/microtopic-extractor.js";
import type { RawConversation, LLMExtractionResult } from "../../../src/data-analysis/types.js";

function makeConversation(overrides: Partial<RawConversation> = {}): RawConversation {
  return {
    conversationId: "1",
    visitorId: "v1",
    visitorName: "Test",
    visitorPhone: "+123",
    visitorEmail: "",
    agentId: "a1",
    agentName: "Agent",
    agentEmail: "a@test.com",
    inbox: "Test",
    labels: ["language_english"],
    status: "Resolved",
    messages: [
      { id: 1, role: "workflow_input", text: "Continue in English, -No Input-, New Postpaid Plan, English," },
      { id: 2, role: "workflow_input", text: "Assigned to Agent by Admin" },
      { id: 3, role: "user", text: "Hello" },
      { id: 4, role: "human_agent", text: "Hi there!" },
      { id: 5, role: "workflow_input", text: "Conversation was marked resolved by Agent" },
    ],
    metadata: {
      messageCountVisitor: 1,
      messageCountAgent: 1,
      totalDurationSeconds: 600,
      startDate: "01/01/2026",
      startTime: "12:00:00 AM",
      replyDate: "01/01/2026",
      replyTime: "12:01:00 AM",
      lastActivityDate: "01/01/2026",
      lastActivityTime: "12:10:00 AM",
    },
    ...overrides,
  };
}

describe("isSystemMessage", () => {
  it("should identify assignment messages", () => {
    expect(isSystemMessage("Assigned to John by Admin")).toBe(true);
  });

  it("should identify self-assignment messages", () => {
    expect(isSystemMessage("John self-assigned this conversation")).toBe(true);
  });

  it("should identify unassignment messages", () => {
    expect(isSystemMessage("Conversation unassigned by John")).toBe(true);
  });

  it("should identify resolution messages", () => {
    expect(isSystemMessage("Conversation was marked resolved by John")).toBe(true);
  });

  it("should identify label addition messages", () => {
    expect(isSystemMessage("John added campaign_mobile, language_english")).toBe(true);
  });

  it("should NOT match regular user messages", () => {
    expect(isSystemMessage("Hello, I need help")).toBe(false);
  });
});

describe("preprocessConversation", () => {
  it("should extract botFlowInput from first workflow message", () => {
    const conv = makeConversation();
    const result = preprocessConversation(conv);
    expect(result.botFlowInput).toBeDefined();
    expect(result.botFlowInput!.intent).toBe("New Postpaid Plan");
    expect(result.botFlowInput!.language).toBe("English");
    expect(result.botFlowInput!.messageIds).toEqual([1]);
  });

  it("should separate system messages from LLM input", () => {
    const conv = makeConversation();
    const result = preprocessConversation(conv);
    // System messages: id 2 (assignment), id 5 (resolution)
    expect(result.systemMessageIds).toEqual(new Set([2, 5]));
    // LLM input: only user + agent messages (id 3, 4)
    expect(result.llmInputMessages.map((m) => m.id)).toEqual([3, 4]);
  });

  it("should skip LLM when no user/agent messages", () => {
    const conv = makeConversation({
      messages: [
        { id: 1, role: "workflow_input", text: "Assigned to Agent by Admin" },
        { id: 2, role: "workflow_input", text: "Conversation was marked resolved by Agent" },
      ],
    });
    const result = preprocessConversation(conv);
    expect(result.llmInputMessages).toHaveLength(0);
    expect(result.skipLLM).toBe(true);
  });
});

describe("assembleConversation", () => {
  it("should merge LLM results with system messages in ID order", () => {
    const conv = makeConversation();
    const preprocess = preprocessConversation(conv);
    const llmResult: LLMExtractionResult = {
      microtopics: [
        {
          type: "greeting",
          exchanges: [{ label: "primary", messageIds: [3, 4] }],
        },
      ],
    };

    const result = assembleConversation(conv, preprocess, llmResult);

    expect(result.conversationId).toBe("1");
    expect(result.language).toBe("English");
    expect(result.botFlowInput).toBeDefined();

    // Should have: uncategorized(2), greeting(3,4), uncategorized(5)
    expect(result.microtopics).toHaveLength(3);
    expect(result.microtopics[0].type).toBe("uncategorized");
    expect(result.microtopics[0].exchanges[0].messages[0].id).toBe(2);
    expect(result.microtopics[1].type).toBe("greeting");
    expect(result.microtopics[1].exchanges[0].messages.map((m) => m.id)).toEqual([3, 4]);
    expect(result.microtopics[2].type).toBe("uncategorized");
    expect(result.microtopics[2].exchanges[0].messages[0].id).toBe(5);
  });

  it("should add missing IDs as uncategorized", () => {
    const conv = makeConversation();
    const preprocess = preprocessConversation(conv);
    // LLM only returns message 3, missing message 4
    const llmResult: LLMExtractionResult = {
      microtopics: [
        {
          type: "greeting",
          exchanges: [{ label: "primary", messageIds: [3] }],
        },
      ],
    };

    const result = assembleConversation(conv, preprocess, llmResult);

    // Message 4 should appear as uncategorized
    const allIds = result.microtopics.flatMap((m) =>
      m.exchanges.flatMap((e) => e.messages.map((msg) => msg.id))
    );
    expect(allIds).toContain(4);
  });

  it("should strip hallucinated IDs", () => {
    const conv = makeConversation();
    const preprocess = preprocessConversation(conv);
    const llmResult: LLMExtractionResult = {
      microtopics: [
        {
          type: "greeting",
          exchanges: [{ label: "primary", messageIds: [3, 4, 999] }], // 999 doesn't exist
        },
      ],
    };

    const result = assembleConversation(conv, preprocess, llmResult);

    const allIds = result.microtopics.flatMap((m) =>
      m.exchanges.flatMap((e) => e.messages.map((msg) => msg.id))
    );
    expect(allIds).not.toContain(999);
  });
});
