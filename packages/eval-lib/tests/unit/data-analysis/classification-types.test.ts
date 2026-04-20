import { describe, it, expect } from "vitest";
import type {
  ClassificationTemplate,
  CategoryDefinition,
  AgentRoleDefinition,
  FewShotExample,
  LLMClassifiedMessage,
  ClassifiedMessage,
  ConversationBlock,
} from "../../../src/data-analysis/types.js";

describe("Classification types", () => {
  it("ClassifiedMessage extends LLMClassifiedMessage with source", () => {
    const llmMsg: LLMClassifiedMessage = {
      messageId: 1,
      label: "question",
      intentOpenCode: "pricing_inquiry",
      confidence: "high",
      isFollowUp: false,
    };
    const stored: ClassifiedMessage = { ...llmMsg, source: "llm" };
    expect(stored.source).toBe("llm");
    expect(stored.messageId).toBe(1);
  });

  it("ConversationBlock references message IDs", () => {
    const block: ConversationBlock = {
      label: "question",
      intentOpenCode: "pricing_inquiry",
      confidence: "high",
      isFollowUp: false,
      messageIds: [3, 4],
    };
    expect(block.messageIds).toHaveLength(2);
  });

  it("ClassificationTemplate has categories and agentRoles", () => {
    const tpl: ClassificationTemplate = {
      id: "test",
      name: "Test",
      description: "test template",
      categories: [{ id: "question", name: "Question", description: "A question", examples: [] }],
      agentRoles: [{ id: "response", name: "Response", description: "Agent responds" }],
      disambiguationRules: ["Rule 1"],
    };
    expect(tpl.categories).toHaveLength(1);
    expect(tpl.agentRoles).toHaveLength(1);
  });
});
