import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyMessageTypes } from "../../../src/data-analysis/message-type-classifier.js";
import type { RawConversation } from "../../../src/data-analysis/types.js";

// Mock the Anthropic client
const mockCreate = vi.fn();
const mockClient = { messages: { create: mockCreate } } as any;

describe("classifyMessageTypes (new format)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("returns classifiedMessages and blocks", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          messages: [
            { messageId: 1, label: "procedural", confidence: "high", isFollowUp: false },
            { messageId: 2, label: "greeting", confidence: "high", isFollowUp: false },
            { messageId: 3, label: "question", confidence: "high", isFollowUp: false, intentOpenCode: "pricing_inquiry" },
            { messageId: 4, label: "response", confidence: "high", isFollowUp: false },
            { messageId: 5, label: "question", confidence: "high", isFollowUp: false, intentOpenCode: "data_plan" },
            { messageId: 6, label: "response", confidence: "high", isFollowUp: false },
          ],
        },
      }],
    });

    const conv: RawConversation = {
      conversationId: "test-1",
      visitorId: "v1", visitorName: "Ahmed", visitorPhone: "", visitorEmail: "",
      agentId: "a1", agentName: "Sarah", agentEmail: "",
      inbox: "support", labels: [], status: "resolved",
      messages: [
        { id: 1, role: "human_agent", text: "Welcome!" },
        { id: 2, role: "user", text: "Hi" },
        { id: 3, role: "user", text: "What are the 5G plans?" },
        { id: 4, role: "human_agent", text: "We have Basic, Plus, Premium." },
        { id: 5, role: "user", text: "Which has the most data?" },
        { id: 6, role: "human_agent", text: "Premium has unlimited data." },
      ],
      metadata: {} as any,
    };

    const result = await classifyMessageTypes(conv, {
      claudeClient: mockClient,
      templateId: "cx-transcript-analysis",
    });

    expect(result.classifiedMessages).toHaveLength(6);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].label).toBe("greeting");
    expect(result.blocks[1].label).toBe("question");
    expect(result.blocks[1].intentOpenCode).toBe("data_plan");
  });

  it("returns botFlowInput when workflow_input first message is present", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        input: {
          messages: [
            { messageId: 2, label: "greeting", confidence: "high", isFollowUp: false },
            { messageId: 3, label: "response", confidence: "high", isFollowUp: false },
          ],
        },
      }],
    });

    const conv: RawConversation = {
      conversationId: "test-2",
      visitorId: "v2", visitorName: "Fatima", visitorPhone: "", visitorEmail: "",
      agentId: "a1", agentName: "Sarah", agentEmail: "",
      inbox: "support", labels: [], status: "resolved",
      messages: [
        { id: 1, role: "workflow_input", text: "Continue in English, -No Input-, New Postpaid Plan, English," },
        { id: 2, role: "user", text: "Hello" },
        { id: 3, role: "human_agent", text: "Hi, how can I help?" },
      ],
      metadata: {} as any,
    };

    const result = await classifyMessageTypes(conv, {
      claudeClient: mockClient,
      templateId: "cx-transcript-analysis",
    });

    expect(result.botFlowInput).toBeDefined();
    expect(result.botFlowInput!.intent).toBe("New Postpaid Plan");
    expect(result.classifiedMessages).toHaveLength(2);
  });

  it("skips LLM when there are no user/agent messages", async () => {
    const conv: RawConversation = {
      conversationId: "test-3",
      visitorId: "v3", visitorName: "Ali", visitorPhone: "", visitorEmail: "",
      agentId: "a1", agentName: "Sarah", agentEmail: "",
      inbox: "support", labels: [], status: "resolved",
      messages: [
        { id: 1, role: "workflow_input", text: "Assigned to Agent by Admin" },
        { id: 2, role: "workflow_input", text: "Conversation was marked resolved by Agent" },
      ],
      metadata: {} as any,
    };

    const result = await classifyMessageTypes(conv, {
      claudeClient: mockClient,
      templateId: "cx-transcript-analysis",
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.classifiedMessages).toHaveLength(0);
    expect(result.blocks).toHaveLength(0);
  });
});
