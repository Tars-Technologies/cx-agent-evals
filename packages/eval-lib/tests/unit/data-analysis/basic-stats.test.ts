import { describe, it, expect } from "vitest";
import { computeBasicStats } from "../../../src/data-analysis/basic-stats.js";

function makeRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    "Conversation ID": "1",
    "Visitor ID": "v1",
    "Visitor Name": "Test",
    "Visitor Email": "",
    "Visitor Phone": "+123",
    "Agent ID": "a1",
    "Agent Name": "Agent One",
    "Agent Email": "a1@test.com",
    "Inbox ID": "1",
    "Inbox": "Test Inbox",
    "Labels": "label_a,label_b",
    "Status": "Resolved",
    "Transcript": "Visitor : Hello || Agent : Hi",
    "Number of messages sent by the visitor": "1",
    "Number of messages sent by the agent": "1",
    "Total Conversation duration in Seconds": "600",
    "Start Date": "01/07/2025",
    "Start Time": "12:00:00 AM",
    "Reply Date": "01/07/2025",
    "Reply Time": "12:01:00 AM",
    "Last Activity Date": "01/07/2025",
    "Last Activity Time": "12:10:00 AM",
    ...overrides,
  };
}

async function* toAsyncIterable(rows: Record<string, string>[]) {
  for (const row of rows) yield row;
}

describe("computeBasicStats", () => {
  it("should count total conversations", async () => {
    const stats = await computeBasicStats(toAsyncIterable([makeRow(), makeRow({ "Conversation ID": "2" })]));
    expect(stats.totalConversations).toBe(2);
  });

  it("should count unique visitors and agents", async () => {
    const rows = [
      makeRow({ "Visitor ID": "v1", "Agent ID": "a1" }),
      makeRow({ "Conversation ID": "2", "Visitor ID": "v2", "Agent ID": "a1" }),
      makeRow({ "Conversation ID": "3", "Visitor ID": "v1", "Agent ID": "a2" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.uniqueVisitors).toBe(2);
    expect(stats.uniqueAgents).toBe(2);
  });

  it("should count conversations with and without user messages", async () => {
    const rows = [
      makeRow({ "Number of messages sent by the visitor": "5" }),
      makeRow({ "Conversation ID": "2", "Number of messages sent by the visitor": "0" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.conversationsWithUserMessages).toBe(1);
    expect(stats.conversationsWithoutUserMessages).toBe(1);
  });

  it("should compute duration stats", async () => {
    const rows = [
      makeRow({ "Total Conversation duration in Seconds": "100" }),
      makeRow({ "Conversation ID": "2", "Total Conversation duration in Seconds": "200" }),
      makeRow({ "Conversation ID": "3", "Total Conversation duration in Seconds": "300" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.durationStats.avgDurationSeconds).toBe(200);
    expect(stats.durationStats.medianDurationSeconds).toBe(200);
    expect(stats.durationStats.minDurationSeconds).toBe(100);
    expect(stats.durationStats.maxDurationSeconds).toBe(300);
  });

  it("should break down labels", async () => {
    const rows = [
      makeRow({ "Labels": "campaign_mobile,language_english" }),
      makeRow({ "Conversation ID": "2", "Labels": "campaign_mobile,language_arabic" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.labelBreakdown["campaign_mobile"]).toBe(2);
    expect(stats.labelBreakdown["language_english"]).toBe(1);
    expect(stats.labelBreakdown["language_arabic"]).toBe(1);
  });

  it("should break down agents", async () => {
    const rows = [
      makeRow({ "Agent Name": "Aya", "Agent Email": "aya@test.com", "Number of messages sent by the agent": "10" }),
      makeRow({ "Conversation ID": "2", "Agent Name": "Aya", "Agent Email": "aya@test.com", "Number of messages sent by the agent": "5" }),
    ];
    const stats = await computeBasicStats(toAsyncIterable(rows));
    expect(stats.agentBreakdown).toHaveLength(1);
    expect(stats.agentBreakdown[0].agentName).toBe("Aya");
    expect(stats.agentBreakdown[0].conversationCount).toBe(2);
    expect(stats.agentBreakdown[0].totalMessagesFromAgent).toBe(15);
  });
});
