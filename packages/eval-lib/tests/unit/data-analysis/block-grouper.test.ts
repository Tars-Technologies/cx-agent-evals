import { describe, it, expect } from "vitest";
import { groupIntoBlocks } from "../../../src/data-analysis/block-grouper.js";
import type { ClassifiedMessage } from "../../../src/data-analysis/types.js";

describe("groupIntoBlocks", () => {
  it("groups user + agent into one block", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "question", confidence: "high", isFollowUp: false, source: "llm", intentOpenCode: "pricing" },
      { messageId: 2, label: "response", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "user"], [2, "human_agent"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe("question");
    expect(blocks[0].intentOpenCode).toBe("pricing");
    expect(blocks[0].messageIds).toEqual([1, 2]);
  });

  it("starts new block when user message appears after agent", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "greeting", confidence: "high", isFollowUp: false, source: "llm" },
      { messageId: 2, label: "procedural", confidence: "high", isFollowUp: false, source: "llm" },
      { messageId: 3, label: "question", confidence: "high", isFollowUp: false, source: "llm", intentOpenCode: "plans" },
      { messageId: 4, label: "response", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "user"], [2, "human_agent"], [3, "user"], [4, "human_agent"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].label).toBe("greeting");
    expect(blocks[1].label).toBe("question");
  });

  it("keeps consecutive user messages in same block", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "question", confidence: "high", isFollowUp: false, source: "llm", intentOpenCode: "plans" },
      { messageId: 2, label: "question", confidence: "high", isFollowUp: false, source: "llm", intentOpenCode: "plans" },
      { messageId: 3, label: "response", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "user"], [2, "user"], [3, "human_agent"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].messageIds).toEqual([1, 2, 3]);
  });

  it("handles conversation starting with agent message", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "procedural", confidence: "high", isFollowUp: false, source: "llm" },
      { messageId: 2, label: "greeting", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "human_agent"], [2, "user"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe("greeting");
    expect(blocks[0].messageIds).toEqual([1, 2]);
  });

  it("propagates follow-up data from first user message", () => {
    const messages: ClassifiedMessage[] = [
      { messageId: 1, label: "question", confidence: "low", isFollowUp: true, followUpType: "clarification", standaloneVersion: "What is the data limit on 5G Plus?", source: "llm", intentOpenCode: "data_limits" },
      { messageId: 2, label: "response", confidence: "high", isFollowUp: false, source: "llm" },
    ];
    const roles = new Map([[1, "user"], [2, "human_agent"]]);
    const blocks = groupIntoBlocks(messages, roles);
    expect(blocks[0].isFollowUp).toBe(true);
    expect(blocks[0].followUpType).toBe("clarification");
    expect(blocks[0].standaloneVersion).toBe("What is the data limit on 5G Plus?");
    expect(blocks[0].confidence).toBe("low");
  });
});
