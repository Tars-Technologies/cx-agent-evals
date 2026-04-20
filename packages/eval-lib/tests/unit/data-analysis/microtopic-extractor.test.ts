import { describe, it, expect } from "vitest";
import {
  preprocessConversation,
  isSystemMessage,
} from "../../../src/data-analysis/message-type-classifier.js";
import type { RawConversation } from "../../../src/data-analysis/types.js";

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

