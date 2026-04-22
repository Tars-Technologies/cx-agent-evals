import type { BasicStats, AgentStats } from "./types.js";

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute aggregate statistics from a stream of CSV rows.
 * Does not parse transcripts — only uses metadata columns.
 */
export async function computeBasicStats(
  rows: AsyncIterable<Record<string, string>>
): Promise<BasicStats> {
  let totalConversations = 0;
  let withUser = 0;
  let withoutUser = 0;
  const visitorIds = new Set<string>();
  const agentIds = new Set<string>();
  const statusCounts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  const agentMap = new Map<string, AgentStats>();
  const visitorMsgCounts: number[] = [];
  const agentMsgCounts: number[] = [];
  const durations: number[] = [];
  let earliestStart = "";
  let latestStart = "";

  for await (const row of rows) {
    totalConversations++;

    const visitorMsgs = parseInt(row["Number of messages sent by the visitor"] || "0", 10);
    const agentMsgs = parseInt(row["Number of messages sent by the agent"] || "0", 10);
    const duration = parseInt(row["Total Conversation duration in Seconds"] || "0", 10);

    if (visitorMsgs > 0) withUser++;
    else withoutUser++;

    visitorIds.add(row["Visitor ID"]);
    agentIds.add(row["Agent ID"]);

    const status = row["Status"] || "unknown";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const labels = (row["Labels"] || "")
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const label of labels) {
      labelCounts[label] = (labelCounts[label] || 0) + 1;
    }

    const agentKey = row["Agent ID"];
    const existing = agentMap.get(agentKey);
    if (existing) {
      existing.conversationCount++;
      existing.totalMessagesFromAgent += agentMsgs;
    } else {
      agentMap.set(agentKey, {
        agentName: row["Agent Name"] || "",
        agentEmail: row["Agent Email"] || "",
        conversationCount: 1,
        totalMessagesFromAgent: agentMsgs,
      });
    }

    visitorMsgCounts.push(visitorMsgs);
    agentMsgCounts.push(agentMsgs);
    durations.push(duration);

    const startDate = row["Start Date"] || "";
    if (!earliestStart || startDate < earliestStart) earliestStart = startDate;
    if (!latestStart || startDate > latestStart) latestStart = startDate;
  }

  visitorMsgCounts.sort((a, b) => a - b);
  agentMsgCounts.sort((a, b) => a - b);
  durations.sort((a, b) => a - b);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);

  return {
    source: "",
    generatedAt: new Date().toISOString(),
    totalConversations,
    conversationsWithUserMessages: withUser,
    conversationsWithoutUserMessages: withoutUser,
    uniqueVisitors: visitorIds.size,
    uniqueAgents: agentIds.size,
    statusBreakdown: statusCounts,
    labelBreakdown: labelCounts,
    agentBreakdown: Array.from(agentMap.values()).sort(
      (a, b) => b.conversationCount - a.conversationCount
    ),
    visitorStats: {
      avgMessagesPerConversation: Math.round(avg(visitorMsgCounts) * 100) / 100,
      medianMessagesPerConversation: median(visitorMsgCounts),
    },
    agentStats: {
      avgMessagesPerConversation: Math.round(avg(agentMsgCounts) * 100) / 100,
      medianMessagesPerConversation: median(agentMsgCounts),
    },
    durationStats: {
      avgDurationSeconds: Math.round(avg(durations)),
      medianDurationSeconds: median(durations),
      minDurationSeconds: durations[0] ?? 0,
      maxDurationSeconds: durations[durations.length - 1] ?? 0,
    },
    timeRange: {
      earliestStart,
      latestStart,
    },
  };
}
